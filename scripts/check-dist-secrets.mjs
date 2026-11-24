/**
 * check-dist-secrets.mjs — nothing secret may be in the build output.
 *
 * The web app is static: whatever sits under dist/ is served to every visitor. Vite inlines every
 * VITE_* value into the JavaScript at build time, and packages/core reads two of them that are
 * credentials (VITE_LLM_OPENAI_API_KEY in llmConfig.ts, VITE_TTS_API_KEY in ttsConfig.ts), so a key
 * set in the build environment or in a .env file is published with the app. scripts/pages-config.mjs
 * already refuses secrets in dist/config.json ("API keys belong on the proxy"); this covers the
 * JavaScript, HTML, CSS and JSON the build emits.
 *
 * Two kinds of finding, both fatal:
 *
 *   - A value. The value of any variable whose NAME ends like a credential (API_KEY, TOKEN, SECRET,
 *     PASSWORD, ...) in the build environment or in a .env file next to the app is looked for in every
 *     text file of the output, as written, URL-encoded and JSON-escaped. Values shorter than 12
 *     characters are ignored: they are not secrets, and they would match ordinary text.
 *   - A shape. A string that looks like a credential whatever its name was: a provider key (sk-...),
 *     an AWS access key id, a GitHub or Slack token, a Tailscale key, a private key block, a literal
 *     `Bearer <token>` header, or a URL that carries a password.
 *
 * A finding names the file, the rule and, for a value, the VARIABLE. It never prints the matched text:
 * the log of a build that failed on a leaked key must not become a second place the key is written.
 *
 * Idea taken from Capri's `tools/checks` (a build check that fails when a value from .env appears in
 * dist/); no code was taken from it. See CI-Engineering resources/research/capri-spatial-companion-review-2026-11.md.
 *
 * `vite build` runs this (apps/web/vite.config.ts, on closeBundle), so it covers every way the web app
 * is built: the pnpm build, the Cloudflare Pages build and the container image's
 * `deno task --cwd apps/web build`, which does not run pnpm's pre/post build hooks. It is plain
 * JavaScript so that `vite build` and `node` can both run it.
 *
 * Source maps (.map) are not read: they hold the original source, where the variable is still named,
 * not its value, and the same value is in the .js file that a finding would already name.
 *
 * Usage: node scripts/check-dist-secrets.mjs [dist dir] [env dir ...]
 *        (defaults: apps/web/dist, then apps/web and the repository root for .env files)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Output files that can hold text a visitor reads. Binary assets (GLB, VRM, images, audio, fonts) are skipped. */
const TEXT_FILE = /\.(?:js|mjs|cjs|html?|css|json|webmanifest|txt|svg|xml)$/i
/** A text file larger than this is not a bundle; skipping it keeps a stray data dump from stalling the build. */
const MAX_FILE_BYTES = 20 * 1024 * 1024
/** Shorter values are not credentials, and searching for them would flag ordinary words. */
export const MIN_SECRET_LENGTH = 12

/** A variable whose name ends like a credential: OPENAI_API_KEY, VITE_TTS_API_KEY, GITHUB_TOKEN, STRIPE_WEBHOOK_SECRET... */
export const SECRET_NAME =
  /(?:^|[_-])(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|token|secret|password|passwd|passphrase|credentials?)$/i

/** .env files hold values; the examples beside them hold placeholders. */
const ENV_FILE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/
const PLACEHOLDER_ENV_FILE = /\.(?:example|default|sample|template|dist)$/i

/**
 * Strings that are credentials whatever the variable was called. Kept narrow on purpose: each one has a
 * fixed prefix or structure, so a bundle of minified third-party code does not trip them.
 */
export const SECRET_SHAPES = [
  { rule: 'provider-key (sk-...)', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { rule: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { rule: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { rule: 'tailscale-key', pattern: /\btskey-[A-Za-z0-9-]{10,}/ },
  { rule: 'private-key-block', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { rule: 'bearer-token-literal', pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{24,}=*/ },
  // user:password@host. A DSN (public key only, no colon before the @) and a bare user@host do not match.
  { rule: 'url-with-password', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`<>]{1,64}:[^\s@/'"`<>]{3,}@[^\s/'"`<>]+/i }
]

/** Which shapes appear in `text`. Names only, each once, in the order of SECRET_SHAPES. */
export function findSecretShapes(text) {
  return SECRET_SHAPES.filter(({ pattern }) => pattern.test(text)).map(({ rule }) => rule)
}

/** The forms a value can take in a bundle: as is, URL-encoded and JSON-escaped (Capri's redaction registry does the same). */
export function valueForms(value) {
  const forms = new Set([value, JSON.stringify(value).slice(1, -1)])
  try {
    forms.add(encodeURIComponent(value))
  } catch {
    // A lone surrogate cannot be URL-encoded, so that form cannot appear either.
  }
  return [...forms].filter((form) => form.length >= MIN_SECRET_LENGTH)
}

/** `NAME=value` lines of a .env file: comments and blanks skipped, `export ` and one pair of quotes dropped. */
export function parseEnvFile(text) {
  const out = new Map()
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1)
    out.set(match[1], value)
  }
  return out
}

/** The .env files (not their examples) directly inside each directory. */
export function envFilesIn(dirs) {
  const files = []
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue
    for (const name of readdirSync(dir).sort()) {
      if (ENV_FILE.test(name) && !PLACEHOLDER_ENV_FILE.test(name)) files.push(join(dir, name))
    }
  }
  return files
}

/**
 * The credentials a build could publish: [{ name, value, source }] for every variable whose name ends like a
 * credential and whose value is long enough, from the environment and from the .env files. The same name and
 * value is listed once.
 */
export function secretValues({ env = process.env, envFiles = [] } = {}) {
  const found = []
  const seen = new Set()
  const add = (name, value, source) => {
    if (!SECRET_NAME.test(name) || typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return
    const key = `${name}\0${value}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ name, value, source })
  }
  for (const [name, value] of Object.entries(env)) add(name, value, 'the build environment')
  for (const file of envFiles) {
    for (const [name, value] of parseEnvFile(readFileSync(file, 'utf8'))) add(name, value, file)
  }
  return found
}

/** Every text file under `dir` worth reading: [{ path, size }], in a stable order. */
export function textFilesIn(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path)
      } else if (TEXT_FILE.test(entry.name)) {
        const size = statSync(path).size
        if (size <= MAX_FILE_BYTES) out.push({ path, size })
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/**
 * Scan the build output. Returns `{ problems, files, bytes }`: one problem line per (file, rule) and per
 * (file, variable), none of them holding a credential.
 */
export function scanDist({ dist, env = process.env, envFiles = [] }) {
  const secrets = secretValues({ env, envFiles }).map((secret) => ({ ...secret, forms: valueForms(secret.value) }))
  const problems = []
  let bytes = 0
  const files = textFilesIn(dist)
  for (const { path, size } of files) {
    bytes += size
    const text = readFileSync(path, 'utf8')
    const where = relative(dist, path) || path
    for (const rule of findSecretShapes(text)) problems.push(`${where}: a string shaped like a credential (${rule})`)
    for (const secret of secrets) {
      if (secret.forms.some((form) => text.includes(form))) {
        problems.push(`${where}: the value of ${secret.name} (from ${secret.source}) is in the output`)
      }
    }
  }
  return { problems, files: files.length, bytes }
}

/** Throws one Error listing every problem. A `dist` that does not exist is not an error: there is nothing to publish. */
export function assertNoDistSecrets({ dist, envDirs = [], env = process.env }) {
  if (!dist || !existsSync(dist)) return { files: 0, bytes: 0 }
  const result = scanDist({ dist, env, envFiles: envFilesIn(envDirs) })
  if (result.problems.length) {
    throw new Error(
      `Secret check failed (scripts/check-dist-secrets.mjs): ${result.problems.length} problem(s) in ${dist}\n  - ${result.problems.join('\n  - ')}\n` +
        'The build output is public and still holds the finding above. Remove the value from the build (API keys belong on the proxy, see apps/proxy) and build again, which replaces the output, before deploying anything.'
    )
  }
  return { files: result.files, bytes: result.bytes }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const dist = resolve(process.argv[2] ?? join(root, 'apps/web/dist'))
  const envDirs = process.argv.length > 3 ? process.argv.slice(3).map((dir) => resolve(dir)) : [join(root, 'apps/web'), root]
  try {
    const { files, bytes } = assertNoDistSecrets({ dist, envDirs })
    console.log(
      existsSync(dist)
        ? `OK: no secret value and no credential-shaped string in ${files} text file(s), ${(bytes / 1048576).toFixed(1)} MiB, under ${dist}.`
        : `OK: nothing to check; there is no build output at ${dist}.`
    )
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
