import { test, type Page } from '@playwright/test'
import {
  DEFAULT_SPEECH_MODE,
  requestedSpeechFromEnv,
  speechParamsFor,
  type SpeechMode
} from '../../apps/web/src/harness/speechMode'

/**
 * The one place the render suites build a harness URL, so the speech source for a whole
 * run is chosen in one place instead of in every spec.
 *
 *   HARNESS_TTS=synthetic|browser   engine
 *   HARNESS_TTS_VOLUME=0..1         level
 *
 * Neither set: the URL is exactly what the specs used to build and the page runs its default
 * (synthetic, level 0). playwright.config.harness.ts sets the defaults for its own runs;
 * the capture config does not, so the suites it shares with the harness config behave as before.
 *
 * An unknown value throws while the spec file loads — a misspelt engine would otherwise
 * produce a green or red run for a source nobody chose.
 */
const requested = requestedSpeechFromEnv(process.env)

export interface HarnessUrlOptions {
  avatar: string
  shot?: 'body' | 'upper' | 'face'
  bg?: 'dark' | 'transparent'
}

export function harnessUrl({ avatar, shot = 'body', bg = 'dark' }: HarnessUrlOptions): string {
  const speech = speechParamsFor(requested)
  return `/harness.html?avatar=${encodeURIComponent(avatar)}&shot=${shot}&bg=${bg}${speech ? `&${speech}` : ''}`
}

/** What this run asked the page to speak with, defaults filled in. */
export function expectedSpeechMode(): SpeechMode {
  return { ...DEFAULT_SPEECH_MODE, ...requested }
}

type SpeechModeWindow = { __harness?: { speechMode?: () => SpeechMode & { silencedOutput: boolean } } }

/**
 * Call once the harness is ready. Fails when the page is not speaking with the source this
 * run asked for, and records the source on the test so a report says which one it measured.
 */
export async function assertSpeechMode(page: Page): Promise<void> {
  const actual = await page.evaluate(() => (window as unknown as SpeechModeWindow).__harness?.speechMode?.())
  if (!actual) throw new Error('window.__harness.speechMode() is missing: the page was built without speech modes')

  const wanted = expectedSpeechMode()
  if (actual.engine !== wanted.engine || actual.volume !== wanted.volume) {
    throw new Error(
      `harness speaks with ${actual.engine} at level ${actual.volume}, ` +
        `but this run asked for ${wanted.engine} at level ${wanted.volume}`
    )
  }
  test.info().annotations.push({
    type: 'speech',
    description: `${actual.engine}, level ${actual.volume}${actual.silencedOutput ? ', output cut' : ''}`
  })
}
