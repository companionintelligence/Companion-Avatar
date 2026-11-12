import { defineConfig, devices } from '@playwright/test'

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
  testIgnore: ['**/render-matrix.spec.ts', '**/scenarios/**'],

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
    baseURL: 'http://localhost:5173',
    
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
      use: { ...devices['Desktop Chrome'] },
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

  // Run your local dev server before starting the tests
  webServer: {
    command: 'pnpm dev:web',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    // Set via `env` rather than a `VAR=value` command prefix, which cmd.exe (Windows) cannot parse.
    env: {
      VITE_LLM_PROVIDER: 'ollama',
      VITE_LLM_OLLAMA_API_URL: 'http://localhost:11434',
      VITE_LLM_OLLAMA_MODEL: 'gemma3:1b',
    },
  },
})
