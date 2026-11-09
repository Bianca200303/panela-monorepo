import Icon from './Icon'

// Estado de error de carga: reemplaza el caso en que una consulta fallida
// se veía igual que una lista vacía ("No hay..."). Siempre ofrece
// reintentar cuando hay cómo hacerlo.
export default function ErrorState({ message = 'No se pudo cargar la información. Revise la conexión e intente de nuevo.', onRetry }) {
  return (
    <div className="state-error" role="alert">
      <Icon name="alertTriangle" size={16} />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && <button className="btn small danger" onClick={onRetry}>Reintentar</button>}
    </div>
  )
}
