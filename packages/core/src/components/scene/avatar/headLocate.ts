import * as THREE from 'three'

import { namedEyeNodes } from '../../../services/emote/modules/faceFrame'

/** Metres a VRM 0.x avatar is pushed along +x after its head is located. */
export const VRM0_HEAD_OFFSET_X = 0.2

/**
 * The x each VRM 0.x avatar had before its offset. Keyed on the avatar object, not on a
 * component ref: a remount gets the same cached scene (useLoader caches by URL), so a
 * per-mount base would stack the offset again each time.
 */
const vrm0BaseX = new WeakMap<THREE.Object3D, number>()

export interface HeadLocateOptions {
  /**
   * Whether the avatar is a VRM, which takes the x offset. The facing is read from the eye bones;
   * with none found, a VRM is taken to face -z and any other rig +z.
   */
  isVRM: boolean
  /** Metres from the head to the camera, along the avatar's facing. */
  cameraDistance: number
  /** Metres to lower the look-at below the head. */
  cameraTargetDrop: number
}

export interface HeadLocation {
  /** The head's world position, after any VRM 0.x offset. */
  headWorldPosition: THREE.Vector3
  cameraTarget: [number, number, number]
  cameraPosition: [number, number, number]
}

/**
 * Which way the face looks: from the head toward the midpoint of its eye bones, flattened onto
 * the avatar's own XZ plane, which is level for the avatar. Undefined when the head has no eye
 * bones, or they sit level with the head so there is no horizontal direction to read.
 *
 * The plane must be the avatar's, not the head's parent's. The Ready Player Me and Mixamo rigs rest
 * with the neck leaning forward about 23 degrees, so the neck's XZ plane slopes down toward the
 * front, and a facing flattened there points below the horizon and parks the camera under the head.
 */
const facingFromEyes = (
  avatar: THREE.Object3D,
  head: THREE.Object3D,
  headWorldPosition: THREE.Vector3
): THREE.Vector3 | undefined => {
  const eyes = namedEyeNodes(head)
  if (eyes.length === 0) return undefined

  const eyeMidpoint = new THREE.Vector3()
  for (const eye of eyes) eyeMidpoint.add(eye.getWorldPosition(new THREE.Vector3()))
  eyeMidpoint.divideScalar(eyes.length)

  const avatarWorldQuat = avatar.getWorldQuaternion(new THREE.Quaternion())
  const horizontal = eyeMidpoint.sub(headWorldPosition).applyQuaternion(avatarWorldQuat.clone().invert())
  horizontal.y = 0
  if (horizontal.lengthSq() < 1e-10) return undefined
  return horizontal.normalize().applyQuaternion(avatarWorldQuat)
}

/**
 * Work out where the camera should look and sit for an avatar's head. The VRM 0.x
 * offset is applied first, so the camera (and the voice, which uses the same head
 * position) follow the head where it is drawn rather than where it was before the shift.
 */
export const locateAvatarHead = (
  avatar: THREE.Object3D,
  head: THREE.Object3D,
  options: HeadLocateOptions
): HeadLocation => {
  const { isVRM, cameraDistance, cameraTargetDrop } = options
  if (isVRM) {
    let base = vrm0BaseX.get(avatar)
    if (base === undefined) {
      base = avatar.position.x
      vrm0BaseX.set(avatar, base)
    }
    avatar.position.x = base + VRM0_HEAD_OFFSET_X
  }

  const headWorldPosition = new THREE.Vector3()
  head.getWorldPosition(headWorldPosition)
  const avatarWorldQuat = new THREE.Quaternion()
  avatar.getWorldQuaternion(avatarWorldQuat)
  const forward =
    facingFromEyes(avatar, head, headWorldPosition) ??
    new THREE.Vector3(0, 0, isVRM ? -1 : 1).applyQuaternion(avatarWorldQuat).normalize()
  const cameraTarget = headWorldPosition.clone().add(new THREE.Vector3(0, -cameraTargetDrop, 0))
  const cameraPosition = headWorldPosition.clone().add(forward.multiplyScalar(cameraDistance))
  return {
    headWorldPosition,
    cameraTarget: cameraTarget.toArray() as [number, number, number],
    cameraPosition: cameraPosition.toArray() as [number, number, number]
  }
}
