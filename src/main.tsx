import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// keep renderer errors around for the diagnostics report
window.addEventListener('error', e => window.electronAPI.diagnostics.reportError('screen', `${e.message}\n${e.error?.stack || ''}`))
window.addEventListener('unhandledrejection', e => window.electronAPI.diagnostics.reportError('screen (promise)', String(e.reason?.stack || e.reason)))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
