import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Barge-in / interruption coverage for the TTS queue.
 *
 *  - C1: after a barge-in (stopSpeaking) clears the queue mid-playback, a fresh
 *        speak() must still play. The regression was that the interrupted audio's
 *        completion handler resumed and clobbered `nextExpectedId`, so every later
 *        message id stopped matching and all speech went silent. A stop that lands
 *        while a buffer is still resuming or decoding must not start that buffer later.
 *  - H4: stopSpeaking must stop the AudioBufferSourceNode that is actually playing,
 *        not merely empty the queue.
 *  - Id gaps: speak() must not take a queue id for text that cleans to nothing (a bare
 *        `---` or `**`). processQueue only ever looks for `nextExpectedId`, so an id that
 *        was handed out but never queued stalled every message after it — the same
 *        silence as C1, reached through speak() instead of through a barge-in.
 *
 * These exercise the real hook against a mocked Web Audio + fetch surface. Because
 * the queue keys on a module-global id counter, each test re-imports the module so
 * the counter starts from 0 and a freshly-mounted hook's cursor lines up.
 */

// ---- Web Audio mock -------------------------------------------------------

class MockGainNode {
  gain = { value: 0 }
  connect() {}
  disconnect() {}
}

class MockAudioBufferSourceNode {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  connect() {}
  disconnect() {}
  start() {
    this.started = true
    MockAudioContext.startedSources.push(this)
  }
  stop() {
    // Browser semantics: a second stop() throws; stopping fires 'ended'.
    if (this.stopped) throw new Error('cannot stop twice')
    this.stopped = true
    this.onended?.()
  }
}

class MockAnalyserNode {
  fftSize = 256
  frequencyBinCount = 128
  smoothingTimeConstant = 0.8
  connect() {}
  disconnect() {}
  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(0)
  }
}

class MockAudioContext {
  static startedSources: MockAudioBufferSourceNode[] = []
  // When held, decodeAudioData stays pending until a test releases it, so a barge-in
  // can land while playAudioBuffer is still between its awaits.
  static holdDecodes = false
  static heldDecodes: Array<() => void> = []
  // A context created before a user gesture starts suspended; resume() then stays
  // pending until a test releases it.
  static startSuspended = false
  static heldResumes: Array<() => void> = []
  state: 'suspended' | 'running'
  currentTime = 0
  destination = {}
  constructor() {
    this.state = MockAudioContext.startSuspended ? 'suspended' : 'running'
  }
  resume() {
    return new Promise<void>((resolve) => {
      MockAudioContext.heldResumes.push(() => {
        this.state = 'running'
        resolve()
      })
    })
  }
  createGain() {
    return new MockGainNode()
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode()
  }
  createAnalyser() {
    return new MockAnalyserNode()
  }
  decodeAudioData(_buffer: ArrayBuffer) {
    const decoded = { duration: 1 } as AudioBuffer
    if (!MockAudioContext.holdDecodes) return Promise.resolve(decoded)
    return new Promise<AudioBuffer>((resolve) => {
      MockAudioContext.heldDecodes.push(() => resolve(decoded))
    })
  }
  close() {
    return Promise.resolve()
  }
}

// Drain all pending microtasks by crossing a macrotask boundary.
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const spokenTexts = (fn: ReturnType<typeof vi.fn>): string[] => fn.mock.calls.map((call) => call[0] as string)

// A genuine `Response`, not a plain object literal — so if ttsService's fetch
// handling ever starts reading `.headers` (or any other real Response member),
// this mock keeps exercising it instead of silently drifting out of sync with
// what `fetch` actually returns.
function mockFetchResponse(body: BodyInit = new ArrayBuffer(8), init?: ResponseInit): Response {
  return new Response(body, { status: 200, statusText: 'OK', ...init })
}

let useTTSService: typeof import('./ttsService').useTTSService

beforeEach(async () => {
  MockAudioContext.startedSources = []
  MockAudioContext.holdDecodes = false
  MockAudioContext.heldDecodes = []
  MockAudioContext.startSuspended = false
  MockAudioContext.heldResumes = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext
  globalThis.fetch = vi.fn(async () => mockFetchResponse()) as unknown as typeof fetch

  // Fresh module → module-global id counter resets to 0.
  vi.resetModules()
  ;({ useTTSService } = await import('./ttsService'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TTS barge-in', () => {
  it('H4: stopSpeaking stops the audio source that is currently playing', async () => {
    const { result } = renderHook(() => useTTSService({ config: { mode: 'remote' } }))

    await act(async () => {
      await result.current.actions.speak('hello there friend')
    })
    await flush()

    const source = MockAudioContext.startedSources[0]
    expect(source).toBeTruthy()
    expect(source.started).toBe(true)
    expect(source.stopped).toBe(false)

    await act(async () => {
      result.current.actions.stopSpeaking()
    })

    // The in-flight utterance is actually cut off, not just dequeued.
    expect(source.stopped).toBe(true)
  })

  it('C1: a stop() mid-playback then a new speak() still plays', async () => {
    const onSpeechStart = vi.fn()
    const { result } = renderHook(() =>
      useTTSService({ config: { mode: 'remote' }, onSpeechStart })
    )

    // Enqueue several utterances; remote mode plays them one at a time, so only the
    // first reaches playback while the others wait behind it.
    await act(async () => {
      await result.current.actions.speak('one')
      await result.current.actions.speak('two')
      await result.current.actions.speak('three')
    })
    await flush()

    expect(spokenTexts(onSpeechStart)).toContain('one')
    const firstSource = MockAudioContext.startedSources[0]
    expect(firstSource).toBeTruthy()

    // Barge-in: clear the queue while the first utterance is still playing.
    await act(async () => {
      result.current.actions.stopSpeaking()
    })
    await flush()

    // Simulate the interrupted audio finishing *after* the barge-in. On the buggy
    // code this is exactly when the stale loop advanced nextExpectedId to a value
    // no future message id could match.
    await act(async () => {
      firstSource.onended?.()
    })
    await flush()

    // A brand-new utterance enqueued after the barge-in must play.
    await act(async () => {
      await result.current.actions.speak('four')
    })
    await flush()

    expect(spokenTexts(onSpeechStart)).toContain('four')
  })

  it('C1: a barge-in while the stale buffer is still decoding does not start it', async () => {
    MockAudioContext.holdDecodes = true
    const { result } = renderHook(() => useTTSService({ config: { mode: 'remote' } }))

    await act(async () => {
      await result.current.actions.speak('one')
    })
    await flush()

    // 'one' is waiting on decodeAudioData, so no source exists yet for stop() to cut off.
    expect(MockAudioContext.heldDecodes).toHaveLength(1)
    expect(MockAudioContext.startedSources).toHaveLength(0)

    await act(async () => {
      result.current.actions.stopSpeaking()
    })

    // The decode lands after the barge-in. The stale buffer must not become a live source.
    await act(async () => {
      MockAudioContext.heldDecodes.shift()?.()
    })
    await flush()
    expect(MockAudioContext.startedSources).toHaveLength(0)

    // Speech enqueued after the barge-in still plays through its own decode.
    await act(async () => {
      await result.current.actions.speak('two')
    })
    await flush()
    await act(async () => {
      MockAudioContext.heldDecodes.shift()?.()
    })
    await flush()
    expect(MockAudioContext.startedSources).toHaveLength(1)
  })

  it('C1: a barge-in while the context is still resuming does not start the stale buffer', async () => {
    MockAudioContext.startSuspended = true
    const { result } = renderHook(() => useTTSService({ config: { mode: 'remote' } }))

    await act(async () => {
      await result.current.actions.speak('one')
    })
    await flush()

    // 'one' is waiting on resume(), so no source exists yet for stop() to cut off.
    expect(MockAudioContext.heldResumes).toHaveLength(1)

    await act(async () => {
      result.current.actions.stopSpeaking()
    })

    // The context resumes after the barge-in. The stale buffer must not start.
    await act(async () => {
      MockAudioContext.heldResumes.shift()?.()
    })
    await flush()
    expect(MockAudioContext.startedSources).toHaveLength(0)
  })
})

describe('TTS queue ids', () => {
  // `cleanText` strips `* < > # % -`, so each of these is non-blank going in and blank
  // coming out. `---` is a markdown rule: a reply that ends in one is enough to hit
  // this. `* * *` is the same rule spelled with spaces, so cleaning leaves spaces
  // rather than an empty string and only a trim() afterwards sees it as empty.
  it.each(['---', '**', '* * *'])(
    'speak(%j) takes no id, so the speech after it still plays',
    async (silent) => {
      const onSpeechStart = vi.fn()
      const { result } = renderHook(() =>
        useTTSService({ config: { mode: 'remote' }, onSpeechStart })
      )

      let silentId: number | null | undefined
      await act(async () => {
        silentId = await result.current.actions.speak(silent)
        await result.current.actions.speak('hello there')
      })
      await flush()

      // The silent text is never queued. If it still took an id, processQueue would
      // wait on that id forever and 'hello there' would never start.
      expect(spokenTexts(onSpeechStart)).toEqual(['hello there'])
      expect(silentId).toBeNull()
    }
  )
})
