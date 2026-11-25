import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentBoundary, STUDIO_HDRI_URL, StudioEnvironment } from './StudioEnvironment'

// The studio's HDRI used to come from a CDN when the scene mounted, and when that fetch failed the loader
// threw. Nothing caught it, so the whole page went blank (avatar.ci.computer, 2026-11-24). Now the file ships
// with the app, and the environment sits in a boundary besides. These hold both to what the scene needs of them:
// the light comes from our own origin, and a throw stops at the boundary while the rest of the page stays.

// drei's <Environment> needs a canvas and a file to load. Here it is a stand-in that records its props and
// throws when it is asked for a file and the file "fails", which is what a failed load does.
const drei = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, fileFails: false }))

vi.mock('@react-three/drei', () => ({
  Environment: (props: Record<string, unknown>) => {
    drei.calls.push(props)
    if (props.files && drei.fileFails) throw new Error('Could not load studio_small_03_1k.hdr: Failed to fetch')
    return <i data-testid={props.files ? 'file-environment' : 'generated-environment'} />
  },
  Lightformer: () => null
}))

const Thrower = (): never => {
  throw new Error('Could not load studio_small_03_1k.hdr: Failed to fetch')
}

/**
 * The repository root, from packages/core/src/components/scene/environment/. A path, not a URL: under the jsdom
 * project a URL resolved against import.meta.url that climbs this far comes out as an http://localhost one.
 */
const repoRoot = path.resolve(import.meta.dirname, '../../../../../..')

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  drei.calls.length = 0
  drei.fileFails = false
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  // React logs every error a boundary catches
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EnvironmentBoundary', () => {
  it('shows its children while nothing throws', () => {
    render(
      <EnvironmentBoundary fallback={<i data-testid="fallback" />}>
        <b data-testid="environment" />
      </EnvironmentBoundary>
    )
    expect(screen.getByTestId('environment')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('shows the fallback when a child throws, and says why', () => {
    render(
      <EnvironmentBoundary fallback={<i data-testid="fallback" />}>
        <Thrower />
      </EnvironmentBoundary>
    )
    expect(screen.getByTestId('fallback')).toBeTruthy()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('studio environment failed to load')
    expect(String(warn.mock.calls[0][1])).toContain('studio_small_03_1k.hdr')
  })

  it('keeps the rest of the page when a child throws', () => {
    render(
      <main data-testid="page">
        <EnvironmentBoundary fallback={<i data-testid="fallback" />}>
          <Thrower />
        </EnvironmentBoundary>
        <span data-testid="avatar" />
      </main>
    )
    expect(screen.getByTestId('page')).toBeTruthy()
    expect(screen.getByTestId('avatar')).toBeTruthy()
    expect(screen.getByTestId('fallback')).toBeTruthy()
  })

  it('does not catch a throw from outside it', () => {
    expect(() =>
      render(
        <>
          <EnvironmentBoundary fallback={<i />}>
            <b />
          </EnvironmentBoundary>
          <Thrower />
        </>
      )
    ).toThrow(/studio_small_03_1k/)
  })
})

describe('StudioEnvironment', () => {
  it('lights the scene from the HDRI that ships with the app, not from a preset', () => {
    render(<StudioEnvironment intensity={0.8} />)

    expect(screen.getByTestId('file-environment')).toBeTruthy()
    expect(drei.calls).toHaveLength(1)
    expect(drei.calls[0]).toMatchObject({ files: STUDIO_HDRI_URL, background: false, environmentIntensity: 0.8 })
    // a preset is what took drei to raw.githack.com
    expect(drei.calls[0]).not.toHaveProperty('preset')
    expect(warn).not.toHaveBeenCalled()
  })

  it('lights it with generated lighting at the same intensity, and says why, when the file fails to load', () => {
    drei.fileFails = true
    render(
      <main>
        <StudioEnvironment intensity={0.6} />
        <span data-testid="avatar" />
      </main>
    )

    expect(screen.queryByTestId('file-environment')).toBeNull()
    expect(screen.getByTestId('generated-environment')).toBeTruthy()
    expect(screen.getByTestId('avatar')).toBeTruthy()
    const generated = drei.calls.at(-1)
    expect(generated).toMatchObject({ background: false, environmentIntensity: 0.6, frames: 1 })
    expect(generated).not.toHaveProperty('files')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][1])).toContain('studio_small_03_1k.hdr')
  })

  it('defaults to full intensity', () => {
    render(<StudioEnvironment />)
    expect(drei.calls[0]).toMatchObject({ environmentIntensity: 1 })
  })
})

describe('the studio HDRI ships with the app', () => {
  const file = path.join(repoRoot, STUDIO_HDRI_URL)

  it('is served from the app\'s own origin and is a file in assets/environments/, where pack-assets takes it from', () => {
    expect(STUDIO_HDRI_URL).toMatch(/^\/assets\/environments\/[\w.-]+\.hdr$/)
    expect(existsSync(file)).toBe(true)
  })

  it('is the Radiance file that scripts/third-party/assets.mjs credits to Poly Haven', () => {
    const bytes = readFileSync(file)
    // not a Git LFS pointer, an HTML error page saved by mistake, or a truncated copy
    expect(bytes.subarray(0, 10).toString('latin1')).toBe('#?RADIANCE')
    expect(bytes.subarray(0, 200).toString('latin1')).toContain('FORMAT=32-bit_rle_rgbe')
    expect(statSync(file).size).toBe(1_680_234)
    // pmndrs/drei-assets@456060a2, hdri/studio_small_03_1k.hdr (git blob 3565559d): the bytes the credit names. A
    // different file needs a different credit, so changing this means changing assets.mjs and NOTICE.md too.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '29267a4aa8c10de26cae758e4e3c4daadde88673798666ad657724bab7224a35'
    )
  })
})

describe('the scene uses it', () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
  /** What the compiler sees: a note in a comment about the old preset is not a use of it. */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it.each([
    ['Scene3D', '../Scene3D.tsx'],
    ['the render harness', '../../../../../../apps/web/src/harness/AvatarHarness.tsx']
  ])('%s lights the studio through StudioEnvironment, not a bare drei preset', (_name, path) => {
    const source = read(path)
    expect(source).toMatch(/<StudioEnvironment\b/)
    expect(source).not.toMatch(/<Environment\b[^>]*preset=/)
  })

  it('StudioEnvironment loads the packed file, and nothing in its code names a CDN', () => {
    const code = withoutComments(read('./StudioEnvironment.tsx'))
    expect(code).toMatch(/<Environment\s+files=\{STUDIO_HDRI_URL\}/)
    expect(code).not.toMatch(/preset\s*=/)
    expect(code).not.toMatch(/githack|https?:\/\//)
  })

  // A bare <Environment preset> anywhere sends drei to its CDN again, and with nothing around it a failed fetch
  // blanks the page, which is the whole incident. Tests and stories may name one.
  it('no component outside the studio asks drei for a CDN-hosted preset', () => {
    const roots = ['packages/core/src', 'apps/web/src', 'apps/vision-pro/src'].map((p) => path.join(repoRoot, p))
    const offenders: string[] = []
    for (const root of roots) {
      if (!existsSync(root)) continue
      for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
        if (!/\.tsx$/.test(entry) || /\.(test|stories)\./.test(entry)) continue
        const source = withoutComments(readFileSync(path.join(root, entry), 'utf8'))
        if (/<Environment\b[^>]*\bpreset=/.test(source)) offenders.push(path.relative(repoRoot, path.join(root, entry)))
      }
    }
    expect(offenders).toEqual([])
  })
})
