#!/usr/bin/env node
/**
 * third-party-notices.mjs: THIRD-PARTY-NOTICES.txt for the desktop and Android apps.
 *
 * What each app carries is read from the lockfiles, not listed by hand:
 *
 *   web      npm packages in the web app every native app bundles: the production dependencies
 *            of @ci-avatar/web and of the workspace packages it links (@ci-avatar/core,
 *            @ci-avatar/engine), as pnpm-lock.yaml resolves them. Vite tree-shakes some of
 *            them out of the bundle; listing one too many is the safe side.
 *   assets   every file under assets/avatars, assets/animations and assets/props, from the
 *            catalogue in scripts/third-party/assets.mjs (author, source, licence).
 *   desktop  Rust crates linked into the Tauri app: `cargo metadata --locked` on
 *            apps/desktop/src-tauri (so Cargo.lock), for every desktop release target, following
 *            normal dependencies. Build scripts and proc macros run only at compile time and are
 *            left out. MPL-2.0 crates get a pointer to their exact source. Microsoft's WebView2
 *            loader, which webview2-com-sys links into the Windows app, gets its own licence.
 *   android  Capacitor's npm packages (apps/mobile in pnpm-lock.yaml) and the Maven libraries
 *            Gradle resolves for the release APK (gradlew :app:dependencies; Gradle keeps no
 *            lockfile here). Each Maven group's licence comes from MAVEN_GROUPS below.
 *
 * Usage:
 *   node scripts/third-party-notices.mjs --parts web,assets,desktop --out <dir> [--json <file>]
 *   node scripts/third-party-notices.mjs --parts android --gradle apps/mobile/android --json <file>
 *   node scripts/third-party-notices.mjs --from a.json --from b.json --out <dir> [--title "all apps"]
 *
 *   --parts <list>        Parts to collect (web, assets, desktop, android).
 *   --from <file>         Data written by an earlier --json; repeatable, merged with --parts.
 *   --out <dir>           Write THIRD-PARTY-NOTICES.txt and LICENSE.txt (the repository licence).
 *   --json <file>         Write the collected data, for a later --from.
 *   --gradle <dir>        Run Gradle in that Android project to list the APK's Maven libraries.
 *   --gradle-deps <file>  Read that list from a saved `gradlew :app:dependencies` report instead.
 *   --title <text>        What the file covers, in its heading. By default it follows the parts:
 *                         "desktop app", "Android app", or "desktop and Android apps".
 *   --strict              Fail on a component with no licence, a licence outside ALLOWED, or no
 *                         licence text. Without it these are warnings. Release builds use it.
 *
 * Licence texts come from the installed packages (node_modules, the Cargo registry), so install
 * first. The output names packages by name, version and repository, never by a local path.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ASSET_DECISION, ASSET_FOLDERS, ASSET_GROUPS, catalogueFiles } from './third-party/assets.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LICENSE_DIR = path.join(ROOT, 'scripts', 'third-party', 'licenses')
const TAURI_DIR = path.join(ROOT, 'apps', 'desktop', 'src-tauri')

/** The targets the release workflow builds the desktop app for. */
export const DESKTOP_TARGETS = [
  ['x86_64-pc-windows-msvc', 'windows'],
  ['aarch64-apple-darwin', 'macos'],
  ['x86_64-apple-darwin', 'macos'],
  ['x86_64-unknown-linux-gnu', 'linux']
]

/** Workspace packages whose production dependencies each part bundles. */
const NPM_ROOTS = {
  web: { importers: ['apps/web'], exclude: [] },
  // @capacitor/ios is the iOS runtime; the Android app does not contain it.
  android: { importers: ['apps/mobile'], exclude: ['@capacitor/ios'] }
}

/** Our own workspace packages: under the repository licence, not third-party. */
const FIRST_PARTY = /^@ci-avatar\//

/**
 * Licences the apps may carry. An OR expression needs one branch whose licences are all here.
 * Anything else (GPL, LGPL, AGPL, an unknown string) fails a strict run, so a dependency under
 * such a licence becomes a decision rather than an accident.
 */
export const ALLOWED = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSL-1.0', 'CC-BY-4.0',
  'CC0-1.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'OFL-1.1', 'Python-2.0', 'Unicode-3.0',
  'Unicode-DFS-2016', 'Unlicense', 'Zlib', 'LicenseRef-Microsoft-WebView2'
])

/** When an expression offers a choice, the licence whose text is preferred. */
const PREFERENCE = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Zlib', '0BSD', 'MIT-0', 'Unlicense', 'CC0-1.0', 'BSL-1.0', 'Unicode-3.0', 'MPL-2.0']

/** Licences whose terms ask for the source of the component to be available. */
const RECIPROCAL = new Set(['MPL-2.0'])

/**
 * Code a crate links into the executable that is not the crate's own. webview2-com-sys (MIT)
 * links Microsoft's static WebView2 loader, WebView2LoaderStatic.lib, into the Windows app. Its
 * licence (the Microsoft.Web.WebView2 package's LICENSE.txt) asks binary redistributions to
 * reproduce Microsoft's notice, conditions and disclaimer.
 */
const LINKED_CODE = {
  'webview2-com-sys': {
    platforms: ['windows'],
    name: 'Microsoft WebView2 loader (WebView2LoaderStatic.lib)',
    url: 'https://www.nuget.org/packages/Microsoft.Web.WebView2',
    license: 'LicenseRef-Microsoft-WebView2',
    file: 'Microsoft.Web.WebView2.txt'
  }
}

/**
 * Maven groups the Android app may contain, with each group's licence. Gradle keeps no lockfile
 * for this project, so the release build's resolved classpath is read and every group must be
 * listed here; an unknown group fails a strict run.
 */
export const MAVEN_GROUPS = [
  { match: /^androidx\./, license: 'Apache-2.0', url: 'https://developer.android.com/jetpack/androidx', holder: 'Copyright The Android Open Source Project' },
  { match: /^org\.apache\.cordova$/, license: 'Apache-2.0', url: 'https://cordova.apache.org', holder: 'Copyright 2015-2020 The Apache Software Foundation', notice: 'Apache Cordova\nCopyright 2015-2020 The Apache Software Foundation\n\nThis product includes software developed at\nThe Apache Software Foundation (http://www.apache.org/).' },
  { match: /^org\.jetbrains\.kotlin$/, license: 'Apache-2.0', url: 'https://kotlinlang.org', holder: 'Copyright JetBrains s.r.o. and Kotlin Programming Language contributors' },
  { match: /^org\.jetbrains\.kotlinx$/, license: 'Apache-2.0', url: 'https://github.com/Kotlin', holder: 'Copyright JetBrains s.r.o. and contributors' },
  { match: /^org\.jetbrains$/, license: 'Apache-2.0', url: 'https://github.com/JetBrains/java-annotations', holder: 'Copyright JetBrains s.r.o.' },
  { match: /^com\.google\.guava$/, license: 'Apache-2.0', url: 'https://github.com/google/guava', holder: 'Copyright The Guava Authors' },
  { match: /^com\.google\.errorprone$/, license: 'Apache-2.0', url: 'https://github.com/google/error-prone', holder: 'Copyright The Error Prone Authors' },
  { match: /^org\.jspecify$/, license: 'Apache-2.0', url: 'https://jspecify.dev', holder: 'Copyright The JSpecify Authors' }
]

/**
 * Copyright holders for components that ship no licence file of their own, read from the
 * upstream repository's licence file on 2026-11-14. Without an entry the holder comes from the
 * package's author metadata. Used only for the standard text such a component gets.
 */
const HOLDERS = [
  [/^(iwer|@iwer\/.+)$/, 'Copyright (c) Meta Platforms, Inc. and affiliates.'],
  [/^@react-three\/fiber$/, 'Copyright (c) 2019-2025 Poimandres'],
  [/^@ricky0123\/vad-web$/, 'Copyright (c) 2022-present ricky0123'],
  [/^maath$/, 'Copyright (c) Isaac Mason'],
  [/^onnxruntime-(web|common)$/, 'Copyright (c) Microsoft Corporation'],
  [/^webview2-com(-sys)?$/, 'Copyright (c) 2021 Bill Avery'],
  [/^dlopen2$/, 'Copyright (c) 2017 Szymon Wieloch\nCopyright (C) 2019 Ahmed Masud'],
  [/^libappindicator-sys$/, 'Copyright (c) 2017-2021 qDot\nCopyright (c) 2021 Tauri Apps Contributors'],
  [/^alloc-stdlib$/, 'Copyright (c) 2016 Dropbox, Inc.'],
  [/^(objc2(-.+)?|block2|dispatch2)$/, 'Copyright (c) Mads Marquart']
]

function holderFor(name, fallback) {
  return HOLDERS.find(([match]) => match.test(name))?.[1] ?? fallback
}

const PLATFORM_NAMES = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }

/** How a licence id reads in the notices, where the id alone would say little. */
const LICENSE_LABELS = { 'LicenseRef-Microsoft-WebView2': 'Microsoft WebView2 SDK licence (BSD-3-Clause style)' }

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const BSD_CONDITIONS = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.`

const BSD_DISCLAIMER = `THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

/** Standard texts, for a component that names its licence but ships no licence file. */
const TEMPLATES = {
  MIT: (holder) => `MIT License\n\n${holder}\n\n${MIT_BODY}`,
  ISC: (holder) =>
    `ISC License\n\n${holder}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'BSD-2-Clause': (holder) => `BSD 2-Clause License\n\n${holder}\n\n${BSD_CONDITIONS}\n\n${BSD_DISCLAIMER}`,
  'BSD-3-Clause': (holder) =>
    `BSD 3-Clause License\n\n${holder}\n\n${BSD_CONDITIONS}\n\n3. Neither the name of the copyright holder nor the names of its\n   contributors may be used to endorse or promote products derived from\n   this software without specific prior written permission.\n\n${BSD_DISCLAIMER}`,
  Zlib: (holder) =>
    `zlib License\n\n${holder}\n\nThis software is provided 'as-is', without any express or implied\nwarranty. In no event will the authors be held liable for any damages\narising from the use of this software.\n\nPermission is granted to anyone to use this software for any purpose,\nincluding commercial applications, and to alter it and redistribute it\nfreely, subject to the following restrictions:\n\n1. The origin of this software must not be misrepresented; you must not\n   claim that you wrote the original software. If you use this software\n   in a product, an acknowledgment in the product documentation would be\n   appreciated but is not required.\n2. Altered source versions must be plainly marked as such, and must not be\n   misrepresented as being the original software.\n3. This notice may not be removed or altered from any source distribution.`,
  'Apache-2.0': () => readFileSync(path.join(LICENSE_DIR, 'Apache-2.0.txt'), 'utf8'),
  'MPL-2.0': () => readFileSync(path.join(LICENSE_DIR, 'MPL-2.0.txt'), 'utf8'),
  'LicenseRef-Microsoft-WebView2': () => readFileSync(path.join(LICENSE_DIR, 'Microsoft.Web.WebView2.txt'), 'utf8')
}

// ---- small pure helpers (scripts/third-party-notices.test.mjs) ------------------------------

const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-_.][\w.-]*)?$/i

function unquote(value) {
  const v = value.trim()
  return (v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')) ? v.slice(1, -1) : v
}

/**
 * The parts of a pnpm v9 lockfile this script needs: each importer's dependencies and each
 * snapshot's dependencies, keyed as the lockfile keys them. A line-based reader for the format
 * pnpm writes, not a general YAML parser.
 */
export function parsePnpmLock(text) {
  const importers = {}
  const snapshots = {}
  let section = null
  let entry = null
  let group = null
  let dep = null
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (indent === 0) {
      section = line.replace(/:.*$/, '')
      entry = null
      continue
    }
    if (section === 'importers') {
      if (indent === 2) {
        entry = unquote(line.replace(/:$/, ''))
        importers[entry] = {}
      } else if (indent === 4) {
        group = line.replace(/:$/, '')
        importers[entry][group] = {}
      } else if (indent === 6) {
        dep = unquote(line.replace(/:$/, ''))
      } else if (indent === 8 && line.startsWith('version:')) {
        importers[entry][group][dep] = unquote(line.slice('version:'.length))
      }
    } else if (section === 'snapshots') {
      if (indent === 2) {
        entry = unquote(line.replace(/:(\s*\{\})?$/, ''))
        snapshots[entry] = {}
        group = null
      } else if (indent === 4) {
        group = line.endsWith(':') ? line.slice(0, -1) : null
        if (group === 'dependencies' || group === 'optionalDependencies') snapshots[entry][group] = {}
      } else if (indent === 6 && (group === 'dependencies' || group === 'optionalDependencies')) {
        const m = line.match(/^('[^']*'|"[^"]*"|[^:\s]+):\s+(.+)$/)
        if (m) snapshots[entry][group][unquote(m[1])] = unquote(m[2])
      }
    }
  }
  return { importers, snapshots }
}

/** The snapshot key a dependency entry points at: `name@version(peers)`, or an alias's target. */
export function snapshotKey(name, version) {
  // An npm alias (`alias: real@1.2.3`) points at another package's snapshot. A plain version
  // starts with a digit, even when a peer suffix (`1.0.1(react@19.2.4)`) holds an "@".
  if (!/^\d/.test(version) && /^(@[^@/()]+\/[^@()]+|[^@/()]+)@\d/.test(version)) return version
  return `${name}@${version}`
}

/** `name` and plain `version` from a snapshot key, without the peer suffix. */
export function splitKey(key) {
  const at = key.indexOf('@', 1)
  const version = key.slice(at + 1)
  return { name: key.slice(0, at), version: version.split('(')[0] }
}

/**
 * The npm packages reachable from the production dependencies (dependencies and
 * optionalDependencies, never devDependencies) of the given importers, following workspace
 * links into other importers. Returns `name@version` → { name, version, optional }, where
 * optional means every path to the package went through an optionalDependencies entry.
 */
export function npmClosure(lock, importerPaths, { exclude = [] } = {}) {
  const found = new Map()
  const seenImporters = new Set()
  const queue = []
  const visitImporter = (importerPath) => {
    if (seenImporters.has(importerPath)) return
    seenImporters.add(importerPath)
    const importer = lock.importers[importerPath]
    if (!importer) throw new Error(`pnpm-lock.yaml has no importer "${importerPath}"`)
    for (const [group, optional] of [['dependencies', false], ['optionalDependencies', true]]) {
      for (const [name, version] of Object.entries(importer[group] ?? {})) {
        if (exclude.includes(name)) continue
        if (version.startsWith('link:')) {
          visitImporter(path.posix.normalize(path.posix.join(importerPath, version.slice('link:'.length))))
        } else {
          queue.push([snapshotKey(name, version), optional])
        }
      }
    }
  }
  importerPaths.forEach(visitImporter)
  const seenKeys = new Map()
  while (queue.length) {
    const [key, optional] = queue.shift()
    const before = seenKeys.get(key)
    if (before === false || before === optional) continue
    seenKeys.set(key, optional)
    const { name, version } = splitKey(key)
    const id = `${name}@${version}`
    const prev = found.get(id)
    found.set(id, { name, version, optional: prev ? prev.optional && optional : optional })
    const snapshot = lock.snapshots[key]
    if (!snapshot) throw new Error(`pnpm-lock.yaml has no snapshot "${key}"`)
    for (const [group, groupOptional] of [['dependencies', false], ['optionalDependencies', true]]) {
      for (const [depName, depVersion] of Object.entries(snapshot[group] ?? {})) {
        if (depVersion.startsWith('link:')) continue
        queue.push([snapshotKey(depName, depVersion), optional || groupOptional])
      }
    }
  }
  for (const id of [...found.keys()]) if (FIRST_PARTY.test(found.get(id).name)) found.delete(id)
  return found
}

/** Split an SPDX-like expression into OR branches of AND-ed licence ids. */
export function licenseBranches(expression) {
  const cleaned = String(expression ?? '')
    .replace(/\s*\/\s*/g, ' OR ') // Cargo's old "MIT/Apache-2.0"
    .replace(/[()]/g, ' ')
    .trim()
  if (!cleaned) return []
  return cleaned.split(/\s+OR\s+/i).map((branch) => branch.split(/\s+AND\s+/i).map((id) => id.trim()).filter(Boolean))
}

/** True when some OR branch of the expression has only allowed licences. */
export function isAllowed(expression) {
  return licenseBranches(expression).some((branch) => branch.length > 0 && branch.every((id) => ALLOWED.has(id)))
}

/** The licence to quote for an expression: the preferred id of the best allowed branch. */
export function chooseLicense(expression) {
  const branches = licenseBranches(expression).filter((b) => b.every((id) => ALLOWED.has(id)))
  for (const preferred of PREFERENCE) {
    const branch = branches.find((b) => b.includes(preferred))
    if (branch) return branch
  }
  return branches[0] ?? []
}

/** The licence a licence file's text is, for packages whose metadata only points at the file. */
export function detectLicense(text) {
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/Apache License[\s\S]{0,120}Version 2\.0/i.test(text)) return 'Apache-2.0'
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(text)) return 'ISC'
  if (/SIL OPEN FONT LICENSE/i.test(text)) return 'OFL-1.1'
  if (/Mozilla Public License,? (Version |v\.?\s?)2\.0/i.test(text)) return 'MPL-2.0'
  if (/This is free and unencumbered software released into the public domain/i.test(text)) return 'Unlicense'
  if (/Redistribution and use in source and binary forms/i.test(text)) return /Neither the name/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause'
  return null
}

/** A person or organisation from package metadata, without e-mail addresses or URLs. */
export function holderName(author) {
  const raw = typeof author === 'string' ? author : author?.name
  if (!raw) return null
  const name = raw.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return name || null
}

/** A repository field as a plain https URL, or null. */
export function normalizeRepository(repo) {
  const raw = typeof repo === 'string' ? repo : repo?.url
  if (!raw) return null
  let url = raw.trim().replace(/^git\+/, '').replace(/\.git$/, '')
  if (url.startsWith('git://')) url = `https://${url.slice(6)}`
  if (url.startsWith('git@github.com:')) url = `https://github.com/${url.slice('git@github.com:'.length)}`
  if (url.startsWith('github:')) url = `https://github.com/${url.slice(7)}`
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  if (url.startsWith('http://github.com/')) url = `https://${url.slice(7)}`
  return /^https?:\/\//.test(url) ? url : null
}

/** Resolved `group:artifact:version` coordinates from `gradlew :app:dependencies` output. */
export function parseGradleDependencies(text) {
  const found = new Map()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^[\s|+\\-]*[+\\]--- (.+)$/)
    if (!m) continue
    let entry = m[1].trim()
    if (entry.startsWith('project ')) continue
    if (/\((c|n)\)\s*$/.test(entry)) continue // constraints and unresolved entries
    entry = entry.replace(/\s*\(\*\)\s*$/, '')
    let coord = entry.match(/^([^:\s]+):([^:\s]+):(\S+?)(?:\s*->\s*(\S+))?(?:\s.*)?$/)
    let group, artifact, version
    if (coord) {
      ;[, group, artifact, version] = coord
      if (coord[4]) version = coord[4]
    } else {
      coord = entry.match(/^([^:\s]+):([^:\s]+)\s*->\s*(\S+)/) // `group:artifact -> version` (a BOM)
      if (!coord) continue
      ;[, group, artifact, version] = coord
    }
    found.set(`${group}:${artifact}`, { group, artifact, version })
  }
  return [...found.values()].sort((a, b) => `${a.group}:${a.artifact}`.localeCompare(`${b.group}:${b.artifact}`))
}

/** Text with Windows line ends and trailing space removed, for comparing and printing. */
function cleanText(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

/** Lines that look like a path on the machine that built the file. Tests keep them out. */
export const LOCAL_PATH = /(?:[A-Za-z]:\\|\\\\|\/Users\/|\/home\/|node_modules[\\/]\.pnpm|\.cargo[\\/]registry)/

// ---- collectors ------------------------------------------------------------------------------

function licenseFilesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && statSync(path.join(dir, f)).isFile())
    .sort()
    .map((file) => ({ file, text: cleanText(readFileSync(path.join(dir, file), 'utf8')) }))
    .filter((entry) => entry.text)
}

/** The licence texts for a component: its own files, else the standard text of its licence. */
function textsFor(dir, license, holder) {
  const texts = licenseFilesIn(dir)
  if (texts.length) return { texts, templated: false }
  const choice = chooseLicense(license)
  const out = []
  for (const id of choice) {
    const template = TEMPLATES[id]
    if (template) out.push({ file: `${id} (standard text)`, text: cleanText(template(holder ?? 'Copyright (c) the authors')) })
  }
  return { texts: out, templated: true }
}

let storeIndex = null

/**
 * name@version -> installed directory, for every package in pnpm's virtual store. The store's
 * directory names cannot be rebuilt from a name and version: long ones are cut short and hashed
 * (on Windows from about 60 characters). Each store directory holds its package as a real
 * directory and its dependencies as links, so the real directories are the packages.
 */
function pnpmStoreIndex() {
  if (storeIndex) return storeIndex
  storeIndex = new Map()
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return storeIndex
  for (const dir of readdirSync(store)) {
    const modules = path.join(store, dir, 'node_modules')
    if (!existsSync(modules)) continue
    for (const entry of readdirSync(modules)) {
      const candidates = entry.startsWith('@')
        ? readdirSync(path.join(modules, entry)).map((child) => path.join(modules, entry, child))
        : [path.join(modules, entry)]
      for (const candidate of candidates) {
        if (lstatSync(candidate).isSymbolicLink()) continue
        const manifest = path.join(candidate, 'package.json')
        if (!existsSync(manifest)) continue
        try {
          const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'))
          if (name && version && !storeIndex.has(`${name}@${version}`)) storeIndex.set(`${name}@${version}`, candidate)
        } catch {
          // Not a package manifest we can read; nothing to index.
        }
      }
    }
  }
  return storeIndex
}

function pnpmStoreDir(name, version) {
  return pnpmStoreIndex().get(`${name}@${version}`) ?? null
}

function readLock() {
  return parsePnpmLock(readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'))
}

function collectNpm(part, problems) {
  const { importers, exclude } = NPM_ROOTS[part]
  const closure = npmClosure(readLock(), importers, { exclude })
  const components = []
  for (const { name, version, optional } of [...closure.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
    const dir = pnpmStoreDir(name, version)
    if (!dir) {
      if (optional) continue // a platform package (an esbuild binary, say) not installed on this machine
      problems.push(`${name}@${version}: not installed; run pnpm install first`)
      continue
    }
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    let license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type
    if (!license && Array.isArray(pkg.licenses)) license = pkg.licenses.map((l) => l.type ?? l).join(' OR ')
    const files = licenseFilesIn(dir)
    let licenseNote = null
    if (!license || /^SEE LICEN[CS]E IN /i.test(license) || license === 'UNLICENSED') {
      const detected = files.map((f) => detectLicense(f.text)).find(Boolean)
      if (detected) {
        licenseNote = `package.json says "${license ?? 'nothing'}"; its licence file is the ${detected} licence`
        license = detected
      }
    }
    const holder = holderFor(name, holderName(pkg.author) ? `Copyright (c) ${holderName(pkg.author)}` : `Copyright (c) the ${name} authors`)
    const { texts, templated } = files.length ? { texts: files, templated: false } : textsFor(dir, license, holder)
    components.push({
      part,
      kind: 'npm',
      name,
      version,
      license: license ?? 'UNKNOWN',
      licenseNote,
      url: normalizeRepository(pkg.repository) ?? pkg.homepage ?? `https://www.npmjs.com/package/${name}`,
      templated,
      texts
    })
  }
  return components
}

function cargoMetadata(target) {
  const result = spawnSync(
    'cargo',
    ['metadata', '--locked', '--format-version', '1', '--manifest-path', path.join(TAURI_DIR, 'Cargo.toml'), '--filter-platform', target],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  )
  if (result.status !== 0) throw new Error(`cargo metadata --filter-platform ${target} failed:\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

/** The crates linked into the app for one target: normal dependencies, not through proc macros. */
export function linkedCrates(meta) {
  const packages = new Map(meta.packages.map((p) => [p.id, p]))
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
  const isProcMacro = (p) => p.targets.some((t) => t.kind.includes('proc-macro'))
  const root = meta.resolve.root
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    if (id !== root && isProcMacro(packages.get(id))) continue
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg)
    }
  }
  return [...seen].filter((id) => id !== root).map((id) => packages.get(id)).filter((p) => !isProcMacro(p))
}

function collectDesktop(problems) {
  const crates = new Map()
  for (const [target, platform] of DESKTOP_TARGETS) {
    for (const p of linkedCrates(cargoMetadata(target))) {
      const key = `${p.name}@${p.version}`
      const entry = crates.get(key) ?? { pkg: p, platforms: new Set() }
      entry.platforms.add(platform)
      crates.set(key, entry)
    }
  }
  const components = []
  for (const { pkg, platforms } of [...crates.values()].sort((a, b) => `${a.pkg.name}@${a.pkg.version}`.localeCompare(`${b.pkg.name}@${b.pkg.version}`))) {
    const dir = path.dirname(pkg.manifest_path)
    let license = pkg.license
    let licenseNote = null
    if (!license && pkg.license_file) {
      const text = cleanText(readFileSync(path.join(dir, pkg.license_file), 'utf8'))
      license = detectLicense(text)
      licenseNote = `Cargo.toml names the licence file ${pkg.license_file}`
    }
    const authors = (pkg.authors ?? []).map(holderName).filter(Boolean)
    const holder = holderFor(pkg.name, authors.length ? `Copyright (c) ${authors.join(', ')}` : `Copyright (c) the ${pkg.name} developers`)
    const { texts, templated } = textsFor(dir, license, holder)
    const fromCratesIo = String(pkg.source ?? '').startsWith('registry+')
    const component = {
      part: 'desktop',
      kind: 'crate',
      name: pkg.name,
      version: pkg.version,
      license: license ?? 'UNKNOWN',
      licenseNote,
      url: pkg.repository ?? pkg.homepage ?? `https://crates.io/crates/${pkg.name}`,
      platforms: [...platforms].sort(),
      templated,
      texts
    }
    if (licenseBranches(license).some((branch) => branch.some((id) => RECIPROCAL.has(id))) && !isAllowedWithout(license, RECIPROCAL)) {
      component.source = {
        page: fromCratesIo ? `https://crates.io/crates/${pkg.name}/${pkg.version}` : null,
        download: fromCratesIo ? `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate` : null,
        repository: pkg.repository ?? null
      }
      if (!fromCratesIo) problems.push(`${pkg.name}@${pkg.version}: MPL-2.0 crate not from crates.io; give its source by hand`)
    }
    components.push(component)
    const linked = LINKED_CODE[pkg.name]
    if (linked && linked.platforms.some((p) => platforms.has(p))) {
      components.push({
        part: 'desktop',
        kind: 'linked',
        name: linked.name,
        version: `as shipped in ${pkg.name} ${pkg.version}`,
        license: linked.license,
        url: linked.url,
        platforms: linked.platforms,
        templated: false,
        texts: [{ file: linked.file, text: cleanText(TEMPLATES[linked.license]()) }]
      })
    }
  }
  return components
}

/** True when the expression is satisfiable without the given licences (MIT OR MPL-2.0, say). */
function isAllowedWithout(expression, without) {
  return licenseBranches(expression).some((b) => b.length && b.every((id) => ALLOWED.has(id) && !without.has(id)))
}

function gradleReport(androidDir) {
  const dir = path.resolve(androidDir)
  // By absolute path: cmd.exe does not always look in the working directory for a command.
  const windows = process.platform === 'win32'
  const wrapper = path.join(dir, windows ? 'gradlew.bat' : 'gradlew')
  const args = [':app:dependencies', '--configuration', 'releaseRuntimeClasspath', '--console=plain', '-q']
  const options = { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  // A .bat needs cmd.exe. The arguments are fixed, so the one command line is safe to hand it.
  const result = windows
    ? spawnSync(`"${wrapper}" ${args.join(' ')}`, { ...options, shell: true })
    : spawnSync(wrapper, args, options)
  if (result.status !== 0) throw new Error(`gradle dependencies failed:\n${result.stderr || result.stdout}`)
  return result.stdout
}

function collectMaven(report, problems) {
  const components = []
  const apache = cleanText(TEMPLATES['Apache-2.0']())
  for (const { group, artifact, version } of parseGradleDependencies(report)) {
    const known = MAVEN_GROUPS.find((g) => g.match.test(group))
    if (!known) problems.push(`${group}:${artifact}:${version}: Maven group not in MAVEN_GROUPS; add its licence`)
    const texts = known?.license === 'Apache-2.0' ? [{ file: 'Apache-2.0 (standard text)', text: apache }] : []
    if (known?.notice) texts.push({ file: 'NOTICE', text: known.notice })
    components.push({
      part: 'android',
      kind: 'maven',
      name: `${group}:${artifact}`,
      version,
      license: known?.license ?? 'UNKNOWN',
      url: known?.url ?? null,
      holder: known?.holder ?? null,
      templated: true,
      texts
    })
  }
  return components
}

/** Every file under assets/<folder> for the bundled folders, as forward-slash paths. */
export function assetFilesOnDisk(root = ROOT) {
  const out = []
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel)
      else out.push(childRel)
    }
  }
  for (const folder of ASSET_FOLDERS) walk(path.join(root, 'assets', folder), folder)
  return out.sort()
}

/** Files on disk the catalogue misses, files it lists twice, and files it lists that do not exist. */
export function checkAssetCatalogue(onDisk = assetFilesOnDisk(), listed = catalogueFiles()) {
  const counts = new Map()
  for (const f of listed) counts.set(f, (counts.get(f) ?? 0) + 1)
  const disk = new Set(onDisk)
  return {
    missing: onDisk.filter((f) => !counts.has(f)),
    duplicated: [...counts].filter(([, n]) => n > 1).map(([f]) => f),
    absent: [...counts.keys()].filter((f) => !disk.has(f))
  }
}

function collectAssets(problems) {
  const { missing, duplicated, absent } = checkAssetCatalogue()
  for (const f of missing) problems.push(`assets/${f}: not in scripts/third-party/assets.mjs; add its author, source and licence`)
  for (const f of duplicated) problems.push(`assets/${f}: listed more than once in scripts/third-party/assets.mjs`)
  for (const f of absent) problems.push(`assets/${f}: listed in scripts/third-party/assets.mjs but not on disk`)
  return ASSET_GROUPS.map((group) => ({
    part: 'assets',
    kind: 'asset',
    name: group.title,
    group,
    texts: group.licenseText === 'MIT' ? [{ file: 'MIT', text: cleanText(TEMPLATES.MIT(group.holder)) }] : []
  }))
}

export function collect(parts, { gradle, gradleDeps } = {}) {
  const problems = []
  const components = []
  for (const part of parts) {
    if (part === 'web') components.push(...collectNpm('web', problems))
    else if (part === 'assets') components.push(...collectAssets(problems))
    else if (part === 'desktop') components.push(...collectDesktop(problems))
    else if (part === 'android') {
      components.push(...collectNpm('android', problems))
      const report = gradleDeps ? readFileSync(gradleDeps, 'utf8') : gradle ? gradleReport(gradle) : null
      if (report === null) problems.push('android: pass --gradle <dir> or --gradle-deps <file> for the Maven libraries')
      else components.push(...collectMaven(report, problems))
    } else throw new Error(`unknown part "${part}" (expected web, assets, desktop or android)`)
  }
  for (const c of components) {
    if (c.kind === 'asset') continue
    const id = `${c.name}@${c.version}`
    if (c.license === 'UNKNOWN') problems.push(`${id}: no licence in its metadata or licence file`)
    else if (!isAllowed(c.license)) problems.push(`${id}: licence "${c.license}" is not in ALLOWED`)
    if (!c.texts.length) problems.push(`${id}: no licence text found and no standard text for "${c.license}"`)
  }
  return { parts: [...parts], components, problems }
}

/** Merge collected data, keeping one entry per component and the union of its platforms. */
export function merge(datasets) {
  const parts = []
  const byId = new Map()
  for (const data of datasets) {
    for (const p of data.parts) if (!parts.includes(p)) parts.push(p)
    for (const c of data.components) {
      const id = `${c.kind}:${c.name}@${c.version ?? ''}`
      const prev = byId.get(id)
      if (prev?.platforms && c.platforms) prev.platforms = [...new Set([...prev.platforms, ...c.platforms])].sort()
      else if (!prev) byId.set(id, structuredClone(c))
    }
  }
  return { parts, components: [...byId.values()], problems: datasets.flatMap((d) => d.problems ?? []) }
}

// ---- rendering -------------------------------------------------------------------------------

function wrap(text, width = 78, indent = '') {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = indent
  for (const word of words) {
    if (line.trim() && (line + ' ' + word).length > width) {
      lines.push(line)
      line = indent + word
    } else line = line.trim() ? `${line} ${word}` : indent + word
  }
  if (line.trim()) lines.push(line)
  return lines.join('\n')
}

function heading(text, char = '=') {
  return `${text}\n${char.repeat(Math.min(78, text.length))}`
}

function appVersion() {
  try {
    return JSON.parse(readFileSync(path.join(TAURI_DIR, 'tauri.conf.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

const PART_TITLES = {
  assets: 'Avatars, animations and props',
  web: 'npm packages in the web app (every app)',
  desktop: 'Rust crates in the desktop app',
  android: 'Android libraries'
}

function renderAssets(components) {
  const out = [wrap(ASSET_DECISION), '']
  for (const { group } of components) {
    out.push(heading(group.title, '-'))
    const fields = [
      ['Author', group.author],
      ['Source', group.source],
      ['Licence', group.licenseUrl && !String(group.license).includes(group.licenseUrl) ? `${group.license}, ${group.licenseUrl}` : group.license],
      ['Credit', group.credit],
      ['Changes', group.changes]
    ]
    for (const [label, value] of fields) if (value) out.push(wrap(`${label}: ${value}`, 78, ''))
    for (const note of group.notes ?? []) out.push(wrap(`Note: ${note}`))
    if (group.files) {
      out.push('Files:')
      for (const f of group.files) out.push(`  assets/${f}`)
    }
    for (const item of group.items ?? []) {
      out.push(`  assets/${item.file}`)
      if (item.title) out.push(wrap(`Title: ${item.title}`, 78, '    '))
      if (item.author) out.push(wrap(`Author: ${item.author}`, 78, '    '))
      if (item.tool) out.push(wrap(`Made with: ${item.tool}`, 78, '    '))
      if (item.source && item.source !== group.source) out.push(wrap(`Source: ${item.source}`, 78, '    '))
      if (item.license && item.license !== group.license) out.push(wrap(`Licence: ${item.license}${item.licenseUrl ? `, ${item.licenseUrl}` : ''}`, 78, '    '))
      else if (item.license && item.licenseUrl) out.push(wrap(`Licence: ${item.license}, ${item.licenseUrl}`, 78, '    '))
      if (item.terms) out.push(wrap(`Terms in the file: ${item.terms}`, 78, '    '))
      if (item.match) out.push(wrap(`Match: ${item.match}`, 78, '    '))
    }
    out.push('')
  }
  return out
}

/** Render merged data into the text of THIRD-PARTY-NOTICES.txt. */
/** What a notices file covers, from the parts it was made from. */
export function titleFor(parts) {
  const desktop = parts.includes('desktop')
  const android = parts.includes('android')
  if (desktop && !android) return 'desktop app'
  if (android && !desktop) return 'Android app'
  return 'desktop and Android apps'
}

export function render(data, { title = titleFor(data.parts), version = appVersion() } = {}) {
  const textIds = new Map() // cleaned text -> { id, users: [] }
  const refFor = (component) =>
    component.texts.map((t) => {
      const key = createHash('sha256').update(t.text).digest('hex')
      if (!textIds.has(key)) textIds.set(key, { id: `T${textIds.size + 1}`, file: t.file, text: t.text, users: [] })
      const entry = textIds.get(key)
      entry.users.push(`${component.name}${component.kind === 'asset' ? '' : ` ${component.version}`}`)
      return entry.id
    })

  const out = []
  out.push(heading(`THIRD-PARTY NOTICES: Avatar Companion ${version} (${title})`))
  out.push('')
  out.push(
    wrap(
      'Avatar Companion is Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer), ' +
        'and is licensed under the PolyForm Noncommercial License 1.0.0 (LICENSE.txt, ' +
        'https://polyformproject.org/licenses/noncommercial/1.0.0).'
    )
  )
  out.push('')
  out.push('Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)')
  out.push('')
  out.push(
    wrap(
      'This file lists the third-party software and content in the app, with the licence each came ' +
        'under. It is generated by scripts/third-party-notices.mjs in ' +
        'https://github.com/companionintelligence/Companion-Avatar from pnpm-lock.yaml, ' +
        'apps/desktop/src-tauri/Cargo.lock, the Android build\'s resolved libraries and the asset ' +
        'catalogue in scripts/third-party/assets.mjs. Licence texts that several components share ' +
        'are printed once, at the end, and referred to as [T1], [T2] and so on.'
    )
  )
  out.push('')

  const order = ['assets', 'web', 'desktop', 'android']
  const sections = order.filter((p) => data.components.some((c) => c.part === p))
  out.push('Contents')
  sections.forEach((p, i) => out.push(`  ${i + 1}. ${PART_TITLES[p]}`))
  const reciprocal = data.components.filter((c) => c.source)
  if (reciprocal.length) out.push(`  ${sections.length + 1}. Source code for the MPL-2.0 components`)
  out.push(`  ${sections.length + (reciprocal.length ? 2 : 1)}. Licence texts`)
  out.push('')

  sections.forEach((part, i) => {
    const components = data.components.filter((c) => c.part === part)
    out.push(heading(`${i + 1}. ${PART_TITLES[part]}${part === 'assets' ? '' : ` (${components.length})`}`))
    out.push('')
    if (part === 'assets') {
      // Asset texts (the MIT text of ChatVRM's clip) go to the shared list like the others.
      for (const c of components) if (c.texts.length) c.group = { ...c.group, notes: [...(c.group.notes ?? []), `Licence text: ${refFor(c).map((r) => `[${r}]`).join(', ')}`] }
      out.push(...renderAssets(components))
      return
    }
    for (const c of components.sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)))) {
      out.push(`${c.name} ${c.version}`)
      out.push(wrap(`Licence: ${LICENSE_LABELS[c.license] ?? c.license}${c.licenseNote ? ` (${c.licenseNote})` : ''}`, 78, '  '))
      if (c.url) out.push(`  ${c.url}`)
      if (c.platforms && c.platforms.length < 3) out.push(`  In the ${c.platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(' and ')} app only`)
      if (c.holder) out.push(`  ${c.holder}`)
      const refs = refFor(c)
      if (refs.length) out.push(`  Licence text${refs.length > 1 ? 's' : ''}: ${refs.map((r) => `[${r}]`).join(', ')}${c.templated ? ' (standard text; the package ships none of its own)' : ''}`)
      out.push('')
    }
  })

  if (reciprocal.length) {
    out.push(heading(`${sections.length + 1}. Source code for the MPL-2.0 components`))
    out.push('')
    out.push(
      wrap(
        'These components are used unmodified, under the Mozilla Public License 2.0. Their source code ' +
          'is available, at the exact version in the app, from:'
      )
    )
    out.push('')
    for (const c of reciprocal.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`${c.name} ${c.version}`)
      if (c.source.page) out.push(`  ${c.source.page}`)
      if (c.source.download) out.push(`  ${c.source.download}`)
      if (c.source.repository) out.push(`  ${c.source.repository}`)
      out.push('')
    }
  }

  out.push(heading(`${sections.length + (reciprocal.length ? 2 : 1)}. Licence texts`))
  out.push('')
  for (const entry of textIds.values()) {
    out.push(`[${entry.id}] ${entry.file}`)
    out.push(wrap(`Used by: ${entry.users.join(', ')}`, 78, '  '))
    out.push('')
    out.push(entry.text)
    out.push('')
    out.push('-'.repeat(78))
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

// ---- command line ----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { parts: [], from: [], strict: process.env.AVATAR_NOTICES_STRICT === '1' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--parts') args.parts.push(...next().split(',').map((s) => s.trim()).filter(Boolean))
    else if (a === '--from') args.from.push(next())
    else if (a === '--out') args.out = next()
    else if (a === '--json') args.json = next()
    else if (a === '--gradle') args.gradle = next()
    else if (a === '--gradle-deps') args.gradleDeps = next()
    else if (a === '--title') args.title = next()
    else if (a === '--strict') args.strict = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (!args.parts.length && !args.from.length) throw new Error('give --parts and/or --from')
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const datasets = args.from.map((f) => JSON.parse(readFileSync(f, 'utf8')))
  if (args.parts.length) datasets.push(collect(args.parts, args))
  const data = merge(datasets)
  for (const problem of data.problems) console.error(`${args.strict ? 'error' : 'warning'}: ${problem}`)
  if (args.strict && data.problems.length) {
    console.error(`third-party-notices: ${data.problems.length} problem(s); nothing written`)
    process.exit(1)
  }
  if (args.json) {
    mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true })
    writeFileSync(args.json, JSON.stringify(data, null, 1))
  }
  if (args.out) {
    mkdirSync(args.out, { recursive: true })
    const text = render(data, args.title ? { title: args.title } : {})
    const leak = text.split('\n').find((line) => LOCAL_PATH.test(line))
    if (leak) throw new Error(`refusing to write a local path into the notices: ${leak.trim()}`)
    writeFileSync(path.join(args.out, 'THIRD-PARTY-NOTICES.txt'), `${text}\n`)
    copyFileSync(path.join(ROOT, 'LICENSE'), path.join(args.out, 'LICENSE.txt'))
  }
  const counts = data.parts.map((p) => `${p} ${data.components.filter((c) => c.part === p).length}`).join(', ')
  console.log(`third-party-notices: ${counts}${args.out ? ` -> ${path.join(args.out, 'THIRD-PARTY-NOTICES.txt')}` : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(`third-party-notices: ${error.message}`)
    process.exit(1)
  }
}
