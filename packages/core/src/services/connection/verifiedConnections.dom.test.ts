import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_REMEMBERED_CONNECTIONS,
  isRememberedConnection,
  rememberVerifiedConnection,
  verifiedConnectionKey
} from './verifiedConnections'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('verifiedConnections', () => {
  it('remembers a checked server for the same provider, server and model only', () => {
    rememberVerifiedConnection('proxy', { url: 'https://box.example.ts.net:18787/api/chat', model: 'gemma3:4b' })

    expect(isRememberedConnection('proxy', { url: 'https://box.example.ts.net:18787/api/chat', model: 'gemma3:4b' })).toBe(true)
    // Another server, another model or another provider has not been checked.
    expect(isRememberedConnection('proxy', { url: 'https://other.example.ts.net:18787/api/chat', model: 'gemma3:4b' })).toBe(false)
    expect(isRememberedConnection('proxy', { url: 'https://box.example.ts.net:18787/api/chat', model: 'qwen3.5:9b' })).toBe(false)
    expect(isRememberedConnection('ollama', { url: 'https://box.example.ts.net:18787/api/chat', model: 'gemma3:4b' })).toBe(false)
  })

  it('treats spellings of one server as the same server', () => {
    rememberVerifiedConnection('ollama', { url: '  HTTP://Beta-Red:11434/ ', model: ' gemma3:4b ' })
    expect(isRememberedConnection('ollama', { url: 'http://beta-red:11434', model: 'gemma3:4b' })).toBe(true)
  })

  it('never remembers the scripted provider, which has no server', () => {
    expect(verifiedConnectionKey('script')).toBeNull()
    rememberVerifiedConnection('script')
    expect(isRememberedConnection('script')).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('keeps the newest servers and drops the oldest', () => {
    for (let i = 0; i <= MAX_REMEMBERED_CONNECTIONS; i++) {
      rememberVerifiedConnection('proxy', { url: `https://host-${i}.example/api/chat` })
    }
    expect(isRememberedConnection('proxy', { url: 'https://host-0.example/api/chat' })).toBe(false)
    expect(isRememberedConnection('proxy', { url: `https://host-${MAX_REMEMBERED_CONNECTIONS}.example/api/chat` })).toBe(true)
  })

  it('moves a server checked again to the front instead of listing it twice', () => {
    rememberVerifiedConnection('proxy', { url: 'https://a.example/api/chat' })
    for (let i = 1; i < MAX_REMEMBERED_CONNECTIONS; i++) {
      rememberVerifiedConnection('proxy', { url: `https://host-${i}.example/api/chat` })
    }
    rememberVerifiedConnection('proxy', { url: 'https://a.example/api/chat' })
    rememberVerifiedConnection('proxy', { url: 'https://newest.example/api/chat' })

    expect(isRememberedConnection('proxy', { url: 'https://a.example/api/chat' })).toBe(true)
    expect(isRememberedConnection('proxy', { url: 'https://host-1.example/api/chat' })).toBe(false)
  })

  it('reads damaged storage as an empty list', () => {
    localStorage.setItem('ci_avatar_verified_connections', '{not json')
    expect(isRememberedConnection('proxy', { url: 'https://a.example/api/chat' })).toBe(false)
    rememberVerifiedConnection('proxy', { url: 'https://a.example/api/chat' })
    expect(isRememberedConnection('proxy', { url: 'https://a.example/api/chat' })).toBe(true)
  })

  it('carries on when storage refuses to be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => rememberVerifiedConnection('proxy', { url: 'https://a.example/api/chat' })).not.toThrow()
    expect(isRememberedConnection('proxy', { url: 'https://a.example/api/chat' })).toBe(false)
  })
})
