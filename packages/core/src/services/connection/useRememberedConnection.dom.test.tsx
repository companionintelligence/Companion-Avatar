import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import type { LLMConfig } from '../llm/config/llmConfig'
import { useRememberedConnection } from './useRememberedConnection'
import { rememberVerifiedConnection } from './verifiedConnections'

const PROXY: LLMConfig = {
  llm_provider: 'proxy',
  proxy_url: 'https://box.example.ts.net:18787/api/chat',
  proxy_model: ''
}

function healthResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useRememberedConnection', () => {
  it('starts the scripted demo as Demo-only, with no request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onActivationStateChange = vi.fn()

    renderHook(() => useRememberedConnection({ llm_provider: 'script' }, onActivationStateChange))

    expect(onActivationStateChange).toHaveBeenCalledWith('demo-only')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks a server that passed before, and restores the state its check gives', async () => {
    rememberVerifiedConnection('proxy', { url: PROXY.proxy_url, model: PROXY.proxy_model })
    const fetchMock = vi.fn().mockResolvedValue(
      healthResponse({ status: 'ok', reachable: true, memory: { configured: true, reachable: true } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const onActivationStateChange = vi.fn()

    renderHook(() => useRememberedConnection(PROXY, onActivationStateChange))

    await waitFor(() => expect(onActivationStateChange).toHaveBeenCalledWith('memory-ready'))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://box.example.ts.net:18787/api/health',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('never contacts a server the user has not checked', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onActivationStateChange = vi.fn()

    renderHook(() => useRememberedConnection(PROXY, onActivationStateChange))

    // Give a stray promise the chance to run before asserting nothing happened.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onActivationStateChange).not.toHaveBeenCalled()
  })

  it('stays Unverified when the remembered server no longer answers', async () => {
    rememberVerifiedConnection('proxy', { url: PROXY.proxy_url, model: PROXY.proxy_model })
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Load failed'))
    vi.stubGlobal('fetch', fetchMock)
    const onActivationStateChange = vi.fn()

    renderHook(() => useRememberedConnection(PROXY, onActivationStateChange))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onActivationStateChange).not.toHaveBeenCalled()
  })

  it('stays Unverified when the server answers that chat is unreachable', async () => {
    rememberVerifiedConnection('proxy', { url: PROXY.proxy_url, model: PROXY.proxy_model })
    const fetchMock = vi.fn().mockResolvedValue(healthResponse({ status: 'degraded', reachable: false }))
    vi.stubGlobal('fetch', fetchMock)
    const onActivationStateChange = vi.fn()

    renderHook(() => useRememberedConnection(PROXY, onActivationStateChange))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onActivationStateChange).not.toHaveBeenCalled()
  })

  it('drops an answer about a server the settings have moved away from', async () => {
    rememberVerifiedConnection('proxy', { url: PROXY.proxy_url, model: PROXY.proxy_model })
    let answer: (response: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => {
        answer = resolve
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const onActivationStateChange = vi.fn()

    const { rerender } = renderHook(({ settings }) => useRememberedConnection(settings, onActivationStateChange), {
      initialProps: { settings: PROXY }
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // The user saves another server (one never checked) before the first answer arrives.
    rerender({ settings: { ...PROXY, proxy_url: 'https://other.example/api/chat' } })
    answer(healthResponse({ status: 'ok', reachable: true }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onActivationStateChange).not.toHaveBeenCalled()
  })
})
