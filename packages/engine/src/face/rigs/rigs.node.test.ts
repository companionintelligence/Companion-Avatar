import { describe, expect, it, vi } from 'vitest'

import { MorphTargetFaceRig, type MorphTargetMeshLike } from './morphTargetRig'
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
