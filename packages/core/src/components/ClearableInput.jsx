import { useRef } from 'react'
import Icon from './Icon'

// Input de texto con una "X" para borrar lo escrito de un toque. Se usa en
// todos los buscadores de la web. Acepta las mismas props que un <input>
// (className, placeholder, style...), más `onClear`, que debe dejar el valor
// en ''. La "X" solo aparece cuando hay texto, y tras borrar el foco vuelve
// al input para seguir escribiendo.
export default function ClearableInput({ value, onClear, className, ...rest }) {
  const inputRef = useRef(null)
  const hasValue = value != null && String(value) !== ''

  return (
    <span className="clearable-input">
      <input
        ref={inputRef}
        type="text"
        {...rest}
        value={value}
        className={`clearable-field${className ? ` ${className}` : ''}`}
      />
      {hasValue && (
        <button
          type="button"
          className="clearable-btn"
          aria-label="Borrar búsqueda"
          title="Borrar"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onClear(); inputRef.current?.focus() }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
  )
}
