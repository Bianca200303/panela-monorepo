import { create } from 'zustand'

// Avisos breves de resultado ("Cliente guardado", "No se pudo guardar...").
// Antes las acciones terminaban en silencio: el modal se cerraba y el
// usuario tenía que adivinar si se guardó. Se usa fuera de React también:
//   import { toast } from '../lib/toast'
//   toast.success('Cliente guardado')
//   toast.error('No se pudo guardar el cliente', err.message)
// El contenedor que los dibuja es <Toaster /> (Layout.jsx).

let nextId = 1

export const useToastStore = create((set) => ({
  toasts: [],
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  push: (toast) => set(s => ({ toasts: [...s.toasts.slice(-3), toast] })),
}))

function show(type, title, detail) {
  const id = nextId++
  useToastStore.getState().push({ id, type, title, detail })
  // Los errores quedan más tiempo: suelen traer un detalle para leer.
  setTimeout(() => useToastStore.getState().dismiss(id), type === 'error' ? 7000 : 3500)
  return id
}

export const toast = {
  success: (title, detail) => show('success', title, detail),
  error: (title, detail) => show('error', title, detail),
  info: (title, detail) => show('info', title, detail),
}
