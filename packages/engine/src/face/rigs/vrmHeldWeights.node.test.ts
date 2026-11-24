import { describe, expect, it } from 'vitest'

import { FaceCompositor } from '../FaceCompositor'
import { DEFAULT_FACE_LAYERS, FACE_LAYERS, type FaceLayerId } from '../layers'
import { MOUTH_REGIONS } from '../regions'
import type { FaceRig } from '../types'
import { VrmExpressionFaceRig, type VrmExpressionManagerLike } from './vrmExpressionRig'

/**
 * The compositor writes a key only when its value moves by 1e-3 or more, so a weight that holds steady is
 * written once and never again. A rig therefore has to treat the last value it was given as standing until
 * the next write. These tests run the rig behind the real compositor, the way AvatarModel does, because the
 * defect only shows across frames: a rig that is correct for the frame it was written in can still drop the
 * weight on the next one.
 */

/**
 * A stand-in for three-vrm's VRMExpressionManager: weights are clamped, a name the head does not have is
 * ignored, and `update()` is what would push the weights onto the mesh.
 */
function fakeManager(names: readonly string[], options: { throwOn?: readonly string[] } = {}) {
  const weights = new Map(names.map((name) => [name, 0]))
  let updates = 0
  const manager: VrmExpressionManagerLike = {
    expressionMap: Object.fromEntries(names.map((name) => [name, {}])),
    setValue(name, value) {
      if (options.throwOn?.includes(name)) throw new Error('empty bind')
      if (!weights.has(name)) return
      weights.set(name, Math.min(1, Math.max(0, value)))
    },
    update() {
      updates++
    }
  }
  return {
    manager,
    weight: (name: string) => weights.get(name) ?? 0,
    updates: () => updates
  }
}

const MOUTH = ['aa', 'ee', 'ih', 'oh', 'ou'] as const
const FRAME = 1 / 60

type Publish = Partial<Record<FaceLayerId, Record<string, number>>>

/** One render frame the way AvatarModel runs it: open, publish, claim, write once. */
function runFrame(compositor: FaceCompositor, rig: FaceRig, publish: Publish = {}, claimMouth = false): void {
  compositor.begin()
  for (const [layer, weights] of Object.entries(publish)) compositor.setAll(layer, weights)
  if (claimMouth) compositor.claim(FACE_LAYERS.SPEECH, MOUTH_REGIONS)
  compositor.applyTo(rig, FRAME)
}

function runFrames(frames: number, each: (frame: number) => void): void {
  for (let frame = 0; frame < frames; frame++) each(frame)
}

describe('VrmExpressionFaceRig behind the compositor — a weight nothing resends', () => {
  it('keeps a scripted jaw weight on every frame, not just the one it was written on', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(30, () => {
      runFrame(compositor, rig, { [FACE_LAYERS.OVERRIDE]: { jawOpen: 0.85 } })
      expect(weight('aa')).toBeCloseTo(0.85)
    })
  })

  it('keeps a held smile folded onto ee', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(30, () => {
      runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } })
      expect(weight('ee')).toBeCloseTo(0.6)
    })
  })

  it('keeps a custom ARKit expression the head exports itself', () => {
    const { manager, weight } = fakeManager(['aa', 'jawOpen', 'mouthFunnel'])
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(20, () => {
      runFrame(compositor, rig, { [FACE_LAYERS.OVERRIDE]: { jawOpen: 0.7, mouthFunnel: 0.4 } })
      expect(weight('jawOpen')).toBeCloseTo(0.7)
      expect(weight('mouthFunnel')).toBeCloseTo(0.4)
    })
    // The fold is for heads that do not carry the name; this head does, so the standard set stays untouched.
    expect(weight('aa')).toBe(0)
  })

  it('keeps a long vowel while speech holds the mouth', () => {
    // A scheduled viseme that lasts several frames is written when it starts and not again.
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(25, () => {
      runFrame(compositor, rig, { [FACE_LAYERS.SPEECH]: { 'viseme:aa': 0.9 } }, true)
      expect(weight('aa')).toBeCloseTo(0.9)
    })
  })

  it('does not strobe on a weight that creeps by less than the write threshold', () => {
    // 0.03 over 90 frames is a third of a thousandth per frame: the compositor writes about every third
    // frame. A rig that keeps only what was written this frame shows the smile on those and nothing between.
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(90, (frame) => {
      const smile = 0.3 + (0.03 * frame) / 90
      runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthSmileLeft: smile, mouthSmileRight: smile } })
      expect(weight('ee')).toBeGreaterThan(0.29)
    })
  })

  it('lets a released weight go all the way to zero through the compositor ramp', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(10, () => runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.8 } }))
    expect(weight('ee')).toBeCloseTo(0.8)

    let previous = weight('ee')
    runFrames(60, () => {
      runFrame(compositor, rig)
      expect(weight('ee')).toBeLessThanOrEqual(previous + 1e-9)
      previous = weight('ee')
    })
    expect(weight('ee')).toBe(0)
  })

  it('hands an expression over to the weaker input still standing when the stronger one lets go', () => {
    // mouthSmileLeft lands on ee at full scale and mouthStretchLeft at 0.8. The stretch is steady, so the
    // compositor never resends it; when the smile releases, ee has to settle on the stretch, not on nothing.
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(5, () =>
      runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.9, mouthStretchLeft: 0.5 } })
    )
    expect(weight('ee')).toBeCloseTo(0.9)

    runFrames(60, () => {
      runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthStretchLeft: 0.5 } })
      expect(weight('ee')).toBeGreaterThanOrEqual(0.4 - 1e-9)
    })
    expect(weight('ee')).toBeCloseTo(0.4)
  })

  it('keeps independent expressions independent', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(5, () =>
      runFrame(compositor, rig, {
        [FACE_LAYERS.OVERRIDE]: { jawOpen: 0.6 },
        [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.5 }
      })
    )
    // The jaw changes while the smile holds still; the smile must not be disturbed by the jaw's writes.
    runFrames(5, (frame) =>
      runFrame(compositor, rig, {
        [FACE_LAYERS.OVERRIDE]: { jawOpen: 0.6 + 0.05 * (frame + 1) },
        [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.5 }
      })
    )
    expect(weight('aa')).toBeCloseTo(0.85)
    expect(weight('ee')).toBeCloseTo(0.5)
  })

  it('closes every expression on a compositor reset, and keeps them closed', () => {
    // Barge-in: useAgent calls resetActiveFace() with no rig in hand. Everything the face was holding has to
    // close on that call and stay closed on the frames after it.
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(10, () =>
      runFrame(compositor, rig, {
        [FACE_LAYERS.SPEECH]: { 'viseme:aa': 0.8 },
        [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 }
      })
    )
    expect(weight('aa')).toBeCloseTo(0.8)
    expect(weight('ee')).toBeCloseTo(0.6)

    compositor.reset()
    for (const name of MOUTH) expect(weight(name)).toBe(0)

    runFrames(10, () => {
      runFrame(compositor, rig)
      for (const name of MOUTH) expect(weight(name)).toBe(0)
    })
  })

  it('puts back a weight something else zeroed on the manager', () => {
    // Core's resetVisemeState zeroes aa/ee/ih/oh/ou on the VRM directly when a barge-in lands. A held smile
    // the compositor is not going to resend has to survive that.
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    runFrames(5, () => runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.6 } }))
    for (const name of MOUTH) manager.setValue(name, 0)
    expect(weight('ee')).toBe(0)

    runFrame(compositor, rig, { [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.6 } })
    expect(weight('ee')).toBeCloseTo(0.6)
  })
})

describe('VrmExpressionFaceRig — the rig on its own', () => {
  it('keeps a written weight across commits that write nothing', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('jawOpen', 0.8)
    for (let i = 0; i < 5; i++) {
      rig.commit()
      expect(weight('aa')).toBeCloseTo(0.8)
    }
  })

  it('releases an input only when it is written back to zero', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('jawOpen', 0.8)
    rig.commit()
    rig.write('jawOpen', 0)
    rig.commit()
    expect(weight('aa')).toBe(0)
    rig.commit()
    expect(weight('aa')).toBe(0)
  })

  it('still flushes the expression manager on every commit', () => {
    // The mixer can move the same morphs between frames; update() re-applies the expressions on top.
    const { manager, updates } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('jawOpen', 0.8)
    rig.commit()
    rig.commit()
    rig.commit()
    expect(updates()).toBe(3)
  })

  it('takes the stronger of two inputs that fold onto one expression, and the other when it lets go', () => {
    const { manager, weight } = fakeManager(['ee'])
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('mouthSmileLeft', 0.9)
    rig.write('mouthStretchLeft', 0.5) // scaled by 0.8 on its way to ee
    rig.commit()
    expect(weight('ee')).toBeCloseTo(0.9)

    rig.write('mouthSmileLeft', 0)
    rig.commit()
    expect(weight('ee')).toBeCloseTo(0.4)

    rig.write('mouthStretchLeft', 0)
    rig.commit()
    expect(weight('ee')).toBe(0)
  })

  it('keeps a viseme and an ARKit key that share an expression apart', () => {
    // viseme:TH folds onto aa, and so does jawOpen. Releasing one must not release the other.
    const { manager, weight } = fakeManager(['aa'])
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('jawOpen', 0.3)
    rig.write('viseme:TH', 0.7)
    rig.commit()
    expect(weight('aa')).toBeCloseTo(0.7)

    rig.write('viseme:TH', 0)
    rig.commit()
    expect(weight('aa')).toBeCloseTo(0.3)
  })

  it('takes an Oculus viseme the head exports by name and keeps it', () => {
    const { manager, weight } = fakeManager(['PP', 'aa'])
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('viseme:PP', 1)
    rig.commit()
    rig.commit()
    expect(weight('PP')).toBe(1)
    expect(weight('aa')).toBe(0)
  })

  it('clamps to 0..1 and treats NaN as a release', () => {
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('jawOpen', 3)
    rig.commit()
    expect(weight('aa')).toBe(1)

    rig.write('jawOpen', Number.NaN)
    rig.commit()
    expect(weight('aa')).toBe(0)
  })

  it('does not hold anything for a key the head cannot show', () => {
    const { manager, weight } = fakeManager(['aa'])
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('tongueOut', 1)
    rig.write('viseme:nope', 1)
    rig.commit()
    expect(weight('aa')).toBe(0)
  })

  it('goes on driving the other expressions when one cannot be set', () => {
    // Converted VRMs advertise expressions with empty binds. The broken one is retried on every frame it is
    // held, so it must keep failing quietly and must not take the others with it.
    const { manager, weight } = fakeManager(MOUTH, { throwOn: ['aa'] })
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('jawOpen', 1)
    rig.write('mouthSmileLeft', 0.5)
    for (let i = 0; i < 3; i++) {
      expect(() => rig.commit()).not.toThrow()
      expect(weight('ee')).toBeCloseTo(0.5)
    }
  })
})

describe('VrmExpressionFaceRig agrees with the compositor over a long, steady-heavy run', () => {
  /** Where each key should land, written out here so the check does not lean on the rig's own table. */
  const LANDS_ON: Readonly<Record<string, readonly [expression: string, scale: number]>> = {
    jawOpen: ['aa', 1],
    mouthSmileLeft: ['ee', 1],
    mouthStretchLeft: ['ee', 0.8],
    mouthStretchRight: ['ih', 0.8],
    mouthFunnel: ['oh', 1],
    mouthPucker: ['ou', 1],
    'viseme:aa': ['aa', 1],
    'viseme:E': ['ee', 1],
    'viseme:PP': ['ou', 1],
    'viseme:TH': ['aa', 1]
  }

  /** What each layer is allowed to publish: the emotion layer owns no jaw, and only speech and the override may. */
  const POOLS: Readonly<Partial<Record<FaceLayerId, readonly string[]>>> = {
    [FACE_LAYERS.EMOTION]: ['mouthSmileLeft', 'mouthStretchLeft', 'mouthStretchRight', 'mouthFunnel', 'mouthPucker'],
    [FACE_LAYERS.SPEECH]: ['jawOpen', 'viseme:aa', 'viseme:E', 'viseme:PP', 'viseme:TH', 'mouthFunnel'],
    [FACE_LAYERS.OVERRIDE]: ['jawOpen', 'mouthSmileLeft', 'viseme:aa']
  }

  /** A small seeded generator, so a failure names a seed and a frame that can be replayed. */
  function seeded(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it.each([1, 2, 3])('seed %i: every expression equals the strongest resolved key that lands on it', (seed) => {
    const random = seeded(seed)
    const { manager, weight } = fakeManager(MOUTH)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    // Producers hold what they publish for a while, as real ones do: the same weights, frame after frame.
    const plans = new Map<FaceLayerId, { weights: Record<string, number>; until: number }>()
    let claimMouth = false
    let framesWithAMouthShape = 0
    let framesAtRest = 0

    for (let frame = 0; frame < 1500; frame++) {
      const publish: Publish = {}
      for (const [layer, pool] of Object.entries(POOLS) as [FaceLayerId, readonly string[]][]) {
        let plan = plans.get(layer)
        if (!plan || frame >= plan.until) {
          const weights: Record<string, number> = {}
          const count = Math.floor(random() * random() * 4) // 0..3 keys, mostly few; 0 is a layer with nothing to say
          for (let i = 0; i < count; i++) {
            weights[pool[Math.floor(random() * pool.length)]] = [0, 0.2, 0.5, 0.8, 1][Math.floor(random() * 5)]
          }
          plan = { weights, until: frame + 1 + Math.floor(random() * 25) }
          plans.set(layer, plan)
          if (layer === FACE_LAYERS.SPEECH) claimMouth = random() < 0.4
        }
        publish[layer] = plan.weights
      }

      runFrame(compositor, rig, publish, claimMouth)

      const written = compositor.trace().written
      let shown = false
      let resting = true
      for (const name of MOUTH) {
        let expected = 0
        for (const [key, [expression, scale]] of Object.entries(LANDS_ON)) {
          if (expression === name) expected = Math.max(expected, (written[key] ?? 0) * scale)
        }
        expect(weight(name), `seed ${seed}, frame ${frame}, ${name}`).toBeCloseTo(expected, 2)
        if (expected > 0.05) shown = true
        if (expected > 0.001) resting = false
      }
      if (shown) framesWithAMouthShape++
      if (resting) framesAtRest++

      // A barge-in now and then: everything closes on the call, and the plans carry on afterwards.
      if (random() < 1 / 150) {
        compositor.reset()
        for (const name of MOUTH) expect(weight(name), `seed ${seed}, frame ${frame}, after reset`).toBe(0)
      }
    }

    // The run has to spend its time both on weights that are showing and on a face that has let go, or
    // agreeing about nothing proves nothing.
    expect(framesWithAMouthShape, `seed ${seed}: frames with a mouth shape`).toBeGreaterThan(400)
    expect(framesAtRest, `seed ${seed}: frames at rest`).toBeGreaterThan(20)
  })
})
