import type { ResolvedConfig } from '../config.js'
import type { TtsAdapter, TtsAudioStream, TtsRequest } from './cosyvoice.js'
import { contentTypeForFormat } from './cosyvoice.js'

/**
 * HeadTTS adapter — Kokoro-82M with phoneme-level timestamps.
 *
 * WHY THIS UPSTREAM
 * -----------------
 * Every other TTS we can reach returns audio and nothing else, which leaves the
 * client inferring mouth shapes from the spectrum. HeadTTS
 * (https://github.com/met4citizen/HeadTTS, MIT) serves
 * `Kokoro-82M-v1.0-ONNX-timestamped` and returns, alongside 24 kHz audio, the
 * **word timings and Oculus viseme ids with millisecond timing** that the mouth
 * actually needs. Its word-timing shape is already `{words, wtimes, wdurations}`
 * — identical to the interface this codebase has always spoken — so nothing
 * downstream has to change to consume it.
 *
 * It runs Hub-side (Node, WebGPU or multi-threaded CPU) rather than in the tab,
 * so the browser downloads no model and a headset gets the same voice as a
 * desktop.
 *
 * NOT STREAMED, DELIBERATELY
 * --------------------------
 * HeadTTS returns a complete response; it has no incremental mode. Wrapping a
 * non-streaming upstream in SSE would add base64 framing overhead for zero
 * latency benefit. The latency win at this layer is already taken elsewhere:
 * the LLM is chunked into sentence-sized "breaths", so each synthesis request is
 * ~1–2 s of audio and playback starts at the first breath, not the last.
 */

/** Word- and viseme-level timings for one synthesized utterance. */
export interface TtsTimings {
  words: string[]
  /** Milliseconds from the start of the utterance. */
  wtimes: number[]
  wdurations: number[]
  /** Oculus viseme ids, when the upstream reports them. */
  visemes?: string[]
  vtimes?: number[]
  vdurations?: number[]
}

export interface TtsTimedAudio {
  /** Base64 audio, ready to hand to the browser without a second encode. */
  audioBase64: string
  contentType: string
  timings: TtsTimings
}

/** A TTS adapter that can also report timings. */
export interface TimedTtsAdapter extends TtsAdapter {
  speakTimed(req: TtsRequest, signal: AbortSignal): Promise<TtsTimedAudio>
}

export function isTimedAdapter(adapter: TtsAdapter): adapter is TimedTtsAdapter {
  return typeof (adapter as TimedTtsAdapter).speakTimed === 'function'
}

const numbers = (value: unknown): number[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'number') ? (value as number[]) : undefined

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined

/**
 * Read timings from the upstream payload.
 *
 * Field names are accepted in both the flat form (`words`/`wtimes`) and a nested
 * `timings`/`metadata` envelope, because the server's REST and WebSocket
 * transports do not agree and pinning one shape would make an upgrade a silent
 * regression to no-lip-sync. Anything unrecognised degrades to word-only timing,
 * which the client can still use.
 */
export function parseHeadTtsTimings(payload: unknown): TtsTimings {
  const root = (payload ?? {}) as Record<string, unknown>
  const nested = (root.timings ?? root.metadata ?? {}) as Record<string, unknown>
  const pick = (key: string): unknown => root[key] ?? nested[key]

  return {
    words: strings(pick('words')) ?? [],
    wtimes: numbers(pick('wtimes')) ?? [],
    wdurations: numbers(pick('wdurations')) ?? [],
    visemes: strings(pick('visemes')),
    vtimes: numbers(pick('vtimes')),
    vdurations: numbers(pick('vdurations'))
  }
}

export function createHeadTtsAdapter(cfg: ResolvedConfig): TimedTtsAdapter {
  const base = cfg.ttsUrl

  const synthesize = async (req: TtsRequest, signal: AbortSignal): Promise<Response> => {
    // With no voice from the browser or APP_TTS_VOICE, ask for none: HeadTTS then speaks with its own default
    // (`tts.defaults.voice`, af_bella as shipped). It loads each voice from a file, so a name it has no file for,
    // such as the 'default' this used to send, gets a 422 and no audio.
    const voice = req.voice || cfg.ttsVoice
    try {
      return await fetch(`${base}/v1/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: req.text,
          ...(voice ? { voice } : {}),
          language: 'en-us',
          audioEncoding: req.format === 'wav' ? 'wav' : 'wav'
        }),
        signal
      })
    } catch (err) {
      throw new Error(`headtts request failed: ${(err as Error).message}`)
    }
  }

  return {
    name: 'headtts',

    async speakTimed(req: TtsRequest, signal: AbortSignal): Promise<TtsTimedAudio> {
      const res = await synthesize(req, signal)
      if (!res.ok) throw new Error(`headtts responded ${res.status}`)

      const payload = (await res.json()) as Record<string, unknown>
      const audioBase64 = typeof payload.audio === 'string' ? payload.audio : ''
      if (!audioBase64) throw new Error('headtts returned no audio')

      return {
        audioBase64,
        contentType: contentTypeForFormat(req.format ?? 'wav'),
        timings: parseHeadTtsTimings(payload)
      }
    },

    /**
     * Plain audio path, for callers that do not want timings. Decodes the base64
     * once here so the browser still receives ordinary binary on `/api/tts`.
     */
    async speak(req: TtsRequest, signal: AbortSignal): Promise<TtsAudioStream> {
      const timed = await this.speakTimed(req, signal)
      const bytes = Buffer.from(timed.audioBase64, 'base64')
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes))
          controller.close()
        }
      })
      return { body, contentType: timed.contentType }
    },

    async health() {
      try {
        const res = await fetch(`${base}/v1/voices`, { method: 'GET' })
        return { ok: res.ok, detail: `headtts ${res.status}` }
      } catch (err) {
        return { ok: false, detail: `headtts unreachable: ${(err as Error).message}` }
      }
    }
  }
}
