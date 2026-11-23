import React, { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  Tags,
  Calendar,
  CalendarDays,
  Activity,
  Droplets,
  Sprout,
  ArrowRight,
  Clock,
  MapPin,
  PlusCircle,
  ArrowRightLeft,
  ClipboardList,
  StickyNote,
  Syringe,
  DollarSign,
  AlertTriangle,
  Wrench,
  FileDown,
  Settings,
  CheckCircle2,
  Plus,
  Save,
  Tractor,
  CloudRain,
  Navigation,
  Sparkles,
  X,
  Edit3,
  Trash2,
  Star,
  ShieldCheck,
  Truck,
  AlertCircle,
  Compass,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import { calcResumenRodeosOficial } from './RodeosCaravanasView.jsx';
import { exportarHojaTareasPDF, calcPermanenciaPotrero } from '../utils/pdfHelper';
import GeminiRecetaModal from './GeminiRecetaModal.jsx';
import { CRONOGRAMA_SAN_JOSE_2026 } from '../data/cronogramaSanJose.js';
import { confirmAction } from './ConfirmDialog.jsx';

const ESTADOS_MOLINO = [
  'Operativo',
  'A revisar',
  'En reparación',
  'Fuera de servicio',
];

function calcRodeoHeads(r) {
  if (!r) return 0;
  return (
    (Number(r.vacas) || 0) +
    (Number(r.terneros) || 0) +
    (Number(r.toros_padres) || 0) +
    (Number(r.toritos) || 0) +
    (Number(r.vacas_cut) || 0) +
    (Number(r.vaquillonas_reposicion) || 0)
  );
}

export default function TableroInicioView({
  potreros,
  molinos,
  infraestructura = [],
  alertasMapa = [],
  tareas = [],
  rodeos = [],
  movimientosHacienda = [],
  eventosSanitarios = [],
  proveedoresEsperados = [],
  animales,
  cajasCaravanas,
  laboresSiembras,
  gastos = [],
  ventas = [],
  campanaKpi = null,
  fechaOperacion,
  dolarRef = 1540,
  appMode = 'admin',
  registrosLluvias = [],
  caminosEstado = 'Transitable',
  onChangeCaminosEstado,
  onNavigate,
  onSelectPotreroInMap,
  onSelectInfraInMap,
  onOpenCuadrilla,
  activeCuadrillaRoute = null,
  onClearCuadrillaRoute,
  onOpenCopiloto,
  onRefresh,
  notify,
}) {
  const [updatingMolinoId, setUpdatingMolinoId] = useState(null);
  const [tabInferior, setTabInferior] = useState('hacienda_superficie'); // 'hacienda_superficie' | 'aguadas' | 'movimientos'
  const [actividadTab, setActividadTab] = useState('todos'); // 'todos' | 'movimientos' | 'labores'
  const [showSimulador, setShowSimulador] = useState(false);
  const [simuladorParams, setSimuladorParams] = useState({
    pctPrenez: 90,
    pctDestete: 80,
    pesoDestete: 190,
    precioKgUsd: 2.20,
  });
  const [showEditCampana, setShowEditCampana] = useState(false);
  const [savingCampana, setSavingCampana] = useState(false);
  const [showRecetaModal, setShowRecetaModal] = useState(false);
  const [showNuevaLluviaModal, setShowNuevaLluviaModal] = useState(false);
  const [savingLluvia, setSavingLluvia] = useState(false);
  const [nuevaLluvia, setNuevaLluvia] = useState({
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    milimetros: '',
    pluviometro: 'Casco Principal',
    observaciones: '',
  });
  const [showHistorialLluviasModal, setShowHistorialLluviasModal] = useState(false);
  const [editingLluviaId, setEditingLluviaId] = useState(null);
  const [editingLluviaForm, setEditingLluviaForm] = useState({
    fecha: '',
    milimetros: '',
    pluviometro: 'Casco Principal',
    observaciones: '',
  });
  const [savingHistorialLluvia, setSavingHistorialLluvia] = useState(false);
  const [campanaForm, setCampanaForm] = useState({
    vientres_entorados: 978,
    vientres_prenados_tacto: 880,
    terneros_destetados: 784,
    peso_destete_prom_kg: 190,
    stock_inicial_cabezas: 2024,
  });

  // Gestor rápido de Tareas Semanal / Mensual en el Tablero
  const [showQuickTareaForm, setShowQuickTareaForm] = useState(false);
  const [savingTarea, setSavingTarea] = useState(false);
  const [quickTarea, setQuickTarea] = useState({
    titulo: '',
    potrero_numero: '',
    infraestructura_nombre: '',
    responsable: '',
    prioridad: 'Alta',
    fecha_limite: fechaOperacion || new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    if (campanaKpi) {
      setCampanaForm({
        vientres_entorados: Number(campanaKpi.vientres_entorados) || 978,
        vientres_prenados_tacto: Number(campanaKpi.vientres_prenados_tacto) || 880,
        terneros_destetados: Number(campanaKpi.terneros_destetados) || 784,
        peso_destete_prom_kg: Number(campanaKpi.peso_destete_prom_kg) || 190,
        stock_inicial_cabezas: Number(campanaKpi.stock_inicial_cabezas) || 2024,
      });
    }
  }, [campanaKpi]);

  // 1. KPIs Reales calculados desde Supabase (conciliados con los 15 rodeos = 2.024 cabezas)
  const totalHectareas = potreros.reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0);
  const animalesActivos = animales.filter((a) => (a.estado || 'En campo') === 'En campo');

  const resumenRodeos = useMemo(() => calcResumenRodeosOficial(rodeos), [rodeos]);

  const totalCabezasActivas =
    resumenRodeos.total > 0 ? resumenRodeos.total : animalesActivos.length;

  const cargaGlobal =
    totalHectareas > 0 ? (totalCabezasActivas / totalHectareas).toFixed(2) : '0.00';

  const potrerosConHacienda = useMemo(() => {
    const s = new Set();
    rodeos.forEach((r) => {
      if (r.potrero_numero != null && calcRodeoHeads(r) > 0) {
        s.add(Number(r.potrero_numero));
      }
    });
    if (s.size === 0) {
      animalesActivos.forEach((a) => {
        if (a.potrero_actual != null) s.add(Number(a.potrero_actual));
      });
    }
    return s;
  }, [rodeos, animalesActivos]);

  const haOcupadas = potreros
    .filter((p) => potrerosConHacienda.has(Number(p.numero)))
    .reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0);

  const stockCaravanasDisponibles = cajasCaravanas.reduce(
    (acc, c) => acc + (Number(c.en_stock) || 0),
    0
  );

  const tareasPendientes = tareas.filter((t) => !t.completada);
  const alertasActivas = alertasMapa.filter((a) => !a.resuelta);
  const sanidadPendiente = eventosSanitarios.filter((e) => !e.realizado && e.estado !== 'Realizado');
  const proveedoresEsperadosPendientes = (proveedoresEsperados || []).filter(
    (p) => p.estado === 'Esperando' || p.estado === 'En Camino'
  );

  // KPIs Económicos en tiempo real (Gastos + Siembras vs Ventas)
  const kpiEconomicos = useMemo(() => {
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    const gastosDirectosArs = gastos.reduce((acc, g) => acc + (Number(g.monto_ars) || 0), 0);
    const siembrasArs = laboresSiembras.reduce((acc, l) => {
      const tot =
        Number(l.costo_total) ||
        (Number(l.costo_semilla) || 0) +
          (Number(l.costo_fertilizante) || 0) +
          (Number(l.costo_fumigacion) || 0) +
          (Number(l.costo_mano_obra) || 0);
      return acc + tot;
    }, 0);
    const gastoTotalArs = gastosDirectosArs + siembrasArs;
    const gastoTotalUsd = gastoTotalArs / tc;
    const costoPorCabezaArs =
      totalCabezasActivas > 0 ? gastoTotalArs / totalCabezasActivas : 0;
    const baseHa = totalHectareas > 0 ? totalHectareas : 2068.06;
    const costoPorHaArs = gastoTotalArs / baseHa;
    const ventasNetasArs = ventas.reduce(
      (acc, v) => acc + (Number(v.ingreso_neto_ars) || 0),
      0
    );
    const ventasNetasUsd = ventas.reduce(
      (acc, v) => acc + (Number(v.ingreso_neto_usd) || (Number(v.ingreso_neto_ars) || 0) / tc),
      0
    );
    const kgVendidos = ventas.reduce(
      (acc, v) => acc + (Number(v.kilos_totales) || Number(v.kg_totales) || Number(v.kilos) || 0),
      0
    );
    const margenArs = ventasNetasArs - gastoTotalArs;
    const margenUsd = ventasNetasUsd - gastoTotalUsd;
    const costoPorHaUsd = gastoTotalUsd / baseHa;

    return {
      gastoTotalArs,
      gastoTotalUsd,
      costoPorCabezaArs,
      costoPorHaArs,
      costoPorHaUsd,
      ventasNetasArs,
      ventasNetasUsd,
      kgVendidos,
      margenArs,
      margenUsd,
      baseHa,
    };
  }, [gastos, laboresSiembras, ventas, dolarRef, totalCabezasActivas, totalHectareas]);

  // Indicadores Macro de Campaña (01/08/2026 → 31/07/2027) calculados automáticamente en vivo desde el sistema
  const macroCampana = useMemo(() => {
    // 1. Vientres reales del establecimiento (planilla de rodeos activa)
    const vientresReales = resumenRodeos.vacas || 978;
    // 2. Terneros al pie reales (suma de terneros machos y hembras en rodeos)
    const ternerosReales = resumenRodeos.terneros || 784;
    // 3. Vientres preñados diagnosticados (campanaKpi o estimado sobre vientres reales)
    const vientresPrenados =
      Number(campanaKpi?.vientres_prenados_tacto) || Math.round(vientresReales * 0.90);
    const pesoDesteteProm = Number(campanaKpi?.peso_destete_prom_kg) || 190;
    const stockInicial =
      Number(campanaKpi?.stock_inicial_cabezas) || totalCabezasActivas || 2024;

    const pctPrenez =
      vientresReales > 0 ? ((vientresPrenados / vientresReales) * 100).toFixed(1) : '0.0';
    const pctDestete =
      vientresReales > 0
        ? ((ternerosReales / vientresReales) * 100).toFixed(1)
        : '0.0';
    const mermaTactoDestete = Math.max(
      0,
      Number(pctPrenez) - Number(pctDestete)
    ).toFixed(1);

    // 4. Bajas por mortandad acumuladas leídas en vivo de movimientos_hacienda
    const bajasMortandadCab = movimientosHacienda
      .filter((m) => {
        const t = String(m.tipo_movimiento || '').toLowerCase();
        return t.includes('mortandad') || t.includes('baja') || t.includes('muerto');
      })
      .reduce((acc, m) => acc + (Number(m.cantidad_cabezas) || 0), 0);

    const baseMortandad = stockInicial > 0 ? stockInicial : totalCabezasActivas || 2024;
    const pctMortandad = ((bajasMortandadCab / baseMortandad) * 100).toFixed(2);

    // 5. Producción en kg de carne por ha (Kg vendidos reales de ventas_hacienda + Kg destete estimado)
    const kgDesteteEstimados = ternerosReales * pesoDesteteProm;
    const kgProducidosTotales = kpiEconomicos.kgVendidos + kgDesteteEstimados;
    const produccionKgHa = (kgProducidosTotales / (kpiEconomicos.baseHa || 2068.1)).toFixed(1);
    const vendidosKgHa = (kpiEconomicos.kgVendidos / (kpiEconomicos.baseHa || 2068.1)).toFixed(1);

    return {
      vientresEntorados: vientresReales,
      vientresPrenados,
      ternerosDestetados: ternerosReales,
      pesoDesteteProm,
      stockInicial,
      pctPrenez,
      pctDestete,
      mermaTactoDestete,
      bajasMortandadCab,
      pctMortandad,
      kgDesteteEstimados,
      kgProducidosTotales,
      produccionKgHa,
      vendidosKgHa,
    };
  }, [
    resumenRodeos,
    totalCabezasActivas,
    movimientosHacienda,
    kpiEconomicos,
    campanaKpi,
  ]);

  // Cálculos dinámicos del Simulador What-If de Proyección (no altera los datos reales)
  const proyeccionSimulador = useMemo(() => {
    const vientresBase = macroCampana.vientresEntorados;
    const pctP = Number(simuladorParams.pctPrenez) || 90;
    const pctD = Number(simuladorParams.pctDestete) || 80;
    const pesoD = Number(simuladorParams.pesoDestete) || 190;
    const precioKg = Number(simuladorParams.precioKgUsd) || 2.20;

    const vientresPrenadosSim = Math.round(vientresBase * (pctP / 100));
    const ternerosDestetadosSim = Math.round(vientresBase * (pctD / 100));
    const kgDesteteSim = ternerosDestetadosSim * pesoD;
    const facturacionUsdSim = kgDesteteSim * precioKg;
    const kgTotalesSim = kpiEconomicos.kgVendidos + kgDesteteSim;
    const kgHaSim = (kgTotalesSim / (kpiEconomicos.baseHa || 2068.1)).toFixed(1);

    return {
      vientresBase,
      vientresPrenadosSim,
      ternerosDestetadosSim,
      kgDesteteSim,
      facturacionUsdSim,
      kgTotalesSim,
      kgHaSim,
    };
  }, [macroCampana.vientresEntorados, simuladorParams, kpiEconomicos]);

  async function handleSaveCampanaKpis(e) {
    e.preventDefault();
    setSavingCampana(true);
    try {
      const payload = {
        vientres_entorados: parseInt(campanaForm.vientres_entorados, 10) || 0,
        vientres_prenados_tacto: parseInt(campanaForm.vientres_prenados_tacto, 10) || 0,
        terneros_destetados: parseInt(campanaForm.terneros_destetados, 10) || 0,
        peso_destete_prom_kg: parseFloat(campanaForm.peso_destete_prom_kg) || 0,
        stock_inicial_cabezas: parseInt(campanaForm.stock_inicial_cabezas, 10) || 2024,
        updated_at: new Date().toISOString(),
      };

      if (campanaKpi?.id) {
        const { error } = await supabase
          .from('campanas_kpis')
          .update(payload)
          .eq('id', campanaKpi.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('campanas_kpis').insert({
          ...payload,
          nombre_campana: 'Campaña 2026/2027 (01/08/2026 – 31/07/2027)',
          fecha_inicio: '2026-08-01',
          fecha_fin: '2027-07-31',
          activa: true,
        });
        if (error) throw error;
      }

      notify('Parámetros Macro de Campaña (Ago 2026 – Jul 2027) actualizados.', 'success');
      setShowEditCampana(false);
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar campaña: ${err.message}`, 'error');
    } finally {
      setSavingCampana(false);
    }
  }

  const totalLluviaCampana = useMemo(() => {
    return registrosLluvias.reduce((acc, r) => acc + (Number(r.milimetros) || 0), 0);
  }, [registrosLluvias]);

  const ultimaLluvia = useMemo(() => {
    if (!registrosLluvias || registrosLluvias.length === 0) return null;
    const sorted = [...registrosLluvias].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return sorted[0];
  }, [registrosLluvias]);

  async function handleSaveLluvia(e) {
    e.preventDefault();
    const mm = parseFloat(nuevaLluvia.milimetros);
    if (isNaN(mm) || mm <= 0) {
      notify?.('Ingresá una cantidad de milímetros válida mayor a 0', 'error');
      return;
    }
    setSavingLluvia(true);
    try {
      const { error } = await supabase.from('registros_lluvias').insert({
        fecha: nuevaLluvia.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
        milimetros: mm,
        pluviometro: nuevaLluvia.pluviometro || 'Casco Principal',
        observaciones: nuevaLluvia.observaciones?.trim() || null,
        campana: '2026/2027',
      });
      if (error) throw error;
      notify?.(`¡Lluvia de ${mm} mm registrada en Supabase!`, 'success');
      setShowNuevaLluviaModal(false);
      setNuevaLluvia({
        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
        milimetros: '',
        pluviometro: 'Casco Principal',
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al registrar lluvia: ${err.message}`, 'error');
    } finally {
      setSavingLluvia(false);
    }
  }

  async function handleSaveEditLluvia(id) {
    const mm = parseFloat(editingLluviaForm.milimetros);
    if (isNaN(mm) || mm <= 0) {
      notify?.('Ingresá una cantidad de milímetros válida mayor a 0', 'error');
      return;
    }
    setSavingHistorialLluvia(true);
    try {
      const { error } = await supabase
        .from('registros_lluvias')
        .update({
          fecha: editingLluviaForm.fecha,
          milimetros: mm,
          pluviometro: editingLluviaForm.pluviometro || 'Casco Principal',
          observaciones: editingLluviaForm.observaciones?.trim() || null,
        })
        .eq('id', id);
      if (error) throw error;
      notify?.(`Registro de lluvia actualizado a ${mm} mm.`, 'success');
      setEditingLluviaId(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al actualizar lluvia: ${err.message}`, 'error');
    } finally {
      setSavingHistorialLluvia(false);
    }
  }

  async function handleDeleteLluvia(record) {
    const ok = await confirmAction({
      title: `¿Eliminar registro de lluvia (${record.milimetros} mm)?`,
      description: `Fecha: ${record.fecha}. El milimetraje se descontará del acumulado del mes.`,
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      const { error } = await supabase
        .from('registros_lluvias')
        .delete()
        .eq('id', record.id);
      if (error) throw error;
      notify?.('Registro de lluvia eliminado.', 'success');
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al eliminar lluvia: ${err.message}`, 'error');
    }
  }

  async function handleCreateQuickTarea(e) {
    e.preventDefault();
    if (!quickTarea.titulo.trim()) {
      notify('Ingresá el título o descripción de la tarea.', 'error');
      return;
    }
    setSavingTarea(true);
    try {
      const { error } = await supabase.from('tareas_campo').insert({
        titulo: quickTarea.titulo.trim(),
        categoria: 'General',
        potrero_numero: quickTarea.potrero_numero
          ? parseInt(quickTarea.potrero_numero, 10)
          : null,
        infraestructura_nombre: quickTarea.infraestructura_nombre.trim() || null,
        responsable: quickTarea.responsable.trim() || null,
        prioridad: quickTarea.prioridad || 'Normal',
        fecha_limite: quickTarea.fecha_limite || null,
        estado: 'Pendiente',
        completada: false,
      });
      if (error) throw error;
      notify('Tarea operativa cargada y lista para imprimir en Hoja de Tareas.', 'success');
      setQuickTarea({
        titulo: '',
        potrero_numero: '',
        infraestructura_nombre: '',
        responsable: '',
        prioridad: 'Alta',
        fecha_limite: fechaOperacion || new Date().toISOString().slice(0, 10),
      });
      setShowQuickTareaForm(false);
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar tarea: ${err.message}`, 'error');
    } finally {
      setSavingTarea(false);
    }
  }

  async function handleToggleQuickTarea(t) {
    try {
      const nextComp = !t.completada;
      const { error } = await supabase
        .from('tareas_campo')
        .update({
          completada: nextComp,
          estado: nextComp ? 'Hecha' : 'Pendiente',
          fecha_completada: nextComp ? fechaOperacion || new Date().toISOString().slice(0, 10) : null,
        })
        .eq('id', t.id);
      if (error) throw error;
      await onRefresh();
    } catch (err) {
      notify(`Error al actualizar tarea: ${err.message}`, 'error');
    }
  }

  // Desglose por Categoría desde Planilla Maestra de Rodeos (15 rodeos = 2.024 cab. conciliadas)
  const resumenCategorias = useMemo(() => {
    if (rodeos.length > 0) {
      const totalTerneros = resumenRodeos.terneros;
      const totalMachos = resumenRodeos.terneros_machos;
      const totalHembras = resumenRodeos.terneros_hembras;
      const sexLabel =
        totalMachos > 0 || totalHembras > 0
          ? ` (${totalMachos} Machos · ${totalHembras} Hembras sexados)`
          : '';

      const sums = [
        {
          categoria: 'Vacas de Cría',
          cantidad: resumenRodeos.vacas,
        },
        {
          categoria: `Terneros Unificados${sexLabel}`,
          cantidad: totalTerneros,
        },
        {
          categoria: 'Vaquillonas de Reposición',
          cantidad: resumenRodeos.vaquillonas_reposicion,
        },
        {
          categoria: 'Toros Padres y Toritos',
          cantidad: resumenRodeos.toros_padres + resumenRodeos.toritos,
        },
        {
          categoria: 'Vacas CUT',
          cantidad: resumenRodeos.vacas_cut,
        },
      ].filter((x) => x.cantidad > 0);

      return sums
        .map((x) => ({
          ...x,
          porcentaje:
            totalCabezasActivas > 0
              ? Math.round((x.cantidad / totalCabezasActivas) * 1000) / 10
              : 0,
        }))
        .sort((a, b) => b.cantidad - a.cantidad);
    }

    const counts = {};
    animalesActivos.forEach((a) => {
      const cat = a.categoria || 'Vaca / Sin categoría';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([categoria, cantidad]) => ({
        categoria,
        cantidad,
        porcentaje:
          totalCabezasActivas > 0
            ? Math.round((cantidad / totalCabezasActivas) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [rodeos, animalesActivos, totalCabezasActivas]);

  // Desglose de Hectáreas por Ambiente
  const resumenAmbientes = useMemo(() => {
    const map = {};
    potreros.forEach((p) => {
      const amb = p.ambiente || 'Bajo Dulce';
      map[amb] = (map[amb] || 0) + (Number(p.hectareas) || 0);
    });
    return Object.entries(map)
      .map(([ambiente, ha]) => ({
        ambiente,
        ha: Math.round(ha * 10) / 10,
        pct: totalHectareas > 0 ? Math.round((ha / totalHectareas) * 100) : 0,
      }))
      .sort((a, b) => b.ha - a.ha);
  }, [potreros, totalHectareas]);

  // Rodeos actualmente pastoreando con potrero asignado, carga y permanencia
  const rodeosPastoreando = useMemo(() => {
    return (rodeos || [])
      .filter((r) => r.potrero_numero != null && r.potrero_numero !== '' && calcRodeoHeads(r) > 0)
      .map((r) => {
        const potObj = potreros.find((p) => Number(p.numero) === Number(r.potrero_numero));
        const haPotrero = potObj ? (parseFloat(String(potObj.hectareas).replace(',', '.')) || 0) : 0;
        const cabezas = calcRodeoHeads(r);
        const carga = haPotrero > 0 ? (cabezas / haPotrero).toFixed(2) : '-';
        const perm = calcPermanenciaPotrero(r, fechaOperacion);
        const diasActuales = perm?.dias ?? 0;
        const diasMeta = Number(r.dias_estimados_pastoreo) || perm?.diasEstimados || 30;
        const superoMeta = diasActuales >= diasMeta;
        const alertaCambio = diasActuales >= 30 || superoMeta;
        const pctProgreso = Math.min(100, Math.round((diasActuales / diasMeta) * 100));

        return {
          ...r,
          potreroNombre: potObj?.nombre || `Potrero #${r.potrero_numero}`,
          haPotrero,
          cabezas,
          carga,
          diasActuales,
          diasMeta,
          superoMeta,
          alertaCambio,
          pctProgreso,
        };
      })
      .sort((a, b) => b.diasActuales - a.diasActuales);
  }, [rodeos, potreros, fechaOperacion]);

  const infraList = infraestructura.length > 0 ? infraestructura : molinos;
  const infraOperativa = infraList.filter(
    (m) => (m.estado || 'Operativo') === 'Operativo'
  ).length;
  const infraEnAlerta = infraList.filter(
    (m) => (m.estado || 'Operativo') !== 'Operativo'
  );

  // Auditor de Salud de Datos: monitoreo proactivo de lluvias, condición corporal, pasturas y aguadas
  const alertasSalud = useMemo(() => {
    const list = [];
    const now = new Date();
    const mesActual = now.getMonth();
    const anioActual = now.getFullYear();
    const lluviasMes = registrosLluvias.filter((r) => {
      if (!r.fecha) return false;
      const d = new Date(r.fecha + 'T12:00:00');
      return d.getMonth() === mesActual && d.getFullYear() === anioActual;
    });

    if (lluviasMes.length === 0) {
      list.push({
        id: 'lluvia-mes',
        tipo: 'pluvio',
        titulo: 'Pluviometría mensual pendiente',
        desc: 'Sin registros de lluvia en el mes actual.',
        accion: '+ Anotar Lluvia',
        onClick: () => setShowNuevaLluviaModal(true),
        severity: 'warning',
        tag: 'Lluvias',
      });
    }

    const rodeosSinCC = rodeos.filter(
      (r) => !r.condicion_corporal || Number(r.condicion_corporal) <= 0
    );
    const rodeosCCBaja = rodeos.filter(
      (r) => Number(r.condicion_corporal) > 0 && Number(r.condicion_corporal) <= 2.5
    );

    if (rodeosCCBaja.length > 0) {
      list.push({
        id: 'cc-baja',
        tipo: 'cc',
        titulo: `${rodeosCCBaja.length} rodeo(s) con CC baja (≤ 2.5 ★)`,
        desc: 'Priorizar suplementación o pasturas de mejor calidad.',
        accion: 'Ver Rodeos',
        onClick: () => onNavigate('rodeos'),
        severity: 'alert',
        tag: 'Condición Corporal',
      });
    } else if (rodeosSinCC.length > 0) {
      list.push({
        id: 'cc-pendiente',
        tipo: 'cc',
        titulo: `${rodeosSinCC.length} rodeo(s) sin evaluar CC`,
        desc: 'Asignar condición corporal de 1 a 5 estrellas.',
        accion: 'Calificar',
        onClick: () => onNavigate('rodeos'),
        severity: 'info',
        tag: 'Condición Corporal',
      });
    }

    const potrerosSinRec = potreros.filter(
      (p) => !p.receptividad_ev_ha && p.receptividad_ev_ha !== 0
    );
    if (potrerosSinRec.length > 0) {
      list.push({
        id: 'potreros-rec',
        tipo: 'forraje',
        titulo: `${potrerosSinRec.length} potreros sin receptividad relevada`,
        desc: 'Valor base asignado: 0.90 EV/ha.',
        accion: 'Ver Potreros',
        onClick: () => onNavigate('mapa'),
        severity: 'info',
        tag: 'Forraje',
      });
    }

    if (infraEnAlerta.length > 0) {
      list.push({
        id: 'infra-alertas',
        tipo: 'infra',
        titulo: `${infraEnAlerta.length} aguada(s) / molinos a revisar`,
        desc: infraEnAlerta.map((i) => i.nombre || `M${i.numero}`).slice(0, 3).join(', '),
        accion: 'Revisar',
        onClick: () => setTabInferior('aguadas'),
        severity: 'warning',
        tag: 'Aguadas',
      });
    }

    return list;
  }, [registrosLluvias, rodeos, potreros, infraEnAlerta, onNavigate]);

  function formatRelativeDate(targetDateStr, todayStr) {
    if (!targetDateStr) return 'Próximamente';
    if (targetDateStr === todayStr) return '¡Hoy!';
    const dTarget = new Date(`${targetDateStr}T00:00:00`);
    const dToday = new Date(`${todayStr}T00:00:00`);
    const diffDays = Math.round((dTarget - dToday) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'Mañana';
    if (diffDays === -1) return 'Ayer';
    if (diffDays < -1) return `Venció hace ${Math.abs(diffDays)}d`;
    if (diffDays <= 7) return `En ${diffDays} días`;
    if (diffDays <= 30) return `En ~${Math.round(diffDays / 7)} sem`;
    const parts = targetDateStr.split('-');
    if (parts.length >= 3) return `${parts[2]}/${parts[1]}`;
    return targetDateStr;
  }

  // 1. Próximos Vencimientos Sanitarios & Reproductivos (Próximos 45 días)
  const proximosHitos = useMemo(() => {
    const combined = [];

    // Hitos del cronograma oficial San José 2026
    (CRONOGRAMA_SAN_JOSE_2026 || []).forEach((c) => {
      const isDone =
        c.realizado ||
        eventosSanitarios.some(
          (e) =>
            (e.id_protocolo === c.orden ||
              e.titulo?.toLowerCase() === c.nombre_protocolo?.toLowerCase()) &&
            e.realizado
        );
      if (!isDone) {
        combined.push({
          id: `crono_${c.orden}`,
          titulo: c.nombre_protocolo || 'Protocolo Sanitario',
          tipo: c.tipo || 'Sanidad',
          fecha: c.fecha_programada || '2026-12-01',
          rodeo: c.rodeo_aplicado || c.categoria_destino || 'Todos los rodeos',
          dosis: c.dosis_via || '',
          observaciones: c.observaciones || '',
          colorCategory: c.tipo === 'Manejo Reproductivo' ? 'reproductivo' : 'sanitario',
        });
      }
    });

    // Eventos sanitarios programados en base de datos
    (eventosSanitarios || []).forEach((e) => {
      if (!e.realizado && e.fecha_programada) {
        if (!combined.some((c) => c.titulo?.toLowerCase() === e.titulo?.toLowerCase())) {
          combined.push({
            id: `ev_${e.id}`,
            titulo: e.nombre_protocolo || e.titulo || 'Tratamiento Sanitario',
            tipo: e.tipo || 'Sanidad',
            fecha: e.fecha_programada,
            rodeo: e.rodeo_aplicado || e.rodeo_nombre || e.categoria_destino || 'Todos los rodeos',
            dosis: e.dosis || '',
            observaciones: e.observaciones || '',
            colorCategory: e.tipo === 'Manejo Reproductivo' ? 'reproductivo' : 'sanitario',
          });
        }
      }
    });

    combined.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return combined.slice(0, 4);
  }, [eventosSanitarios]);

  // 2. Tareas Urgentes y Vencidas
  const tareasUrgentesVencidas = useMemo(() => {
    const today = fechaOperacion || new Date().toISOString().slice(0, 10);
    const urgentes = (tareas || []).filter((t) => {
      if (t.completada) return false;
      const esUrgente = t.prioridad === 'Urgente' || t.prioridad === 'Alta';
      const esVencida = t.fecha_limite && t.fecha_limite <= today;
      return esUrgente || esVencida;
    });

    urgentes.sort((a, b) => {
      const aVencida = a.fecha_limite && a.fecha_limite <= today ? 1 : 0;
      const bVencida = b.fecha_limite && b.fecha_limite <= today ? 1 : 0;
      if (bVencida !== aVencida) return bVencida - aVencida;
      const aPrio = a.prioridad === 'Urgente' ? 3 : a.prioridad === 'Alta' ? 2 : 1;
      const bPrio = b.prioridad === 'Urgente' ? 3 : b.prioridad === 'Alta' ? 2 : 1;
      return bPrio - aPrio;
    });

    return urgentes.slice(0, 4);
  }, [tareas, fechaOperacion]);

  async function handleQuickInfraStatus(item, nuevoEstado) {
    setUpdatingMolinoId(item.id);
    try {
      if (infraestructura.length > 0) {
        const { error } = await supabase
          .from('infraestructura')
          .update({ estado: nuevoEstado })
          .eq('id', item.id);
        if (error) throw error;
        if (item.molino_id_ref) {
          await supabase
            .from('molinos')
            .update({ estado: nuevoEstado })
            .eq('numero', item.molino_id_ref);
        }
      } else {
        const { error } = await supabase
          .from('molinos')
          .update({ estado: nuevoEstado })
          .eq('id', item.id);
        if (error) throw error;
      }
      notify(`${item.nombre} actualizado a "${nuevoEstado}".`, 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error al actualizar: ${err.message}`, 'error');
    } finally {
      setUpdatingMolinoId(null);
    }
  }

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* Encabezado Ejecutivo del Tablero */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-900/10 text-emerald-900 text-xs font-bold mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-700 animate-pulse" />
            Resumen Ejecutivo en Tiempo Real · Las Flores, Bs. As.
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Tablero de Control — Establecimiento San José
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Estado patrimonial de superficie, {rodeos.length} rodeos activos, calendario sanitario,
            infraestructura y labores agrícolas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 text-slate-800 text-xs font-black border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
            Campaña 2026/2027
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-900 text-xs font-bold border border-emerald-200/80">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Operaciones al día</span>
          </div>
        </div>
      </div>

      {/* BARRA DE AVISOS OPERATIVOS ACTIVOS (POST-ITS EN MAPA, TAREAS PENDIENTES, ENTREGAS/SERVICIOS ESPERADOS) */}
      {(infraEnAlerta.length > 0 ||
        alertasActivas.length > 0 ||
        tareasPendientes.length > 0 ||
        proveedoresEsperadosPendientes.length > 0) && (
        <div className="bg-amber-50/90 border border-amber-300/90 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-black text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Avisos operativos activos:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {infraEnAlerta.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (onSelectInfraInMap) {
                    onSelectInfraInMap(infraEnAlerta[0]);
                  } else {
                    onNavigate('mapa');
                  }
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Droplets className="w-3.5 h-3.5 text-amber-700" />
                <span>{infraEnAlerta.length} aguada(s) a revisar</span>
              </button>
            )}
            {alertasActivas.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('mapa')}
                className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <StickyNote className="w-3.5 h-3.5 text-amber-700" />
                <span>{alertasActivas.length} post-it(s) en mapa</span>
              </button>
            )}
            {tareasPendientes.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('tareas')}
                className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <ClipboardList className="w-3.5 h-3.5 text-amber-700" />
                <span>{tareasPendientes.length} tarea(s) pendiente(s)</span>
              </button>
            )}
            {proveedoresEsperadosPendientes.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('calendario')}
                className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                title="Ver entregas y servicios de logística esperados en el calendario"
              >
                <Truck className="w-3.5 h-3.5 text-amber-700" />
                <span>{proveedoresEsperadosPendientes.length} entrega(s) / servicio(s) esperado(s)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* BANNER / TARJETA DESTACADA DE HOJA DE RUTA ACTIVA DEL DÍA */}
      {activeCuadrillaRoute && (
        <div
          className={`p-4 sm:p-5 rounded-2xl shadow-sm border flex flex-col md:flex-row md:items-center justify-between gap-4 transition ${
            activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
              ? 'bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white border-emerald-500/30'
              : 'bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 text-white border-amber-500/30'
          }`}
        >
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}
            >
              {activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA' ? (
                <Compass className="w-5 h-5" />
              ) : (
                <Truck className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                      ? 'bg-emerald-400 text-slate-950'
                      : 'bg-amber-400 text-slate-950'
                  }`}
                >
                  {activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                    ? 'Circuito Ganadero Activo'
                    : 'Plan Cuadrilla Activo'}
                </span>
                <span className="text-xs text-slate-300 font-medium">
                  Salida: {activeCuadrillaRoute.inicio_recomendado || 'Casco Central'} · ⏱️ {activeCuadrillaRoute.tiempo_total_estimado}
                  {activeCuadrillaRoute.distancia_total_km ? ` · 📏 ${activeCuadrillaRoute.distancia_total_km} km` : ''}
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-extrabold text-white mt-1 leading-snug">
                {activeCuadrillaRoute.resumen_operativo || (activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA' ? 'Recorrida y chequeo de rodeo general' : 'Trabajos de mantenimiento e infraestructura')}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {activeCuadrillaRoute.paradas?.length || 0} paradas planificadas · {activeCuadrillaRoute.checkedItems?.length || 0} paradas/tareas marcadas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => onOpenCuadrilla && onOpenCuadrilla(activeCuadrillaRoute, 'hoja')}
              className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md transition active:scale-95 ${
                activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                  ? 'bg-emerald-400 hover:bg-emerald-500 text-slate-950'
                  : 'bg-amber-400 hover:bg-amber-500 text-slate-950'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              <span>📋 Ver Hoja</span>
            </button>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('mapa')}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 border border-white/10 transition"
              >
                <MapPin className="w-4 h-4" />
                <span>Ver en Mapa</span>
              </button>
            )}
            {onClearCuadrillaRoute && (
              <button
                type="button"
                onClick={onClearCuadrillaRoute}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition"
                title="Cerrar y archivar ruta"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* PANEL EJECUTIVO ACCIONABLE: PRÓXIMOS HITOS Y TAREAS (2 COLUMNAS AMPLIAS) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CARD 1: PRÓXIMOS VENCIMIENTOS SANITARIOS & REPRODUCTIVOS */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center shrink-0">
                  <Syringe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Vencimientos Sanitarios & Reprod.</h3>
                  <p className="text-[11px] text-slate-500">Próximos en el calendario 2026</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                {proximosHitos.length}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {proximosHitos.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-600 font-medium italic bg-slate-50 rounded-xl">
                  Al día · Sin vencimientos sanitarios inmediatos
                </div>
              ) : (
                proximosHitos.map((h) => {
                  const rel = formatRelativeDate(h.fecha, fechaOperacion || new Date().toISOString().slice(0, 10));
                  const isReprod = h.colorCategory === 'reproductivo';
                  return (
                    <div
                      key={h.id}
                      onClick={() => {
                        onNavigate?.('calendario', {
                          date: h.fecha,
                          search: h.titulo,
                          eventoId: h.id,
                        });
                      }}
                      className="p-2.5 rounded-xl border border-slate-100 hover:border-amber-300 bg-slate-50/70 hover:bg-white transition flex items-start justify-between gap-2 cursor-pointer group shadow-2xs"
                      title="Clic para abrir directamente en Calendario"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                            isReprod ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                          }`}>
                            {isReprod ? 'Manejo Repr.' : 'Sanidad'}
                          </span>
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {h.titulo}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 truncate">
                          {h.rodeo} {h.dosis ? `· ${h.dosis}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right flex flex-col items-end gap-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10.5px] font-bold text-slate-700">
                          {rel}
                        </span>
                        <span className="text-[10px] text-amber-700 font-bold opacity-0 group-hover:opacity-100 transition">
                          Abrir →
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('calendario')}
            className="mt-3 w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 transition cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>Ver Agenda Sanitaria Completa →</span>
          </button>
        </div>

        {/* CARD 2: TAREAS URGENTES Y VENCIDAS (CON CHECKBOX ACCIONABLE) */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-700 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Tareas Urgentes & Vencidas</h3>
                  <p className="text-[11px] text-slate-500">Acción requerida a campo</p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                tareasUrgentesVencidas.length > 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
              }`}>
                {tareasUrgentesVencidas.length}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {tareasUrgentesVencidas.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-600 font-medium italic bg-slate-50 rounded-xl">
                  Sin tareas urgentes vencidas ni prioritarias
                </div>
              ) : (
                tareasUrgentesVencidas.map((t) => {
                  const today = fechaOperacion || new Date().toISOString().slice(0, 10);
                  const isOverdue = t.fecha_limite && t.fecha_limite < today;
                  const rel = formatRelativeDate(t.fecha_limite, today);
                  return (
                    <div
                      key={t.id}
                      onClick={() => onNavigate?.('tareas', { tareaId: t.id, action: 'edit' })}
                      className="p-2.5 rounded-xl border border-slate-100 hover:border-purple-300 bg-slate-50/70 hover:bg-white transition flex items-start gap-2.5 cursor-pointer group shadow-2xs"
                      title="Clic para abrir ficha completa en Tareas"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleQuickTarea(t);
                        }}
                        title="Tildar como completada"
                        className="mt-0.5 w-5 h-5 rounded-md border-2 border-slate-300 hover:border-emerald-600 hover:bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 transition cursor-pointer"
                      >
                        {t.completada && <CheckCircle2 className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                            t.prioridad === 'Urgente'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {t.prioridad || 'Alta'}
                          </span>
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {t.titulo}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 truncate">
                          {t.potrero_numero ? `Potrero #${t.potrero_numero}` : ''}
                          {t.infraestructura_nombre ? ` · ${t.infraestructura_nombre}` : ''}
                          {t.responsable ? ` (${t.responsable})` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right flex flex-col items-end gap-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isOverdue ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-white border border-slate-200 text-slate-600'
                        }`}>
                          {rel}
                        </span>
                        <span className="text-[10px] text-purple-700 font-bold opacity-0 group-hover:opacity-100 transition">
                          Abrir →
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('tareas')}
            className="mt-3 w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 transition cursor-pointer"
          >
            <ClipboardList className="w-3.5 h-3.5 text-slate-500" />
            <span>Ver Todas las Tareas de Campo →</span>
          </button>
        </div>


      </div>

      {/* 4 Tarjetas KPI Principales del Negocio */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total Hectáreas */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Hectáreas Totales GIS
              </span>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1 tabular-nums">
                {totalHectareas.toLocaleString('es-AR', { maximumFractionDigits: 1 })} ha
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-900/10 text-emerald-900">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              <strong>{potreros.length}</strong> potreros medidos
            </span>
            <span className="text-emerald-800 font-semibold">25% Loma · 75% Bajo</span>
          </div>
        </div>

        {/* KPI 2: Cabezas Activas en Campo (2.024 cab.) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Cabezas Activas
              </span>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1 tabular-nums">
                {totalCabezasActivas.toLocaleString('es-AR')} cab.
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-900/10 text-emerald-900">
              <Tags className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              <strong>{rodeos.length} rodeos</strong> (978 vacas · 784 tern.)
            </span>
            <span className="font-semibold text-slate-800">
              {animalesActivos.length} caravanas
            </span>
          </div>
        </div>

        {/* KPI 3: Carga Global (cab/ha) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Carga Global Actual
              </span>
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-900 mt-1 tabular-nums">
                {cargaGlobal} <span className="text-base font-bold text-slate-600">cab/ha</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-900/10 text-emerald-900">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              Potreros con rodeo: <strong>{potrerosConHacienda.size}</strong>
            </span>
            <span>
              {haOcupadas > 0
                ? `${haOcupadas.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ha en pastoreo`
                : 'Sin asignar lote'}
            </span>
          </div>
        </div>

        {/* KPI 4: Costo / Resultado Operativo (en Admin) o Infraestructura Operativa (en Producción) */}
        {appMode !== 'produccion' ? (
          <div
            onClick={() => onNavigate('costos')}
            className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between cursor-pointer hover:border-emerald-300 transition"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Costo / Resultado Operativo
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1 tabular-nums">
                  US$ {kpiEconomicos.gastoTotalUsd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 text-amber-800">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 tabular-nums">
              <span>
                <strong>
                  ${kpiEconomicos.costoPorCabezaArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </strong>
                /cab
              </span>
              <span className="text-emerald-800 font-bold">
                ${kpiEconomicos.costoPorHaArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}/ha
              </span>
            </div>
          </div>
        ) : (
          <div
            onClick={() => onNavigate('rodeos')}
            className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between cursor-pointer hover:border-emerald-300 transition"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Carga Animal Global
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1 tabular-nums">
                  {cargaGlobal} <span className="text-sm font-bold text-emerald-800">cab/ha</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-800">
                <Activity className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>
                Al pie:{' '}
                <strong className="text-emerald-800">
                  {((resumenRodeos.terneros / (resumenRodeos.vacas || 1)) * 100).toFixed(1)}%
                </strong>{' '}
                ternero/vaca
              </span>
              <span className="text-emerald-800 font-bold hover:underline">Ver Rodeos →</span>
            </div>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* WIDGET OPERATIVO: REGISTRO DE LLUVIAS (PLUVIOMETRÍA REAL Y EDITABLE) */}
      {/* ==================================================================== */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 border border-slate-700 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-blue-500/20 text-blue-300 border border-blue-400/30">
              <CloudRain className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-300 bg-blue-900/60 px-2.5 py-0.5 rounded-full border border-blue-700/50">
                  Pluviometría San José
                </span>
                <span className="text-[11px] text-slate-300">Campaña 2026/2027</span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-white">{totalLluviaCampana} mm</span>
                <span className="text-xs text-slate-300">acumulados</span>
                {ultimaLluvia ? (
                  <span className="text-xs text-blue-200 ml-2">
                    · Última lluvia: <strong>{ultimaLluvia.milimetros} mm</strong> ({new Date(ultimaLluvia.fecha + 'T12:00:00').toLocaleDateString('es-AR')})
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 ml-2">
                    · Sin lluvias registradas
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Botón Ver / Editar Historial */}
            <button
              type="button"
              onClick={() => setShowHistorialLluviasModal(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-200 hover:text-white text-xs font-extrabold flex items-center gap-1.5 border border-slate-600 shadow-sm transition"
            >
              <ClipboardList className="w-4 h-4 text-blue-400" />
              Ver / Editar Historial
            </button>

            {/* Botón Anotar Lluvia */}
            <button
              type="button"
              onClick={() => setShowNuevaLluviaModal(true)}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              + Anotar Lluvia
            </button>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* BLOQUE 1: INDICADORES MACRO DE CAMPAÑA (1° AGOSTO 2026 → 31 JULIO 2027) */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-950 text-emerald-300 shadow-sm">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200 text-[10px] font-extrabold uppercase tracking-wider">
                  Ejercicio Ganadero 01/08/2026 – 31/07/2027
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-0.5">
                Indicadores Macro de Campaña (Ago 2026 – Jul 2027)
              </h3>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSimulador(!showSimulador)}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold flex items-center gap-1.5 transition"
            >
              <Settings className="w-3.5 h-3.5 text-emerald-800" />
              {showSimulador ? 'Ocultar Simulador' : '🔮 Simulador de Proyección'}
            </button>
            {appMode !== 'produccion' && (
              <button
                type="button"
                onClick={() => onNavigate('costos')}
                className="px-3.5 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition"
              >
                Abrir Costos & Finanzas
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Panel desplegable: SIMULADOR WHAT-IF DE PROYECCIÓN GANADERA */}
        {showSimulador && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-purple-50 via-indigo-50/50 to-emerald-50/60 border-2 border-purple-300 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-purple-200">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-purple-600 text-white">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <span className="text-xs font-black text-purple-950 uppercase tracking-wide">
                    🔮 SIMULADOR WHAT-IF — Proyección de Campaña
                  </span>
                  <p className="text-[11px] font-bold text-purple-700">
                    Etiqueta visible: <span className="bg-purple-200/80 px-1.5 py-0.2 rounded text-[10px] text-purple-950 font-black">SIMULACIÓN — No modifica los datos reales del campo</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSimuladorParams({
                    pctPrenez: 90,
                    pctDestete: 80,
                    pesoDestete: 190,
                    precioKgUsd: 2.20,
                  })
                }
                className="px-2.5 py-1 rounded-lg bg-white border border-purple-200 hover:bg-purple-100 text-purple-900 text-xs font-bold transition cursor-pointer"
              >
                Restablecer Valores Base
              </button>
            </div>

            {/* Controles de Parámetros de Simulación */}
            <div className={`grid gap-3 ${appMode === 'produccion' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
              <div>
                <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                  % Preñez Esperado
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="50"
                    max="100"
                    step="0.5"
                    value={simuladorParams.pctPrenez}
                    onChange={(e) =>
                      setSimuladorParams({ ...simuladorParams, pctPrenez: e.target.value })
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-purple-200 bg-white text-xs font-black text-slate-900"
                  />
                  <span className="text-xs font-bold text-slate-500">%</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                  % Destete / Marcación
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="40"
                    max="100"
                    step="0.5"
                    value={simuladorParams.pctDestete}
                    onChange={(e) =>
                      setSimuladorParams({ ...simuladorParams, pctDestete: e.target.value })
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-purple-200 bg-white text-xs font-black text-slate-900"
                  />
                  <span className="text-xs font-bold text-slate-500">%</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                  Peso Prom. Destete (kg)
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="120"
                    max="280"
                    step="1"
                    value={simuladorParams.pesoDestete}
                    onChange={(e) =>
                      setSimuladorParams({ ...simuladorParams, pesoDestete: e.target.value })
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-purple-200 bg-white text-xs font-black text-slate-900"
                  />
                  <span className="text-xs font-bold text-slate-500">kg</span>
                </div>
              </div>

              {appMode !== 'produccion' && (
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Precio Ternero Venta (USD/kg)
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1.0"
                      max="5.0"
                      step="0.05"
                      value={simuladorParams.precioKgUsd}
                      onChange={(e) =>
                        setSimuladorParams({ ...simuladorParams, precioKgUsd: e.target.value })
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-purple-200 bg-white text-xs font-black text-slate-900"
                    />
                    <span className="text-xs font-bold text-slate-500">USD</span>
                  </div>
                </div>
              )}
            </div>

            {/* Resultados de la Simulación en Tiempo Real */}
            <div className={`grid gap-3 pt-2 ${appMode === 'produccion' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
              <div className="p-3 rounded-xl bg-white/90 border border-purple-200/80 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase text-purple-900 block">
                  Terneros Logrados
                </span>
                <span className="text-xl font-black text-slate-900 tabular-nums">
                  {proyeccionSimulador.ternerosDestetadosSim.toLocaleString('es-AR')}{' '}
                  <span className="text-xs font-bold text-purple-700">cab.</span>
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  Sobre {proyeccionSimulador.vientresBase} vientres reales
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white/90 border border-purple-200/80 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase text-purple-900 block">
                  Kg Totales Destete
                </span>
                <span className="text-xl font-black text-emerald-900 tabular-nums">
                  {proyeccionSimulador.kgDesteteSim.toLocaleString('es-AR')}{' '}
                  <span className="text-xs font-bold text-emerald-700">kg</span>
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  A {simuladorParams.pesoDestete} kg promedio
                </span>
              </div>

              {appMode !== 'produccion' && (
                <div className="p-3 rounded-xl bg-white/90 border border-purple-200/80 shadow-2xs">
                  <span className="text-[10px] font-extrabold uppercase text-purple-900 block">
                    Ingreso Bruto Terneros
                  </span>
                  <span className="text-xl font-black text-slate-900 tabular-nums">
                    US$ {proyeccionSimulador.facturacionUsdSim.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    A US$ {simuladorParams.precioKgUsd}/kg en pie
                  </span>
                </div>
              )}

              <div className="p-3 rounded-xl bg-white/90 border border-purple-200/80 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase text-purple-900 block">
                  Prod. Estimada Total
                </span>
                <span className="text-xl font-black text-emerald-900 tabular-nums">
                  {proyeccionSimulador.kgHaSim}{' '}
                  <span className="text-xs font-bold text-emerald-700">kg/ha</span>
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  Ventas reales + destete est.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 4 Tarjetas Ejecutivas de Indicadores Macro de Campaña */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* 1. % Preñez (Tacto) y % Destete / Natalidad */}
          <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                Eficiencia Reproductiva (Cría)
              </div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <div>
                  <span className="text-xl font-black text-emerald-900">
                    {macroCampana.pctPrenez}%
                  </span>
                  <span className="block text-[10px] font-bold text-slate-500">
                    % Preñez (Tacto)
                  </span>
                </div>
                <div className="h-7 w-px bg-slate-200" />
                <div>
                  <span className="text-xl font-black text-sky-900">
                    {macroCampana.pctDestete}%
                  </span>
                  <span className="block text-[10px] font-bold text-slate-500">
                    % Destete / Natalidad
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between">
              <span>
                Vientres: <strong>{macroCampana.vientresEntorados}</strong> ({macroCampana.vientresPrenados} preñ.)
              </span>
              <span className="font-bold text-emerald-800">
                {macroCampana.ternerosDestetados} tern.
              </span>
            </div>
          </div>

          {/* 2. % Mortandad Acumulada */}
          <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                % Mortandad Acumulada
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1.5">
                {macroCampana.pctMortandad}%{' '}
                <span className="text-xs font-bold text-slate-500">
                  ({macroCampana.bajasMortandadCab} bajas)
                </span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between">
              <span>
                Base stock: <strong>{macroCampana.stockInicial.toLocaleString('es-AR')} cab.</strong>
              </span>
              <span
                className={`font-bold ${
                  Number(macroCampana.pctMortandad) <= 2
                    ? 'text-emerald-800'
                    : 'text-red-700'
                }`}
              >
                {Number(macroCampana.pctMortandad) <= 2 ? 'Bajo control (<2%)' : 'Atención sanitaria'}
              </span>
            </div>
          </div>

          {/* 3. Kg Vendidos y Producción Estimada (kg/ha) */}
          <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                Kg Vendidos & Producción (kg/ha)
              </div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <div>
                  <span className="text-xl font-black text-emerald-900">
                    {macroCampana.produccionKgHa} kg/ha
                  </span>
                  <span className="block text-[10px] font-bold text-slate-500">
                    Prod. Estimada Total
                  </span>
                </div>
                <div className="h-7 w-px bg-slate-200" />
                <div>
                  <span className="text-base font-black text-slate-800">
                    {kpiEconomicos.kgVendidos.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    kg
                  </span>
                  <span className="block text-[10px] font-bold text-slate-500">
                    Kg Vendidos ({macroCampana.vendidosKgHa} kg/ha)
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between">
              <span>
                Destete est.:{' '}
                <strong>
                  {macroCampana.kgDesteteEstimados.toLocaleString('es-AR')} kg
                </strong>
              </span>
              <span className="font-bold text-slate-700">
                Prom. {macroCampana.pesoDesteteProm} kg/tern.
              </span>
            </div>
          </div>

          {/* 4. Gasto Acumulado (Modo Admin) o Carga Animal Técnica (Modo Producción) */}
          {appMode !== 'produccion' ? (
            <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 flex flex-col justify-between">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-900">
                  Gasto Campaña · USD/ha · Margen Neto
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <div>
                    <span className="text-lg font-black text-slate-900">
                      US${' '}
                    {kpiEconomicos.gastoTotalUsd.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}
                  </span>
                  <span className="block text-[10px] font-bold text-slate-500">
                    Gasto Acum. ($
                    {kpiEconomicos.gastoTotalArs.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}
                    )
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-black text-emerald-900">
                    US$ {kpiEconomicos.costoPorHaUsd.toFixed(2)}/ha
                  </span>
                  <span className="block text-[10px] font-bold text-emerald-800">
                    Costo por Hectárea
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-emerald-200/80 text-[11px] flex items-center justify-between">
              <span className="font-bold text-slate-700">Margen Neto Operativo:</span>
              <span
                className={`font-black ${
                  kpiEconomicos.margenUsd >= 0 ? 'text-emerald-900' : 'text-amber-900'
                }`}
              >
                {kpiEconomicos.margenUsd >= 0 ? '+' : '-'}US${' '}
                {Math.abs(kpiEconomicos.margenUsd).toLocaleString('es-AR', {
                  maximumFractionDigits: 0,
                })}{' '}
                ($
                {Math.abs(kpiEconomicos.margenArs).toLocaleString('es-AR', {
                  maximumFractionDigits: 0,
                })}
                )
              </span>
            </div>
          </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 flex flex-col justify-between">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  Carga Animal & Eficiencia Técnica
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <div>
                    <span className="text-xl font-black text-slate-900">
                      {(totalCabezasActivas / (totalHectareas || 1)).toFixed(2)} cab/ha
                    </span>
                    <span className="block text-[10px] font-bold text-slate-500">
                      Carga Animal Global
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-emerald-900">
                      {((resumenRodeos.terneros / (resumenRodeos.vacas || 1)) * 100).toFixed(1)}%
                    </span>
                    <span className="block text-[10px] font-bold text-emerald-800">
                      Relación Ternero / Vaca
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between">
                <span>
                  Stock activo: <strong>{totalCabezasActivas.toLocaleString('es-AR')} cab.</strong>
                </span>
                <span className="font-bold text-slate-700">
                  {totalHectareas.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ha totales
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* BLOQUE 2: GESTOR DE TAREAS SEMANAL / MENSUAL + HOJA DE TRABAJO PDF   */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100 text-amber-900">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Tareas Operativas ({tareasPendientes.length} pendientes)
              </h3>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQuickTareaForm(!showQuickTareaForm)}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold flex items-center gap-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-800" />
              {showQuickTareaForm ? 'Cerrar Carga' : '+ Cargar Tarea para Personal'}
            </button>
            <button
              type="button"
              onClick={() =>
                exportarHojaTareasPDF(tareasPendientes.length > 0 ? tareasPendientes : tareas, {
                  periodoLabel: 'Planilla Semanal / Mensual de Campo',
                  fechaOperacion,
                  notify,
                })
              }
              className="px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center gap-2 shadow-sm transition"
            >
              <FileDown className="w-4 h-4 text-emerald-300" />
              Exportar Hoja de Tareas (PDF)
            </button>
          </div>
        </div>

        {showQuickTareaForm && (
          <form
            onSubmit={handleCreateQuickTarea}
            className="p-4 rounded-xl bg-amber-50/70 border border-amber-300 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end"
          >
            <div className="lg:col-span-4">
              <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                Título / Descripción Operativa *
              </label>
              <input
                type="text"
                required
                placeholder="Ej: Revisar chupón Molino 3 / Arreglar varillas P16..."
                value={quickTarea.titulo}
                onChange={(e) => setQuickTarea({ ...quickTarea, titulo: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                Potrero / Ubicación
              </label>
              <select
                value={quickTarea.potrero_numero}
                onChange={(e) =>
                  setQuickTarea({ ...quickTarea, potrero_numero: e.target.value })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
              >
                <option value="">General / Casco</option>
                {potreros.map((p) => (
                  <option key={p.numero} value={p.numero}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                Responsable
              </label>
              <input
                type="text"
                placeholder="Encargado / Personal"
                value={quickTarea.responsable}
                onChange={(e) =>
                  setQuickTarea({ ...quickTarea, responsable: e.target.value })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                Prioridad
              </label>
              <select
                value={quickTarea.prioridad}
                onChange={(e) =>
                  setQuickTarea({ ...quickTarea, prioridad: e.target.value })
                }
                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
              >
                <option value="Alta">Alta</option>
                <option value="Normal">Normal</option>
                <option value="Urgente">Urgente</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                Fecha Límite
              </label>
              <input
                type="date"
                value={quickTarea.fecha_limite}
                onChange={(e) =>
                  setQuickTarea({ ...quickTarea, fecha_limite: e.target.value })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <button
                type="submit"
                disabled={savingTarea}
                className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold"
              >
                Guardar
              </button>
            </div>
          </form>
        )}

        {tareas.length === 0 ? (
          <div className="py-6 text-center text-xs font-medium text-slate-400">
            Sin tareas operativas registradas.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {tareas.slice(0, 6).map((t) => (
              <div
                key={t.id}
                className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 text-xs ${
                  t.completada
                    ? 'bg-slate-50 border-slate-200 opacity-70'
                    : 'bg-white border-slate-200 hover:border-emerald-300'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleToggleQuickTarea(t)}
                    className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                      t.completada
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-300 bg-white hover:border-emerald-700'
                    }`}
                    title={t.completada ? 'Marcar como Pendiente' : 'Marcar como Hecha'}
                  >
                    {t.completada && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>
                  <div className="min-w-0">
                    <div
                      className={`font-extrabold truncate ${
                        t.completada ? 'line-through text-slate-400' : 'text-slate-900'
                      }`}
                    >
                      {t.titulo}
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                      {t.potrero_numero && (
                        <span className="font-bold text-emerald-800">
                          P#{t.potrero_numero === 2 ? '2/3' : t.potrero_numero}
                        </span>
                      )}
                      {t.responsable && <span>· {t.responsable}</span>}
                      {t.fecha_limite && <span>· Lím: {t.fecha_limite}</span>}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    t.prioridad === 'Urgente' || t.prioridad === 'Alta'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {t.completada ? 'Hecha' : t.prioridad || 'Normal'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* TABS DE DESCOMPRESIÓN VISUAL: HACIENDA, AGUADAS Y MOVIMIENTOS         */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs font-bold shadow-xs">
          <button
            type="button"
            onClick={() => setTabInferior('hacienda_superficie')}
            className={`px-3.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap ${
              tabInferior === 'hacienda_superficie'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tags className="w-3.5 h-3.5 text-emerald-800" />
            Hacienda & Potreros
          </button>
          <button
            type="button"
            onClick={() => setTabInferior('aguadas')}
            className={`px-3.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap ${
              tabInferior === 'aguadas'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Droplets className="w-3.5 h-3.5 text-sky-700" />
            Molinos & Aguadas ({infraList.length})
          </button>
          <button
            type="button"
            onClick={() => setTabInferior('movimientos')}
            className={`px-3.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap ${
              tabInferior === 'movimientos'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-700" />
            Últimos Movimientos & Labores
          </button>
        </div>
      </div>

      {/* TAB 1: Resumen por Categoría + Distribución por Ambiente */}
      {tabInferior === 'hacienda_superficie' && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-150">
        {/* Resumen por Categoría de Hacienda */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Resumen de Hacienda por Categoría
                </h3>
                <p className="text-xs text-slate-500 tabular-nums">
                  {totalCabezasActivas.toLocaleString('es-AR')} cabezas en {rodeos.length} rodeos
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('rodeos')}
                className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1"
              >
                Abrir Planilla de Rodeos
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              {resumenCategorias.map((item) => (
                <div key={item.categoria} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-800" />
                      <span className="font-bold text-slate-800">{item.categoria}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-extrabold text-slate-900">
                        {item.cantidad.toLocaleString('es-AR')} cab.
                      </span>
                      <span className="text-slate-400 w-12 text-right font-semibold">
                        {item.porcentaje}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all bg-emerald-800"
                      style={{ width: `${Math.max(item.porcentaje, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Rodeos activos: <strong className="text-slate-800">{rodeos.length} rodeos</strong>
            </span>
            <span>
              Padrón individual:{' '}
              <strong className="text-slate-800">
                {animalesActivos.length} caravanas ({cajasCaravanas.length} cajas)
              </strong>
            </span>
          </div>
        </div>

        {/* Ocupación & Rotación de Potreros Hoy */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 flex flex-col justify-between space-y-3.5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Ocupación & Rotación de Potreros Hoy
                </h3>
                <p className="text-xs text-slate-500 tabular-nums">
                  <strong className="text-emerald-800">{potrerosConHacienda.size} ocupados</strong> · <strong className="text-slate-700">{Math.max(0, potreros.length - potrerosConHacienda.size)} en descanso</strong> de {potreros.length} potreros
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('mapa')}
                className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1 shrink-0 cursor-pointer"
                title="Abrir Mapa Satelital de Potreros"
              >
                Abrir Mapa
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Alerta de rotación si algún lote cumplió o superó meta */}
            {rodeosPastoreando.some((r) => r.alertaCambio) && (
              <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm shrink-0">⚠️</span>
                  <span className="text-amber-950 font-bold truncate">
                    {rodeosPastoreando.filter((r) => r.alertaCambio).length} lote(s) cumplieron estadía recomendada
                  </span>
                </div>
                <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-md bg-amber-200 text-amber-900 shrink-0">
                  Rotar
                </span>
              </div>
            )}

            {/* Listado compacto de rodeos actualmente pastoreando */}
            <div className="mt-3 space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {rodeosPastoreando.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 font-medium bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No hay rodeos con potrero asignado actualmente.
                </div>
              ) : (
                rodeosPastoreando.map((r) => (
                  <div
                    key={r.id}
                    className={`p-2.5 rounded-xl border transition flex flex-col justify-between gap-1.5 ${
                      r.alertaCambio
                        ? 'bg-amber-50/70 border-amber-200/90 hover:border-amber-300'
                        : 'bg-slate-50/80 border-slate-200/80 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-extrabold text-xs text-slate-900 truncate">
                          {r.nombre}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-800 text-[10px] font-black shrink-0">
                          {r.cabezas} cab.
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {r.alertaCambio ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1"
                            title={`Estadía: ${r.diasActuales} días (meta: ${r.diasMeta} días)`}
                          >
                            <span>⚠️ {r.diasActuales}d</span>
                            <span className="text-amber-700/80 font-normal">/ {r.diasMeta}d</span>
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200"
                            title={`Estadía: ${r.diasActuales} días (meta: ${r.diasMeta} días)`}
                          >
                            {r.diasActuales}d / {r.diasMeta}d
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectPotreroInMap) onSelectPotreroInMap(Number(r.potrero_numero));
                            else onNavigate('mapa');
                          }}
                          className="p-1 rounded-lg text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                          title={`Ver ${r.potreroNombre} en el Mapa`}
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-800 truncate">
                        📍 {r.potreroNombre} {r.haPotrero > 0 ? `(${Math.round(r.haPotrero)} ha)` : ''}
                      </span>
                      {r.carga !== '-' && (
                        <span className="font-bold text-emerald-800 shrink-0">
                          {r.carga} cab/ha
                        </span>
                      )}
                    </div>

                    {/* Barra de progreso de permanencia */}
                    <div className="w-full bg-slate-200/80 h-1 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          r.alertaCambio ? 'bg-amber-500' : 'bg-emerald-600'
                        }`}
                        style={{ width: `${Math.min(100, r.pctProgreso)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 text-white flex items-center justify-between">
            <div className="text-xs">
              <div className="font-bold text-emerald-300">
                Superficie Total en Pastoreo
              </div>
              <div className="text-slate-300 text-[11px]">
                {Math.round(haOcupadas).toLocaleString('es-AR')} ha pastoreadas de {Math.round(totalHectareas).toLocaleString('es-AR')} ha totales.
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('mapa')}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shrink-0 transition cursor-pointer"
            >
              Abrir Mapa →
            </button>
          </div>
        </div>
      </div>
      )}

      {/* TAB 2: Estado de Molinos, Tanques, Bebidas y Tranqueras */}
      {tabInferior === 'aguadas' && (
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-4 animate-in fade-in duration-150">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-100 text-sky-800">
              <Droplets className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Estado de Molinos, Aguadas e Infraestructura ({infraList.length})
              </h3>
              <p className="text-xs text-slate-500">
                {infraOperativa} operativos · {infraEnAlerta.length} en alerta o mantenimiento
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('mapa')}
            className="text-xs font-bold text-sky-800 hover:text-sky-950 flex items-center gap-1"
          >
            Ver en Mapa Interactivo
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[500px] overflow-y-auto pr-1">
          {infraList.map((m) => {
            const isOk = (m.estado || 'Operativo') === 'Operativo';
            return (
              <div
                key={m.id}
                className={`p-3 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 ${
                  isOk
                    ? 'bg-slate-50/80 border-slate-200/90 hover:border-slate-300'
                    : 'bg-amber-50/90 border-amber-300'
                }`}
              >
                {/* Línea superior en móvil / Izquierda en desktop */}
                <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  <span
                    className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center text-white shrink-0 shadow-xs mt-0.5 sm:mt-0 ${
                      isOk ? 'bg-sky-700' : 'bg-amber-600'
                    }`}
                  >
                    {m.codigo || (m.numero ? `M${m.numero}` : 'INF')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-xs font-bold text-slate-900 min-w-0 flex-1 break-words">
                        {m.nombre || `Molino ${m.numero}`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectInfraInMap ? onSelectInfraInMap(m) : onNavigate('mapa')
                        }
                        className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 inline-flex items-center gap-1 hover:underline whitespace-nowrap shrink-0 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200/60"
                        title="Ver en mapa"
                      >
                        <MapPin className="w-3 h-3 text-sky-600 shrink-0" />
                        <span>Mapa</span>
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500 break-words mt-0.5">
                      <span className="font-semibold text-slate-700">
                        {m.tipo || 'Molino'}
                      </span>
                      <span className="mx-1 text-slate-300">·</span>
                      <span>
                        {m.potreros_abastecidos ||
                          (m.potrero_numero ? `Potrero #${m.potrero_numero}` : 'General')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Línea inferior en móvil / Derecha en desktop */}
                <div className="flex items-center justify-between sm:justify-end gap-2 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 sm:border-transparent shrink-0">
                  <span className="text-[10px] font-bold uppercase text-slate-400 sm:hidden">
                    Estado:
                  </span>
                  <select
                    disabled={updatingMolinoId === m.id}
                    value={m.estado || 'Operativo'}
                    onChange={(e) => handleQuickInfraStatus(m, e.target.value)}
                    className={`w-full sm:w-auto px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-semibold border transition cursor-pointer text-center sm:text-left ${
                      isOk
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                    }`}
                  >
                    {ESTADOS_MOLINO.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* TAB 3: Últimos Movimientos de Hacienda / Labores Cargadas */}
      {tabInferior === 'movimientos' && (
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-4 flex flex-col justify-between animate-in fade-in duration-150">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-900/10 text-emerald-900">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Últimos Movimientos y Labores
                </h3>
              </div>
            </div>

            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setActividadTab('todos')}
                className={`px-2.5 py-1 rounded-md transition ${
                  actividadTab === 'todos'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Todo
              </button>
              <button
                type="button"
                onClick={() => setActividadTab('labores')}
                className={`px-2.5 py-1 rounded-md transition ${
                  actividadTab === 'labores'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Siembras ({laboresSiembras.length})
              </button>
              <button
                type="button"
                onClick={() => setActividadTab('movimientos')}
                className={`px-2.5 py-1 rounded-md transition ${
                  actividadTab === 'movimientos'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Hacienda ({movimientosHacienda.length})
              </button>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {(actividadTab === 'todos' || actividadTab === 'labores') &&
              laboresSiembras.slice(0, 8).map((l) => {
                const total =
                  Number(l.costo_total) ||
                  (Number(l.costo_semilla) || 0) +
                    (Number(l.costo_fertilizante) || 0) +
                    (Number(l.costo_fumigacion) || 0) +
                    (Number(l.costo_mano_obra) || 0);
                const ha = Number(l.hectareas) || 0;
                const porHa = ha > 0 ? total / ha : 0;

                return (
                  <div
                    key={`lab-${l.id}`}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald-900/10 text-emerald-900">
                        <Sprout className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          {l.tarea || 'Labor'} · {l.cultivo_variedad || 'Pastura'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {l.fecha} ·{' '}
                          <strong>
                            {l.potreros_detalle ||
                              (l.potrero_numero ? `Potrero #${l.potrero_numero}` : 'Lote Gral.')}
                          </strong>{' '}
                          ({ha} ha)
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-extrabold text-emerald-900">
                        ${porHa.toLocaleString('es-AR', { maximumFractionDigits: 0 })}/ha
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Total: ${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>
                );
              })}

            {(actividadTab === 'todos' || actividadTab === 'movimientos') &&
              movimientosHacienda.slice(0, 8).map((m) => (
                <div
                  key={`mov-${m.id}`}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
                      <ArrowRightLeft className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {m.tipo_movimiento}: {m.rodeo_nombre} (
                        {m.cantidad_cabezas ?? m.cantidad ?? 0} cab.)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Fecha: {m.fecha}
                        {m.potrero_origen ? ` · Desde P#${m.potrero_origen}` : ''}
                        {m.potrero_destino ? ` → P#${m.potrero_destino}` : ''}
                      </div>
                    </div>
                  </div>
                  {m.potrero_destino && (
                    <button
                      type="button"
                      onClick={() => onSelectPotreroInMap(Number(m.potrero_destino))}
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 shrink-0"
                    >
                      Ver Lote
                    </button>
                  )}
                </div>
              ))}

            {laboresSiembras.length === 0 && movimientosHacienda.length === 0 && (
              <div className="py-8 text-center text-xs font-medium text-slate-400">
                Sin movimientos ni labores recientes registradas.
              </div>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onNavigate('bitacora')}
            className="text-xs font-bold text-emerald-800 hover:underline flex items-center gap-1"
          >
            Abrir Bitácora Mensual & Exportar PDF
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('tareas')}
            className="text-xs font-bold text-amber-800 hover:underline flex items-center gap-1"
          >
            Ver gestor de Tareas ({tareasPendientes.length})
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: ANOTAR LLUVIAS (PLUVIÓMETRO)                                  */}
      {/* ==================================================================== */}
      {showNuevaLluviaModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-blue-600 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CloudRain className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-extrabold">Anotar Registro de Lluvia</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNuevaLluviaModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveLluvia} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Milímetros (mm) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    placeholder="Ej: 32"
                    value={nuevaLluvia.milimetros}
                    onChange={(e) => setNuevaLluvia({ ...nuevaLluvia, milimetros: e.target.value })}
                    className="w-full pl-3 pr-10 py-2 rounded-xl border border-blue-400 text-lg font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-black text-slate-400">mm</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    required
                    value={nuevaLluvia.fecha}
                    onChange={(e) => setNuevaLluvia({ ...nuevaLluvia, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Pluviómetro
                  </label>
                  <select
                    value={nuevaLluvia.pluviometro}
                    onChange={(e) => setNuevaLluvia({ ...nuevaLluvia, pluviometro: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  >
                    <option value="Casco Principal">Casco Principal</option>
                    <option value="Puesto El Silencio">Puesto El Silencio</option>
                    <option value="Manga Central">Manga Central</option>
                    <option value="Potrero 8">Potrero 8</option>
                    <option value="Potrero 26">Potrero 26</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Observaciones
                </label>
                <input
                  type="text"
                  placeholder="Ej: Lluvia mansa de noche, sin viento"
                  value={nuevaLluvia.observaciones}
                  onChange={(e) => setNuevaLluvia({ ...nuevaLluvia, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNuevaLluviaModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingLluvia}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {savingLluvia ? 'Guardando...' : 'Guardar Lluvia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: HISTORIAL DE LLUVIAS EDITABLE                                 */}
      {/* ==================================================================== */}
      {showHistorialLluviasModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-blue-600 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <CloudRain className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-extrabold">Historial de Lluvias (Campaña 2026/2027)</h3>
                  <p className="text-[11px] text-blue-200">
                    Total Acumulado Real: <strong className="text-white">{totalLluviaCampana} mm</strong> ({registrosLluvias.length} registros)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNuevaLluviaModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Anotar Lluvia
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowHistorialLluviasModal(false);
                    setEditingLluviaId(null);
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {registrosLluvias.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <CloudRain className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="text-xs font-medium text-slate-500">Sin precipitaciones registradas en esta campaña.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-100 px-3 py-2 text-[11px] font-black text-slate-700 uppercase tracking-wider grid grid-cols-12 gap-2 items-center">
                    <span className="col-span-3">Fecha</span>
                    <span className="col-span-2 text-right">Milímetros</span>
                    <span className="col-span-3">Pluviómetro</span>
                    <span className="col-span-2">Observaciones</span>
                    <span className="col-span-2 text-right">Acciones</span>
                  </div>

                  {registrosLluvias.map((r) => {
                    const isEditing = editingLluviaId === r.id;
                    if (isEditing) {
                      return (
                        <div key={r.id} className="p-3 bg-blue-50/70 grid grid-cols-12 gap-2 items-center text-xs">
                          <input
                            type="date"
                            className="col-span-3 px-2 py-1 rounded border border-blue-400 text-xs font-bold bg-white"
                            value={editingLluviaForm.fecha}
                            onChange={(e) => setEditingLluviaForm({ ...editingLluviaForm, fecha: e.target.value })}
                          />
                          <div className="col-span-2 flex items-center gap-1">
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              className="w-full px-2 py-1 rounded border border-blue-400 text-xs font-black text-right bg-white"
                              value={editingLluviaForm.milimetros}
                              onChange={(e) => setEditingLluviaForm({ ...editingLluviaForm, milimetros: e.target.value })}
                            />
                            <span className="text-[10px] text-slate-500 font-bold">mm</span>
                          </div>
                          <select
                            className="col-span-3 px-2 py-1 rounded border border-blue-400 text-xs bg-white"
                            value={editingLluviaForm.pluviometro}
                            onChange={(e) => setEditingLluviaForm({ ...editingLluviaForm, pluviometro: e.target.value })}
                          >
                            <option value="Casco Principal">Casco Principal</option>
                            <option value="Puesto El Silencio">Puesto El Silencio</option>
                            <option value="Manga Central">Manga Central</option>
                            <option value="Potrero 8">Potrero 8</option>
                            <option value="Potrero 26">Potrero 26</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Obs..."
                            className="col-span-2 px-2 py-1 rounded border border-blue-400 text-xs bg-white"
                            value={editingLluviaForm.observaciones}
                            onChange={(e) => setEditingLluviaForm({ ...editingLluviaForm, observaciones: e.target.value })}
                          />
                          <div className="col-span-2 flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleSaveEditLluvia(r.id)}
                              disabled={savingHistorialLluvia}
                              className="p-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px]"
                              title="Guardar cambios"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingLluviaId(null)}
                              className="p-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px]"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={r.id} className="p-3 hover:bg-slate-50/80 grid grid-cols-12 gap-2 items-center text-xs transition">
                        <span className="col-span-3 font-semibold text-slate-800">
                          {new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="col-span-2 font-black text-blue-700 text-right">
                          {r.milimetros} mm
                        </span>
                        <span className="col-span-3 text-slate-600 truncate font-medium">
                          {r.pluviometro || 'Casco Principal'}
                        </span>
                        <span className="col-span-2 text-slate-500 truncate text-[11px]" title={r.observaciones || ''}>
                          {r.observaciones || '-'}
                        </span>
                        <div className="col-span-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingLluviaId(r.id);
                              setEditingLluviaForm({
                                fecha: r.fecha || '',
                                milimetros: String(r.milimetros || ''),
                                pluviometro: r.pluviometro || 'Casco Principal',
                                observaciones: r.observaciones || '',
                              });
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                            title="Editar registro"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLluvia(r)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Eliminar registro"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
              <span>{registrosLluvias.length} registros cargados</span>
              <div className="font-extrabold text-slate-900">
                Total Campaña: <span className="text-blue-600 text-sm font-black">{totalLluviaCampana} mm</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: RECETA AGRONÓMICA CON GEMINI IA                                */}
      {/* ==================================================================== */}
      {showRecetaModal && (
        <GeminiRecetaModal
          isOpen={true}
          onClose={() => setShowRecetaModal(false)}
          onSuccess={() => {
            setShowRecetaModal(false);
            onRefresh?.();
          }}
          potreros={potreros}
          fechaOperacion={fechaOperacion}
          notify={notify}
        />
      )}
    </div>
  );
}
