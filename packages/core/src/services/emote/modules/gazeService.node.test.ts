import { Bone, Euler, MathUtils, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { locateAvatarHead } from '../../../components/scene/avatar/headLocate'
import { defaultEmoteConfig } from '../configs/emoteConfig'
import { initializeEmoteState } from '../emoteService'
import type { EmoteState } from '../emoteTypes'
import { initiateGaze, updateGaze } from './gazeService'
import { ASH, GREG, KENJI, WORKBOY, YUKI, buildRig, removeEyes } from './realRigFixtures'
import type { BuiltRig, RigData } from './realRigFixtures'

const FRAME = 1 / 60
let now = 0

beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  // No random delay or duration: a gaze starts on the first visible frame.
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Advance the clock one frame at a time and run the gaze update.
const step = (state: EmoteState, frames = 1) => {
  for (let i = 0; i < frames; i++) {
    now += FRAME * 1000
    updateGaze(state, FRAME, defaultEmoteConfig)
  }
}

// A GLB-style rig: a spine2 > neck chain, a Head bone for vision, and optional eye bones.
// headUnderNeck places Head under the neck so neck turns and spine bends reach the head.
function rig(options: { headUnderNeck?: boolean; spineX?: number; eyes?: boolean } = {}) {
  const root = new Object3D()

  const spine2 = new Bone()
  spine2.name = 'spine2'
  spine2.position.set(0, 1, 0)
  spine2.rotation.x = options.spineX ?? 0
  root.add(spine2)

  const neck = new Bone()
  neck.name = 'neck'
  neck.position.set(0, 0.5, 0)
  spine2.add(neck)

  const head = new Bone()
  head.name = 'head'
  if (options.headUnderNeck) {
    head.position.set(0, 0.2, 0)
    neck.add(head)
  } else {
    head.position.set(0, 1.7, 0)
    root.add(head)
  }

  const bones: Record<string, Bone> = { spine2, neck, Head: head }
  let leftEye: Bone | undefined
  let rightEye: Bone | undefined
  if (options.eyes) {
    leftEye = new Bone()
    leftEye.position.set(-0.03, 0.05, -0.08)
    head.add(leftEye)
    rightEye = new Bone()
    rightEye.position.set(0.03, 0.05, -0.08)
    head.add(rightEye)
    bones.leftEye = leftEye
    bones.rightEye = rightEye
  }

  root.updateMatrixWorld(true)

  const state = initializeEmoteState()
  const camera = new PerspectiveCamera()
  state.node = root
  state.bones = bones
  state.camera = camera

  return { state, root, spine2, neck, head, leftEye, rightEye, camera }
}

// ---------------------------------------------------------------------------------------------------------------
// Real skeletons. The synthetic rigs below face -z, stand upright and keep their eyes under the head, which is
// where the gaze was tuned. The shipped avatars face +z (or are turned to), lean their necks forward about 20
// degrees, tilt their heads and splay their eye bones, so these tests build the rest poses read from the files
// (realRigFixtures.ts) and check where the neck and eyes end up.
// ---------------------------------------------------------------------------------------------------------------

const toDegrees = MathUtils.RAD2DEG

/** The elevation of a direction above the horizontal, in degrees. */
const elevationOf = (v: Vector3) => toDegrees * Math.atan2(v.y, Math.hypot(v.x, v.z))

/** The signed angle about +y from +z to the horizontal part of a direction, in degrees: toward +x is positive. */
const yawOf = (v: Vector3) => toDegrees * Math.atan2(v.x, v.z)

/**
 * Where each bone's face points in the world. Every shipped avatar faces +z in the world (a VRM 0.x avatar by
 * the turn the app gives it), and each bone carries that as it turns. Read from the rig at rest, before the
 * gaze has moved anything, so the checks do not lean on the code under test.
 */
function trackFace(rig: BuiltRig) {
  const front = new Vector3(0, 0, 1)
  const atRest = new Map<Object3D, Vector3>()
  for (const bone of [rig.head, rig.neck, rig.leftEye, rig.rightEye]) {
    atRest.set(bone, front.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()))
  }
  return (bone: Object3D) => (atRest.get(bone) as Vector3).clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()))
}

/** Put the camera `distance` metres from the head bone: `azimuth` degrees from the face toward +x, `elevation` degrees above level. */
function placeCamera(rig: BuiltRig, azimuth: number, elevation: number, distance = 1) {
  const a = azimuth * MathUtils.DEG2RAD
  const e = elevation * MathUtils.DEG2RAD
  const direction = new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
  rig.camera.position.copy(rig.head.getWorldPosition(new Vector3())).addScaledVector(direction, distance)
}

const towardCamera = (rig: BuiltRig, from: Object3D) => rig.camera.position.clone().sub(from.getWorldPosition(new Vector3()))

/** Give a built rig the VRM the app would hold for it, with a look-at to watch. */
function addVrm(rig: BuiltRig) {
  const lookAt = vi.fn()
  rig.state.vrm = { scene: rig.root, lookAt: { lookAt } } as unknown as VRM
  return lookAt
}

const lastLookAt = (lookAt: ReturnType<typeof vi.fn>) => lookAt.mock.calls[lookAt.mock.calls.length - 1][0] as Vector3

const midpoint = (a: Object3D, b: Object3D) =>
  a.getWorldPosition(new Vector3()).add(b.getWorldPosition(new Vector3())).multiplyScalar(0.5)

describe.each([
  ['Greg', GREG],
  ['Ash', ASH]
] as Array<[string, RigData]>)('gazeService: %s, a Ready Player Me rig that faces +z', (_name, data) => {
  // The aim read the eye's forward as local -z and aimed these eyes at a point behind them: the default
  // avatar's pupils settled about 12 degrees above the camera, and swung to the yaw limit with the camera behind
  // it. The vision cone read the same axis, so a camera in front of the face was "not visible" and neither the
  // neck nor the eyes ever engaged (review findings H1 and H7).
  it('looks at the lens of the default view, with the neck at rest', () => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    const location = locateAvatarHead(rig.root, rig.head, { isVRM: false, cameraDistance: 0.5, cameraTargetDrop: 0 })
    rig.camera.position.set(...location.cameraPosition)
    const rest = rig.neck.quaternion.clone()

    step(rig.state, 600)

    expect(rig.state.gazeState.isPlayerVisible).toBe(true)
    expect(rig.neck.quaternion.angleTo(rest)).toBeLessThan(MathUtils.DEG2RAD * 0.5)
    for (const eye of [rig.leftEye, rig.rightEye]) {
      expect(toDegrees * faceOf(eye).angleTo(towardCamera(rig, eye))).toBeLessThan(1)
    }
  })

  it.each([60, -60])('turns the neck and the eyes toward a camera %i degrees to the side, and not past it', (azimuth) => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    placeCamera(rig, azimuth, 0)
    const toCamera = yawOf(towardCamera(rig, rig.neck))

    step(rig.state, 600)

    // The neck turns to the camera's side, and not past it
    const neckTurn = Math.sign(azimuth) * yawOf(faceOf(rig.neck))
    expect(neckTurn).toBeGreaterThan(5)
    expect(neckTurn).toBeLessThan(Math.abs(toCamera))
    // The eyes turn to the camera's side in their sockets, up to their own yaw limit
    for (const eye of [rig.leftEye, rig.rightEye]) {
      const eyeTurn = Math.sign(azimuth) * (yawOf(faceOf(eye)) - yawOf(faceOf(rig.head)))
      expect(eyeTurn).toBeGreaterThan(30)
      expect(eyeTurn).toBeLessThan(35.5)
    }
  })

  it('does not lift the head or the eyes above a camera that is level with the head bone', () => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    placeCamera(rig, 60, 0)
    const cameraElevation = elevationOf(towardCamera(rig, rig.neck))

    step(rig.state, 600)

    // The camera is a little above the neck: the head follows it up, and stops short
    const neckElevation = elevationOf(faceOf(rig.neck))
    expect(neckElevation).toBeGreaterThanOrEqual(-0.5)
    expect(neckElevation).toBeLessThanOrEqual(cameraElevation)
    // The eyes sit above the head bone, so the camera is below them: they do not pitch up
    for (const eye of [rig.leftEye, rig.rightEye]) {
      expect(elevationOf(faceOf(eye)) - elevationOf(faceOf(rig.head))).toBeLessThan(0.5)
    }
  })

  it('lifts the head and the eyes toward a camera above it', () => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    placeCamera(rig, 0, 45)
    const cameraElevation = elevationOf(towardCamera(rig, rig.neck))

    step(rig.state, 600)

    const neckElevation = elevationOf(faceOf(rig.neck))
    expect(neckElevation).toBeGreaterThan(2)
    expect(neckElevation).toBeLessThanOrEqual(cameraElevation)
    // The eyes pitch up in their sockets as well, as far as their own limit
    for (const eye of [rig.leftEye, rig.rightEye]) {
      const eyePitch = elevationOf(faceOf(eye)) - elevationOf(faceOf(rig.head))
      expect(eyePitch).toBeGreaterThan(5)
      expect(eyePitch).toBeLessThan(25.5)
    }
  })

  it('looks at a camera above it with its eyes alone while the camera is inside central vision', () => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    placeCamera(rig, 0, 25)
    const rest = rig.neck.quaternion.clone()

    step(rig.state, 600)

    expect(rig.neck.quaternion.angleTo(rest)).toBeLessThan(MathUtils.DEG2RAD * 0.5)
    for (const eye of [rig.leftEye, rig.rightEye]) {
      expect(toDegrees * faceOf(eye).angleTo(towardCamera(rig, eye))).toBeLessThan(2)
    }
  })

  it.each([135, 180])('returns the neck to rest and the eyes to straight ahead once the camera is %i degrees behind it', (azimuth) => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    const rest = rig.neck.quaternion.clone()
    placeCamera(rig, 60, 0)
    step(rig.state, 600)
    expect(rig.neck.quaternion.angleTo(rest)).toBeGreaterThan(MathUtils.DEG2RAD * 5)

    placeCamera(rig, azimuth, 0)
    step(rig.state, 600)

    expect(rig.state.gazeState.isPlayerVisible).toBe(false)
    expect(rig.neck.quaternion.angleTo(rest)).toBeLessThan(MathUtils.DEG2RAD * 0.5)
    // Straight ahead of the head, level: the two eyes are about 2 degrees closer than parallel to meet a point 1 m away
    for (const eye of [rig.leftEye, rig.rightEye]) {
      expect(toDegrees * faceOf(eye).angleTo(faceOf(rig.head))).toBeLessThan(3)
    }
  })

  it('classifies the camera against the whole bone chain, so a spine bent back moves the cone', () => {
    const rig = buildRig(data)
    const faceOf = trackFace(rig)
    placeCamera(rig, 0, 0)
    step(rig.state, 5) // the rest is read while the avatar stands as it loaded

    // An animation leans the avatar back 50 degrees, and the camera follows the face up
    rig.bones[data.spine2].rotation.x -= 0.9
    rig.root.updateMatrixWorld(true)
    rig.camera.position.copy(rig.head.getWorldPosition(new Vector3())).addScaledVector(faceOf(rig.head).normalize(), 1)
    step(rig.state, 5)

    expect(elevationOf(faceOf(rig.head))).toBeGreaterThan(40)
    expect(rig.state.gazeState.isPlayerVisible).toBe(true)
    // Focused vision leaves the neck alone; peripheral vision captures and turns it.
    expect(rig.state.gazeState.neckOptions.quaternions.default).toBeNull()
  })
})

describe.each([
  ['kenji, a VRM 0.x', KENJI],
  ['yuki, a VRM 0.x with its eyes under eye-set nodes', YUKI],
  ['Work Boy, a VRM 1.0', WORKBOY]
] as Array<[string, RigData]>)('gazeService: %s, which faces +z in the world', (_name, data) => {
  // A VRM 0.x avatar is turned 180 degrees about y when it loads, so its bones keep the -z axes it was authored
  // with while it faces +z in the world. A VRM 1.0 avatar is not turned, and its bones face +z. The eyes of both
  // are driven by the VRM's look-at, which takes the point to look at.
  it('looks at the camera in front of it and leaves the neck at rest', () => {
    const rig = buildRig(data)
    const lookAt = addVrm(rig)
    placeCamera(rig, 0, 0, 0.5)
    const rest = rig.neck.quaternion.clone()

    step(rig.state, 600)

    expect(rig.state.gazeState.isPlayerVisible).toBe(true)
    expect(rig.neck.quaternion.angleTo(rest)).toBeLessThan(MathUtils.DEG2RAD * 0.5)
    expect(lastLookAt(lookAt).distanceTo(rig.camera.position)).toBeLessThan(0.01)
  })

  it.each([60, -60])('turns the neck toward a camera %i degrees to the side, and not past it', (azimuth) => {
    const rig = buildRig(data)
    const lookAt = addVrm(rig)
    const faceOf = trackFace(rig)
    placeCamera(rig, azimuth, 0)
    const toCamera = yawOf(towardCamera(rig, rig.neck))

    step(rig.state, 600)

    const neckTurn = Math.sign(azimuth) * yawOf(faceOf(rig.neck))
    expect(neckTurn).toBeGreaterThan(5)
    expect(neckTurn).toBeLessThan(Math.abs(toCamera))
    expect(lastLookAt(lookAt).distanceTo(rig.camera.position)).toBeLessThan(0.01)
  })

  it('lifts the neck toward a camera above it, and not past it', () => {
    const rig = buildRig(data)
    addVrm(rig)
    const faceOf = trackFace(rig)
    placeCamera(rig, 45, 35)
    const cameraElevation = elevationOf(towardCamera(rig, rig.neck))

    step(rig.state, 600)

    const neckElevation = elevationOf(faceOf(rig.neck))
    expect(neckElevation).toBeGreaterThan(2)
    expect(neckElevation).toBeLessThanOrEqual(cameraElevation)
  })

  it('returns the neck to rest and looks straight ahead of the face, level with the eyes, with the camera behind it', () => {
    const rig = buildRig(data)
    const lookAt = addVrm(rig)
    const rest = rig.neck.quaternion.clone()
    placeCamera(rig, 60, 0)
    step(rig.state, 600)
    expect(rig.neck.quaternion.angleTo(rest)).toBeGreaterThan(MathUtils.DEG2RAD * 5)

    placeCamera(rig, 180, 0)
    step(rig.state, 600)

    expect(rig.state.gazeState.isPlayerVisible).toBe(false)
    expect(rig.neck.quaternion.angleTo(rest)).toBeLessThan(MathUtils.DEG2RAD * 0.5)
    // The point the eyes rest on is 1 m ahead of the face, along +z in the world, level with the eyes. It used to
    // be a fixed point 1 m behind a turned VRM 0.x avatar, which the look-at met with the eyes at their yaw limit.
    const ahead = lastLookAt(lookAt).clone().sub(midpoint(rig.leftEye, rig.rightEye))
    expect(ahead.length()).toBeCloseTo(1, 6)
    expect(toDegrees * ahead.angleTo(new Vector3(0, 0, 1))).toBeLessThan(0.5)
  })
})

describe('gazeService: VRM 0.x avatars keep the neck they had (characterization)', () => {
  // Recorded from the gaze service as it was before the face's forward axis was read from the rig (a8ed624):
  // the mean orientation of the neck over the last two seconds of a ten second settle, with the camera at
  // azimuth degrees from the face, elevation degrees up, and distance metres from the head. The neck chatters
  // about the edge of the focused cone by design, so a single frame would pin the phase of the chatter.
  const RECORDED: Array<[RigData, Array<[azimuth: number, elevation: number, distance: number, neck: [number, number, number, number]]>]> = [
    [
      KENJI,
      [
        [60, 0, 1, [0.021802, 0.134153, -0.008882, 0.990681]],
        [-75, 20, 1, [0.043058, -0.24744, 0.018163, 0.967776]],
        [45, -20, 0.5, [-0.026045, 0.092176, 0.007854, 0.995371]],
        [60, 40, 2.5, [0.112423, 0.222365, -0.034351, 0.967851]],
        [80, 10, 1, [0.052693, 0.291896, -0.022022, 0.954744]],
        [-45, 30, 1.5, [0.030973, -0.075364, 0.010174, 0.996623]]
      ]
    ],
    [
      YUKI,
      [
        [60, 0, 1, [0.016434, 0.133442, -0.006756, 0.990897]],
        [-75, 20, 1, [0.041916, -0.247994, 0.017809, 0.96769]],
        [45, -20, 0.5, [-0.028634, 0.078701, 0.009209, 0.996444]],
        [60, 40, 2.5, [0.112525, 0.223307, -0.034423, 0.967619]],
        [80, 10, 1, [0.051091, 0.291982, -0.021521, 0.954816]],
        [-45, 30, 1.5, [0.030495, -0.075384, 0.01007, 0.996637]]
      ]
    ]
  ]

  it.each(RECORDED.flatMap(([data, cases]) => cases.map(([azimuth, elevation, distance, neck]) => [data.source, azimuth, elevation, distance, neck, data] as const)))(
    'settles %s to the neck it had with the camera at azimuth %i, elevation %i, distance %f',
    (_source, azimuth, elevation, distance, recorded, data) => {
      const rig = buildRig(data)
      addVrm(rig)
      placeCamera(rig, azimuth, elevation, distance)
      const tail: Quaternion[] = []

      for (let frame = 0; frame < 600; frame++) {
        step(rig.state)
        if (frame >= 480) tail.push(rig.neck.quaternion.clone())
      }

      const mean = new Quaternion(
        ...[0, 1, 2, 3].map((k) => tail.reduce((sum, q) => sum + q.toArray()[k], 0) / tail.length)
      ).normalize()
      // The recorded values are rounded, so they are not exactly unit: normalize before measuring the angle
      expect(toDegrees * mean.angleTo(new Quaternion(...recorded).normalize())).toBeLessThan(0.1)
    }
  )
})

describe('gazeService: a rig whose face cannot be read', () => {
  it('keeps the point it rests its gaze on, 1.5 m up and 1 m along -z', () => {
    const rig = buildRig(KENJI)
    removeEyes(rig)
    const lookAt = addVrm(rig)
    rig.camera.position.set(0, -5, 0) // below the hips: never visible

    step(rig.state, 10)

    expect(lastLookAt(lookAt).toArray()).toEqual([0, 1.5, -1])
  })
})

describe('gazeService: GLB eye bones (H1)', () => {
  it('turns the eye bones toward a camera inside the focused cone', () => {
    const { state, leftEye, camera } = rig({ eyes: true })
    camera.position.set(0, 1.6, -2)

    step(state, 300)

    const eye = leftEye as Bone
    const eyeWorld = eye.getWorldPosition(new Vector3())
    const toCamera = camera.position.clone().sub(eyeWorld).normalize()
    const forward = new Vector3(0, 0, -1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()))
    expect(forward.angleTo(toCamera)).toBeLessThan(MathUtils.DEG2RAD * 1)
  })

  it('aims the eyes no further than the eye yaw limit', () => {
    const { state, leftEye, camera } = rig({ eyes: true })
    // About 87 degrees to the side: visible in peripheral vision, past the 35 degree eye yaw limit.
    camera.position.set(2, 1.7, -0.2)

    step(state, 300)

    const eye = leftEye as Bone
    const forward = new Vector3(0, 0, -1).applyQuaternion(eye.quaternion)
    const angleDeg = MathUtils.RAD2DEG * forward.angleTo(new Vector3(0, 0, -1))
    expect(Math.abs(angleDeg - 35)).toBeLessThan(1)
  })

  it('keeps a turned eye within its own yaw limit while the neck stays at rest', () => {
    const { state, leftEye, neck, camera } = rig({ eyes: true, headUnderNeck: true })
    // 70 degrees to the side of the eye's forward axis, level with it: visible in peripheral vision.
    const eyeWorld = (leftEye as Bone).getWorldPosition(new Vector3())
    const side = new Vector3(Math.sin(70 * MathUtils.DEG2RAD), 0, -Math.cos(70 * MathUtils.DEG2RAD))
    camera.position.copy(eyeWorld).addScaledVector(side, 2)

    for (let i = 0; i < 300; i++) {
      neck.quaternion.identity() // the neck takes none of the turn, so the eye alone is limited
      step(state)
    }

    const turnDeg = (leftEye as Bone).quaternion.angleTo(new Quaternion()) * MathUtils.RAD2DEG
    expect(turnDeg).toBeLessThanOrEqual(35 + 0.5)
    expect(turnDeg).toBeGreaterThan(35 - 1)
  })

  it('limits the eye pitch to its own pitch limit', () => {
    const { state, leftEye, camera } = rig({ eyes: true })
    // 50 degrees above the eye's forward axis: visible in peripheral vision, past the eye pitch limit.
    const eyeWorld = (leftEye as Bone).getWorldPosition(new Vector3())
    const up = new Vector3(0, Math.sin(50 * MathUtils.DEG2RAD), -Math.cos(50 * MathUtils.DEG2RAD))
    camera.position.copy(eyeWorld).addScaledVector(up, 2)

    step(state, 300)

    const turnDeg = (leftEye as Bone).quaternion.angleTo(new Quaternion()) * MathUtils.RAD2DEG
    expect(turnDeg).toBeLessThanOrEqual(25 + 0.5)
    expect(turnDeg).toBeGreaterThan(25 - 1)
  })
})

describe('gazeService: vision cone (M11)', () => {
  it('classifies the camera against the full bone chain, so a bent spine moves the cone', () => {
    const { state, head, camera } = rig({ headUnderNeck: true, spineX: MathUtils.DEG2RAD * 60 })
    // Two units straight out of the head's true (bent) forward direction.
    const forward = new Vector3(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new Quaternion()))
    camera.position.copy(head.getWorldPosition(new Vector3())).addScaledVector(forward, 2)

    step(state)

    expect(state.gazeState.isPlayerVisible).toBe(true)
    // Focused vision leaves the neck alone; peripheral vision captures and turns it.
    expect(state.gazeState.neckOptions.quaternions.default).toBeNull()
  })
})

describe('gazeService: VRM neck rest (M25)', () => {
  const restEuler = new Euler(0.4, 0, 0)

  function vrmRig() {
    const built = rig()
    const normalizedNeck = new Object3D() // humanoid normalized neck: identity rest
    built.state.vrm = {
      scene: new Object3D(),
      lookAt: { lookAt: vi.fn() },
      humanoid: { getNormalizedBoneNode: () => normalizedNeck }
    } as unknown as VRM
    built.neck.quaternion.setFromEuler(restEuler) // raw neck rest
    built.camera.position.set(0, -5, 0) // below the hips: never visible, so the neck settles to rest
    return built
  }

  it('seeds the neck default from the raw bone that updateNeckGaze drives', () => {
    const { state, neck } = vrmRig()

    initiateGaze(state, { duration: Infinity })

    expect(state.gazeState.neckOptions.quaternions.default).toEqual(neck.quaternion.toArray())
  })

  it('returns the neck to its raw rest orientation, not the identity humanoid bone', () => {
    const { state, neck } = vrmRig()
    const rest = new Quaternion().setFromEuler(restEuler)

    initiateGaze(state, { duration: Infinity })
    step(state, 300)

    expect(neck.quaternion.angleTo(rest)).toBeLessThan(1e-3)
  })
})

describe('gazeService: per-frame cost (M27)', () => {
  it('looks up eye meshes once per node instead of walking the scene every frame', () => {
    const root = new Object3D() // no Head bone and no eye bones: the eye-mesh fallback path
    const state = initializeEmoteState()
    state.node = root
    state.camera = new PerspectiveCamera()
    state.camera.position.set(0, 1.6, -2)
    const traverse = vi.spyOn(root, 'traverse')

    step(state, 10)

    expect(traverse).toHaveBeenCalledTimes(1)
  })
})

describe('gazeService: characterization (behaviour must not change)', () => {
  it('keeps the neck and gaze state identical through peripheral, focused and hidden phases', () => {
    const { state, neck, camera } = rig()
    const round = (n: number) => Math.round(n * 1e12) / 1e12
    const snapshots: unknown[] = []

    for (let phase = 0; phase < 3; phase++) {
      if (phase === 0) camera.position.set(2.5, 1.6, -1) // peripheral
      if (phase === 1) camera.position.set(0, 1.6, -2) // focused
      if (phase === 2) camera.position.set(0, -1, -2) // hidden (below the hips)
      step(state, 60)
      const t = state.gazeState.target as Vector3 // typed as the R3F Vector3 union in emoteTypes
      snapshots.push({
        neck: neck.quaternion.toArray().map(round),
        neckDefault: state.gazeState.neckOptions.quaternions.default?.map(round) ?? null,
        visible: state.gazeState.isPlayerVisible,
        target: [t.x, t.y, t.z].map(round),
        gazeStart: round(state.gazeState.gazeTime.start),
        gazeEnd: String(state.gazeState.gazeTime.end)
      })
    }

    expect(snapshots).toEqual(GOLDEN_SNAPSHOTS)
  })
})

// Recorded from the pre-change gazeService: peripheral, focused, then hidden.
const GOLDEN_SNAPSHOTS: unknown[] = [
  {
    gazeEnd: 'Infinity',
    gazeStart: 1016.666666666667,
    neck: [0.092949645352, -0.314131200453, 0.029809935454, 0.944348092644],
    neckDefault: [0, 0, 0, 1],
    target: [2.150193779939, 1.383004826343, -0.729329433527],
    visible: true
  },
  {
    gazeEnd: 'Infinity',
    gazeStart: 1016.666666666667,
    neck: [0.012813647837, -0.043304808339, 0.004109472538, 0.998971278986],
    neckDefault: [0, 0, 0, 1],
    target: [0.290997084222, 1.570632896712, -1.828033438986],
    visible: true
  },
  {
    gazeEnd: 'Infinity',
    gazeStart: 1016.666666666667,
    neck: [0.001734853225, -0.005863083439, 0.000556385799, 0.999981152308],
    neckDefault: [0, 0, 0, 1],
    target: [0.039382172814, 1.509559123082, -1.112062139995],
    visible: false
  }
]
