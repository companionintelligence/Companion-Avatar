import { regionOf, type FaceRegion } from './regions'
import type { BlendMode, CompositorTrace, FaceRig, LayerSpec, RegionOwnership } from './types'

/**
 * FaceCompositor — the single owner of every facial weight the avatar shows.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this, the render loop ran two lip-sync engines and an emote service that
 * each wrote `morphTargetInfluences` / `expressionManager.setValue` directly, in
 * sequence, every frame. Whoever ran last won, so a smile could flatten a viseme,
 * an FFT path with no audio could pin the mouth shut, and a dirty-cache in one
 * writer was silently invalidated by the other — leaving VRM mouths stuck closed.
 *
 * The fix is not "order the writers more carefully"; it is to remove the ability
 * to write at all. Producers submit weighted contributions to a named layer, the
 * compositor arbitrates once per frame, and exactly one write reaches the rig.
 *
 * ARBITRATION
 * -----------
 * 1. Contributions to a region a layer does not own are dropped.
 * 2. A layer may CLAIM a region for the frame. The highest-priority claimant
 *    suppresses every lower-priority layer in that region — including keys the
 *    claimant did not write, which fall to rest. This is what "speech owns the
 *    mouth while speaking" means, and it is the whole reason emotion can no
 *    longer smear a viseme.
 * 3. Surviving contributions combine by blend mode, ascending by priority.
 *
 * RELEASE
 * -------
 * A key written last frame but not this frame decays toward rest rather than
 * being abandoned at its last value. Stuck morphs — a frozen expression after a
 * barge-in, a mouth held open after the audio stopped — are all this bug, and
 * the compositor is the only place it can be fixed once.
 */

interface Contribution {
  value: number
  blend: BlendMode
  priority: number
  layerId: string
}

const EPSILON = 1e-3

/** Time constant for the release ramp, in seconds. ~90% closed after 3x this. */
const DEFAULT_RELEASE_TAU = 0.06

export interface FaceCompositorOptions {
  /** Seconds. Larger = slower return to rest for un-written keys. */
  releaseTau?: number
}

export class FaceCompositor {
  private readonly layers = new Map<string, LayerSpec>()
  private readonly order: string[] = []
  private readonly releaseTau: number

  /** This frame's contributions, keyed by canonical morph name. */
  private frame = new Map<string, Contribution[]>()
  /** Regions claimed exclusively this frame → the claiming layer. */
  private claims = new Map<FaceRegion, LayerSpec>()

  /**
   * Authoritative resolved value per key. Always advances, even on frames where
   * the change is too small to be worth a rig write — decoupling these two is
   * what stops a slow release ramp from stalling just above rest.
   */
  private current = new Map<string, number>()
  /** Last value actually sent to the rig, so we can skip redundant writes. */
  private rigValue = new Map<string, number>()
  /** Keys with a non-zero value that no layer wrote this frame. */
  private releasing = new Map<string, number>()
  /** The rig this compositor is driving: the last one `applyTo` wrote to or `reset` closed. */
  private lastRig: FaceRig | null = null

  private lastTrace: CompositorTrace = { regions: [], written: {}, releasing: [] }

  constructor(layers: readonly LayerSpec[], options: FaceCompositorOptions = {}) {
    this.releaseTau = options.releaseTau ?? DEFAULT_RELEASE_TAU
    for (const layer of layers) this.registerLayer(layer)
  }

  registerLayer(layer: LayerSpec): void {
    if (this.layers.has(layer.id)) {
      throw new Error(`FaceCompositor: duplicate layer id "${layer.id}"`)
    }
    this.layers.set(layer.id, layer)
    this.order.push(layer.id)
  }

  /** Start a frame. Clears contributions and claims; retains release state. */
  begin(): void {
    this.frame.clear()
    this.claims.clear()
  }

  /**
   * Take a region for this frame, suppressing lower-priority layers within it.
   * Re-claiming with a lower priority than the standing claimant is a no-op, so
   * call order between producers does not matter.
   */
  claim(layerId: string, regions: readonly FaceRegion[]): void {
    const layer = this.requireLayer(layerId)
    for (const region of regions) {
      if (layer.owns && !layer.owns.includes(region)) continue
      const standing = this.claims.get(region)
      if (!standing || layer.priority > standing.priority) {
        this.claims.set(region, layer)
      }
    }
  }

  /**
   * Submit one canonical ARKit key. Values outside 0..1 are clamped; NaN is
   * dropped (a NaN reaching a morph influence blanks the whole mesh in three.js,
   * and tracking that back to its producer is miserable).
   */
  set(layerId: string, key: string, value: number, blend?: BlendMode): void {
    if (!Number.isFinite(value)) return
    const layer = this.requireLayer(layerId)

    const region = regionOf(key)
    if (region && layer.owns && !layer.owns.includes(region)) return

    const clamped = value < 0 ? 0 : value > 1 ? 1 : value
    const list = this.frame.get(key)
    const contribution: Contribution = {
      value: clamped,
      blend: blend ?? layer.blend,
      priority: layer.priority,
      layerId: layer.id
    }
    if (list) list.push(contribution)
    else this.frame.set(key, [contribution])
  }

  /** Submit a whole map at once — the common case for an engine's output. */
  setAll(layerId: string, weights: Readonly<Record<string, number>>, blend?: BlendMode): void {
    for (const key in weights) this.set(layerId, key, weights[key], blend)
  }

  /**
   * Resolve the frame into final weights. Pure: safe to call in a test without a
   * rig. `delta` (seconds) drives the release ramp for keys nothing wrote.
   */
  resolve(delta: number): Map<string, number> {
    const resolved = new Map<string, number>()
    const regionWinners = new Map<FaceRegion, RegionOwnership>()
    /** Strongest resolved weight seen per region, so `winner` names the layer that actually shows. */
    const regionPeak = new Map<FaceRegion, number>()

    for (const [key, contributions] of this.frame) {
      const region = regionOf(key)
      const claimant = region ? this.claims.get(region) : undefined

      // A claimed region admits only the claimant and anything above it.
      const admitted = claimant
        ? contributions.filter((c) => c.priority >= claimant.priority)
        : contributions
      if (admitted.length === 0) continue

      admitted.sort((a, b) => a.priority - b.priority)

      let value = 0
      let winner = admitted[0].layerId
      for (const c of admitted) {
        if (c.blend === 'replace') {
          value = c.value
          winner = c.layerId
        } else if (c.blend === 'add') {
          value = Math.min(1, value + c.value)
          winner = c.layerId
        } else {
          if (c.value > value) {
            value = c.value
            winner = c.layerId
          }
        }
      }

      resolved.set(key, value)
      if (region) {
        // Report the region's winner as the layer that supplied its strongest key,
        // which is what a reader actually wants to know when a face looks wrong.
        const peak = regionPeak.get(region)
        if (peak === undefined || value > peak) {
          regionPeak.set(region, value)
          regionWinners.set(region, { region, winner, exclusive: Boolean(claimant) })
        }
      }
    }

    // Release: anything with a live value that nobody wrote this frame ramps down.
    const releaseFactor = delta > 0 ? 1 - Math.exp(-delta / this.releaseTau) : 1
    for (const [key, previous] of this.current) {
      if (resolved.has(key)) continue
      const next = previous + (0 - previous) * releaseFactor
      if (Math.abs(next) < EPSILON) {
        this.releasing.delete(key)
        resolved.set(key, 0)
      } else {
        this.releasing.set(key, next)
        resolved.set(key, next)
      }
    }

    for (const [key, value] of resolved) this.current.set(key, value)

    this.lastTrace = {
      regions: [...regionWinners.values()],
      written: Object.fromEntries(resolved),
      releasing: [...this.releasing.keys()]
    }

    return resolved
  }

  /**
   * Resolve and push to the rig. Only changed values are written, which is now a
   * SOUND optimisation rather than the unsound one it was before: with a single
   * writer, nothing can mutate a morph behind the cache's back.
   */
  applyTo(rig: FaceRig, delta: number): void {
    this.lastRig = rig
    const resolved = this.resolve(delta)

    for (const [key, value] of resolved) {
      if (!rig.has(key)) continue
      const sent = this.rigValue.get(key)
      // Land exactly on rest even when the final step of a ramp is tiny —
      // otherwise a morph settles a hair open and never closes.
      const settling = value === 0 && sent !== 0
      if (sent !== undefined && !settling && Math.abs(sent - value) < EPSILON) continue
      rig.write(key, value)
      this.rigValue.set(key, value)
    }

    // Drop fully-released keys so the maps do not grow without bound. A key
    // qualifies once it has reached rest AND no layer is still driving it; keys
    // a producer is deliberately holding at 0 stay tracked.
    for (const [key, value] of this.current) {
      if (value === 0 && !this.frame.has(key)) {
        this.current.delete(key)
        this.rigValue.delete(key)
      }
    }

    rig.commit?.()
  }

  /**
   * Zero everything immediately — barge-in, avatar swap, teardown. Distinct from
   * the release ramp: an interrupted utterance must close the mouth now, not over
   * the next 200 ms.
   *
   * Without a rig it closes the one this compositor has been driving. Forgetting
   * the keys without telling the rig would strand whatever the rig still holds,
   * and a rig that holds weights between writes (see FaceRig.write) gets no
   * other word about them.
   */
  reset(rig: FaceRig | undefined = this.lastRig ?? undefined): void {
    if (rig) this.lastRig = rig
    for (const key of this.current.keys()) {
      if (rig?.has(key)) rig.write(key, 0)
    }
    rig?.commit?.()
    this.current.clear()
    this.rigValue.clear()
    this.releasing.clear()
    this.frame.clear()
    this.claims.clear()
    this.lastTrace = { regions: [], written: {}, releasing: [] }
  }

  /** Last frame's arbitration, for the harness and for debugging. */
  trace(): CompositorTrace {
    return this.lastTrace
  }

  private requireLayer(layerId: string): LayerSpec {
    const layer = this.layers.get(layerId)
    if (!layer) throw new Error(`FaceCompositor: unknown layer "${layerId}"`)
    return layer
  }
}
