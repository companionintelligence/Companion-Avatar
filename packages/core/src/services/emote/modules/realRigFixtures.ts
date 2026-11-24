// Test fixtures only: the rest poses of shipped avatars, read from the avatar files in assets/avatars.
// Nothing outside the tests imports this.
//
// Synthetic rigs hid the gaze defects fixed alongside these: they faced -z, stood upright, and had
// their eyes under the head. The shipped avatars face +z (or are turned to), lean their necks forward
// about 20 degrees, tilt their heads, and splay their eye bones, so the tests build the real ones.
import { Bone, Object3D, PerspectiveCamera } from 'three'

import { initializeEmoteState } from '../emoteService'
import type { EmoteState } from '../emoteTypes'

type Vec3 = readonly [number, number, number]
type Quat = readonly [number, number, number, number]

/** A bone's name, its offset from its parent, and its rotation (x, y, z, w) at rest. */
export type BoneData = readonly [name: string, offset: Vec3, rotation: Quat]

export interface RigData {
  /** The file the pose was read from. */
  source: string
  /** Which way the face looks along the avatar root's z axis, before any turn of the root. */
  facing: 1 | -1
  /** Whether the avatar loads as a VRM 0.x, which the app turns 180 degrees about y (VRMUtils.rotateVRM0). */
  vrm0: boolean
  /** The bones from the first below the avatar root down to the head, each the parent of the next. */
  chain: readonly BoneData[]
  /** The bones from below the head down to the eye. */
  leftEye: readonly BoneData[]
  rightEye: readonly BoneData[]
  /** Names, in `chain`, of the bones the gaze reads. */
  neck: string
  spine2: string
  head: string
}

// Ready Player Me, as the default avatar and its siblings ship: the neck leans forward 19 degrees in the
// avatar's frame and the head bone is level to within half a degree.
export const GREG: RigData = {
  source: '25-1-3_CI_model_male_Greg.glb',
  facing: 1,
  vrm0: false,
  chain: [
    ['Armature', [0, 0, 0], [0, 0, 0, 1]],
    ['Hips', [0, 1.01919, 0.01003], [0.01623, -0.00003, 0, 0.99987]],
    ['Spine', [0, 0.09847, 0], [-0.06869, 0.00003, 0, 0.99764]],
    ['Spine1', [0, 0.1305, 0], [-0.03217, 0, 0, 0.99948]],
    ['Spine2', [0, 0.12181, 0], [0.0472, 0, 0, 0.99889]],
    ['Neck', [0, 0.15557, 0], [0.20307, 0, 0, 0.97916]],
    ['Head', [0, 0.12264, 0], [-0.16268, 0, 0, 0.98668]]
  ],
  leftEye: [['LeftEye', [0.03035, 0.08784, 0.08241], [-0.00361, 0, 0, 0.99999]]],
  rightEye: [['RightEye', [-0.02988, 0.08779, 0.08241], [-0.00361, 0, 0, 0.99999]]],
  neck: 'Neck',
  spine2: 'Spine2',
  head: 'Head'
}

// The older Ready Player Me rig (Ash, Brit, Cara, Courtney, Shanee, the Mixamo T-pose): its head bone rests
// pitched 8 degrees nose down, and each eye bone is turned back by the same angle so that the eyes are level.
export const ASH: RigData = {
  source: '25-1-3_CI_model_female_Ash.glb',
  facing: 1,
  vrm0: false,
  chain: [
    ['Armature', [0, 0, 0], [0, 0, 0, 1]],
    ['Hips', [0, 1.03696, 0.04043], [-0.02998, -0.00003, 0, 0.99955]],
    ['Spine', [0, 0.09636, 0], [-0.01379, 0.00003, 0, 0.9999]],
    ['Spine1', [0, 0.09147, 0], [-0.03636, 0, 0, 0.99934]],
    ['Spine2', [0, 0.12162, 0], [0.06359, 0, 0, 0.99798]],
    ['Neck', [0, 0.12444, 0], [0.13965, 0, 0, 0.9902]],
    ['Head', [0, 0.0908, 0], [-0.05336, 0, 0, 0.99858]]
  ],
  leftEye: [['LeftEye', [0.03412, 0.08738, 0.06595], [-0.07016, 0, 0, 0.99754]]],
  rightEye: [['RightEye', [-0.03412, 0.08732, 0.06596], [-0.07016, 0, 0, 0.99754]]],
  neck: 'Neck',
  spine2: 'Spine2',
  head: 'Head'
}

// VRM 0.x (VRoid Studio): authored facing -z with every bone unrotated, then turned by the app.
export const KENJI: RigData = {
  source: 'vrm/kenji.vrm',
  facing: -1,
  vrm0: true,
  chain: [
    ['Root', [0, 0, 0], [0, 0, 0, 1]],
    ['J_Bip_C_Hips', [0.00049, 1.01009, -0.01053], [0, 0, 0, 1]],
    ['J_Bip_C_Spine', [0, 0.14422, -0.00051], [0, 0, 0, 1]],
    ['J_Bip_C_Chest', [0, 0.07844, 0.00433], [0, 0, 0, 1]],
    ['J_Bip_C_UpperChest', [0, 0.08739, 0.00468], [0, 0, 0, 1]],
    ['J_Bip_C_Neck', [0, 0.15292, 0.01067], [0, 0, 0, 1]],
    ['J_Bip_C_Head', [0, 0.09259, -0.01489], [0, 0, 0, 1]]
  ],
  leftEye: [['J_Adj_L_FaceEye', [-0.01896, 0.0603, -0.03053], [0, 0, 0, 1]]],
  rightEye: [['J_Adj_R_FaceEye', [0.01896, 0.0603, -0.03053], [0, 0, 0, 1]]],
  neck: 'J_Bip_C_Neck',
  spine2: 'J_Bip_C_UpperChest',
  head: 'J_Bip_C_Head'
}

// VRM 0.x with each eye under an eye-set node that sits in front of the head: the eye is 5 cm in front of
// its own parent (+z) but 3 cm behind the head, because the face looks along -z.
export const YUKI: RigData = {
  source: 'vrm/yuki.vrm',
  facing: -1,
  vrm0: true,
  chain: [
    ['Root', [0, 0, 0], [0, 0, 0, 1]],
    ['J_Bip_C_Hips', [0.00022, 0.85694, -0.00569], [0, 0, 0, 1]],
    ['J_Bip_C_Spine', [0, 0.0494, -0.00923], [0, 0, 0, 1]],
    ['J_Bip_C_Chest', [0, 0.1072, -0.01364], [0, 0, 0, 1]],
    ['J_Bip_C_UpperChest', [0, 0.11575, 0.01229], [0, 0, 0, 1]],
    ['J_Bip_C_Neck', [0, 0.10914, 0.0318], [0, 0, 0, 1]],
    ['J_Bip_C_Head', [0, 0.06945, -0.00895], [0, 0, 0, 1]]
  ],
  leftEye: [
    ['J_Adj_L_FaceEyeSet', [-0.04106, 0.05745, -0.08035], [0, 0, 0, 1]],
    ['J_Adj_L_FaceEye', [0.02078, 0.00337, 0.05276], [0, 0, 0, 1]]
  ],
  rightEye: [
    ['J_Adj_R_FaceEyeSet', [0.04106, 0.05745, -0.08035], [0, 0, 0, 1]],
    ['J_Adj_R_FaceEye', [-0.02078, 0.00337, 0.05276], [0, 0, 0, 1]]
  ],
  neck: 'J_Bip_C_Neck',
  spine2: 'J_Bip_C_UpperChest',
  head: 'J_Bip_C_Head'
}

// VRM 1.0 (VRoid Studio): faces +z and is not turned. Its neck leans forward 7 degrees in the avatar's frame
// and each eye bone rests turned 22 degrees outward, so an eye's own z axis is not where the face looks.
export const WORKBOY: RigData = {
  source: 'vrm/workboy.vrm',
  facing: 1,
  vrm0: false,
  chain: [
    ['Root', [0, 0, 0], [0, 0, 0, 1]],
    ['J_Bip_C_Hips', [0, 1.02398, 0.00358], [0.0629, 0, 0, 0.99802]],
    ['J_Bip_C_Spine', [0, 0.05907, 0.00653], [0.0128, 0, 0, 0.99992]],
    ['J_Bip_C_Chest', [0, 0.12449, -0.01558], [-0.13622, 0, 0, 0.99068]],
    ['J_Bip_C_UpperChest', [0, 0.12054, -0.00162], [-0.10798, 0, 0, 0.99415]],
    ['J_Bip_C_Neck', [0, 0.15261, 0.00855], [0.22687, 0, 0, 0.97393]],
    ['J_Bip_C_Head', [0, 0.09279, -0.0004], [-0.05433, 0, 0, 0.99852]]
  ],
  leftEye: [['J_Adj_L_FaceEye', [0.01236, 0.07482, 0.02331], [0.02039, 0.18818, -0.00618, 0.9819]]],
  rightEye: [['J_Adj_R_FaceEye', [-0.01236, 0.07482, 0.02331], [0.02039, -0.18818, 0.00618, 0.9819]]],
  neck: 'J_Bip_C_Neck',
  spine2: 'J_Bip_C_UpperChest',
  head: 'J_Bip_C_Head'
}

export interface BuiltRig {
  state: EmoteState
  /** The avatar root: the node that the emote state holds, turned 180 degrees for a VRM 0.x avatar. */
  root: Object3D
  camera: PerspectiveCamera
  bones: Record<string, Bone>
  head: Bone
  neck: Bone
  leftEye: Bone
  rightEye: Bone
}

const makeBone = ([name, offset, rotation]: BoneData): Bone => {
  const bone = new Bone()
  bone.name = name
  bone.position.set(...offset)
  bone.quaternion.set(...rotation).normalize()
  return bone
}

/**
 * Build an avatar's skeleton at rest under a root, as AvatarModel hands it to the emote state: the
 * bones the gaze reads under their slot names, and each bone's rest rotation recorded on it.
 */
export const buildRig = (data: RigData, options: { turned?: boolean } = {}): BuiltRig => {
  const { turned = data.vrm0 } = options
  const root = new Object3D()
  if (turned) root.rotation.y = Math.PI

  const bones: Record<string, Bone> = {}
  const attach = (parent: Object3D, list: readonly BoneData[]): Bone => {
    let tip: Object3D = parent
    for (const entry of list) {
      const bone = makeBone(entry)
      tip.add(bone)
      bones[bone.name] = bone
      tip = bone
    }
    return tip as Bone
  }

  const head = attach(root, data.chain)
  const leftEye = attach(head, data.leftEye)
  const rightEye = attach(head, data.rightEye)

  // AvatarModel records every bone's rotation before any animation has run
  for (const bone of Object.values(bones)) bone.userData.initialRotation = bone.rotation.clone()
  root.updateMatrixWorld(true)

  const state = initializeEmoteState()
  const camera = new PerspectiveCamera()
  state.node = root
  state.camera = camera
  state.bones = { spine2: bones[data.spine2], neck: bones[data.neck], Head: head, head, leftEye, rightEye }
  return { state, root, camera, bones, head, neck: bones[data.neck], leftEye, rightEye }
}

/** Take the eyes off a built rig, as a custom avatar with no eye bones would be. Call before the gaze first runs. */
export const removeEyes = (rig: BuiltRig): void => {
  rig.leftEye.removeFromParent()
  rig.rightEye.removeFromParent()
  delete rig.state.bones?.leftEye
  delete rig.state.bones?.rightEye
}
