import { describe, expect, it } from 'vitest'

import {
  acousticContributions,
  isSequenceActive,
  selectSpeechSource,
  sequenceContributions
} from './speechSource'
import type { VisemeState } from '../visemes/visemeTypes'
import { VISEME_WEIGHTS } from '../visemes/visemeTable'

const NOW = 1_000

const stateWith = (partial: Partial<VisemeState>): VisemeState =>
  ({ sequence: [], targets: undefined, dirty: {}, isVRMMode: false, ...partial }) as VisemeState

const item = (start: number, end: number, peak: number = end) => ({
  template: { name: 'x' },
  ts: [start, peak, end] as [number, number, number],
  vs: {}
})

describe('isSequenceActive', () => {
  it('is false with no sequence', () => {
    expect(isSequenceActive(stateWith({}), NOW)).toBe(false)
  })

  it('is false for a sequence that has not started yet', () => {
    // A queued utterance must not steal the mouth and hold it shut.
    expect(isSequenceActive(stateWith({ sequence: [item(NOW + 500, NOW + 900)] }), NOW)).toBe(false)
  })

  it('is false for a sequence that has already finished', () => {
    expect(isSequenceActive(stateWith({ sequence: [item(NOW - 900, NOW - 500)] }), NOW)).toBe(false)
  })

  it('is true inside the active window', () => {
    expect(isSequenceActive(stateWith({ sequence: [item(NOW - 100, NOW + 100)] }), NOW)).toBe(true)
  })

  it('stays active through the release, up to ts[2]', () => {
    // The peak ts[1] is already behind NOW, but visemesUpdate holds the mouth open until the release ends at NOW + 100.
    const releasing = [item(NOW - 200, NOW + 100, NOW - 100)]
    expect(isSequenceActive(stateWith({ sequence: releasing }), NOW)).toBe(true)
    expect(isSequenceActive(stateWith({ sequence: releasing }), NOW + 150)).toBe(false)
  })
})

describe('sequenceContributions', () => {
  it('publishes Oculus targets as canonical viseme identities', () => {
    const state = stateWith({ targets: { viseme_aa: 0.8, viseme_PP: 0.1, viseme_E: 0 } as never })
    expect(sequenceContributions(state)).toEqual({ 'viseme:aa': 0.8, 'viseme:PP': 0.1 })
  })

  it('translates the VRM 5-expression set to the same identities', () => {
    const state = stateWith({
      isVRMMode: true,
      targets: { aa: 0.5, ee: 0.2, ih: 0, oh: 0, ou: 0 } as never
    })
    expect(sequenceContributions(state)).toEqual({ 'viseme:aa': 0.5, 'viseme:E': 0.2 })
  })

  it('returns nothing when the service has no targets bound', () => {
    expect(sequenceContributions(stateWith({}))).toEqual({})
  })
})

describe('acousticContributions', () => {
  it('keeps only non-zero ARKit mouth weights', () => {
    const contributions = acousticContributions({ ...VISEME_WEIGHTS.AA })
    expect(contributions.jawOpen).toBeGreaterThan(0)
    expect(Object.values(contributions).every((v) => v > 0)).toBe(true)
  })
})

describe('selectSpeechSource', () => {
  const acoustic = { ...VISEME_WEIGHTS.AA }

  it('prefers the word-timed sequence when it is live', () => {
    const result = selectSpeechSource({
      visemeState: stateWith({
        sequence: [item(NOW - 10, NOW + 10)],
        targets: { viseme_aa: 0.9 } as never
      }),
      acoustic,
      isSpeaking: true,
      now: NOW
    })
    expect(result.kind).toBe('sequence')
    expect(result.contributions).toEqual({ 'viseme:aa': 0.9 })
  })

  it('falls back to the acoustic path when no sequence is live', () => {
    const result = selectSpeechSource({
      visemeState: stateWith({ sequence: [] }),
      acoustic,
      isSpeaking: true,
      now: NOW
    })
    expect(result.kind).toBe('acoustic')
    expect(result.contributions.jawOpen).toBeGreaterThan(0)
  })

  it('never lets a live sequence with all-zero targets win the mouth', () => {
    // Otherwise a finished-but-not-yet-cleared sequence pins the lips shut.
    const result = selectSpeechSource({
      visemeState: stateWith({
        sequence: [item(NOW - 10, NOW + 10)],
        targets: { viseme_aa: 0 } as never
      }),
      acoustic,
      isSpeaking: true,
      now: NOW
    })
    expect(result.kind).toBe('acoustic')
  })

  it('claims nothing while silent, so emotion gets the lips back', () => {
    const result = selectSpeechSource({ acoustic, isSpeaking: false, now: NOW })
    expect(result.kind).toBe('none')
    expect(result.claimsMouth).toBe(false)
    expect(result.contributions).toEqual({})
  })

  it('claims nothing when there is no audio at all', () => {
    const result = selectSpeechSource({ acoustic: null, isSpeaking: true, now: NOW })
    expect(result.kind).toBe('none')
  })
})
