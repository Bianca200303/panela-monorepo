import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@panela/core/index.css'
import { useAuthStore } from '@panela/core/store/authStore'
import App from './App.jsx'
import { COOPERATIVE } from './lib/config'

if (COOPERATIVE?.logo) {
  const favicon = document.querySelector('link[rel="icon"]')
  if (favicon) favicon.href = COOPERATIVE.logo
}

// authStore ya no puede resolver la cooperativa por su cuenta (dejó de
// importar lib/config.js -- ver Fase 1 del plan de migración): cada app se
// la pasa una sola vez acá, antes de montar <App/> (que es quien dispara
// init()/signIn() más abajo).
useAuthStore.getState().setCooperative(COOPERATIVE)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
