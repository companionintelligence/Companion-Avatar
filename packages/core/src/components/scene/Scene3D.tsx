import { Environment, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { createXRStore, XR, type XRStore } from '@react-three/xr'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SceneConfig } from './sceneTypes'
import type { useAnimationService } from '../../services/animation/useAnimationService'
import type { useEmoteService } from '../../services/emote/useEmoteService'
import type { useVisemeService } from '../../services/visemes/useVisemeService'
import type { useTTSService } from '../../services/tts/ttsService'
import { AvatarModel } from './avatar/AvatarModel'
import { AvatarLightingRig } from '../avatar/AvatarLightingRig'
import { resolveAvatarScale } from '../avatar/avatarSizing'
import { DatacenterDiorama } from './environment/DatacenterDiorama'
import { GraphicsFallback } from './GraphicsFallback'
import { WebGLGate } from './WebGLGate'
import { useRendererConfig } from './rendering/useRendererConfig'
import { configureRenderer, createWebGLContext } from './rendering/RendererConfig'
import type { DeviceCapabilities, RenderQuality } from './rendering/RendererConfig'
import { PostProcessing } from './rendering/PostProcessing'
import { XREnhancements } from './rendering/XREnhancements'


/**
 * Per-environment camera and lighting. `none` reproduces the studio viewport EXACTLY —
 * 0.5 / 1 / 1 are the values this file has always had inline — so the default look, and
 * every committed product screenshot of it, is unchanged.
 *
 * `cameraDistance` — how far in front of the located head bone the camera parks.
 *   `sceneConfig.cameraPosition` is NOT where the camera ends up: AvatarModel finds the
 *   head bone on load and calls onHeadLocated, and handleHeadLocated below overwrites both
 *   position and target with it. So this distance is the only real framing control.
 *   MEASURED at 0.5 m against the real render (fov 50, aspect 1.78, camera ending up at
 *   [0, 1.638, 1.008] looking down -Z): 0 of the diorama's 11 props and 0 of its 3 walls
 *   had a single AABB corner inside the frustum. 2.4 m brings the back wall of machines,
 *   both side walls and the terminal row into shot and still keeps the avatar a mid-shot.
 *
 * `iblIntensity` — how much of the `studio` HDRI reaches the scene.
 *   The studio preset is a bright white lightbox. It is the right key for a bust floating
 *   on a dark HUD, and it is overwhelming inside a room: MEASURED, it was supplying nearly
 *   all the diorama's light. At intensity 1 the machine cabinets clipped to (255,255,192)
 *   and the floor — a #0a1418 plane — rendered at (169,182,195), brighter than anything
 *   else in frame and directly behind the chat input and the control dock. Dropping the
 *   IBL to 0 took the same floor pixel to (31,34,35) and un-clipped the cabinets.
 *   NOTE this is scene.environmentIntensity, not material.envMapIntensity: measured,
 *   setting envMapIntensity to 0 on every diorama material changed the floor by nothing
 *   at all (156,169,181 -> 156,169,181). Tuning that number is tuning a no-op.
 *
 * `rigScale` — multiplier on the four studio directionals and the ambient below.
 *   They are a product-shot rig aimed at a floating figure; at full strength inside a room
 *   they flatten it and wash the walls. Scaled back, the diorama's own practicals become
 *   the light you actually read, which is what docs/DIORAMA.md asks for.
 */
interface EnvironmentLook {
  cameraDistance: number
  /**
   * Camera distance on a PORTRAIT viewport, where the same lens sees far less of the room.
   *
   * three's PerspectiveCamera holds the VERTICAL fov fixed and derives the horizontal one
   * from aspect, so narrowing the window narrows the field rather than letterboxing it. At
   * 1280x720 the frame is +/-0.830*d wide; at 360x640 it is +/-0.262*d — 3.2x less. A room
   * staged to read at 16:9 therefore has almost none of its width left at 9:16, and the
   * measured portrait frame at 2.4 m showed the avatar with one cabinet edge behind it and
   * the whole workstation outside the frame.
   *
   * Full parity would need 3.2x the distance and would leave the avatar a doll. This is the
   * compromise: far enough back that the room wraps the figure, close enough that the figure
   * is still the subject. It is a different staging for a different frame, which is what a
   * 9:16 cut is supposed to be — not the 16:9 one squeezed.
   *
   * Portrait also drops the pitch: at this distance the eyeline is already high in a tall
   * frame, and pitching further down buries the avatar in the bottom third.
   */
  portraitCameraDistance: number
  /** Metres the look-at sits below the head bone, pitching the camera down. 0 = eyeline. */
  cameraTargetDrop: number
  portraitCameraTargetDrop: number
  iblIntensity: number
  rigScale: number
}

const ENVIRONMENT_LOOK: Record<NonNullable<SceneConfig['environment']>, EnvironmentLook> = {
  none: {
    cameraDistance: 0.5,
    portraitCameraDistance: 0.5,
    cameraTargetDrop: 0,
    portraitCameraTargetDrop: 0,
    iblIntensity: 1,
    rigScale: 1
  },
  'datacenter-1970s': {
    cameraDistance: 2.4,
    portraitCameraDistance: 3.6,
    cameraTargetDrop: 0.28,
    portraitCameraTargetDrop: 0.1,
    iblIntensity: 0.14,
    rigScale: 0.42
  }
}

interface Scene3DProps {
  sceneConfig: SceneConfig
  visemeService?: ReturnType<typeof useVisemeService>
  emoteService?: ReturnType<typeof useEmoteService>
  animationService?: ReturnType<typeof useAnimationService>
  ttsService?: ReturnType<typeof useTTSService>
  setXRStore?: (store: XRStore) => void
  onSceneActionsReady?: (actions: SceneActions) => void
  webGPUEnabled: boolean
}

export interface SceneActions {
  recenter: () => void
  scaleBy: (delta: number) => void
  resetScale: () => void
}

const SceneContent = ({
  sceneConfig,
  visemeService,
  emoteService,
  animationService,
  ttsService,
  store,
  webGPUEnabled,
  quality,
  capabilities,
  worldGroupRef,
  worldScale,
  setRecenterHandler
}: Scene3DProps & { store: XRStore; quality: RenderQuality; capabilities: DeviceCapabilities; worldGroupRef: React.RefObject<THREE.Group | null>; worldScale: number; setRecenterHandler?: (fn: () => void) => void }) => {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls> | null>(null)
  const { camera, gl, size: viewportSize } = useThree()
  const [camTarget, setCamTarget] = useState<[number, number, number]>(sceneConfig.cameraTarget)
  const [camPos, setCamPos] = useState<[number, number, number]>(sceneConfig.cameraPosition)

  // Configure renderer on mount with quality settings.
  //
  // Uses the `capabilities` prop rather than re-deriving it. This used to build a
  // second, partial copy inline — re-sniffing the user agent and asserting
  // `hasWebGL2: true` and `maxTextureSize: 2048` whatever the context actually
  // reported — so the renderer was configured from different facts than the ones
  // that chose `quality`. The detected object is already passed in and now also
  // carries isSoftwareRenderer.
  useEffect(() => {
    if (gl && quality) {
      configureRenderer(gl as THREE.WebGLRenderer, { ...capabilities, hasWebGPU: webGPUEnabled }, quality)
    }
  }, [gl, quality, webGPUEnabled, capabilities])

  useEffect(() => {
    camera.position.set(camPos[0], camPos[1], camPos[2])
    camera.lookAt(new THREE.Vector3(camTarget[0], camTarget[1], camTarget[2]))
    if (controlsRef.current) {
      controlsRef.current.target.set(camTarget[0], camTarget[1], camTarget[2])
      controlsRef.current.update()
    }
  }, [camPos, camTarget, camera])

  useEffect(() => {
    if (!setRecenterHandler) return
    setRecenterHandler(() => {
      setCamTarget(sceneConfig.cameraTarget)
      setCamPos(sceneConfig.cameraPosition)
      if (worldGroupRef.current) {
        worldGroupRef.current.position.set(0, 0, 0)
        worldGroupRef.current.rotation.set(0, 0, 0)
      }
    })
  }, [sceneConfig.cameraTarget, sceneConfig.cameraPosition, setRecenterHandler, worldGroupRef])

  const handleHeadLocated = (target: [number, number, number], position: [number, number, number]) => {
    setCamTarget(target)
    setCamPos(position)
  }

  // Determine shadow settings based on quality
  const shadowMapSize = quality?.shadowMapSize || 1024
  const useShadows = quality?.useShadows !== false

  const look = ENVIRONMENT_LOOK[sceneConfig.environment ?? 'none']
  // Portrait is decided by the drawing buffer, not by a user-agent guess: the capture films
  // 1280x720 and 360x640 through the same browser build, so a UA check would call both
  // desktop and stage the 9:16 cut as a cropped 16:9.
  const isPortrait = viewportSize.height > viewportSize.width

  return (
    <XR store={store}>
      <OrbitControls
        ref={controlsRef}
        target={camTarget}
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={1}
        maxDistance={10}
      />

      {sceneConfig.lightingPreset ? (
        <AvatarLightingRig preset={sceneConfig.lightingPreset} />
      ) : (
        <>
          {/* Enhanced lighting setup with quality-based shadows.
              Every intensity here is scaled by the environment's rigScale — 1 for the plain
              studio viewport, so those numbers are untouched. */}
          <ambientLight intensity={0.5 * look.rigScale} color={0xffffff} />
          <directionalLight
            position={[3, 5, 5]}
            intensity={1.5 * look.rigScale}
            color={0xffffff}
            castShadow={useShadows}
            shadow-mapSize={[shadowMapSize, shadowMapSize]}
            shadow-bias={-0.0001}
            shadow-camera-near={0.5}
            shadow-camera-far={15}
            shadow-camera-left={-5}
            shadow-camera-right={5}
            shadow-camera-top={5}
            shadow-camera-bottom={-5}
          />
          <directionalLight position={[-3, 3, 2]} intensity={0.6 * look.rigScale} color={0xeeeeff} />
          <directionalLight position={[0, 3, -5]} intensity={0.4 * look.rigScale} color={0xffeedd} />
          <directionalLight position={[0, -2, 2]} intensity={0.3 * look.rigScale} color={0xffffff} />
          <Environment preset="studio" background={false} environmentIntensity={look.iblIntensity} />
        </>
      )}

      {/* XR enhancements for VR/AR */}
      <XREnhancements enabled={true} showGrid={false} />

      {/* A contact shadow needs something to fall on. This plane is invisible
          except for what the avatar casts onto it (ShadowMaterial writes only
          shadow), so the studio viewport keeps its transparent background while
          the figure stops floating. Skipped when shadows are off — a mesh that
          can never darken is just an extra draw call. */}
      {useShadows && sceneConfig.environment !== 'datacenter-1970s' && (
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[8, 8]} />
          <shadowMaterial transparent opacity={0.32} />
        </mesh>
      )}

      <group ref={worldGroupRef} scale={worldScale}>
        {sceneConfig.environment === 'datacenter-1970s' && <DatacenterDiorama />}
        <group scale={resolveAvatarScale(sceneConfig.avatarSize)}>
          <AvatarModel
            visemeService={visemeService}
            emoteService={emoteService}
            animationService={animationService}
            ttsService={ttsService}
            onHeadLocated={handleHeadLocated}
            cameraDistance={isPortrait ? look.portraitCameraDistance : look.cameraDistance}
            cameraTargetDrop={isPortrait ? look.portraitCameraTargetDrop : look.cameraTargetDrop}
            // NOTE: webGPUEnabled is deliberately NOT passed. It reports device
            // capability, not what is rendering, and using it to pick a node
            // material broke every VRM on any WebGPU-capable machine. The avatar
            // asks the live renderer instead.
            // Spatialise the voice only in a room — an XR session or the diorama.
            // On the flat studio bust there is nowhere for it to come from, and
            // HRTF just makes a centred figure sound off-axis.
            spatialAudio={sceneConfig.environment === 'datacenter-1970s'}
          />
        </group>
      </group>

      {/* Post-processing effects for enhanced visuals */}
      <PostProcessing 
        enabled={true}
        quality={quality?.useShadows ? 'high' : quality?.useFXAA ? 'medium' : 'low'}
        isMobile={capabilities ? !capabilities.isDesktop : false}
      />
    </XR>
  )
}

const Scene3DComponent = ({ sceneConfig, visemeService, emoteService, animationService, ttsService, setXRStore, onSceneActionsReady, webGPUEnabled }: Scene3DProps) => {
  // The XR store is an external state container. Recreating it on every render
  // makes the parent callback fire again, which recreates the store and can
  // spiral into a maximum-update-depth loop in the canonical app.
  const store = useMemo(() => createXRStore(), [])
  const { capabilities, quality, isLoading } = useRendererConfig()
  const worldGroupRef = useRef<THREE.Group>(null)
  const recenterSceneRef = useRef<(() => void) | undefined>(undefined)
  const [worldScale, setWorldScale] = useState(1)

  useEffect(() => {
    if (setXRStore) {
      setXRStore(store)
    }
  }, [setXRStore, store])

  useEffect(() => {
    if (!onSceneActionsReady) return
    const actions: SceneActions = {
      recenter: () => {
        recenterSceneRef.current?.()
        const origin = store.getState().origin
        if (origin) {
          origin.position.set(0, 0, 0)
          origin.rotation.set(0, 0, 0)
        }
        setWorldScale(1)
      },
      scaleBy: (delta: number) => {
        setWorldScale((prev) => {
          const next = Math.min(2, Math.max(0.5, prev + delta))
          return next
        })
      },
      resetScale: () => {
        setWorldScale(1)
      }
    }
    onSceneActionsReady(actions)
  }, [onSceneActionsReady, store])

  // Show loading state while detecting capabilities
  if (isLoading || !capabilities || !quality) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
        <GraphicsFallback />
      </div>
    )
  }

  // Create context based on capabilities
  const glConfig = createWebGLContext(capabilities, quality)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas        
        camera={{ position: [0, 1.6, 3], fov: 50 }}
        style={{ background: 'transparent' }}
        shadows={quality.useShadows}
        dpr={quality.pixelRatio}
        gl={glConfig}
        onCreated={(state) => {
          // `firstHitOnly` is a three-mesh-bvh extension, not part of three's Raycaster type.
          ;(state.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true
          // Additional optimizations for mobile
          if (capabilities.isMobile) {
            state.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
          }
        }}
        fallback={<GraphicsFallback />}
        // NOTE: frameloop must stay "always" (the default). The avatar pipeline animates every
        // frame — mixer, blink, gaze, lip-sync, spring bones — none of which call invalidate().
        // Under frameloop="demand" the whole avatar froze at rest and only ticked while the
        // camera was being dragged. (Review: docs/ANIMATION-SYSTEM-REVIEW.md, C2.)
        performance={{
          min: capabilities.isMobile ? 0.5 : 0.75, // Lower threshold on mobile
          max: 1,
        }}
      >
        <SceneContent
          sceneConfig={sceneConfig}
          visemeService={visemeService}
          emoteService={emoteService}
          animationService={animationService}
          ttsService={ttsService}
          store={store}
          webGPUEnabled={webGPUEnabled}
          quality={quality}
          capabilities={capabilities}
          worldGroupRef={worldGroupRef}
          worldScale={worldScale}
          setRecenterHandler={(fn) => {
            recenterSceneRef.current = fn
          }}
        />
      </Canvas>
    </div>
  )
}

const Scene3DWithWebGL = (props: Scene3DProps) => (
  <WebGLGate>
    <Scene3DComponent {...props} />
  </WebGLGate>
)

// Memoize the component to prevent re-renders when services don't change
export const Scene3D = memo(Scene3DWithWebGL)
