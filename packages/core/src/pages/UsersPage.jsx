import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useCooperative } from '../lib/cooperativeContext'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const ROLE_LABELS = {
  admin_web: 'Administrador',
  operador: 'Operador',
}

export default function UsersPage() {
  const COOPERATIVE_ID = useCooperative().id
  const currentUser = useAuthStore((s) => s.webUser)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ username: '', firstName: '', lastName: '', password: '', role: 'operador' })
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => { loadUsers() }, [])

  const loadUsers = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('web_users')
      .select('id, username, first_name, last_name, role, is_active, created_at')
      .eq('cooperative_id', COOPERATIVE_ID)
      .order('first_name')
    setUsers(data ?? [])
    setLoading(false)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!form.username || !form.firstName || !form.lastName || !form.password) {
      setFormError('Todos los campos son obligatorios')
      return
    }
    setCreating(true)
    try {
      const { data, error } = await supabase.functions.invoke('register-web-user', {
        body: {
          username: form.username.trim().toLowerCase(),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          cooperativeId: COOPERATIVE_ID,
        },
      })
      if (error) throw new Error('Error de conexión')
      if (data?.error) throw new Error(data.error)
      setForm({ username: '', firstName: '', lastName: '', password: '', role: 'operador' })
      setShowForm(false)
      loadUsers()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (user) => {
    await supabase
      .from('web_users')
      .update({ is_active: !user.is_active })
      .eq('id', user.id)
    loadUsers()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Gestión de usuarios</h2>
        {!showForm && (
          <button className="btn primary small" onClick={() => setShowForm(true)}>
            + Nuevo usuario
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Crear nuevo usuario</strong>
          <form onSubmit={handleCreate} style={{ marginTop: 12 }}>
            <div className="grid two" style={{ gap: 12 }}>
              <div className="field">
                <label>Usuario</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="ej: jperez"
                />
              </div>
              <div className="field">
                <label>Contraseña</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="mínimo 6 caracteres"
                />
              </div>
              <div className="field">
                <label>Nombres</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Apellidos</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Rol</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="operador">Operador</option>
                  <option value="admin_web">Administrador</option>
                </select>
              </div>
            </div>
            {formError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0 8px' }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="btn primary small" disabled={creating}>
                {creating ? 'Creando...' : 'Crear usuario'}
              </button>
              <button type="button" className="btn small" onClick={() => { setShowForm(false); setFormError('') }}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <SkeletonList count={3} lines={1} />
        ) : users.length === 0 ? (
          <EmptyState message="No hay usuarios registrados." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.first_name} {u.last_name}</td>
                  <td><span className="tag info">{ROLE_LABELS[u.role] ?? u.role}</span></td>
                  <td>
                    <span className={`tag ${u.is_active ? 'ok' : 'warn'}`}>
                      {u.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    {u.id !== currentUser?.id && (
                      <button className="btn small" onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
