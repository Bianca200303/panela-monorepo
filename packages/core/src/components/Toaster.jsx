import { useToastStore } from '../lib/toast'
import Icon from './Icon'

const ICONS = { success: 'check', error: 'alertTriangle', info: 'circle' }

// Pila de avisos abajo a la derecha (ver lib/toast.js). role="status" /
// "alert" para que los lectores de pantalla los anuncien.
export default function Toaster() {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="toaster">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          <span className="toast-icon"><Icon name={ICONS[t.type]} size={16} /></span>
          <div className="toast-body">
            <strong>{t.title}</strong>
            {t.detail && <span className="toast-detail">{t.detail}</span>}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Cerrar aviso">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
