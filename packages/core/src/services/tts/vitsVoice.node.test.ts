import { PATH_MAP } from '@diffusionstudio/vits-web'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_VITS_VOICE, createVitsVoiceChooser } from './vitsVoice'

/**
 * The voice the VITS worker hands vits-web's predict(). With an id vits-web does not have, predict() fetches
 * `.../undefined.json`, gets a 404, and the worker never answers (vitsVoice.ts). These tests use vits-web's own
 * PATH_MAP, so an upgrade that drops the default voice fails here rather than in a browser.
 */
describe('the VITS voice', () => {
  it('defaults to a voice vits-web has', () => {
    expect(Object.hasOwn(PATH_MAP, DEFAULT_VITS_VOICE)).toBe(true)
  })

  it('replaces two names vits-web does not have: the old shared default and the old worker fallback', () => {
    // 'marius' is a Pocket TTS voice; vits-web's hfc_male voice is en_US only
    expect(Object.hasOwn(PATH_MAP, 'marius')).toBe(false)
    expect(Object.hasOwn(PATH_MAP, 'en_GB-hfc_male-medium')).toBe(false)
    expect(Object.hasOwn(PATH_MAP, 'en_US-hfc_male-medium')).toBe(true)
  })

  it('uses a voice vits-web has as given, with no warning', () => {
    const warn = vi.fn()
    const choose = createVitsVoiceChooser(PATH_MAP, warn)
    expect(choose('en_US-amy-medium')).toBe('en_US-amy-medium')
    expect(choose(' en_GB-alba-medium ')).toBe('en_GB-alba-medium')
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '   '])('gives no voice (%j) the default, with no warning', (requested) => {
    const warn = vi.fn()
    expect(createVitsVoiceChooser(PATH_MAP, warn)(requested)).toBe(DEFAULT_VITS_VOICE)
    expect(warn).not.toHaveBeenCalled()
  })

  it('gives any other name the default, and warns once for each name', () => {
    const warn = vi.fn()
    const choose = createVitsVoiceChooser(PATH_MAP, warn)
    // one sentence after another, the way the worker is asked
    const chosen = ['marius', 'marius', 'echo', 'marius'].map(choose)
    expect(chosen).toEqual(Array(4).fill(DEFAULT_VITS_VOICE))
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toContain("no voice 'marius'")
    expect(warn.mock.calls[0][0]).toContain(`speaks with '${DEFAULT_VITS_VOICE}'`)
    expect(warn.mock.calls[1][0]).toContain("no voice 'echo'")
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'does not take %s, which every object has, for a voice',
    (name) => {
      expect(createVitsVoiceChooser(PATH_MAP, vi.fn())(name)).toBe(DEFAULT_VITS_VOICE)
    }
  )

  it('warns on the console when given no warn function', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createVitsVoiceChooser(PATH_MAP)('marius')).toBe(DEFAULT_VITS_VOICE)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })
})
