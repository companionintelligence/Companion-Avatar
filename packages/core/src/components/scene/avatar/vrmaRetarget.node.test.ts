import { closeSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VRMHumanBoneList, VRMHumanoid } from '@pixiv/three-vrm'
import type { VRMHumanBones } from '@pixiv/three-vrm'
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Matrix4,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from 'three'
import { describe, expect, it } from 'vitest'

import { NORMALIZED_PREFIX, bindTracksToRawBones, captureBoneRests, isRestIdentity } from './vrmaRetarget'

// three-vrm carries a normalized pose onto the real bones in VRMHumanoid.update(). The app drives the real
// bones with a mixer instead, so vrmaRetarget does that carrying when it builds a clip. These tests hold it
// to the library: every VRM that ships is read from its file, built into a real VRMHumanoid, and the library's
// own update() is the oracle for what each bone has to end up at.
const AVATARS = fileURLToPath(new URL('../../../../../../assets/avatars/', import.meta.url))

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
  extensions?: {
    VRM?: { humanoid?: { humanBones?: Array<{ bone: string; node?: number }> } }
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

// VRM 0.x names two thumb bones differently from VRM 1.0, and three-vrm renames them as it loads
const THUMBS: Record<string, string> = {
  leftThumbProximal: 'leftThumbMetacarpal',
  leftThumbIntermediate: 'leftThumbProximal',
  rightThumbProximal: 'rightThumbMetacarpal',
  rightThumbIntermediate: 'rightThumbProximal'
}

/**
 * A VRM as the app holds it once it has loaded: the scene, and a real VRMHumanoid built over its bones before
 * anything has turned the scene. Names are sanitized as GLTFLoader does, so tracks can be bound by name.
 */
const loadVrm = (file: string) => {
  const gltf = readGltfJson(file)
  const nodes = (gltf.nodes ?? []).map((definition) => {
    const node = new Bone()
    node.name = PropertyBinding.sanitizeNodeName(definition.name ?? '')
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
  const scene = new Object3D()
  for (const index of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) scene.add(nodes[index])
  scene.updateMatrixWorld(true)

  const vrm0 = Boolean(gltf.extensions?.VRM)
  const humanBones: Record<string, { node: Object3D }> = {}
  for (const entry of gltf.extensions?.VRM?.humanoid?.humanBones ?? []) {
    if (entry.node == null || entry.node < 0) continue
    humanBones[THUMBS[entry.bone] ?? entry.bone] = { node: nodes[entry.node] }
  }
  for (const [bone, entry] of Object.entries(gltf.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {})) {
    humanBones[bone] = { node: nodes[entry.node] }
  }
  const humanoid = new VRMHumanoid(humanBones as unknown as VRMHumanBones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  return { scene, humanoid, vrm0 }
}

// A small deterministic generator, so a failure repeats
const generator = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const randomRotation = (random: () => number, maxAngle = 1.4): Quaternion => {
  const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0)
  return new Quaternion().setFromAxisAngle(axis.normalize(), random() * maxAngle)
}

/** The largest component difference between two rotations, which are the same rotation when q = -q. */
const difference = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const sign = dot < 0 ? -1 : 1
  return Math.max(...[0, 1, 2, 3].map((i) => Math.abs(a[i] - sign * b[i])))
}

const files = (readdirSync(AVATARS, { recursive: true }) as string[]).filter((file) => /\.vrm$/i.test(file)).sort()

const boneNodes = (humanoid: VRMHumanoid) =>
  VRMHumanBoneList.flatMap((name) => {
    const raw = humanoid.getRawBoneNode(name)
    const normalized = humanoid.getNormalizedBoneNode(name)
    return raw && normalized ? [{ name, raw, normalized }] : []
  })

const trackFor = (nodeName: string, property: string, times: number[], values: ArrayLike<number>) =>
  new QuaternionKeyframeTrack(`${NORMALIZED_PREFIX}${nodeName}.${property}`, times, Array.from(values))

describe('vrmaRetarget: against three-vrm, for every VRM that ships', () => {
  it('has avatars to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(11)
  })

  it.each(files)('%s: carries a normalized pose onto the real bones as the humanoid update does', (file) => {
    const { scene, humanoid, vrm0 } = loadVrm(`${AVATARS}${file}`)
    // The scene is turned after the humanoid has captured its rests (VRMUtils.rotateVRM0 does it for a
    // VRM 0.x), and the app moves it too: none of that is part of a bone's frame
    scene.rotation.y = vrm0 ? Math.PI : 0.6
    scene.position.set(0.3, 0, -0.2)
    scene.updateMatrixWorld(true)

    const nodes = boneNodes(humanoid)
    expect(nodes.length).toBeGreaterThanOrEqual(40)
    const random = generator(file.length * 7919)
    const poses = nodes.map(({ name, normalized }) => {
      const q = randomRotation(random)
      normalized.quaternion.copy(q)
      return { name, q }
    })
    humanoid.update()
    const expected = new Map(nodes.map(({ name, raw }) => [raw.name, { name, q: raw.quaternion.toArray() }]))
    expect(expected.size, 'two humanoid bones share a node name').toBe(nodes.length)

    const rests = captureBoneRests({ scene, humanoid })
    const tracks = poses.map(({ name, q }) =>
      trackFor(humanoid.getRawBoneNode(name)!.name, 'quaternion', [0], q.toArray())
    )
    const bound = bindTracksToRawBones(tracks, rests)

    expect(bound).toHaveLength(tracks.length)
    for (const track of bound) {
      const [nodeName, property] = track.name.split('.')
      expect(property).toBe('quaternion')
      const want = expected.get(nodeName)
      expect(want, `${nodeName} is a humanoid bone`).toBeDefined()
      expect(difference(track.values, want!.q), `${want!.name} (${nodeName})`).toBeLessThan(1e-5)
    }
  })

  it.each(files)('%s: a clip at rest leaves every bone at its own rest', (file) => {
    const { scene, humanoid } = loadVrm(`${AVATARS}${file}`)
    const rests = captureBoneRests({ scene, humanoid })
    const nodes = boneNodes(humanoid)
    const bound = bindTracksToRawBones(
      nodes.map(({ raw }) => trackFor(raw.name, 'quaternion', [0], [0, 0, 0, 1])),
      rests
    )
    const restOf = new Map(nodes.map(({ name, raw }) => [raw.name, humanoid.rawRestPose[name]!.rotation!]))
    for (const track of bound) {
      const nodeName = track.name.split('.')[0]
      expect(difference(track.values, restOf.get(nodeName)!), nodeName).toBeLessThan(1e-5)
    }
  })

  it.each(files)('%s: a bone with no rest to carry keeps its values exactly', (file) => {
    const { scene, humanoid } = loadVrm(`${AVATARS}${file}`)
    const rests = captureBoneRests({ scene, humanoid })
    const random = generator(file.length * 104729)
    for (const { raw } of boneNodes(humanoid)) {
      const track = trackFor(raw.name, 'quaternion', [0, 1], [...randomRotation(random).toArray(), ...randomRotation(random).toArray()])
      const [bound] = bindTracksToRawBones([track], rests)
      expect(bound.name).toBe(`${raw.name}.quaternion`)
      if (isRestIdentity(rests.get(raw.name)!)) {
        expect(Array.from(bound.values)).toEqual(Array.from(track.values))
        expect(Array.from(bound.times)).toEqual(Array.from(track.times))
      }
    }
  })
})

describe('vrmaRetarget: a clip played by a mixer', () => {
  // Work Boy's chest and neck rest turned and Aria's arms hang in a frame turned 90 degrees: the two cases
  // the old binding got wrong. The library's path is the normalized skeleton under a mixer, then update().
  it.each(['vrm/workboy.vrm', 'humgen-aria-01.vrm'])('%s: moves the real bones as the library moves them', (file) => {
    const { scene, humanoid } = loadVrm(`${AVATARS}${file}`)
    const nodes = boneNodes(humanoid)
    const random = generator(31337)
    const times = [0, 0.5, 1, 1.5]
    const tracks = nodes.map(({ raw }) => {
      const values = times.flatMap(() => randomRotation(random, 1.1).toArray())
      return trackFor(raw.name, 'quaternion', times, values)
    })
    const clip = new AnimationClip('walk', 1.5, tracks)

    const library = new AnimationMixer(humanoid.normalizedHumanBonesRoot)
    library.clipAction(clip).play()
    const app = new AnimationMixer(scene)
    app.clipAction(new AnimationClip('walk', 1.5, bindTracksToRawBones(tracks, captureBoneRests({ scene, humanoid })))).play()

    for (const time of [0.1, 0.5, 0.77, 1.2, 1.5]) {
      library.setTime(time)
      humanoid.update()
      const expected = new Map(nodes.map(({ name, raw }) => [name, raw.quaternion.toArray()]))
      app.setTime(time)
      for (const { name, raw } of nodes) {
        expect(difference(raw.quaternion.toArray(), expected.get(name)!), `${name} at ${time} s`).toBeLessThan(1e-5)
      }
    }
  })
})

describe('vrmaRetarget: tracks that are not rotations of a bone', () => {
  const { scene, humanoid } = loadVrm(`${AVATARS}vrm/workboy.vrm`)
  const rests = captureBoneRests({ scene, humanoid })
  const hips = humanoid.getRawBoneNode('hips')!.name

  it('only renames a position track', () => {
    const track = new VectorKeyframeTrack(`${NORMALIZED_PREFIX}${hips}.position`, [0, 1], [0, 1, 0, 0, 1.1, 0])
    const [bound] = bindTracksToRawBones([track], rests)
    expect(bound).toBeInstanceOf(VectorKeyframeTrack)
    expect(bound.name).toBe(`${hips}.position`)
    expect(Array.from(bound.values)).toEqual(Array.from(track.values))
  })

  it('passes a track for anything else through as it is', () => {
    const track = new QuaternionKeyframeTrack('VRMLookAtQuaternionProxy.quaternion', [0], [0, 0, 0, 1])
    expect(bindTracksToRawBones([track], rests)[0]).toBe(track)
  })

  it('leaves the tracks it was given alone', () => {
    const track = trackFor(hips, 'quaternion', [0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5).toArray())
    const before = { name: track.name, values: Array.from(track.values) }
    const [bound] = bindTracksToRawBones([track], rests)
    expect(bound).not.toBe(track)
    expect(track.name).toBe(before.name)
    expect(Array.from(track.values)).toEqual(before.values)
  })

  it('keeps a track as it is for a bone it has no rest for', () => {
    const track = trackFor('NotABone', 'quaternion', [0], [0.1, 0.2, 0.3, 0.9273618495495703])
    const [bound] = bindTracksToRawBones([track], rests)
    expect(bound.name).toBe('NotABone.quaternion')
    expect(Array.from(bound.values)).toEqual(Array.from(track.values))
  })

  it('reads no rests for bones that do not hang from the scene', () => {
    expect(captureBoneRests({ scene: new Object3D(), humanoid }).size).toBe(0)
  })
})

describe('vrmaRetarget: the app uses it', () => {
  const source = readFileSync(fileURLToPath(new URL('./AvatarModel.tsx', import.meta.url)), 'utf8')

  it('builds every VRMA clip through it and no longer strips the prefix itself', () => {
    expect(source).toMatch(/captureBoneRests\(vrm\)/)
    expect(source).toMatch(/bindTracksToRawBones\(clip\.tracks, boneRests\)/)
    expect(source).not.toMatch(/replace\(\/\^Normalized_\//)
  })
})
