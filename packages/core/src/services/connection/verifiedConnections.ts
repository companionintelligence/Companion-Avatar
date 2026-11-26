import type { LLMProvider } from '../llm/config/llmConfig'
import type { ConnectionTarget } from './connectionHealth'

/**
 * The servers this browser has passed "Check connection" against.
 *
 * The app does not talk to a backend until a check has passed in the current session. That rule
 * stays: nothing read from here counts as a verified connection. What this list adds is that the
 * app may run the same check by itself at the next launch, for the saved settings, when they name a
 * server the user has checked before. Without it, every relaunch on every device asked for Check
 * connection again before the avatar would answer. A server the user never checked is never
 * contacted on its own.
 *
 * Entries are keyed by provider, server URL and model, so checking one server never vouches for
 * another, and a model that was never checked on a server is checked by hand like any new server.
 */
const STORAGE_KEY = 'ci_avatar_verified_connections'

/** Enough for a few servers (home, work, a tailnet); the oldest drops off. */
export const MAX_REMEMBERED_CONNECTIONS = 8

/**
 * Storage can be missing or refuse access (a sandboxed document, blocked site data): reading
 * `localStorage` then throws. That must never break a check, so every access sits in a try.
 */
function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** One spelling per server: no stray spaces or trailing slashes, and a lowercase scheme and host. */
function normalizeUrl(raw?: string): string {
  const url = (raw ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) return url
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  } catch {
    return url
  }
}

/**
 * The key a check is remembered under, or null for the scripted provider, which has no server to
 * check.
 */
export function verifiedConnectionKey(provider: LLMProvider, target: ConnectionTarget = {}): string | null {
  if (provider === 'script') return null
  return JSON.stringify([provider, normalizeUrl(target.url), (target.model ?? '').trim()])
}

function readKeys(): string[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

function writeKeys(keys: string[]): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(keys.slice(0, MAX_REMEMBERED_CONNECTIONS)))
  } catch {
    // Full or blocked storage: the next launch asks for Check connection, as it always did.
  }
}

/** Record a check that passed. The newest entry goes first. */
export function rememberVerifiedConnection(provider: LLMProvider, target: ConnectionTarget = {}): void {
  const key = verifiedConnectionKey(provider, target)
  if (!key) return
  writeKeys([key, ...readKeys().filter((existing) => existing !== key)])
}

/** Whether a check of this provider, server and model has passed here before. */
export function isRememberedConnection(provider: LLMProvider, target: ConnectionTarget = {}): boolean {
  const key = verifiedConnectionKey(provider, target)
  return key !== null && readKeys().includes(key)
}
