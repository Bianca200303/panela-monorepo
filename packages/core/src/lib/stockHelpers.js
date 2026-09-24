import { supabase } from './supabase'
import { loadKgPerQuintal } from './formConfig'

// cooperative como primer parámetro en las 3 funciones de este archivo
// (antes leían COOPERATIVE del módulo lib/config, que ya no existe en
// core) -- los call sites (páginas que usan useCooperative()) lo inyectan.

// Materia prima disponible: mismo dato que "Stock de lotes origen"
// (Órdenes/Bunques), acá solo se pide el total en vez de la tabla lote por
// lote -- kg_available ya viene calculado por la vista (recibido - usado en
// homogenizado - rechazado).
export async function fetchMateriaPrimaDisponibleKg(cooperative) {
  const { data, error } = await supabase
    .from('v_plant_available_stock')
    .select('kg_available')
    .eq('cooperative_id', cooperative.id)
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((s, r) => s + Number(r.kg_available ?? 0), 0)
}

// Producto terminado disponible: lotes ya envasados menos lo ya despachado
// (ver v_plant_finished_stock). envasado_qq se guarda en quintales -- se
// convierte a kg acá con el factor configurado, no viene ya en kg.
export async function fetchProductoTerminadoDisponibleKg(cooperative) {
  const [{ data, error }, kgPerQuintal] = await Promise.all([
    supabase
      .from('v_plant_finished_stock')
      .select('envasado_qq, kg_despachado')
      .eq('cooperative_id', cooperative.id),
    loadKgPerQuintal(cooperative),
  ])
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((s, r) => {
    const kgEnvasado = Number(r.envasado_qq ?? 0) * kgPerQuintal
    return s + Math.max(0, kgEnvasado - Number(r.kg_despachado ?? 0))
  }, 0)
}

// Ambos stocks juntos, para las pantallas que muestran los dos totales
// (Inicio, Reportes) -- una sola función para no repetir el Promise.all en
// cada pantalla. Usa allSettled a propósito: son dos fuentes independientes
// (v_plant_available_stock ya existe; v_plant_finished_stock es la vista
// nueva de esta migración) -- si una todavía no está aplicada en la base,
// no tiene que tirar abajo la otra ni el resto de la pantalla que la usa.
// Cada valor sale en null si su consulta falló, nunca lanza.
export async function fetchStockSummary(cooperative) {
  const [mp, pt] = await Promise.allSettled([
    fetchMateriaPrimaDisponibleKg(cooperative),
    fetchProductoTerminadoDisponibleKg(cooperative),
  ])
  if (mp.status === 'rejected') console.error('Materia prima disponible:', mp.reason)
  if (pt.status === 'rejected') console.error('Producto terminado disponible:', pt.reason)
  return {
    materiaPrimaKg: mp.status === 'fulfilled' ? mp.value : null,
    productoTerminadoKg: pt.status === 'fulfilled' ? pt.value : null,
  }
}
