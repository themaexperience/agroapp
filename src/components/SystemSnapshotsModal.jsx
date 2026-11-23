import React, { useState, useEffect } from 'react';
import {
  Shield,
  RotateCcw,
  Plus,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Sparkles,
  RefreshCw,
  Layers,
  ArrowRight,
  History,
} from 'lucide-react';
import {
  crearSystemSnapshot,
  listarSystemSnapshots,
  restaurarSystemSnapshot,
  eliminarSystemSnapshot,
} from '../utils/systemSnapshots';
import { formatFechaHoraCorteAR } from '../utils/dateHelper';
import HistorialAuditoriaView from './HistorialAuditoriaView.jsx';
import { confirmAction } from './ConfirmDialog.jsx';

export default function SystemSnapshotsModal({
  isOpen = false,
  onClose,
  onRestoreSuccess,
  notify,
  onNavigate,
}) {
  const [activeTab, setActiveTab] = useState('snapshots'); // 'snapshots' | 'auditoria'
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [confirmRestaurarId, setConfirmRestaurarId] = useState(null);
  const [restaurando, setRestaurando] = useState(false);
  const [progresoTexto, setProgresoTexto] = useState('');

  const cargarSnapshots = async () => {
    setLoading(true);
    try {
      const data = await listarSystemSnapshots();
      setSnapshots(data || []);
    } catch (err) {
      console.error('Error cargando snapshots:', err);
      notify?.('Error al leer la lista de puntos de restauración', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      cargarSnapshots();
      setConfirmRestaurarId(null);
      setNuevoTitulo('');
    }
  }, [isOpen]);

  const handleCrear = async (e) => {
    e?.preventDefault();
    setCreating(true);
    try {
      const nowFormatted = formatFechaHoraCorteAR(new Date());
      const tituloFinal = nuevoTitulo.trim() || `Respaldo Manual (${nowFormatted})`;
      await crearSystemSnapshot({
        titulo: tituloFinal,
        tipo: 'MANUAL',
      });
      notify?.('Punto de restauración guardado correctamente en Supabase', 'success');
      setNuevoTitulo('');
      await cargarSnapshots();
    } catch (err) {
      console.error('Error creando snapshot:', err);
      notify?.(`Error al crear punto de restauración: ${err.message || 'Error desconocido'}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleEjecutarRestauracion = async (snap) => {
    if (!snap) return;
    setRestaurando(true);
    setProgresoTexto('Iniciando restauración segura...');

    try {
      await restaurarSystemSnapshot(snap.id, (msg) => {
        setProgresoTexto(msg);
      });
      notify?.(`¡Base de datos restaurada con éxito al punto: "${snap.titulo}"!`, 'success');
      setConfirmRestaurarId(null);
      if (onRestoreSuccess) {
        await onRestoreSuccess();
      }
      onClose();
    } catch (err) {
      console.error('Fallo en la restauración:', err);
      notify?.(`Error crítico en la restauración: ${err.message || 'Revise la conexión'}`, 'error');
    } finally {
      setRestaurando(false);
      setProgresoTexto('');
    }
  };

  const handleEliminar = async (id, titulo) => {
    const ok = await confirmAction({
      title: `¿Eliminar respaldo "${titulo}"?`,
      description: 'El punto de restauración y su copia de seguridad se eliminarán definitivamente.',
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await eliminarSystemSnapshot(id);
      notify?.('Punto de restauración eliminado', 'info');
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Error eliminando snapshot:', err);
      notify?.('No se pudo eliminar el respaldo', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div
        className={`relative w-full ${
          activeTab === 'auditoria' ? 'max-w-5xl' : 'max-w-3xl'
        } max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col border border-slate-200 overflow-hidden transition-all duration-150`}
      >
        {/* ENCABEZADO */}
        <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300">
              {activeTab === 'snapshots' ? (
                <Shield className="w-5 h-5" />
              ) : (
                <History className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight flex items-center gap-2">
                Puntos de Restauración & Auditoría
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  Supabase Producción
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                Snapshots completos de las 12 tablas operativas con Airbag de seguridad y trazabilidad con Deshacer
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restaurando}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PROGRESO DE RESTAURACIÓN SI ESTÁ ACTIVO */}
        {restaurando && (
          <div className="bg-amber-500 text-amber-950 px-5 py-3 border-b border-amber-600 flex items-center gap-3 animate-pulse">
            <RefreshCw className="w-5 h-5 animate-spin shrink-0 text-amber-950" />
            <div className="text-xs">
              <span className="font-extrabold block">Restaurando base de datos en Supabase...</span>
              <span className="text-amber-900 font-medium">{progresoTexto}</span>
            </div>
          </div>
        )}

        {/* NAVEGACIÓN ENTRE SOLAPAS (SNAPSHOTS / AUDITORÍA) */}
        <div className="flex items-center px-4 pt-2.5 pb-0 bg-slate-900 border-b border-slate-700/80 shrink-0 gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('snapshots')}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-black flex items-center gap-2 border-t border-x transition cursor-pointer ${
              activeTab === 'snapshots'
                ? 'bg-white text-slate-900 border-slate-300 shadow-xs'
                : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent hover:bg-white/5'
            }`}
          >
            <Shield
              className={`w-3.5 h-3.5 ${
                activeTab === 'snapshots' ? 'text-emerald-700' : 'text-slate-400'
              }`}
            />
            <span>1. 🛡️ Puntos de Restauración (Snapshots)</span>
            {snapshots.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'snapshots'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {snapshots.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('auditoria')}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-black flex items-center gap-2 border-t border-x transition cursor-pointer ${
              activeTab === 'auditoria'
                ? 'bg-white text-slate-900 border-slate-300 shadow-xs'
                : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent hover:bg-white/5'
            }`}
          >
            <History
              className={`w-3.5 h-3.5 ${
                activeTab === 'auditoria' ? 'text-indigo-600' : 'text-slate-400'
              }`}
            />
            <span>2. 🕒 Historial de Cargas & Lotes (Deshacer)</span>
          </button>
        </div>

        {/* SOLAPA 1: PUNTOS DE RESTAURACIÓN / SNAPSHOTS */}
        {activeTab === 'snapshots' && (
          <>
            {/* BARRA SUPERIOR: CREAR NUEVO PUNTO MANUAL */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0">
              <form onSubmit={handleCrear} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  placeholder="Nota o título del punto (ej. Pre-tacto de vacas, Antes de cargar liquidación...)"
                  value={nuevoTitulo}
                  onChange={(e) => setNuevoTitulo(e.target.value)}
                  disabled={creating || restaurando}
                  className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 font-medium text-slate-800 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={creating || restaurando}
                  className="px-4 py-2 bg-emerald-800 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{creating ? 'Guardando snapshot...' : '+ Crear Punto de Restauración'}</span>
                </button>
              </form>
            </div>

            {/* LISTADO DE PUNTOS */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {loading && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-700" />
                  <span className="text-xs font-semibold">Consultando respaldos en Supabase...</span>
                </div>
              )}

              {!loading && snapshots.length === 0 && (
                <div className="py-12 text-center text-slate-400">
                  <Shield className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-bold text-slate-600">Aún no hay puntos de restauración guardados</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    Podés crear uno manualmente arriba o se generarán de forma automática antes de que el Copiloto IA aplique cambios.
                  </p>
                </div>
              )}

              {!loading &&
                snapshots.map((snap) => {
                  const meta = snap.resumen_meta || {};
                  const isConfirming = confirmRestaurarId === snap.id;
                  const fechaStr = snap.creado_en ? formatFechaHoraCorteAR(snap.creado_en) : 'Sin fecha';

                  return (
                    <div
                      key={snap.id}
                      className={`border rounded-xl p-3.5 transition ${
                        isConfirming
                          ? 'border-amber-400 bg-amber-50/70 shadow-md ring-2 ring-amber-300'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {/* BADGE DE TIPO */}
                            {snap.tipo === 'AUTO_PRE_IA' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300">
                                <Sparkles className="w-3 h-3 text-purple-600" />
                                AUTO PRE-IA (AIRBAG)
                              </span>
                            )}
                            {snap.tipo === 'PRE_RESTAURACION' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-300">
                                <RotateCcw className="w-3 h-3 text-teal-600" />
                                PRE-RESTAURACIÓN
                              </span>
                            )}
                            {snap.tipo === 'MANUAL' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300">
                                <Shield className="w-3 h-3 text-blue-600" />
                                MANUAL
                              </span>
                            )}

                            <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {fechaStr}
                            </span>
                          </div>

                          <h4 className="font-extrabold text-sm text-slate-900 leading-snug truncate">
                            {snap.titulo}
                          </h4>

                          {/* RESUMEN DE REGISTROS */}
                          <p className="text-[11px] text-slate-500 mt-1 font-medium">
                            {meta.resumen_texto || `${meta.rodeos || 0} rodeos · ${meta.cabezas || 0} cabezas`}
                          </p>
                        </div>

                        {/* BOTONES DE ACCIÓN */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          {!isConfirming ? (
                            <>
                              <button
                                type="button"
                                disabled={restaurando}
                                onClick={() => setConfirmRestaurarId(snap.id)}
                                className="px-3 py-1.5 rounded-xl border border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                                title="Restaurar toda la base de datos a este punto"
                              >
                                <RotateCcw className="w-3.5 h-3.5 text-emerald-700" />
                                <span>Restaurar</span>
                              </button>
                              <button
                                type="button"
                                disabled={restaurando}
                                onClick={() => handleEliminar(snap.id, snap.titulo)}
                                className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer disabled:opacity-50"
                                title="Eliminar este punto"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center gap-2 animate-in fade-in">
                              <button
                                type="button"
                                disabled={restaurando}
                                onClick={() => setConfirmRestaurarId(null)}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-200 transition cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                disabled={restaurando}
                                onClick={() => handleEjecutarRestauracion(snap)}
                                className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-200" />
                                <span>Confirmar Restauración</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ADVERTENCIA DE CONFIRMACIÓN EXPANDIDA */}
                      {isConfirming && (
                        <div className="mt-2.5 pt-2 border-t border-amber-200 text-[11px] text-amber-900 font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>
                            Atención: Esto sobreescribirá las 12 tablas operativas en Supabase al estado de este punto. Se guardará un respaldo de seguridad del estado actual antes de proceder.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {/* SOLAPA 2: HISTORIAL DE ACTIVIDAD & AUDITORÍA DE LOTES */}
        {activeTab === 'auditoria' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50">
            <HistorialAuditoriaView
              onRefreshParent={onRestoreSuccess}
              notify={notify}
              onNavigate={(targetTab, params) => {
                onClose();
                onNavigate?.(targetTab, params);
              }}
            />
          </div>
        )}

        {/* PIE DE MODAL */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span>
              {activeTab === 'snapshots'
                ? 'Retención automática de los últimos 20 respaldos en Supabase.'
                : 'Trazabilidad y reversión segura de lotes masivos e individuales.'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restaurando}
            className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold transition cursor-pointer disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
