import Icon from './Icon'

// Estado vacío con ícono + mensaje, para reemplazar el texto plano
// "No hay..." repetido en listas -- mismo componente sirve para cualquier
// lista de la app (órdenes, contenedores, reportes, etc.).
// `action` ({ label, onClick }) agrega el siguiente paso obvio ("Nuevo
// cliente"), para que un vacío no sea un callejón sin salida.
export default function EmptyState({ message, title, icon = 'inbox', action }) {
  return (
    <div className="state-empty">
      <span className="state-empty-icon"><Icon name={icon} size={22} /></span>
      {title && <strong className="state-empty-title">{title}</strong>}
      <p className="state-empty-text">{message}</p>
      {action && (
        <button className="btn small primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={action.onClick}>
          <Icon name="plus" size={14} />{action.label}
        </button>
      )}
    </div>
  )
}
