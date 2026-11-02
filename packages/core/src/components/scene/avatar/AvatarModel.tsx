import { useSimpleStore } from '@hexafield/simple-store/react'
import { VRM, VRMCore, VRMLoaderPlugin, VRMUtils, MToonMaterialLoaderPlugin } from '@pixiv/three-vrm'
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes'
import { createVRMAnimationClip, VRMAnimation, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import type { GLTFParser } from 'three/examples/jsm/Addons.js'


import { AvatarOptions } from './AvatarOptions'
import { AvatarState } from './avatarState'
import { ConversationStatusState } from '../../../services/conversation/conversationStatus'
import { Vector3 } from 'three'
import {
  VRMA_CLIPS,
  GLB_ALL_CLIPS,
  getAvatarCatalog,
  getIdleClip,
  getGreetClip,
  getRandomClip,
  updateAnimationDurations
} from '../../../services/animation/config/animationClips'
import type { useAnimationService } from '../../../services/animation/useAnimationService'
import type { useEmoteService } from '../../../services/emote/useEmoteService'
import type { useVisemeService } from '../../../services/visemes/useVisemeService'
import type { useTTSService } from '../../../services/tts/ttsService'
import type { AnimationClip } from '../../../services/animation/animationTypes'
import { talkAnalyser } from '../../../services/talk/talkService'
import { AudioLipSync } from '../../../services/visemes/audioLipSync'
import { PhonemeTimingEngine, blendAudioAndText } from '../../../services/visemes/phonemeTiming'
import { ARKIT_LIP_SYNC_TARGETS, type VisemeWeights } from '../../../services/visemes/visemeTable'
import { AvatarDynamicsEngine } from '../../../services/emote/avatarDynamics'
import { SpringChain, detectSpringChains, type SpringBoneLike } from '@ci-avatar/engine'

/** Scratch vector for the spring solver's world<->local conversions; avoids per-frame allocation. */
const tmpVec3 = new THREE.Vector3()
import {
  DEFAULT_FACE_LAYERS,
  FACE_LAYERS,
  FaceCompositor,
  MOUTH_REGIONS,
  VRM_HUMAN_BONES,
  resolveBones,
  type FaceRig,
  type NodeLike
} from '@ci-avatar/engine'
import {
  getFaceOverride,
  setActiveFaceCompositor,
  setActiveFacialRig,
  setFaceSpeechDebug
} from '../../../services/face/faceCompositorRegistry'
import { createFaceRig, NULL_FACE_RIG } from '../../../services/face/faceRigFactory'
import { translateEmoteTargets } from '../../../services/face/emoteVocabulary'
import { ScheduledSpeechSource, selectSpeechSource } from '../../../services/face/speechSource'
import { mark as markLatency } from '../../../services/telemetry/latency'
import { setVoicePosition } from '../../../services/tts/audioGraph'

// Default to a fully-rigged RPM pro model (visemes + ARKit morphs) so the default
// companion lip-syncs and shows facial emotion. 'Liam' (LiamCES2) is a bare mesh with
// no morph targets — body-animation only — so it's no longer the default.
const AVATAR_MODEL = AvatarOptions.Greg
const avatarOwners = new WeakMap<THREE.Object3D, symbol>()

/**
 * Grace period after an utterance's nominal end during which a text-driven
 * (graph-less) speech source still counts as speaking. Covers the slack between
 * an estimated duration and the real one without letting a stale text flag hold
 * the mouth open forever.
 */
const SPEECH_TAIL_SECONDS = 0.25

/**
 * Keep an array returned by a fixed hook map stable when its members are stable.
 *
 * `useLoader` is intentionally called once per catalog item below, so the outer
 * array is recreated by `.map()` on every render. Passing that fresh array to
 * drei's `useAnimations` makes drei tear down every action and recreate the
 * mixer whenever an unrelated avatar state field changes. That reset is visible
 * as a snap back to idle during speech/emote updates.
 */
const useStableArray = <T,>(items: T[]): T[] => {
  const stableRef = useRef(items)
  if (
    stableRef.current.length !== items.length ||
    items.some((item, index) => stableRef.current[index] !== item)
  ) {
    stableRef.current = items
  }
  return stableRef.current
}


interface AvatarModelProps {
  visemeService?: ReturnType<typeof useVisemeService>
  emoteService?: ReturnType<typeof useEmoteService>
  animationService?: ReturnType<typeof useAnimationService>
  ttsService?: ReturnType<typeof useTTSService>
  onHeadLocated?: (target: [number, number, number], position: [number, number, number]) => void
  /** Metres to park the camera in front of the located head bone. Default 0.5 — the bust
   *  framing the studio viewport has always used. Environments that need the room in shot
   *  pass a wider value; see the comment at the call site. */
  cameraDistance?: number
  /** Metres to lower the look-at below the head bone. Default 0 — dead on the eyeline,
   *  which is right for a bust. A wider shot uses it to pitch the camera down a little,
   *  which lifts the room UP the frame and cuts the dead wall above it. */
  cameraTargetDrop?: number
  /**
   * Position the voice at the avatar's head via an HRTF panner. Off by default:
   * correct in XR and in a room, wrong for a bust on a flat viewport.
   */
  spatialAudio?: boolean
}

// Custom hook to load external animation files, including VRMA animations.
// Exported alongside AvatarModel because it is the loader for exactly that component;
// the app harness also imports it directly.
// eslint-disable-next-line react-refresh/only-export-components
export const useExternalAnimations = (avatarRef: React.RefObject<THREE.Object3D | null>, vrm?: VRMCore) => {
  // Load BOTH catalogs every render (stable hook order); collect only the set that
  // matches the active avatar's skeleton below. VRMA → VRM avatars, GLB → GLB avatars.
  // GLB_ALL_CLIPS includes the feminine (F_*) set so female avatars can use it.
  const vrmaClips = useMemo(() => Object.values(VRMA_CLIPS), [])
  const gltfClips = useMemo(() => Object.values(GLB_ALL_CLIPS), [])

  // These two `.map`s call hooks in a callback, which rules-of-hooks flags. It is safe
  // here — and load-bearing: VRMA_CLIPS and GLB_ALL_CLIPS are module-level literals with
  // a fixed key set (updateAnimationDurations only rewrites `duration` on existing
  // entries), so both arrays have the same length on every render and hook order is
  // stable. Loading each catalog unconditionally is what keeps it stable; making the
  // loads conditional on avatar type is what would actually break the rule.

  // Load VRMA animations
  const vrmaGLTFs = vrmaClips.map((clip) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length catalog, see above
    useLoader(GLTFLoader, clip.path, (loader) => {
      loader.register((parser: GLTFParser) => new VRMAnimationLoaderPlugin(parser))
    })
  )

  // Load GLTF/GLB animations
  // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length catalog, see above
  const gltfGLTFs = gltfClips.map((clip) => useGLTF(clip.path))

  // The hook maps above must stay unconditional, but their container arrays do
  // not need to change when the loaded resources do not. See useStableArray.
  const stableVrmaGLTFs = useStableArray(vrmaGLTFs)
  const stableGltfGLTFs = useStableArray(gltfGLTFs)

  // Collect all animations
  const allAnimations = useMemo(() => {
    const animations: THREE.AnimationClip[] = []

    if (vrm) {
      // Process VRMA
      stableVrmaGLTFs.forEach((gltf, index) => {
        const vrmAnimation: VRMAnimation | undefined = (gltf as { userData?: { vrmAnimations?: VRMAnimation[] } })
          .userData?.vrmAnimations?.[0]

        if (vrmAnimation && vrm) {
          const clip = createVRMAnimationClip(vrmAnimation, vrm)
          clip.name = vrmaClips[index].name
          // Remove "Normalized_" prefix from track names
          clip.tracks = clip.tracks.filter((track) => {
            // Remove "Normalized_" prefix from track names
            if (track.name.startsWith('Normalized_')) {
              track.name = track.name.replace(/^Normalized_/, '')

            }
            const lower = track.name.toLowerCase()
            if (lower.includes('neck') || lower.includes('head')) {
              return false
            }
            return true
          })

          animations.push(clip)
        }
      })
    } else {
      // Process GLTF/GLB
      stableGltfGLTFs.forEach((gltf, index) => {
        if (gltf.animations && gltf.animations.length > 0) {
          gltf.animations.forEach((animation) => {
            animation.name = gltfClips[index].name
            // RPM-library clips (F_*/M_*) are authored against RPM's stock rest pose,
            // whose head orientation differs slightly from the CI models — drop their
            // head/neck tracks (as the VRMA path does) and let the gaze service own
            // the head.
            if (/^[FM]_/.test(animation.name)) {
              animation.tracks = animation.tracks.filter((t) => !/head|neck/i.test(t.name))
            }
            animations.push(animation)
          })
        }
      })
    }

    // Update animation clip durations from the actual loaded animations
    updateAnimationDurations(animations)

    return animations
  }, [stableVrmaGLTFs, stableGltfGLTFs, vrm, vrmaClips, gltfClips])

  // Hook into R3F's animation system

  const { actions, mixer } = useAnimations(allAnimations, avatarRef)
  return { actions, mixer, animations: allAnimations }
}

const AvatarModelComponent = ({
  visemeService,
  emoteService,
  animationService,
  ttsService,
  onHeadLocated,
  cameraDistance = 0.5,
  cameraTargetDrop = 0,
  spatialAudio = false
}: AvatarModelProps) => {
  const { camera: viewerCamera, gl: renderer } = useThree()

  const [state] = useSimpleStore(AvatarState)
  const [{ status: conversationStatus }] = useSimpleStore(ConversationStatusState)
  const morphTargetsRef = useRef<THREE.Mesh[]>([])
  const bonesRef = useRef<Record<string, THREE.Bone>>({})
  // Secondary motion for rigs that have none of their own (i.e. everything that is not VRM).
  const springChainsRef = useRef<SpringChain[]>([])
  const avatarOwnerTokenRef = useRef<symbol | undefined>(undefined)
  if (!avatarOwnerTokenRef.current) avatarOwnerTokenRef.current = Symbol('AvatarModel')
  const ttsServiceRef = useRef(ttsService)
  ttsServiceRef.current = ttsService
  const previousBoneOffsetsRef = useRef<Record<string, { x: number; y: number; z: number }>>({})
  const sceneBaseRotationRef = useRef<THREE.Euler | null>(null)
  const sceneBasePositionYRef = useRef<number | null>(null)
  const startupPlayedRef = useRef<boolean>(false)
  const [isAvatarVisible, setIsAvatarVisible] = useState<boolean>(false)

  // Real-time Audio Lip Sync and Autonomous Dynamics engines
  const lipSyncRef = useRef<AudioLipSync | null>(null)
  const phonemeEngineRef = useRef<PhonemeTimingEngine>(new PhonemeTimingEngine())
  const dynamicsEngineRef = useRef<AvatarDynamicsEngine>(new AvatarDynamicsEngine())
  // The single owner of every facial weight this avatar shows. Created once per
  // mounted avatar; the rig it writes through is rebound when the model changes.
  const compositorRef = useRef<FaceCompositor>(new FaceCompositor(DEFAULT_FACE_LAYERS))
  const faceRigRef = useRef<FaceRig>(NULL_FACE_RIG)
  const warnedUnmappedRef = useRef(false)
  const frameCounterRef = useRef(0)
  const scheduledSpeechRef = useRef(new ScheduledSpeechSource())
  const prevWeightsRef = useRef<VisemeWeights | null>(null)
  const lastTextRef = useRef<string>('')

  const { selectedModel, visemesEnabled, emotesEnabled, animationsEnabled, dynamicsEnabled } = state

  /**
   * Is the live renderer node-based?
   *
   * MToonNodeMaterial is a NODE material: its shader is assembled by the node
   * system and it can only be compiled by a WebGPURenderer. Selecting it was
   * gated on `webGPUEnabled`, which reports whether the DEVICE supports WebGPU
   * and whether the user left the toggle on — not on what is actually rendering.
   * Scene3D has never constructed a WebGPURenderer (the Canvas is r3f's default
   * WebGL one), so on any machine where WebGPU is merely *available* every VRM
   * loaded a node material into the WebGL program path and threw
   * `resolveIncludes: Cannot read properties of undefined (reading 'replace')`
   * on every frame — measured at 980 errors within nine seconds, with nothing
   * on screen.
   *
   * Asking the renderer is the only question with a correct answer. When the
   * WebGPU path is genuinely wired up, this starts returning true on its own.
   */
  const rendererIsNodeBased = Boolean(
    (renderer as unknown as { isWebGPURenderer?: boolean }).isWebGPURenderer
  )

  const gltf = useLoader(GLTFLoader, selectedModel, (loader) => {
    loader.register((parser: GLTFParser) => {
      if (!rendererIsNodeBased) return new VRMLoaderPlugin(parser)
      const mtoonMaterialPlugin = new MToonMaterialLoaderPlugin(parser, {
        materialType: MToonNodeMaterial
      })
      return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin })
    })
  })

  const isVRM = selectedModel.toLowerCase().endsWith('.vrm')
  const vrm = isVRM ? (gltf.userData.vrm as VRM) : undefined

  const isFeminine = /female|woman/i.test(selectedModel)
  const avatarCatalog = getAvatarCatalog(isVRM, isFeminine)
  const idleClip = getIdleClip(avatarCatalog)
  const greetClip = getGreetClip(avatarCatalog)
  const avatarScene = isVRM ? vrm?.scene : gltf.scene
  const avatarRef = useRef<THREE.Object3D>(null)

  // R3F subscriptions can briefly outlive a suspended/retried avatar render.
  // Mark the committed scene owner so an obsolete callback cannot mutate the
  // current avatar or win the audio-lip-sync write for a frame.
  useLayoutEffect(() => {
    const object = avatarRef.current
    const owner = avatarOwnerTokenRef.current
    if (!object || !owner) return
    avatarOwners.set(object, owner)
    return () => {
      if (avatarOwners.get(object) === owner) avatarOwners.delete(object)
    }
  }, [avatarScene])

  // Position camera on head
  useEffect(() => {
    if (!avatarRef.current || !viewerCamera) return
    let head: THREE.Object3D | null = null

    if (isVRM && vrm?.humanoid) {
      const normalizedBone = vrm.humanoid.getRawBone('head')
      head = normalizedBone?.node ?? null
      VRMUtils.rotateVRM0(vrm)
    } else {
      avatarRef.current?.traverse((child) => {
        if (
          !head &&
          (child as THREE.Bone).isBone &&
          typeof child.name === 'string' &&
          child.name.toLowerCase().includes('head')
        ) {
          head = child
        }
      })
    }

    if (head && avatarRef.current) {
      const headWorldPos = new Vector3()
      head.getWorldPosition(headWorldPos)
      const avatarWorldQuat = new THREE.Quaternion()
      avatarRef.current.getWorldQuaternion(avatarWorldQuat)
      const avatarForward = new Vector3(0, 0, isVRM ? -1 : 1).applyQuaternion(avatarWorldQuat).normalize()

      const cameraTarget = headWorldPos
        .clone()
        .add(new Vector3(0, -cameraTargetDrop, 0))
        .toArray() as [number, number, number]

      const cameraPos = headWorldPos.clone().add(avatarForward.multiplyScalar(cameraDistance))
      const cameraPosition = cameraPos.toArray() as [number, number, number]

      onHeadLocated?.(cameraTarget, cameraPosition)
      // Place the voice at the head. In XR a voice from the middle of your own
      // skull breaks presence more completely than any visual flaw; on a flat
      // desktop bust it is off, because there is no room for it to be in.
      if (spatialAudio) setVoicePosition(headWorldPos.toArray() as [number, number, number])
      else setVoicePosition(null)
      if (isVRM) avatarRef.current.position.x += 0.2
    }
  }, [avatarRef.current])

  // Load external animations from animationClips.ts
  const { actions, mixer } = useExternalAnimations(avatarRef, vrm)

  // Setup animation service with R3F
  useEffect(() => {
    if (!avatarScene || !animationService || !actions || !mixer || !animationsEnabled) return

    const validActions: Record<string, THREE.AnimationAction> = {}
    Object.entries(actions).forEach(([name, action]) => {
      if (action) {
        validActions[name] = action
      }
    })

    animationService.actions.setup(validActions, mixer, avatarRef.current || undefined, idleClip, avatarCatalog)

    let raf = 0
    const startedAt = performance.now()
    const REVEAL_TIMEOUT_MS = 6000

    const revealWhenAnimating = () => {
      const driving = Object.values(validActions).some((a) => a.isRunning() && a.time > 0)
      if (driving || performance.now() - startedAt > REVEAL_TIMEOUT_MS) {
        setIsAvatarVisible(true)
        return
      }
      raf = requestAnimationFrame(revealWhenAnimating)
    }
    raf = requestAnimationFrame(revealWhenAnimating)

    return () => cancelAnimationFrame(raf)
  }, [animationsEnabled, animationService, actions, mixer])

  // Discover all morph targets (ARKit 52, Oculus Visemes, Emotes)
  useEffect(() => {
    if (!avatarScene) return

    const morphTargets: THREE.Mesh[] = []
    const visemeDict: Record<string, number[]> = {}
    const emoteDict: Record<string, number[]> = {}
    const bones: Record<string, THREE.Bone> = {}

    avatarScene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.morphTargetDictionary && child.morphTargetInfluences) {
        morphTargets.push(child)
        Object.entries(child.morphTargetDictionary).forEach(([name, index]) => {
          if (name.startsWith('viseme_') || (ARKIT_LIP_SYNC_TARGETS as readonly string[]).includes(name) || name === 'jawOpen' || name === 'mouthOpen') {
            if (!visemeDict[name]) visemeDict[name] = []
            visemeDict[name].push(index)
          }

          if (
            name.includes('eye') ||
            name.includes('brow') ||
            name.includes('mouth') ||
            name.includes('nose') ||
            name.includes('cheek') ||
            name.includes('jaw') ||
            name.includes('Blink')
          ) {
            if (!emoteDict[name]) emoteDict[name] = []
            emoteDict[name].push(index)
          }
        })
      }

      if (child instanceof THREE.Bone) {
        bones[child.name] = child
      }
    })

    // Ground the figure. A shadow-casting key light has been configured all
    // along, but no mesh ever opted in, so nothing cast and nothing received —
    // the avatar read as a cut-out floating in front of the background rather
    // than as something standing in the scene.
    //
    // Gated on the renderer ACTUALLY having shadows enabled. Opting in
    // unconditionally makes every frame render a shadow map, and on a software
    // rasteriser (SwiftShader, which the capture suite and any GPU-blocked
    // browser use) that is not "slower" — measured, it froze the render loop at
    // five frames and never recovered. `quality.useShadows` is already false on
    // those paths; this just respects it.
    if (renderer.shadowMap?.enabled) {
      avatarScene.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          mesh.receiveShadow = true
        }
      })
    }

    morphTargetsRef.current = morphTargets

    // Bind the face rig for THIS avatar. Chosen from what the head actually
    // exposes rather than from the file extension — a VRM with an empty
    // expression manager still has ordinary morph targets worth driving.
    const { rig, kind, facial } = createFaceRig(morphTargets, vrm, avatarScene)
    faceRigRef.current = rig
    setActiveFacialRig(facial)
    // A new head means new channels: clear the compositor's write cache so the
    // first frame on the new rig is a full write, not a diff against the old one.
    compositorRef.current.reset()
    setActiveFaceCompositor(compositorRef.current)
    if (import.meta.env?.DEV) {
      console.debug(
        `[avatar] face rig: ${kind} · tier ${facial.tier} (${facial.names.length} channels, ${morphTargets.length} morph meshes)`
      )
    }
    const compositorForThisAvatar = compositorRef.current

    // Resolve the humanoid skeleton generically. This replaced a hand-written
    // alias list that only knew the rigs in this repo's own hardcoded catalog,
    // which is why "load any avatar" was never actually true. resolveBones()
    // matches RPM, Mixamo, VRM humanoid, VRoid and underscore-suffix naming, and
    // refuses to bind `head` to an RPM "Headphones" prop.
    const nodes: THREE.Object3D[] = []
    avatarScene.traverse((child) => nodes.push(child))
    const resolved = resolveBones(nodes as unknown as NodeLike[], {
      // A VRM declares its own humanoid mapping; that beats guessing from names.
      humanoid: vrm?.humanoid
        ? (slot) => {
            const vrmName = VRM_HUMAN_BONES[slot]
            return vrmName ? (vrm.humanoid.getRawBoneNode(vrmName as never) as NodeLike | null) : null
          }
        : undefined
    })
    for (const [slot, node] of Object.entries(resolved)) {
      if (node) bones[slot] = node as unknown as THREE.Bone
    }
    // The dynamics engine addresses bones by their canonical capitalised names.
    for (const [slot, Canonical] of Object.entries({
      head: 'Head', neck: 'Neck', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2',
      leftShoulder: 'LeftShoulder', rightShoulder: 'RightShoulder',
      leftArm: 'LeftArm', rightArm: 'RightArm',
      leftForeArm: 'LeftForeArm', rightForeArm: 'RightForeArm',
      leftHand: 'LeftHand', rightHand: 'RightHand'
    })) {
      if (bones[slot] && !bones[Canonical]) bones[Canonical] = bones[slot]
    }

    bonesRef.current = bones

    // Secondary motion for non-VRM rigs that carry dangling bones.
    //
    // Inert on the shipped roster and known to be: the GLB avatars have 67 bones
    // and zero hair/cloth joints (their hair is a static mesh), and every rig that
    // DOES have dangling bones is a VRM, handled by its own spring-bone manager.
    // This is here for Phase 3's custom-avatar URLs — VRoid/MMD/Mixamo rigs with
    // hair joints and no solver of their own. Costs nothing when no chain is found.
    //
    // Bones an animation clip drives are excluded: the solver writes world
    // positions after the mixer has posed the skeleton, so simulating a bone the
    // clip owns makes that limb jitter.
    springChainsRef.current = []
    if (!isVRM && avatarRef.current) {
      const animatedBoneNames = new Set<string>()
      for (const clip of Object.values(actions ?? {})) {
        for (const track of clip?.getClip().tracks ?? []) {
          const dot = track.name.indexOf('.')
          animatedBoneNames.add(dot > 0 ? track.name.slice(0, dot) : track.name)
        }
      }
      const adapt = (o: THREE.Object3D): SpringBoneLike => ({
        name: o.name,
        getWorldPosition: (t: { x: number; y: number; z: number }) => {
          o.getWorldPosition(tmpVec3)
          t.x = tmpVec3.x
          t.y = tmpVec3.y
          t.z = tmpVec3.z
          return t
        },
        setWorldPosition: (v: { x: number; y: number; z: number }) => {
          tmpVec3.set(v.x, v.y, v.z)
          // The solver speaks world space; a bone's transform is local to its parent.
          if (o.parent) o.parent.worldToLocal(tmpVec3)
          o.position.copy(tmpVec3)
        },
        get children() {
          return o.children.map(adapt)
        }
      })
      const chains = detectSpringChains(adapt(avatarRef.current), animatedBoneNames)
      springChainsRef.current = chains.map((c) => new SpringChain(c))
      if (chains.length > 0) {
        console.debug(`[avatar] secondary motion: ${chains.length} spring chain(s)`)
      }
    }
    previousBoneOffsetsRef.current = {}
    sceneBaseRotationRef.current = avatarScene.rotation.clone()
    sceneBasePositionYRef.current = avatarScene.position.y
    for (const bone of Object.values(bones)) {
      if (!bone.userData.initialRotation) {
        bone.userData.initialRotation = bone.rotation.clone()
      }
    }

    if (isVRM && vrm) {
      if (visemesEnabled && visemeService) {
        visemeService.actions.setupForVRM(vrm)
      }
      if (emotesEnabled && emoteService) {
        emoteService.actions.setupForVRM(vrm)
      }
    } else {
      if (visemesEnabled && visemeService && morphTargets.length > 0) {
        visemeService.actions.setupForMorphTargets(
          morphTargets as unknown as { morphTargetInfluences: number[] }[],
          visemeDict
        )
      }
      if (emotesEnabled && emoteService && morphTargets.length > 0) {
        emoteService.actions.setupForMorphTargets(
          morphTargets as unknown as { morphTargetInfluences: number[] }[],
          emoteDict
        )
      }
    }

    if (emotesEnabled && emoteService) {
      emoteService.actions.setAvatarReferences({
        bones,
        node: avatarRef.current ?? undefined,
        camera: viewerCamera
      })
    }

    return () => {
      // Zero the face on the way out. Without this an unmounted avatar's last
      // expression is still sitting in the morph influences when the same cached
      // glTF scene is mounted again — drei caches by URL — and the new avatar
      // appears already mid-smile.
      compositorForThisAvatar.reset(faceRigRef.current)
      faceRigRef.current = NULL_FACE_RIG
      setActiveFaceCompositor(null)
      setActiveFacialRig(null)
    }
  }, [avatarScene, visemesEnabled, emotesEnabled, visemeService, emoteService, isVRM, vrm, viewerCamera, renderer, actions])

  // Startup animation sequence
  useEffect(() => {
    if (!animationsEnabled || !emotesEnabled) return
    if (!avatarScene || !actions || !mixer) return
    if (!emoteService || !animationService) return
    if (startupPlayedRef.current) return
    if (!isAvatarVisible) return

    const startupTimer = setTimeout(() => {
      emoteService.actions.performAction({ emotion: 'happy', relaxTime: greetClip.duration })

      animationService.actions.performAction({
        clip: greetClip,
        immediate: true,
        loopCount: 1,
        blendTime: 300
      })

      animationService.actions.performAction({
        clip: idleClip,
        loopCount: Infinity,
        blendTime: 2000
      })
      startupPlayedRef.current = true
    }, 500)

    return () => clearTimeout(startupTimer)
  }, [animationsEnabled, animationService, actions, mixer, emoteService, isAvatarVisible, greetClip, idleClip])

  // 60 FPS Render & Animation Loop: Lip-sync + Autonomous Vitality + Animations
  // This cleanup must run before drei's internal mixer subscriber. The mixer
  // writes authored bone tracks during its own useFrame callback; removing last
  // frame's additive posture after that write subtracts from the authored pose
  // and makes gestures jump. A negative-priority subscriber gives the next
  // mixer tick a clean authored base, while the main subscriber below applies
  // this frame's procedural offsets after the mixer.
  useFrame(() => {
    const object = avatarRef.current
    if (!object || avatarOwners.get(object) !== avatarOwnerTokenRef.current) return

    for (const [name, offset] of Object.entries(previousBoneOffsetsRef.current)) {
      const bone =
        bonesRef.current[name] ??
        bonesRef.current[name.toLowerCase()] ??
        Object.entries(bonesRef.current).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
      if (!bone) continue
      bone.rotation.x -= offset.x
      bone.rotation.y -= offset.y
      bone.rotation.z -= offset.z
    }
    previousBoneOffsetsRef.current = {}
  }, -1)

  useFrame((threeState, delta) => {
    const object = avatarRef.current
    if (!object || avatarOwners.get(object) !== avatarOwnerTokenRef.current) return
    if (typeof document !== 'undefined' && document.hidden) return

    // Open the frame. Producers publish below; the compositor writes once, at
    // step 7. Note there is deliberately no `vrm.expressionManager.update()`
    // here any more — the VRM face rig flushes on commit, and flushing a
    // half-built frame here is what let a zeroed expression win the write.
    const compositor = compositorRef.current
    compositor.begin()

    // 1. Audio-Driven Lip Sync: the TTS voice, or a live talk reply (talkAnalyser is null otherwise)
    const liveTtsService = ttsServiceRef.current
    const analyser = liveTtsService?.actions.getAnalyser() ?? talkAnalyser()
    if (analyser) {
      if (!lipSyncRef.current || (lipSyncRef.current as unknown as { analyser: AnalyserNode }).analyser !== analyser) {
        lipSyncRef.current = new AudioLipSync(analyser)
      }
    } else if (lipSyncRef.current) {
      // The audio graph went away — playback finished, or a barge-in tore it down.
      // Keeping the old AudioLipSync alive means `update()` goes on returning its
      // last smoothed reading against a dead AnalyserNode, so `isSpeaking` stays
      // true and the jaw hangs open long after the sound stopped. Drop it.
      lipSyncRef.current = null
    }

    const audioState = lipSyncRef.current?.update() ?? null

    // 2. Phoneme / Text Viseme Schedule
    const speechInfo = liveTtsService?.actions.getCurrentSpeechInfo()
    const currentText = speechInfo?.text ?? ''
    if (currentText !== lastTextRef.current) {
      lastTextRef.current = currentText
      if (currentText.length > 0) {
        phonemeEngineRef.current.setUtterance(currentText, speechInfo?.duration)
      } else {
        phonemeEngineRef.current.clear()
      }
    }

    let timedViseme: VisemeWeights | null = null
    if (speechInfo && currentText.length > 0 && speechInfo.startTime > 0) {
      const ctx = speechInfo.audioContext
      const currentTime = ctx ? ctx.currentTime : performance.now() / 1000
      const playbackTime = currentTime - speechInfo.startTime
      timedViseme = phonemeEngineRef.current.getActiveViseme(playbackTime)
    }

    // 3. Blend audio + text into mouth weights. NOTHING is written to the rig
    //    here: every producer below publishes to the compositor, which arbitrates
    //    once and performs the only write of the frame.
    const acousticWeights =
      audioState || timedViseme
        ? blendAudioAndText(
            audioState || { energy: 0, lowBand: 0, midBand: 0, highBand: 0, isSpeaking: false },
            timedViseme,
            prevWeightsRef.current,
            0.35
          )
        : null
    if (acousticWeights) prevWeightsRef.current = acousticWeights

    // 4. Autonomous facial vitality (blinks, saccades, gaze, acoustic brows).
    //
    // "Is it speaking" is answered by the audio graph whenever there IS one.
    // The reported text is only a fallback for engines that expose no graph at
    // all (browser `speechSynthesis`), and even then it is bounded by the
    // utterance's own duration — the TTS service does not always clear the text
    // when a single utterance ends, and trusting it unbounded is what left the
    // mouth open indefinitely after the last word.
    const spokenElapsed =
      speechInfo && speechInfo.startTime > 0
        ? (speechInfo.audioContext ? speechInfo.audioContext.currentTime : performance.now() / 1000) -
          speechInfo.startTime
        : Number.POSITIVE_INFINITY
    const textSpeaking =
      !analyser &&
      Boolean(speechInfo?.text) &&
      spokenElapsed < (speechInfo?.duration ?? 0) + SPEECH_TAIL_SECONDS
    const isSpeaking = Boolean(audioState?.isSpeaking) || textSpeaking
    const dynamics = dynamicsEngineRef.current.update({
      elapsedTime: threeState.clock.getElapsedTime(),
      delta,
      pointerX: threeState.pointer.x,
      pointerY: threeState.pointer.y,
      audioState,
      // The real conversational state, not a two-value stand-in. This is what
      // makes the avatar lean in while listening, avert its gaze while thinking,
      // and blink faster under cognitive load — all of which the dynamics engine
      // already implemented and none of which could ever fire before.
      conversationState: isSpeaking ? 'speaking' : conversationStatus
    })

    // 5. Advance the services. These now only update their own internal state —
    //    the applyToRig / applyToVRM / applyToMorphTargets calls that used to
    //    follow are gone, because they are what made three engines fight over the
    //    same morph targets every frame.
    if (animationsEnabled && animationService) {
      animationService.actions.update(delta)
    }
    if (visemesEnabled && visemeService) {
      visemeService.actions.update(delta)
    }
    if (emotesEnabled && emoteService) {
      emoteService.actions.update(delta)
    }

    // 6. Publish contributions, lowest layer first.
    if (emotesEnabled && emoteService) {
      const { weights, unmapped } = translateEmoteTargets(
        emoteService.state.emote.targets as unknown as Record<string, unknown>
      )
      compositor.setAll(FACE_LAYERS.EMOTION, weights)
      if (unmapped.length > 0 && !warnedUnmappedRef.current) {
        warnedUnmappedRef.current = true
        console.warn('[avatar] emote targets with no canonical mapping:', unmapped.join(', '))
      }
    }

    // Rebuild the coarticulated schedule when the engine reports new timings.
    // Browser boundary events land mid-utterance, so this grows word by word.
    const scheduleLoaded = scheduledSpeechRef.current.update(liveTtsService?.actions.getSpeechTimings())

    const speech = selectSpeechSource({
      scheduled: {
        source: scheduledSpeechRef.current,
        playbackSeconds: Number.isFinite(spokenElapsed) ? spokenElapsed : 0,
        loaded: scheduleLoaded
      },
      visemeState: visemesEnabled ? visemeService?.state.viseme : undefined,
      acoustic: acousticWeights,
      isSpeaking
    })
    compositor.setAll(FACE_LAYERS.SPEECH, speech.contributions)
    if (speech.claimsMouth) {
      compositor.claim(FACE_LAYERS.SPEECH, MOUTH_REGIONS)
      // The end of the chain: the first frame on which the mouth actually moves.
      markLatency('first-viseme')
    }
    setFaceSpeechDebug({
      kind: speech.kind,
      hasAnalyser: Boolean(analyser),
      energy: audioState?.energy ?? 0,
      claimed: speech.claimsMouth,
      text: currentText,
      keys: Object.keys(speech.contributions).length,
      frame: ++frameCounterRef.current
    })

    if (dynamicsEnabled) {
      compositor.setAll(FACE_LAYERS.VITALITY, dynamics.blendshapes as Record<string, number>)
    }

    // Scripted capture beats every autonomous producer, by design.
    const override = getFaceOverride()
    if (override) compositor.setAll(FACE_LAYERS.OVERRIDE, override)

    // 7. One arbitration, one write.
    compositor.applyTo(faceRigRef.current, delta)

    // 8. Apply procedural body/neck offsets after authored animation and emotes.
    // The resolver accepts canonical names, Mixamo names, and lower-case aliases.
    for (const [name, offset] of Object.entries(dynamics.boneRotations)) {
      const bone =
        bonesRef.current[name] ??
        bonesRef.current[name.toLowerCase()] ??
        Object.entries(bonesRef.current).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
      if (!bone) continue
      bone.rotation.x += offset.x
      bone.rotation.y += offset.y
      bone.rotation.z += offset.z
      previousBoneOffsetsRef.current[name] = { ...offset }
    }

    if (avatarScene && !bonesRef.current.Head && !bonesRef.current.Spine2) {
      const baseRotation = sceneBaseRotationRef.current
      if (baseRotation) {
        avatarScene.rotation.x = baseRotation.x + dynamics.sceneOffset.rotationX
        avatarScene.rotation.y = baseRotation.y + dynamics.sceneOffset.rotationY
        avatarScene.rotation.z = baseRotation.z + dynamics.sceneOffset.rotationZ
      }
      if (sceneBasePositionYRef.current !== null) {
        avatarScene.position.y = sceneBasePositionYRef.current + dynamics.sceneOffset.positionY
      }
    }

    // 9. VRM secondary motion. springBoneManager was already ticked; lookAt was
    //    not, so a VRM's own eye-tracking sat inert while the rest of the rig
    //    animated. Both are cheap and both are visible.
    if (isVRM && vrm) {
      vrm.springBoneManager?.update(delta)
      vrm.lookAt?.update(delta)
    } else {
      // Non-VRM rigs get the same courtesy from our own solver. Last write of the
      // frame, after the mixer and after the dynamics engine's scene offsets, so
      // the chains hang off wherever the body actually ended up.
      for (const chain of springChainsRef.current) chain.update(delta)
    }
  })

  const handleAvatarClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      if (animationService && emoteService) {
        const randomAction = getRandomClip('action', avatarCatalog) as AnimationClip
        emoteService.actions.performAction({
          emotion: 'happy',
          relaxTime: Math.max(0, randomAction.duration - 1000)
        })

        animationService.actions.performAction({
          clip: randomAction,
          immediate: true,
          loopCount: 1,
          blendTime: 1000
        })

        animationService.actions.performAction({
          clip: idleClip,
          loopCount: Infinity,
          blendTime: 1000
        })
      }
    },
    [animationService, emoteService, avatarCatalog, idleClip]
  )

  return (
    <primitive
      ref={avatarRef}
      object={avatarScene as THREE.Object3D}
      onClick={handleAvatarClick}
      visible={isAvatarVisible}
    />
  )
}

// Memoize so unrelated parent re-renders don't churn the (expensive) avatar.
const AvatarModelMemo = memo(AvatarModelComponent)

// Remount the whole avatar when the selected model changes: a new mesh means new
// morph targets, a new skeleton family (GLB vs VRM), and a fresh startup greet, so
// keying by selectedModel re-initializes every ref/effect cleanly instead of trying
// to mutate a live rig in place.
export const AvatarModel = (props: AvatarModelProps) => {
  const [state] = useSimpleStore(AvatarState)
  return <AvatarModelMemo key={state.selectedModel} {...props} />
}

useGLTF.preload(AVATAR_MODEL)

// Preload all animation files using a loop over ANIMATION_CLIPS

// Loop through all animation clips and preload them
