import { useRef, useState, useEffect } from 'react'
import Icon from './Icon'

// Reemplazo de <input type="date"> nativo. El input nativo muestra el orden
// día/mes/año según el idioma configurado en el navegador/SO de quien lo
// usa -- no es controlable desde CSS/HTML, así que en una máquina en inglés
// se ve mm/dd aunque el resto de la app esté en español. Este componente
// siempre muestra dd/mm/aaaa sin importar esa configuración: el texto lo
// formateamos nosotros, y el selector nativo de calendario se abre oculto
// solo para elegir el día (su formato de texto interno no se ve nunca).
//
// Drop-in: misma interfaz que el input nativo -- value es ISO
// (yyyy-mm-dd) y onChange recibe un evento con target.value en ISO, así
// que los onChange={e => setX(e.target.value)} existentes no cambian.

function isoToDisplay(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

function displayToIso(display) {
  const match = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  const [, d, m, y] = match
  return `${y}-${m}-${d}`
}

export default function DateInput({ value, onChange, style, className, disabled }) {
  const [text, setText] = useState(isoToDisplay(value))
  const hiddenRef = useRef(null)

  useEffect(() => {
    setText(isoToDisplay(value))
  }, [value])

  const handleTextChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let formatted = digits
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    else if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
    setText(formatted)

    if (formatted === '') { onChange({ target: { value: '' } }); return }
    const iso = displayToIso(formatted)
    if (iso) onChange({ target: { value: iso } })
  }

  const openPicker = () => {
    if (disabled) return
    if (hiddenRef.current?.showPicker) hiddenRef.current.showPicker()
    else hiddenRef.current?.click()
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={text}
        onChange={handleTextChange}
        disabled={disabled}
        maxLength={10}
        className={className}
        style={{ width: '100%', paddingRight: 32, ...style }}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Abrir calendario"
        tabIndex={-1}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', padding: 4,
          display: 'flex', color: 'var(--muted)', opacity: disabled ? 0.5 : 1,
        }}
      >
        <Icon name="calendar" size={14} />
      </button>
      <input
        ref={hiddenRef}
        type="date"
        value={value || ''}
        onChange={onChange}
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, border: 'none', padding: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}
