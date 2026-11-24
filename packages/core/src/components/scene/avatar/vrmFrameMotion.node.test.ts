import { describe, expect, it, vi } from 'vitest'

import { updateVrmFrameMotion } from './vrmFrameMotion'

/**
 * A stub VRM that records the order its per-frame components are ticked in. The
 * humanoid, expression manager and whole-VRM update are spies too: the frame must
 * not reach them, because the mixer, gaze and face compositor already drive that state.
 */
const stubVrm = () => {
  const order: string[] = []
  const tick = (name: string) => vi.fn(() => void order.push(name))
  const vrm = {
    lookAt: { update: tick('lookAt') },
    nodeConstraintManager: { update: tick('nodeConstraint') },
    springBoneManager: { update: tick('springBone') },
    materials: [{ update: tick('material') }, {}],
    humanoid: { update: vi.fn() },
    expressionManager: { update: vi.fn() },
    update: vi.fn()
  }
  return { vrm, order }
}

describe('updateVrmFrameMotion', () => {
  it('ticks look-at, node constraints, spring bones and material updates once each, with the delta', () => {
    const { vrm } = stubVrm()

    updateVrmFrameMotion(vrm, 0.016)

    expect(vrm.lookAt.update).toHaveBeenCalledTimes(1)
    expect(vrm.lookAt.update).toHaveBeenCalledWith(0.016)
    expect(vrm.nodeConstraintManager.update).toHaveBeenCalledTimes(1)
    expect(vrm.springBoneManager.update).toHaveBeenCalledTimes(1)
    expect(vrm.springBoneManager.update).toHaveBeenCalledWith(0.016)
    expect(vrm.materials[0].update).toHaveBeenCalledTimes(1)
    expect(vrm.materials[0].update).toHaveBeenCalledWith(0.016)
  })

  it('does not drive the humanoid, the expression manager or the whole VRM update', () => {
    const { vrm } = stubVrm()

    updateVrmFrameMotion(vrm, 0.016)

    expect(vrm.update).not.toHaveBeenCalled()
    expect(vrm.humanoid.update).not.toHaveBeenCalled()
    expect(vrm.expressionManager.update).not.toHaveBeenCalled()
  })

  it('ticks in the order VRM.update uses, so spring chains hang off the constrained pose', () => {
    const { vrm, order } = stubVrm()

    updateVrmFrameMotion(vrm, 0.016)

    expect(order).toEqual(['lookAt', 'nodeConstraint', 'springBone', 'material'])
  })

  it('tolerates a VRM that has none of the optional components', () => {
    expect(() => updateVrmFrameMotion({}, 0.016)).not.toThrow()
  })
})
