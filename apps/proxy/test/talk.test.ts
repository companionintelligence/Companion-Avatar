import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveTalkConfig } from '../src/config.js'
import { __resetTalkAdmissionForTests } from '../src/routes/talk.js'
import { createApp } from '../src/server.js'
import { buildTalkMetadata, parseTalkMetadata } from '../src/talk/metadata.js'

// Test values only. Nothing here is a real key, and no LiveKit server is contacted: the token is signed, not sent.
const KEY = 'APItalktestkey'
const SECRET = 'talk-test-secret-0123456789abcdefghijklmnop'
const VOICE = 'testVoice_01'

const TALK_ENV: Record<string, string> = {
  APP_TALK_ENABLED: 'true',
  APP_LIVEKIT_URL: 'wss://livekit.test.invalid',
  APP_LIVEKIT_API_KEY: KEY,
  APP_LIVEKIT_API_SECRET: SECRET,
  APP_TALK_VOICE_ID: VOICE
}

interface TokenClaims {
  iss: string
  sub: string
  name: string
  exp: number
  nbf: number
  video: Record<string, unknown>
  roomConfig: {
    name: string
    maxParticipants: number
    emptyTimeout: number
    departureTimeout: number
    agents: Array<{ agentName: string; metadata: string }>
  }
}

interface TokenBody {
  serverUrl: string
  token: string
  room: string
  identity: string
  maxSeconds: number
}

function enableTalk(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...TALK_ENV, ...overrides })) vi.stubEnv(name, value)
}

const requestToken = () => createApp().request('/api/talk/token', { method: 'POST' })

async function mintToken(): Promise<TokenBody> {
  const res = await requestToken()
  expect(res.status).toBe(200)
  return (await res.json()) as TokenBody
}

function claimsOf(token: string): TokenClaims {
  const [, payload] = token.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims
}

function messageOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected the call to throw')
}

beforeEach(() => __resetTalkAdmissionForTests())

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('POST /api/talk/token while talk is off', () => {
  it.each(['false', 'TRUE', '1', ''])('answers 503 talk_disabled when APP_TALK_ENABLED is %j', async (value) => {
    vi.stubEnv('APP_TALK_ENABLED', value)
    const res = await requestToken()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'talk_disabled' })
  })

  it('answers 503 talk_disabled when APP_TALK_ENABLED is unset', async () => {
    const saved = process.env.APP_TALK_ENABLED
    delete process.env.APP_TALK_ENABLED
    try {
      const res = await requestToken()
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'talk_disabled' })
    } finally {
      if (saved !== undefined) process.env.APP_TALK_ENABLED = saved
    }
  })
})

describe('POST /api/talk/token while talk is on', () => {
  it('returns the join details and the token, and never the API secret', async () => {
    enableTalk()
    const res = await requestToken()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const raw = await res.text()
    expect(raw).not.toContain(SECRET)
    const body = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['identity', 'maxSeconds', 'room', 'serverUrl', 'token'])
    expect(body.serverUrl).toBe('wss://livekit.test.invalid')
    expect(body.maxSeconds).toBe(180)
  })

  it('names a new talk room and a visitor identity with the required prefixes', async () => {
    enableTalk()
    const first = await mintToken()
    __resetTalkAdmissionForTests()
    const second = await mintToken()

    expect(first.room).toMatch(/^talk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(second.room).not.toBe(first.room)
    expect(first.identity).toMatch(/^visitor-[A-Za-z0-9_-]{8}$/)
  })

  it('mints a one-minute token that may only join its room and publish a microphone', async () => {
    enableTalk()
    const body = await mintToken()
    const claims = claimsOf(body.token)

    expect(claims.iss).toBe(KEY)
    expect(claims.sub).toBe(body.identity)
    expect(claims.name).toBe('Visitor')
    expect(claims.exp - claims.nbf).toBe(60)
    expect(claims.video).toEqual({
      roomJoin: true,
      room: body.room,
      canPublish: true,
      canPublishSources: ['microphone'],
      canSubscribe: true,
      canPublishData: false
    })
  })

  it('dispatches the character agent into a two-person room, with metadata the agent accepts', async () => {
    enableTalk()
    const body = await mintToken()
    const { roomConfig } = claimsOf(body.token)

    expect(roomConfig).toMatchObject({ name: body.room, maxParticipants: 2, emptyTimeout: 30, departureTimeout: 10 })
    expect(roomConfig.agents).toHaveLength(1)
    const [dispatch] = roomConfig.agents
    expect(dispatch.agentName).toBe('ftv-character')

    const metadata = parseTalkMetadata(JSON.parse(dispatch.metadata))
    expect(metadata).toMatchObject({
      v: 1,
      name: 'Companion',
      voiceId: VOICE,
      again: false,
      startMood: { emotion: 'neutral', strength: 0 },
      maxSeconds: 180
    })
    expect(Object.keys(metadata.moodTags)).toEqual(expect.arrayContaining(['happy', 'sad', 'pain']))
    for (const tags of Object.values(metadata.moodTags)) expect(tags).toHaveLength(3)
  })

  it('gives the agent the default companion instructions, with the safety rules', async () => {
    enableTalk()
    const body = await mintToken()
    const [dispatch] = claimsOf(body.token).roomConfig.agents
    const { instructions } = JSON.parse(dispatch.metadata) as { instructions: string }

    expect(instructions).toContain('AI companion')
    expect(instructions).toContain('family-friendly')
    expect(instructions).toContain('personal details')
    expect(instructions).toContain('medical, legal or financial advice')
    expect(instructions).toContain('famous person')
    expect(instructions).toContain('at most 3 minutes')
  })

  it('uses the operator instructions in place of the default when APP_TALK_INSTRUCTIONS is set', async () => {
    enableTalk({ APP_TALK_INSTRUCTIONS: 'Be a plain test voice.' })
    const body = await mintToken()
    const [dispatch] = claimsOf(body.token).roomConfig.agents
    expect(JSON.parse(dispatch.metadata)).toMatchObject({ instructions: 'Be a plain test voice.' })
  })

  it('uses the configured agent name, and caps the length at the hard limit', async () => {
    enableTalk({ APP_TALK_AGENT_NAME: 'custom-agent', APP_TALK_MAX_SECONDS: '900' })
    const body = await mintToken()
    const [dispatch] = claimsOf(body.token).roomConfig.agents

    expect(dispatch.agentName).toBe('custom-agent')
    expect(body.maxSeconds).toBe(300)
    expect(parseTalkMetadata(JSON.parse(dispatch.metadata)).maxSeconds).toBe(300)
  })

  it('answers 503 talk_busy once APP_TALK_MAX_CONCURRENT tokens are out in the window', async () => {
    enableTalk({ APP_TALK_MAX_CONCURRENT: '1' })
    await mintToken()
    const busy = await requestToken()
    expect(busy.status).toBe(503)
    expect(await busy.json()).toEqual({ error: 'talk_busy' })
  })

  it('admits again once the five-minute window has passed', async () => {
    enableTalk({ APP_TALK_MAX_CONCURRENT: '1' })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    await mintToken()
    expect((await requestToken()).status).toBe(503)

    vi.setSystemTime(new Date('2030-01-01T00:05:01Z'))
    await mintToken()
  })

  it('answers 503 talk_misconfigured, and logs only the variable name, when a setting is missing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    enableTalk({ APP_LIVEKIT_API_SECRET: '' })

    const res = await requestToken()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'talk_misconfigured' })
    expect(errors).toHaveBeenCalledWith('[talk] APP_TALK_ENABLED=true needs APP_LIVEKIT_API_SECRET')
  })
})

describe('talk configuration', () => {
  it('is off unless APP_TALK_ENABLED is exactly true', () => {
    expect(resolveTalkConfig({})).toBeNull()
    expect(resolveTalkConfig({ ...TALK_ENV, APP_TALK_ENABLED: 'false' })).toBeNull()
  })

  it('applies the defaults when only the required settings are present', () => {
    expect(resolveTalkConfig(TALK_ENV)).toEqual({
      livekitUrl: 'wss://livekit.test.invalid',
      livekitApiKey: KEY,
      livekitApiSecret: SECRET,
      voiceId: VOICE,
      agentName: 'ftv-character',
      maxSeconds: 180,
      maxConcurrent: 2,
      instructions: null
    })
  })

  it('fails validation naming the missing variable, and never a value', () => {
    const message = messageOf(() => resolveTalkConfig({ ...TALK_ENV, APP_LIVEKIT_API_SECRET: '' }))
    expect(message).toBe('APP_TALK_ENABLED=true needs APP_LIVEKIT_API_SECRET')
    expect(message).not.toContain(SECRET)
    expect(message).not.toContain(KEY)
    expect(message).not.toContain(VOICE)
  })

  it('names the variable, not the value, for each malformed setting', () => {
    expect(messageOf(() => resolveTalkConfig({ ...TALK_ENV, APP_LIVEKIT_URL: 'https://livekit.test.invalid' }))).toBe(
      'APP_LIVEKIT_URL must be a wss:// URL'
    )
    expect(messageOf(() => resolveTalkConfig({ ...TALK_ENV, APP_TALK_VOICE_ID: 'no' }))).toMatch(/^APP_TALK_VOICE_ID /)
    expect(messageOf(() => resolveTalkConfig({ ...TALK_ENV, APP_TALK_MAX_SECONDS: '5' }))).toBe(
      'APP_TALK_MAX_SECONDS must be a whole number of at least 10'
    )
    expect(messageOf(() => resolveTalkConfig({ ...TALK_ENV, APP_TALK_MAX_CONCURRENT: '0' }))).toBe(
      'APP_TALK_MAX_CONCURRENT must be a whole number of at least 1'
    )
    expect(messageOf(() => resolveTalkConfig({ ...TALK_ENV, APP_TALK_INSTRUCTIONS: 'x'.repeat(12_001) }))).toBe(
      'APP_TALK_INSTRUCTIONS must be at most 12000 characters'
    )
  })
})

describe('talk metadata', () => {
  const base = buildTalkMetadata({
    name: 'Companion',
    voiceId: VOICE,
    instructions: 'Hello.',
    greeting: 'Hi.',
    maxSeconds: 60
  })

  it('accepts what the builder makes', () => {
    expect(parseTalkMetadata(base)).toMatchObject({ v: 1, maxSeconds: 60 })
  })

  it.each([
    ['v', { v: 2 }],
    ['voiceId', { voiceId: 'no' }],
    ['maxSeconds', { maxSeconds: 9 }],
    ['instructions', { instructions: '' }],
    ['startMood', { startMood: { emotion: 'happy', strength: 4 } }],
    ['moodTags', { moodTags: { happy: ['a [b]', 'c', 'd'] } }]
  ])('rejects a bad %s, naming it', (field, change) => {
    expect(() => parseTalkMetadata({ ...base, ...change })).toThrow(`talk metadata: ${field}`)
  })
})
