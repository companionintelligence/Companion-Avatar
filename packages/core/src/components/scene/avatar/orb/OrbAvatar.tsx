import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { orbPaletteFor } from './orbCatalog'
import { setOrbSnapshot, type OrbSnapshot } from './orbDebug'
import { OrbMotion } from './orbMotion'
import {
  ORB_BILLBOARD_VERTEX,
  ORB_CORE_FRAGMENT,
  ORB_CORE_VERTEX,
  ORB_HALO_FRAGMENT,
  ORB_MOTES_FRAGMENT,
  ORB_MOTES_VERTEX,
  ORB_RING_SLOTS,
  ORB_RINGS_FRAGMENT
} from './orbShaders'
import { ConversationStatusState } from '../../../../services/conversation/conversationStatus'
import { talkAnalyser } from '../../../../services/talk/talkService'
import { setVoicePosition } from '../../../../services/tts/audioGraph'
import type { useTTSService } from '../../../../services/tts/ttsService'
import { AudioLipSync } from '../../../../services/visemes/audioLipSync'

/** Height of the orb's centre, metres: a little under a standing eye line, where a companion would float. */
export const ORB_CENTRE_HEIGHT = 1.45
/** Radius of the ball, metres. About a head's size, so the bust framing's numbers still frame it. */
const CORE_RADIUS = 0.085
/** Width of the halo quad, metres. */
const HALO_SIZE = 0.5
/** Width of the rings quad, metres. A ring starts at the ball's edge and spreads to about three times its radius. */
const RING_SIZE = 0.52
const MOTE_COUNT = 72
/** The point light's strength at full glow, candela. It shows in a room (the diorama), not on the bare studio bust. */
const LIGHT_CANDELA = 1.6
/**
 * The orb parks the camera this much further back than a head does: the speech rings spread to about three times the
 * ball's radius, and at the bust's 0.5 m they would leave the frame.
 */
const ORB_FRAMING = 1.25
/** Seconds the orb takes to fade in when it is chosen. */
const FADE_IN = 0.6
/**
 * Grace after an utterance's nominal end during which a text-only voice (browser speechSynthesis, which has no audio
 * graph) still counts as speaking. The same slack AvatarModel allows.
 */
const SPEECH_TAIL_SECONDS = 0.25

/** Premultiplied "over": the light adds to a dark backdrop, and the body still occludes a light one. */
const ORB_BLENDING = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor
} as const

/**
 * A voice with no audio graph to measure (browser speechSynthesis): a syllable-rate pulse, so the orb still answers.
 * Two sines at unrelated rates, so the pulse does not read as a metronome.
 */
const syllablePulse = (elapsed: number): number =>
  0.3 + 0.45 * Math.abs(Math.sin(elapsed * 7.3)) * (0.6 + 0.4 * Math.abs(Math.sin(elapsed * 2.1 + 1)))

/** A small fixed-seed generator, so the motes sit in the same places on every load and screenshots compare. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function moteGeometry(): THREE.BufferGeometry {
  const random = seededRandom(0x0a6358)
  const positions = new Float32Array(MOTE_COUNT * 3)
  const seeds = new Float32Array(MOTE_COUNT * 4)
  for (let i = 0; i < MOTE_COUNT; i++) {
    // An even spread of directions over the sphere.
    const z = random() * 2 - 1
    const angle = random() * Math.PI * 2
    const ring = Math.sqrt(1 - z * z)
    positions.set([ring * Math.cos(angle), z, ring * Math.sin(angle)], i * 3)
    seeds.set([random(), random(), random(), random()], i * 4)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  return geometry
}

function useReducedMotion(): React.RefObject<boolean> {
  const reduced = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduced.current = media.matches
    const onChange = (event: MediaQueryListEvent) => {
      reduced.current = event.matches
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export interface OrbAvatarProps {
  /** The `orb:` source that chose this avatar; it names the palette. */
  source: string
  ttsService?: ReturnType<typeof useTTSService>
  /** Called once the orb is placed, with a camera target and position, exactly as AvatarModel does for a head. */
  onHeadLocated?: (target: [number, number, number], position: [number, number, number]) => void
  cameraDistance?: number
  cameraTargetDrop?: number
  /** Place the voice at the orb, as AvatarModel places it at the head. */
  spatialAudio?: boolean
}

/**
 * The green orb: a floating ball of light that speaks for the companion.
 *
 * It listens to the same signals as the face of a model avatar: the voice's analyser (TTS, or a live talk reply) and
 * the conversation status. OrbMotion turns those into a look; this component draws it.
 */
export function OrbAvatar({
  source,
  ttsService,
  onHeadLocated,
  cameraDistance = 0.5,
  cameraTargetDrop = 0,
  spatialAudio = false
}: OrbAvatarProps) {
  const anchorRef = useRef<THREE.Group>(null)
  const floatRef = useRef<THREE.Group>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const haloRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const ttsRef = useRef(ttsService)
  ttsRef.current = ttsService
  const onHeadLocatedRef = useRef(onHeadLocated)
  onHeadLocatedRef.current = onHeadLocated
  const reducedMotion = useReducedMotion()

  const motion = useMemo(() => new OrbMotion(), [])
  const listener = useRef<{ analyser: AnalyserNode; lipSync: AudioLipSync } | null>(null)
  const age = useRef(0)
  const snapshot = useRef<OrbSnapshot>({
    frame: 0,
    status: 'idle',
    speaking: false,
    hasAnalyser: false,
    voice: 0,
    glow: 0,
    scale: 1,
    rings: 0
  })
  useEffect(() => {
    setOrbSnapshot(snapshot.current)
    return () => setOrbSnapshot(null)
  }, [])

  const palette = useMemo(() => orbPaletteFor(source), [source])
  const colours = useMemo(
    () => ({
      uDeep: { value: new THREE.Color(palette.deep) },
      uMid: { value: new THREE.Color(palette.mid) },
      uBright: { value: new THREE.Color(palette.bright) },
      uHot: { value: new THREE.Color(palette.hot) }
    }),
    [palette]
  )

  // One uniform object per value, shared by the materials that read it, so a frame updates each once.
  const uniforms = useMemo(() => {
    const shared = {
      uFlow: { value: 0 },
      uOrbit: { value: 0 },
      uChurn: { value: 0 },
      uGlow: { value: 0 },
      uVoice: { value: 0 },
      uSparkle: { value: 0 },
      uOpacity: { value: 0 },
      uPointScale: { value: 1000 },
      uRings: { value: Array.from({ length: ORB_RING_SLOTS }, () => new THREE.Vector2()) },
      ...colours
    }
    return {
      shared,
      core: {
        uFlow: shared.uFlow,
        uChurn: shared.uChurn,
        uGlow: shared.uGlow,
        uVoice: shared.uVoice,
        uSparkle: shared.uSparkle,
        uOpacity: shared.uOpacity,
        uDeep: shared.uDeep,
        uMid: shared.uMid,
        uBright: shared.uBright,
        uHot: shared.uHot
      },
      halo: {
        uGlow: shared.uGlow,
        uOpacity: shared.uOpacity,
        uDeep: shared.uDeep,
        uMid: shared.uMid,
        uBright: shared.uBright
      },
      rings: {
        uRings: shared.uRings,
        uOpacity: shared.uOpacity,
        uBright: shared.uBright,
        uHot: shared.uHot
      },
      motes: {
        uOrbit: shared.uOrbit,
        uFlow: shared.uFlow,
        uVoice: shared.uVoice,
        uPointScale: shared.uPointScale,
        uGlow: shared.uGlow,
        uSparkle: shared.uSparkle,
        uOpacity: shared.uOpacity,
        uBright: shared.uBright,
        uHot: shared.uHot
      }
    }
  }, [colours])

  const motes = useMemo(moteGeometry, [])
  useEffect(() => () => motes.dispose(), [motes])

  // Frame the orb the way AvatarModel frames a head, and put the voice there in a room.
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    anchor.updateWorldMatrix(true, false)
    const centre = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld)
    const facing = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()))
      .normalize()
    const target = centre.clone().add(new THREE.Vector3(0, -cameraTargetDrop, 0))
    const position = centre.clone().add(facing.multiplyScalar(cameraDistance * ORB_FRAMING))
    onHeadLocatedRef.current?.(
      target.toArray() as [number, number, number],
      position.toArray() as [number, number, number]
    )
    setVoicePosition(spatialAudio ? (centre.toArray() as [number, number, number]) : null)
  }, [cameraDistance, cameraTargetDrop, spatialAudio])

  useFrame((state, delta) => {
    if (typeof document !== 'undefined' && document.hidden) return

    // The voice: the TTS analyser, or a live talk reply's. Rebuild the reader when the analyser changes, and drop it
    // when the graph goes, or it goes on reporting its last reading against a dead node.
    const tts = ttsRef.current
    const analyser = tts?.actions.getAnalyser() ?? talkAnalyser()
    if (!analyser) listener.current = null
    else if (listener.current?.analyser !== analyser) listener.current = { analyser, lipSync: new AudioLipSync(analyser) }
    const audio = listener.current?.lipSync.update() ?? null

    const info = tts?.actions.getCurrentSpeechInfo()
    const elapsed =
      info && info.startTime > 0
        ? (info.audioContext ? info.audioContext.currentTime : performance.now() / 1000) - info.startTime
        : Number.POSITIVE_INFINITY
    const textSpeaking = !analyser && Boolean(info?.text) && elapsed < (info?.duration ?? 0) + SPEECH_TAIL_SECONDS
    const speaking = Boolean(audio?.isSpeaking) || textSpeaking
    const energy = audio?.isSpeaking ? audio.energy : textSpeaking ? syllablePulse(elapsed) : 0

    const status = ConversationStatusState.get().status
    const frame = motion.step(
      { status, speaking, energy, high: audio?.highBand ?? 0, reducedMotion: reducedMotion.current },
      delta
    )
    const published = snapshot.current
    published.frame += 1
    published.status = status
    published.speaking = speaking
    published.hasAnalyser = Boolean(analyser)
    published.voice = frame.voice
    published.glow = frame.glow
    published.scale = frame.scale
    published.rings = frame.rings.length

    age.current += Math.min(delta, 0.1)
    const shared = uniforms.shared
    shared.uOpacity.value = Math.min(1, age.current / FADE_IN)
    shared.uFlow.value = frame.flow
    shared.uOrbit.value = frame.orbit
    shared.uChurn.value = frame.churn
    shared.uGlow.value = frame.glow
    shared.uVoice.value = frame.voice
    shared.uSparkle.value = frame.sparkle
    shared.uPointScale.value = state.size.height * state.viewport.dpr * 0.5 * state.camera.projectionMatrix.elements[5]
    for (let i = 0; i < ORB_RING_SLOTS; i++) {
      const ring = frame.rings[i]
      shared.uRings.value[i].set(ring ? ring.age : 0, ring ? ring.strength : 0)
    }

    floatRef.current?.position.set(frame.drift, frame.lift, 0)
    coreRef.current?.scale.setScalar(CORE_RADIUS * frame.scale)
    haloRef.current?.scale.setScalar(HALO_SIZE * (0.92 + 0.08 * frame.scale + 0.1 * frame.voice))
    if (lightRef.current) lightRef.current.intensity = LIGHT_CANDELA * frame.light * shared.uOpacity.value
  })

  return (
    <group ref={anchorRef} position={[0, ORB_CENTRE_HEIGHT, 0]} name="orb-avatar">
      <group ref={floatRef}>
        <mesh ref={haloRef} scale={HALO_SIZE} renderOrder={10}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            vertexShader={ORB_BILLBOARD_VERTEX}
            fragmentShader={ORB_HALO_FRAGMENT}
            uniforms={uniforms.halo}
            {...ORB_BLENDING}
          />
        </mesh>
        <mesh
          ref={coreRef}
          scale={CORE_RADIUS}
          renderOrder={11}
          onClick={(event) => {
            event.stopPropagation()
            motion.poke()
          }}
        >
          <sphereGeometry args={[1, 48, 32]} />
          <shaderMaterial
            vertexShader={ORB_CORE_VERTEX}
            fragmentShader={ORB_CORE_FRAGMENT}
            uniforms={uniforms.core}
            side={THREE.BackSide}
            {...ORB_BLENDING}
          />
        </mesh>
        <mesh scale={RING_SIZE} renderOrder={12}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            vertexShader={ORB_BILLBOARD_VERTEX}
            fragmentShader={ORB_RINGS_FRAGMENT}
            uniforms={uniforms.rings}
            {...ORB_BLENDING}
          />
        </mesh>
        <points geometry={motes} scale={CORE_RADIUS} renderOrder={13} frustumCulled={false}>
          <shaderMaterial
            vertexShader={ORB_MOTES_VERTEX}
            fragmentShader={ORB_MOTES_FRAGMENT}
            uniforms={uniforms.motes}
            {...ORB_BLENDING}
          />
        </points>
        <pointLight ref={lightRef} color={palette.bright} intensity={0} distance={3} decay={2} />
      </group>
    </group>
  )
}
