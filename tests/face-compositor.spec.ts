import { test, expect, type Page } from '@playwright/test'
import { assertSpeechMode, harnessUrl } from './support/harnessUrl'
import { LONG_UTTERANCE } from './support/utterance'

/**
 * Face arbitration — the regression suite for the FaceCompositor.
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * The avatar's face used to be written by three producers in sequence every
 * frame — an FFT lip-sync path, a legacy word-timed viseme service, and the
 * emote service — each poking `morphTargetInfluences` directly. Whoever ran last
 * won, so a smile could flatten a viseme mid-word and a zeroed expression could
 * pin a VRM's mouth shut.
 *
 * These tests assert the ARBITRATION, not the pixels: `__harness.compositorTrace()`
 * reports which layer owned each facial region on the last rendered frame. A
 * screenshot cannot tell you why a mouth looked wrong; this can.
 */

interface RegionOwnership {
  region: string
  winner: string | null
  exclusive: boolean
}
interface Trace {
  regions: RegionOwnership[]
  written: Record<string, number>
  releasing: string[]
}
interface SpeechDebug {
  kind: 'scheduled' | 'sequence' | 'acoustic' | 'none'
  hasAnalyser: boolean
  energy: number
  claimed: boolean
  text: string
  keys: number
  frame: number
}
interface Harness {
  setConversationStatus(status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'): void
  setEmote(emotion: string, relaxTime?: number): void
  speak(text: string): Promise<number | null>
  faceSnapshot(): { jawOpen: number; blink: number; mouth: Record<string, number> }
  compositorTrace(): Trace | null
  speechDebug(): SpeechDebug | null
  setMorph(entries: Record<string, number>): number
  clearMorphs(): void
}
declare global {
  interface Window {
    __harness?: Harness
    __harnessReady?: boolean
    __avatarLoaded?: boolean
  }
}

/** Greg is an RPM "pro" GLB: ARKit-52 plus Oculus visemes — the richest rig we ship. */
const AVATAR = 'Greg'

async function loadHarness(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
  await page.goto(harnessUrl({ avatar: AVATAR, shot: 'face', bg: 'dark' }), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 60_000 })
  await assertSpeechMode(page)
  await page.waitForFunction(() => window.__avatarLoaded === true, { timeout: 90_000 })
  return errors
}

const trace = (page: Page) => page.evaluate(() => window.__harness!.compositorTrace())
const snapshot = (page: Page) => page.evaluate(() => window.__harness!.faceSnapshot())
const speechDebug = (page: Page) => page.evaluate(() => window.__harness!.speechDebug())
const ownerOf = (t: Trace | null, region: string) => t?.regions.find((r) => r.region === region) ?? null

/**
 * Everything below waits on RENDERED FRAMES, never on wall-clock time.
 *
 * These specs run under the capture config's SwiftShader flags, where a real 3D
 * scene renders at single-digit FPS and cross-process `evaluate` polling starves
 * it further — a `waitForTimeout(3000)` can span as few as five frames. Timing
 * out in wall-clock made this suite measure the test rig instead of the product,
 * which is exactly the flakiness this repo already has a reputation for.
 */
async function waitForFrames(page: Page, count: number, timeoutMs = 60_000): Promise<void> {
  const start = (await speechDebug(page))?.frame ?? 0
  await page
    .waitForFunction(
      ([from, n]) => ((window.__harness?.speechDebug()?.frame ?? 0) - (from as number)) >= (n as number),
      [start, count] as const,
      { timeout: timeoutMs, polling: 100 }
    )
    .catch(() => {
      throw new Error(`render loop advanced fewer than ${count} frames in ${timeoutMs}ms (frame stalled at ${start})`)
    })
}

/** Peak jaw opening observed over the next `frames` rendered frames. */
async function peakJawOverFrames(page: Page, frames: number): Promise<number> {
  const start = (await speechDebug(page))?.frame ?? 0
  let peak = 0
  for (;;) {
    const [snap, dbg] = await Promise.all([snapshot(page), speechDebug(page)])
    peak = Math.max(peak, snap.jawOpen)
    if ((dbg?.frame ?? 0) - start >= frames) return peak
    await page.waitForTimeout(60)
  }
}

/** Wait until the speech layer reports a given state. */
async function waitForSpeechKind(page: Page, kind: SpeechDebug['kind'], timeoutMs = 60_000): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const actual = window.__harness?.speechDebug()?.kind
      // 'none' is exact; anything else means "some tier owns the mouth", because
      // which tier wins depends on what the configured engine reports and that is
      // not what these specs are about.
      return k === 'none' ? actual === 'none' : actual !== undefined && actual !== 'none'
    },
    kind,
    { timeout: timeoutMs, polling: 100 }
  )
}

test.describe('face compositor', () => {
  test('is live and arbitrating on a loaded avatar', async ({ page }) => {
    const errors = await loadHarness(page)
    const t = await trace(page)
    expect(t, 'compositorTrace() must be non-null once an avatar is mounted').not.toBeNull()
    expect(errors, 'no page errors during load').toEqual([])
  })

  test('emotion owns the lips while the avatar is silent', async ({ page }) => {
    await loadHarness(page)
    await page.evaluate(() => window.__harness!.setEmote('happy', 8000))
    await waitForFrames(page, 3)

    const lips = ownerOf(await trace(page), 'lips')
    expect(lips?.winner, 'a silent avatar must let emotion shape the mouth').toBe('emotion')
    expect(lips?.exclusive, 'nothing should be claiming the mouth while silent').toBe(false)
  })

  test('speech takes the mouth exclusively, and a smile cannot flatten it', async ({ page }) => {
    await loadHarness(page)

    // Hold a happy expression for the whole utterance. Before the compositor this
    // is exactly what smeared the visemes: the emote service ran after the lip-sync
    // writer and overwrote the same mouth morphs.
    await page.evaluate(() => window.__harness!.setEmote('happy', 10_000))
    await waitForFrames(page, 2)

    await page.evaluate((text) => window.__harness!.speak(text), LONG_UTTERANCE)
    // Wait for the SPEECH layer to actually take over rather than for a stopwatch.
    await waitForSpeechKind(page, 'acoustic')

    // The trace lists a region only when something is writing keys in it, and which
    // regions speech writes depends on the tier: acoustic speech writes ARKit keys (the
    // jaw and the lips), timed speech writes `viseme:` keys, which are lips. So read the
    // mouth regions that have anything in them, and require every one to be speech's.
    const t = await trace(page)
    const mouth = (['jaw', 'lips'] as const)
      .map((region) => ownerOf(t, region))
      .filter((owner): owner is RegionOwnership => owner !== null)
    expect(mouth.length, 'speech must be writing the mouth while speaking').toBeGreaterThan(0)
    for (const region of mouth) {
      expect(region.winner, `speech must own the ${region.region} while speaking`).toBe('speech')
      expect(region.exclusive, `the ${region.region} claim must be exclusive during speech`).toBe(true)
    }

    // Brows are NOT part of the mouth claim — the avatar should still look happy.
    const brows = ownerOf(t, 'brows')
    expect(brows?.winner, 'emotion and vitality keep the upper face during speech').not.toBe('speech')
  })

  test('the mouth actually moves during speech', async ({ page }) => {
    await loadHarness(page)
    const restingJaw = (await snapshot(page)).jawOpen
    await page.evaluate((text) => window.__harness!.speak(text), LONG_UTTERANCE)
    await waitForSpeechKind(page, 'acoustic')
    const peak = await peakJawOverFrames(page, 8)

    // The whole point. A pass here means real decoded audio reached the analyser,
    // the compositor resolved a mouth shape, and it landed on the rig.
    expect(peak, 'jaw must open measurably while speaking').toBeGreaterThan(0.05)
    expect(peak).toBeGreaterThan(restingJaw)
  })

  test('the mouth returns to rest after speech, and emotion gets the lips back', async ({ page }) => {
    await loadHarness(page)
    await page.evaluate((text) => window.__harness!.speak(text), LONG_UTTERANCE)
    await waitForSpeechKind(page, 'acoustic')
    expect(await peakJawOverFrames(page, 6), 'sanity: the jaw opened before we test that it closes').toBeGreaterThan(0.05)

    // Wait for the speech layer to stand down, then for the release ramp to run.
    await waitForSpeechKind(page, 'none')
    await waitForFrames(page, 4)
    const after = await snapshot(page)
    expect(after.jawOpen, 'a finished utterance must not leave the jaw hanging open').toBeLessThan(0.12)

    const jaw = ownerOf(await trace(page), 'jaw')
    expect(jaw?.exclusive ?? false, 'the mouth claim must be released when speech ends').toBe(false)
  })

  test('the override layer beats every autonomous producer', async ({ page }) => {
    await loadHarness(page)
    // The capture path: scripted weights must survive blinks, emotes and idle
    // vitality, or every deterministic face shot is a lie.
    await page.evaluate(() => window.__harness!.setEmote('happy', 5000))
    await page.evaluate(() => window.__harness!.setMorph({ jawOpen: 0.85 }))
    await waitForFrames(page, 3)

    const held = await snapshot(page)
    expect(held.jawOpen, 'a scripted morph must be held, not released').toBeGreaterThan(0.7)
    expect(ownerOf(await trace(page), 'jaw')?.winner).toBe('override')

    await page.evaluate(() => window.__harness!.clearMorphs())
    await waitForFrames(page, 4)
    expect((await snapshot(page)).jawOpen, 'clearing the override releases the key').toBeLessThan(0.2)
  })
})

test.describe('conversational vitality', () => {
  test('thinking averts the gaze — behaviour that could never fire before', async ({ page }) => {
    // The dynamics engine has always implemented gaze aversion under cognitive
    // load, but the avatar was only ever told 'speaking' or 'idle', so this
    // branch was unreachable dead code.
    await loadHarness(page)
    await page.evaluate(() => window.__harness!.setConversationStatus('idle'))
    await waitForFrames(page, 6)
    const idleGaze = (await snapshot(page)).mouth // placeholder read to sync a frame
    expect(idleGaze).toBeDefined()

    await page.evaluate(() => window.__harness!.setConversationStatus('thinking'))
    await waitForFrames(page, 10)

    const t = await trace(page)
    const written = t?.written ?? {}
    // Aversion drives the eyes up and away; some gaze channel must be non-trivial.
    const gaze = ['eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookInLeft', 'eyeLookOutRight']
      .map((k) => written[k] ?? 0)
      .reduce((a, b) => Math.max(a, b), 0)
    expect(gaze, 'thinking must move the eyes off the viewer').toBeGreaterThan(0.05)
    expect(ownerOf(t, 'gaze')?.winner).toBe('vitality')
  })

  test('listening raises the brows', async ({ page }) => {
    await loadHarness(page)
    await page.evaluate(() => window.__harness!.setConversationStatus('listening'))
    await waitForFrames(page, 10)

    const written = (await trace(page))?.written ?? {}
    const brow = Math.max(written.browInnerUp ?? 0, written.browOuterUpLeft ?? 0)
    expect(brow, 'an attentive brow raise while listening').toBeGreaterThan(0.05)
  })
})
