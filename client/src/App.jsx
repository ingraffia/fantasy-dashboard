import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''
const AUTH_HEADER_NAME = 'x-auth-token'

// Read token from localStorage
function getStoredToken() {
  return localStorage.getItem('fantasy_auth_token')
}

function setStoredToken(token) {
  localStorage.setItem('fantasy_auth_token', token)
}

function clearStoredToken() {
  localStorage.removeItem('fantasy_auth_token')
}

// Add Bearer token to every axios request automatically
function setupAxiosAuth(token) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
}

function syncTokenFromResponse(response) {
  const rotatedToken = response?.headers?.[AUTH_HEADER_NAME]
  if (!rotatedToken) return
  setStoredToken(rotatedToken)
  setupAxiosAuth(rotatedToken)
}

export default function App() {
  const [authed, setAuthed] = useState(null)

  // Auto-redirect to login on any 401 (expired Yahoo token)
  useEffect(() => {
    const id = axios.interceptors.response.use(
      response => {
        syncTokenFromResponse(response)
        return response
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
    // Check if Yahoo OAuth just redirected back with ?auth=TOKEN in the URL
    const params = new URLSearchParams(window.location.search)
    const authToken = params.get('auth')

    if (authToken) {
      // Save token and clean the URL
      setStoredToken(authToken)
      setupAxiosAuth(authToken)
      window.history.replaceState({}, '', '/')
      setAuthed(true)
      return
    }

    // Otherwise check if we have a stored token
    const storedToken = getStoredToken()
    if (storedToken) {
      setupAxiosAuth(storedToken)
      // Verify it's still valid
      axios.get(`${API}/auth/status`)
        .then(r => {
          syncTokenFromResponse(r)
          if (r.data.authenticated) {
            setAuthed(true)
          } else {
            // Token expired or server restarted — clear and show login
            clearStoredToken()
            setAuthed(false)
          }
        })
        .catch(() => {
          clearStoredToken()
          setAuthed(false)
        })
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

  if (authed === null) return (
    <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="surface-card surface-card--strong animate-fade-up" style={{ minWidth: 260, padding: '28px 32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: '#8a98aa', fontWeight: 700, letterSpacing: '0.02em' }}>Loading dashboard...</div>
      </div>
    </div>
  )

  if (!authed) return (
    <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="surface-card surface-card--strong animate-fade-up" style={{ width: 'min(520px, 100%)', padding: '42px 36px', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: 24, margin: '0 auto 18px', background: 'linear-gradient(135deg, #16324f 0%, #2d7ff9 100%)', display: 'grid', placeItems: 'center', boxShadow: '0 24px 44px rgba(45,127,249,0.22)' }}>
          <span style={{ fontSize: 32 }}>⚾</span>
        </div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#16324f', margin: 0, letterSpacing: '-0.03em' }}>Fantasy Dashboard</h1>
        <p style={{ color: '#7d8da1', margin: '10px 0 0', fontSize: 15, lineHeight: 1.6 }}>
          Clean lineup views, live game context, and league-aware stats across Yahoo and ESPN.
        </p>
        <a className="control-button control-button--primary" href={`${API}/auth/login`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#fff', padding: '0.95rem 1.75rem', borderRadius: '14px', textDecoration: 'none', fontWeight: 700, fontSize: 15, marginTop: 24, minWidth: 220 }}>
        <span style={{ fontSize: 16 }}>↗</span>
        Sign in with Yahoo
      </a>
      </div>
    </div>
  )

  return <Dashboard api={API} onLogout={handleLogout} />
}
