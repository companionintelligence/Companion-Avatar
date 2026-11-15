type ShellGlobals = {
  Capacitor?: { isNativePlatform?: () => boolean }
  __TAURI_INTERNALS__?: unknown
}

/**
 * True inside the Capacitor (iOS, Android) or Tauri (desktop) shell. Both load the bundle from
 * localhost, so a check on the hostname takes them for a developer's machine. Use this instead.
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  const shell = window as Window & ShellGlobals
  return Boolean(shell.Capacitor?.isNativePlatform?.() || shell.__TAURI_INTERNALS__)
}

/** True inside the Tauri desktop app only. Its content security policy differs from the web's. */
export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as Window & ShellGlobals).__TAURI_INTERNALS__)
}
