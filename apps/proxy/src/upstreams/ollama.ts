import type { ResolvedConfig } from '../config.js'
import { type ChatEvent, type ChatRequest, type UpstreamAdapter, readLines } from './types.js'

/**
 * Ollama adapter. Ollama streams newline-delimited JSON objects of the shape
 * `{ message: { content }, done }` from `POST /api/chat`.
 */
export function createOllamaAdapter(cfg: ResolvedConfig): UpstreamAdapter {
  return {
    name: 'ollama',

    async *chat(req: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
      let res: Response
      try {
        res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: req.model || cfg.ollamaModel,
            messages: req.messages,
            stream: true,
            // Only when APP_OLLAMA_NUM_CTX is set; otherwise the server's OLLAMA_CONTEXT_LENGTH applies.
            ...(cfg.ollamaNumCtx ? { options: { num_ctx: cfg.ollamaNumCtx } } : {})
          }),
          signal
        })
      } catch (err) {
        yield { type: 'error', message: `ollama request failed: ${(err as Error).message}` }
        return
      }

      if (!res.ok || !res.body) {
        yield { type: 'error', message: `ollama responded ${res.status}` }
        return
      }

      for await (const line of readLines(res.body)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let obj: { message?: { content?: string }; done?: boolean }
        try {
          obj = JSON.parse(trimmed)
        } catch {
          continue // skip malformed lines rather than aborting the stream
        }
        const content = obj.message?.content
        if (content) yield { type: 'chunk', content }
        if (obj.done) {
          yield { type: 'done' }
          return
        }
      }
      yield { type: 'done' }
    },

    async health() {
      try {
        const res = await fetch(`${cfg.ollamaUrl}/api/tags`)
        return { ok: res.ok, detail: `ollama ${res.status}` }
      } catch (err) {
        return { ok: false, detail: `ollama unreachable: ${(err as Error).message}` }
      }
    }
  }
}
