import type { XRStore } from '@react-three/xr'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSimpleStore } from '@hexafield/simple-store/react'
import { ConversationMachine, toDisplayStatus } from '@ci-avatar/engine'

import {
  Viewport3D,
  AvatarCaptionOverlay,
  AvatarStatusPill,
  ChatOverlay,
  ChatPanel,
  LogoOverlay,
  ControlOverlay,
  OnboardingOverlay,
  useAgent,
  useResponsiveLayout,
  AppConfigState,
  type AppConfig,
  defaultVadConfig,
  defaultSTTConfig,
  defaultLLMConfig,
  LLMSettingsState,
  STTSettingsState,
  TTSSettingsState,
  sceneConfig,
  useHasWebGPU,
  type SceneActions,
  type EnvironmentPreset,
  type ActivationState,
  setConversationStatus,
  type AvatarConversationStatus
} from '@ci-avatar/core'

import { rememberOnboarded, wasOnboarded } from './lib/onboardingFlag'

// Module-local: only `App` is imported from this file (see main.tsx).
const config = {
  vad: defaultVadConfig,
  stt: defaultSTTConfig,
  llm: defaultLLMConfig
}

// Opens the microphone once, so the OS permission prompt appears from the Enable Mic tap. The
// stream is released at once: the voice pipeline opens its own later. False if declined or no mic.
async function requestMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch {
    return false
  }
}

// ?env=datacenter-1970s opts into the 1970s research-datacenter environment around the
// avatar (see @ci-avatar/core's DatacenterDiorama). Default stays the plain studio view.
function resolveEnvironmentOverride(): EnvironmentPreset | undefined {
  const raw = new URLSearchParams(location.search).get('env')
  if (raw === 'datacenter-1970s' || raw === 'datacenter1970s') return 'datacenter-1970s'
  if (raw === 'none') return 'none'
  return undefined
}

export const App = () => {
  const { isMobile } = useResponsiveLayout()

  const activeSceneConfig = useMemo(() => {
    const environment = resolveEnvironmentOverride()
    return environment ? { ...sceneConfig, environment } : sceneConfig
  }, [])

  const xrStore = useRef<XRStore | null>(null)
  const [appState, setAppState] = useSimpleStore(AppConfigState)
  // Phones start with the controls collapsed, so the voice status pill has room beside the Controls toggle. The
  // open control bar covers that corner at every width, so the pill hides while the bar is open. Once the user
  // toggles the bar, their choice wins over the default.
  const [controlsOverride, setControlsOverride] = useState<boolean | null>(null)
  const controlsOpen = controlsOverride ?? !isMobile
  const [llmSettings] = useSimpleStore(LLMSettingsState)
  const [ttsSettings] = useSimpleStore(TTSSettingsState)
  const [sttSettings] = useSimpleStore(STTSettingsState)
  const [sceneActions, setSceneActions] = useState<SceneActions | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activationState, setActivationState] = useState<ActivationState>('unverified')
  const setXRStore = useCallback((store: XRStore) => {
    xrStore.current = store
  }, [])

  const agentConfig = useMemo(
    () => ({
      ...config,
      // Live LLM config resolved from runtime /config.json + user overrides.
      llm: {
        ...llmSettings,
        activation_state: activationState
      },
      // Live voice config, same precedence as the LLM: an appliance pointed at
      // its HeadTTS sidecar gets phoneme-accurate lip-sync with no rebuild.
      tts: ttsSettings,
      stt: sttSettings,
      autoSubmitEnabled: appState.autoSubmitEnabled,
      bargeInEnabled: appState.bargeInEnabled,
      vad: {
        ...config.vad,
        microphoneEnabled: appState.microphone
      }
    }),
    [activationState, appState.autoSubmitEnabled, appState.bargeInEnabled, appState.microphone, llmSettings, ttsSettings, sttSettings]
  )

  const agent = useAgent(agentConfig)

  const handleAppStateChange = useCallback((newAppState: AppConfig) => {
    setAppState(newAppState)
  }, [setAppState])

  const hasWebGPU = useHasWebGPU()
  const webGPUEnabled = appState.webGPUEnabled && hasWebGPU
  const [voiceStatus, setVoiceStatus] = useState<AvatarConversationStatus>('idle')
  const [voiceCaption, setVoiceCaption] = useState('')
  const [voiceAnalyser, setVoiceAnalyser] = useState<AnalyserNode | undefined>(undefined)

  /**
   * The conversation's declared state machine.
   *
   * The polling below is a SENSOR — it reads whether TTS is producing audio,
   * whether the LLM is in flight, whether a mic is open. It used to also be the
   * decision, via a priority cascade of booleans, which is how combinations that
   * should be impossible ("speaking" with no turn in flight, "thinking" forever
   * after an error) became reachable. The sensor now raises EVENTS and the
   * machine decides; illegal sequences are dropped and counted rather than
   * producing a wrong avatar state.
   */
  const machineRef = useRef(new ConversationMachine())
  const sensedRef = useRef({ speaking: false, thinking: false, listening: false })

  // TTS uses refs for frame-rate-sensitive state, so poll the small presentation
  // surface instead of forcing the render loop to become React stateful.
  useEffect(() => {
    const updateVoiceSurface = () => {
      const speechInfo = agent.services.tts.actions.getCurrentSpeechInfo()
      const isSpeaking = Boolean(speechInfo.text)
      const isThinking = agent.state.llmThinking
      const isListening = agent.state.vadIsListening || agent.state.sttIsListening

      // Edges, not levels: the machine wants "audio started", not "audio is on".
      const machine = machineRef.current
      const was = sensedRef.current
      if (isListening && !was.listening) machine.send('MIC_OPENED')
      if (isThinking && !was.thinking) machine.send('USER_SUBMITTED')
      if (isSpeaking && !was.speaking) machine.send('AUDIO_STARTED')
      if (!isSpeaking && was.speaking) machine.send('AUDIO_ENDED')
      if (!isListening && was.listening && !isThinking && !isSpeaking) machine.send('MIC_CLOSED')
      sensedRef.current = { speaking: isSpeaking, thinking: isThinking, listening: isListening }

      // `loading` is a model-download concern, not a conversational state, so it
      // sits outside the machine and simply outranks it in presentation.
      const nextStatus: AvatarConversationStatus = agent.state.llmLoading
        ? 'loading'
        : toDisplayStatus(machine.current)
      setVoiceStatus(nextStatus)
      // Share it with the avatar's dynamics engine, not just the status pill.
      setConversationStatus(nextStatus)
      setVoiceAnalyser(agent.services.tts.actions.getAnalyser())
      setVoiceCaption(isSpeaking ? speechInfo.text : agent.state.currentTranscript)
    }
    updateVoiceSurface()
    const timer = window.setInterval(updateVoiceSurface, 100)
    return () => window.clearInterval(timer)
  }, [
    agent.services.tts.actions,
    agent.state.currentTranscript,
    agent.state.llmLoading,
    agent.state.llmThinking,
    agent.state.sttIsListening,
    agent.state.vadIsListening
  ])

  useEffect(() => {
    if (!wasOnboarded()) {
      setShowOnboarding(true)
    }
  }, [])

  const handleEnableMic = useCallback(() => {
    // Ask from this tap, so the permission prompt answers the button. A declined prompt still opens
    // the app, on text chat with the microphone off.
    void requestMicrophone().then((granted) => {
      AppConfigState.set((prev) => ({ ...prev, microphone: granted }))
      setShowOnboarding(false)
      rememberOnboarded()
    })
  }, [])

  const handleSkipOnboarding = useCallback(() => {
    setShowOnboarding(false)
    setActivationState(llmSettings.llm_provider === 'script' ? 'demo-only' : 'unverified')
    rememberOnboarded()
  }, [llmSettings.llm_provider])

  return (
    <div className="app-container">
      <div className="viewport-container">
        <Viewport3D
          sceneConfig={activeSceneConfig}
          visemeService={agent.services.visemes}
          emoteService={agent.services.emotes}
          animationService={agent.services.animations}
          ttsService={agent.services.tts}
          setXRStore={setXRStore}
          onSceneActionsReady={setSceneActions}
          webGPUEnabled={webGPUEnabled}
        />
        <AvatarStatusPill
          status={voiceStatus}
          analyser={voiceAnalyser}
          micError={!agent.state.sttAllowed ? 'Microphone access is unavailable' : null}
          showWaveform={!isMobile}
          style={controlsOpen ? { display: 'none' } : { left: 'calc(10rem + env(safe-area-inset-left))', bottom: 'calc(1.25rem + env(safe-area-inset-bottom))', maxWidth: 'calc(100% - 10rem - 1.25rem)' }}
          onPillClick={() => {
            agent.actions.toggleMicrophone(true)
            agent.actions.startVADListening()
          }}
          onStopClick={() => {
            agent.actions.stopSpeaking()
            agent.actions.stopVADListening()
            agent.actions.toggleMicrophone(false)
          }}
        />
        <AvatarCaptionOverlay
          visible={voiceStatus === 'listening' || voiceStatus === 'speaking'}
          text={voiceCaption}
          speaker={voiceStatus === 'listening' ? 'user' : 'avatar'}
        />
        <LogoOverlay />
        <ChatOverlay config={appState} agent={agent} />
        <ControlOverlay
          config={appState}
          handleAppStateChange={handleAppStateChange}
          agent={agent}
          xrStore={xrStore.current}
          sceneActions={sceneActions}
          activationState={activationState}
          controlsOpen={controlsOpen}
          onControlsOpenChange={setControlsOverride}
          onActivationStateChange={setActivationState}
        />
        <ChatPanel
          messages={agent.state.messages.map((id) => 
            agent.services.conversation.actions.getMessagebyId(id)
          )}
          activationState={activationState}
        />
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
