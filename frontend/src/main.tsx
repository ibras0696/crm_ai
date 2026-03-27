import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import App from './App'
import './index.css'

if (import.meta.env.PROD && typeof window !== 'undefined') {
  const isInsecure = window.location.protocol === 'http:'
  const isProdDomain = window.location.hostname === 'crm.py-it.ru' || window.location.hostname.endsWith('.py-it.ru')
  if (isInsecure && isProdDomain) {
    const secureUrl = `https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.replace(secureUrl)
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
