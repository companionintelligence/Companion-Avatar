import { VISEME_KEY_PREFIX } from '../regions'
import type { FaceRig } from '../types'
import { VISEME_FOLD_KEYS, VISEME_IDS, foldedWeights } from './visemeFold'

/**
 * The only thing this adapter needs from a mesh. Structural rather than
 * `THREE.Mesh` so the face package stays renderer-free and unit-testable with a
 * plain object — three.js meshes satisfy it as-is.
 */
export interface MorphTargetMeshLike {
  morphTargetDictionary?: Record<string, number>
  morphTargetInfluences?: number[]
}

/**
 * MorphTargetFaceRig — canonical ARKit weights onto glTF morph targets.
 *
 * Handles the three channel families a GLB head may carry, in preference order:
 *
 *   1. ARKit-52 morphs (`jawOpen`, `eyeBlinkLeft`, …) — written directly.
 *   2. Oculus visemes (`viseme_aa` …) — driven from an explicit `viseme:` key when
 *      a producer supplies one, otherwise DERIVED from the ARKit mouth weights.
 *   3. Legacy aliases (`Blink`, `eyesClosed`, `mouthOpen`) — the lowest common
 *      denominator on older/exported heads.
 *
 * The derivation in (2) is lossy and always has been: it is a guess at a phonetic
 * shape from muscle activations. It lives here, once, instead of being inlined in
 * the render loop — and `viseme:` lets it be bypassed entirely once the TTS engine
 * reports real viseme ids.
 *
 * The other direction: a head with NO `viseme_*` morph at all (ARKit-only exports, and
 * the catalog's one-morph heads that carry just `mouthOpen`) cannot take a `viseme:` key
 * as it is, so the key is folded onto the ARKit mouth weights the head does have (see
 * `visemeFold.ts`). Without that the timed lip-sync tiers, which publish only `viseme:`
 * keys, moved nothing on such a head. A head that carries any `viseme_*` morph is left
 * as it was: it takes the exact shape, and folding as well would articulate the same
 * viseme twice.
 */

/** ARKit key → the Oculus viseme it most nearly implies, with a scale factor. */
const ARKIT_TO_OCULUS: Readonly<Record<string, readonly [string, number]>> = {
  jawOpen: ['viseme_aa', 1],
  mouthSmileLeft: ['viseme_E', 1],
  mouthStretchLeft: ['viseme_I', 1],
  mouthFunnel: ['viseme_O', 1],
  mouthPucker: ['viseme_U', 1],
  mouthClose: ['viseme_PP', 1],
  mouthRollLower: ['viseme_FF', 1],
  tongueOut: ['viseme_TH', 1],
  mouthShrugUpper: ['viseme_DD', 1],
  mouthShrugLower: ['viseme_kk', 1],
  mouthSmileRight: ['viseme_SS', 1],
  mouthPressLeft: ['viseme_nn', 1]
}

/** Canonical key → legacy single-morph aliases some heads ship instead. */
const LEGACY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  jawOpen: ['mouthOpen'],
  eyeBlinkLeft: ['Blink', 'eyesClosed'],
  eyeBlinkRight: ['Blink', 'eyesClosed']
}

interface Target {
  influences: number[]
  index: number
}

export class MorphTargetFaceRig implements FaceRig {
  /** Canonical (or raw morph) name → every mesh slot it drives. */
  private readonly targets = new Map<string, Target[]>()
  private readonly available = new Set<string>()

  /**
   * Oculus viseme ids this head takes by folding them onto its ARKit or legacy mouth
   * channels. Empty on any head that carries a `viseme_*` morph, which takes them exactly.
   */
  private readonly foldable = new Set<string>()
  /** Folded visemes' current weights (only the ones above zero). */
  private readonly foldLevels = new Map<string, number>()
  /**
   * What was last written to each ARKit key a viseme can fold onto, by anything other
   * than the fold. The compositor resends a value only when it changes, so a held smile is
   * not written again when a viseme lets go of the same key; without this the fold would
   * zero it.
   */
  private readonly requested = new Map<string, number>()

  constructor(meshes: readonly MorphTargetMeshLike[]) {
    for (const mesh of meshes) {
      const dictionary = mesh.morphTargetDictionary
      const influences = mesh.morphTargetInfluences
      if (!dictionary || !influences) continue
      for (const [name, index] of Object.entries(dictionary)) {
        this.available.add(name)
        const list = this.targets.get(name)
        const target: Target = { influences, index }
        if (list) list.push(target)
        else this.targets.set(name, [target])
      }
    }

    if (![...this.available].some((name) => name.startsWith('viseme_'))) {
      for (const id of VISEME_IDS) {
        const weights = foldedWeights(id)
        if (weights && Object.keys(weights).some((key) => this.canDrive(key))) this.foldable.add(id)
      }
    }
  }

  /** True when this head carries any Oculus `viseme_*` morph. */
  get hasOculusVisemes(): boolean {
    return this.available.has('viseme_aa')
  }

  has(key: string): boolean {
    if (key.startsWith(VISEME_KEY_PREFIX)) {
      const id = key.slice(VISEME_KEY_PREFIX.length)
      return this.available.has(`viseme_${id}`) || this.foldable.has(id)
    }
    if (this.available.has(key)) return true
    if (this.hasOculusVisemes && key in ARKIT_TO_OCULUS) return true
    return this.hasLegacyAlias(key)
  }

  write(key: string, value: number): void {
    if (key.startsWith(VISEME_KEY_PREFIX)) {
      const id = key.slice(VISEME_KEY_PREFIX.length)
      if (this.available.has(`viseme_${id}`)) this.writeRaw(`viseme_${id}`, value)
      else if (this.foldable.has(id)) this.foldViseme(id, value)
      return
    }

    // A key some viseme can also drive: keep the request, and never let it undercut
    // the shape a viseme is holding there right now.
    if (this.foldable.size > 0 && VISEME_FOLD_KEYS.has(key)) {
      this.requested.set(key, value)
      this.writeArkit(key, Math.max(value, this.foldedLevel(key)))
      return
    }

    this.writeArkit(key, value)
  }

  /** Canonical ARKit key → the head's own morph, else the Oculus or legacy channel that carries it. */
  private writeArkit(key: string, value: number): void {
    const wroteCanonical = this.writeRaw(key, value)

    // Mirror onto an Oculus viseme only when the head has no ARKit key of its
    // own to carry the shape; a head with both would otherwise get the same
    // articulation twice and over-open.
    if (!wroteCanonical && this.hasOculusVisemes) {
      const mapped = ARKIT_TO_OCULUS[key]
      if (mapped) this.writeRaw(mapped[0], value * mapped[1])
    }

    if (!wroteCanonical) {
      for (const alias of LEGACY_ALIASES[key] ?? []) this.writeRaw(alias, value)
    }
  }

  /** Does this head have a morph, or a legacy single morph, that can carry the ARKit key? */
  private canDrive(key: string): boolean {
    return this.available.has(key) || this.hasLegacyAlias(key)
  }

  private hasLegacyAlias(key: string): boolean {
    return (LEGACY_ALIASES[key] ?? []).some((alias) => this.available.has(alias))
  }

  /**
   * Take a viseme's new weight and re-resolve every ARKit key it folds onto. Every viseme
   * held at the moment counts, not just this one: two overlapping shapes that share a key
   * (coarticulation) show the stronger of the two rather than whichever was written last.
   */
  private foldViseme(id: string, weight: number): void {
    const weights = foldedWeights(id)
    if (!weights) return
    if (weight > 0) this.foldLevels.set(id, weight)
    else this.foldLevels.delete(id)

    for (const key of Object.keys(weights)) {
      this.writeArkit(key, Math.max(this.requested.get(key) ?? 0, this.foldedLevel(key)))
    }
  }

  private foldedLevel(key: string): number {
    let level = 0
    for (const [id, weight] of this.foldLevels) {
      const share = foldedWeights(id)?.[key]
      if (share !== undefined && share * weight > level) level = share * weight
    }
    return level
  }

  private writeRaw(name: string, value: number): boolean {
    const targets = this.targets.get(name)
    if (!targets) return false
    for (const t of targets) t.influences[t.index] = value
    return true
  }
}
