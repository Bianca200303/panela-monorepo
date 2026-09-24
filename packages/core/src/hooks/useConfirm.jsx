import { useState, useCallback } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'

// Uso:
//   const { confirm, dialog } = useConfirm()
//   const ok = await confirm({ title: '...', message: '...', danger: true })
//   if (!ok) return
//   ...
// Y en el JSX del componente: {dialog}
export function useConfirm() {
  const [request, setRequest] = useState(null) // { ...options, resolve }

  const confirm = useCallback((options) => {
    return new Promise(resolve => {
      setRequest({ ...options, resolve })
    })
  }, [])

  const handleConfirm = () => {
    request?.resolve(true)
    setRequest(null)
  }

  const handleCancel = () => {
    request?.resolve(false)
    setRequest(null)
  }

  const dialog = request ? (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmText={request.confirmText}
      cancelText={request.cancelText}
      danger={request.danger}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null

  return { confirm, dialog }
}
