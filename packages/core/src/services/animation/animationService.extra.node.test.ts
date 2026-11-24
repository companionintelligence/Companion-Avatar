import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { ANIMATION_CLIPS, GLB_CLIPS, VRMA_CLIPS } from './config/animationClips'
import {
  applyPersonality,
  getCurrentAnimationInfo,
  getPersonalityAnimationClips,
  initializeAnimationState,
  initializeDefaultAnimation,
  setupAnimationState,
  startPerformance,
  updateAnimation
} from './animationService'

// --- Shared fake AnimationAction / mixer harness (mirrors animationService.node.test.ts) ---
function fakeAction() {
  const a = {
    weight: 0,
    _running: false,
    enabled: true,
    paused: false,
    timeScale: 1,
    clampWhenFinished: false,
    blendMode: 0 as number,
    loop: 0 as number,
    reps: 0 as number,
    reset: vi.fn(() => {
      a._running = false
      return a
    }),
    play: vi.fn(() => {
      a._running = true
      return a
    }),
    stop: vi.fn(() => {
      a._running = false
      return a
    }),
    setEffectiveWeight: vi.fn((w: number) => {
      a.weight = w
      return a
    }),
    setEffectiveTimeScale: vi.fn((t: number) => {
      a.timeScale = t
      return a
    }),
    setLoop: vi.fn((l: number, r: number) => {
      a.loop = l
      a.reps = r
      return a
    }),
    isRunning: vi.fn(() => a._running),
    crossFadeTo: vi.fn(() => a)
  }
  return a
}
type FakeAction = ReturnType<typeof fakeAction>

function makeHarness(clipNames: string[], catalog?: Record<string, unknown>) {
  const actions: Record<string, FakeAction> = {}
  clipNames.forEach((name) => {
    actions[name] = fakeAction()
  })
  let finishedCb: ((e: { action: unknown }) => void) | undefined
  const mixer = {
    update: vi.fn(),
    addEventListener: vi.fn((type: string, cb: (e: { action: unknown }) => void) => {
      if (type === 'finished') finishedCb = cb
    }),
    removeEventListener: vi.fn()
  }
  const state = initializeAnimationState()
  setupAnimationState(state, actions as never, mixer as never, undefined, catalog as never)
  return {
    state,
    actions,
    mixer,
    fireFinished: (name: string) => finishedCb?.({ action: actions[name] })
  }
}

describe('startPerformance — immediate vs queued', () => {
  it('plays immediately when idle and flagged immediate', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)

    expect(h.state.currentClip?.name).toBe('surprise_greet')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })

  it('queues (does not play) when immediate is not set', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, blendTime: 300 }, 0)

    // Still on idle; the request sits in the queue.
    expect(h.state.currentClip?.name).toBe('idle_loop')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)
  })

  it('is a no-op when neither an explicit clip nor a resolvable category is given', () => {
    const h = makeHarness(['idle_loop'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(h.state, { immediate: true, category: 'gesture' }, 0) // no catalog → unresolved
    expect(h.state.currentClip?.name).toBe('idle_loop')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })
})

describe('pickLoadedClipByCategory (via startPerformance category resolution)', () => {
  it('resolves a loaded clip of the requested category from the catalog', () => {
    // Load an idle base + one loaded gesture clip; provide the GLB catalog for lookup.
    const h = makeHarness(['idle-stable', 'Waving'], GLB_CLIPS)
    initializeDefaultAnimation(h.state, 'professional', GLB_CLIPS['idle-stable'])

    startPerformance(h.state, { category: 'gesture', immediate: true, blendTime: 300 }, 0)

    // 'Waving' is the only loaded gesture action → it must be picked.
    expect(h.state.currentClip?.name).toBe('Waving')
  })

  it('stays put when no loaded action matches the requested category', () => {
    const h = makeHarness(['idle-stable'], GLB_CLIPS) // no gesture actions loaded
    initializeDefaultAnimation(h.state, 'professional', GLB_CLIPS['idle-stable'])

    startPerformance(h.state, { category: 'gesture', immediate: true }, 0)
    expect(h.state.currentClip?.name).toBe('idle-stable')
  })
})

describe('finished → advanceToNext → idle fallback', () => {
  it('falls back to the idle clip when a finite gesture finishes with an empty queue', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    // Play a finite (loopCount 1) gesture immediately.
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)
    expect(h.state.currentClip?.name).toBe('surprise_greet')

    // Gesture completes with nothing queued and cycling off → return to idle base.
    h.fireFinished('surprise_greet')
    expect(h.state.currentClip?.name).toBe('idle_loop')
  })

  it('does not fall back when the finished clip is already the idle base', () => {
    const h = makeHarness(['idle_loop'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    // idle_loop is infinite; a spurious finished event must not reshuffle state.
    h.fireFinished('idle_loop')
    expect(h.state.currentClip?.name).toBe('idle_loop')
  })
})

describe('queued performances respect finite clip completion', () => {
  it('does not drain a queued clip when only the crossfade has settled', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(h.state, {
      clip: ANIMATION_CLIPS.surprise_greet,
      immediate: true,
      loopCount: 1,
      blendTime: 300
    }, 0)
    startPerformance(h.state, {
      clip: ANIMATION_CLIPS.idle_loop,
      loopCount: Infinity,
      blendTime: 2000
    }, 0)

    // The blend window is not the authored gesture duration. The queue must
    // remain behind the finite clip until the mixer emits `finished`.
    updateAnimation(h.state, 0.4)
    expect(h.state.currentClip?.name).toBe('surprise_greet')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)

    h.fireFinished('surprise_greet')
    expect(h.state.currentClip?.name).toBe('idle_loop')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })
})

describe('configureAction — loop / clamp / additive mode wiring', () => {
  it('sets LoopOnce + clampWhenFinished for a finite (loopCount 1) clip', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)

    const action = h.actions.surprise_greet
    expect(action.setLoop).toHaveBeenCalledWith(THREE.LoopOnce, 1)
    expect(action.clampWhenFinished).toBe(true)
    expect(action.blendMode).toBe(THREE.NormalAnimationBlendMode)
  })

  it('sets LoopRepeat with Infinity for an infinite idle clip', () => {
    const h = makeHarness(['idle_loop'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    // idle_loop has loopCount Infinity.
    expect(h.actions.idle_loop.setLoop).toHaveBeenCalledWith(THREE.LoopRepeat, Infinity)
  })

  it('sets a finite repetition count for a multi-loop clip', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(
      h.state,
      { clip: ANIMATION_CLIPS.surprise_greet, loopCount: 3, immediate: true, blendTime: 300 },
      0
    )
    expect(h.actions.surprise_greet.setLoop).toHaveBeenCalledWith(THREE.LoopRepeat, 3)
  })

  it('selects the additive blend mode when the clip requests it', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    const additiveClip = { ...ANIMATION_CLIPS.surprise_greet, blendMode: 'additive' as const }
    startPerformance(h.state, { clip: additiveClip, immediate: true, blendTime: 300 }, 0)

    expect(h.actions.surprise_greet.blendMode).toBe(THREE.AdditiveAnimationBlendMode)
  })

  it('applies the clip speed to the action timeScale', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(
      h.state,
      { clip: ANIMATION_CLIPS.surprise_greet, speed: 1.25, immediate: true, blendTime: 300 },
      0
    )
    expect(h.actions.surprise_greet.timeScale).toBe(1.25)
  })
})

describe('personality cycling — category rotation', () => {
  // NOTE: pickNextClip resolves against ANIMATION_CLIPS (= VRMA_CLIPS) regardless of the active
  // avatar's catalog, so cycling is exercised here with VRMA clip actions loaded. See the reported
  // finding about GLB avatars in the task summary.
  it('rotates the infinite idle clip to the next category once its cycle interval elapses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // force sequential (useSequence: r < 0.7) category picks

    // playful ring starts idle → gesture; both categories have VRMA clips (idle_loop, surprise_greet).
    const h = makeHarness(
      Object.values(VRMA_CLIPS).map((c) => c.name),
      VRMA_CLIPS
    )
    applyPersonality(h.state, 'playful')
    h.state.cyclingState.cyclingEnabled = true
    h.state.cyclingState.cycleInterval = 1000

    initializeDefaultAnimation(h.state, 'playful', VRMA_CLIPS.idle_loop)
    // Initial category is idle (set by state init, untouched by an explicit-clip default).
    expect(h.state.cyclingState.lastCategory).toBe('idle')
    expect(h.state.currentClip?.name).toBe('idle_loop')

    // The idle clip is infinite, so the cycle timer fires and advances one step in the ring.
    vi.spyOn(performance, 'now').mockReturnValue(h.state.lastChangeTime + 2000)
    updateAnimation(h.state, 0.016)

    // idle → gesture: the only VRMA gesture clips are surprise_greet / pose.
    expect(h.state.cyclingState.lastCategory).toBe('gesture')
    expect(['surprise_greet', 'pose']).toContain(h.state.currentClip?.name)
    vi.restoreAllMocks()
  })

  it('advances a finite gesture clip onward on its finished event when cycling is enabled', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // sequential category picks

    const h = makeHarness(
      Object.values(VRMA_CLIPS).map((c) => c.name),
      VRMA_CLIPS
    )
    applyPersonality(h.state, 'playful')
    h.state.cyclingState.cyclingEnabled = true

    initializeDefaultAnimation(h.state, 'playful', VRMA_CLIPS.idle_loop)
    // First finished advances idle → a gesture clip.
    h.fireFinished('idle_loop')
    expect(h.state.cyclingState.lastCategory).toBe('gesture')
    const gestureClip = h.state.currentClip!.name
    expect(['surprise_greet', 'pose']).toContain(gestureClip)

    // The finite gesture clip finishing must not freeze on its last frame — it advances again.
    h.fireFinished(gestureClip)
    expect(h.state.currentClip).not.toBeNull()
    vi.restoreAllMocks()
  })

  it('adopts the personality cycle interval on applyPersonality', () => {
    const h = makeHarness(['idle_loop'])
    applyPersonality(h.state, 'energetic') // interval 5000
    expect(h.state.cyclingState.cycleInterval).toBe(5000)
  })
})

// Regression: cycling must draw from the ACTIVE avatar's catalog, not the hardcoded
// VRMA ANIMATION_CLIPS — otherwise a GLB avatar cycles to VRMA clips it never loaded
// and freezes on idle.
describe('getPersonalityAnimationClips — catalog-aware', () => {
  it('defaults to VRMA ANIMATION_CLIPS when no catalog is given', () => {
    const clips = getPersonalityAnimationClips('professional')
    const vrmaNames = new Set(Object.values(VRMA_CLIPS).map((c) => c.name))
    expect(clips.length).toBeGreaterThan(0)
    expect(clips.every((c) => vrmaNames.has(c.name))).toBe(true)
  })

  it('draws from a passed GLB catalog instead of VRMA', () => {
    const glbClips = getPersonalityAnimationClips('professional', GLB_CLIPS)
    const glbNames = new Set(Object.values(GLB_CLIPS).map((c) => c.name))
    const vrmaNames = new Set(Object.values(VRMA_CLIPS).map((c) => c.name))
    expect(glbClips.length).toBeGreaterThan(0)
    // Every returned clip belongs to the GLB catalog…
    expect(glbClips.every((c) => glbNames.has(c.name))).toBe(true)
    // …and none is a VRMA-only clip name absent from the GLB catalog.
    expect(glbClips.some((c) => vrmaNames.has(c.name) && !glbNames.has(c.name))).toBe(false)
  })
})

// M18: blended plays used crossFadeTo(..., warp = true). Warp rewrites timeScale when it
// ends, so the configured clip speed was lost. The weight ramp must stay, warp must go.
describe('playClip — blended crossfade (M18)', () => {
  it('passes warp = false to crossFadeTo', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(
      h.state,
      { clip: ANIMATION_CLIPS.surprise_greet, speed: 1.25, immediate: true, blendTime: 300 },
      0
    )

    expect(h.actions.idle_loop.crossFadeTo).toHaveBeenCalledWith(h.actions.surprise_greet, 0.3, false)
    expect(h.actions.surprise_greet.timeScale).toBe(1.25)
  })
})

// M19: an avatar switch re-runs setupAnimationState on fresh actions. The queue and the
// current clip belong to the previous avatar and must not survive the swap.
describe('setupAnimationState — avatar switch drops the previous avatar state (M19)', () => {
  const freshMixer = () => ({ update: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops a queued performance so it cannot drain onto the new avatar', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, blendTime: 300 }, 0)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)

    const nextActions = { idle_loop: fakeAction(), surprise_greet: fakeAction() }
    setupAnimationState(h.state, nextActions as never, freshMixer() as never)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)

    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    updateAnimation(h.state, 0.016)
    expect(h.state.currentClip?.name).toBe('idle_loop')
    expect(nextActions.surprise_greet.play).not.toHaveBeenCalled()
  })

  it('clears the current clip and any in-flight transition from the previous avatar', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)
    expect(h.state.isTransitioning).toBe(true)

    setupAnimationState(h.state, { idle_loop: fakeAction() } as never, freshMixer() as never)

    expect(h.state.currentClip).toBeNull()
    expect(h.state.isTransitioning).toBe(false)
    expect(h.state.previousClipName).toBeUndefined()
  })
})

// T3: a re-setup must stop the clip it replaces. Otherwise a looping clip keeps its weight on the
// mixer beside the idle that the setup then plays.
describe('setupAnimationState — re-setup stops the replaced clip (T3)', () => {
  const looping = { ...ANIMATION_CLIPS.surprise_greet, loopCount: Infinity }

  it('stops the looping clip when a different action set is set up on the same mixer', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: looping, immediate: true, blendTime: 300 }, 0)
    expect(h.actions.surprise_greet.isRunning()).toBe(true)

    const nextActions = { idle_loop: fakeAction(), surprise_greet: fakeAction() }
    setupAnimationState(h.state, nextActions as never, h.mixer as never)
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    expect(h.actions.surprise_greet.stop).toHaveBeenCalled()
    expect(h.actions.surprise_greet.isRunning()).toBe(false)
    expect(nextActions.idle_loop.isRunning()).toBe(true)
  })

  it('stops the looping clip when the same actions are set up again on the same mixer', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: looping, immediate: true, blendTime: 300 }, 0)

    setupAnimationState(h.state, h.actions as never, h.mixer as never)
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    expect(h.actions.surprise_greet.stop).toHaveBeenCalled()
    expect(h.actions.surprise_greet.isRunning()).toBe(false)
    expect(h.actions.idle_loop.isRunning()).toBe(true)
  })
})

// T4: a same-avatar setup (animations switched back on) keeps the queue. Only a new mixer or a
// new action set starts from an empty queue.
describe('setupAnimationState — same-avatar re-setup keeps playback (T4)', () => {
  it('keeps a queued gesture when the same actions are set up again on the same mixer', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, blendTime: 300 }, 0)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)

    // A rebuilt map of the same action instances, as AvatarModel builds on each effect run.
    setupAnimationState(h.state, { ...h.actions } as never, h.mixer as never)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)

    // The queued gesture still plays once the idle base is running.
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    updateAnimation(h.state, 0.016)
    expect(h.state.currentClip?.name).toBe('surprise_greet')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })

  it('drops the queue when the action set changes on the same mixer', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, blendTime: 300 }, 0)

    setupAnimationState(h.state, { idle_loop: fakeAction(), surprise_greet: fakeAction() } as never, h.mixer as never)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })
})

// L12: on an empty personality/catalog intersection pickNextClip returned undefined and
// advanceToNext passed it to playClip, which read clip.blendTime inside the frame loop.
describe('cycling — empty personality/catalog intersection (L12)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw from the frame loop when no catalog clip fits the personality', () => {
    // 'calm' cycles idle + expression. This catalog only has a gesture, so nothing fits.
    const catalog = { surprise_greet: ANIMATION_CLIPS.surprise_greet }
    const h = makeHarness(['idle_loop', 'surprise_greet'], catalog)
    applyPersonality(h.state, 'calm')
    h.state.cyclingState.cyclingEnabled = true
    h.state.cyclingState.cycleInterval = 1000
    initializeDefaultAnimation(h.state, 'calm', ANIMATION_CLIPS.idle_loop)

    vi.spyOn(performance, 'now').mockReturnValue(h.state.lastChangeTime + 2000)
    expect(() => updateAnimation(h.state, 0.016)).not.toThrow()

    // Nothing to cycle to, so the idle keeps playing.
    expect(h.state.currentClip?.name).toBe('idle_loop')
  })
})
