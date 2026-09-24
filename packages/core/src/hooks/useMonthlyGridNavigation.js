import { useState } from 'react'

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Complementa useGridControl.js para los controles con grilla MENSUAL por
// día (año/mes [+ otras claves de identidad opcionales, ej. turno] × día
// del mes) -- Higiene del Personal CAES, Limpieza General CAES, y (a
// futuro) Limpieza de Ambientes/Equipos, que comparten el mismo shape.
// useGridControl no puede saber esto porque es genérico a cualquier
// grilla (también cubre los controles "por fecha exacta", que no tienen
// noción de "día del mes" ni de "grilla completa vs. un solo día").
//
// Encapsula 3 cosas que antes vivían duplicadas en cada página:
//   1. "Registrar hoy": ir directo a la columna de HOY sin navegar el mes
//      entero, buscando o creando el control del período correspondiente.
//   2. Flechas de mes + detección en vivo de si el período elegido ya
//      tiene un control guardado (evita cargar datos que después no se
//      van a poder guardar).
//   3. Qué columnas de día mostrar: todas, o solo una (quickDay).
//
// extraIdentityKeys: nombres de campos de `header` además de year/month
// que también identifican al control (ej. ['turno'] en Higiene) -- deben
// coincidir con las columnas del UNIQUE real de la tabla (ver
// [[project_higiene_personal_caes_registro_rapido]]).
export function useMonthlyGridNavigation({
  header, controls, editingId,
  updateIdentity, startNewControl, startEditControl,
  extraIdentityKeys = [],
}) {
  const [quickDay, setQuickDay] = useState(null) // { year, month, day } | null
  const [dayFilterActive, setDayFilterActive] = useState(false)

  function identityKeysOf(source) {
    return { year: source.year, month: source.month, ...Object.fromEntries(extraIdentityKeys.map(k => [k, source[k]])) }
  }

  function findExisting(identity) {
    const wanted = identityKeysOf(identity)
    return controls.find(c => Object.entries(wanted).every(([k, v]) => c[k] === v)) ?? null
  }

  // Busca o crea el control del período pedido -- si se pasa `day`, entra
  // filtrado a esa sola columna (caso "hoy"); si no, entra a la grilla
  // completa del mes (caso "otro mes", donde no se sabe el día exacto).
  function startPeriod(identityPatch, day) {
    const existing = findExisting(identityPatch)
    if (existing) {
      startEditControl(existing)
    } else {
      startNewControl()
      updateIdentity(identityPatch)
    }
    if (day != null) {
      setQuickDay({ year: identityPatch.year, month: identityPatch.month, day })
      setDayFilterActive(true)
    } else {
      resetDayFilter()
    }
  }

  function startToday(extraIdentity = {}) {
    const now = new Date()
    startPeriod({ year: now.getFullYear(), month: now.getMonth() + 1, ...extraIdentity }, now.getDate())
  }

  function shiftIdentityMonth(delta) {
    let m = header.month + delta
    let y = header.year
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    updateIdentity({ month: m, year: y })
  }

  function resetDayFilter() {
    setQuickDay(null)
    setDayFilterActive(false)
  }

  // "En este mes" (no solo "hay un día elegido"): el toggle "ver solo ese
  // día" únicamente tiene sentido si el día filtrado pertenece al mes que
  // se está mostrando -- si la página cambia de mes a mano, deja de aplicar.
  const quickDayInThisMonth = !!quickDay && quickDay.year === header.year && quickDay.month === header.month
  const showOnlyDay = quickDayInThisMonth && dayFilterActive
  const days = showOnlyDay
    ? [quickDay.day]
    : Array.from({ length: daysInMonth(header.year, header.month) }, (_, i) => i + 1)

  // Mientras se arma un registro NUEVO (editingId null), el período que
  // muestra `header` en vivo puede coincidir con uno ya guardado -- ver
  // ese caso acá para que la página lo pueda avisar antes de dejar cargar
  // datos que después chocarían al guardar.
  const existingForIdentity = !editingId ? findExisting(header) : null

  return {
    quickDay, dayFilterActive, setDayFilterActive,
    quickDayInThisMonth, showOnlyDay, days,
    startPeriod, startToday, shiftIdentityMonth, resetDayFilter,
    existingForIdentity,
  }
}
