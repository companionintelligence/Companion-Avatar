import { expect, type Page } from '@playwright/test'

/**
 * Shared driver for the L4 vertical scenario specs (docs/TESTING-PIPELINE.md).
 *
 * Every scenario drives the REAL app (`/`) in offline `directed-responses` mode:
 * the app defaults to llm_provider:'script' when no /config.json and no
 * VITE_LLM_PROVIDER are present (see resolveLLMConfig + defaultLLMConfig), so replies
 * come from apps/web/public/assets/directed-responses.json (fetched at runtime via
 * DIRECTED_RESPONSES_URL) — deterministic, no LLM.
 *
 * We force script mode defensively via window.__APP_CONFIG__ (honored synchronously by
 * loadRuntimeConfig before first render) and clear any persisted LLM override, so the
 * suite is hermetic regardless of the developer's local settings.
 */

export const DIRECTED_SCRIPT_INIT = `
  try { localStorage.removeItem('ci_avatar_llm_overrides') } catch {}
  // Skip the mic onboarding modal so the chat input is immediately interactive.
  try { localStorage.setItem('ci_avatar_onboarded', 'true') } catch {}
  window.__APP_CONFIG__ = { llm: { llm_provider: 'script' } };
`

/** Selector reused from tests/agent.spec.ts — the app's single chat textarea. */
export const CHAT_INPUT = 'textarea.chat-input, input[type="text"], textarea'

export interface BootedApp {
  errors: string[]
}

/** Boot the real app in script mode and wait for the avatar canvas to come up. */
export async function bootApp(page: Page): Promise<BootedApp> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))

  await page.addInitScript(DIRECTED_SCRIPT_INIT)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // App shell + 3D canvas present (same readiness gate as tests/agent.spec.ts).
  await page.waitForSelector('.app-container, div[class*="min-h-screen"]', { timeout: 45_000 })
  await page.waitForSelector('canvas', { timeout: 45_000 })

  // Give the avatar its greet→idle startup a beat to begin animating.
  await page.waitForTimeout(2500)
  return { errors }
}

/** One trigger group of directed-responses.json (see llmDirected.ts). */
export interface DirectedTriggerGroup {
  triggers: string[]
  responses: { id: string; response: string }[]
}

/**
 * Serve `groups` ahead of the stock directed-responses catalog for this page. The
 * directed adapter looks for an exact trigger match in every group before it tries
 * partial matches, and takes the first group that matches, so a message equal to one
 * of these triggers gets one of these replies. Call it before bootApp(): the app
 * fetches the catalog once and caches it.
 */
export async function serveDirectedReplies(page: Page, groups: DirectedTriggerGroup[]): Promise<void> {
  await page.route('**/assets/directed-responses.json', async (route) => {
    const catalog = (await (await route.fetch()).json()) as { triggers: unknown[] }
    // Fulfill with `json` alone, not the fetched response, so the stock catalog's
    // Content-Length header does not go out with the longer body.
    await route.fulfill({ json: { ...catalog, triggers: [...groups, ...catalog.triggers] } })
  })
}

/** Number of assistant reply bubbles currently rendered in the chat log. */
export async function assistantBubbleCount(page: Page): Promise<number> {
  // ChatBubble labels the assistant turn with the literal text "Assistant".
  return page.getByText('Assistant', { exact: true }).count()
}

/**
 * Send a user turn via the chat input.
 *
 * We fill + press Enter (the ChatInput submits on Enter-without-shift) rather than
 * clicking the round send button: the XR "Exit XR" control in ControlOverlay overlaps
 * the input's bounding box and intercepts pointer events, so a real .click() on the
 * input/button is flaky. `fill()` targets the element directly and needs no clear
 * pointer path, and Enter avoids the overlaid button entirely.
 */
export async function sendTurn(page: Page, message: string): Promise<void> {
  const input = page.locator(CHAT_INPUT).first()
  await input.fill(message)
  await input.press('Enter')
}

/**
 * Marker the app keeps at the end of an assistant reply while it is still streaming:
 * useConversationService appends '...' to every fragment except the final one.
 */
const STREAMING_MARKER = '...'

/** How long a finished reply must hold still before it counts as settled. */
const SETTLE_MS = 500

/** Time left before `deadline`. Never 0, which expect.poll reads as "no timeout". */
function remaining(deadline: number): number {
  return Math.max(deadline - Date.now(), 1)
}

/** Assistant reply bodies, oldest first: each follows its bubble's "Assistant" label. */
function assistantReplies(page: Page) {
  return page.getByText('Assistant', { exact: true }).locator('xpath=following-sibling::div[1]')
}

/** Text of the newest assistant reply, without the bubble's "Assistant" label. */
export async function latestAssistantReply(page: Page): Promise<string> {
  return ((await assistantReplies(page).last().textContent()) ?? '').trim()
}

/** Text of every assistant reply, oldest first, one reply per line. */
export async function assistantTranscript(page: Page): Promise<string> {
  return (await assistantReplies(page).allTextContents()).map((text) => text.trim()).join('\n')
}

/**
 * Send a turn and wait for a NEW assistant bubble to appear, but not for the reply to
 * finish streaming. Only a barge-in wants that (see bargeIn()); every other turn
 * should go through sendAndAwaitReply().
 */
export async function sendAndAwaitReplyStart(page: Page, message: string, timeout = 30_000): Promise<void> {
  const before = await assistantBubbleCount(page)
  await sendTurn(page, message)

  await expect
    .poll(async () => assistantBubbleCount(page), {
      timeout,
      intervals: [100],
      message: `no new assistant reply appeared after sending "${message}"`
    })
    .toBeGreaterThan(before)
}

/**
 * Wait for the newest assistant reply to settle: it has stopped streaming and its text
 * has held still for SETTLE_MS. Returns that text.
 */
export async function awaitSettledReply(page: Page, timeout = 30_000): Promise<string> {
  let text = ''
  let changedAt = Date.now()

  await expect
    .poll(
      async () => {
        const latest = await latestAssistantReply(page)
        if (latest !== text) {
          text = latest
          changedAt = Date.now()
        }
        const streaming = latest.endsWith(STREAMING_MARKER)
        return { text: latest, streaming, settled: !streaming && Date.now() - changedAt >= SETTLE_MS }
      },
      { timeout, intervals: [100], message: 'the newest assistant reply did not settle' }
    )
    .toMatchObject({ settled: true })

  return text
}

/**
 * Send a turn and wait for a NEW assistant bubble to appear. Returns the assistant
 * reply text once it settles. Throws (fails the test) if no reply appears, or if it
 * has not settled within `timeout` of sending.
 *
 * Waiting for the reply to settle matters: a turn sent while a reply still streams
 * interrupts it, and the app then streams the next reply into the interrupted bubble
 * instead of a new one, so that turn would never get a bubble of its own.
 */
export async function sendAndAwaitReply(page: Page, message: string, timeout = 30_000): Promise<string> {
  const deadline = Date.now() + timeout
  await sendAndAwaitReplyStart(page, message, timeout)
  return awaitSettledReply(page, remaining(deadline))
}

/**
 * Barge in on the reply that is streaming now: send `message` before that reply
 * finishes, then wait for the chat to settle. Call it right after
 * sendAndAwaitReplyStart(). If the reply has already finished, `message` would be an
 * ordinary turn, so that fails the test instead of passing as a barge-in. Returns
 * assistantTranscript() once the chat has settled.
 *
 * Assert on the transcript, not on the bubble count. The interrupted reply never gets
 * its final fragment, so its bubble keeps STREAMING_MARKER, and useConversationService
 * streams the answer to the barge-in into that bubble rather than a new one.
 */
export async function bargeIn(page: Page, message: string, timeout = 30_000): Promise<string> {
  const deadline = Date.now() + timeout
  const interrupted = await latestAssistantReply(page)
  expect(
    interrupted.endsWith(STREAMING_MARKER),
    `the reply finished streaming before "${message}" was sent, so it would not be a barge-in`
  ).toBe(true)

  await sendTurn(page, message)
  await awaitSettledReply(page, remaining(deadline))
  return assistantTranscript(page)
}

/**
 * Best-effort embodiment probe: is the rig MOVING while the avatar replies? We
 * screenshot the canvas repeatedly and report whether any two frames differ.
 *
 * IMPORTANT — this is observational, not a hard gate, and the L4 specs do NOT fail on
 * it. The real app's <Canvas> runs `frameloop="demand"` (Scene3D.tsx) and does not set
 * `preserveDrawingBuffer`, so Playwright's canvas.screenshot() frequently reads an
 * identical/stale framebuffer even while the scene is genuinely animating (verified:
 * idle shows 0/10 frame-pair diffs, a reply ~1/12, though PNG byte-sizes DO shift —
 * i.e. pixels change but screenshots rarely align with a rendered frame). The app also
 * exposes no viseme/emote/animation service state on `window`. The surface built to
 * observe rig motion deterministically is the L3/L5 capture harness
 * (window.__harness + preserveDrawingBuffer), not the real app. See the skipped
 * "embodiment" tests in each vertical spec for the strict assertion + TODO.
 */
export async function canvasFramesDiffer(page: Page, samples = 8, gapMs = 160): Promise<boolean> {
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()

  let prev = await canvas.screenshot()
  for (let i = 0; i < samples; i++) {
    await page.waitForTimeout(gapMs)
    const next = await canvas.screenshot()
    if (Buffer.compare(prev, next) !== 0) return true
    prev = next
  }
  return false
}
