import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/server.js'

/** A fake streaming audio Response, as a CosyVoice2 upstream would return. */
function audioResponse(chunks: string[], contentType = 'audio/mpeg', status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    }
  })
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

afterEach(() => vi.restoreAllMocks())

describe('POST /api/tts', () => {
  it('returns 400 for empty text', async () => {
    const app = createApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' })
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for a missing text field', async () => {
    const app = createApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: 'alba' })
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    const app = createApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json'
    })
    expect(res.status).toBe(400)
  })

  it('streams audio with the right content-type and anti-buffering headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse(['RIFF', 'audio', 'bytes'])))
    const app = createApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello world' })
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mpeg')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(buf)).toBe('RIFFaudiobytes')
  })

  it('selects the CosyVoice2 upstream (POSTs /v1/audio/speech with the OpenAI payload)', async () => {
    const fetchMock = vi.fn(async () => audioResponse(['ok']))
    vi.stubGlobal('fetch', fetchMock)
    const app = createApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'speak this', voice: 'javert' })
    })
    expect(res.status).toBe(200)
    await res.arrayBuffer()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('http://host.docker.internal:8880/v1/audio/speech')
    const sent = JSON.parse(init.body as string)
    expect(sent).toMatchObject({ input: 'speak this', voice: 'javert', stream: true })
  })

  it('returns 502 when the upstream is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const app = createApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('cosyvoice')
  })
})

describe('POST /api/tts/timed', () => {
  const post = (body: unknown) =>
    createApp().request('/api/tts/timed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

  it('returns 400 for empty text', async () => {
    expect((await post({ text: '  ' })).status).toBe(400)
  })

  it('returns 501 — not 404 — when the upstream cannot report timings', async () => {
    // The client must be able to tell "this upstream has no timings" from "this
    // route does not exist", so it falls back to the acoustic tier deliberately.
    vi.stubEnv('APP_TTS_UPSTREAM', 'cosyvoice')
    const res = await post({ text: 'hello' })
    expect(res.status).toBe(501)
    expect((await res.json()) as { upstream: string }).toMatchObject({ upstream: 'cosyvoice' })
  })

  it('returns audio and timings from a timing-capable upstream', async () => {
    vi.stubEnv('APP_TTS_UPSTREAM', 'headtts')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              audio: Buffer.from('wav').toString('base64'),
              words: ['hello'],
              wtimes: [0],
              wdurations: [400],
              visemes: ['kk', 'E'],
              vtimes: [0, 200],
              vdurations: [200, 200]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    )

    const res = await post({ text: 'hello' })
    expect(res.status).toBe(200)
    const payload = (await res.json()) as { audio: string; timings: { visemes: string[] } }
    expect(payload.audio).toBe(Buffer.from('wav').toString('base64'))
    expect(payload.timings.visemes).toEqual(['kk', 'E'])
  })

  it('surfaces an upstream failure as 502', async () => {
    vi.stubEnv('APP_TTS_UPSTREAM', 'headtts')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect((await post({ text: 'hello' })).status).toBe(502)
  })
})

/**
 * The voice, from the browser's request to the upstream's. The browser sends none unless one is configured, so the
 * proxy's APP_TTS_VOICE decides, or else the upstream's own default.
 */
describe('the voice the proxy asks its TTS upstream for', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const speak = (path: '/api/tts' | '/api/tts/timed', body: Record<string, string>) =>
    createApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

  /** Stub the upstream with one answer, and return a function that gives the voice of each request it got. */
  function upstream(answer: () => Response) {
    const fetchMock = vi.fn(async () => answer())
    vi.stubGlobal('fetch', fetchMock)
    return () =>
      fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).voice)
  }

  const headttsAnswer = () =>
    new Response(JSON.stringify({ audio: Buffer.from('wav').toString('base64') }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })

  it('asks HeadTTS for no voice when neither the request nor APP_TTS_VOICE names one', async () => {
    vi.stubEnv('APP_TTS_UPSTREAM', 'headtts')
    vi.stubEnv('APP_TTS_VOICE', '')
    const voices = upstream(headttsAnswer)

    expect((await speak('/api/tts/timed', { text: 'hello' })).status).toBe(200)
    expect((await speak('/api/tts', { text: 'hello' })).status).toBe(200)
    expect(voices()).toEqual([undefined, undefined])
  })

  it("asks for APP_TTS_VOICE when the request names none, and for the request's voice when it does", async () => {
    vi.stubEnv('APP_TTS_UPSTREAM', 'headtts')
    vi.stubEnv('APP_TTS_VOICE', 'am_fenrir')
    const voices = upstream(headttsAnswer)

    await speak('/api/tts/timed', { text: 'hello' })
    await speak('/api/tts/timed', { text: 'hello', voice: 'af_heart' })
    expect(voices()).toEqual(['am_fenrir', 'af_heart'])
  })

  it('still asks an OpenAI-style upstream for "default" when nothing names a voice', async () => {
    vi.stubEnv('APP_TTS_UPSTREAM', 'cosyvoice')
    vi.stubEnv('APP_TTS_VOICE', '')
    const voices = upstream(() => audioResponse(['x']))

    expect((await speak('/api/tts', { text: 'hello' })).status).toBe(200)
    expect(voices()).toEqual(['default'])
  })

  it('reports in /api/health the voice it asks for when the request names none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const healthVoice = async () =>
      ((await (await createApp().request('/api/health')).json()) as { tts: { voice?: string } }).tts.voice

    vi.stubEnv('APP_TTS_VOICE', '')
    vi.stubEnv('APP_TTS_UPSTREAM', 'cosyvoice')
    expect(await healthVoice()).toBe('default')
    // HeadTTS is asked for none, and speaks with its own default
    vi.stubEnv('APP_TTS_UPSTREAM', 'headtts')
    expect(await healthVoice()).toBeUndefined()
    vi.stubEnv('APP_TTS_VOICE', 'af_heart')
    expect(await healthVoice()).toBe('af_heart')
  })
})
