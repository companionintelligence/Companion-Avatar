import { expect, type Page } from '@playwright/test'

/**
 * The Ollama server and model the default config builds the app against (its webServer env), and
 * the agent suite talks to. E2E_OLLAMA_URL and E2E_OLLAMA_MODEL point both somewhere else.
 */
export const E2E_OLLAMA_URL = (process.env.E2E_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
export const E2E_OLLAMA_MODEL = process.env.E2E_OLLAMA_MODEL ?? 'gemma3:1b'

/**
 * Why the conversation tests cannot run here, or null when the Ollama server answers with the
 * model. Asked from Node before any page loads, so a run without a backend says so in one line
 * instead of seventeen timeouts.
 */
export async function ollamaBackendProblem(): Promise<string | null> {
  try {
    const response = await fetch(`${E2E_OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return `Ollama at ${E2E_OLLAMA_URL} answered ${response.status}`
    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
    const names = (payload.models ?? []).map((m) => m.name ?? m.model ?? '')
    if (!names.some((name) => name === E2E_OLLAMA_MODEL || name === `${E2E_OLLAMA_MODEL}:latest`)) {
      return `Ollama at ${E2E_OLLAMA_URL} does not have ${E2E_OLLAMA_MODEL} (ollama pull ${E2E_OLLAMA_MODEL})`
    }
    return null
  } catch (error) {
    return `no Ollama answered at ${E2E_OLLAMA_URL} (${(error as Error).message})`
  }
}

/** The session label in the chat rail, which says what the last check established. */
export function sessionStatus(page: Page) {
  return page.getByRole('status', { name: /^Session: /, includeHidden: true })
}

/**
 * Pass the app's connection gate the way a person does on first launch: press Check connection in
 * the onboarding card, wait for the session to read Chat-only (or Memory-ready), then Skip the
 * microphone. Until a check has passed, the app answers every message with "I am not connected
 * yet" ("connection truth"), which is why the agent suite failed before it did this.
 */
export async function passConnectionGate(page: Page): Promise<void> {
  await page.getByText('Start your companion').waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Check connection' }).click()
  try {
    await expect(sessionStatus(page)).toHaveAccessibleName(/^Session: (Chat-only|Memory-ready)$/, { timeout: 30_000 })
  } catch {
    const said = await page.getByRole('status').allInnerTexts()
    throw new Error(`Check connection did not pass. The page says: ${said.join(' | ').replace(/\s+/g, ' ')}`)
  }
  await page.getByRole('button', { name: 'Skip' }).click()
  // Skipping the microphone keeps the session the check established.
  await expect(sessionStatus(page)).toHaveAccessibleName(/^Session: (Chat-only|Memory-ready)$/)
}

const ASSISTANT_TEXT = '[data-chat-message="assistant"] [data-chat-text]'

/** How many replies the chat log holds now. */
export async function assistantReplyCount(page: Page): Promise<number> {
  return page.locator(ASSISTANT_TEXT).count()
}

/**
 * The first reply after the `before`th, once it has stopped streaming (its text unchanged for
 * 1.5 s). Empty when none arrives in time.
 */
export async function waitForReply(page: Page, before: number, timeout = 30_000): Promise<string> {
  const replies = page.locator(ASSISTANT_TEXT)
  const deadline = Date.now() + timeout
  try {
    await expect.poll(() => replies.count(), { timeout }).toBeGreaterThan(before)
  } catch {
    return ''
  }
  const reply = replies.nth(before)
  let last = ''
  let unchangedSince = Date.now()
  while (Date.now() < deadline) {
    const text = ((await reply.textContent()) ?? '').trim()
    if (text !== last) {
      last = text
      unchangedSince = Date.now()
    } else if (text && Date.now() - unchangedSince >= 1500) {
      break
    }
    await page.waitForTimeout(250)
  }
  return last
}
