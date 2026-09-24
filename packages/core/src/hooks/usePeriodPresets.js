import { useState } from 'react'

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Botones "Este mes / Este año / Últ. 6 meses / Personalizado" que calculan
// dateFrom/dateTo. onChange corre efectos secundarios propios de cada pantalla
// (limpiar resultados de búsqueda previos, etc.) cada vez que se elige un preset.
export function usePeriodPresets(onChange) {
  const [preset, setPreset]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  function selectPreset(key) {
    setPreset(key)
    onChange?.()
    if (key === 'custom') return
    const today = new Date()
    const todayStr = fmt(today)
    if (key === 'month') { setDateFrom(fmt(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(todayStr) }
    else if (key === 'year') { setDateFrom(fmt(new Date(today.getFullYear(), 0, 1))); setDateTo(todayStr) }
    else if (key === '6months') { const f = new Date(today); f.setMonth(f.getMonth() - 6); setDateFrom(fmt(f)); setDateTo(todayStr) }
  }

  return { preset, dateFrom, setDateFrom, dateTo, setDateTo, selectPreset }
}
