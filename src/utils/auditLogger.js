import { supabase } from '../lib/supabase';

const LOCAL_STORAGE_KEY = 'san_jose_audit_logs_cache';

/**
 * Registra una operación de auditoría en la tabla `audit_logs` de Supabase
 * y mantiene sincronizada la caché local.
 */
export async function registrarAuditLog({
  tipo_operacion,
  modulo,
  descripcion,
  afectados_tabla,
  afectados_ids = [],
  snapshot_previo = null,
  metadata = {},
  usuario = 'Administración San José',
}) {
  const timestamp = new Date().toISOString();
  const logPayload = {
    timestamp,
    tipo_operacion,
    modulo,
    descripcion,
    usuario,
    afectados_tabla,
    afectados_ids: Array.isArray(afectados_ids) ? afectados_ids : [afectados_ids],
    snapshot_previo: snapshot_previo || null,
    revertido: false,
    revertido_at: null,
    metadata: metadata || {},
    created_at: timestamp,
  };

  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .insert(logPayload)
      .select()
      .single();

    if (error) {
      console.warn('No se pudo guardar audit_log en Supabase, guardando local:', error);
      saveLocalAuditLog({ ...logPayload, id: `local_${Date.now()}` });
      return { ...logPayload, id: `local_${Date.now()}` };
    }

    saveLocalAuditLog(data);
    return data;
  } catch (err) {
    console.error('Error registrando audit log:', err);
    saveLocalAuditLog({ ...logPayload, id: `local_${Date.now()}` });
    return { ...logPayload, id: `local_${Date.now()}` };
  }
}

/**
 * Guarda o actualiza en la caché de localStorage
 */
function saveLocalAuditLog(item) {
  try {
    const cached = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    const filtered = cached.filter((c) => String(c.id) !== String(item.id));
    const updated = [item, ...filtered].slice(0, 100);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

/**
 * Obtiene los registros de auditoría desde Supabase
 */
export async function obtenerAuditLogs({ limit = 100, modulo = null } = {}) {
  try {
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (modulo && modulo !== 'TODOS') {
      query = query.eq('modulo', modulo);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
      return data;
    }
  } catch (err) {
    console.warn('Error obteniendo audit_logs de Supabase, usando caché:', err);
  }

  // Fallback a caché local
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    if (modulo && modulo !== 'TODOS') {
      return local.filter((l) => l.modulo === modulo);
    }
    return local;
  } catch {
    return [];
  }
}

/**
 * Revierte / Deshace una operación masiva o lote registrado en audit_logs
 */
export async function revertirLoteAuditLog(auditLogId, auditLog) {
  if (!auditLog) throw new Error('No se proporcionaron los datos del lote de auditoría.');
  if (auditLog.revertido) throw new Error('Este lote ya fue revertido con anterioridad.');

  const { afectados_tabla, afectados_ids, snapshot_previo } = auditLog;

  // 1. Eliminar o restaurar los registros en la tabla correspondiente
  if (Array.isArray(afectados_ids) && afectados_ids.length > 0) {
    if (afectados_tabla === 'gastos_campo') {
      const { error } = await supabase.from('gastos_campo').delete().in('id', afectados_ids);
      if (error) throw error;
    } else if (afectados_tabla === 'labores_siembras') {
      const { error } = await supabase.from('labores_siembras').delete().in('id', afectados_ids);
      if (error) throw error;
    } else if (afectados_tabla === 'ventas_hacienda') {
      const { error } = await supabase.from('ventas_hacienda').delete().in('id', afectados_ids);
      if (error) throw error;
    } else if (afectados_tabla === 'balances_contables') {
      const { error } = await supabase.from('balances_contables').delete().in('id', afectados_ids);
      if (error) throw error;
    } else if (afectados_tabla === 'tareas_campo') {
      const { error } = await supabase.from('tareas_campo').delete().in('id', afectados_ids);
      if (error) throw error;
    } else if (afectados_tabla === 'alertas_mapa') {
      const { error } = await supabase.from('alertas_mapa').delete().in('id', afectados_ids);
      if (error) throw error;
    }
  }

  // Reversión de operaciones complejas con snapshot (ej. fusión de rodeos)
  if (afectados_tabla === 'rodeos' && snapshot_previo) {
    if (auditLog.tipo_operacion === 'FUSION_RODEOS') {
      const { origen, destino, eliminarOrigen } = snapshot_previo;
      // Restaurar valores de categorías del destino
      if (destino?.id) {
        await supabase
          .from('rodeos')
          .update({
            cantidad_cabezas: destino.cantidad_cabezas,
            vacas: destino.vacas,
            vaquillonas: destino.vaquillonas,
            novillos: destino.novillos,
            novillitos: destino.novillitos,
            terneros: destino.terneros,
            terneras: destino.terneras,
            toros: destino.toros,
            toritos: destino.toritos,
          })
          .eq('id', destino.id);
      }
      // Si el origen había sido eliminado o vaciado, restaurarlo
      if (origen) {
        if (eliminarOrigen) {
          const { id: _ignored, ...origenData } = origen;
          await supabase.from('rodeos').insert(origenData);
        } else {
          await supabase
            .from('rodeos')
            .update({
              cantidad_cabezas: origen.cantidad_cabezas,
              vacas: origen.vacas,
              vaquillonas: origen.vaquillonas,
              novillos: origen.novillos,
              novillitos: origen.novillitos,
              terneros: origen.terneros,
              terneras: origen.terneras,
              toros: origen.toros,
              toritos: origen.toritos,
              estado_observaciones: origen.estado_observaciones || 'Restaurado por deshacer fusión',
            })
            .eq('id', origen.id);
        }
      }
    } else if (auditLog.tipo_operacion === 'ELIMINAR_RODEO_VACIO') {
      const { rodeo } = snapshot_previo;
      if (rodeo) {
        const { id: _ignored, ...rodeoData } = rodeo;
        await supabase.from('rodeos').insert(rodeoData);
      }
    }
  }

  // 2. Marcar el log como revertido
  const revertidoAt = new Date().toISOString();
  try {
    await supabase
      .from('audit_logs')
      .update({
        revertido: true,
        revertido_at: revertidoAt,
      })
      .eq('id', auditLogId);
  } catch (err) {
    console.warn('Error actualizando estado en Supabase audit_logs:', err);
  }

  // Actualizar en caché local
  try {
    const cached = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    const updated = cached.map((c) =>
      String(c.id) === String(auditLogId)
        ? { ...c, revertido: true, revertido_at: revertidoAt }
        : c
    );
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }

  // 3. Registrar nuevo log de la acción de reversión
  await registrarAuditLog({
    tipo_operacion: 'REVERSION_LOTE',
    modulo: auditLog.modulo,
    descripcion: `Deshecha la operación "${auditLog.descripcion}" (${afectados_ids?.length || 0} registros eliminados/revertidos).`,
    afectados_tabla: auditLog.afectados_tabla,
    afectados_ids: [],
    metadata: {
      lote_original_id: auditLogId,
      operacion_original: auditLog.tipo_operacion,
      registros_eliminados: afectados_ids?.length || 0,
    },
  });

  return true;
}
