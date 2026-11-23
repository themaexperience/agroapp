import React, { useState } from 'react';
import {
  Sparkles,
  UploadCloud,
  FileText,
  X,
  CheckCircle2,
  Trash2,
  AlertCircle,
  RefreshCw,
  Plus,
  DollarSign,
  Receipt,
  PenTool,
  Tag,
  Calendar,
} from 'lucide-react';
import {
  analizarFacturaRemito,
  hasGeminiKey,
  compressImage,
  uploadCompressedImageIfStorageActive,
} from '../lib/geminiService';
import { supabase } from '../lib/supabase';
import { isPdfFile, slicePdfToImages, runWithControlledConcurrency } from '../lib/pdfSlicer.js';
import { obtenerDolarBlueHistorico } from '../lib/dolarService.js';
import { registrarAuditLog } from '../utils/auditLogger';
import MultiFileDropzone from './MultiFileDropzone';

const CATEGORIAS_OPERATIVAS = [
  'Sanidad / Vacunas',
  'Honorarios Veterinarios',
  'Suplementación / Reservas',
  'Maquinaria / Repuestos',
  'Combustible',
  'Infraestructura / Proveedores Externos',
  'Siembras y Labores Agrícolas',
  'Alambrados / Mejoras',
  'Administración / Estructura',
];

export default function GeminiFacturasBatchModal({
  isOpen = true,
  onClose,
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
}) {
  const [filesToScan, setFilesToScan] = useState([]);
  const [contextoUsuario, setContextoUsuario] = useState('');
  const [scannedBatch, setScannedBatch] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState('');

  const isModalOpen = isOpen !== undefined ? isOpen : true;
  if (!isModalOpen) return null;

  async function processSelectedFiles(filesList = []) {
    const selected = Array.isArray(filesList) ? filesList : [];
    const hasFiles = selected.length > 0;
    const hasContext = Boolean(contextoUsuario && contextoUsuario.trim().length > 0);
    if (!hasFiles && !hasContext) return;
    setErrorMessage('');

    if (!hasGeminiKey()) {
      const msg = 'Falta configurar la clave API de Gemini. Abrí el Copiloto IA para cargarla o configurala en .env.';
      setErrorMessage(msg);
      notify?.(msg, 'error');
      return;
    }

    setScanning(true);

    // Procesamiento de solo texto cuando no se adjuntaron archivos
    if (!hasFiles && hasContext) {
      setScanProgress({ current: 0, total: 1 });
      try {
        const parsed = await analizarFacturaRemito(null, contextoUsuario);
        const fechaEmision = parsed.fecha || fechaOperacion || new Date().toISOString().slice(0, 10);
        const isNC =
          Boolean(parsed.es_nota_credito) ||
          parsed.tipo_comprobante?.toLowerCase().includes('crédito') ||
          parsed.tipo_comprobante?.toLowerCase().includes('credito') ||
          Number(parsed.total) < 0;

        const totalBruto = Math.abs(Number(parsed.total) || 0);
        const montoSignado = isNC ? -totalBruto : totalBruto;

        let tdcVal = Number(dolarRef) || 1600;
        let tdcFuente = 'Dólar Ref. General';
        if (parsed.tipo_cambio_manuscrito && Number(parsed.tipo_cambio_manuscrito) > 0) {
          tdcVal = Number(parsed.tipo_cambio_manuscrito);
          tdcFuente = 'Tipo de cambio manuscrito / aclarado';
        }

        let totalUSD = 0;
        let totalARS = 0;
        if (parsed.moneda === 'USD') {
          totalUSD = Math.round(montoSignado * 100) / 100;
          totalARS = Math.round(montoSignado * tdcVal);
        } else {
          totalARS = Math.round(montoSignado);
          totalUSD = Math.round((montoSignado / tdcVal) * 100) / 100;
        }

        const singleItem = {
          id: `fact_txt_${Date.now()}`,
          originalName: 'Indicaciones en Lenguaje Natural',
          displayName: 'Indicaciones de Factura (Texto)',
          imageUrl: null,
          tipo_comprobante: parsed.tipo_comprobante || 'Factura A',
          punto_venta: parsed.punto_venta || '0001',
          numero_comprobante: parsed.numero_comprobante || '',
          emisor: parsed.emisor || '',
          cuit_emisor: parsed.cuit_emisor || '',
          fecha: fechaEmision,
          moneda: parsed.moneda || 'ARS',
          total: montoSignado,
          tipo_cambio_utilizado: tdcVal,
          tipo_cambio_fuente: tdcFuente,
          total_usd: totalUSD,
          total_ars: totalARS,
          categoria_id: null,
          categoria_sugerida: parsed.categoria_sugerida || 'Insumos Agrícolas',
          es_nota_credito: isNC,
          lineas_articulos: parsed.lineas_articulos || [],
          observaciones: parsed.observaciones || contextoUsuario,
          estado_extraccion: 'ok',
          seleccionado: true,
        };
        setScannedBatch((prev) => [singleItem, ...prev]);
        notify?.('Comprobante interpretado desde el texto de contexto.', 'success');
      } catch (err) {
        setErrorMessage(`Error al procesar indicaciones: ${err.message}`);
        notify?.(`Error al procesar: ${err.message}`, 'error');
      } finally {
        setScanning(false);
      }
      return;
    }

    setScanProgress({ current: 0, total: selected.length });

    // 1. Desglosar archivos: si hay PDFs multipágina, trozarlos en páginas JPEG
    const itemsToProcess = [];
    for (const file of selected) {
      if (isPdfFile(file)) {
        try {
          const pages = await slicePdfToImages(file, {
            maxWidth: 1600,
            quality: 0.82,
            maxPages: 60,
            onProgress: ({ current, total }) => {
              setScanProgress({ current, total });
            },
          });
          pages.forEach((p) => {
            const pageTag = p.totalPages > 1 ? ` (Pág. ${p.pageNumber}/${p.totalPages})` : '';
            itemsToProcess.push({
              file: p.file,
              originalName: file.name,
              displayName: `${file.name}${pageTag}`,
              mimeType: p.mimeType || (isPdfFile(p.file) ? 'application/pdf' : 'image/jpeg'),
            });
          });
        } catch (pdfErr) {
          console.warn('[GeminiFacturasBatch] Fallback al trozar PDF, procesando archivo directo:', pdfErr);
          itemsToProcess.push({
            file,
            originalName: file.name,
            displayName: file.name,
            mimeType: 'application/pdf',
          });
        }
      } else {
        itemsToProcess.push({
          file,
          originalName: file.name,
          displayName: file.name,
          mimeType: file.type || 'image/jpeg',
        });
      }
    }

    setScanProgress({ current: 0, total: itemsToProcess.length });
    let completedCount = 0;

    // 2. Procesar con concurrencia controlada (lotes de a 3 páginas en paralelo)
    const newItems = await runWithControlledConcurrency(
      itemsToProcess,
      async (item, idx) => {
        try {
          let fileToSend = item.file;
          // Solo comprimir si es imagen pura y no es PDF
          if (fileToSend.type?.startsWith('image/') && !isPdfFile(fileToSend)) {
            fileToSend = await compressImage(fileToSend, 1600, 0.82);
          }
          const parsed = await analizarFacturaRemito(fileToSend, contextoUsuario);
          // Si hay Storage activo, subir imagen comprimida y conservar solo downloadURL
          const downloadUrl = await uploadCompressedImageIfStorageActive(fileToSend, 'facturas');

          completedCount++;
          setScanProgress({ current: completedCount, total: itemsToProcess.length });

          const fechaEmision = parsed.fecha || fechaOperacion || new Date().toISOString().slice(0, 10);

          // Detección de Nota de Crédito (NC): Signo negativo
          const isNC =
            Boolean(parsed.es_nota_credito) ||
            parsed.tipo_comprobante?.toLowerCase().includes('crédito') ||
            parsed.tipo_comprobante?.toLowerCase().includes('credito') ||
            Number(parsed.total) < 0;

          const isReceta =
            String(parsed.tipo_comprobante || '').toLowerCase().includes('receta') ||
            String(parsed.tipo_comprobante || '').toLowerCase().includes('rao') ||
            item.displayName.toLowerCase().includes('receta') ||
            item.displayName.toLowerCase().includes('rao');

          const totalBruto = Math.abs(Number(parsed.total) || 0);
          const montoSignado = isNC ? -totalBruto : totalBruto;

          // Determinación del Tipo de Cambio (TdC):
          // 1. Manuscrito a mano > 2. Dólar Blue histórico a la fecha > 3. Dólar Ref global
          let tdcVal = Number(dolarRef) || 1600;
          let tdcFuente = 'Dólar Ref. General';

          if (parsed.tipo_cambio_manuscrito && Number(parsed.tipo_cambio_manuscrito) > 0) {
            tdcVal = Number(parsed.tipo_cambio_manuscrito);
            tdcFuente = 'Manuscrito en Comprobante';
          } else if ((parsed.moneda || 'ARS') === 'ARS') {
            const hist = await obtenerDolarBlueHistorico(fechaEmision, dolarRef);
            tdcVal = hist.rate;
            tdcFuente = hist.fuente;
          }

          const netoGrav = Math.abs(Number(parsed.neto_gravado) || Number(parsed.subtotal_neto) || totalBruto / 1.21);
          const alicIva = Number(parsed.alicuota_iva) || 21.0;
          const montoIvaCalc = Math.abs(Number(parsed.monto_iva) || Number(parsed.iva) || (totalBruto - netoGrav));
          const percIvaVal = Math.abs(Number(parsed.percepciones_iva) || 0);

          return {
            temp_id: `factura_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
            nombre_archivo: item.displayName,
            download_url: downloadUrl || null,
            fecha: fechaEmision,
            proveedor: parsed.proveedor || 'Proveedor Desconocido',
            cuit_proveedor: parsed.cuit_proveedor || '',
            comprobante: parsed.numero_comprobante || '',
            tipo_comprobante: parsed.tipo_comprobante || (isReceta ? 'Receta Agronómica RAO' : isNC ? 'Nota de Crédito' : 'Factura B'),
            es_nota_credito: isNC,
            es_receta_agronomica: isReceta,
            rubro: mapCategoryToRubro(parsed.categoria),
            concepto: parsed.descripcion_resumen || item.displayName,
            moneda_carga: parsed.moneda_detectada || parsed.moneda || 'ARS',
            tipo_cambio: String(tdcVal),
            tdc_fuente: tdcFuente,
            monto_original: montoSignado,
            neto_gravado: isNC ? -netoGrav : netoGrav,
            alicuota_iva: alicIva,
            monto_iva: isNC ? -montoIvaCalc : montoIvaCalc,
            percepciones_iva: isNC ? -percIvaVal : percIvaVal,
            percepciones_iibb: Number(parsed.percepciones_iibb) || 0,
            otras_percepciones: Number(parsed.otras_percepciones) || 0,
            subtotal_neto: parsed.subtotal_neto,
            iva: parsed.iva_detectado || parsed.iva,
            monto_sin_facturar: Number(parsed.monto_sin_facturar) || 0,
            total_documento: parsed.total_documento || montoSignado,
            notas_auditoria_ia: parsed.notas_auditoria_ia || null,
            partidas_detalle: parsed.partidas_detalle || [],
            nota_manuscrita_util: parsed.nota_manuscrita_util || null,
            nota_manuscrita_descartada: parsed.nota_manuscrita_descartada || null,
            items: parsed.items || [],
            observaciones: parsed.observaciones || '',
            status: 'ok',
          };
        } catch (err) {
          completedCount++;
          setScanProgress({ current: completedCount, total: itemsToProcess.length });
          const rawErrMsg = err?.message || String(err) || 'Error desconocido al escanear';
          return {
            temp_id: `factura_${Date.now()}_${idx}`,
            nombre_archivo: item.displayName,
            fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
            proveedor: 'Error al escanear',
            rubro: 'Administración / Estructura',
            concepto: `Error: ${rawErrMsg}`,
            error_detalle: rawErrMsg,
            moneda_carga: 'ARS',
            tipo_cambio: String(dolarRef),
            tdc_fuente: 'Error',
            monto_original: 0,
            status: 'error',
          };
        }
      },
      3 // Concurrencia de 3 peticiones simultáneas
    );

    setScannedBatch((prev) => [...prev, ...newItems]);
    setFilesToScan([]);
    setScanning(false);
  }

  function mapCategoryToRubro(cat = '') {
    const lower = cat.toLowerCase();
    if (lower.includes('sanidad') || lower.includes('vacuna')) return 'Sanidad / Vacunas';
    if (lower.includes('alimento') || lower.includes('suplement')) return 'Suplementación / Reservas';
    if (lower.includes('maquinaria') || lower.includes('repuesto')) return 'Maquinaria / Repuestos';
    if (lower.includes('combustible') || lower.includes('gasoil')) return 'Combustible';
    if (lower.includes('infraestructura') || lower.includes('molino')) return 'Infraestructura / Proveedores Externos';
    if (lower.includes('siembra') || lower.includes('pastura')) return 'Siembras y Labores Agrícolas';
    if (lower.includes('honorario') || lower.includes('veterinario')) return 'Honorarios Veterinarios';
    return 'Administración / Estructura';
  }

  async function updateBatchItem(temp_id, field, value) {
    if (field === 'fecha') {
      // Si cambia la fecha y la moneda es ARS, actualizar cotización histórica
      const item = scannedBatch.find((i) => i.temp_id === temp_id);
      if (item && item.moneda_carga === 'ARS' && !item.nota_manuscrita_util?.includes('TC')) {
        const h = await obtenerDolarBlueHistorico(value, dolarRef);
        setScannedBatch((prev) =>
          prev.map((i) =>
            i.temp_id === temp_id
              ? { ...i, fecha: value, tipo_cambio: String(h.rate), tdc_fuente: h.fuente }
              : i
          )
        );
        return;
      }
    }
    setScannedBatch((prev) =>
      prev.map((item) => (item.temp_id === temp_id ? { ...item, [field]: value } : item))
    );
  }

  function toggleNotaCredito(temp_id) {
    setScannedBatch((prev) =>
      prev.map((item) => {
        if (item.temp_id !== temp_id) return item;
        const newNC = !item.es_nota_credito;
        const absVal = Math.abs(Number(item.monto_original) || 0);
        const absNeto = Math.abs(Number(item.neto_gravado) || 0);
        const absIva = Math.abs(Number(item.monto_iva) || 0);
        const absPerc = Math.abs(Number(item.percepciones_iva) || 0);
        return {
          ...item,
          es_nota_credito: newNC,
          tipo_comprobante: newNC ? 'Nota de Crédito A' : 'Factura A',
          monto_original: newNC ? -absVal : absVal,
          neto_gravado: newNC ? -absNeto : absNeto,
          monto_iva: newNC ? -absIva : absIva,
          percepciones_iva: newNC ? -absPerc : absPerc,
        };
      })
    );
  }

  function removeBatchItem(temp_id) {
    setScannedBatch((prev) => prev.filter((item) => item.temp_id !== temp_id));
  }

  async function handleApproveAndSaveAll() {
    // Validar comprobantes que tengan monto distinto de 0 (soporta montos negativos por NC)
    const validItems = scannedBatch.filter(
      (item) => item.status === 'ok' && Number(item.monto_original) !== 0
    );
    if (validItems.length === 0) {
      notify?.('No hay comprobantes válidos para guardar.', 'info');
      return;
    }

    setSaving(true);
    try {
      const recordsToInsert = validItems.map((item) => {
        const montoOrig = Number(item.monto_original) || 0;
        const tc = Number(item.tipo_cambio) || Number(dolarRef) || 1540;
        const montoArs = item.moneda_carga === 'USD' ? montoOrig * tc : montoOrig;
        const montoUsd = item.moneda_carga === 'USD' ? montoOrig : tc > 0 ? montoArs / tc : 0;

        return {
          fecha: item.fecha,
          rubro: item.rubro,
          concepto: item.concepto,
          proveedor: item.proveedor,
          comprobante: item.comprobante || null,
          tipo_comprobante: item.tipo_comprobante || (item.es_nota_credito ? 'Nota de Crédito' : 'Factura'),
          es_nota_credito: Boolean(item.es_nota_credito),
          moneda_carga: item.moneda_carga,
          tipo_cambio: tc,
          monto_original: montoOrig,
          monto_ars: montoArs,
          monto_usd: montoUsd,
          neto_gravado: Number(item.neto_gravado) || 0,
          alicuota_iva: Number(item.alicuota_iva) || 21.0,
          monto_iva: Number(item.monto_iva) || 0,
          percepciones_iva: Number(item.percepciones_iva) || 0,
          percepciones_iibb: Number(item.percepciones_iibb) || 0,
          otras_percepciones: Number(item.otras_percepciones) || 0,
          nota_manuscrita_util: item.nota_manuscrita_util || null,
          nota_manuscrita_descartada: item.nota_manuscrita_descartada || null,
          tdc_fuente: item.tdc_fuente || null,
          estado_pago: 'Pagado',
          observaciones: [
            item.observaciones || '',
            item.es_nota_credito ? 'Nota de Crédito (Resta de rubro)' : '',
            item.nota_manuscrita_util ? `Nota manuscrita: ${item.nota_manuscrita_util}` : '',
            item.tdc_fuente ? `TdC: ${item.tdc_fuente}` : '',
            item.download_url ? `Comprobante: ${item.download_url}` : '',
            'Importado con Gemini IA',
          ].filter(Boolean).join(' · '),
        };
      });

      const { data: insertedData, error } = await supabase
        .from('gastos_campo')
        .insert(recordsToInsert)
        .select('id');
      if (error) throw error;

      const insertedIds = (insertedData || []).map((r) => r.id);

      // Registrar en audit_logs para trazabilidad y deshacer en un clic
      try {
        const provSample = Array.from(new Set(recordsToInsert.map((r) => r.proveedor).filter(Boolean)))
          .slice(0, 3)
          .join(', ');
        await registrarAuditLog({
          tipo_operacion: 'CARGA_MASIVA_FACTURAS',
          modulo: 'Finanzas',
          descripcion: `Carga masiva IA: ${recordsToInsert.length} comprobantes (${provSample || 'Sin proveedor'})`,
          afectados_tabla: 'gastos_campo',
          afectados_ids: insertedIds,
          metadata: {
            cantidad_comprobantes: recordsToInsert.length,
            total_ars: totalArsLote,
            proveedores: provSample,
          },
        });
      } catch (logErr) {
        console.warn('Error guardando audit log:', logErr);
      }

      notify?.(`¡Lote guardado! Se registraron ${recordsToInsert.length} comprobantes en Supabase.`, 'success');
      setScannedBatch([]);
      onClose();
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al guardar comprobantes: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const totalArsLote = scannedBatch.reduce((acc, item) => {
    const m = Number(item.monto_original) || 0;
    const tc = Number(item.tipo_cambio) || dolarRef;
    return acc + (item.moneda_carga === 'USD' ? m * tc : m);
  }, 0);

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="fixed inset-0 z-[9999] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-auto max-h-[90vh] flex flex-col">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-950 text-emerald-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-slate-900">
                  Escáner Inteligente de Facturas y Remitos
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Gemini IA Multimodal
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Subí uno o múltiples comprobantes juntos (fotos o PDFs). La IA extrae proveedor, montos y sugiere el rubro.
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
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage('')}
              className="text-red-500 hover:text-red-700 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Zona de Arrastre y Bandeja de Archivos */}
        <MultiFileDropzone
          files={filesToScan}
          onFilesChange={setFilesToScan}
          accept="image/*,application/pdf"
          disabled={scanning}
          isProcessing={scanning}
          onProcessBatch={() => processSelectedFiles(filesToScan)}
          title="Arrastrá o seleccioná facturas y remitos (PDF, JPG, PNG)"
          subtitle="Podés seleccionar varios comprobantes a la vez o escribir indicaciones. Revisá la bandeja previa y analizá todo el lote junto con Gemini IA."
          processButtonText="✨ Analizar Lote de Facturas con IA"
          contextText={contextoUsuario}
          onContextTextChange={setContextoUsuario}
          contextPlaceholder="Ej: Factura 1050 de Cooperativa por 200 L glifosato a $4.200/L y 50 L 2,4-D a $8.500/L. Descontar en 30 días..."
          contextLabel="📝 Contexto, Precios o Aclaraciones para la IA"
          allowTextOnly={true}
        />

        {/* Tabla Previa Editable */}
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-extrabold text-slate-800">
              Comprobantes Procesados ({scannedBatch.length})
            </span>
            {scannedBatch.length > 0 && (
              <span className="font-extrabold text-emerald-900">
                Total Neto Lote: ${totalArsLote.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS
              </span>
            )}
          </div>

          {scannedBatch.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-slate-200 rounded-xl">
              Todavía no subiste ningún comprobante. Seleccioná los archivos arriba para ver la previsualización editable.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-2.5">Fecha</th>
                    <th className="p-2.5">Tipo / Proveedor</th>
                    <th className="p-2.5">Rubro</th>
                    <th className="p-2.5">Concepto & Anotaciones</th>
                    <th className="p-2.5">IVA & Neto</th>
                    <th className="p-2.5 text-right">TdC Compra</th>
                    <th className="p-2.5 text-right">Total Facturado</th>
                    <th className="p-2.5 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scannedBatch.map((item) => {
                    const isNc = Boolean(item.es_nota_credito);
                    const isErr = item.status === 'error';
                    return (
                      <tr
                        key={item.temp_id}
                        className={`hover:bg-slate-50 transition-colors ${
                          isErr ? 'bg-rose-50/60' : isNc ? 'bg-purple-50/40' : ''
                        }`}
                      >
                        {/* Fecha */}
                        <td className="p-2 align-top">
                          <input
                            type="date"
                            value={item.fecha}
                            onChange={(e) => updateBatchItem(item.temp_id, 'fecha', e.target.value)}
                            className="px-2 py-1 rounded border border-slate-200 text-[11px] font-bold"
                          />
                          <span
                            className="text-[9px] text-slate-400 block mt-0.5 max-w-[120px] truncate"
                            title={item.nombre_archivo}
                          >
                            {item.nombre_archivo}
                          </span>
                        </td>

                        {/* Tipo / Proveedor */}
                        <td className="p-2 align-top">
                          <div className="flex items-center gap-1.5 mb-1">
                            {isErr ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black border bg-rose-100 text-rose-800 border-rose-300 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                                Error de lectura
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleNotaCredito(item.temp_id)}
                                title="Hacé clic para alternar entre Factura y Nota de Crédito (descuento)"
                                className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition ${
                                  item.es_receta_agronomica
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                    : isNc
                                    ? 'bg-purple-100 text-purple-900 border-purple-300'
                                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-purple-50'
                                }`}
                              >
                                {item.es_receta_agronomica
                                  ? '🌱 Receta RAO'
                                  : isNc
                                  ? '🏷️ NC (Descuento)'
                                  : '📄 Factura'}
                              </button>
                            )}
                            {item.comprobante && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                {item.comprobante}
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            value={item.proveedor}
                            onChange={(e) => updateBatchItem(item.temp_id, 'proveedor', e.target.value)}
                            className={`w-full px-2 py-1 rounded border text-[11px] font-bold ${
                              isErr ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'
                            }`}
                            placeholder="Proveedor"
                          />
                        </td>

                        {/* Rubro */}
                        <td className="p-2 align-top">
                          <select
                            value={item.rubro}
                            onChange={(e) => updateBatchItem(item.temp_id, 'rubro', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-slate-200 text-[11px] font-bold bg-white"
                          >
                            {CATEGORIAS_OPERATIVAS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Concepto & Anotaciones Manuscritas */}
                        <td className="p-2 align-top max-w-[280px]">
                          <input
                            type="text"
                            value={item.concepto}
                            title={item.error_detalle || item.concepto}
                            onChange={(e) => updateBatchItem(item.temp_id, 'concepto', e.target.value)}
                            className={`w-full px-2 py-1 rounded border text-[11px] ${
                              isErr
                                ? 'border-rose-300 bg-rose-50 text-rose-900 font-medium'
                                : 'border-slate-200'
                            }`}
                          />
                          {/* Detalle técnico completo cuando hay error */}
                          {isErr && (
                            <div
                              className="mt-1 p-1.5 rounded bg-rose-100/70 border border-rose-300 text-rose-900 text-[10px] leading-tight select-all whitespace-normal break-words"
                              title={item.error_detalle || item.concepto}
                            >
                              <div className="font-bold flex items-center gap-1 text-rose-950 mb-0.5">
                                <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                                <span>Detalle técnico completo:</span>
                              </div>
                              <p className="font-mono text-[9px] break-all leading-relaxed select-all">
                                {item.error_detalle || item.concepto}
                              </p>
                            </div>
                          )}
                          {/* Anotaciones Útiles vs Descartadas */}
                          {item.nota_manuscrita_util && (
                            <div className="mt-1 px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded text-[10px] font-bold flex items-center gap-1">
                              <span>✍️ Útil:</span>
                              <span className="font-normal truncate">{item.nota_manuscrita_util}</span>
                            </div>
                          )}
                          {item.nota_manuscrita_descartada && (
                            <div className="mt-0.5 text-[10px] text-slate-400 italic flex items-center gap-1">
                              <span>🗑️ Descartado:</span>
                              <span className="truncate">{item.nota_manuscrita_descartada}</span>
                            </div>
                          )}
                          {/* Notas de Auditoría y Razonamiento Gemini 2.5 Pro */}
                          {item.notas_auditoria_ia && (
                            <div className="mt-1 p-1.5 rounded bg-emerald-50/70 border border-emerald-200 text-emerald-950 text-[10px] leading-tight select-text">
                              <div className="font-bold flex items-center gap-1 text-emerald-800 mb-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                <span>Auditoría Gemini 2.5 Pro:</span>
                              </div>
                              <p className="text-[10px] font-sans text-slate-700 leading-snug">
                                {item.notas_auditoria_ia}
                              </p>
                              {item.monto_sin_facturar > 0 && (
                                <div className="mt-1 font-bold text-amber-800 text-[9px]">
                                  ⚠️ Sin facturar detectado: ${Math.round(item.monto_sin_facturar).toLocaleString('es-AR')}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* IVA & Neto */}
                        <td className="p-2 align-top">
                          <div className="space-y-1 text-[11px]">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] text-slate-500">Neto:</span>
                              <input
                                type="number"
                                step="0.01"
                                value={item.neto_gravado || ''}
                                onChange={(e) => updateBatchItem(item.temp_id, 'neto_gravado', e.target.value)}
                                className="w-20 px-1 py-0.5 rounded border border-slate-200 text-[10px] text-right"
                              />
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] text-slate-500">
                                IVA ({item.alicuota_iva || 21}%):
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                value={item.monto_iva || ''}
                                onChange={(e) => updateBatchItem(item.temp_id, 'monto_iva', e.target.value)}
                                className="w-20 px-1 py-0.5 rounded border border-slate-200 text-[10px] text-right"
                              />
                            </div>
                            {Number(item.percepciones_iva) !== 0 && (
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] text-amber-700">Perc. IVA:</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.percepciones_iva || ''}
                                  onChange={(e) => updateBatchItem(item.temp_id, 'percepciones_iva', e.target.value)}
                                  className="w-20 px-1 py-0.5 rounded border border-amber-200 bg-amber-50 text-[10px] text-right"
                                />
                              </div>
                            )}
                          </div>
                        </td>

                        {/* TdC Compra */}
                        <td className="p-2 align-top text-right">
                          <div className="flex flex-col items-end">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-bold text-slate-400">$</span>
                              <input
                                type="number"
                                step="0.5"
                                value={item.tipo_cambio}
                                onChange={(e) => updateBatchItem(item.temp_id, 'tipo_cambio', e.target.value)}
                                className="w-16 px-1.5 py-0.5 rounded border border-slate-200 text-[11px] font-bold text-right"
                              />
                            </div>
                            <span className="text-[9px] font-extrabold text-emerald-800 bg-emerald-50 px-1 rounded mt-0.5 truncate max-w-[110px]" title={item.tdc_fuente}>
                              {item.tdc_fuente || 'Dólar Ref.'}
                            </span>
                          </div>
                        </td>

                        {/* Total Facturado */}
                        <td className="p-2 align-top text-right">
                          <div className="flex items-center justify-end gap-1">
                            <select
                              value={item.moneda_carga}
                              onChange={(e) => updateBatchItem(item.temp_id, 'moneda_carga', e.target.value)}
                              className="px-1 py-0.5 rounded border border-slate-200 text-[10px] font-bold bg-white"
                            >
                              <option value="ARS">ARS</option>
                              <option value="USD">USD</option>
                            </select>
                            <input
                              type="number"
                              step="0.01"
                              value={item.monto_original}
                              onChange={(e) => updateBatchItem(item.temp_id, 'monto_original', e.target.value)}
                              className={`w-24 px-1.5 py-0.5 rounded border text-[11px] font-black text-right ${
                                isNc
                                  ? 'border-purple-300 bg-purple-50 text-purple-900'
                                  : 'border-slate-200 text-slate-900'
                              }`}
                            />
                          </div>
                          {isNc && (
                            <span className="text-[9px] font-black text-purple-700 block mt-0.5">
                              Resta del gasto
                            </span>
                          )}
                        </td>

                        {/* Acción */}
                        <td className="p-2 align-top text-center">
                          <button
                            type="button"
                            onClick={() => removeBatchItem(item.temp_id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            Los gastos se guardarán como <strong>Pagados</strong> en <code>gastos_campo</code>.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApproveAndSaveAll}
              disabled={saving || scannedBatch.length === 0}
              className="px-5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold shadow-sm transition disabled:opacity-40"
            >
              {saving ? 'Guardando en Supabase...' : `Aprobar y Guardar Lote (${scannedBatch.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
