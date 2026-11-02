/**
 * remoteStt.ts — transcribe an utterance through the appliance's own Whisper.
 *
 * `STTConfig.remote` has existed as a flag for a long time and never did
 * anything: the service only ever used `webkitSpeechRecognition`, which is
 * Chromium-only and streams the microphone to Google. Meanwhile the VAD already
 * captured each utterance's audio and threw it away. This joins the two ends.
 */

import { apiUrl } from '../../config/apiBase'

export interface RemoteSttResult {
  text: string
  ok: boolean
  error?: string
}

/**
 * POST raw float PCM to the BFF. Raw bytes rather than multipart: the caller has
 * a plain ArrayBuffer and the route is same-origin, so building a multipart body
 * in the browser for the proxy to unpick again buys nothing.
 */
export async function transcribeRemote(
  audio: ArrayBuffer,
  sampleRate: number,
  options: { language?: string; signal?: AbortSignal; url?: string } = {}
): Promise<RemoteSttResult> {
  const params = new URLSearchParams({ sampleRate: String(Math.round(sampleRate)) })
  if (options.language) params.set('language', options.language)

  try {
    const response = await fetch(`${options.url ?? apiUrl('/api/stt')}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: audio,
      signal: options.signal
    })
    if (!response.ok) {
      return { ok: false, text: '', error: `STT responded ${response.status}` }
    }
    const payload = (await response.json()) as { text?: string }
    return { ok: true, text: (payload.text ?? '').trim() }
  } catch (err) {
    return { ok: false, text: '', error: (err as Error).message }
  }
}
