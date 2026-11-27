import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveConfig } from '../src/config.js'
import {
  COSYVOICE_DEFAULT_VOICE,
  contentTypeForFormat,
  createCosyVoiceAdapter,
  selectTtsUpstream
} from '../src/upstreams/cosyvoice.js'

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

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  out += dec.decode()
  return out
}

afterEach(() => vi.restoreAllMocks())

describe('cosyvoice adapter', () => {
  it('POSTs the OpenAI speech payload and pipes the audio stream through', async () => {
    const fetchMock = vi.fn(async () => audioResponse(['chunk-1', 'chunk-2']))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createCosyVoiceAdapter(resolveConfig({}))
    const audio = await adapter.speak(
      { text: 'hello there', voice: 'marius', format: 'mp3' },
      new AbortController().signal
    )

    expect(audio.contentType).toBe('audio/mpeg')
    expect(await drain(audio.body)).toBe('chunk-1chunk-2')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://host.docker.internal:8880/v1/audio/speech')
    const sent = JSON.parse(init.body as string)
    expect(sent).toEqual({
      model: 'cosyvoice2-0.5b',
      input: 'hello there',
      voice: 'marius',
      response_format: 'mp3',
      stream: true
    })
  })

  it('falls back to the config voice when none is supplied', async () => {
    const fetchMock = vi.fn(async () => audioResponse(['x']))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createCosyVoiceAdapter(resolveConfig({ APP_TTS_VOICE: 'javert' }))
    await adapter.speak({ text: 'hi' }, new AbortController().signal)

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.voice).toBe('javert')
  })

  it('sends "default" when neither the browser nor APP_TTS_VOICE names a voice, as before', async () => {
    // The OpenAI speech API needs a voice, so this adapter keeps its old fallback.
    const fetchMock = vi.fn(async () => audioResponse(['x']))
    vi.stubGlobal('fetch', fetchMock)

    for (const env of [{}, { APP_TTS_VOICE: '' }, { APP_TTS_VOICE: '  ' }]) {
      await createCosyVoiceAdapter(resolveConfig(env)).speak({ text: 'hi' }, new AbortController().signal)
    }

    const voices = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).voice
    )
    expect(COSYVOICE_DEFAULT_VOICE).toBe('default')
    expect(voices).toEqual(['default', 'default', 'default'])
    expect(createCosyVoiceAdapter(resolveConfig({})).defaultVoice).toBe('default')
  })

  it('derives content-type from the requested format when the upstream is generic', async () => {
    // Upstream labels the body octet-stream, so we fall back to the format map.
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse(['wavdata'], 'application/octet-stream')))

    const adapter = createCosyVoiceAdapter(resolveConfig({}))
    const audio = await adapter.speak({ text: 'hi', format: 'wav' }, new AbortController().signal)
    expect(audio.contentType).toBe('audio/wav')
  })

  it('throws on a non-ok upstream response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const adapter = createCosyVoiceAdapter(resolveConfig({}))
    await expect(adapter.speak({ text: 'hi' }, new AbortController().signal)).rejects.toThrow(
      /cosyvoice responded 500/
    )
  })

  it('throws a descriptive error on a transport failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    const adapter = createCosyVoiceAdapter(resolveConfig({}))
    await expect(adapter.speak({ text: 'hi' }, new AbortController().signal)).rejects.toThrow(
      /cosyvoice request failed: ECONNREFUSED/
    )
  })

  it('reports reachability via /v1/models for health', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = createCosyVoiceAdapter(resolveConfig({}))
    const probe = await adapter.health()
    expect(probe.ok).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('http://host.docker.internal:8880/v1/models')
  })
})

describe('selectTtsUpstream', () => {
  it('returns the cosyvoice adapter for the default config', () => {
    expect(selectTtsUpstream(resolveConfig({})).name).toBe('cosyvoice')
  })
})

describe('contentTypeForFormat', () => {
  it('maps known formats and defaults to audio/mpeg', () => {
    expect(contentTypeForFormat('mp3')).toBe('audio/mpeg')
    expect(contentTypeForFormat('wav')).toBe('audio/wav')
    expect(contentTypeForFormat('opus')).toBe('audio/opus')
    expect(contentTypeForFormat(undefined)).toBe('audio/mpeg')
    expect(contentTypeForFormat('weird')).toBe('audio/mpeg')
  })
})
