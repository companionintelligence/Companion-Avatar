import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SPEECH_MODE,
  needsSilencedOutput,
  requestedSpeechFromEnv,
  speechModeFromParams,
  speechParamsFor
} from './speechMode'

const params = (query: string) => new URLSearchParams(query)

describe('speechModeFromParams', () => {
  it('is a silent synthetic voice when nothing is asked for', () => {
    expect(speechModeFromParams(params('avatar=Greg&shot=body'))).toEqual({ engine: 'synthetic', volume: 0 })
    expect(DEFAULT_SPEECH_MODE).toEqual({ engine: 'synthetic', volume: 0 })
  })

  it('reads the engine and the level independently', () => {
    expect(speechModeFromParams(params('tts=browser'))).toEqual({ engine: 'browser', volume: 0 })
    expect(speechModeFromParams(params('ttsVolume=0.5'))).toEqual({ engine: 'synthetic', volume: 0.5 })
    expect(speechModeFromParams(params('tts=synthetic&ttsVolume=1'))).toEqual({ engine: 'synthetic', volume: 1 })
  })

  it('treats an empty value as not given', () => {
    expect(speechModeFromParams(params('tts=&ttsVolume='))).toEqual(DEFAULT_SPEECH_MODE)
  })

  it('stops on an engine it does not know instead of running another one', () => {
    expect(() => speechModeFromParams(params('tts=brwoser'))).toThrow(/tts=brwoser.*synthetic or browser/)
  })

  it.each(['-0.1', '1.5', 'loud', 'NaN', 'Infinity'])('stops on the level %s', (level) => {
    expect(() => speechModeFromParams(params(`ttsVolume=${level}`))).toThrow(/is not a level/)
  })
})

describe('requestedSpeechFromEnv', () => {
  it('is null when the run asked for nothing, so URLs stay as they were', () => {
    expect(requestedSpeechFromEnv({})).toBeNull()
    expect(requestedSpeechFromEnv({ HARNESS_TTS: '', HARNESS_TTS_VOLUME: ' ' })).toBeNull()
    expect(speechParamsFor(null)).toBe('')
  })

  it('carries only the parts that were given', () => {
    expect(requestedSpeechFromEnv({ HARNESS_TTS: 'browser' })).toEqual({ engine: 'browser' })
    expect(requestedSpeechFromEnv({ HARNESS_TTS_VOLUME: '1' })).toEqual({ volume: 1 })
    expect(requestedSpeechFromEnv({ HARNESS_TTS: 'synthetic', HARNESS_TTS_VOLUME: '0' })).toEqual({
      engine: 'synthetic',
      volume: 0
    })
  })

  it('names the variable that was wrong', () => {
    expect(() => requestedSpeechFromEnv({ HARNESS_TTS: 'festival' })).toThrow(/HARNESS_TTS=festival/)
    expect(() => requestedSpeechFromEnv({ HARNESS_TTS_VOLUME: '11' })).toThrow(/HARNESS_TTS_VOLUME=11/)
  })

  it('round-trips into the mode the page parses', () => {
    const requested = requestedSpeechFromEnv({ HARNESS_TTS: 'synthetic', HARNESS_TTS_VOLUME: '0.25' })
    expect(speechParamsFor(requested)).toBe('tts=synthetic&ttsVolume=0.25')
    expect(speechModeFromParams(params(speechParamsFor(requested)))).toEqual({ engine: 'synthetic', volume: 0.25 })
    expect(speechParamsFor({ engine: 'browser' })).toBe('tts=browser')
  })
})

describe('needsSilencedOutput', () => {
  it('only cuts the speakers when synthetic audio is loud enough to reach them', () => {
    expect(needsSilencedOutput({ engine: 'synthetic', volume: 0 })).toBe(false)
    expect(needsSilencedOutput({ engine: 'synthetic', volume: 1 })).toBe(true)
    // The browser engine has no analyser to cut; its level is the utterance's own volume.
    expect(needsSilencedOutput({ engine: 'browser', volume: 1 })).toBe(false)
  })
})
