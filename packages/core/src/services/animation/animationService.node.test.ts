import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { ANIMATION_CLIPS } from './config/animationClips'
import type { AnimationState } from './animationTypes'
import {
  applyPersonality,
  getCurrentAnimationInfo,
  initializeAnimationState,
  initializeDefaultAnimation,
  pickLoadedClipByCategory,
  resetAnimationState,
  setupAnimationState,
  startPerformance,
  updateAnimation
} from './animationService'

type FakeAction = ReturnType<typeof fakeAction>

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

function makeHarness(clipNames: string[]) {
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
  setupAnimationState(state, actions as never, mixer as never)
  return {
    state,
    actions,
    mixer,
    fireFinished: (name: string) => finishedCb?.({ action: actions[name] })
  }
}

describe('initializeAnimationState', () => {
  it('starts on the professional personality with cycling off', () => {
    const s = initializeAnimationState()
    expect(s.currentPersonality).toBe('professional')
    expect(s.cyclingState.cyclingEnabled).toBe(false)
    expect(s.currentClip).toBeNull()
    expect(s.isTransitioning).toBe(false)
  })
})

describe('applyPersonality', () => {
  it('adopts the personality cycle interval and filtered clip set', () => {
    const s = initializeAnimationState()
    applyPersonality(s, 'calm') // categories: idle, expression; interval 12000
    expect(s.cyclingState.cycleInterval).toBe(12000)
    // idle_loop is the only 'idle' clip; no 'expression' clips are configured.
    expect(s.cachedClips.map((c) => c.name)).toContain('idle_loop')
    expect(s.cachedClips.every((c) => c.category === 'idle' || c.category === 'expression')).toBe(true)
  })
})

describe('setup + initializeDefaultAnimation', () => {
  it('registers a finished listener and plays the first clip at full weight without blending', () => {
    const h = makeHarness(['idle_loop'])
    expect(h.mixer.addEventListener).toHaveBeenCalledWith('finished', expect.any(Function))

    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    expect(h.state.currentClip?.name).toBe('idle_loop')
    expect(h.actions.idle_loop.play).toHaveBeenCalled()
    expect(h.actions.idle_loop.weight).toBe(1)
    expect(h.state.isTransitioning).toBe(false)
  })
})

describe('crossfade on immediate performance', () => {
  it('crossfades from the current clip to the requested clip', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)

    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)

    expect(h.state.currentClip?.name).toBe('surprise_greet')
    expect(h.state.isTransitioning).toBe(true)
    expect(h.state.previousClipName).toBe('idle_loop')
    // Native crossfade was invoked from the outgoing action to the incoming one.
    expect(h.actions.idle_loop.crossFadeTo).toHaveBeenCalledWith(h.actions.surprise_greet, 0.3, false)
    expect(h.actions.surprise_greet.play).toHaveBeenCalled()
  })

  it('an immediate performance interrupts an in-flight transition (never stalls in the queue)', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)

    // A second immediate request while transitioning now plays through — crossFadeTo
    // interrupts the in-flight fade rather than queueing (and stalling behind idle).
    startPerformance(h.state, { clip: ANIMATION_CLIPS.idle_loop, immediate: true, blendTime: 500 }, 0)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
    expect(h.state.currentClip?.name).toBe('idle_loop')
  })

  it('a NON-immediate performance is queued', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: false, blendTime: 300 }, 0)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)
    expect(h.state.currentClip?.name).toBe('idle_loop')
  })

  it('drains a queued performance behind an INFINITE idle on the next tick (regression: mixing not working)', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop) // infinite idle, no 'finished'
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: false, blendTime: 300 }, 0)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(1)
    expect(h.state.isTransitioning).toBe(false)

    // A mixer tick must drain the queue even though idle never fires 'finished'.
    updateAnimation(h.state, 0.016)
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
    expect(h.state.currentClip?.name).toBe('surprise_greet')
  })
})

describe('finished event advances the queue', () => {
  it('plays the queued clip when the active finite clip finishes', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.idle_loop, loopCount: Infinity, blendTime: 400 }, 0)

    // surprise_greet completes → advance to the queued idle_loop.
    h.fireFinished('surprise_greet')

    expect(h.state.currentClip?.name).toBe('idle_loop')
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })

  it('ignores finished events from a clip that is only fading out', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)

    // idle_loop is the outgoing clip; its finished event must not advance anything.
    h.fireFinished('idle_loop')
    expect(h.state.currentClip?.name).toBe('surprise_greet')
  })
})

describe('updateAnimation transition bookkeeping', () => {
  it('clears the transition and stops the faded-out action once the blend elapses', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, immediate: true, blendTime: 300 }, 0)

    // Advance the mixer past the 300ms blend (delta is in seconds).
    updateAnimation(h.state, 0.2)
    expect(h.state.isTransitioning).toBe(true)
    updateAnimation(h.state, 0.2)

    // Regression guard: updateAnimation must NOT tick the mixer — drei's useAnimations already
    // does that in its own useFrame. Calling it here too double-advanced mixer time and made
    // every clip play at 2x. The transition bookkeeping below still runs from wall-time delta.
    expect(h.mixer.update).not.toHaveBeenCalled()
    expect(h.state.isTransitioning).toBe(false)
    expect(h.actions.idle_loop.stop).toHaveBeenCalled()
    expect(h.state.previousClipName).toBeUndefined()
  })
})

describe('resetAnimationState', () => {
  it('detaches the finished listener and clears the queue', () => {
    const h = makeHarness(['idle_loop', 'surprise_greet'])
    initializeDefaultAnimation(h.state, 'professional', ANIMATION_CLIPS.idle_loop)
    startPerformance(h.state, { clip: ANIMATION_CLIPS.surprise_greet, blendTime: 300 }, 0)

    resetAnimationState(h.state)

    expect(h.mixer.removeEventListener).toHaveBeenCalledWith('finished', expect.any(Function))
    expect(h.state.currentClip).toBeNull()
    expect(getCurrentAnimationInfo(h.state).queueLength).toBe(0)
  })
})

describe('blend mode constant wiring', () => {
  it('exposes three additive/normal constants for layered playback', () => {
    expect(THREE.AdditiveAnimationBlendMode).toBeTypeOf('number')
    expect(THREE.NormalAnimationBlendMode).toBeTypeOf('number')
  })
})

describe('pickLoadedClipByCategory — category fallback (VRM expression no-op fix)', () => {
  // Minimal state: a VRMA-like catalog with gesture+action loaded but NO 'expression' clips —
  // exactly the case where angry/fear/sad/disgust (→ 'expression') used to silently no-op.
  const makeState = (loaded: string[]) =>
    ({
      catalog: {
        idle_loop: { name: 'idle_loop', category: 'idle' },
        wave: { name: 'wave', category: 'gesture' },
        dance: { name: 'dance', category: 'action' }
      },
      actions: Object.fromEntries(loaded.map((n) => [n, {}]))
    }) as unknown as AnimationState

  it('falls back from an empty category (expression) to a loaded one (gesture)', () => {
    const s = makeState(['idle_loop', 'wave', 'dance'])
    const clip = pickLoadedClipByCategory(s, 'expression')
    expect(clip).toBeDefined()
    expect(['gesture', 'action', 'idle']).toContain(clip!.category) // not a silent no-op anymore
  })

  it('returns a clip of the exact category when it IS loaded', () => {
    const s = makeState(['idle_loop', 'wave', 'dance'])
    expect(pickLoadedClipByCategory(s, 'gesture')!.name).toBe('wave')
  })

  it('only considers clips whose action is actually loaded (expression → idle when only idle loaded)', () => {
    const s = makeState(['idle_loop']) // wave/dance present in catalog but NOT loaded
    // expression → [gesture, action, idle]; gesture/action unloaded → resolves the loaded idle
    expect(pickLoadedClipByCategory(s, 'expression')!.category).toBe('idle')
  })

  it('returns undefined when nothing at all is loaded', () => {
    expect(pickLoadedClipByCategory(makeState([]), 'expression')).toBeUndefined()
  })
})
