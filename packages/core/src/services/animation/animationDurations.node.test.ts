import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { GLB_CLIPS, VRMA_CLIPS, updateAnimationDurations } from './config/animationClips'

// updateAnimationDurations writes into the shared catalog objects, so restore them after each case.
const originalDurations = {
  surprise_greet: VRMA_CLIPS.surprise_greet.duration,
  idle_loop: VRMA_CLIPS.idle_loop.duration,
  Waving: GLB_CLIPS.Waving.duration
}

afterEach(() => {
  VRMA_CLIPS.surprise_greet.duration = originalDurations.surprise_greet
  VRMA_CLIPS.idle_loop.duration = originalDurations.idle_loop
  GLB_CLIPS.Waving.duration = originalDurations.Waving
})

const loadedClip = (name: string, seconds: number) => new THREE.AnimationClip(name, seconds, [])

// M22: the stored duration feeds emote relaxTime, so it must be the wall-clock length.
// The action plays at timeScale = catalog speed, so the file length is divided by it.
describe('updateAnimationDurations — stored duration is wall-clock ms at catalog speed (M22)', () => {
  it('divides the file length by the catalog speed (surprise_greet plays at 0.9x)', () => {
    updateAnimationDurations([loadedClip('surprise_greet', 3)])
    expect(VRMA_CLIPS.surprise_greet.duration).toBe(3333)
  })

  it('leaves a speed-1 clip at the file length', () => {
    updateAnimationDurations([loadedClip('idle_loop', 5)])
    expect(VRMA_CLIPS.idle_loop.duration).toBe(5000)
  })

  it('applies the same rule to GLB catalog clips', () => {
    updateAnimationDurations([loadedClip('Waving', 2)])
    expect(GLB_CLIPS.Waving.duration).toBe(2222)
  })

  it('does not compound the speed division when the same file is applied again', () => {
    updateAnimationDurations([loadedClip('surprise_greet', 3)])
    updateAnimationDurations([loadedClip('surprise_greet', 3)])
    expect(VRMA_CLIPS.surprise_greet.duration).toBe(3333)
  })
})
