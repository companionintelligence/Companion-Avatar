import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import ts from 'typescript'
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

// The studio light was one file the app took from a CDN at run time. The local engines were two more: each
// engine's worker imported its library from one (WebLLM from esm.run, vits-web from cdn.jsdelivr.net). Vite now
// bundles every module the apps run, and the apps serve them themselves. These hold the shipped source to that:
// no code in it names a package CDN, so none of it can import from one, and both engines start from workers that
// are bundled with the app. What a library fetches from inside its own code (models, and vits-web's .wasm files,
// see tts/vits.worker.ts) is not in this source; scripts/smoke-live.mjs watches a deployed page for that.
describe('no shipped code comes from a CDN', () => {
  /** The hosts that serve npm and GitHub files as code a page can import, by the names all their hostnames share. */
  const CDN = /jsdelivr|unpkg|esm\.sh|esm\.run|githack|cdnjs|skypack/i

  /** What a module says in its code rather than its comments: its strings, template parts and JSX text, where a URL would be. */
  const codeText = (file: string, text: string): string[] => {
    const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    const found: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) found.push(node.text)
      ts.forEachChild(node, visit)
    }
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind))
    return found
  }
  /** A page or a stylesheet, without its comments. */
  const markupText = (file: string, text: string): string[] => [
    file.endsWith('.css') ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text.replace(/<!--[\s\S]*?-->/g, '')
  ]
  const namesACdn = (file: string, text: string) =>
    // most files name no CDN even in a comment, and need no parsing to say so
    !CDN.test(text) ? [] : (/\.(html|css)$/.test(file) ? markupText(file, text) : codeText(file, text)).filter((said) => CDN.test(said))

  /**
   * The source of everything the apps hand a browser: the packages, and each app's code, pages and public files.
   * Tests, stories and type declarations are not shipped, and public/assets/ holds the media pack-assets copies there.
   */
  const SHIPPED = [
    'packages/core/src',
    'packages/engine/src',
    'packages/agent/src',
    'apps/web/src',
    'apps/web/public',
    'apps/web/index.html',
    'apps/web/harness.html',
    'apps/vision-pro/src',
    'apps/vision-pro/public',
    'apps/vision-pro/index.html',
    'apps/vanilla-client/src',
    'apps/vanilla-client/index.html'
  ]
  const walk = (relative: string): string[] => {
    if (/(?:^|\/)node_modules$|^apps\/[^/]+\/public\/assets$/.test(relative)) return []
    const full = path.join(repoRoot, relative)
    if (statSync(full).isFile()) return [relative]
    return readdirSync(full).flatMap((name) => walk(`${relative}/${name}`))
  }
  const shippedFiles = () =>
    SHIPPED.flatMap((entry) => {
      if (!existsSync(path.join(repoRoot, entry))) throw new Error(`${entry} is not there: a moved app needs this list to follow it`)
      return walk(entry)
    }).filter((file) => /\.(?:[cm]?[jt]sx?|html|css)$/.test(file) && !/\.(?:test|spec|stories)\.|\.d\.ts$/.test(file))

  // It reads a few hundred files, which a full parallel run can slow past the default 5 s.
  it('names no package CDN anywhere in the code the apps ship', { timeout: 30_000 }, () => {
    const files = shippedFiles()
    const offenders = files.flatMap((file) =>
      namesACdn(file, readFileSync(path.join(repoRoot, file), 'utf8')).map((said) => `${file}: ${said.trim().slice(0, 140)}`)
    )
    // a list that found nothing to read would pass for the wrong reason
    expect(files.length).toBeGreaterThan(150)
    expect(files).toContain('packages/core/src/services/llm/llmService.ts')
    expect(files).toContain('apps/web/index.html')
    expect(offenders).toEqual([])
  })

  it('finds a CDN where code would load from it, and not in a comment', () => {
    // The two worker sources as they were, a script tag, and a dynamic import:
    expect(namesACdn('w.ts', "const s = `\nimport * as webllm from 'https://esm.run/@mlc-ai/web-llm';\n`")).toHaveLength(1)
    expect(namesACdn('w.ts', "import * as tts from 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm'")).toHaveLength(1)
    expect(namesACdn('w.tsx', 'export const A = () => <script src="https://unpkg.com/three@0.182.0" />')).toHaveLength(1)
    expect(namesACdn('w.js', 'await import(`https://esm.sh/${name}`)')).toHaveLength(1)
    expect(namesACdn('i.html', '<script type="module" src="https://cdn.skypack.dev/three"></script>')).toHaveLength(1)
    expect(namesACdn('s.css', "@import url('https://cdnjs.cloudflare.com/ajax/libs/x.css');")).toHaveLength(1)
    // ...and what is only history:
    expect(namesACdn('w.ts', '// it came from https://esm.run/@mlc-ai/web-llm\n/* and from raw.githack.com */\nconst accept = "image/*"')).toEqual([])
    expect(namesACdn('i.html', '<!-- once from unpkg.com --><script type="module" src="/src/main.tsx"></script>')).toEqual([])
  })

  const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8')
  const coreDependencies = JSON.parse(read('packages/core/package.json')).dependencies as Record<string, string>

  it.each([
    ['the on-device model (WebLLM)', 'packages/core/src/services/llm/llmService.ts', 'webllm.worker.ts', '@mlc-ai/web-llm'],
    ['local text-to-speech (vits-web)', 'packages/core/src/services/tts/ttsService.ts', 'vits.worker.ts', '@diffusionstudio/vits-web']
  ])('%s runs in a worker that is bundled with the app', (_name, service, worker, library) => {
    const code = read(service)
    // a module worker Vite finds and bundles: new Worker(new URL(<literal>, import.meta.url)), nothing built from a string
    expect(code).toContain(`new Worker(new URL('./${worker}', import.meta.url), { type: 'module' })`)
    expect(code).not.toMatch(/new Blob\(/)
    // the worker imports the library by its package name, so it runs the version pnpm-lock.yaml pins
    const workerCode = read(path.join(path.dirname(service), worker))
    expect(workerCode).toMatch(new RegExp(`from '${library.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`))
    expect(coreDependencies).toHaveProperty([library])
  })
})
