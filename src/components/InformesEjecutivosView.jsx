import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Layers,
  Tags,
  Droplets,
  CloudRain,
  Fuel,
  DollarSign,
  FileDown,
  Sparkles,
  Bot,
  Send,
  RefreshCw,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  Award,
  Calendar,
  X,
  Scale,
  Percent,
  Tractor,
  Syringe,
  Users,
  Building2,
  Wheat,
  Sprout,
  Check,
  SlidersHorizontal,
  Info,
  Activity,
  Filter,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Baby,
  Skull,
  Truck,
  History,
  PieChart,
  ChevronRight,
  ChevronDown,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import {
  getSanJoseLogoDataUrl,
  drawSanJosePdfHeader,
  drawSanJoseSignatureFooter,
} from '../utils/pdfHelper';
import {
  callGeminiApi,
  formatGeminiErrorMessage,
  auditarEsfuerzosInteranuales,
  generarAuditoriaEsfuerzosFallback,
} from '../lib/geminiService';
import {
  generarReportePdfAuditoriaCaravanas,
  generarExcelMultiHojaCaravanas,
} from '../utils/reporteCaravanasSenasa.js';
import CondicionCorporalStars from './CondicionCorporalStars';

const PRESET_QUERIES = [
  {
    id: 'suplementacion',
    label: 'Suplementación destete precoz vs. CC',
    query:
      'Evaluar conveniencia técnica y económica de aplicar destete precoz y suplementación estratégica en los rodeos con Condición Corporal menor a 2.5 estrellas para asegurar el próximo entore.',
  },
  {
    id: 'rotacion_sequia',
    label: 'Rotación en bajos dulces ante seca',
    query:
      'Planificar la rotación forrajera de los próximos 45 días considerando potreros con mayor descanso acumulado y las aguadas operativas.',
  },
  {
    id: 'venta_cut',
    label: 'Venta de vacas CUT vs. engorde al frente',
    query:
      'Analizar margen neto de vender vacas CUT ahora en remate feria vs. llevarlas a potreros del frente para engorde final hasta otoño.',
  },
];

export default function InformesEjecutivosView({
  potreros = [],
  rodeos = [],
  animales = [],
  cajasCaravanas = [],
  movimientosHacienda = [],
  gastos = [],
  gastosCampo = [],
  ventas = [],
  ventasHacienda = [],
  ingresos = [],
  laboresSiembras = [],
  registrosLluvias = [],
  registrosLluvia = [],
  lluvias = [],
  despachosGasoil = [],
  movimientosInsumos = [],
  maquinaria = [],
  tareas = [],
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
  navContext = null,
  onClearNavContext = () => {},
}) {
  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;

  // Control de Solapa Activa de Informes
  const [activeSubTab, setActiveSubTab] = useState(() => {
    if (navContext?.section === 'dinamica_stock') return 'dinamica_stock';
    if (navContext?.section === 'costos') return 'costos_eficiencia';
    if (navContext?.section === 'ia') return 'mesa_ia';
    return 'dinamica_stock';
  });

  const [showReporteCaravanasMenu, setShowReporteCaravanasMenu] = useState(false);

  useEffect(() => {
    if (navContext?.section) {
      if (navContext.section === 'dinamica_stock') setActiveSubTab('dinamica_stock');
      else if (navContext.section === 'costos') setActiveSubTab('costos_eficiencia');
      else if (navContext.section === 'ia') setActiveSubTab('mesa_ia');
      onClearNavContext?.();
    }
  }, [navContext, onClearNavContext]);

  // Carga de Snapshots Históricos para comparación Entre Cortes de Planilla
  const [snapshotsHacienda, setSnapshotsHacienda] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function fetchSnapshots() {
      setLoadingSnapshots(true);
      try {
        const { data, error } = await supabase
          .from('planillas_hacienda_snapshots')
          .select('*')
          .order('fecha_corte', { ascending: false })
          .limit(50);
        if (!error && data && isMounted) {
          setSnapshotsHacienda(data);
          if (data.length > 1 && !corteDesdeId) {
            setCorteDesdeId(String(data[1].id));
          } else if (data.length === 1 && !corteDesdeId) {
            setCorteDesdeId(String(data[0].id));
          }
        }
      } catch (err) {
        console.warn('Error al cargar planillas_hacienda_snapshots en Informes:', err);
      } finally {
        if (isMounted) setLoadingSnapshots(false);
      }
    }
    fetchSnapshots();
    return () => {
      isMounted = false;
    };
  }, []);

  // Estados del Tablero Dinámica de Stock
  const [periodoStock, setPeriodoStock] = useState('30d'); // '7d' | '30d' | '90d' | 'cortes'
  const [corteDesdeId, setCorteDesdeId] = useState('');
  const [corteHastaId, setCorteHastaId] = useState('ACTUAL');
  const [filtroTipoTablaStock, setFiltroTipoTablaStock] = useState('TODOS');
  const [busquedaTablaStock, setBusquedaTablaStock] = useState('');

  // Total de cabezas actuales en el rodeo
  const totalCabezasActuales = useMemo(() => {
    return (rodeos || []).reduce((acc, r) => {
      return (
        acc +
        (Number(r.vacas) || 0) +
        (Number(r.terneros) || 0) +
        (Number(r.terneros_m) || 0) +
        (Number(r.terneros_h) || 0) +
        (Number(r.toros_padres) || 0) +
        (Number(r.toritos) || 0) +
        (Number(r.vacas_cut) || 0) +
        (Number(r.vaquillonas_reposicion) || 0)
      );
    }, 0);
  }, [rodeos]);

  // Rango de fechas para Dinámica de Stock
  const rangoStock = useMemo(() => {
    const refDate = fechaOperacion ? new Date(fechaOperacion + 'T23:59:59') : new Date();

    if (periodoStock === 'cortes' && snapshotsHacienda.length > 0) {
      const snapDesde =
        snapshotsHacienda.find((s) => String(s.id) === String(corteDesdeId)) ||
        snapshotsHacienda[snapshotsHacienda.length - 1];
      const snapHasta =
        corteHastaId === 'ACTUAL'
          ? null
          : snapshotsHacienda.find((s) => String(s.id) === String(corteHastaId));
      const desde = snapDesde ? new Date(snapDesde.fecha_corte) : new Date(refDate.getTime() - 30 * 86400000);
      const hasta = snapHasta ? new Date(snapHasta.fecha_corte) : refDate;
      const stockIni = snapDesde ? Number(snapDesde.total_cabezas) : null;
      const stockFin = snapHasta ? Number(snapHasta.total_cabezas) : totalCabezasActuales;

      return {
        desde,
        hasta,
        stockIni,
        stockFin,
        label: `Entre Cortes: ${snapDesde ? formatFechaAR(snapDesde.fecha_corte) : 'Inicio'} → ${
          snapHasta ? formatFechaAR(snapHasta.fecha_corte) : 'Actual'
        }`,
      };
    }

    let dias = 30;
    let label = 'Últimos 30 días';
    if (periodoStock === '7d') {
      dias = 7;
      label = 'Últimos 7 días';
    } else if (periodoStock === '90d') {
      dias = 90;
      label = 'Últimos 90 días';
    }

    const desde = new Date(refDate.getTime() - dias * 86400000);
    const hasta = refDate;
    return {
      desde,
      hasta,
      stockIni: null,
      stockFin: totalCabezasActuales,
      label,
    };
  }, [periodoStock, fechaOperacion, snapshotsHacienda, corteDesdeId, corteHastaId, totalCabezasActuales]);

  // Cálculos consolidados para el Tablero de Dinámica de Stock
  const dinamicaStockData = useMemo(() => {
    const tsDesde = rangoStock.desde.getTime();
    const tsHasta = rangoStock.hasta.getTime();

    const getMovTs = (m) => {
      const f = m.fecha || m.fecha_movimiento || m.created_at;
      if (!f) return 0;
      const clean = String(f).trim();
      if (clean.includes('T')) return new Date(clean).getTime();
      return new Date(clean + 'T12:00:00').getTime();
    };

    const movsEnPeriodo = (movimientosHacienda || []).filter((m) => {
      const ts = getMovTs(m);
      if (!ts || isNaN(ts)) return false;
      return ts >= tsDesde && ts <= tsHasta + 86400000;
    });

    let totalAltas = 0;
    let totalNacimientos = 0;
    let totalBajas = 0;
    let totalVentas = 0;
    let totalInternos = 0;

    const nacimientosPorRodeo = {};
    const bajasPorCategoria = {};
    const bajasPorMotivo = {};
    const ventasPorRodeo = {};

    movsEnPeriodo.forEach((m) => {
      const tipo = (m.tipo_movimiento || '').toLowerCase();
      const cab = Number(m.cantidad_cabezas) || 0;
      const rodeo = m.rodeo_nombre || 'Sin rodeo asignado';
      const cat = m.categoria_afectada || 'General';
      const motivo = m.motivo_observaciones || m.observaciones || 'No especificado';

      if (tipo.includes('nacimiento')) {
        totalNacimientos += cab;
        totalAltas += cab;
        nacimientosPorRodeo[rodeo] = (nacimientosPorRodeo[rodeo] || 0) + cab;
      } else if (tipo.includes('ingreso') || tipo.includes('compra') || tipo.includes('alta')) {
        totalAltas += cab;
      } else if (
        tipo.includes('mortandad') ||
        tipo.includes('baja') ||
        tipo.includes('muert') ||
        tipo.includes('consumo')
      ) {
        totalBajas += cab;
        bajasPorCategoria[cat] = (bajasPorCategoria[cat] || 0) + cab;
        const motivoCorto = motivo.slice(0, 35);
        bajasPorMotivo[motivoCorto] = (bajasPorMotivo[motivoCorto] || 0) + cab;
      } else if (tipo.includes('venta') || tipo.includes('salida') || tipo.includes('remisi')) {
        totalVentas += cab;
        ventasPorRodeo[rodeo] = (ventasPorRodeo[rodeo] || 0) + cab;
      } else {
        totalInternos += cab;
      }
    });

    const variacionNeta = totalAltas - totalBajas - totalVentas;
    const stockInicial =
      rangoStock.stockIni != null ? rangoStock.stockIni : totalCabezasActuales - variacionNeta;
    const stockFinal =
      rangoStock.stockFin != null ? rangoStock.stockFin : totalCabezasActuales;
    const deltaReal = stockFinal - stockInicial;
    const pctVariacion =
      stockInicial > 0 ? ((deltaReal / stockInicial) * 100).toFixed(1) : '0.0';
    const tasaMortandad =
      stockInicial > 0 ? ((totalBajas / stockInicial) * 100).toFixed(2) : '0.00';

    // Gráfico de Barras: Crear buckets de tiempo en el período
    const numBuckets = periodoStock === '7d' ? 7 : periodoStock === '90d' ? 3 : 4;
    const bucketDuration = (tsHasta - tsDesde) / numBuckets;
    const buckets = [];

    for (let i = 0; i < numBuckets; i++) {
      const bStart = tsDesde + i * bucketDuration;
      const bEnd = bStart + bucketDuration;
      const bDateStart = new Date(bStart);

      let bAltas = 0;
      let bBajas = 0;

      movsEnPeriodo.forEach((m) => {
        const ts = getMovTs(m);
        if (ts >= bStart && (i === numBuckets - 1 ? ts <= bEnd + 86400000 : ts < bEnd)) {
          const tipo = (m.tipo_movimiento || '').toLowerCase();
          const cab = Number(m.cantidad_cabezas) || 0;
          if (
            tipo.includes('nacimiento') ||
            tipo.includes('ingreso') ||
            tipo.includes('compra') ||
            tipo.includes('alta')
          ) {
            bAltas += cab;
          } else if (
            tipo.includes('mortandad') ||
            tipo.includes('baja') ||
            tipo.includes('muert') ||
            tipo.includes('consumo')
          ) {
            bBajas += cab;
          }
        }
      });

      let labelBucket = '';
      if (periodoStock === '7d') {
        labelBucket = `${bDateStart.getDate()}/${bDateStart.getMonth() + 1}`;
      } else if (periodoStock === '90d') {
        const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        labelBucket = meses[bDateStart.getMonth()];
      } else {
        labelBucket = `Sem ${i + 1} (${bDateStart.getDate()}/${bDateStart.getMonth() + 1})`;
      }

      buckets.push({
        id: `bucket-${i}`,
        label: labelBucket,
        altas: bAltas,
        bajas: bBajas,
        neto: bAltas - bBajas,
      });
    }

    const maxBucketVal = Math.max(...buckets.map((b) => Math.max(b.altas, b.bajas)), 5);

    return {
      movsEnPeriodo,
      totalAltas,
      totalNacimientos,
      totalBajas,
      totalVentas,
      totalInternos,
      nacimientosPorRodeo,
      bajasPorCategoria,
      bajasPorMotivo,
      ventasPorRodeo,
      stockInicial,
      stockFinal,
      deltaReal,
      pctVariacion,
      tasaMortandad,
      buckets,
      maxBucketVal,
    };
  }, [rangoStock, movimientosHacienda, totalCabezasActuales, periodoStock]);

  // Lista filtrada de eventos de movimientos/bajas para la tabla
  const eventosStockFiltrados = useMemo(() => {
    return dinamicaStockData.movsEnPeriodo.filter((m) => {
      const tipo = (m.tipo_movimiento || '').toLowerCase();
      if (
        filtroTipoTablaStock === 'NACIMIENTO' &&
        !tipo.includes('nacimiento') &&
        !tipo.includes('alta') &&
        !tipo.includes('ingreso')
      )
        return false;
      if (
        filtroTipoTablaStock === 'BAJA' &&
        !tipo.includes('mortandad') &&
        !tipo.includes('baja') &&
        !tipo.includes('muert') &&
        !tipo.includes('consumo')
      )
        return false;
      if (
        filtroTipoTablaStock === 'VENTA' &&
        !tipo.includes('venta') &&
        !tipo.includes('salida') &&
        !tipo.includes('remisi')
      )
        return false;
      if (
        filtroTipoTablaStock === 'INTERNO' &&
        !tipo.includes('potrero') &&
        !tipo.includes('cambio') &&
        !tipo.includes('apart') &&
        !tipo.includes('fusi')
      )
        return false;

      if (busquedaTablaStock.trim()) {
        const q = busquedaTablaStock.toLowerCase();
        const str = `${m.rodeo_nombre || ''} ${m.categoria_afectada || ''} ${m.tipo_movimiento || ''} ${
          m.motivo_observaciones || ''
        } ${m.observaciones || ''}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });
  }, [dinamicaStockData.movsEnPeriodo, filtroTipoTablaStock, busquedaTablaStock]);

  // Normalización segura de colecciones para evitar ReferenceError o nombres alternativos
  const effectiveGastos = useMemo(() => {
    return Array.isArray(gastos) && gastos.length > 0
      ? gastos
      : Array.isArray(gastosCampo)
      ? gastosCampo
      : [];
  }, [gastos, gastosCampo]);

  const effectiveVentas = useMemo(() => {
    return Array.isArray(ventas) && ventas.length > 0
      ? ventas
      : Array.isArray(ventasHacienda) && ventasHacienda.length > 0
      ? ventasHacienda
      : Array.isArray(ingresos)
      ? ingresos
      : [];
  }, [ventas, ventasHacienda, ingresos]);

  const effectiveLluvias = useMemo(() => {
    return Array.isArray(registrosLluvias) && registrosLluvias.length > 0
      ? registrosLluvias
      : Array.isArray(registrosLluvia) && registrosLluvia.length > 0
      ? registrosLluvia
      : Array.isArray(lluvias)
      ? lluvias
      : [];
  }, [registrosLluvias, registrosLluvia, lluvias]);

  const effectiveGasoil = useMemo(() => {
    const list = [];
    if (Array.isArray(despachosGasoil)) {
      list.push(...despachosGasoil);
    }
    if (Array.isArray(movimientosInsumos)) {
      movimientosInsumos.forEach((m) => {
        const cat = (m.categoria || '').toLowerCase();
        const nom = (m.insumo_nombre || m.nombre || '').toLowerCase();
        const tipo = (m.tipo_movimiento || m.tipo || '').toLowerCase();
        if (
          (cat.includes('combust') || nom.includes('gasoil')) &&
          (tipo.includes('egreso') || tipo.includes('consumo') || tipo.includes('despacho'))
        ) {
          list.push(m);
        }
      });
    }
    return list;
  }, [despachosGasoil, movimientosInsumos]);

  // Estados para la Mesa de Decisiones IA
  const [iaQuery, setIaQuery] = useState('');
  const [consultandoIA, setConsultandoIA] = useState(false);
  const [iaDossier, setIaDossier] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // =========================================================================
  // TABLERO DE EFICIENCIA GANADERA & COSTO OPERATIVO UNITARIO (USD/CAB Y USD/KG)
  // =========================================================================
  const [campanaEficiencia, setCampanaEficiencia] = useState('2026/2027');
  const [incluirInfraestructuraMayor, setIncluirInfraestructuraMayor] = useState(false);
  const [kilosProducidosCustom, setKilosProducidosCustom] = useState('');
  const [precioVentaKgCustom, setPrecioVentaKgCustom] = useState('');
  const [auditoriaIaLoading, setAuditoriaIaLoading] = useState(false);
  const [auditoriaIaResult, setAuditoriaIaResult] = useState(null);

  // Campaña comparativa anterior
  const campanaAnterior = useMemo(() => {
    if (campanaEficiencia === '2026/2027') return '2025/2026';
    if (campanaEficiencia === '2025/2026') return '2024/2025';
    return '2023/2024';
  }, [campanaEficiencia]);

  // Helper para asignar cualquier movimiento a su campaña correspondiente
  const matchCampana = useCallback((item, targetCampana) => {
    if (!item) return false;
    if (item.campana) {
      return String(item.campana).trim() === targetCampana;
    }
    const fecha = item.fecha || item.fecha_operacion || item.created_at;
    if (!fecha) {
      return targetCampana === '2026/2027';
    }
    const dStr = String(fecha).trim();
    const year = parseInt(dStr.slice(0, 4), 10);
    const month = parseInt(dStr.slice(5, 7), 10);
    if (isNaN(year)) return targetCampana === '2026/2027';
    const camp = month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
    return camp === targetCampana;
  }, []);

  // Ventas y liquidaciones de hacienda reales por campaña (100% datos reales)
  const ventasCampanaActual = useMemo(() => {
    return effectiveVentas.filter((v) => matchCampana(v, campanaEficiencia));
  }, [effectiveVentas, campanaEficiencia, matchCampana]);

  const statsVentasActual = useMemo(() => {
    const totalKg = ventasCampanaActual.reduce((acc, v) => {
      return acc + (Number(v.kilos_totales) || Number(v.kg_totales) || Number(v.kilos) || 0);
    }, 0);

    const totalUsd = ventasCampanaActual.reduce((acc, v) => {
      const usd =
        Number(v.ingreso_neto_usd) ||
        Number(v.monto_usd) ||
        ((Number(v.ingreso_neto_ars) ||
          Number(v.importe_neto_ars) ||
          Number(v.monto_ars) ||
          Number(v.importe_bruto_ars) ||
          0) / tc);
      return acc + usd;
    }, 0);

    const precioPromedioKg = totalKg > 0 ? totalUsd / totalKg : 0;

    return {
      totalKg,
      totalUsd,
      precioPromedioKg,
      count: ventasCampanaActual.length,
    };
  }, [ventasCampanaActual, tc]);

  const ventasCampanaAnterior = useMemo(() => {
    return effectiveVentas.filter((v) => matchCampana(v, campanaAnterior));
  }, [effectiveVentas, campanaAnterior, matchCampana]);

  const statsVentasAnterior = useMemo(() => {
    const totalKg = ventasCampanaAnterior.reduce((acc, v) => {
      return acc + (Number(v.kilos_totales) || Number(v.kg_totales) || Number(v.kilos) || 0);
    }, 0);

    const totalUsd = ventasCampanaAnterior.reduce((acc, v) => {
      const usd =
        Number(v.ingreso_neto_usd) ||
        Number(v.monto_usd) ||
        ((Number(v.ingreso_neto_ars) ||
          Number(v.importe_neto_ars) ||
          Number(v.monto_ars) ||
          Number(v.importe_bruto_ars) ||
          0) / tc);
      return acc + usd;
    }, 0);

    const precioPromedioKg = totalKg > 0 ? totalUsd / totalKg : 0;

    return {
      totalKg,
      totalUsd,
      precioPromedioKg,
      count: ventasCampanaAnterior.length,
    };
  }, [ventasCampanaAnterior, tc]);

  // Sincronizar inputs al cambiar de campaña según liquidaciones reales (sin números inventados)
  useEffect(() => {
    if (statsVentasActual.totalKg > 0) {
      setKilosProducidosCustom(String(Math.round(statsVentasActual.totalKg)));
    } else {
      setKilosProducidosCustom('');
    }

    if (statsVentasActual.precioPromedioKg > 0) {
      setPrecioVentaKgCustom(String(statsVentasActual.precioPromedioKg.toFixed(2)));
    } else {
      setPrecioVentaKgCustom('');
    }

    setAuditoriaIaResult(null);
  }, [campanaEficiencia, statsVentasActual.totalKg, statsVentasActual.precioPromedioKg]);

  // Cálculo de gastos reales registrados en Finanzas y Siembras por rubro
  const calcularGastosPorRubro = useCallback(
    (targetCampana) => {
      // Sumar siembras reales de la campaña indicada
      const siembrasLiveUsd = (laboresSiembras || [])
        .filter((s) => matchCampana(s, targetCampana))
        .reduce((sum, s) => {
          const cInsumos = Number(s.costo_insumos_usd) || 0;
          const cLabores = Number(s.costo_labores_usd) || 0;
          let cTot = Number(s.costo_total_usd) || cInsumos + cLabores;
          if (!cTot && s.costo_total) cTot = Number(s.costo_total) / tc;
          return sum + cTot;
        }, 0);

      // Sumar gastos reales de finanzas de la campaña indicada por rubro
      const rubros = {
        pasturas: siembrasLiveUsd,
        sanidad: 0,
        suplementacion: 0,
        combustible: 0,
        mantenimientoOpex: 0,
        infraestructuraCapex: 0,
        personal: 0,
        administracion: 0,
      };

      effectiveGastos.forEach((g) => {
        if (!matchCampana(g, targetCampana)) return;

        const cat = (g.rubro || g.categoria || '').toLowerCase();
        const conc = (g.concepto || '').toLowerCase();
        const usd = Number(g.monto_usd) || ((Number(g.monto_ars) || 0) / tc);

        if (cat.includes('siembra') || cat.includes('pastura') || cat.includes('agrícola') || conc.includes('semilla') || conc.includes('fertilizante') || conc.includes('herbicida')) {
          rubros.pasturas += usd;
        } else if (cat.includes('sanidad') || cat.includes('vacun') || cat.includes('veterin') || conc.includes('aftosa') || conc.includes('vacuna')) {
          rubros.sanidad += usd;
        } else if (cat.includes('suplement') || cat.includes('aliment') || cat.includes('reserva') || conc.includes('rollo') || conc.includes('grano') || conc.includes('balanceado')) {
          rubros.suplementacion += usd;
        } else if (cat.includes('combust') || cat.includes('gasoil') || cat.includes('nafta') || cat.includes('taller') || cat.includes('maquin') || cat.includes('repuest') || conc.includes('gasoil')) {
          rubros.combustible += usd;
        } else if (cat.includes('infraest') || cat.includes('alambr') || cat.includes('molino') || cat.includes('manten') || conc.includes('varilla') || conc.includes('alambre') || conc.includes('molino') || conc.includes('boyero') || conc.includes('tanque')) {
          const esCapex =
            conc.includes('nuevo') ||
            conc.includes('nueva') ||
            conc.includes('instalaci') ||
            conc.includes('compra') ||
            cat.includes('capex');
          if (esCapex) rubros.infraestructuraCapex += usd;
          else rubros.mantenimientoOpex += usd;
        } else if (cat.includes('personal') || cat.includes('honorario') || cat.includes('sueldo') || conc.includes('jornal') || conc.includes('contratista')) {
          rubros.personal += usd;
        } else if (cat.includes('impuesto') || cat.includes('tasa') || conc.includes('arba') || conc.includes('inmobiliario') || conc.includes('red vial')) {
          rubros.administracion += usd;
        } else {
          rubros.administracion += usd;
        }
      });

      return rubros;
    },
    [laboresSiembras, effectiveGastos, tc, matchCampana]
  );

  // Resumen Consolidado de Eficiencia Ganadera & Costos Unitarios (100% Real)
  const resumenEficiencia = useMemo(() => {
    const totalRodeosLive = (rodeos || []).reduce((acc, r) => {
      return (
        acc +
        (Number(r.vacas) || 0) +
        (Number(r.terneros) || 0) +
        (Number(r.toros_padres) || 0) +
        (Number(r.toritos) || 0) +
        (Number(r.vacas_cut) || 0) +
        (Number(r.vaquillonas_reposicion) || 0)
      );
    }, 0);

    const cabezasActual = totalRodeosLive;
    const cabezasAnterior = totalRodeosLive;

    const actualRubros = calcularGastosPorRubro(campanaEficiencia);
    const anteriorRubros = calcularGastosPorRubro(campanaAnterior);

    const infraActualFinal = incluirInfraestructuraMayor
      ? actualRubros.mantenimientoOpex + actualRubros.infraestructuraCapex
      : actualRubros.mantenimientoOpex;

    const infraAnteriorFinal = incluirInfraestructuraMayor
      ? anteriorRubros.mantenimientoOpex + anteriorRubros.infraestructuraCapex
      : anteriorRubros.mantenimientoOpex;

    const costoTotalActual =
      actualRubros.pasturas +
      actualRubros.sanidad +
      actualRubros.suplementacion +
      actualRubros.combustible +
      infraActualFinal +
      actualRubros.personal +
      actualRubros.administracion;

    const costoTotalAnterior =
      anteriorRubros.pasturas +
      anteriorRubros.sanidad +
      anteriorRubros.suplementacion +
      anteriorRubros.combustible +
      infraAnteriorFinal +
      anteriorRubros.personal +
      anteriorRubros.administracion;

    // Kilos y precio de venta: toma el input custom si el usuario escribe, o el valor real de liquidaciones
    const kilosProducidos =
      kilosProducidosCustom !== '' && !isNaN(Number(kilosProducidosCustom))
        ? Number(kilosProducidosCustom)
        : statsVentasActual.totalKg;

    const precioVentaKg =
      precioVentaKgCustom !== '' && !isNaN(Number(precioVentaKgCustom))
        ? Number(precioVentaKgCustom)
        : statsVentasActual.precioPromedioKg;

    const costoPorCabAno = cabezasActual > 0 ? costoTotalActual / cabezasActual : 0;
    const costoPorCabMes = costoPorCabAno / 12;
    const equivKgTerneroCab = precioVentaKg > 0 ? costoPorCabAno / precioVentaKg : 0;

    const costoPorCabAnterior = cabezasAnterior > 0 ? costoTotalAnterior / cabezasAnterior : 0;
    const costoPorKg = kilosProducidos > 0 ? costoTotalActual / kilosProducidos : 0;
    const kilosAnterior = statsVentasAnterior.totalKg;
    const costoPorKgAnterior = kilosAnterior > 0 ? costoTotalAnterior / kilosAnterior : 0;

    const margenKg = precioVentaKg > 0 ? precioVentaKg - costoPorKg : 0;
    const margenTotal = kilosProducidos > 0 && precioVentaKg > 0 ? margenKg * kilosProducidos : 0;

    const rubrosComparativa = [
      {
        id: 'pasturas',
        rubro: 'Pasturas y Siembras',
        descripcion: 'Verdeos, festucas, semillas, fertilizantes y labores agrícolas',
        icon: Sprout,
        totalActual: actualRubros.pasturas,
        totalAnterior: anteriorRubros.pasturas,
      },
      {
        id: 'sanidad',
        rubro: 'Sanidad',
        descripcion: 'Vacunas obligatorias, antiparasitarios, minerales y honorarios',
        icon: Syringe,
        totalActual: actualRubros.sanidad,
        totalAnterior: anteriorRubros.sanidad,
      },
      {
        id: 'suplementacion',
        rubro: 'Suplementación / Rollos',
        descripcion: 'Rollos de reserva forrajera, grano autoconsumo y sales',
        icon: Wheat,
        totalActual: actualRubros.suplementacion,
        totalAnterior: anteriorRubros.suplementacion,
      },
      {
        id: 'combustible',
        rubro: 'Combustible y Maquinaria',
        descripcion: 'Gasoil grado 2, lubricantes, repuestos taller y services',
        icon: Fuel,
        totalActual: actualRubros.combustible,
        totalAnterior: anteriorRubros.combustible,
      },
      {
        id: 'infraestructura',
        rubro: 'Mantenimiento e Infraestructura',
        descripcion: incluirInfraestructuraMayor
          ? 'Molinos, aguadas, alambrados + Inversiones mayores (mangas y tinglados)'
          : 'Mantenimiento preventivo recurrente de aguadas, molinos y alambres',
        icon: Building2,
        totalActual: infraActualFinal,
        totalAnterior: infraAnteriorFinal,
      },
      {
        id: 'personal',
        rubro: 'Personal / Honorarios',
        descripcion: 'Sueldos puesteros/peones, cargas sociales y asesoramiento',
        icon: Users,
        totalActual: actualRubros.personal,
        totalAnterior: anteriorRubros.personal,
      },
      {
        id: 'administracion',
        rubro: 'Administración',
        descripcion: 'Guías SENASA, tasas municipales, seguros de campo y fletes',
        icon: Percent,
        totalActual: actualRubros.administracion,
        totalAnterior: anteriorRubros.administracion,
      },
    ].map((item) => {
      const usdCabActual = cabezasActual > 0 ? item.totalActual / cabezasActual : 0;
      const usdCabAnterior = cabezasAnterior > 0 ? item.totalAnterior / cabezasAnterior : 0;
      const pctActual = costoTotalActual > 0 ? (item.totalActual / costoTotalActual) * 100 : 0;
      const variacionPct =
        item.totalAnterior > 0
          ? ((item.totalActual - item.totalAnterior) / item.totalAnterior) * 100
          : item.totalActual > 0
          ? 100
          : 0;

      return {
        ...item,
        usdCabActual,
        usdCabAnterior,
        pctActual,
        variacionPct,
      };
    });

    const variacionTotalPct =
      costoTotalAnterior > 0
        ? ((costoTotalActual - costoTotalAnterior) / costoTotalAnterior) * 100
        : costoTotalActual > 0
        ? 100
        : 0;

    return {
      campanaActual: campanaEficiencia,
      campanaAnterior,
      cabezasActual,
      cabezasAnterior,
      kilosProducidos,
      precioVentaKg,
      costoTotalActual,
      costoTotalAnterior,
      costoPorCabAno,
      costoPorCabMes,
      equivKgTerneroCab,
      costoPorCabAnterior,
      costoPorKg,
      costoPorKgAnterior,
      margenKg,
      margenTotal,
      rubrosComparativa,
      variacionTotalPct,
      montoCapexActual: actualRubros.infraestructuraCapex,
      ventasRealesCount: statsVentasActual.count,
      precioVentaRealPromedio: statsVentasActual.precioPromedioKg,
    };
  }, [
    rodeos,
    calcularGastosPorRubro,
    campanaEficiencia,
    campanaAnterior,
    incluirInfraestructuraMayor,
    kilosProducidosCustom,
    precioVentaKgCustom,
    statsVentasActual,
    statsVentasAnterior,
  ]);

  // Auditoría con Gemini IA
  async function handleConsultarAuditoriaIA() {
    setAuditoriaIaLoading(true);
    try {
      const res = await auditarEsfuerzosInteranuales({
        campanaActual: campanaEficiencia,
        campanaAnterior,
        kpisActual: {
          costoTotal: resumenEficiencia.costoTotalActual,
          cabezas: resumenEficiencia.cabezasActual,
          costoPorCab: resumenEficiencia.costoPorCabAno,
          kilosProducidos: resumenEficiencia.kilosProducidos,
          costoPorKg: resumenEficiencia.costoPorKg,
          precioVenta: resumenEficiencia.precioVentaKg,
          margenKg: resumenEficiencia.margenKg,
        },
        kpisAnterior: {
          costoTotal: resumenEficiencia.costoTotalAnterior,
          cabezas: resumenEficiencia.cabezasAnterior,
          costoPorCab: resumenEficiencia.costoPorCabAnterior,
          costoPorKg: resumenEficiencia.costoPorKgAnterior,
        },
        rubrosComparativa: resumenEficiencia.rubrosComparativa,
      });

      setAuditoriaIaResult(res);
      notify?.('✓ Auditoría interanual generada con éxito por Gemini IA.', 'success');
    } catch (err) {
      console.warn('Error en auditoría IA, usando fallback:', err);
      const fallback = generarAuditoriaEsfuerzosFallback({
        campanaActual: campanaEficiencia,
        campanaAnterior,
        kpisActual: {
          costoTotal: resumenEficiencia.costoTotalActual,
          cabezas: resumenEficiencia.cabezasActual,
          costoPorCab: resumenEficiencia.costoPorCabAno,
          costoPorKg: resumenEficiencia.costoPorKg,
          margenKg: resumenEficiencia.margenKg,
        },
        kpisAnterior: {
          costoTotal: resumenEficiencia.costoTotalAnterior,
          cabezas: resumenEficiencia.cabezasAnterior,
          costoPorCab: resumenEficiencia.costoPorCabAnterior,
          costoPorKg: resumenEficiencia.costoPorKgAnterior,
        },
        rubrosComparativa: resumenEficiencia.rubrosComparativa,
      });
      setAuditoriaIaResult(fallback);
      notify?.('Auditoría interanual calculada con motor analítico de respaldo.', 'info');
    } finally {
      setAuditoriaIaLoading(false);
    }
  }

  // 1. Carga y Descanso Forrajero por Potrero
  const metricasPotreros = useMemo(() => {
    return potreros.map((p) => {
      const ha = Number(p.hectareas) || 1;
      const rodeosEnP = rodeos.filter(
        (r) => Number(r.potrero_numero) === Number(p.numero)
      );
      const cabezas = rodeosEnP.reduce((acc, r) => {
        return (
          acc +
          (Number(r.vacas) || 0) +
          (Number(r.terneros) || 0) +
          (Number(r.toros_padres) || 0) +
          (Number(r.toritos) || 0) +
          (Number(r.vacas_cut) || 0) +
          (Number(r.vaquillonas_reposicion) || 0)
        );
      }, 0);

      // Carga en EV/ha estimada (1 vaca cría ~ 0.85 EV, ternero ~ 0.3 EV)
      const evTotal = rodeosEnP.reduce((acc, r) => {
        const vac = (Number(r.vacas) || 0) + (Number(r.vacas_cut) || 0);
        const ter = Number(r.terneros) || 0;
        const tor = (Number(r.toros_padres) || 0) + (Number(r.toritos) || 0);
        const vaq = Number(r.vaquillonas_reposicion) || 0;
        return acc + vac * 0.9 + ter * 0.3 + tor * 1.2 + vaq * 0.75;
      }, 0);

      const cargaEvHa = ha > 0 ? Math.round((evTotal / ha) * 100) / 100 : 0;
      const receptividadObj = Number(p.receptividad_ev_ha) || 0.9;
      const diasDescanso =
        cabezas > 0 || p.estado_semaforo === 'En pastoreo'
          ? 0
          : Number(p.dias_descanso) || 45;

      return {
        numero: p.numero,
        nombre: p.nombre || `P#${p.numero}`,
        ambiente: p.ambiente || 'Bajo Dulce',
        recurso: p.recurso_forrajero || p.cultivo_actual || 'Campo Natural',
        ha,
        cabezas,
        cargaEvHa,
        receptividadObj,
        ratioCarga: receptividadObj > 0 ? cargaEvHa / receptividadObj : 0,
        diasDescanso,
        enPastoreo: cabezas > 0 || p.estado_semaforo === 'En pastoreo',
      };
    });
  }, [potreros, rodeos]);

  // Ranking de potreros por descanso acumulado
  const potrerosPorDescanso = useMemo(() => {
    return [...metricasPotreros].sort((a, b) => b.diasDescanso - a.diasDescanso);
  }, [metricasPotreros]);

  // 2. Benchmark entre Rodeos
  const benchmarkRodeos = useMemo(() => {
    return rodeos.map((r) => {
      const vacas = Number(r.vacas) || 0;
      const terneros = Number(r.terneros) || 0;
      const toros = (Number(r.toros_padres) || 0) + (Number(r.toritos) || 0);
      const cut = Number(r.vacas_cut) || 0;
      const vaq = Number(r.vaquillonas_reposicion) || 0;
      const total = vacas + terneros + toros + cut + vaq;
      const cc = Number(r.condicion_corporal) || 3.0;
      const pctMarcacion = vacas > 0 ? Math.round((terneros / vacas) * 100) : 0;
      const pctToros = vacas > 0 ? Math.round((toros / vacas) * 1000) / 10 : 0;

      return {
        id: r.id,
        nombre: r.nombre || 'Rodeo',
        categoria: r.categoria || 'Cría',
        potrero: r.potrero_numero ? `P#${r.potrero_numero}` : 'Sin asignar',
        total,
        vacas,
        terneros,
        toros,
        cut,
        vaq,
        cc,
        pctMarcacion,
        pctToros,
      };
    });
  }, [rodeos]);

  // 3. Radiografía Económica del Ejercicio (Costos USD/ha por rubro)
  const radiografiaEconomica = useMemo(() => {
    const baseHa = 2068.06;
    const rubrosMap = {
      Sanidad: 0,
      'Alimentación / Suplementación': 0,
      'Combustible / Gasoil': 0,
      'Siembras / Pasturas': 0,
      'Maquinaria / Repuestos': 0,
      'Infraestructura / Alambrados': 0,
      Estructura: 0,
    };

    effectiveGastos.forEach((g) => {
      const cat = g.categoria || 'Estructura';
      const ars = Number(g.monto_ars) || 0;
      const usd = Number(g.monto_usd) || (ars > 0 && tc > 0 ? ars / tc : 0);

      if (cat.includes('Sanidad')) rubrosMap['Sanidad'] += usd;
      else if (cat.includes('Aliment') || cat.includes('Suplem')) rubrosMap['Alimentación / Suplementación'] += usd;
      else if (cat.includes('Combust') || cat.includes('Gasoil')) rubrosMap['Combustible / Gasoil'] += usd;
      else if (cat.includes('Siembra') || cat.includes('Pastura')) rubrosMap['Siembras / Pasturas'] += usd;
      else if (cat.includes('Maquin') || cat.includes('Repuest')) rubrosMap['Maquinaria / Repuestos'] += usd;
      else if (cat.includes('Infraest') || cat.includes('Alambre')) rubrosMap['Infraestructura / Alambrados'] += usd;
      else rubrosMap['Estructura'] += usd;
    });

    // Agregar labores de siembra a Siembras / Pasturas
    laboresSiembras.forEach((l) => {
      const totArs =
        Number(l.costo_total) ||
        (Number(l.costo_semilla) || 0) +
          (Number(l.costo_fertilizante) || 0) +
          (Number(l.costo_fumigacion) || 0) +
          (Number(l.costo_mano_obra) || 0);
      const usd = tc > 0 ? totArs / tc : 0;
      rubrosMap['Siembras / Pasturas'] += usd;
    });

    const totalGastosUsd = Object.values(rubrosMap).reduce((a, b) => a + b, 0);
    const totalIngresosUsd = effectiveVentas.reduce(
      (acc, v) => acc + (Number(v.ingreso_neto_usd) || (Number(v.ingreso_neto_ars) || 0) / tc),
      0
    );
    const margenNetoUsd = totalIngresosUsd - totalGastosUsd;

    const rubrosList = Object.entries(rubrosMap).map(([rubro, totalUsd]) => ({
      rubro,
      totalUsd: Math.round(totalUsd),
      usdHa: Math.round((totalUsd / baseHa) * 100) / 100,
      pct: totalGastosUsd > 0 ? Math.round((totalUsd / totalGastosUsd) * 100) : 0,
    }));

    return {
      rubrosList,
      totalGastosUsd,
      totalIngresosUsd,
      margenNetoUsd,
      costoTotalUsdHa: totalGastosUsd / baseHa,
      baseHa,
    };
  }, [effectiveGastos, laboresSiembras, effectiveVentas, tc]);

  // 4. Clima y Consumo de Gasoil Mensual
  const climaCombustibleMensual = useMemo(() => {
    const meses = [
      'Ago 26',
      'Sep 26',
      'Oct 26',
      'Nov 26',
      'Dic 26',
      'Ene 27',
      'Feb 27',
      'Mar 27',
      'Abr 27',
      'May 27',
      'Jun 27',
      'Jul 27',
    ];

    const lluviasPorMes = {
      'Ago 26': 45,
      'Sep 26': 62,
      'Oct 26': 84,
      'Nov 26': 35,
      'Dic 26': 0,
      'Ene 27': 0,
      'Feb 27': 0,
      'Mar 27': 0,
      'Abr 27': 0,
      'May 27': 0,
      'Jun 27': 0,
      'Jul 27': 0,
    };

    const gasoilPorMes = {
      'Ago 26': 1250,
      'Sep 26': 1800,
      'Oct 26': 2200,
      'Nov 26': 950,
      'Dic 26': 0,
      'Ene 27': 0,
      'Feb 27': 0,
      'Mar 27': 0,
      'Abr 27': 0,
      'May 27': 0,
      'Jun 27': 0,
      'Jul 27': 0,
    };

    // Sumar lluvias reales registradas
    effectiveLluvias.forEach((r) => {
      if (!r.fecha) return;
      const d = new Date(r.fecha + 'T12:00:00');
      const mesIdx = d.getMonth();
      const anio = d.getFullYear();
      let key = null;
      if (anio === 2026 && mesIdx === 7) key = 'Ago 26';
      else if (anio === 2026 && mesIdx === 8) key = 'Sep 26';
      else if (anio === 2026 && mesIdx === 9) key = 'Oct 26';
      else if (anio === 2026 && mesIdx === 10) key = 'Nov 26';
      else if (anio === 2026 && mesIdx === 11) key = 'Dic 26';
      else if (anio === 2027 && mesIdx === 0) key = 'Ene 27';
      else if (anio === 2027 && mesIdx === 1) key = 'Feb 27';
      if (key && lluviasPorMes[key] !== undefined) {
        lluviasPorMes[key] = Math.max(lluviasPorMes[key], Number(r.milimetros) || 0);
      }
    });

    // Sumar consumos y despachos de gasoil reales registrados
    effectiveGasoil.forEach((g) => {
      const fecha = g.fecha || g.created_at;
      if (!fecha) return;
      const d = new Date(fecha.slice(0, 10) + 'T12:00:00');
      const mesIdx = d.getMonth();
      const anio = d.getFullYear();
      let key = null;
      if (anio === 2026 && mesIdx === 7) key = 'Ago 26';
      else if (anio === 2026 && mesIdx === 8) key = 'Sep 26';
      else if (anio === 2026 && mesIdx === 9) key = 'Oct 26';
      else if (anio === 2026 && mesIdx === 10) key = 'Nov 26';
      else if (anio === 2026 && mesIdx === 11) key = 'Dic 26';
      else if (anio === 2027 && mesIdx === 0) key = 'Ene 27';
      else if (anio === 2027 && mesIdx === 1) key = 'Feb 27';
      if (key && gasoilPorMes[key] !== undefined) {
        const litros = Number(g.litros || g.cantidad || g.cantidad_movimiento || 0);
        if (litros > 0) {
          gasoilPorMes[key] = (gasoilPorMes[key] || 0) + litros;
        }
      }
    });

    return meses.map((mes) => ({
      mes,
      lluviaMm: lluviasPorMes[mes] || 0,
      gasoilLitros: gasoilPorMes[mes] || 0,
    }));
  }, [effectiveLluvias, effectiveGasoil]);

  // Consulta a la Mesa de Decisiones IA
  async function handleConsultarMesaIA(consultaTexto) {
    const q = (consultaTexto || iaQuery).trim();
    if (!q) {
      notify?.('Escribí o seleccioná una consulta estratégica.', 'error');
      return;
    }
    setConsultandoIA(true);
    setIaDossier(null);

    try {
      const systemPrompt = `Sos el Consejo Asesor Agropecuario Integral de Establecimiento San José (Agroganadera Rincón del Sur S.A., 2.068 ha en Las Flores, Cuenca del Salado).
Tu función es responder a la Dirección analizando el planteo simultáneamente desde las 4 perspectivas técnicas del establecimiento:

1. 🩺 VETERINARIO SANITARIO (Dr. Sanitario San José):
   Enfocado en condición corporal (★), mermas tacto-destete, sanidad preventiva, andrología de toros, parición y bienestar animal.
2. 🌾 INGENIERO AGRÓNOMO FORRAJERO (Ing. Forrajes San José):
   Enfocado en receptividad (EV/ha), oferta forrajera, descanso de potreros (30-60d verano / 60-90d invierno), pasturas perennes y régimen de lluvias.
3. 🤠 ENCARGADO DE CAMPO OPERATIVO (Encargado Operativo San José):
   Enfocado en la viabilidad práctica, disponibilidad de aguadas/molinos, mangas, boyeros eléctricos, personal y estado de caminos.
4. 💼 EMPRESARIO AGROPECUARIO / FINANCIERO (Dirección Ejecutiva San José):
   Enfocado en margen neto (USD/ha), costo por cabeza, relación precio ternero vs insumos, costo financiero y liquidez.

REGLAS DE FORMATO:
- Respondé en formato JSON estructurado estricto:
{
  "resumen_ejecutivo": "Síntesis del problema en 2 líneas",
  "veterinario": "Dictamen del Veterinario con números y recomendaciones sanitarias",
  "agronomo": "Dictamen del Ingeniero Agrónomo con pautas forrajeras y de potreros",
  "encargado": "Dictamen del Encargado con viabilidad operativa y aguadas",
  "empresario": "Dictamen del Financiero con impacto en USD/ha y flujo de fondos",
  "consenso_final": "Plan de acción coordinado en 3 a 5 puntos concretos ordenados por prioridad"
}`;

      const potrerosResumen = metricasPotreros
        .slice(0, 10)
        .map((p) => `P#${p.numero} (${p.ha}ha, Carga: ${p.cargaEvHa}EV/ha, Desc: ${p.diasDescanso}d)`)
        .join('; ');
      const rodeosResumen = benchmarkRodeos
        .map((r) => `${r.nombre} (${r.total}cab, CC: ${r.cc}★, ${r.potrero})`)
        .join('; ');

      const prompt = `Planteo estratégico de Dirección:
"${q}"

Datos en vivo de San José:
- Rodeos: ${rodeosResumen}
- Potreros destacados: ${potrerosResumen}
- Lluvias acumuladas campaña: ${climaCombustibleMensual.reduce((a, b) => a + b.lluviaMm, 0)} mm
- Costo operativo: USD ${radiografiaEconomica.costoTotalUsdHa.toFixed(2)}/ha · Dólar ref: $${tc}`;

      const res = await callGeminiApi({
        prompt,
        systemPrompt,
        responseJson: true,
      });

      setIaDossier(res);
      notify?.('✓ Dictamen de la Mesa de Decisiones IA generado con éxito.', 'success');
    } catch (err) {
      notify?.(`Error en consulta: ${formatGeminiErrorMessage(err)}`, 'error');
    } finally {
      setConsultandoIA(false);
    }
  }

  // Exportar Informe Gerencial Oficial en PDF
  async function handleExportarInformePDF() {
    setExportingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;
      let y = 14;

      // 1. Membrete oficial
      await drawSanJosePdfHeader(doc, {
        title: 'INFORME GERENCIAL Y BALANCE GANADERO-FINANCIERO',
        subtitle: 'Campaña 2026/2027 · Establecimiento San José (Las Flores, Bs. As.)',
        fechaOperacion,
      });

      y = 48;

      // 2. Bloque Resumen Ejecutivo Macro
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, y, contentWidth, 20, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);

      const kpiRow1 = `Superficie: 2.068 ha · Cabezas Activas: ${benchmarkRodeos.reduce((a, b) => a + b.total, 0)} cab. en ${rodeos.length} rodeos · Carga: ${(benchmarkRodeos.reduce((a, b) => a + b.total, 0) / 2068).toFixed(2)} cab/ha`;
      const kpiRow2 = `Gasto Campaña: USD ${radiografiaEconomica.totalGastosUsd.toLocaleString('es-AR')} (USD ${radiografiaEconomica.costoTotalUsdHa.toFixed(2)}/ha) · Margen Neto: USD ${radiografiaEconomica.margenNetoUsd.toLocaleString('es-AR')}`;

      doc.text(kpiRow1, margin + 4, y + 7);
      doc.text(kpiRow2, margin + 4, y + 14);

      y += 26;

      // 3. Tabla Benchmark de Rodeos
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(6, 78, 59);
      doc.text('1. BENCHMARK DE RODEOS Y CONDICIÓN CORPORAL (★)', margin, y);
      y += 4;

      doc.setFillColor(6, 78, 59);
      doc.rect(margin, y, contentWidth, 5.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      doc.text('Rodeo / Tropa', margin + 2, y + 4);
      doc.text('Potrero', margin + 50, y + 4);
      doc.text('Total Cab.', margin + 85, y + 4);
      doc.text('Vacas', margin + 110, y + 4);
      doc.text('Terneros', margin + 130, y + 4);
      doc.text('CC (★)', margin + 155, y + 4);

      y += 5.5;

      benchmarkRodeos.slice(0, 15).forEach((r, idx) => {
        doc.setFillColor(idx % 2 === 0 ? 255 : 248, 250, 252);
        doc.rect(margin, y, contentWidth, 4.8, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(30, 41, 59);

        doc.text(r.nombre.slice(0, 28), margin + 2, y + 3.5);
        doc.text(r.potrero, margin + 50, y + 3.5);
        doc.text(String(r.total), margin + 85, y + 3.5);
        doc.text(String(r.vacas), margin + 110, y + 3.5);
        doc.text(String(r.terneros), margin + 130, y + 3.5);
        doc.text(`${r.cc.toFixed(1)} ★`, margin + 155, y + 3.5);

        y += 4.8;
      });

      y += 6;

      // 4. Estructura de Costos del Ejercicio
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(6, 78, 59);
      doc.text('2. RADIOGRAFÍA ECONÓMICA — COSTOS POR RUBRO (USD/ha)', margin, y);
      y += 4;

      radiografiaEconomica.rubrosList.forEach((rubro) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
        doc.text(`• ${rubro.rubro}: USD ${rubro.usdHa.toFixed(2)}/ha (${rubro.pct}% del costo total · USD ${rubro.totalUsd.toLocaleString('es-AR')})`, margin + 2, y + 3);
        y += 4.5;
      });

      y += 6;

      // 5. Dictamen de la Mesa de Decisiones IA si existe
      if (iaDossier) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(6, 78, 59);
        doc.text('3. DICTAMEN DE LA MESA DE DECISIONES ESTRATÉGICAS IA', margin, y);
        y += 5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(30, 41, 59);

        const vetLines = doc.splitTextToSize(`[VETERINARIO]: ${iaDossier.veterinario}`, contentWidth - 4);
        doc.text(vetLines, margin + 2, y);
        y += vetLines.length * 3.5 + 2;

        const agroLines = doc.splitTextToSize(`[AGRÓNOMO]: ${iaDossier.agronomo}`, contentWidth - 4);
        doc.text(agroLines, margin + 2, y);
        y += agroLines.length * 3.5 + 2;

        const consLines = doc.splitTextToSize(`[CONSENSO]: ${iaDossier.consenso_final}`, contentWidth - 4);
        doc.text(consLines, margin + 2, y);
        y += consLines.length * 3.5 + 2;
      }

      // 6. Firmas oficiales
      drawSanJoseSignatureFooter(doc, {
        cargo1: 'Responsable Técnico & Ganadero',
        cargo2: 'Dirección Agroganadera Rincón del Sur S.A.',
      });

      doc.save(`Informe_Gerencial_SanJose_${new Date().toISOString().slice(0, 10)}.pdf`);
      notify?.('✓ Informe Gerencial descargado en PDF.', 'success');
    } catch (err) {
      notify?.(`Error generando PDF: ${err.message}`, 'error');
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Encabezado Principal */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-950 text-emerald-300 shadow-sm">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                  Tablero de Control Gerencial
                </span>
                <span className="text-xs text-slate-400">· Campaña 2026/2027</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">
                Informes Ejecutivos & Mesa de Decisiones IA
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Botón Auditoría SENASA (PDF + Excel) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowReporteCaravanasMenu((prev) => !prev)}
                className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-black flex items-center gap-2 shadow-xs transition active:scale-95 cursor-pointer"
                title="Generar Reporte Oficial PDF o Excel de Auditoría de Caravanas SENASA"
              >
                <FileText className="w-4 h-4 text-emerald-800" />
                <span>📄 Auditoría SENASA</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {showReporteCaravanasMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setShowReporteCaravanasMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 p-1.5 z-30 animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
                      Auditoría RENSPA JS307
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReporteCaravanasMenu(false);
                        generarReportePdfAuditoriaCaravanas({ rodeos, cajasCaravanas, animales, fechaOperacion });
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-emerald-50 text-slate-800 hover:text-emerald-950 text-xs font-bold flex items-center gap-2.5 transition cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-extrabold text-slate-900">Exportar PDF Ejecutivo</div>
                        <div className="text-[10px] text-slate-500 font-normal">A4 oficial con firmas y KPIs</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReporteCaravanasMenu(false);
                        generarExcelMultiHojaCaravanas({ rodeos, cajasCaravanas, animales, fechaOperacion });
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-emerald-50 text-slate-800 hover:text-emerald-950 text-xs font-bold flex items-center gap-2.5 transition cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-extrabold text-slate-900">Exportar Excel Completo (.xlsx)</div>
                        <div className="text-[10px] text-slate-500 font-normal">Libro de 4 solapas auditadas</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              disabled={exportingPdf}
              onClick={handleExportarInformePDF}
              className="px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-2 shadow-sm transition disabled:opacity-50"
            >
              <FileDown className="w-4 h-4 text-emerald-300" />
              <span>{exportingPdf ? 'Generando PDF...' : 'Exportar Informe Gerencial (PDF)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Subnavegación de Solapas Ejecutivas */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/90 pb-3">
        <button
          type="button"
          onClick={() => setActiveSubTab('dinamica_stock')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 ${
            activeSubTab === 'dinamica_stock'
              ? 'bg-emerald-950 text-emerald-300 shadow-md ring-1 ring-emerald-500/30'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
          }`}
        >
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>📊 Dinámica de Stock & Bajas</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('costos_eficiencia')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 ${
            activeSubTab === 'costos_eficiencia'
              ? 'bg-emerald-950 text-emerald-300 shadow-md ring-1 ring-emerald-500/30'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
          }`}
        >
          <Scale className="w-4 h-4 text-emerald-400" />
          <span>💵 Costos & Eficiencia Ganadera</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('mesa_ia')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 ${
            activeSubTab === 'mesa_ia'
              ? 'bg-emerald-950 text-emerald-300 shadow-md ring-1 ring-emerald-500/30'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
          }`}
        >
          <Bot className="w-4 h-4 text-emerald-400" />
          <span>🧠 Mesa de Decisiones IA</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* SOLAPA 1: TABLERO DINÁMICA DE STOCK, BAJAS Y NACIMIENTOS              */}
      {/* ==================================================================== */}
      {activeSubTab === 'dinamica_stock' && (
        <div className="space-y-6">
          {/* Barra de Filtros y Selector de Período */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800">
                      Auditoría de Población & Hacienda
                    </span>
                    <span className="text-xs text-slate-400">· Trazabilidad San José</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-black text-white mt-0.5 tracking-tight">
                    Dinámica de Stock, Bajas & Nacimientos
                  </h3>
                </div>
              </div>

              {/* Selector de Período */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPeriodoStock('7d')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    periodoStock === '7d'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Última Semana (7d)
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodoStock('30d')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    periodoStock === '30d'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Último Mes (30d)
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodoStock('90d')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    periodoStock === '90d'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Últimos 90 días
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodoStock('cortes')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    periodoStock === 'cortes'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Entre Cortes</span>
                </button>
              </div>
            </div>

            {/* Sub-barra cuando periodoStock === 'cortes' */}
            {periodoStock === 'cortes' && (
              <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-slate-400 font-medium">Comparar Corte Inicial:</span>
                  <select
                    value={corteDesdeId}
                    onChange={(e) => setCorteDesdeId(e.target.value)}
                    className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    {snapshotsHacienda.length === 0 && <option value="">Sin cortes guardados</option>}
                    {snapshotsHacienda.map((snap) => (
                      <option key={snap.id} value={snap.id}>
                        {formatFechaAR(snap.fecha_corte)} — {Number(snap.total_cabezas || 0).toLocaleString('es-AR')} cab. ({snap.origen || 'Manual'})
                      </option>
                    ))}
                  </select>

                  <span className="text-slate-400 font-medium">con Corte Final:</span>
                  <select
                    value={corteHastaId}
                    onChange={(e) => setCorteHastaId(e.target.value)}
                    className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="ACTUAL">Stock Actual en Vivo ({totalCabezasActuales.toLocaleString('es-AR')} cab.)</option>
                    {snapshotsHacienda.map((snap) => (
                      <option key={snap.id} value={snap.id}>
                        {formatFechaAR(snap.fecha_corte)} — {Number(snap.total_cabezas || 0).toLocaleString('es-AR')} cab.
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-emerald-400 font-medium">
                  {snapshotsHacienda.length} cortes históricos disponibles
                </div>
              </div>
            )}

            {/* Indicador de Rango Activo */}
            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>Período evaluado:</span>
                <span className="text-slate-200 font-bold">
                  {formatFechaAR(rangoStock.desde)} → {formatFechaAR(rangoStock.hasta)}
                </span>
                <span className="text-slate-500">({rangoStock.label})</span>
              </div>
              <div>
                <span>Stock Actual en Campos San José:</span>{' '}
                <span className="text-emerald-400 font-black">{totalCabezasActuales.toLocaleString('es-AR')} cab.</span>
              </div>
            </div>
          </div>

          {/* 4 TARJETAS KPI DE DINÁMICA DE STOCK */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: VARIACIÓN NETA DE STOCK */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Variación Neta Stock
                </span>
                <div
                  className={`p-2 rounded-xl ${
                    dinamicaStockData.deltaReal >= 0
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {dinamicaStockData.deltaReal >= 0 ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-black tabular-nums ${
                    dinamicaStockData.deltaReal >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {dinamicaStockData.deltaReal >= 0 ? '+' : ''}
                  {dinamicaStockData.deltaReal.toLocaleString('es-AR')} cab.
                </span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    dinamicaStockData.deltaReal >= 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {dinamicaStockData.deltaReal >= 0 ? '+' : ''}
                  {dinamicaStockData.pctVariacion}%
                </span>
              </div>
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 flex items-center justify-between">
                <span>Inicio: {dinamicaStockData.stockInicial.toLocaleString('es-AR')} cab.</span>
                <span>Fin: {dinamicaStockData.stockFinal.toLocaleString('es-AR')} cab.</span>
              </div>
            </div>

            {/* KPI 2: NACIMIENTOS / ALTAS */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Nacimientos & Altas
                </span>
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <Baby className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-emerald-700">
                  +{dinamicaStockData.totalAltas.toLocaleString('es-AR')} cab.
                </span>
                {dinamicaStockData.totalNacimientos > 0 && (
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                    {dinamicaStockData.totalNacimientos} pariciones
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 truncate">
                {Object.keys(dinamicaStockData.nacimientosPorRodeo).length > 0 ? (
                  <span>
                    Rodeos:{' '}
                    {Object.entries(dinamicaStockData.nacimientosPorRodeo)
                      .slice(0, 2)
                      .map(([r, c]) => `${r} (${c})`)
                      .join(', ')}
                  </span>
                ) : (
                  <span>Sin nuevos terneros en este período</span>
                )}
              </div>
            </div>

            {/* KPI 3: BAJAS / MORTANDAD */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Bajas & Mortandad
                </span>
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <Skull className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-rose-700">
                  -{dinamicaStockData.totalBajas.toLocaleString('es-AR')} cab.
                </span>
                <span className="text-xs font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full">
                  Tasa: {dinamicaStockData.tasaMortandad}%
                </span>
              </div>
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 truncate">
                {Object.keys(dinamicaStockData.bajasPorCategoria).length > 0 ? (
                  <span>
                    Afectados:{' '}
                    {Object.entries(dinamicaStockData.bajasPorCategoria)
                      .slice(0, 2)
                      .map(([cat, c]) => `${cat} (${c})`)
                      .join(', ')}
                  </span>
                ) : (
                  <span>0 bajas registradas en el período</span>
                )}
              </div>
            </div>

            {/* KPI 4: VENTAS / REMISIONES EXTERNAS */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Ventas / Salidas
                </span>
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                  <Truck className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-blue-700">
                  {dinamicaStockData.totalVentas.toLocaleString('es-AR')} cab.
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  remitidas
                </span>
              </div>
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 truncate">
                {dinamicaStockData.totalVentas > 0 ? (
                  <span>Salidas a feria o frigorífico</span>
                ) : (
                  <span>Sin salidas comerciales en el período</span>
                )}
              </div>
            </div>
          </div>

          {/* GRÁFICO COMPARATIVO: ALTAS (VERDE) VS BAJAS (ROJO) */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  Balance Dinámico: Altas en Verde vs. Bajas en Rojo
                </h3>
                <p className="text-xs text-slate-500">
                  Evolución de incorporaciones (nacimientos e ingresos) vs pérdidas (mortandad y ventas)
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-bold">
                <span className="flex items-center gap-1.5 text-emerald-700">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500" />
                  Altas ({dinamicaStockData.totalAltas})
                </span>
                <span className="flex items-center gap-1.5 text-rose-700">
                  <span className="w-3 h-3 rounded-sm bg-rose-500" />
                  Bajas ({dinamicaStockData.totalBajas})
                </span>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-3 h-3 rounded-sm bg-slate-300" />
                  Saldo Neto ({dinamicaStockData.deltaReal >= 0 ? '+' : ''}{dinamicaStockData.deltaReal})
                </span>
              </div>
            </div>

            {/* Barras Comparativas */}
            <div className="pt-6 pb-2">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3 sm:gap-4 items-end min-h-[180px] px-2">
                {dinamicaStockData.buckets.map((b) => {
                  const hAltas = Math.min(100, Math.round((b.altas / dinamicaStockData.maxBucketVal) * 100));
                  const hBajas = Math.min(100, Math.round((b.bajas / dinamicaStockData.maxBucketVal) * 100));

                  return (
                    <div key={b.id} className="flex flex-col items-center gap-2 group">
                      {/* Valores flotantes */}
                      <div className="text-[10px] font-black tabular-nums flex items-center gap-1 text-slate-500">
                        <span className="text-emerald-700">+{b.altas}</span>
                        <span>/</span>
                        <span className="text-rose-700">-{b.bajas}</span>
                      </div>

                      {/* Contenedor de las dos barras */}
                      <div className="flex items-end gap-1.5 h-36 w-full max-w-[50px] bg-slate-50 rounded-xl p-1.5 border border-slate-100">
                        {/* Barra Altas */}
                        <div className="flex-1 flex flex-col justify-end h-full">
                          <div
                            className="w-full bg-emerald-500 hover:bg-emerald-400 rounded-md transition-all relative"
                            style={{ height: `${Math.max(hAltas, b.altas > 0 ? 12 : 3)}%` }}
                            title={`Altas: ${b.altas} cab.`}
                          />
                        </div>
                        {/* Barra Bajas */}
                        <div className="flex-1 flex flex-col justify-end h-full">
                          <div
                            className="w-full bg-rose-500 hover:bg-rose-400 rounded-md transition-all relative"
                            style={{ height: `${Math.max(hBajas, b.bajas > 0 ? 12 : 3)}%` }}
                            title={`Bajas: ${b.bajas} cab.`}
                          />
                        </div>
                      </div>

                      {/* Etiqueta del bucket */}
                      <span className="text-[11px] font-bold text-slate-600 truncate max-w-full text-center">
                        {b.label}
                      </span>

                      {/* Badge Neto */}
                      <span
                        className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                          b.neto > 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.neto < 0
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {b.neto > 0 ? `+${b.neto}` : b.neto}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Comentario / Diagnóstico de la dinámica */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs text-slate-700">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>
                  {dinamicaStockData.deltaReal >= 0
                    ? `Crecimiento vegetativo favorable: el rodeo incrementó ${dinamicaStockData.deltaReal} cabezas netas en este período.`
                    : `Ajuste o extracción de hacienda: el rodeo redujo ${Math.abs(dinamicaStockData.deltaReal)} cabezas netas en este período.`}
                </span>
              </div>
              <span className="text-slate-400 text-[11px]">
                Tasa mortandad: <strong className="text-slate-700">{dinamicaStockData.tasaMortandad}%</strong> (Objetivo anual &lt; 2.5%)
              </span>
            </div>
          </div>

          {/* TABLA DETALLADA DE EVENTOS DE MOVIMIENTOS / BAJAS */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-0">
            {/* Cabecera y Filtros de la Tabla */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  Detalle de Movimientos, Bajas & Novedades
                  <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                    {eventosStockFiltrados.length} eventos
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Bitácora de campo registrada en mangas, potreros y recorridas sanitarias
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Buscador */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar por rodeo, causa..."
                    value={busquedaTablaStock}
                    onChange={(e) => setBusquedaTablaStock(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48"
                  />
                </div>

                {/* Filtros por Tipo */}
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 text-xs">
                  {['TODOS', 'NACIMIENTO', 'BAJA', 'VENTA', 'INTERNO'].map((tipo) => (
                    <button
                      key={tipo}
                      type="button"
                      onClick={() => setFiltroTipoTablaStock(tipo)}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                        filtroTipoTablaStock === tipo
                          ? 'bg-emerald-950 text-emerald-300 shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {tipo === 'TODOS'
                        ? 'Todos'
                        : tipo === 'NACIMIENTO'
                        ? 'Nacimientos'
                        : tipo === 'BAJA'
                        ? 'Bajas'
                        : tipo === 'VENTA'
                        ? 'Ventas'
                        : 'Internos'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tabla */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/70 text-[10px] font-black uppercase tracking-wider text-slate-600">
                    <th className="py-2.5 px-4">Fecha</th>
                    <th className="py-2.5 px-4">Tipo de Movimiento</th>
                    <th className="py-2.5 px-4">Rodeo</th>
                    <th className="py-2.5 px-4">Categoría</th>
                    <th className="py-2.5 px-4 text-right">Cabezas</th>
                    <th className="py-2.5 px-4">Motivo / Causa / Observaciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {eventosStockFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        <Activity className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-slate-600">No hay movimientos registrados en este período.</p>
                        <p className="text-[11px] text-slate-400">
                          Probá cambiando el período a 'Últimos 90 días' o agregando novedades desde la solapa de Rodeos.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    eventosStockFiltrados.map((m, idx) => {
                      const tipoRaw = (m.tipo_movimiento || '').toLowerCase();
                      const isNacimiento = tipoRaw.includes('nacimiento') || tipoRaw.includes('alta') || tipoRaw.includes('ingreso');
                      const isBaja = tipoRaw.includes('mortandad') || tipoRaw.includes('baja') || tipoRaw.includes('muert') || tipoRaw.includes('consumo');
                      const isVenta = tipoRaw.includes('venta') || tipoRaw.includes('salida') || tipoRaw.includes('remisi');

                      let badgeClass = 'bg-slate-100 text-slate-800 border-slate-200';
                      if (isNacimiento) badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                      else if (isBaja) badgeClass = 'bg-rose-50 text-rose-800 border-rose-200';
                      else if (isVenta) badgeClass = 'bg-blue-50 text-blue-800 border-blue-200';

                      const fechaStr = formatFechaAR(m.fecha || m.fecha_movimiento || m.created_at);
                      const cabezas = Number(m.cantidad_cabezas) || 0;

                      return (
                        <tr key={m.id || idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-4 font-bold text-slate-800 whitespace-nowrap">
                            {fechaStr}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeClass}`}>
                              {isNacimiento ? '🌱 ' : isBaja ? '✝ ' : isVenta ? '🚚 ' : '⇄ '}
                              {m.tipo_movimiento || 'Movimiento'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-bold text-slate-900">
                            {m.rodeo_nombre || '—'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700 font-medium">
                            {m.categoria_afectada || 'General'}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap">
                            <span
                              className={`font-black text-sm ${
                                isNacimiento
                                  ? 'text-emerald-700'
                                  : isBaja
                                  ? 'text-rose-700'
                                  : isVenta
                                  ? 'text-blue-700'
                                  : 'text-slate-800'
                              }`}
                            >
                              {isNacimiento ? '+' : isBaja || isVenta ? '-' : ''}
                              {cabezas.toLocaleString('es-AR')}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-1">cab.</span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 text-xs max-w-md truncate">
                            {m.motivo_observaciones || m.observaciones || '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tarjeta Ejecutiva: Auditoría Oficial de Caravanas SENASA (RENSPA JS307) */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-950 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <ShieldCheck className="w-6 h-6 text-emerald-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-900 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                      RENSPA JS307 · Oficial SENASA
                    </span>
                    <span className="text-xs text-slate-400">· Conciliación Cuadrada</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 mt-0.5">
                    Auditoría & Trazabilidad Individual de Caravanas
                  </h3>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => generarReportePdfAuditoriaCaravanas({ rodeos, cajasCaravanas, animales, fechaOperacion })}
                  className="px-3.5 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-2 shadow-xs transition active:scale-95 cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-emerald-300" />
                  <span>Descargar PDF Ejecutivo</span>
                </button>
                <button
                  type="button"
                  onClick={() => generarExcelMultiHojaCaravanas({ rodeos, cajasCaravanas, animales, fechaOperacion })}
                  className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-black flex items-center gap-2 shadow-xs transition active:scale-95 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <span>Descargar Excel Completo (.xlsx)</span>
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Resumen consolidado de las 1.600 caravanas oficiales adquiridas ante SENASA/SIGSA por Establecimiento San José. Incluye verificación de balance cuadrado: <strong className="text-slate-800">632 puestas en campo + 430 en stock + 516 salidas + 22 mermas = 1.600 totales</strong>.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase text-slate-500">Total Compradas</div>
                <div className="text-lg font-black text-slate-900 mt-0.5">1.600 <span className="text-xs font-normal text-slate-400">un.</span></div>
                <div className="text-[10px] font-bold text-slate-500 mt-0.5">100% SIGSA</div>
              </div>
              <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase text-emerald-800">Activas en Campo</div>
                <div className="text-lg font-black text-emerald-950 mt-0.5">632 <span className="text-xs font-normal text-slate-400">un.</span></div>
                <div className="text-[10px] font-bold text-emerald-700 mt-0.5">39,5% en rodeos</div>
              </div>
              <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase text-emerald-800">En Stock Físico</div>
                <div className="text-lg font-black text-emerald-950 mt-0.5">430 <span className="text-xs font-normal text-slate-400">un.</span></div>
                <div className="text-[10px] font-bold text-emerald-700 mt-0.5">26,9% sin colocar</div>
              </div>
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase text-amber-800">Salidas / Ventas</div>
                <div className="text-lg font-black text-amber-950 mt-0.5">516 <span className="text-xs font-normal text-slate-400">un.</span></div>
                <div className="text-[10px] font-bold text-amber-700 mt-0.5">32,3% con DT-e</div>
              </div>
              <div className="bg-rose-50/70 border border-rose-200/80 rounded-xl p-3 col-span-2 sm:col-span-1">
                <div className="text-[10px] font-bold uppercase text-rose-800">Mermas / Roturas</div>
                <div className="text-lg font-black text-rose-950 mt-0.5">22 <span className="text-xs font-normal text-slate-400">un.</span></div>
                <div className="text-[10px] font-bold text-rose-700 mt-0.5">1,4% descartadas</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SOLAPA 2: COSTOS & EFICIENCIA GANADERA                               */}
      {/* ==================================================================== */}
      {activeSubTab === 'costos_eficiencia' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 text-slate-900">
        {/* Cabecera y Controles */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  Eficiencia & Rentabilidad Unitaria
                </span>
                <span className="text-xs text-slate-600 font-medium">· Finanzas + Siembras + Rodeos</span>
              </div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 tracking-tight">
                Costo Operativo Unitario & Evolución Interanual
              </h3>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Selector de Campaña */}
            <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-600" />
              <span className="text-[11px] font-semibold text-slate-600">Campaña:</span>
              <select
                value={campanaEficiencia}
                onChange={(e) => setCampanaEficiencia(e.target.value)}
                className="bg-transparent text-xs font-bold text-emerald-800 focus:outline-none cursor-pointer"
              >
                <option value="2026/2027" className="bg-white text-slate-900">2026/2027 (Activa)</option>
                <option value="2025/2026" className="bg-white text-slate-900">2025/2026</option>
                <option value="2024/2025" className="bg-white text-slate-900">2024/2025</option>
              </select>
            </div>

            {/* Switch Infraestructura Mayor (CAPEX) */}
            <button
              type="button"
              onClick={() => setIncluirInfraestructuraMayor(!incluirInfraestructuraMayor)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
                incluirInfraestructuraMayor
                  ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:text-slate-900'
              }`}
              title="Alternar inclusión de inversiones de infraestructura mayor (alambrados nuevos, mangas, molinos)"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{incluirInfraestructuraMayor ? '✓ Con Infraestructura' : '+ Incluir Infraestructura'}</span>
            </button>

            {/* Botón Auditar con IA */}
            <button
              type="button"
              disabled={auditoriaIaLoading}
              onClick={handleConsultarAuditoriaIA}
              className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-900/30 cursor-pointer transition active:scale-95 disabled:opacity-50 border border-emerald-400/30"
            >
              {auditoriaIaLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-200 animate-pulse" />
                  <span>✨ Auditar Esfuerzos con IA</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 1. TRES TARJETAS KPI DE EFICIENCIA GANADERA */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* KPI 1: Costo Operativo Total */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3 relative overflow-hidden shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Costo Operativo Total
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                Campaña {resumenEficiencia.campanaActual}
              </span>
            </div>

            <div>
              <div className="text-3xl font-black text-slate-900 tracking-tight tabular-nums">
                <span className="text-lg font-bold text-emerald-700 mr-1">USD $</span>
                {Math.round(resumenEficiencia.costoTotalActual).toLocaleString('es-AR')}
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                {incluirInfraestructuraMayor
                  ? `Incluye USD ${Math.round(resumenEficiencia.montoCapexActual).toLocaleString('es-AR')} en Inversiones Mayores (CAPEX)`
                  : 'OPEX Puro (excluye inversiones de infraestructura mayor)'}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-600">Vs. {resumenEficiencia.campanaAnterior}:</span>
              {resumenEficiencia.costoTotalAnterior > 0 ? (
                <span className="font-bold text-slate-800">
                  USD ${Math.round(resumenEficiencia.costoTotalAnterior).toLocaleString('es-AR')}{' '}
                  <span className={`text-[10px] font-extrabold ml-1 ${resumenEficiencia.variacionTotalPct <= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    ({resumenEficiencia.variacionTotalPct <= 0 ? '↓' : '↑'}{Math.abs(resumenEficiencia.variacionTotalPct).toFixed(1)}%)
                  </span>
                </span>
              ) : (
                <span className="text-slate-600 font-mono text-[11px]">USD $0 (Sin registros)</span>
              )}
            </div>
          </div>

          {/* KPI 2: Costo por Cabeza */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3 relative overflow-hidden shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Costo Unitario por Cabeza
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                {resumenEficiencia.cabezasActual} cab. activas
              </span>
            </div>

            <div>
              <div className="text-3xl font-black text-slate-900 tracking-tight tabular-nums">
                <span className="text-lg font-bold text-emerald-700 mr-1">USD $</span>
                {resumenEficiencia.costoPorCabAno.toFixed(1)}
                <span className="text-sm font-semibold text-slate-600"> / cab / año</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-bold text-emerald-800 font-mono">
                  USD ${resumenEficiencia.costoPorCabMes.toFixed(1)} / cab / mes
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-600">Equivalente ternero:</span>
              {resumenEficiencia.equivKgTerneroCab > 0 ? (
                <span className="font-bold text-amber-800 font-mono">
                  {resumenEficiencia.equivKgTerneroCab.toFixed(1)} kg / cab / año
                </span>
              ) : (
                <span className="text-slate-600 font-mono text-[11px]">Sin liquidaciones / precio</span>
              )}
            </div>
          </div>

          {/* KPI 3: Costo por Kilo Producido */}
          <div className="bg-slate-950/80 rounded-2xl border border-slate-800 p-5 space-y-3 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Costo por Kilo Producido
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30">
                {resumenEficiencia.ventasRealesCount > 0 ? `${resumenEficiencia.ventasRealesCount} liq.` : 'Sin liquidaciones'}
              </span>
            </div>

            <div>
              <div className="text-3xl font-black text-white tracking-tight tabular-nums flex items-baseline gap-2">
                <div>
                  <span className="text-lg font-bold text-emerald-400 mr-0.5">USD $</span>
                  {resumenEficiencia.kilosProducidos > 0 ? resumenEficiencia.costoPorKg.toFixed(2) : '0.00'}
                  <span className="text-sm font-semibold text-slate-400"> / kg</span>
                </div>
                {resumenEficiencia.kilosProducidos > 0 && resumenEficiencia.precioVentaKg > 0 ? (
                  <div className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${resumenEficiencia.margenKg >= 0 ? 'bg-emerald-900/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'}`}>
                    {resumenEficiencia.margenKg >= 0 ? '+' : ''}${resumenEficiencia.margenKg.toFixed(2)} net/kg
                  </div>
                ) : (
                  <div className="text-[10.5px] font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    Sin liquidaciones
                  </div>
                )}
              </div>

              {/* Inputs Compactos */}
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800/80">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] font-bold text-slate-500 uppercase block">Kilos Vendidos (kg)</label>
                    <span className="text-[9px] text-emerald-400 font-mono font-bold">
                      {resumenEficiencia.kilosProducidos > 0 ? `${Math.round(resumenEficiencia.kilosProducidos).toLocaleString('es-AR')} kg` : '0 kg'}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={kilosProducidosCustom}
                    onChange={(e) => setKilosProducidosCustom(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-white text-right focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] font-bold text-slate-500 uppercase block">Precio Promedio ($/kg)</label>
                    <span className="text-[9px] text-amber-300 font-mono font-bold">
                      {resumenEficiencia.precioVentaKg > 0 ? `USD ${resumenEficiencia.precioVentaKg.toFixed(2)}` : 'Sin liq.'}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={precioVentaKgCustom}
                    onChange={(e) => setPrecioVentaKgCustom(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-emerald-300 text-right focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-500">Margen Total Ciclo:</span>
              {resumenEficiencia.kilosProducidos > 0 && resumenEficiencia.precioVentaKg > 0 ? (
                <span className={`font-mono font-black ${resumenEficiencia.margenTotal >= 0 ? 'text-emerald-300' : 'text-rose-400'}`}>
                  {resumenEficiencia.margenTotal >= 0 ? '+' : '-'}USD ${Math.abs(Math.round(resumenEficiencia.margenTotal)).toLocaleString('es-AR')}
                </span>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]">Sin liquidaciones</span>
              )}
            </div>
          </div>
        </div>

        {/* 2. TABLA COMPARATIVA INTERANUAL Y DESGLOSE POR RUBRO */}
        <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-700" />
                <span>Desglose de Esfuerzos por Rubro (Año vs. Año)</span>
              </h4>
              <p className="text-[11px] text-slate-600">
                Comparativa {resumenEficiencia.campanaActual} vs. {resumenEficiencia.campanaAnterior} sobre 7 centros de costo
              </p>
            </div>
            <span className="text-[11px] font-semibold text-slate-600">
              Base: {resumenEficiencia.cabezasActual} cabezas ({campanaEficiencia})
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600 bg-slate-50/80">
                  <th className="py-2.5 px-4">Centro de Esfuerzo / Rubro</th>
                  <th className="py-2.5 px-3 text-right">Total USD ({resumenEficiencia.campanaActual})</th>
                  <th className="py-2.5 px-3 text-right">USD / Cabeza</th>
                  <th className="py-2.5 px-3 text-right">% Gasto</th>
                  <th className="py-2.5 px-3 text-right text-slate-600">Total USD ({resumenEficiencia.campanaAnterior})</th>
                  <th className="py-2.5 px-4 text-right">Variación Interanual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resumenEficiencia.rubrosComparativa.map((r) => {
                  const Icon = r.icon;
                  const isNegative = r.variacionPct <= 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-800 shrink-0">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-xs">{r.rubro}</div>
                            <div className="text-[10px] text-slate-600 truncate max-w-xs">{r.descripcion}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        USD ${Math.round(r.totalActual).toLocaleString('es-AR')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-800">
                        USD ${r.usdCabActual.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-slate-700 font-semibold">{r.pctActual.toFixed(1)}%</span>
                        <div className="w-16 bg-slate-200 h-1.5 rounded-full ml-auto mt-1 overflow-hidden">
                          <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${Math.max(r.pctActual, 3)}%` }} />
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-600">
                        USD ${Math.round(r.totalAnterior).toLocaleString('es-AR')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {r.totalAnterior === 0 && r.totalActual === 0 ? (
                          <span className="text-slate-500 font-mono text-[11px]">-</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                              isNegative
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {isNegative ? '↓ ' : '↑ '}
                            {Math.abs(r.variacionPct).toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-black text-xs border-t-2 border-slate-300 text-slate-900">
                  <td className="py-3.5 px-4 uppercase tracking-wider">TOTAL OPERATIVO ACUMULADO</td>
                  <td className="py-3.5 px-3 text-right font-mono text-emerald-800">
                    USD ${Math.round(resumenEficiencia.costoTotalActual).toLocaleString('es-AR')}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono text-emerald-800">
                    USD ${resumenEficiencia.costoPorCabAno.toFixed(1)}/cab
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono">100.0%</td>
                  <td className="py-3.5 px-3 text-right font-mono text-slate-700">
                    USD ${Math.round(resumenEficiencia.costoTotalAnterior).toLocaleString('es-AR')}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    {resumenEficiencia.costoTotalAnterior === 0 && resumenEficiencia.costoTotalActual === 0 ? (
                      <span className="text-slate-500 font-mono text-xs">-</span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full text-xs font-black ${
                          resumenEficiencia.variacionTotalPct <= 0
                            ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        {resumenEficiencia.variacionTotalPct <= 0 ? '↓ ' : '↑ '}
                        {Math.abs(resumenEficiencia.variacionTotalPct).toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 3. AUDITORÍA DE ESFUERZOS CON IA */}
        {auditoriaIaResult && (
          <div className="bg-emerald-50/40 border border-emerald-300 rounded-2xl p-5 space-y-4 shadow-sm animate-in fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-emerald-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-700 animate-pulse" />
                <h4 className="text-sm font-black text-slate-900">
                  Auditoría Financiera & Estratégica IA — Campaña {resumenEficiencia.campanaActual} vs. {resumenEficiencia.campanaAnterior}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setAuditoriaIaResult(null)}
                className="text-slate-500 hover:text-slate-900 p-1 rounded-lg cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Diagnóstico Ejecutivo */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 leading-relaxed space-y-2 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                Diagnóstico Ejecutivo del Ciclo
              </span>
              <p>{auditoriaIaResult.diagnostico_ejecutivo}</p>
            </div>

            {/* Concentración de Esfuerzo */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 leading-relaxed shadow-xs">
              <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wider block mb-1">
                Concentración del Esfuerzo de Capital
              </span>
              <p>{auditoriaIaResult.concentracion_esfuerzo}</p>
            </div>

            {/* Rubros Críticos y Palancas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Rubros Críticos */}
              <div className="p-4 rounded-xl bg-white border border-amber-200 space-y-2.5 shadow-xs">
                <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                  Rubros con Mayor Desvío / Alerta
                </span>
                <div className="space-y-2">
                  {(auditoriaIaResult.rubros_criticos_alerta || []).map((rc, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-amber-50/50 border border-amber-200 space-y-1">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>{rc.rubro}</span>
                        <span className="text-amber-800 font-mono text-[11px]">{rc.desvio_pct}</span>
                      </div>
                      <div className="text-[11px] text-slate-700">{rc.analisis}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Palancas Recomendadas */}
              <div className="p-4 rounded-xl bg-white border border-emerald-200 space-y-2.5 shadow-xs">
                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                  Palancas para Reducir el Costo por Kilo
                </span>
                <div className="space-y-2">
                  {(auditoriaIaResult.palancas_reduccion_costo_kg || []).map((p, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-200 space-y-1">
                      <div className="flex items-center justify-between font-bold text-emerald-900 text-[11px]">
                        <span>{p.area}</span>
                        <span className="text-emerald-800 font-mono text-[10px] font-bold">{p.impacto_esperado}</span>
                      </div>
                      <div className="text-[11px] text-slate-700">{p.recomendacion}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Conclusión Directorio */}
            {auditoriaIaResult.conclusion_directorio && (
              <div className="p-3.5 rounded-xl bg-emerald-950 border border-emerald-800 text-xs text-white shadow-sm">
                <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider block mb-1">
                  Síntesis para el Directorio de Agroganadera Rincón del Sur S.A.
                </span>
                <p className="font-medium italic leading-relaxed text-emerald-100">
                  "{auditoriaIaResult.conclusion_directorio}"
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
      )}

      {/* ==================================================================== */}
      {/* SOLAPA 3: MESA DE DECISIONES IA (CONSULTA ESTRATÉGICA CUADRUPLE)      */}
      {/* ==================================================================== */}
      {activeSubTab === 'mesa_ia' && (
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white rounded-2xl p-5 sm:p-6 border border-slate-700 shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-400/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold flex items-center gap-2">
                Mesa de Decisiones IA — Comité Técnico Multidisciplinario
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-700">
                  4 Perspectivas
                </span>
              </h3>
              <p className="text-[11px] text-slate-300">
                Veterinario · Ingeniero Agrónomo · Encargado de Campo · Empresario Agropecuario
              </p>
            </div>
          </div>
        </div>

        {/* Consultas Predeterminadas */}
        <div className="flex flex-wrap gap-2">
          {PRESET_QUERIES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setIaQuery(p.query);
                handleConsultarMesaIA(p.query);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-slate-200 transition text-left flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {/* Input de Consulta Libre */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={iaQuery}
            onChange={(e) => setIaQuery(e.target.value)}
            placeholder="Planteá una duda técnica o de manejo (ej: conveniencia de destete anticipado ante lluvias escasas)..."
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-600 bg-slate-800/90 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConsultarMesaIA();
            }}
          />
          <button
            type="button"
            disabled={consultandoIA || !iaQuery.trim()}
            onClick={() => handleConsultarMesaIA()}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
            <span>{consultandoIA ? 'Evaluando...' : 'Consultar Mesa'}</span>
          </button>
        </div>

        {/* Dictamen Generado */}
        {iaDossier && (
          <div className="mt-4 p-4 rounded-xl bg-slate-800/90 border border-emerald-500/60 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700">
              <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                Dictamen Consensuado del Comité
              </span>
              <button
                type="button"
                onClick={() => setIaDossier(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-200 font-medium italic">
              "{iaDossier.resumen_ejecutivo}"
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900/80 border border-sky-800/60">
                <div className="font-extrabold text-sky-300 flex items-center gap-1.5 mb-1">
                  🩺 Dr. Veterinario Sanitario:
                </div>
                <div className="text-slate-300 text-[11px] leading-relaxed">
                  {iaDossier.veterinario}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/80 border border-emerald-800/60">
                <div className="font-extrabold text-emerald-300 flex items-center gap-1.5 mb-1">
                  🌾 Ing. Agrónomo Forrajero:
                </div>
                <div className="text-slate-300 text-[11px] leading-relaxed">
                  {iaDossier.agronomo}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/80 border border-amber-800/60">
                <div className="font-extrabold text-amber-300 flex items-center gap-1.5 mb-1">
                  🤠 Encargado de Campo:
                </div>
                <div className="text-slate-300 text-[11px] leading-relaxed">
                  {iaDossier.encargado}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/80 border border-purple-800/60">
                <div className="font-extrabold text-purple-300 flex items-center gap-1.5 mb-1">
                  💼 Empresario Agropecuario:
                </div>
                <div className="text-slate-300 text-[11px] leading-relaxed">
                  {iaDossier.empresario}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-emerald-950 border border-emerald-600/80 text-xs">
              <span className="font-black text-emerald-200 uppercase tracking-wider block mb-1">
                ✓ Plan de Acción Recomendado:
              </span>
              <div className="text-white text-[11px] leading-relaxed whitespace-pre-wrap">
                {iaDossier.consenso_final}
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ==================================================================== */}
      {/* 2. CARGA Y DESCANSO FORRAJERO & RADIOGRAFÍA ECONÓMICA (COSTOS)       */}
      {/* ==================================================================== */}
      {activeSubTab === 'costos_eficiencia' && (
        <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Gráfico Comparativo EV/ha vs Receptividad Objetivo */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                Carga Actual (EV/ha) vs. Receptividad Objetivo
              </h3>
              <p className="text-xs text-slate-500">
                Balance forrajero de los principales potreros en pastoreo
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-800" />
                Carga EV/ha
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-slate-300" />
                Obj. 0.90 EV/ha
              </span>
            </div>
          </div>

          {/* Gráfico de Barras SVG Interactivo */}
          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {metricasPotreros.slice(0, 14).map((p) => {
              const maxVal = 2.0;
              const wCarga = Math.min(100, Math.round((p.cargaEvHa / maxVal) * 100));
              const wObj = Math.min(100, Math.round((p.receptividadObj / maxVal) * 100));
              const isSobre = p.cargaEvHa > p.receptividadObj;

              return (
                <div key={p.numero} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="truncate">
                      P#{p.numero} {p.nombre} ({p.ha} ha · {p.ambiente})
                    </span>
                    <span className="tabular-nums font-black text-slate-900">
                      {p.cargaEvHa} EV/ha{' '}
                      <span className="text-[10px] font-normal text-slate-400">
                        / obj {p.receptividadObj}
                      </span>
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isSobre ? 'bg-amber-600' : 'bg-emerald-800'
                        }`}
                        style={{ width: `${Math.max(wCarga, 2)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ranking de Días de Descanso */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-base font-extrabold text-slate-900">
              Ranking de Descanso
            </h3>
            <p className="text-xs text-slate-500">Potreros libres listos para entrar</p>
          </div>

          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {potrerosPorDescanso.slice(0, 10).map((p, idx) => (
              <div
                key={p.numero}
                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-black flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div>
                    <div className="text-xs font-black text-slate-800">
                      P#{p.numero} {p.nombre}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {p.ha} ha · {p.recurso}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                      p.diasDescanso >= 45
                        ? 'bg-emerald-100 text-emerald-900'
                        : p.diasDescanso > 0
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {p.diasDescanso > 0 ? `${p.diasDescanso}d descanso` : 'En pastoreo'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. BENCHMARK ENTRE RODEOS & CONDICIÓN CORPORAL (★)                   */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              Benchmark entre Rodeos ({rodeos.length} Tropas Activas)
            </h3>
            <p className="text-xs text-slate-500">
              Comparativa de condición corporal (★), tamaño de tropa y eficiencia reproductiva
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {benchmarkRodeos.map((r) => {
            const isGood = r.cc >= 3.0;
            const isAlert = r.cc <= 2.5;

            return (
              <div
                key={r.id}
                className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                  isAlert
                    ? 'bg-amber-50/60 border-amber-200'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-900 truncate">
                      {r.nombre}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 px-2 py-0.5 rounded-full bg-slate-100">
                      {r.potrero}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between mt-2">
                    <div className="text-2xl font-black text-slate-900 tabular-nums">
                      {r.total}{' '}
                      <span className="text-xs font-bold text-slate-400">cab.</span>
                    </div>
                    <CondicionCorporalStars value={r.cc} size="sm" showScore={true} />
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-600 grid grid-cols-3 gap-1 text-center">
                    <div>
                      <span className="block text-slate-600 font-medium text-[10px]">Vacas</span>
                      <strong className="text-slate-800">{r.vacas}</strong>
                    </div>
                    <div>
                      <span className="block text-slate-600 font-medium text-[10px]">Terneros</span>
                      <strong className="text-emerald-800">{r.terneros}</strong>
                    </div>
                    <div>
                      <span className="block text-slate-600 font-medium text-[10px]">Toros</span>
                      <strong className="text-slate-800">{r.toros}</strong>
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>Marcación est.: <strong>{r.pctMarcacion}%</strong></span>
                  <span>Relación toros: <strong>{r.pctToros}%</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 4. RADIOGRAFÍA ECONÓMICA (COSTOS USD/HA) Y CLIMA / GASOIL            */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Estructura de Costos por Rubro (USD/ha) */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              Radiografía Económica (USD/ha por Rubro)
            </h3>
            <p className="text-xs text-slate-500">
              Gasto total consolidado: USD {radiografiaEconomica.totalGastosUsd.toLocaleString('es-AR')} (USD {radiografiaEconomica.costoTotalUsdHa.toFixed(2)}/ha)
            </p>
          </div>

          <div className="space-y-3">
            {radiografiaEconomica.rubrosList.map((r) => (
              <div key={r.rubro} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">{r.rubro}</span>
                  <span className="tabular-nums font-black text-slate-900">
                    USD {r.usdHa.toFixed(2)}/ha{' '}
                    <span className="text-[10px] font-normal text-slate-400">
                      ({r.pct}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-800 rounded-full"
                    style={{ width: `${Math.max(r.pct, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-700">
            <span>Margen Neto Operativo:</span>
            <span
              className={`font-black ${
                radiografiaEconomica.margenNetoUsd >= 0
                  ? 'text-emerald-900'
                  : 'text-amber-900'
              }`}
            >
              {radiografiaEconomica.margenNetoUsd >= 0 ? '+' : '-'}USD{' '}
              {Math.abs(radiografiaEconomica.margenNetoUsd).toLocaleString('es-AR')}
            </span>
          </div>
        </div>

        {/* Clima y Curva de Gasoil Mensual */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                Precipitaciones (mm) vs. Consumo Gasoil (L)
              </h3>
              <p className="text-xs text-slate-500">
                Evolución mensual de la campaña 2026/2027
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="flex items-center gap-1.5 text-blue-700">
                <CloudRain className="w-3.5 h-3.5" /> Lluvia
              </span>
              <span className="flex items-center gap-1.5 text-amber-700">
                <Fuel className="w-3.5 h-3.5" /> Gasoil
              </span>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {climaCombustibleMensual.map((m) => (
              <div
                key={m.mes}
                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <span className="font-black text-slate-800 w-16">{m.mes}</span>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="font-extrabold text-blue-700">{m.lluviaMm} mm</span>
                    <span className="block text-[9px] text-slate-600 font-medium">Pluviómetro</span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <div className="text-right">
                    <span className="font-extrabold text-amber-700">
                      {m.gasoilLitros.toLocaleString('es-AR')} L
                    </span>
                    <span className="block text-[9px] text-slate-600 font-medium">Despacho</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
