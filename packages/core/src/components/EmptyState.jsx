import Icon from './Icon'

// Estado vacío con ícono + mensaje, para reemplazar el texto plano
// "No hay..." repetido en listas -- mismo componente sirve para cualquier
// lista de la app (órdenes, contenedores, reportes, etc.).
export default function EmptyState({ message, icon = 'inbox' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      padding: '28px 16px', color: 'var(--muted)', textAlign: 'center',
    }}>
      <Icon name={icon} size={28} style={{ opacity: 0.5 }} />
      <p className="muted small" style={{ margin: 0 }}>{message}</p>
    </div>
  )
}
