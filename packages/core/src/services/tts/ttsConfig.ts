import { DEFAULT_VITS_VOICE } from './vitsVoice'

export interface WhisperConfig {
    model: string
    language?: string
    quantized: boolean
    multilingual: boolean
  }

// Whisper data interface for visemes
export interface WhisperData {
    words?: string[]
    wtimes?: number[]
    wdurations?: number[]
}

export const defaultWhisperConfig: WhisperConfig = {
model: 'Xenova/whisper-tiny',
language: 'en',
quantized: true,
multilingual: false
}


// synthetic = deterministic render-probe PCM through the real analyser path
export type TTSMode = 'browser' | 'local' | 'remote' | 'pocket' | 'synthetic' | 'headtts'

export interface TTSConfig {
    /**
     * The voice for the engine in `mode`. Empty means that engine's own default; see voiceFor().
     * `pocket` ignores it and reads `pocketTts.voice`.
     */
    voice: string
    speed: number
    pitch: number
    volume: number
    mode: TTSMode
    apiKey?: string
    url?: string
    model?: string
    voiceSettings?: {
      stability?: number
      similarity_boost?: number
    }
    pocketTts?: {
      serverUrl: string
      voice: string // predefined voice name (marius, javert, jean, alba, fantine, cosette, eponine, azelma) or URL
    }
  }

  /**
   * The voice each engine speaks with when `voice` is empty. Engines name their voices their own way, so one
   * default cannot fit them all. The shared default was 'marius', a Pocket TTS voice, which the VITS engine took
   * for a Piper id and found no model for (vitsVoice.ts).
   *
   * The BFF modes, 'remote' and 'headtts', have no default here. The browser then sends no voice, and the proxy
   * uses its own APP_TTS_VOICE, or else its upstream's default. They used to be sent 'marius' too, which overrode
   * APP_TTS_VOICE and which no Kokoro server has: on 2026-11-26 Speaches answered 422 to it, so nothing was said.
   *
   * Browser speech only looks for "male" or "female" in the name, finds neither in 'marius', and uses the system
   * voice.
   */
  // A Map, not an object: `mode` comes from config.json too, and a lookup must not find 'constructor' on it.
  const ENGINE_DEFAULT_VOICES: ReadonlyMap<TTSMode, string> = new Map<TTSMode, string>([
    ['local', DEFAULT_VITS_VOICE],
    ['browser', 'marius']
  ])

  /** The voice to ask the engine in `mode` for: the configured one, or else that engine's default. */
  export function voiceFor(config: Pick<TTSConfig, 'mode' | 'voice'>): string {
    const configured = config.voice?.trim()
    if (configured) return configured
    return ENGINE_DEFAULT_VOICES.get(config.mode) ?? ''
  }

  export const defaultTTSConfig: TTSConfig = {
    // Empty unless VITE_TTS_VOICE is set, so that each engine falls back to its own default (voiceFor).
    voice: import.meta.env.VITE_TTS_VOICE || '',
    speed: parseFloat(import.meta.env.VITE_TTS_SPEED || "1.0") || 1.0,
    pitch: parseFloat(import.meta.env.VITE_TTS_PITCH || "1.0") || 1.0,
    volume: parseFloat(import.meta.env.VITE_TTS_VOLUME || "1.0") || 1.0,
    // Default to the browser's own speechSynthesis, because it is the only mode
    // that needs nothing installed. The previous default was 'pocket', pointed at
    // http://localhost:8000 — a server that is not part of this app and is absent
    // from the published image, so a default install was silent while the product
    // described itself as "an AI with a face, a voice and a body". Every richer
    // backend (pocket / local / remote) stays available as an opt-in upgrade via
    // VITE_TTS_MODE; only the fallback position changed.
    mode: (import.meta.env.VITE_TTS_MODE || 'browser') as TTSMode,
    apiKey: import.meta.env.VITE_TTS_API_KEY,
    url: import.meta.env.VITE_TTS_URL || 'https://api.openai.com/v1/audio/speech',
    model: import.meta.env.VITE_TTS_MODEL || 'tts-1',
    voiceSettings: {
      stability: parseFloat(import.meta.env.VITE_TTS_STABILITY || "0.5") || 0.5,
      similarity_boost: parseFloat(import.meta.env.VITE_TTS_SIMILARITY_BOOST || "0.8") || 0.8
    },
    pocketTts: {
      serverUrl: import.meta.env.VITE_POCKET_TTS_URL || 'http://localhost:8000',
      voice: import.meta.env.VITE_POCKET_TTS_VOICE || 'marius' // male voice
    }
  }


