// Registers public/sw.js, the service worker that makes Avatar Companion installable and
// gives a page load with no network the /offline/ page. What the worker does and does not
// do is written at the top of that file.
//
// It is registered from here, in the bundle, rather than from a script in index.html, so
// the page stays free of inline script and the registration ships with the app it belongs to.

/** Where the worker is served from: the site root, so its scope is the whole origin. */
export const SERVICE_WORKER_URL = '/sw.js'

/** The parts of `window` this module touches, so a test can pass a stand-in. */
export interface RegistrationHost {
  navigator: { serviceWorker?: Pick<ServiceWorkerContainer, 'register'> }
  document: Pick<Document, 'readyState'>
  addEventListener: (type: 'load', listener: () => void, options: { once: boolean }) => void
  /** Injected by the Capacitor native shells before any page script runs. */
  Capacitor?: { isNativePlatform?: () => boolean }
  /** Injected by the Tauri desktop shell before any page script runs. */
  __TAURI_INTERNALS__?: unknown
}

/** Not worth interrupting the visitor for: the app is an ordinary web page without the worker. */
function warn(err: unknown) {
  console.warn('Avatar Companion: could not register the service worker', err)
}

/**
 * Register the service worker once the page has loaded, so it never competes with the
 * app's first render. Returns whether a registration was started.
 *
 * It does nothing:
 *   - outside a production build, where the dev server would otherwise be served from a
 *     worker's idea of the page;
 *   - without `navigator.serviceWorker`, which browsers expose only on https or
 *     localhost. A plain-http LAN address has none, but the app needs a secure context
 *     too (WebGPU is limited to one), so there the page does not start, with or without
 *     a worker; the guard is for browsers and WebViews with no worker support at all;
 *   - inside a native or desktop shell: a Capacitor app (window.Capacitor) or the Tauri
 *     desktop app (window.__TAURI_INTERNALS__). Each loads this same bundle from the app
 *     itself, and a worker there would sit between the WebView and its own files.
 *
 * It catches its own errors and never throws, so the registration can no longer be what
 * stops the app from starting: main.tsx calls it before the app is mounted, the app works
 * without a worker, and merely reading `navigator.serviceWorker` raises a SecurityError in
 * some contexts (a document sandboxed without allow-same-origin, for one). Every access
 * sits inside the try.
 */
export function registerServiceWorker({
  production = import.meta.env.PROD,
  win = globalThis as unknown as RegistrationHost
}: { production?: boolean; win?: RegistrationHost } = {}): boolean {
  if (!production) return false

  try {
    const serviceWorker = win.navigator.serviceWorker
    if (!serviceWorker) return false
    if (win.Capacitor?.isNativePlatform?.()) return false
    if (win.__TAURI_INTERNALS__) return false

    const register = () => {
      try {
        serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' }).catch(warn)
      } catch (err) {
        // A register() that throws instead of rejecting, from the load listener below.
        warn(err)
      }
    }

    if (win.document.readyState === 'complete') register()
    else win.addEventListener('load', register, { once: true })
    return true
  } catch (err) {
    warn(err)
    return false
  }
}
