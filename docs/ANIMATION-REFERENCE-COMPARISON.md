# Avatar animation parity — `react-ai-voice-avatar`

This note records the feature comparison against the public reference implementation
at [927tanmay/react-ai-voice-avatar](https://github.com/927tanmay/react-ai-voice-avatar).
The goal is behavioral parity in the CI avatar platform, while keeping CI's existing
agent, TTS, WebGL/WebGPU, GLB, VRM, and WebSpatial architecture intact.

## Feature matrix

| Reference capability | CI implementation | Verification |
|---|---|---|
| Real decoded audio → `AnalyserNode` → lip-sync | `useTTSService` now supports deterministic `synthetic` PCM WAV for the harness, and all modes use the same decoded-buffer/analyser path. The harness page is silent by default (`volume: 0`), and at that level the analyser reads silence too, so no speech source takes the mouth. The render suites therefore run it at level 1 with the analyser's output cut (`HARNESS_TTS`, `HARNESS_TTS_VOLUME`; see `apps/web/src/harness/speechMode.ts`): the analyser carries real energy, silently, and the synthetic voice reports its own word timings. | `speechInfo`, `audioMetrics`, and `faceSnapshot` in `AvatarHarness`; rendered Chromium probe in `tests/avatar-visual-matrix.spec.ts`. |
| Audio FFT + phoneme timing blend | `AudioLipSync` is blended with `PhonemeTimingEngine` before writing ARKit, Oculus, or VRM mouth targets. | `packages/core/src/services/visemes/audioLipSync.node.test.ts`, `phonemeTiming` tests, and the render-level probe. |
| ARKit-52 / Oculus visemes / VRM mouth expressions | Existing morph and VRM setup is retained; the avatar renderer now writes `jawOpen`, `mouthOpen`, Oculus `viseme_*`, ARKit targets, and VRM `aa/ee/ih/oh/ou` from the same native speech weights. | Greg GLB and Erik VRM render tests. |
| Autonomous gaze, blink, brows, cheeks, listening/thinking face | `AvatarDynamicsEngine` now drives pointer gaze, eye saccades, semantic blink, acoustic brow/cheek response, and conversation-state behavior. | `avatarDynamics.node.test.ts`; live face snapshot reports gaze/blink. |
| Additive head and body motion | Procedural head/neck/spine, breathing, shoulder, arm, forearm, and hand offsets are removed before drei's mixer tick and re-applied after it, so animation clips are preserved and offsets do not accumulate. | Dynamics tests, the finite-gesture browser regression, and the harness posture snapshot. |
| Stable mixer lifecycle | Loaded clip resources keep stable array identity across unrelated avatar-state updates; changing emote/viseme services no longer tears down the active mixer and snaps the body back to idle. | `AvatarModel` stable-array adapter plus the browser state-change regression. |
| Complete gesture playback | Queued idle returns only after a finite gesture emits the mixer's `finished` event; the crossfade duration cannot truncate authored motion. | Animation service regression and the rendered Greg browser probe. |
| Emotion cleanup | Sparse emotion baselines clear keys owned by the previous emotion, and reset/barge-in zeros bound GLB morphs instead of leaving a frozen face. | `emoteService.node.test.ts`. |
| Status pill with waveform | Reusable `AvatarStatusPill` supports loading, idle, listening, thinking, speaking, analyser waveform, reduced motion, microphone/engine warning, and stop interaction. | Mounted in the canonical web app and exported from `@ci-avatar/core`. |
| Captions | Reusable `AvatarCaptionOverlay` renders the active speech/transcript text with accessible live-region semantics. | Mounted in `apps/web/src/App.tsx`. |
| Lighting presets | `AvatarLightingRig` provides studio, cyberpunk violet, cool azure, warm amber, clean white, and none presets. | `Scene3D` accepts `lightingPreset`. |
| Avatar size presets | `avatarSizing` provides compact, bust, half-body, full-body, and portrait scale presets. | `Scene3D` accepts `avatarSize`. |
| Custom GLB support | Existing `AvatarModel` loader remains the source of truth; the rig adapter accepts common VRM, RPM, Mixamo, and lower-case aliases for head, spine, eyes, shoulders, arms, forearms, and hands. | Avatar roster render matrix plus asset packing gate. |
| Text submission / streaming brain | Existing `useAgent` and LLM provider stack remain the conversation boundary. TTS speech is driven from agent replies instead of a second avatar-specific brain. | L4 vertical scenarios and the canonical app. |
| Imperative speech controls | `useTTSService.actions` exposes speak, stop, queue status, analyser, and current speech timing; the harness adds avatar selection, clip, emote, speech, and rig diagnostics. | `window.__harness` and TTS DOM tests. |
| Diagnostics / lighting controls | The harness exposes `faceMorphs`, `setMorph`, `clearMorphs`, `vrmExpressions`, `debugActions`, `speechInfo`, `audioMetrics`, and `faceSnapshot`. | `apps/web/harness.html`; no Leva dependency is required. |

## Intentional engine differences

The reference uses Kokoro/MMS TTS, Whisper/Qwen ASR, ONNX/WebGPU workers, and a
COOP/COEP deployment contract. CI already has equivalent service boundaries—remote,
browser, VITS worker, Pocket/remote TTS, browser/VAD/MLC/Ollama paths, and optional
WebGPU—so those engines were not copied into the core renderer. The renderer consumes
the stable contract (`AnalyserNode` plus speech timing) regardless of which engine
produced the audio.

This keeps engine selection replaceable while making the behavior that users see
consistent: decoded audio drives the analyser, phoneme timing fills the quiet gaps,
emotes cannot flatten speech, and procedural vitality remains additive to authored
motion.

## Render-proof command

Start the web app on the capture port, then run the focused proof:

```bash
CAPTURE_PORT=5200 pnpm --filter @ci-avatar/web dev
CAPTURE_PORT=5200 CAPTURE_BASE_URL=http://127.0.0.1:5200 \
  pnpm exec playwright test -c playwright.config.capture.ts \
  tests/avatar-visual-matrix.spec.ts --grep 'Avatar \\[Greg\\]|Avatar \\[Erik\\]'
```

The assertion waits for a real analyser signal and a non-zero mouth target in the
rendered scene. It does not pass merely because text was queued or because a synthetic
viseme sequence was written to a service ref.

## Media artifacts

The capture suite records the same harness path as PNG stills and MP4/WebM clips:

```bash
CAPTURE_PORT=5200 node scripts/generate-avatar-video.mjs --only=Greg --fps=30
```

Review the generated gallery at [`docs/visual-tests/index.html`](visual-tests/index.html).
