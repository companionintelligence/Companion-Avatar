import { test, expect, type Page } from '@playwright/test'
import { assertSpeechMode, harnessUrl } from './support/harnessUrl'
import { LONG_UTTERANCE } from './support/utterance'

/**
 * The Green Orb on the harness page: it loads by name, frames itself, rests without rings, and answers the voice.
 *
 * Like the face suite, this asserts on what the orb did on its last drawn frame (`__harness.orbSnapshot()`), not on
 * pixels, and it waits on drawn frames rather than wall-clock time: under SwiftShader the page draws at single-digit
 * frame rates.
 */

interface OrbSnapshot {
  frame: number
  status: string
  speaking: boolean
  hasAnalyser: boolean
  voice: number
  glow: number
  scale: number
  rings: number
}
interface Harness {
  currentAvatar(): string
  listOrbs(): string[]
  speak(text: string): Promise<number | null>
  setConversationStatus(status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'): void
  orbSnapshot(): OrbSnapshot | null
}
declare global {
  interface Window {
    __harness?: Harness
    __harnessReady?: boolean
    __avatarLoaded?: boolean
  }
}

const ORB = 'Green Orb'

async function loadOrb(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /shader|program|webgl/i.test(msg.text())) errors.push(msg.text())
  })
  await page.goto(harnessUrl({ avatar: ORB, shot: 'face', bg: 'dark' }), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 60_000 })
  await assertSpeechMode(page)
  await page.waitForFunction(() => window.__avatarLoaded === true, { timeout: 60_000 })
  return errors
}

const orb = (page: Page) => page.evaluate(() => window.__harness!.orbSnapshot())

/** Snapshots over the next `frames` drawn frames, one per poll. */
async function watch(page: Page, frames: number, timeoutMs = 90_000): Promise<OrbSnapshot[]> {
  const first = await orb(page)
  if (!first) throw new Error('no orb is mounted')
  const seen: OrbSnapshot[] = [first]
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const now = await orb(page)
    if (!now) throw new Error('the orb unmounted')
    seen.push(now)
    if (now.frame - first.frame >= frames) return seen
    if (Date.now() > deadline) throw new Error(`the orb drew ${now.frame - first.frame} of ${frames} frames`)
    await page.waitForTimeout(50)
  }
}

test.describe('Green Orb', () => {
  test('loads by name, frames itself and draws without errors', async ({ page }) => {
    const errors = await loadOrb(page)
    expect(await page.evaluate(() => window.__harness!.currentAvatar())).toBe('orb:green')
    expect(await page.evaluate(() => window.__harness!.listOrbs())).toContain(ORB)
    const frames = await watch(page, 20)
    expect(frames.at(-1)!.frame).toBeGreaterThan(frames[0].frame)
    expect(errors).toEqual([])
  })

  test('rests without rings, and rings while it speaks', async ({ page }) => {
    await loadOrb(page)
    for (const frame of await watch(page, 15)) {
      expect(frame.rings).toBe(0)
      expect(frame.speaking).toBe(false)
    }

    await page.evaluate(() => window.__harness!.setConversationStatus('speaking'))
    await page.evaluate((text) => void window.__harness!.speak(text), LONG_UTTERANCE)
    const speaking = await watch(page, 40)
    expect(speaking.some((frame) => frame.hasAnalyser)).toBe(true)
    expect(Math.max(...speaking.map((frame) => frame.voice))).toBeGreaterThan(0.2)
    expect(Math.max(...speaking.map((frame) => frame.rings))).toBeGreaterThan(0)
    expect(Math.max(...speaking.map((frame) => frame.scale))).toBeGreaterThan(1.03)
  })

  test('follows the conversation status', async ({ page }) => {
    await loadOrb(page)
    for (const status of ['listening', 'thinking', 'idle'] as const) {
      await page.evaluate((next) => window.__harness!.setConversationStatus(next), status)
      expect((await watch(page, 3)).at(-1)!.status).toBe(status)
    }
  })
})
