import { supabase } from '../lib/supabase.js';

export const TABLAS_SISTEMA = [
  'rodeos',
  'movimientos_hacienda',
  'labores_siembras',
  'stock_insumos',
  'cajas_caravanas',
  'animales',
  'gastos_campo',
  'ventas_hacienda',
  'registros_lluvias',
  'movimientos_pactados',
  'cuaderno_veterinario',
  'potreros',
];

// Orden inverso de dependencia para vaciar tablas sin violar Foreign Keys
export const ORDEN_BORRADO = [
  'animales',
  'cajas_caravanas',
  'movimientos_hacienda',
  'cuaderno_veterinario',
  'movimientos_pactados',
  'labores_siembras',
  'stock_insumos',
  'gastos_campo',
  'ventas_hacienda',
  'registros_lluvias',
  'rodeos',
  'potreros',
];

// Orden directo de dependencia para reinsertar datos
export const ORDEN_INSERCION = [
  'potreros',
  'rodeos',
  'registros_lluvias',
  'ventas_hacienda',
  'gastos_campo',
  'stock_insumos',
  'labores_siembras',
  'movimientos_pactados',
  'cuaderno_veterinario',
  'movimientos_hacienda',
  'cajas_caravanas',
  'animales',
];

/**
 * Sanitiza las filas eliminando columnas GENERATED ALWAYS de Postgres
 */
function sanitizarFilaParaInsercion(tabla, row) {
  if (!row || typeof row !== 'object') return row;
  const clean = { ...row };
  if (tabla === 'labores_siembras') {
    delete clean.costo_total;
  }
  if (tabla === 'rodeos') {
    delete clean.total_cabezas;
  }
  return clean;
}

/**
 * Calcula métricas sintéticas del snapshot para visualización rápida en UI
 */
export function calcularResumenMeta(payload = {}) {
  const rodeosList = payload.rodeos || [];
  const cantRodeos = rodeosList.length;
  const totalCabezas = rodeosList.reduce((acc, r) => {
    return (
      acc +
      (Number(r.vacas) || 0) +
      (Number(r.terneros) || 0) +
      (Number(r.toros_padres) || 0) +
      (Number(r.toritos) || 0) +
      (Number(r.vacas_cut) || 0) +
      (Number(r.vaquillonas_reposicion) || 0)
    );
  }, 0);

  const cantSiembras = (payload.labores_siembras || []).length;
  const cantInsumos = (payload.stock_insumos || []).length;
  const cantGastos = (payload.gastos_campo || []).length;
  const cantVentas = (payload.ventas_hacienda || []).length;
  const cantLluvias = (payload.registros_lluvias || []).length;
  const cantMovimientos = (payload.movimientos_hacienda || []).length;
  const cantAnimales = (payload.animales || []).length;
  const cantCajasCaravanas = (payload.cajas_caravanas || []).length;
  const cantPotreros = (payload.potreros || []).length;
  const cantCuaderno = (payload.cuaderno_veterinario || []).length;
  const cantMovPactados = (payload.movimientos_pactados || []).length;

  return {
    rodeos: cantRodeos,
    cabezas: totalCabezas,
    siembras: cantSiembras,
    insumos: cantInsumos,
    gastos: cantGastos,
    ventas: cantVentas,
    lluvias: cantLluvias,
    movimientos: cantMovimientos,
    animales: cantAnimales,
    cajas_caravanas: cantCajasCaravanas,
    potreros: cantPotreros,
    cuaderno: cantCuaderno,
    movimientos_pactados: cantMovPactados,
    resumen_texto: `${cantRodeos} rodeos · ${totalCabezas.toLocaleString('es-AR')} cab. · ${cantSiembras} siembras/labores · ${cantInsumos} insumos`,
  };
}

/**
 * Poda los snapshots más antiguos para mantener un límite máximo (por defecto 20)
 */
export async function podarSnapshotsAntiguos(maxRetencion = 20) {
  try {
    const { data: snaps, error } = await supabase
      .from('system_snapshots')
      .select('id')
      .order('creado_en', { ascending: false });

    if (!error && snaps && snaps.length > maxRetencion) {
      const idsToDelete = snaps.slice(maxRetencion).map((s) => s.id);
      if (idsToDelete.length > 0) {
        await supabase.from('system_snapshots').delete().in('id', idsToDelete);
      }
    }
  } catch (err) {
    console.warn('Aviso podando snapshots antiguos:', err);
  }
}

/**
 * Crea un snapshot completo de las 12 tablas operativas de Supabase
 * @param {Object} options
 * @param {string} options.titulo - Nombre o motivo del snapshot
 * @param {'MANUAL' | 'AUTO_PRE_IA' | 'PRE_RESTAURACION'} [options.tipo='MANUAL']
 * @param {Object} [options.metadata={}]
 */
export async function crearSystemSnapshot({ titulo, tipo = 'MANUAL', metadata = {} }) {
  // 1. Leer en paralelo las 12 tablas operativas
  const queries = TABLAS_SISTEMA.map((tabla) => supabase.from(tabla).select('*'));
  const results = await Promise.all(queries);

  const payload = {};
  TABLAS_SISTEMA.forEach((tabla, index) => {
    const res = results[index];
    if (res.error) {
      console.warn(`Error al leer tabla ${tabla} para snapshot:`, res.error);
      payload[tabla] = [];
    } else {
      payload[tabla] = res.data || [];
    }
  });

  // 2. Calcular metadatos resumidos
  const resumenMeta = {
    ...calcularResumenMeta(payload),
    ...metadata,
  };

  const snapshotRow = {
    titulo: titulo || `Respaldo ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`,
    tipo: tipo || 'MANUAL',
    resumen_meta: resumenMeta,
    payload,
    creado_en: new Date().toISOString(),
  };

  // 3. Insertar en system_snapshots
  const { data: inserted, error: insErr } = await supabase
    .from('system_snapshots')
    .insert(snapshotRow)
    .select('id, titulo, tipo, resumen_meta, creado_en')
    .single();

  if (insErr) {
    console.error('Error insertando snapshot en Supabase:', insErr);
    throw insErr;
  }

  // 4. Podar si excede 20
  await podarSnapshotsAntiguos(20);

  return inserted;
}

/**
 * Obtiene la lista de snapshots ordenados de más reciente a más antiguo
 */
export async function listarSystemSnapshots() {
  const { data, error } = await supabase
    .from('system_snapshots')
    .select('id, titulo, tipo, resumen_meta, creado_en')
    .order('creado_en', { ascending: false });

  if (error) {
    console.error('Error al listar system_snapshots:', error);
    throw error;
  }
  return data || [];
}

/**
 * Restaura la base de datos de producción completa al estado del snapshot seleccionado.
 * Crea automáticamente un snapshot de seguridad previo ('PRE_RESTAURACION') antes de vaciar tablas.
 * @param {number|string} snapshotId - ID del snapshot a restaurar
 * @param {Function} [onProgress] - Callback opcional para reportar avance ('Seguridad', 'Limpiando...', 'Restaurando...')
 */
export async function restaurarSystemSnapshot(snapshotId, onProgress) {
  // 1. Obtener el snapshot con su payload completo
  onProgress?.('Cargando respaldo seleccionado...');
  const { data: snap, error: snapErr } = await supabase
    .from('system_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .single();

  if (snapErr || !snap) {
    throw new Error('No se pudo encontrar el punto de restauración en Supabase');
  }

  const payload = snap.payload || {};

  // 2. Crear Airbag de seguridad: Snapshot PRE_RESTAURACION del estado vivo actual
  onProgress?.('Creando respaldo de seguridad previo a la restauración...');
  try {
    await crearSystemSnapshot({
      titulo: `Seguridad Pre-Restauración (Punto #${snapshotId}: ${snap.titulo})`,
      tipo: 'PRE_RESTAURACION',
    });
  } catch (safetyErr) {
    console.warn('Aviso: no se pudo crear el respaldo de seguridad previo:', safetyErr);
  }

  // 3. Vaciar tablas en ORDEN_BORRADO (respetando Foreign Keys)
  for (const tabla of ORDEN_BORRADO) {
    onProgress?.(`Vaciando tabla actual: ${tabla}...`);
    const { error: delErr } = await supabase.from(tabla).delete().neq('id', -999999);
    if (delErr) {
      console.warn(`Aviso al vaciar ${tabla}:`, delErr);
    }
  }

  // 4. Reinsertar datos en ORDEN_INSERCION
  for (const tabla of ORDEN_INSERCION) {
    const filasOriginales = payload[tabla] || [];
    if (filasOriginales.length > 0) {
      onProgress?.(`Restaurando ${filasOriginales.length} registros en ${tabla}...`);
      const filasLimpias = filasOriginales.map((fila) => sanitizarFilaParaInsercion(tabla, fila));

      // Inserción en lotes de 100 para evitar límites de payload HTTP
      const BATCH_SIZE = 100;
      for (let i = 0; i < filasLimpias.length; i += BATCH_SIZE) {
        const batch = filasLimpias.slice(i, i + BATCH_SIZE);
        const { error: insErr } = await supabase.from(tabla).insert(batch);
        if (insErr) {
          console.error(`Error reinsertando lote en ${tabla}:`, insErr);
          throw new Error(`Fallo al restaurar ${tabla}: ${insErr.message || JSON.stringify(insErr)}`);
        }
      }
    }
  }

  onProgress?.('¡Restauración completada con éxito!');
  return snap;
}

/**
 * Elimina un snapshot específico
 */
export async function eliminarSystemSnapshot(snapshotId) {
  const { error } = await supabase.from('system_snapshots').delete().eq('id', snapshotId);
  if (error) {
    console.error('Error al eliminar snapshot:', error);
    throw error;
  }
  return true;
}
