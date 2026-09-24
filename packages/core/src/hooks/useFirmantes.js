import { useState } from 'react'

// CRUD de la lista de firmantes de un documento (detectados automáticamente
// o agregados a mano) que se edita antes de emitir.
export function useFirmantes(initial = []) {
  const [firmantes, setFirmantes] = useState(initial)

  const addFirmante    = () => setFirmantes(prev => [...prev, { nombre: '', cargo: '', orden: prev.length + 1, fuente: 'manual' }])
  const removeFirmante = i => setFirmantes(prev => prev.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, orden: idx + 1 })))
  const updateFirmante = (i, field, v) => setFirmantes(prev => prev.map((x, idx) => idx === i ? { ...x, [field]: v } : x))

  return { firmantes, setFirmantes, addFirmante, removeFirmante, updateFirmante }
}
