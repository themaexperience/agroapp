// Gestor de Cola Offline para Establecimiento San José
// Permite guardar pesajes, lluvias, condición corporal, sanidad, movimientos y tareas en la manga sin señal
// y sincronizar automáticamente al recuperar conexión.

const STORAGE_KEY = 'sanjose_offline_queue_v1';

export function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Error leyendo cola offline:', err);
    return [];
  }
}

export function getOfflineQueueCount() {
  try {
    return getOfflineQueue().length;
  } catch {
    return 0;
  }
}

function stripBase64Deep(val) {
  if (!val) return val;
  if (typeof val === 'string') {
    if (val.startsWith('data:image/') || (val.length > 50000 && !val.includes(' '))) {
      return null;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(stripBase64Deep);
  }
  if (typeof val === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(val)) {
      cleaned[k] = stripBase64Deep(v);
    }
    return cleaned;
  }
  return val;
}

export function saveOfflineAction(action) {
  try {
    const queue = getOfflineQueue();
    const sanitizedAction = stripBase64Deep(action);
    const item = {
      id: `offline_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...sanitizedAction,
    };
    queue.push(item);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    // Disparar evento para actualizar contadores en UI reactivamente
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sanjose_offline_queue_changed', { detail: queue.length }));
    }
    return item;
  } catch (err) {
    console.error('Error guardando acción offline:', err);
    return null;
  }
}

export function removeOfflineAction(id) {
  try {
    const queue = getOfflineQueue().filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sanjose_offline_queue_changed', { detail: queue.length }));
    }
  } catch (err) {
    console.error('Error eliminando de cola offline:', err);
  }
}

export function clearOfflineQueue() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sanjose_offline_queue_changed', { detail: 0 }));
    }
  } catch (err) {
    console.error('Error limpiando cola offline:', err);
  }
}

export async function processOfflineQueue(supabase, onProgress) {
  const queue = getOfflineQueue();
  if (!queue || queue.length === 0) return { synced: 0, failed: 0, processed: 0, remaining: 0, errors: [] };

  let synced = 0;
  let failed = 0;
  const remaining = [];
  const errors = [];

  for (const item of queue) {
    try {
      const { table, payload, operation = 'insert' } = item;
      if (!table || !payload) {
        continue;
      }

      if (operation === 'insert') {
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw error;
      } else if (operation === 'update') {
        const { matchColumn = 'id', matchValue } = item;
        const { error } = await supabase.from(table).update(payload).eq(matchColumn, matchValue);
        if (error) throw error;
      }

      synced++;
      if (onProgress) onProgress({ item, status: 'synced', remaining: queue.length - synced });
    } catch (err) {
      console.error('Error sincronizando ítem offline:', item, err);
      failed++;
      remaining.push(item);
      errors.push({ item, error: err.message });
      if (onProgress) onProgress({ item, status: 'failed', error: err.message });
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sanjose_offline_queue_changed', { detail: remaining.length }));
  }
  return { synced, failed, remaining: remaining.length, processed: synced, errors };
}

/**
 * Helper para ejecutar mutaciones en Supabase con fallback transparente a la cola offline.
 */
export async function executeWithOfflineFallback(supabase, {
  table,
  operation = 'insert',
  payload,
  matchColumn = 'id',
  matchValue,
  onLocalOptimistic,
  notify,
}) {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (isOffline) {
    const item = saveOfflineAction({ table, operation, payload, matchColumn, matchValue });
    if (onLocalOptimistic) onLocalOptimistic(payload);
    if (notify) notify('Sin señal. Acción guardada en cola local (se sincronizará automáticamente).', 'info');
    return { ok: true, offline: true, item };
  }

  try {
    if (operation === 'insert') {
      const { data, error } = await supabase.from(table).insert(payload).select();
      if (error) throw error;
      if (onLocalOptimistic) onLocalOptimistic(data?.[0] || payload);
      return { ok: true, data };
    } else if (operation === 'update') {
      const { data, error } = await supabase.from(table).update(payload).eq(matchColumn, matchValue).select();
      if (error) throw error;
      if (onLocalOptimistic) onLocalOptimistic(payload);
      return { ok: true, data };
    }
  } catch (err) {
    console.warn(`Fallo de red en ${table}, guardando en cola offline:`, err);
    const item = saveOfflineAction({ table, operation, payload, matchColumn, matchValue });
    if (onLocalOptimistic) onLocalOptimistic(payload);
    if (notify) notify('Guardado localmente en cola offline por pérdida de señal.', 'info');
    return { ok: true, offline: true, item };
  }
}
