import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiUrl } from './apiBase'

describe('apiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps same-origin paths when no base is set', () => {
    vi.stubEnv('VITE_API_BASE', '')
    expect(apiUrl('/api/chat')).toBe('/api/chat')
  })

  it('prefixes the proxy origin for a native or desktop shell', () => {
    vi.stubEnv('VITE_API_BASE', 'https://bff.example.com')
    expect(apiUrl('/api/chat')).toBe('https://bff.example.com/api/chat')
  })

  it('drops trailing slashes from the base so paths never double up', () => {
    vi.stubEnv('VITE_API_BASE', 'https://bff.example.com//')
    expect(apiUrl('/api/tts/timed')).toBe('https://bff.example.com/api/tts/timed')
  })
})
