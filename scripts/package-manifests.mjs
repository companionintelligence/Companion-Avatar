#!/usr/bin/env node
/**
 * package-manifests.mjs: the package-manager manifests for one Avatar Companion release, from the
 * release's SHA256SUMS.txt.
 *
 *   node scripts/package-manifests.mjs --tag v0.2.0 --sums SHA256SUMS.txt --out manifests \
 *     [--repo companionintelligence/Companion-Avatar] [--released 2026-11-15] [--macos-notarized]
 *
 * It writes, under --out:
 *
 *   homebrew/Casks/avatar-companion.rb                          for companionintelligence/homebrew-tap
 *   scoop/avatar-companion.json                                 for companionintelligence/scoop-bucket
 *   winget/CompanionIntelligence.AvatarCompanion[...].yaml      for a pull request to microsoft/winget-pkgs
 *
 * --sums is the file native-release.yml publishes (`<sha256>  <file name>` per line), or `-` for
 * standard input. Nothing is uploaded or published: the files are for a person to review and copy
 * into those repositories.
 *
 * The file names are the ones .github/workflows/native-release.yml gives each installer; a test keeps
 * the two in step. The Homebrew cask is marked unpublishable until the macOS build is notarized, which
 * the release workflow does not do yet (--macos-notarized says it was).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const REPO = 'companionintelligence/Companion-Avatar'
export const HOMEPAGE = 'https://avatar.ci.computer'
export const PUBLISHER = 'Companion Intelligence'
export const PUBLISHER_URL = 'https://ci.computer'
export const LICENSE_ID = 'PolyForm-Noncommercial-1.0.0'
export const LICENSE_URL = 'https://polyformproject.org/licenses/noncommercial/1.0.0'
export const WINGET_ID = 'CompanionIntelligence.AvatarCompanion'
export const WINGET_SCHEMA = '1.10.0'
export const DESCRIPTION = 'Embodied AI companion with a 3D avatar, voice and chat'
/** The macOS bundle identifier in apps/desktop/src-tauri/tauri.conf.json; the cask's zap list uses it. */
export const BUNDLE_ID = 'computer.ci.avatar'

const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

/** The release file names, as native-release.yml names them. */
export function assetNames(tag) {
  const base = `avatar-companion-${tag}`
  return {
    dmg: `${base}-macos-universal.dmg`,
    exe: `${base}-windows-x64-setup.exe`,
    msi: `${base}-windows-x64.msi`,
    deb: `${base}-linux-amd64.deb`,
    rpm: `${base}-linux-x86_64.rpm`
  }
}

/** `1.2.3` from `v1.2.3`; throws for anything that is not a release tag. */
export function versionOf(tag) {
  const match = TAG.exec(String(tag))
  if (!match) throw new Error(`The tag must look like v0.2.0 or v0.2.0-rc.1, not '${tag}'.`)
  return match[1]
}

/** SHA256SUMS.txt into a Map of file name to lower-case digest. Throws on a line it cannot read. */
export function parseSums(text) {
  const sums = new Map()
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const match = /^([0-9a-fA-F]{64}) [ *]?(\S.*)$/.exec(line)
    if (!match) throw new Error(`SHA256SUMS.txt line ${index + 1} is not '<sha256>  <file name>'.`)
    sums.set(match[2].trim(), match[1].toLowerCase())
  }
  return sums
}

function digestOf(sums, file) {
  const digest = sums.get(file)
  if (!digest) throw new Error(`SHA256SUMS.txt has no digest for ${file}.`)
  return digest
}

const downloadUrl = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`

/** The Homebrew cask for the universal dmg. */
export function renderCask({ tag, sums, repo = REPO, notarized = false }) {
  const version = versionOf(tag)
  const { dmg } = assetNames(tag)
  const sha = digestOf(sums, dmg)
  const file = dmg.replace(tag, 'v#{version}')
  const banner = notarized
    ? []
    : [
        '# NOT PUBLISHABLE YET. The macOS app in this release is ad-hoc signed and not notarized, and Homebrew',
        '# refuses casks that fail Gatekeeper. Notarize first (apps/desktop/scripts/desktop-notarize.sh), cut a',
        '# new release, and regenerate this file with --macos-notarized.',
        ''
      ]
  return [
    ...banner,
    '# Homebrew Cask for the Avatar Companion desktop app (universal macOS build)',
    'cask "avatar-companion" do',
    `  version "${version}"`,
    `  sha256 "${sha}"`,
    '',
    `  url "https://github.com/${repo}/releases/download/v#{version}/${file}"`,
    '  name "Avatar Companion"',
    `  desc "${DESCRIPTION}"`,
    `  homepage "${HOMEPAGE}"`,
    '',
    '  # The repository publishes many things; a release counts once it lists the universal dmg this cask',
    '  # installs. Releases are still marked pre-release, so this does not skip them: add',
    '  # `|| release["prerelease"]` to the draft check once a stable release exists.',
    '  livecheck do',
    '    url :url',
    '    regex(/^v?(\\d+(?:\\.\\d+)+)$/i)',
    '    strategy :github_releases do |json, regex|',
    '      json.filter_map do |release|',
    '        next if release["draft"]',
    '        next unless release["assets"]&.any? { |asset| asset["name"].to_s.end_with?("-macos-universal.dmg") }',
    '',
    '        match = release["tag_name"]&.match(regex)',
    '        next if match.blank?',
    '',
    '        match[1]',
    '      end',
    '    end',
    '  end',
    '',
    '  depends_on macos: :monterey',
    '',
    '  app "Avatar Companion.app"',
    '',
    '  zap trash: [',
    `    "~/Library/Application Support/${BUNDLE_ID}",`,
    `    "~/Library/Caches/${BUNDLE_ID}",`,
    `    "~/Library/HTTPStorages/${BUNDLE_ID}",`,
    `    "~/Library/Saved Application State/${BUNDLE_ID}.savedState",`,
    `    "~/Library/WebKit/${BUNDLE_ID}",`,
    '  ]',
    '',
    '  caveats <<~EOS',
    '    Avatar Companion starts in demo mode, with a scripted avatar. To talk to a language model, open',
    "    Settings, choose Proxy or Ollama, enter your server's address and press Check connection.",
    '  EOS',
    'end',
    ''
  ].join('\n')
}

/** The Scoop manifest for the NSIS installer (it installs for the current user). */
export function renderScoop({ tag, sums, repo = REPO }) {
  const version = versionOf(tag)
  const { exe } = assetNames(tag)
  const manifest = {
    version,
    description: DESCRIPTION,
    homepage: HOMEPAGE,
    license: { identifier: LICENSE_ID, url: LICENSE_URL },
    notes:
      'Avatar Companion starts in demo mode, with a scripted avatar. To talk to a language model, open Settings, ' +
      "choose Proxy or Ollama, enter your server's address and press Check connection.",
    architecture: {
      '64bit': {
        url: `${downloadUrl(repo, tag, exe)}#/dl.exe`,
        hash: digestOf(sums, exe)
      }
    },
    installer: { file: 'dl.exe', args: ['/S'] },
    uninstaller: {
      script:
        "Write-Host 'Avatar Companion was installed by its own setup program, so Scoop cannot remove it. " +
        "To uninstall it, use Windows Settings > Apps > Avatar Companion.'"
    },
    checkver: {
      url: `https://github.com/${repo}/releases`,
      regex: 'tag/v([\\d.]+)"'
    },
    autoupdate: {
      architecture: {
        '64bit': {
          url: `https://github.com/${repo}/releases/download/v$version/${exe.replace(tag, 'v$version')}#/dl.exe`
        }
      }
    }
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** The three winget files for the NSIS installer, keyed by file name. */
export function renderWinget({ tag, sums, repo = REPO, released = null }) {
  const version = versionOf(tag)
  const { exe } = assetNames(tag)
  const head = (type) => [
    `PackageIdentifier: ${WINGET_ID}`,
    `PackageVersion: ${version}`,
    ...(type === 'version' ? ['DefaultLocale: en-US'] : []),
    ...(type === 'installer' ? ['InstallerLocale: en-US'] : []),
    ...(type === 'defaultLocale' ? ['PackageLocale: en-US'] : [])
  ]
  const foot = (type) => [`ManifestType: ${type}`, `ManifestVersion: ${WINGET_SCHEMA}`, '']

  const versionFile = [...head('version'), ...foot('version')].join('\n')

  const installerFile = [
    ...head('installer'),
    'InstallerType: nullsoft',
    'Scope: user',
    'InstallModes:',
    '  - interactive',
    '  - silent',
    '  - silentWithProgress',
    'InstallerSwitches:',
    '  Silent: /S',
    '  SilentWithProgress: /S',
    'UpgradeBehavior: install',
    ...(released ? [`ReleaseDate: ${released}`] : []),
    'Installers:',
    '  - Architecture: x64',
    `    InstallerUrl: ${downloadUrl(repo, tag, exe)}`,
    `    InstallerSha256: ${digestOf(sums, exe).toUpperCase()}`,
    ...foot('installer')
  ].join('\n')

  const localeFile = [
    ...head('defaultLocale'),
    `Publisher: ${PUBLISHER}`,
    `PublisherUrl: ${PUBLISHER_URL}`,
    'PackageName: Avatar Companion',
    `PackageUrl: ${HOMEPAGE}`,
    `License: ${LICENSE_ID}`,
    `LicenseUrl: ${LICENSE_URL}`,
    `ShortDescription: ${DESCRIPTION}`,
    'Description: >-',
    '  Avatar Companion is a 3D avatar you talk to. It starts in demo mode, with a scripted avatar, and',
    '  connects to a language model server you choose in Settings.',
    'Tags:',
    '  - ai',
    '  - avatar',
    '  - assistant',
    '  - companion',
    `ReleaseNotesUrl: https://github.com/${repo}/releases/tag/${tag}`,
    ...foot('defaultLocale')
  ].join('\n')

  return {
    [`${WINGET_ID}.yaml`]: versionFile,
    [`${WINGET_ID}.installer.yaml`]: installerFile,
    [`${WINGET_ID}.locale.en-US.yaml`]: localeFile
  }
}

/** Every file for a release, keyed by its path under the output folder. */
export function generate({ tag, sums, repo = REPO, released = null, notarized = false }) {
  if (released && !/^\d{4}-\d{2}-\d{2}$/.test(released)) throw new Error(`--released must be YYYY-MM-DD, not '${released}'.`)
  const files = {
    'homebrew/Casks/avatar-companion.rb': renderCask({ tag, sums, repo, notarized }),
    'scoop/avatar-companion.json': renderScoop({ tag, sums, repo })
  }
  for (const [name, text] of Object.entries(renderWinget({ tag, sums, repo, released }))) files[`winget/${name}`] = text
  return files
}

function parseArgs(argv) {
  const args = { notarized: false }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--macos-notarized') args.notarized = true
    else if (['--tag', '--sums', '--out', '--repo', '--released'].includes(key)) args[key.slice(2)] = argv[++i]
    else throw new Error(`Unknown argument ${key}.`)
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.tag || !args.sums || !args.out) {
    console.error('usage: package-manifests.mjs --tag v0.2.0 --sums SHA256SUMS.txt --out <dir> [--repo owner/name] [--released YYYY-MM-DD] [--macos-notarized]')
    process.exit(2)
  }
  const sums = parseSums(readFileSync(args.sums === '-' ? 0 : args.sums, 'utf8'))
  const files = generate({ tag: args.tag, sums, repo: args.repo ?? REPO, released: args.released ?? null, notarized: args.notarized })
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(args.out, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
    console.log(`wrote ${target}`)
  }
  if (!args.notarized) {
    console.error('warning: the Homebrew cask is marked NOT PUBLISHABLE until the macOS app is notarized (--macos-notarized).')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`package-manifests: ${error.message}`)
    process.exit(1)
  }
}
