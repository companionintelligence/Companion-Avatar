import { describe, expect, it } from 'vitest'

import { VisemeSchedule } from '../../lipsync/VisemeSchedule'
import { FaceCompositor } from '../FaceCompositor'
import { DEFAULT_FACE_LAYERS, FACE_LAYERS } from '../layers'
import { MOUTH_REGIONS } from '../regions'
import { VrmExpressionFaceRig, type VrmExpressionManagerLike } from './vrmExpressionRig'

/**
 * `viseme:PP` (p, b, m) and `viseme:sil` (silence) on a VRM head.
 *
 * A VRM's standard mouth set is five shapes, and all five open the mouth: aa, ee, ih, oh, ou. Nothing in it
 * brings the lips together, so a VRM shows a closure, and silence, by showing none of them. The rig used to
 * fold PP onto `ou`, which pursed the lips on every p, b and m, and `sil` onto `aa`, which opened the mouth.
 */

const MOUTH = ['aa', 'ee', 'ih', 'oh', 'ou'] as const

/** Yuki (VRoid, VRM 0.x), as three-vrm names its expressions: the five mouth shapes and nothing for a closure. */
const YUKI = 'neutral aa ih ou ee oh blink blinkLeft blinkRight angry relaxed happy sad Surprised Extra'.split(' ')

/**
 * Aria (HumGen, VRM 1.0): the VRM presets plus 35 ARKit names as custom expressions, read from
 * humgen-aria-01.vrm. `mouthClose` and `mouthPucker` are among them, but `viseme:` keys fold onto the five
 * presets on every VRM that does not export the Oculus names, Aria included.
 */
const ARIA = [
  'aa angry blink blinkLeft blinkRight ee happy ih lookDown lookLeft lookRight lookUp neutral oh ou relaxed sad',
  'surprised browDownLeft browDownRight browInnerUp browOuterUpLeft browOuterUpRight cheekSquintLeft',
  'cheekSquintRight eyeBlinkLeft eyeBlinkRight eyeSquintLeft eyeSquintRight eyeWideLeft eyeWideRight eyesClosed',
  'jawForward mouthClose mouthDimpleLeft mouthDimpleRight mouthFrownLeft mouthFrownRight mouthFunnel mouthLeft',
  'mouthPressLeft mouthPucker mouthRollLower mouthRollUpper mouthShrugLower mouthShrugUpper mouthSmile',
  'mouthStretchLeft mouthStretchRight mouthUpperUpLeft mouthUpperUpRight noseSneerLeft noseSneerRight'
]
  .join(' ')
  .split(' ')

const HEADS: readonly (readonly [string, readonly string[]])[] = [
  ['Yuki', YUKI],
  ['Aria', ARIA]
]

/** three-vrm's expression manager, reduced to what the rig touches: clamped weights, unknown names ignored. */
function fakeManager(names: readonly string[]) {
  const weights = new Map(names.map((name) => [name, 0]))
  const manager: VrmExpressionManagerLike = {
    expressionMap: Object.fromEntries(names.map((name) => [name, {}])),
    setValue(name, value) {
      if (weights.has(name)) weights.set(name, Math.min(1, Math.max(0, value)))
    }
  }
  return {
    manager,
    weight: (name: string) => weights.get(name) ?? 0,
    /** Every expression above zero, so a failure says what the head is actually showing. */
    showing: () => Object.fromEntries([...weights].filter(([, value]) => value > 0))
  }
}

describe.each(HEADS)('%s: a lip closure and silence leave the mouth shut', (_name, expressions) => {
  it.each(['PP', 'sil'])('viseme:%s puts no weight on any expression', (id) => {
    const { manager, showing } = fakeManager(expressions)
    const rig = new VrmExpressionFaceRig(manager)

    rig.write(`viseme:${id}`, 1)
    rig.commit()
    rig.commit()
    expect(showing()).toEqual({})
    expect(rig.has(`viseme:${id}`), 'the head has no shape to fold it onto').toBe(false)
  })

  it.each([
    ['aa', 'aa'],
    ['O', 'oh'],
    ['U', 'ou']
  ])('viseme:%s still opens the mouth to %s', (id, expression) => {
    const { manager, weight } = fakeManager(expressions)
    const rig = new VrmExpressionFaceRig(manager)

    expect(rig.has(`viseme:${id}`)).toBe(true)
    rig.write(`viseme:${id}`, 1)
    rig.commit()
    expect(weight(expression)).toBe(1)
  })

  it('a closure that arrives while a vowel is held leaves the vowel as it was', () => {
    // Coarticulation overlaps neighbours, so PP is written while the vowel before it is still ramping out. It
    // must neither add a shape of its own nor hold the vowel open: the vowel's own ramp closes the mouth.
    const { manager, weight } = fakeManager(expressions)
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('viseme:aa', 0.4)
    rig.write('viseme:PP', 1)
    rig.commit()
    expect(weight('aa')).toBeCloseTo(0.4)
    for (const name of MOUTH.filter((n) => n !== 'aa')) expect(weight(name), name).toBe(0)

    rig.write('viseme:aa', 0)
    rig.commit()
    for (const name of MOUTH) expect(weight(name), name).toBe(0)
  })
})

describe('"mama" through the schedule, the compositor and a VRM head', () => {
  /** p/b/m and a vowel, twice: PP aa PP aa, 120 ms each, as the word-timed tier would lay out "mama". */
  function speak(expressions: readonly string[]) {
    const schedule = new VisemeSchedule()
    schedule.setFromArrays(['PP', 'aa', 'PP', 'aa'], [0, 120, 240, 360], [120, 120, 120, 120])
    const { manager, weight } = fakeManager(expressions)
    const rig = new VrmExpressionFaceRig(manager)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    const FRAME = 1 / 60
    const frames: { time: number; weights: Record<string, number> }[] = []
    for (let frame = 0; frame * FRAME <= 0.6; frame++) {
      const time = frame * FRAME
      const contributions = schedule.weightsAt(time)
      // As AvatarModel does: speech publishes, takes the mouth while it has something to say, one write.
      compositor.begin()
      compositor.setAll(FACE_LAYERS.SPEECH, contributions)
      if (Object.keys(contributions).length > 0) compositor.claim(FACE_LAYERS.SPEECH, MOUTH_REGIONS)
      compositor.applyTo(rig, FRAME)
      frames.push({ time, weights: Object.fromEntries(MOUTH.map((name) => [name, weight(name)])) })
    }
    const at = (time: number) => frames.reduce((a, b) => (Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a))
    return { frames, at }
  }

  it.each(HEADS)('%s: the lips never purse, and they close between the vowels', (_name, expressions) => {
    const { frames, at } = speak(expressions)

    // No rounded vowel in the word, so nothing may round the lips. The old fold put ou at 1 on every m.
    const peakOu = Math.max(...frames.map((f) => f.weights.ou))
    expect(peakOu, 'ou over the word').toBe(0)

    // The vowels open the mouth fully...
    expect(at(0.18).weights.aa).toBeCloseTo(1)
    expect(at(0.42).weights.aa).toBeCloseTo(1)
    // ...and in the middle of the second m it is all but shut: only the first vowel's release tail is left.
    const closed = at(0.3).weights
    for (const name of MOUTH) expect(closed[name], `${name} at 0.30 s`).toBeLessThan(0.1)
  })
})

describe('a VRM that exports the Oculus names outright', () => {
  it('still takes PP and sil exactly', () => {
    const { manager, weight } = fakeManager([...MOUTH, 'PP', 'sil'])
    const rig = new VrmExpressionFaceRig(manager)

    rig.write('viseme:PP', 0.8)
    rig.write('viseme:sil', 0.5)
    rig.commit()
    expect(weight('PP')).toBeCloseTo(0.8)
    expect(weight('sil')).toBeCloseTo(0.5)
    for (const name of MOUTH) expect(weight(name), name).toBe(0)
  })
})
