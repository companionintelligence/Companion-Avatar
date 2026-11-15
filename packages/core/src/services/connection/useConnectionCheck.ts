import { useCallback, useState } from 'react'
import type { ActivationState, LLMProvider } from '../llm/config/llmConfig'
import {
  deriveActivationState,
  fetchConnectionHealth,
  type ConnectionCheckState,
  type ConnectionHealth,
  type ConnectionTarget
} from './connectionHealth'

export interface UseConnectionCheckResult {
  healthState: ConnectionCheckState
  health: ConnectionHealth | null
  healthError: string | null
  checkConnection: () => Promise<void>
}

/**
 * "Check connection" for the provider the user picked. `target` is the server URL and model
 * they picked with it (see `ConnectionTarget`); without one, the check asks this build's own BFF.
 */
export function useConnectionCheck(
  provider: LLMProvider,
  onActivationStateChange?: (state: ActivationState) => void,
  target?: ConnectionTarget
): UseConnectionCheckResult {
  const [healthState, setHealthState] = useState<ConnectionCheckState>('idle')
  const [health, setHealth] = useState<ConnectionHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const targetUrl = target?.url
  const targetModel = target?.model

  const checkConnection = useCallback(async () => {
    // Demo mode has no live backend by design — hitting /api/health here would
    // only ever 404 into the SPA fallback and surface a confusing raw
    // JSON-parse error.
    if (provider === 'script') {
      setHealth(null)
      setHealthError(null)
      setHealthState('demo')
      onActivationStateChange?.('demo-only')
      return
    }

    setHealthState('checking')
    setHealthError(null)

    try {
      const payload = await fetchConnectionHealth(provider, { url: targetUrl, model: targetModel })
      setHealth(payload)
      onActivationStateChange?.(deriveActivationState(payload, provider))
      if (!payload.reachable) {
        setHealthState('error')
        setHealthError(payload.detail ?? null)
      } else if (payload.tts && !payload.tts.reachable) {
        setHealthState('degraded')
      } else {
        setHealthState('healthy')
      }
    } catch (error) {
      setHealth(null)
      setHealthState('error')
      setHealthError(error instanceof Error ? error.message : 'Unable to check the connection')
      onActivationStateChange?.('unverified')
    }
  }, [provider, onActivationStateChange, targetUrl, targetModel])

  return { healthState, health, healthError, checkConnection }
}
