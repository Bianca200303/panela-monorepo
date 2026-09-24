import { useState, useEffect, Fragment } from 'react'
import { useCooperative } from '../lib/cooperativeContext'
import { useGridControl } from '../hooks/useGridControl'
import { loadCleaningVerificationAreas, getCleaningVerificationPersonalNote } from '../lib/formatos/verificacionLimpieza'
import { getCoopCode } from '../lib/formatos/shared'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import PeriodExistsBanner from '../components/PeriodExistsBanner'

// Mismo motor/tabla en ambas cooperativas, pero representa un papel físico
// distinto en cada una: en Norandino es la "Verificación del Programa de
// Limpieza y Sanitización" (SIG-GIA-RG-009); en CAES es la "Inspección de
// Ambientes, Equipos y Personal" (CAESP-PP-HYS-RE-HYS-002) -- ver
// verificacionLimpiezaLabel en lib/config.js y [[project_verificacion_limpieza_caes]].
// Registro por FECHA exacta (no mensual como Ambientes/Equipos), independiente
// de cualquier orden/lote: 1 control por fecha, con una condición
// (correcto/no correcto) + acción correctiva en texto libre por cada uno de
// los ítems fijos del catálogo de áreas (propio de cada cooperativa). El
// documento de una orden lo cruza por fecha exacta (ver quickDocs.js), sin
// relación guardada -- mismo criterio que Higiene de Personal. La forma
// grilla área×ítem×fecha es genérica -- ver hooks/useGridControl.js.

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function cellStyle(status) {
  if (status === 'correcto') return { color: '#166534', background: '#f0fdf4', borderColor: '#166534' }
  if (status === 'no_correcto') return { color: '#991b1b', background: '#fef2f2', borderColor: '#991b1b' }
  return { color: '#999', background: '#fff' }
}

// Cuenta cuántos ítems quedaron marcados en un control ya guardado, para el historial.
function countMarks(checks) {
  const total = (checks ?? []).length
  const ok = (checks ?? []).filter(c => c.status === 'correcto').length
  return { total, ok }
}

// Un control nuevo arranca con todos los ítems en ✓ Correcto -- en la
// práctica la gran mayoría de los ~80 ítems están bien la mayor parte del
// tiempo, así que alcanza con tocar las excepciones (1 click para pasar a
// ✗) en vez de marcar los ~80 uno por uno. Solo aplica a controles nuevos:
// al editar uno guardado se respeta tal cual lo que ya se guardó.
function buildDefaultChecks(areas) {
  const next = {}
  for (const { area, items } of areas) {
    const byArea = {}
    for (const item of items) byArea[item.code] = { status: 'correcto', correctiveAction: '' }
    next[area] = byArea
  }
  return next
}

export default function VerificacionLimpiezaPage() {
  const COOPERATIVE = useCooperative()
  // Mismo motor en ambas cooperativas, pero representa un papel físico
  // distinto en cada una -- ver comentario de verificacionLimpiezaLabel en
  // cada lib/config.js de app. NOMBRE_PLURAL asume que el sustantivo
  // termina en "-ción" (verificación/inspección), válido para las 2
  // cooperativas actuales.
  const VL_LABEL   = COOPERATIVE.features.verificacionLimpiezaLabel
  const VL_NOMBRE  = COOPERATIVE.features.verificacionLimpiezaNombre
  const VL_PLURAL  = VL_NOMBRE.replace(/ción$/, 'ciones')

  const [areas, setAreas] = useState([])
  useEffect(() => { loadCleaningVerificationAreas(COOPERATIVE).then(setAreas) }, [])

  const {
    view, setView, controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
  } = useGridControl({
    table: 'plant_cleaning_verification_controls',
    childTable: 'plant_cleaning_verification_checks',
    historySelect: 'id, control_date, responsible_person, observations, formato_codigo, plant_cleaning_verification_checks ( status ), registered_by:web_users!pcvc_created_by_fkey ( first_name, last_name )',
    historyOrder: [{ column: 'control_date', ascending: false }],
    emptyHeader: () => ({ control_date: todayISO(), responsible_person: '', observations: '' }),
    validateHeader: h => !h.responsible_person?.trim() ? 'Ingrese el responsable.' : null,
    buildHeaderPayload: h => ({
      control_date: h.control_date,
      responsible_person: h.responsible_person.trim(),
      observations: h.observations?.trim() || null,
    }),
    uniqueViolationMessage: 'Ya existe un control para esa fecha.',
    generateCode: {
      rpc: 'generate_cleaning_verification_control_code',
      params: () => ({ p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) }),
    },
    childSelect: 'area, item, status, corrective_action',
    rowsFromChecks: checks => {
      const rows = []
      for (const [area, byItem] of Object.entries(checks)) {
        for (const [item, value] of Object.entries(byItem)) {
          if (value?.status) rows.push({ area, item, status: value.status, corrective_action: value.correctiveAction?.trim() || null })
        }
      }
      return rows
    },
    checksFromRows: rows => {
      const next = {}
      for (const r of rows) {
        const byArea = (next[r.area] ??= {})
        byArea[r.item] = { status: r.status, correctiveAction: r.corrective_action ?? '' }
      }
      return next
    },
    defaultChecks: () => buildDefaultChecks(areas),
  })

  function startToday() {
    const today = todayISO()
    const existing = controls.find(c => c.control_date === today)
    if (existing) {
      startEditControl(existing)
    } else {
      startNewControl()
    }
  }

  function setStatus(area, code, status) {
    const current = cellValue(area, code)
    const nextStatus = current?.status === status ? null : status
    if (nextStatus == null && !current?.correctiveAction) {
      setCellValue(area, code, null)
    } else {
      setCellValue(area, code, { status: nextStatus, correctiveAction: current?.correctiveAction ?? '' })
    }
  }

  function setCorrectiveAction(area, code, text) {
    const current = cellValue(area, code)
    setCellValue(area, code, { status: current?.status ?? null, correctiveAction: text })
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>{VL_LABEL}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={startToday}>Registrar hoy</button>
            <button className="btn small outline" onClick={startNewControl}>+ Nueva {VL_NOMBRE}</button>
          </div>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message={`No hay ${VL_PLURAL} registradas aún.`} />
        ) : (
          <div className="list">
            {controls.map(c => {
              const { total, ok } = countMarks(c.plant_cleaning_verification_checks)
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{new Date(`${c.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {total > 0 && (
                        <span className={`tag ${ok === total ? 'ok' : 'warn'}`}>{ok}/{total} correcto</span>
                      )}
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.formato_codigo && <>Código de Control: <strong style={{ fontFamily: 'monospace' }}>{c.formato_codigo}</strong> · </>}
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
  const existingForDate = !editingId ? controls.find(c => c.control_date === header.control_date) : null

  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar' : 'Nueva'} {VL_NOMBRE}</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            La fecha identifica a este control ya guardado y no se puede cambiar aquí. Para otra fecha, vuelva al historial y use "Editar" o "+ Nueva {VL_NOMBRE}".
          </p>
        )}
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" value={header.control_date} disabled={!!editingId} onChange={e => updateIdentity({ control_date: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Responsable</label>
            <input type="text" value={header.responsible_person} onChange={e => updateHeader({ responsible_person: e.target.value })} placeholder="Coordinador SIG / Supervisor" />
          </div>
        </div>
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={header.observations ?? ''} onChange={e => updateHeader({ observations: e.target.value })} />
        </div>
        {existingForDate && (
          <PeriodExistsBanner
            periodLabel={new Date(`${header.control_date}T00:00:00`).toLocaleDateString('es-PE')}
            responsiblePerson={existingForDate.registered_by ? `${existingForDate.registered_by.first_name} ${existingForDate.registered_by.last_name}` : null}
            onOpen={() => startEditControl(existingForDate)}
          />
        )}
      </div>

      {!existingForDate && (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          ✓ Correcto / ✗ No correcto por ítem, con acción correctiva opcional. {getCleaningVerificationPersonalNote(COOPERATIVE)}
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 220 }}>Área / Descripción</th>
                <th style={{ width: 90 }}>Condición</th>
                <th style={{ textAlign: 'left', minWidth: 220 }}>Acciones Correctivas</th>
              </tr>
            </thead>
            <tbody>
              {areas.map(({ area, items }) => (
                <Fragment key={area}>
                  <tr>
                    <td colSpan={3} style={{ background: '#f3f4f6', fontWeight: 700, fontSize: 12, padding: '4px 6px' }}>{area}</td>
                  </tr>
                  {items.map(item => {
                    const value = cellValue(area, item.code)
                    return (
                      <tr key={`${area}-${item.code}`}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{item.label}</td>
                        <td style={{ padding: '2px 0' }}>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => setStatus(area, item.code, 'correcto')}
                              style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700, ...cellStyle(value?.status === 'correcto' ? 'correcto' : null) }}
                            >✓</button>
                            <button
                              type="button"
                              onClick={() => setStatus(area, item.code, 'no_correcto')}
                              style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700, ...cellStyle(value?.status === 'no_correcto' ? 'no_correcto' : null) }}
                            >✗</button>
                          </div>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={value?.correctiveAction ?? ''}
                            onChange={e => setCorrectiveAction(area, item.code, e.target.value)}
                            placeholder="Acción correctiva (opcional)"
                            style={{ width: '100%', fontSize: 12 }}
                          />
                        </td>
                      </tr>
                    )
                  })}
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
        <button
          className="btn primary"
          onClick={handleSave}
          disabled={saving || !!existingForDate}
          title={existingForDate ? 'Elija una fecha que todavía no tenga control, o abra el existente' : undefined}
        >
          {saving ? 'Guardando...' : `Guardar ${VL_NOMBRE}`}
        </button>
      </div>
    </div>
  )
}
