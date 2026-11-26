import { defineConfig, devices } from '@playwright/test'
import { harnessRunSpeech } from './apps/web/src/harness/speechMode'

/**
 * Where the app under test comes from.
 *
 *   E2E_SERVER=dev (default)  the Vite dev server on :5173, reusing one that is already running
 *   E2E_SERVER=preview        a production build of the app and the harness page
 *                             (apps/web/vite.e2e.config.ts), served by `vite preview` on
 *                             127.0.0.1:E2E_PORT (default 4196). Use it where the dev server cannot
 *                             serve the app, such as a Mac whose antivirus quarantines a
 *                             pre-bundled dependency.
 *
 * Both build the app against Ollama: E2E_OLLAMA_URL (default http://localhost:11434) and
 * E2E_OLLAMA_MODEL (default gemma3:1b). tests/agent.spec.ts checks that server before it talks
 * to it (tests/support/connectionGate.ts).
 */
const PREVIEW = process.env.E2E_SERVER === 'preview'
const PORT = PREVIEW ? Number(process.env.E2E_PORT || 4196) : 5173
const BASE_URL = PREVIEW ? `http://127.0.0.1:${PORT}` : 'http://localhost:5173'
const LLM_ENV = {
  VITE_LLM_PROVIDER: 'ollama',
  VITE_LLM_OLLAMA_API_URL: process.env.E2E_OLLAMA_URL || 'http://localhost:11434',
  VITE_LLM_OLLAMA_MODEL: process.env.E2E_OLLAMA_MODEL || 'gemma3:1b'
}

// The face-compositor and avatar-matrix specs wait for the mouth to move while the avatar speaks,
// so they need the harness's speech source (synthetic, full level), as playwright.config.harness.ts
// sets it. The page's own default is silent. Set before any worker starts.
const runSpeech = harnessRunSpeech(process.env)
process.env.HARNESS_TTS = runSpeech.engine
process.env.HARNESS_TTS_VOLUME = String(runSpeech.volume)

// The specs that drive the harness page, and the browser flags playwright.config.harness.ts runs them with:
// software GL so a headless run still rasterises the scene, and no timer throttling for a page the
// browser thinks is in the background.
const HARNESS_SPECS = ['**/avatar-visual-matrix.spec.ts', '**/face-compositor.spec.ts']
const HARNESS_BROWSER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
]

/**
 * Playwright Configuration for CI-XR-Web Testing
 * 
 * This configuration sets up end-to-end testing for the web avatar application,
 * including agent conversation testing, STT/TTS verification, and animation checks.
 */
export default defineConfig({
  testDir: './tests',

  // The L4 (scenarios/) + L5 (render-matrix) suites need a WebGL-capable Chromium
  // (SwiftShader flags) and the offline `script` provider, both provided by
  // playwright.config.capture.ts. Keep them out of this legacy config, which targets
  // 5173 + Ollama for the agent/audio/animation suites.
  // The harness state captures need the production harness build, which
  // playwright.config.harness.ts serves, so they stay out of this config too.
  // tests/container/ has its own config: it needs the published container on :8080.
  testIgnore: ['**/render-matrix.spec.ts', '**/scenarios/**', '**/harness-states.spec.ts', '**/container/**'],

  // Maximum time one test can run for
  timeout: 60 * 1000,
  
  // Run tests in parallel
  fullyParallel: false, // Sequential for agent testing
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : 1,
  
  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list']
  ],
  
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: BASE_URL,
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    // Viewport size
    viewport: { width: 1280, height: 720 },
    
    // Permissions for microphone (speaker is not a valid permission)
    permissions: ['microphone'],
    
    // Launch browser with these args to allow audio/video
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-file-access',
        '--autoplay-policy=no-user-gesture-required'
      ]
    }
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      testIgnore: HARNESS_SPECS,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The render suites on the harness page, with the browser playwright.config.harness.ts gives them.
      // With this config's plain Chromium, the jaw read 0 during speech in one face test on two runs
      // (2026-11-25), and the same test passed with these flags.
      name: 'chromium-harness',
      testMatch: HARNESS_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: { args: HARNESS_BROWSER_ARGS }
      },
    },
    // Uncomment to test in other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // The app under test: the dev server, or a production build and `vite preview` (see the top).
  webServer: PREVIEW
    ? {
        command: [
          'pnpm --filter @ci-avatar/web run prebuild',
          'pnpm --filter @ci-avatar/web exec vite build --config vite.e2e.config.ts',
          `pnpm --filter @ci-avatar/web exec vite preview --config vite.e2e.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`
        ].join(' && '),
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 600 * 1000,
        env: LLM_ENV
      }
    : {
        command: 'pnpm dev:web',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        // Set via `env` rather than a `VAR=value` command prefix, which cmd.exe (Windows) cannot parse.
        env: LLM_ENV
      },
})
