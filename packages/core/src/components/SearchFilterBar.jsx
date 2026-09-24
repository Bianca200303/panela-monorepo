import Icon from './Icon'
import DateInput from './DateInput'

// Barra de búsqueda + filtros reutilizable -- usada en Recepción, Calidad y
// Órdenes (antes cada pantalla repetía su propio bloque de filtros a mano).
// El rango de fechas y los chips rápidos son opcionales: si no se pasan
// `dateFrom`/`onDateFromChange`, la barra queda solo con el buscador (caso
// de Órdenes, donde no hay filtro de fecha).
export default function SearchFilterBar({
  search, onSearchChange, searchPlaceholder = 'Buscar...',
  dateFrom, onDateFromChange, dateTo, onDateToChange,
  quickRanges, activeRange, onQuickRange,
  filtersActive, onClear,
  style,
}) {
  const hasDateRange = onDateFromChange != null

  return (
    <div className="search-bar" style={style}>
      <div className="search-input-wrap">
        <label>Buscar</label>
        <Icon name="search" size={15} className="search-icon" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>

      {hasDateRange && (
        <>
          <div className="search-date-wrap">
            <label>Desde</label>
            <DateInput value={dateFrom} onChange={e => onDateFromChange(e.target.value)} />
          </div>
          <div className="search-date-wrap">
            <label>Hasta</label>
            <DateInput value={dateTo} onChange={e => onDateToChange(e.target.value)} />
          </div>
        </>
      )}

      {quickRanges && (
        <div className="search-quick-chips">
          {quickRanges.map(({ days, label }) => (
            <button
              key={label}
              className={`btn small ${activeRange === days ? 'primary' : 'outline'}`}
              onClick={() => onQuickRange(days)}
            >
              {label}
            </button>
          ))}
          {filtersActive && (
            <button className="btn small" onClick={onClear}>Limpiar</button>
          )}
        </div>
      )}
    </div>
  )
}
