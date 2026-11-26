import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('defaults to the ollama upstream on host.docker.internal', () => {
    const cfg = resolveConfig({})
    expect(cfg.upstream).toBe('ollama')
    expect(cfg.ollamaUrl).toBe('http://host.docker.internal:11434')
    expect(cfg.ollamaModel).toBe('gemma3:1b')
    expect(cfg.port).toBe(8787)
  })

  it('strips trailing slashes from upstream URLs', () => {
    const cfg = resolveConfig({ APP_OLLAMA_URL: 'http://host:11434/' })
    expect(cfg.ollamaUrl).toBe('http://host:11434')
  })

  it('selects the openai upstream and requires an API key', () => {
    expect(() => resolveConfig({ APP_UPSTREAM: 'openai' })).toThrow(/APP_OPENAI_API_KEY/)
    const cfg = resolveConfig({ APP_UPSTREAM: 'openai', APP_OPENAI_API_KEY: 'sk-test' })
    expect(cfg.upstream).toBe('openai')
    expect(cfg.openaiApiKey).toBe('sk-test')
  })

  it('rejects an unknown upstream', () => {
    expect(() => resolveConfig({ APP_UPSTREAM: 'bogus' })).toThrow(/Invalid APP_UPSTREAM/)
  })

  it('defaults the TTS upstream to cosyvoice on host.docker.internal:8880', () => {
    const cfg = resolveConfig({})
    expect(cfg.ttsUpstream).toBe('cosyvoice')
    expect(cfg.ttsUrl).toBe('http://host.docker.internal:8880')
    expect(cfg.ttsModel).toBe('cosyvoice2-0.5b')
    expect(cfg.ttsVoice).toBe('default')
  })

  it('overrides TTS settings from env and strips the trailing slash', () => {
    const cfg = resolveConfig({
      APP_TTS_URL: 'http://gpu:8880/',
      APP_TTS_MODEL: 'cosyvoice2',
      APP_TTS_VOICE: 'alba'
    })
    expect(cfg.ttsUrl).toBe('http://gpu:8880')
    expect(cfg.ttsModel).toBe('cosyvoice2')
    expect(cfg.ttsVoice).toBe('alba')
  })

  it('rejects an unknown TTS upstream', () => {
    expect(() => resolveConfig({ APP_TTS_UPSTREAM: 'bogus' })).toThrow(/Invalid APP_TTS_UPSTREAM/)
  })

  it('selects the aiavatarkit upstream and requires its identifier', () => {
    expect(() => resolveConfig({ APP_UPSTREAM: 'aiavatarkit' })).toThrow(/APP_AIAVATARKIT_TOKEN/)
    const cfg = resolveConfig({ APP_UPSTREAM: 'aiavatarkit', APP_AIAVATARKIT_TOKEN: 'visitor-1' })
    expect(cfg.upstream).toBe('aiavatarkit')
    expect(cfg.aiavatarkitUrl).toBe('http://host.docker.internal:8000/v1')
    expect(cfg.aiavatarkitToken).toBe('visitor-1')
  })

  it('strips the trailing slash from the aiavatarkit URL', () => {
    const cfg = resolveConfig({ APP_AIAVATARKIT_URL: 'http://avatar:8000/v1/' })
    expect(cfg.aiavatarkitUrl).toBe('http://avatar:8000/v1')
  })

  it('leaves the context window to the Ollama server unless APP_OLLAMA_NUM_CTX is set', () => {
    expect(resolveConfig({}).ollamaNumCtx).toBeNull()
    expect(resolveConfig({ APP_OLLAMA_NUM_CTX: ' ' }).ollamaNumCtx).toBeNull()
    expect(resolveConfig({ APP_OLLAMA_NUM_CTX: '4096' }).ollamaNumCtx).toBe(4096)
  })

  it('rejects an APP_OLLAMA_NUM_CTX that is not a sensible whole number of tokens', () => {
    for (const bad of ['4k', '4096.5', '0', '-1', '100', '99999999']) {
      expect(() => resolveConfig({ APP_OLLAMA_NUM_CTX: bad })).toThrow(/APP_OLLAMA_NUM_CTX/)
    }
  })
})
