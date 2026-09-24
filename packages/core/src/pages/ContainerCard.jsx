import { useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, formatDate, isOrderNacional } from '../lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '../lib/labels'
import OrderNumberField from '../components/OrderNumberField'
import Icon from '../components/Icon'

const CONTAINER_STATUS_LABELS = {
  preparando: { text: 'Preparando', cls: 'warn' },
  cargado: { text: 'Cargado', cls: 'info' },
  despachado: { text: 'Despachado', cls: 'ok' },
  en_transito: { text: 'En tránsito', cls: 'info' },
  entregado: { text: 'Entregado', cls: 'ok' },
}

export default function ContainerCard({
  container, orders, dispatch, carga, packingListNacional, onCarga, onDispatch, onInforme, onDocumentos, onResumenTrazabilidad,
  onOrdenSalidaPdf,
  onPackingListNacional,
  onControlTransporte, onReopenOrder, onReload,
  onEditarContenedor,
}) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
  const [open, setOpen] = useState(false)
  const [reopenError, setReopenError] = useState('')
  const { confirm, dialog: confirmDialog } = useConfirm()
  const st = CONTAINER_STATUS_LABELS[container.status] ?? { text: container.status, cls: 'info' }
  // Venta nacional CAES: sin contenedor real, no pasa por "Registrar carga"
  // (pallets/inspección de contenedor son 100% de exportación) -- tiene su
  // propio documento simple ("Packing List-Nacional"), ver
  // [[project_despacho_nacional_caes]]. isOrderNacional (loteHelpers.js) es
  // la fuente de verdad compartida (order.sale_type), no si falta o no el
  // booking. Todas las órdenes de un mismo contenedor comparten tipo de
  // venta (no se mezclan), alcanza con mirar la primera.
  const esVentaNacional = isOrderNacional(COOPERATIVE, orders[0])
  const totalKg = orders.reduce((s, o) =>
    s + (o.plant_production_batches ?? []).reduce((s2, b) => s2 + loteKg(b), 0), 0
  )

  // Una vez despachado el contenedor ya salió físicamente -- no tiene
  // sentido reabrir una orden de ahí adentro. Con carga (Packing List) sin
  // despacho todavía se puede, pero se avisa porque puede dejar el Packing
  // List desactualizado (habría que rehacerlo sin esa orden).
  const handleReopenOrderClick = async (order) => {
    setReopenError('')
    const ok = await confirm({
      title: 'Reabrir orden',
      message: `¿Reabrir la orden ${order.client_order_number ?? order.order_code} y sacarla d${esVentaNacional ? 'e este despacho nacional' : `el contenedor ${container.container_number ?? 'sin número'}`}? Va a volver a "En proceso" en Órdenes para poder corregir sus ${LOTE_LABEL_PLURAL_LOWER}.${carga ? ' El Packing List de este contenedor va a quedar desactualizado -- revíselo después.' : ''}`,
      confirmText: 'Reabrir orden',
      danger: true,
    })
    if (!ok) return
    try {
      await onReopenOrder(order.id)
    } catch (err) {
      setReopenError(err.message)
    }
  }

  return (
    <div className="item">
      <header style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>{esVentaNacional ? 'Despacho nacional' : `Contenedor ${container.container_number ?? 'Sin número'}`}</strong>
          <span className="muted small">{orders.length} orden(es) · {totalKg.toFixed(0)} kg</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`tag dot ${st.cls}`}>{st.text}</span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)' }} />
        </div>
      </header>

      {open && (
        <>
          <div className="meta" style={{ marginTop: 6 }}>
            {esVentaNacional ? (
              <>
                {packingListNacional?.packing_list_numero && <div>N° Packing List: <strong>{packingListNacional.packing_list_numero}</strong></div>}
                {container.extra_data?.factura_comercial  && <div>Factura Comercial: {container.extra_data.factura_comercial}</div>}
                {packingListNacional?.guia_tramo_interno   && <div>Guía tramo interno: {packingListNacional.guia_tramo_interno}</div>}
                {packingListNacional?.guia_tramo_final     && <div>Guía tramo final: {packingListNacional.guia_tramo_final}</div>}
              </>
            ) : (
              <>
                {container.seal_number      && <div>Sello: <strong>{container.seal_number}</strong> · {container.container_size ?? '20'}ft</div>}
                {container.shipping_line    && <div>Naviera: {container.shipping_line}</div>}
                {container.destination_port && <div>Destino: {container.destination_port}</div>}
                {container.booking_number   && <div>Booking: {container.booking_number}</div>}
                {container.bill_of_lading   && <div>BL: {container.bill_of_lading}</div>}
                {container.departure_date   && <div>Zarpe: {formatDate(container.departure_date)}</div>}
              </>
            )}
          </div>

          {/* Único lugar donde se pueden cargar/corregir Factura Comercial y
              N° Certificado de Transacción después de creado el
              contenedor/despacho -- antes solo se podían cargar al asignar
              la orden por primera vez (openModalContainer), sin forma de
              volver a esos campos una vez despachado. */}
          <div style={{ marginTop: 6 }}>
            <button className="btn small outline" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onEditarContenedor}>
              Editar datos {esVentaNacional ? 'del despacho' : 'del contenedor'}
            </button>
          </div>

          {/* Registrar carga (Packing List) -- paso previo a Registrar
              despacho, pero es 100% de exportación (pallets, inspección de
              contenedor) -- una venta nacional no lo necesita, tiene su
              propio Packing List-Nacional más simple (abajo), ver
              PackingListNacionalCaesModal.jsx. */}
          {!esVentaNacional && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small outline" onClick={onCarga}>
                {!carga ? 'Registrar carga' : carga.status === 'terminado' ? 'Ver carga (Packing List)' : 'Continuar carga'}
              </button>
              {carga?.status === 'terminado' && (
                <span className="tag ok" style={{ fontSize: 11 }}>Cargado</span>
              )}
            </div>
          )}
          {esVentaNacional && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="tag info" style={{ fontSize: 11 }}>Venta nacional</span>
              <button className="btn small outline" onClick={onPackingListNacional}>
                {!packingListNacional ? 'Registrar Packing List-Nacional'
                  : packingListNacional.status === 'terminado' ? 'Ver Packing List-Nacional' : 'Continuar Packing List-Nacional'}
              </button>
              {packingListNacional?.status === 'terminado' && (
                <span className="tag ok" style={{ fontSize: 11 }}>Cargado</span>
              )}
            </div>
          )}

          {/* Control de Unidad de Transporte (CUT) -- aplica a Nacional Y
              Exportación (un mismo camión/tramo real se inspecciona igual
              en los dos casos), ver TransportUnitControlsCaesModal.jsx. Sin
              estado de "terminado" (a diferencia de Packing List) -- es una
              lista abierta de 0 a N controles, siempre se puede seguir
              agregando. */}
          {!!COOPERATIVE?.features?.ventaNacionalExportacion && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small outline" onClick={onControlTransporte}>Control de Unidad de Transporte</button>
            </div>
          )}

          {/* Órdenes dentro del contenedor */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#000', marginBottom: 6 }}>
              Órdenes ({orders.length})
            </div>
            {orders.map(o => {
              const batches = o.plant_production_batches ?? []
              const oKg = batches.reduce((s, b) => s + loteKg(b), 0)
              return (
                <div key={o.id} style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <OrderNumberField order={o} onSaved={onReload} />
                      <span style={{ color: 'var(--muted)' }}>{oKg.toFixed(0)} kg</span>
                    </span>
                    <button
                      className="btn small outline"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      disabled={!!dispatch}
                      title={dispatch ? 'Este contenedor ya tiene despacho registrado -- no se puede reabrir' : undefined}
                      onClick={() => handleReopenOrderClick(o)}
                    >
                      Reabrir
                    </button>
                  </div>
                  <div style={{ marginTop: 2 }}>{o.market} · {batches.length} {LOTE_LABEL_LOWER}(s)</div>
                </div>
              )
            })}
            {reopenError && (
              <p style={{ color: '#dc2626', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{reopenError}</p>
            )}
          </div>

          {/* Despacho */}
          {dispatch ? (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Despacho registrado</div>
              <div>{dispatch.total_loaded_kg} kg · {formatDate(dispatch.dispatch_date)}</div>
              {dispatch.seal_verified && <div style={{ color: 'var(--success)', fontWeight: 600 }}>Sello verificado</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button className="btn small outline" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onDispatch}>
                  Editar despacho
                </button>
                <button className="btn small outline" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onOrdenSalidaPdf}>
                  Orden de Salida (PDF)
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <button className="btn small primary" onClick={onDispatch}>Registrar despacho</button>
            </div>
          )}

          <footer style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small outline" onClick={onInforme}>Ver informe completo</button>
            <button className="btn small outline" onClick={onDocumentos}>Documentos de planta</button>
            {/* Solo una vez despachado -- antes de eso la trazabilidad del
                contenedor todavía puede cambiar (lotes, materia prima). */}
            {dispatch && (
              <button
                className="btn small outline"
                style={{ fontWeight: 600, color: '#166534', borderColor: 'var(--success)', background: '#f0fdf4' }}
                onClick={onResumenTrazabilidad}
              >
                Resumen de trazabilidad
              </button>
            )}
          </footer>
        </>
      )}
      {confirmDialog}
    </div>
  )
}
