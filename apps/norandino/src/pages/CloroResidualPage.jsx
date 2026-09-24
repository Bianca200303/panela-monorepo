import { useState, useEffect } from 'react'
import { COOPERATIVE } from '../lib/config'
import { useGridControl } from '@panela/core/hooks/useGridControl'
import { loadCloroResidualPuntos } from '@panela/core/lib/formConfig'
import { CHLORINE_RESIDUAL_MIN_PPM } from '../lib/formatos/cloroResidual'
import { getCoopCode } from '@panela/core/lib/formatos/shared'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Control de Cloro Residual (SIG-GIA-RG-001) -- registro por FECHA exacta,
// independiente de cualquier orden/lote: 1 control por fecha, con una
// medición numérica (ppm) por cada punto de control configurado (ver
// lib/formConfig.js loadCloroResidualPuntos(COOPERATIVE) -- antes 3 puntos fijos
// harcodeados, ahora configurable por cooperativa). A diferencia de los
// controles de limpieza, aquí el dato es un número, no un estado
// correcto/no correcto -- se resalta en rojo si está por debajo del límite
// mínimo (0.5ppm), solo como referencia visual. El documento de una orden
// lo cruza por fecha exacta (ver quickDocs.js), mismo criterio que Higiene
// y Verificación de Limpieza.
//
// No tiene agrupación por área (a diferencia de Verificación) -- se usa un
// único grupo fijo ('_') en la grilla del motor genérico, con cada punto
// como "ítem" dentro de ese grupo.
const GROUP = '_'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function belowLimit(ppm) {
  return ppm != null && ppm !== '' && Number(ppm) < CHLORINE_RESIDUAL_MIN_PPM
}

export default function CloroResidualPage() {
  const [points, setPoints] = useState([])
  useEffect(() => { loadCloroResidualPuntos(COOPERATIVE).then(setPoints) }, [])

  const {
    view, setView, controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
  } = useGridControl({
    table: 'plant_chlorine_residual_controls',
    childTable: 'plant_chlorine_residual_checks',
    historySelect: 'id, control_date, responsible_person, formato_codigo, plant_chlorine_residual_checks ( result_ppm ), registered_by:web_users!pcrc_created_by_fkey ( first_name, last_name )',
    historyOrder: [{ column: 'control_date', ascending: false }],
    emptyHeader: () => ({ control_date: todayISO(), responsible_person: '' }),
    validateHeader: h => !h.responsible_person?.trim() ? 'Ingrese el responsable.' : null,
    buildHeaderPayload: h => ({ control_date: h.control_date, responsible_person: h.responsible_person.trim() }),
    uniqueViolationMessage: 'Ya existe un control para esa fecha.',
    generateCode: {
      rpc: 'generate_chlorine_residual_control_code',
      params: () => ({ p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) }),
    },
    childSelect: 'point_code, result_ppm, observations, corrective_action',
    rowsFromChecks: checks => {
      const rows = []
      for (const [point, value] of Object.entries(checks[GROUP] ?? {})) {
        if (value.resultPpm === '' && !value.observations && !value.correctiveAction) continue
        rows.push({
          point_code: point,
          result_ppm: value.resultPpm !== '' ? Number(value.resultPpm) : null,
          observations: value.observations?.trim() || null,
          corrective_action: value.correctiveAction?.trim() || null,
        })
      }
      return rows
    },
    checksFromRows: rows => {
      const byPoint = {}
      for (const r of rows) {
        byPoint[r.point_code] = {
          resultPpm: r.result_ppm != null ? String(r.result_ppm) : '',
          observations: r.observations ?? '',
          correctiveAction: r.corrective_action ?? '',
        }
      }
      return { [GROUP]: byPoint }
    },
  })

  function updatePoint(point, field, value) {
    const current = cellValue(GROUP, point) ?? { resultPpm: '', observations: '', correctiveAction: '' }
    setCellValue(GROUP, point, { ...current, [field]: value })
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Control de Cloro Residual</h2>
          <button className="btn primary" onClick={startNewControl}>+ Nuevo control</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de cloro residual registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const results = (c.plant_chlorine_residual_checks ?? []).map(r => r.result_ppm).filter(v => v != null)
              const anyBelow = results.some(v => Number(v) < CHLORINE_RESIDUAL_MIN_PPM)
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{new Date(`${c.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {results.length > 0 && (
                        <span className={`tag ${anyBelow ? 'warn' : 'ok'}`}>
                          {results.length}/{points.length} medidos{anyBelow ? ' · bajo el límite' : ''}
                        </span>
                      )}
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.formato_codigo && <>Código de Control: <strong style={{ fontFamily: 'monospace' }}>{c.formato_codigo}</strong> · </>}
                    Responsable: {c.responsible_person ?? '—'}
                    {c.registered_by && ` · Registrado por: ${c.registered_by.first_name} ${c.registered_by.last_name}`}
                  </div>
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
        <h2>{editingId ? 'Editar' : 'Nuevo'} control de cloro residual</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            La fecha identifica a este control ya guardado y no se puede cambiar aquí. Para otra fecha, vuelva al historial y use "Editar" o "+ Nuevo control".
          </p>
        )}
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" value={header.control_date} disabled={!!editingId} onChange={e => updateIdentity({ control_date: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Responsable</label>
            <input type="text" value={header.responsible_person} onChange={e => updateHeader({ responsible_person: e.target.value })} placeholder="Nombre de quien completa el control" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Límite de cloro libre residual: mín {CHLORINE_RESIDUAL_MIN_PPM} ppm. Un resultado por debajo se resalta en rojo.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Punto de Control</th>
                <th style={{ width: 110 }}>Resultado CLR (ppm)</th>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Observaciones</th>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Acción Correctiva</th>
              </tr>
            </thead>
            <tbody>
              {points.map(point => {
                const value = cellValue(GROUP, point) ?? { resultPpm: '', observations: '', correctiveAction: '' }
                const isLow = belowLimit(value.resultPpm)
                return (
                  <tr key={point}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{point}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={value.resultPpm}
                        onChange={e => updatePoint(point, 'resultPpm', e.target.value)}
                        style={{ width: '100%', fontSize: 12, color: isLow ? '#dc2626' : undefined, fontWeight: isLow ? 700 : undefined }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={value.observations}
                        onChange={e => updatePoint(point, 'observations', e.target.value)}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={value.correctiveAction}
                        onChange={e => updatePoint(point, 'correctiveAction', e.target.value)}
                        placeholder={isLow ? 'Requerido (bajo el límite)' : 'Opcional'}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </td>
                  </tr>
                )
              })}
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
