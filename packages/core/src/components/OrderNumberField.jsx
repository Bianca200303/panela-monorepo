import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { checkDuplicateOrderNumber, orderSaveErrorMessage } from '../lib/orderNumber'
import InlineEditField from './InlineEditField'

// Muestra el número de orden de producción dado por el cliente
// (client_order_number). Si todavía no se registró, en vez de caer al
// código interno largo (ej. "OP-NORA-2026-004", que no significa nada para
// el cliente) muestra un aviso corto + botón para registrarlo ahí mismo.
// Una vez registrado se corrige solo desde "Editar orden".
//
// El guardado es un UPDATE directo sobre la orden ya existente (por su id)
// -- nunca crea una fila nueva en plant_orders ni vuelve a generar
// order_code. Valida que el número no lo tenga otra orden.
export default function OrderNumberField({ order, onSaved, prefix = 'Orden ' }) {
  const COOPERATIVE = useCooperative()

  if (order.client_order_number) {
    return <strong>{prefix}{order.client_order_number}</strong>
  }

  const save = async (number) => {
    if (!number) throw new Error('Ingrese un número')
    const dupMsg = await checkDuplicateOrderNumber({ cooperativeId: order.cooperative_id ?? COOPERATIVE.id, number, excludeOrderId: order.id })
    if (dupMsg) throw new Error(dupMsg)
    const { error } = await supabase.from('plant_orders').update({ client_order_number: number }).eq('id', order.id)
    if (error) throw new Error(orderSaveErrorMessage(error, number))
    onSaved?.()
  }

  return (
    <InlineEditField
      label="N° de orden de producción"
      value=""
      emptyText="SIN REGISTRAR"
      emptyButton="Registrar ahora"
      onSave={save}
    />
  )
}
