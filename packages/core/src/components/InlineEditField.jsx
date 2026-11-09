import { useState } from 'react'

// Dato corto editable en línea dentro de una tarjeta/lista: muestra
// "Etiqueta: valor" (o "sin registrar") con un botón, y al tocarlo un input
// con Guardar/Cancelar (Enter/Escape). Lo usan el N° de orden, el
// Contenedor N° y la GR del transportista -- antes cada uno repetía su
// propia copia de este mismo bloque.
//
// onSave(valorRecortado) es async y lanza Error con el mensaje a mostrar si
// no se pudo guardar (validación o error de BD). Guardar sin cambios solo
// cierra el editor.
export default function InlineEditField({
  label, value, onSave,
  placeholder, emptyText = 'sin registrar', emptyTone = 'muted',
  emptyButton = 'Registrar', filledButton = 'Editar', inputWidth = 170,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const current = value ?? ''

  const stop = (e) => e?.stopPropagation?.()
  const open = (e) => { stop(e); setDraft(current); setError(''); setEditing(true) }
  const cancel = (e) => { stop(e); setEditing(false); setError('') }

  const save = async (e) => {
    stop(e)
    const trimmed = draft.trim()
    if (trimmed === String(current).trim()) { setEditing(false); return }
    setSaving(true); setError('')
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const btn = { fontSize: 11, padding: '2px 8px' }
  const wrap = { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }

  if (editing) {
    return (
      <span onClick={stop} style={wrap}>
        <input
          autoFocus type="text" value={draft} placeholder={placeholder ?? label}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(e); if (e.key === 'Escape') cancel(e) }}
          style={{ fontSize: 12, padding: '2px 6px', width: inputWidth }}
        />
        <button className="btn small primary" style={btn} onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
        <button className="btn small outline" style={btn} onClick={cancel} disabled={saving}>Cancelar</button>
        {error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span>}
      </span>
    )
  }

  return (
    <span onClick={stop} style={wrap}>
      <span className="small">
        {label}: {current
          ? <strong>{current}</strong>
          : <span style={{ color: emptyTone === 'warning' ? 'var(--warning-text)' : 'var(--muted)' }}>{emptyText}</span>}
      </span>
      <button className="btn small outline" style={btn} onClick={open}>{current ? filledButton : emptyButton}</button>
    </span>
  )
}
