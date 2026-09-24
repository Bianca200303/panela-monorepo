import { useState } from 'react'
import Icon from '../components/Icon'

export default function Secc({ titulo, badge, colorTitulo = '#374151', bgBody = '#f8fafc', children }) {
  const [open, setOpen] = useState(false)
  const toggle = () => setOpen(o => !o)
  return (
    <div style={{ borderLeft: `4px solid ${colorTitulo}`, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', background: open ? bgBody : '#fff' }}>
        {/* Zona de toggle — ocupa todo el espacio sobrante, título trunca si no cabe */}
        <div
          role="button" tabIndex={0}
          onClick={toggle}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 10px 10px 12px',
            border: 'none', cursor: 'pointer', textAlign: 'left', background: 'transparent',
            minWidth: 0, overflow: 'hidden',
          }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            background: open ? colorTitulo : 'transparent',
            border: `2px solid ${colorTitulo}`,
            color: open ? '#fff' : colorTitulo,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></span>
          <span style={{
            fontSize: 12, fontWeight: 700, color: colorTitulo, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{titulo}</span>
        </div>
        {/* Zona del badge — columna fija a la derecha, nunca se solapa con el título */}
        {badge != null && (
          <div style={{
            display: 'flex', alignItems: 'center', flexShrink: 0,
            padding: '8px 12px', borderLeft: `1px solid ${colorTitulo}22`,
          }}>
            {typeof badge === 'string'
              ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{badge}</span>
              : badge}
          </div>
        )}
      </div>
      {open && <div style={{ background: bgBody, padding: '12px 14px', borderTop: `1px solid ${colorTitulo}33` }}>{children}</div>}
    </div>
  )
}
