import { describe, expect, it } from 'vitest'

import { speechNodOffset } from './speechNods'

const DEG = Math.PI / 180
const AMP = 2 * DEG

// Sway is 0.3 times the amplitude times sin(2 pi t / 5000 ms), with t counted from speech start.
const sway = (tSinceStartMs: number, amplitudeRad = AMP) =>
  0.3 * amplitudeRad * Math.sin((2 * Math.PI * tSinceStartMs) / 5000)

describe('speechNodOffset', () => {
  it('is zero when the avatar is not speaking', () => {
    for (const tMs of [0, 1000, 99999]) {
      expect(speechNodOffset({ tMs, speakingSinceMs: null, phraseEndsMs: [1000] })).toEqual({
        pitchRad: 0,
        yawRad: 0
      })
    }
  })

  it('is zero before speech starts and once the ease-out has finished', () => {
    expect(speechNodOffset({ tMs: 900, speakingSinceMs: 1000, phraseEndsMs: [1000] })).toEqual({
      pitchRad: 0,
      yawRad: 0
    })
    expect(speechNodOffset({ tMs: 10250, speakingSinceMs: 0, speakingUntilMs: 10000 })).toEqual({
      pitchRad: 0,
      yawRad: 0
    })
    expect(speechNodOffset({ tMs: 20000, speakingSinceMs: 0, speakingUntilMs: 10000 })).toEqual({
      pitchRad: 0,
      yawRad: 0
    })
  })

  it('nods at a phrase end, peaking about 170 ms after it', () => {
    let peak = 0
    let peakMs = -1
    for (let t = 1000; t <= 1400; t += 1) {
      const { pitchRad } = speechNodOffset({ tMs: t, speakingSinceMs: 0, phraseEndsMs: [1000] })
      if (pitchRad > peak) {
        peak = pitchRad
        peakMs = t
      }
    }

    expect(Math.abs(peakMs - (1000 + 170))).toBeLessThanOrEqual(20)
    expect(peak).toBeCloseTo(AMP, 3)
    expect(speechNodOffset({ tMs: 1000, speakingSinceMs: 0, phraseEndsMs: [1000] }).pitchRad).toBe(0)
    expect(speechNodOffset({ tMs: 1350, speakingSinceMs: 0, phraseEndsMs: [1000] }).pitchRad).toBe(0)
  })

  it('leaves yaw to the sway, so a nod does not turn the head', () => {
    const withNod = speechNodOffset({ tMs: 1175, speakingSinceMs: 0, phraseEndsMs: [1000] })
    const withoutNod = speechNodOffset({ tMs: 1175, speakingSinceMs: 0, phraseEndsMs: [] })

    expect(withNod.yawRad).toBe(withoutNod.yawRad)
    expect(withNod.pitchRad).toBeGreaterThan(withoutNod.pitchRad)
  })

  it('sways yaw at 0.3 times the 2 degree default amplitude over a 5 second period', () => {
    // 1250 ms into speech the sine is at its crest.
    expect(speechNodOffset({ tMs: 1250, speakingSinceMs: 0 }).yawRad).toBeCloseTo(0.3 * AMP, 10)
    expect(speechNodOffset({ tMs: 3750, speakingSinceMs: 0 }).yawRad).toBeCloseTo(-0.3 * AMP, 10)
    // The phase counts from speech start, not from the clock's zero.
    expect(speechNodOffset({ tMs: 6250, speakingSinceMs: 5000 }).yawRad).toBeCloseTo(0.3 * AMP, 10)
  })

  it('scales the nod and the sway with amplitudeDeg', () => {
    const at = speechNodOffset({ tMs: 1250, speakingSinceMs: 0, amplitudeDeg: 4 })
    expect(at.yawRad).toBeCloseTo(0.3 * 4 * DEG, 10)

    const nod = speechNodOffset({ tMs: 1175, speakingSinceMs: 0, phraseEndsMs: [1000], amplitudeDeg: 4 })
    expect(nod.pitchRad).toBeCloseTo(4 * DEG, 3)
  })

  it('keeps the sway and the nod within the amplitude over a long stretch', () => {
    for (let t = 0; t <= 20000; t += 37) {
      const { pitchRad, yawRad } = speechNodOffset({
        tMs: t,
        speakingSinceMs: 0,
        phraseEndsMs: [2000, 7300, 13000]
      })
      expect(Math.abs(yawRad)).toBeLessThanOrEqual(AMP + 1e-12)
      expect(Math.abs(yawRad)).toBeLessThanOrEqual(0.3 * AMP + 1e-12)
      expect(pitchRad).toBeGreaterThanOrEqual(0)
      expect(pitchRad).toBeLessThanOrEqual(AMP + 1e-12)
    }
  })

  it('does not stack overlapping nods past the amplitude', () => {
    // The nods for phrase ends 25 ms apart overlap at 1200 ms. The deeper one wins, not the sum.
    const { pitchRad } = speechNodOffset({ tMs: 1200, speakingSinceMs: 0, phraseEndsMs: [1000, 1025] })
    expect(pitchRad).toBeLessThanOrEqual(AMP + 1e-12)
  })

  it('ignores a phrase end from before the speech started', () => {
    // 900 ms falls outside this speech, though its dip would still reach 1100 ms.
    const { pitchRad } = speechNodOffset({ tMs: 1100, speakingSinceMs: 1000, phraseEndsMs: [900] })
    expect(pitchRad).toBe(0)
  })

  it('ramps in over 250 ms from speech start', () => {
    // Half-way through the ramp the offset is half the sway; at 250 ms it is the full sway.
    const half = speechNodOffset({ tMs: 125, speakingSinceMs: 0 }).yawRad
    expect(half / sway(125)).toBeCloseTo(0.5, 6)
    const full = speechNodOffset({ tMs: 250, speakingSinceMs: 0 }).yawRad
    expect(full / sway(250)).toBeCloseTo(1, 6)
  })

  it('ramps out over 250 ms from speech end', () => {
    // Speech ends at 10000 ms, so half-way out of the ramp is 125 ms later.
    const halfway = speechNodOffset({ tMs: 10125, speakingSinceMs: 0, speakingUntilMs: 10000 }).yawRad
    expect(halfway / sway(10125)).toBeCloseTo(0.5, 6)
    const beforeEnd = speechNodOffset({ tMs: 9999, speakingSinceMs: 0, speakingUntilMs: 10000 }).yawRad
    expect(beforeEnd / sway(9999)).toBeCloseTo(1, 6)
  })
})
