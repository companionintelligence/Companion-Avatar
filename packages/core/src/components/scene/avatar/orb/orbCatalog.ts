/**
 * Avatars drawn in code rather than loaded from a model file.
 *
 * The first is the green orb: a floating ball of light that answers the conversation with its glow instead of a face.
 * It is chosen like any other avatar, by name. Its source is an `orb:` token rather than a URL, and the token is what
 * `AvatarState.selectedModel` holds, so everything that keys on the selected model (AvatarModel's remount, the label in
 * Settings) works unchanged.
 *
 * The orb catalog is kept apart from AvatarOptions on purpose. scripts/pack-assets.mjs gates every AvatarOptions entry
 * against a file on disk, and the e2e render matrices load every one of them as a model.
 */

/** The four tones an orb is drawn with, as sRGB hex. */
export interface OrbPalette {
  /** The darkest tone: the body of the ball and the outside of its halo. */
  readonly deep: string
  /** The body. */
  readonly mid: string
  /** The filaments, the rings, the motes and the middle of the halo. */
  readonly bright: string
  /** The white-hot centre, strongest while it speaks. */
  readonly hot: string
}

/** CI phthalo (#0a6358, the canon `--primary`) rising to a pale mint centre. */
export const GREEN_ORB_PALETTE: OrbPalette = Object.freeze({
  deep: '#0a6358',
  mid: '#12a37a',
  bright: '#3df2a6',
  hot: '#dcfff0'
})

export const ORB_SOURCE_PREFIX = 'orb:'

const ORB_PALETTES: Readonly<Record<string, OrbPalette>> = Object.freeze({
  green: GREEN_ORB_PALETTE
})

/** The drawn avatars, keyed by the name the pickers show. */
export const ORB_AVATAR_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  'Green Orb': `${ORB_SOURCE_PREFIX}green`
})

/** True when an avatar source names a drawn orb rather than a model file. */
export function isOrbAvatarSource(source: string | null | undefined): source is string {
  return typeof source === 'string' && source.startsWith(ORB_SOURCE_PREFIX)
}

/** The palette an `orb:` source names. An unknown colour draws the green orb rather than nothing. */
export function orbPaletteFor(source: string): OrbPalette {
  const name = isOrbAvatarSource(source) ? source.slice(ORB_SOURCE_PREFIX.length) : ''
  return ORB_PALETTES[name] ?? GREEN_ORB_PALETTE
}
