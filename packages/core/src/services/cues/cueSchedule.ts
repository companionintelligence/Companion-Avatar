import type { CueEvent, CueKind } from './inlineCues'

/** Where a word starts: its offset into the reply, and its time from the start of its utterance. */
export interface WordStart {
  offset: number
  timeMs: number
}

export interface ScheduledCue {
  /** Milliseconds from the start of the utterance. */
  timeMs: number
  kind: CueKind
  name: string
}

/**
 * Times each cue against the words. A cue fires at the first word whose offset is at or after the
 * cue's offset. A cue past the last word fires at the last word's time. With no word timings, every
 * cue fires at 0, the start of its breath.
 */
export const scheduleCues = (cues: readonly CueEvent[], wordStarts: readonly WordStart[]): ScheduledCue[] => {
  const words = [...wordStarts].sort((a, b) => a.offset - b.offset)
  return cues
    .map((cue): ScheduledCue => {
      if (words.length === 0) return { timeMs: 0, kind: cue.kind, name: cue.name }
      const next = words.find((word) => word.offset >= cue.offset) ?? words[words.length - 1]
      return { timeMs: next.timeMs, kind: cue.kind, name: cue.name }
    })
    .sort((a, b) => a.timeMs - b.timeMs)
}

export interface WordTimings {
  words?: readonly string[]
  wtimes?: readonly number[]
}

/**
 * Places TTS word timings in the reply. `text` is the speakable breath that was spoken, and
 * `baseOffset` is where that breath starts in the reply. Words are found in order and without regard
 * to case. A word that cannot be found is skipped rather than guessed at, and so is a word without a
 * finite time.
 */
export const buildWordStarts = (
  text: string,
  baseOffset: number,
  timings: WordTimings | undefined
): WordStart[] => {
  const words = timings?.words ?? []
  const times = timings?.wtimes ?? []
  const haystack = text.toLowerCase()
  const starts: WordStart[] = []
  let cursor = 0
  const count = Math.min(words.length, times.length)
  for (let i = 0; i < count; i++) {
    const word = words[i].trim().toLowerCase()
    const timeMs = times[i]
    if (!word || !Number.isFinite(timeMs)) continue
    const at = haystack.indexOf(word, cursor)
    if (at < 0) continue
    starts.push({ offset: baseOffset + at, timeMs: Math.max(0, timeMs) })
    cursor = at + word.length
  }
  return starts
}
