import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { VRM0_HEAD_OFFSET_X, locateAvatarHead } from './headLocate'

/** An avatar standing at `x`, with its head bone 1.5 m up, as a bust's head sits. */
const rig = (x: number) => {
  const avatar = new THREE.Object3D()
  avatar.position.x = x
  const head = new THREE.Object3D()
  head.position.y = 1.5
  avatar.add(head)
  return { avatar, head }
}

/** How far the eyes sit in front of the head origin, as the Work Boy VRM 1.0 rig has them. */
const EYE_Z = 0.0233

/** A bone under the head at `position`. */
const addBone = (head: THREE.Object3D, name: string, position: [number, number, number]) => {
  const bone = new THREE.Bone()
  bone.name = name
  bone.position.set(...position)
  head.add(bone)
}

/** A pair of eye bones `z` metres from the head origin, at the Work Boy spacing and height. */
const addEyes = (head: THREE.Object3D, z: number) => {
  addBone(head, 'J_Adj_L_FaceEye', [0.0124, 0.0748, z])
  addBone(head, 'J_Adj_R_FaceEye', [-0.0124, 0.0748, z])
}

/**
 * The default avatar's rest pose, read from 25-1-3_CI_model_male_Greg.glb: each bone's offset from its
 * parent and its x rotation in degrees. Its neck leans forward 23 degrees and its head tips back 19.
 */
const gregSkeleton = () => {
  const avatar = new THREE.Object3D()
  const chain: Array<[name: string, y: number, z: number, xDegrees: number]> = [
    ['Hips', 1.0192, 0.01, 1.86],
    ['Spine', 0.0985, 0, -7.88],
    ['Spine1', 0.1305, 0, -3.69],
    ['Spine2', 0.1218, 0, 5.41],
    ['Neck', 0.1556, 0, 23.43],
    ['Head', 0.1226, 0, -18.72]
  ]
  let parent: THREE.Object3D = avatar
  let head = avatar
  for (const [name, y, z, xDegrees] of chain) {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(0, y, z)
    bone.rotation.x = xDegrees * THREE.MathUtils.DEG2RAD
    parent.add(bone)
    parent = bone
    head = bone
  }
  addBone(head, 'LeftEye', [0.0304, 0.0878, 0.0824])
  addBone(head, 'RightEye', [-0.0299, 0.0878, 0.0824])
  avatar.updateMatrixWorld(true)
  return { avatar, head }
}

const options = (isVRM: boolean) => ({
  isVRM,
  cameraDistance: 0.5,
  cameraTargetDrop: 0
})

describe('locateAvatarHead', () => {
  it('shifts a VRM 0.x avatar before measuring, so the camera aims at the head as drawn', () => {
    const { avatar, head } = rig(0)
    const location = locateAvatarHead(avatar, head, options(true))

    expect(avatar.position.x).toBeCloseTo(VRM0_HEAD_OFFSET_X)
    expect(location.headWorldPosition.x).toBeCloseTo(VRM0_HEAD_OFFSET_X)
    expect(location.cameraTarget[0]).toBeCloseTo(VRM0_HEAD_OFFSET_X)
    expect(location.cameraPosition[0]).toBeCloseTo(VRM0_HEAD_OFFSET_X)
  })

  it('does not stack the offset when the same avatar is located again', () => {
    // A remount gets a fresh component ref but the same cached scene, so the same avatar is
    // located again. The base x is kept per avatar, so the second call must not add the offset again.
    const { avatar, head } = rig(0)
    const opts = options(true)
    const first = locateAvatarHead(avatar, head, opts)
    const second = locateAvatarHead(avatar, head, opts)

    expect(avatar.position.x).toBeCloseTo(VRM0_HEAD_OFFSET_X)
    expect(second.cameraTarget[0]).toBeCloseTo(first.cameraTarget[0])
  })

  it('leaves a non-VRM rig where it is and faces the camera along +z', () => {
    const { avatar, head } = rig(0.3)
    const location = locateAvatarHead(avatar, head, options(false))

    expect(avatar.position.x).toBeCloseTo(0.3)
    expect(location.cameraTarget[0]).toBeCloseTo(0.3)
    expect(location.cameraPosition[2]).toBeCloseTo(0.5)
  })

  it('faces the camera along +z when the eyes sit in front of a VRM head, as a VRM 1.0 face does', () => {
    const { avatar, head } = rig(0)
    addEyes(head, EYE_Z)
    const location = locateAvatarHead(avatar, head, options(true))

    expect(location.cameraPosition[2]).toBeCloseTo(0.5)
  })

  it('keeps the camera on -z when the eyes sit behind a VRM head', () => {
    const { avatar, head } = rig(0)
    addEyes(head, -EYE_Z)
    const location = locateAvatarHead(avatar, head, options(true))

    expect(location.cameraPosition[2]).toBeCloseTo(-0.5)
  })

  it('keeps the current result for a rotated VRM 0.x avatar, whose face is -z before the rotation', () => {
    // VRMUtils.rotateVRM0 turns a VRM 0.x scene by pi about y, so its -z face ends up on +z.
    const { avatar, head } = rig(0)
    avatar.rotation.y = Math.PI
    addEyes(head, -EYE_Z)
    const location = locateAvatarHead(avatar, head, options(true))

    expect(location.cameraPosition[0]).toBeCloseTo(VRM0_HEAD_OFFSET_X)
    expect(location.cameraPosition[2]).toBeCloseTo(0.5)
  })

  it('reads the facing from the eyes and not from an eyebrow in front of them', () => {
    const { avatar, head } = rig(0)
    addEyes(head, -EYE_Z)
    addBone(head, 'J_Adj_L_Eyebrow', [0.0124, 0.1, 0.2])
    const location = locateAvatarHead(avatar, head, options(true))

    expect(location.cameraPosition[2]).toBeCloseTo(-0.5)
  })

  it('reads the facing from the eyes on a non-VRM rig too', () => {
    const { avatar, head } = rig(0)
    addEyes(head, -EYE_Z)
    const location = locateAvatarHead(avatar, head, options(false))

    expect(location.cameraPosition[2]).toBeCloseTo(-0.5)
  })

  it('falls back to -z for a VRM whose head has no eye bones', () => {
    const { avatar, head } = rig(0)
    const location = locateAvatarHead(avatar, head, options(true))

    expect(location.cameraPosition[2]).toBeCloseTo(-0.5)
  })

  it('keeps the camera level with the head on the default avatar, whose neck leans forward at rest', () => {
    // The Ready Player Me and Mixamo rigs rest with the neck leaning forward and the head tipped back to
    // level the face. Flattening the facing in the neck's frame instead of the avatar's left it pointing
    // about 19 degrees below the horizon, so the camera sat under the head and looked up at it.
    const { avatar, head } = gregSkeleton()

    const location = locateAvatarHead(avatar, head, options(false))

    // Level: the camera is at the head's height. Its sideways offset is under a centimetre, because the
    // eye bones are not placed exactly symmetrically.
    expect(location.cameraPosition[1]).toBeCloseTo(location.headWorldPosition.y, 6)
    expect(location.cameraPosition[0]).toBeCloseTo(location.headWorldPosition.x, 2)
    expect(location.cameraPosition[2] - location.headWorldPosition.z).toBeCloseTo(0.5, 3)
  })

  it('keeps the camera level for a turned avatar whose neck leans forward', () => {
    // The level plane is the avatar's own, so turning the whole avatar about y must not tilt the camera.
    const { avatar, head } = gregSkeleton()
    avatar.rotation.y = Math.PI / 2
    avatar.updateMatrixWorld(true)

    const location = locateAvatarHead(avatar, head, options(false))

    expect(location.cameraPosition[1]).toBeCloseTo(location.headWorldPosition.y, 6)
    // +z of the avatar is +x in the world after a quarter turn about y.
    expect(location.cameraPosition[0] - location.headWorldPosition.x).toBeCloseTo(0.5, 3)
  })
})
