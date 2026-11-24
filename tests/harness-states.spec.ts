import { test, expect, type Page } from '@playwright/test'
import { AvatarOptions } from '../packages/core/src/components/scene/avatar/AvatarOptions'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Per-state avatar captures for visual review: one canvas PNG per avatar and state,
 * plus docs/visual-tests/states/index.json describing every capture.
 *
 * Run it through the harness config, which builds harness.html and serves it on
 * 127.0.0.1. The config's testMatch includes this file, so it runs with the others:
 *   pnpm exec playwright test -c playwright.config.harness.ts tests/harness-states.spec.ts
 *
 * Each avatar gets one page and runs the states in order. Speech is awaited to its end
 * and each emote is given time to relax, so a capture does not inherit the last state.
 */

interface Capture {
  avatar: string
  state: string
  file: string
  ok: boolean
  note: string
}

type SpeechWindow = { __harness: { speechInfo: () => { stateSpeaking: boolean } } }

const WANTED_AVATARS = ['Greg', 'Erik', 'Aria', 'Work Boy']
const AVATARS = WANTED_AVATARS.filter((name) => name in AvatarOptions)
if (AVATARS.length !== WANTED_AVATARS.length) {
  const missing = WANTED_AVATARS.filter((name) => !(name in AvatarOptions))
  throw new Error(`harness-states: avatars missing from AvatarOptions: ${missing.join(', ')}`)
}
const STATES_DIR = join(__dirname, '..', 'docs', 'visual-tests', 'states')
const SPEECH = 'Hello there, I am ready to help you with that.'
const EMOTE_SETTLE_MS = 4500
const captures: Capture[] = []

mkdirSync(STATES_DIR, { recursive: true })

async function waitForHarness(page: Page, avatarName: string) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))

  await page.goto(`/harness.html?avatar=${encodeURIComponent(avatarName)}&shot=body&bg=dark`, {
    waitUntil: 'domcontentloaded'
  })
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true, undefined, {
    timeout: 30_000
  })
  await page.waitForFunction(() => (window as unknown as { __avatarLoaded?: boolean }).__avatarLoaded === true, undefined, {
    timeout: 60_000
  })
  return errors
}

/** Calls window.__harness[method](...args). A returned promise is not awaited: speak() can settle at utterance end. */
function callHarness(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    ([name, params]: [string, unknown[]]) => {
      const api = (window as unknown as { __harness?: Record<string, (...a: unknown[]) => unknown> }).__harness
      if (!api || typeof api[name] !== 'function') throw new Error(`window.__harness.${name} is missing`)
      const result = api[name](...params)
      return result instanceof Promise ? true : result
    },
    [method, args] as [string, unknown[]]
  )
}

function isSpeaking(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as SpeechWindow).__harness.speechInfo().stateSpeaking === true)
}

async function waitForSpeechEnd(page: Page) {
  await page
    .waitForFunction(() => (window as unknown as SpeechWindow).__harness.speechInfo().stateSpeaking !== true, undefined, {
      timeout: 20_000
    })
    .catch(() => undefined)
}

async function shoot(page: Page, avatar: string, state: string, ok = true, note = '') {
  const file = `${avatar.toLowerCase().replace(/\s+/g, '-')}-${state}.png`
  await page.locator('canvas').first().screenshot({ path: join(STATES_DIR, file) })
  captures.push({ avatar, state, file, ok, note })
}

test.describe('avatar harness states', () => {
  test.afterAll(() => {
    writeFileSync(join(STATES_DIR, 'index.json'), `${JSON.stringify(captures, null, 2)}\n`)
  })

  for (const avatar of AVATARS) {
    test(`${avatar}: every state`, async ({ page }) => {
      test.setTimeout(240_000)
      const errors = await waitForHarness(page, avatar)
      await page.waitForTimeout(3000) // let the start-up greet settle before the idle capture
      await shoot(page, avatar, 'idle')

      // Close-up for speech and expression, so mouth and face changes are readable.
      await callHarness(page, 'setShot', 'face')
      await callHarness(page, 'speak', SPEECH)
      await page.waitForTimeout(1200)
      const speaking = await isSpeaking(page)
      await shoot(page, avatar, 'speaking', speaking, speaking ? '' : 'not speaking at capture time')
      await waitForSpeechEnd(page)

      for (const emotion of ['happy', 'sad', 'alert']) {
        await callHarness(page, 'setEmote', emotion)
        await page.waitForTimeout(1200)
        await shoot(page, avatar, emotion)
        await page.waitForTimeout(EMOTE_SETTLE_MS)
      }

      await callHarness(page, 'setShot', 'body') // gestures read best at body framing
      const clip = await callHarness(page, 'playCategory', 'gesture')
      await page.waitForTimeout(900)
      const played = typeof clip === 'string'
      await shoot(page, avatar, 'gesture', played, played ? String(clip) : 'no gesture clip for this avatar')
      await page.waitForTimeout(3000)

      await callHarness(page, 'setShot', 'face')
      for (const status of ['listening', 'thinking']) {
        await callHarness(page, 'setConversationStatus', status)
        await page.waitForTimeout(800)
        await shoot(page, avatar, status)
      }

      expect(errors).toEqual([])
    })
  }
})
