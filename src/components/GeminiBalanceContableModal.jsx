import React, { useState } from 'react';
import {
  FileText,
  UploadCloud,
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  Building,
  DollarSign,
  TrendingUp,
  Boxes,
  PieChart,
  Calendar,
  Save,
} from 'lucide-react';
import { hasGeminiKey, analizarBalanceContablePdf } from '../lib/geminiService';
import { supabase } from '../lib/supabase';
import { registrarAuditLog } from '../utils/auditLogger';

export default function GeminiBalanceContableModal({
  isOpen = true,
  onClose,
  onRefresh,
  notify,
}) {
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [balanceData, setBalanceData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState('resultados'); // 'resultados' | 'hacienda' | 'gastos'

  if (!isOpen) return null;

  async function processFile(file) {
    if (!file) return;
    setErrorMsg('');

    if (!hasGeminiKey()) {
      const msg = 'Falta configurar la clave API de Gemini para procesar documentos PDF.';
      setErrorMsg(msg);
      notify?.(msg, 'error');
      return;
    }

    setScanning(true);
    setProgress({ current: 1, total: 1, phase: 'Iniciando análisis...' });

    try {
      const parsed = await analizarBalanceContablePdf(file, ({ current, total, phase }) => {
        setProgress({
          current,
          total,
          phase: phase === 'slicing' ? 'Extrayendo páginas del PDF...' : `Analizando página ${current} de ${total}...`,
        });
      });

      setBalanceData(parsed);
      notify?.(`Balance de ejercicio ${parsed.ejercicio} auditado y extraído con éxito.`, 'success');
    } catch (err) {
      console.error('[GeminiBalanceModal] Error:', err);
      setErrorMsg(`Error al procesar balance: ${err.message}`);
      notify?.(`No se pudo procesar el balance: ${err.message}`, 'error');
    } finally {
      setScanning(false);
    }
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    await processFile(file);
    if (e.target) e.target.value = '';
  }

  function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const file = (e.dataTransfer?.files || e.target?.files)?.[0];
    processFile(file);
    if (e.target) e.target.value = '';
  }

  async function handleSaveBalance() {
    if (!balanceData) return;
    setSaving(true);
    try {
      const { data: insertedBal, error } = await supabase
        .from('balances_contables')
        .insert({
          ejercicio: balanceData.ejercicio,
          fecha_inicio: balanceData.fecha_inicio,
          fecha_cierre: balanceData.fecha_cierre,
          razon_social: balanceData.razon_social,
          cuit: balanceData.cuit,
          estado_resultado: balanceData.estado_resultado || {},
          bienes_de_cambio: balanceData.bienes_de_cambio || {},
          rubros_gastos: balanceData.rubros_gastos || [],
          observaciones: balanceData.notas_estudio_contable || null,
          archivo_nombre: balanceData.archivo_nombre || 'Balance.pdf',
        })
        .select('id')
        .single();

      if (error) throw error;

      // Registrar auditoría
      try {
        await registrarAuditLog({
          tipo_operacion: 'BALANCE_CONTABLE',
          modulo: 'Finanzas',
          descripcion: `Importación Balance Contable Ejercicio ${balanceData.ejercicio} (${balanceData.archivo_nombre || 'PDF'})`,
          afectados_tabla: 'balances_contables',
          afectados_ids: insertedBal?.id ? [insertedBal.id] : [],
          metadata: {
            ejercicio: balanceData.ejercicio,
            archivo: balanceData.archivo_nombre,
          },
        });
      } catch (logErr) {
        console.warn('Error guardando audit log balance:', logErr);
      }

      notify?.(`¡Balance ${balanceData.ejercicio} guardado en el archivo histórico!`, 'success');
      onRefresh?.();
      onClose();
    } catch (err) {
      notify?.(`Error al guardar balance: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="fixed inset-0 z-[9999] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-auto max-h-[92vh] flex flex-col">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-950 text-indigo-400">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-slate-900">
                  Importador de Balances Contables Anuales
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-900 border border-indigo-200">
                  Estudio Contable (Agosto–Julio)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Procesá el PDF completo de Estados Contables. La IA audita el Estado de Resultados, Bienes de Cambio (Hacienda al 31/07) y Gastos cerrados.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensaje de error */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="text-red-500 hover:text-red-700 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Zona de Carga de Archivo */}
        {!balanceData && (
          <div
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={handleFileDrop}
            className="p-8 rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50 text-center transition cursor-pointer relative"
          >
            <input
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,image/*"
              onChange={handleFileSelect}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleFileDrop}
              disabled={scanning}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
            />
            <div className="flex flex-col items-center justify-center gap-2.5 pointer-events-none">
              <UploadCloud className="w-12 h-12 text-indigo-700" />
              <div className="text-sm font-extrabold text-indigo-950">
                {scanning ? progress.phase : 'Hacé clic o arrastrá el PDF del Balance del Estudio Contable'}
              </div>
              <p className="text-xs text-slate-500 max-w-md">
                Soporta balances completos multipágina. Se particionarán y leerán todas las memorias, estados de situación patrimonial y anexos.
              </p>
              <div className="mt-2">
                <span className="px-4 py-2 rounded-xl bg-indigo-900 text-white text-xs font-black shadow-sm inline-flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  {scanning ? 'Auditando Estados Contables...' : 'Seleccionar Balance (PDF)'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Resultados del Balance Auditado */}
        {balanceData && (
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Header del Ejercicio */}
            <div className="p-4 bg-slate-900 text-white rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-indigo-300 block">
                  Ejercicio Agropecuario Auditado
                </span>
                <h4 className="text-xl font-black text-white mt-0.5">
                  Ejercicio {balanceData.ejercicio}
                </h4>
                <p className="text-xs text-slate-300">
                  Período: {balanceData.fecha_inicio} al {balanceData.fecha_cierre} · {balanceData.razon_social} (CUIT: {balanceData.cuit})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBalanceData(null)}
                  className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 hover:text-white"
                >
                  Cargar Otro Archivo
                </button>
              </div>
            </div>

            {/* Selector de Sub-Pestañas */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('resultados')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                  activeTab === 'resultados'
                    ? 'bg-indigo-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                📊 Estado de Resultados
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('hacienda')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                  activeTab === 'hacienda'
                    ? 'bg-indigo-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                🐂 Bienes de Cambio (Hacienda al 31/07)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('gastos')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                  activeTab === 'gastos'
                    ? 'bg-indigo-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                📑 Rubros de Gastos Cerrados ({balanceData.rubros_gastos?.length || 0})
              </button>
            </div>

            {/* TAB 1: Estado de Resultados */}
            {activeTab === 'resultados' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl border border-slate-200 bg-emerald-50/50">
                    <span className="text-[10px] font-black uppercase text-emerald-800 block">
                      Ventas de Hacienda
                    </span>
                    <span className="text-lg font-black text-slate-900 mt-1 block">
                      ${Number(balanceData.estado_resultado?.ventas_hacienda_ars || 0).toLocaleString('es-AR')}
                    </span>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-amber-50/50">
                    <span className="text-[10px] font-black uppercase text-amber-800 block">
                      Costo de Producción / Ventas
                    </span>
                    <span className="text-lg font-black text-slate-900 mt-1 block">
                      ${Number(balanceData.estado_resultado?.costo_ventas_hacienda_ars || 0).toLocaleString('es-AR')}
                    </span>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-indigo-50/50">
                    <span className="text-[10px] font-black uppercase text-indigo-900 block">
                      Resultado del Ejercicio
                    </span>
                    <span className={`text-lg font-black mt-1 block ${Number(balanceData.estado_resultado?.resultado_ejercicio_ars) >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                      ${Number(balanceData.estado_resultado?.resultado_ejercicio_ars || 0).toLocaleString('es-AR')}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                  <h5 className="font-extrabold text-slate-800 uppercase text-[11px]">
                    Desglose de Gastos Operativos Cerrados:
                  </h5>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-600">Gastos de Comercialización:</span>
                    <span className="font-black text-slate-900">
                      ${Number(balanceData.estado_resultado?.gastos_comercializacion_ars || 0).toLocaleString('es-AR')}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-600">Gastos de Administración y Estructura:</span>
                    <span className="font-black text-slate-900">
                      ${Number(balanceData.estado_resultado?.gastos_administracion_ars || 0).toLocaleString('es-AR')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Bienes de Cambio / Hacienda */}
            {activeTab === 'hacienda' && (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase text-amber-900 block">
                      Stock de Hacienda al Cierre ({balanceData.fecha_cierre})
                    </span>
                    <span className="text-xl font-black text-slate-900 mt-0.5 block">
                      {Number(balanceData.bienes_de_cambio?.total_cabezas_cierre || 0).toLocaleString('es-AR')} Cabezas
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-500 block">Valuación Fiscal Total</span>
                    <span className="text-lg font-black text-slate-900">
                      ${Number(balanceData.bienes_de_cambio?.valuacion_hacienda_ars || 0).toLocaleString('es-AR')}
                    </span>
                  </div>
                </div>

                {/* Tabla de Categorías de Hacienda */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Categoría</th>
                        <th className="p-2.5 text-right">Cabezas</th>
                        <th className="p-2.5 text-right">Valuación Unitaria</th>
                        <th className="p-2.5 text-right">Total ($ ARS)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(balanceData.bienes_de_cambio?.detalle_categorias || []).map((cat, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-slate-900">{cat.categoria}</td>
                          <td className="p-2.5 text-right font-black">{cat.cabezas}</td>
                          <td className="p-2.5 text-right text-slate-600">
                            ${Number(cat.valuacion_unitaria_ars || 0).toLocaleString('es-AR')}
                          </td>
                          <td className="p-2.5 text-right font-black text-slate-900">
                            ${Number(cat.total_ars || 0).toLocaleString('es-AR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: Rubros de Gastos Cerrados */}
            {activeTab === 'gastos' && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="p-2.5">Rubro Contable</th>
                      <th className="p-2.5 text-right">Monto Cerrado ($ ARS)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(balanceData.rubros_gastos || []).map((rg, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-900">{rg.rubro}</td>
                        <td className="p-2.5 text-right font-black text-slate-900">
                          ${Number(rg.monto_ars || 0).toLocaleString('es-AR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            {balanceData
              ? `Archivo: ${balanceData.archivo_nombre}`
              : 'Seleccioná un archivo PDF para comenzar.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cerrar
            </button>
            {balanceData && (
              <button
                type="button"
                onClick={handleSaveBalance}
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white text-xs font-extrabold shadow-sm transition inline-flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Guardando en Supabase...' : 'Guardar Balance en Historial'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
