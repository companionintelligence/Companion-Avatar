import { Hono } from 'hono'

import { resolveConfig } from '../config.js'
import { selectTtsUpstream } from '../upstreams/cosyvoice.js'
import { selectUpstream } from '../upstreams/index.js'

export const healthRoutes = new Hono()

/**
 * GET /api/health — reports the resolved chat upstream, default model, a
 * reachability probe (surfaces host.docker.internal DNS/connectivity problems),
 * and a nested `tts` block for the TTS upstream (voice model + reachability).
 */
healthRoutes.get('/health', async (c) => {
  const cfg = resolveConfig()
  const adapter = selectUpstream(cfg)
  const probe = await adapter.health()
  const model = cfg.upstream === 'openai' ? cfg.openaiModel : cfg.ollamaModel

  const ttsAdapter = selectTtsUpstream(cfg)
  const ttsProbe = await ttsAdapter.health()
  const memoryConfigured = cfg.upstream === 'ci-server'

  return c.json({
    status: probe.ok && ttsProbe.ok ? 'ok' : 'degraded',
    upstream: adapter.name,
    model,
    reachable: probe.ok,
    detail: probe.detail,
    memory: {
      configured: memoryConfigured,
      reachable: memoryConfigured && probe.ok,
      detail: memoryConfigured ? probe.detail : 'CI-Server is not selected'
    },
    tts: {
      upstream: ttsAdapter.name,
      model: cfg.ttsModel,
      // The voice asked for when the browser names none. Absent when the proxy asks for none and the upstream picks.
      voice: cfg.ttsVoice || ttsAdapter.defaultVoice,
      reachable: ttsProbe.ok,
      detail: ttsProbe.detail
    }
  })
})
