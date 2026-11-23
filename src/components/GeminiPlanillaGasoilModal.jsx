import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  UploadCloud,
  Fuel,
  X,
  CheckCircle2,
  AlertCircle,
  FileText,
  DollarSign,
  Plus,
  Trash2,
  RefreshCw,
  Tractor,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { analizarPlanillaGasoil, hasGeminiKey } from '../lib/geminiService';
import { supabase } from '../lib/supabase';
import MultiFileDropzone from './MultiFileDropzone';

export default function GeminiPlanillaGasoilModal({
  isOpen = true,
  onClose,
  maquinaria = [],
  insumos = [],
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Estados editables de la planilla
  const [fechaPlanilla, setFechaPlanilla] = useState('');
  const [origenTanque, setOrigenTanque] = useState('Tanque Casco Principal (10.000 L)');
  const [precioPorLitro, setPrecioPorLitro] = useState('1350');
  const [renglones, setRenglones] = useState([]);

  // Checkboxes de automatización
  const [descontarStock, setDescontarStock] = useState(true);
  const [actualizarHorometros, setActualizarHorometros] = useState(true);
  const [registrarGasto, setRegistrarGasto] = useState(true);

  const isModalOpen = isOpen !== undefined ? isOpen : true;
  if (!isModalOpen) return null;

  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;

  // Encontrar insumo de gasoil para comparar stock
  const gasoilInsumo = useMemo(() => {
    return (
      insumos.find(
        (i) =>
          i.categoria === 'Combustible' ||
          (i.nombre && i.nombre.toLowerCase().includes('gasoil'))
      ) || null
    );
  }, [insumos]);

  const stockActualLitros = Number(gasoilInsumo?.cantidad_actual) || 0;

  // Total de litros calculados de la tabla editable
  const totalLitrosCalculado = useMemo(() => {
    return renglones.reduce((acc, r) => acc + (Number(r.litros) || 0), 0);
  }, [renglones]);

  const stockRestanteEstimado = Math.max(0, stockActualLitros - totalLitrosCalculado);

  // Vincular inteligentemente la máquina del renglón con la lista de maquinaria de San José
  function encontrarMaquinariaId(nombreDetectado) {
    if (!nombreDetectado || maquinaria.length === 0) return '';
    const clean = nombreDetectado.toLowerCase().trim();
    const match = maquinaria.find((m) => {
      const nom = (m.nombre || '').toLowerCase();
      const alias = (m.otro_nombre || '').toLowerCase();
      return (
        clean.includes(nom) ||
        nom.includes(clean) ||
        (alias && (clean.includes(alias) || alias.includes(clean)))
      );
    });
    return match ? String(match.id) : '';
  }

  async function handleProcessFiles(filesList = selectedFiles) {
    const filesToRun = Array.isArray(filesList) ? filesList : [filesList];
    if (filesToRun.length === 0) return;
    setErrorMsg('');

    if (!hasGeminiKey()) {
      const msg =
        'Falta configurar la clave API de Gemini. Abrí el Copiloto IA para cargarla o configurala en .env.';
      setErrorMsg(msg);
      notify?.(msg, 'error');
      return;
    }

    setScanning(true);
    try {
      let combinedRows = [];
      let lastData = null;

      for (const file of filesToRun) {
        const data = await analizarPlanillaGasoil(file, maquinaria);
        lastData = data;
        const fDate =
          data.fecha_planilla ||
          fechaOperacion ||
          new Date().toISOString().slice(0, 10);

        const processed = (data.renglones || []).map((r, idx) => {
          const maqId = encontrarMaquinariaId(r.maquina_vehiculo);
          return {
            id: `${combinedRows.length + idx + 1}_${Date.now()}`,
            fecha: r.fecha || fDate,
            maquina_vehiculo: r.maquina_vehiculo || '',
            maquinaria_id: maqId,
            litros: Number(r.litros) || 0,
            horometro_km: r.horometro_km !== null && r.horometro_km !== undefined ? String(r.horometro_km) : '',
            labor_destino: r.labor_destino || '',
            responsable: r.responsable || '',
          };
        });
        combinedRows = combinedRows.concat(processed);
      }

      setParsedData(lastData || { renglones: combinedRows });

      const finalDate =
        lastData?.fecha_planilla ||
        fechaOperacion ||
        new Date().toISOString().slice(0, 10);
      setFechaPlanilla(finalDate);

      if (lastData?.tanque_o_origen) {
        setOrigenTanque(lastData.tanque_o_origen);
      }

      if (gasoilInsumo?.precio_unitario_ref && Number(gasoilInsumo.precio_unitario_ref) > 0) {
        setPrecioPorLitro(String(gasoilInsumo.precio_unitario_ref));
      }

      setRenglones(combinedRows);
      notify?.(
        `Planilla(s) de gasoil analizada(s) con éxito (${combinedRows.length} despachos detectados).`,
        'success'
      );
    } catch (err) {
      console.error('Error analizando planilla de gasoil:', err);
      setErrorMsg(`Error al procesar planilla: ${err.message}`);
      notify?.(`Error al procesar comprobante: ${err.message}`, 'error');
    } finally {
      setScanning(false);
    }
  }

  function handleAddRenglon() {
    setRenglones((prev) => [
      ...prev,
      {
        id: Date.now(),
        fecha: fechaPlanilla || new Date().toISOString().slice(0, 10),
        maquina_vehiculo: '',
        maquinaria_id: maquinaria[0] ? String(maquinaria[0].id) : '',
        litros: 0,
        horometro_km: '',
        labor_destino: 'Labores de campo',
        responsable: 'Operario San José',
      },
    ]);
  }

  function handleUpdateRenglon(idx, field, value) {
    setRenglones((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      if (field === 'maquinaria_id') {
        const maq = maquinaria.find((m) => String(m.id) === String(value));
        if (maq) {
          copy[idx].maquina_vehiculo = maq.nombre;
        }
      }
      return copy;
    });
  }

  function handleRemoveRenglon(idx) {
    setRenglones((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleConfirmPlanilla() {
    if (renglones.length === 0) {
      notify?.('No hay renglones de combustible para procesar.', 'error');
      return;
    }

    setSaving(true);
    try {
      const precio = Number(precioPorLitro) || 1350;
      const montoTotalArs = Math.round(totalLitrosCalculado * precio);
      const montoTotalUsd = Math.round((montoTotalArs / tc) * 100) / 100;
      const fPlanilla = fechaPlanilla || new Date().toISOString().slice(0, 10);

      // 1. Descontar stock y registrar movimientos
      if (descontarStock) {
        let insumoTarget = gasoilInsumo;
        if (!insumoTarget) {
          const { data: dbInsumos } = await supabase
            .from('stock_insumos')
            .select('*')
            .eq('categoria', 'Combustible')
            .limit(1);
          if (dbInsumos && dbInsumos.length > 0) {
            insumoTarget = dbInsumos[0];
          }
        }

        if (insumoTarget) {
          const nuevoStock = Math.max(
            0,
            (Number(insumoTarget.cantidad_actual) || 0) - totalLitrosCalculado
          );
          const { error: errStock } = await supabase
            .from('stock_insumos')
            .update({
              cantidad_actual: nuevoStock,
              updated_at: new Date().toISOString(),
            })
            .eq('id', insumoTarget.id);

          if (errStock) throw errStock;

          // Registrar movimientos detallados
          const insertsMov = renglones.map((r) => ({
            insumo_id: insumoTarget.id,
            tipo: 'Consumo / Egreso',
            cantidad: Number(r.litros) || 0,
            fecha: r.fecha || fPlanilla,
            destino: r.labor_destino || 'Consumo combustible operativo',
            maquinaria_id: r.maquinaria_id ? Number(r.maquinaria_id) : null,
            responsable: r.responsable || null,
            observaciones: `Planilla Gasoil: ${origenTanque} · ${r.maquina_vehiculo || 'Equipo'}${r.horometro_km ? ` (Hs/Km: ${r.horometro_km})` : ''}`,
          }));

          if (insertsMov.length > 0) {
            const { error: errMov } = await supabase
              .from('movimientos_insumos')
              .insert(insertsMov);
            if (errMov) console.warn('Aviso en movimientos_insumos:', errMov);
          }
        }
      }

      // 2. Actualizar horómetros en maquinaria
      if (actualizarHorometros) {
        for (const r of renglones) {
          if (r.maquinaria_id && r.horometro_km) {
            await supabase
              .from('maquinaria')
              .update({ horas_km_actuales: String(r.horometro_km) })
              .eq('id', Number(r.maquinaria_id));
          }
        }
      }

      // 3. Registrar gasto en gastos_campo
      if (registrarGasto) {
        const { error: errGasto } = await supabase.from('gastos_campo').insert({
          fecha: fPlanilla,
          rubro: 'Combustibles y Lubricantes',
          concepto: `Consumo Gasoil - Planilla ${fPlanilla} (${totalLitrosCalculado.toLocaleString('es-AR')} L)`,
          proveedor: origenTanque || 'Tanque Casco San José',
          comprobante: `Planilla Combustible ${fPlanilla}`,
          moneda_carga: 'ARS',
          tipo_cambio: tc,
          monto_original: montoTotalArs,
          monto_ars: montoTotalArs,
          monto_usd: montoTotalUsd,
          observaciones: `Carga automática con Gemini IA (${renglones.length} despachos). Detalle: ${renglones.map((r) => `${r.maquina_vehiculo}: ${r.litros}L`).join('; ')}`,
        });
        if (errGasto) throw errGasto;
      }

      notify?.(
        `⛽ Planilla de gasoil procesada: ${totalLitrosCalculado.toLocaleString('es-AR')} L descontados y registrados correctamente.`,
        'success'
      );
      await onRefresh?.();
      onClose?.();
    } catch (err) {
      console.error('Error al procesar planilla de gasoil:', err);
      notify?.(`Error al procesar planilla: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const modalContent = (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-amber-950 to-slate-900 text-white flex items-center justify-between border-b border-amber-900/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500 text-slate-950 shadow-md">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-white">
                  Escáner IA de Planillas de Gasoil
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  Gemini IA
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Lectura inteligente de libretas de campo, vales y planillas de surtidor con actualización de stock y horómetros.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensaje de Error */}
        {errorMsg && (
          <div className="p-3 bg-red-50 border-b border-red-200 text-red-800 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="p-1 text-red-500 hover:text-red-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Cuerpo del Modal */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {!parsedData ? (
            /* ZONA DE CARGA INICIAL CON SELECCIÓN MÚLTIPLE Y DRAG & DROP */
            <div className="space-y-4">
              <MultiFileDropzone
                files={selectedFiles}
                onFilesChange={setSelectedFiles}
                accept="image/*,application/pdf,text/csv"
                disabled={scanning}
                isProcessing={scanning}
                onProcessBatch={() => handleProcessFiles(selectedFiles)}
                title="Arrastrá o seleccioná una o varias fotos / páginas de libreta de combustible"
                subtitle="Gemini IA extraerá automáticamente fechas, vehículos, litros, horómetros y tareas realizadas de todos los comprobantes."
                processButtonText="✨ Analizar Planilla(s) con IA"
              />
            </div>
          ) : (
            /* VISTA DE DATOS DETECTADOS Y TABLA EDITABLE */
            <div className="space-y-5">
              {/* Resumen Superior e Impacto en Tanque */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Fecha de Planilla
                  </span>
                  <input
                    type="date"
                    value={fechaPlanilla}
                    onChange={(e) => setFechaPlanilla(e.target.value)}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  />
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Tanque u Origen
                  </span>
                  <input
                    type="text"
                    value={origenTanque}
                    onChange={(e) => setOrigenTanque(e.target.value)}
                    placeholder="Tanque Casco Principal"
                    className="w-full mt-1 px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  />
                </div>

                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                    Total Litros Despachados
                  </span>
                  <div className="text-xl font-black text-amber-950 mt-1">
                    {totalLitrosCalculado.toLocaleString('es-AR')}{' '}
                    <span className="text-xs font-bold text-amber-700">Lts</span>
                  </div>
                  <div className="text-[10px] text-amber-700 font-semibold mt-0.5">
                    {renglones.length} renglones computados
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-900 text-white border border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Stock Tanque Proyectado
                  </span>
                  <div className="text-xl font-black text-amber-300 mt-1">
                    {stockRestanteEstimado.toLocaleString('es-AR')}{' '}
                    <span className="text-xs font-bold text-slate-400">Lts</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Actual: {stockActualLitros.toLocaleString('es-AR')} Lts
                  </div>
                </div>
              </div>

              {/* Selector de Precio Ref para Costos */}
              <div className="p-3 bg-amber-50/70 rounded-2xl border border-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-amber-800" />
                  <span className="font-extrabold text-slate-800">Precio Gasoil de Referencia:</span>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-500">$</span>
                    <input
                      type="number"
                      step="1"
                      value={precioPorLitro}
                      onChange={(e) => setPrecioPorLitro(e.target.value)}
                      className="w-24 px-2 py-1 rounded-lg border border-amber-300 bg-white font-black text-xs text-slate-900"
                    />
                    <span className="font-bold text-slate-500">/ litro ARS</span>
                  </div>
                </div>
                <div className="text-slate-600 font-medium">
                  Costo total estimado:{' '}
                  <strong className="text-slate-900">
                    ${Math.round(totalLitrosCalculado * (Number(precioPorLitro) || 1350)).toLocaleString('es-AR')} ARS
                  </strong>{' '}
                  (≈ USD {Math.round((totalLitrosCalculado * (Number(precioPorLitro) || 1350)) / tc).toLocaleString('es-AR')})
                </div>
              </div>

              {/* Tabla Editable de Renglones */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Tractor className="w-4 h-4 text-amber-600" />
                    Detalle de Despachos por Máquina / Vehículo
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddRenglon}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs inline-flex items-center gap-1 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Agregar Renglón
                  </button>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-x-auto shadow-xs">
                  <table className="w-full text-left text-xs text-slate-800 border-collapse min-w-[760px]">
                    <thead>
                      <tr className="bg-slate-100/90 text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3 w-32">Fecha</th>
                        <th className="py-2.5 px-3 w-56">Máquina / Vehículo</th>
                        <th className="py-2.5 px-3 w-24">Litros</th>
                        <th className="py-2.5 px-3 w-28">Horómetro / Km</th>
                        <th className="py-2.5 px-3">Labor / Destino</th>
                        <th className="py-2.5 px-3 w-36">Responsable</th>
                        <th className="py-2.5 px-3 w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {renglones.map((reng, idx) => (
                        <tr key={reng.id || idx} className="hover:bg-amber-50/30 transition">
                          <td className="py-2 px-3 text-center text-slate-400 font-bold">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="date"
                              value={reng.fecha}
                              onChange={(e) => handleUpdateRenglon(idx, 'fecha', e.target.value)}
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white font-medium"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <select
                              value={reng.maquinaria_id}
                              onChange={(e) => handleUpdateRenglon(idx, 'maquinaria_id', e.target.value)}
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white font-bold text-slate-900"
                            >
                              <option value="">-- Sin asignar / Otro --</option>
                              {maquinaria.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.nombre} {m.categoria ? `(${m.categoria.slice(0, 12)}...)` : ''}
                                </option>
                              ))}
                            </select>
                            {!reng.maquinaria_id && (
                              <input
                                type="text"
                                placeholder="Nombre detectado..."
                                value={reng.maquina_vehiculo}
                                onChange={(e) => handleUpdateRenglon(idx, 'maquina_vehiculo', e.target.value)}
                                className="w-full mt-1 px-2 py-0.5 rounded border border-slate-200 text-[11px]"
                              />
                            )}
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              step="0.5"
                              value={reng.litros}
                              onChange={(e) => handleUpdateRenglon(idx, 'litros', e.target.value)}
                              className="w-full px-2 py-1 rounded-lg border border-amber-300 bg-amber-50/50 font-black text-xs text-amber-950 text-right"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              placeholder="Ej: 1450 hs"
                              value={reng.horometro_km}
                              onChange={(e) => handleUpdateRenglon(idx, 'horometro_km', e.target.value)}
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white font-mono"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              placeholder="Labor o potrero..."
                              value={reng.labor_destino}
                              onChange={(e) => handleUpdateRenglon(idx, 'labor_destino', e.target.value)}
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              placeholder="Chofer..."
                              value={reng.responsable}
                              onChange={(e) => handleUpdateRenglon(idx, 'responsable', e.target.value)}
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white"
                            />
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRenglon(idx)}
                              className="p-1 rounded text-slate-400 hover:text-red-600 transition"
                              title="Eliminar renglón"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Opciones de Automatización */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 block">
                  Acciones automáticas al confirmar
                </span>
                <label className="flex items-center gap-2.5 text-xs text-slate-800 font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={descontarStock}
                    onChange={(e) => setDescontarStock(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span>
                    Descontar {totalLitrosCalculado.toLocaleString('es-AR')} Litros del stock de Gasoil en{' '}
                    <code>stock_insumos</code> y registrar cada despacho en <code>movimientos_insumos</code>.
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-800 font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={actualizarHorometros}
                    onChange={(e) => setActualizarHorometros(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span>
                    Actualizar las horas/km actuales en la ficha de cada tractor/vehículo de <code>maquinaria</code>.
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-800 font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={registrarGasto}
                    onChange={(e) => setRegistrarGasto(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span>
                    Registrar el costo total (${Math.round(totalLitrosCalculado * (Number(precioPorLitro) || 1350)).toLocaleString('es-AR')} ARS) en{' '}
                    <code>gastos_campo</code> bajo el rubro <em>"Combustibles y Lubricantes"</em>.
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Pie del Modal */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {parsedData ? (
            <button
              type="button"
              onClick={() => {
                setParsedData(null);
                setRenglones([]);
              }}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 transition"
            >
              ← Subir otra planilla
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
            >
              Cancelar
            </button>

            {parsedData && (
              <button
                type="button"
                onClick={handleConfirmPlanilla}
                disabled={saving || totalLitrosCalculado <= 0}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs shadow-md transition disabled:opacity-40 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Guardando en San José...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>Confirmar y Procesar Planilla Gasoil</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}
