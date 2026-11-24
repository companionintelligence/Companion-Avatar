import type { EmoteConfig } from '../configs/emoteConfig'
import { mapEmotionToVRM } from '../emoteService'
import { VRM_EXPRESSIONS, type EmoteState, type FacialTarget } from '../emoteTypes'
import { applyExpression, clamp } from '../utils/expressionUtils'

// How long a VRM relaxed or neutral tick pulse stays on before it is cleared.
const VRM_TICK_CLEAR_MS = 500

// How long a brow tick key is held before it is re-picked. Re-picking on a per-frame chance made the
// brows jitter several times a second, so the key now changes about every 1.5 seconds.
const TICK_REPICK_MS = 1500

// Pending clear timers, per state. They live beside the module rather than on EmoteState so
// the state type stays unchanged; resetEmoteState and the avatar setups cancel them (M24).
const pendingVrmClears = new WeakMap<EmoteState, Set<ReturnType<typeof setTimeout>>>()

// The value the active emotion holds for a key, or 0 when it does not drive it.
const baselineOf = (state: EmoteState, key: keyof FacialTarget): number => state.emotionTargets[key] ?? 0

// A mood owns the face while its baseline is active.
const hasMoodBaseline = (state: EmoteState): boolean => Object.keys(state.emotionTargets).length > 0

// The VRM key the active mood writes, or null before any mood has been applied. It comes from the
// same mood-to-VRM mapping applyEmotion uses, so a pulse is skipped only where the mood drives that key.
const activeMoodVrmKey = (state: EmoteState): string | null =>
  hasMoodBaseline(state) ? mapEmotionToVRM(state.currentEmotion) : null

// Return the key the tick last drove to its baseline, so no tick residue is left behind (M14).
const releaseTick = (state: EmoteState): void => {
  const key = state.tickState.currentTick
  if (key && state.targets[key] !== undefined) {
    state.targets[key] = baselineOf(state, key)
  }
}

// Clear a VRM tick pulse after a delay, but only while the value is still the one this tick
// wrote; a mood or reset that has written the key since owns it now (M24).
const scheduleVrmTickClear = (state: EmoteState, key: string, value: number): void => {
  const timers = pendingVrmClears.get(state) ?? new Set<ReturnType<typeof setTimeout>>()
  pendingVrmClears.set(state, timers)

  const timer = setTimeout(() => {
    timers.delete(timer)
    if ((state.targets as Record<string, number | undefined>)[key] === value) {
      applyExpression(state, key, 0)
    }
  }, VRM_TICK_CLEAR_MS)
  timers.add(timer)
}

// Cancel a state's pending VRM tick clears: on reset, on barge-in and on avatar switch (M24).
export const cancelFacialTickTimers = (state: EmoteState): void => {
  const timers = pendingVrmClears.get(state)
  if (!timers) return
  timers.forEach((timer) => clearTimeout(timer))
  pendingVrmClears.delete(state)
}

const handleAdvancedTickExpressions = (state: EmoteState, _delta: number , config : EmoteConfig): void => {
  const currentTime = performance.now()
  const { tickState } = state
  
  const tickTargets: readonly (keyof FacialTarget)[] = [
    'browDownLeft',
    'browDownRight',
    'browInnerUp',
    'browOuterUpLeft',
    'browOuterUpRight',
    'cheekSquintLeft',
    'cheekSquintRight'
  ]

  // Generate tick value based on time (more subtle for natural look)
  const tickValue = clamp(Math.sin(currentTime / config.tick.frequency) * config.tick.intensity, 0, config.tick.intensity)

  if (tickValue <= 0.01) {
    releaseTick(state)
    tickState.currentTick = null
    return
  }

  // Pick a new tick target when none is held, or once the held key has had its time
  if (!tickState.currentTick || currentTime - tickState.tickStartTime >= TICK_REPICK_MS) {
    releaseTick(state)
    tickState.currentTick = tickTargets[Math.floor(Math.random() * tickTargets.length)]
    tickState.tickStartTime = currentTime
  }

  // Tick around the emotion baseline: the baseline is the floor and the tick only lifts above it (M14).
  if (tickState.currentTick && state.targets[tickState.currentTick] !== undefined) {
    state.targets[tickState.currentTick] = clamp(baselineOf(state, tickState.currentTick) + tickValue, 0, 1)
  }


}

export const updateFacialTicks = (state: EmoteState, _delta: number , config : EmoteConfig): void => {
  if (!state.targets) return
  const currentTime = performance.now()

  
  handleAdvancedTickExpressions(state, _delta, config)


  // Non-mouth tick expressions for subtle movement
  const vrmTickExpressions = [
    VRM_EXPRESSIONS.relaxed,
    VRM_EXPRESSIONS.neutral
  ]  as const

  const tickValue = clamp(Math.sin(currentTime / config.tick.frequency) * config.tick.intensity, 0, config.tick.intensity)

  // Apply subtle VRM tick expressions (eye movements only). A pulse is skipped only when it would
  // overwrite the key the active mood writes; the other key still pulses (M24).
  if (Math.random() < config.tick.probability && vrmTickExpressions.length > 0) {
    // Even less frequent for subtlety
    const randomVrmTick = vrmTickExpressions[Math.floor(Math.random() * vrmTickExpressions.length)]
    if (randomVrmTick !== activeMoodVrmKey(state)) {
      const pulse = tickValue * 0.2 // Very subtle for VRM
      applyExpression(state, randomVrmTick, pulse)

      // Clear the expression shortly after
      scheduleVrmTickClear(state, randomVrmTick, pulse)
    }
  }
}


