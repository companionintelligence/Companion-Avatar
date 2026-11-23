import { describe, expect, it } from 'vitest'

import { buildWordStarts, scheduleCues } from './cueSchedule'
import type { CueEvent } from './inlineCues'

const wave: CueEvent = { offset: 6, kind: 'gesture', name: 'Waving' }
const words = [
  { offset: 0, timeMs: 0 },
  { offset: 6, timeMs: 400 },
  { offset: 10, timeMs: 900 }
]

describe('scheduleCues', () => {
  it('fires a cue at the time of the first word at or after its offset', () => {
    expect(scheduleCues([wave], words)).toEqual([{ timeMs: 400, kind: 'gesture', name: 'Waving' }])
  })

  it('uses the next word when the cue falls between two words', () => {
    const between: CueEvent = { offset: 7, kind: 'emote', name: 'happy' }
    expect(scheduleCues([between], words)).toEqual([{ timeMs: 900, kind: 'emote', name: 'happy' }])
  })

  it('fires a cue past the last word at the last word time', () => {
    const late: CueEvent = { offset: 50, kind: 'gesture', name: 'Waving' }
    expect(scheduleCues([late], words)).toEqual([{ timeMs: 900, kind: 'gesture', name: 'Waving' }])
  })

  it('fires at the start of the breath when there are no word timings', () => {
    const cues: CueEvent[] = [wave, { offset: 30, kind: 'emote', name: 'sad' }]
    expect(scheduleCues(cues, [])).toEqual([
      { timeMs: 0, kind: 'gesture', name: 'Waving' },
      { timeMs: 0, kind: 'emote', name: 'sad' }
    ])
  })

  it('returns the cues sorted by time', () => {
    const cues: CueEvent[] = [
      { offset: 10, kind: 'emote', name: 'happy' },
      { offset: 0, kind: 'gesture', name: 'Waving' }
    ]
    expect(scheduleCues(cues, words)).toEqual([
      { timeMs: 0, kind: 'gesture', name: 'Waving' },
      { timeMs: 900, kind: 'emote', name: 'happy' }
    ])
  })

  it('does not depend on the order the word starts are given in', () => {
    const shuffled = [words[2], words[0], words[1]]
    expect(scheduleCues([wave], shuffled)).toEqual([{ timeMs: 400, kind: 'gesture', name: 'Waving' }])
  })

  it('keeps cues that share a time in the order they were given', () => {
    const cues: CueEvent[] = [
      { offset: 0, kind: 'gesture', name: 'Waving' },
      { offset: 0, kind: 'emote', name: 'happy' }
    ]
    expect(scheduleCues(cues, [])).toEqual([
      { timeMs: 0, kind: 'gesture', name: 'Waving' },
      { timeMs: 0, kind: 'emote', name: 'happy' }
    ])
  })
})

describe('buildWordStarts', () => {
  it('places each word at its offset in the breath, shifted by the breath start', () => {
    expect(
      buildWordStarts('Sure, let me check.', 20, { words: ['Sure', 'let', 'me', 'check'], wtimes: [0, 300, 450, 700] })
    ).toEqual([
      { offset: 20, timeMs: 0 },
      { offset: 26, timeMs: 300 },
      { offset: 30, timeMs: 450 },
      { offset: 33, timeMs: 700 }
    ])
  })

  it('skips a word it cannot find and keeps the rest in order', () => {
    expect(buildWordStarts('Sure, let me check.', 0, { words: ['Sure', 'banana', 'check'], wtimes: [0, 200, 700] })).toEqual([
      { offset: 0, timeMs: 0 },
      { offset: 13, timeMs: 700 }
    ])
  })

  it('matches words without regard to case', () => {
    expect(buildWordStarts('Sure, let me check.', 0, { words: ['SURE'], wtimes: [5] })).toEqual([{ offset: 0, timeMs: 5 }])
  })

  it('skips a word whose time is not a finite number', () => {
    expect(buildWordStarts('Sure, let me', 0, { words: ['Sure', 'let'], wtimes: [Number.NaN, 300] })).toEqual([
      { offset: 6, timeMs: 300 }
    ])
  })

  it('returns no word starts when the timings are missing or empty', () => {
    expect(buildWordStarts('Hi there.', 0, undefined)).toEqual([])
    expect(buildWordStarts('Hi there.', 0, { words: [], wtimes: [] })).toEqual([])
  })
})
