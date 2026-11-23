import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { AgentService } from '../useAgent'
import { defaultEmoteConfig } from './configs/emoteConfig'
import { initiateGaze } from './modules/gazeService'
import { useEmoteService } from './useEmoteService'

// The hook only passes state through to these, so the services are stubbed. The real modules
// import three at runtime, which the jsdom project cannot resolve (dedupe points at the root).
vi.mock('./modules/gazeService', () => ({
  initiateGaze: vi.fn(),
  updateGaze: vi.fn()
}))

vi.mock('./emoteService', () => ({
  applyEmoteStateToMorphTargets: vi.fn(),
  applyEmoteStateToVRM: vi.fn(),
  applyEmotion: vi.fn(),
  emoteUpdate: vi.fn(),
  handleBargeIn: vi.fn(),
  initializeEmoteState: vi.fn(() => ({})),
  resetEmoteState: vi.fn(),
  setupEmoteStateForMorphTargets: vi.fn(),
  setupEmoteStateForVRM: vi.fn(),
  startPerformance: vi.fn()
}))

// Compile-time only: tsc checks this, vitest does not run it. triggerGaze takes no options, which
// matches useEmoteService; a declared options parameter would be silently dropped.
expectTypeOf<AgentService['actions']['triggerGaze']>().parameters.toEqualTypeOf<[]>()

describe('useEmoteService gaze config (L7)', () => {
  beforeEach(() => {
    vi.mocked(initiateGaze).mockClear()
  })

  it('triggerGaze uses the gaze options that updateConfig set', () => {
    const { result } = renderHook(() => useEmoteService())

    act(() => {
      result.current.actions.updateConfig({
        gaze: { ...defaultEmoteConfig.gaze, options: { randomness: 0 } }
      })
    })
    act(() => {
      result.current.actions.triggerGaze()
    })

    expect(initiateGaze).toHaveBeenLastCalledWith(expect.anything(), { ...defaultEmoteConfig.gaze.options, randomness: 0 })
  })

  it('state.config reflects updateConfig', () => {
    const { result } = renderHook(() => useEmoteService())

    act(() => {
      result.current.actions.updateConfig({
        gaze: { ...defaultEmoteConfig.gaze, interpolationFactor: 7 }
      })
    })

    expect(result.current.state.config.gaze.interpolationFactor).toBe(7)
  })

  it('triggerGaze takes no parameters at runtime, as its type says', () => {
    const { result } = renderHook(() => useEmoteService())

    expect(result.current.actions.triggerGaze.length).toBe(0)
  })
})

describe('useEmoteService updateConfig merge', () => {
  it('a partial gaze update keeps the sibling gaze keys', () => {
    const { result } = renderHook(() => useEmoteService())

    act(() => {
      result.current.actions.updateConfig({ gaze: { options: { randomness: 0.5 } } })
    })

    const { gaze } = result.current.state.config
    expect(gaze.options.randomness).toBe(0.5)
    expect(gaze.maxDistance).toBe(defaultEmoteConfig.gaze.maxDistance)
    expect(gaze.interpolationFactor).toBe(defaultEmoteConfig.gaze.interpolationFactor)
    expect(gaze.eye).toEqual(defaultEmoteConfig.gaze.eye)
    expect(gaze.neck).toEqual(defaultEmoteConfig.gaze.neck)
  })

  it('a randomness-only gaze.options update keeps delay and duration', () => {
    const { result } = renderHook(() => useEmoteService())

    act(() => {
      result.current.actions.updateConfig({ gaze: { options: { randomness: 0.5 } } })
    })

    expect(result.current.state.config.gaze.options).toEqual({
      delay: defaultEmoteConfig.gaze.options.delay,
      duration: defaultEmoteConfig.gaze.options.duration,
      randomness: 0.5
    })
  })

  it('a full gaze update still replaces the values it gives', () => {
    const { result } = renderHook(() => useEmoteService())

    act(() => {
      result.current.actions.updateConfig({
        gaze: { ...defaultEmoteConfig.gaze, maxDistance: 3, options: { randomness: 0 } }
      })
    })

    expect(result.current.state.config.gaze.maxDistance).toBe(3)
    expect(result.current.state.config.gaze.options).toEqual({ ...defaultEmoteConfig.gaze.options, randomness: 0 })
  })

  it('leaves the sections an update does not mention as they were', () => {
    const { result } = renderHook(() => useEmoteService())

    act(() => {
      result.current.actions.updateConfig({ gaze: { maxDistance: 4 } })
    })

    const { config } = result.current.state
    expect(config.blink).toEqual(defaultEmoteConfig.blink)
    expect(config.tick).toEqual(defaultEmoteConfig.tick)
    expect(config.relaxation).toEqual(defaultEmoteConfig.relaxation)
    expect(config.mood).toEqual(defaultEmoteConfig.mood)
  })
})
