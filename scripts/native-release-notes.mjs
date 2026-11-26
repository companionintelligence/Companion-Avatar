#!/usr/bin/env node
/**
 * native-release-notes.mjs: the notes for a native pre-release, from the files it publishes.
 *
 * .github/workflows/native-release.yml runs it in the publish job, over the folder of release
 * files, and passes the result to `gh release create --notes-file`:
 *
 *   node scripts/native-release-notes.mjs --dir dist --tag v0.2.0 --version 0.2.0 \
 *     --commit <sha> --repo companionintelligence/Companion-Avatar [--android-signing <file>]
 *
 * --android-signing names the file the Android job writes: `mode=keystore|throwaway` and
 * `cert=<the signing certificate's SHA-256>`, one per line. Without an APK in --dir there is no
 * Android section.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The release file that matches, by the names the workflow gives them, or null. */
function pick(files, suffix) {
  return files.find((f) => f.endsWith(suffix)) ?? null
}

/** `mode=…` / `cert=…` lines into an object. */
export function parseSigning(text) {
  const out = {}
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

export function releaseNotes({ files, tag, version, commit, repo, server = 'https://github.com', signing = {} }) {
  const exe = pick(files, '-windows-x64-setup.exe')
  const msi = pick(files, '-windows-x64.msi')
  const dmg = pick(files, '-macos-universal.dmg')
  const deb = pick(files, '-linux-amd64.deb')
  const rpm = pick(files, '-linux-x86_64.rpm')
  const apk = files.find((f) => f.endsWith('.apk')) ?? null
  const short = String(commit).slice(0, 7)
  const apps = apk ? 'desktop and Android apps' : 'desktop apps'
  const code = (name) => (name ? `\`${name}\`` : '(not in this release)')

  const out = []
  const line = (text = '') => out.push(text)

  line(
    `Avatar Companion ${version} is a **pre-release** of the ${apps}, built from ` +
      `[\`${short}\`](${server}/${repo}/commit/${commit}) by the Native release workflow. ` +
      'It is for trying the apps, not a store build: nothing here went through the Microsoft Store, ' +
      'the Mac App Store or Google Play, and the desktop installers are not code-signed or notarized.'
  )
  line()
  line('## Downloads')
  line()
  line('| Platform | File |')
  line('| --- | --- |')
  line(`| Windows 10 and 11 (x64) | ${code(exe)} (installs for you only, no admin rights) or ${code(msi)} (installs for all users) |`)
  line(`| macOS 12 or later, Apple silicon and Intel | ${code(dmg)} |`)
  line(`| Debian, Ubuntu 22.04 or later (x86_64) | ${code(deb)} |`)
  line(`| Fedora, RHEL or openSUSE (x86_64) | ${code(rpm)} |`)
  if (apk) line(`| Android 7.0 or later | ${code(apk)} |`)
  line()
  line(
    'To check a download, compare it with `SHA256SUMS.txt`: `sha256sum -c SHA256SUMS.txt --ignore-missing` ' +
      'on Linux, `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` on macOS, or `Get-FileHash <file>` in ' +
      'PowerShell on Windows.'
  )
  line()
  line('## What the apps do without a server')
  line()
  line(
    'The apps need no account, no server and no internet connection to start: the 3D scene\'s studio lighting is ' +
      'a file that ships with them, and everything else they show is bundled. ' +
      'They start in demo mode:'
  )
  line()
  line('- The 3D avatar, with every bundled avatar to pick from in Settings, its body animations, expressions and lip-sync.')
  line(
    '- Text chat with the built-in demo responder. Its answers are scripted, not from a language model, and the ' +
      'session says **Demo-only**. If a first message is answered with "run Check connection", open Settings and ' +
      'press **Check connection** once.'
  )
  line('- Spoken replies, with the system voice, where the app\'s WebView offers speech synthesis.')
  line(
    '- **On-device** (Settings) is meant to run a small language model with WebGPU. Its engine ships with the app; the ' +
      'model downloads from huggingface.co (and its compiled library from raw.githubusercontent.com) the first time. ' +
      'It is switched off in the desktop app, where it has not been run yet. In the Android app it needs a WebView ' +
      'with WebGPU; it has not been tried there.'
  )
  line()
  line('What they do not do in this release:')
  line()
  line(
    '- **No language model is built in.** For real answers, open Settings and pick **Proxy** with the chat URL of ' +
      'your own Avatar Companion server (`https://<your-server>/api/chat`), or **Ollama** with your Ollama server\'s ' +
      'address, then press **Check connection**. The desktop app reaches servers over HTTPS, or over plain HTTP on ' +
      'the same computer (`localhost`, `127.0.0.1`); the Android app over HTTPS only. Ollama must allow the app: on ' +
      'Windows set `OLLAMA_ORIGINS=http://tauri.localhost`. A server built from this release accepts the apps without ' +
      'any setting.'
  )
  line(
    '- No server-side voices, server-side speech recognition or live talk: the app reaches those through a server ' +
      'address built into it, and these builds have none. Companion memory works when the server you pick is set ' +
      'up with it.'
  )
  line('- Voice input depends on the WebView\'s speech recognition, which the app WebViews may not offer. Text chat always works.')
  line('- No WebXR or immersive mode: it is not available in the apps\' WebViews. Use the website on a headset.')
  line('- The 1970s datacenter diorama is in the apps, but nothing in them switches to it yet (on the web it is `?env=datacenter-1970s`).')
  line()
  line(
    'Your settings, including the server you pick, stay on the device, and chat goes only to the server you pick. ' +
      'The microphone is used only when you turn it on. There is no telemetry, and no API key or server address is ' +
      'built into the apps.'
  )
  line()
  line('## Installing')
  line()
  line('### Windows')
  line()
  line(
    'The installers are not code-signed, so Microsoft Defender SmartScreen may say "Windows protected your PC". ' +
      'Click **More info**, then **Run anyway**. The installer downloads Microsoft Edge WebView2 if Windows does not ' +
      'already have it.'
  )
  line()
  line('### macOS')
  line()
  line(
    'The app is ad-hoc signed and not notarized, so macOS will not open it with a double-click the first time. ' +
      'Open the .dmg and drag **Avatar Companion** to Applications. Then right-click (or Control-click) it in ' +
      'Applications, choose **Open**, and click **Open** again. If macOS still refuses (on macOS 15 and later it ' +
      'will), open **System Settings > Privacy & Security**, scroll to the message about Avatar Companion and ' +
      'click **Open Anyway**.'
  )
  line()
  line('### Linux')
  line()
  line(`- Debian or Ubuntu: \`sudo apt install ./${deb ?? 'avatar-companion.deb'}\``)
  line(`- Fedora or RHEL: \`sudo dnf install ./${rpm ?? 'avatar-companion.rpm'}\``)
  line()
  line(
    'The package manager also installs WebKitGTK 4.1, which the app needs. The packages were built on Ubuntu ' +
      '22.04, so they need glibc 2.35 or later.'
  )
  if (apk) {
    const throwaway = signing.mode === 'throwaway' || apk.includes('throwaway-signed')
    line()
    line('### Android (sideloading)')
    line()
    line(
      'Download the APK on the phone and open it. Android asks you to allow your browser or file manager to ' +
        '**install unknown apps**; allow it for this install. Google Play Protect may warn about an app it does not ' +
        'know; choose to install anyway.'
    )
    line()
    line(
      throwaway
        ? 'This APK is signed with a throwaway key that was made for this build and then deleted ' +
            '(`throwaway-signed` in the file name). No later build will be signed with that key.'
        : 'This APK is signed with the project\'s release key (`keystore-signed` in the file name). Later releases ' +
            'signed with the same key install over it and keep its data.'
    )
    if (signing.cert) {
      line()
      line(`Signing certificate SHA-256: \`${signing.cert}\``)
    }
    line()
    line(
      'Android installs an update only when it is signed with the same key as the installed app. A later build ' +
        'signed with a different key will not install over this one: uninstall this version first, which deletes ' +
        'the app\'s data on the phone, such as your settings and the server you picked.'
    )
  }
  line()
  line('## Licences')
  line()
  line(
    'Avatar Companion is licensed under the PolyForm Noncommercial License 1.0.0 (`LICENSE`, ' +
      'https://polyformproject.org/licenses/noncommercial/1.0.0).'
  )
  line()
  line('> Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)')
  line()
  line(
    '`THIRD-PARTY-NOTICES.txt` lists the third-party software in the apps with its licence texts, where to get the ' +
      'source of the MPL-2.0 components, and the authors, sources and licences of the bundled avatars, animations ' +
      'and props. Each app carries it too. Companion Intelligence has permission to redistribute that content in the ' +
      'apps; it is not licensed to you for use outside them.'
  )
  line()
  line(`Tag \`${tag}\`.`)
  return `${out.join('\n')}\n`
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key.startsWith('--') || value === undefined) throw new Error(`bad argument near ${key}`)
    args[key.slice(2)] = value
  }
  for (const required of ['dir', 'tag', 'version', 'commit', 'repo']) {
    if (!args[required]) throw new Error(`--${required} is required`)
  }
  return args
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2))
  const files = readdirSync(args.dir).sort()
  const signing = args['android-signing'] ? parseSigning(readFileSync(args['android-signing'], 'utf8')) : {}
  process.stdout.write(
    releaseNotes({
      files,
      tag: args.tag,
      version: args.version,
      commit: args.commit,
      repo: args.repo,
      server: process.env.GITHUB_SERVER_URL || 'https://github.com',
      signing
    })
  )
}
