import { describe, expect, it } from 'vitest'

import { resolveAvatarSource } from '@ci-avatar/engine'

import { AvatarOptions } from '../AvatarOptions'
import { CC0_AVATAR_SOURCES } from '../cc0Avatars'
import { GREEN_ORB_PALETTE, ORB_AVATAR_OPTIONS, isOrbAvatarSource, orbPaletteFor } from './orbCatalog'

describe('drawn avatars', () => {
  it('offer the Green Orb, which shadows no model or CC0 name', () => {
    expect(ORB_AVATAR_OPTIONS['Green Orb']).toBe('orb:green')
    for (const [name, source] of Object.entries(ORB_AVATAR_OPTIONS)) {
      expect(isOrbAvatarSource(source)).toBe(true)
      expect(Object.keys(AvatarOptions)).not.toContain(name)
      expect(Object.keys(CC0_AVATAR_SOURCES)).not.toContain(name)
    }
  })

  it('resolve by name through the catalog the Settings avatar box uses', () => {
    const catalog = { ...AvatarOptions, ...ORB_AVATAR_OPTIONS, ...CC0_AVATAR_SOURCES }
    expect(resolveAvatarSource('Green Orb', catalog)).toEqual({ ok: true, url: 'orb:green' })
  })

  it('are chosen by name: a typed orb: token is not a URL the box loads', () => {
    expect(resolveAvatarSource('orb:green', AvatarOptions)).toMatchObject({ ok: false, error: 'unsupported-protocol' })
  })

  it('tell an orb source from a model path or URL', () => {
    expect(isOrbAvatarSource('orb:green')).toBe(true)
    expect(isOrbAvatarSource(AvatarOptions.Greg)).toBe(false)
    expect(isOrbAvatarSource('https://example.com/orb:green.glb')).toBe(false)
    expect(isOrbAvatarSource('')).toBe(false)
    expect(isOrbAvatarSource(undefined)).toBe(false)
    expect(isOrbAvatarSource(null)).toBe(false)
  })

  it('draw in CI phthalo, and an unknown colour draws the green orb rather than nothing', () => {
    expect(GREEN_ORB_PALETTE.deep).toBe('#0a6358')
    expect(orbPaletteFor('orb:green')).toBe(GREEN_ORB_PALETTE)
    expect(orbPaletteFor('orb:mauve')).toBe(GREEN_ORB_PALETTE)
    for (const tone of Object.values(GREEN_ORB_PALETTE)) expect(tone).toMatch(/^#[0-9a-f]{6}$/)
  })
})
