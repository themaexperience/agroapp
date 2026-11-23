import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  RotateCcw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Trash2,
  Layers,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Clock,
  Sparkles,
  Info,
  DollarSign,
  Receipt,
  Sprout,
  Users,
} from 'lucide-react';
import { obtenerAuditLogs, revertirLoteAuditLog } from '../utils/auditLogger';
import { formatFechaHoraCorteAR } from '../utils/dateHelper';

export default function HistorialAuditoriaView({
  onRefreshParent,
  notify,
  onNavigate,
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [moduloFiltro, setModuloFiltro] = useState('TODOS');
  const [ocultarRevertidos, setOcultarRevertidos] = useState(false);
  const [confirmUndoModal, setConfirmUndoModal] = useState(null); // logItem to undo
  const [reverting, setReverting] = useState(false);

  // Cargar logs al montar
  useEffect(() => {
    cargarLogs();
  }, []);

  async function cargarLogs() {
    setLoading(true);
    try {
      const data = await obtenerAuditLogs({ limit: 100 });
      setLogs(data || []);
    } catch (err) {
      console.error('Error cargando audit logs:', err);
      notify?.(`Error al cargar historial: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Filtrado de logs
  const logsFiltrados = useMemo(() => {
    return logs.filter((item) => {
      if (moduloFiltro !== 'TODOS' && item.modulo !== moduloFiltro) return false;
      if (ocultarRevertidos && item.revertido) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchDesc = item.descripcion?.toLowerCase().includes(q);
        const matchTipo = item.tipo_operacion?.toLowerCase().includes(q);
        const matchTabla = item.afectados_tabla?.toLowerCase().includes(q);
        const matchUser = item.usuario?.toLowerCase().includes(q);
        if (!matchDesc && !matchTipo && !matchTabla && !matchUser) return false;
      }
      return true;
    });
  }, [logs, moduloFiltro, ocultarRevertidos, searchTerm]);

  // Métricas rápidas
  const totalActivos = logs.filter((l) => !l.revertido).length;
  const totalRevertidos = logs.filter((l) => l.revertido).length;
  const totalRegistrosAfectados = logs
    .filter((l) => !l.revertido)
    .reduce((acc, l) => acc + (Array.isArray(l.afectados_ids) ? l.afectados_ids.length : 0), 0);

  // Ejecutar reversión
  async function handleConfirmRevert() {
    if (!confirmUndoModal) return;
    setReverting(true);
    try {
      await revertirLoteAuditLog(confirmUndoModal.id, confirmUndoModal);
      notify?.(
        `✓ Lote deshecho con éxito. Se eliminaron/restauraron los registros de "${confirmUndoModal.afectados_tabla}".`,
        'success'
      );
      setConfirmUndoModal(null);
      await cargarLogs();
      if (onRefreshParent) await onRefreshParent();
    } catch (err) {
      console.error('Error al deshacer lote:', err);
      notify?.(`Error al deshacer lote: ${err.message}`, 'error');
    } finally {
      setReverting(false);
    }
  }

  // Helper para badge de módulo
  function getModuloBadge(modulo) {
    switch (modulo) {
      case 'Finanzas':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Rodeos':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'Siembras':
        return 'bg-lime-100 text-lime-800 border-lime-300';
      case 'Operaciones':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabecera Principal */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-7 text-white shadow-xl border border-indigo-500/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
              <History className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-wide text-white">
                  Historial de Cargas & Auditoría
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500 text-white">
                  Trazabilidad
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Registro inmutable de cargas masivas IA, operaciones de hacienda y siembras con opción de Deshacer en 1 clic
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={cargarLogs}
            disabled={loading}
            className="self-start md:self-auto px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center gap-2 transition border border-white/10"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar Historial</span>
          </button>
        </div>

        {/* Tarjetas de Resumen KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="bg-white/5 backdrop-blur-xs rounded-2xl p-3 border border-white/10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Operaciones</div>
            <div className="text-xl font-black text-white mt-1">{logs.length}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xs rounded-2xl p-3 border border-white/10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Lotes Activos</div>
            <div className="text-xl font-black text-emerald-400 mt-1">{totalActivos}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xs rounded-2xl p-3 border border-white/10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Lotes Deshechos</div>
            <div className="text-xl font-black text-amber-400 mt-1">{totalRevertidos}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xs rounded-2xl p-3 border border-white/10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">Registros en Base</div>
            <div className="text-xl font-black text-indigo-300 mt-1">{totalRegistrosAfectados}</div>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Buscador */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por descripción, tabla, usuario o tipo..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition"
          />
        </div>

        {/* Selector de Módulo */}
        <div className="flex flex-wrap items-center gap-2">
          {['TODOS', 'Finanzas', 'Rodeos', 'Siembras', 'Operaciones'].map((mod) => (
            <button
              key={mod}
              type="button"
              onClick={() => setModuloFiltro(mod)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                moduloFiltro === mod
                  ? 'bg-indigo-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {mod}
            </button>
          ))}

          {/* Checkbox ocultar revertidos */}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer ml-1 select-none">
            <input
              type="checkbox"
              checked={ocultarRevertidos}
              onChange={(e) => setOcultarRevertidos(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Ocultar deshechos</span>
          </label>
        </div>
      </div>

      {/* Lista de Registros de Auditoría */}
      <div className="space-y-3">
        {logsFiltrados.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 border border-slate-200 text-center shadow-xs">
            <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-700">No hay operaciones registradas</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Cada vez que cargues un lote de facturas por IA, fusiones un rodeo o registres siembras multi-potrero, aparecerá aquí con opción de reversión.
            </p>
          </div>
        ) : (
          logsFiltrados.map((log) => {
            const fechaStr = formatFechaHoraCorteAR(log.timestamp || log.created_at);
            const cantAfectados = Array.isArray(log.afectados_ids) ? log.afectados_ids.length : 0;
            const esReversible = !log.revertido && log.tipo_operacion !== 'REVERSION_LOTE' && cantAfectados > 0;

            return (
              <div
                key={log.id}
                className={`bg-white rounded-2xl p-4 sm:p-5 border transition shadow-xs ${
                  log.revertido
                    ? 'border-slate-200 bg-slate-50/70 opacity-75'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-black border ${
                        log.revertido
                          ? 'bg-slate-200 text-slate-500 border-slate-300'
                          : log.modulo === 'Finanzas'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : log.modulo === 'Rodeos'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : log.modulo === 'Siembras'
                          ? 'bg-lime-50 text-lime-700 border-lime-200'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      }`}
                    >
                      {log.modulo === 'Finanzas' ? '💰' : log.modulo === 'Rodeos' ? '🐂' : log.modulo === 'Siembras' ? '🌱' : '⚙️'}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase border ${getModuloBadge(log.modulo)}`}>
                          {log.modulo}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                          {log.tipo_operacion}
                        </span>
                        <span className="text-[11px] text-slate-400 font-medium">
                          🕒 {fechaStr}
                        </span>
                        {log.revertido ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" />
                            DESHECHO / REVERTIDO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            ACTIVO EN BASE
                          </span>
                        )}
                      </div>

                      <h4
                        className={`text-sm font-bold ${
                          log.revertido ? 'text-slate-500 line-through' : 'text-slate-900'
                        }`}
                      >
                        {log.descripcion}
                      </h4>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-0.5">
                        <span>
                          <strong>Tabla:</strong> <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] text-indigo-700 font-mono">{log.afectados_tabla}</code>
                        </span>
                        {cantAfectados > 0 && (
                          <span>
                            <strong>Registros afectados:</strong> {cantAfectados}
                          </span>
                        )}
                        <span>
                          <strong>Usuario:</strong> {log.usuario || 'San José Admin'}
                        </span>
                        {log.metadata?.total_ars && (
                          <span>
                            <strong>Monto:</strong> ${Number(log.metadata.total_ars).toLocaleString('es-AR')}
                          </span>
                        )}
                      </div>

                      {log.revertido_at && (
                        <div className="text-[11px] text-red-600 font-medium pt-1">
                          ⚠️ Revertido el {formatFechaHoraCorteAR(log.revertido_at)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Botones de Navegación Cruzada y Deshacer */}
                  <div className="self-end sm:self-center shrink-0 flex items-center gap-2 flex-wrap">
                    {onNavigate && !log.revertido && (
                      <button
                        type="button"
                        onClick={() => {
                          const mod = log.modulo;
                          if (mod === 'Finanzas') {
                            onNavigate('costos');
                          } else if (mod === 'Siembras') {
                            const firstId = Array.isArray(log.afectados_ids) ? log.afectados_ids[0] : null;
                            onNavigate('siembras', firstId ? { siembraId: firstId, action: 'edit' } : null);
                          } else if (mod === 'Rodeos') {
                            onNavigate('rodeos');
                          } else if (mod === 'Tareas') {
                            const firstId = Array.isArray(log.afectados_ids) ? log.afectados_ids[0] : null;
                            onNavigate('tareas', firstId ? { tareaId: firstId, action: 'edit' } : null);
                          } else {
                            onNavigate('inicio');
                          }
                        }}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                        title={`Ir al módulo de ${log.modulo}`}
                      >
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                        <span>Abrir en {log.modulo} →</span>
                      </button>
                    )}
                    {esReversible ? (
                      <button
                        type="button"
                        onClick={() => setConfirmUndoModal(log)}
                        className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold flex items-center gap-1.5 transition shadow-xs hover:shadow-sm cursor-pointer"
                        title="Eliminar este lote y revertir los cambios en la base de datos"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Deshacer este lote</span>
                      </button>
                    ) : log.revertido ? (
                      <span className="text-xs text-slate-400 font-bold italic px-3 py-1.5">
                        Lote deshecho
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODAL DE CONFIRMACIÓN DE DESHACER LOTE */}
      {confirmUndoModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-auto">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 border border-red-200 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-black text-slate-900">
                ¿Confirmás deshacer este lote de operaciones?
              </h3>
              <p className="text-xs text-slate-500">
                Esta acción eliminará de Supabase todos los registros creados durante esta carga masiva.
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs space-y-2">
              <div className="font-bold text-slate-900">
                {confirmUndoModal.descripcion}
              </div>
              <div className="text-slate-600 flex items-center justify-between">
                <span>Tabla afectada:</span>
                <code className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-indigo-700">
                  {confirmUndoModal.afectados_tabla}
                </code>
              </div>
              <div className="text-slate-600 flex items-center justify-between">
                <span>Registros a eliminar/restaurar:</span>
                <span className="font-bold text-red-600">
                  {Array.isArray(confirmUndoModal.afectados_ids) ? confirmUndoModal.afectados_ids.length : 0} registros
                </span>
              </div>
              <div className="text-slate-600 flex items-center justify-between">
                <span>Fecha original de carga:</span>
                <span>{formatFechaHoraCorteAR(confirmUndoModal.timestamp || confirmUndoModal.created_at)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmUndoModal(null)}
                disabled={reverting}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmRevert}
                disabled={reverting}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-2 transition shadow-md disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${reverting ? 'animate-spin' : ''}`} />
                <span>{reverting ? 'Deshaciendo lote...' : 'Confirmar y Deshacer Lote'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
