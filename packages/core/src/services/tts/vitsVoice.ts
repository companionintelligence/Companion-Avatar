/**
 * Which voice the in-browser VITS engine (TTS mode 'local') speaks with.
 *
 * vits-web names its voices by Piper id, such as 'en_US-hfc_male-medium', and its predict() looks the id up in
 * PATH_MAP without checking it. An id that is not there makes the address `.../undefined.json`, which Hugging Face
 * answers with a 404 and the body "Entry not found". vits-web keeps that body in the origin-private file system as
 * the voice's config, fails to parse it, and the worker never answers, so the speech queue waits on that sentence
 * for good. Measured on 2026-11-26 against a production build: the default voice, 'marius' (a Pocket TTS name),
 * and the worker's old fallback, 'en_GB-hfc_male-medium', both went that way.
 *
 * This module imports nothing, so ttsConfig.ts can name the default without pulling vits-web into the page.
 * vits.worker.ts passes in vits-web's PATH_MAP.
 */

/** A voice in @diffusionstudio/vits-web 1.0.3's list: male, US English, medium quality, a 63 MB model. */
export const DEFAULT_VITS_VOICE = 'en_US-hfc_male-medium'

/**
 * Makes the function the worker uses to choose each message's voice. `known` is vits-web's PATH_MAP.
 *
 * - A voice it has is used as given.
 * - No voice gets the default, with no warning.
 * - Any other name gets the default and a console warning. The worker is asked once per sentence, so each name
 *   is warned about only once.
 */
export function createVitsVoiceChooser(
  known: Readonly<Record<string, unknown>>,
  warn: (message: string) => void = (message) => console.warn(message)
): (requested: string | undefined) => string {
  const warned = new Set<string>()
  return (requested) => {
    const id = requested?.trim()
    if (!id) return DEFAULT_VITS_VOICE
    // Own keys only: 'constructor' or 'toString' is on every object, and is no voice. (Object.hasOwn is ES2022,
    // as is vits-web's own code, which the worker runs; the page only imports DEFAULT_VITS_VOICE from here.)
    if (Object.hasOwn(known, id)) return id
    if (!warned.has(id)) {
      warned.add(id)
      warn(
        `TTS (local): vits-web has no voice '${id}', so it speaks with '${DEFAULT_VITS_VOICE}'. ` +
          "Set the voice to a Piper id from vits-web's list, such as 'en_US-amy-medium'."
      )
    }
    return DEFAULT_VITS_VOICE
  }
}
