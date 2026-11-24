import { describe, expect, it } from 'vitest'

import {
  BoundaryTimeline,
  DEFAULT_FACE_LAYERS,
  FACE_LAYERS,
  FaceCompositor,
  MOUTH_REGIONS,
  MorphTargetFaceRig,
  type MorphTargetMeshLike
} from '@ci-avatar/engine'

import type { VisemeState } from '../visemes/visemeTypes'
import { ScheduledSpeechSource, selectSpeechSource } from './speechSource'

/**
 * End-to-end proof of the lip-sync tiers, without a browser.
 *
 * Tier C is the one that matters most: it is what the DEFAULT install runs.
 * Before this, `mode: 'browser'` produced no AnalyserNode, so the acoustic path
 * evaluated to "mouth closed" on every frame and the only thing driving the face
 * was a fabricated word timeline (150 WPM plus `Math.random()` pauses). This
 * asserts the replacement actually reaches real mouth shapes.
 */

const timings = (
  words: string[],
  wtimes: number[],
  wdurations: number[],
  extra: Partial<{ visemes: string[]; vtimes: number[]; vdurations: number[] }> = {}
) => ({ words, wtimes, wdurations, revision: 1, ...extra })

describe('Tier A — exact viseme timings from the engine', () => {
  it('uses the reported shapes verbatim, bypassing letter-to-sound rules', () => {
    const source = new ScheduledSpeechSource()
    const loaded = source.update(
      timings(['papa'], [0], [400], {
        visemes: ['PP', 'aa', 'PP', 'aa'],
        vtimes: [0, 100, 200, 300],
        vdurations: [100, 100, 100, 100]
      })
    )
    expect(loaded).toBe(true)
    // Both closures must be present — this is exactly what an FFT cannot recover.
    expect(source.weightsAt(0.05)['viseme:PP']).toBeGreaterThan(0.5)
    expect(source.weightsAt(0.25)['viseme:PP']).toBeGreaterThan(0.5)
    expect(source.weightsAt(0.15)['viseme:aa']).toBeGreaterThan(0.5)
  })
})

describe('Tier B/C — real word timings, rule-derived shapes', () => {
  it('turns word timings into mouth shapes through the letter-to-sound rules', () => {
    const source = new ScheduledSpeechSource()
    expect(source.update(timings(['hello'], [0], [500]))).toBe(true)

    // Something must be shaping the mouth partway through the word.
    const mid = source.weightsAt(0.25)
    expect(Object.keys(mid).length).toBeGreaterThan(0)
    expect(Object.keys(mid).every((k) => k.startsWith('viseme:'))).toBe(true)
  })

  it('places later words at their own measured times, not at a guessed cadence', () => {
    const source = new ScheduledSpeechSource()
    source.update(timings(['hello', 'world'], [0, 2000], [400, 400]))
    // The gap between words is real silence; nothing should be driving the mouth.
    expect(Object.keys(source.weightsAt(1.0))).toEqual([])
    expect(Object.keys(source.weightsAt(2.2)).length).toBeGreaterThan(0)
  })

  it('rebuilds only when the revision moves', () => {
    const source = new ScheduledSpeechSource()
    source.update(timings(['hello'], [0], [400]))
    const before = source.length
    source.update(timings(['hello'], [0], [400]))
    expect(source.length).toBe(before)
  })

  it('grows as boundary events arrive mid-utterance', () => {
    // The browser reports words one at a time WHILE speaking. The schedule has to
    // extend in place; waiting for the whole utterance means never moving at all.
    const timeline = new BoundaryTimeline()
    timeline.reset('hello there friend')
    const source = new ScheduledSpeechSource()
    let revision = 0

    timeline.addBoundary(0, 0)
    source.update({ ...timeline.toWordTimings(), revision: ++revision })
    const afterFirst = source.length

    timeline.addBoundary(6, 400)
    source.update({ ...timeline.toWordTimings(), revision: ++revision })
    expect(source.length).toBeGreaterThan(afterFirst)
  })

  it('clears when the utterance ends', () => {
    const source = new ScheduledSpeechSource()
    source.update(timings(['hello'], [0], [400]))
    expect(source.update(null)).toBe(false)
    expect(source.weightsAt(0.2)).toEqual({})
  })
})

describe('tier selection', () => {
  const loadedSource = () => {
    const source = new ScheduledSpeechSource()
    source.update(timings(['hello'], [0], [500]))
    return source
  }

  it('prefers the scheduled tier over the acoustic one', () => {
    const result = selectSpeechSource({
      scheduled: { source: loadedSource(), playbackSeconds: 0.25, loaded: true },
      acoustic: { jawOpen: 0.5 } as never,
      isSpeaking: true
    })
    expect(result.kind).toBe('scheduled')
    expect(result.claimsMouth).toBe(true)
  })

  it('falls back to acoustic when the schedule has nothing at this instant', () => {
    // Mid-utterance silence between words must not blank the mouth if the audio
    // says otherwise — the schedule is a shape hint, not a gate.
    const result = selectSpeechSource({
      scheduled: { source: loadedSource(), playbackSeconds: 99, loaded: true },
      acoustic: { jawOpen: 0.5 } as never,
      isSpeaking: true
    })
    expect(result.kind).toBe('acoustic')
  })

  it('claims nothing while silent even with a schedule loaded', () => {
    const result = selectSpeechSource({
      scheduled: { source: loadedSource(), playbackSeconds: 0.25, loaded: true },
      acoustic: null,
      isSpeaking: false
    })
    expect(result.kind).toBe('none')
  })
})

describe('timed speech on a head that only has mouthOpen and mouthSmile', () => {
  // Brit, Liam and Liam CES ship these two morphs and no `viseme_*`. The timed tiers publish
  // only `viseme:` keys, which used to reach no morph on such a head: the tier claimed the
  // mouth and the mouth stayed shut.
  const FRAME = 1 / 60

  const oneMorphHead = (): MorphTargetMeshLike => ({
    morphTargetDictionary: { mouthOpen: 0, mouthSmile: 1 },
    morphTargetInfluences: [0, 0]
  })

  /** Run a speech source through the compositor and the rig as the render loop does; returns `mouthOpen` per frame. */
  const play = (frames: number, contributionsAt: (frame: number) => Record<string, number>): number[] => {
    const mesh = oneMorphHead()
    const rig = new MorphTargetFaceRig([mesh])
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)
    const opening: number[] = []
    for (let frame = 0; frame < frames; frame++) {
      const contributions = contributionsAt(frame)
      compositor.begin()
      compositor.setAll(FACE_LAYERS.SPEECH, contributions)
      if (Object.keys(contributions).length > 0) compositor.claim(FACE_LAYERS.SPEECH, MOUTH_REGIONS)
      compositor.applyTo(rig, FRAME)
      opening.push(mesh.morphTargetInfluences![0])
    }
    return opening
  }

  it('moves the mouth for the scheduled tier, and closes it when the words end', () => {
    const source = new ScheduledSpeechSource()
    source.update(timings(['hello', 'there', 'friend'], [0, 600, 1200], [450, 450, 500]))

    const kinds = new Set<string>()
    const opening = play(180, (frame) => {
      const result = selectSpeechSource({
        scheduled: { source, playbackSeconds: frame * FRAME, loaded: true },
        acoustic: null,
        isSpeaking: frame * FRAME < 1.8
      })
      kinds.add(result.kind)
      return result.contributions
    })

    expect(kinds.has('scheduled')).toBe(true)
    expect(Math.max(...opening)).toBeGreaterThan(0.2)
    // It follows the words: it opens and closes more than once, rather than opening and holding.
    const peaks = opening.filter((v, i) => i > 0 && i < opening.length - 1 && v > 0.15 && v >= opening[i - 1] && v > opening[i + 1])
    expect(peaks.length).toBeGreaterThan(2)
    expect(opening[opening.length - 1]).toBe(0)
  })

  it('moves the mouth for the legacy word-timed sequence too', () => {
    const NOW = 1_000
    const state = {
      sequence: [{ template: { name: 'x' }, ts: [NOW - 100, NOW, NOW + 100], vs: {} }],
      targets: { viseme_aa: 0.8, viseme_PP: 0 },
      dirty: {},
      isVRMMode: false
    } as unknown as VisemeState

    const opening = play(6, () => {
      const result = selectSpeechSource({ visemeState: state, acoustic: null, isSpeaking: true, now: NOW })
      expect(result.kind).toBe('sequence')
      return result.contributions
    })

    expect(opening[0]).toBeCloseTo(0.8 * 0.6)
    expect(opening[opening.length - 1]).toBeCloseTo(0.8 * 0.6)
  })
})
