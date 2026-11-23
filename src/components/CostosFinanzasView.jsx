import React, { useState, useEffect, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  PieChart,
  Plus,
  Trash2,
  Sprout,
  Tags,
  Layers,
  Calendar,
  CheckCircle2,
  Receipt,
  Scale,
  ArrowRight,
  Filter,
  Sparkles,
  Building,
  FileText,
  Landmark,
  ShieldCheck,
  Tag,
  PenTool,
  AlertTriangle,
  FileSpreadsheet,
  Check,
  RefreshCw,
  FileDown,
  Pencil,
  Eye,
  Download,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import { obtenerDolarBlueEnVivo, formatDolarDateTime } from '../lib/dolarService.js';
import { calcResumenRodeosOficial } from './RodeosCaravanasView.jsx';
import GeminiFacturasBatchModal from './GeminiFacturasBatchModal.jsx';
import GeminiLiquidacionModal from './GeminiLiquidacionModal.jsx';
import { confirmAction } from './ConfirmDialog.jsx';
import GeminiBalanceContableModal from './GeminiBalanceContableModal.jsx';
import FacturaDetalleModal from './FacturaDetalleModal.jsx';
import { exportarListadoGastosPDF } from '../utils/pdfHelper.js';

export const RUBROS_GASTOS = [
  'Sanidad / Vacunas',
  'Honorarios Veterinarios',
  'Suplementación / Reservas',
  'Administración / Estructura',
  'Impuestos / Tasas',
  'Infraestructura / Proveedores Externos',
];

const CATEGORIAS_VENTA = [
  'Terneros/as Destete',
  'Terneros Machos',
  'Terneras Hembras',
  'Vacas CUT / Descarte',
  'Vacas Preñadas / Cría',
  'Vaquillonas',
  'Toros Descarte',
  'Novillitos / Recría',
];

const RUBRO_COLORS = {
  'Sanidad / Vacunas': 'bg-sky-600',
  'Honorarios Veterinarios': 'bg-indigo-600',
  'Suplementación / Reservas': 'bg-amber-500',
  'Administración / Estructura': 'bg-slate-700',
  'Impuestos / Tasas': 'bg-rose-600',
  'Infraestructura / Proveedores Externos': 'bg-teal-600',
  'Siembras y Labores Agrícolas': 'bg-emerald-600',
};

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

function getMonthLabel(ym) {
  if (!ym || ym === 'TODOS') return 'Todo el Historial Acumulado';
  if (ym === 'ANIO_ACTUAL') return `Año ${new Date().getFullYear()} Acumulado`;
  const [y, m] = ym.split('-');
  const nombres = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  const idx = parseInt(m, 10) - 1;
  return `${nombres[idx] || m} ${y}`;
}

export default function CostosFinanzasView({
  gastos = [],
  ventas = [],
  laboresSiembras = [],
  balancesContables = [],
  rodeos = [],
  potreros = [],
  animales = [],
  fechaOperacion,
  dolarRef = 1600,
  blueInfo = null,
  onChangeDolarRef,
  onActualizarBlue,
  onNavigate,
  navContext = null,
  onClearNavContext,
  onRefresh,
  notify,
  appMode = 'admin',
  isAdmin,
}) {
  const effectiveIsAdmin = typeof isAdmin === 'boolean'
    ? isAdmin
    : (appMode ? appMode === 'admin' : true);

  if (!effectiveIsAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-lg mx-auto my-12 shadow-sm space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mx-auto text-2xl">
          🔒
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-black text-slate-900">Modo Producción Activo</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            La información financiera, precios y balances contables están restringidos en el modo operativo de campo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate?.('inicio')}
          className="px-4 py-2 rounded-xl bg-emerald-900 text-white text-xs font-bold hover:bg-emerald-800 transition cursor-pointer"
        >
          Volver al Tablero de Campo
        </button>
      </div>
    );
  }

  const defaultDate = fechaOperacion || new Date().toISOString().slice(0, 10);
  const tcDefault = Number(dolarRef) > 0 ? Number(dolarRef) : 1600;

  const [subTab, setSubTab] = useState('gastos'); // 'gastos' | 'ventas' | 'iva' | 'balances' | 'siembras'
  const [selectedPeriod, setSelectedPeriod] = useState('TODOS'); // 'TODOS' | 'ANIO_ACTUAL' | 'YYYY-MM'
  const [filterRubro, setFilterRubro] = useState('TODOS');
  const [showGastoForm, setShowGastoForm] = useState(false);
  const [showFinanzasAcciones, setShowFinanzasAcciones] = useState(false);
  const [showVentaForm, setShowVentaForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingBlue, setLoadingBlue] = useState(false);
  const [liveBlueData, setLiveBlueData] = useState(blueInfo);

  useEffect(() => {
    if (blueInfo) setLiveBlueData(blueInfo);
  }, [blueInfo]);

  // Deep-linking cruzado recibido desde otras secciones o Carga Rápida
  useEffect(() => {
    if (!navContext) return;
    if (navContext.action === 'escanear_factura') {
      setSubTab('gastos');
      setShowGeminiFacturasModal(true);
      onClearNavContext?.();
    }
  }, [navContext, onClearNavContext]);

  async function handleSyncBlue() {
    setLoadingBlue(true);
    try {
      if (onActualizarBlue) {
        await onActualizarBlue(true);
      } else {
        const res = await obtenerDolarBlueEnVivo(true);
        if (res && res.rate) {
          setLiveBlueData(res);
          if (onChangeDolarRef) onChangeDolarRef(String(res.rate));
          setGastoForm((prev) => ({ ...prev, tipo_cambio: String(res.rate) }));
          setVentaForm((prev) => ({ ...prev, tipo_cambio: String(res.rate) }));
          notify(
            `Dólar Blue actualizado: Compra $${res.compra.toLocaleString('es-AR')} / Venta $${res.venta.toLocaleString('es-AR')} (${formatDolarDateTime(res.fechaActualizacion)})`,
            'success'
          );
        }
      }
    } catch (err) {
      notify(`Error al actualizar Dólar Blue: ${err?.message || err}`, 'error');
    } finally {
      setLoadingBlue(false);
    }
  }

  const [showGeminiFacturasModal, setShowGeminiFacturasModal] = useState(false);
  const [showGeminiVentaModal, setShowGeminiVentaModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [selectedEjercicioIva, setSelectedEjercicioIva] = useState('2026/2027');
  const [selectedBalanceId, setSelectedBalanceId] = useState(null);

  // Modal Comprobante / Factura Editable (Sprint L)
  const [selectedGastoDetalle, setSelectedGastoDetalle] = useState(null);
  const [showFacturaModal, setShowFacturaModal] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Formulario Nuevo Gasto
  const [gastoForm, setGastoForm] = useState({
    fecha: defaultDate,
    rubro: 'Sanidad / Vacunas',
    concepto: '',
    proveedor: '',
    comprobante: '',
    moneda_carga: 'ARS',
    tipo_cambio: String(tcDefault),
    monto_original: '',
    potrero_numero: '',
    rodeo_nombre: '',
    estado_pago: 'Pagado',
    observaciones: '',
  });

  // Formulario Nueva Venta de Hacienda
  const [ventaForm, setVentaForm] = useState({
    fecha: defaultDate,
    rodeo_nombre: '',
    categoria: 'Terneros/as Destete',
    cantidad_cabezas: '',
    kilos_totales: '',
    moneda_carga: 'ARS',
    tipo_cambio: String(tcDefault),
    precio_kg: '',
    gastos_comercializacion_ars: '',
    comprador: '',
    destino_consignatario: '',
    observaciones: '',
  });

  // Sincronizar Fecha de Operación global y Dólar Ref. cuando cambian en la barra superior
  useEffect(() => {
    if (fechaOperacion) {
      setGastoForm((prev) => ({ ...prev, fecha: fechaOperacion }));
      setVentaForm((prev) => ({ ...prev, fecha: fechaOperacion }));
    }
  }, [fechaOperacion]);

  useEffect(() => {
    if (dolarRef && Number(dolarRef) > 0) {
      setGastoForm((prev) => ({ ...prev, tipo_cambio: String(dolarRef) }));
      setVentaForm((prev) => ({ ...prev, tipo_cambio: String(dolarRef) }));
    }
  }, [dolarRef]);

  // Superficie Total y Cabezas Activas para indicadores unitarios
  const totalHectareas = useMemo(() => {
    const sum = potreros.reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0);
    return sum > 0 ? sum : 2068.06;
  }, [potreros]);

  const totalCabezasActivas = useMemo(() => {
    const fromRodeos = calcResumenRodeosOficial(rodeos).total;
    if (fromRodeos > 0) return fromRodeos;
    return animales.filter((a) => (a.estado || 'En campo') === 'En campo').length || 1;
  }, [rodeos, animales]);

  // Opciones de Mes / Año disponibles
  const availableMonths = useMemo(() => {
    const set = new Set();
    const curYm = defaultDate.slice(0, 7);
    set.add(curYm);
    gastos.forEach((g) => {
      if (g.fecha && g.fecha.length >= 7) set.add(g.fecha.slice(0, 7));
    });
    ventas.forEach((v) => {
      if (v.fecha && v.fecha.length >= 7) set.add(v.fecha.slice(0, 7));
    });
    laboresSiembras.forEach((l) => {
      if (l.fecha && l.fecha.length >= 7) set.add(l.fecha.slice(0, 7));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [gastos, ventas, laboresSiembras, defaultDate]);

  // Función auxiliar para filtrar por período seleccionado
  function matchesPeriod(fechaStr) {
    if (selectedPeriod === 'TODOS') return true;
    if (!fechaStr) return false;
    if (selectedPeriod === 'ANIO_ACTUAL') {
      const yr = defaultDate.slice(0, 4);
      return fechaStr.startsWith(yr);
    }
    return fechaStr.startsWith(selectedPeriod);
  }

  // Ejercicio Agropecuario Oficial (01 de Agosto a 31 de Julio)
  function getEjercicioAgropecuario(dateStr) {
    if (!dateStr || dateStr.length < 7) return '2026/2027';
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(5, 7), 10);
    if (m >= 8) {
      return `${y}/${y + 1}`;
    } else {
      return `${y - 1}/${y}`;
    }
  }

  // Lista de ejercicios agropecuarios detectados
  const ejerciciosDisponibles = useMemo(() => {
    const s = new Set(['2026/2027', '2025/2026', '2024/2025']);
    gastos.forEach((g) => {
      if (g.fecha) s.add(getEjercicioAgropecuario(g.fecha));
    });
    ventas.forEach((v) => {
      if (v.fecha) s.add(getEjercicioAgropecuario(v.fecha));
    });
    return Array.from(s).sort().reverse();
  }, [gastos, ventas]);

  // Balanza de IVA calculada (Crédito Fiscal vs. Débito Fiscal)
  const balanzaIva = useMemo(() => {
    const gastosIva = gastos.filter((g) => {
      if (selectedEjercicioIva === 'TODOS') return true;
      return getEjercicioAgropecuario(g.fecha) === selectedEjercicioIva;
    });

    const ventasIva = ventas.filter((v) => {
      if (selectedEjercicioIva === 'TODOS') return true;
      return getEjercicioAgropecuario(v.fecha) === selectedEjercicioIva;
    });

    // 1. Crédito Fiscal Compras
    let totalNetoCompras = 0;
    let totalIvaCreditoCompras = 0;
    let totalIva21 = 0;
    let totalIva105 = 0;
    let totalIva27 = 0;
    let totalPercepcionesIva = 0;
    let totalPercepcionesIibb = 0;

    gastosIva.forEach((g) => {
      const isNC =
        Boolean(g.es_nota_credito) ||
        Number(g.monto_ars) < 0 ||
        g.tipo_comprobante?.toLowerCase().includes('crédito') ||
        g.tipo_comprobante?.toLowerCase().includes('credito');
      const sign = isNC ? -1 : 1;
      const arsTotal = Math.abs(Number(g.monto_ars) || 0);

      // Mapeo robusto de campos: monto_iva | iva_monto | iva
      const rawIva = g.monto_iva ?? g.iva_monto ?? g.iva;
      const rawNeto = g.neto_gravado ?? g.neto;
      const rawPercIva = g.percepciones_iva ?? g.percepcion_iva ?? g.perc_iva;
      const rawPercIibb = g.percepciones_iibb ?? g.percepcion_iibb ?? g.perc_iibb;

      let ivaVal = 0;
      let netoVal = 0;
      if (rawIva !== undefined && rawIva !== null && Number(rawIva) !== 0) {
        ivaVal = Math.abs(Number(rawIva));
        netoVal = Math.abs(Number(rawNeto) || (arsTotal - ivaVal));
      } else if (g.tipo_comprobante?.includes('A') || g.comprobante?.startsWith('A')) {
        netoVal = arsTotal / 1.21;
        ivaVal = arsTotal - netoVal;
      } else {
        netoVal = arsTotal;
        ivaVal = 0;
      }

      const percIva = Math.abs(Number(rawPercIva) || 0);
      const percIibb = Math.abs(Number(rawPercIibb) || 0);

      totalNetoCompras += netoVal * sign;
      totalIvaCreditoCompras += ivaVal * sign;
      totalPercepcionesIva += percIva * sign;
      totalPercepcionesIibb += percIibb * sign;

      const alic = Number(g.alicuota_iva) || 21.0;
      if (alic === 10.5) totalIva105 += ivaVal * sign;
      else if (alic === 27.0) totalIva27 += ivaVal * sign;
      else totalIva21 += ivaVal * sign;
    });

    const creditoFiscalTotal = totalIvaCreditoCompras + totalPercepcionesIva;

    // 2. Débito Fiscal Ventas
    let totalNetoVentas = 0;
    let totalIvaDebitoVentas = 0;
    let totalRetencionesIva = 0;

    ventasIva.forEach((v) => {
      const bruto = Number(v.importe_bruto_ars) || Number(v.neto_gravado) || Number(v.ingreso_neto_ars) || 0;
      const rawIva = v.monto_iva ?? v.iva_monto ?? v.iva;
      const rawNeto = v.neto_gravado ?? v.neto ?? v.importe_bruto_ars;

      let ivaDeb = 0;
      let neto = 0;

      if (rawIva !== undefined && rawIva !== null && Number(rawIva) !== 0) {
        ivaDeb = Math.abs(Number(rawIva));
        neto = Math.abs(Number(rawNeto) || bruto);
      } else {
        neto = bruto;
        ivaDeb = bruto * 0.105;
      }

      const ret = Math.abs(Number(v.retenciones_iva ?? v.retencion_iva ?? v.ret_iva) || 0);

      totalNetoVentas += neto;
      totalIvaDebitoVentas += ivaDeb;
      totalRetencionesIva += ret;
    });

    // 3. Balanza / Posición Neta
    const saldoTecnicoNeto = (creditoFiscalTotal + totalRetencionesIva) - totalIvaDebitoVentas;
    const esSaldoAFavor = saldoTecnicoNeto >= 0;

    // 4. Desglose Mensual
    const mesesEjercicio = [];
    if (selectedEjercicioIva !== 'TODOS' && selectedEjercicioIva.includes('/')) {
      const [y1Str, y2Str] = selectedEjercicioIva.split('/');
      const y1 = parseInt(y1Str, 10);
      const y2 = parseInt(y2Str, 10);
      for (let m = 8; m <= 12; m++) {
        mesesEjercicio.push(`${y1}-${String(m).padStart(2, '0')}`);
      }
      for (let m = 1; m <= 7; m++) {
        mesesEjercicio.push(`${y2}-${String(m).padStart(2, '0')}`);
      }
    } else {
      availableMonths.forEach((ym) => {
        if (ym !== 'TODOS' && ym !== 'ANIO_ACTUAL') mesesEjercicio.push(ym);
      });
      mesesEjercicio.sort();
    }

    let acumuladorTecnico = 0;
    const desgloseMensual = mesesEjercicio.map((ym) => {
      const gMes = gastosIva.filter((g) => g.fecha?.startsWith(ym));
      const vMes = ventasIva.filter((v) => v.fecha?.startsWith(ym));

      let compIva = 0;
      let compPerc = 0;
      let compNeto = 0;
      gMes.forEach((g) => {
        const isNC =
          Boolean(g.es_nota_credito) ||
          Number(g.monto_ars) < 0 ||
          g.tipo_comprobante?.toLowerCase().includes('crédito') ||
          g.tipo_comprobante?.toLowerCase().includes('credito');
        const sign = isNC ? -1 : 1;
        const total = Math.abs(Number(g.monto_ars) || 0);

        const rawIva = g.monto_iva ?? g.iva_monto ?? g.iva;
        const rawNeto = g.neto_gravado ?? g.neto;
        const rawPerc = g.percepciones_iva ?? g.percepcion_iva ?? g.perc_iva;

        let iv = 0;
        let nt = 0;
        if (rawIva !== undefined && rawIva !== null && Number(rawIva) !== 0) {
          iv = Math.abs(Number(rawIva));
          nt = Math.abs(Number(rawNeto) || (total - iv));
        } else if (g.tipo_comprobante?.includes('A') || g.comprobante?.startsWith('A')) {
          nt = total / 1.21;
          iv = total - nt;
        } else {
          nt = total;
          iv = 0;
        }
        compIva += iv * sign;
        compPerc += (Math.abs(Number(rawPerc) || 0)) * sign;
        compNeto += nt * sign;
      });

      let venNeto = 0;
      let venIvaDeb = 0;
      let venRet = 0;
      vMes.forEach((v) => {
        const b = Number(v.importe_bruto_ars) || Number(v.neto_gravado) || Number(v.ingreso_neto_ars) || 0;
        const rawIva = v.monto_iva ?? v.iva_monto ?? v.iva;
        const iv = (rawIva !== undefined && rawIva !== null && Number(rawIva) !== 0)
          ? Math.abs(Number(rawIva))
          : (b * 0.105);
        const nt = Math.abs(Number(v.neto_gravado ?? v.neto ?? b));
        const ret = Math.abs(Number(v.retenciones_iva ?? v.retencion_iva ?? v.ret_iva) || 0);

        venNeto += nt;
        venIvaDeb += iv;
        venRet += ret;
      });

      const credMes = compIva + compPerc;
      const saldoMes = (credMes + venRet) - venIvaDeb;
      acumuladorTecnico += saldoMes;

      return {
        mes: ym,
        mesLabel: getMonthLabel(ym),
        comprasNetas: compNeto,
        ivaCredito: compIva,
        percepcionesIva: compPerc,
        totalCreditoFiscal: credMes,
        ventasNetas: venNeto,
        ivaDebito: venIvaDeb,
        retencionesIva: venRet,
        saldoMes,
        saldoAcumulado: acumuladorTecnico,
      };
    });

    return {
      totalNetoCompras,
      totalIvaCreditoCompras,
      totalIva21,
      totalIva105,
      totalIva27,
      totalPercepcionesIva,
      totalPercepcionesIibb,
      creditoFiscalTotal,
      totalNetoVentas,
      totalIvaDebitoVentas,
      totalRetencionesIva,
      saldoTecnicoNeto,
      esSaldoAFavor,
      desgloseMensual,
    };
  }, [gastos, ventas, selectedEjercicioIva, availableMonths]);

  const gastosFiltrados = useMemo(() => {
    return gastos.filter((g) => {
      if (!matchesPeriod(g.fecha)) return false;
      if (filterRubro !== 'TODOS' && g.rubro !== filterRubro) return false;
      return true;
    });
  }, [gastos, selectedPeriod, filterRubro, defaultDate]);

  const gastosPeriodoTodosRubros = useMemo(
    () => gastos.filter((g) => matchesPeriod(g.fecha)),
    [gastos, selectedPeriod, defaultDate]
  );

  const laboresPeriodo = useMemo(
    () => laboresSiembras.filter((l) => matchesPeriod(l.fecha)),
    [laboresSiembras, selectedPeriod, defaultDate]
  );

  const ventasPeriodo = useMemo(
    () => ventas.filter((v) => matchesPeriod(v.fecha)),
    [ventas, selectedPeriod, defaultDate]
  );

  // Cálculos automáticos en vivo del formulario de Gasto
  const gastoPreview = useMemo(() => {
    const orig = parseFloat(gastoForm.monto_original) || 0;
    const tc = parseFloat(gastoForm.tipo_cambio) || tcDefault;
    if (gastoForm.moneda_carga === 'USD') {
      return {
        ars: orig * tc,
        usd: orig,
      };
    }
    return {
      ars: orig,
      usd: tc > 0 ? orig / tc : 0,
    };
  }, [gastoForm.monto_original, gastoForm.moneda_carga, gastoForm.tipo_cambio, tcDefault]);

  // Cálculos automáticos en vivo del formulario de Venta
  const ventaPreview = useMemo(() => {
    const cab = parseInt(ventaForm.cantidad_cabezas, 10) || 0;
    const kgTot = parseFloat(ventaForm.kilos_totales) || 0;
    const precioKg = parseFloat(ventaForm.precio_kg) || 0;
    const tc = parseFloat(ventaForm.tipo_cambio) || tcDefault;
    const gastosCom = parseFloat(ventaForm.gastos_comercializacion_ars) || 0;

    const brutoOrig = kgTot * precioKg;
    const brutoArs = ventaForm.moneda_carga === 'USD' ? brutoOrig * tc : brutoOrig;
    const netoArs = Math.max(0, brutoArs - gastosCom);
    const netoUsd = tc > 0 ? netoArs / tc : 0;
    const kgPorCab = cab > 0 ? kgTot / cab : 0;

    return {
      brutoArs,
      netoArs,
      netoUsd,
      kgPorCab,
    };
  }, [
    ventaForm.cantidad_cabezas,
    ventaForm.kilos_totales,
    ventaForm.precio_kg,
    ventaForm.moneda_carga,
    ventaForm.tipo_cambio,
    ventaForm.gastos_comercializacion_ars,
    tcDefault,
  ]);

  // Totales financieros consolidados del período (Gastos + Siembras vs Ventas)
  const resumenFinanciero = useMemo(() => {
    // 1. Gastos Directos y de Estructura
    const totalGastosDirectosArs = gastosPeriodoTodosRubros.reduce(
      (acc, g) => acc + (Number(g.monto_ars) || 0),
      0
    );
    const totalGastosDirectosUsd = gastosPeriodoTodosRubros.reduce(
      (acc, g) =>
        acc +
        (Number(g.monto_usd) ||
          (Number(g.monto_ars) || 0) / (Number(g.tipo_cambio) || tcDefault)),
      0
    );

    // 2. Costos de Siembras y Labores Agrícolas (integrados automáticamente desde labores_siembras)
    let totalSiembrasArs = 0;
    let totalSiembrasUsd = 0;
    laboresPeriodo.forEach((l) => {
      const ars =
        Number(l.costo_total) ||
        (Number(l.costo_semilla) || 0) +
          (Number(l.costo_fertilizante) || 0) +
          (Number(l.costo_fumigacion) || 0) +
          (Number(l.costo_mano_obra) || 0);
      const tcLab = Number(l.tipo_cambio) > 0 ? Number(l.tipo_cambio) : tcDefault;
      const usd = Number(l.costo_total_usd) > 0 ? Number(l.costo_total_usd) : ars / tcLab;
      totalSiembrasArs += ars;
      totalSiembrasUsd += usd;
    });

    const gastoTotalArs = totalGastosDirectosArs + totalSiembrasArs;
    const gastoTotalUsd = totalGastosDirectosUsd + totalSiembrasUsd;

    // 3. Costos unitarios por Cabeza Activa y por Hectárea (2.068 ha)
    const costoPorCabezaArs =
      totalCabezasActivas > 0 ? gastoTotalArs / totalCabezasActivas : 0;
    const costoPorCabezaUsd =
      totalCabezasActivas > 0 ? gastoTotalUsd / totalCabezasActivas : 0;

    const costoPorHaArs = totalHectareas > 0 ? gastoTotalArs / totalHectareas : 0;
    const costoPorHaUsd = totalHectareas > 0 ? gastoTotalUsd / totalHectareas : 0;

    // 4. Ingresos Netos por Ventas de Hacienda
    const ingresosVentasArs = ventasPeriodo.reduce(
      (acc, v) => acc + (Number(v.ingreso_neto_ars) || 0),
      0
    );
    const ingresosVentasUsd = ventasPeriodo.reduce(
      (acc, v) =>
        acc +
        (Number(v.ingreso_neto_usd) ||
          (Number(v.ingreso_neto_ars) || 0) / (Number(v.tipo_cambio) || tcDefault)),
      0
    );
    const cabezasVendidas = ventasPeriodo.reduce(
      (acc, v) => acc + (Number(v.cantidad_cabezas) || 0),
      0
    );
    const kilosVendidos = ventasPeriodo.reduce(
      (acc, v) => acc + (Number(v.kilos_totales) || 0),
      0
    );

    // 5. Resultado / Margen Operativo
    const margenOperativoArs = ingresosVentasArs - gastoTotalArs;
    const margenOperativoUsd = ingresosVentasUsd - gastoTotalUsd;

    // 6. Distribución por Rubro (los 6 rubros de gastos_campo + Siembras y Labores Agrícolas)
    const rubrosMap = {};
    RUBROS_GASTOS.forEach((r) => {
      rubrosMap[r] = { rubro: r, ars: 0, usd: 0, count: 0 };
    });
    rubrosMap['Siembras y Labores Agrícolas'] = {
      rubro: 'Siembras y Labores Agrícolas',
      ars: totalSiembrasArs,
      usd: totalSiembrasUsd,
      count: laboresPeriodo.length,
    };

    gastosPeriodoTodosRubros.forEach((g) => {
      const key = rubrosMap[g.rubro] ? g.rubro : 'Infraestructura / Proveedores Externos';
      const ars = Number(g.monto_ars) || 0;
      const usd =
        Number(g.monto_usd) || ars / (Number(g.tipo_cambio) > 0 ? Number(g.tipo_cambio) : tcDefault);
      rubrosMap[key].ars += ars;
      rubrosMap[key].usd += usd;
      rubrosMap[key].count += 1;
    });

    const distribucionRubros = Object.values(rubrosMap)
      .map((item) => ({
        ...item,
        pct: gastoTotalArs > 0 ? Math.round((item.ars / gastoTotalArs) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.ars - a.ars);

    return {
      totalGastosDirectosArs,
      totalGastosDirectosUsd,
      totalSiembrasArs,
      totalSiembrasUsd,
      gastoTotalArs,
      gastoTotalUsd,
      costoPorCabezaArs,
      costoPorCabezaUsd,
      costoPorHaArs,
      costoPorHaUsd,
      ingresosVentasArs,
      ingresosVentasUsd,
      cabezasVendidas,
      kilosVendidos,
      margenOperativoArs,
      margenOperativoUsd,
      distribucionRubros,
    };
  }, [
    gastosPeriodoTodosRubros,
    laboresPeriodo,
    ventasPeriodo,
    totalCabezasActivas,
    totalHectareas,
    tcDefault,
  ]);

  // Guardar nuevo gasto en Supabase
  async function handleCreateGasto(e) {
    e.preventDefault();
    if (!gastoForm.concepto.trim()) {
      notify('Ingresá el concepto o descripción del gasto.', 'error');
      return;
    }
    const orig = parseFloat(gastoForm.monto_original) || 0;
    if (orig <= 0) {
      notify('Ingresá un monto mayor a cero.', 'error');
      return;
    }

    setSaving(true);
    try {
      const tc = parseFloat(gastoForm.tipo_cambio) || tcDefault;
      const payload = {
        fecha: gastoForm.fecha || defaultDate,
        rubro: gastoForm.rubro,
        concepto: gastoForm.concepto.trim(),
        proveedor: gastoForm.proveedor.trim() || null,
        comprobante: gastoForm.comprobante.trim() || null,
        moneda_carga: gastoForm.moneda_carga,
        tipo_cambio: tc,
        monto_original: orig,
        monto_ars: Math.round(gastoPreview.ars * 100) / 100,
        monto_usd: Math.round(gastoPreview.usd * 100) / 100,
        potrero_numero: gastoForm.potrero_numero
          ? parseInt(gastoForm.potrero_numero, 10)
          : null,
        rodeo_nombre: gastoForm.rodeo_nombre || null,
        estado_pago: gastoForm.estado_pago || 'Pagado',
        observaciones: gastoForm.observaciones.trim() || null,
      };

      const { error } = await supabase.from('gastos_campo').insert(payload);
      if (error) throw error;

      notify(
        `Gasto "${payload.concepto}" ($${payload.monto_ars.toLocaleString('es-AR')}) registrado en Costos & Finanzas.`,
        'success'
      );
      setGastoForm((prev) => ({
        ...prev,
        concepto: '',
        proveedor: '',
        comprobante: '',
        monto_original: '',
        observaciones: '',
      }));
      await onRefresh();
    } catch (err) {
      notify(`Error al registrar gasto: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGasto(id) {
    const gasto = (gastos || []).find((g) => g.id === id);
    const ok = await confirmAction({
      title: `¿Eliminar gasto de ${gasto?.proveedor || 'este proveedor'}?`,
      description: `Monto: $${Number(gasto?.monto_total || 0).toLocaleString('es-AR')} · Concepto: ${gasto?.concepto || 'Sin concepto'}. Esta acción no se puede deshacer.`,
      confirmText: 'Sí, eliminar gasto',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('gastos_campo').delete().eq('id', id);
      if (error) throw error;
      notify('Gasto eliminado.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error eliminando gasto: ${err.message}`, 'error');
    }
  }

  // Exportar Listado de Gastos a CSV (Excel compatible)
  function handleExportarGastosCSV() {
    try {
      if (!gastosFiltrados || gastosFiltrados.length === 0) {
        notify?.('No hay comprobantes cargados en el filtro actual para exportar.', 'error');
        return;
      }

      // Columnas solicitadas: Fecha, Proveedor, N° Comprobante, Concepto, Rubro, Neto ARS, IVA ARS, Perc. IVA ARS, Total ARS, TC Blue, Total USD, Nota
      const headers = [
        'Fecha',
        'Proveedor',
        'N° Comprobante',
        'Tipo Comprobante',
        'Concepto',
        'Rubro',
        'Imputación',
        'Neto ARS',
        'IVA ARS',
        'Perc. IVA ARS',
        'Total ARS',
        'TC Blue',
        'Total USD',
        'Estado Pago',
        'Nota Útil',
        'Observaciones',
      ];

      const escapeCSV = (val) => {
        if (val == null) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      const rows = gastosFiltrados.map((g) => {
        const isNC = Boolean(g.es_nota_credito || Number(g.monto_ars) < 0);
        const sign = isNC ? -1 : 1;
        const neto = Math.abs(Number(g.neto_gravado) || 0) * sign;
        const iva = Math.abs(Number(g.monto_iva) || 0) * sign;
        const pIva = Math.abs(Number(g.percepciones_iva) || 0) * sign;
        const ars = Math.abs(Number(g.monto_ars) || 0) * sign;
        const usd = Math.abs(Number(g.monto_usd) || 0) * sign;
        const destino = g.potrero_numero ? `Potrero #${g.potrero_numero}` : (g.rodeo_nombre ? `Rodeo: ${g.rodeo_nombre}` : 'General');

        return [
          escapeCSV(g.fecha),
          escapeCSV(g.proveedor || ''),
          escapeCSV(g.comprobante || ''),
          escapeCSV(g.tipo_comprobante || (isNC ? 'Nota de Crédito' : 'Factura')),
          escapeCSV(g.concepto || ''),
          escapeCSV(g.rubro || ''),
          escapeCSV(destino),
          neto.toFixed(2),
          iva.toFixed(2),
          pIva.toFixed(2),
          ars.toFixed(2),
          (Number(g.tipo_cambio) || tcDefault).toFixed(2),
          usd.toFixed(2),
          escapeCSV(g.estado_pago || 'Pagado'),
          escapeCSV(g.nota_manuscrita_util || ''),
          escapeCSV(g.observaciones || ''),
        ].join(';');
      });

      // BOM UTF-8 para Excel
      const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const nowIso = new Date().toISOString().slice(0, 10);
      link.setAttribute('href', url);
      link.setAttribute('download', `gastos_san_jose_${nowIso}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      notify?.(`¡Listado exportado a Excel/CSV con éxito! (${gastosFiltrados.length} filas)`, 'success');
    } catch (err) {
      console.error('Error exportando CSV:', err);
      notify?.(`Error al exportar CSV: ${err.message}`, 'error');
    }
  }

  // Exportar Listado de Gastos a PDF
  async function handleExportarGastosPDF() {
    setExportingPdf(true);
    try {
      if (!gastosFiltrados || gastosFiltrados.length === 0) {
        notify?.('No hay comprobantes cargados en el filtro actual para exportar.', 'error');
        return;
      }

      await exportarListadoGastosPDF(gastosFiltrados, {
        filtroRubro: filterRubro,
        periodoLabel: getMonthLabel(selectedPeriod),
        fechaOperacion: defaultDate,
        dolarRef: tcDefault,
        notify,
      });
    } catch (err) {
      console.error('Error exportando PDF:', err);
      notify?.(`Error al exportar PDF: ${err.message}`, 'error');
    } finally {
      setExportingPdf(false);
    }
  }

  // Guardar nueva Venta de Hacienda en Supabase
  async function handleCreateVenta(e) {
    e.preventDefault();
    const cab = parseInt(ventaForm.cantidad_cabezas, 10) || 0;
    const kg = parseFloat(ventaForm.kilos_totales) || 0;
    const precio = parseFloat(ventaForm.precio_kg) || 0;

    if (cab <= 0 || kg <= 0 || precio <= 0) {
      notify('Completá cabezas, kilos totales y precio por kg mayores a cero.', 'error');
      return;
    }

    setSaving(true);
    try {
      const tc = parseFloat(ventaForm.tipo_cambio) || tcDefault;
      const gastosCom = parseFloat(ventaForm.gastos_comercializacion_ars) || 0;

      const payload = {
        fecha: ventaForm.fecha || defaultDate,
        rodeo_nombre: ventaForm.rodeo_nombre || null,
        categoria: ventaForm.categoria,
        cantidad_cabezas: cab,
        kilos_totales: kg,
        moneda_carga: ventaForm.moneda_carga,
        tipo_cambio: tc,
        precio_kg: precio,
        importe_bruto_ars: Math.round(ventaPreview.brutoArs * 100) / 100,
        gastos_comercializacion_ars: Math.round(gastosCom * 100) / 100,
        ingreso_neto_ars: Math.round(ventaPreview.netoArs * 100) / 100,
        ingreso_neto_usd: Math.round(ventaPreview.netoUsd * 100) / 100,
        comprador: ventaForm.comprador.trim() || null,
        destino_consignatario: ventaForm.destino_consignatario.trim() || null,
        observaciones: ventaForm.observaciones.trim() || null,
      };

      const { error } = await supabase.from('ventas_hacienda').insert(payload);
      if (error) throw error;

      notify(
        `Venta de ${cab} cab. (${payload.categoria}) registrada por $${payload.ingreso_neto_ars.toLocaleString('es-AR')} netos.`,
        'success'
      );
      setVentaForm((prev) => ({
        ...prev,
        cantidad_cabezas: '',
        kilos_totales: '',
        precio_kg: '',
        gastos_comercializacion_ars: '',
        comprador: '',
        destino_consignatario: '',
        observaciones: '',
      }));
      await onRefresh();
    } catch (err) {
      notify(`Error al registrar venta: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteVenta(id) {
    const venta = (ventas || []).find((v) => v.id === id);
    const ok = await confirmAction({
      title: `¿Eliminar liquidación de ${venta?.comprador || 'esta venta'}?`,
      description: `Monto neto: $${Number(venta?.ingreso_neto_ars || 0).toLocaleString('es-AR')}. Se eliminará el registro financiero.`,
      confirmText: 'Sí, eliminar venta',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('ventas_hacienda').delete().eq('id', id);
      if (error) throw error;
      notify('Registro de venta eliminado.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error eliminando venta: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* ENCABEZADO EJECUTIVO DE COSTOS & FINANZAS */}
      <div className="bg-emerald-950 text-white rounded-2xl p-5 sm:p-6 shadow-md border border-emerald-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-emerald-800/90 text-emerald-200 border border-emerald-700">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <div className="inline-flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              <span>Gestión Económica y Margen Operativo</span>
              <span>·</span>
              <span>Dólar Ref: ${tcDefault.toLocaleString('es-AR')} ARS</span>
              <button
                type="button"
                onClick={handleSyncBlue}
                disabled={loadingBlue}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-amber-300 border border-emerald-600 font-extrabold text-[10px] tracking-tight transition active:scale-95 cursor-pointer shadow-xs disabled:opacity-50"
                title={
                  liveBlueData
                    ? `Dólar Blue en Vivo\nCompra: $${Number(liveBlueData.compra || 0).toLocaleString('es-AR')}\nVenta: $${Number(liveBlueData.venta || 0).toLocaleString('es-AR')}\nActualizado: ${formatDolarDateTime(liveBlueData.fechaActualizacion)}`
                    : 'Actualizar cotización Dólar Blue en vivo'
                }
              >
                <RefreshCw className={`w-3 h-3 text-amber-300 ${loadingBlue ? 'animate-spin' : ''}`} />
                <span>🔄 Actualizar Blue</span>
              </button>
              {liveBlueData && (
                <span className="text-[10px] text-amber-200/90 font-medium normal-case">
                  (Compra ${Number(liveBlueData.compra || 0).toLocaleString('es-AR')} / Venta ${Number(liveBlueData.venta || 0).toLocaleString('es-AR')})
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              Costos, Gastos, Siembras & Ventas de Hacienda
            </h2>
            <p className="text-xs text-emerald-200/90 mt-0.5">
              Integra automáticamente los costos de <strong>Siembras & Labores</strong> sin
              duplicar carga, calcula el costo por cabeza activa y por hectárea (
              {totalHectareas.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ha).
            </p>
          </div>
        </div>

        {/* Selector de Período */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-emerald-900/90 border border-emerald-700 rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-emerald-300 shrink-0" />
            <div className="text-xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Período de Análisis
              </div>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="bg-transparent text-white font-extrabold text-xs focus:outline-none cursor-pointer pr-2"
              >
                <option value="TODOS" className="text-slate-900">
                  Todo el Historial Acumulado
                </option>
                <option value="ANIO_ACTUAL" className="text-slate-900">
                  Año Actual ({defaultDate.slice(0, 4)})
                </option>
                {availableMonths.map((ym) => (
                  <option key={ym} value={ym} className="text-slate-900">
                    {getMonthLabel(ym)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 5 TARJETAS KPI FINANCIERAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Gasto Total (Gastos + Siembras) */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Gasto Total ({getMonthLabel(selectedPeriod)})
            </span>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
              ${resumenFinanciero.gastoTotalArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs font-extrabold text-emerald-800 mt-0.5">
              USD {resumenFinanciero.gastoTotalUsd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500 space-y-0.5">
            <div>
              Rubros Campo:{' '}
              <strong className="text-slate-800">
                ${resumenFinanciero.totalGastosDirectosArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </strong>
            </div>
            <div>
              Siembras Auto:{' '}
              <strong className="text-emerald-800">
                ${resumenFinanciero.totalSiembrasArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </strong>
            </div>
          </div>
        </div>

        {/* KPI 2: Costo por Cabeza Activa */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Costo por Cabeza Activa
            </span>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
              ${resumenFinanciero.costoPorCabezaArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              <span className="text-xs font-bold text-slate-500"> /cab</span>
            </div>
            <div className="text-xs font-extrabold text-emerald-800 mt-0.5">
              USD {resumenFinanciero.costoPorCabezaUsd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /cab
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Base activa:</span>
            <strong className="text-slate-800">
              {totalCabezasActivas.toLocaleString('es-AR')} cabezas
            </strong>
          </div>
        </div>

        {/* KPI 3: Costo por Hectárea (2.068 ha) */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Costo por Hectárea ({totalHectareas.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ha)
            </span>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
              ${resumenFinanciero.costoPorHaArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              <span className="text-xs font-bold text-slate-500"> /ha</span>
            </div>
            <div className="text-xs font-extrabold text-emerald-800 mt-0.5">
              USD {resumenFinanciero.costoPorHaUsd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /ha
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Superficie GIS:</span>
            <strong className="text-slate-800">
              {totalHectareas.toLocaleString('es-AR', { maximumFractionDigits: 1 })} ha
            </strong>
          </div>
        </div>

        {/* KPI 4: Ingresos por Ventas de Hacienda */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
              Ingresos Netos Ventas
            </span>
            <div className="text-xl sm:text-2xl font-black text-sky-900 mt-1">
              ${resumenFinanciero.ingresosVentasArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs font-extrabold text-sky-700 mt-0.5">
              USD {resumenFinanciero.ingresosVentasUsd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Vendidas:</span>
            <strong className="text-slate-800">
              {resumenFinanciero.cabezasVendidas} cab. (
              {resumenFinanciero.kilosVendidos.toLocaleString('es-AR')} kg)
            </strong>
          </div>
        </div>

        {/* KPI 5: Resultado / Margen Operativo */}
        <div
          className={`rounded-2xl p-4 sm:p-5 border shadow-sm flex flex-col justify-between ${
            resumenFinanciero.margenOperativoArs >= 0
              ? 'bg-emerald-50/80 border-emerald-300'
              : 'bg-amber-50/80 border-amber-300'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                Resultado / Margen
              </span>
              {resumenFinanciero.margenOperativoArs >= 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-700" />
              ) : (
                <TrendingDown className="w-4 h-4 text-amber-700" />
              )}
            </div>
            <div
              className={`text-xl sm:text-2xl font-black mt-1 ${
                resumenFinanciero.margenOperativoArs >= 0
                  ? 'text-emerald-950'
                  : 'text-amber-950'
              }`}
            >
              {resumenFinanciero.margenOperativoArs >= 0 ? '+' : '-'}$
              {Math.abs(resumenFinanciero.margenOperativoArs).toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })}
            </div>
            <div className="text-xs font-extrabold text-slate-700 mt-0.5">
              {resumenFinanciero.margenOperativoUsd >= 0 ? '+' : '-'}USD{' '}
              {Math.abs(resumenFinanciero.margenOperativoUsd).toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[11px] text-slate-600 font-semibold">
            Ventas Netas menos Gasto Total
          </div>
        </div>
      </div>

      {/* GRÁFICO DE DISTRIBUCIÓN POR RUBRO (INCLUYENDO SIEMBRAS AUTOMÁTICAS) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-900/10 text-emerald-900">
              <PieChart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Distribución de Costos por Rubro ({getMonthLabel(selectedPeriod)})
              </h3>
              <p className="text-xs text-slate-500">
                Participación de los 6 rubros operativos y de estructura + costos automáticos
                de Siembras & Labores
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate && onNavigate('siembras')}
            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 transition"
          >
            <Sprout className="w-3.5 h-3.5 text-emerald-700" />
            Ver Siembras & Labores ({laboresPeriodo.length})
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3.5">
          {resumenFinanciero.distribucionRubros.map((item) => {
            const barColor = RUBRO_COLORS[item.rubro] || 'bg-emerald-700';
            return (
              <div key={item.rubro} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${barColor}`} />
                    <span className="font-bold text-slate-800">{item.rubro}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">
                      {item.count} reg.
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="font-extrabold text-slate-900">
                      ${item.ars.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-800">
                      (USD {item.usd.toLocaleString('es-AR', { maximumFractionDigits: 0 })})
                    </span>
                    <span className="text-slate-400 w-11 text-right font-bold">
                      {item.pct}%
                    </span>
                  </div>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${item.ars > 0 ? Math.max(item.pct, 3) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PESTAÑAS DE OPERACIÓN: GASTOS | VENTAS | BALANZA IVA | BALANCES CONTABLES | SIEMBRAS */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-xl bg-white p-1 border border-slate-200 shadow-sm gap-1">
          <button
            type="button"
            onClick={() => setSubTab('gastos')}
            className={`px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${
              subTab === 'gastos'
                ? 'bg-emerald-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="w-4 h-4" />
            1. Gastos & Comprobantes ({gastosPeriodoTodosRubros.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ventas')}
            className={`px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${
              subTab === 'ventas'
                ? 'bg-emerald-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Scale className="w-4 h-4" />
            2. Ventas Hacienda ({ventasPeriodo.length})
          </button>
          {/* Solapa Balanza IVA (AFIP) oculta según especificación Sprint Q */}
          <button
            type="button"
            onClick={() => setSubTab('balances')}
            className={`px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${
              subTab === 'balances'
                ? 'bg-indigo-950 text-white shadow-sm'
                : 'text-slate-600 hover:text-indigo-950'
            }`}
          >
            <FileText className="w-4 h-4" />
            4. 📄 Balances Contables ({balancesContables.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('siembras')}
            className={`px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition ${
              subTab === 'siembras'
                ? 'bg-emerald-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sprout className="w-4 h-4" />
            5. Siembras ({laboresPeriodo.length})
          </button>
        </div>

        {/* Barra de Acciones Estandarizada: 3 Controles */}
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {/* Control 1 — Botón Primario de Carga Manual (verde sólido #14532d) */}
          <button
            type="button"
            onClick={() => {
              if (subTab !== 'gastos') setSubTab('gastos');
              setShowGastoForm(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f4023] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>+ Nuevo Movimiento</span>
          </button>

          {/* Control 2 — Botón Único de Inteligencia Artificial (✨ Importar con IA) */}
          <button
            type="button"
            onClick={() => setShowGeminiFacturasModal(true)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 hover:from-slate-800 hover:to-emerald-900 text-white font-extrabold text-xs flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
            title="Escanear facturas, tickets, notas de crédito o extractos en lote con IA"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>✨ Importar con IA</span>
          </button>

          {/* Control 3 — Menú Desplegable Compacto (Acciones ▾) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFinanzasAcciones(!showFinanzasAcciones)}
              className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer shrink-0"
            >
              <span>Acciones</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {showFinanzasAcciones && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setShowFinanzasAcciones(false)}
                />
                <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-50 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFinanzasAcciones(false);
                      handleExportarGastosPDF();
                    }}
                    disabled={exportingPdf}
                    className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 font-semibold flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    <FileDown className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{exportingPdf ? 'Generando PDF...' : '📄 Exportar Listado (PDF)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowFinanzasAcciones(false);
                      handleExportarGastosCSV();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 font-semibold flex items-center gap-2 transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>📊 Exportar Excel (.xlsx / CSV)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowFinanzasAcciones(false);
                      setShowBalanceModal(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 text-slate-700 font-semibold flex items-center gap-2 transition cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-indigo-700 shrink-0" />
                    <span>📑 Importar Balance Contable (PDF)</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* SUB-VISTA 1: CARGA Y LISTADO DE GASTOS DE CAMPO */}
      {subTab === 'gastos' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                  Registrar Gasto Operativo / Estructura
                </h3>
                <p className="text-xs text-slate-500">
                  Toma por defecto la Fecha de Operación ({defaultDate}) y el Dólar Ref. ($
                  {tcDefault.toLocaleString('es-AR')}) de la barra superior.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGeminiFacturasModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 hover:from-emerald-900 hover:to-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition hover:scale-105 border border-emerald-500/30"
                  title="Escanear facturas y remitos con Gemini IA"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Importar con Gemini IA (Lote)
                </button>
                <button
                  type="button"
                  onClick={() => setShowGastoForm(!showGastoForm)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  {showGastoForm ? 'Ocultar Formulario' : '+ Mostrar Formulario'}
                </button>
              </div>
            </div>

            {showGastoForm && (
              <form onSubmit={handleCreateGasto} className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Fecha del Gasto *
                    </label>
                    <input
                      type="date"
                      required
                      value={gastoForm.fecha}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, fecha: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Rubro Económico *
                    </label>
                    <select
                      value={gastoForm.rubro}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, rubro: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                    >
                      {RUBROS_GASTOS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Concepto / Descripción del Gasto *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Compra 500 dosis vacuna aftosa + carbunclo / Tacto rodeo cabeza / Rollos..."
                      value={gastoForm.concepto}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, concepto: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Moneda de Carga
                    </label>
                    <select
                      value={gastoForm.moneda_carga}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, moneda_carga: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-extrabold bg-white"
                    >
                      <option value="ARS">Pesos ($ ARS)</option>
                      <option value="USD">Dólares (USD)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Monto ({gastoForm.moneda_carga}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={gastoForm.monto_original}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, monto_original: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-emerald-400 text-xs font-extrabold bg-emerald-50/40"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-bold text-slate-700">
                        Dólar Ref. ($ ARS)
                      </label>
                      <button
                        type="button"
                        onClick={handleSyncBlue}
                        disabled={loadingBlue}
                        className="text-[10px] text-amber-800 hover:text-amber-950 font-extrabold inline-flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                        title="Sincronizar con Dólar Blue en tiempo real"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${loadingBlue ? 'animate-spin' : ''}`} />
                        <span>🔄 Blue</span>
                      </button>
                    </div>
                    <input
                      type="number"
                      step="1"
                      value={gastoForm.tipo_cambio}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, tipo_cambio: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Rodeo Asociado (opc.)
                    </label>
                    <select
                      value={gastoForm.rodeo_nombre}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, rodeo_nombre: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold"
                    >
                      <option value="">General Establecimiento</option>
                      {rodeos.map((r) => (
                        <option key={r.id} value={r.nombre}>
                          {r.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Potrero Asociado (opc.)
                    </label>
                    <select
                      value={gastoForm.potrero_numero}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, potrero_numero: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold"
                    >
                      <option value="">Sin lote específico</option>
                      {potreros.map((p) => (
                        <option key={p.numero} value={p.numero}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-end pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Proveedor / Profesional (opc.)
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Veterinaria Las Flores / Contratista..."
                      value={gastoForm.proveedor}
                      onChange={(e) =>
                        setGastoForm({ ...gastoForm, proveedor: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Conversión Automática:</span>
                    <div className="text-right">
                      <span className="font-black text-slate-900">
                        ${gastoPreview.ars.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS
                      </span>
                      <span className="ml-2 font-bold text-emerald-800">
                        (USD {gastoPreview.usd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition"
                  >
                    <Plus className="w-4 h-4" />
                    {saving ? 'Guardando...' : 'Guardar Gasto en Supabase'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Tabla de Gastos Registrados */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-extrabold text-slate-800">
                  Listado de Gastos ({gastosFiltrados.length})
                </span>
                <span className="text-[10px] text-slate-400 font-semibold hidden sm:inline">
                  · Hacé clic en cualquier fila para ver el Comprobante editable
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={filterRubro}
                  onChange={(e) => setFilterRubro(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                >
                  <option value="TODOS">Todos los Rubros ({RUBROS_GASTOS.length})</option>
                  {RUBROS_GASTOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                {/* BOTÓN EXPORTAR LISTADO (EXCEL/CSV Y PDF) */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExportarGastosCSV}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold flex items-center gap-1.5 border border-slate-300 transition cursor-pointer active:scale-95"
                    title="Exportar listado actual a Excel / CSV con todas las columnas separadas"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
                    <span>Excel / CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportarGastosPDF}
                    disabled={exportingPdf}
                    className="px-3 py-1.5 rounded-lg bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-2xs transition cursor-pointer active:scale-95 disabled:opacity-50"
                    title="Exportar informe oficial de gastos en PDF con membrete y firmas"
                  >
                    <FileDown className="w-3.5 h-3.5 text-emerald-300" />
                    <span>{exportingPdf ? 'PDF...' : '📥 Exportar PDF'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase text-slate-500">
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Rubro</th>
                    <th className="py-3 px-4">Concepto / Proveedor</th>
                    <th className="py-3 px-4">Rodeo / Potrero</th>
                    <th className="py-3 px-4 text-right">Monto $ ARS</th>
                    <th className="py-3 px-4 text-right">Equiv. USD</th>
                    <th className="py-3 px-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gastosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-600 font-medium">
                        No hay gastos cargados en este período/rubro. Usá el formulario superior
                        para registrar el primero.
                      </td>
                    </tr>
                  ) : (
                    gastosFiltrados.map((g) => {
                      const isNC =
                        Boolean(g.es_nota_credito) ||
                        Number(g.monto_ars) < 0 ||
                        g.tipo_comprobante?.toLowerCase().includes('crédito') ||
                        g.tipo_comprobante?.toLowerCase().includes('credito');
                      const montoArs = Number(g.monto_ars || 0);
                      const montoUsd = Number(g.monto_usd || 0);

                      return (
                        <tr
                          key={g.id}
                          onClick={() => {
                            setSelectedGastoDetalle(g);
                            setShowFacturaModal(true);
                          }}
                          className={`hover:bg-emerald-50/50 cursor-pointer transition ${
                            isNC ? 'bg-purple-50/35' : ''
                          }`}
                          title="Hacé clic para ver y editar el comprobante tipo factura"
                        >
                          <td className="py-3 px-4 font-bold text-slate-800 whitespace-nowrap">
                            {formatFechaAR(g.fecha)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-bold text-[11px]">
                              {g.rubro}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isNC && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-100 text-purple-900 border border-purple-300">
                                  🏷️ NC (Descuento)
                                </span>
                              )}
                              <span className="font-bold text-slate-900 hover:text-emerald-800 transition">
                                {g.concepto}
                              </span>
                            </div>
                            {g.proveedor && (
                              <div className="text-[11px] text-slate-500">
                                Prov: {g.proveedor} {g.comprobante ? `(${g.comprobante})` : ''}
                              </div>
                            )}
                            {g.nota_manuscrita_util && (
                              <div className="text-[10px] text-emerald-800 font-bold bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                                ✍️ Nota útil: {g.nota_manuscrita_util}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {g.rodeo_nombre ? `🐄 ${g.rodeo_nombre}` : ''}
                            {g.potrero_numero ? ` · P#${g.potrero_numero}` : ''}
                            {!g.rodeo_nombre && !g.potrero_numero ? 'General' : ''}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-extrabold whitespace-nowrap ${
                              isNC ? 'text-purple-900' : 'text-slate-900'
                            }`}
                          >
                            {isNC ? '-' : ''}$
                            {Math.abs(montoArs).toLocaleString('es-AR', {
                              maximumFractionDigits: 0,
                            })}
                            {g.tdc_fuente && (
                              <span className="block text-[9px] font-bold text-slate-400">
                                TdC: ${g.tipo_cambio} ({g.tdc_fuente.slice(0, 15)})
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-bold whitespace-nowrap ${
                              isNC ? 'text-purple-900' : 'text-emerald-800'
                            }`}
                          >
                            {isNC ? '-' : ''}USD{' '}
                            {Math.abs(montoUsd).toLocaleString('es-AR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedGastoDetalle(g);
                                  setShowFacturaModal(true);
                                }}
                                className="p-1.5 rounded-lg text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50 transition"
                                title="Ver / Editar comprobante editable"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteGasto(g.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                title="Eliminar gasto"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
      )}

      {/* SUB-VISTA 2: REGISTRO Y LISTADO DE VENTAS DE HACIENDA */}
      {subTab === 'ventas' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="p-4 sm:p-5 bg-sky-50/70 border-b border-sky-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                  Registrar Venta / Liquidación de Hacienda
                </h3>
                <p className="text-xs text-slate-600">
                  Calcula automáticamente los kg promedio por cabeza, el importe bruto y el
                  ingreso neto descontando gastos de comercialización.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGeminiVentaModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 hover:from-emerald-900 hover:to-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition hover:scale-105 border border-emerald-500/30"
                  title="Cargar liquidación de venta de hacienda con Gemini IA"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Cargar Venta de Hacienda (IA)
                </button>
                <button
                  type="button"
                  onClick={() => setShowVentaForm(!showVentaForm)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  {showVentaForm ? 'Ocultar Formulario' : '+ Mostrar Formulario'}
                </button>
              </div>
            </div>

            {showVentaForm && (
              <form onSubmit={handleCreateVenta} className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Fecha de Venta *
                    </label>
                    <input
                      type="date"
                      required
                      value={ventaForm.fecha}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, fecha: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Categoría Vendida *
                    </label>
                    <select
                      value={ventaForm.categoria}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, categoria: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                    >
                      {CATEGORIAS_VENTA.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Rodeo Origen (opc.)
                    </label>
                    <select
                      value={ventaForm.rodeo_nombre}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, rodeo_nombre: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold"
                    >
                      <option value="">General Establecimiento</option>
                      {rodeos.map((r) => (
                        <option key={r.id} value={r.nombre}>
                          {r.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Comprador / Consignatario
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Remate Feria Las Flores / Frigorífico..."
                      value={ventaForm.comprador}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, comprador: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Cantidad Cabezas *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder="Ej: 45"
                      value={ventaForm.cantidad_cabezas}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, cantidad_cabezas: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-extrabold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Kilos Totales Balanza *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      placeholder="Ej: 9450"
                      value={ventaForm.kilos_totales}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, kilos_totales: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-extrabold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Moneda Precio / Kg
                    </label>
                    <select
                      value={ventaForm.moneda_carga}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, moneda_carga: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                    >
                      <option value="ARS">$ ARS / kg</option>
                      <option value="USD">USD / kg</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Precio por Kg ({ventaForm.moneda_carga}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="Ej: 2850"
                      value={ventaForm.precio_kg}
                      onChange={(e) =>
                        setVentaForm({ ...ventaForm, precio_kg: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-sky-400 bg-sky-50/40 text-xs font-extrabold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Gastos Comercialización ($ ARS)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Comisión, flete, guías..."
                      value={ventaForm.gastos_comercializacion_ars}
                      onChange={(e) =>
                        setVentaForm({
                          ...ventaForm,
                          gastos_comercializacion_ars: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-center pt-1">
                  <div className="sm:col-span-2 p-3 rounded-xl bg-sky-50 border border-sky-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="text-slate-600 font-semibold">Peso Promedio: </span>
                      <strong className="text-slate-900">
                        {ventaPreview.kgPorCab.toLocaleString('es-AR', {
                          maximumFractionDigits: 1,
                        })}{' '}
                        kg/cab
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-600 font-semibold">Ingreso Neto: </span>
                      <strong className="text-sky-950 text-sm font-black">
                        ${ventaPreview.netoArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS
                      </strong>
                      <span className="ml-2 font-bold text-emerald-800">
                        (USD {ventaPreview.netoUsd.toLocaleString('es-AR', { maximumFractionDigits: 0 })})
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2.5 px-4 rounded-xl bg-sky-800 hover:bg-sky-900 disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {saving ? 'Guardando...' : 'Registrar Venta de Hacienda'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Tabla de Ventas de Hacienda */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase text-slate-500">
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Categoría / Rodeo</th>
                    <th className="py-3 px-4">Comprador</th>
                    <th className="py-3 px-4 text-right">Cabezas / Kg</th>
                    <th className="py-3 px-4 text-right">$/Kg</th>
                    <th className="py-3 px-4 text-right">Ingreso Neto $ ARS</th>
                    <th className="py-3 px-4 text-right">Neto USD</th>
                    <th className="py-3 px-4 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ventasPeriodo.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-600 font-medium">
                        No hay ventas de hacienda registradas en este período.
                      </td>
                    </tr>
                  ) : (
                    ventasPeriodo.map((v) => {
                      const cab = Number(v.cantidad_cabezas) || 0;
                      const kg = Number(v.kilos_totales) || 0;
                      const prom = cab > 0 ? (kg / cab).toFixed(1) : 0;
                      return (
                        <tr key={v.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-bold text-slate-800 whitespace-nowrap">
                            {formatFechaAR(v.fecha)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">{v.categoria}</div>
                            {v.rodeo_nombre && (
                              <div className="text-[11px] text-slate-500">
                                Rodeo: {v.rodeo_nombre}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-700 font-medium">
                            {v.comprador || '-'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="font-extrabold text-slate-900">{cab} cab.</div>
                            <div className="text-[11px] text-slate-500">
                              {kg.toLocaleString('es-AR')} kg ({prom} kg/cab)
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-700 whitespace-nowrap">
                            {v.moneda_carga === 'USD' ? 'USD ' : '$'}
                            {Number(v.precio_kg || 0).toLocaleString('es-AR')}
                          </td>
                          <td className="py-3 px-4 text-right font-black text-sky-900 whitespace-nowrap">
                            ${Number(v.ingreso_neto_ars || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-800 whitespace-nowrap">
                            USD {Number(v.ingreso_neto_usd || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteVenta(v.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                              title="Eliminar venta"
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
      )}

      {/* SUB-VISTA 3: POSICIÓN Y BALANZA DE IVA (CRÉDITO FISCAL VS. DÉBITO FISCAL) */}
      {subTab === 'iva' && (
        <div className="space-y-5">
          {/* Cabecera de Balanza de IVA */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-800">
                  Régimen Fiscal Agropecuario · ARCA / AFIP
                </span>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  Balanza de IVA: Crédito Fiscal vs. Débito Fiscal
                </h3>
                <p className="text-xs text-slate-500">
                  Liquidación técnica acumulada: Compras (IVA + Percepciones RG AFIP) − Ventas (IVA 10,5% Hacienda + Retenciones).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Ejercicio:</span>
              <select
                value={selectedEjercicioIva}
                onChange={(e) => setSelectedEjercicioIva(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-black bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-700"
              >
                <option value="TODOS">Todo el Historial</option>
                {ejerciciosDisponibles.map((ej) => (
                  <option key={ej} value={ej}>
                    Ejercicio {ej} (01/Ago – 31/Jul)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tarjetas KPIs de Balanza de IVA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: IVA Crédito Fiscal Compras */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">
                  IVA Crédito Fiscal (Compras)
                </span>
                <div className="text-xl sm:text-2xl font-black text-emerald-950 mt-1">
                  ${balanzaIva.totalIvaCreditoCompras.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs font-bold text-slate-500 mt-1 space-y-0.5">
                  <div className="flex justify-between">
                    <span>IVA 21%:</span>{' '}
                    <span>${balanzaIva.totalIva21.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IVA 10,5%:</span>{' '}
                    <span>${balanzaIva.totalIva105.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 text-[10px] text-slate-500">
                Neto Gravado: ${balanzaIva.totalNetoCompras.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </div>
            </div>

            {/* KPI 2: Percepciones y Pagos a Cuenta */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800">
                  Percepciones & Retenciones
                </span>
                <div className="text-xl sm:text-2xl font-black text-amber-950 mt-1">
                  ${(balanzaIva.totalPercepcionesIva + balanzaIva.totalRetencionesIva).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs font-bold text-slate-500 mt-1 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Perc. IVA (Compras):</span>{' '}
                    <span>${balanzaIva.totalPercepcionesIva.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ret. IVA (Ventas):</span>{' '}
                    <span>${balanzaIva.totalRetencionesIva.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 text-[10px] text-slate-500">
                Pagos a cuenta computables ante AFIP
              </div>
            </div>

            {/* KPI 3: IVA Débito Fiscal Ventas */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-800">
                  IVA Débito Fiscal (Ventas)
                </span>
                <div className="text-xl sm:text-2xl font-black text-sky-950 mt-1">
                  ${balanzaIva.totalIvaDebitoVentas.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs font-bold text-slate-500 mt-1">
                  Alícuota 10,5% sobre hacienda viva
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 text-[10px] text-slate-500">
                Neto Ventas: ${balanzaIva.totalNetoVentas.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </div>
            </div>

            {/* KPI 4: Posición Neta de IVA */}
            <div
              className={`rounded-2xl p-4 sm:p-5 border shadow-sm flex flex-col justify-between ${
                balanzaIva.esSaldoAFavor
                  ? 'bg-emerald-50 border-emerald-300'
                  : 'bg-rose-50 border-rose-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                    Posición Técnica Neta
                  </span>
                  <ShieldCheck
                    className={`w-4 h-4 ${
                      balanzaIva.esSaldoAFavor ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  />
                </div>
                <div
                  className={`text-xl sm:text-2xl font-black mt-1 ${
                    balanzaIva.esSaldoAFavor ? 'text-emerald-950' : 'text-rose-950'
                  }`}
                >
                  ${Math.abs(balanzaIva.saldoTecnicoNeto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
                <div
                  className={`text-xs font-extrabold mt-0.5 ${
                    balanzaIva.esSaldoAFavor ? 'text-emerald-800' : 'text-rose-800'
                  }`}
                >
                  {balanzaIva.esSaldoAFavor
                    ? '✓ Saldo Técnico a Favor'
                    : '⚠ Saldo a Pagar a AFIP'}
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[10px] text-slate-600 font-semibold">
                {balanzaIva.esSaldoAFavor
                  ? 'No se abona IVA este período (se traslada al mes siguiente)'
                  : 'Importe a ingresar en la declaración jurada mensual'}
              </div>
            </div>
          </div>

          {/* Tabla de Desglose Mensualizado */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-700" />
                  Desglose Mensualizado del Ejercicio ({selectedEjercicioIva})
                </h4>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Estimación referencial según comprobantes cargados en San José (para control interno previo al estudio contable)
                </p>
              </div>

              {/* Selector Rápido de Ejercicio */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
                {['2026/2027', '2025/2026', '2024/2025'].map((ej) => (
                  <button
                    key={ej}
                    type="button"
                    onClick={() => setSelectedEjercicioIva(ej)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      selectedEjercicioIva === ej
                        ? 'bg-indigo-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {ej}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Mes</th>
                    <th className="py-2.5 px-3 text-right">Compras Netas</th>
                    <th className="py-2.5 px-3 text-right">IVA Crédito</th>
                    <th className="py-2.5 px-3 text-right">Perc. IVA</th>
                    <th className="py-2.5 px-3 text-right">Ventas Netas</th>
                    <th className="py-2.5 px-3 text-right">IVA Débito</th>
                    <th className="py-2.5 px-3 text-right">Ret. IVA</th>
                    <th className="py-2.5 px-3 text-right">Saldo Mes</th>
                    <th className="py-2.5 px-3 text-right font-black">Saldo Acumulado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balanzaIva.desgloseMensual.map((m) => {
                    const mesPositivo = m.saldoMes >= 0;
                    const acumPositivo = m.saldoAcumulado >= 0;
                    return (
                      <tr key={m.mes} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-slate-900">{m.mesLabel}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          ${m.comprasNetas.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-800">
                          ${m.ivaCredito.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-800 font-semibold">
                          ${m.percepcionesIva.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          ${m.ventasNetas.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-sky-800">
                          ${m.ivaDebito.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-800 font-semibold">
                          ${m.retencionesIva.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-black ${mesPositivo ? 'text-emerald-800' : 'text-rose-700'}`}>
                          {mesPositivo ? '+' : '-'}${Math.abs(m.saldoMes).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-black ${acumPositivo ? 'text-emerald-950 bg-emerald-50/50' : 'text-rose-950 bg-rose-50/50'}`}>
                          {acumPositivo ? 'A Favor: ' : 'A Pagar: '}${Math.abs(m.saldoAcumulado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VISTA 4: BALANCES CONTABLES AUDITADOS & COMPARATIVA DE GESTIÓN */}
      {subTab === 'balances' && (
        <div className="space-y-5">
          {/* Cabecera Balances */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-950 text-indigo-400">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-800">
                  Estados Contables Oficiales · Auditoría Externa
                </span>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  Balances Contables Anuales & Comparativa de Gestión
                </h3>
                <p className="text-xs text-slate-500">
                  Importá el PDF emitido por el Estudio Contable para contrastar el balance cerrado (31/07) contra los costos y ventas reales de la app.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowBalanceModal(true)}
              className="px-4 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white text-xs font-black shadow-sm transition inline-flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-indigo-300" />
              📄 Importar Balance Contable (PDF)
            </button>
          </div>

          {/* Listado de Balances Guardados o Estado Vacío */}
          {balancesContables.length === 0 ? (
            <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-extrabold text-slate-900">
                No hay Balances Contables guardados todavía
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Hacé clic en el botón superior para procesar el PDF del último ejercicio (ej: 2024/2025 o 2025/2026). Gemini IA extraerá el Estado de Resultados y el cuadro de Hacienda al 31/07 automáticamente.
              </p>
              <button
                type="button"
                onClick={() => setShowBalanceModal(true)}
                className="px-4 py-2 rounded-xl bg-indigo-900 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Cargar Primer Balance en PDF
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Tarjetas de Balances */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {balancesContables.map((b) => {
                  const isSelected = (selectedBalanceId || balancesContables[0]?.id) === b.id;
                  const resEj = Number(b.estado_resultado?.resultado_ejercicio_ars || 0);
                  const cab = Number(b.bienes_de_cambio?.total_cabezas_cierre || 0);

                  return (
                    <div
                      key={b.id}
                      onClick={() => setSelectedBalanceId(b.id)}
                      className={`p-4 rounded-2xl border cursor-pointer transition ${
                        isSelected
                          ? 'bg-indigo-50/70 border-indigo-400 ring-2 ring-indigo-200'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-900">
                          Ejercicio {b.ejercicio}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Cierre: {formatFechaAR(b.fecha_cierre, '31/07')}
                        </span>
                      </div>
                      <h4 className="font-extrabold text-sm text-slate-900 mt-2">
                        {b.razon_social || 'Agroganadera Rincón del Sur S.A.'}
                      </h4>
                      <div className="mt-3 pt-2 border-t border-slate-100 space-y-1 text-xs">
                        <div className="flex justify-between text-slate-600">
                          <span>Hacienda al Cierre:</span>
                          <span className="font-bold text-slate-900">{cab.toLocaleString('es-AR')} cab.</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Resultado Neto:</span>
                          <span className={`font-black ${resEj >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                            ${resEj.toLocaleString('es-AR')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detalle y Comparativa del Balance Seleccionado */}
              {(() => {
                const currentBal =
                  balancesContables.find((b) => b.id === (selectedBalanceId || balancesContables[0]?.id)) ||
                  balancesContables[0];
                if (!currentBal) return null;

                const ventasEnPeriodo = ventas.filter((v) => {
                  if (!v.fecha) return false;
                  return v.fecha >= (currentBal.fecha_inicio || '2024-08-01') && v.fecha <= (currentBal.fecha_cierre || '2025-07-31');
                });
                const totalVentasApp = ventasEnPeriodo.reduce((acc, v) => acc + (Number(v.importe_bruto_ars) || 0), 0);
                const ventasBalance = Number(currentBal.estado_resultado?.ventas_hacienda_ars || 0);
                const diffVentas = totalVentasApp - ventasBalance;

                const cabezasBalance = Number(currentBal.bienes_de_cambio?.total_cabezas_cierre || 0);
                const cabezasActuales = totalCabezasActivas;

                return (
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-2">
                      <div>
                        <h4 className="font-black text-sm text-slate-900">
                          Cuadro Comparativo: Balance Contable vs. Gestión Real ({currentBal.ejercicio})
                        </h4>
                        <p className="text-xs text-slate-500">
                          Contraste entre los valores cerrados por el Estudio Contable y los movimientos operativos de San José.
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-indigo-100 text-indigo-900">
                        {currentBal.archivo_nombre || 'Balance.pdf'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Comparativa Ventas */}
                      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 space-y-2">
                        <span className="text-[10px] font-black uppercase text-slate-500 block">
                          Ventas de Hacienda
                        </span>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-600">Balance Contable:</span>
                          <span className="font-bold text-slate-900">${ventasBalance.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-600">Gestión Real App:</span>
                          <span className="font-bold text-slate-900">${totalVentasApp.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-black">
                          <span>Diferencia:</span>
                          <span className={diffVentas === 0 ? 'text-emerald-800' : 'text-amber-800'}>
                            {diffVentas >= 0 ? '+' : ''}${diffVentas.toLocaleString('es-AR')}
                          </span>
                        </div>
                      </div>

                      {/* Comparativa Cabezas */}
                      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 space-y-2">
                        <span className="text-[10px] font-black uppercase text-slate-500 block">
                          Stock de Cabezas (Bienes de Cambio)
                        </span>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-600">Al Cierre (31/07):</span>
                          <span className="font-bold text-slate-900">{cabezasBalance.toLocaleString('es-AR')} cab.</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-600">Stock Actual en Campo:</span>
                          <span className="font-bold text-slate-900">{cabezasActuales.toLocaleString('es-AR')} cab.</span>
                        </div>
                        <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-black">
                          <span>Evolución:</span>
                          <span className="text-indigo-900">
                            {cabezasActuales >= cabezasBalance ? '+' : ''}{cabezasActuales - cabezasBalance} cab.
                          </span>
                        </div>
                      </div>

                      {/* Valuación Hacienda */}
                      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 space-y-2">
                        <span className="text-[10px] font-black uppercase text-slate-500 block">
                          Valuación Fiscal Hacienda
                        </span>
                        <div className="text-xl font-black text-slate-900">
                          ${Number(currentBal.bienes_de_cambio?.valuacion_hacienda_ars || 0).toLocaleString('es-AR')}
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {currentBal.bienes_de_cambio?.detalle_categorias?.length || 0} categorías inventariadas al cierre fiscal del 31 de Julio.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* SUB-VISTA 5: SIEMBRAS Y LABORES INTEGRADAS AUTOMÁTICAMENTE */}
      {subTab === 'siembras' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 bg-emerald-50/70 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                Costos de Siembras & Labores Agrícolas Integrados ({laboresPeriodo.length})
              </h3>
              <p className="text-xs text-slate-600">
                Estos costos se toman automáticamente de la pestaña{' '}
                <strong>Siembras & Costos</strong> y ya están sumados al Gasto Total del
                establecimiento.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('siembras')}
              className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5"
            >
              <Sprout className="w-4 h-4" />
              Ir a Siembras & Costos
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase text-slate-500">
                  <th className="py-3 px-4">Fecha</th>
                  <th className="py-3 px-4">Potrero(s)</th>
                  <th className="py-3 px-4">Labor / Cultivo</th>
                  <th className="py-3 px-4 text-right">Superficie</th>
                  <th className="py-3 px-4 text-right">Costo Total $ ARS</th>
                  <th className="py-3 px-4 text-right">Equiv. USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {laboresPeriodo.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-600 font-medium">
                      No hay labores ni siembras registradas en este período.
                    </td>
                  </tr>
                ) : (
                  laboresPeriodo.map((l) => {
                    const ars =
                      Number(l.costo_total) ||
                      (Number(l.costo_semilla) || 0) +
                        (Number(l.costo_fertilizante) || 0) +
                        (Number(l.costo_fumigacion) || 0) +
                        (Number(l.costo_mano_obra) || 0);
                    const tcLab =
                      Number(l.tipo_cambio) > 0 ? Number(l.tipo_cambio) : tcDefault;
                    const usd =
                      Number(l.costo_total_usd) > 0
                        ? Number(l.costo_total_usd)
                        : ars / tcLab;
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-bold text-slate-800">{formatFechaAR(l.fecha)}</td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {l.potreros_detalle ||
                            (l.potrero_numero ? `Potrero #${l.potrero_numero}` : 'Gral.')}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-emerald-900">{l.tarea}</span> ·{' '}
                          <span>{l.cultivo_variedad || 'Pastura'}</span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold">
                          {Number(l.hectareas || 0)} ha
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                          ${ars.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-800">
                          USD {usd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tipo Comprobante / Factura Oficial Editable (Sprint L) */}
      {showFacturaModal && selectedGastoDetalle && (
        <FacturaDetalleModal
          isOpen={true}
          gasto={selectedGastoDetalle}
          onClose={() => {
            setShowFacturaModal(false);
            setSelectedGastoDetalle(null);
          }}
          rodeos={rodeos}
          potreros={potreros}
          dolarRef={tcDefault}
          onSaveSuccess={() => {
            onRefresh?.();
          }}
          onDeleteSuccess={() => {
            onRefresh?.();
          }}
          notify={notify}
        />
      )}

      {/* Modales de Inteligencia Artificial Gemini */}
      {showGeminiFacturasModal && (
        <GeminiFacturasBatchModal
          isOpen={true}
          onClose={() => setShowGeminiFacturasModal(false)}
          fechaOperacion={defaultDate}
          dolarRef={tcDefault}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {showGeminiVentaModal && (
        <GeminiLiquidacionModal
          isOpen={true}
          onClose={() => setShowGeminiVentaModal(false)}
          rodeos={rodeos}
          fechaOperacion={defaultDate}
          dolarRef={tcDefault}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {showBalanceModal && (
        <GeminiBalanceContableModal
          isOpen={true}
          onClose={() => setShowBalanceModal(false)}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
    </div>
  );
}
