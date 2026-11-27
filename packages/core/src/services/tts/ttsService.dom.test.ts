import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TTSConfig } from './ttsConfig'
import { LOCAL_TTS_SILENCE_MS, type VitsReply, type VitsRequest } from './vitsMessages'
import { DEFAULT_VITS_VOICE } from './vitsVoice'

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

// ---- Worker mock (the VITS engine, mode 'local') --------------------------

/** A message the mock worker sends: `data` after `after` ms, as a 'message' event, or as an 'error' event. */
interface MockReply {
  after: number
  data?: VitsReply
  error?: string
}

/**
 * Records what the hook posts and answers the way vits.worker.ts does. By default each request gets its audio at
 * once; a test sets `MockWorker.replies` to script errors, progress, answers out of order, or silence.
 */
class MockWorker {
  static posted: VitsRequest[] = []
  static replies: (request: VitsRequest) => MockReply[] = (request) => [
    { after: 0, data: { id: request.id, audio: new ArrayBuffer(8) } }
  ]
  static instances: MockWorker[] = []
  terminated = false
  private listeners = new Map<string, Array<(event: unknown) => void>>()
  constructor() {
    MockWorker.instances.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener))
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0)
  }
  postMessage(request: VitsRequest) {
    MockWorker.posted.push(request)
    for (const reply of MockWorker.replies(request)) {
      setTimeout(() => {
        if (this.terminated) return
        const type = reply.error === undefined ? 'message' : 'error'
        const event = reply.error === undefined ? { data: reply.data } : { message: reply.error }
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
      }, reply.after)
    }
  }
  terminate() {
    this.terminated = true
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
  MockWorker.posted = []
  MockWorker.instances = []
  MockWorker.replies = (request) => [{ after: 0, data: { id: request.id, audio: new ArrayBuffer(8) } }]
  globalThis.Worker = MockWorker as unknown as typeof Worker

  // Fresh module → module-global id counter resets to 0.
  vi.resetModules()
  ;({ useTTSService } = await import('./ttsService'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('synthetic engine', () => {
  it('reports its own word timings while it plays, and a remote one reports none', async () => {
    const { result } = renderHook(() => useTTSService({ config: { mode: 'synthetic', volume: 1 } }))
    await act(async () => {
      await result.current.actions.speak('hello there my good friend')
    })
    await flush()

    // The mocked source never ends on its own, so the utterance is still in flight.
    expect(MockAudioContext.startedSources).toHaveLength(1)
    const timings = result.current.actions.getSpeechTimings()
    expect(timings?.words).toEqual(['hello', 'there', 'my', 'good', 'friend'])
    expect(timings?.revision).toBeGreaterThan(0)
    const starts = timings?.wtimes ?? []
    expect(starts.every((value, index) => index === 0 || value > starts[index - 1])).toBe(true)

    const remote = renderHook(() => useTTSService({ config: { mode: 'remote' } }))
    await act(async () => {
      await remote.result.current.actions.speak('hello there my good friend')
    })
    await flush()
    expect(remote.result.current.actions.getSpeechTimings()).toBeNull()
  })
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

describe('the voice each engine is asked for', () => {
  // A local or Pocket message is generated first; the queue looks again every 100 ms until it is ready.
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
  }

  async function speakOnce(config: Partial<TTSConfig>) {
    const { result } = renderHook(() => useTTSService({ config }))
    await act(async () => {
      await result.current.actions.speak('hello there')
    })
    await settle()
  }

  const sentInit = () => vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit | undefined

  it('asks the VITS worker for a Piper voice by default, and plays what it answers', async () => {
    await speakOnce({ mode: 'local' })
    // It used to be sent 'marius', which vits-web has no model for, and the worker never answered.
    expect(MockWorker.posted).toEqual([{ id: 0, text: 'hello there', voice: DEFAULT_VITS_VOICE }])
    expect(MockAudioContext.startedSources).toHaveLength(1)
  })

  it('passes a configured voice to the VITS worker as given', async () => {
    await speakOnce({ mode: 'local', voice: 'en_US-amy-medium' })
    expect(MockWorker.posted.map((request) => request.voice)).toEqual(['en_US-amy-medium'])
  })

  it('still sends remote mode marius by default', async () => {
    await speakOnce({ mode: 'remote' })
    expect(JSON.parse(String(sentInit()?.body))).toMatchObject({ text: 'hello there', voice: 'marius' })
  })

  it('still sends Pocket TTS its own voice, marius by default', async () => {
    await speakOnce({ mode: 'pocket' })
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe('http://localhost:8000/tts')
    expect((sentInit()?.body as FormData).get('voice_url')).toBe('marius')
    expect(MockWorker.posted).toEqual([])
  })
})

describe('local TTS: every sentence ends, whatever the worker does', () => {
  const audio = () => new ArrayBuffer(8)

  async function speakAll(texts: string[]) {
    const onSpeechStart = vi.fn()
    const onSpeechEnd = vi.fn()
    const hook = renderHook(() => useTTSService({ config: { mode: 'local' }, onSpeechStart, onSpeechEnd }))
    await act(async () => {
      for (const text of texts) await hook.result.current.actions.speak(text)
    })
    return { ...hook, onSpeechStart, onSpeechEnd }
  }

  // Fake timers throughout: the queue looks again every 100 ms, and the silence limit is a minute.
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('skips a sentence the worker answers with an error, and plays the next', async () => {
    MockWorker.replies = (request) => [
      request.id === 0
        ? { after: 0, data: { id: 0, error: 'Failed to fetch' } }
        : { after: 0, data: { id: request.id, audio: audio() } }
    ]
    const { onSpeechStart } = await speakAll(['first sentence', 'second sentence'])
    await advance(500)
    expect(spokenTexts(onSpeechStart)).toEqual(['second sentence'])
    expect(MockAudioContext.startedSources).toHaveLength(1)
    expect(MockWorker.instances[0].listenerCount()).toBe(0)
  })

  it('gives each answer to its own sentence when they come back out of order', async () => {
    // The second sentence fails first. That error used to reject the first sentence as well, so neither played.
    MockWorker.replies = (request) =>
      request.id === 0
        ? [{ after: 50, data: { id: 0, audio: audio() } }]
        : [{ after: 0, data: { id: 1, error: 'Failed to fetch' } }]
    const { onSpeechStart } = await speakAll(['first sentence', 'second sentence'])
    await advance(500)
    expect(spokenTexts(onSpeechStart)).toEqual(['first sentence'])
  })

  it('gives a sentence up when the worker goes silent, and the queue moves on', async () => {
    // vits-web's predict() can stay pending for good (vitsMessages.ts); the worker then never answers it.
    MockWorker.replies = (request) => (request.id === 0 ? [] : [{ after: 0, data: { id: request.id, audio: audio() } }])
    const { onSpeechStart } = await speakAll(['first sentence', 'second sentence'])
    await advance(LOCAL_TTS_SILENCE_MS - 1_000)
    expect(spokenTexts(onSpeechStart)).toEqual([])
    await advance(2_000)
    expect(spokenTexts(onSpeechStart)).toEqual(['second sentence'])
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain(`the worker sent nothing for ${LOCAL_TTS_SILENCE_MS / 1000} s`)
  })

  it('gives up the sentences waiting behind one that never ends, and speaks the next reply with a new worker', async () => {
    // The worker speaks one sentence at a time, so behind a predict() that never settles it answers nothing at all.
    MockWorker.replies = () => []
    const { result, onSpeechStart } = await speakAll(['first sentence', 'second sentence', 'third sentence'])
    await advance(LOCAL_TTS_SILENCE_MS - 1_000)
    expect(result.current.actions.getQueueStatus().queueLength).toBe(3)
    await advance(2_000)
    expect(result.current.actions.getQueueStatus().queueLength).toBe(0)
    expect(MockWorker.instances[0].terminated).toBe(true)
    expect(MockWorker.instances[0].listenerCount()).toBe(0)

    MockWorker.replies = (request) => [{ after: 0, data: { id: request.id, audio: audio() } }]
    await act(async () => {
      await result.current.actions.speak('the next reply')
    })
    await advance(500)
    expect(MockWorker.instances).toHaveLength(2)
    expect(spokenTexts(onSpeechStart)).toEqual(['the next reply'])
  })

  it('keeps the sentences behind a slow first download waiting while it reports progress, then plays each in turn', async () => {
    // One at a time: the first sentence downloads the voice for 200 s and reports progress every 30 s. The others
    // hear nothing of their own until it is done, then follow a second apart.
    MockWorker.replies = (request) =>
      request.id === 0
        ? [
            ...[1, 2, 3, 4, 5, 6].map((n) => ({ after: n * 30_000, data: { id: 0, progress: { loaded: n, total: 7 } } })),
            { after: 200_000, data: { id: 0, audio: audio() } }
          ]
        : [{ after: 200_000 + request.id * 1_000, data: { id: request.id, audio: audio() } }]
    const { result, onSpeechStart } = await speakAll(['first sentence', 'second sentence', 'third sentence'])
    await advance(203_000)
    expect(result.current.actions.getQueueStatus().messages.map((message) => message.status)).toEqual([
      'playing',
      'ready',
      'ready'
    ])
    // The mocked sources never end on their own: end each one, and the next sentence plays.
    for (const index of [0, 1]) {
      await act(async () => {
        MockAudioContext.startedSources[index].onended?.()
      })
      await advance(200)
    }
    expect(spokenTexts(onSpeechStart)).toEqual(['first sentence', 'second sentence', 'third sentence'])
  })

  it('keeps waiting while the worker reports download progress', async () => {
    // A slow first download: a progress note every 30 s for three minutes, then the audio.
    MockWorker.replies = (request) => [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ after: n * 30_000, data: { id: request.id, progress: { loaded: n, total: 7 } } })),
      { after: 200_000, data: { id: request.id, audio: audio() } }
    ]
    const { onSpeechStart } = await speakAll(['a slow first download'])
    await advance(199_000)
    expect(spokenTexts(onSpeechStart)).toEqual([])
    await advance(1_500)
    expect(spokenTexts(onSpeechStart)).toEqual(['a slow first download'])
  })

  it('ends every sentence in the worker when the worker itself fails', async () => {
    // A blocked phonemizer download throws inside the worker, which fires its 'error' event.
    MockWorker.replies = (request) => (request.id === 0 ? [{ after: 0, error: 'NetworkError for: piper_phonemize.data' }] : [])
    const { onSpeechStart, onSpeechEnd } = await speakAll(['first sentence', 'second sentence'])
    await advance(500)
    expect(spokenTexts(onSpeechStart)).toEqual([])
    expect(onSpeechEnd).toHaveBeenCalled()
    expect(MockWorker.instances[0].listenerCount()).toBe(0)
  })

  it('gives the waiting sentences up quietly when a barge-in ends the worker', async () => {
    MockWorker.replies = () => []
    const { result } = await speakAll(['first sentence', 'second sentence'])
    await act(async () => {
      result.current.actions.stopSpeaking()
    })
    await advance(LOCAL_TTS_SILENCE_MS * 2)
    expect(MockWorker.instances[0].terminated).toBe(true)
    expect(MockWorker.instances[0].listenerCount()).toBe(0)
    // Without this, each waiting sentence would log a failure a minute after the user cut in.
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toContain('Error generating audio')
  })

  it('starts a new worker for the next sentence after one fails, and ends the failed one', async () => {
    // onnxruntime keeps a failed start for the life of the worker, so the same worker would fail again.
    MockWorker.replies = (request) => [
      request.id === 0
        ? { after: 0, data: { id: 0, error: "no available backend found. ERR: [cpu] Error: previous call to 'initWasm()' failed." } }
        : { after: 0, data: { id: request.id, audio: audio() } }
    ]
    const { result, onSpeechStart } = await speakAll(['first sentence'])
    await advance(500)
    expect(MockWorker.instances).toHaveLength(1)
    expect(MockWorker.instances[0].terminated).toBe(true)
    await act(async () => {
      await result.current.actions.speak('second sentence')
    })
    await advance(500)
    expect(MockWorker.instances).toHaveLength(2)
    expect(MockWorker.instances[1].terminated).toBe(false)
    expect(spokenTexts(onSpeechStart)).toEqual(['second sentence'])
  })

  it('lets the other sentences in a failed worker finish before ending it', async () => {
    MockWorker.replies = (request) =>
      request.id === 0
        ? [{ after: 0, data: { id: 0, error: 'Failed to fetch' } }]
        : [{ after: 50, data: { id: request.id, audio: audio() } }]
    const { onSpeechStart } = await speakAll(['first sentence', 'second sentence'])
    await advance(20)
    expect(MockWorker.instances[0].terminated).toBe(false)
    await advance(500)
    expect(spokenTexts(onSpeechStart)).toEqual(['second sentence'])
    expect(MockWorker.instances[0].terminated).toBe(true)
    expect(MockWorker.instances).toHaveLength(1)
  })
})
