import { defineConfig, devices } from '@playwright/test'

/**
 * Render suites for the avatar harness (tests/avatar-visual-matrix.spec.ts,
 * tests/face-compositor.spec.ts and tests/harness-states.spec.ts), run against a
 * production build of harness.html.
 *
 * Why not the dev server: see apps/web/vite.harness.config.ts. The dev server's lazy
 * dependency pre-bundling returns 504 while the harness loads, so the page never boots.
 *
 * The web server is started and stopped by the test run, on 127.0.0.1 only.
 *
 * Speech source: HARNESS_TTS=synthetic|browser and HARNESS_TTS_VOLUME=0..1 choose what the
 * avatar speaks with for the whole run (tests/support/harnessUrl.ts adds them to every
 * harness URL; apps/web/src/harness/speechMode.ts says what each combination gives).
 *
 * Run:
 *   pnpm exec playwright test -c playwright.config.harness.ts
 *   pnpm exec playwright test -c playwright.config.harness.ts --grep 'Greg|Erik'
 *   HARNESS_TTS=browser pnpm exec playwright test -c playwright.config.harness.ts
 */
const PORT = Number(process.env.HARNESS_PORT || 5204)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/avatar-visual-matrix.spec.ts', '**/face-compositor.spec.ts', '**/harness-states.spec.ts'],

  timeout: 300 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    viewport: { width: 1024, height: 768 }
  },

  projects: [
    {
      name: 'chromium-webgl',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Software GL so headless runs still rasterize the three.js scene.
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
        }
      }
    }
  ],

  webServer: {
    // Same asset packing as the dev server's predev step, then a production build of the
    // harness entry, then a localhost preview of it.
    command: [
      'pnpm --filter @ci-avatar/web run predev',
      'pnpm --filter @ci-avatar/web exec vite build --config vite.harness.config.ts',
      `pnpm --filter @ci-avatar/web exec vite preview --config vite.harness.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`
    ].join(' && '),
    url: `${BASE_URL}/harness.html`,
    reuseExistingServer: false,
    timeout: 600 * 1000
  }
})
