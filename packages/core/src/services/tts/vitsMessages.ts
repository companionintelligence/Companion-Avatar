/**
 * The messages between ttsService.ts and vits.worker.ts (TTS mode 'local'). Types and numbers only, so both sides
 * can import it without the page pulling in vits-web.
 *
 * The page posts one request per sentence. The worker answers each request exactly once, with the audio or an
 * error. Before that it may send progress notes while it downloads the voice.
 */

/** One sentence to speak. `voice` is a Piper voice id (vitsVoice.ts). */
export interface VitsRequest {
  id: number
  text?: string
  voice?: string
}

/** What the worker sends back. `audio` is a WAV. */
export type VitsReply =
  | { id: number; audio: ArrayBuffer }
  | { id: number; error: string }
  | { id: number; progress: { loaded: number; total: number } }

/** The worker sends a progress note at most this often for each request (vits-web reports every chunk it reads). */
export const PROGRESS_INTERVAL_MS = 1_000

/**
 * How long the page waits for a request while the worker sends nothing at all: no answer to any request and no
 * progress. Then the page gives that sentence up and the queue moves on.
 *
 * A limit is needed because vits-web's predict() can stop for good without rejecting. It loads its phonemizer
 * inside `new Promise(async (resolve) => ...)`, which has no way to reject, so a phonemizer .wasm that fails to
 * load leaves predict() pending forever (measured 2026-11-26: no answer in 240 s). Downloads of the voice send
 * progress, so the limit covers only the quiet ones: the phonemizer's 18.7 MB and onnxruntime's 10.6 MB .wasm,
 * which take under 60 s each above about 2.5 Mbit/s.
 */
export const LOCAL_TTS_SILENCE_MS = 60_000
