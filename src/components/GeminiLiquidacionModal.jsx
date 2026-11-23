import React, { useState } from 'react';
import {
  Sparkles,
  Scale,
  X,
  CheckCircle2,
  AlertCircle,
  FileText,
  DollarSign,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  Undo2,
  Layers,
} from 'lucide-react';
import {
  analizarLiquidacionHacienda,
  analizarLiquidacionMultipage,
  analizarLoteLiquidacionesHacienda,
  hasGeminiKey,
} from '../lib/geminiService';
import { supabase } from '../lib/supabase';
import { isPdfFile, slicePdfToImages } from '../lib/pdfSlicer.js';
import { registrarAuditLog } from '../utils/auditLogger';
import MultiFileDropzone from './MultiFileDropzone';

const CATEGORIAS_HACIENDA = [
  'Vacas',
  'Vacas CUT',
  'Terneros',
  'Terneras',
  'Terneros/as',
  'Vaquillonas',
  'Toros',
  'Toritos',
  'Novillos',
  'Hacienda General',
];

export default function GeminiLiquidacionModal({
  isOpen = true,
  onClose,
  rodeos = [],
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [contextoUsuario, setContextoUsuario] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Lote de liquidaciones procesadas
  const [batchResult, setBatchResult] = useState(null); // { resumen_lote, liquidaciones: [...] }
  const [liquidacionesEditables, setLiquidacionesEditables] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  const isModalOpen = isOpen !== undefined ? isOpen : true;
  if (!isModalOpen) return null;

  const tc = Number(dolarRef) || 1540;

  // Procesar lote con IA
  async function handleProcessBatch() {
    const hasFiles = selectedFiles.length > 0;
    const hasContext = Boolean(contextoUsuario && contextoUsuario.trim().length > 0);
    if (!hasFiles && !hasContext) return;
    setErrorMsg('');

    if (!hasGeminiKey()) {
      const msg = 'Falta configurar la clave API de Gemini. Abrí el Copiloto IA para cargarla o configurala en .env.';
      setErrorMsg(msg);
      notify?.(msg, 'error');
      return;
    }

    setScanning(true);
    try {
      let rawList = [];
      let resumen = '';

      if (!hasFiles && hasContext) {
        const data = await analizarLiquidacionHacienda(null, contextoUsuario);
        rawList = [data];
        resumen = `Liquidación analizada desde indicaciones en texto: ${data.consignataria_o_comprador || 'Consignatario'} (Liq N° ${data.numero_liquidacion || 'S/N'}).`;
      } else if (selectedFiles.length === 1) {
        const file = selectedFiles[0];
        let data;
        if (isPdfFile(file)) {
          const pages = await slicePdfToImages(file, { maxWidth: 1400, quality: 0.76 });
          if (pages.length <= 1) {
            data = await analizarLiquidacionHacienda(pages[0]?.file || file, contextoUsuario);
          } else {
            notify?.(`Procesando liquidación PDF multipágina (${pages.length} páginas)...`, 'info');
            data = await analizarLiquidacionMultipage(pages, 3);
          }
        } else {
          data = await analizarLiquidacionHacienda(file, contextoUsuario);
        }
        rawList = [data];
        resumen = `Liquidación individual procesada: ${data.consignataria_o_comprador || 'Consignatario'} (Liq N° ${data.numero_liquidacion || 'S/N'}).`;
      } else {
        const batchRes = await analizarLoteLiquidacionesHacienda(selectedFiles);
        rawList = Array.isArray(batchRes?.liquidaciones) ? batchRes.liquidaciones : [];
        resumen = batchRes?.resumen_lote || `${rawList.length} liquidaciones procesadas conjuntamente.`;
      }

      // Normalizar estructura editable para cada liquidación
      const editables = rawList.map((data, idx) => {
        const renglones = (data.renglones || []).map((r) => {
          const cab = Number(r.cabezas) || 0;
          const kg = Number(r.kilos_totales) || 0;
          const pKg = Number(r.precio_por_kg) || 0;
          const prom = cab > 0 ? kg / cab : Number(r.kilos_promedio) || 0;
          const bruto = kg > 0 && pKg > 0 ? kg * pKg : Number(r.importe_bruto) || 0;
          return {
            categoria: r.categoria || 'Vacas',
            cabezas: cab,
            kilos_totales: kg,
            kilos_promedio: Math.round(prom * 10) / 10,
            precio_por_kg: pKg,
            importe_bruto: Math.round(bruto * 100) / 100,
          };
        });

        const totalCab =
          Number(data.total_cabezas) ||
          renglones.reduce((acc, r) => acc + (Number(r.cabezas) || 0), 0);
        const totalKg =
          Number(data.total_kilos) ||
          renglones.reduce((acc, r) => acc + (Number(r.kilos_totales) || 0), 0);
        const brutoTotal =
          Number(data.importe_bruto_total) ||
          renglones.reduce((acc, r) => acc + (Number(r.importe_bruto) || 0), 0);
        const deducciones = Number(data.descuentos_comisiones_flete) || 0;
        const netoLiquidado =
          Number(data.importe_neto_liquidado) || Math.max(0, brutoTotal - deducciones);

        return {
          id: `liq_${idx}_${Date.now()}`,
          originalIndex: idx,
          fecha: data.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
          consignataria_o_comprador: data.consignataria_o_comprador || 'Consignatario / Remate Feria',
          numero_liquidacion: data.numero_liquidacion || '',
          dta_guia_numero: data.dta_guia_numero || '',
          moneda: data.moneda_detectada || data.moneda || 'ARS',
          moneda_detectada: data.moneda_detectada || data.moneda || 'ARS',
          notas_auditoria_ia: data.notas_auditoria_ia || null,
          partidas_detalle: data.partidas_detalle || [],
          selectedRodeo: '',
          registrarBajaHacienda: true,
          renglones,
          total_cabezas: totalCab,
          total_kilos: totalKg,
          importe_bruto_total: brutoTotal,
          descuentos_comisiones_flete: deducciones,
          importe_neto_liquidado: netoLiquidado,
          neto_gravado: Number(data.neto_gravado) || brutoTotal,
          alicuota_iva: Number(data.alicuota_iva) || 10.5,
          monto_iva: Number(data.monto_iva) || Math.round(brutoTotal * 0.105 * 100) / 100,
          percepciones_iva: Number(data.percepciones_iva) || 0,
          retenciones_iva: Number(data.retenciones_iva) || 0,
          observaciones: data.observaciones || '',
        };
      });

      setBatchResult({ resumen_lote: resumen, total: editables.length });
      setLiquidacionesEditables(editables);
      setSelectedIndices(new Set(editables.map((_, i) => i)));

      notify?.(
        `¡${selectedFiles.length} archivo(s) procesados! Se detectaron ${editables.length} liquidación(es) de hacienda.`,
        'success'
      );
    } catch (err) {
      console.error('Error al procesar lote de liquidaciones:', err);
      setErrorMsg(`Error al procesar liquidaciones: ${err.message}`);
      notify?.(`Error al procesar liquidaciones: ${err.message}`, 'error');
    } finally {
      setScanning(false);
    }
  }

  // Modificar campo de una liquidación
  function handleUpdateLiq(liqIdx, field, value) {
    setLiquidacionesEditables((prev) => {
      const copy = [...prev];
      copy[liqIdx] = { ...copy[liqIdx], [field]: value };
      return copy;
    });
  }

  // Actualizar renglón en una liquidación
  function handleUpdateRenglon(liqIdx, rowIdx, field, value) {
    setLiquidacionesEditables((prev) => {
      const copy = [...prev];
      const liq = { ...copy[liqIdx] };
      const rows = [...liq.renglones];
      const r = { ...rows[rowIdx], [field]: value };

      const cab = Number(r.cabezas) || 0;
      const kg = Number(r.kilos_totales) || 0;
      const pKg = Number(r.precio_por_kg) || 0;
      r.kilos_promedio = cab > 0 ? Math.round((kg / cab) * 10) / 10 : 0;
      r.importe_bruto = Math.round(kg * pKg * 100) / 100;

      rows[rowIdx] = r;

      const totCab = rows.reduce((acc, row) => acc + (Number(row.cabezas) || 0), 0);
      const totKg = rows.reduce((acc, row) => acc + (Number(row.kilos_totales) || 0), 0);
      const totBruto = rows.reduce((acc, row) => acc + (Number(row.importe_bruto) || 0), 0);
      const ded = Number(liq.descuentos_comisiones_flete) || 0;
      const totNeto = Math.max(0, totBruto - ded);

      liq.renglones = rows;
      liq.total_cabezas = totCab;
      liq.total_kilos = totKg;
      liq.importe_bruto_total = totBruto;
      liq.importe_neto_liquidado = totNeto;

      copy[liqIdx] = liq;
      return copy;
    });
  }

  // Toggle de selección
  function toggleLiqSelection(index) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIndices.size === liquidacionesEditables.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(liquidacionesEditables.map((_, i) => i)));
    }
  }

  // Confirmar y guardar las liquidaciones seleccionadas
  async function handleConfirmarLote() {
    const aGuardar = liquidacionesEditables.filter((_, idx) => selectedIndices.has(idx));
    if (aGuardar.length === 0) {
      notify?.('Seleccioná al menos una liquidación para guardar.', 'warning');
      return;
    }

    setSaving(true);
    try {
      let ventasGuardadas = 0;

      for (const liq of aGuardar) {
        const totalCabezas = Number(liq.total_cabezas) || 0;
        const totalKilos = Number(liq.total_kilos) || 0;
        const importeBruto = Number(liq.importe_bruto_total) || 0;
        const deducciones = Number(liq.descuentos_comisiones_flete) || 0;
        const importeNeto = Number(liq.importe_neto_liquidado) || Math.max(0, importeBruto - deducciones);
        const precioPromKg = totalKilos > 0 ? importeBruto / totalKilos : 0;
        const netoUsd = tc > 0 ? Math.round((importeNeto / tc) * 100) / 100 : 0;

        const categoriaPrincipal =
          liq.renglones?.length > 1
            ? liq.renglones.map((r) => `${r.categoria} (${r.cabezas})`).join(' + ')
            : liq.renglones?.[0]?.categoria || 'Hacienda General';

        // 1. Guardar en ventas_hacienda
        const ventaRecord = {
          fecha: liq.fecha,
          rodeo_nombre: liq.selectedRodeo || null,
          categoria: categoriaPrincipal,
          cantidad_cabezas: totalCabezas,
          kilos_totales: totalKilos,
          moneda_carga: liq.moneda || 'ARS',
          tipo_cambio: tc,
          precio_kg: Math.round(precioPromKg * 100) / 100,
          importe_bruto_ars: Math.round(importeBruto * 100) / 100,
          gastos_comercializacion_ars: Math.round(deducciones * 100) / 100,
          ingreso_neto_ars: Math.round(importeNeto * 100) / 100,
          ingreso_neto_usd: netoUsd,
          neto_gravado: Number(liq.neto_gravado) || Math.round(importeBruto * 100) / 100,
          alicuota_iva: Number(liq.alicuota_iva) || 10.5,
          monto_iva: Number(liq.monto_iva) || 0,
          percepciones_iva: Number(liq.percepciones_iva) || 0,
          retenciones_iva: Number(liq.retenciones_iva) || 0,
          comprador: liq.consignataria_o_comprador || 'Consignatario / Remate',
          destino_consignatario: liq.consignataria_o_comprador || 'Remate / Feria',
          observaciones: `Liquidación N° ${liq.numero_liquidacion || '-'} · DTA/Guía: ${liq.dta_guia_numero || '-'} · Lote IA`,
        };

        const { data: insertedVenta, error: errVenta } = await supabase
          .from('ventas_hacienda')
          .insert(ventaRecord)
          .select('id')
          .single();
        if (errVenta) throw errVenta;

        // Registrar auditoría
        try {
          await registrarAuditLog({
            tipo_operacion: 'VENTA_HACIENDA_LOTE',
            modulo: 'Finanzas',
            descripcion: `Liquidación de Venta: ${liq.consignataria_o_comprador} (${totalCabezas} cabezas)`,
            afectados_tabla: 'ventas_hacienda',
            afectados_ids: insertedVenta?.id ? [insertedVenta.id] : [],
            metadata: {
              consignatario: liq.consignataria_o_comprador,
              cabezas: totalCabezas,
              kilos: totalKilos,
              neto_ars: Math.round(importeNeto * 100) / 100,
            },
          });
        } catch (logErr) {
          console.warn('Error guardando audit log venta:', logErr);
        }

        // 2. Si se marcó registrar salida y se seleccionó rodeo
        if (liq.registrarBajaHacienda && liq.selectedRodeo && totalCabezas > 0) {
          const rodeoObj = rodeos.find((r) => r.nombre === liq.selectedRodeo);
          if (rodeoObj) {
            await supabase.from('movimientos_hacienda').insert({
              fecha: liq.fecha,
              tipo_movimiento: 'Venta',
              rodeo_id: rodeoObj.id,
              rodeo_nombre: rodeoObj.nombre,
              potrero_origen: rodeoObj.potrero_numero ? parseInt(rodeoObj.potrero_numero, 10) : null,
              potrero_destino: null,
              categoria_afectada: categoriaPrincipal,
              cantidad_cabezas: totalCabezas,
              motivo_observaciones: `Venta a ${liq.consignataria_o_comprador} (${totalKilos} kg totales - Liquidación N° ${liq.numero_liquidacion || '-'})`,
            });

            // Descontar cabezas del rodeo
            const updatedRodeo = { ...rodeoObj };
            liq.renglones.forEach((r) => {
              const cat = (r.categoria || '').toLowerCase();
              const qty = Number(r.cabezas) || 0;
              if (qty <= 0) return;

              if (cat.includes('cut')) {
                updatedRodeo.vacas_cut = Math.max(0, (Number(updatedRodeo.vacas_cut) || 0) - qty);
              } else if (cat.includes('vaca')) {
                updatedRodeo.vacas = Math.max(0, (Number(updatedRodeo.vacas) || 0) - qty);
              } else if (cat.includes('terner')) {
                updatedRodeo.terneros = Math.max(0, (Number(updatedRodeo.terneros) || 0) - qty);
              } else if (cat.includes('toro') || cat.includes('padre')) {
                updatedRodeo.toros_padres = Math.max(0, (Number(updatedRodeo.toros_padres) || 0) - qty);
              } else if (cat.includes('torito')) {
                updatedRodeo.toritos = Math.max(0, (Number(updatedRodeo.toritos) || 0) - qty);
              } else if (cat.includes('vaquill')) {
                updatedRodeo.vaquillonas_reposicion = Math.max(0, (Number(updatedRodeo.vaquillonas_reposicion) || 0) - qty);
              } else if (cat.includes('novill')) {
                updatedRodeo.novillos = Math.max(0, (Number(updatedRodeo.novillos) || 0) - qty);
              }
            });

            await supabase
              .from('rodeos')
              .update({
                vacas: updatedRodeo.vacas,
                terneros: updatedRodeo.terneros,
                toros_padres: updatedRodeo.toros_padres,
                toritos: updatedRodeo.toritos,
                vacas_cut: updatedRodeo.vacas_cut,
                vaquillonas_reposicion: updatedRodeo.vaquillonas_reposicion,
                novillos: updatedRodeo.novillos,
              })
              .eq('id', rodeoObj.id);
          }
        }

        ventasGuardadas += 1;
      }

      notify?.(
        `¡${ventasGuardadas} liquidación(es) de hacienda registradas con éxito en el sistema!`,
        'success'
      );
      setBatchResult(null);
      setLiquidacionesEditables([]);
      setSelectedFiles([]);
      onClose();
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al registrar ventas de hacienda: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="fixed inset-0 z-[99999] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-auto max-h-[92vh] overflow-y-auto">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-950 text-emerald-400">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-slate-900">
                  Cargar Lote de Liquidaciones de Venta (IA)
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                  Gemini Lotes IA
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Subí una o varias liquidaciones de venta juntas (remate feria, consignataria o frigorífico). Extrae comprador, categorías, cabezas, kilos y precio neto.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerta de Error */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. Zona de Arrastre y Selección Múltiple */}
        {!batchResult && (
          <MultiFileDropzone
            files={selectedFiles}
            onFilesChange={setSelectedFiles}
            disabled={scanning}
            isProcessing={scanning}
            onProcessBatch={handleProcessBatch}
            title="Arrastrá o seleccioná una o varias Liquidaciones de Venta"
            subtitle="Podés soltar varios comprobantes a la vez (PDFs o fotos) o escribir las condiciones de venta para que la IA extraiga los renglones."
            processButtonText="✨ Analizar Liquidaciones con IA"
            contextText={contextoUsuario}
            onContextTextChange={setContextoUsuario}
            contextPlaceholder="Ej: Liquidación de 38 novillos vendidos a Reggi y Cía a $2.900/kg con 420 kg promedio, plazo 30 días, IVA y gastos 5%..."
            contextLabel="📝 Contexto, Precios o Aclaraciones para la IA"
            allowTextOnly={true}
          />
        )}

        {/* 2. Previsualización Editable de las Liquidaciones Extraídas */}
        {batchResult && liquidacionesEditables.length > 0 && (
          <div className="space-y-4">
            {/* Banner resumen */}
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs text-emerald-950">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="font-semibold">{batchResult.resumen_lote}</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white border border-emerald-300 text-emerald-900">
                {liquidacionesEditables.length} liquidaciones
              </span>
            </div>

            {/* Barra de selección */}
            <div className="flex items-center justify-between px-1 text-xs">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1.5 cursor-pointer"
              >
                {selectedIndices.size === liquidacionesEditables.length ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span>
                  {selectedIndices.size === liquidacionesEditables.length
                    ? 'Deseleccionar todas'
                    : 'Seleccionar todas las liquidaciones'}
                </span>
              </button>

              <span className="text-slate-600">
                Seleccionadas: <strong className="text-slate-900">{selectedIndices.size}</strong> de {liquidacionesEditables.length}
              </span>
            </div>

            {/* Lista de Liquidaciones */}
            <div className="space-y-4 max-h-[52vh] overflow-y-auto pr-1">
              {liquidacionesEditables.map((liq, idx) => {
                const isSelected = selectedIndices.has(idx);
                const avgPrice = liq.total_kilos > 0 ? liq.importe_bruto_total / liq.total_kilos : 0;
                const netoUsd = tc > 0 ? liq.importe_neto_liquidado / tc : 0;

                return (
                  <div
                    key={liq.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-white border-emerald-300 shadow-sm'
                        : 'bg-slate-50 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggleLiqSelection(idx)}
                          className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-emerald-700" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-400" />
                          )}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-slate-900">
                              {liq.consignataria_o_comprador}
                            </span>
                            <span className="text-xs text-slate-500 font-mono">
                              Liq N° {liq.numero_liquidacion || 'S/N'}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-600">
                            Fecha: {liq.fecha} · DTA: {liq.dta_guia_numero || 'S/DTA'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-extrabold text-emerald-900 block font-mono">
                          ${Math.round(liq.importe_neto_liquidado).toLocaleString('es-AR')} ARS
                        </span>
                        <span className="text-xs text-slate-600 font-medium">
                          USD ${(Math.round(netoUsd * 10) / 10).toLocaleString('es-AR')} · {liq.total_cabezas} cab.
                        </span>
                      </div>
                    </div>

                    {/* Controles de rodeo de origen */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-3 text-xs">
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                          Fecha Venta:
                        </label>
                        <input
                          type="date"
                          value={liq.fecha}
                          onChange={(e) => handleUpdateLiq(idx, 'fecha', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 bg-white"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                          Descontar de Rodeo (Opcional):
                        </label>
                        <select
                          value={liq.selectedRodeo}
                          onChange={(e) => handleUpdateLiq(idx, 'selectedRodeo', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 bg-white"
                        >
                          <option value="">-- Sin baja de rodeo --</option>
                          {rodeos.map((r) => (
                            <option key={r.id || r.nombre} value={r.nombre}>
                              {r.nombre} (Total: {r.total_cabezas || r.cabezas_totales || 0} cab.)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                          Deducciones/Comisiones (ARS):
                        </label>
                        <input
                          type="number"
                          value={liq.descuentos_comisiones_flete}
                          onChange={(e) => {
                            const ded = parseFloat(e.target.value) || 0;
                            handleUpdateLiq(idx, 'descuentos_comisiones_flete', ded);
                            handleUpdateLiq(
                              idx,
                              'importe_neto_liquidado',
                              Math.max(0, liq.importe_bruto_total - ded)
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 bg-white font-mono"
                        />
                      </div>
                    </div>

                    {/* Dictamen de Auditoría Gemini 2.5 Pro */}
                    {liq.notas_auditoria_ia && (
                      <div className="my-2.5 p-2 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-950 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-[10px] text-emerald-800 mb-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          <span>Auditoría Ganadera Gemini 2.5 Pro:</span>
                          <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 font-mono text-[9px]">
                            {liq.moneda || 'ARS'}
                          </span>
                        </div>
                        <p className="text-[11px] font-sans text-slate-700 leading-snug">
                          {liq.notas_auditoria_ia}
                        </p>
                      </div>
                    )}

                    {/* Desglose de categorías */}
                    <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 border-b border-slate-200 pb-1">
                        <span>Categoría / Lote</span>
                        <div className="flex gap-4">
                          <span>Cab.</span>
                          <span>Kg Totales</span>
                          <span>$/Kg</span>
                        </div>
                      </div>
                      {liq.renglones.map((row, rIdx) => (
                        <div key={rIdx} className="flex items-center justify-between text-xs py-1">
                          <span className="font-semibold text-slate-800">{row.categoria}</span>
                          <div className="flex items-center gap-3 font-mono text-slate-700">
                            <span className="w-12 text-right">{row.cabezas}</span>
                            <span className="w-16 text-right">{row.kilos_totales.toLocaleString('es-AR')} kg</span>
                            <span className="w-16 text-right font-bold text-emerald-800">${row.precio_por_kg}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
          {batchResult ? (
            <button
              type="button"
              onClick={() => {
                setBatchResult(null);
                setLiquidacionesEditables([]);
              }}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer transition"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Cargar otros comprobantes</span>
            </button>
          ) : (
            <span className="text-xs text-slate-500">Establecimiento San José · Las Flores</span>
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
            >
              Cancelar
            </button>
            {batchResult && liquidacionesEditables.length > 0 && (
              <button
                type="button"
                onClick={handleConfirmarLote}
                disabled={saving || selectedIndices.size === 0}
                className="px-5 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-950 text-white text-xs font-extrabold shadow-sm transition disabled:opacity-50 flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {saving
                    ? 'Guardando lote...'
                    : `✓ Registrar ${selectedIndices.size} Venta(s)`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
