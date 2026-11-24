/**
 * regions.ts — the canonical facial vocabulary, partitioned by anatomy.
 *
 * The compositor speaks ONE vocabulary: the 52 Apple ARKit blendshapes. Every rig
 * (GLB morph targets, Oculus `viseme_*`, VRM expressions) is reached through an
 * adapter that translates down from it, so producers never branch on rig type and
 * a mapping lives in exactly one place.
 *
 * Keys are grouped into REGIONS because that is the unit of contention. Two
 * producers wanting `jawOpen` is not the interesting case; a speech engine and an
 * emotion engine both wanting "the mouth" is. Ownership is resolved per region
 * (see FaceCompositor), which is what stops a smile from flattening a viseme.
 */

export type FaceRegion = 'jaw' | 'lips' | 'tongue' | 'eyelids' | 'gaze' | 'brows' | 'cheeks' | 'nose'

/** Regions the mouth is made of. Speech claims these together or not at all. */
export const MOUTH_REGIONS: readonly FaceRegion[] = ['jaw', 'lips', 'tongue']

const REGION_KEYS: Record<FaceRegion, readonly string[]> = {
  jaw: ['jawForward', 'jawLeft', 'jawRight', 'jawOpen'],

  // Everything that shapes the lips. `mouthSmile*`/`mouthFrown*` live here even
  // though emotion also wants them — that overlap is precisely what region
  // ownership arbitrates, and putting them anywhere else would hide the conflict.
  lips: [
    'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
    'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
    'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight',
    'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
    'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
    'mouthUpperUpLeft', 'mouthUpperUpRight'
  ],

  tongue: ['tongueOut'],

  eyelids: ['eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight'],

  // Gaze is separated from eyelids so a blink can win the lids without also
  // freezing where the eyes are pointing.
  gaze: [
    'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
    'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight'
  ],

  brows: ['browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'],

  cheeks: ['cheekPuff', 'cheekSquintLeft', 'cheekSquintRight'],

  nose: ['noseSneerLeft', 'noseSneerRight']
}

/** The 52 canonical ARKit keys, in region order. */
export const ARKIT_52: readonly string[] = Object.values(REGION_KEYS).flat()

const KEY_TO_REGION: ReadonlyMap<string, FaceRegion> = new Map(
  (Object.entries(REGION_KEYS) as [FaceRegion, readonly string[]][]).flatMap(([region, keys]) =>
    keys.map((key) => [key, region] as const)
  )
)

/**
 * Prefix for a direct viseme identity, e.g. `viseme:aa`.
 *
 * ARKit muscle activations cannot losslessly express an Oculus viseme, so a
 * producer that KNOWS the phonetic shape (HeadTTS returns viseme ids outright)
 * publishes that identity. A rig that carries `viseme_*` morphs takes the exact shape;
 * a rig that does not folds it down to the ARKit weights it does have (the VRM rig onto
 * the VRM mouth set, the morph-target rig through `rigs/visemeFold.ts`). The producer
 * publishes the identity ALONE: ARKit weights beside it would articulate the same shape
 * twice on a head that has both. It is an upgrade path, not a second vocabulary.
 */
export const VISEME_KEY_PREFIX = 'viseme:'

/**
 * The region a canonical key belongs to, or undefined for a key outside the ARKit
 * vocabulary. Unknown keys are deliberately NOT coerced into a region: a producer
 * writing a bespoke morph name gets it passed through un-arbitrated rather than
 * silently filed under the wrong owner.
 */
export function regionOf(key: string): FaceRegion | undefined {
  if (key.startsWith(VISEME_KEY_PREFIX)) return 'lips'
  return KEY_TO_REGION.get(key)
}

export function keysInRegion(region: FaceRegion): readonly string[] {
  return REGION_KEYS[region]
}
