# AGENTS.md — CI-Spatial-Companion-WebXR

## Platform context

CI-Spatial-Companion-WebXR is the **Client** layer component of the Companion Intelligence platform — a private, local-first digital memory system.

Full architecture: `CI-Engineering/architecture/architecture.md`

## Repo summary

WebXR spatial companion — immersive XR interface for CI-Server with spatial audio and gesture interaction.

## Stack

- Three.js / WebXR
- TypeScript / JavaScript
- pnpm workspaces (`apps/*`, `packages/*`)

## Setup & commands

```bash
pnpm install         # install
pnpm dev:web         # dev server (web SPA on :5173)
pnpm dev:proxy       # backend proxy / BFF on :8787
pnpm test            # test
pnpm --filter @ci-avatar/web build   # build
```



## Git discipline

- Never `git reset --hard` or `git clean -f` without user confirmation.
- Commit messages: imperative mood, ≤ 72 chars.
- Reference CI-Engineering issues in PRs (e.g. `Closes companionintelligence/CI-Engineering#32`).

## Licence

This repository is public. Its code is licensed under the PolyForm Noncommercial License 1.0.0 ([LICENSE](LICENSE)); the bundled third-party avatars, animations and props keep their own terms ([NOTICE.md](NOTICE.md)).
