// src/utils/caravanasAuditoriaOficial.js
// Auditoría Oficial de Caravanas SENASA (RENSPA JS307) para Establecimiento San José
// Agroganadera Rincón del Sur S.A. · Las Flores, Bs. As.
// Cuadra exactamente: 1.600 compradas = 430 En Stock + 632 Puestas en Campo + 515 Salidas + 23 Mermas

import { supabase } from '../lib/supabase.js';

export const LOTES_OFICIALES_SIGSA = [
  {
    caja_numero: 1,
    marca: 'Allflex Oficial SIGSA',
    fecha_compra: '2026-04-14',
    desde: '032010007455750',
    hasta: '032010007455949',
    cantidad: 200,
    puestas: 15,
    salidas: 185,
    mermas: 0,
    en_stock: 0,
    usadas: 200,
    usadas_sin_detalle: 0,
    color_tipo: 'Amarilla Oficial SENASA',
    cuig: 'JS307',
    proveedor: 'SIGSA / Allflex Oficial',
    observaciones: 'Lote 14/04/2026: 200 unid. (15 puestas en COLA + 185 salidas DT-e)',
  },
  {
    caja_numero: 2,
    marca: 'Allflex Oficial SIGSA',
    fecha_compra: '2026-05-13',
    desde: '032010010604500',
    hasta: '032010010604699',
    cantidad: 200,
    puestas: 184,
    salidas: 15,
    mermas: 1,
    en_stock: 0,
    usadas: 200,
    usadas_sin_detalle: 0,
    color_tipo: 'Amarilla Oficial SENASA',
    cuig: 'JS307',
    proveedor: 'SIGSA / Allflex Oficial',
    observaciones: 'Lote 13/05/2026: 200 unid. (184 puestas [34 Toros 4630-4664 + 20 Vaq. Otoño 4680-4699 + 130 Rodeo 2] + 15 salidas + 1 merma)',
  },
  {
    caja_numero: 3,
    marca: 'Allflex Oficial SIGSA',
    fecha_compra: '2026-07-15',
    desde: '032010011002250',
    hasta: '032010011002549',
    cantidad: 300,
    puestas: 300,
    salidas: 0,
    mermas: 0,
    en_stock: 0,
    usadas: 300,
    usadas_sin_detalle: 0,
    color_tipo: 'Amarilla Oficial SENASA',
    cuig: 'JS307',
    proveedor: 'SIGSA / Allflex Oficial',
    observaciones: 'Lote 15/07/2026: 300 unid. (300 puestas [141 Vaq. Otoño 2250-2390 + 159 Planillas 1-12 2391-2549])',
  },
  {
    caja_numero: 4,
    marca: 'Allflex Oficial SIGSA',
    fecha_compra: '2026-08-24',
    desde: '032010011041325',
    hasta: '032010011041524',
    cantidad: 200,
    puestas: 10,
    salidas: 190,
    mermas: 0,
    en_stock: 0,
    usadas: 200,
    usadas_sin_detalle: 0,
    color_tipo: 'Amarilla Oficial SENASA',
    cuig: 'JS307',
    proveedor: 'SIGSA / Allflex Oficial',
    observaciones: 'Lote 24/08/2026: 200 unid. (10 puestas 41325-41329 / 41520-41524 + 190 salidas)',
  },
  {
    caja_numero: 5,
    marca: 'Allflex Oficial SIGSA',
    fecha_compra: '2026-09-07',
    desde: '032010011048200',
    hasta: '032010011048599',
    cantidad: 400,
    puestas: 123,
    salidas: 125,
    mermas: 22,
    en_stock: 130, // 130 disponibles en depósito (20 unid 48280-48299 + 110 unid 48350-48459)
    usadas: 270,
    usadas_sin_detalle: 0,
    color_tipo: 'Amarilla Oficial SENASA',
    cuig: 'JS307',
    proveedor: 'SIGSA / Allflex Oficial',
    observaciones: 'Lote 07/09/2026: 400 unid. (130 EN STOCK + 123 puestas [Preñez 10/11 y Rodeo 2] + 125 salidas + 22 mermas)',
  },
  {
    caja_numero: 6,
    marca: 'Allflex Oficial SIGSA',
    fecha_compra: '2026-11-02',
    desde: '032010007589125',
    hasta: '032010007589424',
    cantidad: 300,
    puestas: 0,
    salidas: 0,
    mermas: 0,
    en_stock: 300, // 300 en depósito intactas
    usadas: 0,
    usadas_sin_detalle: 0,
    color_tipo: 'Amarilla Oficial SENASA',
    cuig: 'JS307',
    proveedor: 'SIGSA / Allflex Oficial',
    observaciones: 'Lote 02/11/2026: 300 unid. (300 EN STOCK disponibles en depósito)',
  },
];

/**
 * Resuelve un número de caravana (completo o corto de 4 a 6 dígitos) contra los 6 lotes SIGSA
 */
export function resolverCaravanaCompleta(numInput, lotes = LOTES_OFICIALES_SIGSA) {
  if (!numInput) return null;
  const raw = String(numInput).trim().replace(/\s+/g, '');
  if (!raw) return null;

  // Si ya tiene 15 dígitos y coincide
  if (/^\d{15}$/.test(raw)) {
    return raw;
  }

  // Si es un número más corto (ej: 4680, 2250, 48275), buscar coincidencia de sufijo en los lotes
  const cleanDigits = raw.replace(/\D/g, '');
  if (cleanDigits.length < 3) return null;

  for (const lote of lotes) {
    const dStr = lote.desde;
    const hStr = lote.hasta;
    const prefix = dStr.slice(0, -cleanDigits.length);
    const candidate = prefix + cleanDigits;

    // Verificar si cae dentro del rango numérico del lote
    if (candidate >= dStr && candidate <= hStr) {
      return candidate;
    }

    // Probar con match numérico directo
    const numD = BigInt(dStr);
    const numH = BigInt(hStr);
    const numLen = dStr.length;
    for (let offset = 0n; offset <= (numH - numD); offset++) {
      const full = String(numD + offset).padStart(numLen, '0');
      if (full.endsWith(cleanDigits)) {
        return full;
      }
    }
  }

  // Si no coincide con un lote pero tiene entre 10 y 14 dígitos, padear con 0
  if (cleanDigits.length >= 10) {
    return cleanDigits.padStart(15, '0');
  }

  return null;
}

/**
 * Genera el padrón completo oficial de 1.600 animales con estados y rodeos cuadrados
 * Cuadre exacto: 430 En Stock + 632 Puestas en Campo + 515 Salidas/Bajas + 23 Mermas = 1.600
 */
export function generarAuditoriaOficialSanJose() {
  const animales = [];

  // Helper para generar una caravana de 15 dígitos
  const makeId = (num) => String(num).padStart(15, '0');

  // =========================================================================
  // LOTE 1 (14/04/2026): 032010007455750 a 032010007455949 (200 unid: 15 puestas + 185 salidas)
  // =========================================================================
  const l1Start = 32010007455750n;
  for (let i = 0n; i < 200n; i++) {
    const car = makeId(l1Start + i);
    if (i < 15n) {
      // 15 puestas en rodeo COLA (potrero 26)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaca Cría',
        rodeo: 'COLA',
        potrero_actual: 26,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-04-20',
        origen_planilla: 'Auditoría Oficial SIGSA 14/04/2026',
        observaciones: 'Caravana colocada en rodeo COLA',
      });
    } else {
      // 185 salidas comerciales
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Venta Invernada',
        rodeo: 'SALIDA / DESPACHO',
        potrero_actual: null,
        estado: 'Salida / Vendida',
        estado_caravana: 'Salida / Vendida',
        fecha_salida: '2026-05-10',
        motivo_salida: 'Venta / Despacho DT-e',
        dte_numero: 'DTE-2026-00412',
        origen_planilla: 'Auditoría Oficial SIGSA 14/04/2026',
        observaciones: 'Despacho comercial certificado',
      });
    }
  }

  // =========================================================================
  // LOTE 2 (13/05/2026): 032010010604500 a 032010010604699 (200 unid: 184 puestas + 15 salidas + 1 merma)
  // =========================================================================
  const l2Start = 32010010604500n;
  for (let i = 0n; i < 200n; i++) {
    const num = l2Start + i;
    const car = makeId(num);
    const sufijo = Number(i + 500n); // 500 a 699

    // Caso Toros: 4630 a 4664 (sufijo 630 a 664)
    if (sufijo >= 630 && sufijo <= 664) {
      if (sufijo === 636) {
        // Caravana 4636 rota en manga (1 merma/rotura oficial)
        animales.push({
          id: `auditoria_${car}`,
          caravana: car,
          marca: 'San José (JS307)',
          categoria: 'Toros Padres',
          rodeo: 'TOROS',
          potrero_actual: null,
          estado: 'Baja / Merma',
          estado_caravana: 'Merma',
          fecha_salida: '2026-05-18',
          motivo_salida: 'Baja / Rotura en manga',
          origen_planilla: 'Auditoría Oficial SIGSA 13/05/2026',
          observaciones: 'Caravana dañada/rota en colocación (sin animal)',
        });
      } else {
        // 34 Toros reproductores
        animales.push({
          id: `auditoria_${car}`,
          caravana: car,
          marca: 'San José (JS307)',
          categoria: 'Toros Padres',
          rodeo: 'TOROS',
          potrero_actual: 7,
          estado: 'Activa en Campo',
          estado_caravana: 'Activa en Campo',
          fecha_colocacion: '2026-05-18',
          origen_planilla: 'Auditoría Oficial SIGSA 13/05/2026',
          observaciones: 'Toro reproductor identificado',
        });
      }
    } else if (sufijo >= 680 && sufijo <= 699) {
      // 20 Vaquillonas Otoño
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaquillonas Reposición',
        rodeo: 'VAQUILLONAS OTOÑO',
        potrero_actual: 12,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-05-20',
        origen_planilla: 'Auditoría Oficial SIGSA 13/05/2026',
        observaciones: 'Vaquillona reposición otoño',
      });
    } else if (sufijo >= 665 && sufijo <= 679) {
      // 15 Salidas comerciales
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Venta',
        rodeo: 'SALIDA / DESPACHO',
        potrero_actual: null,
        estado: 'Salida / Vendida',
        estado_caravana: 'Salida / Vendida',
        fecha_salida: '2026-06-05',
        motivo_salida: 'Venta Directa',
        dte_numero: 'DTE-2026-00620',
        origen_planilla: 'Auditoría Oficial SIGSA 13/05/2026',
        observaciones: 'Venta de invernada',
      });
    } else {
      // Restantes 130 vacas en rodeo 2 (500 a 629)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaca Cría',
        rodeo: 'COLADA RODEO 2',
        potrero_actual: 15,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-05-22',
        origen_planilla: 'Auditoría Oficial SIGSA 13/05/2026',
        observaciones: 'Vaca de rodeo 2',
      });
    }
  }

  // =========================================================================
  // LOTE 3 (15/07/2026): 032010011002250 a 032010011002549 (300 unid: 300 puestas en campo)
  // =========================================================================
  const l3Start = 32010011002250n;
  for (let i = 0n; i < 300n; i++) {
    const num = l3Start + i;
    const car = makeId(num);
    const sufijo = Number(i + 250n); // 250 a 549 (2250 a 2549)

    if (sufijo <= 390) {
      // 141 Vaquillonas Otoño (2250 a 2390)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaquillonas Reposición',
        rodeo: 'VAQUILLONAS OTOÑO',
        potrero_actual: 12,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-07-20',
        origen_planilla: 'Auditoría Oficial SIGSA 15/07/2026',
        observaciones: 'Vaquillona otoño lote 2250-2390',
      });
    } else {
      // 159 Planillas 1-12 (2391 a 2549) en RODEO 3 (potrero 17)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaca Cría',
        rodeo: 'RODEO 3',
        potrero_actual: 17,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-07-25',
        origen_planilla: 'Auditoría Oficial SIGSA 15/07/2026',
        observaciones: 'Planillas 1-12 lote 2391-2549',
      });
    }
  }

  // =========================================================================
  // LOTE 4 (24/08/2026): 032010011041325 a 032010011041524 (200 unid: 10 puestas + 190 salidas)
  // =========================================================================
  const l4Start = 32010011041325n;
  for (let i = 0n; i < 200n; i++) {
    const num = l4Start + i;
    const car = makeId(num);
    // Puestas: 41325-41329 (i = 0..4) y 41520-41524 (i = 195..199)
    if (i < 5n || i >= 195n) {
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaca Cría',
        rodeo: 'COLA',
        potrero_actual: 26,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-08-28',
        origen_planilla: 'Auditoría Oficial SIGSA 24/08/2026',
        observaciones: 'Caravana activa en rodeo COLA',
      });
    } else {
      // 190 Salidas comerciales
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Venta',
        rodeo: 'SALIDA / DESPACHO',
        potrero_actual: null,
        estado: 'Salida / Vendida',
        estado_caravana: 'Salida / Vendida',
        fecha_salida: '2026-09-15',
        motivo_salida: 'Venta Gordos Frigorífico',
        dte_numero: 'DTE-2026-00891',
        origen_planilla: 'Auditoría Oficial SIGSA 24/08/2026',
        observaciones: 'Despacho comercial de faena',
      });
    }
  }

  // =========================================================================
  // LOTE 5 (07/09/2026): 032010011048200 a 032010011048599 (400 unid: 130 stock + 123 puestas + 125 salidas + 22 mermas)
  // =========================================================================
  // - En Stock (130): 48280-48299 (20) y 48350-48459 (110)
  // - Mermas (22): 48200 a 48221
  // - Puestas (123):
  //     * 68 en Rodeo 2: 48222 a 48274 (53) + 48460 a 48474 (15)
  //     * 55 en Rodeo 1 - Punta (Preñez 10/11): 48275 a 48279 (5) + 48300 a 48349 (50)
  // - Salidas (125): 48475 a 48599
  const l5Start = 32010011048200n;
  for (let i = 0n; i < 400n; i++) {
    const num = l5Start + i;
    const car = makeId(num);
    const sufijo = 48200n + i;

    // 1. En Stock (130 caravanas)
    if ((sufijo >= 48280n && sufijo <= 48299n) || (sufijo >= 48350n && sufijo <= 48459n)) {
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Sin asignar (En depósito)',
        rodeo: null,
        potrero_actual: null,
        estado: 'En Stock',
        estado_caravana: 'En Stock',
        origen_planilla: 'Auditoría Oficial SIGSA 07/09/2026',
        observaciones: 'Caravana nueva en depósito lista para usar (Caja 5)',
      });
    } else if (sufijo >= 48200n && sufijo <= 48221n) {
      // 2. Mermas / Roturas de fábrica (22 caravanas)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Baja',
        rodeo: 'MERMA / ROTURA',
        potrero_actual: null,
        estado: 'Baja / Merma',
        estado_caravana: 'Merma',
        fecha_salida: '2026-09-20',
        motivo_salida: 'Baja / Merma o rotura de fábrica',
        origen_planilla: 'Auditoría Oficial SIGSA 07/09/2026',
        observaciones: 'Caravana fallada o rota de fábrica',
      });
    } else if (sufijo >= 48475n && sufijo <= 48599n) {
      // 3. Salidas comerciales (125 caravanas)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Venta',
        rodeo: 'SALIDA / DESPACHO',
        potrero_actual: null,
        estado: 'Salida / Vendida',
        estado_caravana: 'Salida / Vendida',
        fecha_salida: '2026-10-25',
        motivo_salida: 'Venta Invernada',
        dte_numero: 'DTE-2026-01020',
        origen_planilla: 'Auditoría Oficial SIGSA 07/09/2026',
        observaciones: 'Salida lote 48475-48599',
      });
    } else if ((sufijo >= 48275n && sufijo <= 48279n) || (sufijo >= 48300n && sufijo <= 48349n)) {
      // 4. Preñez 10/11 en Rodeo 1 - Punta (55 caravanas)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaca Cría',
        rodeo: 'RODEO 1 - PUNTA',
        potrero_actual: 5,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-10-10',
        origen_planilla: 'Auditoría Oficial SIGSA 07/09/2026',
        observaciones: 'Preñez 10/11 lote 48275-48349',
      });
    } else {
      // 5. Resto puestas en Rodeo 2 (68 caravanas: 48222 a 48274 y 48460 a 48474)
      animales.push({
        id: `auditoria_${car}`,
        caravana: car,
        marca: 'San José (JS307)',
        categoria: 'Vaca Cría',
        rodeo: 'COLADA RODEO 2',
        potrero_actual: 15,
        estado: 'Activa en Campo',
        estado_caravana: 'Activa en Campo',
        fecha_colocacion: '2026-10-05',
        origen_planilla: 'Auditoría Oficial SIGSA 07/09/2026',
        observaciones: 'Puesta en rodeo 2',
      });
    }
  }

  // =========================================================================
  // LOTE 6 (02/11/2026): 032010007589125 a 032010007589424 (300 unid: 300 EN STOCK en depósito)
  // =========================================================================
  const l6Start = 32010007589125n;
  for (let i = 0n; i < 300n; i++) {
    const num = l6Start + i;
    const car = makeId(num);
    animales.push({
      id: `auditoria_${car}`,
      caravana: car,
      marca: 'San José (JS307)',
      categoria: 'Sin asignar (En depósito)',
      rodeo: null,
      potrero_actual: null,
      estado: 'En Stock',
      estado_caravana: 'En Stock',
      origen_planilla: 'Auditoría Oficial SIGSA 02/11/2026',
      observaciones: 'Caravana nueva en depósito lista para usar (Caja 6)',
    });
  }

  return {
    cajas: LOTES_OFICIALES_SIGSA,
    animales,
  };
}

/**
 * Sincroniza la auditoría oficial tanto en Supabase (Producción) como en Modo Sandbox
 */
export async function sincronizarAuditoriaOficialEnBaseDeDatos({
  isSandboxMode = false,
  notify = () => {},
  onRefresh = () => {},
}) {
  const { cajas, animales } = generarAuditoriaOficialSanJose();

  // -------------------------------------------------------------------------
  // MODO SANDBOX (localStorage)
  // -------------------------------------------------------------------------
  if (isSandboxMode) {
    try {
      notify?.('Sincronizando auditoría oficial en Modo Sandbox...', 'info');
      const raw = localStorage.getItem('san_jose_sandbox_data');
      const sData = raw ? JSON.parse(raw) : {};

      // Paso A: Limpieza previa
      sData.cajasCaravanas = [];
      sData.animales = [];

      // Paso B: Cargar los 6 lotes
      sData.cajasCaravanas = cajas;
      sData.animales = animales;

      localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
      window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: sData }));

      notify?.(
        'Auditoría Oficial SIGSA sincronizada con éxito en Modo Sandbox: 430 en stock, 632 en campo, 515 salidas y 23 mermas.',
        'success'
      );

      if (onRefresh) {
        await onRefresh();
      }

      return { success: true, count: animales.length, cajas, animales };
    } catch (err) {
      console.error('Error en sandbox sync auditoria:', err);
      notify?.('Error al sincronizar en sandbox: ' + err.message, 'error');
      return { success: false, error: err };
    }
  }

  // -------------------------------------------------------------------------
  // MODO PRODUCCIÓN (Supabase)
  // -------------------------------------------------------------------------
  try {
    notify?.('Iniciando limpieza previa en Supabase (cajas viejas y padrón desfasado)...', 'info');

    // Paso A: Limpieza previa en Supabase
    // 1. Eliminar cajas viejas
    const { error: errDelCajas } = await supabase
      .from('cajas_caravanas')
      .delete()
      .gt('id', -1);

    if (errDelCajas) {
      console.warn('Advertencia al limpiar cajas_caravanas previas:', errDelCajas);
      // Intento alternativo con neq
      const { error: altErrCaj } = await supabase.from('cajas_caravanas').delete().neq('caja_numero', -9999);
      if (altErrCaj) {
        notify?.('Advertencia al limpiar cajas previas: ' + altErrCaj.message, 'warning');
      }
    }

    // 2. Eliminar animales viejos desfasados
    const { error: errDelAni } = await supabase
      .from('animales')
      .delete()
      .gt('id', -1);

    if (errDelAni) {
      console.warn('Advertencia al limpiar animales previos:', errDelAni);
      const { error: altErrAni } = await supabase.from('animales').delete().neq('caravana', 'XXXX');
      if (altErrAni) {
        notify?.('Advertencia al limpiar animales previos: ' + altErrAni.message, 'warning');
      }
    }

    // Paso B: Cargar los 6 lotes oficiales
    notify?.('Guardando los 6 lotes oficiales en Cajas en Stock (Supabase)...', 'info');

    const cajasPayload = cajas.map((c) => ({
      caja_numero: c.caja_numero,
      marca: c.marca || 'Allflex Oficial SIGSA',
      desde: c.desde,
      hasta: c.hasta,
      cantidad: c.cantidad,
      en_stock: c.en_stock,
      usadas: c.usadas,
      usadas_sin_detalle: 0,
      color_tipo: c.color_tipo || 'Amarilla Oficial SENASA',
      cuig: c.cuig || 'JS307',
      proveedor: c.proveedor || 'SIGSA / Allflex Oficial',
      fecha_compra: c.fecha_compra,
      observaciones: c.observaciones || '',
    }));

    const { error: errCajas } = await supabase
      .from('cajas_caravanas')
      .insert(cajasPayload);

    if (errCajas) {
      console.error('Error insertando cajas_caravanas en Supabase:', errCajas);
      notify?.('Error insertando cajas oficiales: ' + errCajas.message, 'error');
      throw errCajas;
    }

    notify?.('Sincronizando el padrón de 1.600 caravanas oficiales en bloques...', 'info');

    // Insertar animales en lotes de 100 para no exceder límites de payload ni timeouts
    const batchSize = 100;
    for (let i = 0; i < animales.length; i += batchSize) {
      const chunk = animales.slice(i, i + batchSize).map((a) => ({
        caravana: a.caravana,
        marca: a.marca || 'San José (JS307)',
        categoria: a.categoria || 'Sin categoría',
        rodeo: a.rodeo || null,
        potrero_actual: a.potrero_actual != null ? Number(a.potrero_actual) : null,
        estado: a.estado || 'Activa en Campo',
        estado_caravana: a.estado_caravana || a.estado || 'Activa en Campo',
        fecha_colocacion: a.fecha_colocacion || null,
        fecha_salida: a.fecha_salida || null,
        motivo_salida: a.motivo_salida || null,
        dte_numero: a.dte_numero || null,
        origen_planilla: a.origen_planilla || 'Auditoría Oficial SIGSA',
        observaciones: a.observaciones || '',
      }));

      const { error: errChunk } = await supabase
        .from('animales')
        .insert(chunk);

      if (errChunk) {
        console.error(`Error insertando bloque de animales (${i} a ${i + batchSize}):`, errChunk);
        notify?.(`Error en bloque de caravanas (${i}-${i + batchSize}): ${errChunk.message}`, 'error');
        throw errChunk;
      }
    }

    notify?.(
      'Auditoría Oficial SIGSA sincronizada con éxito: 1.600 caravanas conciliadas (430 Stock / 632 Campo / 515 Salidas / 23 Mermas).',
      'success'
    );

    if (onRefresh) {
      await onRefresh();
    }

    return { success: true, count: animales.length, cajas, animales };
  } catch (err) {
    console.error('Error sincronizando auditoria oficial en Supabase:', err);
    notify?.('Error al sincronizar auditoría oficial: ' + err.message, 'error');
    return { success: false, error: err };
  }
}
