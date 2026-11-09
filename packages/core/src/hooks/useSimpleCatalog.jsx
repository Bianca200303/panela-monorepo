import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { AUDIT_COLUMNS } from '../lib/audit'
import { toast } from '../lib/toast'

// Catálogo simple de Catálogos (una tabla plana por cooperativa, con
// is_active): carga, alta/edición en un modal y nada más. Lo usan Balanzas y
// Empresas de transporte; evita repetir en CatalogosPage.jsx el mismo bloque
// de estado + modal para cada lista nueva.
//
// fields: [{ key, label, required?, placeholder? }] -- todos texto.
export function useSimpleCatalog({ table, cooperativeId, fields, orderBy, loadKey, handleLoad, titles }) {
  const empty = Object.fromEntries(fields.map(f => [f.key, '']))
  const [rows, setRows]         = useState([])
  const [open, setOpen]         = useState(false)
  const [form, setForm]         = useState(empty)
  const [editingId, setEditing] = useState(null)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  const load = () =>
    supabase
      .from(table)
      .select(`id, ${fields.map(f => f.key).join(', ')}, is_active, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', cooperativeId)
      .order(orderBy)
      .then(handleLoad(loadKey, setRows))

  const openNew = () => { setError(''); setEditing(null); setForm(empty); setOpen(true) }
  const openEdit = (row) => {
    setError('')
    setEditing(row.id)
    setForm(Object.fromEntries(fields.map(f => [f.key, row[f.key] ?? ''])))
    setOpen(true)
  }
  const close = () => { setOpen(false); setError(''); setEditing(null) }

  const save = async () => {
    setError('')
    const missing = fields.filter(f => f.required && !String(form[f.key] ?? '').trim())
    if (missing.length) { setError(`${missing.map(f => f.label).join(', ')}: obligatorio`); return }
    const payload = Object.fromEntries(fields.map(f => [f.key, String(form[f.key] ?? '').trim() || null]))
    setSaving(true)
    try {
      const res = editingId
        ? await supabase.from(table).update(payload).eq('id', editingId)
        : await supabase.from(table).insert({ ...payload, cooperative_id: cooperativeId })
      if (res.error) {
        throw new Error(res.error.code === '23505' ? `Ya existe un registro con ese ${fields[0].label.toLowerCase()}.` : res.error.message)
      }
      toast.success(editingId ? titles.updated : titles.created)
      close()
      setForm(empty)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const modal = open && (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-body">
          <h3 style={{ margin: '0 0 16px' }}>{editingId ? titles.edit : titles.new}</h3>
          <div className="grid two" style={{ gap: 8 }}>
            {fields.map(f => (
              <div key={f.key} className="field" style={{ margin: 0 }}>
                <label>{f.label}{f.required ? ' *' : ''}</label>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={close} disabled={saving}>Cancelar</button>
          <button className="btn small primary" onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )

  return { rows, load, openNew, openEdit, modal }
}
