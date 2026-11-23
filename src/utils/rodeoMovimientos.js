// Pase parcial de animales entre rodeos + registro en Línea de Tiempo (movimientos_hacienda).
// Firma estable: aplicarMovimientoRodeos(supabase, { origenId, destinoId, cantidades, motivo })
// cantidades: { vacas, terneros_machos, terneros_hembras, vaquillonas, toros } (enteros >= 0)
// Devuelve { ok: true, origen, destino, total } o lanza Error con mensaje en español.

export const CATEGORIAS_PASE = [
  { key: 'vacas', label: 'Vacas', col: 'vacas' },
  { key: 'terneros_machos', label: 'Terneros M', col: 'terneros_machos' },
  { key: 'terneros_hembras', label: 'Terneros H', col: 'terneros_hembras' },
  { key: 'vaquillonas', label: 'Vaquillonas', col: 'vaquillonas_reposicion' },
  { key: 'toros', label: 'Toros', col: 'toros_padres' },
];

const n = (v) => Math.max(0, parseInt(v, 10) || 0);

export async function aplicarMovimientoRodeos(supabase, { origenId, destinoId, cantidades = {}, motivo = '' } = {}) {
  if (!origenId || !destinoId) throw new Error('Debe indicar rodeo de origen y destino.');
  if (String(origenId) === String(destinoId)) throw new Error('Origen y destino no pueden ser el mismo rodeo.');

  const { data: rows, error } = await supabase.from('rodeos').select('*').in('id', [origenId, destinoId]);
  if (error) throw new Error('Error al leer rodeos: ' + error.message);
  const origen = rows?.find((r) => String(r.id) === String(origenId));
  const destino = rows?.find((r) => String(r.id) === String(destinoId));
  if (!origen || !destino) throw new Error('No se encontró el rodeo de origen o destino.');

  const origUpd = {};
  const destUpd = {};
  const detalle = [];
  let total = 0;
  for (const c of CATEGORIAS_PASE) {
    const cant = n(cantidades[c.key]);
    if (!cant) continue;
    const disp = n(origen[c.col]);
    if (cant > disp) throw new Error(`${c.label}: se intenta pasar ${cant} pero el origen solo tiene ${disp}.`);
    origUpd[c.col] = disp - cant;
    destUpd[c.col] = n(destino[c.col]) + cant;
    detalle.push(`${cant} ${c.label}`);
    total += cant;
  }
  if (!total) throw new Error('Ingrese al menos una cantidad mayor a 0.');

  // Terneros totales: si se tocaron M/H, TOT = M+H (manteniendo excedente no sexado del origen)
  const tocaTerneros = n(cantidades.terneros_machos) + n(cantidades.terneros_hembras);
  if (tocaTerneros) {
    origUpd.terneros = Math.max(0, n(origen.terneros) - tocaTerneros);
    destUpd.terneros = n(destino.terneros) + tocaTerneros;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  origUpd.fecha_actualizacion = hoy;
  destUpd.fecha_actualizacion = hoy;

  const { error: e1 } = await supabase.from('rodeos').update(origUpd).eq('id', origen.id);
  if (e1) throw new Error('Error al actualizar origen: ' + e1.message);
  const { error: e2 } = await supabase.from('rodeos').update(destUpd).eq('id', destino.id);
  if (e2) {
    // revertir origen
    const rev = {};
    Object.keys(origUpd).forEach((k) => { rev[k] = origen[k]; });
    await supabase.from('rodeos').update(rev).eq('id', origen.id);
    throw new Error('Error al actualizar destino: ' + e2.message);
  }

  const texto = `Pase parcial: ${detalle.join(', ')} de "${origen.nombre}" a "${destino.nombre}".${motivo ? ' Motivo: ' + motivo : ''}`;
  await supabase.from('movimientos_hacienda').insert({
    fecha: hoy,
    tipo_movimiento: 'Traslado',
    rodeo_id: origen.id,
    rodeo_nombre: `${origen.nombre} → ${destino.nombre}`,
    potrero_origen: origen.potrero_numero ?? null,
    potrero_destino: destino.potrero_numero ?? null,
    categoria_afectada: 'Pase parcial',
    cantidad_cabezas: total,
    motivo_observaciones: texto,
  });

  return { ok: true, origen: { ...origen, ...origUpd }, destino: { ...destino, ...destUpd }, total };
}

export default aplicarMovimientoRodeos;
