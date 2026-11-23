import type { ResolvedConfig } from '../config.js'
import { createAiAvatarKitAdapter } from './aiavatarkit.js'
import { createCiServerAdapter } from './ciServer.js'
import { createOllamaAdapter } from './ollama.js'
import { createOpenAIAdapter } from './openaiCompat.js'
import type { UpstreamAdapter } from './types.js'

export function selectUpstream(cfg: ResolvedConfig): UpstreamAdapter {
  switch (cfg.upstream) {
    case 'openai':
      return createOpenAIAdapter(cfg)
    case 'aiavatarkit':
      return createAiAvatarKitAdapter(cfg)
    case 'ci-server':
      return createCiServerAdapter(cfg)
    case 'ollama':
    default:
      return createOllamaAdapter(cfg)
  }
}

export type { UpstreamAdapter } from './types.js'
export type { ChatEvent, ChatMessage, ChatRequest } from './types.js'
