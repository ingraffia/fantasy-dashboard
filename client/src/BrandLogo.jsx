const TONES = {
  dark: {
    primary: '#0a0a0a',
    secondary: '#ffffff',
    frameBg: 'linear-gradient(180deg, rgba(17,17,17,0.08), rgba(17,17,17,0.02))',
    frameBorder: 'rgba(17,17,17,0.12)',
    frameShadow: '0 10px 24px rgba(10,10,10,0.10), inset 0 1px 0 rgba(255,255,255,0.72)',
  },
  light: {
    primary: '#ffffff',
    secondary: '#0a0a0a',
    frameBg: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))',
    frameBorder: 'rgba(255,255,255,0.16)',
    frameShadow: '0 12px 28px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.18)',
  },
}

function LogoArt({ primary, secondary }) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill={primary} />
      <path d="M21 8C7 22 7 42 21 56" stroke={secondary} strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M43 8C57 22 57 42 43 56" stroke={secondary} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function BrandMark({ size = 40, tone = 'dark', framed = false }) {
  const palette = TONES[tone] || TONES.dark
  const art = <LogoArt primary={palette.primary} secondary={palette.secondary} />

  if (!framed) {
    return (
      <span
        style={{
          display: 'inline-flex',
          width: size,
          height: size,
          flexShrink: 0,
        }}
      >
        {art}
      </span>
    )
  }

  const innerSize = Math.round(size * 0.66)

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(14, Math.round(size * 0.3)),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: palette.frameBg,
        border: `1px solid ${palette.frameBorder}`,
        boxShadow: palette.frameShadow,
      }}
    >
      <span style={{ width: innerSize, height: innerSize, display: 'inline-flex' }}>
        {art}
      </span>
    </span>
  )
}
