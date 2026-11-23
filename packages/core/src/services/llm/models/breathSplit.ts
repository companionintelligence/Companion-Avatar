/**
 * Breath chunking for streamed LLM replies. A breath is one piece of reply that TTS speaks at a time.
 *
 * Fragments are buffered until the buffer reaches the minimum length. The next fragment with a
 * ., ,, ! or ? closes the breath at that mark, and the text after the mark opens the next breath.
 * finish() returns whatever is still buffered, so a short reply or the last clause is not lost.
 */

export const MIN_BREATH_LENGTH = 20

export interface BreathSplitter {
  /** Adds a streamed fragment. Returns the breath it closed, or null while the breath is still open. */
  push: (fragment: string) => string | null
  /** Ends the stream. Returns the buffered text as the last breath, or null when nothing is left to speak. */
  finish: () => string | null
}

export const createBreathSplitter = (minLength: number = MIN_BREATH_LENGTH): BreathSplitter => {
  let buffer = ''

  return {
    push(fragment) {
      if (buffer.length < minLength) {
        buffer += fragment
        return null
      }

      const boundary = fragment.search(/[.,!?]/)
      if (boundary < 0) {
        buffer += fragment
        return null
      }

      const end = boundary + 1
      const breath = buffer + fragment.slice(0, end)
      buffer = fragment.slice(end)
      return breath
    },
    finish() {
      const rest = buffer
      buffer = ''
      return rest.trim() ? rest : null
    }
  }
}
