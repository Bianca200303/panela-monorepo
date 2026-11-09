// Reporte interno de uso del sistema (web y celular) en un Excel.
//
//   npm run reporte-uso -- --desde 2026-11-01 --hasta 2026-11-30
//   npm run reporte-uso -- --desde 2026-11-01 --detalle crear_orden
//
// --desde / --hasta (AAAA-MM-DD, hora de Perú) son opcionales: sin ellas va
// todo el historial. --detalle agrega una hoja con el uso de una pantalla o
// acción específica (nombre técnico o descripción; acepta % como comodín, ej.
// "/controles%"). Se puede repetir para varias.
//
// Necesita web-react/.env.reporte (ver lib-reporte.mjs).

import { serviceClient, readArgs, PLATAFORMA, fecha, sheet, newBook, addSheet, saveBook } from './lib-reporte.mjs'

const TIPO = { pantalla: 'Pantalla', accion: 'Acción' }

const args = readArgs(['desde', 'hasta', 'detalle'], ['detalle'])
const db = serviceClient()

const periodo = { p_desde: args.desde, p_hasta: args.hasta }
const [ranking, usuarios, semanal, versiones, registros] = await Promise.all([
  db.rpc('reporte_uso_ranking', periodo),
  db.rpc('reporte_uso_usuarios', periodo),
  db.rpc('reporte_uso_semanal', periodo),
  db.rpc('reporte_uso_versiones'),
  db.rpc('reporte_registros_modulo', periodo),
])

const rankingCols = [
  ['cooperativa', 'Cooperativa'],
  ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v],
  ['tipo', 'Tipo', v => TIPO[v] ?? v],
  ['descripcion', 'Pantalla / función'],
  ['nombre', 'Nombre técnico'],
  ['usos', 'Usos'],
  ['usuarios', 'Usuarios distintos'],
  ['ultimo_uso', 'Último uso', fecha],
]

const wb = newBook()

addSheet(wb, sheet([
  { k: 'Período', v: `${args.desde ?? 'inicio'} a ${args.hasta ?? 'hoy'}` },
  { k: 'Generado', v: fecha(new Date()) },
  { k: 'Usuarios activos', v: new Set(usuarios.map(u => `${u.plataforma}|${u.cooperativa}|${u.usuario}`)).size },
  { k: 'Pantallas abiertas', v: usuarios.reduce((s, u) => s + Number(u.pantallas), 0) },
  { k: 'Acciones realizadas', v: usuarios.reduce((s, u) => s + Number(u.acciones), 0) },
  { k: 'Pantallas/funciones sin uso', v: ranking.filter(r => Number(r.usos) === 0).length },
], [['k', 'Dato'], ['v', 'Valor']]), 'Resumen')

addSheet(wb, sheet(ranking, rankingCols), 'Más usadas')
addSheet(wb, sheet(
  [...ranking].sort((a, b) => Number(a.usos) - Number(b.usos) || String(a.descripcion).localeCompare(String(b.descripcion))),
  rankingCols,
), 'Menos usadas')

addSheet(wb, sheet(usuarios, [
  ['cooperativa', 'Cooperativa'],
  ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v],
  ['usuario', 'Usuario'],
  ['rol', 'Rol'],
  ['dias_activos', 'Días activos'],
  ['pantallas', 'Pantallas abiertas'],
  ['acciones', 'Acciones'],
  ['primer_uso', 'Primer uso', fecha],
  ['ultimo_uso', 'Último uso', fecha],
  ['version_app', 'Versión app'],
]), 'Usuarios')

addSheet(wb, sheet(semanal, [
  ['semana', 'Semana (lunes)'],
  ['cooperativa', 'Cooperativa'],
  ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v],
  ['usuarios_activos', 'Usuarios activos'],
  ['pantallas', 'Pantallas abiertas'],
  ['acciones', 'Acciones'],
]), 'Por semana')

addSheet(wb, sheet(versiones, [
  ['cooperativa', 'Cooperativa'],
  ['usuario', 'Usuario'],
  ['rol', 'Rol'],
  ['version_app', 'Versión app'],
  ['ultimo_uso', 'Último uso', fecha],
]), 'Versiones celular')

addSheet(wb, sheet(
  [...registros].sort((a, b) => Number(b.registros) - Number(a.registros)),
  [
    ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v],
    ['modulo', 'Módulo'],
    ['cooperativa', 'Cooperativa'],
    ['registros', 'Registros'],
    ['usuarios', 'Usuarios distintos'],
    ['ultimo_registro', 'Último registro', fecha],
  ],
), 'Registros por módulo')

for (const [i, nombre] of args.detalle.entries()) {
  const rows = await db.rpc('reporte_uso_detalle', { p_nombre: nombre, ...periodo })
  addSheet(wb, sheet(rows, [
    ['fecha', 'Fecha'],
    ['cooperativa', 'Cooperativa'],
    ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v],
    ['tipo', 'Tipo', v => TIPO[v] ?? v],
    ['nombre', 'Nombre técnico'],
    ['detalle', 'Detalle'],
    ['usuario', 'Usuario'],
    ['rol', 'Rol'],
    ['usos', 'Usos'],
  ]), `Detalle ${args.detalle.length > 1 ? i + 1 : ''} ${nombre}`)
  if (rows.length === 0) console.warn(`Sin uso registrado para "${nombre}" en el período.`)
}

saveBook(wb, `Uso del sistema ${args.desde ?? 'inicio'} a ${args.hasta ?? new Date().toISOString().slice(0, 10)}.xlsx`)
