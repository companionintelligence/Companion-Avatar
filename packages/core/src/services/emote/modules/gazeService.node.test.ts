import { Bone, Euler, MathUtils, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultEmoteConfig } from '../configs/emoteConfig'
import { initializeEmoteState } from '../emoteService'
import type { EmoteState } from '../emoteTypes'
import { initiateGaze, updateGaze } from './gazeService'

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
