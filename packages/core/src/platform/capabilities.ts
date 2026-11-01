/**
 * Capability flags — finer-grained than Surface. Probed at boot and frozen for the
 * lifetime of the page (resize/orientation don't toggle these; XR session enter/leave
 * can). Drives feature gates: WebGPU MToon path, WebXR button visibility, mic/STT.
 */

export interface Capabilities {
  webgl2: boolean
  webgpu: boolean
  webxr: boolean
  immersiveVr: boolean
  immersiveAr: boolean
  handTracking: boolean
  webSpeech: boolean
}

export function detectWebGL2(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return !!canvas.getContext('webgl2')
  } catch {
    return false
  }
}

async function detectXR(): Promise<Pick<Capabilities, 'webxr' | 'immersiveVr' | 'immersiveAr' | 'handTracking'>> {
  const none = { webxr: false, immersiveVr: false, immersiveAr: false, handTracking: false }
  // `navigator.xr` is not in the default DOM lib, so widen just that one property.
  const xr =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }).xr
      : undefined
  if (!xr?.isSessionSupported) return none
  try {
    const [immersiveVr, immersiveAr] = await Promise.all([
      xr.isSessionSupported('immersive-vr').catch(() => false),
      xr.isSessionSupported('immersive-ar').catch(() => false)
    ])
    return {
      webxr: true,
      immersiveVr,
      immersiveAr,
      // Hand tracking can't be probed without a session; infer from VR support.
      handTracking: immersiveVr || immersiveAr
    }
  } catch {
    return none
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  // `navigator.gpu` is WebGPU, also absent from the default DOM lib.
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: unknown }) : undefined
  const xr = await detectXR()
  return {
    webgl2: detectWebGL2(),
    webgpu: !!nav?.gpu,
    ...xr,
    webSpeech: typeof globalThis.speechSynthesis !== 'undefined'
  }
}
