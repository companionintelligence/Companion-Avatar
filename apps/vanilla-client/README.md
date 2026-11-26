# Vanilla client

This app is the consolidated home for the standalone
`CI-Spatial-Agent-Web-2` vanilla Three.js/WebGL/WebGPU/WebXR client.

## Layout

```text
apps/vanilla-client/
├── src/
│   ├── agent/       # OpenAI-compatible agent loop and tools
│   ├── character/   # Rig discovery, animation, gaze, locomotion, lip sync
│   ├── core/        # Renderer, capabilities, and event bus
│   ├── perception/  # Camera, detection, and spatial labels
│   ├── speech/      # STT/TTS adapters
│   ├── ui/          # DOM and in-world HUDs
│   └── xr/          # AR/VR sessions and hit testing
├── public/          # Default robot, audio, and textures
├── server/          # Older Grounding DINO WebSocket server (detection now uses the shared POST /detect)
└── tools/           # Listing capture helpers
```

## Commands

```bash
pnpm dev:vanilla
pnpm build:vanilla
pnpm preview:vanilla
pnpm capture:vanilla
pnpm capture:vanilla-gif
```

The original Web-2 repository remains standalone during the migration. Keep
changes to this app mirrored there until the repository is formally retired.
