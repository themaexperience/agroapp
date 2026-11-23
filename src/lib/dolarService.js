/**
 * Servicio Centralizado de Cotizaciones del Dólar (En Vivo e Histórico)
 * Establecimiento San José · Agroganadera Rincón del Sur S.A.
 *
 * - Dólar Blue en Vivo: dolarapi.com/v1/dolares/blue (con fallback oficial y caché 30 min)
 * - Dólar Blue Histórico: api.argentinadatos.com/v1/cotizaciones/dolares/blue/{YYYY}/{MM}/{DD}
 */

const CACHE_KEY_LIVE = 'san_jose_dolar_blue_live';
const CACHE_KEY_HISTORICO = 'san_jose_dolar_blue_historico_cache';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos
const DEFAULT_BLUE_FALLBACK = 1600;

// Caché en memoria para agilizar renderizados rápidos
const memoryHistoricoCache = new Map();

/**
 * Lee la caché persistida de cotizaciones históricas
 */
function getStoredHistoricoCache() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(CACHE_KEY_HISTORICO);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Guarda en caché persistida una cotización histórica
 */
function setStoredHistoricoCache(fechaKey, data) {
  try {
    memoryHistoricoCache.set(fechaKey, data);
    if (typeof localStorage === 'undefined') return;
    const stored = getStoredHistoricoCache();
    stored[fechaKey] = data;
    localStorage.setItem(CACHE_KEY_HISTORICO, JSON.stringify(stored));
  } catch (e) {
    // ignore
  }
}

/**
 * Formatea la hora en formato HH:MM
 */
export function formatDolarTime(dateInput) {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Verifica si la última cotización guardada requiere auto-actualización diaria
 * (si es de un día anterior o tiene más de 12 horas).
 */
export function deberiaAutoActualizarDolar() {
  try {
    if (typeof localStorage === 'undefined') return true;
    // Si el usuario fijó modo manual explícito, NO autoactualizar
    if (localStorage.getItem('sanjose_dolar_manual_locked') === 'manual') {
      return false;
    }
    const raw = localStorage.getItem(CACHE_KEY_LIVE);
    if (!raw) return true;
    const cached = JSON.parse(raw);
    if (!cached || !cached.timestamp) return true;

    const lastTime = new Date(cached.timestamp);
    const now = new Date();

    // Más de 12 horas (12 * 60 * 60 * 1000 = 43200000 ms)
    if (now.getTime() - lastTime.getTime() > 12 * 60 * 60 * 1000) {
      return true;
    }

    // Día diferente
    if (
      lastTime.getDate() !== now.getDate() ||
      lastTime.getMonth() !== now.getMonth() ||
      lastTime.getFullYear() !== now.getFullYear()
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Formatea un timestamp / ISO string para display amigable en español
 */
export function formatDolarDateTime(dateInput) {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return String(dateInput);
  }
}

/**
 * Obtiene la cotización del Dólar Blue en tiempo real.
 * Guarda en localStorage con caché de 30 minutos (salvo que forceRefresh=true).
 * Fallbacks: Dólar Oficial de DolarApi -> Caché vencida -> $1.600.
 *
 * @param {boolean} forceRefresh - Si es true, ignora los 30 min y re-consulta
 * @returns {Promise<{ compra: number, venta: number, rate: number, fechaActualizacion: string, fuente: string, cached: boolean }>}
 */
export async function obtenerDolarBlueEnVivo(forceRefresh = false) {
  const now = Date.now();

  // 1. Revisar caché persistida si no se fuerza la recarga
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(CACHE_KEY_LIVE);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && cached.timestamp && now - cached.timestamp < CACHE_TTL_MS) {
          return {
            ...cached,
            cached: true,
          };
        }
      }
    } catch (e) {
      // Ignorar error de lectura de storage
    }
  }

  // 2. Consultar Dólar Blue en vivo en dolarapi.com
  let liveResult = null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3800);

    const res = await fetch('https://dolarapi.com/v1/dolares/blue', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const compra = Number(data.compra) || 0;
      const venta = Number(data.venta) || 0;
      const rate = venta > 0 ? venta : compra > 0 ? compra : DEFAULT_BLUE_FALLBACK;

      if (rate > 0) {
        liveResult = {
          compra,
          venta,
          rate,
          fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
          fuente: 'Dólar Blue en Vivo (dolarapi.com)',
          timestamp: now,
          cached: false,
        };
      }
    }
  } catch (err) {
    console.warn('[dolarService] Error consultando dolarapi.com/blue:', err?.message || err);
  }

  // 3. Fallback: Dólar Oficial si Blue falló
  if (!liveResult) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch('https://dolarapi.com/v1/dolares/oficial', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const compra = Number(data.compra) || 0;
        const venta = Number(data.venta) || 0;
        const rate = venta > 0 ? venta : compra > 0 ? compra : DEFAULT_BLUE_FALLBACK;

        if (rate > 0) {
          liveResult = {
            compra,
            venta,
            rate,
            fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
            fuente: 'Dólar Oficial (Fallback dolarapi.com)',
            timestamp: now,
            cached: false,
          };
        }
      }
    } catch (err) {
      console.warn('[dolarService] Fallback dolarapi.com/oficial falló:', err?.message || err);
    }
  }

  // 4. Si falló la red, usar caché anterior (aunque esté vencida)
  if (!liveResult) {
    try {
      const raw = localStorage.getItem(CACHE_KEY_LIVE);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && (cached.rate || cached.venta)) {
          return {
            ...cached,
            cached: true,
            fuente: `${cached.fuente || 'Dólar Blue'} (Caché Offline)`,
          };
        }
      }
    } catch {
      // ignore
    }

    // 5. Fallback final garantizado de $1.600
    liveResult = {
      compra: 1580,
      venta: DEFAULT_BLUE_FALLBACK,
      rate: DEFAULT_BLUE_FALLBACK,
      fechaActualizacion: new Date().toISOString(),
      fuente: `Dólar Ref. Contingencia ($${DEFAULT_BLUE_FALLBACK})`,
      timestamp: now,
      cached: false,
    };
  }

  // Guardar en localStorage
  try {
    localStorage.setItem(CACHE_KEY_LIVE, JSON.stringify(liveResult));
  } catch (e) {
    // ignore
  }

  return liveResult;
}

/**
 * Consulta la cotización histórica del Dólar Blue para la fecha exacta de emisión de una factura.
 * Utiliza api.argentinadatos.com/v1/cotizaciones/dolares/blue/{YYYY}/{MM}/{DD}
 *
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @param {number} fallbackRate - Tipo de cambio de respaldo (ej: dolarRef global o 1600)
 * @returns {Promise<{ rate: number, compra?: number, venta?: number, fuente: string }>}
 */
export async function obtenerDolarBlueHistorico(fecha, fallbackRate = DEFAULT_BLUE_FALLBACK) {
  const fallbackNum = Number(fallbackRate) || DEFAULT_BLUE_FALLBACK;

  if (!fecha || typeof fecha !== 'string' || fecha.length < 10) {
    return { rate: fallbackNum, fuente: 'Dólar Ref. General' };
  }

  const cleanDate = fecha.slice(0, 10);

  // 1. Revisar caché en memoria
  if (memoryHistoricoCache.has(cleanDate)) {
    return memoryHistoricoCache.get(cleanDate);
  }

  // 2. Revisar caché persistida en localStorage
  const stored = getStoredHistoricoCache();
  if (stored[cleanDate]) {
    memoryHistoricoCache.set(cleanDate, stored[cleanDate]);
    return stored[cleanDate];
  }

  // 3. Consultar api.argentinadatos.com (Dólar Blue Histórico)
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts;
    const url = `https://api.argentinadatos.com/v1/cotizaciones/dolares/blue/${yyyy}/${mm}/${dd}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const rate = Number(data.venta) || Number(data.compra);
        if (rate && rate > 0) {
          const result = {
            rate,
            compra: Number(data.compra) || rate,
            venta: Number(data.venta) || rate,
            fuente: `Dólar Blue Histórico (${cleanDate})`,
          };
          setStoredHistoricoCache(cleanDate, result);
          return result;
        }
      }
    } catch (e) {
      console.warn(`[dolarService] Fallo consulta histórica Blue para ${cleanDate}:`, e?.message || e);
    }

    // 4. Fallback secundario: Consultar oficial para esa fecha si Blue no estuviera disponible
    try {
      const ofUrl = `https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial/${yyyy}/${mm}/${dd}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const resp = await fetch(ofUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const rate = Number(data.venta) || Number(data.compra);
        if (rate && rate > 0) {
          const result = {
            rate,
            compra: Number(data.compra) || rate,
            venta: Number(data.venta) || rate,
            fuente: `BNA Oficial Histórico (${cleanDate})`,
          };
          setStoredHistoricoCache(cleanDate, result);
          return result;
        }
      }
    } catch (e) {
      // Ignorar y pasar a fallback
    }
  }

  // 5. Fallback final
  const fallbackResult = {
    rate: fallbackNum,
    fuente: `Dólar Ref. Asignado (${cleanDate})`,
  };
  setStoredHistoricoCache(cleanDate, fallbackResult);
  return fallbackResult;
}
