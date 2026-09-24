// Bloque "valor grande + etiqueta chica" para datos numéricos (kg, %,
// conteos). El valor lleva más peso visual que su etiqueta para que el dato
// salte primero al ojo -- patrón repetido en paneles de totales/resúmenes,
// antes duplicado a mano en cada pantalla.
export default function Stat({ label, value, large = false, className = '' }) {
  return (
    <div className={`stat${className ? ` ${className}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${large ? ' lg' : ''}`}>{value}</div>
    </div>
  )
}
