import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultEmoteConfig } from './configs/emoteConfig'
import { applyEmotion, initializeEmoteState, resetEmoteState } from './emoteService'
import type { EmoteState } from './emoteTypes'
import { updateFacialTicks } from './modules/facialTicksService'

// Drive time deterministically by controlling performance.now().
let clock = 0
const setNow = (t: number) => {
  clock = t
}

// sin(t / frequency) is 1 here, so the tick value sits at its intensity.
const PEAK_TIME = defaultEmoteConfig.tick.frequency * (Math.PI / 2)

// VRM expression names are not FacialTarget keys, so read them through a loose view.
const valueOf = (s: EmoteState, key: string): number | undefined =>
  (s.targets as Record<string, number | undefined>)[key]

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const freshState = (): EmoteState => {
  setNow(0)
  return initializeEmoteState()
}

describe('updateFacialTicks — ticks around an emotion baseline (M14)', () => {
  it('lifts a baseline key above its floor and never writes it below the baseline', () => {
    const s = freshState()
    applyEmotion(s, 'angry') // browDownLeft baseline 0.6
    vi.spyOn(Math, 'random').mockReturnValue(0) // picks browDownLeft

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(s.tickState.currentTick).toBe('browDownLeft')
    expect(s.targets.browDownLeft).toBeCloseTo(0.9) // the 0.6 baseline plus the 0.3 tick lift
  })

  it('restores the baseline when the tick collapses', () => {
    const s = freshState()
    applyEmotion(s, 'angry')
    vi.spyOn(Math, 'random').mockReturnValue(0)

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)
    setNow(0) // sin(0) = 0, so the tick collapses
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(s.tickState.currentTick).toBeNull()
    expect(s.targets.browDownLeft).toBe(0.6)
  })

  it('restores the previous key to its baseline when the tick moves on', () => {
    const s = freshState()
    applyEmotion(s, 'angry')
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig) // browDownLeft

    // The held key is re-picked two seconds later, and floor(0.2 * 7) selects browDownRight.
    random.mockReturnValue(0.2)
    setNow(PEAK_TIME + 2000)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(s.tickState.currentTick).toBe('browDownRight')
    expect(s.targets.browDownLeft).toBe(0.6)
  })
})

describe('updateFacialTicks — brow tick cadence', () => {
  it('changes the brow tick key at most once a second over 600 frames at 60 Hz', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = freshState()
    applyEmotion(s, 'angry')
    // A fixed (seeded) random source: the picks vary, and the same sequence runs on every run.
    let seed = 42
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    })
    // Stretch the tick period so the brow tick stays on for the whole 10 s window.
    const config = { ...defaultEmoteConfig, tick: { ...defaultEmoteConfig.tick, frequency: 4000 } }

    let changes = 0
    let previous: string | null = null
    for (let frame = 0; frame < 600; frame++) {
      setNow(1000 + (frame * 1000) / 60)
      updateFacialTicks(s, 1 / 60, config)

      const key = s.tickState.currentTick
      if (key && previous && key !== previous) changes++
      if (key) previous = key

      const values = Object.values(s.targets).filter((v): v is number => typeof v === 'number')
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...values)).toBeLessThanOrEqual(1)
    }

    expect(changes).toBeGreaterThan(0)
    expect(changes).toBeLessThanOrEqual(10)
  })
})

describe('updateFacialTicks — VRM relaxed and neutral pulses (M24)', () => {
  it('clears its own relaxed pulse after 500 ms', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = freshState()
    vi.spyOn(Math, 'random').mockReturnValue(0) // the VRM pulse picks relaxed

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)
    expect(valueOf(s, 'relaxed')).toBeCloseTo(0.06)

    vi.advanceTimersByTime(500)
    expect(valueOf(s, 'relaxed')).toBe(0)
  })

  it('does not let a pending relaxed pulse clear a sleep expression applied after it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = freshState()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig) // relaxed pulse, clear pending
    applyEmotion(s, 'sleep') // sleep owns relaxed at 0.8
    vi.advanceTimersByTime(500)

    expect(valueOf(s, 'relaxed')).toBe(0.8)
  })

  it('still pulses relaxed after a neutral mood is applied', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = freshState()
    applyEmotion(s, 'neutral') // neutral has a baseline, but it writes only the neutral key
    vi.spyOn(Math, 'random').mockReturnValue(0) // the pulse fires and picks relaxed

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(valueOf(s, 'relaxed')).toBeCloseTo(0.06)
  })

  it('still pulses relaxed after a reset', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = freshState()
    applyEmotion(s, 'angry')
    resetEmoteState(s)
    vi.spyOn(Math, 'random').mockReturnValue(0) // the pulse fires and picks relaxed

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(valueOf(s, 'relaxed')).toBeCloseTo(0.06)
  })

  it('skips the relaxed pulse while a mood that writes relaxed is active', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = freshState()
    applyEmotion(s, 'sleep') // sleep maps to the relaxed VRM expression, held at 0.8
    vi.spyOn(Math, 'random').mockReturnValue(0) // the pulse would pick relaxed

    setNow(PEAK_TIME)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(valueOf(s, 'relaxed')).toBe(0.8)
  })
})
