// Aviso inline de "ya existe un control para este período" -- se muestra
// mientras se arma un registro nuevo (editingId null) y el período elegido
// (año/mes [+turno]) coincide con uno ya guardado. `periodLabel` ya viene
// formateado por la página (varía si incluye turno o no). La página debe
// además ocultar su grilla/deshabilitar "Guardar" mientras este aviso esté
// activo, ver [[project_higiene_personal_caes_registro_rapido]].
export default function PeriodExistsBanner({ periodLabel, responsiblePerson, onOpen }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8 }}>
      <span style={{ fontSize: 12 }}>
        Ya existe un control para {periodLabel}, registrado por {responsiblePerson ?? '—'}.
      </span>
      <button className="btn small primary" onClick={onOpen}>Abrir ese registro</button>
    </div>
  )
}
