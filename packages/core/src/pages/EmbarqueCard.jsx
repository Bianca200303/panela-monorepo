import { useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, formatDate, isOrderNacional } from '../lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '../lib/labels'
import OrderNumberField from '../components/OrderNumberField'
import InternalContainerField from '../components/InternalContainerField'
import Icon from '../components/Icon'
import AuditStamp from '../components/AuditStamp'
import ActionMenu from '../components/ActionMenu'

// Solo muestra órdenes SIN contenedor/despacho asignado todavía (ver
// listaEmbarque en EmbarquePage.jsx) -- apenas se asigna, la orden pasa a
// "En contenedor" o "Despachos nacionales", donde vive ContainerCard.jsx.
export default function EmbarqueCard({ order, onAsignar, onReopen, onDocumentos, onReload }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE, order)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE, order)
  const [open, setOpen] = useState(false)
  const [reopenError, setReopenError] = useState('')
  const { confirm, dialog: confirmDialog } = useConfirm()
  const batches = order.plant_production_batches ?? []
  const totalKg = batches.reduce((s, b) => s + loteKg(b), 0)
  const esNacional = isOrderNacional(COOPERATIVE, order)

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <OrderNumberField order={order} onSaved={onReload} />
          <InternalContainerField order={order} onSaved={onReload} />
          <span className="muted small">{order.market} · {batches.length} {LOTE_LABEL_LOWER}(s) · {totalKg.toFixed(0)} kg</span>
          <span className="next-step pending">
            <Icon name="clock" size={13} />
            {esNacional ? 'Falta registrar el despacho nacional' : 'Falta asignar a contenedor'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AuditStamp row={order} />
          <span className="tag dot ok">Lista</span>
          <ActionMenu
            label="Más acciones"
            items={[
              { label: 'Documentos', onClick: onDocumentos },
              { label: 'Reabrir orden', onClick: handleReopenClick },
            ]}
          />
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)' }} />
        </div>
      </header>
      {open && (
        <>
          {(order.tamizado_fecha_inicio || order.envasado_fecha_inicio || order.fecha_envio) && (
            <div className="stage-facts" style={{ marginTop: 8 }}>
              {(order.tamizado_fecha_inicio || order.tamizado_fecha_fin) && (
                <span>tamizado <strong>{formatDate(order.tamizado_fecha_inicio)} — {formatDate(order.tamizado_fecha_fin)}</strong></span>
              )}
              {(order.envasado_fecha_inicio || order.envasado_fecha_fin) && (
                <span>envasado <strong>{formatDate(order.envasado_fecha_inicio)} — {formatDate(order.envasado_fecha_fin)}</strong></span>
              )}
              {order.fecha_envio && <span>envío <strong>{formatDate(order.fecha_envio)}</strong></span>}
            </div>
          )}
          {/* Documentos y "Reabrir orden" están en el menú ⋯. */}
          <footer style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small primary" onClick={onAsignar}>
              {esNacional ? 'Registrar despacho nacional' : 'Asignar a contenedor'}
            </button>
          </footer>
          {reopenError && (
            <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{reopenError}</p>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  )
}
