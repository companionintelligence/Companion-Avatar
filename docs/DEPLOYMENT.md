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

## Cloudflare Pages

Production URL:
`https://avatars-zbe.pages.dev`

The GitHub Actions workflow deploys `apps/web/dist` on pushes to `main`.

Required GitHub Secrets:
- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

These are the names CI-Spatial-Web uses; both repos deploy through the same
action, so the org keeps one convention. The Pages project name is **not** a
secret — it is `avatars`, declared in `wrangler.toml` and inlined in the
workflow. (Before 2026-08-10 the workflow read `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT`; none of the three was
ever set, which is why every deploy since 2026-03-15 failed.)

Neither credential is set on this repo today, so `pages-deploy.yml` skips its
deploy job neutrally and reports green without publishing. To actually publish,
someone with admin on the repo must run:

```bash
gh secret set CF_API_TOKEN  -R companionintelligence/CI-Spatial-Companion-WebXR
gh secret set CF_ACCOUNT_ID -R companionintelligence/CI-Spatial-Companion-WebXR
```

## Local Ollama Over The Web (Quest 3 / iPad / XREAL)

### 1) Run Ollama and allow browser origins
```bash
OLLAMA_ORIGINS="https://avatars-zbe.pages.dev" ollama serve
```

If you also use a Cloudflare tunnel, include the tunnel URL:
```bash
OLLAMA_ORIGINS="https://avatars-zbe.pages.dev,https://your-tunnel.trycloudflare.com" ollama serve
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
OLLAMA_ORIGINS="https://avatars-zbe.pages.dev,https://your-tunnel.trycloudflare.com" pnpm ollama:serve
OLLAMA_HOST_URL="http://localhost:11434" pnpm ollama:tunnel
```

## Notes
- `cloudflared` must be installed and authenticated.
- Use HTTPS for WebXR on headsets.
