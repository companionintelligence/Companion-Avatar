import type { VRM } from '@pixiv/three-vrm'

import { lipsyncConvert } from './lipsync/lipsyncQueue'
import { applyCurve, defaultVisemeConfig, type VisemeConfig } from './config/visemeConfig'
import type { VisemeSequenceItem, VisemeState, VisemeTarget, VRMVisemeTarget, WhisperData } from './visemeTypes'
import { createEmptyVisemeTarget, createEmptyVRMVisemeTarget } from './visemeTypes'

const OCULUS_TO_VRM_MAPPING: Record<keyof VisemeTarget, keyof VRMVisemeTarget> = {
  // Vowels - direct mapping where possible
  viseme_aa: 'aa', // open back vowel → aa
  viseme_E: 'ee', // mid front vowel → ee
  viseme_I: 'ee', // close front vowel → ee
  viseme_O: 'oh', // mid back vowel → oh
  viseme_U: 'ou', // close back vowel → ou

  // Consonants - map to closest vowel shape
  viseme_PP: 'ou', // bilabial (closed lips) → ou (rounded)
  viseme_FF: 'ee', // labiodental → ee (spread lips)
  viseme_TH: 'aa', // dental → aa (open)
  viseme_DD: 'aa', // alveolar → aa (open)
  viseme_kk: 'ih', // velar → ih (mid position)
  viseme_CH: 'ee', // palato-alveolar → ee
  viseme_SS: 'ee', // alveolar fricative → ee (spread)
  viseme_nn: 'ih', // nasal → ih (neutral)
  viseme_RR: 'aa' // trill → aa (open)
}

export function convertToVRMTarget(oculusTarget: VisemeTarget): VRMVisemeTarget {
  const vrmTarget: VRMVisemeTarget = createEmptyVRMVisemeTarget()

  Object.entries(oculusTarget).forEach(([key, value]) => {
    const oculusKey = key as keyof VisemeTarget
    const vrmKey = OCULUS_TO_VRM_MAPPING[oculusKey]

    if (vrmKey && value > 0) {
      // Use max value when multiple Oculus visemes map to same VRM viseme
      vrmTarget[vrmKey] = Math.max(vrmTarget[vrmKey], value)
    }
  })

  return vrmTarget
}

/**
 * Generate viseme sequence from whisper data and volume
 */
export function visemesSequence(
  _volume: VisemeState,
  whisperData: WhisperData | null,
  config: VisemeConfig = defaultVisemeConfig
): VisemeSequenceItem[] {
  const time = performance.now()
  // Input validation
  if (!whisperData) {
    console.warn('visemesSequence: No whisper data provided')
    return []
  }

  if (!whisperData.words || !whisperData.wtimes || !whisperData.wdurations) {
    console.warn('visemesSequence: Incomplete whisper data', {
      hasWords: !!whisperData.words,
      hasTimes: !!whisperData.wtimes,
      hasDurations: !!whisperData.wdurations
    })
    return []
  }

  if (whisperData.words.length === 0) {
    console.warn('visemesSequence: Empty words array')
    return []
  }

  const result = lipsyncConvert(whisperData, 'en', config)
  const sequence = result?.anim || []

  // Validate sequence items
  const validSequence = sequence.filter((item) => {
    if (!item.ts || !Array.isArray(item.ts) || item.ts.length !== 3) {
      console.warn('visemesSequence: Invalid timestamp array', item)
      return false
    }

    if (!item.vs || Object.keys(item.vs).length === 0) {
      console.warn('visemesSequence: Empty viseme values', item)
      return false
    }

    return true
  })

  // Add time offset using configurable fudge factor
  for (const item of validSequence) {
    item.ts[0] += time + config.timing.fudgeFactor
    item.ts[1] += time + config.timing.fudgeFactor
    item.ts[2] += time + config.timing.fudgeFactor
  }

  console.log(`visemesSequence: Generated ${validSequence.length} valid visemes from ${whisperData.words.length} words`)
  return validSequence
}

/**
 * Update viseme targets based on current time and sequence
 */
export function visemesUpdate(volume: VisemeState, delta: number, config: VisemeConfig = defaultVisemeConfig): void {
  const startTime = performance.now()

  if (!volume || !volume.sequence) {
    console.warn('visemesUpdate: Invalid volume state')
    return
  }

  // Initialize targets based on system type
  if (!volume.targets) {
    volume.targets = volume.isVRMMode ? createEmptyVRMVisemeTarget() : createEmptyVisemeTarget()
  }

  if (!volume.dirty) {
    volume.dirty = {}
  }
  // Both target shapes (GLB `VisemeTarget` / VRM `VRMVisemeTarget`) are string→number
  // maps; alias to that so the dynamic-key writes below are typed rather than `any`.
  // Neither declares an index signature, hence the widening through `unknown`.
  const targets = volume.targets as unknown as Record<string, number>

  // Apply dampening per second of elapsed time, so 60 Hz keeps 0.95 per frame at any frame rate.
  const decay = Math.pow(config.intensity.dampeningFactor, delta * 60)
  Object.entries(targets).forEach(([key, value]) => {
    targets[key] = value > 0.01 ? value * decay : 0
  })

  // Process active visemes. The window runs from the attack start ts[0] to the release end ts[2].
  const activeVisemes = volume.sequence.filter((item) => item.ts[0] <= startTime && item.ts[2] >= startTime)

  // Several visemes can land on one key in the same frame: VRM mode folds Oculus visemes onto five keys,
  // and overlapping items share a key in GLB mode too. Keep the strongest instead of letting the last one win.
  const writtenThisFrame = new Set<string>()

  for (const item of activeVisemes) {
    const begins = item.ts[0]
    const ends = item.ts[2]

    if (config.timing.minDuration > 0) {
      const visemeDuration = ends - begins
      if (visemeDuration < config.timing.minDuration) continue
    }

    // A window shorter than attack + release would make the two ramps overlap, and the peak would
    // never reach the viseme value. Then each ramp takes at most half the window. Longer windows
    // keep the configured ramps.
    const span = ends - begins
    let attackTime = config.timing.attackTime
    let releaseTime = config.timing.releaseTime
    if (attackTime + releaseTime > span) {
      attackTime = Math.min(attackTime, span / 2)
      releaseTime = Math.min(releaseTime, span / 2)
    }

    Object.entries(item.vs).forEach(([key, valueArray]) => {
      if (!valueArray || !Array.isArray(valueArray) || valueArray.length < 2) {
        console.warn('visemesUpdate: Invalid value array for viseme', key)
        return
      }

      let value = valueArray[1]
      if (typeof value !== 'number' || isNaN(value)) {
        console.warn('visemesUpdate: Invalid value for viseme', key, value)
        return
      }

      value *= config.intensity.baseMultiplier

      // Apply curves
      if (startTime - begins < attackTime) {
        const attackProgress = (startTime - begins) / attackTime
        value *= applyCurve(attackProgress, config.curves.attackCurve)
      }

      if (ends - startTime < releaseTime) {
        // Fades from 1 to 0 as the release end approaches.
        const releaseProgress = (ends - startTime) / releaseTime
        value *= applyCurve(releaseProgress, config.curves.releaseCurve)
      }

      if (value < config.intensity.minThreshold) value = config.intensity.minThreshold

      // Apply to appropriate target system

      const mappedKey = volume.isVRMMode ? OCULUS_TO_VRM_MAPPING[key as keyof typeof OCULUS_TO_VRM_MAPPING] : key
      if (mappedKey && mappedKey in targets) {
        const sharesKeyThisFrame = writtenThisFrame.has(mappedKey)
        targets[mappedKey] = sharesKeyThisFrame ? Math.max(targets[mappedKey], value) : value
        writtenThisFrame.add(mappedKey)
      }
    })
  }

}
/**
 * Apply viseme targets to the actual avatar rig
 */
export function visemesToRig(volume: VisemeState, _delta: number, amplify: number = 1.0): void {
  const startTime = performance.now()

  if (!volume.targets) return
  if (!volume.dirty) volume.dirty = {}

  // See visemesUpdate: these are string→number maps written by dynamic key.
  const dirty = volume.dirty as Record<string, number>

  let targetsUpdated = 0
  // Handle VRM avatars
  if (volume.vrm) {
    let targetToApply: VRMVisemeTarget

    if (volume.isVRMMode) {
      // Direct VRM mode - targets are already VRM format
      targetToApply = volume.targets as VRMVisemeTarget
    } else {
      // GLB mode - convert 14 visemes to 5 VRM visemes
      targetToApply = convertToVRMTarget(volume.targets as VisemeTarget)
    }

    Object.entries(targetToApply).forEach(([key, value]) => {
      if (amplify !== 1.0) {
        value = value * amplify
      }

      if (value === dirty[key]) return
      dirty[key] = value
      targetsUpdated++

      try {
        volume.vrm!.expressionManager!.setValue(key, value)
      } catch (error) {
        console.error('visemesToRig: Error setting VRM expression', key, value, error)
      }
    })

    const rigApplyTime = performance.now() - startTime
    if (rigApplyTime > 5) {
      console.warn(`visemesToRig: VRM update took ${rigApplyTime.toFixed(2)}ms, updated ${targetsUpdated} targets`)
    }
    return
  }

  // Handle GLB morph target avatars (original system)
  const targets = volume.targets as unknown as Record<string, number>
  Object.entries(targets).forEach(([key, stored]) => {
    // Amplify into a local value and clamp it to 0..1 for the morph. Writing it back into targets
    // would compound the amplify on every call. At amplify 1 the stored value goes through unchanged,
    // so an overdrive above 1 reaches the morph.
    const value = amplify !== 1.0 ? Math.min(1, Math.max(0, stored * amplify)) : stored

    if (value === dirty[key]) return
    dirty[key] = value
    targetsUpdated++

    const group = volume.dictionary?.[key]
    if (!group || !volume.morphs) return

    volume.morphs.forEach((part) => {
      group.forEach((index) => {
        if (part.morphTargetInfluences && part.morphTargetInfluences[index] !== undefined) {
          part.morphTargetInfluences[index] = value
        }
      })
    })
  })

  const rigApplyTime = performance.now() - startTime
  if (rigApplyTime > 5) {
    console.warn(`visemesToRig: GLB update took ${rigApplyTime.toFixed(2)}ms, updated ${targetsUpdated} targets`)
  }
}

/**
 * Reset a viseme state on barge-in.
 *
 * This does three things the previous `initializeVisemeState()`-swap did NOT:
 *  1. clears the pending sequence so no further mouth shapes are scheduled;
 *  2. zeroes the *actual avatar rig* (VRM expressions / GLB morph influences) so
 *     the mouth closes instead of freezing on the last shape it was mid-way through;
 *  3. keeps the avatar bindings (`vrm`/`morphs`/`dictionary`/`isVRMMode`) intact so
 *     the very next utterance still drives lip-sync.
 *
 * Wiping the sequence pointer alone (or replacing the whole state object) left the
 * avatar silently mouthing the rest of the interrupted sentence. (H5)
 */
export function resetVisemeState(state: VisemeState): void {
  // 1. Drop any scheduled visemes.
  state.sequence = []

  // 2. Zero the in-memory targets, preserving the current system (VRM vs GLB).
  state.targets = state.isVRMMode ? createEmptyVRMVisemeTarget() : createEmptyVisemeTarget()

  // 3. Push zeros to the real rig so the mouth actually closes.
  if (state.vrm?.expressionManager) {
    const vrmVisemeKeys: (keyof VRMVisemeTarget)[] = ['aa', 'ee', 'ih', 'oh', 'ou']
    for (const key of vrmVisemeKeys) {
      try {
        state.vrm.expressionManager.setValue(key, 0)
      } catch (error) {
        console.error('resetVisemeState: Error zeroing VRM expression', key, error)
      }
    }
  }

  if (state.morphs && state.dictionary) {
    for (const group of Object.values(state.dictionary)) {
      for (const part of state.morphs) {
        for (const index of group) {
          if (part.morphTargetInfluences && part.morphTargetInfluences[index] !== undefined) {
            part.morphTargetInfluences[index] = 0
          }
        }
      }
    }
  }

  // Reset dirty tracking so the next real viseme is re-applied cleanly.
  state.dirty = {}
}

/**
 * Initialize viseme state for an avatar
 */
export function initializeVisemeState(forVRM: boolean = false): VisemeState {
  return {
    targets: forVRM ? createEmptyVRMVisemeTarget() : createEmptyVisemeTarget(),
    dirty: {},
    sequence: [],
    isVRMMode: forVRM
  }
}

/**
 * Set up viseme state for VRM avatar
 */
export function setupVisemeStateForVRM(state: VisemeState, vrm: VRM): void {
  state.vrm = vrm
  // Clear GLB morph bindings left over from a previously-selected GLB avatar so the
  // rig-apply path can't read stale morph refs after a GLB→VRM switch.
  state.morphs = undefined
  state.dictionary = undefined
  state.dirty = {}

  // Auto-detect if this VRM supports only 5 mouth expressions
  try {
    const expressions = Object.keys(vrm.expressionManager?.expressionMap || {})
    const vrmMouthExpressions = ['aa', 'ee', 'ih', 'oh', 'ou']
    const hasVRMMouthExpressions = vrmMouthExpressions.every((exp) => expressions.includes(exp))
    const hasOculusVisemes = ['PP', 'FF', 'TH'].some((exp) => expressions.includes(exp))

    if (hasVRMMouthExpressions && !hasOculusVisemes) {
      // This VRM only supports 5 mouth expressions - switch to VRM mode
      state.isVRMMode = true
      state.targets = createEmptyVRMVisemeTarget()
      state.dirty = {}
      console.log('VRM detected: Using 5-expression mode (aa, ee, ih, oh, ou)')
    } else {
      // This VRM supports full visemes - keep GLB mode
      state.isVRMMode = false
      // Drop the 5-key VRM target shape a previous avatar may have left behind.
      state.targets = createEmptyVisemeTarget()
      console.log('VRM detected: Using 14-viseme mode (full Oculus set)')
    }

    console.log('VRM Available expressions:', expressions)
  } catch {
    console.warn('Could not detect VRM expression capabilities, defaulting to GLB mode')
    state.isVRMMode = false
    state.targets = createEmptyVisemeTarget()
  }
}
/**
 * Set up viseme state for morph target based avatar
 */
export function setupVisemeStateForMorphTargets(
  state: VisemeState,
  morphs: { morphTargetInfluences: number[] }[],
  dictionary: Record<string, number[]>
): void {
  // Clear any VRM binding from a previously-selected VRM avatar. Without this,
  // visemesToRig sees a stale state.vrm, takes the VRM branch, and `return`s before
  // ever writing the new GLB's morph targets — lip-sync silently dies on the GLB.
  state.vrm = undefined
  state.morphs = morphs
  state.dictionary = dictionary
  state.isVRMMode = false // GLB mode
  // Reset targets/dirty to the GLB (14-viseme) shape; a prior VRM left the 5-key VRM
  // target shape + dirty cache, which would mismatch the GLB morph dictionary.
  state.targets = createEmptyVisemeTarget()
  state.dirty = {}
}
