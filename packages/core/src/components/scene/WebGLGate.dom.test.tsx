import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebGLGate } from './WebGLGate'

describe('WebGLGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a WebGL unavailable message and skips its children when WebGL2 is missing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const Child = vi.fn(() => <div>scene</div>)

    const { container } = render(
      <WebGLGate>
        <Child />
      </WebGLGate>
    )

    expect(container.textContent).toContain('WebGL unavailable')
    expect(Child).not.toHaveBeenCalled()
  })

  it('renders its children when WebGL2 is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)

    const { container } = render(
      <WebGLGate>
        <div>scene</div>
      </WebGLGate>
    )

    expect(container.textContent).toContain('scene')
    expect(container.textContent).not.toContain('WebGL unavailable')
  })
})
