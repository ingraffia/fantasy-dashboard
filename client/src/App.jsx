import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'
import { BrandMark } from './BrandLogo'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''
const AUTH_HEADER_NAME = 'x-auth-token'
const AUTH_STORAGE_KEY = 'fantasy_auth_token'
const YAHOO_REAUTH_GUARD_KEY = 'fantasy_yahoo_reauth_attempted'

function getStoredToken() { return localStorage.getItem(AUTH_STORAGE_KEY) }
function setStoredToken(t) { localStorage.setItem(AUTH_STORAGE_KEY, t) }
function clearStoredToken() { localStorage.removeItem(AUTH_STORAGE_KEY) }
function setupAxiosAuth(token) { axios.defaults.headers.common['Authorization'] = `Bearer ${token}` }

function syncTokenFromResponse(response) {
  const rotated = response?.headers?.[AUTH_HEADER_NAME]
  if (!rotated) return
  setStoredToken(rotated)
  setupAxiosAuth(rotated)
}

function didYahooDashboardAuthFail(response) {
  const warning = response?.headers?.['x-dashboard-warning']
  if (!warning) return false
  return /yahoo/i.test(warning) && /status 403/i.test(warning)
}

function markYahooReauthAttempted() {
  sessionStorage.setItem(YAHOO_REAUTH_GUARD_KEY, '1')
}

function clearYahooReauthAttempted() {
  sessionStorage.removeItem(YAHOO_REAUTH_GUARD_KEY)
}

function hasYahooReauthAttempted() {
  return sessionStorage.getItem(YAHOO_REAUTH_GUARD_KEY) === '1'
}

function beginYahooReauth(setAuthed) {
  if (hasYahooReauthAttempted()) return
  markYahooReauthAttempted()
  clearStoredToken()
  delete axios.defaults.headers.common['Authorization']
  setAuthed(false)
  window.location.assign(`${API}/auth/login`)
}

/* ── Login — dark full-bleed hero ───────────────────────── */
function LoginScreen({ api }) {
  return (
    <div className="login-page">
      {/* Left panel — brand hero */}
      <div className="login-hero">
        <div className="login-hero-noise" />
        <div className="login-hero-content">
          <div className="login-hero-icon"><BrandMark size={64} tone="light" framed /></div>
          <div className="login-hero-wordmark">Dugout</div>
          <p className="login-hero-sub">
            Multi-league fantasy intelligence for serious managers.
          </p>
          <div className="login-feature-grid">
            {[
              { icon: '📊', label: 'Live Box Scores', desc: 'Real-time game stats woven into your lineup' },
              { icon: '🔄', label: 'Multi-League', desc: 'Yahoo & ESPN unified in one dashboard' },
              { icon: '🎯', label: 'Waiver Intel', desc: 'Cross-league ownership & rankings' },
              { icon: '📡', label: 'Live Feed', desc: 'Your roster actions, as they happen' },
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

  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => {
        syncTokenFromResponse(r)
        if (didYahooDashboardAuthFail(r)) beginYahooReauth(setAuthed)
        return r
      },
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
      clearYahooReauthAttempted()
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
          if (r.data.authenticated) {
            clearYahooReauthAttempted()
            setAuthed(true)
          } else {
            clearStoredToken()
            setAuthed(false)
          }
        })
        .catch(() => { clearStoredToken(); setAuthed(false) })
    } else {
      clearYahooReauthAttempted()
      setAuthed(false)
    }
  }, [])

  const handleLogout = () => {
    axios.get(`${API}/auth/logout`).catch(() => { })
    clearYahooReauthAttempted()
    clearStoredToken()
    delete axios.defaults.headers.common['Authorization']
    setAuthed(false)
  }

  return (
    <>
      {authed === null && (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050505' }}>
          <div className="auth-spinner" />
        </div>
      )}
      {authed === false && <LoginScreen api={API} />}
      {authed === true && <Dashboard api={API} onLogout={handleLogout} />}
    </>
  )
}
