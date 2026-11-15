import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useConnectionCheck } from './useConnectionCheck'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useConnectionCheck', () => {
  it('short-circuits the script (demo) provider without hitting fetch', async () => {
    const fetchMock = vi.fn()
    const onActivationStateChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useConnectionCheck('script', onActivationStateChange))

    expect(result.current.healthState).toBe('idle')

    await act(async () => {
      await result.current.checkConnection()
    })

    expect(result.current.healthState).toBe('demo')
    expect(onActivationStateChange).toHaveBeenCalledWith('demo-only')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a reachable non-memory provider to healthy / chat-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          reachable: true,
          memory: { configured: false, reachable: false },
          tts: { reachable: true }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const onActivationStateChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useConnectionCheck('proxy', onActivationStateChange))

    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('healthy'))
    expect(onActivationStateChange).toHaveBeenCalledWith('chat-only')
    expect(result.current.health?.reachable).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ cache: 'no-store', headers: { accept: 'application/json' } })
    )
  })

  it('resolves an unreachable tts to degraded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'degraded',
          reachable: true,
          memory: { configured: false, reachable: false },
          tts: { reachable: false }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const onActivationStateChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useConnectionCheck('proxy', onActivationStateChange))

    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('degraded'))
    expect(onActivationStateChange).toHaveBeenCalledWith('chat-only')
  })

  it('resolves a fetch rejection to error, with healthError set and activation unverified', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    const onActivationStateChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useConnectionCheck('proxy', onActivationStateChange))

    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('error'))
    expect(result.current.healthError).toBe('network down')
    expect(result.current.health).toBeNull()
    expect(onActivationStateChange).toHaveBeenCalledWith('unverified')
  })
})

// The desktop and Android apps load their bundle from their own origin, where the build's
// /api/health is the app's own files, not a server. The check must go to the server the user
// picked in Settings, or a backend chosen at run time can never be verified.
describe('useConnectionCheck against the server the user picked', () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  it('asks the BFF behind the Proxy URL, not the build\'s own /api/health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 'ok', reachable: true, memory: { configured: false, reachable: false } }))
    const onActivationStateChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useConnectionCheck('proxy', onActivationStateChange, { url: 'https://hub.example/api/chat' })
    )
    await act(async () => {
      await result.current.checkConnection()
    })

    expect(fetchMock).toHaveBeenCalledWith('https://hub.example/api/health', expect.objectContaining({ cache: 'no-store' }))
    await waitFor(() => expect(result.current.healthState).toBe('healthy'))
    expect(onActivationStateChange).toHaveBeenCalledWith('chat-only')
  })

  it('asks an Ollama server for its models and accepts it when the chosen model is there', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ models: [{ name: 'gemma3:1b' }, { name: 'llama3.2:latest' }] }))
    const onActivationStateChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useConnectionCheck('ollama', onActivationStateChange, { url: 'http://localhost:11434/', model: 'llama3.2' })
    )
    await act(async () => {
      await result.current.checkConnection()
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.objectContaining({ cache: 'no-store' }))
    await waitFor(() => expect(result.current.healthState).toBe('healthy'))
    expect(result.current.health?.upstream).toBe('ollama')
    expect(onActivationStateChange).toHaveBeenCalledWith('chat-only')
  })

  it('does not verify an Ollama server that lacks the chosen model, and says how to get it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ models: [{ name: 'gemma3:1b' }] })))
    const onActivationStateChange = vi.fn()

    const { result } = renderHook(() =>
      useConnectionCheck('ollama', onActivationStateChange, { url: 'http://localhost:11434', model: 'qwen3:4b' })
    )
    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('error'))
    expect(result.current.healthError).toContain('ollama pull qwen3:4b')
    expect(onActivationStateChange).toHaveBeenCalledWith('unverified')
  })

  it('names OLLAMA_ORIGINS when the Ollama server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const onActivationStateChange = vi.fn()

    const { result } = renderHook(() =>
      useConnectionCheck('ollama', onActivationStateChange, { url: 'http://localhost:11434', model: 'gemma3:1b' })
    )
    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('error'))
    expect(result.current.healthError).toContain('OLLAMA_ORIGINS')
    expect(onActivationStateChange).toHaveBeenCalledWith('unverified')
  })

  it('asks for an Ollama URL instead of calling anything when none is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useConnectionCheck('ollama', vi.fn(), { url: '', model: 'gemma3:1b' }))
    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('error'))
    expect(result.current.healthError).toContain('Enter the URL of your Ollama server')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks WebGPU, not a server, for an on-device model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { ...navigator, gpu: { requestAdapter: vi.fn().mockResolvedValue({}) } })
    const onActivationStateChange = vi.fn()

    const { result } = renderHook(() => useConnectionCheck('mlc', onActivationStateChange, { model: 'SmolLM2-360M-Instruct-q4f16_1-MLC' }))
    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('healthy'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onActivationStateChange).toHaveBeenCalledWith('chat-only')
  })

  it('says on-device models do not run in the desktop app, whose CSP blocks their engine', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('navigator', { ...navigator, gpu: { requestAdapter: vi.fn().mockResolvedValue({}) } })
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const onActivationStateChange = vi.fn()

    try {
      const { result } = renderHook(() => useConnectionCheck('mlc', onActivationStateChange, {}))
      await act(async () => {
        await result.current.checkConnection()
      })

      await waitFor(() => expect(result.current.healthState).toBe('error'))
      expect(result.current.healthError).toContain('desktop app')
      expect(onActivationStateChange).toHaveBeenCalledWith('unverified')
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    }
  })

  it('does not verify an on-device model without WebGPU', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('navigator', { ...navigator, gpu: undefined })
    const onActivationStateChange = vi.fn()

    const { result } = renderHook(() => useConnectionCheck('mlc', onActivationStateChange, {}))
    await act(async () => {
      await result.current.checkConnection()
    })

    await waitFor(() => expect(result.current.healthState).toBe('error'))
    expect(result.current.healthError).toContain('WebGPU')
    expect(onActivationStateChange).toHaveBeenCalledWith('unverified')
  })
})
