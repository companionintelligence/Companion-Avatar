import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ASSET_DECISION, ASSET_GROUPS, catalogueFiles } from './third-party/assets.mjs'
import {
  LOCAL_PATH,
  MAVEN_GROUPS,
  checkAssetCatalogue,
  chooseLicense,
  collect,
  detectLicense,
  holderName,
  isAllowed,
  licenseBranches,
  linkedCrates,
  merge,
  normalizeRepository,
  npmClosure,
  parseGradleDependencies,
  parsePnpmLock,
  render,
  snapshotKey,
  splitKey
} from './third-party-notices.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const LOCK = `lockfileVersion: '9.0'

importers:

  apps/web:
    dependencies:
      '@ci-avatar/core':
        specifier: workspace:*
        version: link:../../packages/core
      react:
        specifier: ^19.1.0
        version: 19.2.4
    devDependencies:
      vitest:
        specifier: ^4.1.9
        version: 4.1.9

  packages/core:
    dependencies:
      '@hexafield/simple-store':
        specifier: ^1.0.1
        version: 1.0.1(react@19.2.4)
    optionalDependencies:
      fsevents:
        specifier: ^2.3.3
        version: 2.3.3

packages:

  react@19.2.4:
    resolution: {integrity: sha512-x}

snapshots:

  '@hexafield/simple-store@1.0.1(react@19.2.4)':
    dependencies:
      react: 19.2.4
      string-width-cjs: string-width@4.2.3

  fsevents@2.3.3:
    optional: true

  react@19.2.4: {}

  string-width@4.2.3: {}

  vitest@4.1.9:
    dependencies:
      tinyspy: 4.0.4

  tinyspy@4.0.4: {}
`

describe('reading pnpm-lock.yaml', () => {
  const lock = parsePnpmLock(LOCK)

  it('reads importers and snapshots, keyed as the lockfile keys them', () => {
    expect(lock.importers['apps/web'].dependencies.react).toBe('19.2.4')
    expect(lock.importers['packages/core'].dependencies['@hexafield/simple-store']).toBe('1.0.1(react@19.2.4)')
    expect(lock.snapshots['@hexafield/simple-store@1.0.1(react@19.2.4)'].dependencies.react).toBe('19.2.4')
    expect(lock.snapshots['react@19.2.4']).toEqual({})
  })

  it('tells a peer suffix from an npm alias', () => {
    expect(snapshotKey('@hexafield/simple-store', '1.0.1(react@19.2.4)')).toBe('@hexafield/simple-store@1.0.1(react@19.2.4)')
    expect(snapshotKey('string-width-cjs', 'string-width@4.2.3')).toBe('string-width@4.2.3')
    expect(splitKey('@hexafield/simple-store@1.0.1(react@19.2.4)')).toEqual({ name: '@hexafield/simple-store', version: '1.0.1' })
  })

  it('follows production dependencies through workspace links, never devDependencies', () => {
    const found = npmClosure(lock, ['apps/web'])
    expect([...found.keys()].sort()).toEqual(['@hexafield/simple-store@1.0.1', 'fsevents@2.3.3', 'react@19.2.4', 'string-width@4.2.3'])
    expect(found.get('fsevents@2.3.3').optional).toBe(true)
    expect(found.get('react@19.2.4').optional).toBe(false)
  })

  it('finds the real web app closure: the runtime libraries, no test or build tools', () => {
    const real = parsePnpmLock(readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'))
    const names = new Set([...npmClosure(real, ['apps/web']).values()].map((p) => p.name))
    for (const name of ['three', 'react', '@pmndrs/xr', '@react-three/xr', 'iwer', '@iwer/devui', '@iwer/sem', '@fontsource/manrope', '@pixiv/three-vrm']) {
      expect(names.has(name), name).toBe(true)
    }
    for (const name of ['vitest', 'vite', 'storybook', 'typescript', '@ci-avatar/core', '@ci-avatar/engine']) {
      expect(names.has(name), name).toBe(false)
    }
  })

  it('leaves the iOS runtime out of the Android app', () => {
    const real = parsePnpmLock(readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'))
    const names = new Set([...npmClosure(real, ['apps/mobile'], { exclude: ['@capacitor/ios'] }).values()].map((p) => p.name))
    expect(names.has('@capacitor/android')).toBe(true)
    expect(names.has('@capacitor/core')).toBe(true)
    expect(names.has('@capacitor/ios')).toBe(false)
    expect(names.has('@capacitor/cli')).toBe(false)
  })
})

describe('licences', () => {
  it('reads Cargo-style and SPDX expressions', () => {
    expect(licenseBranches('MIT/Apache-2.0')).toEqual([['MIT'], ['Apache-2.0']])
    expect(licenseBranches('(MIT OR Apache-2.0) AND Unicode-3.0')).toEqual([['MIT'], ['Apache-2.0', 'Unicode-3.0']])
    expect(isAllowed('MIT OR Apache-2.0')).toBe(true)
    expect(isAllowed('MPL-2.0')).toBe(true)
    expect(isAllowed('GPL-3.0-only')).toBe(false)
    expect(isAllowed('LGPL-2.1-or-later OR MIT')).toBe(true)
    expect(isAllowed('UNKNOWN')).toBe(false)
  })

  it('prefers the MIT text when a crate offers a choice', () => {
    expect(chooseLicense('Zlib OR Apache-2.0 OR MIT')).toEqual(['MIT'])
    expect(chooseLicense('Apache-2.0 AND BSD-3-Clause')).toEqual(['Apache-2.0', 'BSD-3-Clause'])
  })

  it('recognises a licence file when package.json only points at it', () => {
    expect(detectLicense('MIT License\n\nPermission is hereby granted, free of charge, to any person')).toBe('MIT')
    expect(detectLicense('SIL OPEN FONT LICENSE Version 1.1')).toBe('OFL-1.1')
    expect(detectLicense('Mozilla Public License Version 2.0')).toBe('MPL-2.0')
    expect(detectLicense('All rights reserved.')).toBe(null)
  })

  it('keeps e-mail addresses and URLs out of copyright holders', () => {
    expect(holderName('Ionic Team <hi@ionic.io> (https://ionic.io)')).toBe('Ionic Team')
    expect(holderName({ name: 'Jane Doe', email: 'jane@example.com' })).toBe('Jane Doe')
    expect(holderName(undefined)).toBe(null)
  })

  it('normalises repository fields to https URLs', () => {
    expect(normalizeRepository('git+https://github.com/pmndrs/xr.git')).toBe('https://github.com/pmndrs/xr')
    expect(normalizeRepository({ url: 'git://github.com/a/b.git' })).toBe('https://github.com/a/b')
    expect(normalizeRepository('github:stephenh/ts-proto')).toBe('https://github.com/stephenh/ts-proto')
    expect(normalizeRepository('mrdoob/three.js')).toBe('https://github.com/mrdoob/three.js')
  })
})

describe('Rust crates', () => {
  it('follows normal dependencies and skips build-only and proc-macro crates', () => {
    const pkg = (name, kind = 'lib') => ({ id: name, name, version: '1.0.0', targets: [{ kind: [kind] }] })
    const meta = {
      packages: [pkg('app', 'bin'), pkg('tauri'), pkg('serde_derive', 'proc-macro'), pkg('syn'), pkg('cc'), pkg('serde')],
      resolve: {
        root: 'app',
        nodes: [
          { id: 'app', deps: [{ pkg: 'tauri', dep_kinds: [{ kind: null }] }, { pkg: 'cc', dep_kinds: [{ kind: 'build' }] }] },
          { id: 'tauri', deps: [{ pkg: 'serde_derive', dep_kinds: [{ kind: null }] }, { pkg: 'serde', dep_kinds: [{ kind: null }] }] },
          { id: 'serde_derive', deps: [{ pkg: 'syn', dep_kinds: [{ kind: null }] }] },
          { id: 'syn', deps: [] },
          { id: 'cc', deps: [] },
          { id: 'serde', deps: [] }
        ]
      }
    }
    expect(linkedCrates(meta).map((p) => p.name).sort()).toEqual(['serde', 'tauri'])
  })
})

describe('Android libraries', () => {
  it('reads the resolved coordinates from a Gradle dependencies report', () => {
    const report = `releaseRuntimeClasspath - Runtime classpath of '/release'.
+--- androidx.appcompat:appcompat:1.7.1
|    +--- androidx.activity:activity:1.8.0 -> 1.11.0
|    \\--- androidx.annotation:annotation:1.3.0 -> 1.9.1 (*)
+--- project :capacitor-android
|    \\--- org.apache.cordova:framework:14.0.1
+--- org.jetbrains.kotlin:kotlin-bom:2.1.0 (c)
\\--- org.jetbrains.kotlin:kotlin-stdlib -> 2.1.0`
    expect(parseGradleDependencies(report).map((d) => `${d.group}:${d.artifact}:${d.version}`)).toEqual([
      'androidx.activity:activity:1.11.0',
      'androidx.annotation:annotation:1.9.1',
      'androidx.appcompat:appcompat:1.7.1',
      'org.apache.cordova:framework:14.0.1',
      'org.jetbrains.kotlin:kotlin-stdlib:2.1.0'
    ])
  })

  it('knows the licence of every Maven group it names, and Cordova keeps its NOTICE', () => {
    for (const group of MAVEN_GROUPS) expect(isAllowed(group.license)).toBe(true)
    expect(MAVEN_GROUPS.find((g) => g.match.test('org.apache.cordova')).notice).toContain('The Apache Software Foundation')
  })

  it('reports a Maven group it does not know instead of guessing its licence', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notices-test-'))
    try {
      const report = path.join(dir, 'deps.txt')
      writeFileSync(report, '+--- androidx.core:core:1.17.0\n\\--- com.example.unknown:lib:1.0.0\n')
      const result = collect(['android'], { gradleDeps: report })
      expect(result.problems).toEqual([
        'com.example.unknown:lib:1.0.0: Maven group not in MAVEN_GROUPS; add its licence',
        'com.example.unknown:lib@1.0.0: no licence in its metadata or licence file',
        'com.example.unknown:lib@1.0.0: no licence text found and no standard text for "UNKNOWN"'
      ])
      const core = result.components.find((c) => c.name === 'androidx.core:core')
      expect(core.license).toBe('Apache-2.0')
      expect(core.texts[0].text).toContain('Apache License')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('asks for the Gradle report rather than shipping Android notices without the Maven libraries', () => {
    expect(collect(['android'], {}).problems).toContain('android: pass --gradle <dir> or --gradle-deps <file> for the Maven libraries')
  })
})

describe('the asset catalogue', () => {
  it('lists every bundled file under assets/ exactly once, and nothing that is not there', () => {
    expect(checkAssetCatalogue()).toEqual({ missing: [], duplicated: [], absent: [] })
  })

  it('notices a file added to assets/ without a credit', () => {
    const result = checkAssetCatalogue([...catalogueFiles(), 'avatars/new.vrm'], catalogueFiles())
    expect(result.missing).toEqual(['avatars/new.vrm'])
  })

  it('gives every group an author or per-file authors, a source and a licence', () => {
    for (const group of ASSET_GROUPS) {
      expect(group.source, group.title).toBeTruthy()
      expect(group.license, group.title).toBeTruthy()
      if (group.files) expect(group.author, group.title).toBeTruthy()
      for (const item of group.items ?? []) {
        expect(item.author, item.file).toBeTruthy()
        expect(item.terms ?? item.license, item.file).toBeTruthy()
      }
    }
  })

  it('credits the Ready Player Me avatars under CC BY-NC 4.0 and ChatVRM\'s clip under MIT', () => {
    const rpm = ASSET_GROUPS.find((g) => g.title === 'Ready Player Me avatars')
    expect(rpm.license).toBe('CC BY-NC 4.0')
    expect(rpm.files).toContain('avatars/25-1-3_CI_model_male_Greg.glb')
    const chatvrm = ASSET_GROUPS.find((g) => g.files?.includes('animations/vrm/idle_loop.vrma'))
    expect(chatvrm.license).toBe('MIT')
    expect(chatvrm.holder).toBe('Copyright (c) 2023 pixiv Inc.')
  })

  it('records the owner\'s decision with its date', () => {
    expect(ASSET_DECISION).toContain('2026-11-14')
    expect(ASSET_DECISION).toContain('permission to redistribute')
  })

  it('credits the studio HDRI to Greg Zaal at Poly Haven under CC0', () => {
    const hdri = ASSET_GROUPS.find((g) => g.files?.includes('environments/studio_small_03_1k.hdr'))
    expect(hdri.author).toContain('Greg Zaal')
    expect(hdri.source).toContain('polyhaven.com/a/studio_small_03')
    expect(hdri.license).toContain('CC0')
    expect(hdri.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/')
  })
})

describe('the rendered notices', () => {
  // The real web closure and asset catalogue: needs `pnpm install`, as the notices do.
  const data = merge([collect(['web', 'assets'])])
  const text = render(data, { title: 'test', version: '0.0.0' })

  it('collects with no problems, so a strict release build passes', () => {
    expect(data.problems).toEqual([])
  })

  it('carries the owner decision, the asset credits and the packages the task names', () => {
    expect(text).toContain(ASSET_DECISION.slice(0, 60))
    expect(text).toContain('CC BY-NC 4.0')
    expect(text).toContain('assets/animations/vrm/idle_loop.vrma')
    expect(text).toContain('assets/environments/studio_small_03_1k.hdr')
    expect(text).toMatch(/Author: Greg Zaal \(Poly Haven\)[\s\S]{0,900}CC0 1\.0 Universal/)
    expect(text).toContain('museudocomputador')
    expect(text).toMatch(/^@pmndrs\/xr \d/m)
    expect(text).toMatch(/^iwer \d/m)
    expect(text).toMatch(/^@fontsource\/manrope \d[\s\S]{0,40}Licence: OFL-1\.1/m)
    expect(text).toContain('Required Notice: Copyright LifeScope INC')
  })

  it('names packages, never a path on the machine that built it', () => {
    const leaks = text.split('\n').filter((line) => LOCAL_PATH.test(line))
    expect(leaks).toEqual([])
  })

  it('prints a licence text that several packages share only once', () => {
    const ids = text.match(/^\[T\d+\] /gm) ?? []
    expect(ids.length).toBeGreaterThan(10)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
