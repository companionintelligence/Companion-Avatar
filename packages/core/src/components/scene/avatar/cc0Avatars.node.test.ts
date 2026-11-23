import { describe, expect, it } from 'vitest'

import { resolveAvatarSource } from '@ci-avatar/engine'

import { AvatarOptions } from './AvatarOptions'
import { CC0_AVATAR_SOURCES } from './cc0Avatars'

describe('CC0 avatar sources', () => {
  it('are named osa, link to Arweave, and never shadow a built-in name', () => {
    for (const [name, url] of Object.entries(CC0_AVATAR_SOURCES)) {
      expect(name).toMatch(/^osa: \S/)
      expect(url).toMatch(/^https:\/\/arweave\.net\/[A-Za-z0-9_-]{43}$/)
      expect(Object.keys(AvatarOptions)).not.toContain(name)
    }
  })

  it('resolve by name through the catalog the Settings avatar box uses', () => {
    const catalog = { ...AvatarOptions, ...CC0_AVATAR_SOURCES }
    expect(resolveAvatarSource('osa: Devil', catalog)).toEqual({
      ok: true,
      url: CC0_AVATAR_SOURCES['osa: Devil']
    })
  })
})
