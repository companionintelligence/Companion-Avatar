/**
 * Local text-to-speech (TTS mode 'local'): VITS voices through @diffusionstudio/vits-web, in a worker of its
 * own. ttsService.ts starts it and posts one message per sentence: `{ id, text, voice }`. The worker answers each
 * one once, with `{ id, audio }` (the WAV as an ArrayBuffer) or `{ id, error }`, and sends `{ id, progress }`
 * while the voice downloads (vitsMessages.ts). `voice` is a Piper voice id; one that vits-web does not have is
 * replaced by DEFAULT_VITS_VOICE, with a warning (vitsVoice.ts).
 *
 * The worker used to be a string made into a blob: URL that imported vits-web from a CDN. Now Vite bundles
 * vits-web (1.0.3, the version that URL named) and the onnxruntime-web it pins (1.18.0) into this worker, and
 * the browser loads them from the app's own origin.
 *
 * vits-web's predict() still fetches the rest at run time, from addresses fixed in its code:
 *   - the voice (a .onnx model and its .json config) from huggingface.co/diffusionstudio/piper-voices, kept
 *     in the origin-private file system after the first use;
 *   - onnxruntime-web's own .wasm, from cdnjs.cloudflare.com (onnxruntime-web 1.18.0);
 *   - the phonemizer, piper_phonemize.wasm and its .data (espeak-ng and its language data), from
 *     cdn.jsdelivr.net (@diffusionstudio/piper-wasm 1.0.0).
 * Serving those two from this origin as well means patching vits-web, whose code fixes those addresses, and
 * shipping at least 29 MB more in every build (onnxruntime's 10.6 MB SIMD .wasm and the phonemizer's
 * 18.7 MB). The phonemizer is espeak-ng, under GPL-3.0, so serving it ourselves is a licensing decision too,
 * and it has not been made.
 *
 * The worker speaks one sentence at a time, in the order they came. The page posts a reply's sentences all at
 * once, and predict() keeps the voice only after a download has finished, so sentences spoken side by side each
 * downloaded the 63 MB model before any of them had kept it (measured 2026-11-26: three downloads, 190 MB, for
 * a three-sentence reply). One at a time, the first sentence downloads the voice and the rest read the copy it
 * kept. Nothing is lost by waiting: the page is not cross-origin isolated, so onnxruntime has
 * only this worker's thread, and sentences side by side took turns on it anyway.
 *
 * A predict() that never settles (vitsMessages.ts) holds up the sentences behind it. The worker then sends
 * nothing at all, and that silence is what the page waits for: after LOCAL_TTS_SILENCE_MS it gives up every
 * sentence in this worker and sends the next one to a new worker.
 */
import { PATH_MAP, predict, type Progress, type VoiceId } from '@diffusionstudio/vits-web'

import { PROGRESS_INTERVAL_MS, type VitsReply, type VitsRequest } from './vitsMessages'
import { createVitsVoiceChooser } from './vitsVoice'

// PATH_MAP is vits-web's own table of the voices predict() can load, keyed by voice id.
const chooseVoice = createVitsVoiceChooser(PATH_MAP)

const reply = (message: VitsReply) => self.postMessage(message)

/** Passes the voice's download progress on, at most once per PROGRESS_INTERVAL_MS, so the page can tell slow from stuck. */
function progressNotes(id: number): (progress: Progress) => void {
  let last = -Infinity
  return ({ loaded, total }) => {
    const now = Date.now()
    if (now - last < PROGRESS_INTERVAL_MS) return
    last = now
    reply({ id, progress: { loaded, total } })
  }
}

/** Speaks one sentence and answers it, with the audio or with the error predict() gave. */
async function speak(id: number, text: string, voiceId: VoiceId): Promise<void> {
  try {
    const wav = await predict({ text, voiceId }, progressNotes(id))
    reply({ id, audio: await wav.arrayBuffer() })
  } catch (error) {
    // predict() rejects when a download fails ("Failed to fetch") or when what it fetched is unusable, such as
    // a 404 page in place of a voice's config. Unanswered, the page would wait for this sentence for good.
    console.error('TTS Worker Error:', error)
    reply({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

// The sentence being spoken, then the ones waiting: each starts once the one before it has been answered.
let queue: Promise<void> = Promise.resolve()

self.addEventListener('message', (e: MessageEvent<VitsRequest>) => {
  const id = e.data.id
  const text = e.data.text || 'please supply some text'
  const voiceId = chooseVoice(e.data.voice) as VoiceId
  console.log('TTS Worker received message:', { id, text, voiceId })
  // speak() answers its own failures. The catch is for one that escapes it, so the sentences after it still run.
  queue = queue.then(() => speak(id, text, voiceId)).catch((error) => console.error('TTS Worker Error:', error))
  // Settles once this sentence is answered. The browser ignores it; the tests wait on it.
  return queue
})
