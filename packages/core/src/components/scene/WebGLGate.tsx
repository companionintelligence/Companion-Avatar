import { useState, type ReactNode } from 'react'
import { detectWebGL2 } from '../../platform/capabilities'

export const WebGLGate = ({ children }: { children: ReactNode }) => {
  const [hasWebGL] = useState(detectWebGL2)

  if (hasWebGL) {
    return <>{children}</>
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--muted-foreground)' }}>
      WebGL unavailable
    </div>
  )
}
