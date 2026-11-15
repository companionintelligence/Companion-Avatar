# Deployment and Ollama Tunneling

## Backend proxy (BFF) — the recommended path for container deploys

The app ships a small same-origin backend proxy (`@ci-avatar/proxy`, `apps/proxy`) that
brokers chat to a server-configured upstream (Ollama by default, or any OpenAI-compatible
endpoint / CI-Server). The browser talks only to `/api/chat`, so **no `OLLAMA_ORIGINS` CORS
config or public cloudflared tunnel is needed** for the marketplace container — and API keys
never ship in the browser bundle.

**Local dev:**

```bash
pnpm dev:proxy        # starts the BFF on :8787 (upstream from env, default host Ollama)
pnpm dev:web          # Vite dev server; /api is proxied to :8787 (see vite.config.ts)
```

The proxy reads its upstream from env at runtime: `APP_UPSTREAM` (`ollama` | `openai` |
`ci-server`), `APP_OLLAMA_URL` (default `http://host.docker.internal:11434`), `APP_OLLAMA_MODEL`,
`APP_OPENAI_URL` / `APP_OPENAI_API_KEY` / `APP_OPENAI_MODEL`, `PORT` (8787).

`APP_ALLOWED_ORIGINS` (comma-separated) allows browser origins to call the proxy
**cross-origin**. Leave it unset for the container and dev-server deployments, which are
same-origin and need no CORS headers at all. Set it when the SPA is served from a
different origin than the proxy — the static Cloudflare Pages build at
`https://avatar.ci.computer` talking to a tunnelled proxy. See the Cloudflare Pages
section below.

The desktop and Android apps are allowed without it. Their bundled web app runs at
`tauri://localhost` (desktop on macOS and Linux), `http://tauri.localhost` (desktop on
Windows; `https://tauri.localhost` if Tauri's `useHttpsScheme` is ever turned on) and
`https://localhost` (Android), and the proxy answers those four origins, by exact name,
whatever `APP_ALLOWED_ORIGINS` says. A request from any other origin gets exactly what it got
before: no CORS headers unless `APP_ALLOWED_ORIGINS` lists it. Set
`APP_ALLOW_NATIVE_APPS=false` to refuse the apps too. The iOS app's origin,
`capacitor://localhost`, is not among them; list it in `APP_ALLOWED_ORIGINS` if needed.

CORS decides which web pages may read the proxy's replies; it does not authenticate anyone.
The proxy has no auth or rate limit (`docs/GAP-ANALYSIS.md`), so do not expose it to the
internet as it is.

**Container:** two images — the nginx-served SPA
(`ghcr.io/companionintelligence/ci-spatial-companion-webxr`) and the proxy
(`ghcr.io/companionintelligence/ci-spatial-companion-proxy`). nginx reverse-proxies `/api/` →
`proxy:8787` with buffering off (see `nginx/default.conf`). See `marketplace/` for the
runtipi manifest wiring both.

## Runtime configuration (no rebuild)

The SPA reads `/config.json` at boot, which the nginx entrypoint (`nginx/40-render-config.sh`)
generates from container env on start — so a prebuilt image can be pointed at any Ollama/proxy
URL and model at **install time**:

```bash
docker run --rm -p 8080:5173 \
  -e APP_LLM_PROVIDER=proxy \
  -e APP_OLLAMA_URL=http://host.docker.internal:11434 \
  -e APP_LLM_MODEL=gemma3:1b \
  ghcr.io/companionintelligence/ci-spatial-companion-webxr:latest
```

Users can further override the URL/model in-app via the **Settings (⚙️)** panel; overrides
persist to `localStorage`. Precedence: `localStorage` > runtime `/config.json` > build-time
`VITE_LLM_*` defaults.

The boolean `APP_STT_REMOTE` accepts `1`, `true`, `yes` or `on` (any case, surrounding whitespace
ignored); every other value — including empty and unset — is `false`. Both generators
(`nginx/40-render-config.sh` and `scripts/pages-config.mjs`) normalise it rather than passing it
through, because the SPA's loader treats an unparseable `/config.json` as "no config at all": one
malformed value would silently drop the LLM and TTS settings too, with nothing in the logs.

## Cloudflare Pages — `https://avatar.ci.computer`

The static SPA is served from Cloudflare Pages (project **`avatars`**) at
**<https://avatar.ci.computer>**. The project's own `https://avatars-zbe.pages.dev`
stays live alongside it and is what preview deploys use.

The deploy is Cloudflare's own git integration (the `Cloudflare Pages` check on a commit links
to it): a push to `main` publishes production, every other branch gets a preview.
`.github/workflows/pages-deploy.yml` is `workflow_dispatch`-only, like every workflow in this
repo (`docs/CI.md`), so it runs only when someone dispatches it; when it does, it builds
`apps/web/dist`, deploys it with wrangler and runs `scripts/cloudflare-domain.mjs` to make sure
the hostname is still wired up.

### What "static" means here

This origin serves **files only** — there is no `/api/chat` on `avatar.ci.computer`. The
container deployment gets a same-origin BFF because nginx reverse-proxies `/api/` to the
proxy container; Pages has no such hop. So a Pages deploy needs a backend somewhere else,
and the browser has to be told where. Two things make that work:

1. **`dist/config.json`** — written at build time by `scripts/pages-config.mjs` from
   `APP_*` env, the same variable names the container's nginx entrypoint uses. It sets
   `proxy_url` to the **absolute** URL of your backend. (In the container the equivalent
   file is generated at container start instead; on Pages nothing runs at request time,
   so it has to be baked into the build.)
2. **`APP_ALLOWED_ORIGINS` on the proxy** — the call is now cross-origin, so the proxy
   must return CORS headers for this origin or the browser discards every response. The
   proxy sends none for it by default (only for the desktop and Android apps' own origins),
   which is what keeps the same-origin container deployment unchanged.

### Two deploy paths write to this project — set the build env on both

The Pages project has the **Cloudflare dashboard git integration** connected *and* can be
deployed by `.github/workflows/pages-deploy.yml` when it is dispatched. Both push to the same
project, so whichever finishes last wins. This is visible on any PR: the
`cloudflare-workers-and-pages` bot comments with a branch preview URL that the workflow
never created.

That matters because `dist/config.json` is generated from build env, and **the two paths
read their env from different places**:

| Path | Triggers on | Reads `APP_*` from |
| --- | --- | --- |
| Dashboard git integration | every push, every branch (previews included) | Pages project → Settings → **Environment variables** |
| `pages-deploy.yml` | only when dispatched by hand | GitHub → **repository variables** |

Set the values in **both**, or a deploy from the path you forgot ships without a backend
URL. `config.json` is then simply absent — and because Pages falls back to the SPA for an
unmatched path, requesting it returns `index.html` with HTTP 200 rather than a 404. The
loader guards on the response's content type, so it correctly resolves to `{}` and the app
falls back to build-time defaults; the symptom is a working site with no chat backend, not
an error.

If you would rather have one path, disconnect the dashboard git integration and keep the
workflow (the workflow is the one that also ensures the custom domain; it would need its
push trigger back, `ci-local restore`), or delete the workflow and set everything in the
dashboard. Keeping both is fine as long as their env agrees.

### Serving the backend from your own machine over a tunnel

Run the BFF on your own hardware and expose it with a named Cloudflare tunnel. Unlike the
quick `trycloudflare.com` tunnels below, a named tunnel keeps a stable hostname across
restarts — which matters, because the hostname is baked into the Pages build.

```bash
# 1. Run the proxy, allowing the Pages origin to call it.
APP_UPSTREAM=ollama \
APP_OLLAMA_URL=http://localhost:11434 \
APP_OLLAMA_MODEL=gemma3:1b \
APP_ALLOWED_ORIGINS="https://avatar.ci.computer,https://avatars-zbe.pages.dev" \
  pnpm dev:proxy

# 2. Expose it on a stable hostname (one-time: `cloudflared tunnel create avatar-api`
#    and a DNS route for avatar-api.ci.computer).
cloudflared tunnel run --url http://localhost:8787 avatar-api
```

Then point the Pages build at it with these **repository variables** (Settings → Secrets
and variables → Actions → Variables). They are variables, not secrets: they are written
into `config.json`, which every visitor can read.

| Variable | Value | Why |
| --- | --- | --- |
| `APP_LLM_PROVIDER` | `proxy` | Use the BFF rather than talking to Ollama from the browser. |
| `APP_PROXY_URL` | `https://avatar-api.ci.computer/api/chat` | Absolute — there is no `/api` on the Pages origin. |
| `APP_LLM_MODEL` | `gemma3:1b` | Model label shown and requested. |
| `APP_TTS_MODE` | `browser` | Optional; `browser` needs nothing installed. |
| `APP_STT_REMOTE` | `false` | Optional; `true` routes speech input to the appliance's Whisper. |

Never put an API key in these — `config.json` is public. Keys belong in the proxy's own
environment, which is the reason the proxy exists.

Without them the build still succeeds and the site still loads; it just falls back to the
build-time defaults (the scripted demo persona), and chat has no backend.

### Required GitHub Secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT` (`avatars`)

The deploy step is skipped with a warning, not failed, when these are absent.

### This org's Actions policy blocks third-party actions — don't reintroduce one

The workflow deploys by calling the **wrangler CLI over `npx`**, not with
`cloudflare/pages-action` or `cloudflare/wrangler-action`. That is deliberate. This
organisation's GitHub Actions policy allows only a specific set of actions, and the
Cloudflare ones are not on it:

```
##[error]Unable to resolve actions. Cannot access repositories 'cloudflare/pages-action'.
```

A blocked action fails the job at *"Prepare all required actions"*, **before any step
runs** — so the run dies in about seven seconds, no `if:` condition can guard it, and the
log shows no step output to explain why. That is what made this workflow fail on ~90
consecutive pushes to `main`, and it is why no Pages deploy ever reached
`avatars-zbe.pages.dev` from CI. (The failures were previously attributed to the missing
Cloudflare secrets, and a skip-when-absent check was added for them. That check is
genuinely useful, but it never ran and could not have been the cause.)

`actions/*` and `pnpm/action-setup` are allowed — `test.yml` uses the latter and passes,
which is why the setup steps here mirror it. If you add a step that needs a new
third-party action, expect it to be blocked the same way; either get it allowlisted, or do
what the deploy step does and call the tool's CLI directly.

### Provisioning the custom domain

`scripts/cloudflare-domain.mjs` ensures both halves of the wiring — the custom domain on
the Pages project, and a proxied `CNAME` in the `ci.computer` zone pointing at the
project's `*.pages.dev`. It is idempotent: run it as often as you like, and when
everything already matches it changes nothing.

```bash
# See what it would do first.
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  node scripts/cloudflare-domain.mjs --project avatars --domain avatar.ci.computer --dry-run

# Then do it.
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  node scripts/cloudflare-domain.mjs --project avatars --domain avatar.ci.computer
```

The token needs:

| Scope | Permission | Used for |
| --- | --- | --- |
| Account | Cloudflare Pages → Edit | read the project, attach the custom domain |
| Zone | DNS → Edit | create or repoint the `CNAME` |
| Zone | Zone → Read | resolve `ci.computer` to its zone id |

The deploy workflow runs the same script with `continue-on-error`, so a token holding only
the Pages scope still deploys green — the step's log names what it could not do.

### Adding another agent hostname

The `*.ci.computer` scheme is per agent. To add one, deploy that app to its own Pages
project and run the same script against it — the script derives the zone from the
hostname, so nothing else changes:

```bash
node scripts/cloudflare-domain.mjs --project <its-pages-project> --domain <agent>.ci.computer
```

### Files that shape the Pages response

`apps/web/public/_headers` is copied verbatim into the deploy; every other target ignores
it. It sets:

- `Permissions-Policy` granting `xr-spatial-tracking` — a headset refuses `immersive-vr`
  without it, and Cloudflare's default policy does not include it.
- immutable caching for `/assets/*`, which is content-addressed and ~240 MB of media.
- `no-store` for `/config.json`, so a returning visitor is not pinned to an old backend URL.
- `no-cache` for `/sw.js` (the service worker, see below), so an intermediary cannot hold a stale one.

**There is deliberately no `_redirects` file.** Pages already routes an unmatched path to
the SPA by itself, because the build ships no top-level `404.html`. Adding the usual
`/* /index.html 200` SPA rule would actively break the site: Pages applies `_redirects`
*"regardless of whether or not an asset matches the incoming request"*, so a catch-all
rewrite serves `index.html` in place of every hashed JS chunk and every avatar file.

Both halves of that are confirmed against a live branch preview, not just the docs:

```
$ curl -sI <preview>/some/deep/client/route
HTTP/2 200 ; content-type: text/html        # SPA fallback works with no _redirects

$ curl -sI <preview>/assets/index-DuAor7ps.js
HTTP/2 200 ; content-type: application/javascript
cache-control: public, max-age=31536000, immutable   # asset served, not shadowed

$ curl -sI <preview>/                       # _headers applied
permissions-policy: xr-spatial-tracking=(self), camera=(self), ...
```

### Installing it as an app (PWA)

`avatar.ci.computer` can be installed from the browser, with no store review. The files below make it
installable: a web manifest (`display: standalone`, 192, 512 and maskable icons), the head tags that point at it,
and a service worker. The container serves the same files, and `nginx/default.conf` revalidates `/sw.js` and
serves the manifest as `application/manifest+json`, which stock nginx has no type for.

| File | What it is |
| --- | --- |
| `apps/web/public/manifest.webmanifest` | Name, `display: standalone`, the canon dark `#041620` for theme and background, 192 and 512 icons plus a maskable one |
| `apps/web/public/icons/` | The visionOS app icon set from `apps/vision-pro/public/icons`: 192 and 512 copied as they are, the 512 maskable and the 180 apple-touch-icon are `sips -z` resizes of `icon1024maskable.png` and `icon512.png` |
| `apps/web/public/sw.js` | The service worker. Its cache is named after a fingerprint of the files it precaches (below) |
| `apps/web/public/offline/` | The page the worker shows when a page load cannot reach the network |
| `apps/web/src/lib/registerServiceWorker.ts` | Registers the worker from the bundle, in production builds only. It catches its own errors, so the registration can no longer be what stops the app from starting |
| `scripts/check-pwa.mjs` | The build check. `vite build` runs it (`apps/web/vite.config.ts`), so the pnpm build, the Pages build and the container build all do |
| `docs/service-worker-kill-switch.js` | The worker that retires the worker (below) |

The worker is deliberately tiny. It caches three files (the offline page, its stylesheet and the mark) at
install and never writes to a cache again. A page load goes to the network, and only a failed one gets the
offline page. Every other request, including `/assets/*`, `/config.json`, the proxy and anything cross-origin,
is left to the browser: first paint is ~2.2 MB of script and style, `/assets/` carries ~240 MB of avatars,
animations and props, and the app is no use without them or the backend `config.json` names, so a cached shell
would open to a scene with nothing in it and could strand visitors on an old build. Do not add a runtime cache
without a size budget and an eviction policy.

The cache name is `ci-avatar-offline-` plus 12 hex digits: the start of a sha256 over each precached URL and the
bytes of the file behind it, with every CR removed so that a CRLF checkout (git on Windows with
`core.autocrlf=true`, an editor that saves CRLF) gets the same name as CI. A browser fetches the precache again
only when `sw.js` itself changes, so an edit to `offline/index.html`, `offline.css` or `mark.svg` that left the name
alone would never reach a returning visitor. `vite build` fails when the name is out of date, on every build path
(`scripts/check-pwa.mjs`; the container image builds with `deno task --cwd apps/web build`, which does not run
pnpm's build hooks), and so does `pnpm test`; both say which name to paste into `sw.js`. The same check requires
every precached file to be under `/offline/`, the built `dist/sw.js` to match the built files, and the bundle to
register `/sw.js`. To work it out by hand, from `apps/web/public` (the digits are the end of `CACHE` in `sw.js`):

```bash
{
  for pair in /offline/:offline/index.html /offline/offline.css:offline/offline.css /offline/mark.svg:offline/mark.svg; do
    printf '%s\0' "${pair%%:*}"; tr -d '\r' < "${pair#*:}"; printf '\0'
  done
} | shasum -a 256 | cut -c1-12
```

The loop names the three precached files, so change it together with `PRECACHE` in `sw.js`.
Where `shasum` is missing (most Linux images), use `sha256sum` in its place.

To check installability after a change, serve a production build and ask Chrome (`Page.getInstallabilityErrors`
over CDP, in a profile that is not incognito): `pnpm --filter @ci-avatar/web build`, then
`pnpm --filter @ci-avatar/web preview`, and load the page in headless Chrome at a 412x915 viewport. An empty list
and an `activated` worker is the pass.

To retire it, in one change:

1. Copy `docs/service-worker-kill-switch.js` over `apps/web/public/sw.js`. It has no fetch handler; on activation
   it deletes every `ci-avatar-offline-*` cache and unregisters itself.
2. Delete the `registerServiceWorker()` call and its import from `apps/web/src/main.tsx`.
3. Deploy, and leave it deployed for weeks: a browser picks the new `sw.js` up when a page loads.

Reverting the commit that added the worker is not enough. With `/sw.js` gone, the browser's update check gets a
404, fails, and the old worker stays installed and keeps answering page loads. Nothing else has to change: the kill
switch's first line, `// avatar:service-worker-kill-switch`, is how `scripts/check-pwa.mjs` and the unit tests
recognise it, and with it as `sw.js` they stop requiring the offline page, the precache list, the cache
fingerprint and the registration in the bundle. The unit tests still check the manifest, the head tags and the
`no-cache` rule for `/sw.js`. Until the worker is retired, an old copy of it only serves its offline page.

#### After a deploy

The `_headers` rule that keeps `/sw.js` out of shared caches shows on the `*.pages.dev` host
(`no-cache`), not on `avatar.ci.computer`. Production differs from the preview in two ways the
preview cannot show: the `ci.computer` zone has a 4 h browser cache time that works as a floor
on what Cloudflare caches, so `/sw.js` and `/vite.svg` come out as `max-age=14400` where the
preview serves `no-cache` and `max-age=0` (measured 2026-10-30; `/config.json`, which is
`no-store`, `/assets/*`, which is a year, and the HTML and the manifest, which Cloudflare does
not cache, come through as sent; the zone setting itself was not read), and the edge adds a
script of about 1.1 kB before `</body>` to the HTML it serves on `avatar.ci.computer`, which
`*.pages.dev` does not. So the `/offline/` copy a production worker caches can contain that
script (the page does not depend on it), and the new icons, `offline.css` and `mark.svg` can be
held by the browser's HTTP cache for up to 4 h (the install fetches them with
`cache: 'reload'`). The 4 h on `sw.js` itself holds nothing back: the registration has the
default `updateViaCache: 'imports'` (Chrome reported it), so a browser skips the HTTP cache
when it checks `sw.js` for changes, whatever its `max-age`. Chrome 156 installed a changed
`sw.js` about 2 s after the check with `max-age=14400` and with `no-cache` alike; only
`updateViaCache: 'all'` held it back, and `registerServiceWorker.node.test.ts` asserts the exact
registration options, so adding it would fail a test. After a production deploy, check:

```bash
curl -sI https://avatar.ci.computer/sw.js      # 200, a JavaScript content type, cache-control: max-age=14400
curl -sI https://avatars-zbe.pages.dev/sw.js   # 200, a JavaScript content type, cache-control: no-cache
curl -sI https://avatar.ci.computer/offline/   # 200
curl -sI https://avatar.ci.computer/offline    # 308, location: /offline/
```

then run the installability check above against `https://avatar.ci.computer/` (empty list,
`activated` worker). The same requests work against a preview URL, where `/sw.js` shows
`no-cache`.

Making production send `no-cache` too would be a change in the Cloudflare dashboard, not in
this repo: a Cache Rule for `avatar.ci.computer/sw.js` whose Browser TTL is "Respect origin".
That is the owner's to add if it is wanted. No such rule exists today, and nothing here
depends on it.

## Local Ollama Over The Web (Quest 3 / iPad / XREAL)

### 1) Run Ollama and allow browser origins
```bash
OLLAMA_ORIGINS="https://avatar.ci.computer" ollama serve
```

If you also use a Cloudflare tunnel, include the tunnel URL:
```bash
OLLAMA_ORIGINS="https://avatar.ci.computer,https://your-tunnel.trycloudflare.com" ollama serve
```

### 2) Create a public tunnel to your local Ollama
```bash
cloudflared tunnel --url http://localhost:11434 --http-host-header="localhost:11434"
```

You will get a URL like:
`https://your-tunnel.trycloudflare.com`

### 3) Point the app to the tunnel URL
Set this in the app you are running:

`apps/web/.env.local`
```env
VITE_LLM_PROVIDER=ollama
VITE_LLM_OLLAMA_API_URL=https://your-tunnel.trycloudflare.com
VITE_LLM_OLLAMA_MODEL=gemma3:1b
```

`apps/vision-pro/.env.local`
```env
VITE_LLM_PROVIDER=ollama
VITE_LLM_OLLAMA_API_URL=https://your-tunnel.trycloudflare.com
VITE_LLM_OLLAMA_MODEL=gemma3:1b
```

### Optional convenience scripts
From the repo root:

```bash
pnpm ollama:serve
pnpm ollama:tunnel
```

You can override defaults:
```bash
OLLAMA_ORIGINS="https://avatar.ci.computer,https://your-tunnel.trycloudflare.com" pnpm ollama:serve
OLLAMA_HOST_URL="http://localhost:11434" pnpm ollama:tunnel
```

## Notes
- `cloudflared` must be installed and authenticated.
- Use HTTPS for WebXR on headsets.
