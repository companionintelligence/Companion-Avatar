/**
 * Talk live: a visitor speaks with the companion's LiveKit character agent.
 *
 *   POST /api/talk/token ─► join the room ─► publish the microphone ─► the agent's voice plays here
 *
 * The agent's audio is routed into the shared audio graph (services/tts/audioGraph.ts) through a
 * MediaStreamAudioSourceNode, into the same analyser the TTS voice uses, so it comes out of the same output. The
 * AvatarModel reads that analyser for lip-sync during a live reply, as it does for TTS.
 *
 * The server decides everything the agent is told. This file only joins the room the server names. It is off unless
 * the build sets VITE_TALK_ENABLED=true (ControlOverlay), and nothing here logs the token, the audio or any words.
 */
import { createSimpleStore } from '@hexafield/simple-store'
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client'

import { apiUrl } from '../../config/apiBase'
import { getAudioGraph, resumeAudioGraph } from '../tts/audioGraph'

export type TalkState = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

/**
 * Why the session is where it is. These are fixed codes: nothing here carries error text, a token or a URL, so a reason
 * is safe to show and to log.
 */
export type TalkReason =
  | 'user_stopped' // the visitor ended it
  | 'time_up' // the agent reached its time limit
  | 'idle' // the agent ended it after a long silence
  | 'agent_ended' // the agent ended it for a reason this build does not name, or it left the room
  | 'agent_error' // the agent reported a fault
  | 'room_closed' // the room dropped during the conversation
  | 'talk_disabled' // the server is not offering talk
  | 'talk_busy' // the server is at its conversation limit
  | 'talk_misconfigured' // the server has talk switched on but not set up
  | 'request_failed' // no usable token came back
  | 'connect_failed' // the room would not connect
  | 'microphone_denied' // the visitor refused the microphone
  | 'microphone_unavailable' // there is no usable microphone

export interface TalkSnapshot {
  state: TalkState
  reason: TalkReason | null
}

/** Thrown by startTalk when a conversation cannot begin. `reason` is one of the fixed codes above. */
export class TalkError extends Error {
  readonly reason: TalkReason

  constructor(reason: TalkReason) {
    super(`talk unavailable: ${reason}`)
    this.name = 'TalkError'
    this.reason = reason
  }
}

/** The participant attribute the character agent sets when it ends a conversation. Its value says why. */
export const TALK_END_ATTRIBUTE = 'ftv.end'

/** What the page knows of the session. Read it with TalkStore.get(), or through useTalkService(). */
export const TalkStore = createSimpleStore<TalkSnapshot>({ state: 'idle', reason: null })

/** One conversation, from the first request to its end. A new start, a stop or an ending retires it. */
interface Attempt {
  cancelled: boolean
  /** Why it failed, when it ended in the error state. Null for a stop or a conversation that ended. */
  error: TalkReason | null
  room: Room | null
  agentAudio: Array<{ track: MediaStreamTrack; source: MediaStreamAudioSourceNode }>
}

let current: Attempt | null = null
let pending: Promise<void> = Promise.resolve()

/**
 * Start a conversation. Resolves once the visitor is live, or when it is stopped before then. Rejects with a TalkError
 * when it cannot begin, and the store says the same thing. Calling it again while connecting or live does nothing.
 */
export function startTalk(): Promise<void> {
  const { state } = TalkStore.get()
  if (state === 'connecting' || state === 'live') return pending

  // Browsers only let an audio context run from a user gesture, so resume it here, before the first await.
  void resumeAudioGraph()
  const attempt: Attempt = { cancelled: false, error: null, room: null, agentAudio: [] }
  current = attempt
  TalkStore.set({ state: 'connecting', reason: null })
  pending = connectAttempt(attempt)
  return pending
}

/**
 * End the conversation: disconnect the room, release the microphone and disconnect the agent's audio. Safe at any time.
 */
export async function stopTalk(): Promise<void> {
  const attempt = current
  if (!attempt) return
  current = null
  attempt.cancelled = true
  TalkStore.set({ state: 'ended', reason: 'user_stopped' })
  await release(attempt)
}

/**
 * The analyser the agent's voice is heard through, while a conversation is live; null otherwise. AvatarModel uses it
 * for lip-sync when TTS is idle.
 */
export function talkAnalyser(): AnalyserNode | null {
  if (TalkStore.get().state !== 'live') return null
  return getAudioGraph()?.analyser ?? null
}

/** A sentence for the visitor about a reason, or '' when there is nothing to say (the visitor chose to stop). */
export function describeTalkReason(reason: TalkReason | null): string {
  switch (reason) {
    case null:
    case 'user_stopped':
      return ''
    case 'time_up':
      return 'The conversation reached its time limit.'
    case 'idle':
      return 'The conversation ended after a long pause.'
    case 'agent_ended':
      return 'The conversation ended.'
    case 'agent_error':
      return 'The companion had a problem and ended the conversation.'
    case 'room_closed':
      return 'The connection closed.'
    case 'talk_disabled':
      return 'Talking to the companion is not available right now.'
    case 'talk_busy':
      return 'Everyone is talking right now. Try again in a few minutes.'
    case 'talk_misconfigured':
      return 'Talking to the companion is not set up on this server.'
    case 'request_failed':
      return "Couldn't reach the talk service."
    case 'connect_failed':
      return "Couldn't connect to the conversation."
    case 'microphone_denied':
      return 'Allow microphone access to talk.'
    case 'microphone_unavailable':
      return 'No usable microphone was found.'
  }
}

/** Test hook: end whatever is running and return the store to idle. */
export async function __resetTalkForTests(): Promise<void> {
  await stopTalk()
  TalkStore.set({ state: 'idle', reason: null })
}

async function connectAttempt(attempt: Attempt): Promise<void> {
  try {
    const { serverUrl, token } = await requestToken()
    if (attempt.cancelled) return

    const room = new Room()
    attempt.room = room
    listen(room, attempt)

    try {
      await room.connect(serverUrl, token)
    } catch {
      throw new TalkError('connect_failed')
    }
    // A stop during the connect has already released the room. The connect can still finish after that, so close it again.
    if (attempt.cancelled) {
      await closeRoom(room)
      return
    }

    try {
      await room.localParticipant.setMicrophoneEnabled(true)
    } catch (err) {
      throw new TalkError(isPermissionError(err) ? 'microphone_denied' : 'microphone_unavailable')
    }
    // The same for the microphone: a track granted after a stop is stopped here, not left running.
    if (attempt.cancelled) {
      await closeRoom(room)
      return
    }

    // The agent may have ended before the listeners were attached.
    for (const participant of room.remoteParticipants.values()) {
      const value = participant.attributes[TALK_END_ATTRIBUTE]
      if (value) {
        const outcome = endOutcome(value)
        await finish(attempt, outcome.state, outcome.reason)
        return
      }
    }

    TalkStore.set({ state: 'live', reason: null })
  } catch (err) {
    const error = err instanceof TalkError ? err : new TalkError('connect_failed')
    await finish(attempt, 'error', error.reason)
    // The failure may have been reported by the room first, so the attempt's own record decides. A stop, or a
    // conversation that ended, resolves quietly.
    if (attempt.error) throw new TalkError(attempt.error)
  }
}

/**
 * Ask the server for a token. A 503 carries a code that becomes the reason; anything else that is not a usable answer
 * is `request_failed`. The response body is read for its code only.
 */
async function requestToken(): Promise<{ serverUrl: string; token: string }> {
  let response: Response
  try {
    response = await fetch(apiUrl('/api/talk/token'), { method: 'POST', cache: 'no-store' })
  } catch {
    throw new TalkError('request_failed')
  }

  if (response.status === 503) throw new TalkError(refusalReason(await errorCode(response)))
  if (!response.ok) throw new TalkError('request_failed')

  const body = (await response.json().catch(() => null)) as { serverUrl?: unknown; token?: unknown } | null
  if (!body || typeof body.token !== 'string' || typeof body.serverUrl !== 'string' || !isWssUrl(body.serverUrl)) {
    throw new TalkError('request_failed')
  }
  return { serverUrl: body.serverUrl, token: body.token }
}

async function errorCode(response: Response): Promise<unknown> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return body?.error
}

function refusalReason(code: unknown): TalkReason {
  switch (code) {
    case 'talk_disabled':
      return 'talk_disabled'
    case 'talk_busy':
      return 'talk_busy'
    case 'talk_misconfigured':
      return 'talk_misconfigured'
    default:
      return 'request_failed'
  }
}

/**
 * The room's events for one conversation. stopTalk and finish mark the attempt cancelled before they disconnect, so the
 * Disconnected handler below only acts on a drop that nobody asked for.
 */
function listen(room: Room, attempt: Attempt): void {
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (!attempt.cancelled && track.kind === Track.Kind.Audio) routeAgentAudio(attempt, track.mediaStreamTrack)
  })
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    unrouteAgentAudio(attempt, track.mediaStreamTrack)
  })
  room.on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>) => {
    const value = changed[TALK_END_ATTRIBUTE]
    if (!value) return
    const outcome = endOutcome(value)
    void finish(attempt, outcome.state, outcome.reason)
  })
  // The room holds the visitor and the agent only, so a participant leaving is the agent. Its own reason, if it sent
  // one, has already arrived as an attribute above; otherwise the conversation is over all the same.
  room.on(RoomEvent.ParticipantDisconnected, () => {
    void finish(attempt, 'ended', 'agent_ended')
  })
  room.on(RoomEvent.Disconnected, () => {
    if (TalkStore.get().state === 'connecting') void finish(attempt, 'error', 'connect_failed')
    else void finish(attempt, 'ended', 'room_closed')
  })
}

/** The agent's own reasons, mapped onto fixed codes. Anything it sends that is not listed becomes `agent_ended`. */
function endOutcome(value: string): { state: 'ended' | 'error'; reason: TalkReason } {
  switch (value) {
    case 'time_up':
      return { state: 'ended', reason: 'time_up' }
    case 'idle':
      return { state: 'ended', reason: 'idle' }
    case 'error':
    case 'voice_error':
      return { state: 'error', reason: 'agent_error' }
    default:
      return { state: 'ended', reason: 'agent_ended' }
  }
}

/** Retire the attempt with a final state, then release what it holds. A no-op once the attempt is already over. */
async function finish(attempt: Attempt, state: 'ended' | 'error', reason: TalkReason): Promise<void> {
  if (attempt.cancelled) return
  attempt.cancelled = true
  if (state === 'error') attempt.error = reason
  if (current === attempt) current = null
  TalkStore.set({ state, reason })
  await release(attempt)
}

/**
 * Feed the agent's voice into the shared graph. The analyser passes audio on to the output, so the voice is heard, and
 * the lip-sync analyser sees it too. With no graph (no Web Audio in this environment) the voice is not played.
 */
function routeAgentAudio(attempt: Attempt, media: MediaStreamTrack): void {
  const graph = getAudioGraph()
  if (!graph) return
  const source = graph.context.createMediaStreamSource(new MediaStream([media]))
  source.connect(graph.analyser ?? graph.context.destination)
  attempt.agentAudio.push({ track: media, source })
}

function unrouteAgentAudio(attempt: Attempt, media: MediaStreamTrack): void {
  const index = attempt.agentAudio.findIndex((entry) => entry.track === media)
  if (index < 0) return
  attempt.agentAudio[index].source.disconnect()
  attempt.agentAudio.splice(index, 1)
}

/** Close the attempt's room, then disconnect the agent's audio nodes. Every step runs even if one fails. */
async function release(attempt: Attempt): Promise<void> {
  const room = attempt.room
  const audio = attempt.agentAudio.splice(0)
  attempt.room = null

  if (room) await closeRoom(room)
  for (const { source } of audio) source.disconnect()
}

/**
 * Disconnect a room, remove its listeners and stop its microphone track. Safe to run more than once: a closed room and
 * a stopped track do nothing. The track is read before the disconnect, because a disconnect may drop the publication.
 */
async function closeRoom(room: Room): Promise<void> {
  const microphone = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
  try {
    await room.disconnect()
  } catch {
    // Already closed.
  }
  room.removeAllListeners()
  try {
    microphone?.stop()
  } catch {
    // Already stopped.
  }
}

function isPermissionError(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotAllowedError'
}

function isWssUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'wss:'
  } catch {
    return false
  }
}
