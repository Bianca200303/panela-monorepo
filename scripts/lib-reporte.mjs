// Piezas comunes de los reportes internos (reporte-uso, reporte-bitacora):
// conexión con service role desde web-react/.env.reporte, argumentos y hojas
// de Excel.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function fail(message) {
  console.error(message)
  process.exit(1)
}

// Cliente con service role: las funciones de los reportes no las puede
// ejecutar ningún usuario de la web ni del celular.
export function serviceClient() {
  const file = path.join(ROOT, '.env.reporte')
  if (!fs.existsSync(file)) fail(`Falta ${file} con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.`)
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) fail('.env.reporte debe tener SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.')
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  return {
    async rpc(fn, params = {}) {
      const { data, error } = await client.rpc(fn, params)
      if (error) fail(`Error en ${fn}: ${error.message}`)
      return data ?? []
    },
  }
}

// --opcion valor | --opcion=valor. `repeatable` acumula en un arreglo.
// --desde/--hasta se validan como AAAA-MM-DD.
export function readArgs(allowed, repeatable = []) {
  const args = Object.fromEntries(allowed.map(k => [k, repeatable.includes(k) ? [] : null]))
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=')
    const key = flag.replace(/^--/, '')
    if (!flag.startsWith('--') || !allowed.includes(key)) fail(`Opción desconocida: ${argv[i]}. Opciones: ${allowed.map(k => `--${k}`).join(', ')}`)
    const value = inline ?? argv[++i]
    if (!value) fail(`Falta el valor de ${flag}`)
    if (repeatable.includes(key)) args[key].push(value)
    else args[key] = value
  }
  for (const k of ['desde', 'hasta']) {
    if (args[k] && !/^\d{4}-\d{2}-\d{2}$/.test(args[k])) fail(`--${k} debe tener el formato AAAA-MM-DD`)
  }
  return args
}

export const PLATAFORMA = { web: 'Web', movil: 'Celular', sistema: 'Sistema' }

export const fecha = (ts) => ts
  ? new Date(ts).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })
  : ''

// columns: [clave, encabezado, formateador?]
export function sheet(rows, columns) {
  const data = rows.map(r => Object.fromEntries(columns.map(([key, header, fmt]) => [header, fmt ? fmt(r[key], r) : r[key]])))
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map(c => c[1]) })
  ws['!cols'] = columns.map(([, header]) => ({
    wch: Math.min(60, Math.max(header.length, ...data.map(d => String(d[header] ?? '').length)) + 2),
  }))
  ws['!autofilter'] = { ref: ws['!ref'] }
  return ws
}

export function newBook() {
  return XLSX.utils.book_new()
}

export function addSheet(wb, ws, name) {
  XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, '').replace(/\s+/g, ' ').trim().slice(0, 31))
}

export function saveBook(wb, fileName) {
  const outDir = path.join(ROOT, 'reportes-uso')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, fileName)
  XLSX.writeFile(wb, outFile)
  console.log(`Reporte generado: ${outFile}`)
}
