import react from '@vitejs/plugin-react'
import webspatial from '@webspatial/vite-plugin'
import { defineConfig } from 'vite'
import { createHtmlPlugin } from 'vite-plugin-html'
import basicSsl from '@vitejs/plugin-basic-ssl';

// `XR_ENV=avp` marks a build destined for the WebSpatial/visionOS container.
// The dev:avp, build:avp and publish:avp scripts all set it; a plain `build` or
// `preview` does not, and gets a self-contained browser bundle.
const isSpatialBuild = process.env.XR_ENV === 'avp'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // SSL is optional for dev - Cloudflare tunnel handles HTTPS termination
    // Set VITE_USE_SSL=true if you need direct HTTPS access (e.g., for visionOS testing)
    // For production builds, SSL is typically handled by the hosting provider
    ...(process.env.VITE_USE_SSL === 'true' ? [basicSsl()] : []),
    // HTML plugin should come before webspatial to ensure template is processed first
    createHtmlPlugin({
      inject: {
        data: {
          XR_ENV: process.env.XR_ENV || ''
        }
      }
    }),
    react({
      jsxImportSource: "@webspatial/react-sdk",
    }
    ),
    webspatial(
      {
        outputDir:""
      }
    )
  ],
  worker: {
    // As in apps/web/vite.config.ts: workers are bundled as ES modules, and the app starts them as module
    // workers. The local text-to-speech worker from @ci-avatar/core (services/tts/vits.worker.ts) loads parts
    // of vits-web with import(), which Vite's default worker format (iife) cannot split into chunks.
    format: 'es'
  },
  build: {
    rollupOptions: {
      // The WebSpatial JSX runtime is externalised ONLY for the spatial build,
      // where the container resolves the bare specifier itself.
      //
      // It used to be externalised unconditionally, which left
      //   import "@webspatial/react-sdk/web/jsx-runtime"
      // in the browser bundle as a bare specifier no browser can resolve. The
      // built app therefore threw on load and rendered nothing outside the
      // WebSpatial container — so `pnpm --filter @ci-avatar/vision-pro preview`
      // has always been a blank page, and this app could not be developed or
      // reviewed without a Vision Pro. Bundling it for the browser build fixes
      // that and cannot affect the spatial build, which still externalises.
      external: isSpatialBuild
        ? ['@webspatial/react-sdk/jsx-runtime', '@webspatial/react-sdk/web/jsx-runtime']
        : [],
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
      }
    }
  },
  server: {
    host: true, // This allows external connections
    port: 5174,
    allowedHosts: [
      '.webspatial.com', 
      'localhost', 
      '127.0.0.1',
      '0.0.0.0',
      '.companionintel.com',
      '.local' // For local network access
    ]
    // Note: Proxy removed - Cloudflare Tunnel handles API routing
    // For local development without tunnel, set VITE_LLM_OLLAMA_API_URL=http://localhost:11434
  }
})
