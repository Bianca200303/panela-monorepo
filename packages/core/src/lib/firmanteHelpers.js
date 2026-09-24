import { supabase } from './supabase'

// Resuelve firmantes automáticos a partir de los user_id que registraron los
// controles (tabla `users`, personal de campo). Cargo por rol: admin de
// módulo o técnico de campo -- usado igual en los 9 formatos periódicos.
// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- el call site
// (useFormatoPeriodoAgregado.js) lo inyecta desde useCooperative().
export async function resolveFirmantesFromUserIds(cooperative, userIds) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))]
  if (!ids.length) return []
  const { data: users } = await supabase
    .from('users')
    .select('user_id, first_name, last_name, role')
    .in('user_id', ids)
    .eq('cooperative_id', cooperative.id)
  return (users ?? []).map((u, i) => ({
    nombre: `${u.first_name} ${u.last_name}`,
    cargo: u.role === 'admin_modulo' ? 'Administrador de Módulo' : 'Técnico de Campo',
    orden: i + 1,
    fuente: 'auto',
  }))
}
