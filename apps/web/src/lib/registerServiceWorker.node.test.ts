import { describe, expect, it, vi } from 'vitest'

import { SERVICE_WORKER_URL, registerServiceWorker, type RegistrationHost } from './registerServiceWorker'

interface FakeOptions {
  readyState?: DocumentReadyState
  /** `null`: a browser with no `navigator.serviceWorker` at all (plain http, an old WebView). */
  serviceWorker?: RegistrationHost['navigator']['serviceWorker'] | null
  capacitor?: RegistrationHost['Capacitor']
  /** The Tauri desktop shell, which injects `__TAURI_INTERNALS__` before any page script. */
  tauri?: boolean
  /** Fire the `load` listener as soon as it is added, as if the page had finished loading. */
  fireLoad?: boolean
}

function fakeWindow({ readyState = 'complete', serviceWorker, capacitor, tauri = false, fireLoad = true }: FakeOptions = {}) {
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration))
  const addEventListener = vi.fn((_type: 'load', listener: () => void, _options: { once: boolean }) => {
    if (fireLoad) listener()
  })
  const win: RegistrationHost = {
    navigator: serviceWorker === null ? {} : { serviceWorker: serviceWorker ?? { register } },
    document: { readyState },
    addEventListener,
    Capacitor: capacitor,
    __TAURI_INTERNALS__: tauri ? {} : undefined
  }
  return { win, register, addEventListener }
}

describe('registerServiceWorker', () => {
  it('registers /sw.js with the whole origin as its scope', () => {
    const { win, register } = fakeWindow()

    expect(registerServiceWorker({ production: true, win })).toBe(true)
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: '/' })
    expect(SERVICE_WORKER_URL).toBe('/sw.js')
  })

  it('waits for the page to load, so the worker never competes with the first render', () => {
    const { win, register, addEventListener } = fakeWindow({ readyState: 'loading', fireLoad: false })

    registerServiceWorker({ production: true, win })
    expect(register).not.toHaveBeenCalled()

    const [type, listener, options] = addEventListener.mock.calls[0]
    expect(type).toBe('load')
    expect(options).toEqual({ once: true })
    listener()
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('does nothing outside a production build (the default under the test runner)', () => {
    const { win, register } = fakeWindow()

    expect(registerServiceWorker({ win })).toBe(false)
    expect(registerServiceWorker({ production: false, win })).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('does nothing where the browser has no service workers (plain http, old WebViews)', () => {
    const { win } = fakeWindow({ serviceWorker: null })

    expect(registerServiceWorker({ production: true, win })).toBe(false)
  })

  it('does nothing inside a Capacitor shell, which would load this bundle from the app itself', () => {
    const { win, register } = fakeWindow({ capacitor: { isNativePlatform: () => true } })

    expect(registerServiceWorker({ production: true, win })).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('does nothing inside the Tauri desktop shell, which would load this bundle from the app itself', () => {
    const { win, register } = fakeWindow({ tauri: true })

    expect(registerServiceWorker({ production: true, win })).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('still registers in a browser that happens to define window.Capacitor', () => {
    const { win } = fakeWindow({ capacitor: { isNativePlatform: () => false } })

    expect(registerServiceWorker({ production: true, win })).toBe(true)
  })

  it('logs a failed registration and does not throw, because the app works without the worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { win } = fakeWindow({ serviceWorker: { register: vi.fn(() => Promise.reject(new Error('blocked'))) } })

    registerServiceWorker({ production: true, win })
    await Promise.resolve()
    await Promise.resolve()

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('is quiet when it has nothing to do: no warning outside production, without workers, or in a native shell', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    registerServiceWorker({ production: false, win: fakeWindow().win })
    registerServiceWorker({ production: true, win: fakeWindow({ serviceWorker: null }).win })
    registerServiceWorker({ production: true, win: fakeWindow({ capacitor: { isNativePlatform: () => true } }).win })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

// main.tsx calls registerServiceWorker() before the app is mounted, so a throw from it would
// stop the app from starting for the sake of an optional feature. Each of these is a way a
// browser or a shell can make one of its accesses throw.
describe('registerServiceWorker never throws', () => {
  /** What Chrome raises for merely reading `navigator.serviceWorker` in a sandboxed iframe without allow-same-origin. */
  const securityError = () =>
    new DOMException(
      "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.",
      'SecurityError'
    )

  /** Runs the call with console.warn silenced, and returns what it returned and how often it warned. */
  function attempt(win: RegistrationHost) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      return { started: registerServiceWorker({ production: true, win }), warned: warn.mock.calls.length }
    } finally {
      warn.mockRestore()
    }
  }

  it('returns false when merely reading navigator.serviceWorker raises a SecurityError', () => {
    const { win, addEventListener } = fakeWindow()
    Object.defineProperty(win.navigator, 'serviceWorker', {
      get() {
        throw securityError()
      }
    })

    expect(() => attempt(win)).not.toThrow()
    expect(attempt(win)).toEqual({ started: false, warned: 1 })
    expect(addEventListener).not.toHaveBeenCalled()
  })

  it('returns false when asking a Capacitor shell whether it is native throws', () => {
    const { win, register } = fakeWindow({
      capacitor: {
        isNativePlatform: () => {
          throw new Error('bridge not ready')
        }
      }
    })

    expect(attempt(win)).toEqual({ started: false, warned: 1 })
    expect(register).not.toHaveBeenCalled()
  })

  it('returns false when reading the document state, or adding the load listener, throws', () => {
    const noState = fakeWindow()
    Object.defineProperty(noState.win.document, 'readyState', {
      get() {
        throw new Error('document is gone')
      }
    })
    const noListener = fakeWindow({ readyState: 'loading', fireLoad: false })
    noListener.addEventListener.mockImplementation(() => {
      throw new Error('window is gone')
    })

    expect(attempt(noState.win)).toEqual({ started: false, warned: 1 })
    expect(attempt(noListener.win)).toEqual({ started: false, warned: 1 })
  })

  it('catches a register() that throws instead of rejecting, now or from the load event', () => {
    const boom = () => {
      throw new Error('register is broken')
    }
    const now = fakeWindow({ serviceWorker: { register: vi.fn(boom) } })
    const later = fakeWindow({ readyState: 'loading', fireLoad: false, serviceWorker: { register: vi.fn(boom) } })

    expect(attempt(now.win)).toEqual({ started: true, warned: 1 })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(registerServiceWorker({ production: true, win: later.win })).toBe(true)
    const [, onLoad] = later.addEventListener.mock.calls[0]
    expect(() => onLoad()).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
