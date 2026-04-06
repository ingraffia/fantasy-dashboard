import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''
const AUTH_HEADER_NAME = 'x-auth-token'

function getStoredToken() { return localStorage.getItem('fantasy_auth_token') }
function setStoredToken(t) { localStorage.setItem('fantasy_auth_token', t) }
function clearStoredToken() { localStorage.removeItem('fantasy_auth_token') }
function setupAxiosAuth(token) { axios.defaults.headers.common['Authorization'] = `Bearer ${token}` }

function syncTokenFromResponse(response) {
  const rotated = response?.headers?.[AUTH_HEADER_NAME]
  if (!rotated) return
  setStoredToken(rotated)
  setupAxiosAuth(rotated)
}

/* ── Splash — brand moment only, NO progress bar ────────── */
function SplashScreen() {
  return (
    <div className="splash-screen" aria-hidden="true">
      <div className="splash-logo">
        <div className="splash-icon">⚾</div>
        <div className="splash-wordmark">
          Dugout<span className="splash-dot" />
        </div>
        <div className="splash-tagline">Fantasy Intelligence</div>
      </div>
    </div>
  )
}

/* ── Login — dark full-bleed hero ───────────────────────── */
function LoginScreen({ api }) {
  return (
    <div className="login-page">
      {/* Left panel — brand hero */}
      <div className="login-hero">
        <div className="login-hero-noise" />
        <div className="login-hero-content">
          <div className="login-hero-icon">⚾</div>
          <div className="login-hero-wordmark">
            Dugout<span className="login-hero-dot" />
          </div>
          <p className="login-hero-sub">
            Multi-league fantasy intelligence for serious managers.
          </p>
          <div className="login-feature-grid">
            {[
              { icon: '📊', label: 'Live Box Scores', desc: 'Real-time game stats woven into your lineup' },
              { icon: '🔄', label: 'Multi-League', desc: 'Yahoo & ESPN unified in one dashboard' },
              { icon: '🎯', label: 'Waiver Intel', desc: 'Cross-league ownership & rankings' },
              { icon: '⚡', label: 'Trade Analyzer', desc: 'Category impact trades, instantly' },
            ].map(f => (
              <div key={f.label} className="login-feature-item">
                <span className="login-feature-icon">{f.icon}</span>
                <div>
                  <div className="login-feature-label">{f.label}</div>
                  <div className="login-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — auth form */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-form-eyebrow">Welcome back</div>
          <h1 className="login-form-heading">Sign in to<br />your dashboard</h1>
          <p className="login-form-body">
            Connect your Yahoo account to pull in your leagues, rosters, and rankings automatically.
          </p>

          <a className="login-yahoo-btn" href={`${api}/auth/login`}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
              <circle cx="16" cy="16" r="16" fill="#6001D2" />
              <path d="M8 9h4.5l3.5 6 3.5-6H24l-6 10v5h-4v-5L8 9z" fill="white" />
            </svg>
            Continue with Yahoo
            <span className="login-yahoo-arrow">→</span>
          </a>

          <div className="login-divider">
            <span>or</span>
          </div>

          <div className="login-badge-row">
            <span className="login-badge login-badge--beta">Beta</span>
            <span className="login-badge-text">ESPN support coming soon</span>
          </div>

          <p className="login-legal">
            By continuing, you authorize read-only access to your Yahoo Fantasy data. Your credentials never touch our servers.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Root App ───────────────────────────────────────────── */
export default function App() {
  const [authed, setAuthed] = useState(null)
  const [splashDone, setSplashDone] = useState(false)

  // Splash is brand-only, short (1.8s total: fade out at 1.3s, unmount at 1.8s)
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1800)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => { syncTokenFromResponse(r); return r },
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
        .then(r => { syncTokenFromResponse(r); setAuthed(!!r.data.authenticated); if (!r.data.authenticated) clearStoredToken() })
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
      {!splashDone && <SplashScreen />}
      {/* Simple spinner while auth resolves after splash (rarely visible) */}
      {authed === null && splashDone && (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1f3c' }}>
          <div className="auth-spinner" />
        </div>
      )}
      {authed === false && splashDone && <LoginScreen api={API} />}
      {authed === true && <Dashboard api={API} onLogout={handleLogout} />}
    </>
  )
}
