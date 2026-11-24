import { resolve } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, type Plugin } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

import { assertPwa } from '../../scripts/check-pwa.mjs'
import { assertNoDistSecrets } from '../../scripts/check-dist-secrets.mjs'

/**
 * Fail the build when the installable app's service worker disagrees with itself: the cache
 * name public/sw.js declares must be the fingerprint of the offline files it precaches, those
 * files must be in the output, and the bundle must register the worker (scripts/check-pwa.mjs).
 *
 * It runs here, rather than as an npm hook, because every way this app is built goes through
 * `vite build`: pnpm's `build`, the Cloudflare Pages build and the container image's
 * `deno task --cwd apps/web build`, which does not run pnpm's pre/post build hooks. A check that
 * lived in a script would let through a deploy it never saw.
 */
function checkPwa(): Plugin {
  let publicDir: string | false = false
  let outDir: string | null = null
  let skip = false
  let failed = false

  return {
    name: 'ci-avatar-check-pwa',
    apply: 'build',
    configResolved(config) {
      // Storybook builds through this config too: its output is a component gallery, not the app.
      skip = config.plugins.some((plugin) => plugin.name.startsWith('storybook:'))
      publicDir = config.publicDir
      outDir = config.build.ssr ? null : resolve(config.root, config.build.outDir)
    },
    // A build that already failed reports its own error; checking its half-written output
    // would replace that error with a misleading one.
    buildEnd(error) {
      if (error) failed = true
    },
    renderError() {
      failed = true
    },
    closeBundle() {
      if (!skip && !failed && publicDir && outDir) assertPwa({ publicDir, dist: outDir })
    }
  }
}

/**
 * Fail the build when a credential would be published with the app. Vite inlines every VITE_* value
 * into the JavaScript, two of them are keys (VITE_LLM_OPENAI_API_KEY, VITE_TTS_API_KEY), and dist/ is
 * served to every visitor. The check looks for the value of every credential-named variable (build
 * environment and .env files) and for credential-shaped strings, and names the file, never the secret
 * (scripts/check-dist-secrets.mjs). It runs here for the same reason as the PWA check above: every way
 * this app is built goes through `vite build`.
 */
function checkDistSecrets(): Plugin {
  let envDir = ''
  let outDir: string | null = null
  let skip = false
  let failed = false

  return {
    name: 'ci-avatar-check-dist-secrets',
    apply: 'build',
    configResolved(config) {
      // Storybook builds through this config too: its output is a component gallery, not the app.
      skip = config.plugins.some((plugin) => plugin.name.startsWith('storybook:'))
      envDir = typeof config.envDir === 'string' ? config.envDir : config.root
      outDir = config.build.ssr ? null : resolve(config.root, config.build.outDir)
    },
    buildEnd(error) {
      if (error) failed = true
    },
    renderError() {
      failed = true
    },
    closeBundle() {
      // The app's own folder and the repository root are where a .env file for this build would be.
      if (!skip && !failed && outDir) assertNoDistSecrets({ dist: outDir, envDirs: [envDir, resolve(envDir, '../..')] })
    }
  }
}

export default defineConfig({
  plugins: [
    ...(process.env.VITE_USE_SSL === 'true' ? [basicSsl()] : []),
    react(),
    // Last, so they check the output after every other plugin has had its say.
    checkPwa(),
    checkDistSecrets()
  ],
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    // Same-origin BFF in dev: forward /api to the local proxy (pnpm dev:proxy).
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'three']
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // @pixiv/three-vrm's MToonNodeMaterial keeps a runtime-guarded `FnCompat`
        // helper that calls three's pre-r168 `tslFn` only when REVISION < 168, and
        // three's r168+ `Fn` otherwise. We ship three 0.182, so the `tslFn` branch is
        // dead code and works at runtime — but Rollup's static analysis still flags
        // "tslFn is not exported by three.webgpu.js" (code: MISSING_EXPORT). Suppress
        // just that one false positive; let every other warning through.
        if (
          warning.code === 'MISSING_EXPORT' &&
          warning.message.includes('tslFn') &&
          warning.message.includes('three.webgpu')
        ) {
          return
        }
        warn(warning)
      },
      output: {
        // Split stable, rarely-changing vendor code into its own chunks so app
        // code changes don't bust the (large) three.js/vrm/postfx download on
        // every deploy, and so the browser can cache them independently.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/three/') || id.includes('three-mesh-bvh')) return 'vendor-three'
          if (id.includes('@react-three/fiber') || id.includes('@react-three/drei')) return 'vendor-r3f'
          if (id.includes('@pixiv/three-vrm')) return 'vendor-vrm'
          if (id.includes('/postprocessing/')) return 'vendor-postfx'
        }
      }
    }
  }
})
