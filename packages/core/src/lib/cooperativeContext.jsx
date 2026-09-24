import { createContext, useContext } from 'react'

// packages/core ya no tiene un lib/config.js propio -- cada app (apps/caes,
// apps/norandino) define su propia cooperativa fija y envuelve su árbol con
// <CooperativeProvider cooperative={COOPERATIVE}> en su App.jsx. Los
// componentes/hooks de core que antes hacían `import { COOPERATIVE } from
// '../lib/config'` ahora usan useCooperative() -- mismo dato, distinta
// fuente (contexto de React en vez de un módulo con un solo valor fijo).
const CooperativeContext = createContext(null)

export function CooperativeProvider({ cooperative, children }) {
  return (
    <CooperativeContext.Provider value={cooperative}>
      {children}
    </CooperativeContext.Provider>
  )
}

export function useCooperative() {
  const cooperative = useContext(CooperativeContext)
  if (!cooperative) {
    throw new Error('useCooperative() usado fuera de <CooperativeProvider> -- envolvé el árbol en App.jsx de la app (caes/norandino).')
  }
  return cooperative
}
