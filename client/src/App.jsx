import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'
import { BrandMark } from './BrandLogo'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''
const AUTH_HEADER_NAME = 'x-auth-token'
const AUTH_STORAGE_KEY = 'fantasy_auth_token'
const YAHOO_REAUTH_GUARD_KEY = 'fantasy_yahoo_reauth_attempted'
const YAHOO_LAST_OAUTH_RETURN_KEY = 'fantasy_yahoo_last_oauth_return_at'
const YAHOO_LAST_AUTO_REAUTH_KEY = 'fantasy_yahoo_last_auto_reauth_at'
const YAHOO_LAST_WARNING_KEY = 'fantasy_yahoo_last_warning'
const YAHOO_REAUTH_COOLDOWN_MS = 2 * 60 * 1000
const YAHOO_AUTO_REAUTH_WINDOW_MS = 5 * 60 * 1000

function getStoredToken() { return localStorage.getItem(AUTH_STORAGE_KEY) }
function setStoredToken(t) { localStorage.setItem(AUTH_STORAGE_KEY, t) }
function clearStoredToken() { localStorage.removeItem(AUTH_STORAGE_KEY) }
function setupAxiosAuth(token) { axios.defaults.headers.common['Authorization'] = `Bearer ${token}` }

function getStoredTimestamp(key) {
  const value = Number(localStorage.getItem(key) || '')
  return Number.isFinite(value) && value > 0 ? value : 0
}

function setStoredTimestamp(key, value = Date.now()) {
  localStorage.setItem(key, String(value))
}

function clearStoredTimestamp(key) {
  localStorage.removeItem(key)
}

function getStoredWarning() {
  return localStorage.getItem(YAHOO_LAST_WARNING_KEY) || ''
}

function setStoredWarning(value) {
  localStorage.setItem(YAHOO_LAST_WARNING_KEY, value)
}

function clearStoredWarning() {
  localStorage.removeItem(YAHOO_LAST_WARNING_KEY)
}

function syncTokenFromResponse(response) {
  const rotated = response?.headers?.[AUTH_HEADER_NAME]
  if (!rotated) return
  setStoredToken(rotated)
  setupAxiosAuth(rotated)
}

function getYahooDashboardWarning(response) {
  const warning = response?.headers?.['x-dashboard-warning']
  return typeof warning === 'string' ? warning : ''
}

function didYahooDashboardAuthFail(response) {
  const warning = getYahooDashboardWarning(response)
  if (!warning) return false
  return /yahoo/i.test(warning) && /status 403/i.test(warning)
}

function isYahooDashboardResponse(response) {
  const url = response?.config?.url || ''
  return /\/api\/dashboard(?:$|\?)/.test(url)
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

function shouldBlockAutoYahooReauth() {
  const now = Date.now()
  const lastOauthReturnAt = getStoredTimestamp(YAHOO_LAST_OAUTH_RETURN_KEY)
  const lastAutoReauthAt = getStoredTimestamp(YAHOO_LAST_AUTO_REAUTH_KEY)

  return (lastOauthReturnAt && (now - lastOauthReturnAt) < YAHOO_REAUTH_COOLDOWN_MS)
    || (lastAutoReauthAt && (now - lastAutoReauthAt) < YAHOO_AUTO_REAUTH_WINDOW_MS)
}

/* ── Login — dark full-bleed hero ───────────────────────── */
function LoginScreen({ api, yahooNeedsReconnect = false, yahooWarning = '' }) {
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

          {yahooNeedsReconnect && (
            <div style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 16,
              background: '#fff7ed',
              border: '1px solid rgba(234, 88, 12, 0.18)',
              color: '#9a3412',
              fontSize: 13,
              lineHeight: 1.45,
            }}>
              <div style={{ fontWeight: 700, marginBottom: yahooWarning ? 8 : 0 }}>
                Yahoo sent you back, but fantasy access is still being rejected on Saturday, August 1, 2026. The app has stopped auto-redirecting so you can retry manually below.
              </div>
              {yahooWarning && (
                <div style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: '#7c2d12',
                  paddingTop: 8,
                  borderTop: '1px solid rgba(234, 88, 12, 0.14)',
                  wordBreak: 'break-word',
                }}>
                  {yahooWarning}
                </div>
              )}
            </div>
          )}

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
  const [yahooNeedsReconnect, setYahooNeedsReconnect] = useState(false)
  const [yahooWarning, setYahooWarning] = useState(() => getStoredWarning())

  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => {
        syncTokenFromResponse(r)

        if (isYahooDashboardResponse(r) && !didYahooDashboardAuthFail(r)) {
          clearYahooReauthAttempted()
          clearStoredTimestamp(YAHOO_LAST_AUTO_REAUTH_KEY)
          clearStoredWarning()
          setYahooWarning('')
          setYahooNeedsReconnect(false)
        }

        if (didYahooDashboardAuthFail(r)) {
          const warning = getYahooDashboardWarning(r)
          if (warning) {
            setStoredWarning(warning)
            setYahooWarning(warning)
          }

          clearStoredToken()
          delete axios.defaults.headers.common['Authorization']

          if (hasYahooReauthAttempted() || shouldBlockAutoYahooReauth()) {
            setYahooNeedsReconnect(true)
            setAuthed(false)
            return r
          }

          markYahooReauthAttempted()
          setStoredTimestamp(YAHOO_LAST_AUTO_REAUTH_KEY)
          setYahooNeedsReconnect(false)
          setAuthed(false)
          window.location.assign(`${API}/auth/login`)
        }

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
      setStoredTimestamp(YAHOO_LAST_OAUTH_RETURN_KEY)
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
            setAuthed(true)
          } else {
            clearStoredToken()
            setAuthed(false)
          }
        })
        .catch(() => { clearStoredToken(); setAuthed(false) })
    } else {
      clearYahooReauthAttempted()
      clearStoredTimestamp(YAHOO_LAST_OAUTH_RETURN_KEY)
      clearStoredTimestamp(YAHOO_LAST_AUTO_REAUTH_KEY)
      clearStoredWarning()
      setYahooWarning('')
      setYahooNeedsReconnect(false)
      setAuthed(false)
    }
  }, [])

  const handleLogout = () => {
    axios.get(`${API}/auth/logout`).catch(() => { })
    clearYahooReauthAttempted()
    clearStoredTimestamp(YAHOO_LAST_OAUTH_RETURN_KEY)
    clearStoredTimestamp(YAHOO_LAST_AUTO_REAUTH_KEY)
    clearStoredWarning()
    setYahooWarning('')
    setYahooNeedsReconnect(false)
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
      {authed === false && <LoginScreen api={API} yahooNeedsReconnect={yahooNeedsReconnect} yahooWarning={yahooWarning} />}
      {authed === true && <Dashboard api={API} onLogout={handleLogout} />}
    </>
  )
}
