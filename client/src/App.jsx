import { useEffect, useState } from 'react'
import axios from 'axios'
import Dashboard from './Dashboard'

const API = import.meta.env.DEV ? 'https://localhost:3001' : ''

export default function App() {
  const [authed, setAuthed] = useState(null)

  useEffect(() => {
    axios.get(`${API}/auth/status`, { withCredentials: true })
      .then(r => setAuthed(r.data.authenticated))
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) return <div style={{ padding: '2rem' }}>Checking auth...</div>

  if (!authed) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Fantasy Dashboard</h1>
      <p style={{ color: '#666' }}>Sign in with your Yahoo account to continue</p>
      <a href={`${API}/auth/login`} style={{ background: '#6001D2', color: '#fff', padding: '0.6rem 1.5rem', borderRadius: '6px', textDecoration: 'none', fontWeight: 500 }}>
        Sign in with Yahoo
      </a>
    </div>
  )

  return <Dashboard api={API} />
}
