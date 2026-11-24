import type { VisemeId } from '../../lipsync/VisemeSchedule'

/**
 * Oculus viseme → the ARKit mouth weights that most nearly make the same shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * The timed lip-sync tiers (the schedule built from the engine's own word timings, and
 * the legacy word-timed sequence) publish `viseme:aa`, `viseme:PP`, … — the phonetic
 * IDENTITY, not a set of muscle weights. A head with `viseme_*` morphs takes that
 * identity as-is, which is lossless. A head WITHOUT them used to ignore it: the morph-target
 * rig forwarded `viseme:X` only to a `viseme_X` morph, so on the three catalog avatars that
 * ship just `mouthOpen` and `mouthSmile` (Brit, Liam, Liam CES), and on any ARKit-only GLB,
 * the timed tier claimed the mouth and moved nothing. VRMs were never affected: their rig
 * has folded `viseme:` onto the VRM mouth set since it was written.
 *
 * This table is that fold for the morph-target rig. It is the same mapping the acoustic
 * path has always used for its text-derived shapes (`VISEME_WEIGHTS` in
 * core/services/visemes/visemeTable.ts, keyed there by a differently spelled id), so a head
 * that cannot take `viseme:` gets the same shapes from the timed tiers that it gets from the
 * acoustic one. The engine cannot import from core, so the numbers live here too; a test in
 * core compares the two tables id by id so they cannot drift apart.
 *
 * A one-morph head only ever receives `jawOpen` (through the `mouthOpen` alias), so for it
 * the whole table reduces to how far each shape opens the jaw: wide vowels open it, a
 * closure (`PP`, `nn`) leaves it to the other visemes' release.
 */
export const VISEME_TO_ARKIT: Readonly<Record<VisemeId, Readonly<Record<string, number>>>> = {
  sil: { mouthClose: 0.1 },
  PP: { mouthClose: 0.7, mouthPressLeft: 0.4, mouthPressRight: 0.4 },
  FF: {
    jawOpen: 0.1,
    mouthFunnel: 0.3,
    mouthUpperUpLeft: 0.2,
    mouthUpperUpRight: 0.2,
    mouthRollLower: 0.3
  },
  TH: { jawOpen: 0.15, tongueOut: 0.3, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1 },
  DD: { jawOpen: 0.2, mouthStretchLeft: 0.1, mouthStretchRight: 0.1, mouthShrugUpper: 0.15 },
  kk: { jawOpen: 0.15, mouthShrugLower: 0.1, mouthShrugUpper: 0.1 },
  CH: { jawOpen: 0.15, mouthFunnel: 0.35, mouthPucker: 0.15, mouthShrugUpper: 0.1 },
  SS: {
    jawOpen: 0.05,
    mouthStretchLeft: 0.25,
    mouthStretchRight: 0.25,
    mouthSmileLeft: 0.1,
    mouthSmileRight: 0.1
  },
  nn: { mouthClose: 0.4, mouthPressLeft: 0.2, mouthPressRight: 0.2, mouthShrugLower: 0.1 },
  RR: { jawOpen: 0.2, mouthFunnel: 0.15, mouthShrugUpper: 0.1 },
  aa: {
    jawOpen: 0.6,
    mouthLowerDownLeft: 0.2,
    mouthLowerDownRight: 0.2,
    mouthStretchLeft: 0.1,
    mouthStretchRight: 0.1
  },
  E: {
    jawOpen: 0.15,
    mouthSmileLeft: 0.35,
    mouthSmileRight: 0.35,
    mouthStretchLeft: 0.2,
    mouthStretchRight: 0.2
  },
  I: {
    jawOpen: 0.2,
    mouthSmileLeft: 0.2,
    mouthSmileRight: 0.2,
    mouthStretchLeft: 0.1,
    mouthStretchRight: 0.1
  },
  O: { jawOpen: 0.35, mouthFunnel: 0.25, mouthPucker: 0.15 },
  U: { jawOpen: 0.1, mouthFunnel: 0.45, mouthPucker: 0.4 }
}

/** The Oculus viseme ids the table covers. */
export const VISEME_IDS: readonly string[] = Object.keys(VISEME_TO_ARKIT)

/** Every canonical ARKit key some viseme folds onto. */
export const VISEME_FOLD_KEYS: ReadonlySet<string> = new Set(
  Object.values(VISEME_TO_ARKIT).flatMap((weights) => Object.keys(weights))
)

/** The folded weights for a viseme id, or undefined for an id outside the Oculus set. */
export function foldedWeights(id: string): Readonly<Record<string, number>> | undefined {
  return Object.prototype.hasOwnProperty.call(VISEME_TO_ARKIT, id) ? VISEME_TO_ARKIT[id as VisemeId] : undefined
}
