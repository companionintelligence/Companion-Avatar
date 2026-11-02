/**
 * The job metadata a talk token dispatches the character agent with, and the check it passes before it is signed.
 *
 * The shape and bounds follow face-to-voice's agent/src/metadata.ts (MIT License, Copyright (c) 2026 Oliver Hassan),
 * which the agent parses: a version it does not know is refused, and so is any field outside these bounds. This proxy
 * has no schema library, so the bounds are written out by hand. Errors name the field that failed, never its value.
 */
import { TALK_HARD_MAX_SECONDS } from '../config.js'

import { TALK_MOOD_TAGS } from './persona.js'

export const METADATA_VERSION = 1

/** What the agent is told when a conversation is dispatched. */
export interface TalkMetadata {
  v: typeof METADATA_VERSION
  name: string
  voiceId: string
  instructions: string
  greeting: string
  /** A later conversation in the same visit (opens with a new line, not the greeting). Always false here. */
  again: boolean
  startMood: { emotion: string; strength: 0 | 1 | 2 | 3 }
  /** Mood id → the three audio tags for strength 1, 2 and 3. */
  moodTags: Record<string, [string, string, string]>
  maxSeconds: number
}

export interface TalkMetadataInput {
  name: string
  voiceId: string
  instructions: string
  greeting: string
  maxSeconds: number
}

/** Assemble the metadata for one conversation. Pass the result through parseTalkMetadata before it is dispatched. */
export function buildTalkMetadata(input: TalkMetadataInput): TalkMetadata {
  const moodTags: Record<string, [string, string, string]> = {}
  for (const [id, tags] of Object.entries(TALK_MOOD_TAGS)) moodTags[id] = [...tags]

  return {
    v: METADATA_VERSION,
    name: input.name,
    voiceId: input.voiceId,
    instructions: input.instructions,
    greeting: input.greeting,
    again: false,
    startMood: { emotion: 'neutral', strength: 0 },
    moodTags,
    maxSeconds: input.maxSeconds
  }
}

/**
 * Check `input` against the agent's schema and return it typed, with the agent's own cap on the length applied.
 * Throws an Error that names the first field that fails.
 */
export function parseTalkMetadata(input: unknown): TalkMetadata {
  const r = record(input, 'metadata')
  if (r.v !== METADATA_VERSION) fail('v')
  const name = text(r.name, 1, 60, 'name')
  const voiceId = text(r.voiceId, 4, 64, 'voiceId')
  if (!/^[A-Za-z0-9_-]+$/.test(voiceId)) fail('voiceId')
  const instructions = text(r.instructions, 1, 12_000, 'instructions')
  const greeting = text(r.greeting, 1, 400, 'greeting')
  if (r.again !== undefined && typeof r.again !== 'boolean') fail('again')

  const mood = record(r.startMood, 'startMood')
  const emotion = text(mood.emotion, 0, 24, 'startMood')
  if (![0, 1, 2, 3].includes(mood.strength as number)) fail('startMood')
  const strength = mood.strength as 0 | 1 | 2 | 3

  const tagsByMood = record(r.moodTags, 'moodTags')
  const moodTags: Record<string, [string, string, string]> = {}
  for (const [id, tags] of Object.entries(tagsByMood)) {
    if (id.length > 24 || !Array.isArray(tags) || tags.length !== 3 || !tags.every(bracketFreeTag)) fail('moodTags')
    moodTags[id] = [tags[0], tags[1], tags[2]]
  }

  const seconds = r.maxSeconds
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 10) fail('maxSeconds')

  return {
    v: METADATA_VERSION,
    name,
    voiceId,
    instructions,
    greeting,
    again: r.again === true,
    startMood: { emotion, strength },
    moodTags,
    maxSeconds: Math.min(seconds as number, TALK_HARD_MAX_SECONDS)
  }
}

function fail(field: string): never {
  throw new Error(`talk metadata: ${field} is missing or out of range`)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field)
  return value as Record<string, unknown>
}

function text(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(field)
  return value as string
}

/** An audio tag's words: a square bracket would end the tag early and the rest would be spoken. */
function bracketFreeTag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && !/[[\]]/.test(value)
}
