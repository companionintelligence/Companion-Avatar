import type { ConversationStatus } from '../../../../services/conversation/conversationStatus'

/**
 * How the orb moves: what the conversation and the voice do to it, frame by frame.
 *
 * The orb has no face, so it shows the conversation with light. At rest it floats and breathes slowly. While it
 * listens its filaments brighten and it breathes faster. While it thinks the filaments race and the motes spin. While
 * it speaks it swells and glows with the voice, and each syllable onset sends a ring out from the ball, like the
 * "agent speech" rings of the orb in danieloquelis/Unity-QuestConversationalAI that it is modelled on.
 *
 * Pure and renderer-free: OrbAvatar draws whatever `step` returns, and the behaviour is tested in node.
 */

export interface OrbInput {
  /** What the companion is doing (ConversationStatusState). */
  status: ConversationStatus
  /** The voice is sounding now: the audio analyser says so, or the text fallback does. */
  speaking: boolean
  /** Vocal energy, 0..1. Ignored unless `speaking`. */
  energy: number
  /** High-band energy, 0..1: fricatives and sibilants, which add glitter. Ignored unless `speaking`. */
  high: number
  /** The visitor asked for reduced motion: no floating, no rings, a slower swirl. The glow still answers the voice. */
  reducedMotion: boolean
}

export interface OrbRing {
  /** 0 when it leaves the ball, 1 when it is gone. */
  age: number
  /** 0..1, from the voice's energy when it left. */
  strength: number
}

export interface OrbFrame {
  /** Size of the ball; 1 at rest. */
  scale: number
  /** Brightness of the ball and its halo; about 0.3 to 2. */
  glow: number
  /** Brightness of the filaments; about 0.1 to 1.7. */
  churn: number
  /** The smoothed voice, 0..1. Heats the centre. */
  voice: number
  /** Extra glitter from the voice's high band, 0..1. */
  sparkle: number
  /** Filament flow phase. The shaders animate on phases, not on time, so a change of speed never jumps. */
  flow: number
  /** Mote orbit phase. */
  orbit: number
  /** Vertical float offset, metres. */
  lift: number
  /** Sideways float offset, metres. */
  drift: number
  /** Strength of the orb's point light, 0..1. */
  light: number
  /** Live speech rings, oldest first. */
  rings: readonly OrbRing[]
}

/** The settled look of each conversation state. */
interface OrbMood {
  /** Base brightness. */
  glow: number
  /** Filament flow speed, phase units per second. */
  swirl: number
  /** Filament brightness. */
  churn: number
  /** Mote orbit speed, radians per second. */
  spin: number
  /** Breaths per second. */
  breathRate: number
  /** How far a breath swells the ball, as a fraction of its size. */
  breathDepth: number
}

export const ORB_MOODS: Readonly<Record<ConversationStatus, OrbMood>> = Object.freeze({
  loading: { glow: 0.4, swirl: 0.25, churn: 0.15, spin: 0.25, breathRate: 0.2, breathDepth: 0.015 },
  idle: { glow: 0.8, swirl: 0.45, churn: 0.35, spin: 0.45, breathRate: 0.24, breathDepth: 0.025 },
  listening: { glow: 0.95, swirl: 0.7, churn: 0.8, spin: 0.3, breathRate: 0.6, breathDepth: 0.035 },
  thinking: { glow: 0.85, swirl: 1.9, churn: 0.6, spin: 1.8, breathRate: 0.4, breathDepth: 0.015 },
  speaking: { glow: 1, swirl: 0.9, churn: 0.55, spin: 0.8, breathRate: 0.33, breathDepth: 0.01 }
})

/** At most this many rings are alive at once; a new one replaces the oldest. */
export const ORB_MAX_RINGS = 6
/** Seconds from a ring leaving the ball to its fading out. */
export const ORB_RING_LIFE = 1.1
/** The longest step taken, in seconds. The first frame after a hidden tab must not jump. */
export const ORB_MAX_STEP = 0.1

const TAU = Math.PI * 2
/** Seconds for the look to settle into a new conversation state (time constant). */
const MOOD_EASE = 0.35
/** Envelope rates, per second: the glow rises with a syllable at once and falls back over about a tenth of a second. */
const VOICE_ATTACK = 30
const VOICE_RELEASE = 7
/** Rate of the slow follower that syllable onsets are measured against. */
const ONSET_FOLLOW = 3
/** A rise in energy this far above the slow follower is a syllable onset. */
const RING_ONSET = 0.1
/** Below this smoothed energy nothing rings. */
const RING_FLOOR = 0.12
/** Seconds between rings, at least and at most while the voice holds. */
const RING_MIN_GAP = 0.4
const RING_MAX_GAP = 0.6
/** The float: one bob every few seconds, a centimetre high, with a smaller sideways sway at half the rate. */
const FLOAT_PERIOD = 3.6
const FLOAT_HEIGHT = 0.012
const FLOAT_SWAY = 0.004
/** How much a voice at full energy swells the ball, and how much less it does under reduced motion. */
const VOICE_SWELL = 0.16
const REDUCED_VOICE_SWELL = 0.04
/** Brightness a poke adds, and how fast it fades, per second. */
const POKE_FLASH = 0.6
const POKE_FADE = 1.5
/** Phases wrap here to keep float precision; a jump in the filament pattern once every couple of hours is invisible. */
const PHASE_WRAP = 4096

const unit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** Move `value` toward `target` at `rate` per second, over `dt` seconds. Frame-rate independent. */
const follow = (value: number, target: number, rate: number, dt: number): number =>
  value + (target - value) * (1 - Math.exp(-rate * dt))

export class OrbMotion {
  private mood: OrbMood = { ...ORB_MOODS.idle }
  private voice = 0
  private slowVoice = 0
  private sparkle = 0
  private breath = 0
  private float = 0
  private flow = 0
  private orbit = 0
  private flash = 0
  private sinceRing = Number.POSITIVE_INFINITY
  private readonly rings: OrbRing[] = []
  private reducedMotion = false

  /**
   * The frame `step` returns. It is reused, so read it before the next step; a fresh object every frame is garbage
   * the headset's frame budget does not need.
   */
  private readonly frame: OrbFrame = {
    scale: 1,
    glow: ORB_MOODS.idle.glow,
    churn: ORB_MOODS.idle.churn,
    voice: 0,
    sparkle: 0,
    flow: 0,
    orbit: 0,
    lift: 0,
    drift: 0,
    light: 0,
    rings: this.rings
  }

  /** Advance by `dt` seconds. */
  step(input: OrbInput, dt: number): OrbFrame {
    const h = Number.isFinite(dt) ? Math.min(ORB_MAX_STEP, Math.max(0, dt)) : 0
    this.reducedMotion = input.reducedMotion

    // The voice. Silence while not speaking, whatever the analyser last said.
    const energy = input.speaking ? unit(input.energy) : 0
    const high = input.speaking ? unit(input.high) : 0
    this.voice = follow(this.voice, energy, energy > this.voice ? VOICE_ATTACK : VOICE_RELEASE, h)
    this.slowVoice = follow(this.slowVoice, energy, ONSET_FOLLOW, h)
    this.sparkle = follow(this.sparkle, high, high > this.sparkle ? VOICE_ATTACK : VOICE_RELEASE, h)

    // The conversation state, eased so a change of state is a change of mood rather than a cut.
    const target = ORB_MOODS[input.speaking ? 'speaking' : input.status] ?? ORB_MOODS.idle
    const ease = 1 - Math.exp(-h / MOOD_EASE)
    const mood = this.mood
    mood.glow += (target.glow - mood.glow) * ease
    mood.swirl += (target.swirl - mood.swirl) * ease
    mood.churn += (target.churn - mood.churn) * ease
    mood.spin += (target.spin - mood.spin) * ease
    mood.breathRate += (target.breathRate - mood.breathRate) * ease
    mood.breathDepth += (target.breathDepth - mood.breathDepth) * ease

    const calm = input.reducedMotion ? 0.5 : 1
    this.breath = (this.breath + h * TAU * mood.breathRate) % TAU
    this.float = (this.float + (h * TAU) / FLOAT_PERIOD) % (2 * TAU)
    this.flow = (this.flow + h * (mood.swirl + 0.6 * this.voice) * calm) % PHASE_WRAP
    this.orbit = (this.orbit + h * (mood.spin + 0.8 * this.voice) * calm) % PHASE_WRAP
    this.flash = Math.max(0, this.flash - h * POKE_FADE)

    this.ageRings(h)
    this.sinceRing += h
    if (!input.reducedMotion && input.speaking && this.voice > RING_FLOOR && this.sinceRing >= RING_MIN_GAP) {
      const onset = energy - this.slowVoice > RING_ONSET
      if (onset || this.sinceRing >= RING_MAX_GAP) this.emit(0.35 + 0.65 * this.voice)
    }

    const frame = this.frame
    const breathing = Math.sin(this.breath)
    frame.scale = input.reducedMotion
      ? 1 + REDUCED_VOICE_SWELL * this.voice
      : 1 + breathing * mood.breathDepth + VOICE_SWELL * this.voice
    frame.glow = mood.glow * (1 + 0.12 * breathing) + 0.35 * this.voice + this.flash
    frame.churn = mood.churn + 0.6 * this.voice + 0.4 * this.sparkle
    frame.voice = this.voice
    frame.sparkle = this.sparkle
    frame.flow = this.flow
    frame.orbit = this.orbit
    frame.lift = input.reducedMotion ? 0 : FLOAT_HEIGHT * Math.sin(this.float)
    frame.drift = input.reducedMotion ? 0 : FLOAT_SWAY * Math.sin(this.float * 0.5 + 1)
    frame.light = unit(0.3 * frame.glow + 0.5 * this.voice)
    return frame
  }

  /** The visitor touched the orb: a flash, and a ring unless they asked for reduced motion. */
  poke(): void {
    this.flash = POKE_FLASH
    if (!this.reducedMotion) this.emit(0.8)
  }

  private emit(strength: number): void {
    if (this.rings.length >= ORB_MAX_RINGS) this.rings.shift()
    this.rings.push({ age: 0, strength: unit(strength) })
    this.sinceRing = 0
  }

  private ageRings(dt: number): void {
    let kept = 0
    for (const ring of this.rings) {
      ring.age += dt / ORB_RING_LIFE
      if (ring.age < 1) this.rings[kept++] = ring
    }
    this.rings.length = kept
  }
}
