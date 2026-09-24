import { MONTH_NAMES } from '../lib/formatos/shared'

// Select de mes con flechas ◀ ▶ para el ajuste rápido de a 1 mes (el gesto
// de "hojear" el cuaderno de papel) -- usado junto al campo de Año en los
// controles con grilla mensual (Higiene del Personal, Limpieza General).
// Las flechas se ocultan cuando `disabled` (control ya guardado, ver
// [[project_higiene_personal_caes_registro_rapido]]).
export default function MonthArrowSelect({ month, disabled, onShift, onChangeMonth }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {!disabled && (
        <button type="button" className="btn small outline" style={{ padding: '4px 8px' }} onClick={() => onShift(-1)} title="Mes anterior">◀</button>
      )}
      <select value={month} disabled={disabled} onChange={e => onChangeMonth(parseInt(e.target.value, 10))} style={{ flex: 1 }}>
        {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      {!disabled && (
        <button type="button" className="btn small outline" style={{ padding: '4px 8px' }} onClick={() => onShift(1)} title="Mes siguiente">▶</button>
      )}
    </div>
  )
}
