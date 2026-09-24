import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Muestra el número de orden de producción dado por el cliente
// (client_order_number). Si todavía no se registró, en vez de caer al
// código interno largo (ej. "OP-NORA-2026-004", que no significa nada para
// el cliente) muestra un aviso corto + botón para registrarlo ahí mismo.
//
// El guardado es un UPDATE directo sobre la orden ya existente (por su id)
// -- nunca crea una fila nueva en plant_orders ni vuelve a generar
// order_code, así que no hay forma de terminar con un registro doble por
// usar este atajo en vez del modal completo "Editar orden".
export default function OrderNumberField({ order, onSaved, prefix = 'Orden ' }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const startEdit = (e) => {
    e.stopPropagation()
    setValue('')
    setError('')
    setEditing(true)
  }

  const cancelEdit = (e) => {
    e.stopPropagation()
    setEditing(false)
    setError('')
  }

  const handleSave = async (e) => {
    e.stopPropagation()
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Ingrese un número')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error: updErr } = await supabase
        .from('plant_orders')
        .update({ client_order_number: trimmed })
        .eq('id', order.id)
      if (updErr) throw new Error(updErr.message)
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (order.client_order_number) {
    return <strong>{prefix}{order.client_order_number}</strong>
  }

  if (editing) {
    return (
      <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <input
          autoFocus
          type="text"
          placeholder="N° de orden de producción"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(e) }}
          style={{ fontSize: 12, padding: '2px 6px', width: 170 }}
        />
        <button className="btn small primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button className="btn small outline" style={{ fontSize: 11, padding: '2px 8px' }} onClick={cancelEdit} disabled={saving}>
          Cancelar
        </button>
        {error && <span style={{ color: '#dc2626', fontSize: 11 }}>{error}</span>}
      </span>
    )
  }

  return (
    <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="muted small">N° de orden de producción: SIN REGISTRAR</span>
      <button className="btn small outline" style={{ fontSize: 11, padding: '2px 8px' }} onClick={startEdit}>
        Registrar ahora
      </button>
    </span>
  )
}
