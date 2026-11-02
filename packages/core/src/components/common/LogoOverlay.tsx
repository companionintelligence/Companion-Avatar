interface LogoOverlayProps {
  logoSrc?: string
}

export const LogoOverlay = ({ logoSrc = '/assets/2024_CI__Logo_Banner_Color.svg' }: LogoOverlayProps) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'env(safe-area-inset-top)',
        left: 0,
        right: 0,
        zIndex: 1002,
        padding: 'clamp(10px, 2vw, 20px)',
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(16,25,30,0.3) 0%, rgba(17,43,48,0.0) 100%)',
          backdropFilter: 'blur(0.5rem)',
          border: '0.0625rem solid rgba(255,255,255,0.08)',
          borderRadius: 'clamp(8px, 1.5vw, 12px)',
          padding: 'clamp(8px, 1.5vw, 12px) clamp(16px, 3vw, 24px)',
          boxShadow: '0 0.125rem 0.25rem rgba(0,0,0,0.04)',
          pointerEvents: 'none'
        }}
      >
        <img
          style={{
            width: 'clamp(100px, 12vw, 180px)',
            height: 'auto',
            maxWidth: '100%',
            filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
            pointerEvents: 'none'
          }}
          src={logoSrc}
          alt="Logo"
        />
      </div>
    </div>
  )
}
