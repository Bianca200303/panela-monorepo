import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, formatDate, isOrderNacional } from '../lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '../lib/labels'
import OrderNumberField from '../components/OrderNumberField'
import InternalContainerField from '../components/InternalContainerField'
import Icon from '../components/Icon'
import AuditStamp from '../components/AuditStamp'
import ActionMenu from '../components/ActionMenu'

const CONTAINER_STATUS_LABELS = {
  preparando: { text: 'Preparando', cls: 'warn' },
  cargado: { text: 'Cargado', cls: 'info' },
  despachado: { text: 'Despachado', cls: 'ok' },
  en_transito: { text: 'En tránsito', cls: 'info' },
  entregado: { text: 'Entregado', cls: 'ok' },
}

const orderNumber = (o) => o.client_order_number ?? o.order_code

// Datos de una etapa en una sola línea ("Sello X · 20ft · Maersk"), mismo
// patrón que las etapas del lote en OrderCard.jsx.
function Facts({ items }) {
  const list = items.filter(Boolean)
  if (list.length === 0) return <div className="stage-empty">Sin registrar</div>
  return <div className="stage-facts">{list.map((it, i) => <span key={i}>{it}</span>)}</div>
}

// Estado de una etapa junto a su título (✓ listo / ⚠ pendiente).
function StageState({ state, text }) {
  if (!state) return null
  return (
    <span className={`control-chip ${state === 'ok' ? 'ok' : 'pending'}`}>
      <Icon name={state === 'ok' ? 'check' : 'alertTriangle'} size={13} />
      {text}
    </span>
  )
}

export default function ContainerCard({
  container, orders, dispatch, carga, packingListNacional, onCarga, onDispatch, onDocumentos, onResumenTrazabilidad,
  onOrdenSalidaPdf,
  onPackingListNacional,
  onControlTransporte, onReopenOrder, onReload,
  onEditarContenedor,
  controlsVersion = 0,
}) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE, orders[0])
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE, orders[0])
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

  // Control de Unidad de Transporte (CAES, Nacional y Exportación): una lista
  // abierta de 0 a N controles. Se cuenta solo con la tarjeta abierta, y se
  // vuelve a contar al cerrar su modal (controlsVersion, ver EmbarquePage).
  const tieneControlTransporte = !!COOPERATIVE?.features?.ventaNacionalExportacion
  // También cuántos tramos tienen pendiente la GR del transportista (es
  // opcional y suele llegar tarde -- se avisa para no olvidarla).
  const [transportCount, setTransportCount] = useState(null)
  const [grTranspPendientes, setGrTranspPendientes] = useState(0)
  useEffect(() => {
    if (!open || !tieneControlTransporte) return
    let cancelled = false
    supabase
      .from('plant_transport_unit_controls_caes')
      .select('id, guia_remision_transportista')
      .eq('container_id', container.id)
      .then(({ data, error }) => {
        if (cancelled || error) return
        setTransportCount((data ?? []).length)
        setGrTranspPendientes((data ?? []).filter(t => !t.guia_remision_transportista).length)
      })
    return () => { cancelled = true }
  }, [open, tieneControlTransporte, container.id, controlsVersion])

  // Una vez despachado el contenedor ya salió físicamente -- no tiene
  // sentido reabrir una orden de ahí adentro. Con carga (Packing List) sin
  // despacho todavía se puede, pero se avisa porque puede dejar el Packing
  // List desactualizado (habría que rehacerlo sin esa orden).
  const handleReopenOrderClick = async (order) => {
    setReopenError('')
    const ok = await confirm({
      title: 'Reabrir orden',
      message: `¿Reabrir la orden ${orderNumber(order)} y sacarla d${esVentaNacional ? 'e este despacho nacional' : `el contenedor ${container.container_number ?? 'sin número'}`}? Va a volver a "En proceso" en Órdenes para poder corregir sus ${LOTE_LABEL_PLURAL_LOWER}.${carga ? ' El Packing List de este contenedor va a quedar desactualizado -- revíselo después.' : ''}`,
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

  // Estado de la carga: Packing List (exportación) o Packing List-Nacional.
  const cargaDoc = esVentaNacional ? packingListNacional : carga
  const cargaTerminada = cargaDoc?.status === 'terminado'

  // Siguiente paso, visible sin abrir la tarjeta (mismo criterio que la
  // línea de cada orden en OrderCard.jsx).
  const nextStep = dispatch ? null
    : !cargaDoc ? `Falta registrar ${esVentaNacional ? 'el Packing List-Nacional' : 'la carga'}`
    : !cargaTerminada ? `Falta terminar ${esVentaNacional ? 'el Packing List-Nacional' : 'la carga'}`
    : 'Falta registrar el despacho'

  // Lo que identifica a cada tarjeta sin abrirla. Un despacho nacional no
  // tiene número de contenedor: se reconoce por la orden y su Packing List
  // (antes todas decían igual "Despacho nacional").
  const title = esVentaNacional
    ? `Orden ${orders.map(orderNumber).join(', ')}`
    : `Contenedor ${container.container_number ?? 'sin número'}`
  const subtitle = [
    esVentaNacional ? packingListNacional?.packing_list_numero : container.destination_port,
    !esVentaNacional && orders.length > 1 && `${orders.length} órdenes`,
    `${totalKg.toFixed(0)} kg`,
    dispatch?.dispatch_date ? formatDate(dispatch.dispatch_date)
      : !esVentaNacional && container.departure_date ? `zarpe ${formatDate(container.departure_date)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="item">
      <header style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong>{title}</strong>
          <AuditStamp row={container} />
          <span className="muted small">{subtitle}</span>
          {nextStep && (
            <span className="next-step pending">
              <Icon name="clock" size={13} />
              {nextStep}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`tag dot ${st.cls}`}>{st.text}</span>
          <ActionMenu
            label="Más acciones"
            items={[
              { label: 'Documentos', onClick: onDocumentos },
              // Solo una vez despachado -- antes de eso la trazabilidad del
              // contenedor todavía puede cambiar (lotes, materia prima).
              dispatch && { label: 'Resumen de trazabilidad', onClick: onResumenTrazabilidad },
              dispatch && { label: 'Orden de Salida (PDF)', onClick: onOrdenSalidaPdf },
            ]}
          />
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)' }} />
        </div>
      </header>

      {open && (
        <>
          {/* 1. Datos -- único lugar donde se pueden cargar/corregir Factura
              Comercial y N° Certificado de Transacción después de creado
              el contenedor/despacho. */}
          <div className="stage-card">
            <div className="stage-card-title">
              <span>{esVentaNacional ? 'Datos del despacho' : 'Datos del contenedor'}</span>
              <span className="stage-card-actions">
                <button className="btn small outline" onClick={onEditarContenedor}>Editar</button>
              </span>
            </div>
            {esVentaNacional ? (
              <Facts items={[
                packingListNacional?.packing_list_numero && <>Packing List <strong>{packingListNacional.packing_list_numero}</strong></>,
                container.extra_data?.factura_comercial && <>factura <strong>{container.extra_data.factura_comercial}</strong></>,
              ]} />
            ) : (
              <Facts items={[
                container.seal_number && <>sello <strong>{container.seal_number}</strong></>,
                <><strong>{container.container_size ?? '20'}</strong> ft</>,
                container.shipping_line && <strong>{container.shipping_line}</strong>,
                container.destination_port && <>destino <strong>{container.destination_port}</strong></>,
                container.booking_number && <>booking <strong>{container.booking_number}</strong></>,
                container.bill_of_lading && <>BL <strong>{container.bill_of_lading}</strong></>,
                container.departure_date && <>zarpe <strong>{formatDate(container.departure_date)}</strong></>,
              ]} />
            )}
          </div>

          {/* 2. Carga -- Packing List (100% de exportación: pallets,
              inspección de contenedor) o, en venta nacional, su propio
              Packing List-Nacional más simple. */}
          <div className="stage-card">
            <div className="stage-card-title">
              <span>{esVentaNacional ? 'Packing List-Nacional' : 'Carga (Packing List)'}</span>
              <StageState
                state={cargaTerminada ? 'ok' : 'pending'}
                text={cargaTerminada ? 'Terminado' : cargaDoc ? 'Sin terminar' : 'Sin registrar'}
              />
              <span className="stage-card-actions">
                <button
                  className={`btn small ${!cargaTerminada && !dispatch ? 'primary' : 'outline'}`}
                  onClick={esVentaNacional ? onPackingListNacional : onCarga}
                >
                  {!cargaDoc ? 'Registrar' : cargaTerminada ? 'Ver' : 'Continuar'}
                </button>
              </span>
            </div>
          </div>

          {/* 3. Control de Unidad de Transporte (solo CAES) -- aplica a
              Nacional y Exportación; sin estado "terminado", siempre se
              puede seguir agregando. */}
          {tieneControlTransporte && (
            <div className="stage-card">
              <div className="stage-card-title">
                <span>Control de unidad de transporte</span>
                {transportCount != null && (
                  <StageState
                    state={transportCount > 0 ? 'ok' : 'pending'}
                    text={transportCount > 0 ? `${transportCount} tramo${transportCount === 1 ? '' : 's'}` : 'Sin registro'}
                  />
                )}
                {transportCount > 0 && grTranspPendientes > 0 && (
                  <StageState state="pending" text={`GR transportista pendiente${grTranspPendientes > 1 ? ` (${grTranspPendientes})` : ''}`} />
                )}
                <span className="stage-card-actions">
                  <button className="btn small outline" onClick={onControlTransporte}>
                    {transportCount > 0 ? 'Ver' : 'Registrar'}
                  </button>
                </span>
              </div>
            </div>
          )}

          {/* 4. Despacho */}
          <div className="stage-card">
            <div className="stage-card-title">
              <span>Despacho</span>
              {dispatch && <StageState state="ok" text="Registrado" />}
              {dispatch && <AuditStamp row={dispatch} />}
              <span className="stage-card-actions">
                <button className={`btn small ${!dispatch && cargaTerminada ? 'primary' : 'outline'}`} onClick={onDispatch}>
                  {dispatch ? 'Editar' : 'Registrar despacho'}
                </button>
              </span>
            </div>
            {dispatch && (
              <Facts items={[
                <><strong>{Number(dispatch.total_loaded_kg).toLocaleString('es-PE', { maximumFractionDigits: 2 })} kg</strong></>,
                <><strong>{formatDate(dispatch.dispatch_date)}</strong></>,
                // El sello es del contenedor marítimo: no aplica a un despacho nacional.
                !esVentaNacional && dispatch.seal_verified && <strong className="fact-ok">sello verificado</strong>,
              ]} />
            )}
          </div>

          {/* Órdenes dentro del contenedor/despacho */}
          <div className="container-orders">
            {orders.map(o => {
              const batches = o.plant_production_batches ?? []
              const oKg = batches.reduce((s, b) => s + loteKg(b), 0)
              return (
                <div key={o.id} className="container-order-row">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <OrderNumberField order={o} onSaved={onReload} />
                    <InternalContainerField order={o} onSaved={onReload} />
                    <span className="muted small">{o.market} · {batches.length} {LOTE_LABEL_LOWER}(s) · {oKg.toFixed(0)} kg</span>
                  </span>
                  {/* Despachado: ya salió, no se puede reabrir -- el botón ni
                      se muestra (antes quedaba desactivado ocupando lugar). */}
                  {!dispatch && (
                    <button className="btn small outline" onClick={() => handleReopenOrderClick(o)}>Reabrir</button>
                  )}
                </div>
              )
            })}
            {reopenError && (
              <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{reopenError}</p>
            )}
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  )
}
