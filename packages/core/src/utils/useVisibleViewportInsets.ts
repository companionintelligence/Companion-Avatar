import { useLayoutEffect, useState, type RefObject } from 'react'

/** How much of an element lies above and below the part of the page the user can see, in CSS px. */
export interface VisibleViewportInsets {
  top: number
  bottom: number
}

/**
 * The rows of `ref`'s element that the visual viewport hides, or null when the element is fully
 * in view (or the browser has no `visualViewport`).
 *
 * iOS shrinks the visual viewport for the on-screen keyboard, and its web view can leave it shrunk
 * after the keyboard closes: on the iPhone simulator `visualViewport.height` and `innerHeight` stayed
 * 88 px short of the 874 px layout until the device was rotated (docs/DEVICE-QA.md, finding 4). An
 * overlay laid out against the full layout then centres its dialog on rows the user cannot see, and
 * the dialog's bottom row, Save and Cancel, sits below the visible area. Padding the overlay by these
 * insets centres the dialog in what is visible instead, above the keyboard while it is open.
 *
 * Pinch-zoom also shrinks the visual viewport, but that is the user looking closer, so a zoomed
 * page (scale other than 1) reports null and keeps its layout.
 */
export function useVisibleViewportInsets(
  ref: RefObject<HTMLElement | null>,
  enabled = true
): VisibleViewportInsets | null {
  const [insets, setInsets] = useState<VisibleViewportInsets | null>(null)

  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      const element = ref.current
      if (!element || Math.abs(viewport.scale - 1) > 0.01) {
        setInsets(null)
        return
      }
      // Both in layout-viewport coordinates: the visual viewport's offset, and the element's rect.
      const rect = element.getBoundingClientRect()
      const top = Math.max(0, Math.round(viewport.offsetTop - rect.top))
      const bottom = Math.max(0, Math.round(rect.bottom - (viewport.offsetTop + viewport.height)))
      // A pixel of rounding is not a keyboard.
      const next = top <= 1 && bottom <= 1 ? null : { top, bottom }
      setInsets((previous) =>
        previous?.top === next?.top && previous?.bottom === next?.bottom ? previous : next
      )
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [enabled, ref])

  return enabled ? insets : null
}
