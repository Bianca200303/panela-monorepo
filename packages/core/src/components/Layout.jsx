import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { getBunqueLabelPlural } from '../lib/labels'

export default function Layout() {
  const COOPERATIVE = useCooperative()
  const BUNQUE_LABEL_PLURAL = getBunqueLabelPlural(COOPERATIVE)
  const { webUser, signOut } = useAuthStore()
  const navigate = useNavigate()
  const { confirm, dialog: confirmDialog } = useConfirm()

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
            <li><NavLink to="/embarque" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Embarque</NavLink></li>
            <li><NavLink to="/controles" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Controles</NavLink></li>
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

      <main className="container">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span className="small">Sistema de trazabilidad · {coopName}</span>
      </footer>

      {confirmDialog}
    </>
  )
}
