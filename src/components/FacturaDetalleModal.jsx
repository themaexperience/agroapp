import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  X,
  Save,
  Trash2,
  Calendar,
  Building,
  DollarSign,
  Tag,
  CheckCircle2,
  AlertCircle,
  Hash,
  Layers,
  MapPin,
  FileCheck,
  Percent,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { confirmAction } from './ConfirmDialog';

export const RUBROS_GASTOS = [
  'Sanidad / Vacunas',
  'Honorarios Veterinarios',
  'Suplementación / Reservas',
  'Administración / Estructura',
  'Impuestos / Tasas',
  'Infraestructura / Proveedores Externos',
];

export default function FacturaDetalleModal({
  gasto,
  isOpen,
  onClose,
  rodeos = [],
  potreros = [],
  dolarRef = 1600,
  onSaveSuccess,
  onDeleteSuccess,
  notify,
}) {
  if (!isOpen || !gasto) return null;

  // Estado del formulario editable
  const [formData, setFormData] = useState({
    fecha: gasto.fecha || new Date().toISOString().slice(0, 10),
    proveedor: gasto.proveedor || '',
    comprobante: gasto.comprobante || '',
    tipo_comprobante: gasto.tipo_comprobante || (gasto.es_nota_credito ? 'Nota de Crédito' : 'Factura B'),
    es_nota_credito: Boolean(gasto.es_nota_credito || Number(gasto.monto_ars) < 0),
    rubro: gasto.rubro || 'Infraestructura / Proveedores Externos',
    concepto: gasto.concepto || '',
    estado_pago: gasto.estado_pago || 'Pagado',
    moneda_carga: gasto.moneda_carga || 'ARS',
    tipo_cambio: Number(gasto.tipo_cambio) || Number(dolarRef) || 1600,
    tdc_fuente: gasto.tdc_fuente || 'Dólar Blue Histórico',
    neto_gravado: Number(gasto.neto_gravado) || 0,
    alicuota_iva: gasto.alicuota_iva != null ? Number(gasto.alicuota_iva) : 21.0,
    monto_iva: Number(gasto.monto_iva) || 0,
    percepciones_iva: Number(gasto.percepciones_iva) || 0,
    percepciones_iibb: Number(gasto.percepciones_iibb) || 0,
    otras_percepciones: Number(gasto.otras_percepciones) || 0,
    monto_ars: Math.abs(Number(gasto.monto_ars) || 0),
    monto_usd: Math.abs(Number(gasto.monto_usd) || 0),
    rodeo_nombre: gasto.rodeo_nombre || '',
    potrero_numero: gasto.potrero_numero != null ? String(gasto.potrero_numero) : '',
    nota_manuscrita_util: gasto.nota_manuscrita_util || '',
    observaciones: gasto.observaciones || '',
  });

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Inicializar o actualizar formData si cambia gasto
  useEffect(() => {
    if (gasto) {
      const tc = Number(gasto.tipo_cambio) || Number(dolarRef) || 1600;
      const ars = Math.abs(Number(gasto.monto_ars) || 0);
      const neto = Number(gasto.neto_gravado) || 0;
      const alic = gasto.alicuota_iva != null ? Number(gasto.alicuota_iva) : 21.0;
      let iva = Number(gasto.monto_iva) || 0;
      if (iva === 0 && neto > 0) {
        iva = Math.round(neto * (alic / 100) * 100) / 100;
      }
      const pIva = Number(gasto.percepciones_iva) || 0;

      setFormData({
        fecha: gasto.fecha || new Date().toISOString().slice(0, 10),
        proveedor: gasto.proveedor || '',
        comprobante: gasto.comprobante || '',
        tipo_comprobante: gasto.tipo_comprobante || (gasto.es_nota_credito ? 'Nota de Crédito' : 'Factura B'),
        es_nota_credito: Boolean(gasto.es_nota_credito || Number(gasto.monto_ars) < 0),
        rubro: gasto.rubro || 'Infraestructura / Proveedores Externos',
        concepto: gasto.concepto || '',
        estado_pago: gasto.estado_pago || 'Pagado',
        moneda_carga: gasto.moneda_carga || 'ARS',
        tipo_cambio: tc,
        tdc_fuente: gasto.tdc_fuente || 'Dólar Blue Histórico',
        neto_gravado: neto,
        alicuota_iva: alic,
        monto_iva: iva,
        percepciones_iva: pIva,
        percepciones_iibb: Number(gasto.percepciones_iibb) || 0,
        otras_percepciones: Number(gasto.otras_percepciones) || 0,
        monto_ars: ars,
        monto_usd: Number(gasto.monto_usd) || (tc > 0 ? Math.round((ars / tc) * 100) / 100 : 0),
        rodeo_nombre: gasto.rodeo_nombre || '',
        potrero_numero: gasto.potrero_numero != null ? String(gasto.potrero_numero) : '',
        nota_manuscrita_util: gasto.nota_manuscrita_util || '',
        observaciones: gasto.observaciones || '',
      });
    }
  }, [gasto, dolarRef]);

  // Recálculo automático de Total ARS y Total USD
  const calculatedTotals = useMemo(() => {
    const neto = parseFloat(formData.neto_gravado) || 0;
    const iva = parseFloat(formData.monto_iva) || 0;
    const pIva = parseFloat(formData.percepciones_iva) || 0;
    const pIibb = parseFloat(formData.percepciones_iibb) || 0;
    const pOtras = parseFloat(formData.otras_percepciones) || 0;
    const tc = parseFloat(formData.tipo_cambio) || Number(dolarRef) || 1600;

    let subtotalDesglose = neto + iva + pIva + pIibb + pOtras;
    // Si el usuario cargó directamente el total ARS sin desglose detallado
    const totalArs = subtotalDesglose > 0 ? subtotalDesglose : (parseFloat(formData.monto_ars) || 0);
    const totalUsd = tc > 0 ? totalArs / tc : 0;

    return {
      totalArs: Math.round(totalArs * 100) / 100,
      totalUsd: Math.round(totalUsd * 100) / 100,
    };
  }, [
    formData.neto_gravado,
    formData.monto_iva,
    formData.percepciones_iva,
    formData.percepciones_iibb,
    formData.otras_percepciones,
    formData.monto_ars,
    formData.tipo_cambio,
    dolarRef,
  ]);

  // Manejador cuando cambia el Neto Gravado o la Alícuota para sugerir IVA
  const handleNetoChange = (val) => {
    const neto = parseFloat(val) || 0;
    const alic = parseFloat(formData.alicuota_iva) || 0;
    const nuevoIva = Math.round(neto * (alic / 100) * 100) / 100;
    setFormData((prev) => ({
      ...prev,
      neto_gravado: val,
      monto_iva: nuevoIva,
    }));
  };

  const handleAlicuotaChange = (val) => {
    const alic = parseFloat(val) || 0;
    const neto = parseFloat(formData.neto_gravado) || 0;
    const nuevoIva = Math.round(neto * (alic / 100) * 100) / 100;
    setFormData((prev) => ({
      ...prev,
      alicuota_iva: alic,
      monto_iva: nuevoIva,
    }));
  };

  // Guardar modificaciones en Supabase
  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!formData.concepto.trim()) {
      notify?.('Por favor ingresá un concepto o descripción para el comprobante.', 'error');
      return;
    }

    setSaving(true);
    try {
      const tc = parseFloat(formData.tipo_cambio) || Number(dolarRef) || 1600;
      const isNC = Boolean(formData.es_nota_credito);
      const arsTotal = calculatedTotals.totalArs;
      const usdTotal = calculatedTotals.totalUsd;

      // El signo se guarda positivo o negativo según si es NC
      const signedArs = isNC ? -Math.abs(arsTotal) : Math.abs(arsTotal);
      const signedUsd = isNC ? -Math.abs(usdTotal) : Math.abs(usdTotal);

      const payload = {
        fecha: formData.fecha,
        proveedor: formData.proveedor.trim() || null,
        comprobante: formData.comprobante.trim() || null,
        tipo_comprobante: formData.tipo_comprobante.trim() || (isNC ? 'Nota de Crédito' : 'Factura'),
        es_nota_credito: isNC,
        rubro: formData.rubro,
        concepto: formData.concepto.trim(),
        estado_pago: formData.estado_pago || 'Pagado',
        moneda_carga: formData.moneda_carga || 'ARS',
        tipo_cambio: tc,
        tdc_fuente: formData.tdc_fuente.trim() || 'Dólar Blue Histórico',
        monto_original: arsTotal,
        monto_ars: signedArs,
        monto_usd: signedUsd,
        neto_gravado: parseFloat(formData.neto_gravado) || 0,
        alicuota_iva: parseFloat(formData.alicuota_iva) || 21.0,
        monto_iva: parseFloat(formData.monto_iva) || 0,
        percepciones_iva: parseFloat(formData.percepciones_iva) || 0,
        percepciones_iibb: parseFloat(formData.percepciones_iibb) || 0,
        otras_percepciones: parseFloat(formData.otras_percepciones) || 0,
        rodeo_nombre: formData.rodeo_nombre || null,
        potrero_numero: formData.potrero_numero ? parseInt(formData.potrero_numero, 10) : null,
        nota_manuscrita_util: formData.nota_manuscrita_util.trim() || null,
        observaciones: formData.observaciones.trim() || null,
      };

      const { error } = await supabase
        .from('gastos_campo')
        .update(payload)
        .eq('id', gasto.id);

      if (error) throw error;

      notify?.(`Comprobante ${payload.comprobante || payload.concepto} actualizado con éxito.`, 'success');
      onSaveSuccess?.({ ...gasto, ...payload });
      onClose();
    } catch (err) {
      console.error('Error al actualizar gasto:', err);
      notify?.(`Error al actualizar gasto: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmAction({
      title: `¿Eliminar comprobante "${formData.comprobante || formData.concepto || 'Gasto'}"?`,
      description: `Proveedor: ${formData.proveedor || 'Sin proveedor'}. Esta acción eliminará el registro financiero definitivamente.`,
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('gastos_campo')
        .delete()
        .eq('id', gasto.id);

      if (error) throw error;

      notify?.('Comprobante eliminado con éxito.', 'success');
      onDeleteSuccess?.(gasto.id);
      onClose();
    } catch (err) {
      console.error('Error al eliminar gasto:', err);
      notify?.(`Error al eliminar comprobante: ${err.message}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ENCABEZADO TIPO FACTURA OFICIAL */}
        <div className="bg-slate-900 text-white p-4 sm:p-5 border-b border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                    Comprobante / Factura Oficial
                  </span>
                  {formData.es_nota_credito && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-600">
                      🏷️ Nota de Crédito
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                      formData.estado_pago === 'Pagado'
                        ? 'bg-emerald-900/80 text-emerald-200'
                        : 'bg-amber-900/80 text-amber-200'
                    }`}
                  >
                    ● {formData.estado_pago}
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-white mt-1 leading-tight">
                  {formData.proveedor || 'Proveedor Sin Especificar'}
                </h3>
                <p className="text-xs text-slate-300 font-medium">
                  {formData.tipo_comprobante} {formData.comprobante ? `N° ${formData.comprobante}` : '(S/N)'} · Fecha: {formData.fecha}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* CUERPO DEL COMPROBANTE EDITABLE */}
        <form onSubmit={handleSave} className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
          {/* SECCIÓN 1: DATOS FISCALES BÁSICOS */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5 border-b border-slate-200/80 pb-1.5">
              <Building className="w-3.5 h-3.5 text-emerald-700" />
              1. Datos del Emisor & Identificación
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Proveedor / Razón Social *
                </label>
                <input
                  type="text"
                  required
                  value={formData.proveedor}
                  onChange={(e) => setFormData({ ...formData, proveedor: e.target.value })}
                  placeholder="Ej: Da Silva Lubrano, Pinturerías Imagen..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  N° Comprobante *
                </label>
                <input
                  type="text"
                  value={formData.comprobante}
                  onChange={(e) => setFormData({ ...formData, comprobante: e.target.value })}
                  placeholder="Ej: B-0001-00004523"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Fecha Emisión *
                </label>
                <input
                  type="date"
                  required
                  value={formData.fecha}
                  onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Tipo Comprobante
                </label>
                <select
                  value={formData.tipo_comprobante}
                  onChange={(e) => {
                    const isNC = e.target.value.toLowerCase().includes('crédito') || e.target.value.toLowerCase().includes('credito');
                    setFormData({
                      ...formData,
                      tipo_comprobante: e.target.value,
                      es_nota_credito: isNC,
                    });
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                >
                  <option value="Factura B">Factura B</option>
                  <option value="Factura A">Factura A</option>
                  <option value="Factura C">Factura C</option>
                  <option value="Nota de Crédito B">Nota de Crédito B</option>
                  <option value="Nota de Crédito A">Nota de Crédito A</option>
                  <option value="Ticket / Recibo">Ticket / Recibo</option>
                  <option value="Remito Oficial">Remito Oficial</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Rubro Financiero *
                </label>
                <select
                  value={formData.rubro}
                  onChange={(e) => setFormData({ ...formData, rubro: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                >
                  {RUBROS_GASTOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Estado de Pago
                </label>
                <select
                  value={formData.estado_pago}
                  onChange={(e) => setFormData({ ...formData, estado_pago: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                >
                  <option value="Pagado">Pagado</option>
                  <option value="Pendiente">Pendiente de Pago</option>
                  <option value="Financiado / Cta Cte">Financiado / Cta Cte</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Concepto / Detalle del Comprobante *
              </label>
              <input
                type="text"
                required
                value={formData.concepto}
                onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
                placeholder="Ej: Pintura para instalaciones / Honorarios veterinarios / Boyero solar..."
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white"
              />
            </div>
          </div>

          {/* SECCIÓN 2: DESGLOSE ECONÓMICO (NETO, IVA, PERCEPCIONES, TC, USD) */}
          <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-200/80 space-y-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-900 flex items-center justify-between border-b border-emerald-200/80 pb-1.5">
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-700" />
                2. Desglose Impositivo & Tipo de Cambio
              </span>
              <span className="text-[10px] font-bold text-emerald-700">
                Recalcula ARS y USD automáticamente
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Importe Neto */}
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Importe Neto ARS
                </label>
                <div className="relative">
                  <span className="absolute left-2 top-1.5 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.neto_gravado}
                    onChange={(e) => handleNetoChange(e.target.value)}
                    className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white text-right tabular-nums"
                  />
                </div>
              </div>

              {/* Alícuota IVA */}
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Alícuota IVA
                </label>
                <select
                  value={formData.alicuota_iva}
                  onChange={(e) => handleAlicuotaChange(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                >
                  <option value={21.0}>21.0% (General)</option>
                  <option value={10.5}>10.5% (Agro/Bienes de uso)</option>
                  <option value={27.0}>27.0% (Servicios)</option>
                  <option value={0.0}>0.0% (Exento / No gravado)</option>
                </select>
              </div>

              {/* Monto IVA */}
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Monto IVA ARS
                </label>
                <div className="relative">
                  <span className="absolute left-2 top-1.5 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.monto_iva}
                    onChange={(e) => setFormData({ ...formData, monto_iva: e.target.value })}
                    className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white text-right tabular-nums"
                  />
                </div>
              </div>

              {/* Percepción IVA */}
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Percepción IVA ARS
                </label>
                <div className="relative">
                  <span className="absolute left-2 top-1.5 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.percepciones_iva}
                    onChange={(e) => setFormData({ ...formData, percepciones_iva: e.target.value })}
                    className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white text-right tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Fila de Tipo de Cambio & Totales Calculados */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-emerald-200/60 items-center">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Tipo de Cambio Aplicado ($/USD)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.5"
                    value={formData.tipo_cambio}
                    onChange={(e) => setFormData({ ...formData, tipo_cambio: e.target.value })}
                    className="w-24 px-2 py-1.5 rounded-lg border border-slate-300 font-black text-slate-900 bg-white text-right tabular-nums"
                  />
                  <input
                    type="text"
                    value={formData.tdc_fuente}
                    onChange={(e) => setFormData({ ...formData, tdc_fuente: e.target.value })}
                    placeholder="Fuente (ej. Dólar Blue)"
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-[11px] text-slate-600 bg-white"
                  />
                </div>
              </div>

              {/* Caja Total ARS */}
              <div className="p-2.5 rounded-xl bg-white border border-emerald-300 shadow-2xs">
                <div className="text-[10px] font-extrabold uppercase text-slate-500">
                  Total Final ARS
                </div>
                <div className="text-base font-black text-slate-900 tabular-nums">
                  {formData.es_nota_credito ? '-' : ''}$
                  {calculatedTotals.totalArs.toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>

              {/* Caja Total USD */}
              <div className="p-2.5 rounded-xl bg-emerald-900 text-white shadow-2xs">
                <div className="text-[10px] font-bold uppercase text-emerald-300">
                  Total Equivalente USD
                </div>
                <div className="text-base font-black text-emerald-100 tabular-nums">
                  {formData.es_nota_credito ? '-' : ''}USD{' '}
                  {calculatedTotals.totalUsd.toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* SECCIÓN 3: IMPUTACIÓN OPERATIVA Y NOTAS */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5 border-b border-slate-200/80 pb-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-700" />
              3. Imputación Operativa & Nota de Pago
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Potrero */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Imputación a Potrero
                </label>
                <select
                  value={formData.potrero_numero}
                  onChange={(e) => setFormData({ ...formData, potrero_numero: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white"
                >
                  <option value="">Gasto General de Campo (Sin Potrero)</option>
                  {(potreros || []).map((p) => {
                    const pCode = p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero;
                    return (
                      <option key={p.id || p.numero} value={String(p.numero)}>
                        Potrero #{pCode} · {p.nombre} ({p.hectareas} ha)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Rodeo */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Imputación a Rodeo
                </label>
                <select
                  value={formData.rodeo_nombre}
                  onChange={(e) => setFormData({ ...formData, rodeo_nombre: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white"
                >
                  <option value="">Gasto General (Sin Rodeo Específico)</option>
                  {(rodeos || []).map((r) => (
                    <option key={r.id || r.nombre} value={r.nombre}>
                      🐄 {r.nombre} ({r.categoria_principal || 'Rodeo'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Nota Útil (ej. Manuscrita / Tarjeta) */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Nota Útil / Medio de Pago
                </label>
                <input
                  type="text"
                  value={formData.nota_manuscrita_util}
                  onChange={(e) => setFormData({ ...formData, nota_manuscrita_util: e.target.value })}
                  placeholder="Ej: TARJETA VISA / Cheque N° 4022 / Pago Juan..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900 bg-white"
                />
              </div>

              {/* Observaciones */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Observaciones Adicionales
                </label>
                <input
                  type="text"
                  value={formData.observaciones}
                  onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                  placeholder="Detalles sobre entrega o retiro en sucursal..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 bg-white"
                />
              </div>
            </div>
          </div>

          {/* BOTONERA DE ACCIONES INFERIOR */}
          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-extrabold text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? 'Eliminando...' : 'Eliminar Gasto'}
            </button>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-emerald-300" />
                {saving ? 'Guardando Cambios...' : 'Guardar Cambios en Supabase'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
