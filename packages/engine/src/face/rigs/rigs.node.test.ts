import { describe, expect, it, vi } from 'vitest'

import { FaceCompositor } from '../FaceCompositor'
import { DEFAULT_FACE_LAYERS, FACE_LAYERS } from '../layers'
import { MOUTH_REGIONS, keysInRegion } from '../regions'
import { MorphTargetFaceRig, type MorphTargetMeshLike } from './morphTargetRig'
import { VISEME_FOLD_KEYS, VISEME_IDS, VISEME_TO_ARKIT } from './visemeFold'
import { VrmExpressionFaceRig, type VrmExpressionManagerLike } from './vrmExpressionRig'

const mesh = (names: string[]): MorphTargetMeshLike => ({
  morphTargetDictionary: Object.fromEntries(names.map((n, i) => [n, i])),
  morphTargetInfluences: new Array(names.length).fill(0)
})

const valueOf = (m: MorphTargetMeshLike, name: string) =>
  m.morphTargetInfluences![m.morphTargetDictionary![name]]

describe('MorphTargetFaceRig', () => {
  it('writes an ARKit key straight through when the head has it', () => {
    const m = mesh(['jawOpen', 'mouthFunnel'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('jawOpen', 0.7)
    expect(valueOf(m, 'jawOpen')).toBeCloseTo(0.7)
  })

  it('does NOT also mirror onto a viseme when the head carries both channels', () => {
    // An RPM "pro" head has ARKit AND Oculus morphs. Driving both from one weight
    // articulates the same shape twice and reads as an over-open mouth.
    const m = mesh(['jawOpen', 'viseme_aa'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('jawOpen', 0.8)
    expect(valueOf(m, 'jawOpen')).toBeCloseTo(0.8)
    expect(valueOf(m, 'viseme_aa')).toBe(0)
  })

  it('falls back to the derived viseme on an Oculus-only head', () => {
    const m = mesh(['viseme_aa', 'viseme_O'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('jawOpen', 0.6)
    rig.write('mouthFunnel', 0.4)
    expect(valueOf(m, 'viseme_aa')).toBeCloseTo(0.6)
    expect(valueOf(m, 'viseme_O')).toBeCloseTo(0.4)
  })

  it('prefers an explicit viseme id over the lossy ARKit derivation', () => {
    const m = mesh(['viseme_PP', 'viseme_aa'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:PP', 1)
    expect(valueOf(m, 'viseme_PP')).toBe(1)
  })

  it('drives legacy single-morph heads', () => {
    const m = mesh(['mouthOpen', 'Blink'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('jawOpen', 0.5)
    rig.write('eyeBlinkLeft', 1)
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(0.5)
    expect(valueOf(m, 'Blink')).toBe(1)
  })

  it('writes every mesh that shares a morph name', () => {
    // Head, teeth and tongue are separate meshes with the same blendshape names;
    // driving only the first leaves teeth clipping through a closed lip.
    const head = mesh(['jawOpen'])
    const teeth = mesh(['jawOpen'])
    const rig = new MorphTargetFaceRig([head, teeth])
    rig.write('jawOpen', 0.9)
    expect(valueOf(head, 'jawOpen')).toBeCloseTo(0.9)
    expect(valueOf(teeth, 'jawOpen')).toBeCloseTo(0.9)
  })

  it('reports has() honestly for every supported route', () => {
    const rig = new MorphTargetFaceRig([mesh(['viseme_aa', 'Blink'])])
    expect(rig.has('jawOpen')).toBe(true) // via derived viseme
    expect(rig.has('eyeBlinkLeft')).toBe(true) // via legacy alias
    expect(rig.has('viseme:aa')).toBe(true)
    expect(rig.has('noseSneerLeft')).toBe(false)
  })

  it('tolerates a mesh with no morph data', () => {
    expect(() => new MorphTargetFaceRig([{}, mesh(['jawOpen'])])).not.toThrow()
  })
})

describe('MorphTargetFaceRig — a viseme on a head with no viseme morphs', () => {
  const OPEN_AA = VISEME_TO_ARKIT.aa.jawOpen

  it('opens a one-morph head, the way Brit, Liam and Liam CES are built', () => {
    // These three catalog avatars ship `mouthOpen` and `mouthSmile` and nothing else. The
    // timed lip-sync tiers publish only `viseme:` keys, which used to reach no morph here.
    const m = mesh(['mouthOpen', 'mouthSmile'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 1)
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(OPEN_AA)
    expect(valueOf(m, 'mouthSmile')).toBe(0)
  })

  it('scales the shape by the viseme weight', () => {
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 0.5)
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(OPEN_AA * 0.5)
  })

  it('shows the strongest of two overlapping visemes, not the one written last', () => {
    // Coarticulation: the next shape ramps in while the last one is still ramping out.
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 0.5)
    rig.write('viseme:E', 1)
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(Math.max(OPEN_AA * 0.5, VISEME_TO_ARKIT.E.jawOpen))
    expect(valueOf(m, 'mouthOpen')).toBeGreaterThan(VISEME_TO_ARKIT.E.jawOpen)
  })

  it('keeps a viseme that has not been rewritten when another one changes', () => {
    // The compositor sends a key only when its value moved, so a steady viseme is silent.
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 1)
    rig.write('viseme:E', 0.2)
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(OPEN_AA)
  })

  it('closes when the viseme lets go', () => {
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 1)
    rig.write('viseme:aa', 0)
    expect(valueOf(m, 'mouthOpen')).toBe(0)
  })

  it('falls back to the weaker viseme when the stronger one lets go', () => {
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 1)
    rig.write('viseme:O', 1)
    rig.write('viseme:aa', 0)
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(VISEME_TO_ARKIT.O.jawOpen)
  })

  it('folds onto the ARKit morphs a head has, and leaves the ones it lacks', () => {
    const m = mesh(['jawOpen', 'mouthFunnel', 'mouthPucker', 'eyeBlinkLeft'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:O', 1)
    expect(valueOf(m, 'jawOpen')).toBeCloseTo(VISEME_TO_ARKIT.O.jawOpen)
    expect(valueOf(m, 'mouthFunnel')).toBeCloseTo(VISEME_TO_ARKIT.O.mouthFunnel)
    expect(valueOf(m, 'mouthPucker')).toBeCloseTo(VISEME_TO_ARKIT.O.mouthPucker)
    expect(valueOf(m, 'eyeBlinkLeft')).toBe(0)
  })

  it('drives every mesh that shares a morph name', () => {
    const head = mesh(['jawOpen'])
    const teeth = mesh(['jawOpen'])
    const rig = new MorphTargetFaceRig([head, teeth])
    rig.write('viseme:aa', 1)
    expect(valueOf(head, 'jawOpen')).toBeCloseTo(OPEN_AA)
    expect(valueOf(teeth, 'jawOpen')).toBeCloseTo(OPEN_AA)
  })

  it('does not touch a head that carries Oculus visemes: the exact shape is the whole answer', () => {
    // An RPM "pro" head has ARKit morphs AND `viseme_*`. Folding as well would articulate
    // the same shape twice and over-open it.
    const m = mesh(['jawOpen', 'mouthFunnel', 'viseme_aa', 'viseme_PP'])
    const rig = new MorphTargetFaceRig([m])
    rig.write('viseme:aa', 1)
    expect(valueOf(m, 'viseme_aa')).toBe(1)
    expect(valueOf(m, 'jawOpen')).toBe(0)
    expect(valueOf(m, 'mouthFunnel')).toBe(0)
  })

  it('leaves a head with only some viseme morphs on the exact path for the ones it lacks', () => {
    const m = mesh(['jawOpen', 'viseme_aa'])
    const rig = new MorphTargetFaceRig([m])
    expect(rig.has('viseme:O')).toBe(false)
    rig.write('viseme:O', 1)
    expect(valueOf(m, 'jawOpen')).toBe(0)
  })

  it('reports which visemes it can show', () => {
    const oneMorph = new MorphTargetFaceRig([mesh(['mouthOpen', 'mouthSmile'])])
    expect(oneMorph.has('viseme:aa')).toBe(true)
    expect(oneMorph.has('viseme:O')).toBe(true)
    // Nothing on this head can make a closure, so there is nothing to fold a closure onto.
    expect(oneMorph.has('viseme:PP')).toBe(false)
    expect(oneMorph.has('viseme:nn')).toBe(false)
    expect(oneMorph.has('viseme:notAViseme')).toBe(false)

    const arkit = new MorphTargetFaceRig([mesh(['jawOpen', 'mouthClose', 'mouthPressLeft'])])
    expect(arkit.has('viseme:PP')).toBe(true)

    expect(new MorphTargetFaceRig([mesh(['eyeBlinkLeft'])]).has('viseme:aa')).toBe(false)
  })

  it('ignores a viseme id outside the Oculus set', () => {
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    expect(() => rig.write('viseme:__proto__', 1)).not.toThrow()
    expect(() => rig.write('viseme:DD_RETRO', 1)).not.toThrow()
    expect(valueOf(m, 'mouthOpen')).toBe(0)
  })

  describe('and an ARKit key written by something else', () => {
    it('keeps a held smile when the viseme that shared it lets go', () => {
      // `E` and a happy emote both want `mouthSmileLeft`. The compositor writes the smile
      // once and then stays quiet while it holds, so the rig must remember it.
      const m = mesh(['jawOpen', 'mouthSmileLeft'])
      const rig = new MorphTargetFaceRig([m])
      rig.write('mouthSmileLeft', 0.5)
      rig.write('viseme:E', 1)
      expect(valueOf(m, 'mouthSmileLeft')).toBeCloseTo(0.5)
      rig.write('viseme:E', 0)
      expect(valueOf(m, 'mouthSmileLeft')).toBeCloseTo(0.5)
    })

    it('shows the viseme where it asks for more, and hands back when it lets go', () => {
      const m = mesh(['jawOpen', 'mouthSmileLeft'])
      const rig = new MorphTargetFaceRig([m])
      rig.write('mouthSmileLeft', 0.1)
      rig.write('viseme:E', 1)
      expect(valueOf(m, 'mouthSmileLeft')).toBeCloseTo(VISEME_TO_ARKIT.E.mouthSmileLeft)
      rig.write('viseme:E', 0)
      expect(valueOf(m, 'mouthSmileLeft')).toBeCloseTo(0.1)
    })

    it('does not let a lower request undercut the viseme that is holding the key', () => {
      const m = mesh(['mouthOpen'])
      const rig = new MorphTargetFaceRig([m])
      rig.write('viseme:aa', 1)
      rig.write('jawOpen', 0.1)
      expect(valueOf(m, 'mouthOpen')).toBeCloseTo(OPEN_AA)
      rig.write('viseme:aa', 0)
      expect(valueOf(m, 'mouthOpen')).toBeCloseTo(0.1)
    })

    it('writes straight through, as before, when no viseme is involved', () => {
      const m = mesh(['mouthOpen'])
      const rig = new MorphTargetFaceRig([m])
      rig.write('jawOpen', 0.4)
      expect(valueOf(m, 'mouthOpen')).toBeCloseTo(0.4)
      rig.write('jawOpen', 0)
      expect(valueOf(m, 'mouthOpen')).toBe(0)
    })
  })

  describe('the fold table', () => {
    it('covers every viseme the schedule can name, with weights in range', () => {
      for (const id of ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U']) {
        expect(VISEME_IDS, id).toContain(id)
      }
      for (const [id, weights] of Object.entries(VISEME_TO_ARKIT)) {
        expect(Object.keys(weights).length, id).toBeGreaterThan(0)
        for (const [key, weight] of Object.entries(weights)) {
          expect(weight, `${id}.${key}`).toBeGreaterThan(0)
          expect(weight, `${id}.${key}`).toBeLessThanOrEqual(1)
          expect(VISEME_FOLD_KEYS.has(key), `${id}.${key}`).toBe(true)
        }
      }
    })

    it('only folds onto mouth keys, so speech claiming the mouth covers everything it moves', () => {
      const mouthKeys = new Set(MOUTH_REGIONS.flatMap((region) => keysInRegion(region)))
      for (const key of VISEME_FOLD_KEYS) expect(mouthKeys.has(key), key).toBe(true)
    })
  })
})

describe('timed speech through the compositor onto a head with no viseme morphs', () => {
  const FRAME = 1 / 60
  const speakFrame = (compositor: FaceCompositor, rig: MorphTargetFaceRig, visemes: Record<string, number>) => {
    compositor.begin()
    compositor.setAll(FACE_LAYERS.SPEECH, visemes)
    compositor.claim(FACE_LAYERS.SPEECH, MOUTH_REGIONS)
    compositor.applyTo(rig, FRAME)
  }
  const quietFrame = (compositor: FaceCompositor, rig: MorphTargetFaceRig) => {
    compositor.begin()
    compositor.applyTo(rig, FRAME)
  }

  it('moves a one-morph mouth while the viseme plays and closes it after', () => {
    const m = mesh(['mouthOpen', 'mouthSmile'])
    const rig = new MorphTargetFaceRig([m])
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    speakFrame(compositor, rig, { 'viseme:aa': 1 })
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(VISEME_TO_ARKIT.aa.jawOpen)

    // Nothing publishes the viseme any more; the compositor's release ramp closes the mouth.
    for (let i = 0; i < 90; i++) quietFrame(compositor, rig)
    expect(valueOf(m, 'mouthOpen')).toBe(0)
  })

  it('keeps following a viseme the compositor stops resending', () => {
    // A held viseme at a steady weight is written once and skipped on the frames after.
    const m = mesh(['mouthOpen'])
    const rig = new MorphTargetFaceRig([m])
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    for (let i = 0; i < 5; i++) speakFrame(compositor, rig, { 'viseme:aa': 1 })
    expect(valueOf(m, 'mouthOpen')).toBeCloseTo(VISEME_TO_ARKIT.aa.jawOpen)
  })

  it('a head with the exact viseme morphs is driven exactly, as it always was', () => {
    const m = mesh(['viseme_aa', 'jawOpen'])
    const rig = new MorphTargetFaceRig([m])
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)

    speakFrame(compositor, rig, { 'viseme:aa': 1 })
    expect(valueOf(m, 'viseme_aa')).toBe(1)
    expect(valueOf(m, 'jawOpen')).toBe(0)
  })
})

const vrm = (expressions: string[]) => {
  const setValue = vi.fn()
  const manager: VrmExpressionManagerLike = {
    expressionMap: Object.fromEntries(expressions.map((e) => [e, {}])),
    setValue
  }
  return { manager, setValue }
}

describe('VrmExpressionFaceRig', () => {
  it('folds ARKit onto the VRM standard mouth set', () => {
    const { manager, setValue } = vrm(['aa', 'ee', 'ih', 'oh', 'ou', 'blink'])
    const rig = new VrmExpressionFaceRig(manager)
    rig.write('jawOpen', 0.8)
    rig.commit()
    expect(setValue).toHaveBeenCalledWith('aa', 0.8)
  })

  it('takes the max when several ARKit keys fold onto one expression', () => {
    // mouthSmileLeft and mouthStretchLeft both land on `ee`. Writing as they
    // arrive would let the last one processed win and the mouth would flicker.
    const { manager, setValue } = vrm(['ee'])
    const rig = new VrmExpressionFaceRig(manager)
    rig.write('mouthSmileLeft', 0.9)
    rig.write('mouthStretchLeft', 0.2)
    rig.commit()
    const eeCalls = setValue.mock.calls.filter(([n]) => n === 'ee')
    expect(eeCalls).toHaveLength(1)
    expect(eeCalls[0][1]).toBeCloseTo(0.9)
  })

  it('drives ARKit custom expressions directly when the VRM exports them', () => {
    const { manager, setValue } = vrm(['aa', 'jawOpen'])
    const rig = new VrmExpressionFaceRig(manager)
    expect(rig.hasArkitExpressions).toBe(true)
    rig.write('jawOpen', 0.5)
    rig.commit()
    expect(setValue).toHaveBeenCalledWith('jawOpen', 0.5)
    expect(setValue).not.toHaveBeenCalledWith('aa', expect.anything())
  })

  it('clears a folded expression once its ARKit source is written back to zero', () => {
    // The compositor says so explicitly when a key goes quiet; a frame that writes nothing is not that
    // signal (see vrmHeldWeights.node.test.ts, which holds the weight across such frames).
    const { manager, setValue } = vrm(['aa'])
    const rig = new VrmExpressionFaceRig(manager)
    rig.write('jawOpen', 1)
    rig.commit()
    setValue.mockClear()

    rig.write('jawOpen', 0)
    rig.commit()
    expect(setValue).toHaveBeenCalledWith('aa', 0)
  })

  it('uses an explicit viseme id when the VRM exposes Oculus names', () => {
    const { manager, setValue } = vrm(['PP', 'aa'])
    const rig = new VrmExpressionFaceRig(manager)
    rig.write('viseme:PP', 1)
    rig.commit()
    expect(setValue).toHaveBeenCalledWith('PP', 1)
  })

  it('folds an explicit viseme id down when only the standard set exists', () => {
    const { manager, setValue } = vrm(['ou'])
    const rig = new VrmExpressionFaceRig(manager)
    rig.write('viseme:PP', 0.7)
    rig.commit()
    expect(setValue).toHaveBeenCalledWith('ou', 0.7)
  })

  it('survives an expression the VRM advertises but cannot drive', () => {
    // Converted VRMs routinely ship expressions with empty binds; three-vrm
    // throws on some of them. One cosmetic channel must not kill the frame.
    const manager: VrmExpressionManagerLike = {
      expressionMap: { aa: {} },
      setValue: () => {
        throw new Error('empty bind')
      }
    }
    const rig = new VrmExpressionFaceRig(manager)
    rig.write('jawOpen', 1)
    expect(() => rig.commit()).not.toThrow()
  })

  it('reports has() false for expressions the VRM lacks entirely', () => {
    const { manager } = vrm(['aa'])
    const rig = new VrmExpressionFaceRig(manager)
    expect(rig.has('jawOpen')).toBe(true) // folds to aa
    expect(rig.has('tongueOut')).toBe(false)
  })
})
