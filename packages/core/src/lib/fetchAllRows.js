// Supabase entrega como máximo 1000 filas por consulta (max_rows en
// config.toml) y corta el resto SIN avisar. Para tablas que pueden pasar de
// ese número, pedir por páginas:
//
//   const rows = await fetchAllRows(() => supabase.from('plots').select('*').order('id'))
//   const rows = await fetchAllRows(() => supabase.rpc('get_plot_quotas_by_campaign', { p_campaign_id }))
//
// `buildQuery` arma la consulta desde cero en cada página (un query builder
// no se puede reutilizar). La consulta debe tener un orden ÚNICO (desempate
// por id), si no, las páginas pueden saltarse o repetir filas.
const PAGE_SIZE = 1000

export async function fetchAllRows(buildQuery) {
  const all = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE_SIZE) return all
  }
}
