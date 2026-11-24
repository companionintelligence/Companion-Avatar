import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Bone, Euler, Object3D, Quaternion, Vector3 } from 'three'

import { defaultEmoteConfig } from './configs/emoteConfig'
import { moodConfigurations } from './configs/moodConfigurations'
import {
  applyEmotion,
  applyEmoteStateToMorphTargets,
  emoteUpdate,
  handleBargeIn,
  initializeEmoteState,
  resetEmoteState,
  setupEmoteStateForMorphTargets,
  setupEmoteStateForVRM,
  startPerformance
} from './emoteService'
import type { EmotionType, EmoteState } from './emoteTypes'
import { updateFacialTicks } from './modules/facialTicksService'
import { updateGaze } from './modules/gazeService'

const ALL_EMOTIONS: EmotionType[] = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'fear',
  'disgust',
  'love',
  'sleep',
  'alert'
]

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('initializeEmoteState', () => {
  it('starts neutral, not performing, with sub-states initialized', () => {
    const s = initializeEmoteState()
    expect(s.currentEmotion).toBe('neutral')
    expect(s.isPerforming).toBe(false)
    expect(s.performanceStartTime).toBe(0)
    expect(s.blinkState.isBlinking).toBe(false)
    expect(s.blinkState.nextBlinkTime).toBeGreaterThan(0)
    expect(s.tickState.currentTick).toBeNull()
  })
})

describe('applyEmotion — baseline target math', () => {
  it('writes the mood baseline onto state.targets', () => {
    const s = initializeEmoteState()
    const res = applyEmotion(s, 'happy')

    expect(res.success).toBe(true)
    // happy baseline: mouthSmile 0.6, eyesLookDown 0.1.
    expect(s.targets.mouthSmile).toBe(0.6)
    expect(s.targets.eyesLookDown).toBe(0.1)
    expect(s.currentEmotion).toBe('happy')
  })

  it('applies the angry baseline including hand-fist targets', () => {
    const s = initializeEmoteState()
    applyEmotion(s, 'angry')
    expect(s.targets.browDownLeft).toBe(0.6)
    expect(s.targets.handFistLeft).toBe(1)
    expect(s.currentEmotion).toBe('angry')
  })

  it('clears sparse baseline keys when the emotion changes', () => {
    const s = initializeEmoteState()
    applyEmotion(s, 'angry')
    applyEmotion(s, 'happy')

    expect(s.targets.browDownLeft).toBe(0)
    expect(s.targets.mouthFrownLeft).toBe(0)
    expect(s.targets.mouthSmile).toBe(0.6)
  })

  it('applies the alert baseline with fear-like wide eyes and inner brow, mapped to the surprised VRM expression', () => {
    const s = initializeEmoteState()
    const res = applyEmotion(s, 'alert')

    expect(res.success).toBe(true)
    expect(s.currentEmotion).toBe('alert')
    // alert reuses fear's wide-eye and inner-brow targets.
    expect(s.targets).toMatchObject({
      browInnerUp: 0.7,
      eyeWideLeft: 0.6,
      eyeWideRight: 0.6,
      // mapEmotionToVRM maps alert to the surprised VRM expression at 0.8.
      surprised: 0.8
    })
  })

  it('still reports an unknown mood as a failure with a warning', () => {
    const s = initializeEmoteState()
    const before = { ...s.targets }
    const res = applyEmotion(s, 'made-up' as EmotionType)
    // No mood config for this name → fail and warn; nothing is applied.
    expect(res.success).toBe(false)
    expect(console.warn).toHaveBeenCalled()
    expect(s.currentEmotion).toBe('neutral')
    expect(s.targets).toEqual(before)
  })

  it('ignores empty/undefined emotion input', () => {
    const s = initializeEmoteState()
    expect(applyEmotion(s, '' as EmotionType).success).toBe(true)
    expect(s.currentEmotion).toBe('neutral')
  })
})

describe('moodConfigurations completeness', () => {
  it('defines a baseline for every emotion', () => {
    for (const emotion of ALL_EMOTIONS) {
      expect(moodConfigurations[emotion]).toBeDefined()
      expect(moodConfigurations[emotion].baseline).toBeDefined()
      expect(Object.keys(moodConfigurations[emotion].baseline).length).toBeGreaterThan(0)
    }
  })

  it('keeps all baseline expression values within the valid 0..1 range', () => {
    for (const key of Object.keys(moodConfigurations)) {
      const baseline = moodConfigurations[key].baseline
      for (const [name, value] of Object.entries(baseline)) {
        expect(value, `${key}.${name}`).toBeGreaterThanOrEqual(0)
        expect(value, `${key}.${name}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('provides a speech profile for every configured mood', () => {
    for (const key of Object.keys(moodConfigurations)) {
      expect(moodConfigurations[key].speech).toBeDefined()
    }
  })
})

describe('startPerformance', () => {
  it('marks the state performing and schedules a relaxation window', () => {
    const s = initializeEmoteState()
    const res = startPerformance(s, { emotion: 'happy' }, 0)

    expect(res.success).toBe(true)
    expect(s.isPerforming).toBe(true)
    expect(s.performanceStartTime).toBeGreaterThan(0)
    // Relaxation is at least the 2s animation floor after the start time.
    expect(s.relaxationTime).toBeGreaterThanOrEqual(s.performanceStartTime + 2000)
    expect(s.currentEmotion).toBe('happy')
  })

  it('honors a longer explicit relaxTime over the 2s floor', () => {
    const s = initializeEmoteState()
    startPerformance(s, { emotion: 'sad', relaxTime: 5000 }, 0)
    expect(s.relaxationTime).toBeGreaterThanOrEqual(s.performanceStartTime + 5000)
  })

  it('is a safe no-op when no performance data is supplied', () => {
    const s = initializeEmoteState()
    const res = startPerformance(s, undefined as never, 0)
    expect(res.success).toBe(true)
    expect(s.isPerforming).toBe(false)
  })
})

describe('handleBargeIn', () => {
  it('relaxes a performing state back to neutral', () => {
    const s = initializeEmoteState()
    startPerformance(s, { emotion: 'angry' }, 0)
    expect(s.isPerforming).toBe(true)

    handleBargeIn(s)

    expect(s.isPerforming).toBe(false)
    expect(s.currentEmotion).toBe('neutral')
    expect(s.performanceStartTime).toBe(0)
    expect(s.relaxationTime).toBe(0)
  })

  it('zeros the bound GLB morphs instead of leaving an interrupted emotion frozen', () => {
    const s = initializeEmoteState()
    const morphs = [{ morphTargetInfluences: [0, 0] }]
    setupEmoteStateForMorphTargets(s, morphs, {
      browDownLeft: [0],
      mouthFrownLeft: [1]
    })

    applyEmotion(s, 'angry')
    applyEmoteStateToMorphTargets(s, morphs, s.dictionary!)
    expect(morphs[0].morphTargetInfluences).toEqual([0.6, 0.7])

    handleBargeIn(s)

    expect(morphs[0].morphTargetInfluences).toEqual([0, 0])
  })
})

describe('emoteUpdate', () => {
  it('runs a full tick without throwing and clears the performing flag once relaxed', () => {
    const s = initializeEmoteState()
    // Force an already-elapsed relaxation window so the performing branch resets.
    s.isPerforming = true
    s.relaxationTime = performance.now() - 1

    expect(() => emoteUpdate(s, 0.016, defaultEmoteConfig)).not.toThrow()
    expect(s.isPerforming).toBe(false)
  })

  it('is safe to call on a fresh (non-performing) state', () => {
    const s = initializeEmoteState()
    expect(() => emoteUpdate(s, 0.016, defaultEmoteConfig)).not.toThrow()
  })
})

describe('avatar switch VRM → GLB (regression: emote state leak)', () => {
  const makeVrm = () => ({ lookAt: undefined }) as never

  it('setupEmoteStateForMorphTargets clears the stale VRM binding', () => {
    const s = initializeEmoteState()
    setupEmoteStateForVRM(s, makeVrm())
    expect(s.vrm).toBeDefined()

    const morphs = [{ morphTargetInfluences: [0, 0] }]
    setupEmoteStateForMorphTargets(s, morphs, { mouthSmile: [1] })

    expect(s.vrm).toBeUndefined() // the leak fix — updateVRMSystems/applyToVRM now no-op on GLB
    expect(s.morphs).toBe(morphs)
  })

  it('setupEmoteStateForVRM clears stale GLB morph bindings', () => {
    const s = initializeEmoteState()
    setupEmoteStateForMorphTargets(s, [{ morphTargetInfluences: [0] }], { mouthSmile: [0] })
    expect(s.morphs).toBeDefined()

    setupEmoteStateForVRM(s, makeVrm())

    expect(s.morphs).toBeUndefined()
    expect(s.dictionary).toBeUndefined()
    expect(s.vrm).toBeDefined()
  })
})

describe('facial tick clears on reset, barge-in and rig change (M24)', () => {
  // Tick at Math.random 0 so the VRM pulse picks relaxed and a clear timer is scheduled.
  const scheduleRelaxedPulse = (s: EmoteState) => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)
  }

  it('cancels pending tick clears on reset', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = initializeEmoteState()
    scheduleRelaxedPulse(s)
    expect(vi.getTimerCount()).toBe(1)

    resetEmoteState(s)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending tick clears on barge-in', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = initializeEmoteState()
    scheduleRelaxedPulse(s)

    handleBargeIn(s)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending tick clears when the avatar rig changes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = initializeEmoteState()
    scheduleRelaxedPulse(s)

    setupEmoteStateForMorphTargets(s, [{ morphTargetInfluences: [0] }], { mouthSmile: [0] })

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('neck rest orientation across reset and rig changes (M26)', () => {
  it('keeps the captured neck rest quaternion across reset', () => {
    const s = initializeEmoteState()
    s.gazeState.neckOptions.quaternions.default = [0, 0, 0, 1]

    resetEmoteState(s)

    expect(s.gazeState.neckOptions.quaternions.default).toEqual([0, 0, 0, 1])
  })

  it('returns a turned neck to its rest orientation after reset while the player is hidden', () => {
    const s = initializeEmoteState()
    const neck = new Bone()
    neck.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2) // turned 90 degrees about Y
    s.bones = { neck }
    s.camera = { position: new Vector3(0, 1.5, 2) } as never
    s.gazeState.neckOptions.quaternions.default = [0, 0, 0, 1]

    resetEmoteState(s)
    for (let i = 0; i < 6; i++) updateGaze(s, 1, defaultEmoteConfig)

    expect(neck.quaternion.angleTo(new Quaternion(0, 0, 0, 1))).toBeLessThan(0.001)
  })

  it('clears the neck rest orientation when the avatar rig changes', () => {
    const s = initializeEmoteState()
    s.gazeState.neckOptions.quaternions.default = [0, 0, 0, 1]

    setupEmoteStateForMorphTargets(s, [{ morphTargetInfluences: [0] }], { mouthSmile: [0] })

    expect(s.gazeState.neckOptions.quaternions.default).toBeNull()
  })

  it('keeps the neck rest orientation when the same meshes are bound again in a new array', () => {
    const s = initializeEmoteState()
    const mesh = { morphTargetInfluences: [0] }
    setupEmoteStateForMorphTargets(s, [mesh], { mouthSmile: [0] })
    s.gazeState.neckOptions.quaternions.default = [0, 0, 0, 1]

    // The avatar effect rebuilds its morph array on every run, but the meshes are the same.
    setupEmoteStateForMorphTargets(s, [mesh], { mouthSmile: [0] })

    expect(s.gazeState.neckOptions.quaternions.default).toEqual([0, 0, 0, 1])
  })
})

describe('neck rest across an avatar switch', () => {
  // The player stands to the side (peripheral vision) or below the hips (hidden).
  const SIDE = { position: new Vector3(2.5, 1.6, -1) } as never
  const HIDDEN = { position: new Vector3(0, -1, -2) } as never

  // A head and neck under one node. The neck's raw pitch is its rest orientation.
  const avatar = (neckPitch: number) => {
    const node = new Object3D()
    const neck = new Bone()
    neck.quaternion.setFromEuler(new Euler(neckPitch, 0, 0))
    const head = new Bone()
    head.position.set(0, 1.7, 0)
    node.add(neck, head)
    node.updateMatrixWorld(true)
    return { node, neck, head }
  }

  const bind = (s: EmoteState, a: ReturnType<typeof avatar>) => {
    s.node = a.node
    s.bones = { neck: a.neck, Head: a.head }
  }

  // The new neck captures its rest on a frame with the player to the side, is then turned away,
  // and returns to its rest once the player is hidden. Its rest is identity, not the old pitch.
  const captureRestThenHide = (s: EmoteState, neck: Bone) => {
    s.camera = SIDE
    updateGaze(s, 1 / 60, defaultEmoteConfig)
    neck.quaternion.setFromEuler(new Euler(0, 0.6, 0))
    s.camera = HIDDEN
    for (let i = 0; i < 300; i++) updateGaze(s, 1 / 60, defaultEmoteConfig)
  }

  it('returns a GLB avatar with a different mesh count to its own neck rest, not the previous one', () => {
    const s = initializeEmoteState()
    const a = avatar(0.4)
    setupEmoteStateForMorphTargets(s, [{ morphTargetInfluences: [0] }, { morphTargetInfluences: [0] }], {
      mouthSmile: [0]
    })
    bind(s, a)
    s.camera = SIDE
    updateGaze(s, 1 / 60, defaultEmoteConfig)
    expect(s.gazeState.neckOptions.quaternions.default).not.toBeNull()

    const b = avatar(0)
    setupEmoteStateForMorphTargets(s, [{ morphTargetInfluences: [0] }], { mouthSmile: [0] })
    expect(s.gazeState.neckOptions.quaternions.default).toBeNull()
    bind(s, b)
    captureRestThenHide(s, b.neck)

    expect(b.neck.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-3)
  })

  it('returns a VRM avatar to its own neck rest, not the one before it', () => {
    const vrmOf = (node: Object3D) => ({ scene: node, lookAt: { lookAt: vi.fn() } }) as never
    const s = initializeEmoteState()
    const a = avatar(0.4)
    setupEmoteStateForVRM(s, vrmOf(a.node))
    bind(s, a)
    s.camera = SIDE
    updateGaze(s, 1 / 60, defaultEmoteConfig)
    expect(s.gazeState.neckOptions.quaternions.default).not.toBeNull()

    const b = avatar(0)
    setupEmoteStateForVRM(s, vrmOf(b.node))
    expect(s.gazeState.neckOptions.quaternions.default).toBeNull()
    bind(s, b)
    captureRestThenHide(s, b.neck)

    expect(b.neck.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-3)
  })
})
