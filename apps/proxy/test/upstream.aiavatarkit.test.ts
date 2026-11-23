import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { createAiAvatarKitAdapter } from '../src/upstreams/aiavatarkit.js'
import { selectUpstream } from '../src/upstreams/index.js'
import type { ChatEvent } from '../src/upstreams/types.js'

function sseResponse(lines: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const l of lines) controller.enqueue(enc.encode(l))
      controller.close()
    }
  })
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' }
  })
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const cfg = () =>
  resolveConfig({
    APP_UPSTREAM: 'aiavatarkit',
    APP_AIAVATARKIT_URL: 'http://avatar.test:8000/v1/',
    APP_AIAVATARKIT_TOKEN: 'visitor-7f3a'
  })

const signal = () => new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('aiavatarkit adapter', () => {
  it('posts to the chat completions endpoint, with the identifier as the bearer token', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetchMock)

    await collect(createAiAvatarKitAdapter(cfg()).chat({ messages: [{ role: 'user', content: 'hi' }] }, signal()))

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://avatar.test:8000/v1/chat/completions')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer visitor-7f3a'
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      stream: true,
      messages: [{ role: 'user', content: 'hi' }]
    })
  })

  it('maps content deltas and [DONE] into normalized events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }) + '\n\n',
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n\n',
          'data: ' + JSON.stringify({ choices: [{ delta: { content: ' there.' } }] }) + '\n\n',
          'data: ' +
            JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'stop' }]
            }) +
            '\n\n',
          'data: [DONE]\n\n'
        ])
      )
    )

    const events = await collect(createAiAvatarKitAdapter(cfg()).chat({ messages: [] }, signal()))
    expect(events).toEqual([
      { type: 'chunk', content: 'Hello' },
      { type: 'chunk', content: ' there.' },
      { type: 'done' }
    ])
  })

  it('ends the turn with a fixed error when the server reports one, without copying its text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: ' + JSON.stringify({ error: { message: 'internal detail' } }) + '\n\n']))
    )

    const events = await collect(createAiAvatarKitAdapter(cfg()).chat({ messages: [] }, signal()))
    expect(events).toEqual([{ type: 'error', message: 'aiavatarkit reported an error' }])
    expect(JSON.stringify(events)).not.toContain('internal detail')
  })

  it('reports a refused request as an error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 }))
    )

    const events = await collect(createAiAvatarKitAdapter(cfg()).chat({ messages: [] }, signal()))
    expect(events).toEqual([{ type: 'error', message: 'aiavatarkit responded 401' }])
  })

  it('reports configuration only, because a probe would run a turn', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createAiAvatarKitAdapter(cfg()).health()).resolves.toEqual({
      ok: true,
      detail: 'aiavatarkit configured (not probed)'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is selected for APP_UPSTREAM=aiavatarkit', () => {
    expect(selectUpstream(cfg()).name).toBe('aiavatarkit')
  })
})
