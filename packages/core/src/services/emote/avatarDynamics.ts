/**
 * Frame-rate-independent procedural avatar dynamics.
 *
 * This is deliberately a render-layer engine: it computes the same blendshape
 * and bone offsets that the avatar renderer applies every frame. Keeping the
 * stateful timing here makes it usable from both the shipped scene and the
 * deterministic capture harness.
 */

import type { AudioLipSyncState } from '../visemes/audioLipSync'
import { defaultEmoteConfig, type EmoteConfig } from './configs/emoteConfig'
import { SPEECH_RAMP_MS, speechNodOffset, type SpeechNodOffset } from './modules/speechNods'

export type ConversationState = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface DynamicsUpdateParams {
  elapsedTime: number
  delta: number
  pointerX?: number
  pointerY?: number
  audioState?: AudioLipSyncState | null
  conversationState?: ConversationState
}

export interface DynamicsOutput {
  /** ARKit-compatible blendshape weights. Missing targets are ignored by the renderer. */
  blendshapes: Record<string, number>
  /** Additive offsets from each bone's authored rest pose, in radians. */
  boneRotations: Record<string, { x: number; y: number; z: number }>
  /** Fallback root offsets for rigs without the expected body bones. */
  sceneOffset: {
    positionY: number
    rotationY: number
    rotationZ: number
    rotationX: number
  }
}

export interface AvatarDynamicsOptions {
  speech?: {
    nods?: Partial<EmoteConfig['speech']['nods']>
  }
}

// Natural motion limits. These are intentionally conservative so cursor tracking
// reads as attention instead of a camera rig dragging the whole face around.
const BLINK_MIN_INTERVAL = 5
const BLINK_MAX_INTERVAL = 10
const BLINK_DURATION = 0.16
const SACCADE_MIN_INTERVAL = 0.8
const SACCADE_MAX_INTERVAL = 2.2
const SACCADE_STRENGTH = 0.18
const MAX_NECK_YAW = 0.45
const MAX_NECK_PITCH = 0.25
const HEAD_DAMPING = 0.12
// Speech ends only after this much silence. audioState.isSpeaking drops between words, so a shorter
// gap would restart the head motion's ease-in on every word.
const SPEECH_END_HOLD_MS = 400

const lerp = (previous: number, target: number, alpha: number) => previous + (target - previous) * alpha
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const randomRange = (min: number, max: number) => min + Math.random() * (max - min)

export class AvatarDynamicsEngine {
  private nextBlinkTime = 2
  private isBlinking = false
  private blinkStartTime = 0
  private wasSpeaking = false
  private breathPhase = 0
  private smoothedSceneRotZ = 0

  private nextSaccadeTime = 1
  private targetSaccade = { x: 0, y: 0 }
  private currentSaccade = { x: 0, y: 0 }
  private currentHeadRotation = { x: 0, y: 0, z: 0 }

  private smoothedBrowInner = 0
  private smoothedBrowOuter = 0
  private smoothedCheek = 0

  private readonly speechNods: EmoteConfig['speech']['nods']
  private speechSinceMs: number | null = null
  private speechUntilMs: number | null = null
  private silentSinceMs: number | null = null

  constructor(options: AvatarDynamicsOptions = {}) {
    this.speechNods = { ...defaultEmoteConfig.speech.nods, ...options.speech?.nods }
    this.scheduleNextBlink(0)
    this.scheduleNextSaccade(0)
  }

  private scheduleNextBlink(currentTime: number, isListening = false) {
    const min = isListening ? BLINK_MIN_INTERVAL * 2 : BLINK_MIN_INTERVAL
    const max = isListening ? BLINK_MAX_INTERVAL * 2 : BLINK_MAX_INTERVAL
    this.nextBlinkTime = currentTime + randomRange(min, max)
  }

  private forceBlink(currentTime: number) {
    if (!this.isBlinking && currentTime - this.blinkStartTime > 0.8) {
      this.nextBlinkTime = Math.min(this.nextBlinkTime, currentTime)
    }
  }

  private scheduleNextSaccade(currentTime: number, isIdle = false) {
    const min = isIdle ? SACCADE_MIN_INTERVAL * 2.5 : SACCADE_MIN_INTERVAL
    const max = isIdle ? SACCADE_MAX_INTERVAL * 2.5 : SACCADE_MAX_INTERVAL
    this.nextSaccadeTime = currentTime + randomRange(min, max)

    const nextX = randomRange(-SACCADE_STRENGTH, SACCADE_STRENGTH)
    const nextY = randomRange(-SACCADE_STRENGTH, SACCADE_STRENGTH)
    const distance = Math.hypot(nextX - this.currentSaccade.x, nextY - this.currentSaccade.y)
    if (distance > SACCADE_STRENGTH * 1.2) this.forceBlink(currentTime)

    this.targetSaccade = { x: nextX, y: nextY }
  }

  // Tracks the speech window that the head motion eases in and out of.
  private trackSpeech(isSpeaking: boolean, nowMs: number) {
    if (isSpeaking) {
      this.silentSinceMs = null
      if (this.speechSinceMs === null) {
        this.speechSinceMs = nowMs
      } else if (this.speechUntilMs !== null) {
        // Back inside the ease-out: carry on with the same window. Only a finished ease-out starts a new one.
        if (nowMs - this.speechUntilMs >= SPEECH_RAMP_MS) this.speechSinceMs = nowMs
        this.speechUntilMs = null
      }
      return
    }
    if (this.speechSinceMs === null || this.speechUntilMs !== null) return
    if (this.silentSinceMs === null) this.silentSinceMs = nowMs
    if (nowMs - this.silentSinceMs >= SPEECH_END_HOLD_MS) this.speechUntilMs = nowMs
  }

  // No phrase ends reach the engine yet (its input carries only audio levels and the conversation
  // state), so this is sway only. speechNodOffset accepts phrase ends for when they do.
  private speechHeadOffset(nowMs: number): SpeechNodOffset {
    if (!this.speechNods.enabled) return { pitchRad: 0, yawRad: 0 }
    return speechNodOffset({
      tMs: nowMs,
      speakingSinceMs: this.speechSinceMs,
      speakingUntilMs: this.speechUntilMs,
      amplitudeDeg: this.speechNods.amplitudeDeg
    })
  }

  update(input: DynamicsUpdateParams): DynamicsOutput {
    const {
      elapsedTime,
      delta,
      pointerX = 0,
      pointerY = 0,
      audioState,
      conversationState = 'idle'
    } = input
    const blendshapes: Record<string, number> = {}
    const isListening = conversationState === 'listening'
    const isThinking = conversationState === 'thinking'
    const isIdle = conversationState === 'idle'
    const isSpeaking = conversationState === 'speaking'

    // A natural blink at speech boundaries gives the face a clear conversational
    // handoff without relying on a particular avatar's facial rig.
    if (this.wasSpeaking && !isSpeaking) this.forceBlink(elapsedTime)
    this.wasSpeaking = isSpeaking
    this.trackSpeech(isSpeaking, elapsedTime * 1000)

    if (isThinking && !this.isBlinking && this.nextBlinkTime - elapsedTime > 2) {
      this.nextBlinkTime = elapsedTime + randomRange(0.2, 0.8)
    }

    let blinkWeight = 0
    if (!this.isBlinking && elapsedTime >= this.nextBlinkTime) {
      this.isBlinking = true
      this.blinkStartTime = elapsedTime
    }
    if (this.isBlinking) {
      const elapsedInBlink = elapsedTime - this.blinkStartTime
      if (elapsedInBlink >= BLINK_DURATION) {
        this.isBlinking = false
        this.scheduleNextBlink(elapsedTime, isListening)
      } else {
        blinkWeight = Math.pow(Math.sin((elapsedInBlink / BLINK_DURATION) * Math.PI), 0.7)
      }
    }
    blendshapes.eyeBlinkLeft = clamp(blinkWeight)
    blendshapes.eyeBlinkRight = clamp(blinkWeight)

    if (elapsedTime >= this.nextSaccadeTime) this.scheduleNextSaccade(elapsedTime, isIdle)
    this.currentSaccade.x = lerp(this.currentSaccade.x, this.targetSaccade.x, 0.08)
    this.currentSaccade.y = lerp(this.currentSaccade.y, this.targetSaccade.y, 0.08)

    let effectiveGazeX = clamp(pointerX * 0.8 + this.currentSaccade.x, -1, 1)
    let effectiveGazeY = clamp(pointerY * 0.8 + this.currentSaccade.y, -1, 1)
    if (isThinking) {
      effectiveGazeX = lerp(effectiveGazeX, 0.7, 0.5)
      effectiveGazeY = lerp(effectiveGazeY, 0.6, 0.5)
    }

    if (effectiveGazeX < 0) {
      const strength = Math.abs(effectiveGazeX)
      blendshapes.eyeLookOutRight = strength
      blendshapes.eyeLookInLeft = strength
      blendshapes.eyeLookInRight = 0
      blendshapes.eyeLookOutLeft = 0
    } else {
      const strength = Math.abs(effectiveGazeX)
      blendshapes.eyeLookInRight = strength
      blendshapes.eyeLookOutLeft = strength
      blendshapes.eyeLookOutRight = 0
      blendshapes.eyeLookInLeft = 0
    }

    if (effectiveGazeY > 0) {
      const strength = Math.abs(effectiveGazeY)
      blendshapes.eyeLookUpLeft = strength
      blendshapes.eyeLookUpRight = strength
      blendshapes.eyeLookDownLeft = 0
      blendshapes.eyeLookDownRight = 0
    } else {
      const strength = Math.abs(effectiveGazeY)
      blendshapes.eyeLookDownLeft = strength
      blendshapes.eyeLookDownRight = strength
      blendshapes.eyeLookUpLeft = 0
      blendshapes.eyeLookUpRight = 0
    }

    const extremeTracker = Math.min(1, Math.hypot(pointerX, pointerY) * 0.35)
    blendshapes.eyeWideLeft = extremeTracker * (1 - blinkWeight)
    blendshapes.eyeWideRight = extremeTracker * (1 - blinkWeight)
    blendshapes.eyeSquintLeft = Math.abs(this.currentSaccade.x) * 0.5 * (1 - blinkWeight)
    blendshapes.eyeSquintRight = Math.abs(this.currentSaccade.y) * 0.5 * (1 - blinkWeight)

    let targetBrowInner = 0
    let targetBrowOuter = 0
    let targetCheek = 0
    if (audioState?.isSpeaking) {
      targetBrowInner = clamp(audioState.energy * 0.7 + audioState.highBand * 0.4)
      targetBrowOuter = clamp(audioState.energy * 0.45 + audioState.midBand * 0.25)
      targetCheek = clamp(audioState.energy * 0.3)
    } else if (isListening) {
      targetBrowInner = 0.3
      targetBrowOuter = 0.2
    }
    this.smoothedBrowInner = lerp(this.smoothedBrowInner, targetBrowInner, 0.2)
    this.smoothedBrowOuter = lerp(this.smoothedBrowOuter, targetBrowOuter, 0.2)
    this.smoothedCheek = lerp(this.smoothedCheek, targetCheek, 0.25)
    blendshapes.browInnerUp = this.smoothedBrowInner
    blendshapes.browOuterUpLeft = this.smoothedBrowOuter
    blendshapes.browOuterUpRight = this.smoothedBrowOuter
    blendshapes.cheekSquintLeft = Math.max(blendshapes.cheekSquintLeft || 0, this.smoothedCheek)
    blendshapes.cheekSquintRight = Math.max(blendshapes.cheekSquintRight || 0, this.smoothedCheek)

    let targetHeadYaw = clamp(pointerX * 0.6, -MAX_NECK_YAW, MAX_NECK_YAW)
    let targetHeadPitch = clamp(-pointerY * 0.35, -MAX_NECK_PITCH, MAX_NECK_PITCH)
    if (isThinking) {
      targetHeadYaw = lerp(targetHeadYaw, 0.3, 0.4)
      targetHeadPitch = lerp(targetHeadPitch, -0.2, 0.4)
    } else if (isListening) {
      targetHeadPitch += 0.08
    }
    const damping = isIdle ? HEAD_DAMPING * 0.4 : HEAD_DAMPING
    this.currentHeadRotation.y = lerp(this.currentHeadRotation.y, targetHeadYaw, damping)
    this.currentHeadRotation.x = lerp(this.currentHeadRotation.x, targetHeadPitch, damping)
    this.currentHeadRotation.z = lerp(this.currentHeadRotation.z, -pointerX * 0.08, damping * 0.5)

    const boneRotations: Record<string, { x: number; y: number; z: number }> = {}
    const getRotation = (name: string) => {
      if (!boneRotations[name]) boneRotations[name] = { x: 0, y: 0, z: 0 }
      return boneRotations[name]
    }

    // Rest-pose relaxation works for Mixamo/RPM rigs and is harmless when a
    // particular bone is absent because AvatarModel resolves bones by alias.
    getRotation('LeftArm').z -= 0.2
    getRotation('RightArm').z += 0.2
    getRotation('LeftArm').x += 0.1
    getRotation('RightArm').x += 0.1
    getRotation('LeftForeArm').x += 0.25
    getRotation('RightForeArm').x += 0.25
    getRotation('LeftHand').x += 0.1
    getRotation('RightHand').x += 0.1

    this.breathPhase += delta * (isIdle ? 1 : 1.5)
    const swayZ = Math.sin(elapsedTime * 0.4) * 0.015
    const twistY = Math.cos(elapsedTime * 0.3) * 0.02
    getRotation('Spine').z += swayZ
    getRotation('Spine').y += twistY
    getRotation('Spine1').z += swayZ * 0.8
    getRotation('Spine1').y += twistY * 0.8

    const chestRiseX = Math.sin(this.breathPhase) * 0.015
    getRotation('Spine2').x += chestRiseX
    const shoulderRise = Math.sin(this.breathPhase) * 0.02
    getRotation('LeftShoulder').z += shoulderRise
    getRotation('RightShoulder').z -= shoulderRise

    getRotation('Head').y += this.currentHeadRotation.y * 0.5
    getRotation('Head').x += this.currentHeadRotation.x * 0.5
    getRotation('Head').z += this.currentHeadRotation.z
    getRotation('Neck').y += this.currentHeadRotation.y * 0.3
    getRotation('Neck').x += this.currentHeadRotation.x * 0.3
    getRotation('Spine2').y += this.currentHeadRotation.y * 0.2
    getRotation('Spine2').x += this.currentHeadRotation.x * 0.2

    // Plain additive offset on the Head channel. It stays out of currentHeadRotation so the damping
    // does not smooth it.
    const speechHead = this.speechHeadOffset(elapsedTime * 1000)
    getRotation('Head').x += speechHead.pitchRad
    getRotation('Head').y += speechHead.yawRad

    const targetTilt = isListening ? -0.03 : 0
    this.smoothedSceneRotZ = lerp(this.smoothedSceneRotZ, targetTilt, 0.08)
    getRotation('Head').z += this.smoothedSceneRotZ

    return {
      blendshapes,
      boneRotations,
      sceneOffset: {
        positionY: 0,
        rotationY: Math.sin(elapsedTime * 0.5) * 0.04,
        rotationZ: 0,
        rotationX: 0
      }
    }
  }

  reset() {
    this.isBlinking = false
    this.wasSpeaking = false
    this.speechSinceMs = null
    this.speechUntilMs = null
    this.silentSinceMs = null
    this.breathPhase = 0
    this.smoothedSceneRotZ = 0
    this.currentHeadRotation = { x: 0, y: 0, z: 0 }
    this.currentSaccade = { x: 0, y: 0 }
    this.targetSaccade = { x: 0, y: 0 }
    this.smoothedBrowInner = 0
    this.smoothedBrowOuter = 0
    this.smoothedCheek = 0
  }
}

export type DynamicsOutputs = DynamicsOutput
export type DynamicsInput = DynamicsUpdateParams
