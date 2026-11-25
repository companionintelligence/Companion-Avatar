import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The Snap and the two distribution workflows are configuration nobody runs on a pull request, so
// these tests are what keeps them honest against the apps they package.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

const snapcraft = read('snap/snapcraft.yaml')
const desktopFile = read('snap/gui/avatar-companion.desktop')
const tauri = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'))
const rootPackage = JSON.parse(read('package.json'))
const cargoName = /^name = "([^"]+)"/m.exec(read('apps/desktop/src-tauri/Cargo.toml'))[1]

const field = (text, key) => new RegExp(`^${key}: (.+)$`, 'm').exec(text)?.[1].replace(/^'(.*)'$/, '$1')
// A line of a .desktop file: Key=Value.
const entry = (text, key) => new RegExp(`^${key}=(.+)$`, 'm').exec(text)?.[1]

describe('snap/snapcraft.yaml', () => {
  it('packages this version of the desktop app', () => {
    expect(field(snapcraft, 'version')).toBe(tauri.version)
    expect(field(snapcraft, 'name')).toBe('avatar-companion')
    expect(field(snapcraft, 'license')).toBe(rootPackage.license)
  })

  it('runs the binary the Tauri build produces', () => {
    expect(snapcraft).toContain(`command: usr/bin/${cargoName}`)
    expect(snapcraft).toContain('--bundles deb')
    // The web app has to be built before the desktop build, which skips its own beforeBuildCommand.
    expect(snapcraft.indexOf('--filter @ci-avatar/web build')).toBeGreaterThan(0)
    expect(snapcraft.indexOf('--filter @ci-avatar/web build')).toBeLessThan(snapcraft.indexOf('tauri build'))
    expect(snapcraft).toContain('"beforeBuildCommand":""')
  })

  it('builds with the pnpm version the repository pins', () => {
    const pinned = /^pnpm@(.+)$/.exec(rootPackage.packageManager)[1]
    expect(snapcraft).toContain(`pnpm@${pinned} `)
  })

  it('is a strict core24 snap that can hear the microphone and play sound', () => {
    expect(field(snapcraft, 'base')).toBe('core24')
    expect(field(snapcraft, 'confinement')).toBe('strict')
    expect(snapcraft).toMatch(/^platforms:\n {2}amd64:/m)
    expect(snapcraft).not.toMatch(/^architectures:/m)
    for (const plug of ['network', 'audio-playback', 'audio-record']) expect(snapcraft).toContain(`- ${plug}`)
  })

  it('stays out of the stable channel until someone has tried it', () => {
    expect(['devel', 'stable']).toContain(field(snapcraft, 'grade'))
  })

  it('has a store listing the Snap Store accepts', () => {
    expect(field(snapcraft, 'summary').length).toBeLessThanOrEqual(78)
    expect(snapcraft).toMatch(/^description: \|\n {2}\S/m)
    expect(field(snapcraft, 'icon')).toBe('snap/gui/icon.png')
    const png = readFileSync(path.join(root, 'snap/gui/icon.png'))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    // Width and height sit in the IHDR chunk. The store wants a square icon of 256 to 512 pixels.
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(256)
    expect(width).toBeLessThanOrEqual(512)
  })
})

describe('snap/gui/avatar-companion.desktop', () => {
  it('launches the snap app and shows the snap icon', () => {
    expect(entry(desktopFile, 'Exec')).toBe('avatar-companion')
    expect(entry(desktopFile, 'Icon')).toBe('${SNAP}/meta/gui/icon.png')
    expect(entry(desktopFile, 'Name')).toBe(tauri.productName)
    expect(entry(desktopFile, 'StartupWMClass')).toBe(cargoName)
  })
})

describe.each(['package-manifests.yml', 'snap-build.yml'])('.github/workflows/%s', (file) => {
  const workflow = read(`.github/workflows/${file}`)

  it('starts only when someone dispatches it, like the other release workflows', () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m)
    expect(workflow).not.toMatch(/^ {2}(push|pull_request|schedule):/m)
  })

  it('pins every third-party action to a commit', () => {
    const uses = [...workflow.matchAll(/^\s+- uses: (\S+)/gm)].map((match) => match[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/)
  })

  it('reads inputs through the environment, never into a script', () => {
    const scripts = [...workflow.matchAll(/^\s+run: ([|>]-?\n(?:\s{10,}.*\n?)+|.*)/gm)].map((match) => match[1]).join('\n')
    expect(scripts).not.toContain('${{ inputs.')
  })
})

describe('.github/workflows/snap-build.yml', () => {
  const workflow = read('.github/workflows/snap-build.yml')

  it('builds without publishing unless a channel is chosen', () => {
    expect(workflow).toMatch(/default: none/)
    expect(workflow).toMatch(/if: inputs\.publish != 'none'/)
    expect(workflow).toContain('SNAPCRAFT_STORE_CREDENTIALS: ${{ secrets.SNAPCRAFT_STORE_CREDENTIALS }}')
  })
})
