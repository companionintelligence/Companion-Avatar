import { describe, expect, it } from 'vitest'

import { FaceCompositor } from './FaceCompositor'
import { MOUTH_REGIONS } from './regions'
import type { FaceRig, LayerSpec } from './types'

/** Records every write so a test can assert what actually reached the rig. */
class RecordingRig implements FaceRig {
  readonly writes: [string, number][] = []
  readonly values = new Map<string, number>()
  constructor(private readonly known: Set<string> | null = null) {}
  has(key: string) {
    return this.known ? this.known.has(key) : true
  }
  write(key: string, value: number) {
    this.writes.push([key, value])
    this.values.set(key, value)
  }
}

const LAYERS: LayerSpec[] = [
  { id: 'base', priority: 0, blend: 'replace' },
  { id: 'emotion', priority: 10, blend: 'max', owns: ['brows', 'eyelids', 'cheeks', 'lips', 'nose'] },
  { id: 'speech', priority: 20, blend: 'replace', owns: ['jaw', 'lips', 'tongue'] },
  { id: 'vitality', priority: 30, blend: 'max', owns: ['eyelids', 'gaze', 'brows', 'cheeks'] },
  { id: 'override', priority: 100, blend: 'replace' }
]

const make = () => new FaceCompositor(LAYERS)
const FRAME = 1 / 60

describe('FaceCompositor — arbitration', () => {
  it('lets a higher-priority replace layer win the same key', () => {
    const c = make()
    c.begin()
    c.set('base', 'jawOpen', 0.2)
    c.set('speech', 'jawOpen', 0.8)
    expect(c.resolve(FRAME).get('jawOpen')).toBeCloseTo(0.8)
  })

  it('takes the max across max-blend layers rather than summing them', () => {
    const c = make()
    c.begin()
    c.set('emotion', 'browInnerUp', 0.6)
    c.set('vitality', 'browInnerUp', 0.3)
    // Summing would read as a permanent shocked forehead.
    expect(c.resolve(FRAME).get('browInnerUp')).toBeCloseTo(0.6)
  })

  it('drops a contribution to a region the layer does not own', () => {
    const c = make()
    c.begin()
    // The speech layer owns no eyelids; this must not reach the rig at all.
    c.set('speech', 'eyeBlinkLeft', 1)
    expect(c.resolve(FRAME).has('eyeBlinkLeft')).toBe(false)
  })

  it('suppresses lower layers inside a claimed region', () => {
    const c = make()
    c.begin()
    c.claim('speech', MOUTH_REGIONS)
    c.set('emotion', 'mouthSmileLeft', 1)
    c.set('speech', 'mouthSmileLeft', 0.1)
    // This is the whole point: a grin cannot flatten a viseme mid-word.
    expect(c.resolve(FRAME).get('mouthSmileLeft')).toBeCloseTo(0.1)
  })

  it('lets emotion own the mouth again once speech releases the claim', () => {
    const c = make()
    c.begin()
    c.claim('speech', MOUTH_REGIONS)
    c.set('emotion', 'mouthSmileLeft', 1)
    c.set('speech', 'mouthSmileLeft', 0.1)
    c.resolve(FRAME)

    c.begin() // next frame: not speaking, no claim
    c.set('emotion', 'mouthSmileLeft', 1)
    expect(c.resolve(FRAME).get('mouthSmileLeft')).toBeCloseTo(1)
  })

  it('lets a claim be overridden by a strictly higher-priority layer', () => {
    const c = make()
    c.begin()
    c.claim('speech', MOUTH_REGIONS)
    c.set('speech', 'jawOpen', 0.2)
    c.set('override', 'jawOpen', 0.9)
    expect(c.resolve(FRAME).get('jawOpen')).toBeCloseTo(0.9)
  })

  it('is insensitive to the order producers claim in', () => {
    const a = make()
    a.begin()
    a.claim('speech', MOUTH_REGIONS)
    a.claim('emotion', MOUTH_REGIONS)
    a.set('emotion', 'mouthFunnel', 1)
    a.set('speech', 'mouthFunnel', 0.25)

    const b = make()
    b.begin()
    b.claim('emotion', MOUTH_REGIONS)
    b.claim('speech', MOUTH_REGIONS)
    b.set('emotion', 'mouthFunnel', 1)
    b.set('speech', 'mouthFunnel', 0.25)

    expect(a.resolve(FRAME).get('mouthFunnel')).toBeCloseTo(b.resolve(FRAME).get('mouthFunnel')!)
    expect(a.resolve(FRAME).get('mouthFunnel')).toBeCloseTo(0.25)
  })

  it('ignores NaN instead of blanking the mesh', () => {
    const c = make()
    c.begin()
    c.set('speech', 'jawOpen', Number.NaN)
    expect(c.resolve(FRAME).has('jawOpen')).toBe(false)
  })

  it('clamps out-of-range contributions', () => {
    const c = make()
    c.begin()
    c.set('speech', 'jawOpen', 4)
    c.set('speech', 'mouthClose', -2)
    const r = c.resolve(FRAME)
    expect(r.get('jawOpen')).toBe(1)
    expect(r.get('mouthClose')).toBe(0)
  })
})

describe('FaceCompositor — release', () => {
  it('ramps an abandoned key back to rest instead of leaving it stuck', () => {
    const c = make()
    c.begin()
    c.set('speech', 'jawOpen', 1)
    expect(c.resolve(FRAME).get('jawOpen')).toBe(1)

    const rig = new RecordingRig()
    c.begin()
    c.set('speech', 'jawOpen', 1)
    c.applyTo(rig, FRAME)

    // Nobody writes jawOpen from here on — it must fall, not hold.
    let last = 1
    for (let i = 0; i < 40; i++) {
      c.begin()
      c.applyTo(rig, FRAME)
      const now = rig.values.get('jawOpen')!
      expect(now).toBeLessThanOrEqual(last)
      last = now
    }
    expect(last).toBe(0)
  })

  it('reports releasing keys in the trace', () => {
    const c = make()
    const rig = new RecordingRig()
    c.begin()
    c.set('emotion', 'browInnerUp', 1)
    c.applyTo(rig, FRAME)

    c.begin()
    c.applyTo(rig, FRAME)
    expect(c.trace().releasing).toContain('browInnerUp')
  })

  it('reset() closes the mouth immediately rather than over a ramp', () => {
    const c = make()
    const rig = new RecordingRig()
    c.begin()
    c.set('speech', 'jawOpen', 1)
    c.applyTo(rig, FRAME)

    c.reset(rig)
    expect(rig.values.get('jawOpen')).toBe(0)
  })

  it('reset() with no rig closes the rig the compositor has been driving', () => {
    // Barge-in reaches the compositor through resetActiveFace(), which has no rig to hand over. The
    // compositor forgets the keys it sent either way; the rig has to be told, or it keeps them for good.
    const c = make()
    const rig = new RecordingRig()
    c.begin()
    c.set('speech', 'jawOpen', 1)
    c.set('emotion', 'mouthSmileLeft', 0.6)
    c.applyTo(rig, FRAME)

    c.reset()
    expect(rig.values.get('jawOpen')).toBe(0)
    expect(rig.values.get('mouthSmileLeft')).toBe(0)
  })

  it('reset() commits the rig it closes', () => {
    const c = make()
    let commits = 0
    const rig = new (class extends RecordingRig {
      commit() {
        commits++
      }
    })()
    c.begin()
    c.set('speech', 'jawOpen', 1)
    c.applyTo(rig, FRAME)
    expect(commits).toBe(1)

    c.reset()
    expect(commits).toBe(2)
  })

  it('reset() before the compositor has driven any rig is harmless', () => {
    expect(() => make().reset()).not.toThrow()
  })

  it('reset() closes the rig it is handed, and that rig is the one a later reset() closes', () => {
    const c = make()
    const old = new RecordingRig()
    const next = new RecordingRig()
    c.begin()
    c.set('speech', 'jawOpen', 1)
    c.applyTo(old, FRAME)

    // An avatar swap: the new head is introduced with an explicit rig.
    c.reset(next)
    old.writes.length = 0
    c.begin()
    c.set('speech', 'jawOpen', 0.5)
    c.applyTo(next, FRAME)

    c.reset()
    expect(next.values.get('jawOpen')).toBe(0)
    expect(old.writes).toEqual([])
  })

  it('writes everything in full on the first frame after a reset', () => {
    const c = make()
    const rig = new RecordingRig()
    c.begin()
    c.set('emotion', 'mouthSmileLeft', 0.6)
    c.applyTo(rig, FRAME)

    c.reset()
    rig.writes.length = 0
    c.begin()
    c.set('emotion', 'mouthSmileLeft', 0.6)
    c.applyTo(rig, FRAME)
    expect(rig.writes).toEqual([['mouthSmileLeft', 0.6]])
  })
})

describe('FaceCompositor — rig writes', () => {
  it('writes each key at most once per frame', () => {
    const c = make()
    const rig = new RecordingRig()
    c.begin()
    c.set('base', 'jawOpen', 0.2)
    c.set('speech', 'jawOpen', 0.9)
    c.set('override', 'jawOpen', 0.5)
    c.applyTo(rig, FRAME)
    expect(rig.writes.filter(([k]) => k === 'jawOpen')).toHaveLength(1)
  })

  it('skips redundant writes when the value has not moved', () => {
    const c = make()
    const rig = new RecordingRig()
    for (let i = 0; i < 3; i++) {
      c.begin()
      c.set('emotion', 'browInnerUp', 0.5)
      c.applyTo(rig, FRAME)
    }
    expect(rig.writes.filter(([k]) => k === 'browInnerUp')).toHaveLength(1)
  })

  it('does not write keys the rig cannot drive', () => {
    const c = make()
    const rig = new RecordingRig(new Set(['jawOpen']))
    c.begin()
    c.set('speech', 'jawOpen', 0.5)
    c.set('speech', 'tongueOut', 0.5)
    c.applyTo(rig, FRAME)
    expect(rig.writes.map(([k]) => k)).toEqual(['jawOpen'])
  })

  it('rejects an unknown layer id loudly', () => {
    const c = make()
    c.begin()
    expect(() => c.set('nope', 'jawOpen', 1)).toThrow(/unknown layer/)
  })

  it('rejects a duplicate layer id', () => {
    expect(() => new FaceCompositor([...LAYERS, { id: 'base', priority: 1, blend: 'max' }])).toThrow(
      /duplicate layer/
    )
  })
})

describe('FaceCompositor — trace', () => {
  it('names the layer that won each region', () => {
    const c = make()
    c.begin()
    c.claim('speech', MOUTH_REGIONS)
    c.set('speech', 'jawOpen', 0.7)
    c.set('vitality', 'eyeBlinkLeft', 1)
    c.resolve(FRAME)

    const trace = c.trace()
    expect(trace.regions.find((r) => r.region === 'jaw')).toMatchObject({ winner: 'speech', exclusive: true })
    expect(trace.regions.find((r) => r.region === 'eyelids')).toMatchObject({
      winner: 'vitality',
      exclusive: false
    })
  })
})
