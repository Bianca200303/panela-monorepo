import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import FormatosPage from './FormatosPage'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
} from 'recharts'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import { loteBunques, BUNQUE_ALLOCATIONS_SELECT } from '../lib/loteHelpers'
import { getLoteLabelPlural, getLoteLabelPluralLower } from '../lib/labels'
import { fetchStockSummary } from '../lib/stockHelpers'

// ─── Constantes ───────────────────────────────────────────────────────────────

const GEO_URL       = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const HUMIDITY_LIMIT = 12
const MERMA_LIMIT    = 5   // % — umbral de alerta

const MARKET_COORDS = {
  'Alemania':      [10.45, 51.17],
  'Francia':       [2.35,  48.86],
  'EE.UU.':        [-97.0, 38.0],
  'Reino Unido':   [-3.44, 55.38],
  'Italia':        [12.57, 41.87],
  'Países Bajos':  [5.29,  52.13],
  'Bélgica':       [4.47,  50.50],
  'Suiza':         [8.23,  46.82],
  'Austria':       [14.55, 47.52],
  'España':        [-3.75, 40.46],
  'Canadá':        [-106.3, 56.1],
  'Japón':         [138.25, 36.20],
  'Australia':     [133.78, -25.27],
  'Portugal':      [-8.22, 39.40],
  'Suecia':        [18.64, 60.13],
  'Noruega':       [8.47,  60.47],
  'Dinamarca':     [9.50,  56.26],
  'Finlandia':     [25.75, 61.92],
  'Polonia':       [19.15, 51.92],
  'China':         [104.2, 35.86],
  'Corea del Sur': [127.8, 35.91],
  'Singapur':      [103.8, 1.35],
  'Nueva Zelanda': [174.9, -40.9],
  'México':        [-102.6, 23.6],
  'Brasil':        [-51.9, -14.2],
  'Argentina':     [-63.6, -38.4],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n, dec = 1) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toFixed(dec)
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function monthLabel(ym) {
  if (!ym) return '—'
  return new Date(ym + '-02').toLocaleDateString('es-PE', { month: 'short', year: '2-digit' })
}

// Agrega el resultado de tamizado de un lote a partir de sus bunques (el
// tamizado ya no es 1 registro por lote, se reparte en bunques por
// capacidad). tamizada_kg viene de la columna derivada en el lote (trigger
// que suma sus bunques); descarte se suma aquí porque no tiene columna
// derivada propia. processed_at usa el más reciente entre los bunques ya
// procesados.
function getProc(batch) {
  const bunques = loteBunques(batch).filter(b => b.tamizada_kg != null)
  if (bunques.length === 0) return null
  return {
    tamizada_kg: Number(batch.tamizada_kg ?? 0),
    descarte_kg: bunques.reduce((s, b) => s + b.allocated_descarte_kg, 0),
    processed_at: bunques.map(b => b.processed_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  }
}

// Kg reales de un lote: tamizada si ya se procesó, planificados si aún no
// (planificado = cantidad de bolsas/sacos × kg por unidad; las cajas no aportan peso propio)
function batchKg(b) {
  const proc = getProc(b)
  if (proc?.tamizada_kg) return Number(proc.tamizada_kg)
  return Number(b.packaging_count ?? 0) * Number(b.packaging_kg ?? 0)
}

// ─── Iconos SVG ──────────────────────────────────────────────────────────────

const IC = {
  leaf: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z" />
      <path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12" />
    </svg>
  ),
  box: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  ),
  gauge: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16a8 8 0 0 1 16 0" /><path d="M12 16l4-4" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  list: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
      <circle cx="6" cy="8" r="0.5" fill="currentColor" /><circle cx="6" cy="12" r="0.5" fill="currentColor" /><circle cx="6" cy="16" r="0.5" fill="currentColor" />
    </svg>
  ),
  droplet: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </svg>
  ),
  globe: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      <path d="M2 12h20" />
    </svg>
  ),
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

// Mismo look que los KPI de Inicio (kpi-card/kpi-label/kpi-value/kpi-hint en
// index.css): tarjeta blanca plana, etiqueta chica en mayúsculas, valor
// grande. A diferencia de Inicio (que no lleva ícono en sus KPIs), acá cada
// métrica sí lo necesita para distinguirse de un vistazo entre 8 tarjetas --
// se ubica arriba a la derecha, sin caja de fondo, mismo criterio que el
// ícono de los módulos de Inicio. `blue` -- igual que en Inicio, las
// métricas más importantes van en fondo azul sólido (blanco todo el
// contenido); ahí el color por métrica no aplica, ya está todo en blanco.
function KpiCard({ icon, value, label, sub, color = 'var(--primary)', alertSub = false, blue = false }) {
  return (
    <div className={`kpi-card${blue ? ' blue' : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon" style={blue ? undefined : { color }}>{icon}</span>
      </div>
      <div className="kpi-value" style={blue ? undefined : { color }}>{value}</div>
      {sub && <div className="kpi-hint" style={alertSub ? { color: 'var(--danger)' } : undefined}>{sub}</div>}
    </div>
  )
}

// Tooltip unificado para gráficos de kg — siempre en toneladas
function TooltipToneladas({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>{label}</strong>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: <strong>{(Number(p.value) / 1000).toFixed(2)} t</strong>
        </div>
      ))}
    </div>
  )
}

function TooltipCalidad({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
      <strong style={{ display: 'block', marginBottom: 2 }}>{label}</strong>
      <span style={{ color: val > HUMIDITY_LIMIT ? '#dc2626' : 'var(--success)' }}>
        Humedad prom.: <strong>{fmt(val)}%</strong>
      </span>
      <div style={{ color: '#000', marginTop: 2 }}>({payload[0]?.payload?.muestras} evaluacion{payload[0]?.payload?.muestras !== 1 ? 'es' : ''})</div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ReportesPage() {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_PLURAL = getLoteLabelPlural(COOPERATIVE)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
  const [searchParams] = useSearchParams()
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const [tab, setTab]                   = useState(searchParams.get('tab') ?? 'ordenes')
  const [period, setPeriod]             = useState('all')
  const [hoveredMarker, setHoveredMarker] = useState(null)

  // Datos crudos (cargados una vez, filtrado client-side)
  const [rawOrders, setRawOrders]         = useState([])
  const [rawQuality, setRawQuality]       = useState([])
  const [rawReceptions, setRawReceptions] = useState([])
  // Stock actual (no es un total del período filtrado, es una foto de ahora
  // mismo -- por eso va separado del resto, que sí se recalcula con period).
  const [stock, setStock] = useState({ materiaPrimaKg: null, productoTerminadoKg: null })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [ordersRes, qualityRes, receptionsRes, stockRes] = await Promise.all([
        supabase
          .from('plant_orders')
          .select(`
            id, order_code, client_order_number, market, fecha_envio, tamizado_fecha_inicio, total_kg, status, created_at,
            plant_production_batches (
              id, batch_code, brand, packaging_type, packaging_count, packaging_kg, status, tamizada_kg,
${BUNQUE_ALLOCATIONS_SELECT}
            )
          `)
          .eq('cooperative_id', COOPERATIVE.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('quality_evaluations')
          .select(`
            id, humidity_pct, impurities_pct, color, sack_condition, created_at,
            exit_items (
              item_document_number,
              production_batches ( batch_code, producers ( first_name, last_name, coop_modules ( name ) ) )
            )
          `)
          .eq('cooperative_id', COOPERATIVE.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('exit_receptions')
          .select('received_at, exit_reception_items ( quantity_kg_received )')
          .eq('cooperative_id', COOPERATIVE.id)
          .order('received_at', { ascending: true }),
        fetchStockSummary(COOPERATIVE),
      ])
      if (ordersRes.error)  throw ordersRes.error
      if (qualityRes.error) throw qualityRes.error
      setRawOrders(ordersRes.data ?? [])
      setRawQuality(qualityRes.data ?? [])
      setRawReceptions(receptionsRes.data ?? [])
      setStock(stockRes)
    } catch (e) {
      setError(e.message ?? 'Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }

  // ── Filtro de período ─────────────────────────────────────────────────────

  const cutoff = useMemo(() => {
    const now = new Date()
    if (period === 'year')  return `${now.getFullYear()}-01-01`
    if (period === 'month') {
      const y = now.getFullYear()
      const m = String(now.getMonth() + 1).padStart(2, '0')
      return `${y}-${m}-01`
    }
    return null
  }, [period])

  // Órdenes: filtrar por fecha real de procesado del primer lote procesado,
  // o por created_at como fallback (así el filtro refleja actividad real)
  const orders = useMemo(() => {
    if (!cutoff) return rawOrders
    return rawOrders.filter(o => {
      // Incluir si algún lote fue procesado en el período
      const hasProcessedInPeriod = (o.plant_production_batches ?? []).some(b => {
        const proc = getProc(b)
        return proc?.processed_at && proc.processed_at >= cutoff
      })
      // O si la orden fue creada en el período y aún no tiene procesado
      const createdInPeriod = (o.created_at ?? '') >= cutoff
      return hasProcessedInPeriod || createdInPeriod
    })
  }, [rawOrders, cutoff])

  const quality    = useMemo(() => cutoff ? rawQuality.filter(q => (q.created_at ?? '') >= cutoff)      : rawQuality,    [rawQuality, cutoff])
  const receptions = useMemo(() => cutoff ? rawReceptions.filter(r => (r.received_at ?? '') >= cutoff)  : rawReceptions, [rawReceptions, cutoff])

  // ── FIX #3: marketData incluye TODAS las órdenes (no solo completadas) ────
  // Usa kg reales (tamizada) si el lote está procesado, planificados si no.
  // Así el mapa y el gráfico son coherentes con el KPI de mercados.
  const marketData = useMemo(() => {
    const map = {}
    for (const o of orders) {
      if (!o.market) continue
      const kg = (o.plant_production_batches ?? []).reduce((s, b) => s + batchKg(b), 0)
      if (!map[o.market]) map[o.market] = { market: o.market, kg: 0, ordenes: 0, completadas: 0 }
      map[o.market].kg += kg
      map[o.market].ordenes++
      if (o.status === 'completado') map[o.market].completadas++
    }
    return Object.values(map).sort((a, b) => b.kg - a.kg)
  }, [orders])

  // ── Métricas KPI ──────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    let tamizada = 0, descarte = 0, homoInputKg = 0
    let maxMermaOrder = null
    const completadas = orders.filter(o => o.status === 'completado').length
    const enProceso   = orders.filter(o => o.status === 'en_proceso').length

    for (const o of orders) {
      let oTam = 0, oDes = 0
      for (const b of o.plant_production_batches ?? []) {
        const proc = getProc(b)
        const tam  = Number(proc?.tamizada_kg ?? 0)
        const des  = Number(proc?.descarte_kg ?? 0)
        tamizada  += tam
        descarte  += des
        oTam      += tam
        oDes      += des

        // FIX #2: rendimiento medido sobre el insumo real de homogenizado,
        // no sobre la MP recibida en campo (que puede ser de otro período).
        if (tam > 0) {
          homoInputKg += loteBunques(b)
            .filter(bq => bq.tamizada_kg != null)
            .reduce((s, bq) => s + bq.allocated_insumo_kg, 0)
        }
      }
      // FIX #6: merma máxima individual por orden
      if (oTam + oDes > 0) {
        const mermaO = (oDes / (oTam + oDes)) * 100
        if (maxMermaOrder === null || mermaO > maxMermaOrder) maxMermaOrder = mermaO
      }
    }

    const recibido   = receptions.reduce((s, r) =>
      s + (r.exit_reception_items ?? []).reduce((s2, i) => s2 + Number(i.quantity_kg_received ?? 0), 0), 0
    )
    // FIX #2: rendimiento = panela tamizada / MP realmente consumida en planta
    const rendimiento = homoInputKg > 0 && tamizada > 0 ? (tamizada / homoInputKg * 100) : null
    const merma       = tamizada + descarte > 0 ? (descarte / (tamizada + descarte) * 100) : null

    const evals      = quality.filter(q => q.humidity_pct != null)
    const avgHumedad = evals.length > 0 ? evals.reduce((s, q) => s + Number(q.humidity_pct), 0) / evals.length : null
    const outOfSpec  = evals.filter(q => Number(q.humidity_pct) > HUMIDITY_LIMIT).length

    // FIX #3: mercados derivados de marketData (misma fuente que el mapa y el gráfico)
    const mercados = marketData.map(m => m.market)

    return {
      tamizada, descarte, recibido, rendimiento, merma, maxMermaOrder,
      totalOrdenes: orders.length, completadas, enProceso,
      avgHumedad, outOfSpec, totalEvals: evals.length, mercados,
    }
  }, [orders, quality, receptions, marketData])

  // ── FIX #1: Producción mensual agrupada por fecha REAL de procesado ────────
  const monthlyData = useMemo(() => {
    const map = {}
    for (const o of orders) {
      for (const b of o.plant_production_batches ?? []) {
        const proc = getProc(b)
        if (!proc?.tamizada_kg) continue
        // Fecha real: processed_at del lote. Fallback: tamizado_fecha_inicio de la orden.
        const month = proc.processed_at?.slice(0, 7) ?? o.tamizado_fecha_inicio?.slice(0, 7)
        if (!month) continue
        if (!map[month]) map[month] = { month, producido: 0, recibido: 0 }
        map[month].producido += Number(proc.tamizada_kg)
      }
    }
    for (const r of receptions) {
      const month = r.received_at?.slice(0, 7)
      if (!month) continue
      if (!map[month]) map[month] = { month, producido: 0, recibido: 0 }
      map[month].recibido += (r.exit_reception_items ?? [])
        .reduce((s, i) => s + Number(i.quantity_kg_received ?? 0), 0)
    }
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, label: monthLabel(m.month) }))
  }, [orders, receptions])

  // ── FIX #5: Tendencia calidad — incluye nº de muestras por mes ────────────
  const qualityTrend = useMemo(() => {
    const map = {}
    for (const q of quality) {
      if (q.humidity_pct == null) continue
      const month = q.created_at?.slice(0, 7)
      if (!month) continue
      if (!map[month]) map[month] = { month, sum: 0, count: 0 }
      map[month].sum   += Number(q.humidity_pct)
      map[month].count++
    }
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({
        label:    monthLabel(m.month),
        humedad:  parseFloat((m.sum / m.count).toFixed(2)),
        muestras: m.count,
      }))
  }, [quality])

  // ── Marcadores del mapa ───────────────────────────────────────────────────
  const mapMarkers = useMemo(() => {
    const maxKg = Math.max(...marketData.map(m => m.kg), 1)
    return marketData
      .filter(m => MARKET_COORDS[m.market])
      .map(m => ({ ...m, coordinates: MARKET_COORDS[m.market], r: 5 + (m.kg / maxKg) * 14 }))
  }, [marketData])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) return <p className="muted">Cargando reportes...</p>
  if (error)   return <p style={{ color: '#dc2626' }}>Error: {error}</p>

  const {
    tamizada, descarte, recibido, rendimiento, merma, maxMermaOrder,
    totalOrdenes, completadas, enProceso,
    avgHumedad, outOfSpec, totalEvals, mercados,
  } = metrics

  // FIX #4: formateador de eje Y siempre en toneladas (unidad coherente)
  const tickT = v => `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}t`

  // FIX #5: la línea de calidad solo se traza si hay ≥3 puntos; si no, solo dots
  const qualityHasLine = qualityTrend.length >= 3

  return (
    <div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>Reportes</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{COOPERATIVE.name ?? 'Cooperativa'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: 13 }}>
            {[['all', 'Todo'], ['year', 'Año actual'], ['month', 'Mes actual']].map(([v, lbl], i, arr) => (
              <button key={v} onClick={() => setPeriod(v)} style={{
                padding: '5px 11px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                background: period === v ? 'var(--primary)' : '#fff',
                color: period === v ? '#fff' : 'var(--text)',
                borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              }}>{lbl}</button>
            ))}
          </div>
          <button className="btn small primary" onClick={load}>↻ Actualizar</button>
        </div>
      </div>

      {/* ── KPIs -- un solo bloque parejo de 8 tarjetas, 4 columnas x 2 filas
          exactas (sin huecos), todas del mismo tamaño (1 fila x 1 columna).
          Los 2 de stock (foto de AHORA mismo, no cambian con el selector
          Todo/Año/Mes -- a diferencia de las otras 6, que sí) van primero
          y en azul, pero ya del mismo tamaño que el resto. Colores: solo
          paleta de marca (--primary/verde/ámbar/--danger), nada fuera de
          eso. ──────────────────────────────────────────────────────────── */}
      <div className="grid four" style={{ marginBottom: 20 }}>
        <KpiCard
          icon={IC.leaf}
          value={stock.materiaPrimaKg != null ? `${(stock.materiaPrimaKg / 1000).toFixed(2)} t` : '—'}
          label="Materia prima disponible"
          sub={stock.materiaPrimaKg != null ? `${fmt(stock.materiaPrimaKg, 0)} kg · sin usar en homogenizado` : 'No disponible'}
          blue
        />
        <KpiCard
          icon={IC.box}
          value={stock.productoTerminadoKg != null ? `${(stock.productoTerminadoKg / 1000).toFixed(2)} t` : '—'}
          label="Producto terminado disponible"
          sub={stock.productoTerminadoKg != null ? `${fmt(stock.productoTerminadoKg, 0)} kg · envasado, sin despachar` : 'No disponible'}
          blue
        />
        <KpiCard
          icon={IC.leaf}
          value={`${(recibido / 1000).toFixed(2)} t`}
          label="Materia prima recibida"
          sub={recibido > 0 ? `${fmt(recibido, 0)} kg · campo → planta` : 'Sin recepciones registradas'}
        />
        {/* FIX #6: muestra merma promedio Y máxima por orden */}
        <KpiCard
          icon={IC.box}
          value={`${(tamizada / 1000).toFixed(2)} t`}
          label="Panela producida (tamizada)"
          sub={merma != null
            ? `Merma prom.: ${fmt(merma)}%${maxMermaOrder != null ? ` · Máx. orden: ${fmt(maxMermaOrder)}%` : ''}`
            : null}
          alertSub={maxMermaOrder != null && maxMermaOrder > MERMA_LIMIT}
        />
        {/* FIX #2: rendimiento sobre insumo real de homogenizado (no MP de campo) */}
        <KpiCard
          icon={IC.gauge}
          value={`${fmt(rendimiento ?? 0)}%`}
          label="Rendimiento en planta"
          sub={rendimiento != null
            ? `Panela tamizada / MP consumida en homogenizado`
            : `Sin ${LOTE_LABEL_PLURAL_LOWER} completamente procesados`}
          alertSub={rendimiento != null && rendimiento < 80}
        />
        <KpiCard
          icon={IC.list}
          value={totalOrdenes}
          label="Órdenes de producción"
          sub={`${completadas} completada${completadas !== 1 ? 's' : ''} · ${enProceso} en proceso`}
        />
        <KpiCard
          icon={IC.droplet}
          value={`${fmt(avgHumedad ?? 0)}%`}
          label="Humedad promedio"
          sub={totalEvals > 0
            ? outOfSpec > 0
              ? `${outOfSpec} de ${totalEvals} lotes sobre el límite (${HUMIDITY_LIMIT}%)`
              : `${totalEvals} lotes — todos dentro del límite`
            : 'Sin evaluaciones de calidad'}
          color={avgHumedad != null && avgHumedad > HUMIDITY_LIMIT ? 'var(--danger)' : undefined}
          alertSub={avgHumedad != null && avgHumedad > HUMIDITY_LIMIT}
        />
        <KpiCard
          icon={IC.globe}
          value={mercados.length}
          label="Mercados destino"
          sub={mercados.length > 0
            ? mercados.slice(0, 3).join(' · ') + (mercados.length > 3 ? ` +${mercados.length - 3}` : '')
            : 'Sin órdenes registradas'}
        />
      </div>

      {/* ── Fila 2: Producción mensual + Mapa ─────────────────────────────────── */}
      <div className="split" style={{ marginBottom: 20 }}>

        {/* FIX #1: gráfico agrupado por processed_at (fecha real de procesado) */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>
              Producción mensual
              <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>— por fecha real de procesado</span>
            </h4>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#000' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f59e0b', marginRight: 4 }} />MP recibida</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--success)', marginRight: 4 }} />Panela prod.</span>
            </div>
          </div>
          {monthlyData.length === 0 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p className="muted small">Sin datos en el período seleccionado</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barGap={2} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                {/* FIX #4: eje Y siempre en toneladas */}
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={tickT} />
                <Tooltip content={<TooltipToneladas />} cursor={{ fill: '#f3f4f6' }} />
                <Bar dataKey="recibido"  name="MP recibida"  fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="producido" name="Panela prod." fill="var(--success)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Mapa de mercados */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>
              Mercados destino
              <span className="tag ok" style={{ marginLeft: 8, fontWeight: 400 }}>
                {mercados.length} país{mercados.length !== 1 ? 'es' : ''}
              </span>
            </h4>
            {hoveredMarker ? (
              <div style={{ fontSize: 12, textAlign: 'right' }}>
                <strong style={{ color: '#0f4c5c' }}>{hoveredMarker.market}</strong>
                <div style={{ color: '#000' }}>
                  {(hoveredMarker.kg / 1000).toFixed(2)} t · {hoveredMarker.ordenes} orden{hoveredMarker.ordenes !== 1 ? 'es' : ''}
                  {hoveredMarker.completadas < hoveredMarker.ordenes && (
                    <span className="muted"> ({hoveredMarker.completadas} completada{hoveredMarker.completadas !== 1 ? 's' : ''})</span>
                  )}
                </div>
              </div>
            ) : (
              <span style={{ fontSize: 11, color: '#000' }}>Pasa el cursor sobre un punto</span>
            )}
          </div>
          <div style={{ height: 230, margin: '0 -16px -16px' }}>
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{ scale: 105, center: [10, 28] }}
              style={{ width: '100%', height: '100%' }}
            >
              <Geographies geography={GEO_URL}>
                {({ geographies }) =>
                  geographies.map(geo => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="#e5e7eb"
                      stroke="#fff"
                      strokeWidth={0.5}
                      style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                    />
                  ))
                }
              </Geographies>
              {mapMarkers.map(m => (
                <Marker key={m.market} coordinates={m.coordinates}
                  onMouseEnter={() => setHoveredMarker(m)}
                  onMouseLeave={() => setHoveredMarker(null)}
                >
                  <circle r={m.r} fill="#0f4c5c" fillOpacity={0.78} stroke="#fff" strokeWidth={1.5} style={{ cursor: 'pointer' }} />
                </Marker>
              ))}
            </ComposableMap>
          </div>
        </div>

      </div>

      {/* ── Fila 3: Distribución mercados + Tendencia calidad ─────────────────── */}
      <div className="split" style={{ marginBottom: 20 }}>

        {/* FIX #3: barras incluyen todas las órdenes, con nota si hay en proceso */}
        <div className="card">
          <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>
            Distribución por mercado
            <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>— kg reales + planificados</span>
          </h4>
          <div style={{ fontSize: 11, color: '#000', marginBottom: 10 }}>
            Tamizados donde disponible; kg planificados para {LOTE_LABEL_PLURAL_LOWER} en proceso.
          </div>
          {marketData.length === 0 ? (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p className="muted small">Sin órdenes en el período</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, marketData.length * 38)}>
              <BarChart layout="vertical" data={marketData} margin={{ left: 0, right: 32, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                {/* FIX #4: eje X siempre en toneladas */}
                <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={tickT} />
                <YAxis type="category" dataKey="market" tick={{ fontSize: 11 }} width={82} axisLine={false} tickLine={false} />
                <Tooltip content={<TooltipToneladas />} cursor={{ fill: '#f3f4f6' }} />
                <Bar dataKey="kg" name="Panela (kg)" fill="#0f4c5c" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* FIX #5: línea solo si ≥3 puntos; muestra nº de muestras en tooltip */}
        <div className="card">
          <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>
            Tendencia de calidad
            <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>— humedad promedio mensual</span>
          </h4>
          <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 10 }}>
            Límite máximo: {HUMIDITY_LIMIT}%
            {!qualityHasLine && qualityTrend.length > 0 && (
              <span className="muted" style={{ color: '#000', marginLeft: 8 }}>
                (datos insuficientes para trazar tendencia — se muestran puntos individuales)
              </span>
            )}
          </div>
          {qualityTrend.length === 0 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p className="muted small">Sin evaluaciones de calidad en el período</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={qualityTrend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit="%" domain={[0, 'auto']} />
                <Tooltip content={<TooltipCalidad />} />
                <ReferenceLine
                  y={HUMIDITY_LIMIT}
                  stroke="#dc2626"
                  strokeDasharray="5 4"
                  label={{ value: `límite ${HUMIDITY_LIMIT}%`, position: 'insideTopRight', fontSize: 10, fill: '#dc2626' }}
                />
                <Line
                  type="monotone"
                  dataKey="humedad"
                  name="Humedad prom."
                  stroke={qualityHasLine ? '#0891b2' : 'transparent'}
                  strokeWidth={qualityHasLine ? 2.5 : 0}
                  connectNulls={false}
                  dot={{ r: qualityHasLine ? 4 : 6, fill: '#0891b2', strokeWidth: 0 }}
                  activeDot={{ r: 7, fill: '#0891b2', stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>

      {/* ── Tabs de detalle ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          ['ordenes',  'Órdenes de producción'],
          ['calidad',  'Evaluaciones de calidad'],
          ['formatos', 'Formatos de Campo'],
        ].map(([v, lbl]) => (
          <button key={v} className={`btn small ${tab === v ? 'primary' : 'outline'}`} onClick={() => setTab(v)}>{lbl}</button>
        ))}
      </div>

      {/* ── Tab: Órdenes ──────────────────────────────────────────────────────── */}
      {tab === 'ordenes' && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table small">
              <thead>
                <tr>
                  <th>Orden de producción</th>
                  <th>Mercado</th>
                  <th>Envío</th>
                  <th>Carga (kg)</th>
                  <th>{LOTE_LABEL_PLURAL}</th>
                  <th>Producido (kg)</th>
                  <th>Avance</th>
                  <th>Merma</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 20 }}>Sin datos en el período</td></tr>
                )}
                {[...orders].reverse().map(o => {
                  let producido = 0, desc = 0
                  for (const b of o.plant_production_batches ?? []) {
                    const proc = getProc(b)
                    producido += Number(proc?.tamizada_kg ?? 0)
                    desc      += Number(proc?.descarte_kg ?? 0)
                  }
                  const mermaO = producido + desc > 0 ? (desc / (producido + desc) * 100) : null
                  const pct    = o.total_kg > 0 ? Math.min(100, (producido / Number(o.total_kg)) * 100) : 0
                  return (
                    <tr key={o.id}>
                      <td><strong>{o.client_order_number ?? o.order_code}</strong></td>
                      <td>{o.market}</td>
                      <td>{formatDate(o.fecha_envio)}</td>
                      <td>{fmt(o.total_kg, 0)}</td>
                      <td>{(o.plant_production_batches ?? []).length}</td>
                      <td>{producido > 0 ? fmt(producido, 1) : <span className="muted">—</span>}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 56, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--success)' : 'var(--primary)', borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, color: '#000' }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td>
                        {mermaO != null
                          ? <span style={{ color: mermaO > MERMA_LIMIT ? '#dc2626' : 'var(--success)', fontWeight: 600 }}>{fmt(mermaO)}%</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        {o.status === 'completado'
                          ? <span className="tag ok">Completada</span>
                          : <span className="tag warn">En proceso</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Calidad ──────────────────────────────────────────────────────── */}
      {tab === 'calidad' && (
        <div className="card">
          {quality.filter(q => q.humidity_pct != null).length > 0 && (
            <div style={{ display: 'flex', gap: 20, marginBottom: 12, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: 'var(--success)', fontSize: 18 }}>
                  {quality.filter(q => Number(q.humidity_pct) <= HUMIDITY_LIMIT).length}
                </strong>
                <span className="muted"> dentro del límite</span>
              </div>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: '#dc2626', fontSize: 18 }}>
                  {quality.filter(q => Number(q.humidity_pct) > HUMIDITY_LIMIT).length}
                </strong>
                <span className="muted"> sobre el límite ({HUMIDITY_LIMIT}%)</span>
              </div>
              <div style={{ fontSize: 13 }}>
                <strong style={{ fontSize: 18 }}>{quality.filter(q => q.humidity_pct != null).length}</strong>
                <span className="muted"> evaluaciones totales</span>
              </div>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="table small">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Módulo</th>
                  <th>Productor</th>
                  <th>Humedad (%)</th>
                  <th>Impurezas (%)</th>
                  <th>Color</th>
                  <th>Cond. saco</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {quality.length === 0 && (
                  <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>Sin datos en el período</td></tr>
                )}
                {[...quality].reverse().map(ev => {
                  const pb       = ev.exit_items?.production_batches
                  const producer = pb?.producers ? `${pb.producers.first_name} ${pb.producers.last_name}` : '—'
                  const modName  = pb?.producers?.coop_modules?.name ?? '—'
                  const humid    = Number(ev.humidity_pct)
                  const over     = ev.humidity_pct != null && humid > HUMIDITY_LIMIT
                  return (
                    <tr key={ev.id}>
                      <td><strong>{ev.exit_items?.item_document_number ?? pb?.batch_code ?? '—'}</strong></td>
                      <td>{modName}</td>
                      <td>{producer}</td>
                      <td style={{ color: over ? '#dc2626' : 'var(--success)', fontWeight: 600 }}>
                        {fmt(ev.humidity_pct)}{over && <span style={{ marginLeft: 4, fontSize: 11 }}>↑</span>}
                      </td>
                      <td>{fmt(ev.impurities_pct)}</td>
                      <td>{ev.color ?? '—'}</td>
                      <td>{ev.sack_condition ?? '—'}</td>
                      <td>{ev.created_at ? new Date(ev.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Formatos ─────────────────────────────────────────────────────── */}
      {tab === 'formatos' && <FormatosPage />}

    </div>
  )
}
