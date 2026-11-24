import { closeSync, openSync, readSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Bone, Matrix4, MathUtils, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VRM_HUMAN_BONES, resolveBones } from '@ci-avatar/engine'
import type { BoneSlot, NodeLike } from '@ci-avatar/engine'
import { defaultEmoteConfig } from '../configs/emoteConfig'
import { initializeEmoteState } from '../emoteService'
import type { EmoteState } from '../emoteTypes'
import { faceFrameFor, faceFrontWorld } from './faceFrame'
import { updateGaze } from './gazeService'

// Every avatar in the catalog, read from its file: where its eyes sit relative to its head says which way
// it faces, and the gaze has to turn its neck toward a camera on that side and leave it alone behind.
const AVATARS = fileURLToPath(new URL('../../../../../../assets/avatars/', import.meta.url))

const FRAME = 1 / 60
let now = 0

beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface GltfNode {
  name?: string
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface GltfJson {
  nodes?: GltfNode[]
  scene?: number
  scenes?: Array<{ nodes?: number[] }>
  skins?: Array<{ joints: number[] }>
  extensions?: {
    VRM?: { humanoid?: { humanBones?: Array<{ bone: string; node: number }> } }
    VRMC_vrm?: { humanoid?: { humanBones?: Record<string, { node: number }> } }
  }
}

// The JSON chunk of a binary glTF: a 12 byte header, then the chunk's length and type, then the JSON.
const readGltfJson = (file: string): GltfJson => {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    readSync(fd, head, 0, 20, 0)
    const json = Buffer.alloc(head.readUInt32LE(12))
    readSync(fd, json, 0, json.length, 20)
    return JSON.parse(json.toString('utf8')) as GltfJson
  } finally {
    closeSync(fd)
  }
}

/** The avatar as the app holds it once it has loaded: a scene root, its bones, and the emote state's view of them. */
function loadAvatar(file: string) {
  const gltf = readGltfJson(file)
  const joints = new Set((gltf.skins ?? []).flatMap((skin) => skin.joints))
  const nodes = (gltf.nodes ?? []).map((definition, index) => {
    const node = joints.has(index) ? new Bone() : new Object3D()
    node.name = definition.name ?? ''
    if (definition.matrix) {
      new Matrix4().fromArray(definition.matrix).decompose(node.position, node.quaternion, node.scale)
    } else {
      if (definition.translation) node.position.fromArray(definition.translation)
      if (definition.rotation) node.quaternion.fromArray(definition.rotation)
      if (definition.scale) node.scale.fromArray(definition.scale)
    }
    return node
  })
  ;(gltf.nodes ?? []).forEach((definition, index) => definition.children?.forEach((child) => nodes[index].add(nodes[child])))

  const root = new Object3D()
  for (const index of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) root.add(nodes[index])

  // VRM 0.x avatars are turned 180 degrees about y when they load (VRMUtils.rotateVRM0)
  const vrm0 = Boolean(gltf.extensions?.VRM)
  const vrm1 = Boolean(gltf.extensions?.VRMC_vrm)
  if (vrm0) root.rotation.y = Math.PI
  root.updateMatrixWorld(true)

  // The bones the way AvatarModel registers them: by their own names, then by slot, then under the capitalised
  // names the GLB rigs use, with each one's rest rotation recorded before anything animates it.
  const humanBones: Record<string, Object3D> = {}
  for (const entry of gltf.extensions?.VRM?.humanoid?.humanBones ?? []) humanBones[entry.bone] = nodes[entry.node]
  for (const [bone, entry] of Object.entries(gltf.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {})) {
    humanBones[bone] = nodes[entry.node]
  }
  const bones: Record<string, Bone> = {}
  root.traverse((node) => {
    if ((node as Bone).isBone) bones[node.name] = node as Bone
  })
  const resolved = resolveBones(nodes as unknown as NodeLike[], {
    humanoid: vrm0 || vrm1 ? (slot: BoneSlot) => humanBones[VRM_HUMAN_BONES[slot] ?? ''] as unknown as NodeLike : undefined
  })
  for (const [slot, node] of Object.entries(resolved)) if (node) bones[slot] = node as unknown as Bone
  for (const [slot, name] of Object.entries({ head: 'Head', neck: 'Neck', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2' })) {
    if (bones[slot] && !bones[name]) bones[name] = bones[slot]
  }
  for (const bone of Object.values(bones)) bone.userData.initialRotation ??= bone.rotation.clone()

  const state: EmoteState = initializeEmoteState()
  state.node = root
  state.bones = bones
  state.camera = new PerspectiveCamera()
  if (vrm0 || vrm1) state.vrm = { scene: root, lookAt: { lookAt: vi.fn() } } as unknown as VRM
  return { state, bones }
}

const files = (readdirSync(AVATARS, { recursive: true }) as string[])
  .filter((file) => /\.(glb|vrm)$/i.test(file))
  .sort()

describe('gazeService: every avatar in the catalog', () => {
  it('has avatars to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)('%s: reads which way it faces, turns toward a camera on that side and not behind', (file) => {
    const { state, bones } = loadAvatar(`${AVATARS}${file}`)
    const head = bones.Head ?? bones.head
    const neck = state.bones?.neck as Bone
    const camera = state.camera as PerspectiveCamera

    // Its face is read from the rig, not assumed: a rig the gaze cannot read would stay as it was, and inert
    const face = faceFrameFor(state)
    expect(face.legacy, `${file} has no eyes under its head to read the face from`).toBe(false)
    // Every avatar faces +z in the world once it has loaded
    expect(faceFrontWorld(state, face, new Vector3()).angleTo(new Vector3(0, 0, 1)) * MathUtils.RAD2DEG).toBeLessThan(1)

    // Where the neck's face points now, carried from its rest through the neck's orientation
    const restInNeck = new Vector3(0, 0, 1).applyQuaternion(neck.getWorldQuaternion(new Quaternion()).invert())
    const neckYaw = () => {
      const direction = restInNeck.clone().applyQuaternion(neck.getWorldQuaternion(new Quaternion()))
      return MathUtils.RAD2DEG * Math.atan2(direction.x, direction.z)
    }
    const settle = (azimuth: number) => {
      const a = azimuth * MathUtils.DEG2RAD
      camera.position
        .copy(head.getWorldPosition(new Vector3()))
        .add(new Vector3(Math.sin(a), 0, Math.cos(a)))
      for (let i = 0; i < 600; i++) {
        now += FRAME * 1000
        updateGaze(state, FRAME, defaultEmoteConfig)
      }
    }

    settle(60)
    expect(state.gazeState.isPlayerVisible).toBe(true)
    expect(neckYaw()).toBeGreaterThan(5)

    settle(-60)
    expect(neckYaw()).toBeLessThan(-5)

    settle(180)
    expect(state.gazeState.isPlayerVisible).toBe(false)
    expect(Math.abs(neckYaw())).toBeLessThan(0.5)
  })
})
