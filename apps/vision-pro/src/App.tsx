import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSimpleStore } from '@hexafield/simple-store/react'
import { ConversationMachine, toDisplayStatus } from '@ci-avatar/engine'

import {
  Viewport3D,
  ChatOverlay,
  ChatPanel,
  LogoOverlay,
  ControlOverlay,
  OnboardingOverlay,
  useAgent,
  useRememberedConnection,
  useResponsiveLayout,
  AppConfigState,
  LLMSettingsState,
  TTSSettingsState,
  STTSettingsState,
  setConversationStatus,
  type AppConfig,
  defaultVadConfig,
  defaultTTSConfig,
  defaultSTTConfig,
  defaultLLMConfig,
  sceneConfig,
  useHasWebGPU,
  detectSurfaceSync,
  presetFor,
  type SceneActions,
  type XRStore,
  type ActivationState,
  type ConversationStatus,
  type LLMConfig,
  type TTSConfig,
  type STTConfig
} from '@ci-avatar/core'

// Surface-aware render budget: on the WebSpatial Vision Pro container the UA matches
// `visionOS|WebSpatial`, so this resolves to the vision-pro preset (DPR 1, foveation).
// The same build falls back to desktop/mobile presets elsewhere.
const surface = detectSurfaceSync()
const renderPreset = presetFor(surface)
const isSpatial = surface === 'vision-pro'

// Module-local: only `App` is imported from this file (see main.tsx).
const config = {
  vad: defaultVadConfig,
  tts: defaultTTSConfig,
  stt: defaultSTTConfig,
  llm: defaultLLMConfig
}

/**
 * Depth, in points, at which a 2D panel floats in front of the volume's back plane.
 *
 * On visionOS a plain overlay composites INTO the same plane as the avatar, so the
 * chat sat on the avatar's face like a sticker. `enable-xr` promotes an element to
 * its own spatial layer and `--xr-back` sets how far back it sits, which is what
 * turns overlays into panels you can look past. Off-device the attribute is inert
 * and the CSS variable is unused, so the browser build is unchanged.
 */
const PANEL_DEPTH = { chat: 24, controls: 40, logo: 8 } as const

const ONBOARDED_KEY = 'ci_avatar_onboarded'

/**
 * The browser's storage, or nothing when there is none or it cannot be reached: in a document
 * sandboxed without allow-same-origin, or with site data blocked, merely reading `localStorage`
 * throws a SecurityError, and `typeof localStorage` does not protect against that.
 */
function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Unreadable storage counts as not onboarded, so the overlay shows. */
function hasOnboarded(): boolean {
  try {
    return Boolean(storage()?.getItem(ONBOARDED_KEY))
  } catch {
    return false
  }
}

function markOnboarded(): void {
  try {
    storage()?.setItem(ONBOARDED_KEY, 'true')
  } catch {
    // Full or blocked storage: the overlay shows again next visit, which is harmless.
  }
}

export const App = () => {
  useResponsiveLayout()

  const xrStore = useRef<XRStore | null>(null)
  const [appState, setAppState] = useSimpleStore(AppConfigState) as [AppConfig, (value: AppConfig) => void]
  // Runtime config resolved in main.tsx from /config.json, with user overrides on top.
  //
  // The casts match the AppConfigState line above: under this package's module
  // resolution `useSimpleStore` infers a union of value-and-setter rather than a
  // tuple, so every read of a field fails to typecheck. It is a pre-existing quirk
  // here (packages/core's own SettingsPanel hits it too), not a claim about the
  // runtime shape.
  const [llmSettings] = useSimpleStore(LLMSettingsState) as [LLMConfig, (v: LLMConfig) => void]
  const [ttsSettings] = useSimpleStore(TTSSettingsState) as [TTSConfig, (v: TTSConfig) => void]
  const [sttSettings] = useSimpleStore(STTSettingsState) as [STTConfig, (v: STTConfig) => void]
  const [sceneActions, setSceneActions] = useState<SceneActions | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activationState, setActivationState] = useState<ActivationState>('unverified')
  // As in apps/web: no Check connection after a relaunch for the demo or a server checked before.
  useRememberedConnection(llmSettings, setActivationState)
  const setXRStore = useCallback((store: XRStore) => {
    xrStore.current = store
  }, [])

  const agentConfig = useMemo(
    () => ({
      ...config,
      llm: {
        ...llmSettings,
        activation_state: activationState
      },
      tts: ttsSettings,
      stt: sttSettings,
      autoSubmitEnabled: appState.autoSubmitEnabled,
      bargeInEnabled: appState.bargeInEnabled,
      vad: {
        ...config.vad,
        microphoneEnabled: appState.microphone
      }
    }),
    [
      activationState,
      appState.autoSubmitEnabled,
      appState.bargeInEnabled,
      appState.microphone,
      llmSettings,
      ttsSettings,
      sttSettings
    ]
  )

  const agent = useAgent(agentConfig)

  const handleAppStateChange = useCallback(
    (newAppState: AppConfig) => {
      setAppState(newAppState)
    },
    [setAppState]
  )

  const hasWebGPU = useHasWebGPU()
  // Honor the platform preset: some surfaces (e.g. Quest browser) have immature WebGPU,
  // so preferWebGPU gates the user toggle rather than forcing it everywhere.
  const webGPUEnabled = appState.webGPUEnabled && hasWebGPU && renderPreset.preferWebGPU

  /**
   * The conversation's declared state machine — see apps/web for the rationale.
   * Without it this app never told the avatar what the conversation was doing, so
   * every conversation-state behaviour in the dynamics engine (the listening lean,
   * the thinking gaze aversion) sat inert on the surface where presence matters most.
   */
  const machineRef = useRef(new ConversationMachine())
  const sensedRef = useRef({ speaking: false, thinking: false, listening: false })

  useEffect(() => {
    const tick = () => {
      const speechInfo = agent.services.tts.actions.getCurrentSpeechInfo()
      const isSpeaking = Boolean(speechInfo.text)
      const isThinking = agent.state.llmThinking
      const isListening = agent.state.vadIsListening || agent.state.sttIsListening

      const machine = machineRef.current
      const was = sensedRef.current
      if (isListening && !was.listening) machine.send('MIC_OPENED')
      if (isThinking && !was.thinking) machine.send('USER_SUBMITTED')
      if (isSpeaking && !was.speaking) machine.send('AUDIO_STARTED')
      if (!isSpeaking && was.speaking) machine.send('AUDIO_ENDED')
      if (!isListening && was.listening && !isThinking && !isSpeaking) machine.send('MIC_CLOSED')
      sensedRef.current = { speaking: isSpeaking, thinking: isThinking, listening: isListening }

      const status: ConversationStatus = agent.state.llmLoading
        ? 'loading'
        : toDisplayStatus(machine.current)
      setConversationStatus(status)
    }
    tick()
    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [
    agent.services.tts.actions,
    agent.state.llmLoading,
    agent.state.llmThinking,
    agent.state.sttIsListening,
    agent.state.vadIsListening
  ])

  useEffect(() => {
    if (!hasOnboarded()) {
      setShowOnboarding(true)
    }
  }, [])

  const handleEnableMic = useCallback(() => {
    AppConfigState.set((prev) => ({ ...prev, microphone: true }))
    agent.actions.initializeVAD()
    setShowOnboarding(false)
    markOnboarded()
  }, [agent.actions])

  const handleSkipOnboarding = useCallback(() => {
    setActivationState((current) =>
      current === 'unverified' && llmSettings.llm_provider === 'script' ? 'demo-only' : current
    )
    setShowOnboarding(false)
    markOnboarded()
  }, [llmSettings.llm_provider])

  // `enable-xr` is only meaningful inside the WebSpatial container; elsewhere it is
  // an unknown attribute the browser ignores. Applying it conditionally keeps the
  // plain-browser DOM identical to before.
  const spatial = (depth: number) =>
    isSpatial
      ? ({ 'enable-xr': true, style: { ['--xr-back' as string]: depth } } as Record<string, unknown>)
      : {}

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="relative h-screen w-full">
        <Viewport3D
          sceneConfig={sceneConfig}
          visemeService={agent.services.visemes}
          emoteService={agent.services.emotes}
          animationService={agent.services.animations}
          ttsService={agent.services.tts}
          setXRStore={setXRStore}
          onSceneActionsReady={setSceneActions}
          webGPUEnabled={webGPUEnabled}
        />
        <div {...spatial(PANEL_DEPTH.logo)}>
          <LogoOverlay />
        </div>
        <ChatOverlay config={appState} agent={agent} />
        <div {...spatial(PANEL_DEPTH.controls)}>
          <ControlOverlay
            config={appState}
            handleAppStateChange={handleAppStateChange}
            agent={agent}
            xrStore={xrStore.current}
            sceneActions={sceneActions}
            activationState={activationState}
            onActivationStateChange={setActivationState}
          />
        </div>
        <div {...spatial(PANEL_DEPTH.chat)}>
          <ChatPanel
            messages={agent.state.messages.map((id) =>
              agent.services.conversation.actions.getMessagebyId(id)
            )}
            activationState={activationState}
          />
        </div>
        <OnboardingOverlay
          isOpen={showOnboarding && !appState.microphone}
          onEnableMic={handleEnableMic}
          onSkip={handleSkipOnboarding}
          activationState={activationState}
          llmProvider={llmSettings.llm_provider}
          onActivationStateChange={setActivationState}
        />
      </div>
    </div>
  )
}
