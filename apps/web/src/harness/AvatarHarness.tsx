/**
 * AvatarHarness — a deterministic capture surface for visual tests.
 *
 * Renders ONLY the avatar (no chat/control UI) and exposes `window.__harness` so a
 * Playwright driver can select any avatar, play any body animation, fire any facial
 * emote, and drive lip-sync — then capture frames that are encoded to animated WebP
 * (see e2e/capture/). It reuses the real viseme/emote/animation services and the real
 * AvatarModel, so what it captures is exactly what ships.
 *
 * Served as a separate Vite entry at /harness.html. Query params:
 *   ?avatar=Greg   initial avatar (AvatarOptions or ORB_AVATAR_OPTIONS key)
 *   ?shot=body|upper|face   camera framing (default body)
 *   ?bg=transparent|dark    background (default dark)
 *   ?tts=synthetic|browser  speech engine (default synthetic)
 *   ?ttsVolume=0..1         speech level (default 0, silent) — see ./speechMode
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  AvatarModel,
  AvatarState,
  AvatarOptions,
  ORB_AVATAR_OPTIONS,
  getAvatarCatalog,
  getRandomClip,
  useAnimationService,
  useEmoteService,
  useTTSService,
  useVisemeService,
  type AnimationClip,
  type EmotionType,
  getAudioGraph,
  getFaceCompositorTrace,
  getFaceOverride,
  getFaceSpeechDebug,
  getOrbSnapshot,
  setConversationStatus,
  setFaceOverride,
  StudioEnvironment
} from '@ci-avatar/core'
import { needsSilencedOutput, speechModeFromParams } from './speechMode'

type Shot = 'face' | 'upper' | 'body'
type TTSService = ReturnType<typeof useTTSService>

declare global {
  interface Window {
    /**
     * Debug/QA surface driven by the Playwright capture driver (see e2e/capture/).
     * Typed loosely on purpose: it is consumed from `page.evaluate` as plain JS, and
     * pinning an interface here would just duplicate the literal below.
     */
    __harness?: Record<string, unknown>
    __harnessReady?: boolean
    __avatarLoaded?: boolean
  }
}

const params = new URLSearchParams(location.search)
const initialAvatar = params.get('avatar')
const transparent = params.get('bg') === 'transparent'

/** The source for a harness avatar name: a model from AvatarOptions, or a drawn orb. */
const avatarSource = (name: string): string | undefined =>
  AvatarOptions[name as keyof typeof AvatarOptions] ?? ORB_AVATAR_OPTIONS[name]

// Fixed for the life of the page. An unknown engine or level throws here, on purpose.
const speechMode = speechModeFromParams(params)
const silencedOutput = needsSilencedOutput(speechMode)

const SHOTS: Record<Shot, { d: number; ty: number; cy: number; fov: number }> = {
  face: { d: 1.15, ty: -0.02, cy: 0.05, fov: 26 },
  // Keep the head, shoulders, and most expressive hand motion in frame during
  // authored talking/waving clips instead of letting the close crop hide it.
  upper: { d: 2.2, ty: -0.2, cy: 0.05, fov: 30 },
  // Body: camera pulled back with breathing room and held near-level with the look
  // target (mid-torso) — a high camera looking down foreshortens the neck and makes
  // shoulders read as hunched/raised.
  body: { d: 4.5, ty: -0.85, cy: 0.02, fov: 30 }
}

// Optional per-run tuning of the active shot: ?d=4.2&ty=-0.8&cy=0&fov=30
for (const k of ['d', 'ty', 'cy', 'fov'] as const) {
  const v = params.get(k)
  if (v !== null && !Number.isNaN(Number(v))) {
    SHOTS[(params.get('shot') as Shot) || 'body'][k] = Number(v)
  }
}

/** Shared frame state written by onHeadLocated / setShot, read by the camera rig. */
interface FrameState {
  head: THREE.Vector3
  forward: THREE.Vector3
  shot: Shot
  ready: boolean
}

function isVRMSelected() {
  return AvatarState.get().selectedModel.toLowerCase().endsWith('.vrm')
}

/** Catalog for the active avatar — feminine-aware, mirroring AvatarModel. */
function activeCatalog() {
  const model = AvatarState.get().selectedModel
  return getAvatarCatalog(isVRMSelected(), /female|woman/i.test(model))
}

function CameraRig({ frameRef }: { frameRef: React.MutableRefObject<FrameState> }) {
  const { camera } = useThree()
  useFrame(() => {
    const f = frameRef.current
    if (!f.ready) return
    const cfg = SHOTS[f.shot]
    const forwardH = f.forward.clone()
    forwardH.y = 0
    if (forwardH.lengthSq() < 1e-6) forwardH.set(0, 0, 1)
    forwardH.normalize()

    const lookTarget = f.head.clone()
    lookTarget.y += cfg.ty
    const camPos = lookTarget.clone().add(forwardH.multiplyScalar(cfg.d))
    camPos.y += cfg.cy

    camera.position.copy(camPos)
    camera.lookAt(lookTarget)
    if ((camera as THREE.PerspectiveCamera).fov !== cfg.fov) {
      ;(camera as THREE.PerspectiveCamera).fov = cfg.fov
      camera.updateProjectionMatrix()
    }
  })
  return null
}

function HarnessScene() {
  const visemes = useVisemeService()
  const emotes = useEmoteService()
  const animations = useAnimationService()
  // The harness deliberately uses a silent synthetic TTS backend. It exercises
  // the production decoded-audio -> analyser -> AudioLipSync -> AvatarModel path
  // without depending on a network TTS server or browser SpeechSynthesis.
  // `?tts=browser` swaps the deterministic synthetic PCM for the real
  // `speechSynthesis` engine, so the Tier C boundary-event path can be exercised
  // against an engine that actually has voices. Default stays synthetic: it is
  // reproducible and works in headless CI, which has no voices at all.
  // Silent also means the analyser reads nothing, so the speech layer reports no
  // source; `?ttsVolume=1` is what gives a test a mouth to watch (see ./speechMode).
  const tts = useTTSService({ config: { mode: speechMode.engine, volume: speechMode.volume } })
  const ttsRef = useRef(tts)
  ttsRef.current = tts
  // Keep the prop identity stable while forwarding every read and command to
  // the current hook instance. AvatarModel runs from R3F's frame loop, so it
  // should not depend on a React state object changing identity mid-utterance.
  const ttsDriver = useMemo<TTSService>(
    () => ({
      get state() {
        return ttsRef.current.state
      },
      actions: {
        speak: (text) => ttsRef.current.actions.speak(text),
        stopSpeaking: () => ttsRef.current.actions.stopSpeaking(),
        playAudioBuffer: (audioBuffer, speechText) => ttsRef.current.actions.playAudioBuffer(audioBuffer, speechText),
        getQueueStatus: () => ttsRef.current.actions.getQueueStatus(),
        getAnalyser: () => ttsRef.current.actions.getAnalyser(),
        getCurrentSpeechInfo: () => ttsRef.current.actions.getCurrentSpeechInfo(),
        getSpeechTimings: () => ttsRef.current.actions.getSpeechTimings()
      }
    }),
    []
  )
  const three = useThree()

  useEffect(() => {
    if (!silencedOutput) return
    // The analyser is the one node wired to the speakers (see audioGraph). Cut that wire
    // and the voice still reaches the analyser at full level — an analyser with a
    // connected input and no output is pulled by the audio thread all the same — so
    // lip-sync reads a real signal and nothing is audible, headed or headless.
    getAudioGraph()?.analyser?.disconnect()
  }, [])

  const frameRef = useRef<FrameState>({
    head: new THREE.Vector3(0, 1.5, 0),
    forward: new THREE.Vector3(0, 0, 1),
    shot: (params.get('shot') as Shot) || 'body',
    ready: false
  })

  useEffect(() => {
    const initialSource = initialAvatar ? avatarSource(initialAvatar) : undefined
    if (initialSource) {
      AvatarState.set((s) => ({ ...s, selectedModel: initialSource }))
    }

    const w = window
    w.__harness = {
      /** The model avatars. The roster specs compare this with AvatarOptions, so the drawn orbs are listed apart. */
      listAvatars: () => Object.keys(AvatarOptions),
      /** The drawn avatars (ORB_AVATAR_OPTIONS). selectAvatar and ?avatar= take these names too. */
      listOrbs: () => Object.keys(ORB_AVATAR_OPTIONS),

      /**
       * Every bone in the loaded rig.
       *
       * Added because "does this avatar have hair bones?" is a question about the
       * ASSET, not the code, and there was no way to ask it — which is how a
       * secondary-motion solver nearly shipped against a roster that has nothing
       * for it to solve. Cheap, and it makes rig assumptions checkable.
       */
      listBones: () => {
        const out: string[] = []
        three.scene.traverse((o) => {
          if ((o as THREE.Bone).isBone) out.push(o.name)
        })
        return out
      },
      listClips: () => Object.keys(activeCatalog()),
      currentAvatar: () => AvatarState.get().selectedModel,

      selectAvatar(name: string) {
        const url = avatarSource(name) ?? name
        w.__avatarLoaded = false
        frameRef.current.ready = false
        AvatarState.set((s) => ({ ...s, selectedModel: url }))
        return url
      },

      setShot(shot: Shot) {
        frameRef.current.shot = shot
      },

      /** Play a named clip (catalog key or clip.name) as a one-shot over idle. */
      playAnimation(clip: string, opts?: { loopCount?: number; blendTime?: number; speed?: number }) {
        const catalog = activeCatalog()
        const found = catalog[clip] ?? Object.values(catalog).find((c) => c.name === clip)
        if (!found) return false
        animations.actions.performAction({
          clip: found,
          immediate: true,
          loopCount: opts?.loopCount ?? 1,
          blendTime: opts?.blendTime ?? 350,
          speed: opts?.speed
        })
        return true
      },

      /**
       * Isolated capture: stop everything and play ONLY this clip, cleanly looping from
       * t=0 at full weight, bypassing the idle/greet/queue interplay. Returns the clip
       * duration in ms so the capture window can be exactly one seam-free pass.
       */
      captureClip(clip: string) {
        const catalog = activeCatalog()
        const found = catalog[clip] ?? Object.values(catalog).find((c) => c.name === clip)
        const st = animations.state
        const action = found && st.actions?.[found.name]
        if (!action) return 0
        Object.values(st.actions ?? {}).forEach((a) => a && a.stop())
        action.reset()
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
        action.setEffectiveTimeScale(1)
        action.setEffectiveWeight(1)
        action.play()
        // Pin service state so the per-frame update() doesn't advance/queue over it.
        st.currentClip = { ...found, loopCount: Infinity, speed: 1 }
        st.isTransitioning = false
        st.transitionProgress = 0
        st.transitionDuration = 0
        st.previousClipName = undefined
        if (st.queue) st.queue.length = 0
        st.cyclingState.cyclingEnabled = false
        return Math.round((action.getClip?.()?.duration ?? found.duration / 1000) * 1000)
      },

      /** Play a random clip of a category (idle|gesture|expression|action|...). */
      playCategory(category: string, opts?: { loopCount?: number; blendTime?: number }) {
        const clip = getRandomClip(category as AnimationClip['category'], activeCatalog())
        if (!clip) return false
        animations.actions.performAction({
          clip,
          immediate: true,
          loopCount: opts?.loopCount ?? 1,
          blendTime: opts?.blendTime ?? 350
        })
        return clip.name
      },

      setEmote(emotion: string, relaxTime = 4000) {
        emotes.actions.performAction({ emotion: emotion as EmotionType, relaxTime })
        return true
      },

      /** The speech source this page runs on, so a run can assert it got the one it asked for. */
      speechMode() {
        return { ...speechMode, silencedOutput }
      },

      /** Drive lip-sync from text (synthetic whisper timing). */
      speak(text: string) {
        visemes.actions.reset()
        return tts.actions.speak(text)
      },

      /** Read the live speech driver used by the rendered AvatarModel. */
      speechInfo() {
        const info = tts.actions.getCurrentSpeechInfo()
        const queue = tts.actions.getQueueStatus()
        return {
          text: info.text,
          duration: info.duration,
          startTime: info.startTime,
          hasAnalyser: Boolean(tts.actions.getAnalyser()),
          queueLength: queue.queueLength,
          isProcessing: queue.isProcessing,
          stateSpeaking: tts.state.isSpeaking,
          stateQueue: tts.state.audioQueue
        }
      },

      /** Sample the analyser so tests can prove the browser produced audio energy. */
      audioMetrics() {
        const analyser = tts.actions.getAnalyser()
        if (!analyser) return { hasAnalyser: false, mean: 0, peak: 0 }
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        const peak = data.reduce((max, value) => Math.max(max, value), 0)
        const mean = data.length > 0 ? data.reduce((sum, value) => sum + value, 0) / data.length : 0
        return { hasAnalyser: true, mean, peak }
      },

      /** Snapshot live morphs and posture for render-level assertions. */
      faceSnapshot() {
        let maxMorph = 0
        let jawOpen = 0
        let blink = 0
        let gaze = 0
        let vrmMouth = 0
        const mouth: Record<string, number> = {}
        const boneRotations: Record<string, { x: number; y: number; z: number }> = {}
        three.scene.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (mesh.morphTargetInfluences && mesh.morphTargetDictionary) {
            mesh.morphTargetInfluences.forEach((value) => {
              maxMorph = Math.max(maxMorph, Math.abs(value))
            })
            for (const key of ['jawOpen', 'mouthOpen', 'viseme_aa']) {
              const index = mesh.morphTargetDictionary[key]
              if (index !== undefined) {
                const value = mesh.morphTargetInfluences[index] ?? 0
                mouth[key] = Math.max(mouth[key] ?? 0, value)
                jawOpen = Math.max(jawOpen, value)
              }
            }
            for (const key of ['eyeBlinkLeft', 'eyeBlinkRight', 'Blink', 'blink']) {
              const index = mesh.morphTargetDictionary[key]
              if (index !== undefined) blink = Math.max(blink, mesh.morphTargetInfluences[index] ?? 0)
            }
            for (const key of [
              'eyeLookInLeft',
              'eyeLookInRight',
              'eyeLookOutLeft',
              'eyeLookOutRight',
              'eyeLookUpLeft',
              'eyeLookUpRight',
              'eyeLookDownLeft',
              'eyeLookDownRight'
            ]) {
              const index = mesh.morphTargetDictionary[key]
              if (index !== undefined) gaze = Math.max(gaze, mesh.morphTargetInfluences[index] ?? 0)
            }
          }
          const bone = object as THREE.Bone
          if (bone.isBone && ['Head', 'Neck', 'Spine2', 'LeftArm', 'RightArm'].includes(bone.name)) {
            boneRotations[bone.name] = {
              x: Number(bone.rotation.x.toFixed(4)),
              y: Number(bone.rotation.y.toFixed(4)),
              z: Number(bone.rotation.z.toFixed(4))
            }
          }
        })
        const expressionManager = visemes.state.viseme?.vrm?.expressionManager
        if (expressionManager) {
          for (const name of ['aa', 'ee', 'ih', 'oh', 'ou']) {
            try {
              vrmMouth = Math.max(vrmMouth, expressionManager.getValue(name) ?? 0)
            } catch {
              // Some VRM expression managers expose a name without a readable value.
            }
          }
        }
        return {
          maxMorph: Number(maxMorph.toFixed(4)),
          jawOpen: Number(jawOpen.toFixed(4)),
          mouth: Object.fromEntries(Object.entries(mouth).map(([key, value]) => [key, Number(value.toFixed(4))])),
          vrmMouth: Number(vrmMouth.toFixed(4)),
          blink: Number(blink.toFixed(4)),
          gaze: Number(gaze.toFixed(4)),
          boneRotations,
          speech: {
            text: tts.actions.getCurrentSpeechInfo().text,
            hasAnalyser: Boolean(tts.actions.getAnalyser())
          }
        }
      },

      /** Introspect the live animation mixer (for mixing/crossfade QA). */
      debugActions() {
        const s = animations.state
        const acts: Record<string, THREE.AnimationAction> = s.actions || {}
        const live = Object.entries(acts)
          .map(([name, a]) => ({
            name,
            w: Number((a.getEffectiveWeight?.() ?? a.weight ?? 0).toFixed(3)),
            t: Number((a.time ?? 0).toFixed(2)),
            run: !!a.isRunning?.()
          }))
          .filter((x) => x.w > 0.001 || x.run)
        return {
          current: s.currentClip?.name ?? null,
          transitioning: !!s.isTransitioning,
          queue: s.queue?.length ?? 0,
          live
        }
      },

      // ---- direct rig control (for crisp, deterministic FACE tests) ----
      // Toggle the per-frame services so direct morph writes aren't overwritten.
      setServices(flags: { visemes?: boolean; emotes?: boolean; animations?: boolean; dynamics?: boolean }) {
        AvatarState.set((s) => ({
          ...s,
          visemesEnabled: flags.visemes ?? s.visemesEnabled,
          emotesEnabled: flags.emotes ?? s.emotesEnabled,
          animationsEnabled: flags.animations ?? s.animationsEnabled,
          dynamicsEnabled: flags.dynamics ?? s.dynamicsEnabled
        }))
      },

      /** Every morph-target name on the avatar (visemes + ARKit) — diagnostic. */
      faceMorphs() {
        const names = new Set<string>()
        three.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.morphTargetDictionary) Object.keys(mesh.morphTargetDictionary).forEach((n) => names.add(n))
        })
        return [...names].sort()
      },

      /** Directly set GLB morph influences: {morphName: value}. Returns #applied. */
      /**
       * Drive facial weights deterministically for a capture.
       *
       * Publishes to the compositor's OVERRIDE layer rather than writing morph
       * influences directly: the compositor writes the face every frame now, so
       * a direct poke would be released back to rest before the shutter opened.
       * Going through the same path the product uses also means these captures
       * are evidence about the shipping pipeline, not about a test back door.
       *
       * Returns the number of entries the loaded rig can actually drive, so a
       * capture against a head that lacks the morph fails loudly instead of
       * silently photographing a neutral face.
       */
      setMorph(entries: Record<string, number>) {
        setFaceOverride({ ...(getFaceOverride() ?? {}), ...entries })
        let drivable = 0
        three.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.morphTargetDictionary) return
          for (const name of Object.keys(entries)) {
            if (mesh.morphTargetDictionary[name] !== undefined) drivable++
          }
        })
        return drivable
      },

      /** Zero all morph influences (reset the face). */
      /**
       * Drop the scripted override and let the autonomous producers have the face
       * back. The compositor releases every key the override was holding, so the
       * face returns to rest on its own ramp rather than snapping to zero.
       */
      clearMorphs() {
        setFaceOverride(null)
        three.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0)
        })
      },

      /**
       * Which layer won each facial region on the last rendered frame.
       *
       * The regression surface for face arbitration: a test asserts that speech
       * owned the jaw during an utterance, instead of a human squinting at a WebP.
       */
      compositorTrace() {
        return getFaceCompositorTrace()
      },

      /** Why the mouth is (or is not) moving — see FaceSpeechDebug. */
      speechDebug() {
        return getFaceSpeechDebug()
      },

      /** The Green Orb's last frame (voice, glow, rings), or null when a model avatar is loaded. */
      orbSnapshot: () => getOrbSnapshot(),

      /**
       * Drive the conversational state the dynamics engine branches on.
       * Until this was threaded through, the avatar was only ever told
       * 'speaking' or 'idle', so listening/thinking behaviour never ran.
       */
      setConversationStatus(status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking') {
        setConversationStatus(status)
      },

      /** VRM expression names + current values (diagnose VRM face driving). */
      vrmExpressions() {
        const em = visemes.state.viseme?.vrm?.expressionManager
        if (!em) return { vrm: false, note: 'no VRM expressionManager on this avatar' }
        const names = Object.keys(em.expressionMap || {})
        const values: Record<string, number> = {}
        for (const n of names) {
          try {
            values[n] = Number((em.getValue(n) ?? 0).toFixed(2))
          } catch {
            // Expression present in the map but unreadable — skip it rather than
            // failing the whole diagnostic dump.
          }
        }
        return { vrm: true, names, values }
      }
    }
    w.__harnessReady = true
    return () => {
      delete w.__harness
      w.__harnessReady = false
    }
    }, [visemes, emotes, animations, tts, three])

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.25} />
      <directionalLight position={[-2, 1, -2]} intensity={0.35} />
      <StudioEnvironment />
      <CameraRig frameRef={frameRef} />
      <Suspense fallback={null}>
        <AvatarModel
          visemeService={visemes}
          emoteService={emotes}
          animationService={animations}
          ttsService={ttsDriver}
          onHeadLocated={(target, position) => {
            const head = new THREE.Vector3(...target)
            const forward = new THREE.Vector3(...position).sub(head)
            frameRef.current.head = head
            frameRef.current.forward = forward
            frameRef.current.ready = true
            window.__avatarLoaded = true
          }}
        />
      </Suspense>
    </>
  )
}

export function AvatarHarness() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: transparent ? 'transparent' : '#0a1416' }}>
      <Canvas
        frameloop="always"
        gl={{ alpha: transparent, antialias: true, preserveDrawingBuffer: true }}
        camera={{ position: [0, 1.5, 2.5], fov: 30 }}
        dpr={[1, 2]}
      >
        <HarnessScene />
      </Canvas>
    </div>
  )
}
