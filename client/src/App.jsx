import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''

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

export default function App() {
  const [authed, setAuthed] = useState(null)

  // Auto-redirect to login on any 401 (expired Yahoo token)
  useEffect(() => {
    if (!authed) return
    const id = axios.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401) {
          clearStoredToken()
          delete axios.defaults.headers.common['Authorization']
          setAuthed(false)
        }
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [authed])

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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ fontSize: 14, color: '#9ca3af' }}>Loading...</div>
    </div>
  )

  if (!authed) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem', fontFamily: '-apple-system, sans-serif', background: '#f9fafb' }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>⚾</div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e3a5f', margin: 0 }}>Fantasy Dashboard</h1>
      <p style={{ color: '#9ca3af', margin: 0, fontSize: 14 }}>Sign in with Yahoo to continue</p>
      <a href={`${API}/auth/login`} style={{ background: '#6001D2', color: '#fff', padding: '0.7rem 2rem', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: 15, marginTop: 8 }}>
        Sign in with Yahoo
      </a>
    </div>
  )

  return <Dashboard api={API} onLogout={handleLogout} />
}
