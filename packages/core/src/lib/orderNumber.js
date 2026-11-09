import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Validación de "Número de orden de producción" (plant_orders.client_order_number):
// no puede repetirse dentro de la cooperativa. Se compara sin distinguir
// mayúsculas/minúsculas ni espacios al inicio/final, igual que el índice
// único de la BD (uq_plant_orders_coop_client_order_number), que es la
// garantía final si dos personas guardan a la vez.

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export const duplicateOrderNumberMessage = (number) =>
  `Ya existe una orden con el número "${String(number).trim()}". Use otro número.`

// Devuelve el mensaje de error si `number` ya lo tiene otra orden de la
// cooperativa (sin contar `excludeOrderId`, la propia orden al editar), o
// null si está libre. Número vacío = no se valida (es opcional).
export async function checkDuplicateOrderNumber({ cooperativeId, number, excludeOrderId = null }) {
  const wanted = normalize(number)
  if (!wanted) return null
  const { data, error } = await supabase
    .from('plant_orders')
    .select('id, client_order_number')
    .eq('cooperative_id', cooperativeId)
    .not('client_order_number', 'is', null)
  if (error) throw new Error(error.message)
  const taken = (data ?? []).some(o => o.id !== excludeOrderId && normalize(o.client_order_number) === wanted)
  return taken ? duplicateOrderNumberMessage(number) : null
}

// Traduce el error de la BD por el índice único a un mensaje legible.
export function orderSaveErrorMessage(err, number) {
  const msg = err?.message ?? String(err)
  if (err?.code === '23505' || msg.includes('uq_plant_orders_coop_client_order_number')) {
    return duplicateOrderNumberMessage(number)
  }
  return msg
}

// Revisa el número mientras se escribe (con una pequeña espera) para mostrar
// el aviso directo debajo del campo, sin esperar a "Guardar". Devuelve
// [mensaje | null, setMensaje] -- setMensaje sirve para que el guardado
// muestre ahí mismo un duplicado detectado a último momento.
export function useDuplicateOrderNumber({ cooperativeId, number, excludeOrderId = null, enabled = true }) {
  const [result, setResult] = useState({ key: null, message: null })
  const key = enabled ? `${normalize(number)}|${excludeOrderId ?? ''}` : null
  useEffect(() => {
    if (!enabled || !normalize(number)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const message = await checkDuplicateOrderNumber({ cooperativeId, number, excludeOrderId })
        if (!cancelled) setResult({ key, message })
      } catch {
        // Sin conexión u otro error: la validación al guardar lo vuelve a revisar.
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [cooperativeId, number, excludeOrderId, enabled, key])
  const message = key && result.key === key ? result.message : null
  const setMessage = (msg) => setResult({ key, message: msg })
  return [message, setMessage]
}
