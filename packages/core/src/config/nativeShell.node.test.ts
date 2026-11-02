import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNativeShell } from './nativeShell'

describe('isNativeShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false when there is no window', () => {
    expect(isNativeShell()).toBe(false)
  })

  it('is false in a plain browser tab', () => {
    vi.stubGlobal('window', {})
    expect(isNativeShell()).toBe(false)
  })

  it('is true inside a Capacitor app', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } })
    expect(isNativeShell()).toBe(true)
  })

  it('is false when Capacitor reports a web platform', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => false } })
    expect(isNativeShell()).toBe(false)
  })

  it('is true inside the Tauri desktop app', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    expect(isNativeShell()).toBe(true)
  })
})
