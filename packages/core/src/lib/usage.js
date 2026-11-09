import { supabase } from './supabase'
import { useAuthStore } from '../store/authStore'

// Registro de uso (pantallas y acciones) para el reporte interno de uso del
// sistema (`npm run reporte-uso`, ver migración usage_events). Nunca bloquea
// ni avisa nada al usuario: si el envío falla, esos eventos se pierden.
// Los nombres de acción deben existir en usage_catalog para que el reporte
// muestre también las que tienen 0 usos.

const FLUSH_DELAY_MS = 3000
let queue = []
let timer = null

function push(kind, name, detail) {
  queue.push({ kind, name, detail: detail ?? null, occurred_at: new Date().toISOString() })
  if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS)
}

function flush() {
  clearTimeout(timer)
  timer = null
  const cooperativeId = useAuthStore.getState().cooperative?.id
  if (queue.length === 0 || !cooperativeId) return
  const events = queue
  queue = []
  supabase
    .rpc('log_usage_events', { p_platform: 'web', p_cooperative_id: cooperativeId, p_app_version: null, p_events: events })
    .then(() => {}, () => {})
}

export const trackScreen = (name) => push('pantalla', name)
export const trackAction = (name, detail) => push('accion', name, detail)

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
}
