import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { defaultVisemeConfig, type VisemeConfig } from './config/visemeConfig'
import {
  convertToVRMTarget,
  initializeVisemeState,
  resetVisemeState,
  setupVisemeStateForMorphTargets,
  setupVisemeStateForVRM,
  visemesToRig,
  visemesSequence,
  visemesUpdate
} from './visemesService'
import { createEmptyVisemeTarget, createEmptyVRMVisemeTarget } from './visemeTypes'
import type { VisemeSequenceItem, WhisperData } from './visemeTypes'

// Silence the service's informational console noise so a failing assertion is easy to spot.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const whisper = (over: Partial<WhisperData> = {}): WhisperData => ({
  words: ['hello'],
  wtimes: [0],
  wdurations: [500],
  ...over
})

describe('convertToVRMTarget', () => {
  it('maps the 14 GLB visemes down to the 5 VRM mouth shapes', () => {
    const glb = createEmptyVisemeTarget()
    glb.viseme_PP = 0.5 // bilabial → ou
    glb.viseme_aa = 0.9 // → aa
    glb.viseme_kk = 0.4 // velar → ih
    glb.viseme_E = 0.7 // → ee

    const vrm = convertToVRMTarget(glb)

    expect(vrm).toEqual({ aa: 0.9, ee: 0.7, ih: 0.4, oh: 0, ou: 0.5 })
  })

  it('takes the max when several GLB visemes collapse onto one VRM viseme', () => {
    const glb = createEmptyVisemeTarget()
    // E, I, FF, CH, SS all map to ee — the largest should win.
    glb.viseme_E = 0.2
    glb.viseme_I = 0.9
    glb.viseme_FF = 0.4

    expect(convertToVRMTarget(glb).ee).toBe(0.9)
  })

  it('leaves the target empty when no GLB viseme is active', () => {
    expect(convertToVRMTarget(createEmptyVisemeTarget())).toEqual(createEmptyVRMVisemeTarget())
  })

  it('ignores zero/negative viseme values (only value > 0 is mapped)', () => {
    const glb = createEmptyVisemeTarget()
    glb.viseme_O = 0 // → oh, but 0 must not register
    expect(convertToVRMTarget(glb).oh).toBe(0)
  })
})

describe('visemesSequence', () => {
  it('produces one sequence item per generated viseme, well-ordered in time', () => {
    const seq = visemesSequence({} as never, whisper())

    // "hello" → 4 visemes (I, E, nn, O).
    expect(seq).toHaveLength(4)

    for (const item of seq) {
      // ts is a 3-tuple [start, peak, end] and must be monotonically non-decreasing.
      expect(item.ts).toHaveLength(3)
      expect(item.ts[0]).toBeLessThanOrEqual(item.ts[1])
      expect(item.ts[1]).toBeLessThanOrEqual(item.ts[2])
      // Every item carries at least one viseme value.
      expect(Object.keys(item.vs).length).toBeGreaterThan(0)
    }
  })

  it('offsets every timestamp by the configured fudge factor', () => {
    const base = visemesSequence({} as never, whisper())
    const shifted = visemesSequence({} as never, whisper(), {
      timing: { fudgeFactor: 1_000_000, attackTime: 0, releaseTime: 0, minDuration: 0 },
      intensity: { baseMultiplier: 1, minThreshold: 0, dampeningFactor: 0.95 },
      curves: { attackCurve: 'linear', releaseCurve: 'linear' },
      lipsync: { baseLevel: 0.8, levelRange: 0.6, specialVisemes: { PP: 0.9, FF: 0.9 } }
    })
    // The huge fudge factor pushes the shifted sequence far into the future.
    expect(shifted[0].ts[0]).toBeGreaterThan(base[0].ts[0] + 900_000)
  })

  it('returns an empty array for null whisper data without throwing', () => {
    expect(() => visemesSequence({} as never, null)).not.toThrow()
    expect(visemesSequence({} as never, null)).toEqual([])
  })

  it('returns an empty array when required whisper fields are missing', () => {
    expect(visemesSequence({} as never, { words: ['hi'] } as WhisperData)).toEqual([])
    expect(visemesSequence({} as never, { wtimes: [0], wdurations: [1] } as WhisperData)).toEqual([])
  })

  it('returns an empty array for an empty words array', () => {
    expect(visemesSequence({} as never, whisper({ words: [], wtimes: [], wdurations: [] }))).toEqual([])
  })

  it('skips unpronounceable words without throwing', () => {
    // "!!!" preprocesses to nothing → no visemes, but the call must stay safe.
    expect(() => visemesSequence({} as never, whisper({ words: ['!!!'] }))).not.toThrow()
  })
})

describe('initializeVisemeState', () => {
  it('starts in GLB (14-viseme) mode by default', () => {
    const s = initializeVisemeState()
    expect(s.isVRMMode).toBe(false)
    expect(s.targets).toEqual(createEmptyVisemeTarget())
    expect(s.sequence).toEqual([])
    expect(s.dirty).toEqual({})
  })

  it('starts in VRM (5-viseme) mode when requested', () => {
    const s = initializeVisemeState(true)
    expect(s.isVRMMode).toBe(true)
    expect(s.targets).toEqual(createEmptyVRMVisemeTarget())
  })
})

describe('setupVisemeStateForMorphTargets', () => {
  it('wires morph targets + dictionary and forces GLB mode', () => {
    const s = initializeVisemeState(true) // start in VRM mode…
    const morphs = [{ morphTargetInfluences: [0, 0, 0] }]
    const dictionary = { viseme_aa: [0, 1] }

    setupVisemeStateForMorphTargets(s, morphs, dictionary)

    expect(s.morphs).toBe(morphs)
    expect(s.dictionary).toBe(dictionary)
    expect(s.isVRMMode).toBe(false) // …forced back to GLB.
  })
})

describe('resetVisemeState (barge-in)', () => {
  const item = (): VisemeSequenceItem =>
    ({ ts: [0, 1, 2], vs: { viseme_aa: [null, 0.8, 0.8] }, template: { name: 'x' } }) as VisemeSequenceItem

  it('zeroes the GLB morph influences the mouth was frozen at, not just the sequence', () => {
    const state = initializeVisemeState(false)
    const morphs = [{ morphTargetInfluences: [0, 0, 0, 0] }]
    const dictionary = { viseme_aa: [0, 1], viseme_O: [2, 3] }
    setupVisemeStateForMorphTargets(state, morphs, dictionary)

    // Simulate being mid-sentence: mouth is open and a sequence is still queued.
    morphs[0].morphTargetInfluences[0] = 0.8
    morphs[0].morphTargetInfluences[1] = 0.6
    morphs[0].morphTargetInfluences[2] = 0.5
    state.sequence = [item()]

    resetVisemeState(state)

    // Mouth actually closes (all mapped morphs zeroed) and nothing is left scheduled.
    expect(morphs[0].morphTargetInfluences).toEqual([0, 0, 0, 0])
    expect(state.sequence).toEqual([])
    // Bindings survive so the next utterance still animates the same avatar.
    expect(state.morphs).toBe(morphs)
    expect(state.dictionary).toBe(dictionary)
    expect(state.isVRMMode).toBe(false)
  })

  it('zeroes VRM mouth expressions and keeps the vrm binding', () => {
    const setValue = vi.fn()
    const state = initializeVisemeState(true)
    // Minimal VRM stand-in exposing the expressionManager surface reset() uses.
    state.vrm = { expressionManager: { setValue } } as never
    state.sequence = [item()]

    resetVisemeState(state)

    expect(state.sequence).toEqual([])
    for (const key of ['aa', 'ee', 'ih', 'oh', 'ou']) {
      expect(setValue).toHaveBeenCalledWith(key, 0)
    }
    // The vrm binding is preserved (a full state swap used to drop it).
    expect(state.vrm).toBeTruthy()
    expect(state.isVRMMode).toBe(true)
  })
})

describe('avatar switch VRM → GLB (regression: viseme state leak)', () => {
  // A VRM exposing the 5 mouth expressions → setupVisemeStateForVRM enters VRM mode.
  const makeVrm = () =>
    ({
      expressionManager: {
        expressionMap: { aa: {}, ee: {}, ih: {}, oh: {}, ou: {} },
        setValue: vi.fn()
      }
    }) as never

  it('setupVisemeStateForMorphTargets clears the stale VRM and resets GLB targets', () => {
    const s = initializeVisemeState()
    setupVisemeStateForVRM(s, makeVrm())
    expect(s.vrm).toBeDefined()
    expect(s.isVRMMode).toBe(true)

    setupVisemeStateForMorphTargets(s, [{ morphTargetInfluences: [0, 0] }], { viseme_aa: [1] })

    expect(s.vrm).toBeUndefined() // the leak fix — no stale VRM binding
    expect(s.isVRMMode).toBe(false)
    expect(s.targets).toEqual(createEmptyVisemeTarget()) // reset to 14-viseme GLB shape
  })

  it('visemesToRig drives the new GLB morphs, not the disposed VRM, after the switch', () => {
    const s = initializeVisemeState()
    const vrm = makeVrm()
    setupVisemeStateForVRM(s, vrm)

    const morphs = [{ morphTargetInfluences: [0, 0, 0] }]
    setupVisemeStateForMorphTargets(s, morphs, { viseme_aa: [1] })
    ;(s.targets as Record<string, number>).viseme_aa = 0.8

    visemesToRig(s, 0)

    expect(morphs[0].morphTargetInfluences[1]).toBeCloseTo(0.8) // GLB morph written
    expect((vrm as { expressionManager: { setValue: ReturnType<typeof vi.fn> } }).expressionManager.setValue).not.toHaveBeenCalled() // old VRM untouched
  })
})

// Ramps are off unless a test sets them. Only the timing under test is overridden.
const configWith = (timing: Partial<VisemeConfig['timing']>): VisemeConfig => ({
  ...defaultVisemeConfig,
  timing: { ...defaultVisemeConfig.timing, attackTime: 0, releaseTime: 0, ...timing },
  intensity: { ...defaultVisemeConfig.intensity, baseMultiplier: 1, minThreshold: 0 },
  curves: { attackCurve: 'linear', releaseCurve: 'linear' }
})

// GLB and VRM targets have different key types, so the new tests read them by name through one cast.
const targetsByKey = (state: { targets: unknown }): Record<string, number> => state.targets as Record<string, number>

describe('visemesUpdate active window and release (M8)', () => {
  // One GLB viseme_aa item with window [start, peak, end], sampled at `now` ms.
  const sampleAa = (ts: [number, number, number], now: number, config: VisemeConfig): number => {
    const state = initializeVisemeState(false)
    state.sequence = [{ template: { name: 'x' }, ts, vs: { viseme_aa: [null, 1, 1] } }]
    vi.spyOn(performance, 'now').mockReturnValue(now)
    visemesUpdate(state, 1 / 60, config)
    return targetsByKey(state).viseme_aa
  }

  it('keeps a viseme open past its peak until the release end ts[2]', () => {
    const config = configWith({ attackTime: 120, releaseTime: 150 })

    // ts[1] = 25 is the peak. The mouth must still be open at 60 ms and fading by 100 ms.
    const at60 = sampleAa([0, 25, 110], 60, config)
    const at100 = sampleAa([0, 25, 110], 100, config)
    expect(at60).toBeGreaterThan(0)
    expect(at60).toBeGreaterThan(at100)
  })

  it('fades the release from full to zero as ts[2] approaches', () => {
    const config = configWith({ releaseTime: 150 })

    expect(sampleAa([0, 25, 300], 150, config)).toBeCloseTo(1) // release has not started yet
    expect(sampleAa([0, 25, 300], 225, config)).toBeCloseTo(0.5) // 75 of 150 ms left
    expect(sampleAa([0, 25, 300], 290, config)).toBeCloseTo(10 / 150)
  })

  it('reaches full value at the midpoint of an 85 ms viseme at the defaults, and is back to 0 at ts[2]', () => {
    // At the defaults the 120 ms attack and 150 ms release cannot both fit in 85 ms. Left unscaled,
    // the two ramps overlap and the peak falls far short of the viseme value.
    const full = defaultVisemeConfig.intensity.baseMultiplier
    expect(sampleAa([0, 40, 85], 42.5, defaultVisemeConfig)).toBeGreaterThanOrEqual(0.95 * full)
    expect(sampleAa([0, 40, 85], 85, defaultVisemeConfig)).toBeCloseTo(0)
  })

  it('scales the ramps of a 200 ms viseme so its midpoint reaches full value', () => {
    const full = defaultVisemeConfig.intensity.baseMultiplier
    expect(sampleAa([0, 100, 200], 100, defaultVisemeConfig)).toBeCloseTo(full)
  })

  it('keeps the configured ramps for a window longer than attack plus release', () => {
    // Characterization: the current behaviour, pinned. 280 ms is just over attack + release (270 ms),
    // so the full 150 ms release still applies.
    const boost = defaultVisemeConfig.intensity.baseMultiplier
    expect(sampleAa([0, 140, 280], 60, defaultVisemeConfig)).toBeCloseTo(boost * Math.pow(60 / 120, 2)) // attack
    expect(sampleAa([0, 140, 280], 200, defaultVisemeConfig)).toBeCloseTo(boost * Math.pow(80 / 150, 2)) // release
    // A much longer window follows the same rule.
    expect(sampleAa([0, 500, 1000], 950, defaultVisemeConfig)).toBeCloseTo(boost * Math.pow(50 / 150, 2))
  })
})

describe('visemesUpdate dampening per second (L5)', () => {
  // Release a fully open viseme_aa over `frames` steps of `delta` seconds, with nothing scheduled.
  const releaseAfter = (frames: number, delta: number): number => {
    const state = initializeVisemeState(false)
    ;targetsByKey(state).viseme_aa = 1
    for (let frame = 0; frame < frames; frame++) visemesUpdate(state, delta)
    return targetsByKey(state).viseme_aa
  }

  it('releases the same amount over one second at 60 Hz and at 120 Hz', () => {
    expect(releaseAfter(60, 1 / 60)).toBeCloseTo(Math.pow(0.95, 60), 3)
    expect(releaseAfter(120, 1 / 120)).toBeCloseTo(releaseAfter(60, 1 / 60), 3)
  })
})

describe('visemesUpdate GLB key collisions', () => {
  it('keeps the strongest of two overlapping items on one GLB key instead of dropping to the newer one', () => {
    const state = initializeVisemeState(false)
    state.sequence = [
      // Still at its peak at 200 ms.
      { template: { name: 'a' }, ts: [0, 25, 300], vs: { viseme_aa: [null, 0.9, 0.9] } },
      // Its attack starts at 200 ms, so its own value is still 0 there.
      { template: { name: 'b' }, ts: [200, 225, 400], vs: { viseme_aa: [null, 0.5, 0.5] } }
    ]
    vi.spyOn(performance, 'now').mockReturnValue(200)

    visemesUpdate(state, 1 / 60, configWith({ attackTime: 100 }))

    expect(targetsByKey(state).viseme_aa).toBeCloseTo(0.9)
  })
})

describe('visemesUpdate VRM key collisions (L2)', () => {
  it('keeps the strongest of several visemes that land on one VRM key in a frame', () => {
    const state = initializeVisemeState(true)
    state.sequence = [
      { template: { name: 'a' }, ts: [0, 100, 200], vs: { viseme_PP: [null, 0.9, 0.9] } }, // PP maps to ou
      { template: { name: 'b' }, ts: [0, 100, 200], vs: { viseme_U: [null, 0.2, 0.2] } } // U also maps to ou, written last
    ]
    vi.spyOn(performance, 'now').mockReturnValue(60)

    visemesUpdate(state, 1 / 60, configWith({}))

    expect(targetsByKey(state).ou).toBe(0.9)
  })
})

describe('setupVisemeStateForVRM target shape (L3)', () => {
  const fiveMouthVrm = () =>
    ({ expressionManager: { expressionMap: { aa: {}, ee: {}, ih: {}, oh: {}, ou: {} }, setValue: vi.fn() } }) as never
  const oculusVrm = () =>
    ({ expressionManager: { expressionMap: { PP: {}, FF: {}, TH: {} }, setValue: vi.fn() } }) as never

  it('a 14-viseme VRM after a 5-expression VRM gets the 14-viseme target shape', () => {
    const s = initializeVisemeState()
    setupVisemeStateForVRM(s, fiveMouthVrm())
    expect(s.isVRMMode).toBe(true)

    setupVisemeStateForVRM(s, oculusVrm())

    expect(s.isVRMMode).toBe(false)
    expect(s.targets).toEqual(createEmptyVisemeTarget())
  })

  it('falls back to the 14-viseme target shape when the expression map cannot be read', () => {
    const s = initializeVisemeState()
    setupVisemeStateForVRM(s, fiveMouthVrm())
    const unreadable = {
      expressionManager: {
        get expressionMap(): never {
          throw new Error('expression map unavailable')
        },
        setValue: vi.fn()
      }
    } as never

    setupVisemeStateForVRM(s, unreadable)

    expect(s.isVRMMode).toBe(false)
    expect(s.targets).toEqual(createEmptyVisemeTarget())
  })
})

describe('visemesToRig GLB amplify (L4)', () => {
  const glbWithAa = (aa: number) => {
    const state = initializeVisemeState(false)
    const morphs = [{ morphTargetInfluences: [0] }]
    setupVisemeStateForMorphTargets(state, morphs, { viseme_aa: [0] })
    ;targetsByKey(state).viseme_aa = aa
    return { state, morphs }
  }

  it('clamps the amplified morph to 1 and never writes the amplified value back', () => {
    const { state, morphs } = glbWithAa(0.9)

    visemesToRig(state, 0, 1.5)

    expect(targetsByKey(state).viseme_aa).toBe(0.9)
    expect(morphs[0].morphTargetInfluences[0]).toBe(1)
  })

  it('does not compound the amplify from frame to frame', () => {
    const { state, morphs } = glbWithAa(0.3)

    for (let frame = 0; frame < 3; frame++) visemesToRig(state, 1 / 60, 1.5)

    expect(targetsByKey(state).viseme_aa).toBeCloseTo(0.3)
    expect(morphs[0].morphTargetInfluences[0]).toBeCloseTo(0.45)
  })

  it('writes a stored overdrive above 1 unchanged at amplify 1', () => {
    const { state, morphs } = glbWithAa(1.2)

    visemesToRig(state, 0, 1)

    expect(morphs[0].morphTargetInfluences[0]).toBe(1.2)
  })

  it('clamps an amplified value to 0..1 and does not write the clamp back', () => {
    const high = glbWithAa(1.2)
    visemesToRig(high.state, 0, 0.5)
    expect(high.morphs[0].morphTargetInfluences[0]).toBeCloseTo(0.6)
    expect(targetsByKey(high.state).viseme_aa).toBe(1.2)

    const low = glbWithAa(-0.4)
    visemesToRig(low.state, 0, 0.5)
    expect(low.morphs[0].morphTargetInfluences[0]).toBe(0)
    expect(targetsByKey(low.state).viseme_aa).toBe(-0.4)
  })
})
