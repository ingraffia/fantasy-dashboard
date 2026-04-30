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

function LogoArt({ primary }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" aria-hidden="true">
      {/* Partial circle ring — gap at upper-right where bat exits */}
      <path
        d="M 91.5 43 A 43 43 0 1 1 61 12.5"
        stroke={primary}
        strokeWidth="4.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Baseball batter silhouette — one continuous clockwise path */}
      <path
        d="
          M 91 9
          C 86 13 79 19 74 23
          C 70 26 66 29 65 30
          C 61 32 57 32 54 33
          C 53 40 53 48 52 56
          C 51 63 49 70 47 77
          L 38 77
          C 35 70 33 63 31 56
          C 30 50 29 44 29 38
          C 29 33 30 30 31 27
          C 31 25 32 24 33 24
          C 33 22 33 21 33 20
          C 31 19 28 19 25 21
          C 23 22 22 23 22 24
          C 22 25 22 26 22 27
          C 23 28 25 28 27 28
          C 29 28 31 27 33 26
          C 35 25 36 23 36 21
          C 37 19 37 17 38 15
          C 38 14 39 13 40 13
          C 42 12 44 13 44 15
          C 45 17 45 19 44 23
          C 44 25 44 26 44 27
          C 46 27 48 28 49 30
          C 51 28 54 26 57 24
          C 60 22 63 20 66 18
          C 69 16 72 13 74 12
          C 77 11 81 10 85 9
          L 91 9
          Z
        "
        fill={primary}
      />
    </svg>
  )
}

export function BrandMark({ size = 40, tone = 'dark', framed = false }) {
  const palette = TONES[tone] || TONES.dark
  const art = <LogoArt primary={palette.primary} />

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
