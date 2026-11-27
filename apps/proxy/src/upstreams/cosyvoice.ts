import type { ResolvedConfig } from '../config.js'
import { createHeadTtsAdapter } from './headtts.js'

/**
 * A synthesized-audio stream from a TTS upstream: the raw audio byte stream plus
 * the content-type to relay to the browser. `contentType` is derived from the
 * requested `format` (falling back to the upstream's own header) so the client
 * can decode it without guessing.
 */
export interface TtsAudioStream {
  body: ReadableStream<Uint8Array>
  contentType: string
}

export interface TtsRequest {
  text: string
  voice?: string
  /** Output container, e.g. 'mp3' | 'wav' | 'opus'. Defaults to 'mp3'. */
  format?: string
}

export interface TtsAdapter {
  readonly name: string
  /**
   * The voice this adapter asks for when neither the browser nor APP_TTS_VOICE names one. Undefined when it then
   * asks for none, and the upstream speaks with its own default.
   */
  readonly defaultVoice?: string
  /**
   * Stream synthesized audio from the upstream. Honors `signal` for cancellation
   * (client disconnect / barge-in). Throws on a non-ok upstream or transport error.
   */
  speak(req: TtsRequest, signal: AbortSignal): Promise<TtsAudioStream>
  /** Lightweight reachability probe for /api/health. */
  health(): Promise<{ ok: boolean; detail?: string }>
}

/** Map an OpenAI `response_format` value to an audio MIME type. */
export function contentTypeForFormat(format: string | undefined): string {
  switch ((format ?? 'mp3').toLowerCase()) {
    case 'wav':
      return 'audio/wav'
    case 'opus':
      return 'audio/opus'
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'pcm':
      return 'audio/pcm'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}

/**
 * CosyVoice2 adapter. CosyVoice2 ships an OpenAI-compatible speech endpoint at
 * `POST ${APP_TTS_URL}/v1/audio/speech`; wrappers that expose this shape include
 * gpustack/vox-box and neosun100/cosyvoice-docker. We POST the OpenAI payload
 * `{ model, input, voice, stream: true }` and pipe the audio stream straight
 * through to the browser — the proxy is a same-origin, key-free passthrough so
 * the appliance keeps everything local.
 *
 * There is no CosyVoice2 server in CI, so the tests mock `fetch`; point
 * `APP_TTS_URL` at a real server to exercise this end to end.
 */
/**
 * The voice an OpenAI-style server is sent when neither the browser nor APP_TTS_VOICE names one. That API needs a
 * voice, and no one name is valid on every server: Speaches (Kokoro) answers 422 to this one. Set APP_TTS_VOICE
 * to a voice of the server you run.
 */
export const COSYVOICE_DEFAULT_VOICE = 'default'

export function createCosyVoiceAdapter(cfg: ResolvedConfig): TtsAdapter {
  return {
    name: 'cosyvoice',
    defaultVoice: COSYVOICE_DEFAULT_VOICE,

    async speak(req: TtsRequest, signal: AbortSignal): Promise<TtsAudioStream> {
      const format = req.format || 'mp3'
      let res: Response
      try {
        res = await fetch(`${cfg.ttsUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: cfg.ttsModel,
            input: req.text,
            voice: req.voice || cfg.ttsVoice || COSYVOICE_DEFAULT_VOICE,
            response_format: format,
            stream: true
          }),
          signal
        })
      } catch (err) {
        throw new Error(`cosyvoice request failed: ${(err as Error).message}`)
      }

      if (!res.ok || !res.body) {
        throw new Error(`cosyvoice responded ${res.status}`)
      }

      // Prefer the requested format's MIME; fall back to whatever the upstream
      // labeled the stream so we never mislabel exotic formats.
      const upstreamType = res.headers.get('content-type')
      const contentType =
        upstreamType && upstreamType.startsWith('audio/')
          ? upstreamType
          : contentTypeForFormat(format)

      return { body: res.body, contentType }
    },

    async health() {
      try {
        // OpenAI-compatible servers expose /v1/models; use it as a cheap probe.
        const res = await fetch(`${cfg.ttsUrl}/v1/models`, { method: 'GET' })
        return { ok: res.ok, detail: `cosyvoice ${res.status}` }
      } catch (err) {
        return { ok: false, detail: `cosyvoice unreachable: ${(err as Error).message}` }
      }
    }
  }
}

/**
 * Select the configured TTS adapter.
 *
 * `headtts` is the only one that reports timings; everything else leaves the
 * client on the acoustic tier. See upstreams/headtts.ts.
 */
export function selectTtsUpstream(cfg: ResolvedConfig): TtsAdapter {
  switch (cfg.ttsUpstream) {
    case 'headtts':
      return createHeadTtsAdapter(cfg)
    case 'cosyvoice':
    default:
      return createCosyVoiceAdapter(cfg)
  }
}
