import { useState, useEffect, Fragment } from 'react'
import { COOPERATIVE } from '../lib/config'
import { useGridControl } from '@panela/core/hooks/useGridControl'
import { useMonthlyGridNavigation } from '@panela/core/hooks/useMonthlyGridNavigation'
import { loadLimpiezaGeneralAreas } from '@panela/core/lib/formConfig'
import { TIPO_LIMPIEZA_LABELS, PRODUCTO_LABELS } from '../lib/formatos/limpiezaGeneral'
import { MONTH_NAMES, getCoopCode } from '@panela/core/lib/formatos/shared'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import MonthArrowSelect from '@panela/core/components/MonthArrowSelect'
import PeriodExistsBanner from '@panela/core/components/PeriodExistsBanner'

// Control de Limpieza (CAESP-PP-HYS-RE-HYS-001) -- SOLO CAES, ver
// COOPERATIVE.features.limpiezaUnificada en lib/config.js. Registro MENSUAL
// que fusiona lo que en Norandino son Limpieza de Ambientes + Limpieza de
// Equipos (ver LimpiezaAmbientesPage.jsx/LimpiezaEquiposPage.jsx, que
// Norandino sigue usando sin cambios). A diferencia de Equipos, acá cada
// celda es un solo check (sin producto por celda) -- el tipo de limpieza y
// el producto aplicable son metadata fija del ítem (se muestran como
// referencia junto al nombre, no se capturan a diario).

// Click cicla: sin marcar -> correcto -> no_correcto -> sin marcar.
function nextStatus(current) {
  if (current == null) return 'correcto'
  if (current === 'correcto') return 'no_correcto'
  return null
}

function cellStyle(status) {
  if (status === 'correcto') return { color: '#166534', background: '#f0fdf4' }
  if (status === 'no_correcto') return { color: '#991b1b', background: '#fef2f2' }
  return { color: '#ccc', background: '#fff' }
}

function cellSymbol(status) {
  if (status === 'correcto') return '✓'
  if (status === 'no_correcto') return '✗'
  return '·'
}

function referencia(item) {
  const tipo = (item.tipoLimpieza ?? []).map(c => TIPO_LIMPIEZA_LABELS[c] ?? c).join('/')
  const producto = (item.producto ?? []).map(c => PRODUCTO_LABELS[c] ?? c).join('/')
  const parts = [tipo, producto].filter(Boolean)
  return parts.length ? `(${parts.join(' · ')})` : null
}

// Cuenta cuántas celdas quedaron marcadas en un control ya guardado, para el historial.
function countMarks(checks) {
  const total = (checks ?? []).length
  const ok = (checks ?? []).filter(c => c.status === 'correcto').length
  return { total, ok }
}

// Igual criterio que Ambientes/Equipos: un control aquí es todo un mes, así
// que el default de "arranca marcado" solo aplica a la columna del día de
// HOY (si el mes mostrado es el mes actual) y solo para celdas sin valor
// guardado -- no pisa datos reales ya cargados.
function applyTodayDefault(checksObj, year, month, areas) {
  const now = new Date()
  if (year !== now.getFullYear() || month !== now.getMonth() + 1) return checksObj
  const today = now.getDate()
  const next = { ...checksObj }
  for (const { area, items } of areas) {
    const byArea = { ...(next[area] ?? {}) }
    for (const item of items) {
      const byDay = { ...(byArea[item.code] ?? {}) }
      if (byDay[today] == null) byDay[today] = 'correcto'
      byArea[item.code] = byDay
    }
    next[area] = byArea
  }
  return next
}

export default function LimpiezaGeneralPage() {
  const [areas, setAreas] = useState([])
  useEffect(() => { loadLimpiezaGeneralAreas(COOPERATIVE).then(setAreas) }, [])

  const {
    view, setView, controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
  } = useGridControl({
    table: 'plant_general_cleaning_controls',
    childTable: 'plant_general_cleaning_checks',
    historySelect: 'id, year, month, responsible_person, observations, formato_codigo, plant_general_cleaning_checks ( status ), registered_by:web_users!pgcc_created_by_fkey ( first_name, last_name )',
    historyOrder: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }],
    emptyHeader: () => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1, responsible_person: '', observations: '' }
    },
    validateHeader: h => !h.responsible_person?.trim() ? 'Ingrese el responsable.' : null,
    generateCode: {
      rpc: 'generate_general_cleaning_control_code',
      params: () => ({ p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) }),
    },
    buildHeaderPayload: h => ({
      year: h.year,
      month: h.month,
      responsible_person: h.responsible_person.trim(),
      observations: h.observations?.trim() || null,
    }),
    uniqueViolationMessage: 'Ya existe un control para ese año y mes.',
    childSelect: 'area, item, day, status',
    rowsFromChecks: checks => {
      const rows = []
      for (const [area, byItem] of Object.entries(checks)) {
        for (const [item, byDay] of Object.entries(byItem)) {
          for (const [day, status] of Object.entries(byDay)) {
            if (status) rows.push({ area, item, day: parseInt(day, 10), status })
          }
        }
      }
      return rows
    },
    checksFromRows: (rows, control) => {
      const next = {}
      for (const r of rows) {
        const byArea = (next[r.area] ??= {})
        const byItem = (byArea[r.item] ??= {})
        byItem[r.day] = r.status
      }
      return applyTodayDefault(next, control.year, control.month, areas)
    },
    defaultChecks: h => applyTodayDefault({}, h.year, h.month, areas),
  })

  // Sin claves de identidad extra (a diferencia de Higiene, que suma
  // "turno") -- (año, mes) solos ya identifican al control.
  const {
    quickDay, setDayFilterActive,
    quickDayInThisMonth, showOnlyDay, days,
    startToday, shiftIdentityMonth, resetDayFilter,
    existingForIdentity,
  } = useMonthlyGridNavigation({
    header, controls, editingId,
    updateIdentity, startNewControl, startEditControl,
  })

  function toggleCell(area, code, day) {
    const current = cellValue(area, code)?.[day] ?? null
    const status = nextStatus(current)
    const byDay = { ...(cellValue(area, code) ?? {}) }
    if (status == null) delete byDay[day]
    else byDay[day] = status
    setCellValue(area, code, byDay)
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Control de Limpieza</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => startToday()}>Registrar hoy</button>
            <button className="btn small outline" onClick={() => { resetDayFilter(); startNewControl() }}>+ Nuevo control</button>
          </div>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de limpieza registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const { total, ok } = countMarks(c.plant_general_cleaning_checks)
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{MONTH_NAMES[c.month - 1]} {c.year}</strong>
                      {c.formato_codigo && <span className="muted small" style={{ marginLeft: 8 }}>{c.formato_codigo}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {total > 0 && (
                        <span className={`tag ${ok === total ? 'ok' : 'warn'}`}>{ok}/{total} correcto</span>
                      )}
                      <button className="btn small outline" onClick={() => { resetDayFilter(); startEditControl(c) }}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    Responsable: {c.responsible_person ?? '—'}
                    {c.registered_by && ` · Registrado por: ${c.registered_by.first_name} ${c.registered_by.last_name}`}
                  </div>
                  {c.observations && <div className="meta" style={{ fontSize: 12 }}>Observaciones: {c.observations}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar control' : 'Nuevo control'} de limpieza</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            Mes y año identifican a este control ya guardado y no se pueden cambiar aquí. Para otro período, vuelva al historial y use "Editar".
          </p>
        )}
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Mes</label>
            <MonthArrowSelect
              month={header.month}
              disabled={!!editingId}
              onShift={shiftIdentityMonth}
              onChangeMonth={m => updateIdentity({ month: m })}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Año</label>
            <input type="number" value={header.year} disabled={!!editingId} onChange={e => updateIdentity({ year: parseInt(e.target.value, 10) || header.year })} style={{ width: 100 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Responsable</label>
            <input type="text" value={header.responsible_person} onChange={e => updateHeader({ responsible_person: e.target.value })} placeholder="Nombre de quien completa el control" />
          </div>
        </div>
        {existingForIdentity && (
          <PeriodExistsBanner
            periodLabel={`${MONTH_NAMES[header.month - 1]} ${header.year}`}
            responsiblePerson={existingForIdentity.responsible_person}
            onOpen={() => { resetDayFilter(); startEditControl(existingForIdentity) }}
          />
        )}
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={header.observations ?? ''} onChange={e => updateHeader({ observations: e.target.value })} />
        </div>
      </div>

      {!existingForIdentity && (
      <div className="card" style={{ marginTop: 12 }}>
        {quickDayInThisMonth && (
          <button className="btn small outline" style={{ marginBottom: 8 }} onClick={() => setDayFilterActive(v => !v)}>
            {showOnlyDay ? 'Ver mes completo' : `Ver solo el día ${quickDay.day}`}
          </button>
        )}
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Click en cada celda: sin marcar → ✓ correcto → ✗ no correcto → sin marcar. Entre paréntesis, tipo de limpieza (D/G/P) y producto de referencia (C/D/A) de cada ítem.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', position: 'sticky', left: 0, background: '#fff', minWidth: 220 }}>Área / Ítem</th>
                {days.map(d => (
                  <th key={d} style={{ width: showOnlyDay ? 60 : 22, minWidth: showOnlyDay ? 60 : 22, fontSize: showOnlyDay ? 12 : 10, padding: '2px 0' }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {areas.map(({ area, items }) => (
                <Fragment key={area}>
                  <tr>
                    <td colSpan={days.length + 1} style={{ background: '#f3f4f6', fontWeight: 700, fontSize: 12, padding: '4px 6px' }}>{area}</td>
                  </tr>
                  {items.map(item => (
                    <tr key={`${area}-${item.code}`}>
                      <td style={{ position: 'sticky', left: 0, background: '#fff', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {item.label}{referencia(item) && <span className="muted" style={{ fontSize: 10 }}> {referencia(item)}</span>}
                      </td>
                      {days.map(d => {
                        const value = cellValue(area, item.code)?.[d] ?? null
                        return (
                          <td key={d} style={{ padding: 0, textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => toggleCell(area, item.code, d)}
                              style={{
                                width: showOnlyDay ? 52 : 22, height: showOnlyDay ? 36 : 22,
                                border: '1px solid var(--border)', borderRadius: showOnlyDay ? 8 : 4,
                                fontWeight: 700, fontSize: showOnlyDay ? 16 : 10, cursor: 'pointer', padding: 0, lineHeight: 1,
                                ...cellStyle(value),
                              }}
                            >
                              {cellSymbol(value)}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !!existingForIdentity} title={existingForIdentity ? 'Elija un período que todavía no tenga control, o abra el existente' : undefined}>
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
    </div>
  )
}
