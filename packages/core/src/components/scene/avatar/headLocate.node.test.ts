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
})
