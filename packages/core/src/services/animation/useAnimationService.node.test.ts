import { useGLTF } from '@react-three/drei'
import { useLoader } from '@react-three/fiber'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { useAnimationService } from './useAnimationService'

// Mock R3F and drei so any preload is observable and the node run makes no network request.
vi.mock('@react-three/fiber', () => ({
  useLoader: Object.assign(vi.fn(), { preload: vi.fn() })
}))
vi.mock('@react-three/drei', () => ({
  useGLTF: Object.assign(vi.fn(), { preload: vi.fn() })
}))

// The hook is plain state plus useRef/useCallback/useMemo. Run those without a renderer.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(factory: () => T) => factory()
  }
})

// T6: a module-scope useLoader.preload cached a failed fetch for the page lifetime and fetched each
// VRMA twice. Nothing may preload on import; the consumer loads each VRMA itself.
describe('useAnimationService runs no module-scope preload (T6)', () => {
  it('does not preload any VRMA on import', () => {
    expect(vi.mocked(useLoader.preload)).not.toHaveBeenCalled()
    expect(vi.mocked(useGLTF.preload)).not.toHaveBeenCalled()
  })

  it('leaves the consumer loading VRMA with the Addons GLTFLoader and the VRMA plugin', () => {
    // AvatarModel's useExternalAnimations is the only VRMA loader. Importing it would pull the whole
    // renderer into this node run, so its source is checked for the loader it uses.
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '../../components/scene/avatar/AvatarModel.tsx'), 'utf8')
    expect(source).toMatch(/import \{[^}]*\bGLTFLoader\b[^}]*\} from 'three\/examples\/jsm\/Addons\.js'/)
    expect(source).toMatch(/useLoader\(\s*GLTFLoader\s*,\s*clip\.path/)
    expect(source).toMatch(/new VRMAnimationLoaderPlugin\(parser\)/)
  })
})

// M21: enableCycling must drive only the cycling flag. It must not touch the master gate.
describe('useAnimationService.enableCycling leaves the master gate alone (M21)', () => {
  it('turns cycling on while the service stays enabled', () => {
    const { actions, state } = useAnimationService()
    actions.enableCycling(true)
    expect(state.cyclingState.cyclingEnabled).toBe(true)
    expect(state.enabled).toBe(true)
  })

  it('does not re-enable a service whose master gate is off', () => {
    const { actions, state } = useAnimationService()
    actions.setEnabled(false)
    actions.enableCycling(true)
    expect(state.enabled).toBe(false)
    expect(state.cyclingState.cyclingEnabled).toBe(true)
  })
})
