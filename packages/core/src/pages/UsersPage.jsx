import { useState, useEffect } from 'react'
import ClearableInput from '../components/ClearableInput'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useCooperative } from '../lib/cooperativeContext'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import AuditStamp from '../components/AuditStamp'
import { AUDIT_COLUMNS } from '../lib/audit'
import ErrorState from '../components/ErrorState'
import { toast } from '../lib/toast'

const ROLE_LABELS = {
  admin_web: 'Administrador',
  operador: 'Operador',
}

const STATUS_FILTERS = [['todos', 'Todos'], ['activos', 'Activos'], ['inactivos', 'Inactivos']]

const emptyCreateForm = { username: '', firstName: '', lastName: '', password: '', role: 'operador' }

// El servidor guarda el usuario en minúsculas y sin espacios (ver handleCreate).
const normalizeUsername = (value) => value.trim().toLowerCase()

const fullName = (u) => `${u.first_name} ${u.last_name}`.trim()
const initials = (u) => `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase() || '?'

export default function UsersPage() {
  const COOPERATIVE_ID = useCooperative().id
  const currentUser = useAuthStore((s) => s.webUser)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [roleFilter, setRoleFilter] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyCreateForm)
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  // Edición: solo nombre, apellidos y rol. El usuario (login) no se cambia
  // porque es con lo que la persona ingresa.
  const [editing, setEditing] = useState(null) // fila de web_users, o null
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', role: 'operador' })
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => { loadUsers() }, [])

  const loadUsers = async () => {
    const { data, error } = await supabase
      .from('web_users')
      .select(`id, username, first_name, last_name, role, is_active, created_at, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE_ID)
      .order('first_name')
    setLoadError(error ? error.message : '')
    if (!error) setUsers(data ?? [])
    setLoading(false)
  }

  const closeCreate = () => { setShowCreate(false); setFormError(''); setForm(emptyCreateForm) }

  const handleCreate = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!form.username.trim() || !form.firstName.trim() || !form.lastName.trim() || !form.password) {
      setFormError('Todos los campos son obligatorios')
      return
    }
    if (form.password.length < 6) {
      setFormError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (duplicateUser) {
      setFormError(`El usuario "${duplicateUser.username}" ya existe`)
      return
    }
    setCreating(true)
    try {
      const { data, error } = await supabase.functions.invoke('register-web-user', {
        body: {
          username: normalizeUsername(form.username),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          cooperativeId: COOPERATIVE_ID,
        },
      })
      if (error) {
        // Con una respuesta 4xx (usuario duplicado, sin permiso...) el
        // servidor manda el motivo en el cuerpo; antes se mostraba siempre
        // "Error de conexión". Mismo criterio que signIn en authStore.js.
        let message = 'Error de conexión'
        try {
          const body = await error.context?.json?.()
          if (body?.error) message = body.error
        } catch {
          // fallback al mensaje genérico
        }
        throw new Error(message)
      }
      if (data?.error) throw new Error(data.error)
      toast.success('Usuario creado', `${form.firstName.trim()} ${form.lastName.trim()} ya puede ingresar con "${normalizeUsername(form.username)}".`)
      closeCreate()
      loadUsers()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (user) => {
    setEditError('')
    setEditing(user)
    setEditForm({ firstName: user.first_name ?? '', lastName: user.last_name ?? '', role: user.role })
  }

  const handleSaveEdit = async () => {
    setEditError('')
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      setEditError('Nombres y apellidos son obligatorios')
      return
    }
    const isSelf = editing.id === currentUser?.id
    setSavingEdit(true)
    try {
      const payload = { first_name: editForm.firstName.trim(), last_name: editForm.lastName.trim() }
      // El propio rol no se cambia desde aquí: un administrador podría
      // quitarse el acceso a esta misma pantalla sin querer.
      if (!isSelf) payload.role = editForm.role
      const { data, error } = await supabase.from('web_users').update(payload).eq('id', editing.id).select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) throw new Error('No tiene permiso para modificar este usuario.')
      // El nombre del encabezado sale del store, no de la tabla.
      if (isSelf) {
        useAuthStore.setState(s => ({ webUser: { ...s.webUser, first_name: payload.first_name, last_name: payload.last_name } }))
      }
      setEditing(null)
      toast.success('Usuario actualizado')
      loadUsers()
    } catch (err) {
      setEditError(err.message)
    } finally {
      setSavingEdit(false)
    }
  }

  // `.select('id')`: si RLS bloquea el UPDATE no hay error, solo 0 filas --
  // antes el botón no hacía nada y no se avisaba.
  const toggleActive = async (user) => {
    setActionError('')
    if (user.is_active) {
      const ok = await confirm({
        title: 'Desactivar usuario',
        message: `¿Seguro que desea desactivar a ${fullName(user)}? Ya no podrá ingresar al sistema hasta que se vuelva a activar.`,
        confirmText: 'Desactivar',
        danger: true,
      })
      if (!ok) return
    }
    const verb = user.is_active ? 'desactivar' : 'activar'
    const { data, error } = await supabase
      .from('web_users')
      .update({ is_active: !user.is_active })
      .eq('id', user.id)
      .select('id')
    if (error) {
      setActionError(`No se pudo ${verb} a ${fullName(user)}: ${error.message}`)
      return
    }
    if (!data?.length) {
      setActionError(`No se pudo ${verb} a ${fullName(user)}: no tiene permiso para modificar usuarios.`)
      return
    }
    toast.success(user.is_active ? `${fullName(user)} fue desactivado` : `${fullName(user)} fue activado`)
    loadUsers()
  }

  // Aviso inmediato en el formulario, sin esperar al servidor (que igual lo
  // rechaza). La lista incluye inactivos: un usuario dado de baja sigue
  // ocupando su nombre de usuario.
  const typedUsername = normalizeUsername(form.username)
  const duplicateUser = typedUsername ? users.find(u => u.username?.toLowerCase() === typedUsername) : null

  const reactivateDuplicate = async () => {
    const user = duplicateUser
    closeCreate()
    await toggleActive(user)
  }

  const activeCount = users.filter(u => u.is_active).length
  const adminCount = users.filter(u => u.is_active && u.role === 'admin_web').length

  const query = search.trim().toLowerCase()
  const visibleUsers = users
    .filter(u => statusFilter === 'todos' || (statusFilter === 'activos') === u.is_active)
    .filter(u => !roleFilter || u.role === roleFilter)
    .filter(u => !query || [fullName(u), u.username].some(f => f?.toLowerCase().includes(query)))
    // Activos primero; dentro de cada grupo se respeta el orden por nombre.
    .sort((a, b) => Number(b.is_active) - Number(a.is_active))

  return (
    <div>
      <div className="catalog-header" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <h2 style={{ margin: 0 }}>Usuarios</h2>
        <button className="btn small primary catalog-new-btn" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={14} />Nuevo usuario
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi-card blue">
          <div className="kpi-top"><span className="kpi-label">Usuarios</span><Icon name="users" size={18} className="kpi-icon" /></div>
          <span className="kpi-value">{users.length}</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">Activos</span><Icon name="check" size={18} style={{ color: 'var(--success)' }} /></div>
          <span className="kpi-value">{activeCount}</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">Inactivos</span><Icon name="x" size={18} style={{ color: 'var(--warning)' }} /></div>
          <span className="kpi-value">{users.length - activeCount}</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">Administradores</span><Icon name="badgeCheck" size={18} style={{ color: 'var(--primary)' }} /></div>
          <span className="kpi-value">{adminCount}</span>
        </div>
      </div>

      <div className="card">
        <div className="catalog-toolbar">
          <div className="catalog-search">
            <Icon name="search" size={16} />
            <ClearableInput placeholder="Buscar por nombre o usuario" value={search} onChange={e => setSearch(e.target.value)} onClear={() => setSearch('')} />
          </div>
          <div className="segmented" role="group" aria-label="Estado">
            {STATUS_FILTERS.map(([key, label]) => (
              <button key={key} className={statusFilter === key ? 'active' : ''} aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <select className="input" style={{ maxWidth: 200 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">Todos los roles</option>
            {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        {loadError && <ErrorState message="No se pudo cargar la lista de usuarios. Revise la conexión e intente de nuevo." onRetry={loadUsers} />}
        {actionError && (
          <div className="catalog-error">
            <Icon name="alertTriangle" size={16} />
            <span style={{ flex: 1 }}>{actionError}</span>
            <button className="btn small danger" onClick={() => setActionError('')}>Cerrar</button>
          </div>
        )}

        {loading ? (
          <SkeletonList count={3} lines={1} />
        ) : visibleUsers.length === 0 ? (
          loadError ? null : users.length === 0
            ? <EmptyState message="Todavía no hay usuarios registrados." action={{ label: 'Nuevo usuario', onClick: () => setShowCreate(true) }} />
            : <EmptyState icon="search" message="No hay usuarios que coincidan con la búsqueda o los filtros." />
        ) : (
          <div className="catalog-list">
            {visibleUsers.map(u => {
              const isSelf = u.id === currentUser?.id
              return (
                <div key={u.id} className={`catalog-row${u.is_active ? '' : ' inactive'}`}>
                  <div className="user-row-main">
                    <span className={`user-avatar${u.role === 'admin_web' ? ' admin' : ''}`}>{initials(u)}</span>
                    <div className="catalog-row-main">
                      <div className="catalog-row-title">
                        <strong>{fullName(u)}</strong>
                        <span className="tag info">{ROLE_LABELS[u.role] ?? u.role}</span>
                        {isSelf && <span className="tag">Usted</span>}
                        {!u.is_active && <span className="tag warn">Inactivo</span>}
                        <AuditStamp row={u} />
                      </div>
                      <div className="muted small">Usuario: {u.username}</div>
                    </div>
                  </div>
                  <div className="catalog-row-actions">
                    <button className="btn small primary" onClick={() => openEdit(u)}>Editar</button>
                    {!isSelf && (
                      <button className={`btn small ${u.is_active ? 'danger primary' : 'primary'}`} onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal: Nuevo usuario ── */}
      {showCreate && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleCreate}>
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nuevo usuario</h3>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nombres *</label>
                  <input type="text" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Apellidos *</label>
                  <input type="text" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Usuario *</label>
                  <input
                    type="text" placeholder="Ej: jperez" autoComplete="off"
                    value={form.username}
                    style={duplicateUser ? { borderColor: 'var(--danger)' } : undefined}
                    onChange={e => setForm({ ...form, username: e.target.value })}
                  />
                  {duplicateUser && (
                    <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0 0' }}>
                      {duplicateUser.is_active
                        ? `Ya existe: ${fullName(duplicateUser)}.`
                        : <>Pertenece a {fullName(duplicateUser)}, que está inactivo. <button type="button" className="link-button" onClick={reactivateDuplicate}>Activarlo</button></>}
                    </p>
                  )}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Contraseña *</label>
                  <input type="password" placeholder="Mínimo 6 caracteres" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Rol</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                    <option value="operador">Operador</option>
                    <option value="admin_web">Administrador</option>
                  </select>
                </div>
              </div>
              {formError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '8px 0 0' }}>{formError}</p>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn small" onClick={closeCreate} disabled={creating}>Cancelar</button>
              <button type="submit" className="btn small primary" disabled={creating || Boolean(duplicateUser)}>
                {creating ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal: Editar usuario ── */}
      {editing && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 4px' }}>Editar usuario</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>Usuario: {editing.username}</p>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nombres *</label>
                  <input type="text" value={editForm.firstName} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Apellidos *</label>
                  <input type="text" value={editForm.lastName} onChange={e => setEditForm({ ...editForm, lastName: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Rol</label>
                  <select
                    value={editForm.role}
                    disabled={editing.id === currentUser?.id}
                    onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                  >
                    <option value="operador">Operador</option>
                    <option value="admin_web">Administrador</option>
                  </select>
                </div>
              </div>
              <p className="muted small" style={{ margin: '8px 0 0' }}>
                {editing.id === currentUser?.id
                  ? 'No puede cambiar su propio rol.'
                  : 'El cambio de rol se aplica la próxima vez que el usuario inicie sesión.'}
              </p>
              {editError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '8px 0 0' }}>{editError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => setEditing(null)} disabled={savingEdit}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  )
}
