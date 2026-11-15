import { describe, expect, it } from 'vitest'

import { parseSigning, releaseNotes } from './native-release-notes.mjs'

const DESKTOP = [
  'avatar-companion-v0.2.0-windows-x64-setup.exe',
  'avatar-companion-v0.2.0-windows-x64.msi',
  'avatar-companion-v0.2.0-macos-universal.dmg',
  'avatar-companion-v0.2.0-linux-amd64.deb',
  'avatar-companion-v0.2.0-linux-x86_64.rpm',
  'LICENSE',
  'SHA256SUMS.txt',
  'THIRD-PARTY-NOTICES.txt'
]

const base = { tag: 'v0.2.0', version: '0.2.0', commit: '0123456789abcdef', repo: 'companionintelligence/Companion-Avatar' }

describe('native release notes', () => {
  const notes = releaseNotes({
    ...base,
    files: [...DESKTOP, 'avatar-companion-v0.2.0-android-throwaway-signed.apk'],
    signing: { mode: 'throwaway', cert: 'AB:CD' }
  })

  it('says it is a pre-release and not a store build', () => {
    expect(notes).toContain('**pre-release**')
    expect(notes).toContain('not a store build')
    expect(notes).toContain('not code-signed or notarized')
  })

  it('lists every installer and how to check it', () => {
    for (const file of DESKTOP.slice(0, 5)) expect(notes).toContain(file)
    expect(notes).toContain('SHA256SUMS.txt')
  })

  it('tells people how to get past SmartScreen and Gatekeeper', () => {
    expect(notes).toContain('SmartScreen')
    expect(notes).toContain('**Run anyway**')
    expect(notes).toContain('choose **Open**')
    expect(notes).toContain('**Open Anyway**')
  })

  it('gives the deb and rpm install commands', () => {
    expect(notes).toContain('sudo apt install ./avatar-companion-v0.2.0-linux-amd64.deb')
    expect(notes).toContain('sudo dnf install ./avatar-companion-v0.2.0-linux-x86_64.rpm')
  })

  it('explains sideloading and that a differently signed build needs an uninstall first', () => {
    expect(notes).toContain('install unknown apps')
    expect(notes).toContain('throwaway key')
    expect(notes).toContain('uninstall this version first')
    expect(notes).toContain('Signing certificate SHA-256: `AB:CD`')
  })

  it('says what works without a server and what does not', () => {
    expect(notes).toContain('## What the apps do without a server')
    expect(notes).toContain('demo mode')
    expect(notes).toContain('**No language model is built in.**')
    expect(notes).toContain('OLLAMA_ORIGINS=http://tauri.localhost')
    expect(notes).toContain('No WebXR')
  })

  it('carries the licence and the Required Notice', () => {
    expect(notes).toContain('PolyForm Noncommercial License 1.0.0')
    expect(notes).toContain('Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)')
    expect(notes).toContain('THIRD-PARTY-NOTICES.txt')
  })

  it('names the release key when the APK is keystore-signed', () => {
    const keystore = releaseNotes({
      ...base,
      files: [...DESKTOP, 'avatar-companion-v0.2.0-android-keystore-signed.apk'],
      signing: { mode: 'keystore', cert: 'EF:01' }
    })
    expect(keystore).toContain("signed with the project's release key")
    expect(keystore).not.toContain('throwaway key')
  })

  it('leaves Android out when the release has no APK', () => {
    const desktopOnly = releaseNotes({ ...base, files: DESKTOP })
    expect(desktopOnly).toContain('pre-release** of the desktop apps')
    expect(desktopOnly).not.toContain('Android (sideloading)')
    expect(desktopOnly).not.toContain('Android 7.0')
  })

  it('reads the signing file the Android job writes', () => {
    expect(parseSigning('mode=keystore\ncert=AA:BB\n')).toEqual({ mode: 'keystore', cert: 'AA:BB' })
  })
})
