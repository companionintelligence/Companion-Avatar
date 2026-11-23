import type { ResolvedConfig } from '../config.js'
import { type ChatEvent, type ChatRequest, type UpstreamAdapter, readLines } from './types.js'

/** One OpenAI-style Chat Completions endpoint: the base URL that `/chat/completions` is added to, and its bearer token. */
export interface ChatCompletionsEndpoint {
  /** Named in error messages. */
  name: string
  /** Base URL, including any `/v1` prefix. */
  baseUrl: string
  /** Sent as `Authorization: Bearer <bearerToken>`. */
  bearerToken: string
  /** Used when a request names no model. */
  defaultModel: string
}

/** One SSE data object from a Chat Completions stream. */
interface StreamLine {
  choices?: { delta?: { content?: string } }[]
  error?: unknown
}

/**
 * Stream one turn from an OpenAI-style Chat Completions endpoint (OpenAI, vLLM, Lemonade, AIAvatarKit, ...). These stream
 * SSE lines `data: { choices: [{ delta: { content } }] }` terminated by `data: [DONE]`. A line that carries an `error`
 * object ends the turn with a fixed message: the upstream's own text is never copied out.
 */
export async function* streamChatCompletions(
  endpoint: ChatCompletionsEndpoint,
  req: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<ChatEvent> {
  let res: Response
  try {
    res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.bearerToken}`
      },
      body: JSON.stringify({
        model: req.model || endpoint.defaultModel,
        messages: req.messages,
        stream: true
      }),
      signal
    })
  } catch (err) {
    yield { type: 'error', message: `${endpoint.name} request failed: ${(err as Error).message}` }
    return
  }

  if (!res.ok || !res.body) {
    yield { type: 'error', message: `${endpoint.name} responded ${res.status}` }
    return
  }

  for await (const line of readLines(res.body)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') {
      yield { type: 'done' }
      return
    }
    let obj: StreamLine | null
    try {
      obj = JSON.parse(data) as StreamLine | null
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    if (obj.error) {
      yield { type: 'error', message: `${endpoint.name} reported an error` }
      return
    }
    const content = obj.choices?.[0]?.delta?.content
    if (content) yield { type: 'chunk', content }
  }
  yield { type: 'done' }
}

/** The OpenAI API, or any server that speaks its Chat Completions. */
export function createOpenAIAdapter(cfg: ResolvedConfig): UpstreamAdapter {
  const endpoint: ChatCompletionsEndpoint = {
    name: 'openai',
    baseUrl: cfg.openaiUrl,
    bearerToken: cfg.openaiApiKey,
    defaultModel: cfg.openaiModel
  }
  return {
    name: 'openai',
    chat: (req, signal) => streamChatCompletions(endpoint, req, signal),

    async health() {
      return {
        ok: Boolean(cfg.openaiApiKey),
        detail: cfg.openaiApiKey ? 'openai key present' : 'openai key missing'
      }
    }
  }
}
