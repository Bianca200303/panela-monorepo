import DateInput from './DateInput'

/**
 * DynamicForm — Renderiza campos de formulario basados en configuración JSONB.
 *
 * Soporta tipos: text, number, select, date, checkbox, textarea
 *
 * Props:
 *   fields    - Array de field definitions [{key, label, type, required, options, min, max, default, order}]
 *   values    - Object con valores actuales { [key]: value }
 *   onChange  - (key, value) => void
 *   columns   - Columnas del grid (default: 2)
 *   disabled  - Deshabilitar todos los campos
 */
export default function DynamicForm({ fields, values, onChange, columns = 2, disabled = false }) {
  if (!fields || fields.length === 0) return null

  const gridClass = columns === 3 ? 'grid three' : columns === 1 ? '' : 'grid two'

  return (
    <div className={gridClass} style={{ gap: 8 }}>
      {fields.map(field => (
        <DynamicField
          key={field.key}
          field={field}
          value={values[field.key] ?? field.default ?? ''}
          onChange={(val) => onChange(field.key, val)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function DynamicField({ field, value, onChange, disabled }) {
  const { key, label, type, required, options, min, max } = field

  const renderInput = () => {
    switch (type) {
      case 'select':
        return (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            required={required}
          >
            <option value="">— Seleccionar —</option>
            {(options || []).map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            required={required}
            min={min}
            max={max}
            step="any"
          />
        )

      case 'date':
        return (
          <DateInput
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        )

      case 'checkbox':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
              style={{ width: 'auto', margin: 0 }}
            />
            <span style={{ fontSize: 14 }}>{label}</span>
          </label>
        )

      case 'textarea':
        return (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            required={required}
            rows={3}
            placeholder={required ? '' : 'Opcional'}
          />
        )

      default: // text
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            required={required}
            placeholder={required ? '' : 'Opcional'}
          />
        )
    }
  }

  // Checkbox renders its own label inline
  if (type === 'checkbox') {
    return (
      <div className="field" style={{ margin: 0 }}>
        {renderInput()}
      </div>
    )
  }

  return (
    <div className="field" style={{ margin: 0, opacity: field._deprecated ? 0.6 : 1 }}>
      <label>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
        {field._deprecated && <span className="muted small" style={{ marginLeft: 4 }}>(campo anterior)</span>}
      </label>
      {renderInput()}
    </div>
  )
}

/**
 * Valida los valores contra las definiciones de campos.
 *
 * @param {Array} fields - Field definitions
 * @param {Object} values - Current values
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDynamicForm(fields, values) {
  const errors = []

  for (const field of fields) {
    const val = values[field.key]

    // Required check
    if (field.required) {
      if (val === undefined || val === null || val === '') {
        errors.push(`${field.label} es requerido`)
        continue
      }
    }

    // Skip further validation if empty and not required
    if (val === undefined || val === null || val === '') continue

    // Number range
    if (field.type === 'number') {
      const num = parseFloat(val)
      if (isNaN(num)) {
        errors.push(`${field.label} debe ser un número válido`)
      } else {
        if (field.min !== undefined && num < field.min) {
          errors.push(`${field.label} debe ser mayor o igual a ${field.min}`)
        }
        if (field.max !== undefined && num > field.max) {
          errors.push(`${field.label} debe ser menor o igual a ${field.max}`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Combina la config actual de campos con los datos de un registro histórico.
 *
 * Problema que resuelve: si un campo existía cuando se guardó el registro
 * pero luego fue eliminado de la config, ese dato no se perdería al visualizar.
 *
 * Retorna un array de fields que incluye:
 * 1. Todos los campos de la config actual (en su orden)
 * 2. Campos extra presentes en el registro pero ausentes en la config actual
 *    (se muestran como texto de solo lectura con el key como label)
 *
 * @param {Array} currentFields - Config actual de campos
 * @param {Object} recordData - Datos del registro guardado { key: value }
 * @param {Object} [options]
 * @param {string[]} [options.ignoreKeys] - Keys a ignorar (ej: ['id', 'created_at'])
 * @returns {Array} Fields combinados para renderizar
 */
export function mergeFieldsWithRecord(currentFields, recordData, { ignoreKeys = [] } = {}) {
  if (!recordData) return currentFields || []

  const currentKeys = new Set((currentFields || []).map(f => f.key))
  const ignore = new Set([
    'id', 'created_at', 'updated_at', 'cooperative_id',
    'created_by', 'evaluated_by', 'filled_by', 'filled_at',
    ...ignoreKeys,
  ])

  const extraFields = []
  const maxOrder = Math.max(0, ...(currentFields || []).map(f => f.order || 0))

  let orderOffset = 1
  for (const [key, value] of Object.entries(recordData)) {
    if (currentKeys.has(key) || ignore.has(key)) continue
    if (value === null || value === undefined) continue

    // Inferir tipo del valor
    const type = typeof value === 'boolean' ? 'checkbox' : 'text'

    extraFields.push({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type,
      required: false,
      order: maxOrder + orderOffset,
      _deprecated: true, // marca para UI (campo ya no vigente)
    })
    orderOffset++
  }

  return [...(currentFields || []), ...extraFields]
}

/**
 * Genera valores iniciales (defaults) a partir de las field definitions.
 *
 * @param {Array} fields
 * @returns {Object}
 */
export function getInitialValues(fields) {
  const values = {}
  for (const field of fields) {
    if (field.default !== undefined) {
      values[field.key] = field.default
    } else if (field.type === 'checkbox') {
      values[field.key] = false
    } else {
      values[field.key] = ''
    }
  }
  return values
}
