# Testing Pipeline — Embodied Companion (CI-Spatial-Companion-WebXR)

This pipeline is derived from the product's own description of what an Embodied Agent
_is_: a 3D avatar with **two puppetry systems — one for the face, one for the body —**
that talks (STT/TTS + lip-sync), emotes, and renders across web + spatial (WebGL/WebGPU,
WebSpatial for visionOS / Android XR / Horizon OS), for **hospitality, retail, and
education** deployments.

We test that promise on two axes:

- **Pillars** — the capabilities every deployment shares.
- **Verticals** — the three use cases the product leads with, exercised end-to-end.

…across **five layers**, cheapest/fastest first:

| Layer | Tool | Runs in | What it proves | Speed |
|------|------|--------|----------------|-------|
| **L1 Logic** | Vitest | node/jsdom | pure state machines & mappings are correct | ms |
| **L2 Component** | Storybook + play + axe | headless Chromium (Vitest browser mode) | UI renders, is interactive & accessible | s |
| **L3 Visual** | Capture harness → **WebP** | headless Chromium + WebGL | the rig actually _moves_ (anim/viseme/emote/blend) | ~15 s/clip |
| **L4 Scenario (E2E)** | Playwright | real app | a vertical works door-to-door | ~1 min |
| **L5 Render matrix** | Playwright | real app | every avatar loads on every renderer | ~1 min |

---

## Pillars

### P1 — Body system (animation)
`services/animation/*` — a pure state machine over `THREE.AnimationMixer` with native
`crossFadeTo` blending, a one-shot→idle queue, personality cycling, and a
skeleton-aware catalog (`GLB_CLIPS` for RPM/Mixamo/HumGen, `VRMA_CLIPS` for VRM).

- **L1**: transition gating (`isTransitioning`), `finished`-event queue advance,
  loop/clamp config, `pickLoadedClipByCategory`, personality filtering.
- **L3**: `*-idle`, `*-gesture`, `*-action`, and an **idle→gesture→idle blend** clip
  per skeleton family (GLB + VRM via VRMA).

### P2 — Face system A: visemes / lip-sync
`services/visemes/*` — `WhisperData → visemesSequence → visemesUpdate → visemesToRig`,
mapping phonemes to 14 Oculus visemes (GLB `viseme_*` morphs) or 5 VRM mouth
expressions (`aa/ee/ih/oh/ou`, auto-migrated from VRM0 `a/i/u/e/o`).

- **L1**: `lipsyncEn` grapheme→viseme mapping, sequence timing/ordering, GLB↔VRM
  target conversion (`convertToVRMTarget`).
- **L3**: `*-lipsync` face clips on GLB (Greg), VRM (Erik), and HumGen (Aria) — the
  three rig contracts that must all drive a mouth.

### P3 — Face system B: emotes / mood
`services/emote/*` — emotion → facial morph targets (ARKit-ish) + head/gaze, with
blinking, facial ticks, and barge-in relax.

- **L1**: `applyEmotion` target math, mood configs, barge-in handling, blink/tick timers.
- **L3**: `*-emote-{happy,sad,angry}` face clips.

### P4 — Avatars (GLB · VRM · HumGen pipeline)
24 catalog avatars across three loaders. The rig contract: RPM/ARKit/viseme morphs
(GLB) or humanoid + expression manager (VRM).

- **L1**: `pack-assets` gate (every `AvatarOptions` entry resolves to a packaged file).
- **L5**: every avatar loads without error and reports its expected morph/bone set.

### P5 — Conversation (chat → response → embodiment)
`useAgent` + `integration/*` — a chat turn drives text emotion detection →
`reactionIntegration` gesture category + `emotionIntegration` emote + TTS lip-sync,
skeleton-agnostically.

- **L1**: `detectEmotionFromText`, `EMOTION_TO_CATEGORY` mapping, `shouldTriggerBargeIn`.
- **L2**: `ChatPanel` / `ChatInput` / `ChatBubble` render + submit.
- **L4**: chat message → visible response + lip-sync + gesture (per vertical).

### P6 — Rendering & XR (WebGL / WebGPU / WebSpatial)
- **L2**: `useHasWebGPU` capability detection, `GraphicsFallback`.
- **L5**: render matrix runs the avatar under WebGL and (where available) WebGPU
  (`MToonNodeMaterial` path), plus the vision-pro (WebSpatial) build smoke.

---

## Verticals (L4 scenario specs)

Each is a Playwright spec driving the **real app** in offline `directed-responses`
mode (deterministic replies), asserting: avatar loads → user turn → visible reply →
lip-sync activity → a gesture/emote fires.

| Vertical | Scenario | Key assertions |
|---|---|---|
| **Hospitality** | greeter/wayfinding: "Where's the conference room?" | greet gesture on load; reply bubble; pointing/gesture; lip-sync frames differ |
| **Retail** | product assistant: "Tell me about this jacket." | idle→gesture on answer; emote (happy) on positive; response contains product text |
| **Education** | tutor turn-taking: a short Q&A with think/nod beats | multiple turns; expression changes between turns; barge-in stops mid-utterance |

---

## Layer L3 — the WebP visual harness (how it works)

The keystone. Most rig bugs (frozen avatar, missing morphs, blend that snaps, a viseme
that never fires) are invisible to unit tests and only show up as _motion_. L3 makes
motion a reviewable artifact.

```
apps/web/harness.html  ─ dedicated capture page (no chat/control UI)
apps/web/src/harness/AvatarHarness.tsx
    └─ window.__harness = { selectAvatar, playAnimation, playCategory,
                            setEmote, speak, speechInfo, audioMetrics,
                            faceSnapshot, setShot }             # reuses the REAL services
e2e/capture/gen-webp.mjs  ─ Playwright drives __harness, screenshots frames,
                            img2webp encodes → docs/visual-tests/*.webp + manifest.json
```

Run it:

```bash
PORT=5199 pnpm --filter @ci-avatar/web dev &         # serves /harness.html
BASE=http://localhost:5199 node e2e/capture/gen-webp.mjs   # writes docs/visual-tests/
# open docs/visual-tests/index.html to review the gallery
```

Because the harness mounts the same `AvatarModel` + viseme/emote/animation/TTS path the
app ships, a clip is a faithful record of production behavior — not a mock. Speech uses
deterministic decoded PCM with zero output volume, so the browser still exercises the
real analyser and lip-sync path without requiring a network voice server. Add a row to
`MATRIX` to cover a new avatar/behavior; captions + sizes land in `manifest.json`.

For a render-level speech proof, run the focused Playwright gate:

```bash
CAPTURE_PORT=5200 CAPTURE_BASE_URL=http://127.0.0.1:5200 \
  pnpm exec playwright test -c playwright.config.capture.ts \
  tests/avatar-visual-matrix.spec.ts --grep 'Avatar \\[Greg\\]|Avatar \\[Erik\\]'
```

The gate waits until the rendered scene reports both analyser energy and a non-zero
mouth target (`jawOpen` for GLB, `aa/ee/ih/oh/ou` for VRM). A queued utterance alone is
not considered a passing lip-sync result.

> **Regression use:** commit a curated hero set; regenerate on demand. For pixel-diff
> gating later, freeze fps/seed and diff against a committed baseline (out of scope v1;
> the harness is deterministic enough to add it).

---

## What to run when

| Trigger | Layers |
|---|---|
| Every commit (pre-push / CI `test.yml`) | **L1 + L2** (`pnpm test`, `build-storybook`) |
| Touching a rig/service/avatar | **+ L3** curated clips for the affected pillar |
| Adding/re-rigging an avatar | **+ L5** render matrix + L3 `*-lipsync`/`*-gesture` |
| Release candidate | **all five**, incl. L4 verticals + vision-pro build smoke |

## Status (v1 of this pipeline)

- **L1** — 81 tests green; expanding viseme/emote/blend/integration coverage.
- **L2** — every story runs as a test, with axe at `error` (`pnpm test:stories`, see
  TESTING.md). CI still only builds Storybook.
- **L3** — harness + `gen-webp.mjs` live; hero set in `docs/visual-tests/`; the
  production decoded-audio path is covered by `speechInfo`/`audioMetrics`/`faceSnapshot`.
- **L4** — hospitality/retail/education specs live (`tests/scenarios/*.spec.ts`, run via
  `playwright.config.capture.ts`): each boots the real app in offline `script` mode and
  asserts avatar boot → user turn → visible reply bubble → multi-turn/barge-in. Strict
  embodiment (specific gesture, lip-sync frames, expression delta, barge-in halt) is
  parked in documented `test.skip`s — not observable from the real app, which keeps
  R3F's continuous render loop but exposes no service state/debug contract on `window`.
  The L3/L5 harness is the surface instrumented for rig motion; the next gate is to
  expose a non-production embodiment probe for the canonical app as well.
- **L5** — render matrix live (`tests/render-matrix.spec.ts` plus
  `tests/avatar-visual-matrix.spec.ts`): all 25 catalog keys
  (14 GLB incl. HumGen Aria + 10 VRM; 24 unique files) load on the WebGL renderer via the
  harness — asserts `__avatarLoaded`, no page error, non-zero canvas. Green on headless
  SwiftShader.

## Layer L6 — curated demo evidence

L6 is a communication artifact, not a release gate. It records the canonical
web surface and the instrumented avatar surface separately so a polished reel
cannot be mistaken for proof of memory or agency:

- `pnpm generate:system-demo` captures the real web app in deterministic
  `script / demo-only` mode, including onboarding, activation labeling, two
  visible turns, Chat Log, Settings, and five PNG stills under `docs/demo/`.
- `pnpm generate:avatar-media -- --only=Greg --fps=30` captures the real avatar
  harness as PNG stills plus MP4/WebM clips under `docs/visual-tests/`.
- The demo manifest records `audio: silent capture` and the page-error list.
  A clean media run is evidence of the tested flow, not a claim that
  CI-Server memory, TTS, XR, or tools are connected.

Current artifact: [`docs/demo/README.md`](demo/README.md). Round record:
[`docs/gauntlet/ROUND-4-DEMO.md`](gauntlet/ROUND-4-DEMO.md).
