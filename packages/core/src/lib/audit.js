// Columnas de trazabilidad que la BD llena en todas las tablas (quién y
// cuándo creó / modificó por última vez el registro). Agregarlas al select de
// los registros que muestran <AuditStamp row={...} />.
export const AUDIT_COLUMNS = 'audit_created_by_name, audit_created_at, audit_updated_by_name, audit_updated_at'
