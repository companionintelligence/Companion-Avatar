import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

/**
 * Every Storybook story as a test: `pnpm test:stories`, from the repo root or from this folder.
 *
 * @storybook/addon-vitest turns each story that .storybook/main.ts finds into a Vitest browser test.
 * The test renders the story in headless Chromium (Playwright), runs its play function, then runs axe
 * through @storybook/addon-a11y. `parameters.a11y.test` in .storybook/preview.tsx decides what an axe
 * violation does: 'error' fails the story, 'todo' only reports it.
 *
 * It extends this app's vite.config.ts, as Storybook does, so stories build with the app's React
 * plugin and dedupe. It is not one of the root vitest.config.ts projects: `pnpm test` stays on node
 * and jsdom and needs no browser.
 *
 * `storiesConfig` builds the config for one Storybook config folder. vitest.witness.config.ts uses it
 * for .storybook-witness, the planted bug that `pnpm check:stories` expects to fail.
 */
export const storiesConfig = (configDir: string, name: string) =>
  mergeConfig(
    viteConfig,
    defineConfig({
      plugins: [storybookTest({ configDir: fileURLToPath(new URL(configDir, import.meta.url)) })],
      resolve: {
        // The stories live in packages/core, which does not depend on Storybook. Storybook's own
        // builder hands `storybook/test` to them as a preview global; under Vitest it is a real
        // import, so resolve it from this app.
        dedupe: ['storybook']
      },
      test: {
        name,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright(),
          instances: [{ browser: 'chromium' }],
          // vite.config.ts serves the dev app on every interface (`server.host: true`). The test
          // server stays on this machine.
          api: { host: '127.0.0.1' }
        }
      }
    })
  )

export default storiesConfig('.storybook', 'storybook')
