import { useState } from 'react'

const OTHER = '__otro__'

// Desplegable de un catálogo (personal, empresas de transporte...) con una
// última opción "Otro (escribir)" para quien todavía no está registrado.
// El valor sigue siendo texto: lo elegido o lo escrito. Un valor guardado
// que no está en la lista se muestra directamente en modo "escribir".
//
// options: [{ value, label }]
export default function SelectOrOther({ options, value, onChange, onSelectOption, otherLabel = 'Otro (escribir)', placeholder }) {
  const inList = options.some(o => o.value === value)
  const [manual, setManual] = useState(!!value && !inList)
  const showInput = manual || (!!value && !inList)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={showInput ? OTHER : (inList ? value : '')}
        onChange={e => {
          const v = e.target.value
          if (v === OTHER) { setManual(true); onChange(''); return }
          setManual(false)
          onChange(v)
          onSelectOption?.(options.find(o => o.value === v) ?? null)
        }}
      >
        <option value="">Seleccione...</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {showInput && (
        <input type="text" autoFocus={manual && !value} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}
