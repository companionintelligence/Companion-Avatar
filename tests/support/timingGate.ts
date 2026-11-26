import os from 'node:os'
import type { Page } from '@playwright/test'

/**
 * Whether a timing measurement (a frame rate, a blink cadence) can mean anything on this run.
 *
 * Two runs on 2026-11-25 showed what it measures otherwise. On beta-red, headless Chromium had no
 * GPU and drew with SwiftShader at about 7 fps, so the frame-rate and blink tests timed out though
 * the avatar rendered. On a Mac at a load average of 60 to 194, the frame-rate test read 19 to 21
 * fps where an idle machine gives 60. Neither says anything about the app, so such a run skips
 * these tests and says why, instead of failing them.
 *
 *   E2E_MAX_LOAD_PER_CPU   the busiest host, as a 1-minute load average per CPU, that still counts
 *                          (default 1.5). Windows reports no load average, so it never skips there.
 */
export const DEFAULT_MAX_LOAD_PER_CPU = 1.5

/** The WebGL renderer the page would draw with, or '' when it gets no WebGL context. */
export async function webglRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return ''
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  })
}

/** SwiftShader, llvmpipe and the other CPU rasterisers. */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render driver/i.test(renderer)
}

/** The 1-minute load average per CPU. */
export function hostLoadPerCpu(): number {
  return os.loadavg()[0] / Math.max(1, os.cpus().length)
}

function maxLoadPerCpu(env: Record<string, string | undefined> = process.env): number {
  const limit = Number(env.E2E_MAX_LOAD_PER_CPU)
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_MAX_LOAD_PER_CPU
}

/** Why a timing test cannot measure on this run, or null when it can. */
export async function timingSkipReason(page: Page): Promise<string | null> {
  const renderer = await webglRenderer(page)
  if (!renderer) return 'the page gets no WebGL context, so there is no frame rate to measure'
  if (isSoftwareRenderer(renderer)) return `software rendering (${renderer}): no GPU, so a frame rate means nothing`
  const load = hostLoadPerCpu()
  const limit = maxLoadPerCpu()
  if (load > limit) {
    return `the host is busy: load ${load.toFixed(1)} per CPU, above ${limit} (E2E_MAX_LOAD_PER_CPU)`
  }
  return null
}
