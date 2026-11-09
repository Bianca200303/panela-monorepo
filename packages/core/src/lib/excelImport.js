import * as XLSX from 'xlsx'

// Lectura genérica de Excel (.xlsx/.xls) o CSV. Devuelve la primera hoja
// como filas de celdas (array de arrays), sin interpretar encabezados: cada
// importación decide qué columnas busca (ver findHeaderRow).
export async function readSpreadsheetRows(file) {
  const buffer = await file.arrayBuffer()
  // CSV: se decodifica aquí para no perder las tildes (UTF-8 o, si no lo
  // es, Windows-1252, que es como lo guarda Excel en español). raw: los
  // valores quedan como texto ("25.000" no se vuelve 25; el DNI conserva
  // sus ceros) y cada importación los interpreta.
  const wb = /\.(csv|txt)$/i.test(file.name)
    ? XLSX.read(decodeText(buffer), { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false })
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

// Texto comparable: minúsculas, sin tildes, sin lo que va entre paréntesis
// y con espacios simples. "Código  Parcela (kg)" → "codigo parcela".
export function normalizeText(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Busca la fila de encabezados entre las primeras filas (el archivo puede
// traer un título arriba). `columns` = { clave: [nombres aceptados] }.
// Devuelve { headerIndex, colIndex: { clave: índice } } o null si ninguna
// fila tiene las columnas `required`.
export function findHeaderRow(rows, columns, required, maxScan = 15) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = rows[i].map(normalizeText)
    const colIndex = {}
    for (const [key, aliases] of Object.entries(columns)) {
      const idx = cells.findIndex(c => aliases.includes(c))
      if (idx >= 0) colIndex[key] = idx
    }
    if (required.every(k => k in colIndex)) return { headerIndex: i, colIndex }
  }
  return null
}

// Número escrito a mano en Excel/CSV: 25000, "25 000", "25,000", "25.000,5",
// "25000.5". Devuelve NaN si no es un número.
export function parseNumberCell(v) {
  if (typeof v === 'number') return v
  let s = String(v ?? '').replace(/\s/g, '')
  if (!s) return NaN
  if (s.includes(',') && s.includes('.')) {
    // El último separador es el decimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    s = s.replace(/[.,]/g, '') // separador de miles: 25,000 o 25.000
  } else {
    s = s.replace(',', '.')
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}
