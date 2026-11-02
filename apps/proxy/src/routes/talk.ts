import { randomBytes, randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import { AccessToken, RoomAgentDispatch, RoomConfiguration, TrackSource } from 'livekit-server-sdk'

import { resolveTalkConfig, type TalkConfig } from '../config.js'
import { buildTalkMetadata, parseTalkMetadata } from '../talk/metadata.js'
import { defaultInstructions, TALK_GREETING, TALK_NAME } from '../talk/persona.js'

export const talkRoutes = new Hono()

/** Life of the join token. The browser joins at once, so a minute is plenty and a leaked token goes stale quickly. */
const TOKEN_TTL_SECONDS = 60

/** The window APP_TALK_MAX_CONCURRENT counts tokens over. */
const WINDOW_MS = 5 * 60 * 1000

/** When each token in the current window was admitted (ms since the epoch). In memory, per process. */
const admitted: number[] = []

/**
 * POST /api/talk/token: a short-lived LiveKit token that joins a new room and dispatches the character agent into it.
 *
 * 503 `talk_disabled` unless APP_TALK_ENABLED is exactly `true`. 503 `talk_misconfigured` when it is on but a
 * setting is wrong (server.ts refuses to start in that case, so this only guards a changed environment). 503
 * `talk_busy` once APP_TALK_MAX_CONCURRENT tokens have been admitted in the last five minutes.
 *
 * The admission count is APPROXIMATE. It counts tokens, not live conversations: it does not know when a conversation
 * ends, so it can refuse while one is still running, or admit more than the limit once an earlier one ages out. It is
 * per process, so each replica counts on its own, and it starts again on restart. It is a brake on runaway use, not a
 * reservation of seats.
 *
 * The browser sends nothing. The room, identity, voice, instructions and length are all chosen here. The response
 * carries the public URL and the token, never the API secret, and nothing here logs a token.
 */
talkRoutes.post('/talk/token', async (c) => {
  let cfg: TalkConfig | null
  try {
    cfg = resolveTalkConfig()
  } catch (err) {
    // The message names a variable, never a value, so it is safe to log.
    console.error(`[talk] ${(err as Error).message}`)
    return c.json({ error: 'talk_misconfigured' }, 503)
  }
  if (!cfg) return c.json({ error: 'talk_disabled' }, 503)

  const now = Date.now()
  while (admitted.length && admitted[0] <= now - WINDOW_MS) admitted.shift()
  if (admitted.length >= cfg.maxConcurrent) return c.json({ error: 'talk_busy' }, 503)

  // Reserve the slot before the first await, so two requests that arrive together cannot both pass the check above.
  admitted.push(now)
  try {
    const join = await mintJoin(cfg)
    c.header('Cache-Control', 'no-store')
    return c.json({
      serverUrl: cfg.livekitUrl,
      token: join.token,
      room: join.room,
      identity: join.identity,
      maxSeconds: join.maxSeconds
    })
  } catch (err) {
    // Give the slot back: nothing was issued.
    const at = admitted.lastIndexOf(now)
    if (at >= 0) admitted.splice(at, 1)
    throw err
  }
})

/** Build the join token and the dispatch it carries. Nothing returned here is logged. */
async function mintJoin(
  cfg: TalkConfig
): Promise<{ token: string; room: string; identity: string; maxSeconds: number }> {
  const room = `talk-${randomUUID()}`
  // 6 random bytes encode to exactly 8 base64url characters.
  const identity = `visitor-${randomBytes(6).toString('base64url')}`

  const metadata = parseTalkMetadata(
    buildTalkMetadata({
      name: TALK_NAME,
      voiceId: cfg.voiceId,
      instructions: cfg.instructions ?? defaultInstructions(cfg.maxSeconds),
      greeting: TALK_GREETING,
      maxSeconds: cfg.maxSeconds
    })
  )

  const at = new AccessToken(cfg.livekitApiKey, cfg.livekitApiSecret, {
    identity,
    name: 'Visitor',
    ttl: TOKEN_TTL_SECONDS
  })
  // A microphone and nothing else: no camera, screen, or data channel.
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: false
  })
  // Applied when this token creates the room: at most two participants; the room closes 30 seconds after creation if no
  // one joins (emptyTimeout) or 10 seconds after the last one leaves (departureTimeout); and the character agent is
  // dispatched into it with the metadata above.
  at.roomConfig = new RoomConfiguration({
    name: room,
    maxParticipants: 2,
    emptyTimeout: 30,
    departureTimeout: 10,
    agents: [new RoomAgentDispatch({ agentName: cfg.agentName, metadata: JSON.stringify(metadata) })]
  })

  return { token: await at.toJwt(), room, identity, maxSeconds: metadata.maxSeconds }
}

/** Test hook: forget the admission window. */
export function __resetTalkAdmissionForTests(): void {
  admitted.length = 0
}
