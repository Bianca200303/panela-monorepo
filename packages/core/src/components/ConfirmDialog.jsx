export default function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <div className="modal-body">
          {title && <h3 style={{ margin: '0 0 8px' }}>{title}</h3>}
          {message && (
            <p style={{ margin: 0, whiteSpace: 'pre-line', fontSize: 14, color: 'var(--text)' }}>
              {message}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onCancel}>{cancelText}</button>
          <button
            className={`btn small primary${danger ? ' danger' : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
