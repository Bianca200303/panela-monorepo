import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { fetchStockSummary } from '../lib/stockHelpers'
import { Skeleton } from '../components/Skeleton'

// Íconos de línea simples (currentColor) -- sin dependencia nueva, un ícono
// por módulo, mismo trazo/tamaño que los de la imagen de referencia.
const ICONS = {
  box: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
    </svg>
  ),
  clipboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V2h6v2" /><path d="M9 11l2 2 4-4" />
    </svg>
  ),
  list: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" />
    </svg>
  ),
  truck: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h11v9H2z" /><path d="M13 11h4l4 4v2h-8z" /><circle cx="7" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" />
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  chart: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" />
    </svg>
  ),
  database: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" /><circle cx="17.5" cy="9" r="2.6" /><path d="M15 20.3c.3-2.7 2.3-4.7 4.9-5.1" />
    </svg>
  ),
}

// Módulos de acceso rápido -- todas las tarjetas blancas, con ícono y
// numeración. Sin datos ficticios (turno/estado de planta): el contador
// "N módulos" es real (largo del array), no inventado.
const menuItems = [
  { path: '/recepcion', title: 'Recepcionar materia prima', desc: 'Registra las salidas recibidas de los productores', icon: 'box' },
  { path: '/calidad', title: 'Registrar calidad', desc: 'Evalúa la calidad de la materia prima recepcionada', icon: 'clipboard' },
  { path: '/ordenes', title: 'Órdenes de producción', desc: 'Crea y gestiona órdenes de producción interna', icon: 'list' },
  { path: '/embarque', title: 'Embarque', desc: 'Órdenes completadas: asignar contenedor, carga, despacho y trazabilidad', icon: 'truck' },
  { path: '/controles', title: 'Controles de planta de envasado', desc: 'Higiene, limpieza, plagas, cloro residual y demás controles SIG', icon: 'shield' },
  { path: '/reportes', title: 'Reportes', desc: 'Visualiza estadísticas y trazabilidad completa', icon: 'chart' },
  { path: '/catalogos', title: 'Catálogos', desc: 'Clientes, marcas, productos y demás catálogos del sistema', icon: 'database' },
]

// Igual que en Layout.jsx: el link a Usuarios solo se muestra a admin_web.
const adminMenuItems = [
  { path: '/usuarios', title: 'Usuarios', desc: 'Administra las cuentas y roles de los usuarios del sistema', icon: 'users' },
]

function fechaHoy() {
  const s = new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function DashboardPage() {
  const COOPERATIVE = useCooperative()
  const webUser = useAuthStore((s) => s.webUser)
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase
        .from('plant_orders')
        .select('status, total_kg')
        .eq('cooperative_id', COOPERATIVE.id),
      fetchStockSummary(COOPERATIVE),
    ]).then(([{ data }, stock]) => {
      if (cancelled) return
      const rows = data ?? []
      const enProceso = rows.filter(r => r.status === 'en_proceso')
      setStats({
        ordenesEnProceso: enProceso.length,
        kgEnProceso: enProceso.reduce((s, r) => s + Number(r.total_kg ?? 0), 0),
        ordenesCompletadas: rows.filter(r => r.status === 'completado').length,
        materiaPrimaKg: stock.materiaPrimaKg,
        productoTerminadoKg: stock.productoTerminadoKg,
      })
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e.message ?? 'Error al cargar el resumen')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const kpis = stats ? [
    { tone: 'blue', label: 'Órdenes en producción', value: stats.ordenesEnProceso },
    { tone: 'blue', label: 'Kg en proceso', value: stats.kgEnProceso.toLocaleString('es-PE', { maximumFractionDigits: 0 }) },
    { tone: 'blue', label: 'Órdenes completadas', value: stats.ordenesCompletadas },
    { tone: 'white', label: 'Materia prima disponible (kg)', value: stats.materiaPrimaKg != null ? stats.materiaPrimaKg.toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—' },
    { tone: 'white', label: 'Producto terminado disponible (kg)', value: stats.productoTerminadoKg != null ? stats.productoTerminadoKg.toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—' },
  ] : []

  const allMenuItems = [...menuItems, ...(webUser?.role === 'admin_web' ? adminMenuItems : [])]

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>Bienvenido, {webUser?.first_name}</h2>
      <p className="muted small" style={{ margin: '0 0 10px' }}>{fechaHoy()}</p>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {loading ? (
          [0, 1, 2, 3, 4].map(i => (
            <div key={i} className="kpi-card">
              <Skeleton width="60%" height={12} />
              <Skeleton width="45%" height={28} />
            </div>
          ))
        ) : stats ? (
          kpis.map(k => (
            <div key={k.label} className={`kpi-card ${k.tone !== 'white' ? k.tone : ''}`}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))
        ) : (
          <p style={{ color: 'var(--danger)', margin: 0, gridColumn: '1 / -1' }}>{error}</p>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17 }}>Acceso rápido</h3>
        </div>
        <span className="muted small">{allMenuItems.length} módulos</span>
      </div>

      <div className="module-grid">
        {allMenuItems.map((item, idx) => (
          <div
            key={item.path}
            className="module-card"
            onClick={() => navigate(item.path)}
          >
            <div className="module-top">
              <span className="module-number">{String(idx + 1).padStart(2, '0')}</span>
              <span className="module-icon">{ICONS[item.icon]}</span>
            </div>
            <strong className="module-title">{item.title}</strong>
            <p className="module-desc">{item.desc}</p>
            <span className="module-open">Abrir →</span>
          </div>
        ))}
      </div>
    </div>
  )
}
