import { describe, expect, it } from 'vitest'

import type { ConversationStatus } from '../../../../services/conversation/conversationStatus'
import { ORB_MAX_RINGS, ORB_MAX_STEP, ORB_RING_LIFE, OrbMotion, type OrbFrame, type OrbInput } from './orbMotion'

const FRAME = 1 / 60

const silent = (status: ConversationStatus = 'idle', reducedMotion = false): OrbInput => ({
  status,
  speaking: false,
  energy: 0,
  high: 0,
  reducedMotion
})

const voice = (energy: number, reducedMotion = false): OrbInput => ({
  status: 'speaking',
  speaking: true,
  energy,
  high: energy / 2,
  reducedMotion
})

/** Run `seconds` of frames, calling `input` for each frame's input; returns copies of every frame. */
function run(motion: OrbMotion, seconds: number, input: (t: number) => OrbInput): OrbFrame[] {
  const frames: OrbFrame[] = []
  const count = Math.round(seconds / FRAME)
  for (let i = 0; i < count; i++) {
    const frame = motion.step(input(i * FRAME), FRAME)
    frames.push({ ...frame, rings: frame.rings.map((ring) => ({ ...ring })) })
  }
  return frames
}

/** Syllables: loud for 0.15 s, quiet for 0.15 s. */
const syllables = (t: number, reducedMotion = false) => voice(Math.floor(t / 0.15) % 2 === 0 ? 0.8 : 0.08, reducedMotion)

const settled = (motion: OrbMotion, status: ConversationStatus) => run(motion, 3, () => silent(status)).at(-1)!

/** The average of one number across frames: phases of the breath make single frames a poor comparison. */
const mean = (frames: OrbFrame[], key: 'glow' | 'light'): number =>
  frames.reduce((sum, frame) => sum + frame[key], 0) / frames.length

describe('OrbMotion', () => {
  it('floats and breathes at rest, with no rings', () => {
    const frames = run(new OrbMotion(), 8, () => silent())
    for (const frame of frames) {
      expect(frame.rings).toHaveLength(0)
      expect(Math.abs(frame.scale - 1)).toBeLessThanOrEqual(0.03)
      expect(Math.abs(frame.lift)).toBeLessThanOrEqual(0.012)
    }
    const lifts = frames.map((frame) => frame.lift)
    expect(Math.max(...lifts) - Math.min(...lifts)).toBeGreaterThan(0.02)
  })

  it('sends a ring out on syllables while it speaks, never more than six at once', () => {
    const motion = new OrbMotion()
    let emitted = 0
    let previous = 0
    for (const frame of run(motion, 3, (t) => syllables(t))) {
      expect(frame.rings.length).toBeLessThanOrEqual(ORB_MAX_RINGS)
      // A ring is returned at age 0 on the frame it leaves the ball, and has aged by the next one.
      const fresh = frame.rings.filter((ring) => ring.age === 0).length
      emitted += fresh
      previous = frame.rings.length
    }
    // Ten syllables in three seconds, one every 0.3 s. Rings are at least 0.4 s apart, so about every other syllable
    // rings: seven, at 0, 0.4, 0.9, 1.3, 1.8, 2.2 and 2.7 s.
    expect(emitted).toBeGreaterThanOrEqual(5)
    expect(emitted).toBeLessThanOrEqual(9)
    expect(previous).toBeGreaterThan(0)
  })

  it('lets the rings fade out once the voice stops', () => {
    const motion = new OrbMotion()
    run(motion, 1, (t) => syllables(t))
    const after = run(motion, ORB_RING_LIFE + 0.05, () => silent())
    expect(after.at(-1)!.rings).toHaveLength(0)
    for (const ring of after[0].rings) {
      expect(ring.age).toBeGreaterThan(0)
      expect(ring.age).toBeLessThan(1)
      expect(ring.strength).toBeGreaterThan(0)
      expect(ring.strength).toBeLessThanOrEqual(1)
    }
  })

  it('rises with a syllable at once and falls back over about a tenth of a second', () => {
    const motion = new OrbMotion()
    const loud = run(motion, 0.1, () => voice(1)).at(-1)!
    expect(loud.voice).toBeGreaterThan(0.9)
    expect(loud.scale).toBeGreaterThan(1.12)
    const quiet = run(motion, 0.1, () => silent('speaking')).at(-1)!
    expect(quiet.voice).toBeGreaterThan(0.3)
    expect(quiet.voice).toBeLessThan(0.7)
    expect(run(motion, 1, () => silent('speaking')).at(-1)!.voice).toBeLessThan(0.01)
  })

  it('is brighter while it speaks than at rest', () => {
    const rest = run(new OrbMotion(), 4, () => silent()).slice(-120)
    const motion = new OrbMotion()
    run(motion, 1, () => voice(0.7))
    const speaking = run(motion, 2, () => voice(0.7))
    expect(mean(speaking, 'glow')).toBeGreaterThan(mean(rest, 'glow') + 0.3)
    expect(mean(speaking, 'light')).toBeGreaterThan(mean(rest, 'light'))
  })

  it('races its filaments while it thinks, and brightens them while it listens', () => {
    const idle = new OrbMotion()
    const thinking = new OrbMotion()
    const listening = new OrbMotion()
    const idleStart = settled(idle, 'idle').flow
    const thinkingStart = settled(thinking, 'thinking').flow
    const idleFlow = run(idle, 1, () => silent('idle')).at(-1)!.flow - idleStart
    const thinkingFlow = run(thinking, 1, () => silent('thinking')).at(-1)!.flow - thinkingStart
    expect(thinkingFlow).toBeGreaterThan(3 * idleFlow)
    expect(settled(listening, 'listening').churn).toBeGreaterThan(settled(new OrbMotion(), 'idle').churn + 0.3)
  })

  it('under reduced motion does not float or ring, and its glow still answers the voice', () => {
    const motion = new OrbMotion()
    const rest = run(motion, 4, () => silent('idle', true)).slice(-120)
    for (const frame of run(motion, 2, (t) => syllables(t, true))) {
      expect(frame.rings).toHaveLength(0)
      expect(frame.lift).toBe(0)
      expect(frame.drift).toBe(0)
      expect(frame.scale).toBeLessThanOrEqual(1.04)
    }
    const speaking = run(motion, 2, () => voice(0.8, true))
    expect(mean(speaking, 'glow')).toBeGreaterThan(mean(rest, 'glow') + 0.3)
  })

  it('takes a long frame as one short step, so a tab coming back does not jump', () => {
    const motion = new OrbMotion()
    const before = settled(motion, 'idle').flow
    const after = motion.step(silent('thinking'), 30).flow
    // At most one ORB_MAX_STEP of flow at the fastest mood's swirl, rather than thirty seconds of it.
    expect(after - before).toBeLessThanOrEqual(ORB_MAX_STEP * 2 + 1e-9)
    expect(after - before).toBeGreaterThan(0)
  })

  it('takes bad readings as silence', () => {
    const motion = new OrbMotion()
    const frames = run(motion, 1, () => ({ ...voice(Number.NaN), high: Number.POSITIVE_INFINITY }))
    for (const frame of frames) {
      expect(frame.voice).toBe(0)
      expect(frame.rings).toHaveLength(0)
      expect(Number.isFinite(frame.glow)).toBe(true)
    }
    expect(motion.step(silent(), Number.NaN).scale).toBeGreaterThan(0)
  })

  it('flashes and rings when touched, even in silence; only flashes under reduced motion', () => {
    const motion = new OrbMotion()
    const rest = settled(motion, 'idle').glow
    motion.poke()
    const touched = motion.step(silent(), FRAME)
    expect(touched.rings).toHaveLength(1)
    expect(touched.glow).toBeGreaterThan(rest + 0.4)

    const calm = new OrbMotion()
    run(calm, 3, () => silent('idle', true))
    calm.poke()
    const calmTouched = calm.step(silent('idle', true), FRAME)
    expect(calmTouched.rings).toHaveLength(0)
    expect(calmTouched.glow).toBeGreaterThan(rest + 0.4)
  })
})
