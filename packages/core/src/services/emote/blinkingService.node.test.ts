import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultEmoteConfig } from './configs/emoteConfig'
import { applyEmotion, initializeEmoteState } from './emoteService'
import { updateBlinking } from './modules/blinkingService'
import { updateFacialTicks } from './modules/facialTicksService'
import type { EmoteState } from './emoteTypes'

// Drive time deterministically by controlling performance.now().
let clock = 0
const setNow = (t: number) => {
  clock = t
}

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const freshState = (): EmoteState => {
  // initializeEmoteState reads performance.now() for nextBlinkTime — pin it to 0-relative.
  setNow(0)
  return initializeEmoteState()
}

describe('updateBlinking — deterministic blink cycle', () => {
  it('does not start a blink before nextBlinkTime', () => {
    const s = freshState()
    s.blinkState.nextBlinkTime = 1000
    s.blinkState.isBlinking = false

    setNow(500)
    updateBlinking(s, 0.016, defaultEmoteConfig)

    expect(s.blinkState.isBlinking).toBe(false)
  })

  it('opens a blink and closes the eyelids once nextBlinkTime is reached', () => {
    const s = freshState()
    s.blinkState.nextBlinkTime = 1000
    s.blinkState.isBlinking = false

    // Enter the blink at t = 1000.
    setNow(1000)
    updateBlinking(s, 0.016, defaultEmoteConfig)
    expect(s.blinkState.isBlinking).toBe(true)
    expect(s.blinkState.blinkStartTime).toBe(1000)
    // A fresh nextBlinkTime is scheduled past the min interval.
    expect(s.blinkState.nextBlinkTime).toBeGreaterThanOrEqual(1000 + defaultEmoteConfig.blink.minInterval)

    // Mid-blink (halfway through the 150ms cycle) → eyelid influence near its sine peak.
    setNow(1075)
    updateBlinking(s, 0.016, defaultEmoteConfig)
    expect(s.targets.eyeBlinkLeft).toBeGreaterThan(0.9)
    expect(s.targets.eyeBlinkRight).toBeGreaterThan(0.9)
    // The blink drives the two lids only; eyesClosed belongs to emotion baselines (L6).
    expect(s.targets.eyesClosed ?? 0).toBe(0)
  })

  it('ends the blink and resets the eyelids after the cycle duration', () => {
    const s = freshState()
    s.blinkState.nextBlinkTime = 1000
    setNow(1000)
    updateBlinking(s, 0.016, defaultEmoteConfig)

    // Past the 150ms cycle → blink completes and eyelids relax to 0.
    setNow(1000 + defaultEmoteConfig.blink.cycleDuration + 1)
    updateBlinking(s, 0.016, defaultEmoteConfig)

    expect(s.blinkState.isBlinking).toBe(false)
    expect(s.targets.eyeBlinkLeft).toBe(0)
    expect(s.targets.eyeBlinkRight).toBe(0)
    expect(s.targets.eyesClosed ?? 0).toBe(0)
  })

  it('stacks the blink on a sleep baseline instead of snapping the lids open or shut (M13)', () => {
    const s = freshState()
    applyEmotion(s, 'sleep') // eyeBlinkLeft/Right 1, eyesClosed 0.6
    s.blinkState.nextBlinkTime = 1000

    // Blink start: the sine is 0 here, which must not open lids that sleep holds closed.
    setNow(1000)
    updateBlinking(s, 0.016, defaultEmoteConfig)
    expect(s.blinkState.isBlinking).toBe(true)
    expect(s.targets.eyeBlinkLeft).toBe(1)

    // Blink end: the lids return to the sleep baseline, not to zero.
    setNow(1000 + defaultEmoteConfig.blink.cycleDuration + 1)
    updateBlinking(s, 0.016, defaultEmoteConfig)
    expect(s.blinkState.isBlinking).toBe(false)
    expect(s.targets.eyeBlinkLeft).toBe(1)
    expect(s.targets.eyeBlinkRight).toBe(1)
    expect(s.targets.eyesClosed).toBe(0.6)
  })

  it('bails out safely when there is no targets object', () => {
    const s = freshState()
    ;(s as unknown as { targets: undefined }).targets = undefined
    expect(() => updateBlinking(s, 0.016, defaultEmoteConfig)).not.toThrow()
  })
})

describe('updateFacialTicks — deterministic tick advance', () => {
  it('does not throw and keeps tick targets within [0, intensity]', () => {
    const s = freshState()
    // Random is used for target selection + probability; pin it for determinism.
    vi.spyOn(Math, 'random').mockReturnValue(0)

    // Pick a time where sin(t / frequency) is clearly positive.
    setNow(defaultEmoteConfig.tick.frequency * (Math.PI / 2))
    expect(() => updateFacialTicks(s, 0.016, defaultEmoteConfig)).not.toThrow()

    if (s.tickState.currentTick) {
      const v = s.targets[s.tickState.currentTick] ?? 0
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(defaultEmoteConfig.tick.intensity)
    }
  })

  it('clears the active tick when the tick value collapses to ~0', () => {
    const s = freshState()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    s.tickState.currentTick = 'browDownLeft'

    // sin(0) = 0 → tickValue ≤ 0.01 → currentTick cleared.
    setNow(0)
    updateFacialTicks(s, 0.016, defaultEmoteConfig)

    expect(s.tickState.currentTick).toBeNull()
  })

  it('bails out safely when there is no targets object', () => {
    const s = freshState()
    ;(s as unknown as { targets: undefined }).targets = undefined
    expect(() => updateFacialTicks(s, 0.016, defaultEmoteConfig)).not.toThrow()
  })
})
