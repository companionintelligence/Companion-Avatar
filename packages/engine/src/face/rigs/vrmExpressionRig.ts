import { VISEME_KEY_PREFIX } from '../regions'
import type { FaceRig } from '../types'

/**
 * VrmExpressionFaceRig — canonical ARKit weights onto a VRM expression manager.
 *
 * VRM 1.0 ships a small standard vocabulary (five mouth shapes, blink, look, and
 * six emotion presets) but ALSO supports arbitrary custom expressions. Detailed
 * heads — HumGen's `prepare_for_arkit` output, the Aria avatar — export the full
 * ARKit-52 as custom expressions, so the right behaviour is:
 *
 *   1. If the VRM exposes the canonical ARKit name, drive it directly. Full fidelity.
 *   2. Otherwise fold down to the VRM standard set. Lossy but portable.
 *
 * Folding is many-to-one (`mouthSmile*` and `mouthStretch*` both land on `ee`), so
 * the weights that share a target are combined by max and flushed on commit rather
 * than written as they arrive — otherwise the last ARKit key processed would win and
 * the mouth would flicker between the shapes that share a target.
 *
 * The compositor writes a key when its value changes, not on every frame, so a weight
 * that holds steady is written once and then left standing. This rig therefore keeps
 * the last weight of every input and rebuilds all of its targets from them on each
 * commit. An input stops counting when the compositor writes it back to zero, which it
 * always does in the end: through the release ramp, or through reset().
 */

type VrmStandard = 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | 'blink' | 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight'

/** ARKit key → (VRM standard expression, contribution scale). */
const ARKIT_TO_VRM: Readonly<Record<string, readonly [VrmStandard, number]>> = {
  jawOpen: ['aa', 1],
  mouthFunnel: ['oh', 1],
  mouthPucker: ['ou', 1],
  mouthRollLower: ['ou', 0.8],
  mouthSmileLeft: ['ee', 1],
  mouthSmileRight: ['ee', 1],
  mouthStretchLeft: ['ee', 0.8],
  mouthStretchRight: ['ih', 0.8],
  mouthShrugUpper: ['ih', 1],

  eyeBlinkLeft: ['blink', 1],
  eyeBlinkRight: ['blink', 1],

  eyeLookUpLeft: ['lookUp', 1],
  eyeLookUpRight: ['lookUp', 1],
  eyeLookDownLeft: ['lookDown', 1],
  eyeLookDownRight: ['lookDown', 1],
  eyeLookOutLeft: ['lookLeft', 1],
  eyeLookInRight: ['lookLeft', 1],
  eyeLookInLeft: ['lookRight', 1],
  eyeLookOutRight: ['lookRight', 1]
}

/** Oculus viseme id → VRM mouth shape, for the `viseme:` fast path. */
const OCULUS_TO_VRM: Readonly<Record<string, VrmStandard>> = {
  aa: 'aa', E: 'ee', I: 'ih', O: 'oh', U: 'ou',
  PP: 'ou', FF: 'ee', TH: 'aa', DD: 'aa', kk: 'ih',
  CH: 'ee', SS: 'ee', nn: 'ih', RR: 'aa', sil: 'aa'
}

export interface VrmExpressionManagerLike {
  expressionMap?: Record<string, unknown>
  setValue(name: string, value: number): void
  update?(): void
}

/** Where a canonical key lands on this head: the expression it drives, and the scale on the way. */
interface Route {
  readonly target: string
  readonly scale: number
}

/** What one input key is holding right now. Only inputs above zero are kept. */
interface Standing {
  readonly target: string
  weight: number
}

export class VrmExpressionFaceRig implements FaceRig {
  private readonly manager: VrmExpressionManagerLike
  private readonly available: Set<string>
  /** Routes for the keys this head can show, so the per-frame has() checks allocate nothing. */
  private readonly routes = new Map<string, Route>()
  /** The weight each input key was last given, scaled for its target. See the header for why it is kept. */
  private readonly standing = new Map<string, Standing>()
  /** commit()'s working set: the weight each expression gets this frame. */
  private readonly targets = new Map<string, number>()
  /** Expressions the last commit set above zero, so they can be cleared once their last input lets go. */
  private readonly live = new Set<string>()

  constructor(manager: VrmExpressionManagerLike) {
    this.manager = manager
    this.available = new Set(Object.keys(manager.expressionMap ?? {}))
  }

  /** True when this VRM carries ARKit names as custom expressions. */
  get hasArkitExpressions(): boolean {
    return this.available.has('jawOpen')
  }

  has(key: string): boolean {
    return this.route(key) !== undefined
  }

  write(key: string, value: number): void {
    const route = this.route(key)
    if (!route) return

    // A NaN falls through to the release branch: nothing should hold a weight it cannot state.
    const weight = Math.min(1, Math.max(0, value * route.scale))
    if (!(weight > 0)) {
      this.standing.delete(key)
      return
    }
    const held = this.standing.get(key)
    if (held) held.weight = weight
    else this.standing.set(key, { target: route.target, weight })
  }

  commit(): void {
    // Rebuild every expression from the inputs still standing. Several inputs can land on one
    // expression; the strongest shows, whichever of them was written last.
    const targets = this.targets
    targets.clear()
    for (const { target, weight } of this.standing.values()) {
      const current = targets.get(target)
      if (current === undefined || weight > current) targets.set(target, weight)
    }

    // An expression whose last input let go falls back to zero, so a folded shape cannot stick.
    for (const name of this.live) {
      if (!targets.has(name)) this.safeSet(name, 0)
    }
    this.live.clear()

    // Every standing weight is set on every commit, not only the ones that just changed: something else
    // can zero an expression behind this rig (core's resetVisemeState zeroes aa/ee/ih/oh/ou when a
    // barge-in lands), and the compositor will not resend a weight it has already sent.
    for (const [name, value] of targets) {
      this.safeSet(name, value)
      this.live.add(name)
    }

    this.manager.update?.()
  }

  /** Which expression a canonical key drives on this head, or undefined when the head has nothing for it. */
  private route(key: string): Route | undefined {
    const known = this.routes.get(key)
    if (known) return known
    const route = this.findRoute(key)
    if (route) this.routes.set(key, route)
    return route
  }

  private findRoute(key: string): Route | undefined {
    if (key.startsWith(VISEME_KEY_PREFIX)) {
      const id = key.slice(VISEME_KEY_PREFIX.length)
      // A VRM exporting Oculus names outright takes the exact shape.
      if (this.available.has(id)) return { target: id, scale: 1 }
      const folded = OCULUS_TO_VRM[id]
      return folded && this.available.has(folded) ? { target: folded, scale: 1 } : undefined
    }

    // Full-fidelity path: the head speaks ARKit natively.
    if (this.available.has(key)) return { target: key, scale: 1 }

    const mapped = ARKIT_TO_VRM[key]
    return mapped && this.available.has(mapped[0]) ? { target: mapped[0], scale: mapped[1] } : undefined
  }

  private safeSet(name: string, value: number): void {
    try {
      this.manager.setValue(name, value)
    } catch {
      // A VRM can advertise an expression it cannot actually drive (empty binds
      // are common in converted models). Skipping is correct; throwing here would
      // take down the whole render loop for one cosmetic channel.
    }
  }
}
