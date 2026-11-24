import { describe, expect, it } from 'vitest'
import { VISEME_TO_ARKIT } from '@ci-avatar/engine'
import {
  ARKIT_LIP_SYNC_TARGETS,
  VISEME_WEIGHTS,
  getVisemeForChar,
  textToVisemeSequence,
  type VisemeId
} from './visemeTable'

describe('visemeTable', () => {
  it('maps standard Latin vowels to correct visemes', () => {
    expect(getVisemeForChar('a')).toBe('AA')
    expect(getVisemeForChar('e')).toBe('EE')
    expect(getVisemeForChar('i')).toBe('IH')
    expect(getVisemeForChar('o')).toBe('OH')
    expect(getVisemeForChar('u')).toBe('OO')
  })

  it('maps consonants to articulatory visemes', () => {
    expect(getVisemeForChar('p')).toBe('PP')
    expect(getVisemeForChar('b')).toBe('PP')
    expect(getVisemeForChar('m')).toBe('PP')
    expect(getVisemeForChar('f')).toBe('FF')
    expect(getVisemeForChar('s')).toBe('SS')
  })

  it('provides all 52 ARKit target weights for each viseme', () => {
    for (const key of ARKIT_LIP_SYNC_TARGETS) {
      expect(VISEME_WEIGHTS.AA[key]).toBeDefined()
      expect(VISEME_WEIGHTS.PP[key]).toBeDefined()
    }
    expect(VISEME_WEIGHTS.AA.jawOpen).toBeGreaterThan(0.4)
    expect(VISEME_WEIGHTS.PP.mouthClose).toBeGreaterThan(0.5)
  })

  it('converts full text strings to viseme sequences', () => {
    const seq = textToVisemeSequence('Hello')
    expect(seq.length).toBe(5)
    expect(seq).toEqual(['ASPIRATE', 'EE', 'DD', 'DD', 'OH'])
  })
})

describe('the engine rig fold agrees with this table', () => {
  // The engine's morph-target rig folds an Oculus `viseme:` key onto ARKit weights for heads
  // that have no `viseme_*` morph. It cannot import this file, so it holds its own copy of the
  // numbers; this is what keeps a head that takes timed speech through the fold looking like
  // one that takes it through the acoustic path.
  const OCULUS_TO_TABLE: Record<string, VisemeId> = {
    sil: 'sil',
    PP: 'PP',
    FF: 'FF',
    TH: 'TH',
    DD: 'DD',
    kk: 'KK',
    CH: 'CH',
    SS: 'SS',
    nn: 'NN',
    RR: 'RR',
    aa: 'AA',
    E: 'EE',
    I: 'IH',
    O: 'OH',
    U: 'OO'
  }

  it('names every Oculus viseme the engine folds', () => {
    expect(Object.keys(OCULUS_TO_TABLE).sort()).toEqual(Object.keys(VISEME_TO_ARKIT).sort())
  })

  it.each(Object.entries(OCULUS_TO_TABLE))('gives %s the weights this table gives %s', (oculus, id) => {
    const expected = Object.fromEntries(Object.entries(VISEME_WEIGHTS[id]).filter(([, weight]) => weight > 0))
    expect(VISEME_TO_ARKIT[oculus as keyof typeof VISEME_TO_ARKIT]).toEqual(expected)
  })
})
