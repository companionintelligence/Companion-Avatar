import { describe, expect, it, vi } from 'vitest';

import { HttpDetectionClient, healthUrlFor, toPerceptionDetections } from './HttpDetectionClient.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('healthUrlFor', () => {
  it('puts /health beside /detect, on this origin or another', () => {
    expect(healthUrlFor('/detect')).toBe('/health');
    expect(healthUrlFor('https://beta-glass.example.ts.net:8010/detect')).toBe('https://beta-glass.example.ts.net:8010/health');
    expect(healthUrlFor('https://box.example/vision/')).toBe('https://box.example/vision/health');
  });
});

describe('toPerceptionDetections', () => {
  it('turns pixel boxes into centres as fractions of the frame', () => {
    const out = toPerceptionDetections({
      frame_width: 1000,
      frame_height: 500,
      detections: [{ label: 'cup', confidence: 0.61, bbox: [100, 100, 200, 100] }],
    });
    expect(out).toEqual([{ label: 'cup', confidence: 0.61, center: [0.2, 0.3], bbox: [100, 100, 200, 100] }]);
  });

  it('drops detections it cannot place, and replies without a frame size', () => {
    expect(toPerceptionDetections({ detections: [{ label: 'cup', bbox: [0, 0, 1, 1] }] })).toEqual([]);
    const out = toPerceptionDetections({
      frame_width: 100,
      frame_height: 100,
      detections: [
        { label: 'no box', confidence: 0.9 },
        { label: '', confidence: 0.9, bbox: [0, 0, 10, 10] },
        { label: 'short box', confidence: 0.9, bbox: [0, 0, 10] },
        { label: 'kept', confidence: 0.5, bbox: [90, 90, 40, 40] },
      ],
    });
    // A box running off the frame still gets a centre inside it.
    expect(out).toEqual([{ label: 'kept', confidence: 0.5, center: [1, 1], bbox: [90, 90, 40, 40] }]);
  });
});

describe('HttpDetectionClient', () => {
  it('sends the shared contract, with the token, and returns Perception detections', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({
        frame_width: 640,
        frame_height: 480,
        detections: [{ label: 'laptop', confidence: 0.7, bbox: [320, 240, 0, 0] }],
        inference_ms: 92,
      }),
    );
    const client = new HttpDetectionClient('https://beta-glass.example.ts.net:8010/detect', { token: 's3cret', fetchImpl });

    const result = await client.detectImage('AAAA', 'laptop . cup', { boxThreshold: 0.3, textThreshold: 0.2, maxDetections: 5 });

    expect(result).toEqual({
      detections: [{ label: 'laptop', confidence: 0.7, center: [0.5, 0.5], bbox: [320, 240, 0, 0] }],
      inference_time_ms: 92,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://beta-glass.example.ts.net:8010/detect');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer s3cret');
    expect(JSON.parse(init.body)).toEqual({
      prompt: 'laptop . cup',
      threshold: 0.3,
      text_threshold: 0.2,
      max_detections: 5,
      image_base64: 'AAAA',
    });
    expect(client.isConnected).toBe(true);
  });

  it('sends no Authorization header without a token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ frame_width: 1, frame_height: 1, detections: [] }));
    await new HttpDetectionClient('/detect', { fetchImpl }).detectImage('AAAA', 'cup');
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it('connects once the service reports its model ready, and says why when it is not', async () => {
    const onStatusChange = vi.fn();
    const ready = new HttpDetectionClient('/detect', { fetchImpl: vi.fn().mockResolvedValue(json({ status: 'ok', ready: true })) });
    ready.onStatusChange = onStatusChange;
    await ready.connect();
    expect(ready.isConnected).toBe(true);
    expect(onStatusChange).toHaveBeenCalledWith(true);

    const loading = new HttpDetectionClient('/detect', {
      fetchImpl: vi.fn().mockResolvedValue(json({ status: 'ok', ready: false, state: 'loading' })),
    });
    await expect(loading.connect()).rejects.toThrow('not ready: loading');
    expect(loading.isConnected).toBe(false);
  });

  it('reports a refused request with its status, and goes offline while the model loads', async () => {
    const client = new HttpDetectionClient('/detect', {
      fetchImpl: vi.fn().mockResolvedValue(new Response('model loading', { status: 503 })),
    });
    client.isConnected = true;
    await expect(client.detectImage('AAAA', 'cup')).rejects.toThrow('Detection failed (503): model loading');
    expect(client.isConnected).toBe(false);
  });

  it('gives up after the timeout', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const client = new HttpDetectionClient('/detect', { fetchImpl });
    await expect(client.detectImage('AAAA', 'cup', { timeoutMs: 10 })).rejects.toThrow('timed out after 10 ms');
  });
});
