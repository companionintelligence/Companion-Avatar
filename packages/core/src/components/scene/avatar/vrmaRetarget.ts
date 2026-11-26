import { Quaternion, QuaternionKeyframeTrack } from 'three'
import type { KeyframeTrack, Object3D } from 'three'
import { VRMHumanBoneList } from '@pixiv/three-vrm'
import type { VRMHumanoid } from '@pixiv/three-vrm'

// A VRMA clip is written for a normalized skeleton: every bone at rest is the identity rotation and a
// track's value is the turn away from rest, in a frame that does not depend on the model. three-vrm
// carries that onto the real bones (VRMHumanoidRig.update) as
//
//   raw = inverse(PW) * q * PW * R
//
// where q is the normalized value, R the bone's own rest rotation and PW the rotation of its parent at
// rest. This app drives the real bones with the clip's mixer and never calls humanoid.update(), which
// would rewrite every bone from the normalized skeleton on each frame, the neck and head the gaze owns
// among them (see vrmFrameMotion.ts), so it binds each clip to the real bones' names instead. The
// values must then be carried over the same way, which this does when the clip is built.
//
// The values were left as they were, and that is exact only where R and PW are the identity, as they are
// in every shipped VRM 0.x avatar. In the VRM 1.0 avatars they are not: Work Boy and Casual Person rest
// with a 26 degree neck, a -16 degree chest and arms that hang 8 degrees out, and Aria's arms rest in a
// frame turned 90 degrees. A clip overwrote those rests with rest-relative values, so the torso lost its
// authored lean (the head hung 22 degrees nose down once the neck kept its own rest) and the arms
// swung about the wrong axes.

/** How three-vrm names a normalized bone: this prefix and the real node's name. */
export const NORMALIZED_PREFIX = 'Normalized_'

/** What carries a normalized rotation onto one real bone. */
export interface BoneRest {
  /** The bone's own rotation at rest, local to its parent (R). */
  rest: Quaternion
  /** Its parent's rotation at rest in the avatar's own frame, from the model's root down (PW). */
  parentWorld: Quaternion
}

/** What this module reads from a loaded VRM. */
export interface RestSource {
  scene: Object3D
  humanoid: Pick<VRMHumanoid, 'getRawBoneNode' | 'rawRestPose'>
}

const EPSILON = 1e-6

const isIdentity = (q: Quaternion): boolean => Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) < EPSILON

/** Whether a bone's values need no carrying over: its own rest and its parent's are both the identity. */
export const isRestIdentity = ({ rest, parentWorld }: BoneRest): boolean => isIdentity(rest) && isIdentity(parentWorld)

/**
 * The rests of a loaded VRM's bones, by the name of the real node, which is what a bound track carries.
 *
 * R is read from the rest pose three-vrm took when the model loaded. PW is the product of the rests of
 * every ancestor from the bone's parent up to the scene, so it does not depend on the pose the avatar is
 * in now. The scene's own transform is left out, as three-vrm leaves it out: it captures the rests
 * before VRMUtils.rotateVRM0 turns a VRM 0.x scene about y.
 */
export const captureBoneRests = ({ scene, humanoid }: RestSource): Map<string, BoneRest> => {
  const restOfNode = new Map<Object3D, Quaternion>()
  for (const name of VRMHumanBoneList) {
    const node = humanoid.getRawBoneNode(name)
    const rotation = humanoid.rawRestPose[name]?.rotation
    if (node && rotation) restOfNode.set(node, new Quaternion().fromArray(rotation))
  }

  const rests = new Map<string, BoneRest>()
  for (const name of VRMHumanBoneList) {
    const node = humanoid.getRawBoneNode(name)
    const rest = node && restOfNode.get(node)
    if (!node || !rest) continue

    const ancestors: Object3D[] = []
    let reachedScene = false
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent === scene) {
        reachedScene = true
        break
      }
      ancestors.push(parent)
    }
    // A bone that does not hang from the scene has no frame to read, so its values stay as the clip has them
    if (!reachedScene) continue

    const parentWorld = new Quaternion()
    for (let i = ancestors.length - 1; i >= 0; i--) {
      // A bone above this one is read at rest; a node that is not a humanoid bone is never animated
      parentWorld.multiply(restOfNode.get(ancestors[i]) ?? ancestors[i].quaternion)
    }
    rests.set(node.name, { rest: rest.clone(), parentWorld })
  }
  return rests
}

/** Carry flat (x, y, z, w) rotations from the normalized skeleton onto one real bone: inverse(PW) * q * PW * R. */
const carryRotations = (values: ArrayLike<number>, { rest, parentWorld }: BoneRest): Float32Array => {
  const before = parentWorld.clone().invert()
  const after = parentWorld.clone().multiply(rest)
  const out = new Float32Array(values.length)
  const q = new Quaternion()
  for (let i = 0; i + 3 < values.length; i += 4) {
    q.fromArray(values, i).premultiply(before).multiply(after).normalize().toArray(out, i)
  }
  return out
}

/**
 * Bind a clip's tracks, made for the normalized skeleton, to the real bones: drop the `Normalized_`
 * prefix from each name so the mixer finds the real node, and carry each rotation over that bone's rest.
 * A track for a bone whose rests are the identity keeps its values as they are, so a model like that
 * moves exactly as it did before. Position tracks and tracks that are not for a normalized bone only
 * change name. Returns new tracks; the ones passed in are not touched.
 */
export const bindTracksToRawBones = (
  tracks: readonly KeyframeTrack[],
  rests: ReadonlyMap<string, BoneRest>
): KeyframeTrack[] =>
  tracks.map((track) => {
    if (!track.name.startsWith(NORMALIZED_PREFIX)) return track

    const dot = track.name.lastIndexOf('.')
    const node = track.name.slice(NORMALIZED_PREFIX.length, dot < 0 ? undefined : dot)
    const property = dot < 0 ? '' : track.name.slice(dot + 1)
    const rest = rests.get(node)

    if (property === 'quaternion' && rest && !isRestIdentity(rest)) {
      return new QuaternionKeyframeTrack(
        track.name.slice(NORMALIZED_PREFIX.length),
        track.times,
        carryRotations(track.values, rest),
        track.getInterpolation()
      )
    }
    const bound = track.clone()
    bound.name = track.name.slice(NORMALIZED_PREFIX.length)
    return bound
  })
