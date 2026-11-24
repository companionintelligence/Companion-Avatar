/**
 * Which speech source the avatar harness (harness.html) runs on.
 *
 * Chosen per page by URL parameter, and per Playwright run by environment variable (the
 * test helper in tests/support/harnessUrl.ts turns one into the other), so the render
 * suites can be pointed at a different source without editing any of them:
 *
 *   ?tts=synthetic|browser     engine (default synthetic)
 *   ?ttsVolume=0..1            playback level (default 0)
 *
 *   HARNESS_TTS=synthetic|browser
 *   HARNESS_TTS_VOLUME=0..1
 *
 * The default, synthetic at volume 0, is a silent and repeatable page: right for the
 * capture pipeline, which films the avatar, and useless for a test that waits for the mouth,
 * because the analyser reads silence and the speech layer reports no source at all.
 *
 * This module is plain TypeScript with no DOM or React imports, so the page and the Node
 * side of the test run share one parser and one set of error messages.
 */

export type SpeechEngine = 'synthetic' | 'browser'

export const SPEECH_ENGINES: readonly SpeechEngine[] = ['synthetic', 'browser']

export interface SpeechMode {
  engine: SpeechEngine
  /**
   * Playback level from 0 to 1. For `synthetic` it is the gain between the decoded audio and
   * the analyser; for `browser` it is `utterance.volume`.
   */
  volume: number
}

export const DEFAULT_SPEECH_MODE: SpeechMode = { engine: 'synthetic', volume: 0 }

export function parseSpeechEngine(raw: string | null | undefined, source = '?tts'): SpeechEngine | null {
  const value = raw?.trim()
  if (!value) return null
  if ((SPEECH_ENGINES as readonly string[]).includes(value)) return value as SpeechEngine
  // A typo must stop the run. Falling back to another engine would report results for a
  // source nobody asked for, and the numbers would look fine.
  throw new Error(`harness speech: ${source}=${value} is not an engine; use ${SPEECH_ENGINES.join(' or ')}`)
}

export function parseSpeechVolume(raw: string | null | undefined, source = '?ttsVolume'): number | null {
  const value = raw?.trim()
  if (!value) return null
  const volume = Number(value)
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(`harness speech: ${source}=${value} is not a level; use a number from 0 to 1`)
  }
  return volume
}

/** The mode a harness page runs, from its query string. Anything not given is the default. */
export function speechModeFromParams(params: URLSearchParams): SpeechMode {
  return {
    engine: parseSpeechEngine(params.get('tts')) ?? DEFAULT_SPEECH_MODE.engine,
    volume: parseSpeechVolume(params.get('ttsVolume')) ?? DEFAULT_SPEECH_MODE.volume
  }
}

/** The parts of a mode a test run asked for through the environment, or null when it asked for none. */
export function requestedSpeechFromEnv(env: Record<string, string | undefined>): Partial<SpeechMode> | null {
  const engine = parseSpeechEngine(env.HARNESS_TTS, 'HARNESS_TTS')
  const volume = parseSpeechVolume(env.HARNESS_TTS_VOLUME, 'HARNESS_TTS_VOLUME')
  if (engine === null && volume === null) return null
  return { ...(engine !== null && { engine }), ...(volume !== null && { volume }) }
}

/** Query-string pairs for a requested mode. Empty for no request, so the URL is then the one it always was. */
export function speechParamsFor(requested: Partial<SpeechMode> | null): string {
  if (!requested) return ''
  const pairs: string[] = []
  if (requested.engine !== undefined) pairs.push(`tts=${requested.engine}`)
  if (requested.volume !== undefined) pairs.push(`ttsVolume=${requested.volume}`)
  return pairs.join('&')
}

/**
 * Does the page have to cut the analyser's output for this mode?
 *
 * Synthetic audio above zero level reaches the analyser at full strength, which is the
 * point, and would reach the speakers too if the analyser stayed wired to them. Headless
 * Chromium mutes its output anyway; a headed run on a desk would hum.
 */
export function needsSilencedOutput(mode: SpeechMode): boolean {
  return mode.engine === 'synthetic' && mode.volume > 0
}
