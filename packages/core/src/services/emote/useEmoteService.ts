import type { VRM } from '@pixiv/three-vrm'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Camera, Object3D } from 'three'

import { defaultEmoteConfig, type EmoteConfig } from './configs/emoteConfig'
import {
  applyEmoteStateToMorphTargets,
  applyEmoteStateToVRM,
  applyEmotion,
  handleBargeIn,
  initializeEmoteState,
  resetEmoteState,
  setupEmoteStateForMorphTargets,
  setupEmoteStateForVRM,
  startPerformance,
  emoteUpdate as emoteUpdate
} from './emoteService'
import type { EmoteResult, EmoteState, EmotionType, PerformanceData } from './emoteTypes'
import { initiateGaze } from './modules/gazeService'

// Each section can be given partially. Plain objects merge key by key at every depth, so an
// unspecified key survives: gaze.maxDistance when only gaze.options is given, or gaze.options.delay
// when only randomness is given. Arrays and other values are replaced whole.
type EmoteConfigUpdate = { [K in keyof EmoteConfig]?: Partial<EmoteConfig[K]> }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype

const mergeDeep = (base: unknown, update: unknown): unknown => {
  if (!isPlainObject(base) || !isPlainObject(update)) return update
  const next: Record<string, unknown> = { ...base }
  for (const key of Object.keys(update)) {
    next[key] = mergeDeep(base[key], update[key])
  }
  return next
}

const mergeEmoteConfig = (prev: EmoteConfig, update: EmoteConfigUpdate): EmoteConfig =>
  mergeDeep(prev, update) as EmoteConfig

export const useEmoteService = (initialConfig?: Partial<EmoteConfig>) => {
  const emoteStateRef = useRef<EmoteState>(initializeEmoteState())
  const [config, setConfig] = useState<EmoteConfig>({
    ...defaultEmoteConfig,
    ...initialConfig
  })

  const setEmotion = useCallback((emotion: EmotionType): EmoteResult => {
    return applyEmotion(emoteStateRef.current, emotion)
  }, [])

  const performAction = useCallback((performanceData: PerformanceData, _delta: number = 0.33): EmoteResult => {
    return startPerformance(emoteStateRef.current, performanceData, _delta)
  }, [])

  const triggerGaze = useCallback((): void => {
    initiateGaze(emoteStateRef.current, config.gaze.options)
  }, [config])

  const update = useCallback((_delta: number) => {
    emoteUpdate(emoteStateRef.current, _delta , config)
  }, [config])

  const reset = useCallback(() => {
    resetEmoteState(emoteStateRef.current)
  }, [])

  const updateConfig = useCallback((newConfig: EmoteConfigUpdate) => {
    setConfig((prev) => mergeEmoteConfig(prev, newConfig))
  }, [])

  const onBargeIn = useCallback(() => {
    handleBargeIn(emoteStateRef.current)
  }, [])

  const setupForVRM = useCallback((vrm: VRM): EmoteResult => {
    return setupEmoteStateForVRM(emoteStateRef.current, vrm)
  }, [])

  const setupForMorphTargets = useCallback(
    (morphs: { morphTargetInfluences: number[] }[], dictionary: Record<string, number[]>): EmoteResult => {
      return setupEmoteStateForMorphTargets(emoteStateRef.current, morphs, dictionary)
    },
    []
  )

  const applyToVRM = useCallback((vrm: VRM): EmoteResult => {
    return applyEmoteStateToVRM(emoteStateRef.current, vrm)
  }, [])

  const applyToMorphTargets = useCallback(
    (morphs: { morphTargetInfluences: number[] }[], dictionary: Record<string, number[]>): EmoteResult => {
      return applyEmoteStateToMorphTargets(emoteStateRef.current, morphs, dictionary)
    },
    []
  )

  const setAvatarReferences = useCallback(
    (references: { bones?: Record<string, unknown>; node?: Object3D; camera: Camera }): void => {
      const state = emoteStateRef.current
      if (references.bones) state.bones = references.bones as EmoteState['bones']
      if (references.node) state.node = references.node as EmoteState['node']
      if (references.camera) state.camera = references.camera as EmoteState['camera']
    },
    []
  )


  const state = useMemo(() => 
    ({
      emote: emoteStateRef.current,
      config: config
    })
  , [config])

  const actions = useMemo(
    () => ({
      update,
      reset,
      setEmotion,
      performAction,
      triggerGaze,
      onBargeIn,
      setupForVRM,
      setupForMorphTargets,
      setAvatarReferences,
      applyToVRM,
      applyToMorphTargets,
      updateConfig,
    }),
    [
      setEmotion,
      performAction,
      triggerGaze,
      reset,
      onBargeIn,
      update,
      setupForVRM,
      setupForMorphTargets,
      setAvatarReferences,
      applyToVRM,
      applyToMorphTargets
    ]
  )

  return useMemo(
    () => ({
      state,
      actions,
    }),
    [actions, state]
  )
}
