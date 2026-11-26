import { useEffect, useRef } from 'react'
import type { ActivationState, LLMConfig } from '../llm/config/llmConfig'
import { connectionTargetFor, deriveActivationState, fetchConnectionHealth } from './connectionHealth'
import { isRememberedConnection, verifiedConnectionKey } from './verifiedConnections'

/**
 * Bring a session back to life at launch without a trip to Settings.
 *
 * - The scripted provider has no server, so it starts as Demo-only. It used to start Unverified
 *   after every relaunch, and the demo answered "I am not connected yet" until someone pressed
 *   Check connection.
 * - A server the user has checked before (see `verifiedConnections`) is checked again, quietly,
 *   with the same check the button runs. Only a passing check changes the state; a failure leaves
 *   it Unverified, and the user can run Check connection as before.
 * - Anything else stays Unverified until the user checks it.
 *
 * It runs again when the saved provider, server or model changes. An answer that arrives after the
 * settings moved on is dropped, because it is about another server.
 */
export function useRememberedConnection(
  settings: LLMConfig,
  onActivationStateChange?: (state: ActivationState) => void
): void {
  const provider = settings.llm_provider
  const target = connectionTargetFor(settings)
  const targetUrl = target.url
  const targetModel = target.model
  const key = provider ? verifiedConnectionKey(provider, target) : null

  // The key of the settings as they are now, for answers that arrive late.
  const currentKey = useRef(key)
  currentKey.current = key

  useEffect(() => {
    if (!provider) return
    if (provider === 'script') {
      onActivationStateChange?.('demo-only')
      return
    }
    const checked = { url: targetUrl, model: targetModel }
    if (!isRememberedConnection(provider, checked)) return

    let cancelled = false
    const checkedKey = verifiedConnectionKey(provider, checked)
    fetchConnectionHealth(provider, checked)
      .then((health) => {
        if (cancelled || currentKey.current !== checkedKey || !health.reachable) return
        onActivationStateChange?.(deriveActivationState(health, provider))
      })
      .catch(() => {
        // The server is down or refused: stay Unverified. Check connection says why.
      })
    return () => {
      cancelled = true
    }
  }, [provider, targetUrl, targetModel, onActivationStateChange])
}
