import { useState } from 'react'
import Icon from './Icon'

const fmt = (ts) => new Date(ts).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })

// Quién registró y quién modificó por última vez un registro (columnas audit_*
// que llena la BD, ver migración bitacora_auditoria; traerlas en el select con
// AUDIT_COLUMNS de lib/audit.js). Discreto: un ícono con el detalle al pasar
// el mouse; con un clic se muestra en línea (útil en pantallas táctiles).
export default function AuditStamp({ row, style }) {
  const [open, setOpen] = useState(false)
  if (!row?.audit_created_at && !row?.audit_updated_at) return null

  const parts = []
  if (row.audit_created_at) {
    parts.push(`Registrado${row.audit_created_by_name ? ` por ${row.audit_created_by_name}` : ''} · ${fmt(row.audit_created_at)}`)
  }
  if (row.audit_updated_at) {
    parts.push(`Modificado por ${row.audit_updated_by_name ?? 'Sistema'} · ${fmt(row.audit_updated_at)}`)
  }

  return (
    <span className="audit-stamp" style={style}>
      <button
        type="button"
        className="audit-stamp-btn"
        title={parts.join('\n')}
        aria-label={parts.join('. ')}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
      >
        <Icon name="user" size={14} />
      </button>
      {open && <span className="audit-stamp-text">{parts.join(' · ')}</span>}
    </span>
  )
}
