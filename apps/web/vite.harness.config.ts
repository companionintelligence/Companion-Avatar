import { mergeConfig } from 'vite'
import base from './vite.config'

/**
 * Production build of the avatar harness page (harness.html) for the render suites.
 *
 * The dev server pre-bundles three.js dependencies lazily while the harness loads.
 * On a cold cache the first module request returns 504 "Outdated Optimize Dep", and
 * the harness never reaches window.__harnessReady, so reloads do not recover it.
 * The render suites therefore build this entry once and serve it with `vite preview`
 * (see playwright.config.harness.ts). The default build is unchanged.
 */
export default mergeConfig(base, {
  build: {
    outDir: 'dist/harness',
    emptyOutDir: true,
    rollupOptions: {
      input: { harness: 'harness.html' }
    }
  }
})
