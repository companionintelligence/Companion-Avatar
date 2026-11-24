import { MathUtils, Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { locateAvatarHead } from '../../../components/scene/avatar/headLocate'
import { faceAxes, faceFrameFor, faceFrontWorld, pitchAxisWorld, restFrame } from './faceFrame'
import { ASH, GREG, KENJI, WORKBOY, YUKI, buildRig, removeEyes } from './realRigFixtures'
import type { RigData } from './realRigFixtures'

const RIGS: Array<[string, RigData]> = [
  ['Greg (Ready Player Me)', GREG],
  ['Ash (older Ready Player Me, head bone tipped 8 degrees)', ASH],
  ['kenji (VRM 0.x)', KENJI],
  ['yuki (VRM 0.x, eyes under eye-set nodes)', YUKI],
  ['Work Boy (VRM 1.0, eye bones turned outward)', WORKBOY]
]

const degrees = (radians: number) => radians * MathUtils.RAD2DEG
const elevation = (v: Vector3) => degrees(Math.atan2(v.y, Math.hypot(v.x, v.z)))

describe('faceFrameFor: the way a rig faces, read from where its eyes sit', () => {
  it.each(RIGS)('reads %s as facing %s of the avatar root', (_name, data) => {
    const { state } = buildRig(data)

    const face = faceFrameFor(state)

    expect(face.legacy).toBe(false)
    expect(face.front.y).toBe(0)
    expect(face.front.length()).toBeCloseTo(1, 10)
    // Along z to within the half degree that the eyes sit off the head's midline
    expect(degrees(face.front.angleTo(new Vector3(0, 0, data.facing)))).toBeLessThan(0.5)
  })

  it.each(RIGS)('turns %s toward the world +z the camera sits on, once its root is turned', (_name, data) => {
    const { state } = buildRig(data)

    const world = faceFrontWorld(state, faceFrameFor(state), new Vector3())

    // Every shipped avatar faces +z in the world: a VRM 0.x avatar by the turn the app gives it
    expect(degrees(world.angleTo(new Vector3(0, 0, 1)))).toBeLessThan(0.5)
  })

  it('raises the face about -x for a rig that faces +z and about +x for one that faces -z', () => {
    const greg = buildRig(GREG)
    const kenji = buildRig(KENJI)

    expect(faceFrameFor(greg.state).pitchAxis.x).toBeCloseTo(-1, 3)
    expect(faceFrameFor(kenji.state).pitchAxis.x).toBeCloseTo(1, 3)
    // In the world both look along +z, so the same axis raises either face
    expect(pitchAxisWorld(greg.state, faceFrameFor(greg.state), new Vector3()).x).toBeCloseTo(-1, 3)
    expect(pitchAxisWorld(kenji.state, faceFrameFor(kenji.state), new Vector3()).x).toBeCloseTo(-1, 3)
  })

  it.each(RIGS)('keeps the face level for %s whatever the rest tilt of its bones', (_name, data) => {
    const rig = buildRig(data)
    const face = faceFrameFor(rig.state)
    const front = new Vector3()
    const up = new Vector3()

    for (const bone of [rig.head, rig.neck, rig.leftEye, rig.rightEye]) {
      faceAxes(bone, rig.state, face, front, up)
      const world = front.applyQuaternion(bone.getWorldQuaternion(new Quaternion()))
      // At rest the face looks along the horizontal through every bone that carries it, and up is up
      expect(Math.abs(elevation(world))).toBeLessThan(0.1)
      expect(up.applyQuaternion(bone.getWorldQuaternion(new Quaternion())).y).toBeGreaterThan(0.9999)
    }
  })

  it('reads the same face whatever pose the head is in when it is first read', () => {
    const rest = buildRig(GREG)
    const posed = buildRig(GREG)
    // An animation has already turned and tipped the head and neck before the gaze first runs
    posed.head.rotation.y = 35 * MathUtils.DEG2RAD
    posed.head.rotation.x += 30 * MathUtils.DEG2RAD
    posed.neck.rotation.z = 12 * MathUtils.DEG2RAD
    posed.root.updateMatrixWorld(true)

    const a = faceFrameFor(rest.state).front
    const b = faceFrameFor(posed.state).front

    expect(degrees(a.angleTo(b))).toBeLessThan(1e-6)
  })

  it('finds eyes named like eyes under the head when the avatar mapped none, as the camera does', () => {
    // Aria, the Hum Gen VRM 1.0 avatar, has no eye in its humanoid map but eyeball nodes under the head
    const rig = buildRig(GREG)
    delete rig.state.bones?.leftEye
    delete rig.state.bones?.rightEye
    rig.leftEye.name = 'eyeball.L'
    rig.rightEye.name = 'eyeball.R'
    // Nodes that contain "eye" but are not eyes must not pull the midpoint
    for (const name of ['eyebrow_L', 'eyelash_R', 'eyeball_lookat.L']) {
      const decoy = new Object3D()
      decoy.name = name
      decoy.position.set(0, 0.3, -0.3)
      rig.head.add(decoy)
    }
    rig.root.updateMatrixWorld(true)

    const face = faceFrameFor(rig.state)

    expect(face.legacy).toBe(false)
    expect(face.eyes).toEqual([rig.leftEye, rig.rightEye])
    expect(degrees(face.front.angleTo(new Vector3(0, 0, 1)))).toBeLessThan(0.5)
  })

  it('keeps the maths the gaze was tuned on for a rig with no eyes to read', () => {
    const rig = buildRig(GREG)
    removeEyes(rig)

    const face = faceFrameFor(rig.state)

    expect(face.legacy).toBe(true)
    expect(face.front.toArray()).toEqual([0, 0, -1])
  })

  it('does not take a direction from eyes that sit straight above the head bone', () => {
    const rig = buildRig(GREG)
    rig.leftEye.position.set(0.03, 0.09, 0.001)
    rig.rightEye.position.set(-0.03, 0.09, 0.001)
    rig.root.updateMatrixWorld(true)

    expect(faceFrameFor(rig.state).legacy).toBe(true)
  })

  it('reads the face once per avatar, and again for a new avatar', () => {
    const rig = buildRig(GREG)
    const first = faceFrameFor(rig.state)

    rig.head.rotation.y = 1
    expect(faceFrameFor(rig.state)).toBe(first)

    const other = buildRig(KENJI)
    expect(faceFrameFor(other.state)).not.toBe(first)
  })

  it('reads the rest orientation of a bone from the rotation the avatar recorded before it was animated', () => {
    const rig = buildRig(GREG)
    // Greg's root is not turned, so a bone's world orientation at rest is its orientation relative to the root
    const atRest = rig.neck.getWorldQuaternion(new Quaternion())
    // The mixer has leaned the neck and the spine since the avatar recorded their rest
    rig.neck.rotation.x += 0.4
    rig.bones.Spine1.rotation.x += 0.3
    rig.root.updateMatrixWorld(true)

    expect(restFrame(rig.neck, rig.root).angleTo(atRest)).toBeLessThan(1e-6)
    expect(rig.neck.getWorldQuaternion(new Quaternion()).angleTo(atRest)).toBeGreaterThan(0.5)
  })

  it.each(RIGS)('faces %s along the line from its head to the camera that headLocate places', (_name, data) => {
    const rig = buildRig(data)
    const location = locateAvatarHead(rig.root, rig.head, { isVRM: data.vrm0, cameraDistance: 0.5, cameraTargetDrop: 0 })
    const toCamera = new Vector3(...location.cameraPosition).sub(location.headWorldPosition)
    // The camera is on the face's side of the head bone, so the avatar's front is the way to the camera
    const front = faceFrontWorld(rig.state, faceFrameFor(rig.state), new Vector3())
    toCamera.y = 0

    expect(degrees(front.angleTo(toCamera.normalize()))).toBeLessThan(0.5)
  })
})
