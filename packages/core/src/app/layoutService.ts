import { useEffect, useState } from 'react'

export const useResponsiveLayout = (breakpoint: number = 1000) => {
  // Read the width on the first render, so a phone does not paint the desktop layout for one frame.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= breakpoint)

  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth <= breakpoint)
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)

    return () => window.removeEventListener('resize', checkScreenSize)
  }, [breakpoint])

  return { isMobile }
}

