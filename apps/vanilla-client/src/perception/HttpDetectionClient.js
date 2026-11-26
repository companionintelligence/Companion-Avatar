/**
 * HttpDetectionClient — open-vocabulary detection through the shared detection service.
 *
 * The scanner's Grounding DINO service speaks this contract (Companion-Scan
 * `scripts/grounding_dino_server.py`, #315; it runs on beta-glass at :8010), and so does the
 * ZeroShot client of the Unity avatar prototype, so one service serves every product:
 *
 *   POST {endpoint}
 *     {"prompt": "a cup, a laptop", "threshold": 0.35, "text_threshold": 0.25,
 *      "max_detections": 50, "image_base64": "<JPEG, base64>"}
 *   -> {"frame_width": 1280, "frame_height": 960,
 *       "detections": [{"label": "cup", "confidence": 0.61, "bbox": [x, y, w, h]}]}
 *   GET  {endpoint without /detect}/health -> {"status": "ok", "ready": true, ...}
 *
 * `bbox` is in pixels of the frame as sent, origin top left. With a token, requests carry
 * "Authorization: Bearer <token>" (the service's GDINO_TOKEN).
 *
 * It hands Perception what the WebSocket client for the bundled server did: a label, a
 * confidence and the box centre normalised to 0..1.
 */
export class HttpDetectionClient {
  /**
   * @param {string} endpoint  the POST /detect URL: absolute, or a path on this origin
   * @param {{ token?: string, fetchImpl?: typeof fetch }} [options]
   */
  constructor(endpoint, { token = '', fetchImpl } = {}) {
    this.endpoint = endpoint;
    this.token = token;
    this._fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.isConnected = false;
    this.onStatusChange = null;
  }

  /** The service's health route: the endpoint with its last path segment replaced by `health`. */
  get healthUrl() {
    return healthUrlFor(this.endpoint);
  }

  _headers(json) {
    const headers = { accept: 'application/json' };
    if (json) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }

  /** Resolves once the service says its model is loaded; rejects with the reason otherwise. */
  async connect() {
    const response = await this._fetch(this.healthUrl, { headers: this._headers(false), cache: 'no-store' });
    if (!response.ok) throw new Error(`Detection service health check failed (${response.status})`);
    const health = await response.json();
    if (health?.ready !== true) {
      throw new Error(`Detection service is not ready: ${health?.error ?? health?.state ?? 'unknown state'}`);
    }
    this._setConnected(true);
  }

  _setConnected(up) {
    if (this.isConnected === up) return;
    this.isConnected = up;
    this.onStatusChange?.(up);
  }

  /**
   * Detect in a video or canvas frame.
   * @param {HTMLVideoElement|HTMLCanvasElement} source
   */
  async detect(source, prompt, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth ?? source.width;
    canvas.height = source.videoHeight ?? source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return this.detectImage(dataUrl.slice(dataUrl.indexOf(',') + 1), prompt, options);
  }

  /**
   * Detect in an already-encoded frame.
   * @param {string} imageBase64  a JPEG or PNG, base64, without a data: prefix
   * @returns {Promise<{detections: Array<{label: string, confidence: number, center: [number, number], bbox: number[]}>, inference_time_ms?: number}>}
   */
  async detectImage(imageBase64, prompt, { boxThreshold = 0.35, textThreshold = 0.25, maxDetections = 50, timeoutMs = 10000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this._fetch(this.endpoint, {
        method: 'POST',
        headers: this._headers(true),
        body: JSON.stringify({
          prompt,
          threshold: boxThreshold,
          text_threshold: textThreshold,
          max_detections: maxDetections,
          image_base64: imageBase64,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      this._setConnected(false);
      throw controller.signal.aborted ? new Error(`Detection timed out after ${timeoutMs} ms`) : err;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      // 503 while the model loads, 401 without the right token: say which.
      const detail = await response.text().catch(() => '');
      if (response.status === 503) this._setConnected(false);
      throw new Error(`Detection failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    const reply = await response.json();
    this._setConnected(true);
    return { detections: toPerceptionDetections(reply), inference_time_ms: reply?.inference_ms };
  }
}

/** `…/detect` becomes `…/health`; any other path gets `/health` beside it. */
export function healthUrlFor(endpoint) {
  const trimmed = String(endpoint).replace(/\/+$/, '');
  return /\/detect$/.test(trimmed) ? trimmed.replace(/\/detect$/, '/health') : `${trimmed}/health`;
}

/**
 * The service's reply as Perception's detections: label, confidence, and the box centre as a
 * fraction of the frame. A detection without a usable box or frame size is dropped.
 */
export function toPerceptionDetections(reply) {
  const width = Number(reply?.frame_width);
  const height = Number(reply?.frame_height);
  if (!(width > 0) || !(height > 0) || !Array.isArray(reply?.detections)) return [];
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const out = [];
  for (const det of reply.detections) {
    const box = det?.bbox;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => Number.isFinite(v))) continue;
    const label = String(det.label ?? '').trim();
    if (!label) continue;
    const [x, y, w, h] = box;
    out.push({
      label,
      confidence: Number.isFinite(det.confidence) ? det.confidence : 0,
      center: [clamp((x + w / 2) / width), clamp((y + h / 2) / height)],
      bbox: box,
    });
  }
  return out;
}
