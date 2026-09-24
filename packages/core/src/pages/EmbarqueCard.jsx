import { useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, formatDate, isOrderNacional } from '../lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '../lib/labels'
import OrderNumberField from '../components/OrderNumberField'
import Icon from '../components/Icon'

// Solo muestra órdenes SIN contenedor/despacho asignado todavía (ver
// listaEmbarque en EmbarquePage.jsx) -- apenas se asigna, la orden pasa a
// "En contenedor" o "Despachos nacionales", donde vive ContainerCard.jsx.
export default function EmbarqueCard({ order, onAsignar, onInforme, onReopen, onDocumentos, onReload }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
  const [open, setOpen] = useState(false)
  const [reopenError, setReopenError] = useState('')
  const { confirm, dialog: confirmDialog } = useConfirm()
  const batches = order.plant_production_batches ?? []
  const totalKg = batches.reduce((s, b) => s + loteKg(b), 0)

  const handleReopenClick = async () => {
    setReopenError('')
    const ok = await confirm({
      title: 'Reabrir orden',
      message: `¿Reabrir la orden ${order.client_order_number ?? order.order_code}? Va a volver a "En proceso" y se van a poder corregir sus ${LOTE_LABEL_PLURAL_LOWER}.`,
      confirmText: 'Reabrir orden',
      danger: true,
    })
    if (!ok) return
    try {
      await onReopen()
    } catch (err) {
      setReopenError(err.message)
    }
  }

  return (
    <div className="item">
      <header style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OrderNumberField order={order} onSaved={onReload} />
          <span className="muted small">{order.market} · {totalKg.toFixed(0)} kg</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tag dot ok">Lista</span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)' }} />
        </div>
      </header>
      {open && (
        <>
          <div className="meta" style={{ marginTop: 6 }}>
            {(order.tamizado_fecha_inicio || order.tamizado_fecha_fin) && (
              <div>Tamizado: {formatDate(order.tamizado_fecha_inicio)} — {formatDate(order.tamizado_fecha_fin)}</div>
            )}
            {(order.envasado_fecha_inicio || order.envasado_fecha_fin) && (
              <div>Envasado: {formatDate(order.envasado_fecha_inicio)} — {formatDate(order.envasado_fecha_fin)}</div>
            )}
            {order.fecha_envio && <div>Fecha de envío: {formatDate(order.fecha_envio)}</div>}
            <div>{batches.length} {LOTE_LABEL_LOWER}(s) · {totalKg.toFixed(0)} kg procesados</div>
          </div>
          <footer style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small primary" onClick={onAsignar}>
              {isOrderNacional(COOPERATIVE, order) ? 'Registrar despacho nacional' : 'Asignar a contenedor'}
            </button>
            <button className="btn small outline" onClick={onInforme}>Ver informe</button>
            <button className="btn small outline" onClick={onDocumentos}>Documentos de planta</button>
            <button className="btn small danger" onClick={handleReopenClick}>
              Reabrir orden
            </button>
          </footer>
          {reopenError && (
            <p style={{ color: '#dc2626', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{reopenError}</p>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  )
}
