/**
 * Local text-to-speech (TTS mode 'local'): VITS voices through @diffusionstudio/vits-web, in a worker of its
 * own. ttsService.ts starts it and posts one message per sentence: `{ id, text, voice }`. The worker answers
 * `{ id, audio }`, with the WAV as an ArrayBuffer, or `{ id, error }`. `voice` is a Piper voice id; one that
 * vits-web does not have is replaced by DEFAULT_VITS_VOICE, with a warning (vitsVoice.ts).
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
 */
import { PATH_MAP, predict, type VoiceId } from '@diffusionstudio/vits-web'

import { createVitsVoiceChooser } from './vitsVoice'

interface SpeakRequest {
  id: number
  text?: string
  voice?: string
}

// PATH_MAP is vits-web's own table of the voices predict() can load, keyed by voice id.
const chooseVoice = createVitsVoiceChooser(PATH_MAP)

self.addEventListener('message', async (e: MessageEvent<SpeakRequest>) => {
  const id = e.data.id
  const text = e.data.text || 'please supply some text'
  const voiceId = chooseVoice(e.data.voice) as VoiceId
  console.log('TTS Worker received message:', { id, text, voiceId })
  predict({ text, voiceId }).then((audio) => {
    new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(audio)
    })
      .then((audio) => {
        self.postMessage({ audio, id })
      })
      .catch((error) => {
        console.error('TTS Worker Error:', error)
        self.postMessage({ error: error.message, id })
      })
  })
})
