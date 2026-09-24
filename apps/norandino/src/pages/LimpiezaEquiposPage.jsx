import { useState, useEffect, Fragment } from 'react'
import { useGridControl } from '@panela/core/hooks/useGridControl'
import { loadEquipmentCleaningAreas, EQUIPMENT_CLEANING_PRODUCT_CODES, EQUIPMENT_CLEANING_PRODUCT_LABELS } from '../lib/formatos/limpiezaEquipos'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Control del Programa de Limpieza y Sanitización de Equipos - Utensilios
// (SIG-GIA-RG-003) -- registro MENSUAL, independiente de cualquier
// orden/lote: 1 control por (año, mes), con una grilla área/equipo × día
// del mes. A diferencia de Ambientes, cada celda lleva un solo chequeo
// (correcto/no correcto) más el/los producto(s) usados (H/A/D, pueden
// combinarse) -- por eso el click abre un mini-formulario en vez de ciclar.
// Los equipos de "Otros" no llevan producto (mismo criterio que el papel
// físico real), así que esos sí ciclan directo como en Ambientes. El
// documento de una orden lo cruza por mes (ver quickDocs.js), sin relación
// guardada -- mismo criterio que Ambientes/Higiene. La forma grilla
// área×equipo×día del mes es genérica -- ver hooks/useGridControl.js.

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Click cicla: sin marcar -> correcto -> no_correcto -> sin marcar (solo para equipos sin producto, ej. "Otros")
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

// Igual criterio que Ambientes: un control aquí es todo un mes, así que el
// default de "arranca marcado" solo aplica a la columna del día de HOY (si
// el mes mostrado es el mes actual) y solo para celdas sin valor guardado
// -- no pisa datos reales ya cargados. El producto queda vacío por default
// (se completa a mano si corresponde).
function applyTodayDefault(checksObj, year, month, areas) {
  const now = new Date()
  if (year !== now.getFullYear() || month !== now.getMonth() + 1) return checksObj
  const today = now.getDate()
  const next = { ...checksObj }
  for (const { area, items } of areas) {
    const byArea = { ...(next[area] ?? {}) }
    for (const item of items) {
      const byEquipment = { ...(byArea[item.code] ?? {}) }
      if (byEquipment[today] == null) byEquipment[today] = { status: 'correcto', products: [] }
      byArea[item.code] = byEquipment
    }
    next[area] = byArea
  }
  return next
}

export default function LimpiezaEquiposPage() {
  const [areas, setAreas] = useState([])
  useEffect(() => { loadEquipmentCleaningAreas().then(setAreas) }, [])

  const {
    view, setView, controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
  } = useGridControl({
    table: 'plant_equipment_cleaning_controls',
    childTable: 'plant_equipment_cleaning_checks',
    historySelect: 'id, year, month, responsible_person, observations, plant_equipment_cleaning_checks ( status ), registered_by:web_users!pecc_created_by_fkey ( first_name, last_name )',
    historyOrder: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }],
    emptyHeader: () => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1, responsible_person: '', observations: '' }
    },
    validateHeader: h => !h.responsible_person?.trim() ? 'Ingrese el responsable.' : null,
    buildHeaderPayload: h => ({
      year: h.year,
      month: h.month,
      responsible_person: h.responsible_person.trim(),
      observations: h.observations?.trim() || null,
    }),
    uniqueViolationMessage: 'Ya existe un control para ese año y mes.',
    childSelect: 'area, equipment, day, status, products',
    rowsFromChecks: checks => {
      const rows = []
      for (const [area, byEquipment] of Object.entries(checks)) {
        for (const [equipment, byDay] of Object.entries(byEquipment)) {
          for (const [day, value] of Object.entries(byDay)) {
            if (value?.status) rows.push({ area, equipment, day: parseInt(day, 10), status: value.status, products: value.products ?? [] })
          }
        }
      }
      return rows
    },
    checksFromRows: (rows, control) => {
      const next = {}
      for (const r of rows) {
        const byArea = (next[r.area] ??= {})
        const byEquipment = (byArea[r.equipment] ??= {})
        byEquipment[r.day] = { status: r.status, products: r.products ?? [] }
      }
      return applyTodayDefault(next, control.year, control.month, areas)
    },
    defaultChecks: h => applyTodayDefault({}, h.year, h.month, areas),
  })

  // Celda que se está editando en el popover (equipos con producto)
  const [editingCell, setEditingCell] = useState(null) // { area, code, label, day }
  const [draftStatus, setDraftStatus] = useState(null)
  const [draftProducts, setDraftProducts] = useState([])

  function setDayValue(area, code, day, value) {
    const byDay = { ...(cellValue(area, code) ?? {}) }
    if (value == null) delete byDay[day]
    else byDay[day] = value
    setCellValue(area, code, byDay)
  }

  // Equipos sin producto (ej. "Otros"): cicla directo, igual que Ambientes.
  function toggleSimpleCell(area, code, day) {
    const current = cellValue(area, code)?.[day] ?? null
    const status = nextStatus(current?.status ?? null)
    setDayValue(area, code, day, status == null ? null : { status, products: [] })
  }

  // Equipos con producto: abre el mini-formulario.
  function openCellEditor(area, code, label, day) {
    const current = cellValue(area, code)?.[day] ?? null
    setDraftStatus(current?.status ?? null)
    setDraftProducts(current?.products ?? [])
    setEditingCell({ area, code, label, day })
  }

  function toggleDraftProduct(code) {
    setDraftProducts(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
  }

  function saveCellEditor() {
    const { area, code, day } = editingCell
    setDayValue(area, code, day, draftStatus == null ? null : { status: draftStatus, products: draftProducts })
    setEditingCell(null)
  }

  function clearCellEditor() {
    const { area, code, day } = editingCell
    setDayValue(area, code, day, null)
    setEditingCell(null)
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Limpieza y Sanitización de Equipos - Utensilios</h2>
          <button className="btn primary" onClick={startNewControl}>+ Nuevo control</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de limpieza de equipos registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const { total, ok } = countMarks(c.plant_equipment_cleaning_checks)
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
        <h2>{editingId ? 'Editar control' : 'Nuevo control'} de limpieza de equipos</h2>
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
          Click en cada celda: equipos con producto abren un mini-formulario (producto + estado); "Otros" cicla directo sin marcar → ✓ correcto → ✗ no correcto → sin marcar.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', position: 'sticky', left: 0, background: '#fff', minWidth: 160 }}>Área / Equipo</th>
                {days.map(d => <th key={d} style={{ width: 22, minWidth: 22, fontSize: 10, padding: '2px 0' }}>{d}</th>)}
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
                      <td style={{ position: 'sticky', left: 0, background: '#fff', fontSize: 12, whiteSpace: 'nowrap' }}>{item.label}</td>
                      {days.map(d => {
                        const value = cellValue(area, item.code)?.[d] ?? null
                        const tracksProduct = item.tracksProduct !== false
                        return (
                          <td key={d} style={{ padding: 0, textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => tracksProduct ? openCellEditor(area, item.code, item.label, d) : toggleSimpleCell(area, item.code, d)}
                              title={value?.products?.length ? value.products.join('') : undefined}
                              style={{
                                width: 22, height: 22, border: '1px solid var(--border)', borderRadius: 4,
                                fontWeight: 700, fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: 1,
                                ...cellStyle(value?.status),
                              }}
                            >
                              {cellSymbol(value?.status)}
                              {value?.products?.length > 0 && <div style={{ fontSize: 7 }}>{value.products.join('')}</div>}
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

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>

      {editingCell && (
        <div className="modal-overlay" onClick={() => setEditingCell(null)}>
          <div className="modal-content" style={{ maxWidth: 320 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body">
              <h3 style={{ marginTop: 0 }}>{editingCell.label} — Día {editingCell.day}</h3>

              <div className="field">
                <label>Estado</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className={`btn small ${draftStatus === 'correcto' ? 'primary' : 'outline'}`}
                    onClick={() => setDraftStatus('correcto')}
                  >✓ Correcto</button>
                  <button
                    type="button"
                    className={`btn small ${draftStatus === 'no_correcto' ? 'primary' : 'outline'}`}
                    onClick={() => setDraftStatus('no_correcto')}
                  >✗ No correcto</button>
                </div>
              </div>

              <div className="field">
                <label>Producto empleado</label>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {EQUIPMENT_CLEANING_PRODUCT_CODES.map(code => (
                    <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={draftProducts.includes(code)}
                        onChange={() => toggleDraftProduct(code)}
                      />
                      {code}: {EQUIPMENT_CLEANING_PRODUCT_LABELS[code]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={clearCellEditor}>Borrar marca</button>
              <div style={{ flex: 1 }} />
              <button className="btn small" onClick={() => setEditingCell(null)}>Cancelar</button>
              <button className="btn primary small" onClick={saveCellEditor} disabled={draftStatus == null}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
