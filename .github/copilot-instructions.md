# GitHub Copilot Instructions — CI-Spatial-Companion-WebXR

You are working in **CI-Spatial-Companion-WebXR**, the **Client** component of the **Companion Intelligence** platform — a private, local-first digital memory and AI appliance system owned by Lifescope Inc.

## Platform architecture

```
Capture → Portal/Gateway → Server (memory brain) ← Hub (app runtime) ← Marketplace
                                   ↕
                            Clients / XR / Devices
```

Full architecture and ADRs live in `CI-Engineering/architecture/`.

## This repo

WebXR spatial companion — immersive XR interface for CI-Server with spatial audio and gesture interaction.

## Tech stack

- Three.js / WebXR
- TypeScript / JavaScript
- pnpm workspaces (`apps/*`, `packages/*`)

## Development

```bash
pnpm install         # install
pnpm dev:web         # dev server (web SPA on :5173)
pnpm lint            # lint
pnpm test            # test
pnpm --filter @ci-avatar/web build   # build
```



## Conventions

- Use pnpm (pinned by `package.json#packageManager`); do not mix it with npm, yarn or bun.
- Keep PRs small and linked to CI-Engineering issues.
- Multiple agents may work this codebase simultaneously — never use destructive git operations.
- All code is **private and confidential** — do not surface or transmit source beyond this session.
