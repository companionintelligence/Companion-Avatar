import type { ResolvedConfig } from '../config.js'
import { type ChatCompletionsEndpoint, streamChatCompletions } from './openaiCompat.js'
import type { UpstreamAdapter } from './types.js'

/**
 * AIAvatarKit (github.com/uezo/aiavatarkit, Apache-2.0): the Chat Completions endpoint that its experimental
 * `AIAvatarChatCompletionsServer` serves at `/v1/chat/completions`. Nothing from that project is copied here. The proxy
 * speaks the endpoint's HTTP contract, the same one the OpenAI adapter reads.
 *
 * Three things differ from OpenAI, and each one matters to an operator:
 * - The bearer token is an identifier, not a credential. The server keys its conversation on it, and nothing checks it.
 *   The proxy sends one value for every visitor, so every visitor shares one conversation. Keep the server on a private
 *   network, reachable only from this proxy.
 * - The server answers from its own system prompt and the conversation it keeps under that identifier. It reads the
 *   newest user message and ignores the rest of `messages`.
 * - Its replies are text only. The face and animation requests that its other channels send are not part of this
 *   endpoint.
 */
export function createAiAvatarKitAdapter(cfg: ResolvedConfig): UpstreamAdapter {
  const endpoint: ChatCompletionsEndpoint = {
    name: 'aiavatarkit',
    baseUrl: cfg.aiavatarkitUrl,
    bearerToken: cfg.aiavatarkitToken,
    defaultModel: 'aiavatarkit'
  }
  return {
    name: 'aiavatarkit',
    chat: (req, signal) => streamChatCompletions(endpoint, req, signal),

    async health() {
      // Every call runs a conversational turn, so there is no cheap probe. This reports configuration only.
      const ok = Boolean(cfg.aiavatarkitUrl && cfg.aiavatarkitToken)
      return {
        ok,
        detail: ok ? 'aiavatarkit configured (not probed)' : 'aiavatarkit url or token missing'
      }
    }
  }
}
