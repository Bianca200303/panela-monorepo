import { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useGridControl } from '@panela/core/hooks/useGridControl'
import { useMonthlyGridNavigation } from '@panela/core/hooks/useMonthlyGridNavigation'
import { HYGIENE_CAES_ITEMS, HYGIENE_CAES_ZONAS, HYGIENE_CAES_TURNOS } from '../lib/formatos/higienePersonalCaes'
import { MONTH_NAMES, getCoopCode } from '@panela/core/lib/formatos/shared'
import { useConfirm } from '@panela/core/hooks/useConfirm'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import MonthArrowSelect from '@panela/core/components/MonthArrowSelect'
import PeriodExistsBanner from '@panela/core/components/PeriodExistsBanner'

// Control de Higiene del Personal (CAESP-PP-HYS-RE-HSP-003) -- SOLO CAES,
// ver COOPERATIVE.features.higieneGrillaMensual en lib/config.js. A
// diferencia del Control de Salud e Higiene del Personal de Norandino
// (HigienePage.jsx, 1 control por fecha/turno/área con roster+criterios),
// acá es un registro MENSUAL con una grilla persona × ítem × día -- mismo
// motor que Limpieza de Equipos, con "persona" haciendo de área. La zona de
// trabajo (Tamizado y Homogenizado / Envasado) es un dato de la persona
// dentro de este control, se maneja aparte de la grilla de checks (no es
// parte de useGridControl). Reusa el catálogo plant_personnel ya existente.

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

// Un control nuevo arranca con todos los ítems de hoy en ✓ Correcto -- mismo
// criterio que los demás controles mensuales (Ambientes/Equipos/Limpieza),
// solo la columna de hoy, sin pisar datos guardados.
function applyTodayDefault(checksObj, year, month, personnel) {
  const now = new Date()
  if (year !== now.getFullYear() || month !== now.getMonth() + 1) return checksObj
  const today = now.getDate()
  const next = { ...checksObj }
  for (const p of personnel) {
    const byItem = { ...(next[p.id] ?? {}) }
    for (const item of HYGIENE_CAES_ITEMS) {
      const byDay = { ...(byItem[item.code] ?? {}) }
      if (byDay[today] == null) byDay[today] = 'correcto'
      byItem[item.code] = byDay
    }
    next[p.id] = byItem
  }
  return next
}

function todayDefaultZonas(personnel) {
  return Object.fromEntries(personnel.map(p => [p.id, 'tamizado_homogenizado']))
}

export default function HigienePersonalCaesPage() {
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [personnel, setPersonnel] = useState([])
  const [zonas, setZonas] = useState({})
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')

  const loadPersonnel = useCallback(async () => {
    const { data } = await supabase
      .from('plant_personnel')
      .select('id, first_name, last_name, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('is_active', true)
      .order('first_name')
    setPersonnel(data ?? [])
  }, [])

  useEffect(() => { loadPersonnel() }, [loadPersonnel])

  const {
    view, setView, controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
  } = useGridControl({
    table: 'plant_hygiene_controls_caes',
    childTable: 'plant_hygiene_checks_caes',
    historySelect: 'id, year, month, turno, responsible_person, observations, formato_codigo, plant_hygiene_checks_caes ( status ), registered_by:web_users!phcc_created_by_fkey ( first_name, last_name )',
    historyOrder: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }],
    emptyHeader: () => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1, turno: 'manana', responsible_person: '', observations: '' }
    },
    validateHeader: h => !h.responsible_person?.trim() ? 'Ingrese el responsable.' : null,
    buildHeaderPayload: h => ({
      year: h.year,
      month: h.month,
      turno: h.turno,
      responsible_person: h.responsible_person.trim(),
      observations: h.observations?.trim() || null,
    }),
    uniqueViolationMessage: 'Ya existe un control para ese año, mes y turno.',
    generateCode: {
      rpc: 'generate_hygiene_caes_control_code',
      params: () => ({ p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) }),
    },
    childSelect: 'personnel_id, zona, item, day, status',
    rowsFromChecks: checks => {
      const rows = []
      for (const [personnelId, byItem] of Object.entries(checks)) {
        const zona = zonas[personnelId] ?? 'tamizado_homogenizado'
        for (const [item, byDay] of Object.entries(byItem)) {
          for (const [day, status] of Object.entries(byDay)) {
            if (status) rows.push({ personnel_id: personnelId, zona, item, day: parseInt(day, 10), status })
          }
        }
      }
      return rows
    },
    // Side effect (fuera del render, disparado desde startEditControl):
    // deriva `zonas` de las mismas filas -- la zona es dato de la persona
    // dentro de este control, no parte de la grilla de checks del hook.
    checksFromRows: (rows, control) => {
      const next = {}
      const zonasNext = {}
      for (const r of rows) {
        const byItem = (next[r.personnel_id] ??= {})
        const byDay = (byItem[r.item] ??= {})
        byDay[r.day] = r.status
        zonasNext[r.personnel_id] = r.zona
      }
      for (const p of personnel) if (!(p.id in zonasNext)) zonasNext[p.id] = 'tamizado_homogenizado'
      setZonas(zonasNext)
      return applyTodayDefault(next, control.year, control.month, personnel)
    },
    defaultChecks: h => {
      setZonas(todayDefaultZonas(personnel))
      return applyTodayDefault({}, h.year, h.month, personnel)
    },
  })

  // (año, mes, turno) es la identidad del control -- "turno" es lo único
  // que este control le suma al shape genérico (año, mes) que ya cubre
  // useMonthlyGridNavigation por defecto.
  const {
    quickDay, setDayFilterActive,
    quickDayInThisMonth, showOnlyDay, days,
    startToday, shiftIdentityMonth, resetDayFilter,
    existingForIdentity,
  } = useMonthlyGridNavigation({
    header, controls, editingId,
    updateIdentity, startNewControl, startEditControl,
    extraIdentityKeys: ['turno'],
  })

  function toggleCell(personnelId, itemCode, day) {
    const current = cellValue(personnelId, itemCode)?.[day] ?? null
    const status = nextStatus(current)
    const byDay = { ...(cellValue(personnelId, itemCode) ?? {}) }
    if (status == null) delete byDay[day]
    else byDay[day] = status
    setCellValue(personnelId, itemCode, byDay)
  }

  function setPersonZona(personnelId, zona) {
    setZonas(prev => ({ ...prev, [personnelId]: zona }))
  }

  async function handleAddPersonnel() {
    if (!newFirstName.trim() || !newLastName.trim()) return
    const { data: newPerson, error: insErr } = await supabase
      .from('plant_personnel')
      .insert({ cooperative_id: COOPERATIVE.id, first_name: newFirstName.trim(), last_name: newLastName.trim() })
      .select('id, first_name, last_name, is_active')
      .single()
    if (insErr) return
    setPersonnel(prev => [...prev, newPerson].sort((a, b) => a.first_name.localeCompare(b.first_name)))
    setZonas(prev => ({ ...prev, [newPerson.id]: 'tamizado_homogenizado' }))

    // Mismo criterio que defaultChecks/checksFromRows: la columna de HOY
    // arranca en ✓ correcto para los 8 ítems, pero solo si el mes que se
    // está viendo es el mes actual -- si no, se agrega sin marcar.
    const now = new Date()
    const isCurrentMonth = header.year === now.getFullYear() && header.month === now.getMonth() + 1
    for (const item of HYGIENE_CAES_ITEMS) {
      setCellValue(newPerson.id, item.code, isCurrentMonth ? { [now.getDate()]: 'correcto' } : {})
    }

    setNewFirstName('')
    setNewLastName('')
  }

  async function handleDeactivatePersonnel(person) {
    const ok = await confirm({
      title: 'Dar de baja del catálogo',
      message: `¿Dar de baja a ${person.first_name} ${person.last_name}? No va a aparecer en los próximos controles, pero se conservan sus registros anteriores.`,
      confirmText: 'Dar de baja',
    })
    if (!ok) return
    await supabase.from('plant_personnel').update({ is_active: false }).eq('id', person.id)
    setPersonnel(prev => prev.filter(p => p.id !== person.id))
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Higiene del Personal</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => startToday({ turno: 'manana' })}>Registrar hoy (Mañana)</button>
            <button className="btn primary" onClick={() => startToday({ turno: 'tarde' })}>Registrar hoy (Tarde)</button>
            <button className="btn small outline" onClick={() => { resetDayFilter(); startNewControl() }}>+ Nuevo control</button>
          </div>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de higiene registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const total = c.plant_hygiene_checks_caes?.length ?? 0
              const ok = (c.plant_hygiene_checks_caes ?? []).filter(x => x.status === 'correcto').length
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{MONTH_NAMES[c.month - 1]} {c.year}</strong>
                      <span className="muted small" style={{ marginLeft: 8 }}>{HYGIENE_CAES_TURNOS[c.turno] ?? c.turno}</span>
                      {c.formato_codigo && <span className="muted small" style={{ marginLeft: 8 }}>{c.formato_codigo}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {total > 0 && <span className={`tag ${ok === total ? 'ok' : 'warn'}`}>{ok}/{total} correcto</span>}
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
        {confirmDialog}
      </div>
    )
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar control' : 'Nuevo control'} de higiene del personal</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            Mes, año y turno identifican a este control ya guardado y no se pueden cambiar aquí. Para otro período, vuelva al historial y use "Editar".
          </p>
        )}
        <div className="grid four" style={{ gap: 8 }}>
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
            <label>Turno</label>
            <select value={header.turno} disabled={!!editingId} onChange={e => updateIdentity({ turno: e.target.value })}>
              <option value="manana">Mañana</option>
              <option value="tarde">Tarde</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Responsable</label>
            <input type="text" value={header.responsible_person} onChange={e => updateHeader({ responsible_person: e.target.value })} placeholder="Nombre de quien completa el control" />
          </div>
        </div>
        {existingForIdentity && (
          <PeriodExistsBanner
            periodLabel={`${MONTH_NAMES[header.month - 1]} ${header.year} (${HYGIENE_CAES_TURNOS[header.turno]})`}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Personal</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" className="input" placeholder="Nombre" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} style={{ width: 130 }} />
            <input type="text" className="input" placeholder="Apellido" value={newLastName} onChange={e => setNewLastName(e.target.value)} style={{ width: 130 }} />
            <button className="btn small outline" onClick={handleAddPersonnel}>+ Agregar al catálogo</button>
          </div>
        </div>
        {quickDayInThisMonth && (
          <button className="btn small outline" style={{ marginBottom: 8 }} onClick={() => setDayFilterActive(v => !v)}>
            {showOnlyDay ? 'Ver mes completo' : `Ver solo el día ${quickDay.day}`}
          </button>
        )}
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Click en cada celda: sin marcar → ✓ correcto → ✗ no correcto → sin marcar.
        </p>

        {personnel.length === 0 ? (
          <p className="muted small">Todavía no hay personal cargado -- agregue el primero arriba.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table small" style={{ minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', position: 'sticky', left: 0, background: '#fff', minWidth: 220 }}>Persona / Ítem</th>
                  {days.map(d => (
                    <th key={d} style={{ width: showOnlyDay ? 60 : 22, minWidth: showOnlyDay ? 60 : 22, fontSize: showOnlyDay ? 12 : 10, padding: '2px 0' }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {personnel.map(p => (
                  <Fragment key={p.id}>
                    <tr>
                      <td colSpan={days.length + 1} style={{ background: '#f3f4f6', fontWeight: 700, fontSize: 12, padding: '4px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span>{p.first_name} {p.last_name}</span>
                          <select
                            className="input"
                            value={zonas[p.id] ?? 'tamizado_homogenizado'}
                            onChange={e => setPersonZona(p.id, e.target.value)}
                            style={{ width: 'auto', fontSize: 11, fontWeight: 400, padding: '3px 6px' }}
                          >
                            {Object.entries(HYGIENE_CAES_ZONAS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                          </select>
                          <button
                            className="btn small outline"
                            style={{ fontSize: 11, padding: '1px 6px', marginLeft: 'auto' }}
                            onClick={() => handleDeactivatePersonnel(p)}
                            title="Dar de baja del catálogo"
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {HYGIENE_CAES_ITEMS.map(item => (
                      <tr key={`${p.id}-${item.code}`}>
                        <td style={{ position: 'sticky', left: 0, background: '#fff', fontSize: 12, whiteSpace: 'nowrap' }}>{item.label}</td>
                        {days.map(d => {
                          const value = cellValue(p.id, item.code)?.[d] ?? null
                          return (
                            <td key={d} style={{ padding: 0, textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => toggleCell(p.id, item.code, d)}
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
        )}
      </div>
      )}

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !!existingForIdentity} title={existingForIdentity ? 'Elija un período que todavía no tenga control, o abra el existente' : undefined}>
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
      {confirmDialog}
    </div>
  )
}
