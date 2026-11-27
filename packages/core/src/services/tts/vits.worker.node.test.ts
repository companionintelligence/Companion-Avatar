import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VitsReply, VitsRequest } from './vitsMessages'

/**
 * The worker itself, loaded as the browser loads it, with a stand-in for vits-web: the real predict() downloads
 * models from three hosts and runs them. Every request must get exactly one answer, or the page's queue waits.
 * Each test loads the worker afresh, as `new Worker()` does, so a predict() left pending cannot hold up the next.
 */
const predict = vi.hoisted(() => vi.fn())
vi.mock('@diffusionstudio/vits-web', () => ({
  PATH_MAP: { 'en_US-hfc_male-medium': 'en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx' },
  predict
}))

type Progress = { url: string; loaded: number; total: number }

const posted: VitsReply[] = []
let handle: (event: { data: VitsRequest }) => Promise<void>

/** The answers posted so far, without the progress notes. */
const answers = () => posted.filter((message) => !('progress' in message))

/** Lets every promise that can settle now do so, and any predict() call that is due be made. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeAll(() => {
  vi.stubGlobal('self', {
    addEventListener: (type: string, listener: typeof handle) => {
      if (type === 'message') handle = listener
    },
    postMessage: (message: VitsReply) => posted.push(message)
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

beforeEach(async () => {
  posted.length = 0
  predict.mockReset()
  vi.resetModules()
  await import('./vits.worker')
})

describe('vits.worker', () => {
  it('answers with the WAV that predict() makes', async () => {
    predict.mockResolvedValue(new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/x-wav' }))
    await handle({ data: { id: 1, text: 'hello', voice: 'en_US-hfc_male-medium' } })
    expect(posted).toHaveLength(1)
    const answer = posted[0] as { id: number; audio: ArrayBuffer }
    expect(answer.id).toBe(1)
    expect([...new Uint8Array(answer.audio)]).toEqual([82, 73, 70, 70])
  })

  it.each([
    ['a download that fails', new TypeError('Failed to fetch')],
    ['a 404 page in place of the config', new SyntaxError(`Unexpected token 'E', "Entry not found" is not valid JSON`)],
    ['onnxruntime without its .wasm', new Error("no available backend found. ERR: [wasm] TypeError: Failed to fetch")]
  ])('answers with an error when predict() rejects: %s', async (_case, error) => {
    predict.mockRejectedValue(error)
    await handle({ data: { id: 2, text: 'hello', voice: 'en_US-hfc_male-medium' } })
    expect(posted).toEqual([{ id: 2, error: error.message }])
  })

  it('answers with an error when predict() rejects with something that is not an Error', async () => {
    predict.mockRejectedValue('worker out of memory')
    await handle({ data: { id: 3, text: 'hello' } })
    expect(posted).toEqual([{ id: 3, error: 'worker out of memory' }])
  })

  it('asks vits-web for the default voice in place of one it does not have', async () => {
    predict.mockResolvedValue(new Blob([]))
    await handle({ data: { id: 4, text: 'hello', voice: 'marius' } })
    expect(predict).toHaveBeenCalledWith({ text: 'hello', voiceId: 'en_US-hfc_male-medium' }, expect.any(Function))
  })

  it('passes the download progress on, at most once a second', async () => {
    // vits-web reports every chunk it reads; these seven arrive over 2.1 s.
    const clock = [0, 300, 600, 900, 1_000, 1_500, 2_100]
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock.shift() ?? 9_999)
    predict.mockImplementation(async (_config: unknown, onProgress: (p: Progress) => void) => {
      for (let loaded = 1; loaded <= 7; loaded++) onProgress({ url: 'model.onnx', loaded, total: 7 })
      return new Blob([])
    })
    try {
      await handle({ data: { id: 5, text: 'hello' } })
    } finally {
      now.mockRestore()
    }
    expect(posted.filter((message) => 'progress' in message)).toEqual([
      { id: 5, progress: { loaded: 1, total: 7 } },
      { id: 5, progress: { loaded: 5, total: 7 } },
      { id: 5, progress: { loaded: 7, total: 7 } }
    ])
    // ...and still exactly one answer, the last message
    expect(answers()).toHaveLength(1)
    expect(posted.at(-1)).toHaveProperty('audio')
  })

  describe('one sentence at a time', () => {
    it('starts each predict() once the one before it is answered, and answers in the order they came', async () => {
      const finish: Array<() => void> = []
      predict.mockImplementation(
        ({ text }: { text: string }) => new Promise<Blob>((resolve) => finish.push(() => resolve(new Blob([text]))))
      )
      const done = [1, 2, 3].map((id) => handle({ data: { id, text: `sentence ${id}` } }))
      for (let started = 1; started <= 3; started++) {
        await settle()
        expect(predict).toHaveBeenCalledTimes(started)
        expect(answers()).toHaveLength(started - 1)
        finish.shift()?.()
      }
      await Promise.all(done)
      const spoken = answers().map((answer) => [answer.id, new TextDecoder().decode((answer as { audio: ArrayBuffer }).audio)])
      expect(spoken).toEqual([
        [1, 'sentence 1'],
        [2, 'sentence 2'],
        [3, 'sentence 3']
      ])
    })

    it('downloads the voice once for a reply whose sentences come together', async () => {
      // Like vits-web: predict() looks for the voice where it keeps it, downloads it when it is not there, and keeps
      // it only once the download has finished. Side by side, all three sentences downloaded it.
      let kept = false
      let downloads = 0
      predict.mockImplementation(async (_config: unknown, onProgress: (p: Progress) => void) => {
        if (!kept) {
          downloads++
          for (let loaded = 1; loaded <= 3; loaded++) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            onProgress({ url: 'model.onnx', loaded, total: 3 })
          }
          kept = true
        }
        return new Blob([])
      })
      await Promise.all([1, 2, 3].map((id) => handle({ data: { id, text: 'hello' } })))
      expect(downloads).toBe(1)
      // The progress notes are the first sentence's, the one that downloaded; then each sentence gets its audio.
      expect(posted.filter((message) => 'progress' in message).map((message) => message.id)).toEqual([1])
      expect(answers().map((answer) => [answer.id, 'audio' in answer])).toEqual([
        [1, true],
        [2, true],
        [3, true]
      ])
    })

    it('goes on to the next sentence when predict() rejects', async () => {
      predict.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Blob([]))
      await Promise.all([handle({ data: { id: 1, text: 'one' } }), handle({ data: { id: 2, text: 'two' } })])
      expect(posted).toEqual([
        { id: 1, error: 'Failed to fetch' },
        { id: 2, audio: expect.any(ArrayBuffer) }
      ])
    })

    it('sends nothing for the sentences behind a predict() that never settles', async () => {
      // vits-web's predict() can stay pending for good (vitsMessages.ts). The sentences behind it then wait in this
      // worker, and the page's silence limit gives them all up and starts a new worker. So the worker must go
      // quiet: anything it sent would keep the page waiting.
      predict.mockReturnValueOnce(new Promise<Blob>(() => {})).mockResolvedValue(new Blob([]))
      void handle({ data: { id: 1, text: 'one' } })
      void handle({ data: { id: 2, text: 'two' } })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(predict).toHaveBeenCalledTimes(1)
      expect(posted).toEqual([])
    })
  })
})
