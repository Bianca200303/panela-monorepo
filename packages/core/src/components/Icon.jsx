// Set mínimo de iconos SVG con trazo unificado (stroke, tamaño, peso),
// para reemplazar los glifos tipográficos sueltos (✓ ✗ ▼ ▲ ○ ⚠) que convivían
// con pesos visuales distintos según la fuente del sistema operativo.
// Agregar un ícono nuevo = sumar una entrada al mapa, no crear otro archivo.
const PATHS = {
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M18 15l-6-6-6 6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  x: <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>,
  circle: <circle cx="12" cy="12" r="9" />,
  alertTriangle: <>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>,
  inbox: <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  calendar: <>
    <rect x="3" y="4" width="18" height="18" rx="3" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </>,
  users: <>
    <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
    <circle cx="17.5" cy="9" r="2.6" /><path d="M15 20.3c.3-2.7 2.3-4.7 4.9-5.1" />
  </>,
  truck: <>
    <path d="M2 8h11v9H2z" /><path d="M13 11h4l4 4v2h-8z" />
    <circle cx="7" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" />
  </>,
  clipboardCheck: <>
    <rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V2h6v2" /><path d="M9 11l2 2 4-4" />
  </>,
  droplet: <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />,
  thermometer: <>
    <path d="M12 2a2 2 0 0 0-2 2v9.17a4 4 0 1 0 4 0V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
  </>,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z" />,
  bug: <>
    <rect x="8" y="8" width="8" height="10" rx="4" />
    <path d="M12 8V4" /><path d="M9 4h6" />
    <path d="M5 11h3M16 11h3" /><path d="M5 16h3M16 16h3" /><path d="M8 13h8" />
  </>,
  heartPulse: <>
    <path d="M20 8.5c0-2.5-2-4.5-4.5-4.5-1.5 0-2.8.7-3.5 1.8-.7-1.1-2-1.8-3.5-1.8C6 4 4 6 4 8.5c0 4.5 8 10.5 8 10.5s8-6 8-10.5Z" />
    <path d="M4.5 11h3l1.5-3 2 5 1.5-3h4" />
  </>,
  spray: <>
    <path d="M9 3h4v3H9z" /><path d="M8 6h6l1 15H7Z" />
    <path d="M15 8l3-2" /><path d="M16 10h3" /><path d="M15 12l3 2" />
  </>,
  messageAlert: <>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
}

export default function Icon({ name, size = 16, style, ...rest }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
      {...rest}
    >
      {path}
    </svg>
  )
}
