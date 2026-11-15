import { describe, expect, it } from 'vitest'

import {
  activationStateLabel,
  bffHealthUrl,
  connectionTargetFor,
  deriveActivationState,
  ollamaTagsUrl,
  type ConnectionHealth
} from './connectionHealth'

const healthyChat: ConnectionHealth = {
  reachable: true,
  memory: { configured: false, reachable: false },
  tts: { reachable: true }
}

describe('activation state', () => {
  it('keeps scripted responses explicitly demo-only', () => {
    expect(deriveActivationState(healthyChat, 'script')).toBe('demo-only')
  })

  it('does not call an unreachable chat provider connected', () => {
    expect(deriveActivationState({ reachable: false }, 'proxy')).toBe('unverified')
  })

  it('distinguishes chat-only from memory-ready sessions', () => {
    expect(deriveActivationState(healthyChat, 'proxy')).toBe('chat-only')
    expect(
      deriveActivationState(
        {
          ...healthyChat,
          memory: { configured: true, reachable: true }
        },
        'proxy'
      )
    ).toBe('memory-ready')
  })

  it('provides stable labels for the user-facing state', () => {
    expect(activationStateLabel('unverified')).toBe('Unverified')
    expect(activationStateLabel('demo-only')).toBe('Demo-only')
    expect(activationStateLabel('chat-only')).toBe('Chat-only')
    expect(activationStateLabel('memory-ready')).toBe('Memory-ready')
  })
})

describe('the server a check goes to', () => {
  it('finds the BFF health route beside the chat URL the user entered', () => {
    expect(bffHealthUrl('https://hub.example/api/chat')).toBe('https://hub.example/api/health')
    expect(bffHealthUrl('https://hub.example:8787/api/chat/')).toBe('https://hub.example:8787/api/health')
    expect(bffHealthUrl('https://hub.example/avatar/api/chat')).toBe('https://hub.example/avatar/api/health')
  })

  it('falls back to the origin for an absolute URL with another path', () => {
    expect(bffHealthUrl('https://hub.example')).toBe('https://hub.example/api/health')
    expect(bffHealthUrl('http://192.0.2.20:8787/chat')).toBe('http://192.0.2.20:8787/api/health')
  })

  it("keeps this build's own BFF for no URL or a relative one", () => {
    expect(bffHealthUrl()).toBe('/api/health')
    expect(bffHealthUrl('')).toBe('/api/health')
    expect(bffHealthUrl('/api/chat')).toBe('/api/health')
  })

  it("asks an Ollama server for its model list", () => {
    expect(ollamaTagsUrl('http://localhost:11434')).toBe('http://localhost:11434/api/tags')
    expect(ollamaTagsUrl(' https://ollama.example/ ')).toBe('https://ollama.example/api/tags')
  })

  it('takes the URL and model saved for the provider in use', () => {
    const saved = {
      proxy_url: 'https://hub.example/api/chat',
      proxy_model: 'gemma3:4b',
      ollama_url: 'http://localhost:11434',
      ollama_model: 'gemma3:1b',
      mlc_model: 'SmolLM2-360M-Instruct-q4f16_1-MLC'
    }
    expect(connectionTargetFor({ ...saved, llm_provider: 'proxy' })).toEqual({ url: 'https://hub.example/api/chat', model: 'gemma3:4b' })
    expect(connectionTargetFor({ ...saved, llm_provider: 'ollama' })).toEqual({ url: 'http://localhost:11434', model: 'gemma3:1b' })
    expect(connectionTargetFor({ ...saved, llm_provider: 'mlc' })).toEqual({ model: 'SmolLM2-360M-Instruct-q4f16_1-MLC' })
    expect(connectionTargetFor({ ...saved, llm_provider: 'script' })).toEqual({})
  })
})
