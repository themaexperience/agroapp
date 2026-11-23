import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Sprout,
  X,
  CheckCircle2,
  AlertCircle,
  FileText,
  MapPin,
  Clock,
  ShieldAlert,
  DollarSign,
  PackageCheck,
  PackageX,
  Info,
  Undo2,
  ChevronRight,
  Layers,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  analizarRecetaAgronomicaRAO,
  analizarLoteRecetasAgronomicas,
  hasGeminiKey,
} from '../lib/geminiService';
import { buscarUltimoPrecioInsumo } from '../utils/preciosRefHelper.js';
import { findPotreroByGpsOrName } from '../utils/geoParser';
import { registrarAuditLog } from '../utils/auditLogger';
import { supabase } from '../lib/supabase';
import MultiFileDropzone from './MultiFileDropzone';

/**
 * Busca de forma flexible un insumo en el inventario del Pañol
 */
function matchStockInsumo(productName, stockList = []) {
  if (!productName || !stockList || stockList.length === 0) return null;
  const pNorm = productName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Coincidencia normalizada
  for (const s of stockList) {
    const sNorm = (s.nombre || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (sNorm && (sNorm.includes(pNorm) || pNorm.includes(sNorm))) {
      return s;
    }
  }

  // 2. Coincidencia por palabras clave principales
  const words = productName.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
  for (const w of words) {
    for (const s of stockList) {
      if ((s.nombre || '').toLowerCase().includes(w)) {
        return s;
      }
    }
  }

  return null;
}

export default function GeminiRecetaModal({
  isOpen = true,
  onClose,
  potreros = [],
  stockInsumos = [],
  siembras = [],
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

  // Lote de recetas procesadas
  const [batchResult, setBatchResult] = useState(null); // { resumen_lote, archivos_procesados, cruce_realizado, recetas: [...] }
  const [lotesEditables, setLotesEditables] = useState([]); // Array de recetas con sus estados editables
  const [selectedLoteIndices, setSelectedLoteIndices] = useState(new Set()); // Índices a guardar

  const isModalOpen = isOpen !== undefined ? isOpen : true;
  if (!isModalOpen) return null;

  // Procesar lote completo con IA
  async function handleProcessBatch() {
    const hasFiles = selectedFiles.length > 0;
    const hasContext = Boolean(contextoUsuario && contextoUsuario.trim().length > 0);
    if (!hasFiles && !hasContext) return;
    setErrorMsg('');

    if (!hasGeminiKey()) {
      const msg = 'Falta configurar la clave API de Gemini en el sistema.';
      setErrorMsg(msg);
      notify?.(msg, 'error');
      return;
    }

    setScanning(true);
    try {
      let result;
      if (!hasFiles && hasContext) {
        const raw = await analizarRecetaAgronomicaRAO(null, potreros, contextoUsuario);
        result = {
          resumen_lote: `Receta agronómica individual extraída de texto: ${raw.numero_receta || 'S/N'} (${raw.cultivo_tratado || 'Tratamiento agrícola'}).`,
          archivos_procesados: 1,
          cruce_realizado: 'Cruce geográfico y agronómico unitario desde indicaciones.',
          recetas: [raw],
        };
      } else if (selectedFiles.length === 1) {
        // Modo un archivo: compatibilidad directa o lote
        const raw = await analizarRecetaAgronomicaRAO(selectedFiles[0], potreros, contextoUsuario);
        result = {
          resumen_lote: `Receta agronómica individual analizada: ${raw.numero_receta || 'S/N'} (${raw.cultivo_tratado || 'Tratamiento agrícola'}).`,
          archivos_procesados: 1,
          cruce_realizado: 'Cruce geográfico y agronómico unitario.',
          recetas: [raw],
        };
      } else {
        result = await analizarLoteRecetasAgronomicas({
          files: selectedFiles,
          potrerosList: potreros,
          contextoUsuario,
        });
      }

      setBatchResult(result);

      // Mapear cada receta a una estructura editable
      const rawRecetas = Array.isArray(result?.recetas) && result.recetas.length > 0
        ? result.recetas
        : [];

      const editables = rawRecetas.map((r, idx) => {
        const latRaw = r.coordenadas_gps?.latitud;
        const lngRaw = r.coordenadas_gps?.longitud;
        const declared = r.lote_declarado || '';
        const match = findPotreroByGpsOrName(latRaw, lngRaw, declared, potreros);
        const targetPot = match?.potrero || potreros[0] || null;

        const potHa = Number(r.hectareas_declaradas) || Number(targetPot?.hectareas) || 40;
        const cult = r.cultivo_tratado || targetPot?.cultivo_actual || 'Barbecho Químico';

        return {
          id: `lote_${idx}_${Date.now()}`,
          originalIndex: idx,
          numero_receta: r.numero_receta || `REC-${idx + 1}`,
          ingeniero_agronomo: r.ingeniero_agronomo || 'Asesor Técnico',
          matricula_profesional: r.matricula_profesional || '',
          fecha_emision: r.fecha_emision || fechaOperacion || new Date().toISOString().slice(0, 10),
          selectedPotreroNum: targetPot ? Number(targetPot.numero) : null,
          superficieTratada: potHa,
          cultivoDestino: cult,
          costoLaborHaUsd: 8.0,
          tiempoReingresoHs: Number(r.tiempo_reingreso_horas) || 24,
          tiempoCarenciaDias: Number(r.tiempo_carencia_dias) || 7,
          metodoCruceGps: match,
          observaciones: r.observaciones_clave || '',
          volumen_agua_lts_ha: r.volumen_agua_lts_ha || 80,
          condiciones_ambientales: r.condiciones_ambientales || 'Viento < 15 km/h',
          rawProductos: Array.isArray(r.productos) ? r.productos : [],
        };
      });

      setLotesEditables(editables);
      // Por defecto seleccionar todos los detectados
      setSelectedLoteIndices(new Set(editables.map((_, i) => i)));

      notify?.(
        `¡Lote de ${selectedFiles.length} archivo(s) procesado con éxito! Se detectaron ${editables.length} lote(s)/receta(s).`,
        'success'
      );
    } catch (err) {
      console.error('Error al procesar lote de recetas:', err);
      setErrorMsg(`Error al interpretar lote de recetas: ${err.message}`);
      notify?.(`Error al procesar lote: ${err.message}`, 'error');
    } finally {
      setScanning(false);
    }
  }

  // Modificar campo de un lote específico
  function handleUpdateLote(index, field, value) {
    setLotesEditables((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  }

  // Toggle de selección individual
  function toggleLoteSelection(index) {
    setSelectedLoteIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // Toggle selección total
  function toggleSelectAll() {
    if (selectedLoteIndices.size === lotesEditables.length) {
      setSelectedLoteIndices(new Set());
    } else {
      setSelectedLoteIndices(new Set(lotesEditables.map((_, i) => i)));
    }
  }

  // Evaluar productos de un lote contra Pañol
  function getProductosEvaluados(lote) {
    if (!lote || !Array.isArray(lote.rawProductos)) return [];
    return lote.rawProductos.map((prod) => {
      const stockItem = matchStockInsumo(prod.marca_comercial, stockInsumos);
      const cantTotal =
        Number(prod.cantidad_total) ||
        Math.round((Number(prod.dosis_ha) || 0) * (Number(lote.superficieTratada) || 1) * 100) / 100;

      // Si el archivo de factura/remito ya vino cruzado con precio, priorizarlo
      let precioUnit = Number(prod.precio_unitario_usd) || 0;
      let precioSugeridoRef = false;
      let refPrecioLabel = '';
      if (!precioUnit && stockItem) {
        precioUnit =
          Number(stockItem.precio_unitario_ref) ||
          (stockItem.moneda === 'ARS'
            ? (Number(stockItem.precio_unitario_ref) || 0) / Number(dolarRef)
            : 0);
        if (precioUnit > 0) {
          precioSugeridoRef = true;
          refPrecioLabel = 'Ref. Stock Galpón';
        }
      }
      if (!precioUnit) {
        const matchRef = buscarUltimoPrecioInsumo(prod.marca_comercial, stockInsumos, siembras, dolarRef);
        if (matchRef && matchRef.precio_unitario > 0) {
          precioUnit = matchRef.moneda === 'ARS' ? matchRef.precio_unitario / Number(dolarRef) : matchRef.precio_unitario;
          precioSugeridoRef = true;
          refPrecioLabel = matchRef.fuente === 'stock_insumo' ? 'Ref. Stock Galpón' : 'Ref. última compra';
        }
      }

      const costoTotalProd = cantTotal * (precioUnit || 0);
      const stockCampo = Number(stockItem?.stock_campo) || 0;
      const stockCoop = Number(stockItem?.stock_cooperativa) || 0;
      const hayStockCampo = stockCampo >= cantTotal;
      const hayStockTotal = stockCampo + stockCoop >= cantTotal;

      return {
        ...prod,
        cantidad_calculada: cantTotal,
        stockItem,
        precio_unitario_usd: precioUnit,
        costo_total_usd: costoTotalProd,
        precio_sugerido_ref: precioSugeridoRef,
        ref_precio_label: refPrecioLabel,
        stock_campo: stockCampo,
        stock_cooperativa: stockCoop,
        hayStockCampo,
        hayStockTotal,
      };
    });
  }

  // Resumen financiero macro de los lotes seleccionados
  const resumenTotales = useMemo(() => {
    let haTotal = 0;
    let costoInsumosTotal = 0;
    let costoLaboresTotal = 0;

    lotesEditables.forEach((lote, idx) => {
      if (!selectedLoteIndices.has(idx)) return;
      const ha = Number(lote.superficieTratada) || 0;
      haTotal += ha;
      const cLab = ha * (Number(lote.costoLaborHaUsd) || 0);
      costoLaboresTotal += cLab;

      const prods = getProductosEvaluados(lote);
      const cIns = prods.reduce((acc, p) => acc + (p.costo_total_usd || 0), 0);
      costoInsumosTotal += cIns;
    });

    return {
      haTotal,
      costoInsumosTotal,
      costoLaboresTotal,
      granTotal: costoInsumosTotal + costoLaboresTotal,
    };
  }, [lotesEditables, selectedLoteIndices, stockInsumos, dolarRef]);

  // Confirmar y guardar todos los lotes tildados
  async function handleConfirmarLote() {
    const lotesAGuardar = lotesEditables.filter((_, idx) => selectedLoteIndices.has(idx));
    if (lotesAGuardar.length === 0) {
      notify?.('Seleccioná al menos un lote para sincronizar.', 'warning');
      return;
    }

    setSaving(true);
    try {
      let lotesImpactadosCount = 0;
      let insumosDescontadosCount = 0;

      for (const lote of lotesAGuardar) {
        const pot = potreros.find((p) => Number(p.numero) === Number(lote.selectedPotreroNum));
        const ha = Number(lote.superficieTratada) || Number(pot?.hectareas) || 40;
        const cLabTotal = ha * (Number(lote.costoLaborHaUsd) || 0);

        const prodsEval = getProductosEvaluados(lote);
        const cInsTotal = prodsEval.reduce((acc, p) => acc + (p.costo_total_usd || 0), 0);
        const invTotal = cLabTotal + cInsTotal;

        // Buscar siembra activa previa en ese potrero
        const siembraActiva = siembras.find(
          (s) =>
            Number(s.potrero_numero) === Number(lote.selectedPotreroNum) &&
            (s.vigencia || 'Activa') === 'Activa' &&
            s.vigencia !== 'Pasada / Histórica'
        );

        const campanaActual = siembraActiva?.campana || '2026/2027';

        // 1. Preparar labor
        const nuevaLabor = {
          id: `labor_rao_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          fecha: lote.fecha_emision,
          labor: `Pulverización Terrestre (RAO ${lote.numero_receta})`,
          contratista: 'Equipo Terrestre San José',
          costo_ha_usd: Number(lote.costoLaborHaUsd) || 0,
          costo_total_usd: cLabTotal,
          receta_numero: lote.numero_receta,
          ingeniero: lote.ingeniero_agronomo,
          matricula: lote.matricula_profesional,
          reingreso_horas: Number(lote.tiempoReingresoHs) || 0,
          carencia_dias: Number(lote.tiempoCarenciaDias) || 0,
          volumen_agua_lts_ha: lote.volumen_agua_lts_ha || 80,
          condiciones: lote.condiciones_ambientales || 'Viento < 15 km/h',
          observaciones: lote.observaciones || '',
        };

        const nuevosProductosReceta = prodsEval.map((p) => ({
          producto: p.marca_comercial,
          principio_activo: p.principio_activo || '',
          dosis_ha: Number(p.dosis_ha) || 0,
          unidad: p.unidad || 'Lt',
          total_lote: Number(p.cantidad_calculada) || 0,
          costo_unitario_usd: Number(p.precio_unitario_usd) || 0,
          costo_total_usd: Number(p.costo_total_usd) || 0,
          receta_ref: lote.numero_receta,
        }));

        let siembraDestinoId = null;

        // IMPACTO 1: EN SIEMBRAS / LABORES
        if (siembraActiva) {
          siembraDestinoId = siembraActiva.id;
          const recetaActualizada = [
            ...(Array.isArray(siembraActiva.receta_json) ? siembraActiva.receta_json : []),
            ...nuevosProductosReceta,
          ];
          const laboresActualizadas = [
            ...(Array.isArray(siembraActiva.labores_json) ? siembraActiva.labores_json : []),
            nuevaLabor,
          ];

          const nuevoCostoInsumos = (Number(siembraActiva.costo_insumos_usd) || 0) + cInsTotal;
          const nuevoCostoLabores = (Number(siembraActiva.costo_labores_usd) || 0) + cLabTotal;

          await supabase
            .from('labores_siembras')
            .update({
              receta_json: recetaActualizada,
              labores_json: laboresActualizadas,
              costo_insumos_usd: nuevoCostoInsumos,
              costo_labores_usd: nuevoCostoLabores,
              costo_total_usd: nuevoCostoInsumos + nuevoCostoLabores,
            })
            .eq('id', siembraActiva.id);
        } else {
          const payloadNuevaSiembra = {
            potrero_numero: Number(lote.selectedPotreroNum),
            campana: campanaActual,
            fecha: lote.fecha_emision,
            cultivo_variedad: lote.cultivoDestino || 'Barbecho Químico',
            variedad_hibrido: '',
            hectareas: ha,
            ha_sembradas: ha,
            estado: 'Sembrado',
            vigencia: 'Activa',
            receta_json: nuevosProductosReceta,
            labores_json: [nuevaLabor],
            insumos_json: [],
            costo_insumos_usd: cInsTotal,
            costo_labores_usd: cLabTotal,
            costo_total_usd: invTotal,
            observaciones: `Carga automática vía Receta Agronómica RAO N° ${lote.numero_receta}. Ing: ${lote.ingeniero_agronomo}`,
          };

          const { data: createdSiembra } = await supabase
            .from('labores_siembras')
            .insert(payloadNuevaSiembra)
            .select()
            .single();

          siembraDestinoId = createdSiembra?.id;
        }

        // IMPACTO 2: EN PAÑOL / STOCK DE INSUMOS
        for (const prod of prodsEval) {
          if (prod.stockItem && prod.cantidad_calculada > 0) {
            const sItem = prod.stockItem;
            const actualCampo = Number(sItem.stock_campo) || 0;
            const nuevoCampo = Math.max(0, actualCampo - prod.cantidad_calculada);
            const nuevoTotal = nuevoCampo + (Number(sItem.stock_cooperativa) || 0);

            await supabase
              .from('stock_insumos')
              .update({
                stock_campo: nuevoCampo,
                cantidad_actual: nuevoTotal,
                updated_at: new Date().toISOString(),
              })
              .eq('id', sItem.id);

            await supabase.from('movimientos_stock').insert({
              insumo_id: sItem.id,
              nombre_insumo: sItem.nombre,
              tipo_movimiento: 'EGRESO_APLICACION',
              cantidad: prod.cantidad_calculada,
              unidad: prod.unidad || sItem.unidad || 'Lt',
              origen: 'Campo San José',
              destino: `Potrero #${lote.selectedPotreroNum} (RAO ${lote.numero_receta})`,
              costo_unitario_usd: prod.precio_unitario_usd || 0,
              costo_total_usd: prod.costo_total_usd || 0,
              fecha: lote.fecha_emision,
              observaciones: `Aplicación fitosanitaria según Receta RAO N° ${lote.numero_receta}.`,
            });

            insumosDescontadosCount += 1;
          }
        }

        // IMPACTO 3: ALERTA FITOSANITARIA
        if (lote.tiempoReingresoHs > 0 || lote.tiempoCarenciaDias > 0) {
          const prodNames = prodsEval.map((p) => p.marca_comercial).join(', ');
          await supabase.from('alertas_campo').insert({
            potrero_numero: Number(lote.selectedPotreroNum),
            tipo: 'RESTRICCION_FITOSANITARIA',
            nivel: 'WARNING',
            titulo: `Restricción Fitosanitaria RAO ${lote.numero_receta} en P#${lote.selectedPotreroNum}`,
            horas_reingreso: Number(lote.tiempoReingresoHs),
            dias_carencia: Number(lote.tiempoCarenciaDias),
            resuelta: false,
            fecha_creacion: lote.fecha_emision,
            observaciones: `Restricción fitosanitaria de acceso y pastoreo. Reingreso: ${lote.tiempoReingresoHs} hs. Carencia: ${lote.tiempoCarenciaDias} días. RAO N° ${lote.numero_receta}. Fitosanitarios aplicados: ${prodNames}. Ing. Agr: ${lote.ingeniero_agronomo}.`,
          });
        }

        // Auditoría
        await registrarAuditLog({
          tipo_operacion: 'IMPORTACION_LOTE_RAO',
          modulo: 'Siembras',
          descripcion: `Sincronización RAO N° ${lote.numero_receta} en P#${lote.selectedPotreroNum}: ${ha} ha de ${lote.cultivoDestino}`,
          afectados_tabla: 'labores_siembras',
          afectados_ids: [siembraDestinoId],
          metadata: {
            rao_numero: lote.numero_receta,
            potrero_numero: lote.selectedPotreroNum,
            hectareas: ha,
            costo_total_usd: invTotal,
          },
          usuario: 'Administración San José',
        });

        lotesImpactadosCount += 1;
      }

      notify?.(
        `¡Sincronización exitosa! ${lotesImpactadosCount} lote(s)/receta(s) impactados y ${insumosDescontadosCount} insumos descontados del pañol.`,
        'success'
      );

      setBatchResult(null);
      setLotesEditables([]);
      setSelectedFiles([]);
      onClose();
      await onRefresh?.();
    } catch (err) {
      console.error('Error al sincronizar lote de recetas:', err);
      notify?.(`Error al sincronizar lote: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-6 shadow-2xl text-slate-100 space-y-5 my-auto max-h-[92vh] overflow-y-auto">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Sprout className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-base sm:text-lg text-white tracking-tight">
                  Lector Inteligente y Cruce de Lotes de Recetas (RAO / MDA)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Lote Multidocumento + GIS + Pañol
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Cargá múltiples recetas, remitos y facturas juntos. La IA cruza dosis, precios y potreros sin pisarse.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensaje de error */}
        {errorMsg && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="text-rose-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. Zona de Selección Múltiple y Drag & Drop */}
        {!batchResult && (
          <div className="space-y-4">
            <MultiFileDropzone
              files={selectedFiles}
              onFilesChange={setSelectedFiles}
              disabled={scanning}
              isProcessing={scanning}
              onProcessBatch={handleProcessBatch}
              title="Arrastrá o seleccioná una o varias Recetas / Remitos / Facturas"
              subtitle="Podés soltar varios PDFs o fotos a la vez, o escribir indicaciones directas para que Gemini IA consolide los potreros y productos."
              processButtonText="✨ Analizar y Cruzar Lote con IA"
              contextText={contextoUsuario}
              onContextTextChange={setContextoUsuario}
              contextPlaceholder="Ej: Aplicación de barbecho en Potrero 10: 2,5 L/ha glifosato y 0,7 L/ha 2,4-D Dedalo. El contratista cobra USD 8/ha..."
              contextLabel="📝 Contexto, Precios o Aclaraciones para la IA"
              allowTextOnly={true}
            />
          </div>
        )}

        {/* 2. Vista Previa Editable del Lote Cruzado */}
        {batchResult && lotesEditables.length > 0 && (
          <div className="space-y-4">
            {/* Resumen del Lote IA */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <span className="text-xs font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  Resumen de Cruce Inteligente de Lote
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {batchResult.archivos_procesados || selectedFiles.length} archivos · {lotesEditables.length} lotes detectados
                </span>
              </div>
              <p className="text-xs text-slate-300">{batchResult.resumen_lote}</p>
              {batchResult.cruce_realizado && (
                <div className="text-[11px] text-teal-300 bg-teal-950/40 border border-teal-500/20 rounded-xl px-3 py-1.5 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>{batchResult.cruce_realizado}</span>
                </div>
              )}
            </div>

            {/* Barra de control de selección */}
            <div className="flex items-center justify-between px-1 text-xs">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 cursor-pointer"
              >
                {selectedLoteIndices.size === lotesEditables.length ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span>
                  {selectedLoteIndices.size === lotesEditables.length
                    ? 'Deseleccionar todos'
                    : 'Seleccionar todos los lotes'}
                </span>
              </button>

              <span className="text-slate-400">
                Seleccionados: <strong className="text-white">{selectedLoteIndices.size}</strong> de {lotesEditables.length}
              </span>
            </div>

            {/* Listado de Lotes / Recetas Detectadas */}
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
              {lotesEditables.map((lote, idx) => {
                const isSelected = selectedLoteIndices.has(idx);
                const prodsEval = getProductosEvaluados(lote);
                const cIns = prodsEval.reduce((sum, p) => sum + (p.costo_total_usd || 0), 0);
                const cLab = (Number(lote.superficieTratada) || 0) * (Number(lote.costoLaborHaUsd) || 0);

                return (
                  <div
                    key={lote.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      isSelected
                        ? 'bg-slate-950 border-emerald-500/40 ring-1 ring-emerald-500/20'
                        : 'bg-slate-950/50 border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggleLoteSelection(idx)}
                          className="text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-500" />
                          )}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-sm text-white">
                              Receta: {lote.numero_receta}
                            </span>
                            {lote.metodoCruceGps && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                {lote.metodoCruceGps.descripcion}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">
                            Ing: {lote.ingeniero_agronomo} · Fecha: {lote.fecha_emision}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-mono font-bold text-emerald-400 block">
                          USD ${Math.round(cIns + cLab).toLocaleString('es-AR')}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {lote.superficieTratada} ha @ ${(
                            (cIns + cLab) / (Number(lote.superficieTratada) || 1)
                          ).toFixed(1)}/ha
                        </span>
                      </div>
                    </div>

                    {/* Inputs editables del lote */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 my-3 text-xs">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Potrero Asignado:
                        </label>
                        <select
                          value={lote.selectedPotreroNum || ''}
                          onChange={(e) => handleUpdateLote(idx, 'selectedPotreroNum', Number(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-bold text-xs focus:outline-none focus:border-emerald-500"
                        >
                          {potreros.map((p) => (
                            <option key={p.numero} value={p.numero}>
                              P#{p.numero} - {p.nombre} ({p.hectareas || 0} ha)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Superficie (ha):
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={lote.superficieTratada}
                          onChange={(e) => handleUpdateLote(idx, 'superficieTratada', Number(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-emerald-400 font-mono font-bold text-xs focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Cultivo / Destino:
                        </label>
                        <input
                          type="text"
                          value={lote.cultivoDestino}
                          onChange={(e) => handleUpdateLote(idx, 'cultivoDestino', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-semibold text-xs focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Labor (USD/ha):
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={lote.costoLaborHaUsd}
                          onChange={(e) => handleUpdateLote(idx, 'costoLaborHaUsd', Number(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-emerald-400 font-mono font-bold text-xs focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Fitosanitarios del lote */}
                    <div className="bg-slate-900/60 rounded-xl p-2.5 border border-slate-800 text-[11px] space-y-1">
                      <span className="font-bold text-slate-300 block mb-1">
                        Insumos Prescriptos ({prodsEval.length}):
                      </span>
                      <div className="divide-y divide-slate-800/60">
                        {prodsEval.map((p, pIdx) => (
                          <div key={pIdx} className="flex items-center justify-between py-1">
                            <span className="text-white font-medium">
                              {p.marca_comercial} ({p.dosis_ha} {p.unidad}/ha → {p.cantidad_calculada.toFixed(1)} {p.unidad})
                            </span>
                            <div className="flex items-center gap-2">
                              {p.precio_sugerido_ref && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" title="Precio unitario sugerido según compras o stock anteriores">
                                  🏷️ {p.ref_precio_label || 'Ref. última compra'}
                                </span>
                              )}
                              {p.stockItem ? (
                                <span className="text-[10px] text-emerald-400">
                                  Pañol: {p.stock_campo} {p.unidad}
                                </span>
                              ) : (
                                <span className="text-[10px] text-amber-400">Sin stock registrado</span>
                              )}
                              <span className="font-mono text-slate-300">
                                USD ${Math.round(p.costo_total_usd).toLocaleString('es-AR')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Banner resumen de confirmación */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 text-xs flex flex-wrap items-center justify-between gap-3">
              <span className="text-slate-300">
                Total Lote a Sincronizar: <strong className="text-white">{selectedLoteIndices.size}</strong> lotes ({resumenTotales.haTotal.toFixed(1)} ha tratadas)
              </span>
              <div className="flex items-center gap-4">
                <span className="text-slate-400">
                  Labores: <strong className="text-slate-200">USD ${Math.round(resumenTotales.costoLaboresTotal).toLocaleString('es-AR')}</strong>
                </span>
                <span className="text-slate-400">
                  Insumos: <strong className="text-slate-200">USD ${Math.round(resumenTotales.costoInsumosTotal).toLocaleString('es-AR')}</strong>
                </span>
                <span className="font-mono font-black text-emerald-400 text-sm">
                  Inversión Total: USD ${Math.round(resumenTotales.granTotal).toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
          {batchResult ? (
            <button
              type="button"
              onClick={() => {
                setBatchResult(null);
                setLotesEditables([]);
              }}
              className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Cargar otros archivos</span>
            </button>
          ) : (
            <span className="text-xs text-slate-500">Establecimiento San José · Las Flores, Bs. As.</span>
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-bold text-slate-300 transition cursor-pointer"
            >
              Cancelar
            </button>
            {batchResult && lotesEditables.length > 0 && (
              <button
                type="button"
                onClick={handleConfirmarLote}
                disabled={saving || selectedLoteIndices.size === 0}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white text-xs font-black shadow-lg shadow-emerald-950/40 transition disabled:opacity-50 flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {saving
                    ? 'Sincronizando lote...'
                    : `✓ Confirmar y Sincronizar (${selectedLoteIndices.size} lotes)`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
