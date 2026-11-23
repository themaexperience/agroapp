import { obtenerDolarBlueHistorico } from '../lib/dolarService.js';

export { obtenerDolarBlueHistorico };

const CACHE_KEY = 'san_jose_dolar_historico_cache';
const memoryCache = new Map();

// Puntos de anclaje para interpolación histórica en caso de corte de internet / offline
const ANCLAJES_DOLAR_BNA = [
  { fecha: '2024-01-01', rate: 820 },
  { fecha: '2024-03-01', rate: 860 },
  { fecha: '2024-06-01', rate: 915 },
  { fecha: '2024-09-01', rate: 975 },
  { fecha: '2024-12-01', rate: 1030 },
  { fecha: '2025-03-01', rate: 1100 },
  { fecha: '2025-06-01', rate: 1180 },
  { fecha: '2025-09-01', rate: 1260 },
  { fecha: '2025-12-01', rate: 1350 },
  { fecha: '2026-03-01', rate: 1400 },
  { fecha: '2026-06-01', rate: 1450 },
  { fecha: '2026-09-01', rate: 1510 },
  { fecha: '2026-11-16', rate: 1540 },
];

function getStoredCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function setStoredCache(dateStr, rate) {
  try {
    memoryCache.set(dateStr, rate);
    const c = getStoredCache();
    c[dateStr] = rate;
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch (e) {
    // ignore
  }
}

function estimateRateByInterpolation(dateStr, fallbackRate = 1540) {
  try {
    const targetTime = new Date(dateStr).getTime();
    if (isNaN(targetTime)) return fallbackRate;

    const first = ANCLAJES_DOLAR_BNA[0];
    const last = ANCLAJES_DOLAR_BNA[ANCLAJES_DOLAR_BNA.length - 1];

    if (targetTime <= new Date(first.fecha).getTime()) return first.rate;
    if (targetTime >= new Date(last.fecha).getTime()) return last.rate;

    for (let i = 0; i < ANCLAJES_DOLAR_BNA.length - 1; i++) {
      const p1 = ANCLAJES_DOLAR_BNA[i];
      const p2 = ANCLAJES_DOLAR_BNA[i + 1];
      const t1 = new Date(p1.fecha).getTime();
      const t2 = new Date(p2.fecha).getTime();

      if (targetTime >= t1 && targetTime <= t2) {
        const factor = (targetTime - t1) / (t2 - t1);
        const interpolated = p1.rate + factor * (p2.rate - p1.rate);
        return Math.round(interpolated);
      }
    }
  } catch (err) {
    console.warn('[dolarHistorico] Error en interpolación:', err);
  }
  return fallbackRate;
}

/**
 * Obtiene la cotización del dólar a la fecha indicada (YYYY-MM-DD).
 * @param {string} fecha - Fecha formato YYYY-MM-DD
 * @param {number} fallbackRate - TdC por defecto si falla
 * @returns {Promise<{rate: number, fuente: string}>}
 */
export async function getHistoricalDollarRate(fecha, fallbackRate = 1540) {
  if (!fecha || typeof fecha !== 'string' || fecha.length < 10) {
    return { rate: Number(fallbackRate) || 1540, fuente: 'Dólar Ref. General' };
  }

  const cleanDate = fecha.slice(0, 10);

  // 1. Verificar memoria o localStorage
  if (memoryCache.has(cleanDate)) {
    return { rate: memoryCache.get(cleanDate), fuente: 'BNA Histórico (Caché)' };
  }
  const cachedMap = getStoredCache();
  if (cachedMap[cleanDate]) {
    memoryCache.set(cleanDate, cachedMap[cleanDate]);
    return { rate: cachedMap[cleanDate], fuente: 'BNA Histórico (Caché)' };
  }

  // 2. Intentar API pública ArgentinaDatos (Oficial / BNA) con timeout
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts;
    const url = `https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial/${yyyy}/${mm}/${dd}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2800);

      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const rate = Number(data.venta) || Number(data.compra);
        if (rate && rate > 0) {
          setStoredCache(cleanDate, rate);
          return { rate, fuente: `BNA Histórico Oficial (${cleanDate})` };
        }
      }
    } catch (e) {
      // Continuar al fallback
    }
  }

  // 3. Fallback interpolado oficial
  const estimated = estimateRateByInterpolation(cleanDate, fallbackRate);
  setStoredCache(cleanDate, estimated);
  return { rate: estimated, fuente: `Estimado Histórico BNA (${cleanDate})` };
}
