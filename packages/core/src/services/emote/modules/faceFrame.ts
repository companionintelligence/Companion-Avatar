import { Quaternion, Vector3 } from 'three'
import type { Euler, Mesh, Object3D } from 'three'

import type { EmoteState } from '../emoteTypes'

/**
 * Which way a rig's face looks, read from the rig and not assumed.
 *
 * The gaze used to take the face's forward as local -z, which is where a VRM 0.x avatar looks. The
 * Ready Player Me and Mixamo avatars and VRM 1.0 face +z, so for them the maths aimed at a point behind
 * the face. A VRM 0.x avatar is turned 180 degrees about y when it loads, so it also ends up facing
 * +z in the world, but its bones keep the -z axes it was authored with.
 */
export interface FaceFrame {
  /** Horizontal unit vector, in the avatar root's own frame, that the face looks along at rest. */
  front: Vector3
  /**
   * The axis, in the avatar root's frame, that a positive turn raises the face about. It is `front`
   * crossed with up: +x for a -z face and -x for a +z face, so the same pitch sign works for both.
   */
  pitchAxis: Vector3
  /** The nodes the face was read from, for placing the neutral gaze target level with the eyes. */
  eyes: readonly Object3D[]
  /**
   * True when the rig has no readable face geometry, so the maths this service was tuned on holds as it was:
   * the face looks along local -z, the bones are taken as aligned with the avatar, and pitch is measured
   * about world x, as it is for a VRM 0.x avatar whose root is turned 180 degrees.
   */
  legacy: boolean
}

const UP = new Vector3(0, 1, 0)

const LEGACY_FRAME: FaceFrame = {
  front: new Vector3(0, 0, -1),
  pitchAxis: new Vector3(1, 0, 0),
  eyes: [],
  legacy: true
}

/** The pitch axis in the world, for a rig with no readable face: pitch is measured about world x. */
export const LEGACY_PITCH_AXIS_WORLD: Readonly<Vector3> = new Vector3(-1, 0, 0)

/** Eye bone names. Eyebrows, eyelids, lashes and look targets contain "eye" but are not eyes. */
const EYE_BONE_NAME = /^(?!.*(brow|lid|lash|target|look)).*eye/i

/** The head bone of the rig: the VRM humanoid slot or the name the GLB rigs register it under. */
export const headBoneOf = (state: EmoteState): Object3D | undefined => state.bones?.Head ?? state.bones?.head

/**
 * The nodes under a head that are named like eyes. This is how the eyes of a rig are found when its avatar
 * mapped none, and how the camera is placed in front of the face (headLocate.ts).
 */
export const namedEyeNodes = (head: Object3D): Object3D[] => {
  const named: Object3D[] = []
  head.traverse((node) => {
    if (node !== head && !(node as Mesh).isMesh && EYE_BONE_NAME.test(node.name)) named.push(node)
  })
  return named
}

/** The eyes of a rig: the bones its avatar resolved, or failing those the nodes under the head named like eyes. */
export const eyeBonesOf = (state: EmoteState, head: Object3D): Object3D[] => {
  const mapped = [state.bones?.leftEye, state.bones?.rightEye].filter((bone): bone is NonNullable<typeof bone> => !!bone)
  return mapped.length > 0 ? mapped : namedEyeNodes(head)
}

const scratchLocal = new Quaternion()
const scratchInverse = new Quaternion()
const scratchWorldQuat = new Quaternion()
const scratchHeadPos = new Vector3()
const scratchEyePos = new Vector3()
const scratchOffset = new Vector3()

// The orientation of a bone relative to the avatar root, at rest. Keyed by the bone: a rig's rest does
// not change, so a new avatar brings its own.
const restFrames = new WeakMap<Object3D, Quaternion>()

// A node's rest rotation relative to its parent: the pose the avatar was loaded in, which the avatar
// records on each bone before any animation runs, or else its rotation as it is when first read.
const restLocal = (node: Object3D, out: Quaternion): Quaternion => {
  const rest = (node.userData as { initialRotation?: Euler } | undefined)?.initialRotation
  return rest?.isEuler ? out.setFromEuler(rest) : out.copy(node.quaternion)
}

/**
 * The orientation of `bone` relative to `root` in the rig's rest pose, which is how the bone's own axes
 * sit in the avatar's frame. Ready Player Me and Mixamo rigs rest with the neck leaning forward about 20
 * degrees, so a bone's local axes are not the avatar's. Read once and kept, so an animation that has
 * already moved the bone does not change it.
 */
export const restFrame = (bone: Object3D, root: Object3D): Quaternion => {
  let frame = restFrames.get(bone)
  if (!frame) {
    frame = new Quaternion()
    for (let node: Object3D | null = bone; node && node !== root; node = node.parent) {
      frame.premultiply(restLocal(node, scratchLocal))
    }
    restFrames.set(bone, frame)
  }
  return frame
}

/**
 * The face's forward and up in a bone's own frame, as they are in the rig's rest pose. Turning these by
 * the bone's world orientation gives where the face looks, and which way is up for it, now.
 */
export const faceAxes = (bone: Object3D, state: EmoteState, face: FaceFrame, outFront: Vector3, outUp: Vector3): void => {
  if (face.legacy || !state.node) {
    outFront.set(0, 0, -1)
    outUp.set(0, 1, 0)
    return
  }
  const inverse = scratchInverse.copy(restFrame(bone, state.node)).invert()
  outFront.copy(face.front).applyQuaternion(inverse)
  outUp.copy(UP).applyQuaternion(inverse)
}

/** The horizontal direction the avatar's face looks along in the world. */
export const faceFrontWorld = (state: EmoteState, face: FaceFrame, out: Vector3): Vector3 => {
  if (face.legacy || !state.node) return out.set(0, 0, -1)
  return out.copy(face.front).applyQuaternion(state.node.getWorldQuaternion(scratchWorldQuat))
}

/** The world axis that a positive pitch raises the face about. */
export const pitchAxisWorld = (state: EmoteState, face: FaceFrame, out: Vector3): Vector3 => {
  if (face.legacy || !state.node) return out.copy(LEGACY_PITCH_AXIS_WORLD)
  return out.copy(face.pitchAxis).applyQuaternion(state.node.getWorldQuaternion(scratchWorldQuat))
}

// Read the face from the rig: from the head toward the midpoint of its eyes, in the head's own frame,
// carried into the avatar's frame by the head's rest orientation, then flattened onto the avatar's
// horizontal plane. Nothing in it depends on how the avatar is posed when it is read.
const readFaceFrame = (state: EmoteState): FaceFrame | null => {
  const root = state.node
  const head = headBoneOf(state)
  if (!root || !head) return null

  const eyes = eyeBonesOf(state, head)
  if (eyes.length === 0) return null

  head.getWorldPosition(scratchHeadPos)
  scratchOffset.set(0, 0, 0)
  for (const eye of eyes) scratchOffset.add(eye.getWorldPosition(scratchEyePos))
  scratchOffset.divideScalar(eyes.length).sub(scratchHeadPos)

  // Into the head's frame, which does not change when the head turns, and from there into the avatar's
  // frame as the head sits at rest.
  scratchOffset.applyQuaternion(scratchInverse.copy(head.getWorldQuaternion(scratchWorldQuat)).invert())
  scratchOffset.applyQuaternion(restFrame(head, root))

  // Eyes straight above the head bone say nothing about which way it looks.
  const horizontal = Math.hypot(scratchOffset.x, scratchOffset.z)
  if (horizontal === 0 || horizontal < 0.1 * scratchOffset.length()) return null

  const front = new Vector3(scratchOffset.x, 0, scratchOffset.z).normalize()

  // Take the rest orientation of every bone the gaze reads in the same frame, so that they agree.
  for (const bone of [state.bones?.neck, state.bones?.leftEye, state.bones?.rightEye]) {
    if (bone) restFrame(bone, root)
  }

  return { front, pitchAxis: new Vector3().crossVectors(front, UP).normalize(), eyes, legacy: false }
}

// Read once per avatar, keyed by the bones the avatar registered, which are replaced with it.
const faceFrames = new WeakMap<object, FaceFrame>()

/**
 * The face frame of the avatar in the emote state. A rig whose face cannot be read gets the frame that
 * the gaze was tuned on, so it behaves as it did.
 */
export const faceFrameFor = (state: EmoteState): FaceFrame => {
  const bones = state.bones
  if (!bones || !state.node) return LEGACY_FRAME

  let frame = faceFrames.get(bones)
  if (!frame) {
    frame = readFaceFrame(state) ?? LEGACY_FRAME
    faceFrames.set(bones, frame)
  }
  return frame
}
