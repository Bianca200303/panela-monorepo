// Placeholder de carga con shimmer, para reemplazar el texto plano
// "Cargando..." en pantallas con listas/cards de datos. `count` controla
// cuántas filas placeholder se repiten (para simular una lista).
export function Skeleton({ width = '100%', height = 14, style }) {
  return <span className="skeleton" style={{ width, height, ...style }} />
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="item">
      <Skeleton width="40%" height={16} style={{ marginBottom: 10 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '90%'} style={{ marginTop: 8 }} />
      ))}
    </div>
  )
}

export function SkeletonList({ count = 3, lines = 3 }) {
  return (
    <div className="list">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} lines={lines} />)}
    </div>
  )
}
