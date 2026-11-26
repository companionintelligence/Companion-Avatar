import type { ConversationStatus } from '../../../../services/conversation/conversationStatus'

/**
 * The orb's last drawn frame, for the capture harness and its specs (tests/orb-avatar.spec.ts). Like the face specs,
 * they assert on what the avatar did rather than on pixels: a screenshot cannot say whether a dim frame was silence or
 * a dead analyser, and this can.
 */
export interface OrbSnapshot {
  /** Frames drawn since the orb mounted. */
  frame: number
  status: ConversationStatus
  /** The orb took the voice as sounding on this frame. */
  speaking: boolean
  /** A voice analyser was connected on this frame. */
  hasAnalyser: boolean
  /** The smoothed voice, 0..1. */
  voice: number
  glow: number
  scale: number
  /** Speech rings alive on this frame. */
  rings: number
}

let latest: OrbSnapshot | null = null

/** The orb's last frame, or null when no orb is mounted. */
export function getOrbSnapshot(): OrbSnapshot | null {
  return latest ? { ...latest } : null
}

/** OrbAvatar publishes each frame here; null on unmount. */
export function setOrbSnapshot(snapshot: OrbSnapshot | null): void {
  latest = snapshot
}
