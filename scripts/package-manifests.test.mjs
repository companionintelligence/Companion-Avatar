import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { assetNames, generate, parseSums, renderCask, versionOf } from './package-manifests.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')

// The digests of the real v0.2.0 files, as GitHub lists them.
const DMG = 'c876eca45253a9bebc7b9c6540265d8daa84e28bfe065756949ff0928c6995c0'
const EXE = '7689ceed5d6b81ed7a4ff2931e8f99ba0524915b98e3b21a01b012a559818c01'
const MSI = 'fe0daa5c407e610cdcff986898d01733f2ff69bc4d9cb1398a2eaa9180f9eeff'

const SUMS_TEXT = [
  `${MSI}  avatar-companion-v0.2.0-windows-x64.msi`,
  `${EXE}  avatar-companion-v0.2.0-windows-x64-setup.exe`,
  `${DMG}  avatar-companion-v0.2.0-macos-universal.dmg`,
  ''
].join('\n')

const sums = () => parseSums(SUMS_TEXT)
const tmp = []
const scratch = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'package-manifests-'))
  tmp.push(dir)
  return dir
}
afterAll(() => tmp.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('release file names', () => {
  it('are the names native-release.yml gives the installers', () => {
    const workflow = readFileSync(path.join(repoRoot, '.github/workflows/native-release.yml'), 'utf8')
    expect(workflow).toContain('base="avatar-companion-$TAG"')
    for (const name of Object.values(assetNames('v0.2.0'))) {
      const suffix = name.replace('avatar-companion-v0.2.0', '$base')
      expect(workflow, `${suffix} is not collected by native-release.yml`).toContain(`"${suffix}"`)
    }
  })
})

describe('versionOf', () => {
  it('drops the v, and keeps a pre-release suffix', () => {
    expect(versionOf('v0.2.0')).toBe('0.2.0')
    expect(versionOf('v1.10.3-rc.1')).toBe('1.10.3-rc.1')
  })

  it.each(['0.2.0', 'v1.2', 'latest', 'v1.2.3 ', ''])('rejects %j', (tag) => {
    expect(() => versionOf(tag)).toThrow(/must look like v0\.2\.0/)
  })
})

describe('parseSums', () => {
  it('reads sha256sum output, in text and binary mode, and lower-cases digests', () => {
    const upper = 'ABCDEF0123456789'.repeat(4)
    const parsed = parseSums(`${upper}  one.exe\n${'a'.repeat(64)} *two.dmg\n\r\n`)
    expect(parsed.get('one.exe')).toBe(upper.toLowerCase())
    expect(parsed.get('two.dmg')).toBe('a'.repeat(64))
    expect(parsed.size).toBe(2)
  })

  it('names the line it cannot read', () => {
    expect(() => parseSums(`${'a'.repeat(64)}  ok.exe\nnot a digest line\n`)).toThrow(/line 2/)
    expect(() => parseSums(`${'a'.repeat(63)}  short.exe`)).toThrow(/line 1/)
  })
})

describe('generate', () => {
  const files = generate({ tag: 'v0.2.0', sums: sums(), released: '2026-11-15' })

  it('writes the cask, the Scoop manifest and the three winget files', () => {
    expect(Object.keys(files).sort()).toEqual([
      'homebrew/Casks/avatar-companion.rb',
      'scoop/avatar-companion.json',
      'winget/CompanionIntelligence.AvatarCompanion.installer.yaml',
      'winget/CompanionIntelligence.AvatarCompanion.locale.en-US.yaml',
      'winget/CompanionIntelligence.AvatarCompanion.yaml'
    ])
  })

  it('points the cask at the universal dmg and pins its digest', () => {
    const cask = files['homebrew/Casks/avatar-companion.rb']
    expect(cask).toContain('cask "avatar-companion" do')
    expect(cask).toContain('version "0.2.0"')
    expect(cask).toContain(`sha256 "${DMG}"`)
    expect(cask).toContain(
      'url "https://github.com/companionintelligence/Companion-Avatar/releases/download/v#{version}/avatar-companion-v#{version}-macos-universal.dmg"'
    )
    expect(cask).toContain('depends_on macos: :monterey')
    expect(cask).toContain('app "Avatar Companion.app"')
    expect(cask).toContain('"~/Library/Application Support/computer.ci.avatar"')
  })

  it('keeps the cask balanced Ruby: every do block has an end', () => {
    const cask = files['homebrew/Casks/avatar-companion.rb']
    const opens = (cask.match(/\bdo\b(?: \|[^|]*\|)?$/gm) ?? []).length
    const ends = (cask.match(/^\s*end$/gm) ?? []).length
    expect(opens).toBeGreaterThan(0)
    expect(ends).toBe(opens)
    expect(cask).not.toContain('\t')
  })

  it('marks the cask unpublishable until the macOS app is notarized', () => {
    expect(files['homebrew/Casks/avatar-companion.rb']).toMatch(/^# NOT PUBLISHABLE YET\./)
    const notarized = renderCask({ tag: 'v0.2.0', sums: sums(), notarized: true })
    expect(notarized).not.toContain('NOT PUBLISHABLE')
    expect(notarized.startsWith('# Homebrew Cask')).toBe(true)
  })

  it('gives Scoop the setup program, its digest, a silent switch and an autoupdate template', () => {
    const scoop = JSON.parse(files['scoop/avatar-companion.json'])
    expect(scoop.version).toBe('0.2.0')
    expect(scoop.architecture['64bit'].url).toBe(
      'https://github.com/companionintelligence/Companion-Avatar/releases/download/v0.2.0/avatar-companion-v0.2.0-windows-x64-setup.exe#/dl.exe'
    )
    expect(scoop.architecture['64bit'].hash).toBe(EXE)
    expect(scoop.installer).toEqual({ file: 'dl.exe', args: ['/S'] })
    expect(scoop.license.identifier).toBe('PolyForm-Noncommercial-1.0.0')
    expect(scoop.autoupdate.architecture['64bit'].url).toContain('v$version/avatar-companion-v$version-windows-x64-setup.exe')
    expect(new RegExp(scoop.checkver.regex).exec('releases/tag/v0.3.1"')?.[1]).toBe('0.3.1')
  })

  it('gives winget an upper-case digest, a per-user NSIS installer and one schema version throughout', () => {
    const installer = files['winget/CompanionIntelligence.AvatarCompanion.installer.yaml']
    expect(installer).toContain(`InstallerSha256: ${EXE.toUpperCase()}`)
    expect(installer).toContain('InstallerType: nullsoft')
    expect(installer).toContain('Scope: user')
    expect(installer).toContain('ReleaseDate: 2026-11-15')
    expect(installer).toContain('InstallerUrl: https://github.com/companionintelligence/Companion-Avatar/releases/download/v0.2.0/avatar-companion-v0.2.0-windows-x64-setup.exe')
    for (const [name, text] of Object.entries(files).filter(([n]) => n.startsWith('winget/'))) {
      expect(text, name).toContain('PackageIdentifier: CompanionIntelligence.AvatarCompanion')
      expect(text, name).toContain('PackageVersion: 0.2.0')
      expect(text, name).toContain('ManifestVersion: 1.10.0')
      expect(text.endsWith('\n'), name).toBe(true)
    }
    expect(files['winget/CompanionIntelligence.AvatarCompanion.yaml']).toContain('ManifestType: version')
    expect(files['winget/CompanionIntelligence.AvatarCompanion.locale.en-US.yaml']).toContain('ManifestType: defaultLocale')
  })

  it('leaves ReleaseDate out unless it is given, and rejects a malformed one', () => {
    const without = generate({ tag: 'v0.2.0', sums: sums() })
    expect(without['winget/CompanionIntelligence.AvatarCompanion.installer.yaml']).not.toContain('ReleaseDate')
    expect(() => generate({ tag: 'v0.2.0', sums: sums(), released: '15/11/2026' })).toThrow(/YYYY-MM-DD/)
  })

  it('names the file whose digest is missing', () => {
    const noExe = parseSums(`${DMG}  avatar-companion-v0.2.0-macos-universal.dmg\n`)
    expect(() => generate({ tag: 'v0.2.0', sums: noExe })).toThrow('avatar-companion-v0.2.0-windows-x64-setup.exe')
    const noDmg = parseSums(`${EXE}  avatar-companion-v0.2.0-windows-x64-setup.exe\n`)
    expect(() => generate({ tag: 'v0.2.0', sums: noDmg })).toThrow('avatar-companion-v0.2.0-macos-universal.dmg')
  })

  it('refuses a digest list from another release', () => {
    expect(() => generate({ tag: 'v0.3.0', sums: sums() })).toThrow('avatar-companion-v0.3.0-macos-universal.dmg')
  })
})

describe('the command line', () => {
  const script = path.join(here, 'package-manifests.mjs')
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

  it('writes the files and warns that the cask must wait for notarization', () => {
    const dir = scratch()
    const sumsFile = path.join(dir, 'SHA256SUMS.txt')
    writeFileSync(sumsFile, SUMS_TEXT)
    const out = path.join(dir, 'out')

    const result = run('--tag', 'v0.2.0', '--sums', sumsFile, '--out', out, '--released', '2026-11-15')

    expect(result.status).toBe(0)
    expect(existsSync(path.join(out, 'homebrew/Casks/avatar-companion.rb'))).toBe(true)
    expect(existsSync(path.join(out, 'scoop/avatar-companion.json'))).toBe(true)
    expect(existsSync(path.join(out, 'winget/CompanionIntelligence.AvatarCompanion.installer.yaml'))).toBe(true)
    expect(result.stderr).toContain('NOT PUBLISHABLE')
    expect(run('--tag', 'v0.2.0', '--sums', sumsFile, '--out', out, '--macos-notarized').stderr).toBe('')
  })

  it('exits 2 without its arguments and 1 on bad input', () => {
    expect(run('--tag', 'v0.2.0').status).toBe(2)
    expect(run('--bogus').status).toBe(1)
    const dir = scratch()
    const sumsFile = path.join(dir, 'SHA256SUMS.txt')
    writeFileSync(sumsFile, 'nonsense\n')
    const bad = run('--tag', 'v0.2.0', '--sums', sumsFile, '--out', path.join(dir, 'out'))
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('line 1')
  })
})
