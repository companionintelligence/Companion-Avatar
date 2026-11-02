/// <reference types="vite/client" />

interface ImportMetaEnv {
  // LLM Configuration
  readonly VITE_LLM_PROVIDER?: string
  readonly VITE_LLM_LOCAL_MODEL?: string
  readonly VITE_LLM_OLLAMA_API_URL?: string
  readonly VITE_LLM_OLLAMA_MODEL?: string
  readonly VITE_LLM_OPENAI_API_URL?: string
  readonly VITE_LLM_OPENAI_API_KEY?: string
  readonly VITE_LLM_OPENAI_MODEL?: string
  
  // Legacy/deprecated
  readonly VITE_OLLAMA_API_URL?: string
  readonly VITE_CLOUD_LLM_URL?: string
  readonly VITE_CLOUD_LLM_MODEL?: string
  readonly VITE_CLOUD_LLM_AUTH?: string
  readonly VITE_FLOWISE_API_URL?: string
  readonly VITE_FLOWISE_CHATFLOW_ID?: string
  readonly VITE_IS_FLOWISE?: string
  
  // STT Configuration
  readonly VITE_STT_API_URL?: string
  readonly VITE_STT_API_KEY?: string
  readonly VITE_STT_MODEL?: string
  readonly VITE_STT_LANGUAGE?: string
  readonly VITE_STT_CONTINUOUS?: string
  readonly VITE_STT_REMOTE?: string
  
  // TTS Configuration
  readonly VITE_TTS_API_URL?: string
  readonly VITE_TTS_API_KEY?: string
  readonly VITE_TTS_VOICE?: string
  readonly VITE_TTS_VOICE_ID?: string
  readonly VITE_TTS_SIMILARITY_BOOST?: string
  readonly VITE_TTS_STABILITY?: string
  readonly VITE_TTS_SPEED?: string
  readonly VITE_TTS_PITCH?: string
  readonly VITE_TTS_VOLUME?: string
  readonly VITE_TTS_MODE?: string
  readonly VITE_TTS_MODEL_ID?: string
  readonly VITE_TTS_OPTIMIZE_STREAMING_LATENCY?: string
  readonly VITE_TTS_OUTPUT_FORMAT?: string
  
  // VAD Configuration
  readonly VITE_VAD_THRESHOLD?: string
  readonly VITE_VAD_SAMPLE_RATE?: string
  readonly VITE_VAD_SILENCE_DURATION_MS?: string
  
  // Other
  readonly VITE_API_BASE?: string
  readonly VITE_DIRECTED_MODE?: string
  readonly VITE_USE_SSL?: string
  readonly VITE_TALK_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
