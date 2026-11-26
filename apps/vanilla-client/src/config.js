/**
 * Central engine configuration.
 *
 * Resolution order (later wins):
 *   defaults → localStorage('ci-companion-config') → URL query params
 *
 * Everything the engine talks to is pluggable: the AI backend is any
 * OpenAI-compatible API (Companion Intelligence server, Ollama, llama.cpp,
 * vLLM, OpenAI, Anthropic-compatible gateways…), speech endpoints follow the
 * OpenAI audio API (speaches / faster-whisper / Piper bridges) with browser
 * Web Speech fallbacks, and detection uses the bundled Grounding DINO server.
 */

const DEFAULTS = {
  renderer: {
    // Prefer the WebGPU backend when available. On devices that support
    // immersive XR but lack XRGPUBinding, the engine falls back to the
    // WebGL2 backend so WebXR sessions keep working.
    preferWebGPU: true,
    // Allow WebGPU + WebXR together (requires XRGPUBinding, e.g. Chrome
    // with WebXR/WebGPU bindings enabled). Off by default for safety.
    webgpuXR: false,
    maxPixelRatio: 2,
  },

  ai: {
    // OpenAI-compatible base URL. '/v1' is proxied by Vite in dev
    // (see vite.config.js → AI_PROXY_TARGET, default http://localhost:11434).
    baseUrl: '/v1',
    apiKey: '',
    model: 'llama3.2-vision',
    temperature: 0.7,
    maxTokens: 512,
    maxToolRounds: 4,
  },

  speech: {
    // 'auto' tries the OpenAI-compatible endpoint, falls back to browser APIs.
    sttMode: 'auto',           // 'auto' | 'whisper' | 'browser' | 'off'
    sttModel: 'whisper-1',
    ttsMode: 'auto',           // 'auto' | 'openai' | 'piper' | 'browser' | 'off'
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    // Used when ttsMode is 'piper': GET `${piperUrl}?text=…` → WAV.
    piperUrl: '/tts',
    language: '',
  },

  vision: {
    // Attach the latest camera frame to each user utterance (Astra-style
    // "what am I looking at" multimodal chat).
    attachFrameToChat: true,
    frameMaxSize: 768,
    frameJpegQuality: 0.8,
    // The shared detection service, POST /detect (Companion-Scan's Grounding DINO service; the
    // dev server proxies /detect to DETECT_HTTP_TARGET, default http://localhost:8010).
    // '' = same-origin /detect. A ws:// URL selects the older bundled WebSocket server instead.
    detectionUrl: '',
    // Bearer token, when the service runs with GDINO_TOKEN.
    detectionToken: '',
    detectionPrompt: 'object . person . chair . table . cup . bottle . door . screen . plant . laptop',
    detectionEnabled: true,
    boxThreshold: 0.35,
    textThreshold: 0.25,
    maxDetections: 50,
    // Non-XR mode runs detection on an interval; XR mode is stillness-gated.
    flatIntervalMs: 3000,
    maxSpatialLabels: 5,
  },

  character: {
    // Default character. Any glTF/GLB works; Ready Player Me avatar URLs
    // (https://models.readyplayer.me/<id>.glb) get viseme morph targets
    // requested automatically.
    url: './gltf/robot/robot.gltf',
    targetHeight: 1.0,         // metres; humanoid-scale models keep native size
    walkSpeed: 0.9,            // m/s
    turnSpeed: 3.0,            // rad/s
    personalSpace: 0.7,        // min distance to the user, metres
    wander: true,              // idle wandering inside the home radius
    wanderRadius: 1.6,
  },

  agent: {
    name: 'Companion',
    proactive: true,           // comment on newly seen objects while idle
    proactiveCooldownMs: 90000,
    historyLimit: 20,
    persona:
      'You are {name}, a friendly embodied AI companion sharing physical space with the user. ' +
      'You exist as a small robot avatar they can see. Be warm, curious and concise — ' +
      'you are SPEAKING out loud, so answer in 1-3 short conversational sentences unless asked for detail.',
  },

  ui: {
    showViewfinder: true,
    showHud: true,
  },
};

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

const STORAGE_KEY = 'ci-companion-config';

export function loadConfig() {
  let cfg = structuredClone(DEFAULTS);

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored) cfg = deepMerge(cfg, stored);
  } catch { /* corrupt local settings — ignore */ }

  const q = new URLSearchParams(location.search);
  if (q.has('ai_base')) cfg.ai.baseUrl = q.get('ai_base');
  if (q.has('ai_key')) cfg.ai.apiKey = q.get('ai_key');
  if (q.has('model')) cfg.ai.model = q.get('model');
  if (q.has('avatar')) cfg.character.url = q.get('avatar');
  if (q.has('gpu')) cfg.renderer.preferWebGPU = q.get('gpu') !== '0';
  if (q.has('webgpu_xr')) cfg.renderer.webgpuXR = q.get('webgpu_xr') === '1';
  if (q.has('detect')) cfg.vision.detectionEnabled = q.get('detect') !== '0';
  if (q.has('proactive')) cfg.agent.proactive = q.get('proactive') !== '0';

  return cfg;
}

/** Persist a subset of settings the user changed via the HUD. */
export function saveConfigPatch(patch) {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* reset */ }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deepMerge(stored, patch)));
}

export function resetStoredConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
