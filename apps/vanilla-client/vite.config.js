import { defineConfig, loadEnv } from 'vite';
import mkcert from 'vite-plugin-mkcert';

/**
 * Dev server proxies (override targets via .env — see .env.example):
 *   /detect, /health → the shared detection service, POST /detect (Companion-Scan's Grounding DINO)
 *   /ws  → the older bundled Grounding DINO server (WebSocket), for a ws:// detectionUrl
 *   /v1  → any OpenAI-compatible AI backend (chat, STT, TTS)
 *   /tts → plain Piper HTTP server (only used when speech.ttsMode = 'piper')
 *
 * HTTPS via mkcert because WebXR + getUserMedia require a secure context
 * when accessed from a headset over the local network.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const DETECT = env.DETECT_PROXY_TARGET || 'http://localhost:8000';
  const DETECT_HTTP = env.DETECT_HTTP_TARGET || 'http://localhost:8010';
  const AI = env.AI_PROXY_TARGET || 'http://localhost:11434';
  const TTS = env.TTS_PROXY_TARGET || 'http://localhost:5000';

  return {
    plugins: [mkcert()],
    server: {
      host: '0.0.0.0',
      port: 8081,
      proxy: {
        '/detect': {
          target: DETECT_HTTP,
          changeOrigin: true,
        },
        '/health': {
          target: DETECT_HTTP,
          changeOrigin: true,
        },
        '/ws': {
          target: DETECT.replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
        },
        '/v1': {
          target: AI,
          changeOrigin: true,
        },
        '/tts': {
          target: TTS,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tts/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      target: 'esnext',
      sourcemap: mode !== 'production',
      // three.js (≈850 kB min) gets its own long-term-cacheable chunk;
      // app code changes then only invalidate the small app chunk.
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three/')) return 'three';
          },
        },
      },
    },
    esbuild: { target: 'esnext' },
    publicDir: 'public',
    base: './',
  };
});
