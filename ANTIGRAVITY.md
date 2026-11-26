# ANTIGRAVITY.md — CI-Spatial-Companion-WebXR

## Context

**CI-Spatial-Companion-WebXR** — **Client** layer of the Companion Intelligence platform (Lifescope Inc).

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`

## Purpose

WebXR spatial companion — immersive XR interface for CI-Server with spatial audio and gesture interaction.

## Stack

- Three.js / WebXR
- TypeScript / JavaScript
- pnpm workspaces (`apps/*`, `packages/*`)

## Commands

```bash
pnpm install
pnpm dev:web
pnpm test
pnpm test:stories
pnpm check:stories
pnpm --filter @ci-avatar/web build
```

## Rules

- Package manager: **pnpm** (pinned by `package.json#packageManager`) — do not switch or mix with npm/yarn/bun.
- Destructive git operations (`reset --hard`, `clean -f`) require explicit user confirmation.
- Commits reference CI-Engineering issues.
- The repository is public, under the PolyForm Noncommercial License 1.0.0 (`LICENSE`); third-party avatars, animations and props keep their own terms (`NOTICE.md`).
