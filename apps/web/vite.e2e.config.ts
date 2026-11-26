import { mergeConfig } from 'vite'
import base from './vite.config'

/**
 * Production build for the default Playwright config's preview mode (E2E_SERVER=preview): the app
 * (index.html) and the avatar harness page (harness.html) in one build, so the agent, animation,
 * audio and face-compositor specs all run against production code served by `vite preview`.
 *
 * Use it where the dev server cannot serve the app: a cold dependency pre-bundle answers 504
 * (see vite.harness.config.ts), and on a Mac whose antivirus quarantines a pre-bundled file the
 * app never mounts. The default build (`pnpm --filter @ci-avatar/web build`) is unchanged.
 */
export default mergeConfig(base, {
  build: {
    outDir: 'dist/e2e',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: 'index.html', harness: 'harness.html' }
    }
  }
})
