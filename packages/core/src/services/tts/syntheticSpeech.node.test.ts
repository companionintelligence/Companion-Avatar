import { describe, expect, it } from 'vitest'

import { createSyntheticSpeechWav, syntheticSpeechDuration, syntheticWordTimings } from './syntheticSpeech'

describe('synthetic speech render probe', () => {
  it('creates a valid mono PCM WAV with deterministic voiced samples', () => {
    const first = createSyntheticSpeechWav('Hello render probe')
    const second = createSyntheticSpeechWav('Hello render probe')
    const bytes = new Uint8Array(first)

    expect(first.byteLength).toBeGreaterThan(44)
    expect(Array.from(bytes.slice(0, 4))).toEqual([82, 73, 70, 70])
    expect(Array.from(bytes.slice(8, 12))).toEqual([87, 65, 86, 69])
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second))

    const pcm = new Int16Array(first.slice(44))
    expect(pcm.some((sample) => sample !== 0)).toBe(true)
    expect(Math.max(...pcm)).toBeGreaterThan(1000)
    expect(Math.min(...pcm)).toBeLessThan(-1000)
  })

  it('keeps the render probe bounded and scales duration with text', () => {
    expect(syntheticSpeechDuration('')).toBe(0.7)
    expect(syntheticSpeechDuration('a'.repeat(500))).toBe(12)

    const short = createSyntheticSpeechWav('short', { sampleRate: 8000, duration: 1 })
    const long = createSyntheticSpeechWav('long', { sampleRate: 8000, duration: 2 })
    expect(short.byteLength).toBe(44 + 8000 * 2)
    expect(long.byteLength).toBe(44 + 16000 * 2)
  })
})

describe('synthetic word timings', () => {
  const sentence = 'Hello there, I am ready to help you with that.'

  it('names the words of the text in order', () => {
    const timings = syntheticWordTimings(sentence)
    expect(timings.words).toEqual(['Hello', 'there,', 'I', 'am', 'ready', 'to', 'help', 'you', 'with', 'that.'])
    expect(timings.wtimes).toHaveLength(timings.words.length)
    expect(timings.wdurations).toHaveLength(timings.words.length)
  })

  it('runs the words back to back, between the fades, inside the audio', () => {
    const duration = syntheticSpeechDuration(sentence)
    const { wtimes, wdurations } = syntheticWordTimings(sentence)

    // The waveform fades in over 50 ms and out over its last ~56 ms.
    expect(wtimes[0]).toBeCloseTo(50, 5)
    for (let index = 1; index < wtimes.length; index++) {
      expect(wtimes[index]).toBeCloseTo(wtimes[index - 1] + wdurations[index - 1], 6)
    }
    const end = wtimes[wtimes.length - 1] + wdurations[wdurations.length - 1]
    expect(end).toBeCloseTo(duration * 1000 - 1000 / 18, 5)
    expect(end).toBeLessThan(duration * 1000)
    expect(wdurations.every((value) => value > 0)).toBe(true)
  })

  it('gives a longer word more time, and a one-letter word enough to show a shape', () => {
    const { words, wdurations } = syntheticWordTimings('I wonderful')
    expect(words).toEqual(['I', 'wonderful'])
    expect(wdurations[1]).toBeGreaterThan(wdurations[0])
    // "I" is weighted as three letters, "wonderful" as nine.
    expect(wdurations[0] / wdurations[1]).toBeCloseTo(3 / 9, 6)
  })

  it('is the same every time, and follows the duration it is given', () => {
    expect(syntheticWordTimings(sentence)).toEqual(syntheticWordTimings(sentence))
    const slow = syntheticWordTimings(sentence, 6)
    const fast = syntheticWordTimings(sentence, 3)
    expect(slow.wtimes[slow.wtimes.length - 1]).toBeGreaterThan(fast.wtimes[fast.wtimes.length - 1])
  })

  it('has nothing to time for no words, and stays inside a very short clip', () => {
    expect(syntheticWordTimings('   ')).toEqual({ words: [], wtimes: [], wdurations: [] })
    expect(syntheticWordTimings('hello', 0)).toEqual({ words: [], wtimes: [], wdurations: [] })

    const short = syntheticWordTimings('a b c', 0.1)
    const end = short.wtimes[2] + short.wdurations[2]
    expect(short.wtimes[0]).toBeGreaterThanOrEqual(0)
    expect(end).toBeLessThanOrEqual(100)
  })
})
