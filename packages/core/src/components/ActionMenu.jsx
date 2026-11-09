import { useState, useEffect, useRef } from 'react'
import Icon from './Icon'

// Menú "⋯" para acciones secundarias (las que se usan poco), para que no
// compitan en pantalla con la acción principal. items: [{ label, onClick }].
// Se cierra al elegir, con Escape o al hacer clic afuera.
export default function ActionMenu({ items, label = 'Más acciones' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = items.filter(Boolean)
  if (visible.length === 0) return null

  return (
    // stopPropagation: el menú suele vivir dentro de una cabecera que se
    // pliega/despliega con un clic -- usar el menú no debe plegarla.
    <div className="action-menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="action-menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
      >
        <Icon name="moreHorizontal" size={18} />
      </button>
      {open && (
        <div className="action-menu-list" role="menu">
          {visible.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="action-menu-item"
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick() }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
