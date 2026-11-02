/**
 * Runtime configuration for the BFF, read from process.env on each resolve so a
 * marketplace container can be pointed at any upstream without a rebuild.
 */
export type UpstreamKind = 'ollama' | 'openai' | 'ci-server'

/**
 * TTS upstream kind. `cosyvoice` speaks to a CosyVoice2 OpenAI-compatible server
 * (see `upstreams/cosyvoice.ts`). Kept as its own enum so the chat and TTS
 * upstreams evolve independently.
 */
export type TtsUpstreamKind = 'cosyvoice' | 'headtts'

export interface ResolvedConfig {
  upstream: UpstreamKind
  ollamaUrl: string
  ollamaModel: string
  openaiUrl: string
  openaiApiKey: string
  openaiModel: string
  ciServerUrl: string
  /** Selected TTS upstream (env APP_TTS_UPSTREAM). */
  ttsUpstream: TtsUpstreamKind
  /**
   * Base URL of the TTS server. Should point at a CosyVoice2 OpenAI-compatible
   * server exposing `POST /v1/audio/speech` — e.g. gpustack/vox-box or
   * neosun100/cosyvoice-docker. There is no such server in CI/tests, which is
   * why the TTS tests mock `fetch`.
   */
  ttsUrl: string
  ttsModel: string
  ttsVoice: string
  sttUrl: string
  sttModel: string
  ciServerApiKey: string
  /** How many knowledge-graph hits to pull per turn. */
  memoryMaxResults: number
  /** Which upstream actually generates tokens when memory is in front. */
  memoryGenerationUpstream: UpstreamKind
  port: number
  requestTimeoutMs: number
  /**
   * Browser origins allowed to call this BFF cross-origin (env
   * `APP_ALLOWED_ORIGINS`, comma-separated).
   *
   * Empty by default, which sends no CORS headers at all — the same-origin
   * deployments (nginx reverse-proxying `/api/` in the container, Vite's dev
   * proxy) never needed them and are unaffected.
   *
   * It is needed when the SPA and this proxy are on *different* origins: the
   * static Cloudflare Pages build at `https://avatar.ci.computer` talking to a
   * self-hosted proxy exposed over a Cloudflare tunnel. Without the origin
   * listed here the browser blocks every `/api/*` response.
   *
   * A single `*` entry allows any origin. Credentials are never allowed either
   * way, so a permissive list cannot be used to ride a user's cookies.
   */
  allowedOrigins: string[]
}

/**
 * Normalize an origin for comparison against the `Origin` header the browser
 * sends: scheme and host are case-insensitive, and the header never carries a
 * trailing slash even when an operator writes one in the env var.
 */
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

/** Parse `APP_ALLOWED_ORIGINS` into a deduplicated list, dropping blank entries. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map(normalizeOrigin).filter(Boolean))]
}

/**
 * Resolve an `Origin` header against the allowlist, returning the value to echo
 * in `Access-Control-Allow-Origin` or `null` to send no CORS headers.
 *
 * Echoes the request's own origin rather than `*` on a match, so the response
 * stays correct behind a cache that varies on `Origin`.
 */
export function resolveAllowedOrigin(origin: string, allowed: string[]): string | null {
  if (allowed.length === 0) return null
  if (allowed.includes('*')) return origin
  return allowed.includes(normalizeOrigin(origin)) ? origin : null
}

const VALID_UPSTREAMS: UpstreamKind[] = ['ollama', 'openai', 'ci-server']
const VALID_TTS_UPSTREAMS: TtsUpstreamKind[] = ['cosyvoice', 'headtts']

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const upstream = (env.APP_UPSTREAM ?? 'ollama') as UpstreamKind
  if (!VALID_UPSTREAMS.includes(upstream)) {
    throw new Error(`Invalid APP_UPSTREAM "${upstream}" (expected one of: ${VALID_UPSTREAMS.join(', ')})`)
  }

  const openaiApiKey = env.APP_OPENAI_API_KEY ?? ''
  if (upstream === 'openai' && !openaiApiKey) {
    throw new Error('APP_OPENAI_API_KEY is required when APP_UPSTREAM=openai')
  }

  const ttsUpstream = (env.APP_TTS_UPSTREAM ?? 'cosyvoice') as TtsUpstreamKind
  if (!VALID_TTS_UPSTREAMS.includes(ttsUpstream)) {
    throw new Error(
      `Invalid APP_TTS_UPSTREAM "${ttsUpstream}" (expected one of: ${VALID_TTS_UPSTREAMS.join(', ')})`
    )
  }

  return {
    upstream,
    ollamaUrl: stripTrailingSlash(env.APP_OLLAMA_URL ?? 'http://host.docker.internal:11434'),
    ollamaModel: env.APP_OLLAMA_MODEL ?? 'gemma3:1b',
    openaiUrl: stripTrailingSlash(env.APP_OPENAI_URL ?? 'https://api.openai.com/v1'),
    openaiApiKey,
    openaiModel: env.APP_OPENAI_MODEL ?? 'gpt-4o-mini',
    ciServerUrl: stripTrailingSlash(env.APP_CISERVER_URL ?? 'http://host.docker.internal:3000'),
    ttsUpstream,
    // Default targets a CosyVoice2 OpenAI-compatible server on the host. 8880 is
    // the port used by common CosyVoice2 Docker images (e.g. vox-box); override
    // with APP_TTS_URL for a different host/port.
    ttsUrl: stripTrailingSlash(env.APP_TTS_URL ?? 'http://host.docker.internal:8880'),
    ttsModel: env.APP_TTS_MODEL ?? 'cosyvoice2-0.5b',
    ttsVoice: env.APP_TTS_VOICE ?? 'default',
    sttUrl: stripTrailingSlash(env.APP_STT_URL ?? 'http://host.docker.internal:8081'),
    sttModel: env.APP_STT_MODEL ?? 'Systran/faster-whisper-small',
    ciServerApiKey: env.APP_CI_SERVER_API_KEY ?? '',
    memoryMaxResults: Number(env.APP_MEMORY_MAX_RESULTS ?? '6'),
    memoryGenerationUpstream: (env.APP_MEMORY_GENERATION_UPSTREAM ?? 'ollama') as UpstreamKind,
    port: Number(env.PORT ?? 8787),
    requestTimeoutMs: Number(env.APP_REQUEST_TIMEOUT_MS ?? 60000),
    allowedOrigins: parseAllowedOrigins(env.APP_ALLOWED_ORIGINS)
  }
}

/**
 * Longest a live conversation may run, whatever APP_TALK_MAX_SECONDS says. The character agent caps it the same way on
 * its side, so a larger value here would only be clipped there.
 */
export const TALK_HARD_MAX_SECONDS = 300

/** Longest instructions the character agent accepts in its job metadata. */
export const TALK_MAX_INSTRUCTIONS = 12_000

/**
 * Live talk: a visitor's microphone joins a LiveKit room with the character agent (routes/talk.ts). Read only when
 * APP_TALK_ENABLED is exactly `true`, and off by default. `livekitApiSecret` signs the join tokens, so it must never
 * reach a response or a log.
 */
export interface TalkConfig {
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  /** The ElevenLabs voice the agent speaks with (APP_TALK_VOICE_ID). */
  voiceId: string
  /** The agent name it is dispatched by (APP_TALK_AGENT_NAME). */
  agentName: string
  /** Conversation length the agent is told, in seconds: APP_TALK_MAX_SECONDS, capped at TALK_HARD_MAX_SECONDS. */
  maxSeconds: number
  /** Tokens admitted per five-minute window (APP_TALK_MAX_CONCURRENT). Approximate; see routes/talk.ts. */
  maxConcurrent: number
  /** Replaces the built-in companion instructions when set (APP_TALK_INSTRUCTIONS). */
  instructions: string | null
}

const TALK_REQUIRED = ['APP_LIVEKIT_URL', 'APP_LIVEKIT_API_KEY', 'APP_LIVEKIT_API_SECRET', 'APP_TALK_VOICE_ID'] as const

/**
 * Read the talk settings, or return null when talk is off. Once it is on, every problem throws an error that names the
 * variable and never its value. server.ts calls this at startup, so a bad deployment is refused there rather than at
 * the first conversation.
 */
export function resolveTalkConfig(env: NodeJS.ProcessEnv = process.env): TalkConfig | null {
  if (env.APP_TALK_ENABLED !== 'true') return null

  const read = (name: string) => (env[name] ?? '').trim()

  const missing = TALK_REQUIRED.filter((name) => !read(name))
  if (missing.length) throw new Error(`APP_TALK_ENABLED=true needs ${missing.join(', ')}`)

  const livekitUrl = stripTrailingSlash(read('APP_LIVEKIT_URL'))
  if (!isWssUrl(livekitUrl)) throw new Error('APP_LIVEKIT_URL must be a wss:// URL')

  const voiceId = read('APP_TALK_VOICE_ID')
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(voiceId)) {
    throw new Error('APP_TALK_VOICE_ID must be 4 to 64 letters, digits, "_" or "-"')
  }

  const agentName = read('APP_TALK_AGENT_NAME') || 'ftv-character'
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(agentName)) {
    throw new Error('APP_TALK_AGENT_NAME must be 1 to 64 letters, digits, "_" or "-"')
  }

  const instructions = read('APP_TALK_INSTRUCTIONS')
  if (instructions.length > TALK_MAX_INSTRUCTIONS) {
    throw new Error(`APP_TALK_INSTRUCTIONS must be at most ${TALK_MAX_INSTRUCTIONS} characters`)
  }

  return {
    livekitUrl,
    livekitApiKey: read('APP_LIVEKIT_API_KEY'),
    livekitApiSecret: read('APP_LIVEKIT_API_SECRET'),
    voiceId,
    agentName,
    maxSeconds: Math.min(
      wholeNumber(read('APP_TALK_MAX_SECONDS'), 180, 'APP_TALK_MAX_SECONDS', 10),
      TALK_HARD_MAX_SECONDS
    ),
    maxConcurrent: wholeNumber(read('APP_TALK_MAX_CONCURRENT'), 2, 'APP_TALK_MAX_CONCURRENT', 1),
    instructions: instructions || null
  }
}

/** A whole number from an env value, or `fallback` when it is unset. Throws, naming `name`, when it is below `min`. */
function wholeNumber(raw: string, fallback: number, name: string, min: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min}`)
  return n
}

function isWssUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'wss:'
  } catch {
    return false
  }
}
