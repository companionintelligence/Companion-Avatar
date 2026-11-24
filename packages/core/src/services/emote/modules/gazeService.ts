import { Quaternion, Vector3, MathUtils } from 'three'
import type { Mesh, Object3D } from 'three'

import type { EmoteState, GazeState, PlayerVisionType } from '../emoteTypes'
import type { EmoteConfig } from '../configs/emoteConfig'
import { faceAxes, faceFrameFor, faceFrontWorld, pitchAxisWorld, restFrame } from './faceFrame'
import type { FaceFrame } from './faceFrame'

// Type for Camera (r3f uses three.Camera)
type CameraType = {
  position: Vector3
}

type EyeAngles = { h: number; v: number }

const UP = new Vector3(0, 1, 0)

// How far ahead of the face the neutral gaze target sits, in metres. Far enough that the eyes look parallel, as
// they do at rest: at 1 m each eye would turn about 2 degrees toward the other.
const NEUTRAL_DISTANCE = 10

// Scratch objects for the per-frame gaze path, so it does not allocate. Nothing here is stored
// on state: values are cloned or copied before they are kept.
const scratchTarget = new Vector3()
const neutralTarget = new Vector3()
const scratchNeutralOrigin = new Vector3()
const scratchNeckWorld = new Vector3()
const scratchNeckWorldQuat = new Quaternion()
const scratchToTarget = new Vector3()
const scratchNeckForward = new Vector3()
const scratchToTargetXZ = new Vector3()
const scratchNeckForwardXZ = new Vector3()
const scratchCrossYaw = new Vector3()
const scratchPitchAxisWorld = new Vector3()
const scratchToTargetSagittal = new Vector3()
const scratchNeckForwardSagittal = new Vector3()
const scratchCrossPitch = new Vector3()
const scratchFaceFront = new Vector3()
const scratchFaceUp = new Vector3()
const scratchFaceRight = new Vector3()
const scratchEyePitchAxis = new Vector3()
const scratchPitchQuat = new Quaternion()
const scratchRestInv = new Quaternion()
const scratchNeckOffset = new Quaternion()
const scratchNeckGoal = new Quaternion()
const scratchReturnQuat = new Quaternion()
const scratchEyeTarget = new Vector3()
const scratchEyeDir = new Vector3()
const scratchEyeRestInv = new Quaternion()
const scratchEyeOffset = new Quaternion()
const scratchEyeGoal = new Quaternion()
const scratchEyePos = new Vector3()
const scratchEyeWorldQuat = new Quaternion()
const scratchEyeForward = new Vector3()
const scratchEyeUp = new Vector3()
const scratchEyeRight = new Vector3()
const scratchEyeToCamera = new Vector3()
const scratchLeftEyePos = new Vector3()
const scratchRightEyePos = new Vector3()
const scratchEyeMidpoint = new Vector3()
const scratchToCamera = new Vector3()
const scratchLeftAngles: EyeAngles = { h: 0, v: 0 }
const scratchRightAngles: EyeAngles = { h: 0, v: 0 }
const aimOut = { yaw: 0, pitch: 0 }

export const updateGaze = (state: EmoteState, delta: number, config: EmoteConfig): void => {
  try {
    updateGazeInternal(state, delta, config)
  } catch (error) {
    console.warn('Gaze update failed', error)
    // Fallback to neutral gaze
    resetGazeToNeutral(state)
  }
}

const updateGazeInternal = (state: EmoteState, delta: number , config : EmoteConfig): void => {
  const currentTime = performance.now()
  const camera = state.camera

  if (!camera || (state.vrm && !state.vrm.lookAt)) return

  const { gazeState } = state

  // Which way this rig's face looks, read from its geometry once per avatar
  const face = faceFrameFor(state)

  // 1. Check visibility
  const visibilityState = getPlayerVisionState(state, camera , config, face)
  const isVisible = visibilityState !== null

  if (isVisible && !gazeState.isPlayerVisible) {
    initiateGaze(state, { duration: Infinity })
  }
  gazeState.isPlayerVisible = isVisible

  // 2. Determine focus state
  const isActiveFocus = gazeState.gazeTime.start < currentTime && gazeState.gazeTime.end > currentTime

  // 3. Pick gaze target
  const target = calculateGazeTarget(state, camera, visibilityState, currentTime, isActiveFocus, face)

  // 4. Smooth toward the new target from the PREVIOUS smoothed target. (Previously this
  //    assigned `target` to gazeState.target first, so smoothVector lerped the target toward
  //    itself — a no-op, making the eyes snap instantly.)
  if (!gazeState.target) {
    gazeState.target = target.clone()
  } else {
    gazeState.target = smoothVector(gazeState.target as Vector3, target, delta, config.gaze.interpolationFactor)
  }

  // 5. Apply gaze based on visibility state
  applyGazeBehavior(state, visibilityState, delta , config, face)
}

// The point the eyes rest on when there is nothing to look at: far ahead of the face, level with the eyes, so
// that they settle at their rest orientation. A rig whose face cannot be read keeps the point this was tuned
// on, 1.5 m up and 1 m along -z.
const neutralGazeTarget = (state: EmoteState, face: FaceFrame, out: Vector3): Vector3 => {
  if (face.legacy || !state.node) return out.set(0, 1.5, -1)

  scratchNeutralOrigin.set(0, 0, 0)
  for (const eye of face.eyes) scratchNeutralOrigin.add(eye.getWorldPosition(scratchEyePos))
  scratchNeutralOrigin.divideScalar(face.eyes.length)
  return out.copy(scratchNeutralOrigin).addScaledVector(faceFrontWorld(state, face, scratchFaceFront), NEUTRAL_DISTANCE)
}

const calculateGazeTarget = (
  state: EmoteState,
  camera: CameraType,
  visibilityState: PlayerVisionType,
  currentTime: number,
  isActiveFocus: boolean,
  face: FaceFrame
): Vector3 => {
  if (!visibilityState) {
    return neutralGazeTarget(state, face, scratchTarget) // Default forward look
  }

  if (isActiveFocus) {
    return scratchTarget.copy(camera.position)
  } else if (state.relaxationTime > currentTime) {
    return scratchTarget.copy(camera.position).multiplyScalar(0.5)
  } else {
    return neutralGazeTarget(state, face, scratchTarget)
  }
}

const applyGazeBehavior = (
  state: EmoteState,
  visibilityState: PlayerVisionType,
  delta: number,
  config: EmoteConfig,
  face: FaceFrame
): void => {
  const target = state.gazeState.target as Vector3
  if (visibilityState) {
    switch (visibilityState) {
      case 'focused':
        // In central/paracentral vision: Eyes follow directly, neck stays neutral
        updateEyeGaze(state, target, delta, config, face)
        returnNeckToNeutral(state, delta , config)
        break
      case 'peripheral':
      default:
        // In peripheral vision: Lead with neck, then eyes follow
        updateNeckGaze(state, target, delta , config, face)
        break
    }
  } else {
    // Not visible: Return neck and eyes to neutral position
    returnNeckToNeutral(state, delta, config)
    updateEyeGaze(state, neutralGazeTarget(state, face, neutralTarget), delta, config, face)
  }
}

const resetGazeToNeutral = (state: EmoteState): void => {
  // Fallback neutral gaze
  if (state.vrm?.lookAt) {
    const target = new Vector3(0, 1.5, -1)
    try {
      neutralGazeTarget(state, faceFrameFor(state), target)
    } catch {
      // The face could not be read either: look at the point the rig was tuned on
      target.set(0, 1.5, -1)
    }
    state.vrm.lookAt.lookAt(target)
  }
}

export const initiateGaze = (state: EmoteState , options: { delay?: number, duration?: number, randomness?: number }): void => {
  if (!state.bones?.neck) return

  const { delay = -1, duration = -1, randomness = 0 } = options
  // Don't always gaze
  if (randomness > 0 && Math.random() > randomness) return

  const currentTime = performance.now()
  const actualDelay = delay < 0 ? Math.random() * 1000 : delay
  const actualDuration = duration < 0 ? Math.random() * 1000 + 4000 : duration

  state.gazeState.gazeTime.start = currentTime + actualDelay
  state.gazeState.gazeTime.end = currentTime + actualDelay + actualDuration
  state.gazeState.isGazing = true

  // VRM: seed the neck rest from the raw bone that updateNeckGaze drives (see captureNeckRest)
  if (state.vrm && state.vrm.scene) {
    captureNeckRest(state)
  }
}

function smoothVector(current: Vector3, target: Vector3, delta: number, factor: number): Vector3 {
  return current.lerp(target, 1 - Math.exp(-delta * factor))
}

// Eye aim limits in degrees. An eye turns only about 35 degrees yaw and 25 degrees pitch in its
// socket before the head has to move, so the eye bones stop there and the head and neck take the
// rest of a larger turn. These are the eyes' own limits, separate from the neck's.
const EYE_YAW_LIMIT = 35
const EYE_PITCH_LIMIT = 25

// Clamp a yaw/pitch aim to a range given in degrees: yaw is limited by maxYawDeg, and pitch is
// limited by maxPitchDeg, decayed as the yaw turns to the side. The result is left in aimOut.
function clampAim(yaw: number, pitch: number, maxYawDeg: number, maxPitchDeg: number): void {
  const maxYaw = maxYawDeg * MathUtils.DEG2RAD
  const clampedYaw = Math.max(-maxYaw, Math.min(maxYaw, yaw))

  // Decay pitch for higher yaw: when looking to the side, reduce pitch range
  const maxPitch = maxPitchDeg * MathUtils.DEG2RAD
  const yawAbs = Math.abs(clampedYaw)
  const pitchDecay = Math.pow(1 - yawAbs / maxYaw, 2.5) // Sharper dropoff from center to side
  const decayedMaxPitch = maxPitch * Math.max(0, pitchDecay)

  aimOut.yaw = clampedYaw
  aimOut.pitch = Math.max(-decayedMaxPitch, Math.min(decayedMaxPitch, pitch))
}

// The rest orientation of each neck bone, as first captured from the raw bone. Keyed by the bone,
// so a reset that clears the gaze state's copy restores this rest instead of a turned pose.
const neckRestByBone = new WeakMap<Object3D, [number, number, number, number]>()

// The neck bone that each gaze state's rest belongs to, so a new avatar's neck does not inherit one
const neckRestSource = new WeakMap<GazeState, Object3D>()

// Seed the neck rest into the gaze state when it is missing or belongs to another neck. The rest
// is the bone's first captured orientation, so a pose the neck is already turned to never becomes it.
function captureNeckRest(state: EmoteState): void {
  const neck = state.bones?.neck
  if (!neck) return
  const { gazeState } = state
  const source = neckRestSource.get(gazeState)
  if (!gazeState.neckOptions.quaternions.default || (source && source !== neck)) {
    let rest = neckRestByBone.get(neck)
    if (!rest) {
      rest = neck.quaternion.toArray() as [number, number, number, number]
      neckRestByBone.set(neck, rest)
    }
    gazeState.neckOptions.quaternions.default = [...rest] as [number, number, number, number]
  }
  neckRestSource.set(gazeState, neck)
}

// The neck rest to return to, for the neck bone in the state
function neckRestFor(state: EmoteState): [number, number, number, number] | null {
  const neck = state.bones?.neck
  if (!neck) return null
  const rest = state.gazeState.neckOptions.quaternions.default
  const source = neckRestSource.get(state.gazeState)
  if (rest && (!source || source === neck)) return rest
  return neckRestByBone.get(neck) ?? null
}

// Rest orientation of each eye bone, keyed by the bone so a new avatar brings its own rest
const eyeRestQuaternions = new WeakMap<Object3D, Quaternion>()

// Apply eye-only gaze. VRM avatars use their lookAt; other rigs drive their eye bones.
function updateEyeGaze(state: EmoteState, target: Vector3, delta: number, config: EmoteConfig, face: FaceFrame) {
  if (state.vrm) {
    // Blend between forward and target for subtlety
    state.vrm.lookAt?.lookAt(target)
    return
  }
  if (state.bones?.leftEye) aimEyeBone(state.bones.leftEye, target, delta, config, state, face)
  if (state.bones?.rightEye) aimEyeBone(state.bones.rightEye, target, delta, config, state, face)
}

// Aim one eye bone's forward axis at the target, within the eye's own yaw and pitch limits. The
// direction is measured in the eye's parent frame, so head and neck turns are already included.
// The aim is absolute: unlike the neck's residual aim, it does not settle at about half the angle.
//
// The eye's forward is where the rig's face looks, carried into the eye's own rest frame (see
// faceFrame.ts), so the same maths aims an eye that sits behind the head bone at -z (VRM 0.x) and one
// in front of it at +z (Ready Player Me, Mixamo, VRM 1.0). Yaw turns the face about up, pitch about the
// axis that raises it, and both are applied on the eye's rest orientation.
function aimEyeBone(eye: Object3D, target: Vector3, delta: number, config: EmoteConfig, state: EmoteState, face: FaceFrame): void {
  let rest = eyeRestQuaternions.get(eye)
  if (!rest) {
    rest = eye.quaternion.clone()
    eyeRestQuaternions.set(eye, rest)
  }

  scratchEyeTarget.copy(target)
  eye.parent?.worldToLocal(scratchEyeTarget)
  // Direction from the eye to the target, then into the eye's rest frame
  scratchEyeDir.subVectors(scratchEyeTarget, eye.position).normalize()
  scratchEyeRestInv.copy(rest).invert()
  scratchEyeDir.applyQuaternion(scratchEyeRestInv)

  // Forward, up and the axis a positive yaw turns toward, in the eye's rest frame
  faceAxes(eye, state, face, scratchFaceFront, scratchFaceUp)
  const right = scratchFaceRight.crossVectors(scratchFaceUp, scratchFaceFront)
  const ahead = scratchEyeDir.dot(scratchFaceFront)
  const aside = scratchEyeDir.dot(right)

  clampAim(
    Math.atan2(aside, ahead),
    Math.atan2(scratchEyeDir.dot(scratchFaceUp), Math.hypot(ahead, aside)),
    EYE_YAW_LIMIT,
    EYE_PITCH_LIMIT
  )
  // Pitch about the axis that raises the face, then yaw about up: the same order as Euler 'YXZ'
  scratchEyeOffset
    .setFromAxisAngle(scratchFaceUp, aimOut.yaw)
    .multiply(scratchPitchQuat.setFromAxisAngle(scratchEyePitchAxis.crossVectors(scratchFaceFront, scratchFaceUp), aimOut.pitch))
  scratchEyeGoal.copy(rest).multiply(scratchEyeOffset)
  eye.quaternion.slerp(scratchEyeGoal, 1 - Math.exp(-delta * config.gaze.interpolationFactor))
}

// Apply neck rotation toward target (yaw about up, pitch about the lateral axis; eyes follow)
function updateNeckGaze(state: EmoteState, target: Vector3, delta: number , config: EmoteConfig, face: FaceFrame) {
  const { gazeState } = state
  if (!state.bones?.neck) return

  captureNeckRest(state)

  const baseBone = state.bones.spine2 || state.bones.spine || null
  if (!baseBone) return

  const neckWorld = state.bones.neck.getWorldPosition(scratchNeckWorld)

  // Compute direction to target in world space
  const toTarget = scratchToTarget.subVectors(target, neckWorld).normalize()
  const neckWorldQuat = state.bones.neck.getWorldQuaternion(scratchNeckWorldQuat)
  // Where the face looks through the neck in world space. The rig's own forward carried into the neck's
  // frame, so a neck that leans forward at rest still points the face level.
  faceAxes(state.bones.neck, state, face, scratchFaceFront, scratchFaceUp)
  const neckForward = scratchNeckForward.copy(scratchFaceFront).applyQuaternion(neckWorldQuat).normalize()

  // Calculate yaw (rotation around y axis)
  const toTargetXZ = scratchToTargetXZ.set(toTarget.x, 0, toTarget.z).normalize()
  const neckForwardXZ = scratchNeckForwardXZ.set(neckForward.x, 0, neckForward.z).normalize()
  let yawAngle = neckForwardXZ.angleTo(toTargetXZ)
  const crossYaw = scratchCrossYaw.crossVectors(neckForwardXZ, toTargetXZ)
  const signYaw = Math.sign(crossYaw.y) // y axis is up
  yawAngle *= signYaw

  // Calculate pitch (rotation about the lateral axis, the one a positive pitch raises the face about)
  // Project toTarget and neckForward onto the plane across it (ignore the lateral part for pitch). That
  // axis is -x for a face that looks along world +z, so a positive angle is a target above the face
  // for a VRM 0.x avatar turned to face +z and for a Ready Player Me avatar facing +z alike.
  const lateral = pitchAxisWorld(state, face, scratchPitchAxisWorld)
  const toTargetSagittal = scratchToTargetSagittal.copy(toTarget).addScaledVector(lateral, -toTarget.dot(lateral)).normalize()
  const neckForwardSagittal = scratchNeckForwardSagittal.copy(neckForward).addScaledVector(lateral, -neckForward.dot(lateral)).normalize()
  let pitchAngle = neckForwardSagittal.angleTo(toTargetSagittal)
  const crossPitch = scratchCrossPitch.crossVectors(neckForwardSagittal, toTargetSagittal)
  const signPitch = Math.sign(crossPitch.dot(lateral))
  pitchAngle *= signPitch

  // Clamp to the neck range (yaw, then pitch decayed by yaw)
  clampAim(yawAngle, pitchAngle, config.gaze.neck.yaw, config.gaze.neck.pitch)

  // Build target quaternion: yaw about up and pitch about the lateral axis, in the avatar's frame, carried
  // into the neck's own frame by the neck's rest orientation and applied on top of the neck rest. The neck
  // of a Ready Player Me avatar leans forward about 20 degrees at rest, so its own y axis is not up.
  const defaultQuat = scratchNeckGoal.fromArray(gazeState.neckOptions.quaternions.default!)
  scratchNeckOffset
    .setFromAxisAngle(UP, aimOut.yaw)
    .multiply(scratchPitchQuat.setFromAxisAngle(face.pitchAxis, aimOut.pitch))
  if (!face.legacy && state.node) {
    const neckRest = restFrame(state.bones.neck, state.node)
    scratchNeckOffset.premultiply(scratchRestInv.copy(neckRest).invert()).multiply(neckRest)
  }
  const constrainedQuat = defaultQuat.multiply(scratchNeckOffset)

  // Smoothly interpolate neck toward constrained orientation
  state.bones.neck.quaternion.slerp(constrainedQuat, 1 - Math.exp(-delta * config.gaze.interpolationFactor))

  // Eyes follow neck movement with slight delay for natural look
  updateEyeGaze(state, target, delta, config, face)
}

function returnNeckToNeutral(state: EmoteState, delta: number , config: EmoteConfig) {
  const rest = neckRestFor(state)
  if (rest && state.bones?.neck) {
    state.bones.neck.quaternion.slerp(scratchReturnQuat.fromArray(rest), 1 - Math.exp(-delta * config.gaze.interpolationFactor))
  }
}

// Eye meshes under a node, looked up once per node. This used to walk the scene every frame;
// the result is cached per node object instead.
const eyeMeshCache = new WeakMap<Object3D, { left: Object3D | null; right: Object3D | null }>()

function findEyeMeshes(node: Object3D) {
  const cached = eyeMeshCache.get(node)
  if (cached) return cached

  const found: { left: Object3D | null; right: Object3D | null } = { left: null, right: null }
  // Traverse the node's children to find meshes with "eye" in the name
  node.traverse((child) => {
    const name = child.name?.toLowerCase?.() ?? ''
    const isMesh = (child as Mesh).isMesh === true
    if (!found.left && isMesh && name.includes('left') && name.includes('eye')) {
      found.left = child
    }
    if (!found.right && isMesh && name.includes('right') && name.includes('eye')) {
      found.right = child
    }
  })
  eyeMeshCache.set(node, found)
  return found
}

// Horizontal and vertical angles (radians) from an eye's forward axis to the camera
function eyeAnglesToCamera(eye: Object3D, cameraPos: Vector3, out: EyeAngles, state: EmoteState, face: FaceFrame): EyeAngles {
  const eyePos = eye.getWorldPosition(scratchEyePos)
  // The eye's full world orientation: avatar root, spine, neck, head and eye
  const eyeWorldQuat = eye.getWorldQuaternion(scratchEyeWorldQuat)

  // The rig's forward and up in the eye's own frame, turned by that orientation: where the face looks, and
  // which way is up for it, as the whole chain has posed them
  faceAxes(eye, state, face, scratchEyeForward, scratchEyeUp)
  scratchEyeForward.applyQuaternion(eyeWorldQuat).normalize()
  scratchEyeUp.applyQuaternion(eyeWorldQuat).normalize()
  const eyeForward = scratchEyeForward
  const eyeUp = scratchEyeUp

  const toTarget = scratchEyeToCamera.subVectors(cameraPos, eyePos).normalize()
  const eyeRight = scratchEyeRight.crossVectors(eyeForward, eyeUp).normalize()

  out.h = Math.atan2(toTarget.dot(eyeRight), toTarget.dot(eyeForward))
  out.v = Math.atan2(toTarget.dot(eyeUp), toTarget.dot(eyeForward))
  return out
}

// Whether an eye's angles fall inside a vision cone given in degrees
function inVisionCone(angles: EyeAngles, hAngle: number, vAngle: number): boolean {
  return Math.abs(angles.h) < hAngle * MathUtils.DEG2RAD && Math.abs(angles.v) < vAngle * MathUtils.DEG2RAD
}

function getPlayerVisionState(state: EmoteState, camera: CameraType , config: EmoteConfig, face: FaceFrame): PlayerVisionType {
  if (!state.node || !camera) return null

  // Parameter defaults
  const {
    maxDistance,
    eye: {
      focused: { horizontal: focusedHorizontalAngle, vertical: focusedVerticalAngle },
      peripheral: { horizontal: peripheralHorizontalAngle, vertical: peripheralVerticalAngle }
    }
  } = config.gaze

  let leftEyeObj: Object3D | null = null
  let rightEyeObj: Object3D | null = null

  if (state.vrm && state.bones?.leftEye && state.bones?.rightEye) {
    // VRM: use bones
    leftEyeObj = state.bones.leftEye
    rightEyeObj = state.bones.rightEye
  } else if (state.bones?.Head) {
    // Not VRM: use head bone if available
    leftEyeObj = state.bones.Head
    rightEyeObj = state.bones.Head
  } else {
    // Not VRM: use the eye meshes under the node
    const eyeMeshes = findEyeMeshes(state.node)
    leftEyeObj = eyeMeshes.left
    rightEyeObj = eyeMeshes.right
  }

  if (!leftEyeObj || !rightEyeObj) return null

  // Get world positions
  const leftEyeWorldPos = leftEyeObj.getWorldPosition(scratchLeftEyePos)
  const rightEyeWorldPos = rightEyeObj.getWorldPosition(scratchRightEyePos)
  const hipsWorldPos = state.node.position
  const cameraPos = camera.position

  // Calculate the midpoint between the eyes (approximate head center)
  const eyeMidpoint = scratchEyeMidpoint.addVectors(leftEyeWorldPos, rightEyeWorldPos).multiplyScalar(0.5)
  // Vector from eye midpoint to camera
  const toCameraVec = scratchToCamera.subVectors(cameraPos, eyeMidpoint)
  const cameraDistance = toCameraVec.length()

  // Always visible if camera is above the avatar (y axis)
  // Invisible if camera is below the avatar (y axis)
  if (cameraPos.y < hipsWorldPos.y) {
    return null
  }

  // Invisible if outside of specified range
  if (cameraDistance > maxDistance) {
    return null
  }

  // Each eye is measured once, then checked against both cones
  const leftAngles = eyeAnglesToCamera(leftEyeObj, cameraPos, scratchLeftAngles, state, face)
  const rightAngles = eyeAnglesToCamera(rightEyeObj, cameraPos, scratchRightAngles, state, face)

  // Focused (central vision)
  if (
    inVisionCone(leftAngles, focusedHorizontalAngle, focusedVerticalAngle) ||
    inVisionCone(rightAngles, focusedHorizontalAngle, focusedVerticalAngle)
  ) {
    return 'focused'
  }

  // Peripheral vision
  if (
    inVisionCone(leftAngles, peripheralHorizontalAngle, peripheralVerticalAngle) ||
    inVisionCone(rightAngles, peripheralHorizontalAngle, peripheralVerticalAngle)
  ) {
    return 'peripheral'
  }

  // Not visible
  return null
}
