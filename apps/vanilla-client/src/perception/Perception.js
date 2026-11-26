import * as THREE from 'three/webgpu';
import { CameraFeed } from './CameraFeed.js';
import { DetectionClient } from './DetectionClient.js';
import { HttpDetectionClient } from './HttpDetectionClient.js';

/**
 * Perception — the companion's eyes.
 *
 * Combines (ported from the original IWSDK app, now renderer-agnostic):
 *  - head-locked AR viewfinder: live camera plane + canvas dot overlay
 *  - stillness-gated detection in XR: fires once after the head has been
 *    still for ~700 ms; movement clears labels and re-arms the gate
 *  - FOV auto-calibration from the XR projection matrix, mapping normalized
 *    detection centers to angled rays
 *  - hit-test anchored billboard labels on real surfaces (max N, one-shot
 *    hit-test sources)
 *
 * New: every anchored detection feeds the agent's spatial memory, novel
 * labels emit 'novel-object' (proactive commentary), `captureFrame()` feeds
 * multimodal chat, and `detectNow()` is exposed as an agent tool. In flat
 * mode detection runs on an interval against the webcam with a PiP overlay
 * handled by the HUD.
 */
export class Perception {
  constructor(engine, xrSessions, hitTest, memory, config, events) {
    this.engine = engine;
    this.xr = xrSessions;
    this.hitTest = hitTest;
    this.memory = memory;
    this.config = config;
    this.events = events;

    this.camera = new CameraFeed();
    this.client = null;
    this.connected = false;

    // Stillness gate (XR) — same tuning as the original app.
    this.STILL_POS = 0.005;       // m/frame
    this.STILL_ROT = 0.008;       // rad/frame
    this.STILL_MS = 700;
    this._stillSince = 0;
    this._requiresMovement = false;
    this._poseSeeded = false;
    this._prevPos = new THREE.Vector3();
    this._prevQuat = new THREE.Quaternion();
    this._curPos = new THREE.Vector3();
    this._curQuat = new THREE.Quaternion();

    this._detecting = false;
    this._lastFlatDetect = 0;

    // Viewfinder (XR).
    this.viewfinderVisible = config.ui.showViewfinder;
    this._vf = null;              // { group, feedPlane, overlayCanvas, overlayCtx, overlayTex }

    // Spatial labels.
    this._labels = [];            // [{ mesh }]
    this._labelHeadPos = new THREE.Vector3();

    this._seenLabels = new Set();

    if (config.vision.detectionEnabled) this._connectDetector();
    events.on('xr-squeeze', () => this.toggleViewfinder());
    events.on('xr-end', () => this._teardownViewfinder());
  }

  get detectionAvailable() {
    return this.connected && this.camera.active;
  }

  _connectDetector() {
    // The shared detection service (POST /detect) by default, on this origin unless the config
    // names another. A ws:// or wss:// URL still selects the older bundled WebSocket server
    // (apps/vanilla-client/server), until the owner decides to remove it.
    const url = this.config.vision.detectionUrl || '/detect';
    this.client = /^wss?:\/\//i.test(url)
      ? new DetectionClient(url)
      : new HttpDetectionClient(url, { token: this.config.vision.detectionToken });
    this.client.onStatusChange = (up) => {
      this.connected = up;
      this.events.emit('detector-status', up);
    };
    this.client.connect().then(() => {
      this.connected = true;
      this.events.emit('detector-status', true);
    }).catch(() => {
      console.warn('[Perception] detection server unreachable');
    });
  }

  /**
   * The HTTP service has no socket to reconnect: ask its /health again, at most every 10 s unless
   * the agent is asking now. (The WebSocket client reconnects by itself.)
   */
  async _retryHttpConnect(force) {
    if (!(this.client instanceof HttpDetectionClient) || this._connecting) return;
    const now = performance.now();
    if (!force && now - (this._lastConnectAttempt ?? -Infinity) < 10_000) return;
    this._lastConnectAttempt = now;
    this._connecting = true;
    try {
      await this.client.connect();
      this.connected = true;
      this.events.emit('detector-status', true);
    } catch {
      // Still down or still loading its model; the next attempt says so again.
    } finally {
      this._connecting = false;
    }
  }

  async startCamera() {
    try {
      await this.camera.start();
      this.events.emit('camera-status', true);
    } catch (err) {
      this.events.emit('toast', `Camera unavailable: ${err.message ?? err}`);
    }
  }

  /** JPEG data URL of the current camera frame (starts the camera lazily). */
  async captureFrame() {
    if (!this.camera.active) await this.startCamera();
    return this.camera.captureFrame(
      this.config.vision.frameMaxSize,
      this.config.vision.frameJpegQuality,
    );
  }

  /** Run detection now (agent tool). Returns detections with directions. */
  async detectNow(prompt) {
    if (!this.detectionAvailable) {
      if (!this.camera.active) await this.startCamera();
      if (!this.connected) await this._retryHttpConnect(true);
      if (!this.detectionAvailable) return [];
    }
    const result = await this.client.detect(
      this.camera.video,
      prompt || this.config.vision.detectionPrompt,
      {
        boxThreshold: this.config.vision.boxThreshold,
        textThreshold: this.config.vision.textThreshold,
        maxDetections: this.config.vision.maxDetections,
      },
    );
    const detections = result.detections ?? [];
    this._ingest(detections);
    this._drawOverlay(detections);
    if (this.engine.presenting) this._placeSpatialLabels(detections);
    return detections.map((d) => ({ ...d, direction: this._direction(d.center[0]) }));
  }

  _direction(cx) {
    if (cx < 0.33) return 'to the left';
    if (cx > 0.66) return 'to the right';
    return 'ahead';
  }

  toggleViewfinder() {
    this.viewfinderVisible = !this.viewfinderVisible;
    if (this._vf) this._vf.group.visible = this.viewfinderVisible;
  }

  update(ctx) {
    if (!this.config.vision.detectionEnabled) return;

    if (ctx.presenting && this.xr.isAR) {
      if (this.camera.active) this._ensureViewfinder();
      this._stillnessGate(ctx);
    } else {
      this._flatCadence(ctx);
    }

    // Billboard the spatial labels.
    if (this._labels.length) {
      this.engine.getHeadPose(this._labelHeadPos);
      for (const { mesh } of this._labels) mesh.lookAt(this._labelHeadPos);
    }
  }

  // ----- detection cadence -----

  _stillnessGate({ dt }) {
    if (!this.connected || !this.camera.active) return;

    this.engine.getHeadPose(this._curPos, this._curQuat);
    if (!this._poseSeeded) {
      this._prevPos.copy(this._curPos);
      this._prevQuat.copy(this._curQuat);
      this._poseSeeded = true;
      return;
    }

    const dPos = this._curPos.distanceTo(this._prevPos);
    const dRot = this._prevQuat.angleTo(this._curQuat);
    this._prevPos.copy(this._curPos);
    this._prevQuat.copy(this._curQuat);

    const isStill = dPos < this.STILL_POS && dRot < this.STILL_ROT;
    if (!isStill) {
      if (this._labels.length) this._clearLabels();
      this._clearOverlayCanvas();
      this._stillSince = 0;
      this._requiresMovement = false;
      return;
    }

    if (this._requiresMovement || this._detecting) return;
    const now = performance.now();
    if (this._stillSince === 0) {
      this._stillSince = now;
      return;
    }
    if (now - this._stillSince < this.STILL_MS) return;

    this._requiresMovement = true;
    this._fireDetection();
  }

  _flatCadence() {
    if (!this.connected) void this._retryHttpConnect(false);
    if (!this.connected || !this.camera.active || this._detecting) return;
    const now = performance.now();
    if (now - this._lastFlatDetect < this.config.vision.flatIntervalMs) return;
    this._lastFlatDetect = now;
    this._fireDetection();
  }

  _fireDetection() {
    this._detecting = true;
    this.client.detect(this.camera.video, this.config.vision.detectionPrompt, {
      boxThreshold: this.config.vision.boxThreshold,
      textThreshold: this.config.vision.textThreshold,
      maxDetections: this.config.vision.maxDetections,
    }).then((result) => {
      const detections = result.detections ?? [];
      this._ingest(detections);
      this._drawOverlay(detections);
      if (this.engine.presenting) this._placeSpatialLabels(detections);
      this.events.emit('detections', detections);
    }).catch((err) => {
      console.warn('[Perception] detection failed:', err.message ?? err);
    }).finally(() => {
      this._detecting = false;
    });
  }

  _ingest(detections) {
    for (const det of detections) {
      const novel = this.memory.rememberDetection(det.label, {
        confidence: det.confidence,
        bearing: det.center[0],
      });
      if (novel && !this._seenLabels.has(det.label)) {
        this._seenLabels.add(det.label);
        this.events.emit('novel-object', det.label);
      }
    }
  }

  // ----- XR viewfinder (head-locked camera plane + dot overlay) -----

  _ensureViewfinder() {
    if (this._vf) return;
    const video = this.camera.video;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const planeW = 0.24;
    const planeH = planeW * (vh / vw);

    const group = new THREE.Group();
    group.name = 'viewfinder';

    const feedTex = new THREE.VideoTexture(video);
    feedTex.colorSpace = THREE.SRGBColorSpace;
    const feedPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({ map: feedTex }),
    );
    group.add(feedPlane);

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = vw;
    overlayCanvas.height = vh;
    const overlayCtx = overlayCanvas.getContext('2d');
    const overlayTex = new THREE.CanvasTexture(overlayCanvas);
    const overlayPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthWrite: false }),
    );
    overlayPlane.position.z = 0.0005;
    group.add(overlayPlane);

    group.position.set(0, -0.05, -0.4);
    group.visible = this.viewfinderVisible;
    this.engine.camera.add(group);

    this._vf = { group, overlayCanvas, overlayCtx, overlayTex };
  }

  _teardownViewfinder() {
    if (!this._vf) return;
    this.engine.camera.remove(this._vf.group);
    this._vf = null;
    this._clearLabels();
    this._poseSeeded = false;
    this._stillSince = 0;
    this._requiresMovement = false;
  }

  _drawOverlay(detections) {
    // XR overlay canvas; in flat mode the HUD draws its own PiP overlay.
    this.events.emit('flat-detections', detections);
    if (!this._vf) return;
    const { overlayCtx: ctx, overlayCanvas: canvas, overlayTex } = this._vf;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (const det of detections) {
      const cx = det.center[0] * w;
      const cy = det.center[1] * h;
      const r = Math.max(14, w * 0.01);

      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,136,0.25)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#00ff88';
      ctx.fill();

      const text = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      const fontSize = Math.max(22, w * 0.016);
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      const pillW = ctx.measureText(text).width + 18;
      const pillH = fontSize * 1.7;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.roundRect(cx - pillW / 2, Math.max(0, cy - r - pillH - 8), pillW, pillH, 8);
      ctx.fill();
      ctx.fillStyle = '#00ff88';
      ctx.fillText(text, cx - pillW / 2 + 9, Math.max(pillH - 8, cy - r - 8 - pillH * 0.28));
    }
    overlayTex.needsUpdate = true;
  }

  _clearOverlayCanvas() {
    if (!this._vf) return;
    const { overlayCtx, overlayCanvas, overlayTex } = this._vf;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayTex.needsUpdate = true;
  }

  // ----- spatial labels (hit-test anchored, billboarded) -----

  async _placeSpatialLabels(detections) {
    this._clearLabels();
    const fov = this.engine.getViewFov();
    const top = [...detections]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.vision.maxSpatialLabels);

    await Promise.all(top.map(async (det) => {
      const [cxN, cyN] = det.center;
      // Normalized frame position → viewer-relative ray angles (negated
      // horizontally to match the passthrough stream orientation).
      const angleH = -(cxN - 0.5) * fov.h;
      const angleV = -(cyN - 0.5) * fov.v;

      const { position, hit } = await this.hitTest.castFromViewer(angleH, angleV);
      this.memory.rememberDetection(det.label, {
        position,
        confidence: det.confidence,
        bearing: cxN,
      });

      const mesh = this._makeLabelMesh(det.label, det.confidence, hit);
      mesh.position.copy(position).add(new THREE.Vector3(0, 0.12, 0));
      this.engine.scene.add(mesh);
      this._labels.push({ mesh });
    }));
  }

  _clearLabels() {
    for (const { mesh } of this._labels) {
      this.engine.scene.remove(mesh);
      mesh.material?.map?.dispose?.();
      mesh.material?.dispose?.();
      mesh.geometry?.dispose?.();
    }
    this._labels = [];
  }

  _makeLabelMesh(label, confidence, anchored) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 120, 24);
    ctx.fill();
    ctx.strokeStyle = anchored ? '#00ff88' : '#ffb347';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.fillStyle = anchored ? '#00ff88' : '#ffb347';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} ${(confidence * 100).toFixed(0)}%`, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.075),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
  }
}
