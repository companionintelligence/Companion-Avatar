import type { FaceRegion } from './regions'

/**
 * How a layer's contribution combines with the value already resolved beneath it.
 *
 * `max` is the default for facial morphs because summing two expressions that
 * share a key (a smile and a viseme both wanting `mouthSmileLeft`) overshoots
 * into a grimace, while `replace` would let whichever layer ran last erase the
 * other. `max` degrades gracefully in both directions.
 */
export type BlendMode = 'replace' | 'max' | 'add'

export interface LayerSpec {
  id: string
  /** Higher wins. Ties resolve in registration order. */
  priority: number
  /** Default blend for this layer's contributions. */
  blend: BlendMode
  /**
   * Regions this layer is allowed to write. Omit for "any region".
   * A contribution to a region the layer does not own is dropped, not clamped —
   * silently narrowing it would hide the bug in the producer.
   */
  owns?: readonly FaceRegion[]
}

/**
 * A rig that can receive canonical ARKit-52 weights.
 *
 * Implementations own the translation from the canonical vocabulary down to
 * whatever channels the loaded avatar actually exposes (ARKit morph targets,
 * Oculus `viseme_*`, VRM expressions). The compositor never branches on rig type.
 */
export interface FaceRig {
  /** Does this rig expose anything the given canonical key can drive? */
  has(key: string): boolean
  /**
   * Write one canonical key. Called at most once per key per frame, and only when its
   * value has changed: a weight that holds steady is written once, so the rig keeps
   * the last value it was given until the next write. The compositor always ends a
   * weight with an explicit write of 0.
   */
  write(key: string, value: number): void
  /** Flush, if the underlying rig batches (e.g. VRM expressionManager.update). Called after every frame's writes. */
  commit?(): void
}

export interface RegionOwnership {
  region: FaceRegion
  /** The layer whose contribution survived for this region, or null if nothing wrote it. */
  winner: string | null
  /** True when the winner took the region exclusively, suppressing lower layers. */
  exclusive: boolean
}

/**
 * Per-frame explanation of what the compositor did. Consumed by the test harness
 * (`window.__harness.compositorTrace`) so a regression in arbitration is visible
 * as data rather than as "the mouth looks wrong in this WebP".
 */
export interface CompositorTrace {
  regions: RegionOwnership[]
  /** Canonical keys written this frame, with their resolved values. */
  written: Record<string, number>
  /** Keys that had a value last frame and are now decaying back to rest. */
  releasing: string[]
}
