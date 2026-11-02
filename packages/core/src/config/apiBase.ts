/**
 * Where the BFF proxy is, as seen from this build.
 *
 * The web build leaves VITE_API_BASE empty, so /api calls stay same-origin and nginx routes
 * them. A native or desktop shell is served from its own origin (capacitor://localhost,
 * https://localhost on Android, tauri://localhost). There a relative /api path reaches nothing,
 * so the shell's build sets VITE_API_BASE to the proxy's absolute origin. The proxy must list
 * that shell origin in APP_ALLOWED_ORIGINS, or the browser blocks the call.
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}
