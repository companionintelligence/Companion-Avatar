/**
 * LLM Service - Phase 4 Implementation
 *
 * This service provides a comprehensive LLM integration that supports both local and remote models.
 * It's a direct port from the archive/chat/llm.js implementation with modern React/TypeScript patterns.
 *
 * Features:
 * - Local LLM support using Ollama (preferred) or WebLLM fallback
 * - Remote API support (OpenAI, Anthropic, etc.)
 * - Streaming responses with "breath" chunking for TTS integration
 * - Barge-in interruption support
 * - System prompt management
 * - Conversation context handling
 * - Environment variable configuration
 *
 * Local LLM Priority:
 * 1. Ollama (if VITE_OLLAMA_API_URL is configured)
 * 2. WebLLM (as fallback if Ollama unavailable)
 *
 * Key behaviors matching the archive implementation:
 * - Breaks responses into natural speech chunks (MIN_BREATH_LENGTH)
 * - Supports interrupt timestamps for barge-in
 * - Processes <think> blocks from models like DeepSeek
 * - Maintains conversation history with system prompts
 * - Web worker implementation for local models
 *
 * Integration points:
 * - Connects to local TTS service for speaking responses (remote TTS not yet implemented)
 * - Integrates with chat service for message history
 * - Responds to app config changes (local vs cloud mode)
 * - Provides status callbacks for UI updates
 */

import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { llmCloud } from './models/llmCloud'
import { llmDirected } from './models/llmDirected'
import { llmLocal } from './models/llmLocal'
import { llmOllama } from './models/llmOllama'
import { llmProxy } from './models/llmProxy'
import { defaultLLMConfig, SYSTEM_PROMPT, type LLMConfig, AVAILABLE_LOCAL_MODELS } from './config/llmConfig'
import type { LLMStatusUpdate, LLMResponse, LLMState, LLMPerformRequest } from './llmTypes'

// Pick a conservative default model for low-memory devices
function pickConservativeLocalModel(cfg: LLMConfig): string {

  const deviceMemoryGb = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4
  // Prefer the smallest model on <=4GB, modest model on <=8GB
  if (deviceMemoryGb <= 4) return 'SmolLM2-360M-Instruct-q4f16_1-MLC'
  if (deviceMemoryGb <= 8) return 'gemma-2-2b-it-q4f16_1-MLC'
  // Fall back to configured model or a reasonable mid-size
  return cfg.mlc_model || 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
}

type LLMServiceProps = {
  config?: Partial<LLMConfig>
  onStatus?: (update: LLMStatusUpdate) => void
  onResponse?: (response: LLMResponse) => void
}

export const useLLMService = ({ config: configPartial = {}, onStatus, onResponse }: LLMServiceProps) => {
  const config = useMemo(() => ({ ...defaultLLMConfig, ...configPartial }), [configPartial])
  const [state, setState] = useState<LLMState>({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    thinking: false,
    ready: false,
    loading: false,
    selectedModel: pickConservativeLocalModel(config),
    engine: null,
    _latest_interrupt: 0
  })

  const initializedRef = useRef(false)

  // Live "newest turn" marker. Adapters receive a getter over this ref (not a copy),
  // so an in-flight stream from a previous turn observes the latest interrupt and
  // self-cancels. Passing request.interrupt by value made the guard compare a number
  // to itself, so a new user turn never stopped the previous turn's network stream.
  const latestInterruptRef = useRef(0)
  const getLatestInterrupt = useCallback(() => latestInterruptRef.current, [])

  const processThinkBlocks = useCallback((input: string) => {
    const thinkBlocks: string[] = []

    const cleanedResponse = input.replace(/<think>(.*?)<\/think>/gs, (_, content) => {
      thinkBlocks.push(content.trim())
      return ''
    })

    return { cleanedResponse, thinkBlocks }
  }, [])

  const load = useCallback(async () => {
    if (config.llm_provider !== 'mlc' || !config.mlc_model) return
    if (state.loading) return

    setState((prev) => ({ ...prev, loading: true }))

    try {
      // Guard: require WebGPU support
      const hasWebGPU = typeof (navigator as unknown as { gpu?: unknown }).gpu !== 'undefined'
      if (!hasWebGPU) {
        console.warn('LLM: WebGPU not available, skipping local model load and using fallback responses')
        setState((prev) => ({ ...prev, loading: false, ready: false, engine: null }))
        if (onStatus) {
          onStatus({ color: 'error', text: 'WebGPU not available; using fallback responses' })
        }
        return
      }

      // Choose a safe model for the current device unless explicitly overridden
      const modelToLoad = pickConservativeLocalModel(config)
      const safeModel = AVAILABLE_LOCAL_MODELS.includes(modelToLoad) ? modelToLoad : pickConservativeLocalModel(config)
      
      setState((prev) => ({ ...prev, selectedModel: safeModel }))
      
      const initProgressCallback = (status: { text: string }) => {
        if (onStatus) {
          onStatus({
            color: state.ready ? 'ready' : 'loading',
            text: status.text
          })
        }
      }

      const completed = (engine: unknown) => {
        setState((prev) => ({
          ...prev,
          engine: engine as WebWorkerMLCEngine,
          ready: true,
          loading: false
        }))

        if (onStatus) {
          onStatus({
            color: 'ready',
            text: 'Ready'
          })
        }
      }

      if (onStatus) {
        onStatus({
          color: state.ready ? 'ready' : 'loading',
          text: `Loading local model ${safeModel}`
        })
      }

      // The engine runs in a worker. Vite bundles webllm.worker.ts with @mlc-ai/web-llm, and the browser
      // loads it from the app's own origin.
      const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' })

      const webllm = await import('@mlc-ai/web-llm')
      const engine = await webllm.CreateWebWorkerMLCEngine(worker, safeModel, { initProgressCallback })

      completed(engine)
    } catch (err) {
      console.error('LLM - worker fetch error', err)
      setState((prev) => ({ ...prev, loading: false }))

      if (onStatus) {
        onStatus({
          color: 'error',
          text: 'Failed to load model'
        })
      }
    }
  }, [config.llm_provider, config.mlc_model, state.loading, state.ready, onStatus])

  // Initialize function that starts loading the LLM
  const initialize = useCallback(async () => {
    if (initializedRef.current) return
    initializedRef.current = true

    // Determine which mode to use and set ready state
    if (config.llm_provider === 'script') {
      setState((prev) => ({ ...prev, ready: true }))
    } else if (config.llm_provider === 'proxy') {
      // Same-origin BFF; ready immediately (server resolves the upstream).
      setState((prev) => ({ ...prev, ready: true }))
    } else if (config.llm_provider === 'ollama' && config.ollama_url) {
      setState((prev) => ({ ...prev, ready: true }))
    } else if (config.llm_provider === 'mlc' && config.mlc_model) {
      await load()
    } else if (
      config.llm_provider === 'openai' &&
      config.openai_api_key &&
      config.openai_api_url &&
      config.openai_model
    ) {
      setState((prev) => ({ ...prev, ready: true }))
    }
  }, [
    config.llm_provider,
    config.mlc_model,
    config.ollama_url,
    config.openai_api_key,
    config.openai_api_url,
    config.openai_model,
    config.proxy_url,
    load
  ])

  // Auto-initialize when the service is created
  useEffect(() => {
    // Small delay to ensure the service is fully mounted
    const timer = setTimeout(() => {
      initialize()
    }, 100)

    return () => clearTimeout(timer)
  }, [initialize])

  const processUserInput = useCallback(
    async (request: LLMPerformRequest) => {
      if (!request.final) return

      const text = request.text?.trim()
      if (!text || !text.length) return

      // Publish this turn as the newest interrupt BEFORE dispatching, so any stream
      // still running from a previous turn (which holds getLatestInterrupt) sees a
      // newer value and self-cancels.
      latestInterruptRef.current = request.interrupt

      const activationState = config.activation_state
      const responseCallback = (response: LLMResponse) => {
        onResponse?.({ ...response, activationState })
      }

      if (activationState === 'unverified') {
        onStatus?.({ color: 'error', text: 'Connection not verified' })
        responseCallback({
          text: '',
          breath: 'I am not connected yet. Open Settings and run Check connection before we talk.',
          ready: true,
          final: true,
          interrupt: request.interrupt
        })
        return
      }

      const canUseDirectedFallback = activationState === undefined || activationState === 'demo-only'

      // If model is loading or not ready, use directed responses as fallback
      if (state.loading || !state.ready) {
        if (!canUseDirectedFallback) {
          onStatus?.({ color: 'error', text: 'Verified connection is not ready' })
          responseCallback({
            text: '',
            breath: 'Your connection is verified, but the language model is still starting. I will not use a scripted answer; please try again shortly.',
            ready: true,
            final: true,
            interrupt: request.interrupt
          })
          return
        }

        console.log('LLM: Model not ready, using directed responses as fallback')

        if (onStatus) {
          onStatus({
            color: 'loading',
            text:
              activationState === 'demo-only'
                ? 'Demo mode — no private memory'
                : state.loading
                  ? 'Model loading, using fallback responses...'
                  : 'Model not ready, using fallback responses...'
          })
        }

        setState((prev) => ({ ...prev, _latest_interrupt: request.interrupt }))

        const baseParams = {
          userMessage: text,
          interrupt: request.interrupt,
          messages: state.messages,
          latestInterrupt: getLatestInterrupt,
          responseCallback,
          updateMessages: (userMsg: string, assistantMsg: string) => {
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: 'user', content: userMsg },
                { role: 'assistant', content: assistantMsg }
              ]
            }))
          },
          setThinking: (thinking: boolean) => {
            setState((prev) => ({ ...prev, thinking }))
          },
          statusCallback: onStatus,
          processThinkBlocks
        }

        try {
          const result = await llmDirected(baseParams)
          if (!result.success && result.error) {
            console.error('LLM: Directed fallback failed:', result.error)
            if (onStatus) {
              onStatus({
                color: 'error',
                text: 'Failed to process request with fallback'
              })
            }
          }
        } catch (error) {
          console.error('LLM: Fallback error:', error)
          if (onStatus) {
            onStatus({
              color: 'error',
              text: 'Error processing request with fallback'
            })
          }
        }
        return
      }

      // Handle interruptions
      if (state.thinking && state.engine?.interruptGenerate) {
        state.engine.interruptGenerate()
        setState((prev) => ({ ...prev, thinking: false }))
      }

      setState((prev) => ({ ...prev, _latest_interrupt: request.interrupt }))

      const baseParams = {
        userMessage: text,
        interrupt: request.interrupt,
        messages: state.messages,
        latestInterrupt: getLatestInterrupt,
        responseCallback,
        updateMessages: (userMsg: string, assistantMsg: string) => {
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: 'user', content: userMsg },
              { role: 'assistant', content: assistantMsg }
            ]
          }))
        },
        setThinking: (thinking: boolean) => {
          setState((prev) => ({ ...prev, thinking }))
        },
        statusCallback: onStatus,
        processThinkBlocks
      }

      // Surface a backend failure to the user as a visible chat message instead
      // of failing silently (previously errors only went to the console).
      const surfaceBackendFailure = (backend: string, error: Error) => {
        console.error(`LLM: ${backend} reasoning failed:`, error)
        onStatus?.({
          color: 'error',
          text: `${backend} backend unreachable`
        })
        responseCallback({
          text: '',
          breath: `I couldn't reach my ${backend} language model backend. Please check that it is running and that this app is configured to point at it.`,
          ready: true,
          final: true,
          interrupt: request.interrupt
        })
      }

      try {
        // Route to appropriate LLM based on config
        if (config.llm_provider === 'script') {
          const result = await llmDirected(baseParams)
          if (!result.success && result.error) {
            console.error('LLM: Directed reasoning failed:', result.error)
          }
        } else if (config.llm_provider === 'proxy') {
          const result = await llmProxy({
            ...baseParams,
            llmUrl: config.proxy_url || '/api/chat',
            llmModel: config.proxy_model
          })
          if (!result.success && result.error) {
            surfaceBackendFailure('Proxy', result.error)
          }
        } else if (config.llm_provider === 'ollama' && config.ollama_model) {
          const result = await llmOllama({
            ...baseParams,
            llmUrl: config.ollama_url,
            llmModel: config.ollama_model
          })
          if (!result.success && result.error) {
            surfaceBackendFailure('Ollama', result.error)
          }
        } else if (config.llm_provider === 'mlc' && config.mlc_model && state.engine) {
          const result = await llmLocal({
            ...baseParams,
            engine: state.engine
          })
          if (!result.success && result.error) {
            console.error('LLM: Local reasoning failed:', result.error)
          }
        } else if (
          config.llm_provider === 'openai' &&
          config.openai_api_key &&
          config.openai_api_url &&
          config.openai_model
        ) {
          // Use cloud API for OpenAI
          const result = await llmCloud({
            ...baseParams,
            llmModel: config.openai_model,
            llmAuth: config.openai_api_key,
            llmUrl: config.openai_api_url
          })
          if (!result.success && result.error) {
            surfaceBackendFailure('OpenAI-compatible', result.error)
          }
        } else {
          console.error('LLM: Unsupported provider or missing configuration', config.llm_provider)
          if (onStatus) {
            onStatus({
              color: 'error',
              text: 'Unsupported LLM provider or missing configuration'
            })
          }
        }
      } catch (error) {
        console.error('LLM - error processing input:', error)
        onStatus?.({
          color: 'error',
          text: 'Error processing request'
        })
      }
    },
    [
      state.loading,
      state.ready,
      state.thinking,
      state.engine,
      state.messages,
      state._latest_interrupt,
      getLatestInterrupt,
      onResponse,
      onStatus,
      processThinkBlocks,
      config.llm_provider,
      config.ollama_model,
      config.mlc_model,
      config.openai_api_key,
      config.openai_api_url,
      config.openai_model,
      config.ollama_url,
      config.proxy_url,
      config.proxy_model,
      config.activation_state
    ]
  )

  const clearHistory = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }]
    }))
  }, [])

  const actions = useMemo(
    () => ({
      load,
      processUserInput,
      clearHistory
    }),
    [load, processUserInput, clearHistory]
  )

  return useMemo(
    () => ({
      state,
      actions
    }),
    [state, actions]
  )
}
