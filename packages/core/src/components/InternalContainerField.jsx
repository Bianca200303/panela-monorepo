import { supabase } from '../lib/supabase'
import InlineEditField from './InlineEditField'

// "Contenedor N°" (plant_orders.internal_container_number) editable en línea
// desde Embarque. Es opcional y normalmente se conoce casi al final, cuando la
// orden ya está completada y "Editar orden" no está disponible -- por eso se
// puede registrar o corregir aquí en cualquier momento. Los documentos lo
// toman de la orden al generarse, así que basta con volver a descargarlos.
//
// UPDATE directo sobre la orden existente (por su id): nunca crea filas.
export default function InternalContainerField({ order, onSaved }) {
  const save = async (value) => {
    const { error } = await supabase
      .from('plant_orders')
      .update({ internal_container_number: value || null })
      .eq('id', order.id)
    if (error) throw new Error(error.message)
    onSaved?.()
  }

  return (
    <InlineEditField
      label="Contenedor N°"
      value={order.internal_container_number}
      placeholder="Contenedor N° (opcional)"
      onSave={save}
    />
  )
}
