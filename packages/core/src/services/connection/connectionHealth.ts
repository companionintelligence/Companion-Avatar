import type { ActivationState, LLMProvider } from '../llm/config/llmConfig'
import { apiUrl } from '../../config/apiBase'

export type { ActivationState }

export interface ConnectionHealth {
  status?: 'ok' | 'degraded'
  upstream?: string
  model?: string
  reachable: boolean
  detail?: string
  memory?: {
    configured: boolean
    reachable: boolean
    detail?: string
  }
  tts?: {
    upstream?: string
    model?: string
    voice?: string
    reachable: boolean
    detail?: string
  }
}

export type ConnectionCheckState = 'idle' | 'checking' | 'healthy' | 'degraded' | 'error' | 'demo'

export async function fetchConnectionHealth(): Promise<ConnectionHealth> {
  if (typeof fetch !== 'function') {
    throw new Error('Connection checks are unavailable in this environment')
  }

  const response = await fetch(apiUrl('/api/health'), {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`)
  }

  // A static deployment with no backend proxy (e.g. this app's Cloudflare Pages
  // build) has no route at /api/health, so the request falls through to the
  // SPA's index.html fallback and comes back 200 with an HTML body. Catch that
  // here instead of letting `.json()` throw a raw "Unexpected token '<'" at the user.
  const contentType = response.headers?.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('No backend proxy is reachable at this URL — this deployment has no live service configured')
  }

  const payload = (await response.json()) as ConnectionHealth
  if (typeof payload.reachable !== 'boolean') {
    throw new Error('Health response did not report chat reachability')
  }
  return payload
}

export function deriveActivationState(health: ConnectionHealth, provider?: LLMProvider): ActivationState {
  if (provider === 'script') return 'demo-only'
  if (!health.reachable) return 'unverified'
  if (health.memory?.configured && health.memory.reachable) return 'memory-ready'
  return 'chat-only'
}

export function activationStateLabel(state: ActivationState): string {
  switch (state) {
    case 'demo-only':
      return 'Demo-only'
    case 'chat-only':
      return 'Chat-only'
    case 'memory-ready':
      return 'Memory-ready'
    case 'unverified':
      return 'Unverified'
  }
}
