import { afterEach, describe, expect, it, vi } from 'vitest'

import { APP_ORIGINS, parseAllowedOrigins, resolveAllowedOrigin, resolveConfig } from '../src/config.js'
import { createApp } from '../src/server.js'

const PAGES_ORIGIN = 'https://avatar.ci.computer'

/**
 * A GET route that answers from env alone. /api/health would do for CORS, but it
 * probes the chat and TTS upstreams over the network first, which made these
 * tests slow and, where host.docker.internal resolves, time out.
 */
const PROBE_FREE_ROUTE = '/api/config/telemetry'

/**
 * These cases are what make the split deployment work: the static Cloudflare
 * Pages build at avatar.ci.computer calling this BFF on a different origin
 * (self-hosted, exposed over a Cloudflare tunnel). Without the allowlist the
 * browser discards every /api/* response.
 *
 * The first block is the one that must never regress — the container and
 * dev-server deployments are same-origin and must keep sending no CORS headers
 * at all, because an unconditional `Access-Control-Allow-Origin` on a proxy
 * reachable over a tunnel is exactly the mistake this guards against.
 */
describe('CORS — default (no APP_ALLOWED_ORIGINS)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends no Access-Control-Allow-Origin', async () => {
    const res = await createApp().request(PROBE_FREE_ROUTE, {
      headers: { Origin: PAGES_ORIGIN }
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('does not turn a preflight into an approval', async () => {
    const res = await createApp().request('/api/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: PAGES_ORIGIN,
        'Access-Control-Request-Method': 'POST'
      }
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sets no Vary: Origin either', async () => {
    // Hono's cors() is not inert when it merely *declines* an origin — it still
    // adds Vary: Origin to every response. Harmless, but it is a change to a
    // deployment that asked for no CORS at all, and it makes a shared cache key
    // on a header the response does not actually depend on. So the middleware is
    // skipped outright when the allowlist is empty, and this is what proves it.
    const res = await createApp().request(PROBE_FREE_ROUTE, {
      headers: { Origin: PAGES_ORIGIN }
    })

    expect(res.headers.get('vary')).toBeNull()
  })

  it('lets the router handle OPTIONS rather than short-circuiting it', async () => {
    // cors() answers every preflight with a 204 before the router sees it. With no
    // allowlist the BFF has no OPTIONS route, so the honest answer is the router's
    // 404 — the same thing the container returned before this middleware existed.
    const res = await createApp().request('/api/chat', { method: 'OPTIONS' })

    expect(res.status).toBe(404)
  })
})

describe('CORS — with an allowlist', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('echoes an allowlisted origin', async () => {
    vi.stubEnv('APP_ALLOWED_ORIGINS', PAGES_ORIGIN)

    const res = await createApp().request(PROBE_FREE_ROUTE, {
      headers: { Origin: PAGES_ORIGIN }
    })

    expect(res.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN)
  })

  it('refuses an origin that is not listed', async () => {
    vi.stubEnv('APP_ALLOWED_ORIGINS', PAGES_ORIGIN)

    const res = await createApp().request(PROBE_FREE_ROUTE, {
      headers: { Origin: 'https://attacker.example' }
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers a chat preflight so the real POST is allowed to follow', async () => {
    vi.stubEnv('APP_ALLOWED_ORIGINS', PAGES_ORIGIN)

    const res = await createApp().request('/api/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: PAGES_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    })

    expect(res.status).toBeLessThan(300)
    expect(res.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type')
  })

  it('honours several origins, so a preview URL can be allowed beside production', async () => {
    const preview = 'https://avatars-zbe.pages.dev'
    vi.stubEnv('APP_ALLOWED_ORIGINS', `${PAGES_ORIGIN},${preview}`)

    for (const origin of [PAGES_ORIGIN, preview]) {
      const res = await createApp().request(PROBE_FREE_ROUTE, { headers: { Origin: origin } })
      expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    }
  })

  it('never allows credentials, so a permissive list cannot ride browser cookies', async () => {
    vi.stubEnv('APP_ALLOWED_ORIGINS', '*')

    const res = await createApp().request(PROBE_FREE_ROUTE, {
      headers: { Origin: PAGES_ORIGIN }
    })

    expect(res.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN)
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })
})

describe('parseAllowedOrigins', () => {
  it('is empty for unset and blank values', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins(' , ,')).toEqual([])
  })

  it('trims, lowercases, drops a trailing slash and deduplicates', () => {
    expect(parseAllowedOrigins(' https://Avatar.CI.Computer/ , https://avatar.ci.computer ')).toEqual([
      'https://avatar.ci.computer'
    ])
  })
})

describe('resolveAllowedOrigin', () => {
  it('declines everything when the allowlist is empty', () => {
    expect(resolveAllowedOrigin(PAGES_ORIGIN, [])).toBeNull()
  })

  it('matches case-insensitively and ignores a trailing slash in the env value', () => {
    const allowed = parseAllowedOrigins('https://Avatar.CI.Computer/')
    expect(resolveAllowedOrigin(PAGES_ORIGIN, allowed)).toBe(PAGES_ORIGIN)
  })

  it('does not match a different port or scheme', () => {
    const allowed = parseAllowedOrigins('https://avatar.ci.computer')
    expect(resolveAllowedOrigin('http://avatar.ci.computer', allowed)).toBeNull()
    expect(resolveAllowedOrigin('https://avatar.ci.computer:8443', allowed)).toBeNull()
  })

  it('does not treat the allowlist entry as a suffix match', () => {
    const allowed = parseAllowedOrigins('https://avatar.ci.computer')
    expect(resolveAllowedOrigin('https://evil-avatar.ci.computer', allowed)).toBeNull()
    expect(resolveAllowedOrigin('https://avatar.ci.computer.evil.test', allowed)).toBeNull()
  })

  it('echoes the caller origin for a wildcard rather than returning "*"', () => {
    expect(resolveAllowedOrigin(PAGES_ORIGIN, ['*'])).toBe(PAGES_ORIGIN)
  })
})

/**
 * The desktop and Android apps serve their bundled web app from these origins,
 * and a user can point either app at their own BFF. A stock BFF (no
 * APP_ALLOWED_ORIGINS) must answer them, and must still answer everything else
 * exactly as the "default" block above pins.
 */
describe('CORS — the desktop and Android apps', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('names the four app origins exactly', () => {
    expect([...APP_ORIGINS]).toEqual([
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'https://localhost'
    ])
    expect(resolveConfig({}).appOrigins).toEqual([...APP_ORIGINS])
  })

  it.each([...APP_ORIGINS])('echoes %s with no APP_ALLOWED_ORIGINS set', async (origin) => {
    const res = await createApp().request(PROBE_FREE_ROUTE, { headers: { Origin: origin } })

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    expect(res.headers.get('vary')).toContain('Origin')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it.each([...APP_ORIGINS])('answers a chat preflight from %s', async (origin) => {
    const res = await createApp().request('/api/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type')
  })

  it.each([
    'tauri://evil.example',
    'tauri://localhost.evil.example',
    'http://tauri.localhost.evil.example',
    'https://tauri.localhost:8443',
    'http://tauri.localhost:8080',
    'https://localhost:5173',
    'http://localhost',
    'https://evil-localhost.example',
    'capacitor://localhost',
    'null'
  ])('treats the lookalike %s like any other origin: no CORS headers at all', async (origin) => {
    const res = await createApp().request(PROBE_FREE_ROUTE, { headers: { Origin: origin } })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()

    const preflight = await createApp().request('/api/chat', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' }
    })
    expect(preflight.status).toBe(404)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('keeps allowing the apps when an operator lists other origins', async () => {
    vi.stubEnv('APP_ALLOWED_ORIGINS', PAGES_ORIGIN)

    for (const origin of [PAGES_ORIGIN, 'tauri://localhost', 'https://localhost']) {
      const res = await createApp().request(PROBE_FREE_ROUTE, { headers: { Origin: origin } })
      expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    }
    const other = await createApp().request(PROBE_FREE_ROUTE, { headers: { Origin: 'https://attacker.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('turns the app origins off with APP_ALLOW_NATIVE_APPS=false, back to no CORS at all', async () => {
    vi.stubEnv('APP_ALLOW_NATIVE_APPS', 'false')
    expect(resolveConfig().appOrigins).toEqual([])

    for (const origin of APP_ORIGINS) {
      const res = await createApp().request(PROBE_FREE_ROUTE, { headers: { Origin: origin } })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      expect(res.headers.get('vary')).toBeNull()
    }
  })

  it('reads anything but exactly "false" as on', () => {
    for (const value of ['', '0', 'no', 'FALSE', 'true']) {
      expect(resolveConfig({ APP_ALLOW_NATIVE_APPS: value }).appOrigins).toEqual([...APP_ORIGINS])
    }
  })

  it('sends a same-origin request (no Origin header) nothing new', async () => {
    const res = await createApp().request(PROBE_FREE_ROUTE)

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
  })
})
