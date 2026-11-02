// Sentry bootstrap. Must stay the FIRST import: the SDK patches Node internals
// on init, and it initialises nothing at all unless a DSN is configured.
import { captureException, installCrashHandlers, isTelemetryEnabled, telemetry } from './instrument.js'

import { pathToFileURL } from 'node:url'

import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { resolveAllowedOrigin, resolveConfig, resolveTalkConfig } from './config.js'
import { chatRoutes } from './routes/chat.js'
import { configRoutes } from './routes/config.js'
import { healthRoutes } from './routes/health.js'
import { sttRoutes } from './routes/stt.js'
import { talkRoutes } from './routes/talk.js'
import { ttsRoutes } from './routes/tts.js'

/**
 * Build the BFF app. Exported so tests can drive the whole pipeline in-process
 * via `app.request(...)` without binding a socket.
 */
export function createApp(): Hono {
  const app = new Hono()

  // Cross-origin access, off unless APP_ALLOWED_ORIGINS names an origin.
  //
  // The container and dev-server deployments put the SPA and this proxy on one
  // origin, so they send no CORS headers and this middleware never engages. A
  // split deployment — the static Pages build at avatar.ci.computer, this proxy
  // self-hosted behind a Cloudflare tunnel — is cross-origin, and the browser
  // discards every /api/* response without them.
  //
  // The env is read per request (not captured once at startup) to match how the
  // rest of the BFF resolves config, so a restart-free env change takes effect
  // and tests can stub it. `credentials` stays false: this BFF authenticates to
  // its upstream with a server-side key and never uses browser cookies, so
  // allowing them — which would also make `*` illegal — buys nothing.
  //
  // The empty-allowlist case returns `next()` without constructing the middleware
  // at all, rather than letting it run and decline each origin. Hono's `cors()`
  // is not inert when it declines: it still sets `Vary: Origin` on every response
  // and still answers OPTIONS with a 204 instead of letting the router 404 it. Both
  // are harmless, but they would be changes to the same-origin container and
  // dev-server deployments, which have no reason to see any of this.
  app.use('/api/*', (c, next) => {
    const { allowedOrigins } = resolveConfig()
    if (allowedOrigins.length === 0) return next()

    return cors({
      origin: (origin) => resolveAllowedOrigin(origin, allowedOrigins),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 86400
    })(c, next)
  })

  app.route('/api', healthRoutes)
  app.route('/api', configRoutes)
  app.route('/api', chatRoutes)
  app.route('/api', ttsRoutes)
  app.route('/api', sttRoutes)
  app.route('/api', talkRoutes)

  // Report unexpected route failures. The two branches below are a line-for-line
  // copy of Hono's own default error handler (`hono/dist/hono-base.js`), down to
  // the duck-typed `'getResponse' in err` check, so installing this changes no
  // response, status or body. The only addition is the capture — a no-op when
  // reporting is off.
  app.onError((err, c) => {
    if ('getResponse' in err) {
      const res = (err as { getResponse: () => Response }).getResponse()
      return c.newResponse(res.body, res)
    }

    // eslint-disable-next-line no-console
    console.error(err)
    captureException(err)

    return c.text('Internal Server Error', 500)
  })

  return app
}

// Start a listener only when executed directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  // No-op unless a DSN is configured: with reporting off no process handler is
  // registered at all, so crash behaviour and exit codes are unchanged.
  installCrashHandlers()

  const cfg = resolveConfig()
  // Off unless APP_TALK_ENABLED=true. When it is on, a missing or malformed talk setting stops startup
  // here, naming the variable, rather than failing the first conversation.
  resolveTalkConfig()
  const app = createApp()
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port: cfg.port })
  console.log(`[proxy] listening on :${cfg.port} → upstream=${cfg.upstream}`)
  // eslint-disable-next-line no-console
  console.log(
    `[proxy] error reporting ${
      isTelemetryEnabled() ? `on (${telemetry.environment})` : `off (${telemetry.disabledReason})`
    }`
  )
}
