import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  FileDown,
  Sparkles,
  Plus,
  Scale,
  Calendar,
  Building,
  DollarSign,
  TrendingUp,
  Search,
  Filter,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertCircle,
  X,
  UploadCloud,
  Layers,
  ArrowRightLeft,
  Tag,
  Eye,
  RefreshCw,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import { exportarListadoVentasPDF, exportarDetalleLiquidacionPDF } from '../utils/pdfHelper';
import { registrarAuditLog } from '../utils/auditLogger';
import NumericInput from './NumericInput';
import {
  analizarLiquidacionHacienda,
  compressImage,
} from '../lib/geminiService';
import { isPdfFile, slicePdfToImages, runWithControlledConcurrency } from '../lib/pdfSlicer';
import { obtenerDolarBlueHistorico } from '../lib/dolarService';
import LiquidacionDetalleModal from './LiquidacionDetalleModal.jsx';
import { confirmAction } from './ConfirmDialog';

/**
 * Agrupa y consolida categorías repetidas provenientes de remitos o liquidaciones con múltiples lotes.
 * Ejemplo: "Terneras (2) + Vacas (3) + Vacas (3) + Terneras (40)" -> "Vacas (6) · Terneras (42)"
 */
export function consolidarCategoriasVenta(categoriaStr = '', renglones = null) {
  // 1. Si vienen renglones estructurados en array
  if (Array.isArray(renglones) && renglones.length > 0) {
    const mapa = new Map();
    renglones.forEach((r) => {
      const cat = (r.categoria || 'Hacienda General').trim();
      const cab = Number(r.cabezas) || 0;
      mapa.set(cat, (mapa.get(cat) || 0) + cab);
    });
    return Array.from(mapa.entries())
      .map(([cat, cab]) => (cab > 0 ? `${cat} (${cab})` : cat))
      .join(' · ');
  }

  if (!categoriaStr || typeof categoriaStr !== 'string') {
    return 'Hacienda General';
  }

  // Si no contiene separador de lotes '+' ni paréntesis de cantidad, devolver tal cual
  if (!categoriaStr.includes('+') && !categoriaStr.includes('(')) {
    return categoriaStr.trim();
  }

  const partes = categoriaStr.split('+');
  const mapa = new Map();

  partes.forEach((parte) => {
    const clean = parte.trim();
    if (!clean) return;

    // Patrón "Nombre (N)" o "Nombre (N cab)" o "N Nombre"
    const matchPar = clean.match(/^(.*?)\s*\((\d+)\s*cab\.?\)?$/i) || clean.match(/^(.*?)\s*\((\d+)\)$/);
    if (matchPar) {
      const nombreCat = matchPar[1].trim();
      const cantidad = parseInt(matchPar[2], 10) || 0;
      mapa.set(nombreCat, (mapa.get(nombreCat) || 0) + cantidad);
    } else {
      mapa.set(clean, (mapa.get(clean) || 0));
    }
  });

  if (mapa.size === 0) return categoriaStr;

  return Array.from(mapa.entries())
    .map(([cat, cab]) => (cab > 0 ? `${cat} (${cab})` : cat))
    .join(' · ');
}

export default function VentasView({
  ventas = [],
  rodeos = [],
  potreros = [],
  animales = [],
  dolarRef = 1600,
  fechaOperacion = '',
  notify,
  onRefresh,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('TODOS');
  const [filterRodeo, setFilterRodeo] = useState('TODOS');

  // Modales
  const [selectedVentaForDetail, setSelectedVentaForDetail] = useState(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showAccionesMenu, setShowAccionesMenu] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [activeRowMenuId, setActiveRowMenuId] = useState(null);

  // Cerrar menú de acciones contextual al hacer clic fuera
  useEffect(() => {
    function handleClickOutside() {
      setActiveRowMenuId(null);
    }
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Estado del escaneo Batch
  const [batchItems, setBatchItems] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [savingBatch, setSavingBatch] = useState(false);
  const fileInputRef = useRef(null);

  // Formulario manual
  const [manualForm, setManualForm] = useState({
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    comprador: '',
    rodeo_nombre: '',
    categoria: 'Vacas',
    cantidad_cabezas: '',
    kilos_totales: '',
    precio_kg: '',
    gastos_comercializacion_ars: '0',
    tipo_cambio: dolarRef || 1600,
    descontar_stock: true,
    observaciones: '',
  });

  const availablePeriods = useMemo(() => {
    const s = new Set();
    ventas.forEach((v) => {
      if (v.fecha && v.fecha.length >= 7) s.add(v.fecha.slice(0, 7));
    });
    return Array.from(s).sort().reverse();
  }, [ventas]);

  const filteredVentas = useMemo(() => {
    return ventas.filter((v) => {
      if (filterPeriod !== 'TODOS' && (!v.fecha || !v.fecha.startsWith(filterPeriod))) {
        return false;
      }
      if (filterRodeo !== 'TODOS' && v.rodeo_nombre !== filterRodeo) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const comp = (v.comprador || v.destino_consignatario || '').toLowerCase();
        const cat = (v.categoria || '').toLowerCase();
        const obs = (v.observaciones || '').toLowerCase();
        const nLiq = (v.tipo_comprobante || '').toLowerCase();
        if (!comp.includes(q) && !cat.includes(q) && !obs.includes(q) && !nLiq.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [ventas, filterPeriod, filterRodeo, searchTerm]);

  // 4 KPIs superiores con desglose preciso de kilos y cabezas pesadas
  const stats = useMemo(() => {
    let cab = 0;
    let kg = 0;
    let netoArs = 0;
    let netoUsd = 0;
    let brutoArs = 0;
    let ivaDebito = 0;
    let cabezasPesadas = 0;

    filteredVentas.forEach((v) => {
      const vCab = Number(v.cantidad_cabezas) || 0;
      const vKg = Number(v.kilos_totales) || 0;
      cab += vCab;
      kg += vKg;
      if (vKg > 0) {
        cabezasPesadas += vCab;
      }
      const b = Number(v.importe_bruto_ars) || 0;
      brutoArs += b;
      netoArs += Number(v.ingreso_neto_ars) || 0;
      netoUsd += Number(v.ingreso_neto_usd) || ((Number(v.ingreso_neto_ars) || 0) / (Number(v.tipo_cambio) || dolarRef || 1600));
      ivaDebito += (v.monto_iva !== null && v.monto_iva !== undefined && v.monto_iva !== '')
        ? Number(v.monto_iva)
        : (b * 0.105);
    });

    const promKgArs = kg > 0 ? (brutoArs / kg) : 0;
    const promKgUsd = kg > 0 && netoUsd > 0 ? (netoUsd / kg) : 0;
    const cabezasSinKilos = Math.max(0, cab - cabezasPesadas);

    return {
      cabezas: cab,
      cabezasPesadas,
      cabezasSinKilos,
      kilos: kg,
      brutoArs,
      ivaDebito,
      netoArs,
      netoUsd,
      promKgArs,
      promKgUsd,
      count: filteredVentas.length,
    };
  }, [filteredVentas, dolarRef]);

  // Eliminar liquidación con confirmación protegida
  async function handleDeleteVenta(venta) {
    if (!venta) return;
    const comp = venta.comprador || venta.destino_consignatario || 'Liquidación';
    const neto = Math.round(Number(venta.ingreso_neto_ars || 0)).toLocaleString('es-AR');
    const cab = Number(venta.cantidad_cabezas || 0);

    const ok = await confirmAction({
      title: `¿Eliminar liquidación de ${comp}?`,
      description: `Monto neto: $${neto} ARS (${cab} cabezas). Esta acción eliminará el registro de venta y su impacto contable.`,
      confirmText: 'Sí, eliminar venta',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('ventas_hacienda').delete().eq('id', venta.id);
      if (error) throw error;

      await registrarAuditLog({
        tipo_operacion: 'VENTA_HACIENDA_ELIMINADA',
        modulo: 'Ventas',
        descripcion: `Liquidación #${venta.id} eliminada: ${comp} ($${neto})`,
        afectados_tabla: 'ventas_hacienda',
        afectados_ids: [venta.id],
        metadata: { id: venta.id, comprador: comp, neto_ars: venta.ingreso_neto_ars },
      });

      notify?.(`Liquidación de ${comp} eliminada con éxito.`, 'success');
      await onRefresh?.();
    } catch (err) {
      console.error('Error eliminando venta:', err);
      notify?.(`Error al eliminar venta: ${err.message}`, 'error');
    }
  }

  // Exportar a Excel CSV
  function handleExportCSV() {
    if (filteredVentas.length === 0) {
      notify?.('No hay liquidaciones para exportar con el filtro actual.', 'error');
      return;
    }
    const headers = [
      'ID',
      'Fecha',
      'Consignatario / Comprador',
      'Comprobante / Liquidación',
      'Categoría',
      'Rodeo Origen',
      'Cabezas',
      'Kilos Totales',
      'Precio $/kg',
      'Importe Bruto ARS',
      'Gastos Comerc. ARS',
      'Ingreso Neto ARS',
      'Tipo de Cambio',
      'Ingreso Neto USD',
      'IVA Débito (10.5%)',
      'Observaciones',
    ];

    const rows = filteredVentas.map((v) => [
      v.id,
      v.fecha,
      `"${(v.comprador || '').replace(/"/g, '""')}"`,
      `"${(v.tipo_comprobante || '').replace(/"/g, '""')}"`,
      `"${(v.categoria || '').replace(/"/g, '""')}"`,
      `"${(v.rodeo_nombre || 'Sin asignar').replace(/"/g, '""')}"`,
      v.cantidad_cabezas,
      v.kilos_totales,
      v.precio_kg,
      v.importe_bruto_ars,
      v.gastos_comercializacion_ars,
      v.ingreso_neto_ars,
      v.tipo_cambio,
      v.ingreso_neto_usd,
      v.monto_iva,
      `"${(v.observaciones || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Ventas_Liquidaciones_San_Jose_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notify?.('Listado de ventas exportado a CSV.', 'success');
  }

  // Exportar PDF
  async function handleExportPDF() {
    if (filteredVentas.length === 0) {
      notify?.('No hay liquidaciones para exportar en el período seleccionado.', 'error');
      return;
    }
    setExportingPdf(true);
    try {
      await exportarListadoVentasPDF(filteredVentas, {
        periodoLabel: filterPeriod === 'TODOS' ? 'Historial Completo' : `Período ${filterPeriod}`,
        fechaOperacion,
        dolarRef,
        notify,
      });
    } catch (err) {
      console.error('Error exportando PDF ventas:', err);
      notify?.(`Error exportando PDF: ${err.message}`, 'error');
    } finally {
      setExportingPdf(false);
    }
  }

  // MOTOR BATCH MULTIPÁGINA IA PARA PDFS MERGEADOS DE VENTAS
  async function handleBatchFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setScanning(true);
    setScanProgress({ current: 0, total: files.length });

    const itemsToProcess = [];
    for (const file of files) {
      if (isPdfFile(file)) {
        try {
          const pages = await slicePdfToImages(file, {
            maxWidth: 1600,
            quality: 0.82,
            maxPages: 40,
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
          console.warn('[VentasBatch] Fallback al trozar PDF, procesando directo:', pdfErr);
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

    const parsedBatch = await runWithControlledConcurrency(
      itemsToProcess,
      async (item) => {
        try {
          let fileToSend = item.file;
          if (fileToSend.type?.startsWith('image/') && !isPdfFile(fileToSend)) {
            fileToSend = await compressImage(fileToSend, 1600, 0.82);
          }
          const parsed = await analizarLiquidacionHacienda(fileToSend);

          completedCount++;
          setScanProgress({ current: completedCount, total: itemsToProcess.length });

          const fechaEmision = parsed.fecha || fechaOperacion || new Date().toISOString().slice(0, 10);
          const histTc = await obtenerDolarBlueHistorico(fechaEmision, dolarRef);
          const tc = histTc?.valor || dolarRef || 1600;

          let totalCab = Number(parsed.total_cabezas) || 0;
          let totalKg = Number(parsed.total_kilos) || 0;
          let bruto = Number(parsed.importe_bruto_total) || 0;

          // Si hay renglones múltiples, sumar estrictamente TODOS los renglones (sin tomar un solo sub-lote)
          if (Array.isArray(parsed.renglones) && parsed.renglones.length > 0) {
            const sumKgRenglones = parsed.renglones.reduce((acc, r) => acc + (Number(r.kilos_totales) || 0), 0);
            const sumCabRenglones = parsed.renglones.reduce((acc, r) => acc + (Number(r.cabezas) || 0), 0);
            const sumBrutoRenglones = parsed.renglones.reduce((acc, r) => acc + (Number(r.importe_bruto) || 0), 0);

            if (sumKgRenglones > 0) totalKg = Math.max(totalKg, sumKgRenglones);
            if (sumCabRenglones > 0) totalCab = Math.max(totalCab, sumCabRenglones);
            if (sumBrutoRenglones > 0) bruto = Math.max(bruto, sumBrutoRenglones);
          }

          const gastos = Number(parsed.descuentos_comisiones_flete) || 0;
          const neto = Number(parsed.importe_neto_liquidado) || Math.max(0, bruto - gastos);
          const netoUsd = tc > 0 ? Math.round((neto / tc) * 100) / 100 : 0;
          // Calcular precio_kg usando Importe Bruto / Kilos Totales
          const precioKg = totalKg > 0 ? Math.round((bruto / totalKg) * 100) / 100 : 0;

          // Validación de sanidad
          const pesoPromedioCab = totalCab > 0 ? totalKg / totalCab : 0;
          let advertenciaSanidad = null;
          if (totalCab > 0 && totalKg > 0) {
            if (pesoPromedioCab < 120) {
              advertenciaSanidad = `⚠️ Revisar kilos totales: peso promedio por cabeza inusualmente bajo (${pesoPromedioCab.toFixed(1)} kg/cab < 120 kg).`;
            } else if (precioKg > 12000) {
              advertenciaSanidad = `⚠️ Revisar precio $/kg: precio inusualmente alto ($${precioKg.toLocaleString('es-AR')}/kg > $12.000/kg). Posible error en kilos totales.`;
            }
          }

          const categoriaPrincipal =
            parsed.renglones?.length > 1
              ? parsed.renglones.map((r) => `${r.categoria} (${r.cabezas})`).join(' + ')
              : parsed.renglones?.[0]?.categoria || 'Hacienda General';

          return {
            temp_id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            displayName: item.displayName,
            fecha: fechaEmision,
            comprador: parsed.consignataria_o_comprador || 'Consignatario / Remate',
            nro_comprobante: parsed.numero_liquidacion || 'Liq. Vta',
            categoria: categoriaPrincipal,
            cantidad_cabezas: totalCab,
            kilos_totales: totalKg,
            precio_kg: precioKg,
            importe_bruto_ars: bruto,
            gastos_comercializacion_ars: gastos,
            ingreso_neto_ars: neto,
            tipo_cambio: tc,
            ingreso_neto_usd: netoUsd,
            moneda: parsed.moneda_detectada || parsed.moneda || 'ARS',
            monto_iva: Number(parsed.monto_iva) || Math.round(bruto * 0.105 * 100) / 100,
            retenciones_iva: Number(parsed.retenciones_iva) || 0,
            percepciones_iva: Number(parsed.percepciones_iva) || 0,
            notas_auditoria_ia: parsed.notas_auditoria_ia || null,
            partidas_detalle: parsed.partidas_detalle || [],
            renglones: parsed.renglones || [],
            caravanas_detectadas: Array.isArray(parsed.caravanas_detectadas) ? parsed.caravanas_detectadas : [],
            rodeo_nombre: rodeos[0]?.nombre || '',
            descontar_stock: true,
            advertenciaSanidad,
            status: advertenciaSanidad ? 'alerta' : (totalCab > 0 || neto > 0 ? 'ok' : 'alerta'),
          };
        } catch (err) {
          console.warn('[VentasBatch] Error analizando liquidación:', err);
          completedCount++;
          setScanProgress({ current: completedCount, total: itemsToProcess.length });
          return {
            temp_id: `batch-err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            displayName: item.displayName,
            fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
            comprador: 'Error en escaneo',
            nro_comprobante: 'Error',
            categoria: 'Error al interpretar',
            cantidad_cabezas: 0,
            kilos_totales: 0,
            precio_kg: 0,
            importe_bruto_ars: 0,
            gastos_comercializacion_ars: 0,
            ingreso_neto_ars: 0,
            tipo_cambio: dolarRef || 1600,
            ingreso_neto_usd: 0,
            monto_iva: 0,
            retenciones_iva: 0,
            percepciones_iva: 0,
            caravanas_detectadas: [],
            rodeo_nombre: '',
            descontar_stock: false,
            status: 'error',
            errorMsg: err.message,
          };
        }
      },
      3
    );

    setBatchItems((prev) => [...prev, ...parsedBatch]);
    setScanning(false);
    setShowBatchModal(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function updateBatchItem(temp_id, field, value) {
    setBatchItems((prev) =>
      prev.map((item) => {
        if (item.temp_id !== temp_id) return item;
        const next = { ...item, [field]: value };
        if (field === 'cantidad_cabezas' || field === 'kilos_totales' || field === 'precio_kg' || field === 'gastos_comercializacion_ars') {
          const kg = Number(field === 'kilos_totales' ? value : next.kilos_totales) || 0;
          const precio = Number(field === 'precio_kg' ? value : next.precio_kg) || 0;
          const gastos = Number(field === 'gastos_comercializacion_ars' ? value : next.gastos_comercializacion_ars) || 0;
          const tc = Number(next.tipo_cambio) || 1600;
          const bruto = kg * precio;
          const neto = Math.max(0, bruto - gastos);
          next.importe_bruto_ars = Math.round(bruto * 100) / 100;
          next.ingreso_neto_ars = Math.round(neto * 100) / 100;
          next.ingreso_neto_usd = Math.round((neto / tc) * 100) / 100;
          next.monto_iva = Math.round(bruto * 0.105 * 100) / 100;
        }
        return next;
      })
    );
  }

  function removeBatchItem(temp_id) {
    setBatchItems((prev) => prev.filter((i) => i.temp_id !== temp_id));
  }

  // Confirmar y guardar el lote completo con impacto transversal sincronizado
  async function handleConfirmBatch() {
    const validItems = batchItems.filter((i) => i.status !== 'error' && (Number(i.cantidad_cabezas) > 0 || Number(i.ingreso_neto_ars) > 0));
    if (validItems.length === 0) {
      notify?.('No hay liquidaciones válidas para guardar en el lote.', 'error');
      return;
    }

    setSavingBatch(true);
    try {
      let totalCabVendidas = 0;
      let totalNetoArsLote = 0;
      let totalNetoUsdLote = 0;

      for (const item of validItems) {
        // 1. Guardar en ventas_hacienda
        const ventaRecord = {
          fecha: item.fecha,
          rodeo_nombre: item.rodeo_nombre || null,
          categoria: item.categoria,
          cantidad_cabezas: Number(item.cantidad_cabezas) || 0,
          kilos_totales: Number(item.kilos_totales) || 0,
          moneda_carga: 'ARS',
          tipo_cambio: Number(item.tipo_cambio) || dolarRef || 1600,
          precio_kg: Number(item.precio_kg) || 0,
          importe_bruto_ars: Number(item.importe_bruto_ars) || 0,
          gastos_comercializacion_ars: Number(item.gastos_comercializacion_ars) || 0,
          ingreso_neto_ars: Number(item.ingreso_neto_ars) || 0,
          ingreso_neto_usd: Number(item.ingreso_neto_usd) || 0,
          neto_gravado: Number(item.importe_bruto_ars) || 0,
          alicuota_iva: 10.5,
          monto_iva: Number(item.monto_iva) || 0,
          percepciones_iva: Number(item.percepciones_iva) || 0,
          retenciones_iva: Number(item.retenciones_iva) || 0,
          comprador: item.comprador,
          destino_consignatario: item.comprador,
          observaciones: `Liquidación N° ${item.nro_comprobante} · Carga Batch IA`,
        };

        const { data: insertedVenta, error: errVenta } = await supabase
          .from('ventas_hacienda')
          .insert(ventaRecord)
          .select('id')
          .single();

        if (errVenta) throw errVenta;

        totalCabVendidas += ventaRecord.cantidad_cabezas;
        totalNetoArsLote += ventaRecord.ingreso_neto_ars;
        totalNetoUsdLote += ventaRecord.ingreso_neto_usd;

        // 2. Si descuenta stock y seleccionó rodeo, registrar movimiento y descontar stock
        if (item.descontar_stock && item.rodeo_nombre && ventaRecord.cantidad_cabezas > 0) {
          const rodeoObj = rodeos.find((r) => r.nombre === item.rodeo_nombre);
          if (rodeoObj) {
            await supabase.from('movimientos_hacienda').insert({
              fecha: item.fecha,
              tipo_movimiento: 'Venta',
              rodeo_id: rodeoObj.id,
              rodeo_nombre: rodeoObj.nombre,
              potrero_origen: rodeoObj.potrero_numero ? parseInt(rodeoObj.potrero_numero, 10) : null,
              potrero_destino: null,
              categoria_afectada: item.categoria,
              cantidad_cabezas: ventaRecord.cantidad_cabezas,
              motivo_observaciones: `Venta a ${item.comprador} (${item.kilos_totales} kg totales - Liq. N° ${item.nro_comprobante})`,
            });

            // Descuento según categoría
            const catLower = item.categoria.toLowerCase();
            const qty = ventaRecord.cantidad_cabezas;
            const updated = { ...rodeoObj };

            if (catLower.includes('cut')) {
              updated.vacas_cut = Math.max(0, (Number(updated.vacas_cut) || 0) - qty);
            } else if (catLower.includes('vaca')) {
              updated.vacas = Math.max(0, (Number(updated.vacas) || 0) - qty);
            } else if (catLower.includes('terner')) {
              updated.terneros = Math.max(0, (Number(updated.terneros) || 0) - qty);
            } else if (catLower.includes('toro') || catLower.includes('padre')) {
              updated.toros_padres = Math.max(0, (Number(updated.toros_padres) || 0) - qty);
            } else if (catLower.includes('torito')) {
              updated.toritos = Math.max(0, (Number(updated.toritos) || 0) - qty);
            } else if (catLower.includes('vaquill')) {
              updated.vaquillonas_reposicion = Math.max(0, (Number(updated.vaquillonas_reposicion) || 0) - qty);
            } else {
              updated.vacas = Math.max(0, (Number(updated.vacas) || 0) - qty);
            }

            await supabase
              .from('rodeos')
              .update({
                vacas: updated.vacas,
                terneros: updated.terneros,
                toros_padres: updated.toros_padres,
                toritos: updated.toritos,
                vacas_cut: updated.vacas_cut,
                vaquillonas_reposicion: updated.vaquillonas_reposicion,
              })
              .eq('id', rodeoObj.id);
          }
        }

        // 3. Si se detectaron caravanas, pasarlas a BAJA_VENTA
        if (Array.isArray(item.caravanas_detectadas) && item.caravanas_detectadas.length > 0) {
          for (const carNum of item.caravanas_detectadas) {
            const cleanCar = String(carNum).trim();
            if (!cleanCar) continue;
            try {
              await supabase
                .from('animales')
                .update({
                  estado: 'Vendido',
                  fecha_salida: item.fecha,
                  motivo_salida: `Venta a ${item.comprador} (Liq. #${insertedVenta.id})`,
                })
                .ilike('caravana', cleanCar);
            } catch (carErr) {
              console.warn('[VentasBatch] Error actualizando caravana:', carErr);
            }
          }
        }

        // 4. Registro de auditoría
        await registrarAuditLog({
          tipo_operacion: 'VENTA_HACIENDA',
          modulo: 'Ventas',
          descripcion: `Liquidación Batch: ${item.comprador} (${ventaRecord.cantidad_cabezas} cab. · $${ventaRecord.ingreso_neto_ars.toLocaleString('es-AR')})`,
          afectados_tabla: 'ventas_hacienda',
          afectados_ids: [insertedVenta.id],
          metadata: {
            id: insertedVenta.id,
            comprador: item.comprador,
            cabezas: ventaRecord.cantidad_cabezas,
            neto_ars: ventaRecord.ingreso_neto_ars,
            neto_usd: ventaRecord.ingreso_neto_usd,
          },
        });
      }

      notify?.(
        `¡Lote de ${validItems.length} liquidaciones guardado con éxito! (${totalCabVendidas} cabezas · USD $${Math.round(totalNetoUsdLote).toLocaleString('es-AR')})`,
        'success'
      );
      setBatchItems([]);
      setShowBatchModal(false);
      await onRefresh?.();
    } catch (err) {
      console.error('Error guardando lote de ventas:', err);
      notify?.(`Error al guardar lote en Supabase: ${err.message}`, 'error');
    } finally {
      setSavingBatch(false);
    }
  }

  // Alta manual directa
  async function handleCreateManual(e) {
    e.preventDefault();
    const cab = Number(manualForm.cantidad_cabezas) || 0;
    const kg = Number(manualForm.kilos_totales) || 0;
    const precio = Number(manualForm.precio_kg) || 0;
    const gastos = Number(manualForm.gastos_comercializacion_ars) || 0;
    const tc = Number(manualForm.tipo_cambio) || dolarRef || 1600;

    if (cab <= 0 || kg <= 0 || precio <= 0) {
      notify?.('Completá cabezas, kilos y precio por kilo mayores a 0.', 'error');
      return;
    }

    const bruto = kg * precio;
    const neto = Math.max(0, bruto - gastos);
    const netoUsd = Math.round((neto / tc) * 100) / 100;
    const montoIva = Math.round(bruto * 0.105 * 100) / 100;

    try {
      const payload = {
        fecha: manualForm.fecha,
        rodeo_nombre: manualForm.rodeo_nombre || null,
        categoria: manualForm.categoria,
        cantidad_cabezas: cab,
        kilos_totales: kg,
        moneda_carga: 'ARS',
        tipo_cambio: tc,
        precio_kg: precio,
        importe_bruto_ars: Math.round(bruto * 100) / 100,
        gastos_comercializacion_ars: Math.round(gastos * 100) / 100,
        ingreso_neto_ars: Math.round(neto * 100) / 100,
        ingreso_neto_usd: netoUsd,
        neto_gravado: Math.round(bruto * 100) / 100,
        alicuota_iva: 10.5,
        monto_iva: montoIva,
        percepciones_iva: 0,
        retenciones_iva: 0,
        comprador: manualForm.comprador?.trim() || 'Comprador / Consignatario',
        destino_consignatario: manualForm.comprador?.trim() || 'Comprador / Consignatario',
        observaciones: manualForm.observaciones?.trim() || null,
      };

      const { data: inserted, error: errVenta } = await supabase
        .from('ventas_hacienda')
        .insert(payload)
        .select('id')
        .single();

      if (errVenta) throw errVenta;

      // Descuento de stock si aplica
      if (manualForm.descontar_stock && manualForm.rodeo_nombre && cab > 0) {
        const rodeoObj = rodeos.find((r) => r.nombre === manualForm.rodeo_nombre);
        if (rodeoObj) {
          await supabase.from('movimientos_hacienda').insert({
            fecha: manualForm.fecha,
            tipo_movimiento: 'Venta',
            rodeo_id: rodeoObj.id,
            rodeo_nombre: rodeoObj.nombre,
            potrero_origen: rodeoObj.potrero_numero ? parseInt(rodeoObj.potrero_numero, 10) : null,
            potrero_destino: null,
            categoria_afectada: manualForm.categoria,
            cantidad_cabezas: cab,
            motivo_observaciones: `Venta manual a ${manualForm.comprador}`,
          });

          const catLower = manualForm.categoria.toLowerCase();
          const updated = { ...rodeoObj };
          if (catLower.includes('cut')) {
            updated.vacas_cut = Math.max(0, (Number(updated.vacas_cut) || 0) - cab);
          } else if (catLower.includes('vaca')) {
            updated.vacas = Math.max(0, (Number(updated.vacas) || 0) - cab);
          } else if (catLower.includes('terner')) {
            updated.terneros = Math.max(0, (Number(updated.terneros) || 0) - cab);
          } else if (catLower.includes('toro')) {
            updated.toros_padres = Math.max(0, (Number(updated.toros_padres) || 0) - cab);
          }

          await supabase
            .from('rodeos')
            .update({
              vacas: updated.vacas,
              terneros: updated.terneros,
              toros_padres: updated.toros_padres,
              vacas_cut: updated.vacas_cut,
            })
            .eq('id', rodeoObj.id);
        }
      }

      await registrarAuditLog({
        tipo_operacion: 'VENTA_HACIENDA',
        modulo: 'Ventas',
        descripcion: `Venta Manual: ${payload.comprador} (${cab} cab. · $${payload.ingreso_neto_ars.toLocaleString('es-AR')})`,
        afectados_tabla: 'ventas_hacienda',
        afectados_ids: [inserted.id],
        metadata: { id: inserted.id, cabezas: cab, neto_ars: payload.ingreso_neto_ars },
      });

      notify?.(`Venta de ${cab} cabezas registrada con éxito.`, 'success');
      setShowManualForm(false);
      setManualForm({
        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
        comprador: '',
        rodeo_nombre: '',
        categoria: 'Vacas',
        cantidad_cabezas: '',
        kilos_totales: '',
        precio_kg: '',
        gastos_comercializacion_ars: '0',
        tipo_cambio: dolarRef || 1600,
        descontar_stock: true,
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      console.error('Error creando venta manual:', err);
      notify?.(`Error al registrar venta: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      
      {/* Input oculto para carga masiva de PDFs/fotos */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        onChange={handleBatchFilesSelected}
        className="hidden"
      />

      {/* Cabecera Principal */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-200">
              Módulo Administración · Exclusivo Admin
            </span>
            <span className="text-xs font-bold text-slate-600">
              Dólar Ref: ${dolarRef}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2 mt-1">
            <Scale className="w-6 h-6 text-emerald-800" />
            Ventas & Liquidaciones de Hacienda
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
            Gestión comercial y fiscal: escaneo IA multipágina de liquidaciones oficiales, impacto sincronizado en Finanzas (IVA 10,5% e ingresos), descuento de stock en rodeos y trazabilidad de caravanas.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {/* Control 1 — Botón Primario de Carga Manual (verde sólido #14532d) */}
          <button
            type="button"
            onClick={() => setShowManualForm(!showManualForm)}
            className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f4023] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{showManualForm ? 'Cerrar Formulario' : '+ Carga Manual'}</span>
          </button>

          {/* Control 2 — Botón Único de Inteligencia Artificial (✨ Importar con IA) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 hover:from-slate-800 hover:to-emerald-900 text-white font-extrabold text-xs flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0 disabled:opacity-50"
            title="Importar liquidaciones, romaneos o DT-e oficiales en PDF, imagen o Excel con IA"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>{scanning ? `Analizando con IA (${scanProgress.current}/${scanProgress.total})...` : '✨ Importar con IA'}</span>
          </button>

          {/* Control 3 — Menú Desplegable Compacto (Acciones ▾) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAccionesMenu(!showAccionesMenu)}
              className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer shrink-0"
            >
              <span>Acciones</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {showAccionesMenu && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setShowAccionesMenu(false)}
                />
                <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-50 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAccionesMenu(false);
                      handleExportPDF();
                    }}
                    disabled={exportingPdf}
                    className="w-full text-left px-3.5 py-2 hover:bg-amber-50 text-slate-700 font-semibold flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    <FileDown className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{exportingPdf ? 'Generando PDF...' : '📄 Exportar Listado (PDF)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowAccionesMenu(false);
                      handleExportCSV();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 font-semibold flex items-center gap-2 transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>📊 Exportar Excel (.xlsx / CSV)</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 4 KPIs Superiores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
          <div className="text-[10px] font-black uppercase text-slate-600 tracking-wider">
            Ingresos Netos Totales
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-900 mt-1">
            USD ${Math.round(stats.netoUsd).toLocaleString('es-AR')}
          </div>
          <div className="text-xs font-bold text-slate-600 mt-0.5">
            ARS ${Math.round(stats.netoArs).toLocaleString('es-AR')}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
          <div className="text-[10px] font-black uppercase text-slate-600 tracking-wider">
            Cabezas Comercializadas
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            {stats.cabezas.toLocaleString('es-AR')} cab.
          </div>
          <div className="text-xs font-bold text-slate-600 mt-0.5">
            En {stats.count} liquidaciones oficiales
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
          <div className="text-[10px] font-black uppercase text-slate-600 tracking-wider">
            Kilos Totales Carne
          </div>
          <div className="text-xl sm:text-2xl font-black text-sky-950 mt-1">
            {Math.round(stats.kilos).toLocaleString('es-AR')} kg
          </div>
          <div className="text-xs font-bold text-slate-600 mt-0.5">
            {stats.cabezasPesadas > 0 ? (
              stats.cabezasSinKilos > 0 ? (
                <span>
                  Prom: <strong className="text-slate-900">{Math.round(stats.kilos / stats.cabezasPesadas).toLocaleString('es-AR')} kg/cab</strong> ({stats.cabezasPesadas.toLocaleString('es-AR')} pesadas · {stats.cabezasSinKilos.toLocaleString('es-AR')} al bulto)
                </span>
              ) : (
                <span>
                  Prom: <strong className="text-slate-900">{Math.round(stats.kilos / stats.cabezasPesadas).toLocaleString('es-AR')} kg/cab</strong>
                </span>
              )
            ) : (
              '0 kg/cab'
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
          <div className="text-[10px] font-black uppercase text-slate-600 tracking-wider">
            Precio Promedio
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-950 mt-1">
            ${stats.promKgArs.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg
          </div>
          <div className="text-xs font-bold text-slate-600 mt-0.5">
            USD {stats.promKgUsd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / kg vivo
          </div>
        </div>
      </div>

      {/* Formulario de Alta Manual Desplegable */}
      {showManualForm && (
        <form
          onSubmit={handleCreateManual}
          className="bg-white rounded-2xl p-5 border-2 border-emerald-600/60 shadow-lg space-y-4 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-800" />
              Nueva Liquidación / Venta de Hacienda (Carga Manual)
            </h3>
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Fecha
              </label>
              <input
                type="date"
                value={manualForm.fecha}
                onChange={(e) => setManualForm({ ...manualForm, fecha: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-bold text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Consignatario / Comprador
              </label>
              <input
                type="text"
                placeholder="Razón Social / Firma"
                value={manualForm.comprador}
                onChange={(e) => setManualForm({ ...manualForm, comprador: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-bold text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Rodeo Origen
              </label>
              <select
                value={manualForm.rodeo_nombre}
                onChange={(e) => setManualForm({ ...manualForm, rodeo_nombre: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-bold text-xs bg-white"
              >
                <option value="">(Sin rodeo / Carga histórica)</option>
                {rodeos.map((r) => (
                  <option key={r.id} value={r.nombre}>
                    {r.nombre} (P#{r.potrero_numero || '—'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Categoría
              </label>
              <input
                type="text"
                placeholder="Vacas CUT, Terneros..."
                value={manualForm.categoria}
                onChange={(e) => setManualForm({ ...manualForm, categoria: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-bold text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Cabezas
              </label>
              <NumericInput
                placeholder="10"
                value={manualForm.cantidad_cabezas}
                onChange={(val) => setManualForm({ ...manualForm, cantidad_cabezas: val })}
                allowDecimals={false}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-black text-xs text-center"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Kilos Totales
              </label>
              <NumericInput
                placeholder="4200"
                value={manualForm.kilos_totales}
                onChange={(val) => setManualForm({ ...manualForm, kilos_totales: val })}
                allowDecimals={true}
                maxDecimals={2}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-black text-xs text-right"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Precio $/kg Vivo
              </label>
              <NumericInput
                placeholder="2450"
                value={manualForm.precio_kg}
                onChange={(val) => setManualForm({ ...manualForm, precio_kg: val })}
                allowDecimals={true}
                maxDecimals={2}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-black text-xs text-right text-emerald-800"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Gastos Comercializ. ($)
              </label>
              <NumericInput
                placeholder="0"
                value={manualForm.gastos_comercializacion_ars}
                onChange={(val) => setManualForm({ ...manualForm, gastos_comercializacion_ars: val })}
                allowDecimals={true}
                maxDecimals={2}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-bold text-xs text-right text-rose-700"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={manualForm.descontar_stock}
                onChange={(e) => setManualForm({ ...manualForm, descontar_stock: e.target.checked })}
                className="rounded border-slate-300 text-emerald-800 focus:ring-emerald-700"
              />
              Descontar automáticamente del stock del rodeo seleccionado
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="px-3 py-1.5 text-xs font-bold text-slate-500"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black shadow-sm transition active:scale-95 cursor-pointer"
              >
                Guardar Liquidación
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por comprador, categoría, DTA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700"
            >
              <option value="TODOS">Todos los Períodos ({ventas.length})</option>
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <select
            value={filterRodeo}
            onChange={(e) => setFilterRodeo(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700"
          >
            <option value="TODOS">Todos los Rodeos</option>
            {rodeos.map((r) => (
              <option key={r.id} value={r.nombre}>
                {r.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs font-bold text-slate-600">
          Mostrando {filteredVentas.length} de {ventas.length} registros
        </div>
      </div>

      {/* Tabla Oficial de Liquidaciones Clicable */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-3">Fecha</th>
                <th className="py-3 px-3">Consignatario / Comprador</th>
                <th className="py-3 px-3">Categoría & Rodeo</th>
                <th className="py-3 px-3 text-center">Cabezas</th>
                <th className="py-3 px-3 text-right">Kilos Totales</th>
                <th className="py-3 px-3 text-right">Precio $/kg</th>
                <th className="py-3 px-3 text-right">IVA Débito (10.5%)</th>
                <th className="py-3 px-3 text-right">Ingreso Neto (ARS)</th>
                <th className="py-3 px-3 text-right">Neto (USD)</th>
                <th className="py-3 px-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVentas.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-600 font-medium">
                    <Scale className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="font-bold text-slate-800">No hay liquidaciones registradas en este período.</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Cargá un comprobante con el botón "⚡ Escanear Liquidación (IA)" o "Carga Manual".
                    </p>
                  </td>
                </tr>
              ) : (
                filteredVentas.map((v) => {
                  const cab = Number(v.cantidad_cabezas) || 0;
                  const kg = Number(v.kilos_totales) || 0;
                  const promKg = cab > 0 ? (kg / cab).toFixed(1) : 0;
                  const netoArs = Number(v.ingreso_neto_ars) || 0;
                  const netoUsd = Number(v.ingreso_neto_usd) || (netoArs / (Number(v.tipo_cambio) || dolarRef || 1600));
                  const ivaDeb = Number(v.monto_iva) || ((Number(v.importe_bruto_ars) || 0) * 0.105);

                  return (
                    <tr
                      key={v.id}
                      onClick={() => setSelectedVentaForDetail(v)}
                      className="hover:bg-emerald-50/40 cursor-pointer transition group"
                    >
                      <td className="py-3 px-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                        {formatFechaAR(v.fecha)}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-extrabold text-slate-900 group-hover:text-emerald-900 transition flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-slate-400" />
                          <span>{v.comprador || v.destino_consignatario || 'Consignatario'}</span>
                        </div>
                        {v.observaciones && (
                          <div className="text-[10px] text-slate-600 font-medium truncate max-w-xs mt-0.5">
                            {v.observaciones}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 min-w-[200px] max-w-sm">
                        <div className="font-extrabold text-slate-900 text-xs leading-snug">
                          {consolidarCategoriasVenta(v.categoria, v.renglones || v.renglones_json)}
                        </div>
                        <div className="text-[11px] text-slate-600 font-semibold mt-0.5 flex items-center gap-1">
                          <Tag className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{v.rodeo_nombre ? `Rodeo: ${v.rodeo_nombre}` : 'Sin rodeo asignado'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-black bg-slate-100 text-slate-800">
                          {cab} cab.
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="font-bold text-slate-900">{kg > 0 ? `${kg.toLocaleString('es-AR')} kg` : '—'}</div>
                        <div className="text-[10px] text-slate-600 font-medium">
                          {cab > 0 && kg > 0 ? `${(kg / cab).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg/cab` : 'Al bulto'}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {Number(v.precio_kg) > 0
                          ? `$${Number(v.precio_kg).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-sky-800">
                        ${Math.round(ivaDeb).toLocaleString('es-AR')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        ${Math.round(netoArs).toLocaleString('es-AR')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-emerald-800 whitespace-nowrap">
                        USD ${Math.round(netoUsd).toLocaleString('es-AR')}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedVentaForDetail(v)}
                            className="px-2.5 py-1.5 rounded-xl text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs active:scale-95"
                            title="Ver desglose completo de lotes y comprobante"
                          >
                            <Eye className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Detalle</span>
                          </button>

                          <div className="relative inline-block text-left">
                            <button
                              type="button"
                              onClick={() => setActiveRowMenuId(activeRowMenuId === v.id ? null : v.id)}
                              className={`px-2 py-1.5 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-300 text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer shadow-2xs active:scale-95 ${
                                activeRowMenuId === v.id ? 'bg-slate-100 ring-2 ring-emerald-600/30' : 'bg-white'
                              }`}
                            >
                              <span>Acciones</span>
                              <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${activeRowMenuId === v.id ? 'rotate-180' : ''}`} />
                            </button>

                            {activeRowMenuId === v.id && (
                              <div
                                className="absolute right-0 top-full mt-1.5 z-40 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-xs animate-in fade-in slide-in-from-top-1 duration-100 text-left"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveRowMenuId(null);
                                    exportarDetalleLiquidacionPDF(v, { dolarRef, fechaOperacion, notify });
                                  }}
                                  className="w-full px-3 py-2 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-emerald-900 flex items-center gap-2 cursor-pointer transition"
                                >
                                  <FileText className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  <span>Descargar PDF</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveRowMenuId(null);
                                    setSelectedVentaForDetail(v);
                                  }}
                                  className="w-full px-3 py-2 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-emerald-900 flex items-center gap-2 cursor-pointer transition"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                  <span>Editar / Asignar Rodeo</span>
                                </button>

                                <div className="border-t border-slate-100 my-1"></div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveRowMenuId(null);
                                    handleDeleteVenta(v);
                                  }}
                                  className="w-full px-3 py-2 text-left font-bold text-rose-700 hover:bg-rose-50 flex items-center gap-2 cursor-pointer transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  <span>Eliminar venta</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredVentas.length > 0 && (
              <tfoot className="bg-slate-900 text-white font-extrabold text-xs">
                <tr>
                  <td colSpan={3} className="py-3 px-3 text-left">
                    TOTAL ({filteredVentas.length} LIQUIDACIONES)
                  </td>
                  <td className="py-3 px-3 text-center text-emerald-300 font-black">
                    {stats.cabezas.toLocaleString('es-AR')} cab.
                  </td>
                  <td className="py-3 px-3 text-right text-sky-300 font-black">
                    {Math.round(stats.kilos).toLocaleString('es-AR')} kg
                  </td>
                  <td className="py-3 px-3 text-right text-amber-300 font-mono font-bold whitespace-nowrap">
                    ${stats.promKgArs.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg
                  </td>
                  <td className="py-3 px-3 text-right text-sky-300">
                    ${Math.round(stats.ivaDebito || 0).toLocaleString('es-AR')}
                  </td>
                  <td className="py-3 px-3 text-right text-white font-black whitespace-nowrap">
                    ${Math.round(stats.netoArs).toLocaleString('es-AR')}
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-300 font-black whitespace-nowrap">
                    USD ${Math.round(stats.netoUsd).toLocaleString('es-AR')}
                  </td>
                  <td className="py-3 px-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* MODAL DETALLE EDITABLE DE LIQUIDACIÓN */}
      {selectedVentaForDetail && (
        <LiquidacionDetalleModal
          isOpen={true}
          venta={selectedVentaForDetail}
          onClose={() => setSelectedVentaForDetail(null)}
          rodeos={rodeos}
          dolarRef={dolarRef}
          onSaveSuccess={onRefresh}
          onDeleteSuccess={onRefresh}
          notify={notify}
        />
      )}

      {/* MODAL PREVISUALIZACIÓN EDITABLE BATCH DE LIQUIDACIONES IA */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 text-white p-5 flex items-center justify-between border-b border-white/10">
              <div>
                <h3 className="text-lg font-black flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                  Previsualización de Liquidaciones Extraídas por IA
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Revisá y editá los datos de cada comprobante antes de guardarlos. Podés asignar el rodeo origen y decidir si descuenta stock.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBatchModal(false);
                  setBatchItems([]);
                }}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-black uppercase text-[10px]">
                    <tr>
                      <th className="p-2">Fecha</th>
                      <th className="p-2">Comprador</th>
                      <th className="p-2">Categoría</th>
                      <th className="p-2 text-center">Cabezas</th>
                      <th className="p-2 text-right">Kilos</th>
                      <th className="p-2 text-right">Precio $/kg</th>
                      <th className="p-2 text-right">Neto ARS</th>
                      <th className="p-2 text-right">Neto USD</th>
                      <th className="p-2">Rodeo Origen</th>
                      <th className="p-2 text-center">Desc. Stock</th>
                      <th className="p-2 text-center">Quitar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchItems.map((item) => (
                      <React.Fragment key={item.temp_id}>
                        <tr className={item.status === 'error' ? 'bg-rose-50/50' : 'hover:bg-slate-50'}>
                          <td className="p-2">
                            <input
                              type="date"
                              value={item.fecha}
                              onChange={(e) => updateBatchItem(item.temp_id, 'fecha', e.target.value)}
                              className="px-2 py-1 rounded border border-slate-300 text-xs font-bold"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.comprador}
                              onChange={(e) => updateBatchItem(item.temp_id, 'comprador', e.target.value)}
                              className="w-40 px-2 py-1 rounded border border-slate-300 text-xs font-bold"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.categoria}
                              onChange={(e) => updateBatchItem(item.temp_id, 'categoria', e.target.value)}
                              className="w-32 px-2 py-1 rounded border border-slate-300 text-xs font-medium"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <NumericInput
                              value={item.cantidad_cabezas}
                              onChange={(val) => updateBatchItem(item.temp_id, 'cantidad_cabezas', val)}
                              allowDecimals={false}
                              className="w-16 px-1 py-1 rounded border border-slate-300 text-xs font-black text-center"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <NumericInput
                              value={item.kilos_totales}
                              onChange={(val) => updateBatchItem(item.temp_id, 'kilos_totales', val)}
                              allowDecimals={true}
                              maxDecimals={2}
                              className="w-20 px-1 py-1 rounded border border-slate-300 text-xs font-black text-right"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <NumericInput
                              value={item.precio_kg}
                              onChange={(val) => updateBatchItem(item.temp_id, 'precio_kg', val)}
                              allowDecimals={true}
                              maxDecimals={2}
                              className="w-20 px-1 py-1 rounded border border-slate-300 text-xs font-black text-right text-emerald-800"
                            />
                          </td>
                          <td className="p-2 text-right font-black font-mono text-slate-900 whitespace-nowrap">
                            ${item.ingreso_neto_ars.toLocaleString('es-AR')}
                          </td>
                          <td className="p-2 text-right font-black font-mono text-emerald-800 whitespace-nowrap">
                            USD ${item.ingreso_neto_usd.toLocaleString('es-AR')}
                          </td>
                          <td className="p-2">
                            <select
                              value={item.rodeo_nombre}
                              onChange={(e) => updateBatchItem(item.temp_id, 'rodeo_nombre', e.target.value)}
                              className="w-36 px-2 py-1 rounded border border-slate-300 text-xs font-bold bg-white"
                            >
                              <option value="">(Sin rodeo)</option>
                              {rodeos.map((r) => (
                                <option key={r.id} value={r.nombre}>
                                  {r.nombre} (P#{r.potrero_numero || '—'})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={item.descontar_stock}
                              onChange={(e) => updateBatchItem(item.temp_id, 'descontar_stock', e.target.checked)}
                              className="rounded border-slate-300 text-emerald-800 focus:ring-emerald-700"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeBatchItem(item.temp_id)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                        {item.advertenciaSanidad && (
                          <tr className="bg-amber-50/80">
                            <td colSpan={11} className="px-3 py-1.5 text-xs text-amber-900 font-bold border-b border-amber-200">
                              {item.advertenciaSanidad}
                            </td>
                          </tr>
                        )}
                        {item.notas_auditoria_ia && (
                          <tr className="bg-emerald-50/60 border-b border-emerald-100">
                            <td colSpan={11} className="px-3 py-2 text-xs text-emerald-950">
                              <div className="flex items-center gap-1.5 font-bold text-[10px] uppercase text-emerald-800 mb-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                <span>Auditoría Ganadera Gemini 2.5 Pro:</span>
                                {item.moneda && (
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 font-mono text-[9px]">
                                    {item.moneda}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] font-sans text-slate-700 leading-snug">
                                {item.notas_auditoria_ia}
                              </p>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-600">
                Lote listo para procesar: <strong>{batchItems.length}</strong> comprobantes
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowBatchModal(false);
                    setBatchItems([]);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800"
                >
                  Descartar Lote
                </button>
                <button
                  type="button"
                  disabled={savingBatch || batchItems.length === 0}
                  onClick={handleConfirmBatch}
                  className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black shadow-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {savingBatch ? 'Guardando en Supabase...' : `Aprobar y Guardar (${batchItems.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
