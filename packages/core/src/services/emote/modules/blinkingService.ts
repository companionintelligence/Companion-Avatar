import type { EmoteConfig } from '../configs/emoteConfig'
import type { EmoteState, FacialTarget } from '../emoteTypes'
import { applyExpression } from '../utils/expressionUtils'

export const updateBlinking = (state: EmoteState, _delta: number , config: EmoteConfig): void => {
  if (!state.targets) return

  const currentTime = performance.now()
  const { blinkState } = state
  // Time to start a new blink
  if (currentTime >= blinkState.nextBlinkTime && !blinkState.isBlinking) {
    blinkState.isBlinking = true
    blinkState.blinkStartTime = currentTime
    blinkState.nextBlinkTime =
      currentTime + Math.random() * (config.blink.maxInterval - config.blink.minInterval) + config.blink.minInterval
  }

  // Handle active blink
  if (blinkState.isBlinking) {
    const blinkDuration = currentTime - blinkState.blinkStartTime

    if (blinkDuration < config.blink.cycleDuration) {
      // Blink animation using sine wave
      const blinkValue = Math.max(0, Math.min(1, Math.sin((blinkDuration / config.blink.cycleDuration) * Math.PI)))

      applyBlinkExpression(state, blinkValue)
    } else {
      // End blink
      blinkState.isBlinking = false
      resetBlinkExpression(state)
    }
  }
}

// The GLB eyelid channels the blink owns. eyesClosed is not blink-owned (L6): it is an
// alias that only emotion baselines drive, such as sleep.
const BLINK_LID_KEYS: readonly (keyof FacialTarget)[] = ['eyeBlinkLeft', 'eyeBlinkRight']

// The value the active emotion holds for a key, or 0 when it does not drive it.
const baselineOf = (state: EmoteState, key: keyof FacialTarget): number => state.emotionTargets[key] ?? 0

const applyBlinkExpression = (state: EmoteState, value: number): void => {
  if (state.vrm) {
    applyExpression(state, 'blink', value)
  } else {
    // Stack on the emotion baseline rather than replace it: a mood that already closes
    // the lids (sleep) must not snap them open at the start of each blink (M13).
    for (const key of BLINK_LID_KEYS) {
      applyExpression(state, key, Math.max(baselineOf(state, key), value))
    }
  }
}

const resetBlinkExpression = (state: EmoteState): void => {
  applyExpression(state, 'blink', 0)
  // Return the lids to the active emotion's baseline, not to zero (M13).
  for (const key of BLINK_LID_KEYS) {
    applyExpression(state, key, baselineOf(state, key))
  }
}
