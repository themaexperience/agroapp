import React, { useState } from 'react';
import {
  Sparkles,
  UploadCloud,
  Wrench,
  X,
  CheckCircle2,
  AlertCircle,
  Tractor,
  DollarSign,
} from 'lucide-react';
import { analizarRepuestoMaquinaria, hasGeminiKey } from '../lib/geminiService';
import { supabase } from '../lib/supabase';
import MultiFileDropzone from './MultiFileDropzone';

export default function GeminiRepuestoModal({
  isOpen = true,
  onClose,
  maquinaria = [],
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [contextoUsuario, setContextoUsuario] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [selectedMaquinariaId, setSelectedMaquinariaId] = useState('');
  const [registrarEnGastos, setRegistrarEnGastos] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const isModalOpen = isOpen !== undefined ? isOpen : true;
  if (!isModalOpen) return null;

  async function processRepuestoFile(fileToScan) {
    const file = fileToScan || selectedFiles[0] || null;
    const hasContext = Boolean(contextoUsuario && contextoUsuario.trim().length > 0);
    if (!file && !hasContext) return;
    setErrorMsg('');

    if (!hasGeminiKey()) {
      const msg = 'Falta configurar la clave API de Gemini. Abrí el Copiloto IA para cargarla o configurala en .env.';
      setErrorMsg(msg);
      notify?.(msg, 'error');
      return;
    }

    setScanning(true);
    try {
      const data = await analizarRepuestoMaquinaria(file, maquinaria, contextoUsuario);
      setParsedData(data);
      if (data.maquinaria_sugerida_id) {
        setSelectedMaquinariaId(String(data.maquinaria_sugerida_id));
      } else if (maquinaria.length > 0) {
        setSelectedMaquinariaId(String(maquinaria[0].id));
      }
      notify?.('Repuesto / service analizado con éxito por Gemini IA.', 'success');
    } catch (err) {
      setErrorMsg(`Error al procesar repuesto: ${err.message}`);
      notify?.(`Error al procesar comprobante: ${err.message}`, 'error');
    } finally {
      setScanning(false);
    }
  }

  async function handleSaveRepuesto() {
    if (!parsedData) return;
    setSaving(true);
    try {
      const maqId = selectedMaquinariaId ? Number(selectedMaquinariaId) : null;
      const cant = Number(parsedData.cantidad) || 1;
      const costo = Number(parsedData.costo_unitario) || 0;
      const totalCosto = cant * costo;
      const tc = Number(dolarRef) || 1540;

      // 1. Guardar en maquinaria_repuestos
      const { error: errRep } = await supabase.from('maquinaria_repuestos').insert({
        maquinaria_id: maqId,
        codigo_pieza: parsedData.codigo_repuesto || null,
        descripcion: parsedData.descripcion || 'Repuesto / Pieza',
        marca: parsedData.marca_repuesto || null,
        cantidad_stock: cant,
        ubicacion: 'Taller Casco',
        precio_unitario: costo,
        observaciones: `Proveedor: ${parsedData.proveedor || '-'} · Cargado con Gemini IA`,
      });
      if (errRep) throw errRep;

      // 2. Si es service preventivo, registrar en maquinaria_services
      if (parsedData.es_service_preventivo && maqId) {
        await supabase.from('maquinaria_services').insert({
          maquinaria_id: maqId,
          fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
          tipo_service: 'Mantenimiento Preventivo',
          horas_motor: parsedData.horas_o_km_sugeridos || null,
          costo_total: totalCosto,
          responsable: 'Taller San José',
          tareas_realizadas: `${parsedData.descripcion}: ${parsedData.detalle_trabajo || 'Cambio de repuesto / service'}`,
        });
      }

      // 3. Si se marcó registrar en gastos
      if (registrarEnGastos && totalCosto > 0) {
        const montoArs = parsedData.moneda === 'USD' ? totalCosto * tc : totalCosto;
        const montoUsd = parsedData.moneda === 'USD' ? totalCosto : totalCosto / tc;

        await supabase.from('gastos_campo').insert({
          fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
          rubro: 'Maquinaria / Repuestos',
          concepto: `${parsedData.descripcion} (${parsedData.codigo_repuesto || 'Repuesto'})`,
          proveedor: parsedData.proveedor || 'Proveedor Taller',
          moneda_carga: parsedData.moneda || 'ARS',
          tipo_cambio: tc,
          monto_original: totalCosto,
          monto_ars: montoArs,
          monto_usd: montoUsd,
          estado_pago: 'Pagado',
          observaciones: 'Gasto registrado automáticamente desde escáner de repuestos Gemini IA',
        });
      }

      notify?.(`¡Repuesto "${parsedData.descripcion}" registrado con éxito!`, 'success');
      setParsedData(null);
      onClose();
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al registrar repuesto: ${err.message}`, 'error');
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
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-auto">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-amber-950 text-amber-400">
              <Wrench className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-slate-900">
                  Asignador Inteligente de Repuestos & Mantenimiento
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                  Gemini IA
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Subí la foto del repuesto, caja o factura. La IA identifica la pieza y sugiere la máquina de San José.
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

        {/* Alerta de Error en Pantalla */}
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

        {/* Zona de Subida y Arrastre */}
        {!parsedData && (
          <MultiFileDropzone
            files={selectedFiles}
            onFilesChange={setSelectedFiles}
            accept="image/*,application/pdf"
            disabled={scanning}
            isProcessing={scanning}
            onProcessBatch={() => processRepuestoFile(selectedFiles[0] || null)}
            title="Arrastrá o seleccioná la foto o factura del repuesto"
            subtitle="Identifica código de pieza, fabricante (John Deere, Case, etc.) y máquina correspondiente de San José."
            processButtonText="✨ Reconocer Repuesto con IA"
            contextText={contextoUsuario}
            onContextTextChange={setContextoUsuario}
            contextPlaceholder="Ej: Filtro de aceite y combustible para tractor John Deere 6125J comprado en Agronorte por $145.000..."
            contextLabel="📝 Contexto o Aclaraciones del Repuesto para la IA"
            allowTextOnly={true}
          />
        )}

        {/* Datos Extraídos */}
        {parsedData && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Pieza / Descripción</span>
                <span className="font-extrabold text-slate-900">{parsedData.descripcion}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Código de Parte</span>
                <span className="font-mono font-bold text-amber-900">{parsedData.codigo_repuesto || 'S/N'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Fabricante / Marca</span>
                <span className="font-bold text-slate-800">{parsedData.marca_repuesto || '-'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Proveedor</span>
                <span className="font-bold text-slate-800">{parsedData.proveedor || '-'}</span>
              </div>
            </div>

            {/* Asignación de Máquina de San José */}
            <div className="p-3.5 bg-amber-50/70 rounded-xl border border-amber-200 space-y-2">
              <label className="block text-[11px] font-bold text-amber-950 uppercase">
                Asignar a Maquinaria del Establecimiento:
              </label>
              <select
                value={selectedMaquinariaId}
                onChange={(e) => setSelectedMaquinariaId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-amber-300 text-xs font-bold bg-white"
              >
                <option value="">Repuesto de uso general / Taller</option>
                {maquinaria.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.tipo} - {m.marca} {m.modelo || ''} ({m.codigo_interno || '-'})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 font-bold text-[10px] uppercase mb-1">
                  Cantidad
                </label>
                <input
                  type="number"
                  value={parsedData.cantidad}
                  onChange={(e) => setParsedData({ ...parsedData, cantidad: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-bold text-[10px] uppercase mb-1">
                  Costo Total ({parsedData.moneda})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedData.costo_unitario}
                  onChange={(e) => setParsedData({ ...parsedData, costo_unitario: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-right"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={registrarEnGastos}
                onChange={(e) => setRegistrarEnGastos(e.target.checked)}
                className="rounded border-slate-300 text-amber-600"
              />
              <span>Registrar también el gasto en <strong>Costos & Finanzas</strong> (Maquinaria/Repuestos)</span>
            </label>
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
          {parsedData && (
            <button
              type="button"
              onClick={() => setParsedData(null)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              ← Subir otra foto
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancelar
            </button>
            {parsedData && (
              <button
                type="button"
                onClick={handleSaveRepuesto}
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold shadow-sm transition disabled:opacity-40"
              >
                {saving ? 'Guardando...' : 'Asignar y Guardar en Taller'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
