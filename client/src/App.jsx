import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''
const AUTH_HEADER_NAME = 'x-auth-token'

function getStoredToken() { return localStorage.getItem('fantasy_auth_token') }
function setStoredToken(t) { localStorage.setItem('fantasy_auth_token', t) }
function clearStoredToken() { localStorage.removeItem('fantasy_auth_token') }

function setupAxiosAuth(token) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
}

function syncTokenFromResponse(response) {
  const rotated = response?.headers?.[AUTH_HEADER_NAME]
  if (!rotated) return
  setStoredToken(rotated)
  setupAxiosAuth(rotated)
}

/* ── Splash Screen ──────────────────────────────────────── */
function SplashScreen() {
  return (
    <div className="splash-screen" aria-label="Loading Dugout">
      <div className="splash-logo">
        <div className="splash-icon">⚾</div>
        <div>
          <div className="splash-wordmark">
            Dugout<span className="splash-dot" />
          </div>
          <div className="splash-tagline">Fantasy Intelligence</div>
        </div>
        <div className="splash-progress-track">
          <div className="splash-progress-bar" />
        </div>
      </div>
    </div>
  )
}

/* ── Login Screen ───────────────────────────────────────── */
function LoginScreen({ api }) {
  return (
    <>
      <div className="login-bg" />
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', padding: '24px',
      }}>
        <div className="login-card">
          {/* Logo */}
          <div style={{
            width: 80, height: 80, borderRadius: 26, margin: '0 auto 24px',
            background: 'linear-gradient(135deg, #0d1f3c 0%, #16324f 40%, #2563a8 100%)',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 24px 50px rgba(15,32,80,0.22), inset 0 1px 0 rgba(255,255,255,0.18)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: 36 }}>⚾</span>
          </div>

          {/* Wordmark */}
          <div style={{
            fontSize: 32, fontWeight: 900, letterSpacing: '-0.05em',
            color: '#0d1f3c', lineHeight: 1, marginBottom: 6,
            display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2,
          }}>
            Dugout
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: '#2d7ff9', marginLeft: 2, marginBottom: 3,
              boxShadow: '0 0 10px rgba(45,127,249,0.5)',
            }} />
          </div>

          <p style={{
            color: '#6b7f96', fontSize: 15, lineHeight: 1.65,
            marginBottom: 32, marginTop: 8,
          }}>
            Multi-league fantasy intelligence — Yahoo & ESPN, lineups, live scores, and smarter waivers.
          </p>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28,
          }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.2)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sign in with</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.2)' }} />
          </div>

          {/* Yahoo CTA */}
          <a
            className="control-button control-button--primary"
            href={`${api}/auth/login`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              color: '#fff', padding: '14px 28px',
              borderRadius: '14px', textDecoration: 'none',
              fontWeight: 700, fontSize: 15, width: '100%',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
              <circle cx="16" cy="16" r="16" fill="#6001D2" />
              <path d="M8 9h4.5l3.5 6 3.5-6H24l-6 10v5h-4v-5L8 9z" fill="white" />
            </svg>
            Continue with Yahoo
          </a>

          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 20, lineHeight: 1.6 }}>
            Your credentials stay with Yahoo. We only read your fantasy league data.
          </p>

          {/* Feature pills */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 28,
          }}>
            {['Live Box Scores', 'Multi-League', 'Waiver Intel', 'Trade Analyzer'].map(f => (
              <span key={f} style={{
                fontSize: 11, fontWeight: 600, color: '#4a607a',
                background: 'rgba(15,32,80,0.06)', border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 99, padding: '4px 12px', letterSpacing: '-0.01em',
              }}>{f}</span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Root App ───────────────────────────────────────────── */
export default function App() {
  const [authed, setAuthed] = useState(null)
  const [splashDone, setSplashDone] = useState(false)

  // Eject splash after animation finishes (3.1s)
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 3100)
    return () => clearTimeout(t)
  }, [])

  // Intercept 401s
  useEffect(() => {
    const id = axios.interceptors.response.use(
      response => { syncTokenFromResponse(response); return response },
      err => {
        syncTokenFromResponse(err.response)
        if (err.response?.status === 401) {
          clearStoredToken()
          delete axios.defaults.headers.common['Authorization']
          setAuthed(false)
        }
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  // Auth check
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authToken = params.get('auth')

    if (authToken) {
      setStoredToken(authToken)
      setupAxiosAuth(authToken)
      window.history.replaceState({}, '', '/')
      setAuthed(true)
      return
    }

    const storedToken = getStoredToken()
    if (storedToken) {
      setupAxiosAuth(storedToken)
      axios.get(`${API}/auth/status`)
        .then(r => {
          syncTokenFromResponse(r)
          setAuthed(!!r.data.authenticated)
          if (!r.data.authenticated) clearStoredToken()
        })
        .catch(() => { clearStoredToken(); setAuthed(false) })
    } else {
      setAuthed(false)
    }
  }, [])

  const handleLogout = () => {
    axios.get(`${API}/auth/logout`).catch(() => { })
    clearStoredToken()
    delete axios.defaults.headers.common['Authorization']
    setAuthed(false)
  }

  return (
    <>
      {/* Splash always mounts first, CSS fades it out at 2.6s then we unmount at 3.1s */}
      {!splashDone && <SplashScreen />}

      {authed === null && splashDone && (
        /* Fallback if auth check is very slow after splash */
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(45,127,249,0.2)', borderTopColor: '#2d7ff9', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {authed === false && splashDone && <LoginScreen api={API} />}
      {authed === true && <Dashboard api={API} onLogout={handleLogout} />}
    </>
  )
}
