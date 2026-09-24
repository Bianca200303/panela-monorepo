import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// server.fs.allow explícito: esta app sirve código fuente de
// packages/core (fuera de apps/norandino), y Vite en modo estricto bloquea
// archivos fuera de su root si no se declara -- ver Fase 0 del plan.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
})
