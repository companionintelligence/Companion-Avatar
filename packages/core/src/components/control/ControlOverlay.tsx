import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { ToggleButton } from '../common/ToggleButton'
import type { XRStore } from '@react-three/xr'
import { AppConfigState, type AppConfig } from '../../app/appConfig'
import type { AgentService } from '../../services/useAgent'
import type { ActivationState } from '../../services/llm/config/llmConfig'
import { ControlPanel } from './ControlPanel'
import { SettingsPanel } from './SettingsPanel'
import type { SceneActions } from '../scene/Scene3D'
import { useXRLayout } from '../../utils/useXRLayout'
import { describeTalkReason } from '../../services/talk/talkService'
import { useTalkService } from '../../services/talk/useTalkService'

interface ControlOverlayProps {
  config: AppConfig
  handleAppStateChange: (newAppState: AppConfig) => void
  agent: AgentService
  xrStore: XRStore | null
  sceneActions?: SceneActions | null
  activationState?: ActivationState
  onActivationStateChange?: (state: ActivationState) => void
  /** Controlled open state of the panel. Leave both props out to let the overlay own the state. */
  controlsOpen?: boolean
  onControlsOpenChange?: (open: boolean) => void
}


/** Button text for each talk state. While connecting or live, the same button cancels or ends the conversation. */
const TALK_LABELS = {
  idle: 'Talk live',
  connecting: 'Cancel',
  live: 'End talk',
  ended: 'Talk again',
  error: 'Talk live'
} as const

export const ControlOverlay = memo(({
  config,
  handleAppStateChange,
  agent,
  xrStore,
  sceneActions,
  activationState,
  onActivationStateChange,
  controlsOpen,
  onControlsOpenChange
}: ControlOverlayProps) => {
  const [openState, setOpenState] = useState(true)
  const isButtonsVisible = controlsOpen ?? openState
  const setIsButtonsVisible = onControlsOpenChange ?? setOpenState
  const [showSettings, setShowSettings] = useState(false)
  const [xrMode, setXrMode] = useState<XRSessionMode | null>(null)
  const [xrSessionActive, setXrSessionActive] = useState(false)
  const [xrSupport, setXrSupport] = useState({ ar: false, vr: false })
  const { isXR } = useXRLayout()
  const talk = useTalkService()
  
  const handleEnterARMode = useCallback(() => {
    if (!xrStore) return
    xrStore.enterAR().then(() => {
      AppConfigState.set((prev) => ({ ...prev, microphone: true }))
      agent.actions.setSTTDesired(true)
    })
    console.log('AR + STT mode activated - click the AR button in the 3D view to enter AR')
  }, [xrStore, agent.actions])

  const handleEnterVRMode = useCallback(() => {
    if (!xrStore) return
    xrStore.enterVR().then(() => {
      AppConfigState.set((prev) => ({ ...prev, microphone: true }))
      agent.actions.setSTTDesired(true)
    })
    console.log('VR + STT mode activated - click the VR button in the 3D view to enter VR')
  }, [xrStore, agent.actions])

  const handleExitXR = useCallback(() => {
    const session = xrStore?.getState().session
    session?.end()
  }, [xrStore])

  const handleRecenter = useCallback(() => {
    sceneActions?.recenter()
  }, [sceneActions])

  const handleScaleUp = useCallback(() => {
    sceneActions?.scaleBy(0.1)
  }, [sceneActions])

  const handleScaleDown = useCallback(() => {
    sceneActions?.scaleBy(-0.1)
  }, [sceneActions])

  useEffect(() => {
    if (!xrStore) return
    const unsub = xrStore.subscribe((state) => {
      setXrMode(state.mode)
      setXrSessionActive(!!state.session)
    })
    return () => {
      unsub()
    }
  }, [xrStore])

  useEffect(() => {
    let cancelled = false
    async function checkSupport() {
      if (!('xr' in navigator) || !navigator.xr?.isSessionSupported) {
        if (!cancelled) setXrSupport({ ar: false, vr: false })
        return
      }
      try {
        const [ar, vr] = await Promise.all([
          navigator.xr.isSessionSupported('immersive-ar'),
          navigator.xr.isSessionSupported('immersive-vr')
        ])
        if (!cancelled) setXrSupport({ ar, vr })
      } catch {
        if (!cancelled) setXrSupport({ ar: false, vr: false })
      }
    }
    checkSupport()
    return () => {
      cancelled = true
    }
  }, [])

  const xrStatusText = useMemo(() => {
    if (xrSessionActive) return `XR: active (${xrMode || 'unknown'})`
    if (xrSupport.ar || xrSupport.vr) return 'XR: ready'
    return 'XR: unavailable'
  }, [xrSessionActive, xrMode, xrSupport])
  return (
    <>
      {/* Control Buttons */}
      <ControlPanel
        config={config} 
        isRecording={config.microphone}
        handleAppStateChange={handleAppStateChange}
        onEnterARMode={handleEnterARMode}
        onEnterVRMode={handleEnterVRMode}
        onExitXR={handleExitXR}
        onRecenter={handleRecenter}
        onScaleUp={handleScaleUp}
        onScaleDown={handleScaleDown}
        onOpenSettings={() => setShowSettings(true)}
        xrStatusText={xrStatusText}
        xrCanEnterAR={xrSupport.ar}
        xrCanEnterVR={xrSupport.vr}
        vadDetecting={agent.state.vadIsDetecting}
        ttsActive={agent.state.ttsIsSpeaking}
        isVisible={isButtonsVisible}
      />

      {/* Controls Toggle Button */}
      <ToggleButton
        isVisible={isButtonsVisible}
        onToggle={() => setIsButtonsVisible(!isButtonsVisible)}
        label={"Controls"}
        position="bottom-left"
        size={isXR ? 44 : 32}
      />

      {/* Connection settings */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        activationState={activationState}
        onActivationStateChange={onActivationStateChange}
      />

      {/* Talk live: a conversation with the companion's voice agent. Off unless the build sets VITE_TALK_ENABLED=true. */}
      {import.meta.env.VITE_TALK_ENABLED === 'true' && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(1rem + env(safe-area-inset-top))',
            right: 'calc(1rem + env(safe-area-inset-right))',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '0.25rem'
          }}
        >
          <button
            type="button"
            onClick={talk.state === 'live' || talk.state === 'connecting' ? talk.stop : talk.start}
            style={{
              padding: '0.5rem 0.875rem',
              borderRadius: '9999px',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              fontWeight: 600,
              background: 'var(--xr-glass-bg)',
              backdropFilter: 'blur(var(--xr-glass-blur))',
              border: '0.0625rem solid var(--xr-glass-border)',
              color: 'var(--card-foreground)'
            }}
          >
            {TALK_LABELS[talk.state]}
          </button>
          <span role="status" style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
            {describeTalkReason(talk.reason)}
          </span>
        </div>
      )}
    </>
  )
})
