import type { VRM } from '@pixiv/three-vrm'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAnimationService } from './animation/useAnimationService'
import { useConversationService } from './conversation/useConversationService'
import type { ConversationId, ConversationMessage } from './conversation/conversationType'
import type { EmotionType, PerformanceData } from './emote/emoteTypes'
import { useEmoteService } from './emote/useEmoteService'
import { useLLMService } from './llm/llmService'
import type { LLMPerformRequest, LLMResponse, LLMStatusUpdate } from './llm/llmTypes'
import { createReactionFromMessage } from '../integration/reactionIntegration'
import { useSTTService } from './stt/sttService'
import { useVADService } from './vad/vadService'
import { useTTSService } from './tts/ttsService'
import { useVisemeService } from './visemes/useVisemeService'
import { defaultVadConfig, type VADConfig, type VADResult } from './vad/vadConfig'
import { defaultTTSConfig, type TTSConfig, type WhisperData } from './tts/ttsConfig'
import { defaultSTTConfig, type STTConfig } from './stt/sttConfig'
import { defaultLLMConfig, type LLMConfig } from './llm/config/llmConfig'
import { shouldTriggerBargeIn } from '../integration/emotionIntegration'
import { resetActiveFace } from './face/faceCompositorRegistry'
import { beginTurn, mark as markLatency } from './telemetry/latency'
import { transcribeRemote } from './stt/remoteStt'
import { GLB_ALL_CLIPS, VRMA_CLIPS } from './animation/config/animationClips'
import { moodConfigurations } from './emote/configs/moodConfigurations'
import { createCueParser, type CueEvent, type CueNames, type CueParseResult, type CueParser } from './cues/inlineCues'
import { buildWordStarts, scheduleCues, type ScheduledCue, type WordStart } from './cues/cueSchedule'
import { cleanText } from './tts/textUtils'

// STT service result interface (defined locally in sttService.ts)
interface STTPerformResult {
  text: string
  interrupt: number
  confidence: number
  spoken: boolean
  human: boolean
  comment: string
  rcounter: number
  bcounter: number
  final: boolean
  bargein: boolean
}

interface MorphTargetObject {
  morphTargetInfluences: number[]
}

// Configuration interfaces
export interface AgentConfig {
  // Audio/VAD configuration
  vad?: Partial<VADConfig>
  // TTS configuration
  tts?:  Partial<TTSConfig>
  // STT configuration
  stt?:  Partial<STTConfig>
  // LLM configuration
  llm?: Partial<LLMConfig>
  // App behavior configuration
  autoSubmitEnabled?: boolean
  bargeInEnabled?: boolean
}

// Callback interfaces
export interface AgentCallbacks {
  // VAD callbacks
  onVADResult?: (result: VADResult) => void
  onSpeechStart?: () => void
  onSpeechEnd?: (audio: ArrayBuffer) => void

  // STT callbacks
  onSTTResult?: (result: STTPerformResult) => void
  onInterimTranscript?: (text: string) => void

  // LLM callbacks
  onLLMStatus?: (status: LLMStatusUpdate) => void
  onLLMResponse?: (response: LLMResponse) => void

  // TTS callbacks
  onTTSSpeechStart?: (text: string, whisperData: WhisperData) => void
  onTTSSpeechEnd?: () => void

  // Conversation callbacks
  onMessageAdded?: (message: ConversationMessage) => void
  onMessageUpdated?: (messages: ConversationMessage[]) => void

  // General callbacks
  onError?: (error: Error) => void
}

// Return type for the hook
export interface AgentService {
  // State
  state: {
    // VAD state
    vadIsListening: boolean
    vadIsDetecting: boolean

    // STT state
    sttIsListening: boolean
    sttAllowed: boolean
    sttDesired: boolean
    currentTranscript: string

    // LLM state
    llmReady: boolean
    llmLoading: boolean
    llmThinking: boolean
    llmMessages: Array<{ role: string; content: string }>

    // TTS state
    ttsIsSpeaking: boolean
    ttsAudioQueue: number

    // Conversation state
    messages: ConversationId[]
  }

  // Actions
  actions: {
    // VAD actions
    startVADListening: () => void
    stopVADListening: () => void
    initializeVAD: () => void

    // STT actions
    startSTTListening: () => void
    stopSTTListening: () => void
    setSTTDesired: (desired: boolean) => void

    // LLM actions
    loadLLM: () => void
    processUserInput: (request: LLMPerformRequest) => void
    clearLLMHistory: () => void

    // TTS actions
    speak: (text: string) => Promise<number | null>
    stopSpeaking: () => void
    playAudioBuffer: (audioBuffer: ArrayBuffer) => Promise<void>
    getTTSQueueStatus: () => {
      queueLength: number
      isProcessing: boolean
      nextExpectedId: number
      messages: Array<{ id: number; status: string; text: string }>
    }

    // Chat actions
    addMessage: (text: string, isUser: boolean) => void
    streamMessage: (fragment: string, finished: boolean) => void
    clearAllMessages: () => void
    getMessagebyId: (id: ConversationId) => ConversationMessage

    // Convenience actions  
    submitMessage: (message: string) => void
    toggleMicrophone: (isRecording: boolean) => void
    triggerBargein: () => void

    // Viseme actions (for external avatar control)
    setupVisemesForVRM: (vrm: VRM) => void
    setupVisemesForMorphTargets: (morphs: MorphTargetObject[], dictionary: Record<string, number[]>) => void
    updateVisemes: (_delta: number) => void
    applyVisemesToRig: (_delta: number, amplify?: number) => void
    resetVisemes: () => void

    // Emote actions (for external avatar control)
    setupEmotesForVRM: (vrm: VRM) => void
    setupEmotesForMorphTargets: (morphs: MorphTargetObject[], dictionary: Record<string, number[]>) => void
    setEmotion: (emotion: EmotionType) => void
    performAction: (performanceData: PerformanceData) => void
    triggerGaze: () => void
    updateEmotes: (_delta: number) => void
    applyEmotesToVRM: (vrm: VRM) => void
    applyEmotesToMorphTargets: (morphs: MorphTargetObject[], dictionary: Record<string, number[]>) => void
    resetEmotes: () => void
    onEmoteBargein: () => void
  }

  // Service instances (for advanced usage)
  services: {
    conversation: ReturnType<typeof useConversationService>
    vad: ReturnType<typeof useVADService>
    stt: ReturnType<typeof useSTTService>
    llm: ReturnType<typeof useLLMService>
    tts: ReturnType<typeof useTTSService>
    visemes: ReturnType<typeof useVisemeService>
    emotes: ReturnType<typeof useEmoteService>
    animations: ReturnType<typeof useAnimationService>
  }
}

/**
 * Sample rate the VAD emits. `@ricky0123/vad-web` resamples to 16 kHz for Silero
 * regardless of the device's own rate, and the transcript is garbage if the
 * server is told the wrong one.
 */
const VAD_SAMPLE_RATE = 16000

// Default app behavior configuration
const defaultAppConfig = {
  autoSubmitEnabled: true,
  bargeInEnabled: true
}

/**
 * What a cue tag may name. A gesture is any clip in either skeleton catalog that plays once: an avatar
 * plays only the clips of its own catalog, so a clip it does not carry does nothing, and a looping clip
 * (the idle loops, walking) would never end. An emote is any mood in the emote palette, which is what
 * applyEmotion accepts.
 */
const CUE_CLIPS = { ...VRMA_CLIPS, ...GLB_ALL_CLIPS }
const CUE_NAMES: CueNames = {
  gesture: Object.keys(CUE_CLIPS).filter((name) => CUE_CLIPS[name].loopCount !== Infinity),
  emote: Object.keys(moodConfigurations)
}

/** A breath of the reply, as it is handed to TTS, and the cues that are timed against it. */
interface CueBreath {
  /** The text as TTS reports it when it starts the breath. */
  spoken: string
  /** The speakable text. Word offsets are found in it. */
  text: string
  /** Where the breath starts in the reply, counted in speakable characters. */
  start: number
  cues: CueEvent[]
  startedAt: number | null
  wordStarts: WordStart[]
}

/** One assistant reply, from its first chunk to its final one. */
interface CueTurn {
  interrupt: number
  parser: CueParser
  /** Speakable characters emitted so far. */
  emitted: number
  /** Cues waiting for the breath that speaks the word after them. */
  queued: CueEvent[]
  /** Breaths handed to TTS that it has not started yet, in order. */
  awaiting: CueBreath[]
  /** The most recent breath. The cues at the very end of a reply belong to it. */
  last: CueBreath | null
  /** Timers of cues that have not fired yet. */
  timers: Set<ReturnType<typeof setTimeout>>
}

/** Clears the timers of cues that have not fired, and the cues still waiting for speech. */
const cancelCueTurn = (turn: CueTurn) => {
  for (const timer of turn.timers) clearTimeout(timer)
  turn.timers.clear()
  turn.queued = []
  turn.awaiting = []
  turn.last = null
}

/**
 * Unified agent hook that combines all conversational AI services
 *
 * This hook integrates VAD, STT, LLM, TTS, Visemes, and Emotes services
 * with automatic service coordination and state management.
 *
 * @param config - Configuration object for all services
 * @param callbacks - Callback functions for service events
 * @returns AgentService object with state, actions, and service instances
 */





export const useAgent = (config: AgentConfig = {}, callbacks: AgentCallbacks = {}): AgentService => {
  // Merge configurations with defaults
  const vadConfig = { ...defaultVadConfig, ...config.vad }
  const ttsConfig = { ...defaultTTSConfig, ...config.tts }
  const sttConfig = { ...defaultSTTConfig, ...config.stt }
  const llmConfig = useMemo(() => ({ ...defaultLLMConfig, ...config.llm }), [config.llm])
  const appConfig = {
    autoSubmitEnabled: config.autoSubmitEnabled ?? defaultAppConfig.autoSubmitEnabled,
    bargeInEnabled: config.bargeInEnabled ?? defaultAppConfig.bargeInEnabled
  }

  // Internal state
  const [currentInterimTranscript, setCurrentInterimTranscript] = useState('')
  const interruptCounterRef = useRef(performance.now())
  // The reply being streamed. A reaction is derived once per assistant message from its whole
  // text (M5), not per LLM breath, which arrive every ~1-3s. `interrupt` names the turn, so a
  // reply cut off by a barge-in never carries into the next one.
  const replyRef = useRef({ interrupt: -1, text: '' })

  // Initialize conversation service
  const conversation = useConversationService()

  // Initialize viseme and emote services
  const visemes = useVisemeService()
  const emotes = useEmoteService()
  const animations = useAnimationService()
  const onLLMStatus = callbacks.onLLMStatus
  const handleLLMStatus = useCallback(
    (status: LLMStatusUpdate) => {
      console.log('LLM status:', status)
      onLLMStatus?.(status)
    },
    [onLLMStatus]
  )

  // Cue tags. A cue is armed when TTS starts the breath that speaks the word after it, and it
  // fires at that word. The turn is kept in a ref so its timers outlive renders.
  const cueTurnRef = useRef<CueTurn | null>(null)

  const dispatchCue = (cue: ScheduledCue) => {
    if (cue.kind === 'emote') {
      emotes.actions.performAction({ emotion: cue.name as EmotionType })
      return
    }
    const clip = CUE_CLIPS[cue.name]
    // Immediate, not queued: the cue is timed to its word, so it plays as that word is spoken.
    if (clip) animations.actions.performAction({ clip, immediate: true })
  }

  const armCues = (turn: CueTurn, cues: CueEvent[], wordStarts: WordStart[], startedAt: number) => {
    for (const cue of scheduleCues(cues, wordStarts)) {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        turn.timers.delete(timer)
        dispatchCue(cue)
      }, Math.max(0, startedAt + cue.timeMs - Date.now()))
      turn.timers.add(timer)
    }
  }

  const cueTurnFor = (interrupt: number): CueTurn => {
    const current = cueTurnRef.current
    if (current?.interrupt === interrupt) return current
    // A new interrupt cuts the previous reply off, so its pending cues go with it.
    if (current) cancelCueTurn(current)
    const turn: CueTurn = {
      interrupt,
      parser: createCueParser(CUE_NAMES),
      emitted: 0,
      queued: [],
      awaiting: [],
      last: null,
      timers: new Set()
    }
    cueTurnRef.current = turn
    return turn
  }

  /** Returns the speakable text of a parsed chunk, and keeps its cues for the breath that speaks them. */
  const takeCueText = (turn: CueTurn, parsed: CueParseResult): string => {
    turn.queued.push(...parsed.cues)
    for (const tag of parsed.unknown) {
      console.warn(`Cue tag ${tag.kind}:${tag.name} is not a known ${tag.kind}, so it is dropped.`)
    }
    return parsed.text
  }

  /** Hands a breath to TTS. The cues that come before the next word are timed against it. */
  const speakCueBreath = (turn: CueTurn, text: string) => {
    const start = turn.emitted
    turn.emitted += text.length
    const spoken = cleanText(text)
    // Registered before TTS is given the text, so the speech start can never arrive first.
    if (spoken.trim()) {
      const end = turn.emitted
      const breath: CueBreath = {
        spoken,
        text,
        start,
        cues: turn.queued.filter((cue) => cue.offset < end),
        startedAt: null,
        wordStarts: []
      }
      turn.queued = turn.queued.filter((cue) => cue.offset >= end)
      turn.awaiting.push(breath)
      turn.last = breath
    }
    tts.actions.speak(text)
  }

  /** A cue at the very end of a reply has no word after it, so it fires with the last word. */
  const attachTrailingCues = (turn: CueTurn) => {
    const cues = turn.queued
    turn.queued = []
    if (cues.length === 0) return
    const breath = turn.last
    if (!breath) {
      // Nothing was spoken for the cues to wait on, so they fire at once. After a barge-in,
      // the cues of the cut-off speech are dropped instead.
      if (turn.emitted === 0) armCues(turn, cues, [], Date.now())
      return
    }
    if (breath.startedAt === null) breath.cues.push(...cues)
    else armCues(turn, cues, breath.wordStarts, breath.startedAt)
  }

  /** TTS has started an utterance: arms the cues of the breath it speaks, timed by its word timings. */
  const cueSpeechStarted = (text: string, whisperData: WhisperData) => {
    const turn = cueTurnRef.current
    const index = turn ? turn.awaiting.findIndex((breath) => breath.spoken === text) : -1
    if (!turn || index < 0) return
    const breath = turn.awaiting[index]
    // TTS speaks in order, so any breath ahead of this one was skipped and will not start.
    turn.awaiting.splice(0, index + 1)
    breath.startedAt = Date.now()
    breath.wordStarts = buildWordStarts(breath.text, breath.start, whisperData)
    armCues(turn, breath.cues, breath.wordStarts, breath.startedAt)
  }

  // Initialize LLM service
  const llmService = useLLMService({
    config: llmConfig,
    onStatus: handleLLMStatus,
    onResponse: (response: LLMResponse) => {
      // First token of the reply — the number that decides whether the companion
      // feels responsive or sluggish.
      markLatency('llm-first-token')

      // Cue tags are taken out of the stream before anything reads it. What is left is spoken,
      // shown and judged for emotion, and each cue is timed against the word after it.
      const turn = cueTurnFor(response.interrupt)
      const breath = takeCueText(turn, turn.parser.push(response.breath)) +
        (response.final ? takeCueText(turn, turn.parser.finish()) : '')
      if (breath) {
        speakCueBreath(turn, breath)
      }
      if (response.final) attachTrailingCues(turn)

      // One reaction per assistant message (M5). Breaths accumulate into the reply, and the
      // facial emote and body gesture fire once, when the reply is final. The final chunk can
      // carry no breath of its own, so it is handled outside the `if (breath)` above.
      const reply = replyRef.current
      if (reply.interrupt !== response.interrupt) {
        reply.interrupt = response.interrupt
        reply.text = ''
      }
      if (breath) reply.text += breath
      if (response.final) {
        const replyText = reply.text.trim()
        reply.text = ''
        if (replyText) {
          // Analyze the reply for emotional content and trigger the matching emote
          const message = {
            id: Date.now().toString(),
            text: replyText,
            isUser: false,
            timestamp: Date.now()
          }

          const { performance: emotePerf, animation } = createReactionFromMessage(
            message,
            conversation.state.messages.length
          )

          emotes.actions.performAction(emotePerf)
          // Queued, not immediate: the gesture starts once the clip now playing finishes, so it
          // never cuts a gesture short and does not depend on a wall-clock gap.
          if (animation) animations.actions.performAction({ ...animation, immediate: false })
        }
      }

      conversation.actions.streamMessage(breath, response.final)
      callbacks.onLLMResponse?.(response)
    }
  })

  // Initialize TTS service
  const tts = useTTSService({
    config: ttsConfig,
    onSpeechStart: (text: string, whisperData: WhisperData) => {
      cueSpeechStarted(text, whisperData)
      visemes.actions.generateSequence(whisperData)
      callbacks.onTTSSpeechStart?.(text, whisperData)
    },
    onSpeechEnd: () => {
      emotes.actions.reset()
      callbacks.onTTSSpeechEnd?.()
    }
  })

  // One coherent "stop everything from the previous turn" for a barge-in, shared by
  // the STT stop-word path and the explicit triggerBargein() action. Previously each
  // site only stopped TTS + relaxed emotes, so the avatar kept mouthing visemes (H5)
  // and any queued gesture kept playing (M20).
  const performBargeIn = useCallback(() => {
    // Stop speech: clears the queue AND the currently-playing audio (C1/H4).
    if (tts.state.isSpeaking) {
      tts.actions.stopSpeaking()
    }
    // Relax facial emotes back toward neutral.
    emotes.actions.onBargeIn()
    // Stop the avatar silently mouthing the rest of the interrupted sentence (H5).
    visemes.actions.reset()
    // Close the mouth on THIS frame rather than over the compositor's release
    // ramp: a barge-in that takes 200 ms to land reads as not being heard.
    resetActiveFace()
    // Drop any queued gesture performances from the interrupted turn (M20).
    animations.actions.clearQueue()
    // Cancel the cues the interrupted reply has not fired yet, so they do not play over the next one.
    if (cueTurnRef.current) cancelCueTurn(cueTurnRef.current)
  }, [tts.state.isSpeaking, tts.actions, emotes.actions, visemes.actions, animations.actions])

  // Initialize VAD service
  const vad = useVADService({
    config: vadConfig,
    onVADResult: (result) => {
      callbacks.onVADResult?.(result)
    },
    onSpeechStart: () => {
      // The user began speaking: this is when their turn starts, and every
      // latency number should be measured from here rather than from whenever
      // the transcript happened to finalize.
      beginTurn()
      callbacks.onSpeechStart?.()
    },
    onSpeechEnd: (audio: ArrayBuffer) => {
      callbacks.onSpeechEnd?.(audio)
      // Local transcription. The VAD has always captured this audio and dropped
      // it on the floor; with `stt.remote` on we send it to the appliance's own
      // Whisper instead of relying on webkitSpeechRecognition, which is
      // Chromium-only and streams the microphone to Google.
      if (!sttConfig.remote) return
      void transcribeRemote(audio, VAD_SAMPLE_RATE, {
        language: sttConfig.language.split('-')[0]
      }).then((result) => {
        if (!result.ok || !result.text) return
        markLatency('stt-final')
        const interrupt = Date.now()
        interruptCounterRef.current = interrupt
        conversation.actions.addMessage(result.text, true)
        llmService.actions.processUserInput({
          text: result.text,
          human: true,
          final: true,
          bargein: appConfig.bargeInEnabled,
          interrupt
        })
      })
    }
  })

  // Initialize STT service
  const stt = useSTTService({
    config: sttConfig,
    onPerform: (result) => {
      if (result.final) {
        const interrupt = Date.now()
        // Handle barge-in if detected
        if (shouldTriggerBargeIn({ text: result.text, isUser: true, id: '', timestamp: interrupt })) {
          performBargeIn()
          console.log('STT: Stop command detected - barge-in activated')
        }

        // Auto-submit or set interim transcript
        if (appConfig.autoSubmitEnabled) {
          conversation.actions.addMessage(result.text, true)
          setCurrentInterimTranscript('')
        } else {
          setCurrentInterimTranscript(result.text)
        }

        markLatency('stt-final')
        interruptCounterRef.current = interrupt
        llmService.actions.processUserInput({
          text: result.text,
          human: true,
          final: true,
          bargein: appConfig.bargeInEnabled,
          interrupt
        })
      } else {
        setCurrentInterimTranscript(result.text)
      }

      console.log('STT: result:', result)
      callbacks.onSTTResult?.(result)
    },
    onInterimTranscript: (text) => {
      setCurrentInterimTranscript(text)
      callbacks.onInterimTranscript?.(text)
    }
  })

  // Service coordination effects
  useEffect(() => { 
    stt.actions.setDesired(vad.state.isDetecting)
  }, [vad.state.isDetecting, stt.actions])

  useEffect(() => {
    // Always allow STT if barge-in is enabled, otherwise only allow if not speaking
    if (appConfig.bargeInEnabled) {
      stt.actions.setAllowed(true)
    } else {
      stt.actions.setAllowed(!tts.state.isSpeaking)
    }
  }, [appConfig.bargeInEnabled, tts.state.isSpeaking, stt.actions])

  // Convenience action implementations
  const submitMessage = useCallback(
    (message: string) => {
      if (message.trim()) {
        const userMessage = message.trim()

        // A typed turn starts here; a spoken one starts at speech end (below).
        beginTurn()
        conversation.actions.addMessage(userMessage, true)

        const interrupt = Date.now()
        interruptCounterRef.current = interrupt

        llmService.actions.processUserInput({
          text: userMessage,
          human: true,
          final: true,
          bargein: appConfig.bargeInEnabled,
          interrupt
        })
      }
    },
    [appConfig.bargeInEnabled, conversation.actions, llmService.actions]
  )

  const toggleMicrophone = useCallback(
    (isRecording: boolean) => {
      stt.actions.setDesired(isRecording)
      setCurrentInterimTranscript('')
    },
    [stt.actions]
  )

  const triggerBargein = useCallback(() => {
    const interrupt = Date.now()
    interruptCounterRef.current = interrupt

    performBargeIn()
  }, [performBargeIn])

  // Memoize the services object to prevent unnecessary re-renders
  const services = useMemo(
    () => ({
      conversation,
      vad,
      stt,
      llm: llmService,
      tts,
      visemes,
      emotes,
      animations
    }),
    [conversation, vad, stt, llmService, tts, visemes, emotes, animations]
  )

  // Memoize the actions object to prevent unnecessary re-renders
  const actions = useMemo(
    () => ({
      // VAD actions
      startVADListening: vad.actions.startListening,
      stopVADListening: vad.actions.stopListening,
      initializeVAD: vad.actions.initializeVAD,

      // STT actions
      startSTTListening: stt.actions.startListening,
      stopSTTListening: stt.actions.stopListening,
      setSTTDesired: stt.actions.setDesired,

      // LLM actions
      loadLLM: llmService.actions.load,
      processUserInput: llmService.actions.processUserInput,
      clearLLMHistory: llmService.actions.clearHistory,

      // TTS actions
      speak: tts.actions.speak,
      stopSpeaking: tts.actions.stopSpeaking,
      playAudioBuffer: tts.actions.playAudioBuffer,
      getTTSQueueStatus: tts.actions.getQueueStatus,

      // Chat actions
      addMessage: conversation.actions.addMessage,
      streamMessage: conversation.actions.streamMessage,
      clearAllMessages: conversation.actions.clearAllMessages,
      getMessagebyId: conversation.actions.getMessagebyId,
      // Convenience actions
      submitMessage,
      toggleMicrophone,
      triggerBargein,

      // Viseme actions
      setupVisemesForVRM: visemes.actions.setupForVRM,
      setupVisemesForMorphTargets: visemes.actions.setupForMorphTargets,
      updateVisemes: visemes.actions.update,
      applyVisemesToRig: visemes.actions.applyToRig,
      resetVisemes: visemes.actions.reset,

      // Emote actions
      setupEmotesForVRM: emotes.actions.setupForVRM,
      setupEmotesForMorphTargets: emotes.actions.setupForMorphTargets,
      setEmotion: emotes.actions.setEmotion,
      performAction: emotes.actions.performAction,
      triggerGaze: emotes.actions.triggerGaze,
      updateEmotes: emotes.actions.update,
      applyEmotesToVRM: emotes.actions.applyToVRM,
      applyEmotesToMorphTargets: emotes.actions.applyToMorphTargets,
      resetEmotes: emotes.actions.reset,
      onEmoteBargein: emotes.actions.onBargeIn
    }),
    [
      vad.actions.startListening,
      vad.actions.stopListening,
      vad.actions.initializeVAD,
      stt.actions.startListening,
      stt.actions.stopListening,
      stt.actions.setDesired,
      llmService.actions.load,
      llmService.actions.processUserInput,
      llmService.actions.clearHistory,
      tts.actions.speak,
      tts.actions.stopSpeaking,
      tts.actions.playAudioBuffer,
      tts.actions.getQueueStatus,
      conversation.actions.addMessage,
      conversation.actions.streamMessage,
      conversation.actions.clearAllMessages,
      submitMessage,
      toggleMicrophone,
      triggerBargein,
      visemes.actions.setupForVRM,
      visemes.actions.setupForMorphTargets,
      visemes.actions.update,
      visemes.actions.applyToRig,
      visemes.actions.reset,
      emotes.actions.setupForVRM,
      emotes.actions.setupForMorphTargets,
      emotes.actions.setEmotion,
      emotes.actions.performAction,
      emotes.actions.triggerGaze,
      emotes.actions.update,
      emotes.actions.applyToVRM,
      emotes.actions.applyToMorphTargets,
      emotes.actions.reset,
      emotes.actions.onBargeIn
    ]
  )

  const state = useMemo(
    () => ({
      vadIsListening: vad.state.isListening,
      vadIsDetecting: vad.state.isDetecting,
      sttIsListening: stt.state.isListening,
      sttAllowed: stt.state.allowed,
      sttDesired: stt.state.desired,
      currentTranscript: currentInterimTranscript,
      llmReady: llmService.state.ready,
      llmLoading: llmService.state.loading,
      llmThinking: llmService.state.thinking,
      llmMessages: llmService.state.messages,
      ttsIsSpeaking: tts.state.isSpeaking,
      ttsAudioQueue: tts.state.audioQueue,
      messages: conversation.state.messages,
    }),
    [ 
      vad.state.isListening,
      vad.state.isDetecting,
      stt.state.isListening,
      stt.state.allowed,
      stt.state.desired,
      currentInterimTranscript,
      llmService.state.ready,
      llmService.state.loading,
      llmService.state.thinking,
      llmService.state.messages,
      tts.state.isSpeaking,
      tts.state.audioQueue,
      conversation.state.messages,  
    ]
  )

  // Return the unified service interface
  return {
    state,
    actions,
    services
  }
}
