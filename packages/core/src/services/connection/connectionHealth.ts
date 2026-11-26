import type { ActivationState, LLMConfig, LLMProvider } from '../llm/config/llmConfig'
import { apiUrl } from '../../config/apiBase'
import { isDesktopShell } from '../../config/nativeShell'

export type { ActivationState }

/**
 * What "Check connection" checks, besides the provider: the server the user picked in
 * Settings and the model they want from it.
 *
 * The check used to ask the build's own `/api/health` whatever the user had picked. In the
 * desktop and Android apps that path is the app's bundle, not a server, so a backend chosen
 * at run time could never be verified, and an unverified session refuses to chat.
 */
export interface ConnectionTarget {
  /** Proxy: the BFF's chat URL (`https://hub.example/api/chat`). Ollama: the server's base URL. */
  url?: string
  /** The model to ask for. An Ollama check reports whether it is pulled. */
  model?: string
}

/** The target for the settings a provider has saved. */
export function connectionTargetFor(config: Partial<LLMConfig>): ConnectionTarget {
  switch (config.llm_provider) {
    case 'proxy':
      return { url: config.proxy_url, model: config.proxy_model }
    case 'ollama':
      return { url: config.ollama_url, model: config.ollama_model }
    case 'mlc':
      return { model: config.mlc_model }
    default:
      return {}
  }
}

/**
 * The BFF's health route beside the chat URL the user entered: `…/api/chat` becomes
 * `…/api/health`, an absolute URL with any other path gets `/api/health` on its origin, and no
 * URL (or a relative one) means this build's own BFF.
 */
export function bffHealthUrl(chatUrl?: string): string {
  const url = (chatUrl ?? '').trim().replace(/\/+$/, '')
  if (/\/api\/chat$/.test(url)) return url.replace(/\/api\/chat$/, '/api/health')
  if (/^https?:\/\//i.test(url)) return new URL('/api/health', url).toString()
  return apiUrl('/api/health')
}

/** Ollama's model list, under the server URL the user entered. */
export function ollamaTagsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/api/tags`
}

async function fetchOllamaHealth(target: ConnectionTarget): Promise<ConnectionHealth> {
  const base = (target.url ?? '').trim()
  if (!base) throw new Error('Enter the URL of your Ollama server, such as http://localhost:11434')

  let response: Response
  try {
    response = await fetch(ollamaTagsUrl(base), { cache: 'no-store', headers: { accept: 'application/json' } })
  } catch {
    // A refused connection and a CORS refusal look the same from here.
    throw new Error(
      `Could not reach Ollama at ${base}. Check that it is running and that its OLLAMA_ORIGINS allows this app.`
    )
  }
  if (!response.ok) throw new Error(`Ollama check failed (${response.status})`)
  const contentType = response.headers?.get('content-type') ?? ''
  if (!contentType.includes('application/json')) throw new Error(`No Ollama server answered at ${base}`)

  const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
  const installed = (payload.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean)
  const model = target.model?.trim() || undefined
  const hasModel = !model || installed.some((name) => name === model || name === `${model}:latest`)
  return {
    status: hasModel ? 'ok' : 'degraded',
    upstream: 'ollama',
    model,
    // Chat with a model the server does not have fails on every turn, so it does not count.
    reachable: hasModel,
    detail: hasModel
      ? `Ollama answered with ${installed.length} model${installed.length === 1 ? '' : 's'}.`
      : `Ollama answered, but it does not have ${model}. Pull it with: ollama pull ${model}`,
    memory: { configured: false, reachable: false }
  }
}

/** On-device models (WebLLM) need no server, only a WebGPU adapter. */
async function checkOnDevice(target: ConnectionTarget): Promise<ConnectionHealth> {
  // The engine's worker used to import it from a CDN, which the desktop app's content security policy
  // blocked. It is bundled with the app now (llm/webllm.worker.ts), which that policy allows, but no
  // model has been run in the desktop app since, so this keeps saying it does not run there until one
  // has, instead of passing a check that the first message might then fail.
  if (isDesktopShell()) {
    return {
      status: 'degraded',
      upstream: 'webllm',
      model: target.model,
      reachable: false,
      detail: 'On-device models do not run in the desktop app yet. Pick Proxy or Ollama instead.',
      memory: { configured: false, reachable: false }
    }
  }
  let adapter: unknown = null
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
      adapter = await navigator.gpu.requestAdapter()
    }
  } catch {
    adapter = null
  }
  return {
    status: adapter ? 'ok' : 'degraded',
    upstream: 'webllm',
    model: target.model,
    reachable: Boolean(adapter),
    detail: adapter
      ? 'On-device: the model downloads from huggingface.co the first time you chat.'
      : 'On-device models need WebGPU, which this device or app does not offer.',
    memory: { configured: false, reachable: false }
  }
}

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

/**
 * Check the backend the user picked: the BFF behind the Proxy URL, the Ollama server, or (for
 * on-device models) WebGPU. Without a provider it checks this build's own BFF, as it always did.
 */
export async function fetchConnectionHealth(
  provider?: LLMProvider,
  target: ConnectionTarget = {}
): Promise<ConnectionHealth> {
  if (provider === 'mlc') return checkOnDevice(target)
  if (typeof fetch !== 'function') {
    throw new Error('Connection checks are unavailable in this environment')
  }
  if (provider === 'ollama') return fetchOllamaHealth(target)

  const response = await fetch(provider === 'proxy' ? bffHealthUrl(target.url) : apiUrl('/api/health'), {
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
