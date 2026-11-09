import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { getBunqueLabelPlural, getBunqueLabelPluralLower } from '../lib/labels'
import Icon from './Icon'
import Toaster from './Toaster'
import { trackScreen } from '../lib/usage'

export default function Layout() {
  const COOPERATIVE = useCooperative()
  const BUNQUE_LABEL_PLURAL = getBunqueLabelPlural(COOPERATIVE)
  const { webUser, signOut } = useAuthStore()
  const navigate = useNavigate()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const location = useLocation()

  // Aviso global si la cooperativa no tiene campaña activa: no bloquea nada,
  // pero sin campaña los bunques nuevos quedan sin campaña y no se
  // sugiere su numeración (ver BunquesPage.jsx). Se vuelve a consultar en cada
  // cambio de ruta, así desaparece al volver de Catálogos tras abrir una.
  const [hasActiveCampaign, setHasActiveCampaign] = useState(true)
  useEffect(() => {
    if (!webUser) return
    supabase
      .from('campaigns')
      .select('id')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('is_active', true)
      .limit(1)
      .then(({ data, error }) => {
        // Con error de red no se avisa: sería una falsa alarma.
        if (!error) setHasActiveCampaign(data.length > 0)
      })
  }, [webUser, COOPERATIVE.id, location.pathname, location.search])

  // Uso del sistema: una pantalla por ruta; las pestañas que viven en la URL
  // (?tab=) cuentan como pantallas propias, ej. /controles/cloro-residual.
  const screenTab = new URLSearchParams(location.search).get('tab')
  useEffect(() => {
    if (webUser?.id) trackScreen(screenTab ? `${location.pathname}/${screenTab}` : location.pathname)
  }, [webUser?.id, location.pathname, screenTab])

  const onCampaignsTab = location.pathname === '/catalogos' && new URLSearchParams(location.search).get('tab') === 'campanas'

  const handleSignOut = async () => {
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: '¿Seguro que desea salir? Va a tener que volver a iniciar sesión para continuar.',
      confirmText: 'Salir',
      danger: true,
    })
    if (!ok) return
    await signOut()
    navigate('/login')
  }

  const coopName = webUser?.cooperatives?.name ?? ''

  return (
    <>
      <header className="app-header">
        <div className="brand">
          {webUser?.cooperatives?.logo && (
            <img
              src={webUser.cooperatives.logo}
              alt={coopName}
              style={{ height: 32, width: 'auto' }}
              onError={e => { e.target.style.display = 'none' }}
            />
          )}
          <h1>Trazabilidad Panela</h1>
          <span className="tag info">{coopName}</span>
        </div>
        <nav className="top-nav">
          <ul>
            <li><NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Inicio</NavLink></li>
            <li><NavLink to="/recepcion" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Recepción</NavLink></li>
            <li><NavLink to="/calidad" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Calidad</NavLink></li>
            <li><NavLink to="/ordenes" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Órdenes</NavLink></li>
            <li><NavLink to="/bunques" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{BUNQUE_LABEL_PLURAL}</NavLink></li>
            <li><NavLink to="/controles" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Controles</NavLink></li>
            {/* Orden → Lote → Controles → Despacho/Embarque (venta nacional = despacho, exportación = embarque). */}
            <li><NavLink to="/embarque" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{COOPERATIVE?.features?.ventaNacionalExportacion ? 'Despacho / Embarque' : 'Embarque'}</NavLink></li>
            <li><NavLink to="/catalogos" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Catálogos</NavLink></li>
            <li><NavLink to="/reportes" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Reportes</NavLink></li>
            {webUser?.role === 'admin_web' && (
              <>
                <li><NavLink to="/cupos-produccion" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Cupos</NavLink></li>
                <li><NavLink to="/usuarios" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Usuarios</NavLink></li>
              </>
            )}
          </ul>
          <div className="session">
            <span className="small muted">{webUser?.first_name} {webUser?.last_name}</span>
            <button className="btn small danger primary" onClick={handleSignOut}>Salir</button>
          </div>
        </nav>
      </header>

      {!hasActiveCampaign && !onCampaignsTab && (
        <div className="campaign-alert" role="alert">
          <div className="campaign-alert-inner">
            <Icon name="alertTriangle" size={18} />
            <span className="campaign-alert-text">
              <strong>No hay una campaña activa.</strong> Los {getBunqueLabelPluralLower(COOPERATIVE)} que se registren quedarán sin campaña.
            </span>
            <button className="btn small warning" onClick={() => navigate('/catalogos?tab=campanas')}>
              Activar campaña
            </button>
          </div>
        </div>
      )}

      <main className="container">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span className="small">Sistema de trazabilidad · {coopName}</span>
      </footer>

      {confirmDialog}
      <Toaster />
    </>
  )
}
