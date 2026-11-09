import * as XLSX from 'xlsx'

// Exporta una tabla a Excel. Reutilizable para cualquier listado: se le
// pasan las columnas (encabezado + cómo leer el valor de cada fila) y las
// filas tal como se muestran en pantalla.
//
// columns: [{ label, value: (row) => any }]
export function exportTableToExcel({ fileName, sheetName = 'Datos', columns, rows }) {
  exportSheetsToExcel({ fileName, sheets: [{ sheetName, columns, rows }] })
}

// Igual, con varias hojas en el mismo archivo.
// sheets: [{ sheetName, columns, rows }]
export function exportSheetsToExcel({ fileName, sheets }) {
  const wb = XLSX.utils.book_new()
  for (const { sheetName = 'Datos', columns, rows } of sheets) {
    const aoa = [
      columns.map(c => c.label),
      ...rows.map(r => columns.map(c => c.value(r) ?? '')),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = columns.map(c => ({ wch: Math.max(10, String(c.label).length + 2) }))
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  }
  XLSX.writeFile(wb, `${fileName.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`)
}
