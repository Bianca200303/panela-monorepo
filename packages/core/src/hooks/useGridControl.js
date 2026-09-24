import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'

// Motor genérico para los "controles de planta" con forma grilla (área/ítem
// × fecha o área/ítem × día del mes): Limpieza de Ambientes, Limpieza de
// Equipos, Verificación de Limpieza, Cloro Residual, y los nuevos de CAES
// (Temperatura/Humedad, Hermeticidad, Calibración de Balanzas, Manejo de
// Residuos, Preparación de Soluciones, Monitoreo del Tamizado). Todos
// comparten el mismo esqueleto real (confirmado comparando Ambientes y
// Verificación línea por línea): historial + control por (fecha) o por
// (año,mes), un encabezado con responsable/observaciones, una grilla que se
// guarda como "borrar hijos + reinsertar" -- lo único que cambia entre
// controles es la forma de la grilla en sí y los nombres de tabla/columna.
//
// No cubre Control de Plagas (dos catálogos de dispositivos en paralelo,
// no una sola grilla área×ítem) ni Salud e Higiene actual de Norandino
// (lista de personas presentes, no área×ítem) -- para Higiene de CAES
// (grilla mensual por persona) sí aplica: "persona" hace de "área".
//
// checks: objeto anidado { [groupKey]: { [itemKey]: valor } } -- la forma
// de "valor" la define cada control (un string de status, un {status,
// correctiveAction}, un {status, products}, un número, etc.), este hook
// nunca mira adentro de "valor", solo lo pasa entre checksFromRows/
// rowsFromChecks y el estado.
export function useGridControl({
  table,
  childTable,
  childFk = 'control_id',
  historySelect,
  historyOrder,
  emptyHeader,
  validateHeader,
  buildHeaderPayload,
  uniqueViolationMessage = 'Ya existe un control para ese período.',
  generateCode,
  childSelect,
  rowsFromChecks,
  checksFromRows,
  defaultChecks,
}) {
  const COOPERATIVE = useCooperative()
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [header, setHeader] = useState(emptyHeader())
  const [checks, setChecks] = useState({})

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    let query = supabase.from(table).select(historySelect).eq('cooperative_id', COOPERATIVE.id)
    for (const { column, ascending } of historyOrder) query = query.order(column, { ascending })
    const { data } = await query.limit(50)
    setControls(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNewControl() {
    setEditingId(null)
    const h = emptyHeader()
    setHeader(h)
    setChecks(defaultChecks ? defaultChecks(h) : {})
    setError('')
    setView('form')
  }

  async function startEditControl(control) {
    setEditingId(control.id)
    setHeader(prev => ({ ...prev, ...control }))

    const { data: rows } = await supabase
      .from(childTable)
      .select(childSelect)
      .eq(childFk, control.id)
    setChecks(checksFromRows(rows ?? [], control))
    setError('')
    setView('form')
  }

  async function handleSave() {
    setError('')
    const validationError = validateHeader?.(header)
    if (validationError) { setError(validationError); return }

    setSaving(true)
    try {
      let controlId = editingId
      const payload = buildHeaderPayload(header)
      if (controlId) {
        const { error: updErr } = await supabase.from(table).update(payload).eq('id', controlId)
        if (updErr) {
          if (updErr.code === '23505') throw new Error(uniqueViolationMessage)
          throw new Error(updErr.message)
        }
        await supabase.from(childTable).delete().eq(childFk, controlId)
      } else {
        let codigo = null
        if (generateCode) {
          const { data, error: codeErr } = await supabase.rpc(generateCode.rpc, generateCode.params())
          if (codeErr) throw new Error(codeErr.message)
          codigo = data
        }
        const { data: newControl, error: insErr } = await supabase
          .from(table)
          .insert({
            ...payload,
            cooperative_id: COOPERATIVE.id,
            created_by: webUser.id,
            ...(codigo != null ? { formato_codigo: codigo } : {}),
          })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') throw new Error(`${uniqueViolationMessage} Búsquelo en el historial y edítelo.`)
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      const rows = rowsFromChecks(checks).map(r => ({ ...r, [childFk]: controlId }))
      if (rows.length > 0) {
        const { error: insChecksErr } = await supabase.from(childTable).insert(rows)
        if (insChecksErr) throw new Error(insChecksErr.message)
      }

      setView('history')
      await loadHistory()
    } catch (err) {
      setError(err.message ?? 'Error al guardar el control')
    } finally {
      setSaving(false)
    }
  }

  function updateHeader(patch) {
    setHeader(prev => ({ ...prev, ...patch }))
  }

  // Para los campos de IDENTIDAD del control (año/mes/turno, o fecha según
  // el control -- lo que define la clave única de la tabla): solo se
  // pueden tocar mientras se está armando un registro nuevo todavía sin
  // guardar (editingId null). Ahí es seguro, y además recalcula `checks`
  // para el período nuevo (si no, quedaría pegado el auto-marcado "hoy" u
  // otro dato calculado para el período anterior). Una vez que el control
  // ya existe (editingId con valor), la página debe dejar esos campos de
  // solo lectura -- cambiarlos ahí relabelearía el registro real sin
  // avisar, ver [[project_higiene_personal_caes_registro_rapido]].
  function updateIdentity(patch) {
    if (editingId) return
    const nextHeader = { ...header, ...patch }
    setHeader(nextHeader)
    setChecks(defaultChecks ? defaultChecks(nextHeader) : {})
  }

  function cellValue(group, item) {
    return checks?.[group]?.[item] ?? null
  }

  function setCellValue(group, item, value) {
    setChecks(prev => {
      const byGroup = { ...(prev[group] ?? {}) }
      if (value == null) delete byGroup[item]
      else byGroup[item] = value
      return { ...prev, [group]: byGroup }
    })
  }

  return {
    view, setView,
    controls, loadingHistory,
    editingId, header, updateHeader, updateIdentity,
    checks, cellValue, setCellValue,
    saving, error,
    startNewControl, startEditControl, handleSave,
    reload: loadHistory,
  }
}
