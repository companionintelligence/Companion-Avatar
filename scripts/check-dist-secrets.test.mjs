import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertNoDistSecrets,
  envFilesIn,
  findSecretShapes,
  parseEnvFile,
  scanDist,
  secretValues,
  valueForms
} from './check-dist-secrets.mjs'

/**
 * `dist/` is served to every visitor, and Vite inlines every VITE_* value into it, two of which
 * (VITE_LLM_OPENAI_API_KEY, VITE_TTS_API_KEY) are credentials. These cases pin what the build check
 * must catch, what it must leave alone, and that it never prints what it found.
 *
 * Every credential below is assembled at run time from harmless pieces, so this file holds no
 * string that a secret scanner (or the check itself) would take for one.
 */
const fake = {
  providerKey: () => 'sk' + '-' + 'q'.repeat(30),
  awsKeyId: () => 'AK' + 'IA' + 'Z'.repeat(16),
  githubToken: () => 'gh' + 'p_' + 'a1'.repeat(20),
  slackToken: () => 'xo' + 'xb-' + '1234567890-abcdefghij',
  tailscaleKey: () => 'ts' + 'key-' + 'auth-' + 'k'.repeat(16),
  privateKeyHeader: () => '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  bearer: () => 'Bea' + 'rer ' + 'abcdefghij0123456789ABCDEF',
  urlWithPassword: () => 'https://' + 'operator' + ':' + 'hunter2hunter2' + '@db.example.net/app'
}

const dirs = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-secrets-'))
  dirs.push(dir)
  return dir
}
const put = (dir, name, content) => {
  const path = join(dir, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('findSecretShapes', () => {
  it.each([
    ['provider-key (sk-...)', fake.providerKey],
    ['aws-access-key-id', fake.awsKeyId],
    ['github-token', fake.githubToken],
    ['slack-token', fake.slackToken],
    ['tailscale-key', fake.tailscaleKey],
    ['private-key-block', fake.privateKeyHeader],
    ['bearer-token-literal', fake.bearer],
    ['url-with-password', fake.urlWithPassword]
  ])('names %s', (rule, make) => {
    expect(findSecretShapes(`const x = "${make()}";`)).toEqual([rule])
  })

  it('leaves minified application code alone', () => {
    const code = [
      'headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"}',
      'const h = `Bearer ${token}`',
      'a.headers.set("Authorization", "Bearer " + key)',
      'const desk = "desk-lamp-with-a-very-long-descriptive-name-0123456789"',
      'const task = "risk-assessment-task-management-0123456789abcdef"',
      'const ask = "ask-the-companion-about-anything-0123456789abcdef"'
    ].join('\n')
    expect(findSecretShapes(code)).toEqual([])
  })

  it('leaves a Sentry DSN and other URLs without a password alone', () => {
    const urls = [
      'https://0123456789abcdef0123456789abcdef@o12345.ingest.us.sentry.io/6789',
      'https://user@example.com/path',
      'postgres://localhost:5432/appdb',
      'http://localhost:8787/api/chat',
      'wss://avatar-api.ci.computer:443/talk'
    ].join('\n')
    expect(findSecretShapes(urls)).toEqual([])
  })

  it('reports each rule once however often it matches', () => {
    expect(findSecretShapes(`${fake.providerKey()} ${fake.providerKey()}`)).toEqual(['provider-key (sk-...)'])
  })
})

describe('parseEnvFile', () => {
  it('reads NAME=value lines, quotes, export, comments and blanks', () => {
    const parsed = parseEnvFile(
      ['# a comment', '', 'VITE_A=plain', 'export VITE_B="double quoted"', "VITE_C='single quoted'", 'VITE_D=', 'not a line', '  VITE_E = spaced  '].join('\n')
    )
    expect(Object.fromEntries(parsed)).toEqual({
      VITE_A: 'plain',
      VITE_B: 'double quoted',
      VITE_C: 'single quoted',
      VITE_D: '',
      VITE_E: 'spaced'
    })
  })
})

describe('secretValues', () => {
  const long = 'abcdef0123456789'

  it('keeps variables whose name ends like a credential and whose value is long enough', () => {
    const found = secretValues({
      env: {
        VITE_LLM_OPENAI_API_KEY: long,
        VITE_TTS_API_KEY: long + 'x',
        GITHUB_TOKEN: long + 'y',
        STRIPE_WEBHOOK_SECRET: long + 'z',
        DB_PASSWORD: long + 'w',
        VITE_LLM_PROVIDER: 'proxy-for-everything',
        VITE_SENTRY_DSN: 'https://0123456789abcdef@o1.ingest.us.sentry.io/2',
        TOKEN_REQUEST_URL: 'https://token.example.net/request-a-token',
        API_KEY: 'short'
      }
    }).map((s) => s.name)
    expect(found.sort()).toEqual(['DB_PASSWORD', 'GITHUB_TOKEN', 'STRIPE_WEBHOOK_SECRET', 'VITE_LLM_OPENAI_API_KEY', 'VITE_TTS_API_KEY'])
  })

  it('reads .env files, and lists a name and value that is in both places once', () => {
    const dir = scratch()
    const file = put(dir, '.env.local', `VITE_LLM_OPENAI_API_KEY=${long}\nVITE_LLM_PROVIDER=openai\n`)
    const found = secretValues({ env: { VITE_LLM_OPENAI_API_KEY: long }, envFiles: [file] })
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('VITE_LLM_OPENAI_API_KEY')
  })
})

describe('envFilesIn', () => {
  it('takes .env files and skips the examples beside them', () => {
    const dir = scratch()
    for (const name of ['.env', '.env.local', '.env.production.local', '.env.example', '.env.local.default', '.envrc', 'env.txt']) put(dir, name, 'A=1\n')
    expect(envFilesIn([dir, join(dir, 'missing'), null]).map((p) => p.slice(dir.length + 1))).toEqual(['.env', '.env.local', '.env.production.local'])
  })
})

describe('valueForms', () => {
  it('adds the URL-encoded and the JSON-escaped spelling', () => {
    const forms = valueForms('p@ss word/with"quote-0123')
    expect(forms).toContain('p@ss word/with"quote-0123')
    expect(forms).toContain('p%40ss%20word%2Fwith%22quote-0123')
    expect(forms).toContain('p@ss word/with\\"quote-0123')
  })

  it('drops forms too short to search for', () => {
    expect(valueForms('short')).toEqual([])
  })
})

describe('scanDist and assertNoDistSecrets', () => {
  const KEY = 'live-openai-credential-0123456789'

  it('passes a clean build and counts only text files', () => {
    const dist = scratch()
    put(dist, 'index.html', '<!doctype html><title>Avatar</title>')
    put(dist, 'assets/index-abc.js', 'export default 1')
    put(dist, 'assets/avatar.vrm', 'binary')
    put(dist, 'assets/model.glb', 'binary')
    const result = assertNoDistSecrets({ dist, envDirs: [], env: { VITE_LLM_OPENAI_API_KEY: KEY } })
    expect(result.files).toBe(2)
  })

  it('fails when an environment credential was inlined, and names the variable, never the value', () => {
    const dist = scratch()
    put(dist, 'assets/index-abc.js', `const cfg={openai_api_key:"${KEY}"}`)
    let message = ''
    try {
      assertNoDistSecrets({ dist, envDirs: [], env: { VITE_LLM_OPENAI_API_KEY: KEY } })
    } catch (e) {
      message = e.message
    }
    expect(message).toMatch(/^Secret check failed \(scripts\/check-dist-secrets\.mjs\): 1 problem\(s\)/)
    expect(message).toContain('assets/index-abc.js: the value of VITE_LLM_OPENAI_API_KEY (from the build environment) is in the output')
    expect(message).not.toContain(KEY)
  })

  it('fails when a .env value was inlined, and says which file it came from', () => {
    const dist = scratch()
    const envDir = scratch()
    put(envDir, '.env.local', `VITE_TTS_API_KEY=${KEY}\n`)
    put(dist, 'assets/tts-abc.js', `apiKey:"${KEY}"`)
    expect(() => assertNoDistSecrets({ dist, envDirs: [envDir], env: {} })).toThrow(/the value of VITE_TTS_API_KEY \(from .*\.env\.local\) is in the output/)
    expect(() => assertNoDistSecrets({ dist, envDirs: [envDir], env: {} })).not.toThrow(new RegExp(KEY))
  })

  it('finds the value as Vite writes it into a JSON or URL string too', () => {
    const dist = scratch()
    const value = 'p@ss/"word"-0123456789'
    put(dist, 'config.json', JSON.stringify({ k: value }))
    put(dist, 'assets/u.js', `fetch("/x?k=${encodeURIComponent(value)}")`)
    const { problems } = scanDist({ dist, env: { SERVICE_PASSWORD: value } })
    expect(problems.sort()).toEqual([
      'assets/u.js: the value of SERVICE_PASSWORD (from the build environment) is in the output',
      'config.json: the value of SERVICE_PASSWORD (from the build environment) is in the output'
    ])
  })

  it('fails on a credential-shaped string even when no variable held it', () => {
    const dist = scratch()
    const token = fake.providerKey()
    put(dist, 'assets/index-abc.js', `const k="${token}"`)
    let message = ''
    try {
      assertNoDistSecrets({ dist, envDirs: [], env: {} })
    } catch (e) {
      message = e.message
    }
    expect(message).toContain('assets/index-abc.js: a string shaped like a credential (provider-key (sk-...))')
    expect(message).not.toContain(token)
  })

  it('does not read binary assets, source maps or node_modules', () => {
    const dist = scratch()
    put(dist, 'assets/avatar.vrm', KEY)
    put(dist, 'assets/index-abc.js.map', JSON.stringify({ sourcesContent: [`const k="${KEY}"`] }))
    put(dist, 'node_modules/x/index.js', `const k="${KEY}"`)
    expect(scanDist({ dist, env: { VITE_LLM_OPENAI_API_KEY: KEY } })).toEqual({ problems: [], files: 0, bytes: 0 })
  })

  it('lists every problem in a stable order, one per file and rule', () => {
    const dist = scratch()
    put(dist, 'b.js', `${fake.awsKeyId()} ${fake.githubToken()}`)
    put(dist, 'a.js', fake.slackToken())
    const { problems } = scanDist({ dist, env: {} })
    expect(problems).toEqual([
      'a.js: a string shaped like a credential (slack-token)',
      'b.js: a string shaped like a credential (aws-access-key-id)',
      'b.js: a string shaped like a credential (github-token)'
    ])
  })

  it('has nothing to check when there is no build output', () => {
    expect(assertNoDistSecrets({ dist: join(scratch(), 'missing'), envDirs: [], env: { A_TOKEN: KEY } })).toEqual({ files: 0, bytes: 0 })
    expect(assertNoDistSecrets({ dist: null })).toEqual({ files: 0, bytes: 0 })
  })

  it('ignores a variable that is blank, short or not named like a credential', () => {
    const dist = scratch()
    put(dist, 'index.js', 'proxy short-value apikeyvalue')
    expect(() =>
      assertNoDistSecrets({ dist, envDirs: [], env: { VITE_TTS_API_KEY: '', API_KEY: 'short', VITE_LLM_PROVIDER: 'proxy', NOTES: 'apikeyvalue-apikeyvalue' } })
    ).not.toThrow()
  })
})
