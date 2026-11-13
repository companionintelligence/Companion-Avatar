import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the L4 (vertical scenarios) + L5 (avatar render matrix)
 * suites described in docs/TESTING-PIPELINE.md.
 *
 * Kept separate from the root playwright.config.ts on purpose:
 *   - It boots the web app on PORT=5178 (5173 is frequently occupied) and points
 *     baseURL there, with reuseExistingServer so a dev server you already have up
 *     is reused instead of spawning a second one.
 *   - It does NOT set VITE_LLM_PROVIDER, so the app boots in its default offline
 *     `script` (directed-responses) mode — deterministic replies, no LLM/Ollama.
 *   - It launches Chromium with the SwiftShader/ANGLE flags required to run the
 *     three.js WebGL renderer in headless CI (real avatars actually rasterize).
 *
 * Run:
 *   pnpm exec playwright test -c playwright.config.capture.ts tests/render-matrix.spec.ts
 *   pnpm exec playwright test -c playwright.config.capture.ts tests/scenarios
 */
const PORT = Number(process.env.CAPTURE_PORT || 5178)
const BASE_URL = process.env.CAPTURE_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  // Only the L4/L5 suites belong to this config; the legacy agent/audio/animation
  // specs stay on the root config (which targets 5173 + Ollama).
  testMatch: [
    '**/render-matrix.spec.ts',
    '**/avatar-visual-matrix.spec.ts',
    '**/face-compositor.spec.ts',
    '**/scenarios/**/*.spec.ts'
  ],

  timeout: 120 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/capture', open: 'never' }],
    ['json', { outputFile: 'playwright-report/capture-results.json' }]
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1024, height: 768 }
  },

  projects: [
    {
      name: 'chromium-webgl',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Force a software GL implementation so headless CI (no real GPU)
            // still rasterizes the three.js scene instead of failing the context.
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--enable-webgl',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            // Keep render probes on real RAFs when Chromium considers the
            // software-WebGL tab backgrounded or occluded.
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        }
      }
    }
  ],

  webServer: {
    // Boots vite via the workspace; `predev` (pack-assets) runs first so every
    // AvatarOptions entry is materialized into public/assets before the matrix runs.
    command: 'pnpm --filter @ci-avatar/web dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180 * 1000,
    // Set via `env` rather than a `PORT=... cmd` command prefix, which cmd.exe (Windows) cannot parse.
    env: { PORT: String(PORT) }
  }
})
