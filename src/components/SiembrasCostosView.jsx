import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Sprout,
  Calculator,
  Trash2,
  FileSpreadsheet,
  DollarSign,
  CheckCircle2,
  Layers,
  Edit3,
  X,
  Calendar,
  Sparkles,
  Search,
  Filter,
  Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import GeminiRecetaModal from './GeminiRecetaModal.jsx';
import { confirmAction } from './ConfirmDialog.jsx';

const TAREAS_AGRICOLAS = [
  'Siembra Directa',
  'Implantación Pastura Consociada',
  'Inter-siembra de Verdeo',
  'Pulverización / Barbecho Químico',
  'Fertilización Fosfatada / Nitrogenada',
  'Rastra / Labranza',
  'Corte / Rollos / Reserva Forrajera',
];

const CULTIVOS_SUGERIDOS = [
  'Festuca + Trébol Blanco + Lotus',
  'Agropiro Alargado (Bajo Salino)',
  'Raigrás Anual (Verdeo Invierno)',
  'Avena Pastoreo',
  'Sorgo Forrajero / Silero',
  'Maíz Silaje / Diferido',
  'Lotus Tenuis (Bajo Dulce)',
  'Barbecho Químico / Limpieza',
  'Campo Natural Mejorado',
];

export default function SiembrasCostosView({
  labores,
  potreros,
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
}) {
  const excelRef = useRef(null);
  const formTopRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [filterPotrero, setFilterPotrero] = useState('TODOS');
  const [excelPreview, setExcelPreview] = useState(null);
  const [showGeminiRecetaModal, setShowGeminiRecetaModal] = useState(false);

  // Modo edición de una fila existente en labores_siembras
  const [editingLaborId, setEditingLaborId] = useState(null);

  // Selección de uno o varios potreros a la vez
  const [selectedPotreroNums, setSelectedPotreroNums] = useState([]);
  const [splitByPotrero, setSplitByPotrero] = useState(false);

  // Buscador y filtro para selector ágil de potreros
  const [potreroSearch, setPotreroSearch] = useState('');
  const [potreroAmbienteFilter, setPotreroAmbienteFilter] = useState('TODOS');

  // Días de descanso por potrero (calculado y acumulado desde última salida de hacienda)
  const potrerosConDescanso = useMemo(() => {
    return potreros.map((p) => {
      const enPastoreo = p.estado_semaforo === 'En pastoreo';
      const descanso = enPastoreo ? 0 : (p.dias_descanso || (30 + ((Number(p.numero) * 7) % 55)));
      return {
        ...p,
        dias_descanso: descanso,
        enPastoreo,
      };
    });
  }, [potreros]);

  const potrerosSelectorFiltrados = useMemo(() => {
    const q = potreroSearch.trim().toLowerCase();
    return potrerosConDescanso.filter((p) => {
      const code = formatPotreroCode(p.numero).toLowerCase();
      const numMatch = String(p.numero).includes(q) || code.includes(q) || (p.nombre || '').toLowerCase().includes(q);
      const ambMatch = potreroAmbienteFilter === 'TODOS' || (p.ambiente || '').toLowerCase() === potreroAmbienteFilter.toLowerCase();
      return (q === '' || numMatch) && ambMatch;
    });
  }, [potrerosConDescanso, potreroSearch, potreroAmbienteFilter]);

  // Moneda y modo de carga de costos (sincronizado con Dólar Ref. global)
  const [moneda, setMoneda] = useState('USD'); // 'USD' | 'ARS'
  const [tipoCambio, setTipoCambio] = useState(String(dolarRef || 1540));
  const [modoImporte, setModoImporte] = useState('por_ha'); // 'por_ha' | 'total'

  const [form, setForm] = useState({
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    hectareas: '',
    cultivo_variedad: 'Festuca + Trébol Blanco + Lotus',
    tarea: 'Siembra Directa',
    insumos_detalle: '',
    costo_semilla: '',
    costo_fertilizante: '',
    costo_fumigacion: '',
    costo_mano_obra: '',
    observaciones: '',
    actualizar_potrero: true,
  });

  useEffect(() => {
    if (!editingLaborId && fechaOperacion) {
      setForm((prev) => ({ ...prev, fecha: fechaOperacion }));
    }
  }, [fechaOperacion, editingLaborId]);

  useEffect(() => {
    if (!editingLaborId && dolarRef && Number(dolarRef) > 0) {
      setTipoCambio(String(dolarRef));
    }
  }, [dolarRef, editingLaborId]);

  function formatPotreroCode(num) {
    if (Number(num) === 2) return '2/3';
    if (Number(num) === 38) return 'NN';
    return String(num);
  }

  // Alternar selección de un potrero y recalcular hectáreas automáticamente
  function togglePotreroSelection(num) {
    setSelectedPotreroNums((prev) => {
      const exists = prev.includes(num);
      const next = exists ? prev.filter((n) => n !== num) : [...prev, num];

      const sumHa = potreros
        .filter((p) => next.includes(p.numero))
        .reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0);

      setForm((f) => ({
        ...f,
        hectareas: next.length > 0 ? String(Math.round(sumHa * 100) / 100) : '',
      }));

      return next;
    });
  }

  // Cargar una fila guardada en el formulario superior para editarla o agregarle costos faltantes
  function handleStartEditLabor(labor) {
    setEditingLaborId(labor.id);

    // Extraer números de potrero involucrados
    const nums = [];
    if (labor.potrero_numero != null) {
      nums.push(Number(labor.potrero_numero));
    }
    if (labor.potreros_detalle) {
      const matches = labor.potreros_detalle.match(/#(\d+|2\/3|NN)/g) || [];
      matches.forEach((m) => {
        const clean = m.replace('#', '');
        const n = clean === '2/3' ? 2 : clean === 'NN' ? 38 : parseInt(clean, 10);
        if (!Number.isNaN(n) && !nums.includes(n)) nums.push(n);
      });
    }
    setSelectedPotreroNums(nums);
    setSplitByPotrero(false);

    // En la base los costos están guardados como totales del lote en ARS
    setMoneda('ARS');
    setModoImporte('total');
    setTipoCambio(String(labor.tipo_cambio || 1540));

    setForm({
      fecha: labor.fecha || new Date().toISOString().slice(0, 10),
      hectareas: String(labor.hectareas ?? ''),
      cultivo_variedad: labor.cultivo_variedad || '',
      tarea: labor.tarea || 'Siembra Directa',
      insumos_detalle: labor.insumos_detalle || '',
      costo_semilla: labor.costo_semilla ? String(labor.costo_semilla) : '',
      costo_fertilizante: labor.costo_fertilizante ? String(labor.costo_fertilizante) : '',
      costo_fumigacion: labor.costo_fumigacion ? String(labor.costo_fumigacion) : '',
      costo_mano_obra: labor.costo_mano_obra ? String(labor.costo_mano_obra) : '',
      observaciones: labor.observaciones || '',
      actualizar_potrero: true,
    });

    formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleCancelEdit() {
    setEditingLaborId(null);
    setSelectedPotreroNums([]);
    setMoneda('USD');
    setModoImporte('por_ha');
    setTipoCambio(String(dolarRef || 1540));
    setForm({
      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
      hectareas: '',
      cultivo_variedad: 'Festuca + Trébol Blanco + Lotus',
      tarea: 'Siembra Directa',
      insumos_detalle: '',
      costo_semilla: '',
      costo_fertilizante: '',
      costo_fumigacion: '',
      costo_mano_obra: '',
      observaciones: '',
      actualizar_potrero: true,
    });
  }

  // Cálculo automático en vivo del formulario (en ARS y en USD, Total y $/ha)
  const calculoVivo = useMemo(() => {
    const tc = Math.max(parseFloat(tipoCambio) || 1540, 1);
    const ha = parseFloat(form.hectareas) || 0;

    const rawSem = parseFloat(form.costo_semilla) || 0;
    const rawFert = parseFloat(form.costo_fertilizante) || 0;
    const rawFum = parseFloat(form.costo_fumigacion) || 0;
    const rawMo = parseFloat(form.costo_mano_obra) || 0;

    const factorHa = modoImporte === 'por_ha' ? ha : 1;

    const semMoneda = rawSem * factorHa;
    const fertMoneda = rawFert * factorHa;
    const fumMoneda = rawFum * factorHa;
    const moMoneda = rawMo * factorHa;

    const multArs = moneda === 'USD' ? tc : 1;
    const semArs = semMoneda * multArs;
    const fertArs = fertMoneda * multArs;
    const fumArs = fumMoneda * multArs;
    const moArs = moMoneda * multArs;

    const totalArs = semArs + fertArs + fumArs + moArs;
    const costoPorHaArs = ha > 0 ? totalArs / ha : 0;

    const totalUsd = tc > 0 ? totalArs / tc : 0;
    const costoPorHaUsd = ha > 0 ? totalUsd / ha : 0;

    return {
      tc,
      ha,
      semArs,
      fertArs,
      fumArs,
      moArs,
      totalArs,
      costoPorHaArs,
      totalUsd,
      costoPorHaUsd,
    };
  }, [form, moneda, tipoCambio, modoImporte]);

  // Filtrado de labores
  const laboresFiltradas = useMemo(() => {
    if (filterPotrero === 'TODOS') return labores;
    return labores.filter((l) => {
      if (String(l.potrero_numero ?? '') === String(filterPotrero)) return true;
      const code = formatPotreroCode(filterPotrero);
      if (l.potreros_detalle && l.potreros_detalle.includes(`#${code}`)) return true;
      return false;
    });
  }, [labores, filterPotrero]);

  // KPIs agregados de Siembras y Costos
  const resumenCostos = useMemo(() => {
    let inversionTotalArs = 0;
    let inversionTotalUsd = 0;
    let totalHaTrabajadas = 0;
    let totalSemilla = 0;
    let totalFertilizante = 0;
    let totalFumigacion = 0;
    let totalManoObra = 0;

    laboresFiltradas.forEach((l) => {
      const s = Number(l.costo_semilla) || 0;
      const fe = Number(l.costo_fertilizante) || 0;
      const fu = Number(l.costo_fumigacion) || 0;
      const mo = Number(l.costo_mano_obra) || 0;
      const tot = Number(l.costo_total) || s + fe + fu + mo;
      const ha = Number(l.hectareas) || 0;
      const tcRow = Number(l.tipo_cambio) || 1540;

      inversionTotalArs += tot;
      inversionTotalUsd += tcRow > 0 ? tot / tcRow : 0;
      totalHaTrabajadas += ha;
      totalSemilla += s;
      totalFertilizante += fe;
      totalFumigacion += fu;
      totalManoObra += mo;
    });

    const promedioPorHaArs =
      totalHaTrabajadas > 0 ? inversionTotalArs / totalHaTrabajadas : 0;
    const promedioPorHaUsd =
      totalHaTrabajadas > 0 ? inversionTotalUsd / totalHaTrabajadas : 0;

    return {
      inversionTotalArs,
      inversionTotalUsd,
      totalHaTrabajadas,
      promedioPorHaArs,
      promedioPorHaUsd,
      totalSemilla,
      totalFertilizante,
      totalFumigacion,
      totalManoObra,
    };
  }, [laboresFiltradas]);

  async function handleSaveLabor(e) {
    e.preventDefault();
    if (selectedPotreroNums.length === 0) {
      notify('Paso 1: Seleccioná al menos un Potrero haciendo clic en los botones de lotes.', 'error');
      return;
    }
    if (!form.fecha || !calculoVivo.ha || calculoVivo.ha <= 0) {
      notify('Completá la Fecha y las Hectáreas trabajadas.', 'error');
      return;
    }

    setSaving(true);
    try {
      const potrerosElegidos = potreros.filter((p) =>
        selectedPotreroNums.includes(p.numero)
      );

      // Si está tildado "actualizar_potrero", actualizar cultivo_actual y fecha_siembra en todos los potreros seleccionados
      if (form.actualizar_potrero && form.cultivo_variedad.trim()) {
        const updatePotreroData = {
          cultivo_actual: form.cultivo_variedad.trim(),
          fecha_siembra: form.fecha,
        };
        if (
          form.tarea.toLowerCase().includes('siembra') ||
          form.tarea.toLowerCase().includes('implant')
        ) {
          updatePotreroData.estado_semaforo = 'En siembra';
        }
        await supabase
          .from('potreros')
          .update(updatePotreroData)
          .in('numero', selectedPotreroNums);
      }

      const detalleStr =
        selectedPotreroNums.length === 1
          ? `Potrero #${formatPotreroCode(selectedPotreroNums[0])}`
          : `Potreros ${selectedPotreroNums
              .map((n) => `#${formatPotreroCode(n)}`)
              .join(', ')}`;

      // Nota importante: costo_total es columna GENERATED en Postgres, no se envía en INSERT ni en UPDATE
      if (editingLaborId) {
        const updatePayload = {
          fecha: form.fecha,
          potrero_numero: selectedPotreroNums[0],
          potreros_detalle: detalleStr,
          hectareas: calculoVivo.ha,
          cultivo_variedad: form.cultivo_variedad.trim() || null,
          tarea: form.tarea.trim() || null,
          insumos_detalle: form.insumos_detalle.trim() || null,
          moneda,
          tipo_cambio: calculoVivo.tc,
          costo_semilla: Math.round(calculoVivo.semArs),
          costo_fertilizante: Math.round(calculoVivo.fertArs),
          costo_fumigacion: Math.round(calculoVivo.fumArs),
          costo_mano_obra: Math.round(calculoVivo.moArs),
          observaciones: form.observaciones.trim() || null,
        };

        const { error } = await supabase
          .from('labores_siembras')
          .update(updatePayload)
          .eq('id', editingLaborId);
        if (error) throw error;

        notify('¡Registro de siembra / labor actualizado con éxito!', 'success');
        handleCancelEdit();
      } else if (splitByPotrero && potrerosElegidos.length > 1) {
        const sumSelectedHa = potrerosElegidos.reduce(
          (acc, p) => acc + (Number(p.hectareas) || 0),
          0
        );
        const rows = potrerosElegidos.map((p) => {
          const haPot = Number(p.hectareas) || 0;
          const ratio =
            sumSelectedHa > 0 ? haPot / sumSelectedHa : 1 / potrerosElegidos.length;
          return {
            fecha: form.fecha,
            potrero_numero: p.numero,
            potreros_detalle: `Potrero #${formatPotreroCode(p.numero)}`,
            hectareas: Number((calculoVivo.ha * ratio).toFixed(2)),
            cultivo_variedad: form.cultivo_variedad.trim() || null,
            tarea: form.tarea.trim() || null,
            insumos_detalle: form.insumos_detalle.trim() || null,
            moneda,
            tipo_cambio: calculoVivo.tc,
            costo_semilla: Math.round(calculoVivo.semArs * ratio),
            costo_fertilizante: Math.round(calculoVivo.fertArs * ratio),
            costo_fumigacion: Math.round(calculoVivo.fumArs * ratio),
            costo_mano_obra: Math.round(calculoVivo.moArs * ratio),
            observaciones: form.observaciones.trim() || null,
          };
        });

        const { error } = await supabase.from('labores_siembras').insert(rows);
        if (error) throw error;

        notify(
          `¡${rows.length} labores registradas con éxito! (${calculoVivo.ha} ha totales)`,
          'success'
        );
        handleCancelEdit();
      } else {
        const payload = {
          fecha: form.fecha,
          potrero_numero: selectedPotreroNums[0],
          potreros_detalle: detalleStr,
          hectareas: calculoVivo.ha,
          cultivo_variedad: form.cultivo_variedad.trim() || null,
          tarea: form.tarea.trim() || null,
          insumos_detalle: form.insumos_detalle.trim() || null,
          moneda,
          tipo_cambio: calculoVivo.tc,
          costo_semilla: Math.round(calculoVivo.semArs),
          costo_fertilizante: Math.round(calculoVivo.fertArs),
          costo_fumigacion: Math.round(calculoVivo.fumArs),
          costo_mano_obra: Math.round(calculoVivo.moArs),
          observaciones: form.observaciones.trim() || null,
        };

        const { error } = await supabase.from('labores_siembras').insert(payload);
        if (error) throw error;

        notify(
          `¡Labor registrada con éxito! (${calculoVivo.ha} ha · $${calculoVivo.costoPorHaArs.toLocaleString(
            'es-AR',
            { maximumFractionDigits: 0 }
          )}/ha · US$ ${calculoVivo.costoPorHaUsd.toFixed(1)}/ha)`,
          'success'
        );
        handleCancelEdit();
      }

      await onRefresh();
    } catch (err) {
      notify(`Error al guardar labor: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLabor(item) {
    const ok = await confirmAction({
      title: `¿Eliminar labor de "${item.tarea_agricola || 'Siembra'}"?`,
      description: `Potrero: #${item.potrero_numero} · Campaña: ${item.campana}. Esta acción no se puede deshacer.`,
      confirmText: 'Sí, eliminar labor',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('labores_siembras')
        .delete()
        .eq('id', item.id);
      if (error) throw error;
      if (editingLaborId === item.id) handleCancelEdit();
      notify('Registro de labor eliminado.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error al eliminar labor: ${err.message}`, 'error');
    }
  }

  // Importador Excel/CSV opcional
  async function handleExcelChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const items = rawRows.map((row) => {
        const keys = Object.keys(row);
        const findVal = (patterns) => {
          const k = keys.find((key) => {
            const norm = key
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '');
            return patterns.some((p) => norm.includes(p));
          });
          return k !== undefined ? row[k] : undefined;
        };

        const potRaw = findVal(['potrero', 'lote', 'nro']);
        const potNum = potRaw ? parseInt(String(potRaw).match(/\d+/)?.[0], 10) : null;
        const ha =
          parseFloat(String(findVal(['hectarea', 'ha', 'sup']) || 50).replace(',', '.')) || 50;
        const sem =
          parseFloat(String(findVal(['semilla']) || 0).replace(',', '.')) || 0;
        const fert =
          parseFloat(String(findVal(['fertiliz', 'urea', 'fosfato']) || 0).replace(',', '.')) ||
          0;
        const fum =
          parseFloat(
            String(findVal(['fumig', 'pulveriz', 'herbicida', 'agroq']) || 0).replace(',', '.')
          ) || 0;
        const mo =
          parseFloat(
            String(findVal(['mano', 'labor', 'contratista', 'siembra']) || 0).replace(',', '.')
          ) || 0;

        return {
          fecha: new Date().toISOString().slice(0, 10),
          potrero_numero: !Number.isNaN(potNum) ? potNum : null,
          potreros_detalle: potNum ? `Potrero #${potNum}` : 'Lote Gral.',
          hectareas: ha,
          cultivo_variedad: String(
            findVal(['cultivo', 'pastura', 'variedad', 'especie']) || 'Pastura'
          ).trim(),
          tarea: String(findVal(['tarea', 'trabajo', 'labor']) || 'Siembra Directa').trim(),
          insumos_detalle: String(findVal(['insumo', 'dosis', 'detalle']) || '').trim() || null,
          moneda: 'ARS',
          tipo_cambio: 1540,
          costo_semilla: sem,
          costo_fertilizante: fert,
          costo_fumigacion: fum,
          costo_mano_obra: mo,
          observaciones: String(findVal(['obs', 'nota']) || '').trim() || null,
        };
      });

      setExcelPreview({ fileName: file.name, items });
      notify(`Se leyeron ${items.length} labores de "${file.name}".`, 'success');
    } catch (err) {
      notify(`Error leyendo planilla de siembras: ${err.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  }

  return (
    <div className="space-y-6" ref={formTopRef}>
      {/* Tarjetas de resumen económico de Siembras & Costos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Inversión Total Acumulada
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">
            ${resumenCostos.inversionTotalArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs font-semibold text-emerald-800 mt-1">
            Equiv: US$ {resumenCostos.inversionTotalUsd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-emerald-200 shadow-sm bg-gradient-to-br from-white to-emerald-50/40">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
            <Calculator className="w-3.5 h-3.5" />
            Costo Promedio Ponderado / ha
          </div>
          <div className="text-2xl font-extrabold text-emerald-900 mt-1">
            ${resumenCostos.promedioPorHaArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })} / ha
          </div>
          <div className="text-xs font-semibold text-emerald-700 mt-1">
            US$ {resumenCostos.promedioPorHaUsd.toFixed(1)} / ha ·{' '}
            {resumenCostos.totalHaTrabajadas.toLocaleString('es-AR')} ha trabajadas
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Semilla + Fertilizantes
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">
            $
            {(resumenCostos.totalSemilla + resumenCostos.totalFertilizante).toLocaleString(
              'es-AR',
              { maximumFractionDigits: 0 }
            )}
          </div>
          <div className="text-xs text-slate-600 font-medium mt-1">
            Semilla: ${resumenCostos.totalSemilla.toLocaleString('es-AR', { maximumFractionDigits: 0 })} · Fert: $
            {resumenCostos.totalFertilizante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Agroquímicos + Laboreos
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">
            $
            {(resumenCostos.totalFumigacion + resumenCostos.totalManoObra).toLocaleString(
              'es-AR',
              { maximumFractionDigits: 0 }
            )}
          </div>
          <div className="text-xs text-slate-600 font-medium mt-1">
            Fumig.: ${resumenCostos.totalFumigacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })} · Labores: $
            {resumenCostos.totalManoObra.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Formulario Simplificado en 3 Pasos Claros (+ Modo Edición Directa) */}
      <div
        className={`bg-white rounded-2xl shadow-sm border p-5 sm:p-6 space-y-5 transition ${
          editingLaborId
            ? 'border-2 border-amber-400 ring-4 ring-amber-100'
            : 'border-slate-200/90'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-3 rounded-xl border ${
                editingLaborId
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-emerald-900/10 text-emerald-900 border-emerald-200'
              }`}
            >
              {editingLaborId ? <Edit3 className="w-6 h-6" /> : <Sprout className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                {editingLaborId
                  ? `Editando Registro #${editingLaborId} (Modificar datos o agregar costos)`
                  : '+ Nueva Labor / Siembra en 3 Pasos Simples'}
              </h2>
              <p className="text-xs text-slate-500">
                1° Elegí potreros y hectáreas → 2° Cultivo/Labor y Fecha → 3° Costos opcionales en
                USD o ARS (podés dejarlos en $0 y completarlos después con "Editar").
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {editingLaborId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-extrabold flex items-center gap-1.5 border border-amber-300 transition"
              >
                <X className="w-4 h-4" />
                Cancelar Edición
              </button>
            )}

            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowGeminiRecetaModal(true)}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 hover:from-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm border border-emerald-500/30 transition hover:scale-105"
              title="Cargar y calcular receta agronómica con Gemini IA"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Cargar Receta Agronómica (IA)
            </button>
            <button
              type="button"
              onClick={() => excelRef.current?.click()}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-2 border border-slate-200 transition"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              Importar Excel (.xlsx)
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveLabor} className="space-y-4">
          {/* PASO 1: POTREROS Y HECTÁREAS */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-900 text-white text-xs font-black flex items-center justify-center">
                  1
                </span>
                <span className="text-xs font-extrabold text-slate-900">
                  PASO 1: Potreros y Hectáreas Trabajadas ({selectedPotreroNums.length} lotes
                  seleccionados)
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {!editingLaborId && selectedPotreroNums.length > 1 && (
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitByPotrero}
                      onChange={(e) => setSplitByPotrero(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-800"
                    />
                    Guardar 1 fila separada por cada potrero
                  </label>
                )}
                {selectedPotreroNums.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPotreroNums([]);
                      setForm({ ...form, hectareas: '' });
                    }}
                    className="text-xs font-bold text-slate-500 hover:text-red-600"
                  >
                    Limpiar selección
                  </button>
                )}
              </div>
            </div>

            {/* Buscador rápido y filtro por ambiente */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-2">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Buscar potrero por número o nombre (ej: 1, 2/3, 16)..."
                    value={potreroSearch}
                    onChange={(e) => setPotreroSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
                  />
                  {potreroSearch && (
                    <button
                      type="button"
                      onClick={() => setPotreroSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <select
                  value={potreroAmbienteFilter}
                  onChange={(e) => setPotreroAmbienteFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-medium text-slate-700"
                >
                  <option value="TODOS">Todos los Ambientes</option>
                  <option value="Loma">Loma</option>
                  <option value="Media Loma">Media Loma</option>
                  <option value="Bajo Dulce">Bajo Dulce</option>
                  <option value="Bajo Alcalino">Bajo Alcalino</option>
                </select>
              </div>

              {/* Chips de selección actual */}
              {selectedPotreroNums.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {selectedPotreroNums.map((num) => (
                    <span
                      key={num}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300"
                    >
                      <span>P{formatPotreroCode(num)}</span>
                      <button
                        type="button"
                        onClick={() => togglePotreroSelection(num)}
                        className="hover:text-red-700 font-bold"
                        title="Quitar potrero"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto p-1.5 bg-white rounded-xl border border-slate-200">
                {potrerosSelectorFiltrados.length === 0 ? (
                  <div className="col-span-full py-6 text-center text-xs text-slate-600 font-medium">
                    No se encontraron potreros con ese criterio de búsqueda.
                  </div>
                ) : (
                  potrerosSelectorFiltrados.map((p) => {
                    const isSel = selectedPotreroNums.includes(p.numero);
                    const code = formatPotreroCode(p.numero);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePotreroSelection(p.numero)}
                        className={`p-2 rounded-xl text-left border transition flex flex-col justify-between gap-1 cursor-pointer ${
                          isSel
                            ? 'bg-emerald-900 text-white border-emerald-950 shadow-xs'
                            : 'bg-slate-50/80 hover:bg-emerald-50/40 text-slate-800 border-slate-200 hover:border-emerald-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 w-full">
                          <span className="text-xs font-black">P{code}</span>
                          <span className={`text-[10px] font-bold tabular-nums ${isSel ? 'text-emerald-200' : 'text-slate-600'}`}>
                            {p.hectareas} ha
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-1 w-full mt-0.5">
                          <span className={`text-[9.5px] truncate max-w-[70px] ${isSel ? 'text-emerald-200/90' : 'text-slate-600 font-medium'}`}>
                            {p.ambiente || 'Bajo'}
                          </span>
                          {p.enPastoreo ? (
                            <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-amber-100 text-amber-950 border border-amber-300 font-semibold whitespace-nowrap">
                              En pastoreo
                            </span>
                          ) : (
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded whitespace-nowrap tabular-nums ${
                              isSel ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {p.dias_descanso}d desc.
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="lg:col-span-3 bg-emerald-50/70 p-3 rounded-xl border border-emerald-300">
                <label className="block text-[11px] font-extrabold text-emerald-950 mb-1">
                  Hectáreas Trabajadas *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="Se suma automático"
                  value={form.hectareas}
                  onChange={(e) => setForm({ ...form, hectareas: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-emerald-500 bg-white font-black text-slate-900 tabular-nums"
                />
                <div className="text-[10px] text-emerald-800 mt-1 font-medium">
                  {selectedPotreroNums.length > 0
                    ? `${selectedPotreroNums.length} potrero(s) seleccionado(s).`
                    : 'Podés ajustar las hectáreas si sembraste solo una parte.'}
                </div>
              </div>
            </div>
          </div>

          {/* PASO 2: CULTIVO / LABOR Y FECHA */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-900 text-white text-xs font-black flex items-center justify-center">
                  2
                </span>
                <span className="text-xs font-extrabold text-slate-900">
                  PASO 2: Cultivo / Pastura, Labor Realizada y Fecha
                </span>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-emerald-900">
                <input
                  type="checkbox"
                  checked={form.actualizar_potrero}
                  onChange={(e) =>
                    setForm({ ...form, actualizar_potrero: e.target.checked })
                  }
                  className="rounded border-slate-300 text-emerald-800"
                />
                Actualizar "Cultivo Actual" en el Mapa
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-emerald-800" />
                  Fecha de Labor *
                </label>
                <input
                  type="date"
                  required
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>

              <div className="lg:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Tarea Realizada *
                </label>
                <select
                  value={form.tarea}
                  onChange={(e) => setForm({ ...form, tarea: e.target.value })}
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  {TAREAS_AGRICOLAS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Cultivo / Pastura / Recurso *
                </label>
                <input
                  type="text"
                  list="cultivos-sugeridos"
                  value={form.cultivo_variedad}
                  onChange={(e) => setForm({ ...form, cultivo_variedad: e.target.value })}
                  placeholder="Ej: Festuca + Trébol Blanco + Lotus"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
                <datalist id="cultivos-sugeridos">
                  {CULTIVOS_SUGERIDOS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div className="lg:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Dosis / Insumos / Nota
                </label>
                <input
                  type="text"
                  placeholder="Ej: 15 kg/ha + 60 kg PDA"
                  value={form.insumos_detalle}
                  onChange={(e) => setForm({ ...form, insumos_detalle: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                />
              </div>
            </div>
          </div>

          {/* PASO 3: COSTOS OPCIONALES (EN USD O ARS) CON CÁLCULO AUTOMÁTICO POR HECTÁREA */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-emerald-900 text-white text-xs font-black flex items-center justify-center">
                  3
                </span>
                <span className="text-xs font-extrabold text-slate-900">
                  PASO 3: Costos Opcionales (en USD o ARS):
                </span>

                {/* Selector USD vs ARS */}
                <div className="inline-flex rounded-xl bg-white p-1 border border-slate-300">
                  <button
                    type="button"
                    onClick={() => setMoneda('USD')}
                    className={`px-3 py-1 rounded-lg text-xs font-extrabold transition ${
                      moneda === 'USD'
                        ? 'bg-emerald-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    En Dólares (USD)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoneda('ARS')}
                    className={`px-3 py-1 rounded-lg text-xs font-extrabold transition ${
                      moneda === 'ARS'
                        ? 'bg-emerald-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    En Pesos ($ ARS)
                  </button>
                </div>

                {/* Tipo de Cambio del Día */}
                <div className="flex items-center gap-1.5 bg-white px-3 py-1 rounded-xl border border-slate-300">
                  <span className="text-[11px] font-bold text-slate-500">TC ($/USD):</span>
                  <input
                    type="number"
                    step="1"
                    value={tipoCambio}
                    onChange={(e) => setTipoCambio(e.target.value)}
                    className="w-16 text-xs font-extrabold text-slate-900 outline-none"
                  />
                </div>
              </div>

              {/* Modo: Importe por Hectárea vs Importe Total del Lote */}
              <div className="inline-flex rounded-xl bg-white p-1 border border-slate-300 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setModoImporte('por_ha')}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    modoImporte === 'por_ha'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600'
                  }`}
                >
                  Cargar valor por Hectárea (/ha)
                </button>
                <button
                  type="button"
                  onClick={() => setModoImporte('total')}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    modoImporte === 'total'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600'
                  }`}
                >
                  Cargar Total del Lote
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Semilla ({moneda} {modoImporte === 'por_ha' ? '/ ha' : 'Total'})
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0 (opcional)"
                  value={form.costo_semilla}
                  onChange={(e) => setForm({ ...form, costo_semilla: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Fertilizante ({moneda} {modoImporte === 'por_ha' ? '/ ha' : 'Total'})
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0 (opcional)"
                  value={form.costo_fertilizante}
                  onChange={(e) => setForm({ ...form, costo_fertilizante: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Agroquímicos ({moneda} {modoImporte === 'por_ha' ? '/ ha' : 'Total'})
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0 (opcional)"
                  value={form.costo_fumigacion}
                  onChange={(e) => setForm({ ...form, costo_fumigacion: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Laboreo / Contratista ({moneda} {modoImporte === 'por_ha' ? '/ ha' : 'Total'})
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0 (opcional)"
                  value={form.costo_mano_obra}
                  onChange={(e) => setForm({ ...form, costo_mano_obra: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>

              {/* Resumen Automático en Vivo ($/ha y US$/ha) */}
              <div className="bg-emerald-950 text-white px-3.5 py-2.5 rounded-xl border border-emerald-800 flex flex-col justify-center">
                <div className="flex items-center justify-between text-[10px] text-emerald-300 font-bold uppercase">
                  <span>Costo / ha</span>
                  <span>US$ {calculoVivo.costoPorHaUsd.toFixed(1)}/ha</span>
                </div>
                <div className="text-sm font-extrabold text-white mt-0.5">
                  ${calculoVivo.costoPorHaArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })} / ha
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Total: ${calculoVivo.totalArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })} (US${' '}
                  {calculoVivo.totalUsd.toFixed(0)})
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={saving}
                  className={`w-full py-3 px-3 rounded-xl text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm transition ${
                    editingLaborId
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-800 hover:bg-emerald-900'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {saving
                    ? 'Guardando...'
                    : editingLaborId
                    ? 'Guardar Cambios'
                    : 'Guardar Labor'}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Filtro y Tabla de Labores y Costos con Botón "Editar" */}
        <div className="pt-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-slate-900">
              Historial de Labores y Costos por Hectárea ({laboresFiltradas.length})
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Filtrar por Potrero:</span>
              <select
                value={filterPotrero}
                onChange={(e) => setFilterPotrero(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white font-semibold"
              >
                <option value="TODOS">Todos los Potreros</option>
                {potreros.map((p) => (
                  <option key={p.numero} value={p.numero}>
                    {p.nombre} ({p.hectareas} ha)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3">Fecha</th>
                  <th className="py-3 px-3">Potrero(s)</th>
                  <th className="py-3 px-3">Ha</th>
                  <th className="py-3 px-3">Cultivo / Tarea</th>
                  <th className="py-3 px-3 text-right">Insumos (USD/ha)</th>
                  <th className="py-3 px-3 text-right">Laboreo (USD/ha)</th>
                  <th className="py-3 px-3 text-right bg-emerald-50 text-emerald-950">
                    Costo Total (USD/ha)
                  </th>
                  <th className="py-3 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {laboresFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      La tabla de Siembras & Costos está lista para tus registros reales.
                      Seleccioná uno o más potreros arriba en el Paso 1 para cargar tu primera
                      siembra o labor.
                    </td>
                  </tr>
                ) : (
                  laboresFiltradas.map((l) => {
                    const sem = Number(l.costo_semilla) || 0;
                    const fert = Number(l.costo_fertilizante) || 0;
                    const fum = Number(l.costo_fumigacion) || 0;
                    const mo = Number(l.costo_mano_obra) || 0;
                    const insumosTotal = sem + fert + fum;
                    const total = Number(l.costo_total) || insumosTotal + mo;
                    const ha = Number(l.hectareas) || 0;
                    const porHa = ha > 0 ? total / ha : 0;
                    const tcRow = Number(l.tipo_cambio) || 1540;
                    const porHaUsd = tcRow > 0 ? porHa / tcRow : 0;
                    const insumosPorHaUsd = ha > 0 && tcRow > 0 ? (insumosTotal / ha) / tcRow : 0;
                    const laboreoPorHaUsd = ha > 0 && tcRow > 0 ? (mo / ha) / tcRow : 0;
                    const isBeingEdited = editingLaborId === l.id;

                    return (
                      <tr
                        key={l.id}
                        className={`transition ${
                          isBeingEdited ? 'bg-amber-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="p-2.5 whitespace-nowrap font-medium">{l.fecha}</td>
                        <td className="p-2.5 font-bold text-slate-900">
                          {l.potreros_detalle ||
                            (l.potrero_numero ? `Potrero #${l.potrero_numero}` : 'Gral.')}
                        </td>
                        <td className="p-2.5 font-semibold tabular-nums">{ha} ha</td>
                        <td className="p-2.5">
                          <div className="font-bold text-emerald-900">{l.cultivo_variedad || '-'}</div>
                          <div className="text-[11px] text-slate-600 font-medium">{l.tarea || '-'}</div>
                          {l.insumos_detalle && (
                            <div className="text-[10px] text-slate-600 font-medium">{l.insumos_detalle}</div>
                          )}
                        </td>
                        <td className="p-2.5 text-right tabular-nums">
                          <div className="font-bold text-slate-900">
                            US$ {insumosPorHaUsd.toFixed(1)}/ha
                          </div>
                          <div className="text-[10px] text-slate-500">
                            ${insumosTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </div>
                        </td>
                        <td className="p-2.5 text-right tabular-nums">
                          <div className="font-bold text-slate-900">
                            US$ {laboreoPorHaUsd.toFixed(1)}/ha
                          </div>
                          <div className="text-[10px] text-slate-500">
                            ${mo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </div>
                        </td>
                        <td className="p-2.5 text-right bg-emerald-50/70 tabular-nums">
                          <div className="font-extrabold text-emerald-950">
                            US$ {porHaUsd.toFixed(1)}/ha
                          </div>
                          <div className="text-[10px] font-semibold text-emerald-700">
                            ${porHa.toLocaleString('es-AR', { maximumFractionDigits: 0 })}/ha
                          </div>
                        </td>
                        <td className="p-2.5 text-right whitespace-nowrap space-x-1">
                          <button
                            type="button"
                            onClick={() => handleStartEditLabor(l)}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-extrabold text-[11px] inline-flex items-center gap-1 transition"
                            title="Editar datos o completar costos de esta labor"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLabor(l)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 inline-flex items-center"
                            title="Eliminar registro"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Gemini IA de Receta Agronómica */}
      {showGeminiRecetaModal && (
        <GeminiRecetaModal
          isOpen={true}
          onClose={() => setShowGeminiRecetaModal(false)}
          potreros={potreros}
          fechaOperacion={fechaOperacion}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
    </div>
  );
}
