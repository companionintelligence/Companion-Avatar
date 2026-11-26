import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VitsReply, VitsRequest } from './vitsMessages'

/**
 * The worker itself, loaded as the browser loads it, with a stand-in for vits-web: the real predict() downloads
 * models from three hosts and runs them. Every request must get exactly one answer, or the page's queue waits.
 */
const predict = vi.hoisted(() => vi.fn())
vi.mock('@diffusionstudio/vits-web', () => ({
  PATH_MAP: { 'en_US-hfc_male-medium': 'en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx' },
  predict
}))

const posted: VitsReply[] = []
let handle: (event: { data: VitsRequest }) => Promise<void>

beforeAll(async () => {
  vi.stubGlobal('self', {
    addEventListener: (type: string, listener: typeof handle) => {
      if (type === 'message') handle = listener
    },
    postMessage: (message: VitsReply) => posted.push(message)
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await import('./vits.worker')
})

beforeEach(() => {
  posted.length = 0
  predict.mockReset()
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
    predict.mockImplementation(async (_config: unknown, onProgress: (p: { url: string; loaded: number; total: number }) => void) => {
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
    expect(posted.filter((message) => !('progress' in message))).toHaveLength(1)
    expect(posted.at(-1)).toHaveProperty('audio')
  })
})
