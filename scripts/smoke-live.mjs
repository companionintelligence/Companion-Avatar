/**
 * smoke-live.mjs — load a deployed copy of the web app in headless Chromium, and fail when it does not mount or
 * when it asks any origin but its own for anything.
 *
 * On 2026-11-24 avatar.ci.computer went blank because the scene took its studio light from raw.githack.com and
 * that host failed (see packages/core/src/components/scene/environment/StudioEnvironment.tsx). The app now serves
 * its own light and its own local engines; this checks that a deploy does too, from a real browser against the
 * real host. The page must mount (a canvas in #root), still be mounted once the network has settled, and every
 * request it made, its workers' included, must have gone to the page's own origin.
 *
 * Usage:
 *   node scripts/smoke-live.mjs [url] [--allow <origin>]... [--settle <ms>] [--timeout <ms>]
 *   pnpm smoke:live https://<branch>.avatars-zbe.pages.dev
 *
 *   url        The page to load. Default: $SMOKE_URL, else https://avatar.ci.computer.
 *   --allow    An origin the page may also contact, for a feature someone has to opt into: for example
 *              https://*.arweave.net for the CC0 avatars (arweave.net sends each file on to a subdomain of its
 *              own). Repeatable; $SMOKE_ALLOW takes a comma-separated list. Empty by default, because a page
 *              load nobody has touched contacts no one else.
 *   --settle   Once the app has mounted, keep watching until no request has started for this long, in ms
 *              (default 5000). The avatar, its animations and the studio light are asked for after the first
 *              paint. It waits for requests to stop starting, not to finish: a long download, or a response the
 *              app never reads (the live site's /config.json is one), would otherwise hold it to --timeout.
 *   --timeout  How long the page has to mount, and then to stop starting requests, in ms (default 60000).
 *
 * Exit status: 0 when the app mounted, stayed mounted and asked no other origin for anything; 1 when it did not;
 * 2 when the check could not run (a bad argument, no browser, a page that would not load).
 *
 * It only reads: it loads the page once, as a visitor would, and presses nothing. Requests to other origins are
 * let through and recorded, not blocked, so the page behaves as it does for everyone. It needs Playwright's
 * Chromium (pnpm exec playwright install chromium). .github/workflows/smoke-live.yml runs it on demand.
 */
import { pathToFileURL } from 'node:url'

export const DEFAULT_URL = 'https://avatar.ci.computer'
export const DEFAULT_SETTLE_MS = 5_000
export const DEFAULT_TIMEOUT_MS = 60_000
/** What a mounted app has: React rendered into #root, and the scene's canvas is in it. */
export const MOUNTED_SELECTOR = '#root canvas'

const SCHEMES = { 'http:': 'http:', 'https:': 'https:', 'ws:': 'http:', 'wss:': 'https:' }

/**
 * The origin a request reaches, with ws: and wss: counted as http: and https: (a socket to the page's own host is
 * the page's own), or null for a URL that reaches no server: data:, blob:, about:, a browser's own pages.
 */
export function originOf(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const scheme = SCHEMES[parsed.protocol]
  return scheme ? `${scheme}//${parsed.host}` : null
}

/**
 * One allowlist entry as a matcher: an origin (https://example.com), or one whose host starts with `*.`
 * (https://*.example.com), which takes that host and every host under it. Throws on anything else.
 */
export function allowRule(entry) {
  const text = String(entry).trim()
  const host = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*'
  const wildcard = new RegExp(`^(https?)://\\*\\.(${host})(:\\d+)?/?$`, 'i').exec(text)
  if (wildcard) {
    const base = originOf(`${wildcard[1]}://${wildcard[2]}${wildcard[3] ?? ''}`)
    const scheme = base.slice(0, base.indexOf('//') + 2)
    const suffix = `.${base.slice(scheme.length)}`
    return { entry: text, matches: (o) => o === base || (o.startsWith(scheme) && o.endsWith(suffix)) }
  }
  const origin = new RegExp(`^https?://(?:${host}|\\[[0-9a-f:.]+\\])(?::\\d+)?/?$`, 'i').test(text) ? originOf(text) : null
  if (!origin) throw new Error(`--allow takes an origin such as https://example.com or https://*.example.com, not "${text}"`)
  return { entry: text, matches: (o) => o === origin }
}

/**
 * Sort what the page asked for. `own` is the page's origins (the one asked for and, after a redirect, the one it
 * landed on), `allow` the parsed allowlist. Returns the requests to other origins, split by the allowlist.
 */
export function sortRequests(requests, own, allow = []) {
  const ownOrigins = new Set(own.map(originOf).filter(Boolean))
  const thirdParty = []
  const allowed = []
  let sameOrigin = 0
  for (const request of requests) {
    const origin = originOf(request.url)
    if (!origin) continue
    if (ownOrigins.has(origin)) sameOrigin += 1
    else if (allow.some((rule) => rule.matches(origin))) allowed.push({ ...request, origin })
    else thirdParty.push({ ...request, origin })
  }
  return { sameOrigin, allowed, thirdParty }
}

/** The command line and environment, read into options. Throws on a bad argument. */
export function parseArgs(argv, env = {}) {
  const options = {
    url: env.SMOKE_URL?.trim() || DEFAULT_URL,
    allow: (env.SMOKE_ALLOW ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    settle: DEFAULT_SETTLE_MS,
    timeout: DEFAULT_TIMEOUT_MS
  }
  const number = (flag, value) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} takes a number of milliseconds, not "${value}"`)
    return n
  }
  let urlGiven = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`)
      return argv[++i]
    }
    if (arg === '--allow') options.allow.push(value())
    else if (arg === '--settle') options.settle = number(arg, value())
    else if (arg === '--timeout') options.timeout = number(arg, value())
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else if (urlGiven) throw new Error(`one URL at a time, not also ${arg}`)
    else {
      options.url = arg
      urlGiven = true
    }
  }
  if (!/^https?:\/\//i.test(options.url)) throw new Error(`the URL must start with http:// or https://, not "${options.url}"`)
  options.rules = options.allow.map(allowRule)
  return options
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/** Load the page and report. Returns the exit status. */
export async function run(options, log = console.log) {
  const { chromium } = await import('playwright')
  // Software GL, as the render suites use (playwright.config.ts): a runner has no GPU, and a scene with no WebGL
  // context would fail here for a reason that has nothing to do with the deploy.
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const requests = []
  const notes = []
  let lastRequestAt = Date.now()
  const record = (request) => {
    requests.push(request)
    lastRequestAt = Date.now()
  }
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    // Requests from the page's dedicated workers come through the page too, in Chromium.
    page.on('request', (request) => record({ method: request.method(), url: request.url(), type: request.resourceType() }))
    page.on('websocket', (socket) => record({ method: 'WS', url: socket.url(), type: 'websocket' }))
    page.on('pageerror', (error) => notes.push(`page error: ${error.message.split('\n')[0]}`))
    page.on('requestfailed', (request) => {
      notes.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'no reason given'})`)
    })

    log(`smoke-live: ${options.url}`)
    const started = Date.now()
    try {
      await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: options.timeout })
    } catch (error) {
      log(`  could not load the page: ${error.message.split('\n')[0]}`)
      return 2
    }
    const own = [options.url, page.url()]

    let mounted = true
    try {
      await page.waitForSelector(MOUNTED_SELECTOR, { state: 'attached', timeout: options.timeout })
      log(`  mounted after ${seconds(Date.now() - started)} (${MOUNTED_SELECTOR})`)
    } catch {
      mounted = false
      log(`  FAIL: the app did not mount within ${seconds(options.timeout)}: no ${MOUNTED_SELECTOR}`)
    }
    if (mounted) {
      // The avatar, its animations and the studio light are asked for after the first paint: watch until no
      // request has started for --settle, then look again. A scene that throws once its files arrive takes the
      // page down after it mounted, which is what happened on 2026-11-24.
      const watchUntil = Date.now() + options.timeout
      while (Date.now() - lastRequestAt < options.settle) {
        if (Date.now() > watchUntil) {
          notes.push(`requests were still starting ${seconds(options.timeout)} after the app mounted`)
          break
        }
        await page.waitForTimeout(250)
      }
      if (await page.$(MOUNTED_SELECTOR)) log(`  still mounted after ${seconds(Date.now() - started)}`)
      else {
        mounted = false
        log(`  FAIL: the app unmounted after ${seconds(Date.now() - started)}: ${MOUNTED_SELECTOR} is gone`)
      }
    }

    const { sameOrigin, allowed, thirdParty } = sortRequests(requests, own, options.rules)
    const ownOrigins = [...new Set(own.map(originOf))].join(' and ')
    log(`  ${requests.length} requests: ${sameOrigin} to ${ownOrigins}, ${allowed.length} allowed, ${thirdParty.length} to other origins`)
    for (const request of allowed) log(`    allowed: ${request.method} ${request.url} (${request.type})`)
    for (const request of thirdParty) log(`    ${request.method} ${request.url} (${request.type})`)
    for (const note of notes) log(`  note: ${note}`)

    if (thirdParty.length) {
      const origins = [...new Set(thirdParty.map((r) => r.origin))]
      log(`  FAIL: the page asked ${origins.length === 1 ? 'another origin' : `${origins.length} other origins`} for something: ${origins.join(', ')}`)
    }
    if (!mounted || thirdParty.length) return 1
    log(`  OK: mounted, stayed mounted, and asked no origin but ${ownOrigins}${allowed.length ? ' (and the allowed ones)' : ''} for anything`)
    return 0
  } finally {
    await browser.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let options
  try {
    options = parseArgs(process.argv.slice(2), process.env)
  } catch (error) {
    console.error(`smoke-live: ${error.message}`)
    process.exit(2)
  }
  run(options).then(
    (status) => process.exit(status),
    (error) => {
      console.error(`smoke-live: could not run the check: ${error.message}`)
      process.exit(2)
    }
  )
}
