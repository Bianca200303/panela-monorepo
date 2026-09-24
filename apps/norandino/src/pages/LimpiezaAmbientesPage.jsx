import { useState, useEffect, Fragment } from 'react'
import { useGridControl } from '@panela/core/hooks/useGridControl'
import { loadLimpiezaAmbientesAreas } from '@panela/core/lib/formConfig'
import { COOPERATIVE } from '../lib/config'
import { CLEANING_ELEMENTS, CLEANING_CHECK_LABELS } from '../lib/formatos/limpiezaAmbientes'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Control del Programa de Limpieza y Sanitización de Ambientes (SIG-GIA-RG-002)
// -- registro MENSUAL, independiente de cualquier orden/lote: 1 control por
// (año, mes), con una grilla área/elemento × día del mes. Techos/Paredes y
// Puertas solo llevan chequeo de Limpieza; Pisos lleva Limpieza Y
// Sanitización por separado. El documento de una orden lo cruza por mes
// (ver quickDocs.js), sin relación guardada -- mismo criterio que Higiene.
//
// La forma grilla área×ítem×fecha(o mes) es genérica -- ver
// hooks/useGridControl.js. Acá el "ítem" de la grilla es un elemento+tipo
// de chequeo combinados ("elementCode::checkType", ver itemKey más abajo)
// y el "valor" de cada (área, ítem) es un mapa { [día]: status } en vez de
// un solo status -- el hook no le exige forma a "valor", así que un control
// mensual con 31 columnas cabe igual que uno de una sola fecha.

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function itemKey(elementCode, checkType) {
  return `${elementCode}::${checkType}`
}

// Click cicla: sin marcar -> correcto -> no_correcto -> sin marcar
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

// Cuenta cuántas celdas quedaron marcadas en un control ya guardado, para el historial.
function countMarks(checks) {
  const total = (checks ?? []).length
  const ok = (checks ?? []).filter(c => c.status === 'correcto').length
  return { total, ok }
}

// A diferencia de Verificación/Plagas (un control = una sola fecha), aquí
// un control es TODO un mes -- no tiene sentido marcar los 31 días como
// correcto de una, se estaría dando por inspeccionado días futuros o que
// nadie miró. Por eso el default de "arranca marcado" solo aplica a la
// columna del día de HOY (si el mes mostrado es el mes actual), y solo
// para celdas que todavía no tengan un valor guardado -- no pisa datos
// reales ya cargados. Se aplica tanto a un control nuevo como a uno que se
// está editando (por si el mes de hoy tiene días sin marcar todavía).
function applyTodayDefault(checksObj, year, month, areasList) {
  const now = new Date()
  if (year !== now.getFullYear() || month !== now.getMonth() + 1) return checksObj
  const today = now.getDate()
  const next = { ...checksObj }
  for (const area of areasList) {
    const byArea = { ...(next[area] ?? {}) }
    for (const el of CLEANING_ELEMENTS) {
      for (const checkType of el.checks) {
        const key = itemKey(el.code, checkType)
        const byDay = { ...(byArea[key] ?? {}) }
        if (byDay[today] == null) byDay[today] = 'correcto'
        byArea[key] = byDay
      }
    }
    next[area] = byArea
  }
  return next
}

export default function LimpiezaAmbientesPage() {
  const [areas, setAreas] = useState([])
  useEffect(() => { loadLimpiezaAmbientesAreas(COOPERATIVE).then(setAreas) }, [])

  const {
    view, setView, controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
  } = useGridControl({
    table: 'plant_cleaning_controls',
    childTable: 'plant_cleaning_checks',
    historySelect: 'id, year, month, responsible_person, observations, plant_cleaning_checks ( status ), registered_by:web_users!pcc_created_by_fkey ( first_name, last_name )',
    historyOrder: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }],
    emptyHeader: () => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1, responsible_person: '', observations: '' }
    },
    validateHeader: h => !h.responsible_person?.trim() ? 'Ingrese el responsable.' : null,
    buildHeaderPayload: h => ({
      year: h.year, month: h.month,
      responsible_person: h.responsible_person.trim(),
      observations: h.observations?.trim() || null,
    }),
    uniqueViolationMessage: 'Ya existe un control para ese año y mes.',
    childSelect: 'area, element, check_type, day, status',
    rowsFromChecks: checks => {
      const rows = []
      for (const [area, byItem] of Object.entries(checks)) {
        for (const [key, byDay] of Object.entries(byItem)) {
          const [element, checkType] = key.split('::')
          for (const [day, status] of Object.entries(byDay)) {
            if (status) rows.push({ area, element, check_type: checkType, day: parseInt(day, 10), status })
          }
        }
      }
      return rows
    },
    checksFromRows: (rows, control) => {
      const next = {}
      for (const r of rows) {
        const byArea = (next[r.area] ??= {})
        const byDay = (byArea[itemKey(r.element, r.check_type)] ??= {})
        byDay[r.day] = r.status
      }
      return applyTodayDefault(next, control.year, control.month, areas)
    },
    defaultChecks: h => applyTodayDefault({}, h.year, h.month, areas),
  })

  function toggleCell(area, elementCode, checkType, day) {
    const key = itemKey(elementCode, checkType)
    const byDay = cellValue(area, key) ?? {}
    const status = nextStatus(byDay[day] ?? null)
    const nextByDay = { ...byDay }
    if (status == null) delete nextByDay[day]
    else nextByDay[day] = status
    setCellValue(area, key, nextByDay)
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Limpieza y Sanitización de Ambientes</h2>
          <button className="btn primary" onClick={startNewControl}>+ Nuevo control</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de limpieza de ambientes registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const { total, ok } = countMarks(c.plant_cleaning_checks)
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{MONTH_NAMES[c.month - 1]} {c.year}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {total > 0 && (
                        <span className={`tag ${ok === total ? 'ok' : 'warn'}`}>{ok}/{total} correcto</span>
                      )}
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
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
  const days = Array.from({ length: daysInMonth(header.year, header.month) }, (_, i) => i + 1)

  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar control' : 'Nuevo control'} de limpieza de ambientes</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            Mes y año identifican a este control ya guardado y no se pueden cambiar aquí. Para otro período, vuelva al historial y use "Editar" o "+ Nuevo control".
          </p>
        )}
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Mes</label>
            <select value={header.month} disabled={!!editingId} onChange={e => updateIdentity({ month: parseInt(e.target.value, 10) })}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
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
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={header.observations ?? ''} onChange={e => updateHeader({ observations: e.target.value })} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Click en cada celda para ciclar: sin marcar → ✓ correcto → ✗ no correcto → sin marcar.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', position: 'sticky', left: 0, background: '#fff', minWidth: 160 }}>Área / Elemento</th>
                {days.map(d => <th key={d} style={{ width: 22, minWidth: 22, fontSize: 10, padding: '2px 0' }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {areas.map(area => (
                <Fragment key={area}>
                  <tr>
                    <td colSpan={days.length + 1} style={{ background: '#f3f4f6', fontWeight: 700, fontSize: 12, padding: '4px 6px' }}>{area}</td>
                  </tr>
                  {CLEANING_ELEMENTS.flatMap(el => el.checks.map(checkType => {
                    const label = el.checks.length > 1 ? `${el.label} — ${CLEANING_CHECK_LABELS[checkType]}` : el.label
                    const byDay = cellValue(area, itemKey(el.code, checkType)) ?? {}
                    return (
                      <tr key={`${area}-${el.code}-${checkType}`}>
                        <td style={{ position: 'sticky', left: 0, background: '#fff', fontSize: 12, whiteSpace: 'nowrap' }}>{label}</td>
                        {days.map(d => {
                          const status = byDay[d] ?? null
                          return (
                            <td key={d} style={{ padding: 0, textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => toggleCell(area, el.code, checkType, d)}
                                style={{
                                  width: 22, height: 22, border: '1px solid var(--border)', borderRadius: 4,
                                  fontWeight: 700, fontSize: 11, cursor: 'pointer', padding: 0,
                                  ...cellStyle(status),
                                }}
                              >
                                {cellSymbol(status)}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  }))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
    </div>
  )
}
