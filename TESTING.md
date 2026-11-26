# Testing — CI-Spatial-Agent-Web

This repo has two independent test systems. **Vitest** (unit/component tests) is what
actually gates PR merges in CI; **Playwright** (documented in the rest of this file) is a
separate end-to-end/browser suite that is not part of the required CI workflow.

## Vitest — Unit & Component Tests

The root `vitest.config.ts` defines a single Vitest 4 config with multiple **projects**
(via the `test.projects` API). Each project pins its own `environment` and `include`
glob, so a file's location and name — not a per-file `@vitest-environment` docblock —
determine how it runs.

| Project | Environment | Files (`include`) | Covers |
| --- | --- | --- | --- |
| `agent-node` | node | `packages/agent/src/**/*.node.test.ts` | Transport-agnostic agent layer (tools + spatial memory) |
| `engine-node` | node | `packages/engine/src/**/*.node.test.ts` | Renderer-free avatar engine — pure arbitration logic |
| `core-node` | node | `packages/core/src/**/*.node.test.ts` | Pure service logic, no DOM |
| `core-dom` | jsdom | `packages/core/src/**/*.dom.test.{ts,tsx}` | Component + browser-API logic (React Testing Library, via `vitest.setup.ts`) |
| `proxy` | node | `apps/proxy/test/**/*.test.ts` | Backend proxy / BFF unit + integration tests |
| `web-node` | node | `apps/web/src/**/*.node.test.ts` | App-level logic outside `packages/core` (browser telemetry gate + scrubber) |
| `scripts` | node | `scripts/**/*.test.mjs` | Repo tooling under `scripts/` (plain `.mjs`, no TS project of its own) |
| `nginx-node` | node | `nginx/**/*.node.test.ts` | Container entrypoint that renders `/config.json` (test shells out through `sh`) |

### Filename convention

- **`*.node.test.ts`** → runs with `environment: 'node'`. Use for pure logic that doesn't
  touch the DOM (three.js math, service logic, BFF/config-generator logic, etc.) — it's
  cheaper and closer to how the code actually executes.
- **`*.dom.test.{ts,tsx}`** → runs with `environment: 'jsdom'` plus
  `@testing-library/react`/`@testing-library/jest-dom` (loaded by `vitest.setup.ts`). Use
  for React components or anything that touches browser APIs.

Matching one of the `include` globs above is what registers a new test file with a
project — there's no separate manual registration step, but a file in the wrong location
or with the wrong suffix simply won't be picked up by any project.

### Running it

```bash
pnpm test           # vitest run — single pass across every project (this is what CI runs)
pnpm test:watch     # vitest — interactive watch mode
pnpm test:coverage  # vitest run --coverage
```

Scope a run to one project with Vitest's own `--project` flag, e.g.
`pnpm test -- --project core-dom`.

### CI gating

`.github/workflows/test.yml` runs on every push/PR to `main` and its `Unit + component
tests` step is just `pnpm test`. That step (alongside lint, the web typecheck/build, and
a Storybook build smoke test) is what gates merges — the Playwright suite below has no
job in that workflow and does not block a PR.

## Playwright — End-to-End / Browser Tests

Everything from here to the end of this file (`Overview` through `Conclusion`) documents
the **Playwright** suite, which drives the built app in a real browser via `pnpm
test:e2e`. It is a separate, heavier suite from the Vitest tests above and is not wired
into `.github/workflows/test.yml`.

## Overview
Successfully created comprehensive end-to-end testing infrastructure using Playwright to test the AI avatar web application.

## Test Coverage

### ✅ 1. Agent Conversation Tests (`tests/agent.spec.ts`)
**Total Tests: 19**

#### Question Bank Categories:
- **Greetings** (5 tests): Hello, Hi there, Good morning, How are you?, What's up?
- **Information** (3 tests): Questions about agent capabilities
- **Technical** (2 tests): AI/ML questions  
- **Conversational** (2 tests): Casual questions
- **Math & Logic** (3 tests): Math problems

#### Advanced Tests:
- Rapid consecutive message handling
- Conversation context maintenance
- Avatar animation during conversation
- Response pattern validation

### ✅ 2. Speech & Audio Tests (`tests/audio.spec.ts`)
**Total Tests: 16**

#### STT (Speech-to-Text):
- Browser API detection (Web Speech API, AudioContext)
- Microphone permission handling
- VAD (Voice Activity Detection) initialization
- Fake audio stream injection for testing
- Microphone toggle UI verification

#### TTS (Text-to-Speech):
- Speech Synthesis API availability
- Voice enumeration and configuration
- TTS event monitoring (speak, start, end, error)
- Viseme generation for lip synchronization
- TTS queue management
- Multi-message handling

#### Integration:
- Audio context management
- Permission graceful degradation
- Half-duplex communication verification

### ✅ 3. Animation Tests (`tests/animation.spec.ts`)
**Total Tests: 14**

#### Core Animation:
- Canvas rendering verification
- Three.js & WebGL context
- Idle animation activity
- Frame rate monitoring (target 60 FPS, min 30 FPS)
- Animation state transitions

#### Avatar Features:
- VRM model loading
- Lip synchronization during speech
- Blinking animation (2-8 second intervals)
- Facial expressions
- Gaze following behavior
- Emotion-based animations

#### Performance:
- Memory leak detection
- Window resize handling
- Sustained animation quality

## Infrastructure

### Configuration (`playwright.config.ts`)
- **App under test**: the dev server on http://localhost:5173 by default. `E2E_SERVER=preview` builds the app and
  the harness page for production (`apps/web/vite.e2e.config.ts`) and serves them with `vite preview` on
  http://127.0.0.1:4196 (`E2E_PORT`). Use preview where the dev server cannot serve the app, for example on a Mac
  whose antivirus quarantines Vite's pre-bundled `@react-three/drei`.
- **Backend**: both build the app against Ollama, `E2E_OLLAMA_URL` (default http://localhost:11434) with
  `E2E_OLLAMA_MODEL` (default `gemma3:1b`). The agent specs check that server first and press Check
  connection before they talk. Without it they are skipped with the reason; `E2E_REQUIRE_BACKEND=1` fails
  them instead.
- **Timing tests**: the frame-rate and blink tests skip, with the reason, under software rendering (no GPU)
  or when the host's load per CPU is above `E2E_MAX_LOAD_PER_CPU` (default 1.5). Either makes a frame rate
  meaningless (`tests/support/timingGate.ts`).
- **Speech for the face tests**: the synthetic voice at full level, as in `playwright.config.harness.ts`
  (`HARNESS_TTS`, `HARNESS_TTS_VOLUME`).
- **Not in this config**: `tests/container/`, which needs the published container and has its own config.
- **Timeouts**: 60s per test, 120s for server startup (600s for a preview build)
- **Browser**: Chromium (Chrome for Testing)
- **Permissions**: Microphone, speaker auto-granted
- **Media**: Fake devices for consistent testing
- **Reports**: HTML, JSON, screenshots, videos

### Test Data (`tests/data/questionBank.ts`)
- 50+ test questions across 8 categories
- Expected response patterns for validation
- Helper functions for random/category selection
- Edge cases (empty, long, emoji, caps, etc.)

## npm Scripts

```bash
# Run all E2E tests
pnpm test:e2e

# Run specific suites
pnpm test:agent       # Agent conversation tests
pnpm test:audio       # STT/TTS tests
pnpm test:animation   # Avatar animation tests

# Interactive modes
pnpm test:e2e:ui      # UI mode (recommended)
pnpm test:e2e:headed  # See browser
pnpm test:e2e:debug   # Debug mode

# View reports
pnpm test:report      # Open HTML report
```

## Test Results Location

```
playwright-report/
├── index.html              # Main HTML report
├── results.json            # JSON test results
├── screenshots/
│   ├── initial-state.png
│   ├── avatar-idle-animation.png
│   ├── avatar-talking.png
│   ├── avatar-lip-sync.png
│   └── microphone-enabled.png
├── videos/                 # Test run videos (on failure)
└── traces/                 # Detailed traces (on retry)
```

## Key Testing Capabilities

### 1. Question Bank Testing
- Automated testing of 50+ questions
- Response validation with regex patterns
- Category-based organization
- Edge case handling

### 2. STT Testing Approach
```typescript
// Inject fake audio stream for consistent testing
await injectFakeAudioStream(page)

// Monitor microphone state
const micButton = page.locator('button[aria-label*="microphone"]')
await micButton.click()

// Verify VAD initialization
// Check for console logs indicating VAD is active
```

### 3. TTS Testing Approach
```typescript
// Monitor TTS events
await setupTTSMonitoring(page)

// Trigger speech
await sendMessage(page, 'Hello')

// Get events
const events = await getTTSEvents(page)
// events: [{ type: 'speak', text: '...', timestamp: ... }]
```

### 4. Animation Verification
```typescript
// Compare screenshots to detect animation
const screenshot1 = await canvas.screenshot()
await page.waitForTimeout(500)
const screenshot2 = await canvas.screenshot()

// If different, avatar is animating
const isAnimating = Buffer.compare(screenshot1, screenshot2) !== 0

// Estimate FPS
const fps = await estimateFPS(page, 2000)
expect(fps).toBeGreaterThan(30)
```

## Test Execution Flow

1. **Setup**: Playwright config starts dev server with Ollama
2. **Browser Launch**: Chromium with fake media devices
3. **Navigation**: Load http://localhost:5174
4. **Wait**: Agent initialization (canvas render + 2s)
5. **Execute**: Run test interactions
6. **Assert**: Verify expected outcomes
7. **Capture**: Screenshots/videos on failure
8. **Report**: Generate HTML/JSON reports

## Requirements

### System Dependencies
- Node.js >=20
- pnpm 10.28.2
- Ollama 0.15.2 (running locally)
- Chromium browser (auto-installed by Playwright)

### Environment Variables
```bash
VITE_LLM_PROVIDER=ollama
VITE_LLM_OLLAMA_API_URL=http://localhost:11434
VITE_LLM_OLLAMA_MODEL=gemma3:1b
```

## Known Limitations

1. **STT Testing**: Uses fake audio streams, doesn't test actual speech recognition
2. **TTS Verification**: Browser policies may prevent audio in headless mode
3. **Animation Comparison**: Timing-sensitive, may produce false positives
4. **Ollama Dependency**: Tests require local Ollama server running

## Best Practices

### For Agent Tests:
- Use question bank categories for organization
- Add expected patterns for response validation
- Test context maintenance with follow-ups
- Include edge cases (empty, long, special chars)

### For Audio Tests:
- Always grant permissions in beforeEach
- Use fake devices for consistency
- Monitor console logs for service initialization
- Test both browser APIs and custom services

### For Animation Tests:
- Compare multiple screenshots for reliability
- Set reasonable FPS thresholds (30-60)
- Test state transitions and performance
- Verify animations during different agent states

## Debugging

```bash
# Run with UI (best for development)
pnpm test:e2e:ui

# Run single test
pnpm test:e2e --grep "should load the application"

# Show browser
pnpm test:e2e:headed

# Debug mode (step through)
pnpm test:e2e:debug

# View last report
pnpm test:report
```

## Next Steps

1. **CI/CD Integration**: Add tests to GitHub Actions
2. **Visual Regression**: Add Percy or Chromatic for screenshot comparison
3. **Performance Benchmarks**: Track FPS/memory over time
4. **Accessibility**: Add axe-core tests
5. **Real STT/TTS**: Test with actual audio files
6. **Load Testing**: Multiple concurrent sessions

## Success Metrics

- ✅ **49 total tests** across 3 test suites
- ✅ Tests cover **agent conversation, audio, and animation**
- ✅ **Automated test execution** with reports
- ✅ **Question bank** with 50+ test questions
- ✅ **STT/TTS testing** with event monitoring
- ✅ **Animation verification** with FPS tracking
- ✅ **Screenshot/video capture** on failures
- ✅ **Interactive debugging** with Playwright UI

## Conclusion

A comprehensive E2E testing framework is now in place for the CI-XR-Web application. The tests cover the three critical areas requested:
1. ✅ **Question bank testing** - Automated testing of agent responses
2. ✅ **STT/TTS testing** - Speech input/output verification
3. ✅ **Animation verification** - Avatar animation monitoring

All tests are runnable with `pnpm test:e2e` and provide detailed reports for debugging and validation.
