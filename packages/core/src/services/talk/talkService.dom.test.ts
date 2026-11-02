import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiUrl } from '../../config/apiBase'

import { __resetTalkForTests, startTalk, stopTalk, talkAnalyser, TalkError, TalkStore } from './talkService'

// The LiveKit room is replaced by a fake that records what the service does to it. Nothing here opens a socket.
const lk = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  const state = {
    micError: undefined as Error | undefined,
    joinAttributes: undefined as Record<string, string> | undefined,
    /** When set, room.connect waits for it: a test can stop a conversation while the room is still connecting. */
    connectGate: null as Promise<void> | null,
    /** When set, the microphone prompt waits for it: a test can stop a conversation while the prompt is open. */
    micGate: null as Promise<void> | null,
    /** When set, the room reports a disconnect and then fails to connect, as a real room can. */
    connectFailure: false,
    rooms: [] as FakeRoom[]
  }

  class FakeRoom {
    readonly micTrack = { stop: vi.fn() }
    readonly remoteParticipants = new Map<string, { attributes: Record<string, string> }>()
    private micPublished = false
    readonly connect = vi.fn(async (_url: string, _token: string) => {
      if (state.connectGate) await state.connectGate
      if (state.connectFailure) {
        this.emit('disconnected')
        throw new Error('no route to host')
      }
      // What the agent may already have set on itself when the visitor joins.
      if (state.joinAttributes) this.remoteParticipants.set('agent', { attributes: state.joinAttributes })
    })
    readonly disconnect = vi.fn(async () => undefined)
    readonly localParticipant = {
      setMicrophoneEnabled: vi.fn(async (_enabled: boolean) => {
        if (state.micGate) await state.micGate
        if (state.micError) throw state.micError
        this.micPublished = true
        return undefined
      }),
      // As in the SDK, the microphone publication exists only once the prompt has been granted.
      getTrackPublication: vi.fn(() => (this.micPublished ? { track: this.micTrack } : undefined))
    }
    private readonly listeners = new Map<string, Set<Listener>>()

    constructor() {
      state.rooms.push(this)
    }

    on(event: string, listener: Listener): this {
      const set = this.listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      this.listeners.set(event, set)
      return this
    }

    removeAllListeners(): this {
      this.listeners.clear()
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
    }
  }

  return { state, FakeRoom }
})

vi.mock('livekit-client', () => ({
  Room: lk.FakeRoom,
  RoomEvent: {
    Disconnected: 'disconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    ParticipantAttributesChanged: 'participantAttributesChanged',
    ParticipantDisconnected: 'participantDisconnected'
  },
  Track: {
    Kind: { Audio: 'audio', Video: 'video' },
    Source: { Microphone: 'microphone' }
  }
}))

// The shared audio graph, reduced to the parts the service touches.
const audio = vi.hoisted(() => {
  const sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const analyser = { name: 'shared-analyser' }
  const context = {
    destination: { name: 'destination' },
    createMediaStreamSource: vi.fn((_stream: unknown) => {
      const source = { connect: vi.fn(), disconnect: vi.fn() }
      sources.push(source)
      return source
    })
  }
  const graph = { context, analyser, panner: null }
  return {
    sources,
    analyser,
    context,
    getAudioGraph: vi.fn(() => graph),
    resumeAudioGraph: vi.fn(async () => undefined)
  }
})

vi.mock('../tts/audioGraph', () => ({
  getAudioGraph: audio.getAudioGraph,
  resumeAudioGraph: audio.resumeAudioGraph
}))

class FakeMediaStream {
  readonly tracks: unknown[]

  constructor(tracks: unknown[] = []) {
    this.tracks = tracks
  }
}

const LIVE_TOKEN = {
  serverUrl: 'wss://livekit.test.invalid',
  token: 'header.payload.signature',
  room: 'talk-test',
  identity: 'visitor-abcdefgh',
  maxSeconds: 180
}

/** A fetch answer with the parts the service reads. */
function answer(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const AGENT_VOICE = { kind: 'audio', mediaStreamTrack: { id: 'agent-voice' } } as const

/** Let queued promise work (a finished attempt releasing its room) run before asserting. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  lk.state.rooms.length = 0
  lk.state.micError = undefined
  lk.state.joinAttributes = undefined
  lk.state.connectGate = null
  lk.state.micGate = null
  lk.state.connectFailure = false
  audio.sources.length = 0
  audio.context.createMediaStreamSource.mockClear()
  audio.resumeAudioGraph.mockClear()
  fetchMock = vi.fn(async () => answer(200, LIVE_TOKEN))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('MediaStream', FakeMediaStream)
})

afterEach(async () => {
  await __resetTalkForTests()
  vi.unstubAllGlobals()
})

describe('startTalk', () => {
  it('asks the talk route for a token', async () => {
    await startTalk()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(apiUrl('/api/talk/token'), expect.objectContaining({ method: 'POST' }))
  })

  it('joins the room the server names, then enables the microphone', async () => {
    await startTalk()
    const [room] = lk.state.rooms
    expect(room.connect).toHaveBeenCalledWith('wss://livekit.test.invalid', 'header.payload.signature')
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(TalkStore.get()).toEqual({ state: 'live', reason: null })
  })

  it('resumes the audio graph straight away, inside the gesture that started it', async () => {
    const started = startTalk()
    expect(audio.resumeAudioGraph).toHaveBeenCalledTimes(1)
    await started
  })

  it('does not open a second conversation while one is live', async () => {
    await startTalk()
    await startTalk()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lk.state.rooms).toHaveLength(1)
  })

  it('maps a 503 talk_disabled answer to a typed error, and joins no room', async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: 'talk_disabled' }))
    const failure = await startTalk().catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(TalkError)
    expect(failure).toMatchObject({ reason: 'talk_disabled' })
    expect(TalkStore.get()).toEqual({ state: 'error', reason: 'talk_disabled' })
    expect(lk.state.rooms).toHaveLength(0)
  })

  it.each(['talk_busy', 'talk_misconfigured'])('maps a 503 %s answer to the same reason', async (code) => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: code }))
    await expect(startTalk()).rejects.toMatchObject({ reason: code })
    expect(TalkStore.get()).toEqual({ state: 'error', reason: code })
  })

  it('treats any other failed answer as request_failed', async () => {
    fetchMock.mockResolvedValueOnce(answer(500, { error: 'boom' }))
    await expect(startTalk()).rejects.toMatchObject({ reason: 'request_failed' })
  })

  it('refuses a server URL that is not wss, and joins no room', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { ...LIVE_TOKEN, serverUrl: 'https://livekit.test.invalid' }))
    await expect(startTalk()).rejects.toMatchObject({ reason: 'request_failed' })
    expect(lk.state.rooms).toHaveLength(0)
  })

  it('a refused microphone is an error, and the room is released', async () => {
    lk.state.micError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    await expect(startTalk()).rejects.toMatchObject({ reason: 'microphone_denied' })

    expect(TalkStore.get()).toEqual({ state: 'error', reason: 'microphone_denied' })
    expect(lk.state.rooms[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('stopping while still connecting leaves no room behind', async () => {
    const started = startTalk()
    await stopTalk()

    await expect(started).resolves.toBeUndefined()
    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'user_stopped' })
    expect(lk.state.rooms).toHaveLength(0)
  })

  it('a stop while the room is still connecting leaves it disconnected once the connect finishes', async () => {
    let finishConnect!: () => void
    lk.state.connectGate = new Promise<void>((resolve) => {
      finishConnect = resolve
    })

    const started = startTalk()
    await flush()
    await stopTalk()
    finishConnect()
    await started

    const [room] = lk.state.rooms
    expect(room.disconnect).toHaveBeenCalled()
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'user_stopped' })
  })

  it('a room that reports its own connect failure rejects with connect_failed', async () => {
    lk.state.connectFailure = true
    await expect(startTalk()).rejects.toMatchObject({ reason: 'connect_failed' })
    expect(TalkStore.get()).toEqual({ state: 'error', reason: 'connect_failed' })
    expect(lk.state.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  it('a microphone granted after a stop is stopped, not left running', async () => {
    let grantMicrophone!: () => void
    lk.state.micGate = new Promise<void>((resolve) => {
      grantMicrophone = resolve
    })

    const started = startTalk()
    await flush()
    await stopTalk()
    grantMicrophone()
    await started

    const [room] = lk.state.rooms
    expect(room.micTrack.stop).toHaveBeenCalled()
    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'user_stopped' })
  })

  it('an ftv.end the agent set before the visitor joined ends the session at once', async () => {
    lk.state.joinAttributes = { 'ftv.end': 'idle' }
    await startTalk()
    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'idle' })
    expect(lk.state.rooms[0].disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('stopTalk', () => {
  it('disconnects the room, stops the microphone track, then disconnects the agent audio', async () => {
    await startTalk()
    const [room] = lk.state.rooms
    room.emit('trackSubscribed', AGENT_VOICE, {}, {})

    await stopTalk()

    expect(room.disconnect).toHaveBeenCalledTimes(1)
    expect(room.micTrack.stop).toHaveBeenCalledTimes(1)
    expect(audio.sources[0].disconnect).toHaveBeenCalledTimes(1)
    const [disconnected] = room.disconnect.mock.invocationCallOrder
    expect(disconnected).toBeLessThan(room.micTrack.stop.mock.invocationCallOrder[0])
    expect(room.micTrack.stop.mock.invocationCallOrder[0]).toBeLessThan(
      audio.sources[0].disconnect.mock.invocationCallOrder[0]
    )
    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'user_stopped' })
  })

  it('does nothing when no conversation is running', async () => {
    await stopTalk()
    expect(TalkStore.get()).toEqual({ state: 'idle', reason: null })
  })
})

describe('the agent voice', () => {
  it('routes into the shared analyser through a MediaStreamAudioSourceNode', async () => {
    await startTalk()
    const agentTrack = AGENT_VOICE.mediaStreamTrack as unknown as MediaStreamTrack
    lk.state.rooms[0].emit('trackSubscribed', AGENT_VOICE, {}, {})

    expect(audio.context.createMediaStreamSource).toHaveBeenCalledTimes(1)
    const [stream] = audio.context.createMediaStreamSource.mock.calls[0] as unknown as [FakeMediaStream]
    expect(stream.tracks).toEqual([agentTrack])
    expect(audio.sources[0].connect).toHaveBeenCalledWith(audio.analyser)
  })

  it('ignores video tracks', async () => {
    await startTalk()
    lk.state.rooms[0].emit('trackSubscribed', { kind: 'video', mediaStreamTrack: {} }, {}, {})
    expect(audio.context.createMediaStreamSource).not.toHaveBeenCalled()
  })
})

describe('talkAnalyser', () => {
  it('is the shared analyser only while a conversation is live', async () => {
    expect(talkAnalyser()).toBeNull()
    await startTalk()
    expect(talkAnalyser()).toBe(audio.analyser)
    await stopTalk()
    expect(talkAnalyser()).toBeNull()
  })
})

describe('ending a conversation', () => {
  it('an ftv.end attribute from the agent ends the session, with the agent reason', async () => {
    await startTalk()
    const [room] = lk.state.rooms
    room.emit('participantAttributesChanged', { 'ftv.end': 'time_up' }, { identity: 'agent' })
    await flush()

    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'time_up' })
    expect(room.disconnect).toHaveBeenCalledTimes(1)
    expect(room.micTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('maps an agent error to the error state', async () => {
    await startTalk()
    lk.state.rooms[0].emit('participantAttributesChanged', { 'ftv.end': 'voice_error' }, {})
    await flush()
    expect(TalkStore.get()).toEqual({ state: 'error', reason: 'agent_error' })
  })

  it('maps an unrecognised ftv.end value to agent_ended, and never carries its text', async () => {
    await startTalk()
    lk.state.rooms[0].emit('participantAttributesChanged', { 'ftv.end': 'the model said: boom' }, {})
    await flush()

    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'agent_ended' })
    expect(JSON.stringify(TalkStore.get())).not.toContain('boom')
  })

  it('the agent leaving the room ends the session as agent_ended', async () => {
    await startTalk()
    const [room] = lk.state.rooms
    room.emit('participantDisconnected', { identity: 'agent' })
    await flush()

    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'agent_ended' })
    expect(room.disconnect).toHaveBeenCalledTimes(1)
  })

  it('a room that drops mid-conversation ends the session as room_closed', async () => {
    await startTalk()
    lk.state.rooms[0].emit('disconnected')
    await flush()
    expect(TalkStore.get()).toEqual({ state: 'ended', reason: 'room_closed' })
  })
})
