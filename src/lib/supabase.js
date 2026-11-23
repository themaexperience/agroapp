import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const SUPABASE_URL =
  env.VITE_SUPABASE_URL ||
  'https://btruytfuiwrgyzrkkxat.supabase.co';

const SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cnV5dGZ1aXdyZ3l6cmtreGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2MDM0MTcsImV4cCI6MjExMDE3OTQxN30.1sqEEI70CLRWUDCG3SG6zjPdpRCoGH7Nt1og2ZW3CYk';

const rawSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE_TO_SANDBOX_KEY = {
  rodeos: 'rodeos',
  potreros: 'potreros',
  molinos: 'molinos',
  infraestructura: 'infraestructura',
  alertas_mapa: 'alertasMapa',
  alertasMapa: 'alertasMapa',
  caminos: 'caminos',
  tareas_campo: 'tareas',
  tareas: 'tareas',
  movimientos_hacienda: 'movimientosHacienda',
  movimientos_ganaderos: 'movimientosHacienda',
  movimientosGanaderos: 'movimientosHacienda',
  eventos_sanitarios: 'eventosSanitarios',
  animales: 'animales',
  cajas_caravanas: 'cajasCaravanas',
  labores_siembras: 'laboresSiembras',
  siembras: 'laboresSiembras',
  bitacora_notas: 'bitacoraNotas',
  gastos_campo: 'gastosCampo',
  gastos: 'gastosCampo',
  ventas_hacienda: 'ventasHacienda',
  ventas: 'ventasHacienda',
  maquinaria: 'maquinaria',
  maquinaria_repuestos: 'maquinariaRepuestos',
  maquinaria_services: 'maquinariaServices',
  campanas_kpis: 'campanasKpis',
  campanasKpis: 'campanasKpis',
  stock_insumos: 'stockInsumos',
  insumos: 'stockInsumos',
  movimientos_insumos: 'movimientosInsumos',
  registros_lluvias: 'registrosLluvias',
  lluvias: 'registrosLluvias',
  balances_contables: 'balancesContables',
  system_snapshots: 'systemSnapshots',
  audit_logs: 'auditLogs',
};

function isSandboxActive() {
  try {
    return typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true';
  } catch {
    return false;
  }
}

function getSandboxData() {
  try {
    const raw = localStorage.getItem('san_jose_sandbox_data');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSandboxData(data) {
  try {
    localStorage.setItem('san_jose_sandbox_data', JSON.stringify(data));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('san_jose_sandbox_changed', {
          detail: { timestamp: Date.now() },
        })
      );
    }
  } catch (e) {
    console.warn('Error guardando datos en Modo Sandbox:', e);
  }
}

function createSandboxQueryBuilder(tableName) {
  const sKey = TABLE_TO_SANDBOX_KEY[tableName] || tableName;

  let currentOp = 'select'; // 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  let payload = null;
  const filters = []; // [{ type: 'eq', col, val }, { type: 'in', col, vals }]
  let orderCol = null;
  let orderAsc = true;
  let limitVal = null;

  const execute = async () => {
    const sandboxData = getSandboxData();
    let items = Array.isArray(sandboxData[sKey]) ? [...sandboxData[sKey]] : [];

    if (currentOp === 'delete') {
      const prevLen = items.length;
      items = items.filter((item) => {
        for (const f of filters) {
          if (f.type === 'eq' && String(item[f.col]) === String(f.val)) return false;
          if (
            f.type === 'in' &&
            Array.isArray(f.vals) &&
            f.vals.map(String).includes(String(item[f.col]))
          )
            return false;
        }
        return true;
      });
      sandboxData[sKey] = items;
      saveSandboxData(sandboxData);
      return { data: null, error: null, count: prevLen - items.length };
    }

    if (currentOp === 'update') {
      let matchedCount = 0;
      items = items.map((item) => {
        let matches = true;
        for (const f of filters) {
          if (f.type === 'eq' && String(item[f.col]) !== String(f.val)) matches = false;
          if (
            f.type === 'in' &&
            Array.isArray(f.vals) &&
            !f.vals.map(String).includes(String(item[f.col]))
          )
            matches = false;
        }
        if (matches) {
          matchedCount++;
          return { ...item, ...payload };
        }
        return item;
      });
      sandboxData[sKey] = items;
      saveSandboxData(sandboxData);
      return {
        data: items.filter((i) =>
          filters.some((f) => f.type === 'eq' && String(i[f.col]) === String(f.val))
        ),
        error: null,
      };
    }

    if (currentOp === 'insert') {
      const records = Array.isArray(payload) ? payload : [payload];
      const newItems = records.map((rec) => ({
        id:
          rec.id ||
          (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sbx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`),
        creado_en: rec.creado_en || new Date().toISOString(),
        ...rec,
      }));
      items = [...items, ...newItems];
      sandboxData[sKey] = items;
      saveSandboxData(sandboxData);
      return { data: Array.isArray(payload) ? newItems : newItems[0], error: null };
    }

    if (currentOp === 'upsert') {
      const records = Array.isArray(payload) ? payload : [payload];
      records.forEach((rec) => {
        const id =
          rec.id ||
          (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sbx_${Date.now()}`);
        const idx = items.findIndex((i) => String(i.id) === String(id));
        if (idx >= 0) {
          items[idx] = { ...items[idx], ...rec };
        } else {
          items.push({ id, ...rec });
        }
      });
      sandboxData[sKey] = items;
      saveSandboxData(sandboxData);
      return { data: payload, error: null };
    }

    // Default: 'select'
    let result = items.filter((item) => {
      for (const f of filters) {
        if (f.type === 'eq' && String(item[f.col]) !== String(f.val)) return false;
        if (
          f.type === 'in' &&
          Array.isArray(f.vals) &&
          !f.vals.map(String).includes(String(item[f.col]))
        )
          return false;
      }
      return true;
    });

    if (orderCol) {
      result.sort((a, b) => {
        if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1;
        if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1;
        return 0;
      });
    }

    if (limitVal != null) {
      result = result.slice(0, limitVal);
    }

    return { data: result, error: null };
  };

  const builder = {
    select(cols) {
      return builder;
    },
    insert(data) {
      currentOp = 'insert';
      payload = data;
      return builder;
    },
    update(data) {
      currentOp = 'update';
      payload = data;
      return builder;
    },
    upsert(data) {
      currentOp = 'upsert';
      payload = data;
      return builder;
    },
    delete() {
      currentOp = 'delete';
      return builder;
    },
    eq(col, val) {
      filters.push({ type: 'eq', col, val });
      return builder;
    },
    in(col, vals) {
      filters.push({ type: 'in', col, vals });
      return builder;
    },
    order(col, opts = {}) {
      orderCol = col;
      orderAsc = opts.ascending !== false;
      return builder;
    },
    limit(val) {
      limitVal = val;
      return builder;
    },
    single() {
      return execute().then((res) => ({
        data: Array.isArray(res.data) ? res.data[0] || null : res.data,
        error: res.error,
      }));
    },
    maybeSingle() {
      return execute().then((res) => ({
        data: Array.isArray(res.data) ? res.data[0] || null : res.data,
        error: res.error,
      }));
    },
    then(onFulfilled, onRejected) {
      return execute().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return execute().catch(onRejected);
    },
  };

  return builder;
}

export const supabase = new Proxy(rawSupabase, {
  get(target, prop, receiver) {
    if (prop === 'from') {
      return function (tableName) {
        if (isSandboxActive()) {
          return createSandboxQueryBuilder(tableName);
        }
        return target.from(tableName);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

export { SUPABASE_URL };
export default supabase;
