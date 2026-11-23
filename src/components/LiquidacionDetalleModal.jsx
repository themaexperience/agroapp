import React, { useState, useEffect } from 'react';
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
  Scale,
  Percent,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { registrarAuditLog } from '../utils/auditLogger';
import { exportarDetalleLiquidacionPDF } from '../utils/pdfHelper';
import { confirmAction } from './ConfirmDialog';

export default function LiquidacionDetalleModal({
  venta,
  isOpen,
  onClose,
  rodeos = [],
  dolarRef = 1600,
  onSaveSuccess,
  onDeleteSuccess,
  notify,
}) {
  if (!isOpen || !venta) return null;

  const [formData, setFormData] = useState({
    fecha: venta.fecha || new Date().toISOString().slice(0, 10),
    comprador: venta.comprador || venta.destino_consignatario || '',
    destino_consignatario: venta.destino_consignatario || '',
    tipo_comprobante: venta.tipo_comprobante || 'Liquidación Venta Hacienda',
    rodeo_nombre: venta.rodeo_nombre || '',
    categoria: venta.categoria || 'Hacienda General',
    cantidad_cabezas: Number(venta.cantidad_cabezas) || 0,
    kilos_totales: Number(venta.kilos_totales) || 0,
    precio_kg: Number(venta.precio_kg) || 0,
    moneda_carga: venta.moneda_carga || 'ARS',
    tipo_cambio: Number(venta.tipo_cambio) || Number(dolarRef) || 1600,
    importe_bruto_ars: Number(venta.importe_bruto_ars) || 0,
    gastos_comercializacion_ars: Number(venta.gastos_comercializacion_ars) || 0,
    ingreso_neto_ars: Number(venta.ingreso_neto_ars) || 0,
    ingreso_neto_usd: Number(venta.ingreso_neto_usd) || 0,
    neto_gravado: Number(venta.neto_gravado) || 0,
    alicuota_iva: venta.alicuota_iva != null ? Number(venta.alicuota_iva) : 10.5,
    monto_iva: Number(venta.monto_iva) || 0,
    retenciones_iva: Number(venta.retenciones_iva) || 0,
    percepciones_iva: Number(venta.percepciones_iva) || 0,
    observaciones: venta.observaciones || '',
  });

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (venta) {
      setFormData({
        fecha: venta.fecha || new Date().toISOString().slice(0, 10),
        comprador: venta.comprador || venta.destino_consignatario || '',
        destino_consignatario: venta.destino_consignatario || '',
        tipo_comprobante: venta.tipo_comprobante || 'Liquidación Venta Hacienda',
        rodeo_nombre: venta.rodeo_nombre || '',
        categoria: venta.categoria || 'Hacienda General',
        cantidad_cabezas: Number(venta.cantidad_cabezas) || 0,
        kilos_totales: Number(venta.kilos_totales) || 0,
        precio_kg: Number(venta.precio_kg) || 0,
        moneda_carga: venta.moneda_carga || 'ARS',
        tipo_cambio: Number(venta.tipo_cambio) || Number(dolarRef) || 1600,
        importe_bruto_ars: Number(venta.importe_bruto_ars) || 0,
        gastos_comercializacion_ars: Number(venta.gastos_comercializacion_ars) || 0,
        ingreso_neto_ars: Number(venta.ingreso_neto_ars) || 0,
        ingreso_neto_usd: Number(venta.ingreso_neto_usd) || 0,
        neto_gravado: Number(venta.neto_gravado) || 0,
        alicuota_iva: venta.alicuota_iva != null ? Number(venta.alicuota_iva) : 10.5,
        monto_iva: Number(venta.monto_iva) || 0,
        retenciones_iva: Number(venta.retenciones_iva) || 0,
        percepciones_iva: Number(venta.percepciones_iva) || 0,
        observaciones: venta.observaciones || '',
      });
    }
  }, [venta, dolarRef]);

  // Recálculo dinámico si cambian importes
  function handleNumericChange(field, val) {
    const num = Number(val) || 0;
    setFormData((prev) => {
      const next = { ...prev, [field]: num };
      const tc = Number(next.tipo_cambio) || 1600;

      if (field === 'kilos_totales') {
        // Al editar los kilos totales, si ya hay importe bruto fijo (como en una liquidación cargada),
        // mantenemos el importe bruto oficial y recalculamos el precio $/kg real de forma coherente.
        if (num > 0 && next.importe_bruto_ars > 0) {
          next.precio_kg = Math.round((next.importe_bruto_ars / num) * 100) / 100;
        } else if (num > 0 && next.precio_kg > 0) {
          const bruto = num * next.precio_kg;
          next.importe_bruto_ars = Math.round(bruto * 100) / 100;
          next.neto_gravado = next.importe_bruto_ars;
          next.monto_iva = Math.round(next.neto_gravado * (next.alicuota_iva / 100) * 100) / 100;
          const neto = next.importe_bruto_ars - next.gastos_comercializacion_ars;
          next.ingreso_neto_ars = Math.round(neto * 100) / 100;
          next.ingreso_neto_usd = Math.round((neto / tc) * 100) / 100;
        }
      } else if (field === 'precio_kg') {
        const bruto = next.kilos_totales * num;
        next.importe_bruto_ars = Math.round(bruto * 100) / 100;
        next.neto_gravado = next.importe_bruto_ars;
        next.monto_iva = Math.round(next.neto_gravado * (next.alicuota_iva / 100) * 100) / 100;
        const neto = next.importe_bruto_ars - next.gastos_comercializacion_ars;
        next.ingreso_neto_ars = Math.round(neto * 100) / 100;
        next.ingreso_neto_usd = Math.round((neto / tc) * 100) / 100;
      } else if (field === 'gastos_comercializacion_ars') {
        const neto = next.importe_bruto_ars - num;
        next.ingreso_neto_ars = Math.round(neto * 100) / 100;
        next.ingreso_neto_usd = Math.round((neto / tc) * 100) / 100;
      } else if (field === 'importe_bruto_ars') {
        next.neto_gravado = num;
        next.monto_iva = Math.round(num * (next.alicuota_iva / 100) * 100) / 100;
        const neto = num - next.gastos_comercializacion_ars;
        next.ingreso_neto_ars = Math.round(neto * 100) / 100;
        next.ingreso_neto_usd = Math.round((neto / tc) * 100) / 100;
        if (next.kilos_totales > 0) {
          next.precio_kg = Math.round((num / next.kilos_totales) * 100) / 100;
        }
      } else if (field === 'tipo_cambio') {
        next.ingreso_neto_usd = Math.round((next.ingreso_neto_ars / (num || 1600)) * 100) / 100;
      }

      return next;
    });
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        fecha: formData.fecha,
        comprador: formData.comprador?.trim() || null,
        destino_consignatario: formData.destino_consignatario?.trim() || formData.comprador?.trim() || null,
        tipo_comprobante: formData.tipo_comprobante,
        rodeo_nombre: formData.rodeo_nombre || null,
        categoria: formData.categoria,
        cantidad_cabezas: Number(formData.cantidad_cabezas) || 0,
        kilos_totales: Number(formData.kilos_totales) || 0,
        precio_kg: Number(formData.precio_kg) || 0,
        moneda_carga: formData.moneda_carga,
        tipo_cambio: Number(formData.tipo_cambio) || 1600,
        importe_bruto_ars: Number(formData.importe_bruto_ars) || 0,
        gastos_comercializacion_ars: Number(formData.gastos_comercializacion_ars) || 0,
        ingreso_neto_ars: Number(formData.ingreso_neto_ars) || 0,
        ingreso_neto_usd: Number(formData.ingreso_neto_usd) || 0,
        neto_gravado: Number(formData.neto_gravado) || 0,
        alicuota_iva: Number(formData.alicuota_iva) || 10.5,
        monto_iva: Number(formData.monto_iva) || 0,
        retenciones_iva: Number(formData.retenciones_iva) || 0,
        percepciones_iva: Number(formData.percepciones_iva) || 0,
        observaciones: formData.observaciones?.trim() || null,
      };

      const { error } = await supabase
        .from('ventas_hacienda')
        .update(payload)
        .eq('id', venta.id);

      if (error) throw error;

      await registrarAuditLog({
        tipo_operacion: 'VENTA_HACIENDA_EDITADA',
        modulo: 'Ventas',
        descripcion: `Liquidación #${venta.id} editada: ${formData.comprador} ($${payload.ingreso_neto_ars.toLocaleString('es-AR')})`,
        afectados_tabla: 'ventas_hacienda',
        afectados_ids: [venta.id],
        metadata: { id: venta.id, payload },
      });

      notify?.('Liquidación de venta actualizada con éxito.', 'success');
      onSaveSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error guardando liquidación:', err);
      notify?.(`Error al actualizar liquidación: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await confirmAction({
      title: `¿Eliminar liquidación de ${formData.comprador}?`,
      description: `Monto neto: $${Number(formData.ingreso_neto_ars || 0).toLocaleString('es-AR')}. Esta acción eliminará el registro de venta y su impacto contable.`,
      confirmText: 'Sí, eliminar venta',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('ventas_hacienda')
        .delete()
        .eq('id', venta.id);

      if (error) throw error;

      await registrarAuditLog({
        tipo_operacion: 'VENTA_HACIENDA_ELIMINADA',
        modulo: 'Ventas',
        descripcion: `Liquidación #${venta.id} eliminada: ${formData.comprador} ($${formData.ingreso_neto_ars.toLocaleString('es-AR')})`,
        afectados_tabla: 'ventas_hacienda',
        afectados_ids: [venta.id],
        metadata: { id: venta.id, comprador: formData.comprador, monto_neto: formData.ingreso_neto_ars },
      });

      notify?.('Liquidación eliminada del registro de ventas.', 'success');
      onDeleteSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error eliminando liquidación:', err);
      notify?.(`Error al eliminar: ${err.message}`, 'error');
    } finally {
      setDeleting(false);
    }
  }

  const promKg =
    formData.cantidad_cabezas > 0 && formData.kilos_totales > 0
      ? (formData.kilos_totales / formData.cantidad_cabezas).toLocaleString('es-AR', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : '0';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Cabecera Oficial */}
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white p-5 sm:p-6 border-b border-emerald-900/60">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Comprobante Oficial de Venta
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ID #{venta.id}
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <Scale className="w-6 h-6 text-emerald-400 shrink-0" />
                {formData.comprador || 'Consignatario / Comprador'}
              </h3>
              <p className="text-xs text-slate-300">
                {formData.tipo_comprobante} · {formData.categoria} ({formData.cantidad_cabezas} cab. · {formData.kilos_totales.toLocaleString('es-AR')} kg)
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Banner de Totales Clave */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5 pt-4 border-t border-white/10">
            <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-300 block">Ingreso Neto (USD)</span>
              <span className="text-lg font-black text-emerald-300">
                USD ${formData.ingreso_neto_usd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-300 block">Ingreso Neto (ARS)</span>
              <span className="text-lg font-black text-white">
                ${formData.ingreso_neto_ars.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-300 block">IVA Débito (10,5%)</span>
              <span className="text-lg font-black text-sky-300">
                ${formData.monto_iva.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-300 block">Precio Promedio</span>
              <span className="text-lg font-black text-amber-300">
                ${formData.precio_kg.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg
              </span>
            </div>
          </div>
        </div>

        {/* Cuerpo del Formulario Editable */}
        <form onSubmit={handleSave} className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* Fila 1: Fechas y Comprador */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                Fecha de Emisión / Venta
              </label>
              <input
                type="date"
                value={formData.fecha}
                onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 text-xs focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                Consignatario / Comprador
              </label>
              <input
                type="text"
                value={formData.comprador}
                onChange={(e) => setFormData({ ...formData, comprador: e.target.value })}
                placeholder="Razón Social / Firma Consignataria"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 text-xs focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                Rodeo Origen
              </label>
              <select
                value={formData.rodeo_nombre}
                onChange={(e) => setFormData({ ...formData, rodeo_nombre: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 text-xs bg-white focus:ring-2 focus:ring-emerald-700 focus:outline-none"
              >
                <option value="">(Sin rodeo asignado / Histórico)</option>
                {rodeos.map((r) => (
                  <option key={r.id} value={r.nombre}>
                    {r.nombre} (P#{r.potrero_numero || '—'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fila 2: Cabezas, Kilos y Precio */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Categoría
              </label>
              <input
                type="text"
                value={formData.categoria}
                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Cabezas
              </label>
              <input
                type="number"
                min="1"
                value={formData.cantidad_cabezas}
                onChange={(e) => handleNumericChange('cantidad_cabezas', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-black text-xs text-center bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Kilos Totales
              </label>
              <input
                type="number"
                step="any"
                value={formData.kilos_totales}
                onChange={(e) => handleNumericChange('kilos_totales', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-black text-xs text-right bg-white"
                required
              />
              <span className="block text-[10px] text-slate-600 text-right mt-0.5">
                {promKg} kg/cab
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Precio por Kilo ($/kg)
              </label>
              <input
                type="number"
                step="any"
                value={formData.precio_kg}
                onChange={(e) => handleNumericChange('precio_kg', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-black text-xs text-right text-emerald-800 bg-white"
                required
              />
            </div>
          </div>

          {/* Fila 3: Liquidación Impositiva y Comercial */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-emerald-50/50 p-4 rounded-xl border border-emerald-200">
            <div>
              <label className="block text-[11px] font-black uppercase text-emerald-900 mb-1">
                Importe Bruto (ARS)
              </label>
              <input
                type="number"
                step="any"
                value={formData.importe_bruto_ars}
                onChange={(e) => handleNumericChange('importe_bruto_ars', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 font-black text-xs text-right bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-emerald-900 mb-1">
                Gastos Comercializ. (ARS)
              </label>
              <input
                type="number"
                step="any"
                value={formData.gastos_comercializacion_ars}
                onChange={(e) => handleNumericChange('gastos_comercializacion_ars', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 font-bold text-xs text-right text-rose-700 bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-emerald-900 mb-1">
                IVA Débito (10,5%)
              </label>
              <input
                type="number"
                step="any"
                value={formData.monto_iva}
                onChange={(e) => handleNumericChange('monto_iva', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 font-bold text-xs text-right text-sky-800 bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-emerald-900 mb-1">
                Dólar Blue Histórico ($)
              </label>
              <input
                type="number"
                step="any"
                value={formData.tipo_cambio}
                onChange={(e) => handleNumericChange('tipo_cambio', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 font-bold text-xs text-right bg-white"
              />
            </div>
          </div>

          {/* Fila 4: Observaciones */}
          <div>
            <label className="block text-xs font-black uppercase text-slate-600 mb-1">
              Observaciones, DTA, N° de Guía o Remate
            </label>
            <textarea
              rows={2}
              value={formData.observaciones}
              onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
              placeholder="Número de liquidación, condiciones de pago, transportista, caravanas..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-700 focus:outline-none"
            />
          </div>
        </form>

        {/* Footer con Acciones */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-extrabold flex items-center gap-1.5 border border-rose-200 transition cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
            {deleting ? 'Eliminando...' : 'Eliminar Liquidación'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportarDetalleLiquidacionPDF({ ...venta, ...formData }, { dolarRef, notify })}
              className="px-4 py-2.5 rounded-xl bg-white hover:bg-emerald-50 text-emerald-900 text-xs font-black flex items-center gap-2 border border-emerald-300 shadow-2xs transition active:scale-95 cursor-pointer"
              title="Descargar Comprobante Oficial en PDF"
            >
              <FileText className="w-4 h-4 text-emerald-700" />
              <span>📄 PDF Comprobante</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-extrabold text-slate-600 hover:text-slate-800 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Guardando Cambios...' : 'Guardar Comprobante'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
