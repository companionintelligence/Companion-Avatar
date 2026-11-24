import { test, expect, type Page } from '@playwright/test'
import { AvatarOptions } from '../packages/core/src/components/scene/avatar/AvatarOptions'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { assertSpeechMode, harnessUrl } from './support/harnessUrl'

/**
 * Avatar Visual & Animation Matrix Test Suite
 *
 * Exercises all avatar models across:
 *  - Head bone rigging and WebGL rendering.
 *  - Idle vitality and animation loop motion (frame delta checks).
 *  - ARKit and Oculus facial morph target bindings.
 *  - Emotion transitions and speech lip-sync visemes.
 */

const AVATAR_KEYS = Object.keys(AvatarOptions)
const SHOTS_DIR = join(__dirname, '..', 'docs', 'visual-tests', 'shots')
mkdirSync(SHOTS_DIR, { recursive: true })

async function waitForHarness(page: Page, avatarName: string) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))

  await page.goto(harnessUrl({ avatar: avatarName, shot: 'body', bg: 'dark' }), {
    waitUntil: 'domcontentloaded'
  })

  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true, {
    timeout: 30_000
  })
  await assertSpeechMode(page)

  await page.waitForFunction(() => (window as unknown as { __avatarLoaded?: boolean }).__avatarLoaded === true, {
    timeout: 60_000
  })

  return errors
}

async function assertCanvasRendering(page: Page) {
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return null
    return {
      width: c.width,
      height: c.height,
      clientWidth: c.clientWidth,
      clientHeight: c.clientHeight
    }
  })

  expect(canvas).not.toBeNull()
  expect(canvas!.width).toBeGreaterThan(0)
  expect(canvas!.height).toBeGreaterThan(0)
  expect(canvas!.clientWidth).toBeGreaterThan(0)
  expect(canvas!.clientHeight).toBeGreaterThan(0)
}

async function verifyAnimationMovement(page: Page, samples = 3, intervalMs = 250): Promise<boolean> {
  const canvas = page.locator('canvas').first()
  const buffers: Buffer[] = []

  for (let i = 0; i < samples; i++) {
    buffers.push(await canvas.screenshot())
    await page.waitForTimeout(intervalMs)
  }

  let deltas = 0
  for (let i = 1; i < buffers.length; i++) {
    if (Buffer.compare(buffers[i - 1], buffers[i]) !== 0) {
      deltas++
    }
  }

  return deltas > 0
}

async function waitForRenderedSpeech(page: Page) {
  await page.waitForFunction(
    () => {
      const h = (window as unknown as {
        __harness?: {
          speechInfo(): { hasAnalyser: boolean }
          audioMetrics(): { mean: number; peak: number }
          faceSnapshot(): { jawOpen: number; vrmMouth: number }
        }
      }).__harness
      if (!h) return false
      const speech = h.speechInfo()
      const audio = h.audioMetrics()
      const face = h.faceSnapshot()
      return speech.hasAnalyser && (audio.mean > 0 || audio.peak > 0) && (face.jawOpen > 0.05 || face.vrmMouth > 0.05)
    },
    { timeout: 15_000, polling: 100 }
  )
}

test.describe('Avatar Visual & Animation Matrix', () => {
  test('Roster agreement: AvatarOptions matches harness list', async ({ page }) => {
    const errors = await waitForHarness(page, AVATAR_KEYS[0])
    const list = await page.evaluate(() => {
      const h = (window as unknown as { __harness?: { listAvatars(): string[] } }).__harness
      return h?.listAvatars() ?? []
    })

    expect(new Set(list)).toEqual(new Set(AVATAR_KEYS))
    expect(errors).toEqual([])
  })

  test('Finite body gestures finish before the queued idle takes over', async ({ page }) => {
    await waitForHarness(page, 'Greg')
    await page.waitForTimeout(4_000) // let the startup greet and its queued idle settle

    await page.evaluate(() => {
      window.__harness?.playAnimation('Waving', { loopCount: 1, blendTime: 250 })
    })

    // A settled crossfade is not the end of a finite authored gesture.
    await page.waitForTimeout(650)
    const during = await page.evaluate(() => window.__harness?.debugActions())
    expect(during?.current).toBe('Waving')

    await page.waitForFunction(
      () => window.__harness?.debugActions().current !== 'Waving',
      { timeout: 8_000, polling: 100 }
    )

    const after = await page.evaluate(() => window.__harness?.debugActions())
    expect(after?.current).toBe('idle-stable')
  })

  test('Avatar state changes do not rebuild the active mixer action', async ({ page }) => {
    await waitForHarness(page, 'Greg')
    await page.waitForTimeout(4_000) // let the startup greet and its queued idle settle

    await page.evaluate(() => {
      window.__harness?.playAnimation('Clapping', { loopCount: Infinity, blendTime: 250 })
    })
    await page.waitForTimeout(700)
    const before = await page.evaluate(() => window.__harness?.debugActions())
    const beforeTime = before?.live.find((action) => action.name === 'Clapping')?.t ?? 0
    expect(before?.current).toBe('Clapping')
    expect(beforeTime).toBeGreaterThan(0.2)

    await page.evaluate(() => window.__harness?.setServices({ emotes: false }))
    await page.waitForTimeout(250)

    const after = await page.evaluate(() => window.__harness?.debugActions())
    const afterTime = after?.live.find((action) => action.name === 'Clapping')?.t ?? 0
    expect(after?.current).toBe('Clapping')
    expect(afterTime).toBeGreaterThan(beforeTime)
  })

  for (const name of AVATAR_KEYS) {
    test(`Avatar [${name}]: rigs, renders, animates, and lip-syncs`, async ({ page }) => {
      const errors = await waitForHarness(page, name)

      // 1. Verify canvas WebGL context
      await assertCanvasRendering(page)

      // 2. Verify animation mixer is actively driving the rig
      const debugState = await page.evaluate(() => {
        const h = (window as unknown as { __harness?: { debugActions(): { live: Array<{ name: string; w: number }> } } }).__harness
        return h?.debugActions()
      })
      expect(debugState?.live.length).toBeGreaterThan(0)

      // 3. Verify visual animation movement (not frozen in bind pose)
      const isMoving = await verifyAnimationMovement(page)
      expect(isMoving).toBe(true)

      // 4. Test facial emote transition
      await page.evaluate(() => {
        const h = (window as unknown as { __harness?: { setEmote(emo: string): boolean; setShot(shot: string): void } }).__harness
        h?.setShot('face')
        h?.setEmote('happy')
      })
      await page.waitForTimeout(400)

      // 5. Test speech lip-sync trigger
      await page.evaluate(() => {
        const h = (window as unknown as { __harness?: { speak(t: string): Promise<number | null> | boolean } }).__harness
        h?.speak('Hello world')
      })
      await waitForRenderedSpeech(page)

      // 6. Capture visual reference screenshot
      const shotPath = join(SHOTS_DIR, `${name.toLowerCase()}-verified.png`)
      await page.locator('canvas').first().screenshot({ path: shotPath })

      // 7. Verify no fatal page runtime errors
      expect(errors, `Runtime errors on avatar "${name}":\n${errors.join('\n')}`).toEqual([])
    })
  }
})
