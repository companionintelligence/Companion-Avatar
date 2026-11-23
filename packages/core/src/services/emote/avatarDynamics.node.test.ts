import { describe, expect, it, vi } from 'vitest'

import { AvatarDynamicsEngine } from './avatarDynamics'

describe('AvatarDynamicsEngine render-layer behavior', () => {
  it('maps pointer tracking into gaze blendshapes and bounded neck motion', () => {
    const engine = new AvatarDynamicsEngine()
    const output = engine.update({
      elapsedTime: 0,
      delta: 1 / 60,
      pointerX: 1,
      pointerY: 1
    })

    expect(output.blendshapes.eyeLookInRight).toBeGreaterThan(0)
    expect(output.blendshapes.eyeLookOutLeft).toBeGreaterThan(0)
    expect(output.blendshapes.eyeLookUpLeft).toBeGreaterThan(0)
    expect(output.blendshapes.eyeLookUpRight).toBeGreaterThan(0)
    expect(Math.abs(output.boneRotations.Head.y)).toBeLessThanOrEqual(0.45)
    expect(Math.abs(output.boneRotations.Head.x)).toBeLessThanOrEqual(0.25)
  })

  it('couples vocal energy to brows, cheeks, and full-body rest posture', () => {
    const engine = new AvatarDynamicsEngine()
    const output = engine.update({
      elapsedTime: 1,
      delta: 1 / 60,
      audioState: {
        energy: 0.9,
        lowBand: 0.7,
        midBand: 0.8,
        highBand: 0.6,
        isSpeaking: true
      },
      conversationState: 'speaking'
    })

    expect(output.blendshapes.browInnerUp).toBeGreaterThan(0)
    expect(output.blendshapes.cheekSquintLeft).toBeGreaterThan(0)
    expect(output.boneRotations.LeftArm).toBeDefined()
    expect(output.boneRotations.LeftForeArm.x).toBeGreaterThan(0)
    expect(output.boneRotations.Spine2).toBeDefined()
  })

  it('adds attentive listening and thinking behavior without leaving stale face state', () => {
    const engine = new AvatarDynamicsEngine()
    const listening = engine.update({
      elapsedTime: 1,
      delta: 1 / 60,
      conversationState: 'listening'
    })
    const thinking = engine.update({
      elapsedTime: 1.1,
      delta: 1 / 60,
      conversationState: 'thinking'
    })

    expect(listening.blendshapes.browInnerUp).toBeGreaterThan(0)
    expect(thinking.blendshapes.eyeLookInRight).toBeGreaterThan(0)
    expect(thinking.boneRotations.Head.y).toBeGreaterThan(0)

    engine.reset()
    const idle = engine.update({ elapsedTime: 1.2, delta: 1 / 60 })
    expect(idle.blendshapes.browInnerUp).toBe(0)
    expect(idle.boneRotations.Head.y).toBeCloseTo(0, 4)
  })

  it('forces a semantic blink after speech ends', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const engine = new AvatarDynamicsEngine()
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    engine.update({ elapsedTime: 2.08, delta: 1 / 60, conversationState: 'idle' })
    const afterSpeech = engine.update({ elapsedTime: 2.12, delta: 1 / 60, conversationState: 'idle' })

    expect(afterSpeech.blendshapes.eyeBlinkLeft).toBeGreaterThan(0)
    expect(afterSpeech.blendshapes.eyeBlinkRight).toBeGreaterThan(0)
    vi.restoreAllMocks()
  })
})

describe('AvatarDynamicsEngine speech head motion', () => {
  const AMP = 2 * (Math.PI / 180)
  // Expected sway for a time counted from speech start: 0.3 times the amplitude, on a 5 s sine.
  const swayAt = (tSinceStartMs: number, amplitudeRad = AMP) =>
    0.3 * amplitudeRad * Math.sin((2 * Math.PI * tSinceStartMs) / 5000)

  it('adds a sway offset to the head while speaking', () => {
    const engine = new AvatarDynamicsEngine()
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    const output = engine.update({ elapsedTime: 2.5, delta: 1 / 60, conversationState: 'speaking' })

    expect(output.boneRotations.Head.y).toBeCloseTo(swayAt(1500), 6)
    expect(output.boneRotations.Head.y).not.toBe(0)
    // No phrase ends reach the engine yet, so there is no nod on the pitch channel.
    expect(output.boneRotations.Head.x).toBeCloseTo(0, 6)
  })

  it('leaves the head still while idle', () => {
    const engine = new AvatarDynamicsEngine()
    for (const elapsedTime of [1, 2.5, 6]) {
      const output = engine.update({ elapsedTime, delta: 1 / 60 })
      expect(output.boneRotations.Head.x).toBeCloseTo(0, 6)
      expect(output.boneRotations.Head.y).toBeCloseTo(0, 6)
    }
  })

  it('adds no speech offset when nods are disabled', () => {
    const engine = new AvatarDynamicsEngine({ speech: { nods: { enabled: false } } })
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    const output = engine.update({ elapsedTime: 2.5, delta: 1 / 60, conversationState: 'speaking' })

    expect(output.boneRotations.Head.x).toBeCloseTo(0, 6)
    expect(output.boneRotations.Head.y).toBeCloseTo(0, 6)
  })

  it('uses the configured amplitude', () => {
    const engine = new AvatarDynamicsEngine({ speech: { nods: { amplitudeDeg: 4 } } })
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    const output = engine.update({ elapsedTime: 2.5, delta: 1 / 60, conversationState: 'speaking' })

    expect(output.boneRotations.Head.y).toBeCloseTo(swayAt(1500, 2 * AMP), 6)
  })

  it('eases the head offset out once the silence has held', () => {
    const engine = new AvatarDynamicsEngine()
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    engine.update({ elapsedTime: 5.25, delta: 1 / 60, conversationState: 'idle' })
    // Silence began at 5.25 s. The sway holds through the first 400 ms of it.
    const holding = engine.update({ elapsedTime: 5.5, delta: 1 / 60, conversationState: 'idle' })
    // At 5.75 s the silence has lasted 500 ms, so the 250 ms ease-out starts there.
    engine.update({ elapsedTime: 5.75, delta: 1 / 60, conversationState: 'idle' })
    const halfway = engine.update({ elapsedTime: 5.875, delta: 1 / 60, conversationState: 'idle' })
    const done = engine.update({ elapsedTime: 6, delta: 1 / 60, conversationState: 'idle' })

    expect(holding.boneRotations.Head.y).toBeCloseTo(swayAt(4500), 6)
    expect(halfway.boneRotations.Head.y / swayAt(4875)).toBeCloseTo(0.5, 6)
    expect(done.boneRotations.Head.y).toBeCloseTo(0, 6)
  })

  it('keeps the sway through a short pause between words', () => {
    const engine = new AvatarDynamicsEngine()
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    engine.update({ elapsedTime: 2, delta: 1 / 60, conversationState: 'idle' })
    const resumed = engine.update({ elapsedTime: 2.25, delta: 1 / 60, conversationState: 'speaking' })

    // The window was not restarted, so the sway is still on its original 5 s cycle.
    expect(resumed.boneRotations.Head.y).toBeCloseTo(swayAt(1250), 6)
  })

  it('starts a new speech window after a full stop', () => {
    const engine = new AvatarDynamicsEngine()
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    engine.update({ elapsedTime: 2, delta: 1 / 60, conversationState: 'idle' })
    engine.update({ elapsedTime: 2.5, delta: 1 / 60, conversationState: 'idle' })
    engine.update({ elapsedTime: 3, delta: 1 / 60, conversationState: 'idle' })
    const restarted = engine.update({ elapsedTime: 4, delta: 1 / 60, conversationState: 'speaking' })
    const later = engine.update({ elapsedTime: 5.5, delta: 1 / 60, conversationState: 'speaking' })

    // The new window ramps in from zero at 4 s, then sways from its own start.
    expect(restarted.boneRotations.Head.y).toBeCloseTo(0, 6)
    expect(later.boneRotations.Head.y).toBeCloseTo(swayAt(1500), 6)
  })

  it('starts a fresh speech window after reset', () => {
    const engine = new AvatarDynamicsEngine()
    engine.update({ elapsedTime: 1, delta: 1 / 60, conversationState: 'speaking' })
    engine.update({ elapsedTime: 2.5, delta: 1 / 60, conversationState: 'speaking' })
    engine.reset()
    engine.update({ elapsedTime: 10, delta: 1 / 60, conversationState: 'speaking' })
    // Measured from the new speech start at 10 s, not from the old one at 1 s.
    const output = engine.update({ elapsedTime: 11.5, delta: 1 / 60, conversationState: 'speaking' })

    expect(output.boneRotations.Head.y).toBeCloseTo(swayAt(1500), 6)
  })
})
