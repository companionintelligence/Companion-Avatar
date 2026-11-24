/**
 * Deterministic speech-like PCM for render probes.
 *
 * This is not a user-facing TTS engine. It creates a small, voiced waveform so
 * the production AudioContext -> AnalyserNode -> AudioLipSync path can be tested
 * in a browser without downloading a model or contacting a TTS server.
 */

export interface SyntheticSpeechOptions {
  duration?: number
  sampleRate?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

export function syntheticSpeechDuration(text: string): number {
  const normalized = text.trim()
  return clamp(0.7 + normalized.length * 0.052, 0.7, 12)
}

/** `{words, wtimes, wdurations}` as the rest of the speech stack speaks them: times in milliseconds. */
export interface SyntheticWordTimings {
  words: string[]
  /** Milliseconds from the start of the audio, in speaking order. */
  wtimes: number[]
  /** Milliseconds. Back to back: each word ends where the next one starts. */
  wdurations: number[]
}

/** The waveform fades in over its first 1/20 s and out over its last 1/18 s (see the envelope below). */
const FADE_IN_SECONDS = 1 / 20
const FADE_OUT_SECONDS = 1 / 18

/** A word gets time by its length, but never less than this many letters' worth, so "a" and "I" still show a shape. */
const MIN_WORD_LETTERS = 3

/**
 * When each word is "spoken" in the audio `createSyntheticSpeechWav` makes from the same text.
 *
 * The waveform is a hum shaped by an envelope, not words, so there is nothing to measure. What
 * the engine does know is how long it will run, and that is enough to behave like an engine
 * that reports its own word timings (Tier B): the words are laid back to back between the
 * fades, each taking a share of the time in proportion to its length. Deterministic, so a
 * render test sees the same mouth every run on every machine.
 */
export function syntheticWordTimings(text: string, duration: number = syntheticSpeechDuration(text)): SyntheticWordTimings {
  const words = text.split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0 || !(duration > 0)) return { words: [], wtimes: [], wdurations: [] }

  // Speak between the fades. `duration / 4` keeps a very short clip from inverting the span.
  const startMs = Math.min(FADE_IN_SECONDS, duration / 4) * 1000
  const endMs = (duration - Math.min(FADE_OUT_SECONDS, duration / 4)) * 1000
  const letters = words.map((word) => Math.max(MIN_WORD_LETTERS, word.length))
  const totalLetters = letters.reduce((sum, count) => sum + count, 0)

  const wtimes: number[] = []
  const wdurations: number[] = []
  let cursor = startMs
  for (const count of letters) {
    const share = ((endMs - startMs) * count) / totalLetters
    wtimes.push(cursor)
    wdurations.push(share)
    cursor += share
  }
  return { words, wtimes, wdurations }
}

/**
 * Produce a mono 16-bit PCM WAV with deterministic vowel/consonant-like energy
 * changes. The spectrum intentionally spans low, mid, and high bands because
 * AudioLipSync reads those bands to shape jaw, lips, brows, and cheeks.
 */
export function createSyntheticSpeechWav(text: string, options: SyntheticSpeechOptions = {}): ArrayBuffer {
  const sampleRate = options.sampleRate ?? 24000
  const duration = options.duration ?? syntheticSpeechDuration(text)
  const frameCount = Math.max(1, Math.ceil(duration * sampleRate))
  const dataBytes = frameCount * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  const normalized = text.trim() || 'hello'
  const phraseRate = 3.8 + Math.min(2.4, normalized.length / 30)
  const seed = [...normalized].reduce((total, char) => total + char.charCodeAt(0), 0)

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate
    const phrase = 0.55 + 0.45 * Math.sin(time * Math.PI * 2 * phraseRate + seed * 0.013)
    const syllable = 0.68 + 0.32 * Math.sin(time * Math.PI * 2 * 7.2 + seed * 0.007)
    const attack = Math.min(1, time * 20)
    const release = Math.min(1, (duration - time) * 18)
    const envelope = Math.max(0, phrase * syllable * attack * release)
    const fundamental = 145 + (seed % 45) + Math.sin(time * 1.7) * 8
    const voiced =
      Math.sin(time * Math.PI * 2 * fundamental) * 0.42 +
      Math.sin(time * Math.PI * 2 * fundamental * 2.01) * 0.2 +
      Math.sin(time * Math.PI * 2 * fundamental * 3.03) * 0.11
    const formant = Math.sin(time * Math.PI * 2 * 920) * 0.08
    const fricative = Math.sin(time * Math.PI * 2 * 4300) * 0.035 * (0.4 + 0.6 * syllable)
    const sample = clamp((voiced + formant + fricative) * envelope * 0.72, -0.92, 0.92)
    view.setInt16(44 + frame * 2, Math.round(sample * 32767), true)
  }

  return buffer
}
