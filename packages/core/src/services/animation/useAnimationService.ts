import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { ANIMATION_CLIPS } from './config/animationClips'
import {
  applyPersonality,
  clearAnimationQueue,
  enqueueAnimation,
  getCurrentAnimationInfo,
  getPersonalityAnimationClips,
  initializeAnimationState,
  initializeDefaultAnimation,
  resetAnimationState,
  setAnimationEnabled,
  setupAnimationState,
  startPerformance,
  updateAnimation
} from './animationService'
import type { AnimationClip, AnimationPerformanceData, AnimationState } from './animationTypes'

export const useAnimationService = () => {
  const animationStateRef = useRef<AnimationState>(initializeAnimationState())

  const setPersonality = useCallback((personality: string) => {
    applyPersonality(animationStateRef.current, personality)
  }, [])

  const performAction = useCallback((performanceData: AnimationPerformanceData) => {
    const startTime = performance.now()
    startPerformance(animationStateRef.current, performanceData, startTime)
  }, [])

  const reset = useCallback(() => {
    resetAnimationState(animationStateRef.current)
  }, [])

  /**
   * Turn idle variety on or off.
   *
   * This used to call `setAnimationEnabled`, which is the MASTER gate for the
   * whole animation service — not the cycling flag. So enabling "cycling" merely
   * re-enabled animation, `cyclingState.cyclingEnabled` stayed false, and the
   * weighted idle picker plus all six personality presets never ran once. The
   * avatar sat in a single looping idle for the life of the app.
   */
  const enableCycling = useCallback((enabled: boolean) => {
    animationStateRef.current.cyclingState.cyclingEnabled = enabled
  }, [])

  /**
   * The master gate for the whole animation service.
   *
   * Exposed because `enableCycling` was previously its only caller — by mistake —
   * which meant there was no working way to enable idle variety AND no working
   * way to stop animation either. Both capabilities existed; neither was reachable.
   */
  const setEnabled = useCallback((enabled: boolean) => {
    setAnimationEnabled(animationStateRef.current, enabled)
  }, [])

  const setup = useCallback(
    (
      actions: Record<string, THREE.AnimationAction>,
      mixer: THREE.AnimationMixer,
      avatar?: THREE.Object3D,
      animation?: AnimationClip,
      catalog?: Record<string, AnimationClip>
    ) => {
      setupAnimationState(animationStateRef.current, actions, mixer, avatar, catalog)

      // Initialize with a default animation
      const personality = animationStateRef.current.currentPersonality
      initializeDefaultAnimation(animationStateRef.current, personality, animation)
    },
    []
  )

  const update = useCallback((delta: number) => {
    updateAnimation(animationStateRef.current, delta)
  }, [])

  const getCurrentInfo = useCallback(() => {
    return getCurrentAnimationInfo(animationStateRef.current)
  }, [])

  const getAvailableClips = useCallback((): AnimationClip[] => {
    const personality = animationStateRef.current.currentPersonality
    return getPersonalityAnimationClips(personality, animationStateRef.current.catalog ?? ANIMATION_CLIPS)
  }, [])

  const actions = useMemo(
    () => ({
      setPersonality,
      performAction,
      enqueue: (performanceData: AnimationPerformanceData) =>
        enqueueAnimation(animationStateRef.current, performanceData),
      clearQueue: () => clearAnimationQueue(animationStateRef.current),
      enableCycling,
      setEnabled,
      reset,
      setup,
      update,
      getCurrentInfo,
      getAvailableClips,
    }),
    [setPersonality, performAction, enqueueAnimation, clearAnimationQueue, enableCycling, reset, setup, update, getCurrentInfo, getAvailableClips, setEnabled]
  )

  const state = useMemo(
    () => animationStateRef.current
    ,
    [animationStateRef.current]
  )

  return useMemo(
    () => ({
      actions,
      state
    }),
    [actions, state]
  )
}
