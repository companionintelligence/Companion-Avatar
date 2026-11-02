<p align="center">
  <img src="https://raw.githubusercontent.com/companionintelligence/.github/main/profile/assets/icons/avatar-companion.png" width="96" height="96" alt="Avatar Companion icon">
</p>

<h1 align="center">CI Spatial Companion</h1>

<p align="center"><strong>WebXR and WebSpatial</strong></p>

[![release](https://img.shields.io/badge/release-not%20published-757575?style=flat-square)](https://github.com/companionintelligence/CI-Spatial-Agent-Web/releases)
[![platform](https://img.shields.io/badge/platform-WebXR%20%C2%B7%20visionOS%20%C2%B7%20Web-0a6358?style=flat-square)](https://github.com/companionintelligence/CI-Spatial-Agent-Web)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-0a6358?style=flat-square)](LICENSE)
[![Discord](https://img.shields.io/badge/chat-Discord-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.com/invite/yQp9hwpzAa)

<p align="center"><a href="#documentation">Documentation</a> · <a href="#install-dependencies">Get started</a> · <a href="#license">License</a> · <a href="https://docs.ci.computer/docs/reference/open-source-systems">Systems map</a></p>

<p align="center">
  <a href="#docker--ci-hub"><img src="https://img.shields.io/badge/Run%20with%20Docker-Run%20with%20Docker-0a6358?style=for-the-badge&logo=docker&logoColor=white" alt="Run with Docker" height="30"></a>
</p>

Embodied AI Avatar framework with WebXR and Vision Pro support.

## Documentation

**Start here — system reference** (how it all works, with mermaid charts):

| Doc | What it covers |
|---|---|
| [architecture.md](docs/architecture.md) | The embodied agent end-to-end — pipeline, conversation-turn sequence, `useAgent` service graph, platform/render tiers, deployment |
| [animation.md](docs/animation.md) | The body **animation mixer**, the full clip/expression library (33 GLB + 7 feminine + 6 VRMA), and **how the LLM triggers animations** |
| [avatar.md](docs/avatar.md) | Avatar **rig contract**, the viseme + emote face systems, facial capability tiers, the 24-avatar catalog, and the HumGen→VRM pipeline |
| 🎞 [**Visual-test gallery**](docs/visual-tests/) | **98 animated WebP clips** across 6 avatars (male + female · GLB + VRM, incl. the **feminine motion set** on female avatars) in sub-pages — [body animations](docs/visual-tests/animations.md), [faces](docs/visual-tests/faces.md) (lip-sync + emotes), [eye movement](docs/visual-tests/eyes.md), [blend combos](docs/visual-tests/blends.md) — rendered inline on GitHub |

**Pipelines & plans:**

| Doc | What it covers |
|---|---|
| [ANIMATION-PIPELINE.md](docs/ANIMATION-PIPELINE.md) | The body-animation pipeline + the RPM/Mixamo clip library |
| [AVATAR-PIPELINE.md](docs/AVATAR-PIPELINE.md) | Avatar pipeline + the rig contract in depth |
| [VOICE-PIPELINE.md](docs/VOICE-PIPELINE.md) | STT → LLM → TTS voice pipeline + lip-sync (VibeVoice / CosyVoice) |
| [FACIAL-ANIMATION-PLAN.md](docs/FACIAL-ANIMATION-PLAN.md) | Tiered facial animation (VRM → ARKit → FACS → **MetaHuman** roadmap) |
| [WEBSPATIAL-PLAN.md](docs/WEBSPATIAL-PLAN.md) | WebSpatial / spatial-platform support (visionOS, Android XR, Pico) |
| [TESTING-PIPELINE.md](docs/TESTING-PIPELINE.md) | The 5-layer test strategy (unit → visual WebP → E2E) |
| [operations/error-reporting.md](docs/operations/error-reporting.md) | Opt-out Sentry crash reporting — how to turn it off, what is scrubbed, and why prompts/replies can never reach it |
| [ASSET-PIPELINE.md](docs/ASSET-PIPELINE.md) · [DEPLOYMENT.md](docs/DEPLOYMENT.md) · [DRIVE-ASSETS.md](docs/DRIVE-ASSETS.md) · [PRODUCT-PLAN.md](docs/PRODUCT-PLAN.md) · [BUTTON-AUDIT.md](docs/BUTTON-AUDIT.md) | Asset packaging · container deployment · owned-asset inventory · product/launch plan · control-bar audit |

## Interface

The app is a full-viewport **3D avatar viewport** with a 2D HUD — logo, chat-log
panel, chat input, and a floating control dock — composited on top. The shell is
intentionally **dark-only**: it is an XR HUD, not a light-themable document
surface, so the canon dark background (`--teal-950` `#041620`) is kept even under a
light OS preference. It is on the [Companion Intelligence design system](https://github.com/companionintelligence/CI-Common/tree/main/styles):
phthalo `--primary` (`#0a6358` / dark `#c5e8dc`) and Manrope, sourced from the shared
`:root` / `.dark` tokens in `packages/core/src/styles/globals.css`. The design system
ships both light and dark palettes; this XR HUD deliberately renders the **dark**
tokens only.

All screenshots below are the **real UI rendered headlessly** (WebGL via
`chrome-headless-shell`/SwiftShader). With no LLM/TTS backend configured the app
falls back to the offline scripted (`script`) LLM provider, so the avatar, control
dock, and chat conversation all render out of the box — no backend needed for any
screen here. XR (AR/VR) session entry and speech audio require a headset / native
runtime and are **not** exercised in these captures (the dock reports
`XR: unavailable` under headless Chromium); see the note at the end of this section.

### First-run onboarding

The microphone-permission modal shown on first load (before `ci_avatar_onboarded`
is set in `localStorage`), layered over the live avatar scene. "Skip" drops
straight into text chat.

![First-run onboarding — dark](docs/media/webxr-onboarding-dark.png)

### HUD shell

The default state once onboarding is dismissed: the Companion Intelligence logo, the
VRM avatar, the collapsible **Chat Log** panel (empty), the floating control dock,
and the live `XR:` status line.

![HUD shell — dark](docs/media/webxr-shell-dark.png)

### Chat conversation

The **Chat Log** populated by a real exchange with the offline scripted provider —
`You` / `Assistant` bubbles rendered with the canon teal gradient. No LLM backend
is running; the responses come from the bundled directed-response set.

![Chat conversation — dark](docs/media/webxr-chat-dark.png)

### Controls collapsed

With the control dock hidden via its **Controls** toggle (bottom-left), the HUD
reduces to the logo, Chat Log, and the exposed `Type your message here…` chat
input — the minimal text-only interaction surface.

![Controls collapsed — dark](docs/media/webxr-controls-collapsed-dark.png)

> **Backend / native-runtime-gated surfaces (not captured):** entering an immersive
> **AR/VR session** requires a WebXR-capable headset (the 🥽 / 📱 dock buttons and
> the XR recenter/scale/exit controls only activate inside a session), the **Vision
> Pro** WebSpatial build (`apps/vision-pro`) needs visionOS, and **voice** (mic VAD →
> STT → TTS lip-sync) and **cloud/WebGPU** modes need device permissions or a
> reachable backend. Those states are not fabricated here; only what genuinely
> renders headlessly is shown.

## Structure

```
├── packages/
│   └── core/           # Shared services, components, and utilities
├── apps/
│   ├── web/            # React/R3F standard web application
│   ├── vision-pro/     # Apple Vision Pro (WebSpatial) application
│   └── vanilla-client/ # Vanilla Three.js/WebGPU/WebXR client from Web-2
```

## Development

```bash
# Install dependencies
pnpm install

# Start web dev server
pnpm dev:web

# Start Vision Pro dev server
pnpm dev:vision

# Start the vanilla WebGL/WebGPU/WebXR client
pnpm dev:vanilla

# Build only the vanilla client
pnpm build:vanilla
```

## Docker / CI Hub

A public multi-arch (amd64 + arm64) image is published to GHCR and used by the CI Hub
app store as **Avatar Companion**. nginx serves the built web app on internal port **5173**.

```bash
docker run -d -p 8080:5173 ghcr.io/companionintelligence/ci-spatial-companion-webxr:latest
# open http://localhost:8080
```

The published image is fully self-contained: with no LLM/TTS backend configured it
falls back to offline scripted responses (`script` provider), so the avatar, chat,
and animations work out of the box. Speech audio is disabled unless a TTS backend
is reachable.

### Connecting an LLM/TTS backend

The image reads its LLM/TTS config from **environment variables at container start**,
via `/config.json` (generated by the nginx entrypoint) — no rebuild needed:

```bash
docker run -d -p 8080:5173 \
  -e APP_LLM_PROVIDER=proxy \
  -e APP_OLLAMA_URL=http://host.docker.internal:11434 \
  -e APP_LLM_MODEL=gemma3:1b \
  ghcr.io/companionintelligence/ci-spatial-companion-webxr:latest
```

With `APP_LLM_PROVIDER=proxy`, the browser talks only to the container's built-in
backend proxy (`/api/chat`), which in turn talks to Ollama — so **no `OLLAMA_ORIGINS`
CORS config and no public tunnel are needed**. Users can further override the
URL/model in-app via the **Settings (⚙️)** panel; overrides persist to `localStorage`.
Precedence: `localStorage` > runtime `/config.json` > build-time `VITE_LLM_*` defaults.

| Env var             | Default                              | Purpose                                                             |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `APP_LLM_PROVIDER`   | `script`                             | `script`, `ollama`, `mlc`, `openai`, or `proxy` (recommended — routes through the built-in BFF, no CORS needed) |
| `APP_OLLAMA_URL`     | `http://host.docker.internal:11434`  | Ollama server URL (used by the `proxy`/`ollama` providers)          |
| `APP_LLM_MODEL`      | `gemma3:1b`                          | Model name                                                          |
| `APP_TTS_MODE`       | `browser`                            | `browser` (speechSynthesis), `pocket`, `local`, or `remote`         |
| `APP_STT_REMOTE`     | `false`                              | Route speech input to the appliance's Whisper instead of on-device  |

The default `APP_TTS_MODE` is `browser` because it is the only mode that needs
nothing installed: a stock install speaks out of the box. `pocket`, `local` and
`remote` are quality upgrades you opt into. If you opt into `pocket` and the server
turns out to be unreachable, the app logs one warning and falls back to the browser
voice for the rest of the session rather than going silent.

<details>
<summary><strong>Advanced (legacy): baking the backend in at build time</strong></summary>

Before the runtime `/config.json` mechanism above existed, the only way to wire up a
backend was to bake Vite environment variables in **at build time** — setting them on
`docker run` has no effect on an image built this way. Prefer the runtime approach
above; this path remains for cases that genuinely need a backend fixed into the image
itself:

```bash
docker build \
  --build-arg VITE_LLM_PROVIDER=ollama \
  --build-arg VITE_LLM_OLLAMA_API_URL=https://ollama.example.com \
  --build-arg VITE_LLM_OLLAMA_MODEL=gemma3:1b \
  -t avatar-companion .
```

| Build arg / env           | Default                 | Purpose                                                     |
| ------------------------- | ----------------------- | ----------------------------------------------------------- |
| `VITE_LLM_PROVIDER`       | `script`                | `script`, `ollama`, `mlc` (in-browser WebLLM), `openai`, or `proxy` |
| `VITE_LLM_OLLAMA_API_URL` | —                       | Ollama server URL (required for `ollama`)                   |
| `VITE_LLM_OLLAMA_MODEL`   | `gemma3:1b`             | Ollama model name                                           |
| `VITE_TTS_MODE`           | `browser`               | `browser` (speechSynthesis), `pocket`, `local`, or `remote` |
| `VITE_POCKET_TTS_URL`     | `http://localhost:8000` | Pocket TTS server URL (used when `VITE_TTS_MODE=pocket`)    |

Unlike `proxy`, the `ollama`/`openai` providers here make LLM/TTS requests straight
from the **browser**, not the container, so the backend URL must be reachable from
the user's machine and must allow the app's origin via CORS (for Ollama set
`OLLAMA_ORIGINS`, see `pnpm ollama:serve`).

</details>

## Core Features

| Feature | What it provides |
|---|---|
| **Conversation** | Stream text or speech input through configurable agent and LLM backends. |
| **Embodied output** | Coordinate TTS, visemes, emotion selection and avatar animation. |
| **Platform adapters** | Share a React/Three.js core across web, WebXR and visionOS. |
| **Server boundary** | Use the Hono BFF to keep provider keys out of browser clients. |


- **3D Avatar System**: VRM-based avatars with emotion and speech animation
- **LLM Integration**: Local (WebLLM, Ollama) and cloud backends
- **Voice Pipeline**: STT → LLM → TTS with viseme lip sync
- **WebXR Support**: AR/VR experiences via @react-three/xr
- **WebGPU Rendering**: Optional high-performance rendering


## How it fits together

Platform adapters collect text, speech and XR input; the shared conversation pipeline streams an agent response, then TTS, viseme timing and emotion drive the avatar renderer.

```mermaid
flowchart LR
  Input[Web, WebXR or visionOS input] --> Core[Shared conversation core]
  Core --> BFF[Optional Hono BFF]
  BFF --> Agent[Agent or LLM backend]
  Agent --> Speech[TTS and viseme timing]
  Speech --> Avatar[Three.js or native avatar renderer]
```

## Architecture

### Services

- `llm/` - Language model integration (WebLLM, Ollama, Cloud APIs)
- `tts/` - Text-to-speech with VITS
- `stt/` - Speech-to-text with Whisper
- `vad/` - Voice activity detection
- `viseme/` - Lip sync viseme generation
- `emote/` - Facial expression system
- `animation/` - Body animation system

### Components

- `scene/` - 3D scene and avatar rendering
- `chat/` - Chat UI components
- `control/` - Settings and control panels

<!-- companion-hub-readme-deep-review -->

## Browser and service flow

```mermaid
flowchart LR
  User --> Client[Spatial Agent Web client]
  Client --> HUD[HUD, chat, and controls]
  Client --> Backend[Configured LLM or voice backend]
  Client --> Vision[Vision Pro, WebGL, WebGPU, or WebXR client]
  Client --> Hub[Optional Companion Hub deployment]
```

The README documents several client targets. Choose the Vision Pro dev server, vanilla WebGL/WebGPU/WebXR client, or Docker/Hub path explicitly; they are separate run targets. Backend URLs and credentials belong in local environment configuration, not in a committed screenshot or issue report.

## License

CI Spatial Companion is free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). The full text is in [`LICENSE`](LICENSE); common questions are answered in the [License FAQ](docs/License-FAQ.md), or email support@companionintelligence.com.

Some bundled avatar models carry their own, more restrictive terms. See [NOTICE.md](NOTICE.md) before redistributing them.

> Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)
