# CLAUDE.md — CI-Spatial-Companion-WebXR

> Public repository: [companionintelligence/Companion-Avatar](https://github.com/companionintelligence/Companion-Avatar), licensed under the PolyForm Noncommercial License 1.0.0.

## Platform role

**CI-Spatial-Companion-WebXR** sits in the **Client** layer of the Companion Intelligence platform.

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`
Issues: <https://github.com/companionintelligence/CI-Engineering/issues>

## What this repo does

WebXR spatial companion — immersive XR interface for CI-Server with spatial audio and gesture interaction.

## Stack

- Three.js / WebXR / React Three Fiber
- TypeScript / JavaScript
- pnpm workspaces (`apps/*`, `packages/*`)

## Key commands

```bash
# Install dependencies
pnpm install

# Start development server (web SPA on :5173)
pnpm dev:web

# Start the backend proxy / BFF on :8787 (Vite proxies /api to it)
pnpm dev:proxy

# Lint, unit/component tests, production build
pnpm lint
pnpm test
pnpm --filter @ci-avatar/web build

# Every Storybook story as a test in headless Chromium, axe at error (TESTING.md)
pnpm test:stories
```

`pnpm test` runs Vitest across six projects (see `vitest.config.ts`); Playwright e2e is
separate (`pnpm test:e2e`). `predev`/`prebuild` run `scripts/pack-assets.mjs`, which packs
the shared media from `/assets` into `apps/*/public` — those copies are gitignored.

## Package manager

**pnpm** (pinned by `package.json#packageManager`) — use exclusively; do not mix with
npm/yarn/bun. `pnpm-workspace.yaml` defines the workspace, and `pnpm-lock.yaml` is the
committed lockfile.

## Claude Code on the web

`.claude/hooks/session-start.sh` is a SessionStart hook that prepares a cloud container:
it installs workspace dependencies and packs the shared assets, so `pnpm lint`, `pnpm test`
and the web build work from the first turn. It is a no-op outside a remote session
(`CLAUDE_CODE_REMOTE`). Chromium is preinstalled in the cloud image, so the hook tells
Playwright not to re-download browsers.

## Deployment

- **Static SPA** → Cloudflare Pages, project `avatars`, at <https://avatar.ci.computer>.
  That origin serves files only: there is no `/api` on it, so the browser is pointed at a
  backend by `dist/config.json` (written at build time by `scripts/pages-config.mjs`), and
  the backend must allow the origin via `APP_ALLOWED_ORIGINS`.
- **Container** → two GHCR images (nginx-served SPA + proxy); nginx reverse-proxies
  `/api/` so that path is same-origin and needs no CORS.

Full runbook, including the idempotent `scripts/cloudflare-domain.mjs` that provisions the
custom domain and DNS: `docs/DEPLOYMENT.md`.

## Cross-repo connections

- Connects to CI-Server for memory data and LLM chat



## Multi-agent safety

Multiple AI agents work these repos in parallel. Never use `git reset --hard`, `git clean -f`, or any destructive git command without explicit confirmation from the user.

## Licence

This repository is public. Its code is licensed under the PolyForm Noncommercial License 1.0.0 ([LICENSE](LICENSE)); the bundled third-party avatars, animations and props keep their own terms ([NOTICE.md](NOTICE.md)).
