import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentBoundary } from './StudioEnvironment'

// drei's <Environment preset="studio"> fetches its HDRI from a CDN when the scene mounts, and when that fetch
// fails the loader throws. Nothing caught it, so the whole page went blank (avatar.ci.computer, 2026-11-24).
// These hold the boundary to what the scene needs of it: the throw stops there, the rest of the page stays.

const Thrower = (): never => {
  throw new Error('Could not load studio_small_03_1k.hdr: Failed to fetch')
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
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

describe('the scene uses it', () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  it.each([
    ['Scene3D', '../Scene3D.tsx'],
    ['the render harness', '../../../../../../apps/web/src/harness/AvatarHarness.tsx']
  ])('%s lights the studio through StudioEnvironment, not a bare drei preset', (_name, path) => {
    const source = read(path)
    expect(source).toMatch(/<StudioEnvironment\b/)
    expect(source).not.toMatch(/<Environment\b[^>]*preset=/)
  })
})
