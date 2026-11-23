/**
 * The VRM components the frame loop ticks. Structural rather than `VRM`, so a test
 * can pass a stub.
 */
export interface VrmFrameParts {
  lookAt?: { update(delta: number): void } | null
  nodeConstraintManager?: { update(): void } | null
  springBoneManager?: { update(delta: number): void } | null
  materials?: readonly object[] | null
}

type Updatable = { update(delta: number): void }
const isUpdatable = (value: object): value is Updatable =>
  typeof (value as Partial<Updatable>).update === 'function'

/**
 * Per-frame secondary motion for a VRM the frame loop drives itself: the parts of
 * `VRM.update` the rest of the frame does not already own, in the same order. Look-at
 * first, then node constraints (aim constraints), then spring bones, so the chains hang
 * off the constrained pose. Then each material's own update (MToon UV animation).
 *
 * Deliberately not `vrm.update(delta)`: that also re-drives the humanoid and the
 * expression manager, which the mixer, gaze and face compositor already own.
 */
export const updateVrmFrameMotion = (vrm: VrmFrameParts, delta: number): void => {
  vrm.lookAt?.update(delta)
  vrm.nodeConstraintManager?.update()
  vrm.springBoneManager?.update(delta)
  for (const material of vrm.materials ?? []) {
    if (isUpdatable(material)) material.update(delta)
  }
}
