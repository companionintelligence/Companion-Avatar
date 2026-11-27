import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { selectTtsUpstream } from '../src/upstreams/cosyvoice.js'
import { createHeadTtsAdapter, isTimedAdapter, parseHeadTtsTimings } from '../src/upstreams/headtts.js'

const AUDIO_B64 = Buffer.from('fake-wav-bytes').toString('base64')

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

const cfg = () => resolveConfig({ APP_TTS_UPSTREAM: 'headtts', APP_TTS_URL: 'http://headtts:8080' })

afterEach(() => vi.restoreAllMocks())

describe('parseHeadTtsTimings', () => {
  it('reads the flat shape', () => {
    const t = parseHeadTtsTimings({
      words: ['hello'],
      wtimes: [0],
      wdurations: [400],
      visemes: ['kk', 'E'],
      vtimes: [0, 200],
      vdurations: [200, 200]
    })
    expect(t.words).toEqual(['hello'])
    expect(t.visemes).toEqual(['kk', 'E'])
  })

  it('reads a nested timings envelope', () => {
    // The REST and WebSocket transports do not agree on nesting; pinning one
    // would make a server upgrade a silent regression to no lip-sync.
    const t = parseHeadTtsTimings({ timings: { words: ['hi'], wtimes: [0], wdurations: [100] } })
    expect(t.words).toEqual(['hi'])
  })

  it('reads a nested metadata envelope', () => {
    const t = parseHeadTtsTimings({ metadata: { words: ['hi'], wtimes: [0], wdurations: [100] } })
    expect(t.words).toEqual(['hi'])
  })

  it('degrades to word-only rather than throwing on missing viseme arrays', () => {
    const t = parseHeadTtsTimings({ words: ['hi'], wtimes: [0], wdurations: [100] })
    expect(t.visemes).toBeUndefined()
    expect(t.words).toEqual(['hi'])
  })

  it('rejects arrays of the wrong element type instead of passing them on', () => {
    // A malformed array reaching the scheduler produces NaN timings, which is a
    // much harder failure to trace than an empty schedule.
    const t = parseHeadTtsTimings({ words: [1, 2], wtimes: ['a'], wdurations: [100] })
    expect(t.words).toEqual([])
    expect(t.wtimes).toEqual([])
  })

  it('survives a null or non-object payload', () => {
    expect(parseHeadTtsTimings(null).words).toEqual([])
    expect(parseHeadTtsTimings('nope').words).toEqual([])
  })
})

describe('headtts adapter', () => {
  it('is selected by APP_TTS_UPSTREAM and reports timing capability', () => {
    const adapter = selectTtsUpstream(cfg())
    expect(adapter.name).toBe('headtts')
    expect(isTimedAdapter(adapter)).toBe(true)
  })

  it('cosyvoice is NOT timing-capable, so the route can 501 honestly', () => {
    const adapter = selectTtsUpstream(resolveConfig({ APP_TTS_UPSTREAM: 'cosyvoice' }))
    expect(isTimedAdapter(adapter)).toBe(false)
  })

  it('POSTs the synthesize payload and returns audio plus timings', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        audio: AUDIO_B64,
        words: ['hello'],
        wtimes: [0],
        wdurations: [400],
        visemes: ['kk', 'E'],
        vtimes: [0, 200],
        vdurations: [200, 200]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createHeadTtsAdapter(cfg()).speakTimed(
      { text: 'hello', voice: 'af_heart' },
      new AbortController().signal
    )

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://headtts:8080/v1/synthesize')
    expect(JSON.parse(String(init.body))).toMatchObject({ input: 'hello', voice: 'af_heart' })
    expect(result.audioBase64).toBe(AUDIO_B64)
    expect(result.timings.visemes).toEqual(['kk', 'E'])
  })

  /** The voice in each synthesize request, or undefined where a request named none. */
  const voicesSent = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).voice)

  it('asks for no voice when neither the browser nor APP_TTS_VOICE names one, so HeadTTS uses its own', async () => {
    // It used to send 'default'. HeadTTS loads each voice from a file and has none by that name, so it answered 422.
    const fetchMock = vi.fn(async () => jsonResponse({ audio: AUDIO_B64 }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createHeadTtsAdapter(cfg())
    await adapter.speakTimed({ text: 'hello' }, new AbortController().signal)
    await adapter.speak({ text: 'hello', voice: '' }, new AbortController().signal)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ input: 'hello', language: 'en-us', audioEncoding: 'wav' })
    expect(voicesSent(fetchMock)).toEqual([undefined, undefined])
    expect(adapter.defaultVoice).toBeUndefined()
  })

  it("asks for APP_TTS_VOICE when the browser names none, and for the browser's voice when it does", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ audio: AUDIO_B64 }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createHeadTtsAdapter(
      resolveConfig({ APP_TTS_UPSTREAM: 'headtts', APP_TTS_URL: 'http://headtts:8080', APP_TTS_VOICE: 'am_fenrir' })
    )
    await adapter.speakTimed({ text: 'hello' }, new AbortController().signal)
    await adapter.speakTimed({ text: 'hello', voice: 'af_heart' }, new AbortController().signal)

    expect(voicesSent(fetchMock)).toEqual(['am_fenrir', 'af_heart'])
  })

  it('exposes the same audio through the plain speak() path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ audio: AUDIO_B64 })))
    const { body, contentType } = await createHeadTtsAdapter(cfg()).speak(
      { text: 'hi' },
      new AbortController().signal
    )
    const reader = body.getReader()
    const { value } = await reader.read()
    expect(Buffer.from(value!).toString()).toBe('fake-wav-bytes')
    expect(contentType).toBe('audio/wav')
  })

  it('throws on a non-ok upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 503)))
    await expect(
      createHeadTtsAdapter(cfg()).speakTimed({ text: 'hi' }, new AbortController().signal)
    ).rejects.toThrow(/503/)
  })

  it('throws when the upstream returns metadata but no audio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ words: ['hi'] })))
    await expect(
      createHeadTtsAdapter(cfg()).speakTimed({ text: 'hi' }, new AbortController().signal)
    ).rejects.toThrow(/no audio/)
  })

  it('surfaces a transport failure with the upstream named', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(
      createHeadTtsAdapter(cfg()).speakTimed({ text: 'hi' }, new AbortController().signal)
    ).rejects.toThrow(/headtts request failed.*ECONNREFUSED/)
  })

  it('reports unreachable rather than throwing from health()', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await createHeadTtsAdapter(cfg()).health()).toMatchObject({ ok: false })
  })
})
