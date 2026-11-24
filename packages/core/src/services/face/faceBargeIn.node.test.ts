import type { VRM } from '@pixiv/three-vrm'
import type * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_FACE_LAYERS, FACE_LAYERS, FaceCompositor, MOUTH_REGIONS, type FaceRig } from '@ci-avatar/engine'

import { resetActiveFace, setActiveFaceCompositor } from './faceCompositorRegistry'
import { createFaceRig } from './faceRigFactory'

/**
 * Barge-in, the way useAgent does it: `resetActiveFace()` with no rig in hand.
 *
 * The compositor forgets every key it sent when it is reset. A rig that keeps the last weight it was given
 * (a VRM's expression manager, a head's morph influences) is only closed if the compositor tells it, so the
 * reset has to reach the rig the avatar mounted with. These tests build the rig with the same factory the
 * avatar uses and run frames the way AvatarModel does.
 */

const FRAME = 1 / 60

function runFrame(
  compositor: FaceCompositor,
  rig: FaceRig,
  publish: Record<string, Record<string, number>> = {},
  claimMouth = false
): void {
  compositor.begin()
  for (const [layer, weights] of Object.entries(publish)) compositor.setAll(layer, weights)
  if (claimMouth) compositor.claim(FACE_LAYERS.SPEECH, MOUTH_REGIONS)
  compositor.applyTo(rig, FRAME)
}

/** A VRM whose expression manager keeps weights the way three-vrm's does. */
function fakeVrm(expressions: readonly string[]) {
  const weights = new Map(expressions.map((name) => [name, 0]))
  const expressionManager = {
    expressionMap: Object.fromEntries(expressions.map((name) => [name, {}])),
    setValue: (name: string, value: number) => {
      if (weights.has(name)) weights.set(name, value)
    },
    update: () => {}
  }
  return { vrm: { expressionManager } as unknown as VRM, weight: (name: string) => weights.get(name) ?? 0 }
}

describe('barge-in closes the face the avatar mounted with', () => {
  afterEach(() => setActiveFaceCompositor(null))

  it('on a VRM that is holding a smile and a vowel the compositor is not resending', () => {
    const { vrm, weight } = fakeVrm(['aa', 'ee', 'ih', 'oh', 'ou'])
    const { rig, kind } = createFaceRig([], vrm)
    expect(kind).toBe('vrm-expression')

    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)
    compositor.reset(rig) // what AvatarModel does when it binds a new head
    setActiveFaceCompositor(compositor)

    for (let i = 0; i < 10; i++) {
      runFrame(compositor, rig, {
        [FACE_LAYERS.SPEECH]: { 'viseme:aa': 0.8 },
        [FACE_LAYERS.EMOTION]: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 }
      })
    }
    expect(weight('aa')).toBeCloseTo(0.8)
    expect(weight('ee')).toBeCloseTo(0.6)

    resetActiveFace()
    for (const name of ['aa', 'ee', 'ih', 'oh', 'ou']) expect(weight(name)).toBe(0)

    for (let i = 0; i < 5; i++) {
      runFrame(compositor, rig)
      for (const name of ['aa', 'ee', 'ih', 'oh', 'ou']) expect(weight(name)).toBe(0)
    }
  })

  it('on a morph-target head that was speaking', () => {
    const mesh = {
      morphTargetDictionary: { jawOpen: 0, mouthSmileLeft: 1 },
      morphTargetInfluences: [0, 0]
    }
    const { rig, kind } = createFaceRig([mesh as unknown as THREE.Mesh])
    expect(kind).toBe('morph-target')

    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)
    compositor.reset(rig)
    setActiveFaceCompositor(compositor)

    for (let i = 0; i < 10; i++) {
      runFrame(compositor, rig, { [FACE_LAYERS.SPEECH]: { jawOpen: 0.7 } }, true)
    }
    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.7)

    resetActiveFace()
    expect(mesh.morphTargetInfluences[0]).toBe(0)

    // Speech has stopped; nothing asks for the jaw again, so nothing may open it again.
    for (let i = 0; i < 5; i++) runFrame(compositor, rig)
    expect(mesh.morphTargetInfluences[0]).toBe(0)
  })

  it('and does nothing once the avatar has unmounted', () => {
    const { vrm, weight } = fakeVrm(['aa'])
    const { rig } = createFaceRig([], vrm)
    const compositor = new FaceCompositor(DEFAULT_FACE_LAYERS)
    setActiveFaceCompositor(compositor)
    runFrame(compositor, rig, { [FACE_LAYERS.OVERRIDE]: { jawOpen: 0.5 } })

    setActiveFaceCompositor(null)
    expect(() => resetActiveFace()).not.toThrow()
    expect(weight('aa')).toBeCloseTo(0.5)
  })
})
