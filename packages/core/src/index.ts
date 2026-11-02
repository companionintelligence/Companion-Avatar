// Services - LLM
export { useLLMService } from './services/llm/llmService'
export * from './services/llm/llmTypes'
export { defaultLLMConfig, SYSTEM_PROMPT, AVAILABLE_LOCAL_MODELS } from './services/llm/config/llmConfig'
export type { ActivationState, LLMConfig, LLMProvider } from './services/llm/config/llmConfig'

// Services - TTS (WhisperData is also in visemes, use tts version as canonical)
export { useTTSService } from './services/tts/ttsService'
export { defaultTTSConfig } from './services/tts/ttsConfig'
export { createSyntheticSpeechWav, syntheticSpeechDuration } from './services/tts/syntheticSpeech'
export type { TTSConfig, WhisperData } from './services/tts/ttsConfig'

// Services - STT
export { useSTTService } from './services/stt/sttService'
export { defaultSTTConfig } from './services/stt/sttConfig'
export type { STTConfig } from './services/stt/sttConfig'

// Services - VAD
export { useVADService } from './services/vad/vadService'
export { defaultVadConfig } from './services/vad/vadConfig'
export type { VADConfig } from './services/vad/vadConfig'

// Services - Visemes (skip WhisperData to avoid duplicate)
export { visemesSequence, convertToVRMTarget } from './services/visemes/visemesService'
export { useVisemeService } from './services/visemes/useVisemeService'
export { AudioLipSync } from './services/visemes/audioLipSync'
export type { AudioLipSyncState } from './services/visemes/audioLipSync'
export { PhonemeTimingEngine, blendAudioAndText } from './services/visemes/phonemeTiming'
export { ARKIT_LIP_SYNC_TARGETS, VISEME_WEIGHTS, getVisemeForChar, getVisemeWeights } from './services/visemes/visemeTable'
export type { VisemeId, VisemeWeights } from './services/visemes/visemeTable'
export type { VisemeState, VisemeTarget, VRMVisemeTarget, VisemeSequenceItem } from './services/visemes/visemeTypes'

// Services - Emote & Dynamics
export { AvatarDynamicsEngine } from './services/emote/avatarDynamics'
export type { DynamicsOutput, DynamicsUpdateParams } from './services/emote/avatarDynamics'

// Services - Emote
export {
  initializeEmoteState,
  resetEmoteState,
  applyEmotion,
  emoteUpdate,
  startPerformance,
  handleBargeIn,
  applyEmoteStateToVRM,
  setupEmoteStateForVRM
} from './services/emote/emoteService'
export { useEmoteService } from './services/emote/useEmoteService'
export type { EmoteState, EmotionType, PerformanceData, EmoteResult, FacialTarget } from './services/emote/emoteTypes'

// Services - Animation
export * from './services/animation/animationService'
export { useAnimationService } from './services/animation/useAnimationService'
export type { AnimationState, AnimationClip, AnimationPerformanceData } from './services/animation/animationTypes'

// Services - Conversation
export { useConversationService } from './services/conversation/useConversationService'
export type { ConversationMessage, ConversationState } from './services/conversation/conversationType'

// Services - Agent
export { useAgent } from './services/useAgent'
export type { AgentService, AgentConfig, AgentCallbacks } from './services/useAgent'

// Services - Talk live (the LiveKit character agent; off unless VITE_TALK_ENABLED=true)
export { TalkError, describeTalkReason, startTalk, stopTalk, talkAnalyser } from './services/talk/talkService'
export type { TalkReason, TalkSnapshot, TalkState } from './services/talk/talkService'
export { useTalkService } from './services/talk/useTalkService'
export type { TalkControls } from './services/talk/useTalkService'

// Components - Scene
export { Scene3D } from './components/scene/Scene3D'
export { Viewport3D } from './components/scene/Viewport3D'
export { sceneConfig } from './components/scene/sceneTypes'
export type { SceneConfig } from './components/scene/sceneTypes'
export { AvatarModel } from './components/scene/avatar/AvatarModel'
export { AvatarState } from './components/scene/avatar/avatarState'
export {
  appendMessage,
  clearConversation,
  loadConversation,
  type StoredMessage
} from './services/conversation/conversationStore'
export {
  budgetHistory,
  estimateTokens,
  willTrim,
  type BudgetedMessage
} from './services/conversation/historyBudget'
export {
  ConversationStatusState,
  setConversationStatus,
  type ConversationStatus
} from './services/conversation/conversationStatus'
export { AvatarOptions } from './components/scene/avatar/AvatarOptions'
export { AvatarStatusPill } from './components/avatar/AvatarStatusPill'
export type { AvatarStatusPillProps, AvatarConversationStatus } from './components/avatar/AvatarStatusPill'
export { AvatarCaptionOverlay } from './components/avatar/AvatarCaptionOverlay'
export type { AvatarCaptionOverlayProps } from './components/avatar/AvatarCaptionOverlay'
export { AvatarLightingRig } from './components/avatar/AvatarLightingRig'
export type { AvatarLightingPreset } from './components/avatar/AvatarLightingRig'
export { AVATAR_SIZE_SCALES, resolveAvatarScale } from './components/avatar/avatarSizing'
export type { AvatarSizePreset } from './components/avatar/avatarSizing'
export type { SceneActions } from './components/scene/Scene3D'
// Re-exported so consumers that don't depend on @react-three/xr directly (apps/vision-pro)
// can still type the store that ControlOverlay/Viewport3D require.
export type { XRStore } from '@react-three/xr'
export { DatacenterDiorama } from './components/scene/environment/DatacenterDiorama'
export { DioramaProps } from './components/scene/environment/DioramaProps'
export type { DioramaPropName } from './components/scene/environment/DioramaProps'
export { ENVIRONMENT_PRESETS } from './components/scene/environment/environmentTypes'
export type { EnvironmentPreset } from './components/scene/environment/environmentTypes'

// Animation catalogs (skeleton-aware clip lookup for consumers/harness)
export {
  ANIMATION_CLIPS,
  VRMA_CLIPS,
  GLB_CLIPS,
  getAvatarCatalog,
  getIdleClip,
  getGreetClip,
  getClipsByCategory,
  getRandomClip
} from './services/animation/config/animationClips'

// Components - Chat
export { ChatOverlay } from './components/chat/ChatOverlay'
export { ChatPanel } from './components/chat/ChatPanel'
export { ChatInput } from './components/chat/ChatInput'
export { ChatBubble } from './components/chat/ChatBubble'

// Components - Common
export { LogoOverlay } from './components/common/LogoOverlay'
export { ControlButton } from './components/common/ControlButton'
export { ToggleButton } from './components/common/ToggleButton'
export { Tooltip } from './components/common/Tooltip'
export { OnboardingOverlay } from './components/common/OnboardingOverlay'

// Components - Control
export { ControlOverlay } from './components/control/ControlOverlay'
export { ControlPanel } from './components/control/ControlPanel'
export { XRControlPanel } from './components/control/XRControlPanel'
export type { XRControlAction } from './components/control/XRControlPanel'

// Components - Debug (presentational, prop-driven visualizers for design review)
export { VisemeMeter } from './components/debug/VisemeMeter'
export type { VisemeMeterProps } from './components/debug/VisemeMeter'
export { EmotePalette, EMOTIONS } from './components/debug/EmotePalette'
export type { EmotePaletteProps } from './components/debug/EmotePalette'
export { BlendTimeline } from './components/debug/BlendTimeline'
export type { BlendTimelineProps } from './components/debug/BlendTimeline'

// Theme
export { ThemeProvider, useTheme } from './theme/ThemeProvider'
export type { Theme } from './theme/ThemeProvider'

// App utilities
export { AppConfigState, initialAppConfig } from './app/appConfig'
export type { AppConfig, AppState } from './app/appConfig'
export { useResponsiveLayout } from './app/layoutService'

// Runtime configuration
export { loadRuntimeConfig, __resetRuntimeConfigCache } from './config/runtimeConfig'
export { apiUrl } from './config/apiBase'
export { resolveSTTConfig, resolveTTSConfig } from './config/appConfigService'
export { transcribeRemote } from './services/stt/remoteStt'
export { getAudioGraph, resumeAudioGraph, setVoicePosition } from './services/tts/audioGraph'
export { STTSettingsState, TTSSettingsState } from './config/settingsStore'
export type { RuntimeAppConfig } from './config/runtimeConfig'
export {
  resolveLLMConfig,
  readLocalOverrides,
  writeLocalOverrides,
  clearLocalOverrides,
  LLM_OVERRIDES_KEY
} from './config/appConfigService'
export { LLMSettingsState } from './config/settingsStore'
export { SettingsPanel } from './components/control/SettingsPanel'

// Utils
export { useHasWebGPU } from './utils/useHasWebGPU'
export { useXRLayout } from './utils/useXRLayout'

// Platform — surface detection + per-surface render presets (multi-platform seam)
export { detectSurfaceSync, isSpatial, SPATIAL_SURFACES } from './platform/surface'
export type { Surface } from './platform/surface'
export { detectCapabilities } from './platform/capabilities'
export type { Capabilities } from './platform/capabilities'
export { presetFor } from './platform/presets'
export type { RenderPreset } from './platform/presets'

// Integration
export { 
  shouldTriggerBargeIn, 
  detectEmotionFromText,
  createPerformanceFromMessage,
  emotionIntegrationService 
} from './integration/emotionIntegration'
export { reactionIntegrationService } from './integration/reactionIntegration'

// Face — capability-tiered facial-animation model (VRM-standard → ARKit-52 → FACS → MetaHuman)
export {
  detectFacialTier,
  describeFacialTier,
  FACIAL_TIERS,
  ARKIT_52,
  OCULUS_VISEMES,
  VRM_STANDARD_EXPRESSIONS
} from './services/face/facialTiers'
export type { FacialTier, FacialTierId } from './services/face/facialTiers'
export { inspectFacialRig, facialNamesFromVRM, facialNamesFromScene } from './services/face/facialCapabilities'
export type { FacialRigInfo } from './services/face/facialCapabilities'

// Face compositing — the single arbiter of facial weights, plus the harness seam.
export { createFaceRig, NULL_FACE_RIG } from './services/face/faceRigFactory'
export {
  getActiveFacialRig,
  getFaceCompositorTrace,
  getFaceOverride,
  getFaceSpeechDebug,
  resetActiveFace,
  setActiveFaceCompositor,
  setActiveFacialRig,
  setFaceOverride
} from './services/face/faceCompositorRegistry'
export { translateEmoteTargets } from './services/face/emoteVocabulary'
export { selectSpeechSource, isSequenceActive } from './services/face/speechSource'

// Conversational latency instrumentation.
export {
  LATENCY_BUDGETS_MS,
  beginTurn,
  getLastLatencyTrace,
  getLatencyTrace,
  mark as markLatency,
  overBudget,
  type LatencyStage,
  type LatencyTrace
} from './services/telemetry/latency'
