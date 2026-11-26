import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vitest/config'

/**
 * Root Vitest config using the `projects` API (Vitest 4).
 *
 * Environment is selected by filename convention so it stays greppable and
 * avoids per-file `@vitest-environment` docblocks:
 *   - `*.node.test.ts`      → pure logic (three.js math runs fine in node)
 *   - `*.dom.test.{ts,tsx}` → jsdom + @testing-library/react component logic
 *
 * A third `proxy` project runs the BFF (apps/proxy) unit + integration tests, and
 * a fourth `web-node` project covers app-level logic that lives outside
 * packages/core (apps/web/src/lib — the browser telemetry gate and scrubber).
 *
 * Two further projects cover the deploy-time config generators, which are not app
 * code but produce the `/config.json` the app boots from: `scripts` (the plain
 * .mjs tooling under scripts/) and `nginx-node` (the container entrypoint, run
 * through `sh` so the test covers its real quoting).
 *
 * `resolve.dedupe` mirrors apps/web/vite.config.ts so a single React/three
 * instance is used under test.
 */
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', 'three']
  },
  test: {
    projects: [
      {
        // Transport-agnostic agent layer (packages/agent) — tools + spatial memory.
        test: {
          name: 'agent-node',
          environment: 'node',
          globals: true,
          include: ['packages/agent/src/**/*.node.test.ts']
        }
      },
      {
        // Renderer-free avatar engine (packages/engine) — pure arbitration logic.
        test: {
          name: 'engine-node',
          environment: 'node',
          globals: true,
          include: ['packages/engine/src/**/*.node.test.ts']
        }
      },
      {
        // Pure service logic — no DOM.
        test: {
          name: 'core-node',
          environment: 'node',
          globals: true,
          include: ['packages/core/src/**/*.node.test.ts']
        }
      },
      {
        // Component + browser-API logic — jsdom.
        plugins: [react()],
        resolve: { dedupe: ['react', 'react-dom', 'three'] },
        test: {
          name: 'core-dom',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['packages/core/src/**/*.dom.test.{ts,tsx}']
        }
      },
      {
        // Backend proxy (BFF).
        test: {
          name: 'proxy',
          environment: 'node',
          globals: true,
          include: ['apps/proxy/test/**/*.test.ts']
        }
      },
      {
        // App-level logic outside packages/core — the browser telemetry gate and
        // scrubber, which are node-testable pure functions plus a fetch gate.
        test: {
          name: 'web-node',
          environment: 'node',
          globals: true,
          include: ['apps/web/src/**/*.node.test.ts']
        }
      },
      {
        // The vanilla client's DOM-free modules (apps/vanilla-client), plain JS: the client for
        // the shared detection service.
        test: {
          name: 'vanilla-node',
          environment: 'node',
          globals: true,
          include: ['apps/vanilla-client/src/**/*.node.test.js']
        }
      },
      {
        // Repo tooling under scripts/ — plain .mjs, run by the build rather than
        // imported by the app, so it has no TypeScript project of its own.
        test: {
          name: 'scripts',
          environment: 'node',
          globals: true,
          include: ['scripts/**/*.test.mjs']
        }
      },
      {
        // The container entrypoint that renders /config.json from APP_* env — the
        // nginx-side counterpart of scripts/pages-config.mjs above. The test shells
        // out to the real script, so it covers the sh quoting rather than a
        // reimplementation of it.
        test: {
          name: 'nginx-node',
          environment: 'node',
          globals: true,
          include: ['nginx/**/*.node.test.ts']
        }
      }
    ]
  }
})
