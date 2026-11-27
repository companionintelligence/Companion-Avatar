import { describe, expect, it } from 'vitest'

import { defaultTTSConfig, voiceFor } from './ttsConfig'
import { DEFAULT_VITS_VOICE } from './vitsVoice'

/**
 * Each engine has its own default voice. All of them used to share one, 'marius', a Pocket TTS voice, which the
 * VITS engine ('local') took for a Piper id, so it never spoke.
 */
describe('voiceFor', () => {
  it('gives the VITS engine a Piper voice by default', () => {
    expect(voiceFor({ mode: 'local', voice: '' })).toBe(DEFAULT_VITS_VOICE)
  })

  it('names no voice for the BFF modes by default, so the proxy picks it', () => {
    // They were sent 'marius', which overrode the proxy's APP_TTS_VOICE and which no Kokoro server has.
    for (const mode of ['remote', 'headtts'] as const) {
      expect(voiceFor({ mode, voice: '' }), mode).toBe('')
      expect(voiceFor({ mode, voice: '   ' }), mode).toBe('')
    }
  })

  it('still gives browser speech marius by default, as before', () => {
    expect(voiceFor({ mode: 'browser', voice: '' })).toBe('marius')
  })

  it('uses a configured voice for every engine, as given', () => {
    for (const mode of ['local', 'remote', 'headtts', 'browser'] as const) {
      expect(voiceFor({ mode, voice: ' en_US-amy-medium ' }), mode).toBe('en_US-amy-medium')
    }
  })

  it('names no voice for an engine that takes none from it, or for a mode it does not know', () => {
    // Pocket TTS reads pocketTts.voice; the synthetic engine has no voice
    expect(voiceFor({ mode: 'pocket', voice: '' })).toBe('')
    expect(voiceFor({ mode: 'synthetic', voice: '' })).toBe('')
    // a mode from config.json that is no engine, and a name every object has
    expect(voiceFor({ mode: 'constructor' as never, voice: '' })).toBe('')
  })

  const envVoices = [
    import.meta.env.VITE_TTS_VOICE,
    import.meta.env.VITE_POCKET_TTS_VOICE,
    import.meta.env.VITE_POCKET_TTS_URL
  ].some(Boolean)

  it.skipIf(envVoices)('leaves the voice to each engine by default, and keeps the Pocket TTS defaults', () => {
    expect(defaultTTSConfig.voice).toBe('')
    expect(voiceFor({ ...defaultTTSConfig, mode: 'local' })).toBe(DEFAULT_VITS_VOICE)
    expect(defaultTTSConfig.pocketTts).toEqual({ serverUrl: 'http://localhost:8000', voice: 'marius' })
  })
})
