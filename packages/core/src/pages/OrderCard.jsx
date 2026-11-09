import { useState, useEffect } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, loteLabel, packagingLabel, isEnvasadoOk, isCalidadOk, loteBunques, formatDate } from '../lib/loteHelpers'
import { getPendingLoteControls, getLoteControlStatus, controlsFor } from '../lib/loteControles'
import { toast } from '../lib/toast'
import { getLoteLabel, getLoteLabelLower, getLoteLabelPluralLower, getBunqueLabelLower, getBunqueLabelPlural, getBunqueLabelPluralLower } from '../lib/labels'
import OrderNumberField from '../components/OrderNumberField'
import Icon from '../components/Icon'
import ActionMenu from '../components/ActionMenu'
import AuditStamp from '../components/AuditStamp'
import Stat from '../components/Stat'
import LoteStepper from './LoteStepper'
import TotalsPanel from './TotalsPanel'
import TrazabilidadTable from './TrazabilidadTable'

// Números sin ceros de relleno: 184 en vez de 184.00, 2.5 en vez de 2.50.
const fmtNum = (n, digits = 2) => Number(n ?? 0).toLocaleString('es-PE', { maximumFractionDigits: digits })

const BATCH_STATUS = {
  pendiente_homogenizado: { label: 'Sin homogenizado', cls: 'warn' },
  homogenizado:           { label: 'Homogenizado',     cls: 'info' },
  procesado:              { label: 'Procesado',         cls: 'ok'   },
}

export default function OrderCard({ order, stockItems, processingLimits, kgPerQuintal, webUsersMap, onAddLote, onEditLote, onGestionarBunques, onGestionarEnvasado, onGestionarObjetosExtranos, onGestionarPesosSellado, onGestionarSelladoEnvasadoCaes, onGestionarHermeticidadCaes, onGestionarMonitoreoTamizadoCaes, onGestionarCalidad, onCloseLote, onComplete, onEditOrder, onDocumentos, onResumenTrazabilidad, onReload, controlsVersion = 0 }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL = getLoteLabel(COOPERATIVE, order)
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE, order)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE, order)
  const BUNQUE_LABEL_LOWER = getBunqueLabelLower(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL = getBunqueLabelPlural(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL_LOWER = getBunqueLabelPluralLower(COOPERATIVE)
  // Colapsada por defecto -- con muchas órdenes en proceso a la vez, mostrar
  // todo expandido de entrada hace la lista imposible de escanear.
  const [open, setOpen] = useState(false)
  const [openTraza, setOpenTraza] = useState(null) // bunque_id con trazabilidad abierta
  const [collapsedLotes, setCollapsedLotes] = useState({}) // overrides manuales { [pb.id]: bool }
  const { confirm, dialog: confirmDialog } = useConfirm()

  // Estado de los controles de planta de cada lote (✓ / sin registro), para
  // mostrarlos junto a la etapa a la que pertenecen. Se consulta solo con la
  // orden abierta, y se vuelve a consultar al recargar la orden o al cerrar
  // el modal de un control (controlsVersion, ver OrdenesPage.jsx).
  const LOTE_CONTROLS = controlsFor(COOPERATIVE)
  const [controlStatus, setControlStatus] = useState({})
  const batchIdsKey = (order.plant_production_batches ?? []).map(b => b.id).join(',')
  useEffect(() => {
    if (!open || !batchIdsKey) return
    let cancelled = false
    getLoteControlStatus(COOPERATIVE, batchIdsKey.split(',')).then(st => { if (!cancelled) setControlStatus(st) })
    return () => { cancelled = true }
  }, [open, batchIdsKey, controlsVersion, order])
  const openControl = {
    monitoreoTamizado: onGestionarMonitoreoTamizadoCaes,
    selladoEnvasado: onGestionarSelladoEnvasadoCaes,
    hermeticidad: onGestionarHermeticidadCaes,
    pesosSellado: onGestionarPesosSellado,
    objetosExtranos: onGestionarObjetosExtranos,
  }

  const batches = order.plant_production_batches ?? []
  const readOnly = order.status === 'completado'
  const allProcessed = batches.length > 0 && batches.every(b => b.status === 'procesado')
  const pendingEnvasado = batches.filter(b => !isEnvasadoOk(b, kgPerQuintal))
  const totalPlannedKg = batches.reduce((s, b) => s + loteKg(b), 0)
  const canComplete = allProcessed && pendingEnvasado.length === 0

  // Qué falta en la orden, para mostrarlo en su línea sin tener que abrirla.
  // Toma el primer lote pendiente y su paso siguiente (mismo orden que el
  // stepper del lote); "(+N)" si hay más lotes pendientes.
  const nextStep = (() => {
    if (readOnly) return null
    if (batches.length === 0) return { tone: 'pending', text: `Falta agregar un ${LOTE_LABEL_LOWER}` }
    if (canComplete) return { tone: 'ready', text: 'Lista para completar' }
    const pending = batches.filter(b => b.status !== 'procesado' || !isEnvasadoOk(b, kgPerQuintal))
    const b = pending[0]
    const bq = loteBunques(b)
    const step = bq.length === 0 ? `repartir ${BUNQUE_LABEL_PLURAL_LOWER}`
      : !bq.some(x => x.tamizada_kg != null) ? 'registrar tamizado'
      : !isEnvasadoOk(b, kgPerQuintal) ? (b.envasado_registered_at ? 'corregir envasado' : 'registrar envasado')
      : !isCalidadOk(COOPERATIVE, b) ? (COOPERATIVE?.features?.liberacionProductoTerminado ? 'registrar liberación' : 'registrar calidad')
      : `cerrar ${LOTE_LABEL_LOWER}`
    return { tone: 'pending', text: `Falta ${step} · ${loteLabel(b)}${pending.length > 1 ? ` (+${pending.length - 1})` : ''}` }
  })()

  // El tamizado siempre puede superar lo planificado (no hay merma negativa
  // que "importe") — la comparación relevante antes de completar es contra
  // el envasado, que si difiere de lo planificado es una señal real.
  const totalEnvasadoKg = batches.reduce((s, b) => s + Number(b.envasado_qq ?? 0) * kgPerQuintal, 0)
  const envasadoGapKg = totalPlannedKg - totalEnvasadoKg
  const envasadoGapPct = totalPlannedKg > 0 ? (envasadoGapKg / totalPlannedKg) * 100 : 0

  const [completeError, setCompleteError] = useState('')

  const [checkingComplete, setCheckingComplete] = useState(false)
  const handleCompleteClick = async () => {
    setCompleteError('')
    // Completar la orden es el último punto donde se pueden registrar los
    // controles por lote (después pasa a Embarque en solo lectura): se avisa
    // qué falta en cada lote, sin bloquear. Ver lib/loteControles.js.
    setCheckingComplete(true)
    const pendingByBatch = await Promise.all(batches.map(async b => ({ batch: b, pending: await getPendingLoteControls(COOPERATIVE, b.id) })))
    setCheckingComplete(false)
    const withPending = pendingByBatch.filter(p => p.pending.length > 0)
    if (withPending.length > 0) {
      const list = withPending
        .map(({ batch, pending }) => `${LOTE_LABEL} ${loteLabel(batch)}:\n` + pending
          .map(c => `• ${c.label}${c.reason === 'sin_terminar' ? ' (iniciado, sin terminar)' : ''}`)
          .join('\n'))
        .join('\n\n')
      const ok = await confirm({
        title: 'Controles de planta pendientes',
        message:
          `Faltan controles de planta en esta orden:\n\n${list}\n\n` +
          `Una vez completada, la orden pasa a Embarque y ya no se podrán registrar desde aquí. ¿Desea completarla de todos modos?`,
        confirmText: 'Completar de todos modos',
        cancelText: 'Volver',
        danger: true,
      })
      if (!ok) return
    }
    if (Math.abs(envasadoGapKg) > 0.5) {
      const ok = await confirm({
        title: 'Diferencia entre lo planificado y lo envasado',
        message:
          `Se planificaron ${totalPlannedKg.toFixed(1)} kg y se envasó realmente ${totalEnvasadoKg.toFixed(1)} kg ` +
          `(${envasadoGapKg > 0 ? 'faltan' : 'sobran'} ${Math.abs(envasadoGapKg).toFixed(1)} kg, ${Math.abs(envasadoGapPct).toFixed(1)}%).\n\n` +
          `¿Desea completar la orden de todas formas?`,
        confirmText: 'Completar de todas formas',
        danger: Math.abs(envasadoGapPct) > processingLimits.mermaThresholdPct,
      })
      if (!ok) return
    }
    try {
      await onComplete()
      toast.success('Orden completada', 'Ya está disponible en Embarque.')
    } catch (err) {
      setCompleteError(err.message)
    }
  }

  // Cerrar un lote con controles de planta sin registrar está permitido
  // (se pueden completar después), pero se avisa cuáles faltan. Los
  // controles cambian por cooperativa, ver lib/loteControles.js.
  const [closingLoteId, setClosingLoteId] = useState(null)
  const handleCloseLoteClick = async (pb) => {
    setClosingLoteId(pb.id)
    try {
      const pending = await getPendingLoteControls(COOPERATIVE, pb.id)
      if (pending.length > 0) {
        const list = pending
          .map(c => `• ${c.label}${c.reason === 'sin_terminar' ? ' (iniciado, sin terminar)' : ''}`)
          .join('\n')
        const ok = await confirm({
          title: `Controles pendientes en el ${LOTE_LABEL_LOWER} ${loteLabel(pb)}`,
          message:
            `Los siguientes controles de planta no están completos:\n\n${list}\n\n` +
            `Puede cerrar el ${LOTE_LABEL_LOWER} igualmente y registrarlos después. ¿Desea cerrarlo?`,
          confirmText: `Cerrar ${LOTE_LABEL_LOWER} de todos modos`,
          cancelText: 'Volver',
          danger: true,
        })
        if (!ok) return
      }
      await onCloseLote(pb)
      toast.success(`${LOTE_LABEL} ${loteLabel(pb)} cerrado`)
    } catch (err) {
      toast.error(`No se pudo cerrar el ${LOTE_LABEL_LOWER}`, err.message)
    } finally {
      setClosingLoteId(null)
    }
  }

  return (
    <div className="item">
      <header style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <OrderNumberField order={order} onSaved={onReload} />
          <span className="muted small">
            {order.market}
            {totalPlannedKg > 0 && ` · ${totalPlannedKg.toFixed(1)} kg`}
            {` · ${batches.length} ${LOTE_LABEL_LOWER}(s)`}
          </span>
          {nextStep && (
            <span className={`next-step ${nextStep.tone}`}>
              <Icon name={nextStep.tone === 'ready' ? 'check' : 'clock'} size={13} />
              {nextStep.text}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AuditStamp row={order} />
          <span className={`tag dot ${order.status === 'completado' ? 'ok' : 'warn'}`}>
            {order.status === 'completado' ? 'Completado' : 'En proceso'}
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)' }} />
        </div>
      </header>

      {open && (<>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <button className="btn small outline" onClick={() => onEditOrder(order)}>
          Editar orden
        </button>
        <button className="btn small outline" onClick={onDocumentos}>
          Documentos
        </button>
      </div>

      {/* Mercado y carga total no se repiten aquí: ya están en la línea de la orden. */}
      {(order.tamizado_fecha_inicio || order.tamizado_fecha_fin || order.envasado_fecha_inicio || order.envasado_fecha_fin || order.fecha_envio || order.internal_container_number) && (
      <div className="order-meta-grid">
        {(order.tamizado_fecha_inicio || order.tamizado_fecha_fin) && (
          <Stat label="Tamizado" value={`${formatDate(order.tamizado_fecha_inicio)} — ${formatDate(order.tamizado_fecha_fin)}`} />
        )}
        {(order.envasado_fecha_inicio || order.envasado_fecha_fin) && (
          <Stat label="Envasado" value={`${formatDate(order.envasado_fecha_inicio)} — ${formatDate(order.envasado_fecha_fin)}`} />
        )}
        {order.fecha_envio && <Stat label="Fecha de envío" value={formatDate(order.fecha_envio)} />}
        {order.internal_container_number && <Stat label="Contenedor interno" value={order.internal_container_number} />}
      </div>
      )}

      {batches.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {batches.map(pb => {
            const bunques = loteBunques(pb)
            const totalInputKg = bunques.reduce((s, b) => s + b.allocated_insumo_kg, 0)
            const totalReproceso = bunques.reduce((s, b) => s + b.allocated_reproceso_kg, 0)
            const totalDescarte = bunques.reduce((s, b) => s + b.allocated_descarte_kg, 0)
            const totalMerma = bunques.reduce((s, b) => s + b.allocated_merma_kg, 0)
            const mermaPct = totalInputKg > 0 ? (totalMerma / totalInputKg * 100) : 0
            const hasSalida = bunques.some(b => b.tamizada_kg != null)
            const plannedKg = loteKg(pb)
            // pb.status solo distingue "procesado" de forma confiable (se
            // actualiza al cerrar el lote); el paso a 'homogenizado' quedó
            // huérfano desde que el reparto de bunques pasó a ser independiente
            // del lote, así que ese estado se deriva de los bunques repartidos.
            const effectiveStatus = pb.status === 'procesado'
              ? 'procesado'
              : bunques.length > 0 ? 'homogenizado' : 'pendiente_homogenizado'
            const status = BATCH_STATUS[effectiveStatus] ?? { label: effectiveStatus, cls: 'info' }
            const envasadoOk = isEnvasadoOk(pb, kgPerQuintal)
            const calidadOk = isCalidadOk(COOPERATIVE, pb)
            const isLiberacion = COOPERATIVE?.features?.liberacionProductoTerminado
            // Colapsado por defecto solo cuando ya no queda nada pendiente
            // (cerrado y con envasado correcto) -- si algo necesita atención
            // se muestra expandido de entrada.
            const defaultCollapsed = pb.status === 'procesado' && envasadoOk
            const isCollapsed = collapsedLotes[pb.id] ?? defaultCollapsed
            const toggleCollapsed = () => setCollapsedLotes(prev => ({ ...prev, [pb.id]: !isCollapsed }))

            return (
              <div key={pb.id} className="lote-card">
                <div className="lote-card-header">
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{LOTE_LABEL}: {loteLabel(pb)}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AuditStamp row={pb} />
                    <span className={`tag dot ${status.cls}`} style={{ fontSize: 11 }}>{status.label}</span>
                    <ActionMenu
                      label={`Más acciones del ${LOTE_LABEL_LOWER} ${loteLabel(pb)}`}
                      items={[
                        !readOnly && { label: `Editar ${LOTE_LABEL_LOWER}`, onClick: () => onEditLote(pb) },
                        { label: 'Resumen de trazabilidad', onClick: () => onResumenTrazabilidad(pb) },
                        // La tabla de trazabilidad vive dentro del detalle: se
                        // despliega el lote si estaba plegado.
                        ...bunques.filter(b => b.tamizada_kg != null).map(b => ({
                          label: openTraza === b.id ? `Ocultar trazabilidad · ${b.bunque_number}` : `Trazabilidad · ${BUNQUE_LABEL_LOWER} ${b.bunque_number}`,
                          onClick: () => {
                            setOpenTraza(openTraza === b.id ? null : b.id)
                            setCollapsedLotes(prev => ({ ...prev, [pb.id]: false }))
                          },
                        })),
                      ]}
                    />
                    <button
                      className="btn small outline"
                      style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={toggleCollapsed}
                    >
                      <Icon name={isCollapsed ? 'chevronDown' : 'chevronUp'} size={12} />
                      {isCollapsed ? 'Detalle' : 'Ocultar'}
                    </button>
                  </div>
                </div>
                <div className="lote-card-sub">
                  Marca <strong>{pb.brand}</strong> · Empaque <strong>{packagingLabel(pb)}</strong> · Planificado <strong>{fmtNum(plannedKg)} kg</strong>{COOPERATIVE?.features?.pallets && pb.pallet_count ? <> · <strong>{pb.pallet_count}</strong> pallets</> : null}
                </div>
                <LoteStepper bunques={bunques} hasSalida={hasSalida} envasadoOk={envasadoOk} calidadOk={calidadOk} status={effectiveStatus} />

                {!isCollapsed && <>

                {(() => {
                  // Chips de los controles de planta de una etapa: muestran si
                  // ya se registraron y, con la orden abierta, abren su modal.
                  const chips = (stage) => {
                    const list = LOTE_CONTROLS.filter(c => c.stage === stage)
                    if (list.length === 0) return null
                    return (
                      <div className="control-chips">
                        {list.map(c => {
                          const st = controlStatus[pb.id]?.[c.key]
                          const state = st?.state
                          const detail = !st ? '' : state === 'ok' ? `${st.count} registro${st.count === 1 ? '' : 's'}` : state === 'sin_terminar' ? 'sin terminar' : 'sin registro'
                          const cls = state === 'ok' ? 'ok' : state ? 'pending' : ''
                          const content = (<>
                            <Icon name={state === 'ok' ? 'check' : state ? 'alertTriangle' : 'circle'} size={13} />
                            <span>{c.label}</span>
                            {detail && <span className="control-chip-detail">{detail}</span>}
                          </>)
                          return readOnly
                            ? <span key={c.key} className={`control-chip ${cls}`}>{content}</span>
                            : <button key={c.key} type="button" className={`control-chip ${cls}`} onClick={() => openControl[c.key]?.(pb)}>{content}</button>
                        })}
                      </div>
                    )
                  }
                  // Primary se mueve solo al paso activo del stepper de arriba
                  // (reparto/tamizado -> envasado -> calidad), para que quede
                  // claro cuál tocar sin tener que leer el stepper.
                  const stageAction = (label, onClick, isNext) => !readOnly && (
                    <button className={`btn small ${isNext ? 'primary' : 'outline'}`} onClick={onClick}>{label}</button>
                  )
                  const calidadLabel = isLiberacion ? 'liberación' : 'control de calidad'
                  // Datos de cada etapa en una sola línea ("45 kg tamizada ·
                  // 2 kg reproceso"), en vez de una grilla de casillas.
                  const facts = (items) => (
                    <div className="stage-facts">
                      {items.filter(Boolean).map((it, i) => <span key={i}>{it}</span>)}
                    </div>
                  )
                  return (<>
                    <div className="stage-card">
                      <div className="stage-card-title">
                        <span>Tamizado</span>
                        <span className="stage-card-actions">
                          {stageAction(
                            `Repartir ${BUNQUE_LABEL_PLURAL_LOWER}${bunques.length > 0 ? ` (${bunques.length})` : ''}`,
                            () => onGestionarBunques(pb),
                            !hasSalida,
                          )}
                        </span>
                      </div>
                      {bunques.length > 0 && totalInputKg > 0 ? (
                        facts([
                          <>{BUNQUE_LABEL_PLURAL} <strong>{bunques.map(b => b.bunque_number).join(', ')}</strong></>,
                          <><strong>{fmtNum(totalInputKg)} kg</strong> repartidos</>,
                          hasSalida && <><strong>{fmtNum(pb.tamizada_kg)} kg</strong> tamizada</>,
                          hasSalida && <><strong>{fmtNum(totalReproceso)} kg</strong> reproceso</>,
                          hasSalida && <><strong>{fmtNum(totalDescarte)} kg</strong> descarte</>,
                          hasSalida && <>merma <strong>{fmtNum(totalMerma)} kg ({fmtNum(mermaPct, 1)}%)</strong></>,
                        ])
                      ) : (
                        <div className="stage-empty">Sin {BUNQUE_LABEL_PLURAL_LOWER} repartidos</div>
                      )}
                      {mermaPct > 5 && (
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                          {mermaPct.toFixed(2)}% de merma — sobre el umbral habitual (5%)
                        </div>
                      )}
                      {chips('tamizado')}
                    </div>

                    <div className="stage-card">
                      <div className="stage-card-title">
                        <span>Envasado</span>
                        {webUsersMap[pb.envasado_registered_by] && (
                          <span className="registrado-por" title={`Registró: ${webUsersMap[pb.envasado_registered_by]}`} aria-label={`Registró: ${webUsersMap[pb.envasado_registered_by]}`}>
                            <Icon name="user" size={14} />
                          </span>
                        )}
                        <span className="stage-card-actions">
                          {stageAction(
                            pb.envasado_registered_at ? 'Editar' : 'Registrar envasado',
                            () => onGestionarEnvasado(pb),
                            hasSalida && !envasadoOk,
                          )}
                        </span>
                      </div>
                      {pb.envasado_registered_at ? (
                        facts([
                          <><strong>{fmtNum(Number(pb.envasado_qq) * kgPerQuintal)} kg</strong> ({fmtNum(pb.envasado_qq)} qq)</>,
                          <><strong>{pb.envasado_cajas_envasadas}</strong> cajas</>,
                          pb.packaging_type === 'bolsa' && pb.envasado_bolsas_envasadas != null && <><strong>{pb.envasado_bolsas_envasadas}</strong> bolsas</>,
                          pb.packaging_type === 'saco' && pb.envasado_sacos_envasados != null && <><strong>{pb.envasado_sacos_envasados}</strong> sacos</>,
                          <>turno <strong>{pb.envasado_turno === 'manana' ? 'mañana' : 'tarde'}</strong></>,
                          Number(pb.tamizada_kg ?? 0) > 0 && <><strong>{fmtNum((Number(pb.envasado_qq) * kgPerQuintal) / Number(pb.tamizada_kg) * 100, 0)}%</strong> de lo tamizado</>,
                        ])
                      ) : (
                        <div className="stage-empty">Sin registrar</div>
                      )}
                      {bunques.length > 0 && !envasadoOk && !readOnly && pb.envasado_registered_at && (
                        <div className="stage-warning">
                          Para cerrar el {LOTE_LABEL_LOWER}, el envasado debe coincidir exacto con lo planificado (QQ, cajas y {pb.packaging_type === 'bolsa' ? 'bolsas' : 'sacos'}).
                        </div>
                      )}
                      {chips('envasado')}
                    </div>

                    <div className="stage-card">
                      <div className="stage-card-title">
                        <span>{isLiberacion ? 'Liberación' : 'Calidad'}</span>
                        {webUsersMap[pb.calidad_registered_by] && (
                          <span className="registrado-por" title={`Registró: ${webUsersMap[pb.calidad_registered_by]}`} aria-label={`Registró: ${webUsersMap[pb.calidad_registered_by]}`}>
                            <Icon name="user" size={14} />
                          </span>
                        )}
                        <span className="stage-card-actions">
                          {stageAction(
                            pb.calidad_registered_at ? 'Editar' : `Registrar ${calidadLabel}`,
                            () => onGestionarCalidad(pb),
                            envasadoOk && !calidadOk,
                          )}
                        </span>
                      </div>
                      {pb.calidad_registered_at ? (
                        facts([
                          isLiberacion && pb.liberacion_resultado && (
                            <strong className={pb.liberacion_resultado === 'conforme' ? 'fact-ok' : 'fact-bad'}>
                              {pb.liberacion_resultado === 'conforme' ? 'Conforme' : 'No conforme'}
                            </strong>
                          ),
                          <>humedad <strong>{fmtNum(pb.calidad_humedad_pct)}%</strong></>,
                          <>impurezas <strong>{fmtNum(pb.calidad_impurezas_pct)}%</strong></>,
                          isLiberacion && pb.liberacion_formato_presentacion && <>presentación <strong>{pb.liberacion_formato_presentacion}</strong></>,
                          !isLiberacion && pb.calidad_color && <>color <strong>{pb.calidad_color}</strong></>,
                          !isLiberacion && pb.calidad_sabor && <>sabor <strong>{pb.calidad_sabor}</strong></>,
                          !isLiberacion && pb.calidad_textura && <>textura <strong>{pb.calidad_textura}</strong></>,
                        ])
                      ) : (
                        <div className="stage-empty">Sin registrar</div>
                      )}
                    </div>

                    {/* Editar lote y trazabilidad están en el menú ⋯ de la cabecera.
                        Un lote ya cerrado no vuelve a mostrar "Cerrar". */}
                    {!readOnly && bunques.length > 0 && pb.status !== 'procesado' && (
                    <div className="lote-card-footer">
                        <button
                          className="btn small primary lote-card-close"
                          onClick={() => handleCloseLoteClick(pb)}
                          disabled={!envasadoOk || !calidadOk || closingLoteId === pb.id}
                          title={envasadoOk && calidadOk ? undefined : `Falta ${!envasadoOk ? 'completar el envasado' : `registrar ${isLiberacion ? 'la liberación' : 'el control de calidad'}`}`}
                        >
                          Cerrar {LOTE_LABEL_LOWER}
                        </button>
                    </div>
                    )}
                    {bunques.filter(b => b.tamizada_kg != null).map(b => openTraza === b.id && (
                      <TrazabilidadTable
                        key={b.id}
                        inputs={b.allocated_inputs ?? []}
                        stockItems={stockItems ?? []}
                        processing={b}
                        order={order}
                      />
                    ))}
                  </>)
                })()}
                </>}
              </div>
            )
          })}

        </div>
      )}

      {batches.length > 1 && (
        <TotalsPanel batches={batches} kgPerQuintal={kgPerQuintal} plannedKg={totalPlannedKg} envasadoKg={totalEnvasadoKg} />
      )}

      {/* Fase 2: cierre */}
      <div className={`order-completion-banner ${canComplete ? 'ready' : 'pending'}`}>
        {canComplete ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Todos los {LOTE_LABEL_PLURAL_LOWER} procesados</span>
            <button className="btn small primary" onClick={handleCompleteClick} disabled={checkingComplete}>{checkingComplete ? 'Revisando...' : 'Completar orden'}</button>
          </>
        ) : (
          <span style={{ fontSize: 12 }}>
            {batches.length === 0
              ? `Agrega al menos un ${LOTE_LABEL_LOWER} para poder completar la orden.`
              : batches.filter(b => b.status !== 'procesado').length > 0
                ? `${batches.filter(b => b.status !== 'procesado').length} ${LOTE_LABEL_LOWER}(s) aún sin procesar.`
                : `${pendingEnvasado.length} ${LOTE_LABEL_LOWER}(s) con envasado sin completar correctamente (debe coincidir exacto con lo planificado).`
            }
          </span>
        )}
      </div>
      {completeError && (
        <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{completeError}</p>
      )}

      <footer style={{ marginTop: 8 }}>
        <button className="btn small outline" onClick={onAddLote}>+ Agregar {LOTE_LABEL_LOWER}</button>
      </footer>
      </>)}

      {confirmDialog}
    </div>
  )
}
