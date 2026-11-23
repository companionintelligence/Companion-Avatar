import { VISEME_KEY_PREFIX, VisemeSchedule, scheduleFromWordTimings } from '@ci-avatar/engine'

import { lipsyncPreProcessText, lipsyncWordsToVisemes } from '../visemes/lipsync/lipsyncQueue'
import type { SpeechTimings } from '../tts/ttsService'
import type { VisemeState } from '../visemes/visemeTypes'
import type { VisemeWeights } from '../visemes/visemeTable'
import { ARKIT_LIP_SYNC_TARGETS } from '../visemes/visemeTable'

/**
 * Which engine gets the mouth this frame.
 *
 * There are two lip-sync producers in the tree and they used to BOTH write the rig
 * every frame, in sequence — the single largest reason the avatar's mouth looked
 * wrong. They are not equivalent, so the fix is not to blend them; it is to state
 * the preference and feed exactly one:
 *
 *  - `sequence` — the legacy word-timed path (LipsyncEn over whisper-style word
 *    timings). When it has a live entry it knows the actual phonetic shape, which
 *    beats anything inferred from the spectrum.
 *  - `acoustic` — FFT energy blended with a per-character timing estimate. The
 *    fallback, and today the only source in browser-TTS mode.
 *  - `none` — silence. The compositor's release ramp closes the mouth.
 *
 * Once real phoneme timestamps arrive from the TTS engine (HeadTTS/Kokoro), the
 * `sequence` branch becomes the normal path and `acoustic` degrades to amplitude
 * only. This function is the seam where that happens.
 */
export type SpeechSourceKind = 'scheduled' | 'sequence' | 'acoustic' | 'none'

/**
 * Holds a coarticulated viseme schedule built from the TTS engine's own timings.
 *
 * Rebuilt only when the timings' `revision` moves, which matters because browser
 * boundary events arrive mid-utterance: the schedule grows word by word as the
 * engine reports them, rather than being computed once from a guess.
 */
export class ScheduledSpeechSource {
  private readonly schedule = new VisemeSchedule()
  private revision = -1

  /** Returns true when a usable schedule is loaded. */
  update(timings: SpeechTimings | null | undefined): boolean {
    if (!timings) {
      if (this.revision !== -1) {
        this.schedule.clear()
        this.revision = -1
      }
      return false
    }
    if (timings.revision === this.revision) return this.schedule.length > 0

    this.revision = timings.revision

    // Tier A: the engine reported exact viseme shapes with timings. Use them.
    if (timings.visemes?.length && timings.vtimes?.length && timings.vdurations?.length) {
      this.schedule.setFromArrays(timings.visemes, timings.vtimes, timings.vdurations)
      return this.schedule.length > 0
    }

    // Tier B/C: real WORD timings only. The letter-to-sound rules supply the
    // shapes; the engine's measured spans supply the clock.
    if (timings.words.length > 0) {
      const built = scheduleFromWordTimings(
        timings.words,
        timings.wtimes,
        timings.wdurations,
        (word) => {
          const parsed = lipsyncWordsToVisemes(lipsyncPreProcessText(word))
          return parsed && parsed.visemes.length > 0
            ? { visemes: parsed.visemes, times: parsed.times, durations: parsed.durations }
            : null
        }
      )
      this.schedule.setFromArrays(built.visemes, built.times, built.durations)
      return this.schedule.length > 0
    }

    this.schedule.clear()
    return false
  }

  /** Canonical `viseme:` contributions at `playbackSeconds` into the utterance. */
  weightsAt(playbackSeconds: number): Record<string, number> {
    return this.schedule.weightsAt(playbackSeconds)
  }

  get length(): number {
    return this.schedule.length
  }
}

/** Legacy VRM 5-expression target names → the Oculus viseme id they represent. */
const VRM_TARGET_TO_VISEME: Readonly<Record<string, string>> = {
  aa: 'aa',
  ee: 'E',
  ih: 'I',
  oh: 'O',
  ou: 'U'
}

/**
 * Is the word-timed sequence actually driving the mouth right now?
 *
 * Mirrors `visemesUpdate`'s own active-window filter rather than merely checking
 * that a sequence exists — a queued-but-not-yet-started utterance must not take
 * the mouth away from the acoustic path and freeze it shut. The window runs from
 * the attack start ts[0] to the release end ts[2]; ts[1] is only the peak.
 */
export function isSequenceActive(state: VisemeState, now: number = performance.now()): boolean {
  const sequence = state.sequence
  if (!sequence || sequence.length === 0) return false
  for (const item of sequence) {
    if (item.ts[0] <= now && item.ts[2] >= now) return true
  }
  return false
}

/**
 * Convert the legacy service's current targets into canonical `viseme:` keys.
 *
 * Publishing the viseme IDENTITY rather than a set of ARKit muscle weights keeps
 * the shape lossless for heads that carry `viseme_*` morphs, and lets the rig
 * adapter fold it down for those that do not — instead of the render loop
 * hand-rolling a different approximation for each rig type, as it did before.
 */
export function sequenceContributions(state: VisemeState): Record<string, number> {
  const targets = state.targets as unknown as Record<string, number> | undefined
  if (!targets) return {}

  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(targets)) {
    if (typeof value !== 'number' || value <= 0) continue
    if (state.isVRMMode) {
      const id = VRM_TARGET_TO_VISEME[key]
      if (id) out[`${VISEME_KEY_PREFIX}${id}`] = value
    } else if (key.startsWith('viseme_')) {
      out[`${VISEME_KEY_PREFIX}${key.slice('viseme_'.length)}`] = value
    }
  }
  return out
}

/** Convert blended acoustic/phonetic weights into canonical ARKit contributions. */
export function acousticContributions(weights: VisemeWeights): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of ARKIT_LIP_SYNC_TARGETS) {
    const value = weights[key]
    if (typeof value === 'number' && value > 0) out[key] = value
  }
  return out
}

export interface SpeechSourceInput {
  /** Schedule built from the engine's own timings — the preferred source. */
  scheduled?: { source: ScheduledSpeechSource; playbackSeconds: number; loaded: boolean }
  visemeState?: VisemeState
  /** Blended FFT + phonetic weights, or null when there is no audio at all. */
  acoustic: VisemeWeights | null
  /** True while audio is actually playing — gates the exclusive mouth claim. */
  isSpeaking: boolean
  now?: number
}

export interface SpeechSourceResult {
  kind: SpeechSourceKind
  contributions: Record<string, number>
  /**
   * Whether speech should take the mouth exclusively this frame. Only true while
   * something is genuinely driving it: a silent avatar must hand the lips back so
   * an emotion can smile with them.
   */
  claimsMouth: boolean
}

export function selectSpeechSource(input: SpeechSourceInput): SpeechSourceResult {
  const { scheduled, visemeState, acoustic, isSpeaking, now } = input

  // Tier A/B/C: real timings from the engine that made the sound. Preferred over
  // anything inferred, and the only source that can place a bilabial closure.
  if (scheduled?.loaded && isSpeaking) {
    const contributions = scheduled.source.weightsAt(scheduled.playbackSeconds)
    if (Object.keys(contributions).length > 0) {
      return { kind: 'scheduled', contributions, claimsMouth: true }
    }
  }

  if (visemeState && isSequenceActive(visemeState, now)) {
    const contributions = sequenceContributions(visemeState)
    if (Object.keys(contributions).length > 0) {
      return { kind: 'sequence', contributions, claimsMouth: true }
    }
  }

  if (acoustic && isSpeaking) {
    const contributions = acousticContributions(acoustic)
    if (Object.keys(contributions).length > 0) {
      return { kind: 'acoustic', contributions, claimsMouth: true }
    }
  }

  return { kind: 'none', contributions: {}, claimsMouth: false }
}
