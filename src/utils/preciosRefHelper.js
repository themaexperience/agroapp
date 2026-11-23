// src/utils/preciosRefHelper.js
// Memoria y Sugerencia Inteligente de Últimos Precios de Insumos y Labores
// Establecimiento San José · Agroganadera Rincón del Sur S.A.

/**
 * Normaliza una cadena de texto para comparación flexible de nombres de insumos y labores:
 * minúsculas, sin tildes/acentos, sin puntuación y sin espacios duplicados.
 */
export function normalizarNombreInsumo(str = '') {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca el último precio unitario registrado para un insumo/producto en:
 * 1. Stock de Galpón / Insumos (`stockInsumos`)
 * 2. Siembras históricas de San José (`siembras`, revisando `insumos_json` por fecha descendente)
 *
 * @param {string} nombreProducto - Nombre del producto detectado en la receta/orden
 * @param {Array} stockInsumos - Listado de stock_insumos
 * @param {Array} siembras - Listado de labores_siembras
 * @param {number} dolarRef - Cotización del dólar de referencia
 * @returns {Object|null} { precio: number, moneda: 'USD'|'ARS', fuente: string, nombreMatch: string }
 */
export function buscarUltimoPrecioInsumo(nombreProducto, stockInsumos = [], siembras = [], dolarRef = 1540) {
  const targetNorm = normalizarNombreInsumo(nombreProducto);
  if (!targetNorm || targetNorm.length < 2) return null;

  const targetTokens = targetNorm.split(' ').filter((t) => t.length > 2);

  // 1. Buscar en stock de insumos del Galpón con precio de referencia > 0
  for (const item of stockInsumos || []) {
    const itemNorm = normalizarNombreInsumo(item.nombre);
    if (!itemNorm) continue;
    const precio = Number(item.precio_unitario_ref || item.costo_unitario_usd || item.precio_unitario || 0);
    if (precio <= 0) continue;

    const matchExacto = itemNorm.includes(targetNorm) || targetNorm.includes(itemNorm);
    const matchTokens = targetTokens.length > 0 && targetTokens.every((tok) => itemNorm.includes(tok));

    if (matchExacto || matchTokens) {
      return {
        precio,
        moneda: item.moneda || 'USD',
        fuente: 'Galpón / Stock',
        nombreMatch: item.nombre,
      };
    }
  }

  // 2. Buscar en siembras existentes (ordenadas de más reciente a más antigua)
  const siembrasSorted = [...(siembras || [])].sort((a, b) => {
    const dA = a.fecha ? new Date(a.fecha).getTime() : 0;
    const dB = b.fecha ? new Date(b.fecha).getTime() : 0;
    return dB - dA;
  });

  for (const s of siembrasSorted) {
    const insList = Array.isArray(s.insumos_json) ? s.insumos_json : [];
    for (const ins of insList) {
      const insNorm = normalizarNombreInsumo(ins.producto || ins.nombre);
      if (!insNorm) continue;

      let pUnit = Number(ins.precio_unitario) || 0;
      if (pUnit <= 0 && Number(ins.costo_usd) > 0 && Number(ins.cantidad) > 0) {
        pUnit = Number((Number(ins.costo_usd) / Number(ins.cantidad)).toFixed(2));
      }
      if (pUnit <= 0) continue;

      const matchExacto = insNorm.includes(targetNorm) || targetNorm.includes(insNorm);
      const matchTokens = targetTokens.length > 0 && targetTokens.every((tok) => insNorm.includes(tok));

      if (matchExacto || matchTokens) {
        return {
          precio: pUnit,
          moneda: ins.moneda || s.moneda || 'USD',
          fuente: `Siembra P#${s.potrero_numero} (${s.fecha || 'anterior'})`,
          nombreMatch: ins.producto || ins.nombre,
        };
      }
    }
  }

  // 3. Buscar en Catálogo de Presupuestos / Cotizaciones de Insumos
  const presupuestos = getHistorialPresupuestos();
  for (const pres of presupuestos) {
    for (const item of pres.items || []) {
      const itemNorm = normalizarNombreInsumo(item.producto);
      if (!itemNorm) continue;
      const precio = Number(item.precio_unitario) || 0;
      if (precio <= 0) continue;

      const matchExacto = itemNorm.includes(targetNorm) || targetNorm.includes(itemNorm);
      const matchTokens = targetTokens.length > 0 && targetTokens.every((tok) => itemNorm.includes(tok));

      if (matchExacto || matchTokens) {
        return {
          precio,
          moneda: item.moneda || pres.moneda || 'USD',
          fuente: `Cotización ${pres.proveedor || ''} (${pres.fecha || ''})`,
          nombreMatch: item.producto,
        };
      }
    }
  }

  return null;
}

/**
 * Busca la última tarifa por hectárea o precio unitario registrado para una labor agrícola
 * (siembra, fumigación, pasada de disco, fertilización, etc.) en siembras anteriores.
 *
 * @param {string} conceptoLabor - Concepto o nombre de la labor
 * @param {Array} siembras - Listado de labores_siembras
 * @returns {Object|null} { precio: number, moneda: 'USD'|'ARS', fuente: string, nombreMatch: string }
 */
export function buscarUltimoPrecioLabor(conceptoLabor, siembras = []) {
  const targetNorm = normalizarNombreInsumo(conceptoLabor);
  if (!targetNorm || targetNorm.length < 2) return null;

  const targetTokens = targetNorm.split(' ').filter((t) => t.length > 2);

  const siembrasSorted = [...(siembras || [])].sort((a, b) => {
    const dA = a.fecha ? new Date(a.fecha).getTime() : 0;
    const dB = b.fecha ? new Date(b.fecha).getTime() : 0;
    return dB - dA;
  });

  for (const s of siembrasSorted) {
    const labList = Array.isArray(s.labores_json) ? s.labores_json : [];
    for (const lab of labList) {
      const labNorm = normalizarNombreInsumo(lab.concepto || lab.labor || lab.tarea);
      if (!labNorm) continue;

      const pUnit = Number(lab.costo_ha_usd || lab.precio_unitario || 0);
      if (pUnit <= 0) continue;

      const matchExacto = labNorm.includes(targetNorm) || targetNorm.includes(labNorm);
      const matchTokens = targetTokens.length > 0 && targetTokens.every((tok) => labNorm.includes(tok));

      if (matchExacto || matchTokens) {
        return {
          precio: pUnit,
          moneda: lab.moneda || s.moneda || 'USD',
          fuente: `Labor P#${s.potrero_numero} (${s.fecha || 'anterior'})`,
          nombreMatch: lab.concepto || lab.labor,
        };
      }
    }
  }

  return null;
}

// =========================================================================
// PIZARRA DE PRECIOS GANADEROS DE REFERENCIA (MAG CAÑUELAS / ROSGAN)
// Actualizado a Noviembre 2026
// =========================================================================

export const DEFAULT_PRECIOS_HACIENDA = {
  ternero_kg_ars: 6300,      // Ternero Invernada $/kg vivo (MAG / Rosgan)
  novillito_kg_ars: 4400,    // Novillito / Consumo $/kg vivo
  vaca_kg_ars: 3100,         // Vaca Invernada / Descarte $/kg vivo
  toro_kg_ars: 3300,         // Toro $/kg vivo
  fechaActualizacion: new Date().toISOString(),
  fuente: 'MAG Cañuelas / Rosgan (Noviembre 2026)',
};

export function getPreciosHaciendaRef() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('sanjose_precios_hacienda_ref') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migración automática si los precios guardados son los viejos defaults (ej. ternero <= 4000)
      if (parsed && Number(parsed.ternero_kg_ars) > 0 && Number(parsed.ternero_kg_ars) < 4000) {
        const migrated = {
          ...DEFAULT_PRECIOS_HACIENDA,
          ...parsed,
          ternero_kg_ars: 6300,
          novillito_kg_ars: 4400,
          vaca_kg_ars: 3100,
          toro_kg_ars: 3300,
          fechaActualizacion: new Date().toISOString(),
          fuente: 'MAG Cañuelas / Rosgan (Noviembre 2026)',
        };
        try {
          localStorage.setItem('sanjose_precios_hacienda_ref', JSON.stringify(migrated));
        } catch {}
        return migrated;
      }
      return { ...DEFAULT_PRECIOS_HACIENDA, ...parsed };
    }
  } catch {}
  return DEFAULT_PRECIOS_HACIENDA;
}

export function savePreciosHaciendaRef(precios = {}) {
  try {
    const updated = {
      ...DEFAULT_PRECIOS_HACIENDA,
      ...precios,
      fechaActualizacion: new Date().toISOString(),
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sanjose_precios_hacienda_ref', JSON.stringify(updated));
    }
    return updated;
  } catch {}
  return { ...DEFAULT_PRECIOS_HACIENDA, ...precios };
}

// =========================================================================
// HISTORIAL Y CATÁLOGO DE PRESUPUESTOS / COTIZACIONES DE INSUMOS
// =========================================================================

export function getHistorialPresupuestos() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('sanjose_catalogo_presupuestos') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function guardarPresupuestoEnCatalogo(presupuesto = {}) {
  try {
    const list = getHistorialPresupuestos();
    const itemsSanitizados = (presupuesto.items || []).map((it) => ({
      producto: it.producto || it.nombre || 'Insumo',
      cantidad_total: Number(it.cantidad_total || it.cantidad) || 0,
      unidad: it.unidad || 'L',
      precio_unitario: Number(it.precio_unitario || it.precio) || 0,
      costo_total: Number(it.costo_total || it.total) || 0,
      moneda: it.moneda || presupuesto.moneda || 'USD',
      observaciones: it.observaciones || '',
    }));

    const nuevo = {
      id: presupuesto.id || `pres_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fecha: presupuesto.fecha || new Date().toISOString().slice(0, 10),
      proveedor: presupuesto.proveedor || presupuesto.ingeniero_o_proveedor || 'Cooperativa / Proveedor',
      numero_comprobante: presupuesto.numero_comprobante || presupuesto.remito_o_receta_nro || '',
      moneda: presupuesto.moneda || 'USD',
      total_estimado: Number(presupuesto.total_estimado || presupuesto.subtotal_neto || presupuesto.total_documento) || 0,
      archivo_nombre: presupuesto.archivo_nombre || presupuesto.fileName || '',
      observaciones: presupuesto.observaciones || presupuesto.observaciones_generales || '',
      items: itemsSanitizados,
      createdAt: new Date().toISOString(),
    };

    const filtered = list.filter((p) => p.id !== nuevo.id);
    const updated = [nuevo, ...filtered].slice(0, 50);

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sanjose_catalogo_presupuestos', JSON.stringify(updated));
    }
    return updated;
  } catch (err) {
    console.warn('Error al guardar presupuesto en catálogo:', err);
    return getHistorialPresupuestos();
  }
}

export function eliminarPresupuestoCatalogo(id) {
  try {
    const list = getHistorialPresupuestos();
    const updated = list.filter((p) => p.id !== id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sanjose_catalogo_presupuestos', JSON.stringify(updated));
    }
    return updated;
  } catch {}
  return [];
}

export default {
  normalizarNombreInsumo,
  buscarUltimoPrecioInsumo,
  buscarUltimoPrecioLabor,
  getHistorialPresupuestos,
  guardarPresupuestoEnCatalogo,
  eliminarPresupuestoCatalogo,
  DEFAULT_PRECIOS_HACIENDA,
  getPreciosHaciendaRef,
  savePreciosHaciendaRef,
};
