import { useState } from 'react'

// Filtro de período + módulo sobre una lista de formatos ya emitidos
// (historial). histModuleFilter no hace nada si la pantalla no tiene
// filtro de módulo (queda en '' y la condición se salta sola).
export function useHistorialFilter(historial, docFromUrl) {
  const [histFilter, setHistFilter]             = useState(docFromUrl ? 'all' : 'month')
  const [histModuleFilter, setHistModuleFilter] = useState('')
  const [histCustomFrom, setHistCustomFrom]     = useState('')
  const [histCustomTo, setHistCustomTo]         = useState('')

  const now = new Date()
  const filteredHistorial = historial.filter(f => {
    if (docFromUrl && f.formato_codigo !== docFromUrl) return false
    const d = new Date(f.emitted_at)
    if (histFilter === 'month') { if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false }
    else if (histFilter === 'year') { if (d.getFullYear() !== now.getFullYear()) return false }
    else if (histFilter === '6months') { const c = new Date(now); c.setMonth(c.getMonth() - 6); if (d < c) return false }
    else if (histFilter === 'custom') {
      if (histCustomFrom && d < new Date(histCustomFrom + 'T00:00:00')) return false
      if (histCustomTo   && d > new Date(histCustomTo + 'T23:59:59')) return false
    }
    if (histModuleFilter && f.module_id !== histModuleFilter) return false
    return true
  })

  return {
    histFilter, setHistFilter,
    histModuleFilter, setHistModuleFilter,
    histCustomFrom, setHistCustomFrom,
    histCustomTo, setHistCustomTo,
    filteredHistorial,
  }
}
