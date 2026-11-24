/**
 * Speech head motion: a soft nod at each phrase end and a slow sway while the avatar talks.
 *
 * Pure and stateless. The caller supplies the speech window and any phrase ends, and gets a
 * pitch and yaw offset in radians to add to the head. Both are zero outside speech.
 */

export interface SpeechNodOffsetInput {
  /** Current time in milliseconds, on the same clock as the speech times. */
  tMs: number
  /** When speech started, or null when the avatar is not speaking. */
  speakingSinceMs: number | null
  /** When speech ended. Leave it null or omit it while speaking; the head eases out from here. */
  speakingUntilMs?: number | null
  /** Phrase-end times in milliseconds, on the same clock. Each one gets a nod. */
  phraseEndsMs?: readonly number[]
  /** Head motion amplitude in degrees. The nod peaks at this value. Defaults to 2. */
  amplitudeDeg?: number
}

export interface SpeechNodOffset {
  /** Radians. Positive tips the head down, the same sign as the listening lean on the Head x channel. */
  pitchRad: number
  /** Radians. The side-to-side sway, on the Head y channel. */
  yawRad: number
}

const DEFAULT_AMPLITUDE_DEG = 2
const NOD_DURATION_MS = 350
export const SPEECH_RAMP_MS = 250
const SWAY_PERIOD_MS = 5000
const SWAY_GAIN = 0.3
const DEG_TO_RAD = Math.PI / 180

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

// Eases 0 to 1 over the unit interval with a half cosine, so the ramp starts and ends flat.
const easeInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x))

// One nod: 0 at the phrase end, 1 half-way through, and 0 again once the dip is over.
const nodDip = (elapsedMs: number) => {
  if (elapsedMs < 0 || elapsedMs >= NOD_DURATION_MS) return 0
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * elapsedMs) / NOD_DURATION_MS)
}

export function speechNodOffset({
  tMs,
  speakingSinceMs,
  speakingUntilMs = null,
  phraseEndsMs = [],
  amplitudeDeg = DEFAULT_AMPLITUDE_DEG
}: SpeechNodOffsetInput): SpeechNodOffset {
  if (speakingSinceMs === null || tMs < speakingSinceMs) return { pitchRad: 0, yawRad: 0 }

  // Ease in from speech start and out from speech end. Once the ease-out has finished there is no offset.
  let envelope = easeInOut((tMs - speakingSinceMs) / SPEECH_RAMP_MS)
  if (speakingUntilMs !== null && tMs > speakingUntilMs) {
    const sinceEnd = (tMs - speakingUntilMs) / SPEECH_RAMP_MS
    if (sinceEnd >= 1) return { pitchRad: 0, yawRad: 0 }
    envelope = Math.min(envelope, 1 - easeInOut(sinceEnd))
  }

  // Phrase ends from before this speech belong to an earlier utterance. Overlapping nods take the
  // deeper of the two rather than their sum, so the nod never exceeds the amplitude.
  let dip = 0
  for (const endMs of phraseEndsMs) {
    if (endMs < speakingSinceMs) continue
    dip = Math.max(dip, nodDip(tMs - endMs))
  }

  const amplitudeRad = Math.max(0, amplitudeDeg) * DEG_TO_RAD
  const swayPhase = (2 * Math.PI * (tMs - speakingSinceMs)) / SWAY_PERIOD_MS
  return {
    pitchRad: envelope * dip * amplitudeRad,
    yawRad: envelope * SWAY_GAIN * amplitudeRad * Math.sin(swayPhase)
  }
}
