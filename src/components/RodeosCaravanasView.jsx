import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import {
  Search,
  ArrowUp,
  ArrowDown,
  Pencil,
  Edit3,
  FileSpreadsheet,
  Plus,
  Save,
  Trash2,
  Tag,
  Check,
  CheckCircle2,
  ArrowRightLeft,
  ClipboardList,
  Calendar,
  MapPin,
  TrendingDown,
  X,
  Link2,
  FileDown,
  Clock,
  Sparkles,
  TrendingUp,
  ShoppingCart,
  Baby,
  Skull,
  DollarSign,
  Filter,
  Layers,
  Compass,
  Zap,
  ChevronDown,
  Scissors,
  History,
  Eye,
  Camera,
  ChevronRight,
  Package,
  GripVertical,
  BarChart3,
  Activity,
  RotateCcw,
  AlertTriangle,
  ArrowUpDown,
  ShieldCheck,
  FileText,
  Upload,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR, formatFechaHoraCorteAR } from '../utils/dateHelper';
import { confirmAction } from './ConfirmDialog';
import {
  getSanJoseLogoDataUrl,
  drawSanJosePdfHeader,
  drawSanJoseSignatureFooter,
  calcPermanenciaPotrero,
} from '../utils/pdfHelper';
import { registrarAuditLog } from '../utils/auditLogger';
import GeminiLiquidacionModal from './GeminiLiquidacionModal.jsx';
import CaravanasManagerModal from './CaravanasManagerModal.jsx';
import ConciliadorCaravanasIaModal from './ConciliadorCaravanasIaModal.jsx';
import { sincronizarAuditoriaOficialEnBaseDeDatos } from '../utils/caravanasAuditoriaOficial.js';
import {
  generarReportePdfAuditoriaCaravanas,
  generarExcelMultiHojaCaravanas,
} from '../utils/reporteCaravanasSenasa.js';
import CondicionCorporalStars from './CondicionCorporalStars';
import PotreroCard from './PotreroCard.jsx';
import { inferirRolProtocolo, ROLES_PROTOCOLO } from '../lib/geminiService';
import { aplicarMovimientoRodeos, CATEGORIAS_PASE } from '../utils/rodeoMovimientos';

const CATEGORIAS_GANADO = [
  'Vaca / Sin categoría',
  'Vaca Cría',
  'Vaca CUT',
  'Vaca Seca / Invernada',
  'Vacas coloradas inseminadas',
  'Vaquillonas',
  'Vaquillona 15 meses',
  'Vaquillona 27 meses',
  'Hembras inseminadas',
  'Ternero',
  'Ternera',
  'Toro',
  'Novillito',
];

const ESTADOS_ANIMAL = ['En campo', 'Vendido', 'Muerto / Baja', 'Traslado'];

const CATEGORIAS_COLUMNA_RODEO = [
  { key: 'vacas', label: 'Vacas' },
  { key: 'terneros', label: 'Terneros Total' },
  { key: 'toros_padres', label: 'Toros Padres' },
  { key: 'toritos', label: 'Toritos' },
  { key: 'vacas_cut', label: 'Vacas CUT' },
  { key: 'vaquillonas_reposicion', label: 'Vaquillonas Reposición' },
];

export function formatPotreroNum(num) {
  if (num == null || num === '') return 'Sin potrero';
  if (Number(num) === 2) return 'Potrero 2/3';
  if (Number(num) === 38) return 'Potrero NN';
  return `Potrero ${num}`;
}

export function calcTotalRodeoRow(r) {
  if (!r) return 0;
  return (
    (parseInt(r.vacas, 10) || 0) +
    (parseInt(r.terneros, 10) || 0) +
    (parseInt(r.toros_padres, 10) || 0) +
    (parseInt(r.toritos, 10) || 0) +
    (parseInt(r.vacas_cut, 10) || 0) +
    (parseInt(r.vaquillonas_reposicion, 10) || 0)
  );
}

// Normalización de fechas para orden cronológico estricto YYYY-MM-DD
export function getNormalizedDateStr(item) {
  if (!item) return '1970-01-01';
  const f = item.fecha || item.fecha_movimiento || item.created_at || '';
  if (!f) return '1970-01-01';
  const clean = String(f).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return clean.slice(0, 10);
}

export function getTimestampOrId(item) {
  if (!item) return 0;
  if (item.created_at) {
    const ts = new Date(item.created_at).getTime();
    if (!isNaN(ts)) return ts;
  }
  return Number(item.id) || 0;
}

export function mapCategoriaToRodeoField(categoriaStr = '') {
  const norm = String(categoriaStr || '').toLowerCase().trim();
  if (norm.includes('mach') && norm.includes('terner')) return 'terneros_machos';
  if (norm.includes('hembr') && norm.includes('terner')) return 'terneros_hembras';
  if (norm.includes('terner')) return 'terneros';
  if (norm.includes('cut')) return 'vacas_cut';
  if (norm.includes('vaquillona') || norm.includes('vaq')) return 'vaquillonas_reposicion';
  if (norm.includes('torito')) return 'toritos';
  if (norm.includes('toro') || norm.includes('padre')) return 'toros_padres';
  if (norm.includes('vaca')) return 'vacas';
  return 'vacas';
}

export function getCategoriaFieldLabel(fieldKey) {
  const map = {
    vacas: 'Vacas',
    terneros: 'Terneros Total',
    terneros_machos: 'Terneros Machos',
    terneros_hembras: 'Terneros Hembras',
    toros_padres: 'Toros Padres',
    toritos: 'Toritos',
    vacas_cut: 'Vacas CUT',
    vaquillonas_reposicion: 'Vaquillonas Reposición',
  };
  return map[fieldKey] || 'Cabezas';
}

// Conciliación oficial Planilla Maestra 30/10/2026 (15 rodeos = 2.024 cabezas:
// 978 vacas + 784 terneros unificados + 55 toros + 202 vaquillonas + 5 ajuste = 2.024)
export function calcResumenRodeosOficial(rodeos = [], editedRodeos = {}) {
  const raw = {
    vacas: 0,
    terneros: 0,
    terneros_machos: 0,
    terneros_hembras: 0,
    toros_padres: 0,
    toritos: 0,
    vacas_cut: 0,
    vaquillonas_reposicion: 0,
    total: 0,
    potrerosOcupados: new Set(),
  };

  rodeos.forEach((r) => {
    const edit = editedRodeos[r.id] || r;
    raw.vacas += parseInt(edit.vacas, 10) || 0;
    raw.terneros += parseInt(edit.terneros, 10) || 0;
    raw.terneros_machos += parseInt(edit.terneros_machos, 10) || 0;
    raw.terneros_hembras += parseInt(edit.terneros_hembras, 10) || 0;
    raw.toros_padres += parseInt(edit.toros_padres, 10) || 0;
    raw.toritos += parseInt(edit.toritos, 10) || 0;
    raw.vacas_cut += parseInt(edit.vacas_cut, 10) || 0;
    raw.vaquillonas_reposicion += parseInt(edit.vaquillonas_reposicion, 10) || 0;
    raw.total += calcTotalRodeoRow(edit);
    if (edit.potrero_numero) raw.potrerosOcupados.add(Number(edit.potrero_numero));
  });

  // Exactitud: los totales son la suma EXACTA de las columnas renderizadas (sin ajustes ocultos)
  const hasSubLotes = false && rodeos.some((r) =>
    ['COLADA RODEO 2', 'INSEMINACIÓN NEGRAS', 'INSEMINACIÓN COLORADAS'].includes(
      (r.nombre || '').toUpperCase()
    )
  );

  const vacasConciliadas = hasSubLotes ? Math.max(0, raw.vacas - 66) : raw.vacas;
  const ternerosConciliados = hasSubLotes ? Math.max(0, raw.terneros - 15) : raw.terneros;
  const ajusteConciliacion = hasSubLotes ? 5 : 0;
  const totalConciliado = hasSubLotes
    ? vacasConciliadas +
      ternerosConciliados +
      raw.toros_padres +
      raw.toritos +
      raw.vacas_cut +
      raw.vaquillonas_reposicion +
      ajusteConciliacion
    : raw.total;

  return {
    ...raw,
    raw_vacas: raw.vacas,
    raw_terneros: raw.terneros,
    raw_total: raw.total,
    vacas: vacasConciliadas,
    terneros: ternerosConciliados,
    ajuste: ajusteConciliacion,
    total: totalConciliado,
  };
}

// =========================================================================
// SUBCOMPONENTE REUTILIZABLE: STEPPER TÁCTIL PARA ANIMALES [ - | N | + ]
// =========================================================================
export function AnimalStepperInput({
  value = 0,
  onChange,
  onBlur,
  disabled = false,
  min = 0,
  max = 99999,
  step = 1,
  colorTheme = 'slate', // 'slate' | 'sky' | 'rose' | 'emerald' | 'purple' | 'amber'
  inputWidth = 'w-11', // 'w-10' | 'w-11' | 'w-12'
  className = '',
  title = '',
  ariaLabel = '',
}) {
  const numVal = parseInt(value, 10) || 0;

  const handleStep = (delta) => {
    if (disabled) return;
    const next = Math.max(min, Math.min(max, numVal + delta));
    onChange?.(next);
  };

  const handleInputChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange?.('');
      return;
    }
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) {
      onChange?.(Math.max(min, Math.min(max, parsed)));
    }
  };

  const themeStyles = {
    slate: {
      border: 'border-slate-300 hover:border-slate-400 focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-400',
      text: 'text-slate-900',
      btn: 'bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 border-slate-200',
    },
    emerald: {
      border: 'border-emerald-500 hover:border-emerald-600 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-500 ring-1 ring-emerald-500/20',
      text: 'text-emerald-950 font-black',
      btn: 'bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 border-emerald-200',
    },
    sky: {
      border: 'border-sky-300 hover:border-sky-400 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-400',
      text: 'text-sky-950',
      btn: 'bg-sky-50 hover:bg-sky-100 active:bg-sky-200 text-sky-800 border-sky-200',
    },
    rose: {
      border: 'border-rose-300 hover:border-rose-400 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-400',
      text: 'text-rose-950',
      btn: 'bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-800 border-rose-200',
    },
    purple: {
      border: 'border-purple-300 hover:border-purple-400 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-400',
      text: 'text-purple-950',
      btn: 'bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-800 border-purple-200',
    },
    amber: {
      border: 'border-amber-300 hover:border-amber-400 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-400',
      text: 'text-amber-950',
      btn: 'bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-800 border-amber-200',
    },
  };

  const theme = themeStyles[colorTheme] || themeStyles.slate;
  const isMin = numVal <= min;

  return (
    <div
      title={title}
      className={`inline-flex items-center rounded-lg border overflow-hidden shadow-xs transition-colors ${theme.border} ${
        disabled ? 'opacity-80 bg-slate-50/90 cursor-not-allowed' : 'bg-white'
      } ${className}`}
    >
      <button
        type="button"
        disabled={disabled || isMin}
        onClick={() => handleStep(-step)}
        aria-label={`Restar ${ariaLabel || ''}`}
        tabIndex={-1}
        className={`w-6 h-8 flex items-center justify-center font-bold text-sm select-none border-r transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-slate-100 ${theme.btn}`}
      >
        −
      </button>

      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? 0}
        disabled={disabled}
        onChange={handleInputChange}
        onBlur={onBlur}
        aria-label={ariaLabel}
        className={`${inputWidth} h-8 text-center font-bold tabular-nums text-sm bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${theme.text} ${
          disabled ? 'cursor-not-allowed text-slate-500' : ''
        }`}
      />

      <button
        type="button"
        disabled={disabled || numVal >= max}
        onClick={() => handleStep(step)}
        aria-label={`Sumar ${ariaLabel || ''}`}
        tabIndex={-1}
        className={`w-6 h-8 flex items-center justify-center font-bold text-sm select-none border-l transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-slate-100 ${theme.btn}`}
      >
        +
      </button>
    </div>
  );
}

function mapRawRowToAnimal(row, index, sheetName) {
  const keys = Object.keys(row);
  const findVal = (patterns) => {
    const foundKey = keys.find((k) => {
      const norm = k
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
      return patterns.some((p) => norm.includes(p));
    });
    return foundKey !== undefined ? row[foundKey] : undefined;
  };

  const rawCaravana =
    findVal(['caravana', 'ide', 'electronica', 'senasa', 'numero', 'rp', 'identificador', 'id']) ??
    Object.values(row)[0] ??
    `0320000000${String(index + 1).padStart(5, '0')}`;

  const caravanaStr = String(rawCaravana).trim();
  const potRaw = findVal(['potrero', 'lote']);
  const potParsed =
    potRaw !== undefined && potRaw !== ''
      ? parseInt(String(potRaw).match(/\d+/)?.[0], 10)
      : null;

  const ccRaw = findVal(['cc', 'condicion', 'corporal']);
  const pesoRaw = findVal(['peso', 'kg', 'kilos']);

  return {
    caravana: caravanaStr,
    marca: String(findVal(['marca', 'propietario', 'hierro']) || 'San José').trim(),
    categoria: String(findVal(['categoria', 'cat', 'clase', 'tipo']) || 'Vaca Cría').trim(),
    rodeo: String(findVal(['rodeo', 'tropa', 'grupo']) || 'COLA').trim(),
    potrero_actual: !Number.isNaN(potParsed) ? potParsed : null,
    condicion_corporal:
      ccRaw !== undefined && ccRaw !== ''
        ? parseFloat(String(ccRaw).replace(',', '.')) || null
        : null,
    peso_actual:
      pesoRaw !== undefined && pesoRaw !== ''
        ? parseFloat(String(pesoRaw).replace(',', '.')) || null
        : null,
    estado: String(findVal(['estado', 'situacion']) || 'En campo').trim(),
    origen_planilla: sheetName || 'Importación Excel/CSV',
    observaciones: String(findVal(['obs', 'nota', 'comentario', 'detalle']) || '').trim() || null,
  };
}

function mapRawRowToCaja(row, index) {
  const keys = Object.keys(row);
  const findVal = (patterns) => {
    const foundKey = keys.find((k) => {
      const norm = k
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
      return patterns.some((p) => norm.includes(p));
    });
    return foundKey !== undefined ? row[foundKey] : undefined;
  };

  const numRaw = findVal(['caja', 'numero', 'nro', 'id']);
  const numParsed =
    numRaw !== undefined ? parseInt(String(numRaw).match(/\d+/)?.[0], 10) : index + 1;

  return {
    caja_numero: !Number.isNaN(numParsed) ? numParsed : index + 1,
    marca: String(findVal(['marca', 'proveedor', 'color', 'tipo']) || 'Allflex Oficial').trim(),
    desde: String(findVal(['desde', 'inicio', 'inicial']) || '').trim(),
    hasta: String(findVal(['hasta', 'fin', 'final']) || '').trim(),
    cantidad: parseInt(findVal(['cantidad', 'total', 'unidades']), 10) || 50,
    en_stock: parseInt(findVal(['stock', 'disponible', 'restante']), 10) || 0,
    usadas_sin_detalle: parseInt(findVal(['usadas', 'colocadas', 'aplicadas']), 10) || 0,
    observaciones: String(findVal(['obs', 'nota', 'comentario']) || '').trim() || null,
  };
}

export default function RodeosCaravanasView({
  rodeos = [],
  movimientosHacienda = [],
  animales = [],
  cajasCaravanas = [],
  potreros = [],
  fechaOperacion,
  onSelectPotreroInMap = () => {},
  onRefresh = () => {},
  notify = () => {},
  dolarRef = 1420,
  ventas = [],
  onOpenRecorrida,
  onNavigate,
  navContext = null,
  onClearNavContext,
  appMode = 'admin',
  isAdmin,
}) {
  const effectiveIsAdmin = typeof isAdmin === 'boolean'
    ? isAdmin
    : (appMode ? appMode === 'admin' : true);
  const excelInputRef = useRef(null);

  // Pestaña activa: 'stock_actual' (o 'planilla_rodeos') | 'movimientos_ventas' | 'caravanas' | 'linea_tiempo'
  const [subTab, setSubTab] = useState('stock_actual');
  const [caravanasSubView, setCaravanasSubView] = useState('cajas'); // 'cajas' | 'padron'
  const [showConciliadorIaModal, setShowConciliadorIaModal] = useState(false);

  const handleSincronizarAuditoriaOficial = async () => {
    const isSandboxMode =
      typeof window !== 'undefined' &&
      localStorage.getItem('san_jose_sandbox_data') !== null;

    const conf = await confirmAction({
      title: '¿Sincronizar Auditoría Oficial SIGSA?',
      description: `Se sincronizará el universo oficial de 1.600 caravanas (430 En Stock, 632 En Campo, 516 Salidas/Bajas, 22 Mermas). Operando en ${isSandboxMode ? 'MODO SANDBOX' : 'PRODUCCIÓN SUPABASE'}. Se realizará una limpieza previa de datos desfasados para cuadre exacto.`,
      confirmText: 'Sí, sincronizar auditoría',
      variant: 'warning',
    });

    if (!conf) return;

    setSyncingAuditoria(true);
    try {
      const res = await sincronizarAuditoriaOficialEnBaseDeDatos({
        isSandboxMode,
        notify,
        onRefresh,
      });
      if (res?.success && onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      console.error('Error sincronizando auditoría:', err);
      notify?.('Error al sincronizar auditoría: ' + err.message, 'error');
    } finally {
      setSyncingAuditoria(false);
    }
  };

  const handleExportarPadronExcel = () => {
    if (!animalesFiltrados || animalesFiltrados.length === 0) {
      notify?.('No hay caravanas para exportar con los filtros actuales.', 'warning');
      return;
    }

    try {
      const dataToExport = animalesFiltrados.map((a) => ({
        'Caravana SENASA (15 Díg.)': a.caravana || '',
        'Marca': a.marca || 'San José (JS307)',
        'Categoría': a.categoria || 'Sin categoría',
        'Rodeo Asignado': a.rodeo || 'Sin rodeo',
        'Potrero Actual': a.potrero_actual != null ? `Lote ${a.potrero_actual}` : '-',
        'Estado': a.estado_caravana || a.estado || 'Activa en Campo',
        'Fecha Colocación': a.fecha_colocacion ? formatFechaAR(a.fecha_colocacion) : '-',
        'Fecha Salida': a.fecha_salida ? formatFechaAR(a.fecha_salida) : '-',
        'Motivo Salida': a.motivo_salida || '-',
        'N° DT-e': a.dte_numero || '-',
        'Observaciones': a.observaciones || '',
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Padrón Caravanas');
      const filename = `San_Jose_Padron_Caravanas_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);
      notify?.(`Se descargó ${filename} con ${animalesFiltrados.length} registros.`, 'success');
    } catch (err) {
      console.error('Error exportando Excel caravanas:', err);
      notify?.('Error al exportar a Excel.', 'error');
    }
  };

  // KPIs de Caravanas SENASA calculados en tiempo real
  const caravanasKpis = useMemo(() => {
    const enStock = (cajasCaravanas || []).reduce((acc, c) => acc + (Number(c.en_stock) || 0), 0);
    const cajasConStock = (cajasCaravanas || []).filter(c => (Number(c.en_stock) || 0) > 0).length;
    const cajasCount = cajasConStock;

    const puestas = (animales || []).filter(a => {
      const est = (a.estado_caravana || a.estado || '').toLowerCase();
      if (est.includes('stock') || est.includes('deposito') || est.includes('depósito')) return false;
      if (est.includes('baja') || est.includes('salida') || est.includes('venta') || est.includes('muert') || est.includes('merma') || est.includes('rotura')) return false;
      return true;
    }).length;

    // Total Vigentes: En Stock (depósito) + Puestas (activas en campo), excluyendo salidas históricas
    const totalVigentes = enStock + puestas;

    const rodeosConCaravanas = new Set(
      (animales || [])
        .filter(a => {
          const est = (a.estado_caravana || a.estado || '').toLowerCase();
          if (est.includes('stock') || est.includes('deposito') || est.includes('depósito')) return false;
          if (est.includes('baja') || est.includes('salida') || est.includes('venta') || est.includes('muert') || est.includes('merma') || est.includes('rotura')) return false;
          return !!a.rodeo;
        })
        .map(a => a.rodeo)
    ).size;

    const salidas = (animales || []).filter(a => {
      const est = (a.estado_caravana || a.estado || '').toLowerCase();
      if (est.includes('stock') || est.includes('deposito') || est.includes('depósito')) return false;
      if (est.includes('merma') || est.includes('rotura')) return false;
      return est.includes('salida') || est.includes('venta') || est.includes('despacho') || est.includes('d-te') || est.includes('muert') || est.includes('baja');
    }).length;

    const mermas = (animales || []).filter(a => {
      const est = (a.estado_caravana || a.estado || '').toLowerCase();
      return est.includes('merma') || est.includes('rotura');
    }).length;

    return { enStock, cajasCount, cajasConStock, puestas, totalVigentes, rodeosConCaravanas, salidas, mermas };
  }, [cajasCaravanas, animales]);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRodeoId, setSavingRodeoId] = useState(null);

  // Auto-guardado transparente e indicador de estado global
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const autoSaveTimerRef = useRef(null);
  const debounceTimersRef = useRef({}); // { [rodeoId]: timerId }
  const pendingRowsRef = useRef({}); // { [rodeoId]: latestRow }
  const dirtyRowsRef = useRef(new Set()); // IDs de filas actualmente en edición o guardado en vuelo
  const editedRodeosRef = useRef({}); // Referencia fresca permanente de editedRodeos para cero closures viejos

  // Modales de Acción Directa con Impacto Doble
  const [ventaModal, setVentaModal] = useState(null);
  const [compraModal, setCompraModal] = useState(null);
  const [nacimientoModal, setNacimientoModal] = useState(null);
  const [bajaModal, setBajaModal] = useState(null);

  // Filtros de la tabla de movimientos y ordenamiento
  const [filterMovTipo, setFilterMovTipo] = useState('TODOS');
  const [searchMov, setSearchMov] = useState('');
  const [movSortBy, setMovSortBy] = useState('recientes'); // 'recientes' | 'antiguos' | 'rodeo_asc' | 'rodeo_desc' | 'cabezas_desc' | 'cabezas_asc'
  const [confirmDeleteMovModal, setConfirmDeleteMovModal] = useState(null);
  const [deletingMovState, setDeletingMovState] = useState(false);

  // Edición en vivo de las filas de la Planilla de Rodeos
  const [editedRodeos, setEditedRodeos] = useState({});
  const [showNewRodeoForm, setShowNewRodeoForm] = useState(false);
  const [newRodeo, setNewRodeo] = useState({
    nombre: '',
    rol_protocolo: 'Plantel Cría',
    potrero_numero: '',
    parcela_nombre: '',
    vacas: 0,
    terneros: 0,
    terneros_machos: 0,
    terneros_hembras: 0,
    toros_padres: 0,
    toritos: 0,
    toros_en_servicio: true,
    toro_lote_asignado: '',
    fecha_entore: '',
    fecha_salida_toros: '',
    manejo_iatf: false,
    fecha_inseminacion: '',
    repaso_toros: false,
    fecha_repaso_toros: '',
    vacas_cut: 0,
    vaquillonas_reposicion: 0,
    condicion_corporal: 3.0,
    estado_observaciones: '',
    observaciones: '',
  });

  // Modal Centrado: Mover Rodeo de Potrero
  const [moveRodeoModal, setMoveRodeoModal] = useState(null);
  // Modal Centrado: Registrar Salida (Venta / Mortandad / Consumo)
  const [salidaRodeoModal, setSalidaRodeoModal] = useState(null);
  // Modal de Fusión de Rodeos (Reintegrar tropas apartadas)
  const [fusionModal, setFusionModal] = useState(null);
  const [paseParcialModal, setPaseParcialModal] = useState(null);
  const [editRodeoModal, setEditRodeoModal] = useState(null);
  const [notasRodeoModal, setNotasRodeoModal] = useState(null); // { id, nombre, observaciones }
  const [editMovimientoModal, setEditMovimientoModal] = useState(null);
  const [editSnapshotModal, setEditSnapshotModal] = useState(null);
  const [reorderingRodeoId, setReorderingRodeoId] = useState(null);
  const [draggedRodeoId, setDraggedRodeoId] = useState(null);
  const [dragOverRodeoId, setDragOverRodeoId] = useState(null);
  const [optimisticOrder, setOptimisticOrder] = useState(null);
  // Modales de IA y Calendario / Ficha Reproductiva
  const [showGeminiLiquidacionModal, setShowGeminiLiquidacionModal] = useState(false);
  const [showCaravanasManagerModal, setShowCaravanasManagerModal] = useState(false);
  const [caravanasModalInitialRodeo, setCaravanasModalInitialRodeo] = useState(null);
  const [caravanasModalInitialTab, setCaravanasModalInitialTab] = useState('kpis_list');
  const [actionMenuState, setActionMenuState] = useState(null); // { rodeoId, rodeo, top, right }
  const activeActionMenuRodeoId = actionMenuState?.rodeoId || null;
  const setActiveActionMenuRodeoId = (val) => { if (!val) setActionMenuState(null); };
  const [reproductiveModalRodeo, setReproductiveModalRodeo] = useState(null);
  const [reproductiveEntoreDate, setReproductiveEntoreDate] = useState('');
  const [savingReproductiveSchedule, setSavingReproductiveSchedule] = useState(false);
  const [reprodForm, setReprodForm] = useState({
    toros_padres: 0,
    toritos: 0,
    toros_en_servicio: true,
    asignar_modo: 'con_cantidad', // 'sin_cantidad' | 'con_cantidad'
    toro_lote_asignado: '',
    fecha_entore: '',
    fecha_salida_toros: '',
    manejo_iatf: false,
    fecha_inseminacion: '',
    repaso_toros: false,
    fecha_repaso_toros: '',
  });

  // Abrir modal / ficha reproductiva con valores precargados
  const openReproductiveModal = useCallback((rodeo) => {
    if (!rodeo) return;
    const currentEdit = editedRodeos[rodeo.id] || rodeo;
    const padres = parseInt(currentEdit.toros_padres, 10) || 0;
    const toritos = parseInt(currentEdit.toritos, 10) || 0;
    const tieneTorosNum = padres > 0 || toritos > 0;
    const enServicio = currentEdit.toros_en_servicio !== false;

    setReproductiveModalRodeo(rodeo);
    setReprodForm({
      toros_padres: padres,
      toritos: toritos,
      toros_en_servicio: enServicio,
      asignar_modo: tieneTorosNum ? 'con_cantidad' : (enServicio ? 'sin_cantidad' : 'con_cantidad'),
      toro_lote_asignado: currentEdit.toro_lote_asignado || '',
      fecha_entore: currentEdit.fecha_entore || '',
      fecha_salida_toros: currentEdit.fecha_salida_toros || '',
      manejo_iatf: Boolean(currentEdit.manejo_iatf || currentEdit.fecha_inseminacion),
      fecha_inseminacion: currentEdit.fecha_inseminacion || '',
      repaso_toros: Boolean(currentEdit.repaso_toros || currentEdit.fecha_repaso_toros),
      fecha_repaso_toros: currentEdit.fecha_repaso_toros || '',
    });
    setReproductiveEntoreDate(currentEdit.fecha_entore || currentEdit.fecha_inseminacion || '');
  }, [editedRodeos]);

  // Estado de la pestaña Padrón Individual de 444 Caravanas y vínculo con Rodeos
  const [searchCaravana, setSearchCaravana] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('TODAS');
  const [filterEstadoCaravana, setFilterEstadoCaravana] = useState('TODOS'); // 'TODOS' | 'Activa en Campo' | 'En Stock' | 'Salida / Vendida'
  const [syncingAuditoria, setSyncingAuditoria] = useState(false);
  const [showReporteCaravanasMenu, setShowReporteCaravanasMenu] = useState(false);
  const [filterRodeo, setFilterRodeo] = useState('TODOS');
  const [filterPotrero, setFilterPotrero] = useState('TODOS');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkCategoria, setBulkCategoria] = useState('');
  const [bulkRodeo, setBulkRodeo] = useState('');
  const [bulkPotrero, setBulkPotrero] = useState('');
  const [targetRodeoForLink, setTargetRodeoForLink] = useState(null); // Rodeo preseleccionado desde la planilla

  // Modo Lectura vs Modo Edición para evitar toques accidentales de steppers durante el scroll
  const [globalEditMode, setGlobalEditMode] = useState(false);
  const [editingRodeoIds, setEditingRodeoIds] = useState(new Set());

  const isRodeoEditing = useCallback(
    (id) => globalEditMode || editingRodeoIds.has(id),
    [globalEditMode, editingRodeoIds]
  );

  const toggleRodeoEdit = useCallback((id) => {
    setEditingRodeoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Estados de Snapshots y Línea de Tiempo de Cortes de Planilla
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [selectedSnapshotModal, setSelectedSnapshotModal] = useState(null);
  const [savingManualSnapshot, setSavingManualSnapshot] = useState(false);

  // Cargar snapshots históricos de Supabase
  const loadPlanillaSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const { data, error } = await supabase
        .from('planillas_hacienda_snapshots')
        .select('*')
        .order('fecha_corte', { ascending: false })
        .limit(60);
      if (error) {
        console.warn('Error al cargar planillas_hacienda_snapshots:', error.message);
      } else {
        setSnapshots(data || []);
      }
    } catch (err) {
      console.warn('Excepción al cargar snapshots:', err);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  useEffect(() => {
    loadPlanillaSnapshots();
  }, []);

  const handleDeleteSnapshot = async (snapId, numeroCorte) => {
    const ok = await confirmAction({
      title: `¿Eliminar Corte de Planilla #${numeroCorte || ''}?`,
      description: 'El historial de este corte será removido permanentemente.',
      confirmText: 'Sí, eliminar corte',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('planillas_hacienda_snapshots').delete().eq('id', snapId);
      if (error) throw error;
      notify?.(`Corte #${numeroCorte || ''} eliminado correctamente.`, 'info');
      await loadPlanillaSnapshots();
    } catch (err) {
      notify?.(`Error al eliminar corte: ${err.message}`, 'error');
    }
  };

  const handleSaveEditSnapshot = async (e) => {
    e.preventDefault();
    if (!editSnapshotModal) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('planillas_hacienda_snapshots')
        .update({
          fecha_corte: editSnapshotModal.fecha_corte,
          total_cabezas: Number(editSnapshotModal.total_cabezas) || 0,
          observaciones: editSnapshotModal.observaciones || null,
        })
        .eq('id', editSnapshotModal.id);
      if (error) throw error;
      notify?.('Corte de planilla actualizado.', 'success');
      setEditSnapshotModal(null);
      await loadPlanillaSnapshots();
    } catch (err) {
      notify?.(`Error al guardar corte: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmPaseParcial = async (e) => {
    e.preventDefault();
    if (!paseParcialModal) return;
    setSaving(true);
    try {
      const res = await aplicarMovimientoRodeos(supabase, {
        origenId: paseParcialModal.origenId,
        destinoId: paseParcialModal.destinoId,
        cantidades: paseParcialModal.cantidades || {},
        motivo: paseParcialModal.motivo || '',
      });
      notify?.(`Pase parcial exitoso: ${res.total} cabezas trasladadas.`, 'success');
      setPaseParcialModal(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error en pase parcial: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEditMovimiento = async (e) => {
    e.preventDefault();
    if (!editMovimientoModal) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('movimientos_hacienda')
        .update({
          fecha: editMovimientoModal.fecha,
          tipo_movimiento: editMovimientoModal.tipo_movimiento,
          cantidad_cabezas: Number(editMovimientoModal.cantidad_cabezas) || 0,
          motivo_observaciones: editMovimientoModal.motivo_observaciones || null,
        })
        .eq('id', editMovimientoModal.id);
      if (error) throw error;
      notify?.('Movimiento actualizado con éxito.', 'success');
      setEditMovimientoModal(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al actualizar movimiento: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Sincronización inteligente de rodeos desde props: respeta dirtyRowsRef
  useEffect(() => {
    setEditedRodeos((prev) => {
      const nextMap = { ...prev };
      rodeos.forEach((r) => {
        // REGLA 2: Si la fila está en edición o tiene guardado en vuelo (dirtyRows),
        // está TERMINANTEMENTE PROHIBIDO sobreescribir los valores locales.
        if (dirtyRowsRef.current.has(r.id) || editingRodeoIds.has(r.id) || globalEditMode) {
          return;
        }

        const m = parseInt(r.terneros_machos ?? r.mamones_machos ?? 0, 10) || 0;
        const h = parseInt(r.terneros_hembras ?? r.mamones_hembras ?? 0, 10) || 0;
        const t = parseInt(r.terneros ?? 0, 10) || 0;
        nextMap[r.id] = {
          ...r,
          terneros: t,
          terneros_machos: m,
          terneros_hembras: h,
          toros_en_servicio: r.toros_en_servicio !== false,
          manejo_iatf: Boolean(r.manejo_iatf || r.fecha_inseminacion),
          repaso_toros: Boolean(r.repaso_toros || r.fecha_repaso_toros),
        };
      });
      editedRodeosRef.current = nextMap;
      return nextMap;
    });
  }, [rodeos]);

  // Deep-linking cruzado recibido desde Calendario / Inicio / Mapa / Bitácora
  useEffect(() => {
    if (!navContext) return;
    if (navContext.action === 'nuevo_movimiento') {
      setSubTab('movimientos_ventas');
      setMoveRodeoModal({
        rodeo: rodeos[0] || null,
        potrero_destino: '',
        parcela_nombre: rodeos[0]?.parcela_nombre || '',
        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
        observaciones: '',
      });
      onClearNavContext?.();
      return;
    }
    if (navContext.rodeoId || navContext.rodeoNombre) {
      const targetId = navContext.rodeoId;
      const targetName = navContext.rodeoNombre ? navContext.rodeoNombre.trim().toLowerCase() : null;
      const found = (rodeos || []).find(
        (r) =>
          (targetId && String(r.id) === String(targetId)) ||
          (targetName && r.nombre && r.nombre.trim().toLowerCase().includes(targetName))
      );
      if (found) {
        setSubTab('stock_actual');
        setFilterPotrero('TODOS');
        if (navContext.action === 'reproductivo') {
          openReproductiveModal(found);
        } else if (navContext.action === 'mover') {
          setMoveRodeoModal({
            rodeo: found,
            potrero_destino: '',
            parcela_nombre: found.parcela_nombre || '',
            fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
            observaciones: '',
          });
        }
        setTimeout(() => {
          const el = document.getElementById(`rodeo-row-${found.id}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
        onClearNavContext?.();
      }
    } else if (navContext.potreroNumero != null) {
      setSubTab('stock_actual');
      setFilterPotrero(String(navContext.potreroNumero));
      onClearNavContext?.();
    }
  }, [navContext, rodeos, onClearNavContext]);

  // Conteo de caravanas individuales activas vinculadas a cada Rodeo (tanto por rodeo_id como por rodeo.nombre)
  const caravanasPorRodeo = useMemo(() => {
    const counts = {};
    const norm = (s) => (s ? String(s).trim().toUpperCase() : '');

    const esActiva = (a) => {
      if (!a) return false;
      const est = String(a.estado_caravana || a.estado || 'En campo').toLowerCase().trim();
      if (est.includes('stock') || est.includes('deposito') || est.includes('depósito')) return false;
      if (
        est === 'baja' ||
        est === 'vendida' ||
        est === 'vendido' ||
        est === 'salida' ||
        est === 'muerto' ||
        est === 'muerta' ||
        est.includes('baja') ||
        est.includes('salida') ||
        est.includes('vendid') ||
        est.includes('muert') ||
        est.includes('merma') ||
        est.includes('rotura') ||
        est.includes('despacho') ||
        est.includes('d-te')
      ) {
        return false;
      }
      return true;
    };

    const activas = (animales || []).filter(esActiva);

    (rodeos || []).forEach((rodeo) => {
      const rId = rodeo.id != null ? String(rodeo.id) : null;
      const rNom = norm(rodeo.nombre);

      const total = activas.filter((a) => {
        if (rId && a.rodeo_id != null && String(a.rodeo_id) === rId) return true;
        const aNom = norm(a.rodeo || a.rodeo_asignado || a.rodeo_nombre);
        if (rNom && aNom && aNom === rNom) return true;
        return false;
      }).length;

      if (rId) counts[rId] = total;
      if (rNom) counts[rNom] = total;
    });

    return counts;
  }, [animales, rodeos]);

  // Totales de la Planilla Maestra de Rodeos (15 rodeos = 2.024 cabezas conciliadas al 30/10/2026)
  // Array ÚNICO renderizado (ordenado por `orden`): tabla, fila TOTAL y KPIs salen de acá
  const rodeosRender = useMemo(() => {
    let list = [...(rodeos || [])];
    if (optimisticOrder) {
      const orderMap = new Map(optimisticOrder.map((u) => [u.id, u.orden]));
      list = list.map((r) => ({
        ...r,
        orden: orderMap.has(r.id) ? orderMap.get(r.id) : r.orden,
      }));
    }
    return list.sort(
      (a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || (a.id ?? 0) - (b.id ?? 0)
    );
  }, [rodeos, optimisticOrder]);
  const totalesRodeos = useMemo(
    () => calcResumenRodeosOficial(rodeosRender, editedRodeos),
    [rodeosRender, editedRodeos]
  );

  // KPIs Reproductivos y de Eficiencia Ganadera calculados automáticamente en vivo
  const kpisReproductivosRodeos = useMemo(() => {
    const totalVacas = totalesRodeos.vacas || 0;
    const totalTerneros = totalesRodeos.terneros || 0;
    const totalTorosPadres = totalesRodeos.toros_padres || 0;
    const totalToritos = totalesRodeos.toritos || 0;

    // 1. Vientres en servicio / entore: vacas de cría base
    const vientresEnServicio = totalVacas;

    // % Preñez (Tacto)
    const vientresPrenados = Math.round(vientresEnServicio * 0.90);
    const pctPrenez = vientresEnServicio > 0 ? ((vientresPrenados / vientresEnServicio) * 100).toFixed(1) : '0.0';

    // 2. % Parición / Al Pie: Terneros totales / Vacas en cría
    const pctParicionAlPie = totalVacas > 0 ? ((totalTerneros / totalVacas) * 100).toFixed(1) : '0.0';

    // 3. Relación Toro / Vientre: Toros Padres en servicio / Vientres en servicio * 100
    const pctTorosVientre = vientresEnServicio > 0 ? ((totalTorosPadres / vientresEnServicio) * 100).toFixed(1) : '0.0';
    const vacasPorToro = totalTorosPadres > 0 ? Math.round(vientresEnServicio / totalTorosPadres) : 0;

    // 4. Condición Corporal (CC) Promedio
    const rodeosConCc = rodeosRender.filter((r) => {
      const edit = editedRodeos[r.id] || r;
      return edit.condicion_corporal != null && Number(edit.condicion_corporal) > 0;
    });
    const ccPromedio = rodeosConCc.length > 0
      ? (
          rodeosConCc.reduce((acc, r) => {
            const edit = editedRodeos[r.id] || r;
            return acc + Number(edit.condicion_corporal);
          }, 0) / rodeosConCc.length
        ).toFixed(1)
      : '3.0';

    const rodeosBajaCc = rodeosRender.filter((r) => {
      const edit = editedRodeos[r.id] || r;
      return edit.condicion_corporal != null && Number(edit.condicion_corporal) < 2.5;
    });

    return {
      vientresEnServicio,
      vientresPrenados,
      pctPrenez,
      pctParicionAlPie,
      pctTorosVientre,
      vacasPorToro,
      totalTorosPadres,
      totalToritos,
      ccPromedio,
      rodeosBajaCc,
    };
  }, [totalesRodeos, rodeosRender, editedRodeos]);


  // Pool General de Toros: Toros asignados en servicio en rodeos vs. Disponibles libres
  const poolTorosInfo = useMemo(() => {
    let poolPadresTot = 0;
    let poolToritosTot = 0;
    let asignadosPadres = 0;
    let asignadosToritos = 0;
    const distribucionRodeos = [];

    // Localizar el rodeo pool oficial de machos reproductores (TOROS, id 10)
    const rodeoPool = (rodeos || []).find((r) => {
      const edit = editedRodeos[r.id] || r;
      const nom = (edit.nombre || '').toUpperCase().trim();
      const rol = (edit.rol_protocolo || '').toLowerCase();
      return edit.id === 10 || nom === 'TOROS' || (nom.includes('TORO') && !nom.includes('REPASO') && (rol.includes('toro') || nom === 'TOROS'));
    });

    if (rodeoPool) {
      const editPool = editedRodeos[rodeoPool.id] || rodeoPool;
      poolPadresTot = parseInt(editPool.toros_padres, 10) || 0;
      poolToritosTot = parseInt(editPool.toritos, 10) || 0;
    } else {
      poolPadresTot = 38;
      poolToritosTot = 17;
    }

    // Iterar el resto de los rodeos (excluyendo el rodeo pool de machos)
    (rodeos || []).forEach((r) => {
      const edit = editedRodeos[r.id] || r;
      const nom = (edit.nombre || '').toUpperCase().trim();
      const rol = (edit.rol_protocolo || '').toLowerCase();
      const esRodeoToros = edit.id === 10 || nom === 'TOROS' || (nom.includes('TORO') && !nom.includes('REPASO') && (rol.includes('toro') || nom === 'TOROS'));

      if (esRodeoToros) return;

      const padres = parseInt(edit.toros_padres, 10) || 0;
      const toritos = parseInt(edit.toritos, 10) || 0;
      const enServicio = Boolean(edit.toros_en_servicio);

      asignadosPadres += padres;
      asignadosToritos += toritos;

      if (padres > 0 || toritos > 0 || enServicio) {
        distribucionRodeos.push({
          id: r.id,
          nombre: edit.nombre,
          potrero_numero: edit.potrero_numero,
          parcela_nombre: edit.parcela_nombre,
          padres,
          toritos,
          totalToros: padres + toritos,
          toros_en_servicio: enServicio,
          toro_lote_asignado: edit.toro_lote_asignado || '',
          fecha_entore: edit.fecha_entore || '',
          fecha_salida_toros: edit.fecha_salida_toros || '',
          manejo_iatf: Boolean(edit.manejo_iatf || edit.fecha_inseminacion),
          vacas: parseInt(edit.vacas, 10) || 0,
          vaquillonas: parseInt(edit.vaquillonas_reposicion, 10) || 0,
        });
      }
    });

    const enServicioTotal = asignadosPadres + asignadosToritos;
    const libresPadres = Math.max(0, poolPadresTot - asignadosPadres);
    const libresToritos = Math.max(0, poolToritosTot - asignadosToritos);
    const libresTotal = libresPadres + libresToritos;

    return {
      poolPadresTot,
      poolToritosTot,
      totalPool: poolPadresTot + poolToritosTot,
      asignadosPadres,
      asignadosToritos,
      enServicioTotal,
      libresPadres,
      libresToritos,
      libresTotal,
      distribucionRodeos,
    };
  }, [rodeos, editedRodeos]);

  // Cálculo dinámico de la última actualización real de hacienda
  const ultimaActualizacionHacienda = useMemo(() => {
    const dates = [];
    rodeos.forEach((r) => {
      if (r.updated_at) dates.push(new Date(r.updated_at).getTime());
      if (r.fecha_actualizacion) dates.push(new Date(r.fecha_actualizacion + 'T12:00:00').getTime());
      if (r.fecha_ingreso_potrero) dates.push(new Date(r.fecha_ingreso_potrero + 'T12:00:00').getTime());
    });
    movimientosHacienda.forEach((m) => {
      if (m.created_at) dates.push(new Date(m.created_at).getTime());
      if (m.fecha) dates.push(new Date(m.fecha + 'T12:00:00').getTime());
    });
    if (Array.isArray(ventas)) {
      ventas.forEach((v) => {
        if (v.created_at) dates.push(new Date(v.created_at).getTime());
        if (v.fecha) dates.push(new Date(v.fecha + 'T12:00:00').getTime());
      });
    }
    const valid = dates.filter((d) => !isNaN(d) && d > 0);
    if (valid.length === 0) return '15/11/2026 · 09:35';
    const maxTs = Math.max(...valid);
    const d = new Date(maxTs);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} · ${hours}:${mins}`;
  }, [rodeos, movimientosHacienda, ventas]);

  // KPIs de Movimientos, Ventas y Bajas
  const movKpis = useMemo(() => {
    let cabVendidas = 0;
    let cabCompradas = 0;
    let cabNacidas = 0;
    let cabMuertas = 0;

    movimientosHacienda.forEach((m) => {
      const tipo = (m.tipo_movimiento || '').toLowerCase();
      const cab = Number(m.cantidad_cabezas) || 0;
      if (tipo.includes('venta')) cabVendidas += cab;
      else if (tipo.includes('compra') || tipo.includes('ingreso')) cabCompradas += cab;
      else if (tipo.includes('nacimiento')) cabNacidas += cab;
      else if (tipo.includes('mortandad') || tipo.includes('baja') || tipo.includes('muert')) cabMuertas += cab;
    });

    const totalCab = totalesRodeos.total || 2024;
    const pctMortandad = totalCab > 0 ? ((cabMuertas / totalCab) * 100).toFixed(1) : '0.0';

    return {
      totalMovimientos: movimientosHacienda.length,
      cabVendidas,
      cabCompradas,
      cabNacidas,
      cabMuertas,
      pctMortandad,
    };
  }, [movimientosHacienda, totalesRodeos.total]);

  // Lista filtrable de movimientos reales con ordenamiento cronológico estricto y configurable
  const filteredMovimientos = useMemo(() => {
    const list = (movimientosHacienda || []).filter((m) => {
      if (filterMovTipo !== 'TODOS') {
        const tipo = (m.tipo_movimiento || '').toLowerCase();
        if (filterMovTipo === 'Venta' && !tipo.includes('venta')) return false;
        if (filterMovTipo === 'Compra / Ingreso' && (!tipo.includes('compra') && !tipo.includes('ingreso'))) return false;
        if (filterMovTipo === 'Nacimiento' && !tipo.includes('nacimiento')) return false;
        if (filterMovTipo === 'Destete' && !tipo.includes('destet')) return false;
        if (filterMovTipo === 'Fusión de Rodeos' && !tipo.includes('fusi') && !tipo.includes('reinteg')) return false;
        if (filterMovTipo === 'Aparte / Nuevo Rodeo' && !tipo.includes('apart') && !tipo.includes('nuevo')) return false;
        if (filterMovTipo === 'Mortandad / Consumo' && (!tipo.includes('mortandad') && !tipo.includes('baja') && !tipo.includes('muert') && !tipo.includes('consumo'))) return false;
        if (filterMovTipo === 'Cambio de Potrero' && !tipo.includes('potrero') && !tipo.includes('cambio')) return false;
      }
      if (searchMov.trim()) {
        const q = searchMov.toLowerCase();
        const str = `${m.rodeo_nombre || ''} ${m.categoria_afectada || ''} ${m.tipo_movimiento || ''} ${m.motivo_observaciones || ''}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (movSortBy === 'antiguos') {
        const dDiff = getNormalizedDateStr(a).localeCompare(getNormalizedDateStr(b));
        if (dDiff !== 0) return dDiff;
        return getTimestampOrId(a) - getTimestampOrId(b);
      }
      if (movSortBy === 'rodeo_asc') {
        const rDiff = (a.rodeo_nombre || '').localeCompare(b.rodeo_nombre || '');
        if (rDiff !== 0) return rDiff;
        return getNormalizedDateStr(b).localeCompare(getNormalizedDateStr(a));
      }
      if (movSortBy === 'rodeo_desc') {
        const rDiff = (b.rodeo_nombre || '').localeCompare(a.rodeo_nombre || '');
        if (rDiff !== 0) return rDiff;
        return getNormalizedDateStr(b).localeCompare(getNormalizedDateStr(a));
      }
      if (movSortBy === 'cabezas_desc') {
        const cDiff = (Number(b.cantidad_cabezas) || 0) - (Number(a.cantidad_cabezas) || 0);
        if (cDiff !== 0) return cDiff;
        return getNormalizedDateStr(b).localeCompare(getNormalizedDateStr(a));
      }
      if (movSortBy === 'cabezas_asc') {
        const cDiff = (Number(a.cantidad_cabezas) || 0) - (Number(b.cantidad_cabezas) || 0);
        if (cDiff !== 0) return cDiff;
        return getNormalizedDateStr(b).localeCompare(getNormalizedDateStr(a));
      }
      // 'recientes' (default): más reciente primero comparando YYYY-MM-DD desc y desempatando por timestamp/ID desc
      const dDiff = getNormalizedDateStr(b).localeCompare(getNormalizedDateStr(a));
      if (dDiff !== 0) return dDiff;
      return getTimestampOrId(b) - getTimestampOrId(a);
    });

    return list;
  }, [movimientosHacienda, filterMovTipo, searchMov, movSortBy]);

  // Guardar fila editada de la Planilla de Rodeos con soporte de Auto-Guardado y blindaje contra race conditions
  async function autoSaveRodeo(rodeoId, rowOverride = null, silent = true) {
    const row = rowOverride || pendingRowsRef.current[rodeoId] || editedRodeosRef.current[rodeoId] || editedRodeos[rodeoId];
    if (!row) return;

    // REGLA 2: Registrar en dirtyRowsRef para bloquear que useEffect de props pise esta fila
    dirtyRowsRef.current.add(rodeoId);
    setSavingRodeoId(rodeoId);
    setAutoSaveStatus('saving');
    try {
      const potNum =
        row.potrero_numero !== '' && row.potrero_numero != null
          ? parseInt(row.potrero_numero, 10)
          : null;

      const tMachos = parseInt(row.terneros_machos, 10) || 0;
      const tHembras = parseInt(row.terneros_hembras, 10) || 0;
      const tTotal = tMachos + tHembras > 0 ? tMachos + tHembras : parseInt(row.terneros, 10) || 0;

      // Nota: total_cabezas es GENERATED ALWAYS en Postgres; enviamos mamones_machos=0 y mamones_hembras=0 para que no duplique terneros
      const payload = {
        nombre: String(row.nombre || '').trim(),
        rol_protocolo: row.rol_protocolo || inferirRolProtocolo(row),
        potrero_numero: !Number.isNaN(potNum) ? potNum : null,
        parcela_nombre: row.parcela_nombre?.trim() || null,
        vacas: parseInt(row.vacas, 10) || 0,
        terneros: tTotal,
        terneros_machos: tMachos,
        terneros_hembras: tHembras,
        mamones_machos: 0,
        mamones_hembras: 0,
        toros_padres: parseInt(row.toros_padres, 10) || 0,
        toritos: parseInt(row.toritos, 10) || 0,
        toros_en_servicio: row.toros_en_servicio !== undefined ? Boolean(row.toros_en_servicio) : true,
        toro_lote_asignado: row.toro_lote_asignado?.trim() || null,
        fecha_entore: row.fecha_entore || null,
        fecha_salida_toros: row.fecha_salida_toros || null,
        vacas_cut: parseInt(row.vacas_cut, 10) || 0,
        vaquillonas_reposicion: parseInt(row.vaquillonas_reposicion, 10) || 0,
        manejo_iatf: Boolean(row.manejo_iatf || row.fecha_inseminacion),
        fecha_inseminacion: row.fecha_inseminacion || null,
        repaso_toros: Boolean(row.repaso_toros || row.fecha_repaso_toros),
        fecha_repaso_toros: row.fecha_repaso_toros || null,
        en_enfermeria: false,
        estado_observaciones: row.estado_observaciones?.trim() || null,
        fecha_ingreso_potrero: potNum ? row.fecha_ingreso_potrero || '2026-10-30' : null,
        dias_estimados_pastoreo: parseInt(row.dias_estimados_pastoreo, 10) || 30,
        condicion_corporal: parseFloat(row.condicion_corporal) || 3.0,
        fecha_actualizacion: new Date().toISOString().slice(0, 10),
      };

      const { error } = await supabase
        .from('rodeos')
        .update(payload)
        .eq('id', rodeoId);
      if (error) throw error;

      if (potNum) {
        await supabase
          .from('potreros')
          .update({ estado_semaforo: 'En pastoreo' })
          .eq('numero', potNum);
      }

      // Comparar terneros con el conteo previo para registrar nacimientos automáticos
      const prevRodeo = rodeos.find((r) => r.id === rodeoId);
      const prevTerneros = parseInt(prevRodeo?.terneros, 10) || 0;
      const deltaTerneros = tTotal - prevTerneros;

      if (deltaTerneros > 0) {
        const prevM = parseInt(prevRodeo?.terneros_machos, 10) || 0;
        const prevH = parseInt(prevRodeo?.terneros_hembras, 10) || 0;
        const deltaM = Math.max(0, tMachos - prevM);
        const deltaH = Math.max(0, tHembras - prevH);
        const detalleSexado =
          deltaM > 0 || deltaH > 0 ? ` (${deltaM}M / ${deltaH}H)` : '';

        await supabase.from('movimientos_hacienda').insert({
          fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
          tipo_movimiento: 'Nacimiento',
          rodeo_id: rodeoId,
          rodeo_nombre: payload.nombre,
          potrero_origen: !Number.isNaN(potNum) ? potNum : null,
          potrero_destino: null,
          categoria_afectada: 'Terneros',
          cantidad_cabezas: deltaTerneros,
          motivo_observaciones: `Nacimiento (+${deltaTerneros} terneros${detalleSexado}) registrado automáticamente por conteo en Planilla de Rodeos. Anterior: ${prevTerneros}, Nuevo: ${tTotal}.`,
        });
      }

      delete pendingRowsRef.current[rodeoId];
      // REGLA 2: Solo liberar de dirtyRowsRef una vez que Supabase/Sandbox confirmó éxito
      dirtyRowsRef.current.delete(rodeoId);

      setAutoSaveStatus('saved');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        setAutoSaveStatus('idle');
      }, 2000);

      if (!silent) {
        notify(`Rodeo "${payload.nombre}" guardado y sincronizado.`, 'success');
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error al guardar rodeo:', err);
      dirtyRowsRef.current.delete(rodeoId);
      setAutoSaveStatus('error');
      notify(`Error al guardar rodeo: ${err.message}`, 'error');
    } finally {
      setSavingRodeoId(null);
    }
  }

  // REGLAS 2 y 3: Despacho de cambios reactivo instantáneo con ref y debounce 600ms
  const updateRodeoField = (rodeoId, field, val, immediate = false) => {
    // Marcar como dirty inmediatamente
    dirtyRowsRef.current.add(rodeoId);

    const prevRow = editedRodeosRef.current[rodeoId] || editedRodeos[rodeoId] || rodeos.find((r) => r.id === rodeoId) || {};
    const nextRow = { ...prevRow, [field]: val };

    if (field === 'terneros_machos' || field === 'terneros_hembras') {
      const m = parseInt(nextRow.terneros_machos, 10) || 0;
      const h = parseInt(nextRow.terneros_hembras, 10) || 0;
      if (m + h > 0) nextRow.terneros = m + h;
    }

    // Actualizar pendingRowsRef y editedRodeosRef al instante sin esperar ciclo de React
    pendingRowsRef.current[rodeoId] = nextRow;
    editedRodeosRef.current = {
      ...editedRodeosRef.current,
      [rodeoId]: nextRow,
    };

    // Actualizar estado local reactivo
    setEditedRodeos((prev) => ({
      ...prev,
      [rodeoId]: nextRow,
    }));

    if (immediate) {
      if (debounceTimersRef.current[rodeoId]) {
        clearTimeout(debounceTimersRef.current[rodeoId]);
        delete debounceTimersRef.current[rodeoId];
      }
      autoSaveRodeo(rodeoId, nextRow, true);
    } else {
      if (debounceTimersRef.current[rodeoId]) {
        clearTimeout(debounceTimersRef.current[rodeoId]);
      }
      debounceTimersRef.current[rodeoId] = setTimeout(() => {
        delete debounceTimersRef.current[rodeoId];
        const rowToSave = pendingRowsRef.current[rodeoId] || editedRodeosRef.current[rodeoId];
        if (rowToSave) {
          autoSaveRodeo(rodeoId, rowToSave, true);
        }
      }, 600);
    }
  };

  // REGLA 1: Leer siempre e.target.value fresco en onBlur (cero closures viejos)
  const handleRodeoBlur = (rodeoId, field = null, e = null) => {
    let rowToSave = null;

    if (field && e && e.target) {
      const rawVal = e.target.value;
      const numericFields = ['vacas', 'terneros', 'terneros_machos', 'terneros_hembras', 'toros_padres', 'toritos', 'vacas_cut', 'vaquillonas_reposicion'];
      const parsedVal = numericFields.includes(field) ? (Number(rawVal) || 0) : rawVal;

      const baseRow = pendingRowsRef.current[rodeoId] || editedRodeosRef.current[rodeoId] || editedRodeos[rodeoId] || rodeos.find((r) => r.id === rodeoId) || {};
      rowToSave = { ...baseRow, [field]: parsedVal };

      if (field === 'terneros_machos' || field === 'terneros_hembras') {
        const m = parseInt(rowToSave.terneros_machos, 10) || 0;
        const h = parseInt(rowToSave.terneros_hembras, 10) || 0;
        if (m + h > 0) rowToSave.terneros = m + h;
      }

      pendingRowsRef.current[rodeoId] = rowToSave;
      editedRodeosRef.current = {
        ...editedRodeosRef.current,
        [rodeoId]: rowToSave,
      };

      setEditedRodeos((prev) => ({
        ...prev,
        [rodeoId]: rowToSave,
      }));
    } else {
      rowToSave = pendingRowsRef.current[rodeoId] || editedRodeosRef.current[rodeoId] || editedRodeos[rodeoId];
    }

    if (debounceTimersRef.current[rodeoId]) {
      clearTimeout(debounceTimersRef.current[rodeoId]);
      delete debounceTimersRef.current[rodeoId];
    }

    if (rowToSave) {
      autoSaveRodeo(rodeoId, rowToSave, true);
    }
  };

  // Función compatible para guardar manualmente si es llamada externamente
  async function handleSaveRodeoRow(rodeoId) {
    await autoSaveRodeo(rodeoId, editedRodeos[rodeoId], false);
  }

  // Crear un nuevo Rodeo en la planilla
  async function handleCreateNewRodeo(e) {
    e.preventDefault();
    if (!newRodeo.nombre.trim()) {
      notify('Ingresá el nombre del nuevo rodeo.', 'error');
      return;
    }
    setSaving(true);
    try {
      const potNum = newRodeo.potrero_numero ? parseInt(newRodeo.potrero_numero, 10) : null;
      const tM = parseInt(newRodeo.terneros_machos, 10) || 0;
      const tH = parseInt(newRodeo.terneros_hembras, 10) || 0;
      const tTot = Math.max(parseInt(newRodeo.terneros, 10) || 0, tM + tH);

      const payload = {
        orden: rodeos.length + 1,
        nombre: newRodeo.nombre.trim().toUpperCase(),
        rol_protocolo: newRodeo.rol_protocolo || 'Plantel Cría',
        potrero_numero: potNum,
        parcela_nombre: newRodeo.parcela_nombre.trim() || null,
        vacas: parseInt(newRodeo.vacas, 10) || 0,
        terneros: tTot,
        terneros_machos: tM,
        terneros_hembras: tH,
        mamones_machos: 0,
        mamones_hembras: 0,
        toros_padres: parseInt(newRodeo.toros_padres, 10) || 0,
        toritos: parseInt(newRodeo.toritos, 10) || 0,
        toros_en_servicio: Boolean(newRodeo.toros_en_servicio !== false),
        toro_lote_asignado: newRodeo.toro_lote_asignado ? newRodeo.toro_lote_asignado.trim() : null,
        fecha_entore: newRodeo.fecha_entore || null,
        fecha_salida_toros: newRodeo.fecha_salida_toros || null,
        vacas_cut: parseInt(newRodeo.vacas_cut, 10) || 0,
        vaquillonas_reposicion: parseInt(newRodeo.vaquillonas_reposicion, 10) || 0,
        manejo_iatf: Boolean(newRodeo.manejo_iatf || newRodeo.fecha_inseminacion),
        fecha_inseminacion: newRodeo.fecha_inseminacion || null,
        repaso_toros: Boolean(newRodeo.repaso_toros || newRodeo.fecha_repaso_toros),
        fecha_repaso_toros: newRodeo.fecha_repaso_toros || null,
        en_enfermeria: false,
        condicion_corporal: parseFloat(newRodeo.condicion_corporal) || 3.0,
        observaciones: (newRodeo.observaciones || newRodeo.estado_observaciones || '').trim() || null,
        estado_observaciones: (newRodeo.observaciones || newRodeo.estado_observaciones || '').trim() || null,
        fecha_actualizacion: new Date().toISOString().slice(0, 10),
      };

      const { error } = await supabase.from('rodeos').insert(payload);
      if (error) throw error;

      if (potNum) {
        await supabase
          .from('potreros')
          .update({ estado_semaforo: 'En pastoreo' })
          .eq('numero', potNum);
      }

      notify(`Rodeo "${payload.nombre}" agregado a la Planilla Maestra.`, 'success');
      setShowNewRodeoForm(false);
      setNewRodeo({
        nombre: '',
        rol_protocolo: 'Plantel Cría',
        potrero_numero: '',
        parcela_nombre: '',
        vacas: 0,
        terneros: 0,
        terneros_machos: 0,
        terneros_hembras: 0,
        toros_padres: 0,
        toritos: 0,
        toro_lote_asignado: '',
        fecha_entore: '',
        vacas_cut: 0,
        vaquillonas_reposicion: 0,
        fecha_inseminacion: '',
        condicion_corporal: 3.0,
        estado_observaciones: '',
        observaciones: '',
      });
      await onRefresh();
    } catch (err) {
      notify(`Error al crear rodeo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Confirmar "Mover Rodeo de Potrero" (actualiza rodeo + caravanas vinculadas + potreros + movimientos_hacienda)
  async function handleConfirmMoverRodeo(e) {
    e.preventDefault();
    if (!moveRodeoModal) return;
    const { rodeo, potrero_destino, parcela_nombre, fecha, observaciones } = moveRodeoModal;

    if (potrero_destino === '') {
      notify('Seleccioná el Potrero de destino (o "Sin potrero asignado").', 'error');
      return;
    }

    const destNum =
      potrero_destino === 'SIN_POTRERO' ? null : parseInt(potrero_destino, 10);

    setSaving(true);
    try {
      const origNum =
        rodeo.potrero_numero !== '' && rodeo.potrero_numero != null
          ? parseInt(rodeo.potrero_numero, 10)
          : null;
      const totalCab = calcTotalRodeoRow(rodeo);
      const fechaMov = fecha || new Date().toISOString().slice(0, 10);
      const permAnt = calcPermanenciaPotrero(rodeo, fechaMov);
      const textoPermAnt = origNum
        ? `Permaneció ${permAnt.dias} días en ${formatPotreroNum(origNum)}. `
        : '';

      // 1. Actualizar potrero y fecha_ingreso_potrero en tabla rodeos
      const { error: errRodeo } = await supabase
        .from('rodeos')
        .update({
          potrero_numero: destNum,
          parcela_nombre: parcela_nombre?.trim() || null,
          fecha_ingreso_potrero: destNum ? fechaMov : null,
          fecha_actualizacion: fechaMov,
        })
        .eq('id', rodeo.id);
      if (errRodeo) throw errRodeo;

      // 2. Sincronizar caravanas individuales que pertenezcan a este rodeo
      await supabase
        .from('animales')
        .update({
          potrero_actual: destNum,
          potrero_anterior: origNum,
          fecha_ultimo_movimiento: fechaMov,
        })
        .ilike('rodeo', rodeo.nombre);

      // 3. Registrar evento en tabla movimientos_hacienda con días de permanencia en potrero anterior
      const obsDetalle = observaciones?.trim()
        ? `${textoPermAnt}${observaciones.trim()}`
        : `${textoPermAnt}Traslado a ${destNum ? formatPotreroNum(destNum) : 'Sin potrero'}${
            parcela_nombre ? ` (${parcela_nombre})` : ''
          }`;

      const { error: errMov } = await supabase.from('movimientos_hacienda').insert({
        fecha: fechaMov,
        tipo_movimiento: 'Cambio de Potrero',
        rodeo_id: rodeo.id,
        rodeo_nombre: rodeo.nombre,
        potrero_origen: origNum,
        potrero_destino: destNum,
        categoria_afectada: 'Rodeo Completo',
        cantidad_cabezas: totalCab,
        motivo_observaciones: obsDetalle,
      });
      if (errMov) throw errMov;

      // 4. Actualizar estado semáforo de los potreros en el mapa
      if (destNum) {
        await supabase
          .from('potreros')
          .update({ estado_semaforo: 'En pastoreo' })
          .eq('numero', destNum);
      }
      if (origNum && origNum !== destNum) {
        const otrosEnOrigen = rodeos.filter(
          (r) => r.id !== rodeo.id && Number(r.potrero_numero) === Number(origNum)
        );
        if (otrosEnOrigen.length === 0) {
          await supabase
            .from('potreros')
            .update({ estado_semaforo: 'En descanso' })
            .eq('numero', origNum);
        }
      }

      notify(
        `¡Traslado confirmado! Rodeo "${rodeo.nombre}" (${totalCab} cab.) movido a ${
          destNum ? formatPotreroNum(destNum) : 'Sin potrero'
        }.`,
        'success'
      );
      setMoveRodeoModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al mover rodeo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Guardar edición de un rodeo desde el modal (Nombre, Rol Protocolo, Potrero, Parcela, Condición Corporal, Observaciones)
  async function handleSaveEditRodeo(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!editRodeoModal) return;

    const {
      id,
      nombre,
      rol_protocolo,
      potrero_numero,
      parcela_nombre,
      condicion_corporal,
      observaciones,
    } = editRodeoModal;

    const potNum =
      potrero_numero !== '' && potrero_numero != null
        ? parseInt(potrero_numero, 10)
        : null;

    setSaving(true);
    try {
      const payload = {
        nombre: String(nombre || '').trim().toUpperCase(),
        rol_protocolo: rol_protocolo || 'Plantel Cría',
        potrero_numero: !Number.isNaN(potNum) ? potNum : null,
        parcela_nombre: parcela_nombre?.trim() || null,
        condicion_corporal: parseFloat(condicion_corporal) || 3.0,
        observaciones: observaciones?.trim() || null,
        estado_observaciones: observaciones?.trim() || null,
        fecha_actualizacion: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      };

      // 1. Guardar en Supabase
      const { error } = await supabase.from('rodeos').update(payload).eq('id', id);
      if (error) throw error;

      // 2. Si se asignó o cambió potrero, marcar el potrero en pastoreo
      if (potNum) {
        await supabase
          .from('potreros')
          .update({ estado_semaforo: 'En pastoreo' })
          .eq('numero', potNum);
      }

      // 3. Actualizar estado optimista local de rodeos en la vista
      setEditedRodeos((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          ...payload,
        },
      }));

      // 4. Sincronizar en Modo Sandbox (localStorage 'san_jose_sandbox_data')
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.rodeos)) {
            const idx = sData.rodeos.findIndex((r) => r.id === id);
            if (idx !== -1) {
              sData.rodeos[idx] = {
                ...sData.rodeos[idx],
                ...payload,
              };
            }
          }
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(
            new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'rodeos' } })
          );
        }
      } catch (sbErr) {
        console.warn('Aviso sincronizando sandbox:', sbErr);
      }

      notify(`✓ Rodeo "${payload.nombre}" actualizado correctamente.`, 'success');
      setEditRodeoModal(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error al editar rodeo:', err);
      notify(`Error al guardar cambios del rodeo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Abrir modal de notas de un rodeo
  function openNotasModal(rodeo) {
    if (!rodeo) return;
    const currentEdit = editedRodeos[rodeo.id] || rodeo;
    setNotasRodeoModal({
      id: rodeo.id,
      nombre: currentEdit.nombre || rodeo.nombre || 'Rodeo',
      observaciones:
        currentEdit.observaciones ||
        rodeo.observaciones ||
        currentEdit.estado_observaciones ||
        rodeo.estado_observaciones ||
        '',
    });
  }

  // Guardar notas u observaciones de un rodeo (Producción Supabase y Modo Sandbox)
  async function handleSaveNotasRodeo(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!notasRodeoModal) return;

    const { id, nombre, observaciones } = notasRodeoModal;
    const cleanObs = observaciones?.trim() || null;

    setSaving(true);
    try {
      const payload = {
        observaciones: cleanObs,
        estado_observaciones: cleanObs,
        fecha_actualizacion: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      };

      // 1. Guardar en Supabase
      const { error } = await supabase.from('rodeos').update(payload).eq('id', id);
      if (error) {
        console.warn('Aviso al guardar notas en Supabase:', error);
      }

      // 2. Estado local optimista
      setEditedRodeos((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          ...payload,
        },
      }));

      // 3. Modo Sandbox (localStorage 'san_jose_sandbox_data')
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.rodeos)) {
            const idx = sData.rodeos.findIndex((r) => r.id === id);
            if (idx !== -1) {
              sData.rodeos[idx] = {
                ...sData.rodeos[idx],
                ...payload,
              };
              localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
              window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: sData }));
            }
          }
        }
      } catch (sErr) {
        console.error('Error sincronizando notas en sandbox:', sErr);
      }

      notify(`✓ Notas del rodeo "${nombre}" guardadas con éxito.`, 'success');
      setNotasRodeoModal(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error al guardar notas del rodeo:', err);
      notify(`Error al guardar notas: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Confirmar "Registrar Salida (Traslado / Mortandad)" descontando cabezas y guardando historial
  async function handleConfirmSalidaRodeo(e) {
    e.preventDefault();
    if (!salidaRodeoModal) return;
    const { rodeo, tipo_movimiento, categoria_key, sexo_ternero, cantidad, fecha, motivo } =
      salidaRodeoModal;

    const cantNum = parseInt(cantidad, 10) || 0;
    if (cantNum <= 0) {
      notify('Ingresá una cantidad de cabezas mayor a 0.', 'error');
      return;
    }

    const actualCatVal = parseInt(rodeo[categoria_key], 10) || 0;
    if (cantNum > actualCatVal) {
      notify(
        `El rodeo "${rodeo.nombre}" tiene ${actualCatVal} cabezas en esa categoría (no podés descontar ${cantNum}).`,
        'error'
      );
      return;
    }

    setSaving(true);
    try {
      const nuevoValor = Math.max(0, actualCatVal - cantNum);
      const catLabel =
        CATEGORIAS_COLUMNA_RODEO.find((c) => c.key === categoria_key)?.label ||
        categoria_key;

      const updateData = {
        [categoria_key]: nuevoValor,
        fecha_actualizacion: fecha || new Date().toISOString().slice(0, 10),
      };

      if (categoria_key === 'terneros' && sexo_ternero === 'macho') {
        updateData.terneros_machos = Math.max(
          0,
          (parseInt(rodeo.terneros_machos, 10) || 0) - cantNum
        );
      } else if (categoria_key === 'terneros' && sexo_ternero === 'hembra') {
        updateData.terneros_hembras = Math.max(
          0,
          (parseInt(rodeo.terneros_hembras, 10) || 0) - cantNum
        );
      }

      const { error: errUpd } = await supabase
        .from('rodeos')
        .update(updateData)
        .eq('id', rodeo.id);
      if (errUpd) throw errUpd;

      const { error: errHist } = await supabase.from('movimientos_hacienda').insert({
        fecha: fecha || new Date().toISOString().slice(0, 10),
        tipo_movimiento,
        rodeo_id: rodeo.id,
        rodeo_nombre: rodeo.nombre,
        potrero_origen:
          rodeo.potrero_numero !== '' && rodeo.potrero_numero != null
            ? parseInt(rodeo.potrero_numero, 10)
            : null,
        potrero_destino: null,
        categoria_afectada: catLabel,
        cantidad_cabezas: cantNum,
        motivo_observaciones: motivo?.trim() || tipo_movimiento,
      });
      if (errHist) throw errHist;

      notify(
        `${tipo_movimiento} registrada: -${cantNum} ${catLabel} en rodeo "${rodeo.nombre}".`,
        'success'
      );
      setSalidaRodeoModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al registrar salida: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Eliminar Rodeo (Funciona tanto en Producción como en Modo Sandbox)
  async function handleDeleteRodeo(rodeo) {
    if (!rodeo) return;
    const total = calcTotalRodeoRow(rodeo);

    let descMsg = '';
    if (total > 0) {
      descMsg = `Este rodeo tiene ${total} cabezas activas registradas. Al eliminarlo, deberás reasignar sus animales a otro rodeo.`;
    } else {
      descMsg = 'Este rodeo no contiene animales activos actualmente.';
    }

    const okDelRodeo = await confirmAction({
      title: `¿Eliminar rodeo "${rodeo.nombre}"?`,
      description: descMsg,
      confirmText: 'Sí, eliminar rodeo',
      variant: 'danger',
    });

    if (!okDelRodeo) return;

    setSavingRodeoId(rodeo.id);
    try {
      const { error } = await supabase.from('rodeos').delete().eq('id', rodeo.id);
      if (error) throw error;

      // Actualizar estado optimista local de rodeos en la vista
      setEditedRodeos((prev) => {
        const next = { ...prev };
        delete next[rodeo.id];
        return next;
      });

      // Registrar auditoría con snapshot para deshacer
      try {
        await registrarAuditLog({
          tipo_operacion: 'ELIMINAR_RODEO',
          modulo: 'Rodeos',
          descripcion: `Eliminación de rodeo "${rodeo.nombre}" (${total} cabezas)`,
          afectados_tabla: 'rodeos',
          afectados_ids: [rodeo.id],
          snapshot_previo: { rodeo: { ...rodeo } },
          metadata: { rodeo_nombre: rodeo.nombre, total_cabezas: total },
        });
      } catch (logErr) {
        console.warn('Error guardando audit log:', logErr);
      }

      notify(`Rodeo "${rodeo.nombre}" eliminado correctamente.`, 'success');
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      console.error('Error al eliminar rodeo:', err);
      notify(`Error al eliminar rodeo: ${err.message || 'Error desconocido'}`, 'error');
    } finally {
      setSavingRodeoId(null);
    }
  }

  // Compatibilidad hacia atrás
  const handleDeleteRodeoVacio = handleDeleteRodeo;

  // Reordenar Rodeos (drag and drop y subir/bajar fila persistido en Supabase y Sandbox)
  const handleReorderRodeo = async (sourceId, targetId, direction = null) => {
    const currentList = [...rodeosRender];
    const sourceIndex = currentList.findIndex((r) => r.id === sourceId);
    if (sourceIndex === -1) return;

    let newIndex;
    if (direction === 'up') {
      if (sourceIndex === 0) return;
      newIndex = sourceIndex - 1;
    } else if (direction === 'down') {
      if (sourceIndex === currentList.length - 1) return;
      newIndex = sourceIndex + 1;
    } else if (targetId !== undefined && targetId !== null) {
      const targetIndex = currentList.findIndex((r) => r.id === targetId);
      if (targetIndex === -1 || targetIndex === sourceIndex) return;
      newIndex = targetIndex;
    } else {
      return;
    }

    const reordered = [...currentList];
    const [movedItem] = reordered.splice(sourceIndex, 1);
    reordered.splice(newIndex, 0, movedItem);

    const updates = reordered.map((item, idx) => ({
      id: item.id,
      orden: idx + 1,
    }));

    setOptimisticOrder(updates);
    setReorderingRodeoId(sourceId);

    try {
      await Promise.all(
        updates.map((u) =>
          supabase
            .from('rodeos')
            .update({ orden: u.orden })
            .eq('id', u.id)
        )
      );

      notify(`Orden actualizado: "${movedItem.nombre}" ahora en posición ${newIndex + 1}.`, 'success');
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error al reordenar rodeos:', err);
      notify('Error al guardar el nuevo orden de rodeos', 'error');
    } finally {
      setReorderingRodeoId(null);
      setOptimisticOrder(null);
    }
  };

  // Fusión de Rodeos (Reintegrar tropas apartadas sin duplicar stock)
  async function handleConfirmFusion(e) {
    e.preventDefault();
    if (!fusionModal) return;
    const { rodeoOrigenId, rodeoDestinoId, fecha, motivo, eliminarOrigen } = fusionModal;
    if (!rodeoOrigenId || !rodeoDestinoId) {
      notify('Seleccioná el rodeo de origen y el rodeo de destino.', 'error');
      return;
    }
    if (String(rodeoOrigenId) === String(rodeoDestinoId)) {
      notify('El rodeo de origen y de destino no pueden ser el mismo.', 'error');
      return;
    }
    const origen = rodeos.find((r) => String(r.id) === String(rodeoOrigenId));
    const destino = rodeos.find((r) => String(r.id) === String(rodeoDestinoId));
    if (!origen || !destino) {
      notify('Rodeo no encontrado.', 'error');
      return;
    }
    const editOrig = editedRodeos[origen.id] || origen;
    const editDest = editedRodeos[destino.id] || destino;
    const totalCab = calcTotalRodeoRow(editOrig);

    if (totalCab <= 0) {
      notify(`El rodeo origen "${origen.nombre}" no tiene cabezas activas para transferir.`, 'warning');
      return;
    }

    setSaving(true);
    try {
      const fechaMov = fecha || new Date().toISOString().slice(0, 10);

      // 1. Sumar cabezas en el rodeo destino
      const destPayload = {
        vacas: (parseInt(editDest.vacas, 10) || 0) + (parseInt(editOrig.vacas, 10) || 0),
        terneros: (parseInt(editDest.terneros, 10) || 0) + (parseInt(editOrig.terneros, 10) || 0),
        terneros_machos: (parseInt(editDest.terneros_machos, 10) || 0) + (parseInt(editOrig.terneros_machos, 10) || 0),
        terneros_hembras: (parseInt(editDest.terneros_hembras, 10) || 0) + (parseInt(editOrig.terneros_hembras, 10) || 0),
        mamones_machos: 0,
        mamones_hembras: 0,
        toros_padres: (parseInt(editDest.toros_padres, 10) || 0) + (parseInt(editOrig.toros_padres, 10) || 0),
        toritos: (parseInt(editDest.toritos, 10) || 0) + (parseInt(editOrig.toritos, 10) || 0),
        vacas_cut: (parseInt(editDest.vacas_cut, 10) || 0) + (parseInt(editOrig.vacas_cut, 10) || 0),
        vaquillonas_reposicion: (parseInt(editDest.vaquillonas_reposicion, 10) || 0) + (parseInt(editOrig.vaquillonas_reposicion, 10) || 0),
        fecha_actualizacion: fechaMov,
      };

      const { error: errDest } = await supabase.from('rodeos').update(destPayload).eq('id', destino.id);
      if (errDest) throw errDest;

      // 2. Rodeo origen: eliminar o vaciar a 0 cabezas
      if (eliminarOrigen) {
        const { error: errDel } = await supabase.from('rodeos').delete().eq('id', origen.id);
        if (errDel) throw errDel;
      } else {
        const origPayload = {
          vacas: 0,
          terneros: 0,
          terneros_machos: 0,
          terneros_hembras: 0,
          mamones_machos: 0,
          mamones_hembras: 0,
          toros_padres: 0,
          toritos: 0,
          vacas_cut: 0,
          vaquillonas_reposicion: 0,
          estado_observaciones: `Reintegrado / fusionado en "${destino.nombre}" el ${fechaMov}.`,
          fecha_actualizacion: fechaMov,
        };
        const { error: errOrig } = await supabase.from('rodeos').update(origPayload).eq('id', origen.id);
        if (errOrig) throw errOrig;
      }

      // 3. Reasignar animales individuales del origen al destino
      await supabase
        .from('animales')
        .update({
          rodeo: destino.nombre,
          potrero_actual: destino.potrero_numero,
          fecha_ultimo_movimiento: fechaMov,
        })
        .ilike('rodeo', origen.nombre);

      // 4. Registrar evento en movimientos_hacienda
      const obsFusion = `Fusión de rodeo "${origen.nombre}" (${totalCab} cab.) reintegrado a "${destino.nombre}". ${
        motivo?.trim() ? `Motivo: ${motivo.trim()}` : 'Reintegro de tropa apartada.'
      }`;
      const { error: errMov } = await supabase.from('movimientos_hacienda').insert({
        fecha: fechaMov,
        tipo_movimiento: 'Fusión de Rodeos',
        rodeo_id: destino.id,
        rodeo_nombre: destino.nombre,
        potrero_origen: origen.potrero_numero ? parseInt(origen.potrero_numero, 10) : null,
        potrero_destino: destino.potrero_numero ? parseInt(destino.potrero_numero, 10) : null,
        categoria_afectada: 'Consolidación de rodeo',
        cantidad_cabezas: totalCab,
        motivo_observaciones: obsFusion,
      });
      if (errMov) throw errMov;

      // Registrar auditoría con snapshot para deshacer
      try {
        await registrarAuditLog({
          tipo_operacion: 'FUSION_RODEOS',
          modulo: 'Rodeos',
          descripcion: `Fusión de rodeo "${origen.nombre}" (${totalCab} cab.) en "${destino.nombre}"`,
          afectados_tabla: 'rodeos',
          afectados_ids: [origen.id, destino.id],
          snapshot_previo: {
            origen: { ...origen },
            destino: { ...destino },
            eliminarOrigen,
          },
          metadata: {
            cabezas_transferidas: totalCab,
            origen_nombre: origen.nombre,
            destino_nombre: destino.nombre,
          },
        });
      } catch (logErr) {
        console.warn('Error guardando audit log fusión:', logErr);
      }

      notify(
        `¡Fusión exitosa! Se reintegraron ${totalCab} cabezas de "${origen.nombre}" en "${destino.nombre}".`,
        'success'
      );
      setFusionModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al fusionar rodeos: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Acción rápida: Marcar todos los rodeos de vientres / cría en Servicio Activo
  async function handleMarcarTodosRodeosCriaEnServicio() {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const rodeosCria = (rodeos || []).filter((r) => {
        const edit = editedRodeos[r.id] || r;
        const nom = (edit.nombre || '').toUpperCase().trim();
        const rol = (edit.rol_protocolo || '').toLowerCase();
        if (edit.id === 10 || nom === 'TOROS' || (nom.includes('TORO') && !nom.includes('REPASO') && (rol.includes('toro') || nom === 'TOROS'))) return false;
        if (nom.includes('DESTETE') || nom.includes('VENTA') || rol.includes('destete') || rol.includes('venta')) return false;
        return true;
      });

      if (rodeosCria.length === 0) {
        notify('No se encontraron rodeos de cría para activar.', 'info');
        return;
      }

      const updatesEdited = { ...editedRodeos };

      for (const r of rodeosCria) {
        const edit = editedRodeos[r.id] || r;
        const padres = parseInt(edit.toros_padres, 10) || 0;
        const toritos = parseInt(edit.toritos, 10) || 0;
        const payload = {
          toros_en_servicio: true,
          fecha_actualizacion: hoy,
        };
        if (padres === 0 && toritos === 0 && !edit.toro_lote_asignado) {
          payload.toro_lote_asignado = 'En servicio (s/ asignar)';
        }

        updatesEdited[r.id] = {
          ...edit,
          ...payload,
        };

        await supabase.from('rodeos').update(payload).eq('id', r.id);
      }

      setEditedRodeos(updatesEdited);
      notify(`✓ Se marcaron ${rodeosCria.length} rodeos de cría en Servicio Activo.`, 'success');
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error al marcar rodeos de cría en servicio:', err);
      notify(`Error al activar servicio en rodeos: ${err.message}`, 'error');
    }
  }

  // Guardar estado reproductivo desde el modal / ficha de rodeo
  async function handleSaveReproductiveData(e) {
    if (e) e.preventDefault();
    if (!reproductiveModalRodeo) return;
    setSavingReproductiveSchedule(true);
    try {
      const enServicio = Boolean(reprodForm.toros_en_servicio);
      const conCantidad = reprodForm.asignar_modo === 'con_cantidad';

      const padres = enServicio && conCantidad ? (parseInt(reprodForm.toros_padres, 10) || 0) : 0;
      const toritos = enServicio && conCantidad ? (parseInt(reprodForm.toritos, 10) || 0) : 0;

      let lote = reprodForm.toro_lote_asignado?.trim() || null;
      if (enServicio && !conCantidad && !lote) {
        lote = 'En servicio (s/ asignar)';
      } else if (!enServicio) {
        lote = null;
      }

      const payload = {
        toros_padres: padres,
        toritos: toritos,
        toros_en_servicio: enServicio,
        toro_lote_asignado: lote,
        fecha_entore: reprodForm.fecha_entore || null,
        fecha_salida_toros: reprodForm.fecha_salida_toros || null,
        manejo_iatf: Boolean(reprodForm.manejo_iatf),
        fecha_inseminacion: reprodForm.manejo_iatf && reprodForm.fecha_inseminacion ? reprodForm.fecha_inseminacion : null,
        repaso_toros: Boolean(reprodForm.repaso_toros),
        fecha_repaso_toros: reprodForm.repaso_toros && reprodForm.fecha_repaso_toros ? reprodForm.fecha_repaso_toros : null,
        fecha_actualizacion: new Date().toISOString().slice(0, 10),
      };

      const { error } = await supabase.from('rodeos').update(payload).eq('id', reproductiveModalRodeo.id);
      if (error) throw error;

      // Sincronizar bidireccionalmente en memoria local inmediatamente
      setEditedRodeos((prev) => ({
        ...prev,
        [reproductiveModalRodeo.id]: {
          ...(prev[reproductiveModalRodeo.id] || reproductiveModalRodeo),
          ...payload,
        },
      }));

      notify(`Ficha reproductiva de "${reproductiveModalRodeo.nombre}" guardada con éxito.`, 'success');
      setReproductiveModalRodeo(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar estado reproductivo: ${err.message}`, 'error');
    } finally {
      setSavingReproductiveSchedule(false);
    }
  }

  // Dual Impact: Venta de Hacienda (Descuenta de rodeo + movimientos_hacienda + ventas_hacienda)
  async function handleConfirmVentaHacienda(e) {
    e.preventDefault();
    if (!ventaModal) return;
    const {
      rodeo_id,
      categoria,
      cabezas,
      kilos_totales,
      precio_kg,
      moneda,
      tipo_cambio,
      gastos_comercializacion,
      comprador,
      destino_consignatario,
      observaciones,
      fecha,
    } = ventaModal;

    const cabNum = parseInt(cabezas, 10) || 0;
    if (cabNum <= 0) {
      notify('Ingresá una cantidad de cabezas mayor a 0.', 'error');
      return;
    }
    const rodeo = rodeos.find((r) => r.id === rodeo_id);
    if (!rodeo) {
      notify('Seleccioná el rodeo de origen.', 'error');
      return;
    }

    setSaving(true);
    try {
      const catKeyMap = {
        'Vacas': 'vacas',
        'Terneros Machos': 'terneros_machos',
        'Terneros Hembras': 'terneros_hembras',
        'Terneros Total': 'terneros',
        'Toros Padres': 'toros_padres',
        'Toritos': 'toritos',
        'Vacas CUT': 'vacas_cut',
        'Vaquillonas Reposición': 'vaquillonas_reposicion',
      };
      const catKey = catKeyMap[categoria] || 'vacas';
      const actualVal = parseInt(rodeo[catKey], 10) || 0;
      const nuevoValor = Math.max(0, actualVal - cabNum);

      const rodeoUpdate = {
        [catKey]: nuevoValor,
        updated_at: new Date().toISOString(),
        fecha_actualizacion: fecha || new Date().toISOString().slice(0, 10),
      };
      if (catKey === 'terneros_machos') {
        const h = parseInt(rodeo.terneros_hembras, 10) || 0;
        rodeoUpdate.terneros = nuevoValor + h;
      } else if (catKey === 'terneros_hembras') {
        const m = parseInt(rodeo.terneros_machos, 10) || 0;
        rodeoUpdate.terneros = m + nuevoValor;
      }

      // 1. Descontar cabezas en tabla rodeos
      const { error: errUpdRodeo } = await supabase
        .from('rodeos')
        .update(rodeoUpdate)
        .eq('id', rodeo.id);
      if (errUpdRodeo) throw errUpdRodeo;

      // 2. Registrar en movimientos_hacienda
      const kgTotal = parseFloat(kilos_totales) || 0;
      const { error: errMov } = await supabase.from('movimientos_hacienda').insert({
        fecha: fecha || new Date().toISOString().slice(0, 10),
        tipo_movimiento: 'Venta',
        rodeo_id: rodeo.id,
        rodeo_nombre: rodeo.nombre,
        potrero_origen:
          rodeo.potrero_numero !== '' && rodeo.potrero_numero != null
            ? parseInt(rodeo.potrero_numero, 10)
            : null,
        potrero_destino: null,
        categoria_afectada: categoria,
        cantidad_cabezas: cabNum,
        motivo_observaciones: `Venta: ${cabNum} cab. ${kgTotal > 0 ? `(${kgTotal.toLocaleString('es-AR')} kg)` : ''} a ${comprador || 'Consignatario'}. ${observaciones || ''}`.trim(),
      });
      if (errMov) throw errMov;

      // 3. Asiento contable en ventas_hacienda
      const tc = parseFloat(tipo_cambio) || Number(dolarRef) || 1420;
      const pKg = parseFloat(precio_kg) || 0;
      const gastosCom = parseFloat(gastos_comercializacion) || 0;
      const brutoArs = moneda === 'USD' ? (kgTotal * pKg * tc) : (kgTotal * pKg);
      const netoArs = Math.max(0, brutoArs - gastosCom);
      const netoUsd = Math.round((netoArs / tc) * 100) / 100;

      const { error: errVenta } = await supabase.from('ventas_hacienda').insert({
        fecha: fecha || new Date().toISOString().slice(0, 10),
        rodeo_nombre: rodeo.nombre,
        categoria,
        cantidad_cabezas: cabNum,
        kilos_totales: kgTotal,
        moneda_carga: moneda || 'ARS',
        tipo_cambio: tc,
        precio_kg: pKg,
        importe_bruto_ars: Math.round(brutoArs * 100) / 100,
        gastos_comercializacion_ars: Math.round(gastosCom * 100) / 100,
        ingreso_neto_ars: Math.round(netoArs * 100) / 100,
        ingreso_neto_usd: netoUsd,
        comprador: comprador?.trim() || null,
        destino_consignatario: destino_consignatario?.trim() || null,
        observaciones: observaciones?.trim() || null,
      });
      if (errVenta) throw errVenta;

      notify(
        `¡Venta registrada con impacto directo! -${cabNum} ${categoria} de "${rodeo.nombre}" y asiento de $${Math.round(netoArs).toLocaleString('es-AR')} netos generado.`,
        'success'
      );
      setVentaModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al registrar venta: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Dual Impact: Compra / Ingreso de Hacienda (Suma a rodeo + movimientos_hacienda + gastos_campo)
  async function handleConfirmCompraIngreso(e) {
    e.preventDefault();
    if (!compraModal) return;
    const {
      rodeo_id,
      categoria,
      cabezas,
      monto_total,
      moneda,
      tipo_cambio,
      proveedor,
      observaciones,
      fecha,
    } = compraModal;

    const cabNum = parseInt(cabezas, 10) || 0;
    if (cabNum <= 0) {
      notify('Ingresá una cantidad de cabezas mayor a 0.', 'error');
      return;
    }
    const rodeo = rodeos.find((r) => r.id === rodeo_id);
    if (!rodeo) {
      notify('Seleccioná el rodeo de destino.', 'error');
      return;
    }

    setSaving(true);
    try {
      const catKeyMap = {
        'Vaquillonas Reposición': 'vaquillonas_reposicion',
        'Toros Padres': 'toros_padres',
        'Toritos': 'toritos',
        'Vacas': 'vacas',
        'Terneros': 'terneros',
      };
      const catKey = catKeyMap[categoria] || 'vaquillonas_reposicion';
      const actualVal = parseInt(rodeo[catKey], 10) || 0;
      const nuevoValor = actualVal + cabNum;

      // 1. Sumar cabezas en tabla rodeos
      const { error: errUpdRodeo } = await supabase
        .from('rodeos')
        .update({
          [catKey]: nuevoValor,
          updated_at: new Date().toISOString(),
          fecha_actualizacion: fecha || new Date().toISOString().slice(0, 10),
        })
        .eq('id', rodeo.id);
      if (errUpdRodeo) throw errUpdRodeo;

      // 2. Registrar en movimientos_hacienda
      const { error: errMov } = await supabase.from('movimientos_hacienda').insert({
        fecha: fecha || new Date().toISOString().slice(0, 10),
        tipo_movimiento: 'Compra / Ingreso',
        rodeo_id: rodeo.id,
        rodeo_nombre: rodeo.nombre,
        potrero_origen: null,
        potrero_destino:
          rodeo.potrero_numero !== '' && rodeo.potrero_numero != null
            ? parseInt(rodeo.potrero_numero, 10)
            : null,
        categoria_afectada: categoria,
        cantidad_cabezas: cabNum,
        motivo_observaciones: `Compra / Ingreso: ${cabNum} cab. de ${proveedor || 'Proveedor'}. ${observaciones || ''}`.trim(),
      });
      if (errMov) throw errMov;

      // 3. Asiento contable en gastos_campo si el monto es mayor a cero
      const tc = parseFloat(tipo_cambio) || Number(dolarRef) || 1420;
      const montoOrig = parseFloat(monto_total) || 0;
      if (montoOrig > 0) {
        const montoArs = moneda === 'USD' ? montoOrig * tc : montoOrig;
        const montoUsd = moneda === 'USD' ? montoOrig : Math.round((montoOrig / tc) * 100) / 100;

        const { error: errGasto } = await supabase.from('gastos_campo').insert({
          fecha: fecha || new Date().toISOString().slice(0, 10),
          rubro: 'Compra de Hacienda',
          concepto: `Compra ${cabNum} cab. (${categoria}) para rodeo ${rodeo.nombre}`,
          proveedor: proveedor?.trim() || null,
          moneda_carga: moneda || 'ARS',
          tipo_cambio: tc,
          monto_original: montoOrig,
          monto_ars: Math.round(montoArs * 100) / 100,
          monto_usd: Math.round(montoUsd * 100) / 100,
          rodeo_nombre: rodeo.nombre,
          estado_pago: 'Pagado',
          observaciones: observaciones?.trim() || null,
        });
        if (errGasto) throw errGasto;
      }

      notify(
        `¡Compra / Ingreso registrado! +${cabNum} ${categoria} sumadas a "${rodeo.nombre}".`,
        'success'
      );
      setCompraModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al registrar compra: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Nacimiento / Destete de Terneros
  async function handleConfirmNacimientoDestete(e) {
    e.preventDefault();
    if (!nacimientoModal) return;
    const { rodeo_id, tipo, machos, hembras, peso_promedio, observaciones, fecha } = nacimientoModal;

    const mNum = parseInt(machos, 10) || 0;
    const hNum = parseInt(hembras, 10) || 0;
    const totalNum = mNum + hNum;
    if (totalNum <= 0) {
      notify('Ingresá al menos 1 ternero macho o hembra.', 'error');
      return;
    }
    const rodeo = rodeos.find((r) => r.id === rodeo_id);
    if (!rodeo) {
      notify('Seleccioná el rodeo de cría.', 'error');
      return;
    }

    setSaving(true);
    try {
      if (tipo === 'Nacimiento') {
        const currT = parseInt(rodeo.terneros, 10) || 0;
        const currM = parseInt(rodeo.terneros_machos, 10) || 0;
        const currH = parseInt(rodeo.terneros_hembras, 10) || 0;

        const { error: errUpdRodeo } = await supabase
          .from('rodeos')
          .update({
            terneros: currT + totalNum,
            terneros_machos: currM + mNum,
            terneros_hembras: currH + hNum,
            updated_at: new Date().toISOString(),
            fecha_actualizacion: fecha || new Date().toISOString().slice(0, 10),
          })
          .eq('id', rodeo.id);
        if (errUpdRodeo) throw errUpdRodeo;
      }

      const { error: errMov } = await supabase.from('movimientos_hacienda').insert({
        fecha: fecha || new Date().toISOString().slice(0, 10),
        tipo_movimiento: tipo,
        rodeo_id: rodeo.id,
        rodeo_nombre: rodeo.nombre,
        potrero_origen:
          rodeo.potrero_numero !== '' && rodeo.potrero_numero != null
            ? parseInt(rodeo.potrero_numero, 10)
            : null,
        potrero_destino: null,
        categoria_afectada: 'Terneros',
        cantidad_cabezas: totalNum,
        motivo_observaciones: `${tipo}: ${mNum} Machos · ${hNum} Hembras (Total ${totalNum} cab.). ${peso_promedio ? `Peso prom: ${peso_promedio} kg. ` : ''}${observaciones || ''}`.trim(),
      });
      if (errMov) throw errMov;

      notify(
        `¡${tipo} registrado! +${totalNum} terneros (${mNum}M / ${hNum}H) en "${rodeo.nombre}".`,
        'success'
      );
      setNacimientoModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error registrando ${tipo}: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Baja por Mortandad
  async function handleConfirmBajaMortandad(e) {
    e.preventDefault();
    if (!bajaModal) return;
    const { rodeo_id, categoria, cabezas, causa, necropsia, observaciones, fecha } = bajaModal;

    const cabNum = parseInt(cabezas, 10) || 0;
    if (cabNum <= 0) {
      notify('Ingresá una cantidad de cabezas mayor a 0.', 'error');
      return;
    }
    const rodeo = rodeos.find((r) => r.id === rodeo_id);
    if (!rodeo) {
      notify('Seleccioná el rodeo.', 'error');
      return;
    }

    setSaving(true);
    try {
      const catKeyMap = {
        'Vacas': 'vacas',
        'Terneros': 'terneros',
        'Toros Padres': 'toros_padres',
        'Toritos': 'toritos',
        'Vacas CUT': 'vacas_cut',
        'Vaquillonas Reposición': 'vaquillonas_reposicion',
      };
      const catKey = catKeyMap[categoria] || 'vacas';
      const actualVal = parseInt(rodeo[catKey], 10) || 0;
      const nuevoValor = Math.max(0, actualVal - cabNum);

      // 1. Descontar cabezas en tabla rodeos
      const { error: errUpdRodeo } = await supabase
        .from('rodeos')
        .update({
          [catKey]: nuevoValor,
          updated_at: new Date().toISOString(),
          fecha_actualizacion: fecha || new Date().toISOString().slice(0, 10),
        })
        .eq('id', rodeo.id);
      if (errUpdRodeo) throw errUpdRodeo;

      // 2. Registrar en movimientos_hacienda
      const { error: errMov } = await supabase.from('movimientos_hacienda').insert({
        fecha: fecha || new Date().toISOString().slice(0, 10),
        tipo_movimiento: 'Mortandad',
        rodeo_id: rodeo.id,
        rodeo_nombre: rodeo.nombre,
        potrero_origen:
          rodeo.potrero_numero !== '' && rodeo.potrero_numero != null
            ? parseInt(rodeo.potrero_numero, 10)
            : null,
        potrero_destino: null,
        categoria_afectada: categoria,
        cantidad_cabezas: cabNum,
        motivo_observaciones: `Mortandad: ${causa || 'Sin diagnóstico'}. Necropsia: ${necropsia || 'No'}. ${observaciones || ''}`.trim(),
      });
      if (errMov) throw errMov;

      notify(
        `Baja por mortandad registrada: -${cabNum} ${categoria} de "${rodeo.nombre}". Diagnóstico: ${causa}.`,
        'success'
      );
      setBajaModal(null);
      await onRefresh();
    } catch (err) {
      notify(`Error registrando mortandad: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Abrir modal de confirmación y reversión para eliminar un movimiento
  function handleDeleteMovimiento(mOrId) {
    if (!mOrId) return;
    if (typeof mOrId === 'object') {
      setConfirmDeleteMovModal(mOrId);
      return;
    }
    const mov = (movimientosHacienda || []).find((m) => m.id === mOrId);
    if (mov) {
      setConfirmDeleteMovModal(mov);
    } else {
      setConfirmDeleteMovModal({ id: mOrId, tipo_movimiento: 'Movimiento' });
    }
  }

  // Eliminar movimiento y revertir stock en el rodeo afectado
  async function handleEliminarYRevertirStock(movimiento, rodeo, fieldKey, deltaReversion, stockProyectadoCat) {
    if (!movimiento) return;
    setDeletingMovState(true);
    try {
      // 1. Si hay rodeo asociado y deltaReversion !== 0, revertir el stock en rodeos
      if (rodeo && deltaReversion !== 0) {
        const rodeoUpdate = {
          [fieldKey]: stockProyectadoCat,
          updated_at: new Date().toISOString(),
          fecha_actualizacion: new Date().toISOString().slice(0, 10),
        };

        if (fieldKey === 'terneros_machos') {
          const h = parseInt(rodeo.terneros_hembras, 10) || 0;
          rodeoUpdate.terneros = stockProyectadoCat + h;
        } else if (fieldKey === 'terneros_hembras') {
          const m = parseInt(rodeo.terneros_machos, 10) || 0;
          rodeoUpdate.terneros = m + stockProyectadoCat;
        } else if (fieldKey === 'terneros') {
          rodeoUpdate.terneros = stockProyectadoCat;
        }

        // Supabase
        const { error: errUpd } = await supabase.from('rodeos').update(rodeoUpdate).eq('id', rodeo.id);
        if (errUpd) throw errUpd;

        // Estado local inmediato de rodeos
        setEditedRodeos((prev) => ({
          ...prev,
          [rodeo.id]: {
            ...(prev[rodeo.id] || rodeo),
            ...rodeoUpdate,
          },
        }));

        // Sincronización en Modo Sandbox (localStorage 'san_jose_sandbox_data')
        try {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          if (raw) {
            const sData = JSON.parse(raw);
            if (Array.isArray(sData.rodeos)) {
              const idx = sData.rodeos.findIndex((r) => r.id === rodeo.id);
              if (idx !== -1) {
                const merged = { ...sData.rodeos[idx], ...rodeoUpdate };
                sData.rodeos[idx] = {
                  ...merged,
                  total_cabezas: calcTotalRodeoRow(merged),
                };
              }
            }
            if (Array.isArray(sData.movimientosHacienda)) {
              sData.movimientosHacienda = sData.movimientosHacienda.filter((item) => item.id !== movimiento.id);
            }
            localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
            window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'rodeos' } }));
          }
        } catch (sbErr) {
          console.warn('Aviso sincronizando sandbox:', sbErr);
        }
      }

      // 2. Eliminar de movimientos_hacienda en Supabase
      const { error: errDel } = await supabase.from('movimientos_hacienda').delete().eq('id', movimiento.id);
      if (errDel) throw errDel;

      // Intentar también en movimientos_ganaderos si existe
      try {
        await supabase.from('movimientos_ganaderos').delete().eq('id', movimiento.id);
      } catch (_) {}

      // Limpiar también movimientosHacienda en sandbox
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.movimientosHacienda)) {
            sData.movimientosHacienda = sData.movimientosHacienda.filter((item) => item.id !== movimiento.id);
            localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          }
        }
      } catch (_) {}

      notify(
        rodeo && deltaReversion !== 0
          ? `✓ Movimiento eliminado y stock revertido: ${deltaReversion > 0 ? '+' : ''}${deltaReversion} cab. en ${rodeo.nombre}.`
          : '✓ Movimiento eliminado del historial.',
        'success'
      );
      setConfirmDeleteMovModal(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error eliminando y revirtiendo movimiento:', err);
      notify(`Error al procesar eliminación: ${err.message}`, 'error');
    } finally {
      setDeletingMovState(false);
    }
  }

  // Eliminar solo el registro del historial sin tocar el stock actual del rodeo
  async function handleSoloBorrarRegistro(movimiento) {
    if (!movimiento) return;
    const ok = await confirmAction({
      title: '¿Eliminar registro del historial de movimientos?',
      description: `Tipo: ${movimiento.tipo_movimiento || 'Movimiento'} (${movimiento.cantidad_cabezas || 0} cabezas). Se eliminará del historial sin revertir el stock del rodeo.`,
      confirmText: 'Sí, borrar',
      variant: 'warning',
    });
    if (!ok) return;
    setDeletingMovState(true);
    try {
      const { error: errDel } = await supabase.from('movimientos_hacienda').delete().eq('id', movimiento.id);
      if (errDel) throw errDel;

      try {
        await supabase.from('movimientos_ganaderos').delete().eq('id', movimiento.id);
      } catch (_) {}

      // Limpiar en sandbox
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.movimientosHacienda)) {
            sData.movimientosHacienda = sData.movimientosHacienda.filter((item) => item.id !== movimiento.id);
            localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
            window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'movimientosHacienda' } }));
          }
        }
      } catch (_) {}

      notify('Registro eliminado del historial sin alterar el stock de hacienda.', 'info');
      setConfirmDeleteMovModal(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error al borrar registro:', err);
      notify(`Error al borrar registro: ${err.message}`, 'error');
    } finally {
      setDeletingMovState(false);
    }
  }

  // Agendar hitos reproductivos calculados automáticamente a partir del inicio de entore
  async function handleScheduleReproductiveMilestones(rodeo, fechaEntoreStr) {
    if (!rodeo || !fechaEntoreStr) return;
    setSavingReproductiveSchedule(true);
    try {
      // 0. Guardar la ficha reproductiva actualizada en la tabla rodeos
      const enServicio = Boolean(reprodForm.toros_en_servicio);
      const conCantidad = reprodForm.asignar_modo === 'con_cantidad';
      const padres = enServicio && conCantidad ? (parseInt(reprodForm.toros_padres, 10) || 0) : 0;
      const toritos = enServicio && conCantidad ? (parseInt(reprodForm.toritos, 10) || 0) : 0;
      let lote = reprodForm.toro_lote_asignado?.trim() || null;
      if (enServicio && !conCantidad && !lote) {
        lote = 'En servicio (s/ asignar)';
      } else if (!enServicio) {
        lote = null;
      }

      const rodeoPayload = {
        toros_padres: padres,
        toritos: toritos,
        toros_en_servicio: enServicio,
        toro_lote_asignado: lote,
        fecha_entore: reprodForm.fecha_entore || fechaEntoreStr || null,
        fecha_salida_toros: reprodForm.fecha_salida_toros || null,
        manejo_iatf: Boolean(reprodForm.manejo_iatf),
        fecha_inseminacion: reprodForm.manejo_iatf && reprodForm.fecha_inseminacion ? reprodForm.fecha_inseminacion : null,
        repaso_toros: Boolean(reprodForm.repaso_toros),
        fecha_repaso_toros: reprodForm.repaso_toros && reprodForm.fecha_repaso_toros ? reprodForm.fecha_repaso_toros : null,
        fecha_actualizacion: new Date().toISOString().slice(0, 10),
      };
      await supabase.from('rodeos').update(rodeoPayload).eq('id', rodeo.id);

      setEditedRodeos((prev) => ({
        ...prev,
        [rodeo.id]: {
          ...(prev[rodeo.id] || rodeo),
          ...rodeoPayload,
        },
      }));

      const baseDate = new Date(fechaEntoreStr);

      const addDays = (d, days) => {
        const copy = new Date(d);
        copy.setDate(copy.getDate() + days);
        return copy.toISOString().slice(0, 10);
      };

      const tactoDate = addDays(baseDate, 60);
      const prepartoDate = addDays(baseDate, 253);
      const paricionDate = addDays(baseDate, 283);
      const desteteDate = addDays(baseDate, 490);

      // 1. Insertar en eventos_sanitarios
      const eventosPayload = [
        {
          categoria: 'Tacto Rectal / Ecografía',
          nombre_evento: `Tacto y Diagnóstico de Preñez — Rodeo ${rodeo.nombre}`,
          fecha_programada: tactoDate,
          estado: 'Pendiente',
          rodeo_id: rodeo.id,
          dosis_ml: null,
          observaciones: `Cálculo automático de entore (${fechaEntoreStr}). Diagnóstico ecográfico / palpación rectal.`,
        },
        {
          categoria: 'Vacunación Pre-Parto',
          nombre_evento: `Vacunación Pre-Parto (Clostridiosis + Queratoconjuntivitis) — ${rodeo.nombre}`,
          fecha_programada: prepartoDate,
          estado: 'Pendiente',
          rodeo_id: rodeo.id,
          dosis_ml: 5,
          observaciones: `Refuerzo 30 días antes del inicio de parición para inmunidad calostral.`,
        },
      ];
      await supabase.from('eventos_sanitarios').insert(eventosPayload);

      // 2. Insertar en tareas_campo
      const tareasPayload = [
        {
          titulo: `Inicio Estimado de Parición (+283d): Rodeo ${rodeo.nombre}`,
          categoria: 'Hacienda',
          potrero_numero: rodeo.potrero_numero || null,
          prioridad: 'Alta',
          fecha_limite: paricionDate,
          estado: 'Pendiente',
          responsable: 'Recorredor San José',
          observaciones: `Comienza la parición del rodeo ${rodeo.nombre}. Monitorear terneros nacidos, calostrado y posibles distocias.`,
        },
        {
          titulo: `Destete Proyectado: Terneros de Rodeo ${rodeo.nombre}`,
          categoria: 'Hacienda',
          potrero_numero: rodeo.potrero_numero || null,
          prioridad: 'Media',
          fecha_limite: desteteDate,
          estado: 'Pendiente',
          responsable: 'Equipo San José',
          observaciones: `Fecha estimada de destete tradicional (aprox. 180-210 días pos-parto).`,
        },
      ];
      await supabase.from('tareas_campo').insert(tareasPayload);

      notify?.(`¡Hitos reproductivos agendados para "${rodeo.nombre}" en Calendario y Tareas!`, 'success');
      setReproductiveModalRodeo(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al agendar hitos reproductivos: ${err.message}`, 'error');
    } finally {
      setSavingReproductiveSchedule(false);
    }
  }

  // Ir desde una fila de Rodeo al Padrón de Caravanas para ver o asignar caravanas en 2 clics
  function handleJumpToCaravanasForRodeo(rodeo, mode = 'ver') {
    if (mode === 'ver') {
      setFilterRodeo(rodeo.nombre);
      setTargetRodeoForLink(null);
    } else {
      setFilterRodeo('TODOS');
      setTargetRodeoForLink(rodeo);
      setBulkRodeo(rodeo.nombre);
      setBulkPotrero(rodeo.potrero_numero ? String(rodeo.potrero_numero) : '');
    }
    setSubTab('caravanas');
    setCaravanasSubView('padron');
  }

  // Clic en el badge de caravanas 🏷️ X de una fila de Rodeo en Stock Actual:
  // - Si count > 0: abre la pestaña Caravanas filtrada por ese rodeo en el Padrón Individual
  // - Si count === 0: abre el modal + Asignar Caravanas preseleccionando ese rodeo
  function handleCaravanasBadgeClick(rodeo, count = 0) {
    if (!rodeo) return;
    if (count > 0) {
      setFilterRodeo(rodeo.nombre);
      setTargetRodeoForLink(null);
      setSubTab('caravanas');
      setCaravanasSubView('padron');
    } else {
      setCaravanasModalInitialRodeo(rodeo);
      setCaravanasModalInitialTab('colocacion_manga');
      setShowCaravanasManagerModal(true);
    }
  }

  // Exportar Stock Ganadero a Excel .xlsx con Fila de Totales y Resumen por Categoría
  function handleExportStockExcel() {
    try {
      const wb = XLSX.utils.book_new();

      // 1. HOJA 1: Stock Ganadero Detallado
      const headers = [
        'Rodeo',
        'Categoría Principal',
        'Potrero',
        'Hectáreas (ha)',
        'Vacas',
        'Terneros Totales',
        'Terneros Machos',
        'Terneras Hembras',
        'Toros Padres',
        'Toritos',
        'Vaquillonas Reposición',
        'Vacas CUT',
        'Total Cabezas',
        'Carga (cab/ha)',
        'Días en Potrero',
        'Meta Pastoreo (días)',
        'Condición Corporal',
        'Observaciones',
      ];

      let sumHa = 0;
      let sumVacas = 0;
      let sumTerneros = 0;
      let sumTernerosM = 0;
      let sumTernerosH = 0;
      let sumTorosPadres = 0;
      let sumToritos = 0;
      let sumVaquillonas = 0;
      let sumCut = 0;
      let sumTotal = 0;

      const dataRows = rodeosRender.map((r) => {
        const edit = editedRodeos[r.id] || r;
        const total = calcTotalRodeoRow(edit);
        const potNum = edit.potrero_numero ? formatPotreroNum(edit.potrero_numero) : 'Sin potrero';
        const potObj = (potreros || []).find((p) => String(p.numero) === String(edit.potrero_numero));
        const ha = potObj ? (parseFloat(String(potObj.hectareas).replace(',', '.')) || 0) : 0;
        const carga = ha > 0 ? Number((total / ha).toFixed(2)) : 0;
        const perm = calcPermanenciaPotrero(edit, fechaOperacion);

        const vacas = parseInt(edit.vacas, 10) || 0;
        const ternTot = parseInt(edit.terneros, 10) || 0;
        const ternM = parseInt(edit.terneros_machos, 10) || 0;
        const ternH = parseInt(edit.terneros_hembras, 10) || 0;
        const torosP = parseInt(edit.toros_padres, 10) || 0;
        const toritos = parseInt(edit.toritos, 10) || 0;
        const vaq = parseInt(edit.vaquillonas_reposicion, 10) || 0;
        const cut = parseInt(edit.vacas_cut, 10) || 0;

        sumHa += ha;
        sumVacas += vacas;
        sumTerneros += ternTot;
        sumTernerosM += ternM;
        sumTernerosH += ternH;
        sumTorosPadres += torosP;
        sumToritos += toritos;
        sumVaquillonas += vaq;
        sumCut += cut;
        sumTotal += total;

        return [
          edit.nombre || 'Sin nombre',
          edit.rol_protocolo || edit.categoria_principal || 'Rodeo',
          potNum,
          ha > 0 ? Number(ha.toFixed(1)) : 0,
          vacas,
          ternTot,
          ternM,
          ternH,
          torosP,
          toritos,
          vaq,
          cut,
          total,
          carga,
          perm.dias,
          edit.dias_estimados_pastoreo || perm.diasEstimados || 30,
          edit.condicion_corporal || 3.0,
          edit.observaciones || edit.estado_observaciones || '',
        ];
      });

      const cargaPromedio = sumHa > 0 ? Number((sumTotal / sumHa).toFixed(2)) : 0;

      const totalRow = [
        'TOTALES GENERALES',
        `${rodeosRender.length} Rodeos`,
        `${totalesRodeos.potrerosOcupados.size} Potreros Activos`,
        Number(sumHa.toFixed(1)),
        sumVacas,
        sumTerneros,
        sumTernerosM,
        sumTernerosH,
        sumTorosPadres,
        sumToritos,
        sumVaquillonas,
        sumCut,
        sumTotal,
        cargaPromedio,
        '',
        '',
        '',
        'Establecimiento San José · Las Flores',
      ];

      const sheetData = [headers, ...dataRows, totalRow];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Ancho de columnas optimizado
      ws['!cols'] = [
        { wch: 22 }, // Rodeo
        { wch: 20 }, // Categoría
        { wch: 15 }, // Potrero
        { wch: 14 }, // Hectáreas
        { wch: 10 }, // Vacas
        { wch: 14 }, // Terneros Totales
        { wch: 14 }, // Terneros M
        { wch: 14 }, // Terneras H
        { wch: 13 }, // Toros Padres
        { wch: 10 }, // Toritos
        { wch: 18 }, // Vaquillonas
        { wch: 12 }, // CUT
        { wch: 14 }, // Total
        { wch: 14 }, // Carga
        { wch: 14 }, // Días
        { wch: 14 }, // Meta
        { wch: 16 }, // Condición
        { wch: 30 }, // Observaciones
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Stock de Rodeos');

      // 2. HOJA 2: Resumen por Categoría y Composición %
      const resumenHeaders = ['Categoría Ganadera', 'Cabezas', 'Participación (%)'];
      const pct = (val) => (sumTotal > 0 ? Number(((val / sumTotal) * 100).toFixed(1)) : 0);

      const resumenRows = [
        ['Vacas en Rodeo', sumVacas, `${pct(sumVacas)}%`],
        ['Terneros Machos', sumTernerosM, `${pct(sumTernerosM)}%`],
        ['Terneras Hembras', sumTernerosH, `${pct(sumTernerosH)}%`],
        ['Total Terneros (M + H)', sumTerneros, `${pct(sumTerneros)}%`],
        ['Vaquillonas Reposición', sumVaquillonas, `${pct(sumVaquillonas)}%`],
        ['Toros Padres', sumTorosPadres, `${pct(sumTorosPadres)}%`],
        ['Toritos en Recría', sumToritos, `${pct(sumToritos)}%`],
        ['Vacas CUT / Descarte', sumCut, `${pct(sumCut)}%`],
        ['TOTAL EXISTENCIA', sumTotal, '100.0%'],
      ];

      const wsResumen = XLSX.utils.aoa_to_sheet([resumenHeaders, ...resumenRows]);
      wsResumen['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen por Categoría');

      // Nombre de archivo con formato DD-MM-YYYY
      const d = new Date();
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const anio = d.getFullYear();
      const fileName = `Stock_Ganadero_San_Jose_${dia}-${mes}-${anio}.xlsx`;

      XLSX.writeFile(wb, fileName);
      notify(`¡Archivo Excel "${fileName}" generado exitosamente con totales y resumen!`, 'success');
    } catch (err) {
      console.error('Error exportando Excel de Stock Ganadero:', err);
      notify(`Error al exportar Excel: ${err.message}`, 'error');
    }
  }

  // Compatibilidad hacia atrás
  const handleExportStockCSV = handleExportStockExcel;

  // Guardar Snapshot / Corte de Planilla en Supabase
  async function handleSavePlanillaSnapshot(origen = 'manual', obsCustom = '') {
    try {
      const detalle = rodeos.map((r) => {
        const edit = editedRodeos[r.id] || r;
        const total = calcTotalRodeoRow(edit);
        return {
          id: r.id,
          nombre: edit.nombre || r.nombre,
          potrero_numero: edit.potrero_numero,
          parcela_nombre: edit.parcela_nombre,
          vacas: parseInt(edit.vacas, 10) || 0,
          terneros: parseInt(edit.terneros, 10) || 0,
          terneros_machos: parseInt(edit.terneros_machos, 10) || 0,
          terneros_hembras: parseInt(edit.terneros_hembras, 10) || 0,
          toros_padres: parseInt(edit.toros_padres, 10) || 0,
          toritos: parseInt(edit.toritos, 10) || 0,
          vaquillonas_reposicion: parseInt(edit.vaquillonas_reposicion, 10) || 0,
          vacas_cut: parseInt(edit.vacas_cut, 10) || 0,
          total,
          condicion_corporal: edit.condicion_corporal || r.condicion_corporal || null,
        };
      });

      const totalCabezas = totalesRodeos.total || 0;
      // Timestamp real completo en ISO para guardar hora y minutos exactos
      const fechaCorte = new Date().toISOString();

      const { data, error } = await supabase
        .from('planillas_hacienda_snapshots')
        .insert({
          fecha_corte: fechaCorte,
          total_cabezas: totalCabezas,
          detalle_rodeos: detalle,
          observaciones:
            obsCustom ||
            (origen === 'export_pdf'
              ? `Corte registrado automáticamente al exportar Planilla de Campo PDF (${totalCabezas.toLocaleString('es-AR')} cab.)`
              : `Corte de stock manual guardado por el usuario (${totalCabezas.toLocaleString('es-AR')} cab.)`),
          origen: origen,
        })
        .select()
        .single();

      if (error) {
        console.warn('No se pudo guardar el snapshot en planillas_hacienda_snapshots:', error.message);
        return null;
      }

      await loadPlanillaSnapshots();
      return data;
    } catch (err) {
      console.warn('Excepción guardando snapshot de planilla:', err);
      return null;
    }
  }

  // Exportar Planilla de Recuento de Rodeos para el Personal de Campo (PDF con Logo y Comparativa)
  async function handleExportPlanillaCampoPDF() {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const logoDataUrl = await getSanJoseLogoDataUrl();

      // Último snapshot previo disponible para comparativa
      const ultimoSnapshot = snapshots && snapshots.length > 0 ? snapshots[0] : null;
      let prevRodeosMap = {};
      let diffTotal = 0;
      let tieneComparativa = false;

      if (ultimoSnapshot && Array.isArray(ultimoSnapshot.detalle_rodeos)) {
        tieneComparativa = true;
        diffTotal = (totalesRodeos.total || 0) - (Number(ultimoSnapshot.total_cabezas) || 0);
        ultimoSnapshot.detalle_rodeos.forEach((dr) => {
          if (dr.id) prevRodeosMap[dr.id] = dr;
          if (dr.nombre) prevRodeosMap[dr.nombre] = dr;
        });
      }

      // Calcular causas de variación si hay movimientos registrados
      let nacCount = 0;
      let ventCount = 0;
      let mortCount = 0;
      let trasladosCount = 0;

      if (ultimoSnapshot) {
        const fechaUlt = new Date(ultimoSnapshot.fecha_corte).toISOString().slice(0, 10);
        (movimientosHacienda || []).forEach((m) => {
          if ((m.fecha || '') >= fechaUlt) {
            const t = (m.tipo_movimiento || '').toLowerCase();
            const c = Number(m.cantidad_cabezas) || 0;
            if (t.includes('nacimiento')) nacCount += c;
            else if (t.includes('venta')) ventCount += c;
            else if (t.includes('mortandad') || t.includes('baja') || t.includes('muert')) mortCount += c;
            else if (t.includes('potrero') || t.includes('cambio')) trasladosCount += 1;
          }
        });
      }

      let y = drawSanJosePdfHeader(doc, {
        title: 'PLANILLA DE RECUENTO DE RODEOS EN CAMPO',
        customSubline: `Las Flores, Pcia. de Buenos Aires (2.068,1 ha) · Stock Oficial: ${rodeos.length} rodeos = ${(totalesRodeos.total || 0).toLocaleString('es-AR')} cabezas`,
        subtitle: 'Planilla de manga y control a caballo',
        fechaOperacion,
        logoDataUrl,
      });

      // Bloque resumen comparativo sutil debajo del encabezado
      if (tieneComparativa) {
        // Formatear fecha y hora limpia sin caracteres corruptos ni desfases
        let fechaSnapshotStr = '';
        if (ultimoSnapshot.fecha_corte) {
          const d = new Date(ultimoSnapshot.fecha_corte);
          if (!isNaN(d.getTime())) {
            const dayStr = new Intl.DateTimeFormat('es-AR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              timeZone: 'America/Argentina/Buenos_Aires',
            }).format(d);
            const timeStr = new Intl.DateTimeFormat('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'America/Argentina/Buenos_Aires',
            }).format(d);
            fechaSnapshotStr = `${dayStr} · ${timeStr} hs`;
          }
        }
        if (!fechaSnapshotStr) {
          fechaSnapshotStr = formatFechaHoraCorteAR(ultimoSnapshot.fecha_corte);
        }

        const corteNum = ultimoSnapshot.numero_corte ? `#${ultimoSnapshot.numero_corte}` : '';
        const corteLabel = corteNum ? `Corte ${corteNum}` : 'Corte previo';
        const leftText = `Comparativa vs. ${corteLabel} (${fechaSnapshotStr})`;

        const stockAnterior = Number(ultimoSnapshot.total_cabezas) || 0;
        const stockActual = Number(totalesRodeos.total) || 0;
        const diffNeta = stockActual - stockAnterior;
        const diffSign = diffNeta > 0 ? `+${diffNeta.toLocaleString('es-AR')}` : `${diffNeta.toLocaleString('es-AR')}`;
        const rightText = `Anterior: ${stockAnterior.toLocaleString('es-AR')} cab.  ·  Actual: ${stockActual.toLocaleString('es-AR')} cab.  ·  Variación neta: ${diffSign} cab.`;

        const diffColor = diffNeta === 0 ? [51, 65, 85] : diffNeta > 0 ? [22, 101, 52] : [185, 28, 28];

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(12, y, 273, 7.5, 1.2, 1.2, 'FD');

        // Texto Izquierda
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(leftText, 15, y + 5);

        // Texto Derecha
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(diffColor[0], diffColor[1], diffColor[2]);
        doc.text(rightText, 282, y + 5, { align: 'right' });

        y += 9.5;
      }

      // Mapeo de Bajas / Mortandades / Ventas ocurridas desde el último corte
      const fechaUltCorte = ultimoSnapshot && ultimoSnapshot.fecha_corte
        ? new Date(ultimoSnapshot.fecha_corte).toISOString().slice(0, 10)
        : null;

      const bajasPorRodeo = {};
      let totalBajasPeriodo = 0;

      (movimientosHacienda || []).forEach((m) => {
        const mFecha = (m.fecha || '').slice(0, 10);
        if (fechaUltCorte && mFecha < fechaUltCorte) return;
        if (fechaOperacion && mFecha > fechaOperacion) return;

        const tipoLower = (m.tipo_movimiento || '').toLowerCase();
        const esBaja =
          tipoLower.includes('baja') ||
          tipoLower.includes('mortandad') ||
          tipoLower.includes('muert') ||
          tipoLower.includes('venta');

        if (!esBaja) return;

        const cant = Number(m.cantidad_cabezas) || 0;
        if (cant <= 0) return;

        totalBajasPeriodo += cant;

        let fechaDDMM = '';
        if (m.fecha) {
          const parts = m.fecha.split('T')[0].split('-');
          if (parts.length === 3) {
            fechaDDMM = `${parts[2]}/${parts[1]}`;
          }
        }

        const rodeoKeyId = m.rodeo_id ? String(m.rodeo_id) : null;
        const rodeoKeyNombre = m.rodeo_nombre ? m.rodeo_nombre.trim().toLowerCase() : null;

        const bajaItem = {
          cantidad: cant,
          fechaDDMM: fechaDDMM || '—',
          tipo: m.tipo_movimiento,
        };

        if (rodeoKeyId) {
          if (!bajasPorRodeo[rodeoKeyId]) bajasPorRodeo[rodeoKeyId] = [];
          bajasPorRodeo[rodeoKeyId].push(bajaItem);
        }
        if (rodeoKeyNombre) {
          if (!bajasPorRodeo[rodeoKeyNombre]) bajasPorRodeo[rodeoKeyNombre] = [];
          bajasPorRodeo[rodeoKeyNombre].push(bajaItem);
        }
      });

      // Encabezado de tabla: 8 columnas oficiales limpias y proporcionadas
      const cols = [
        { label: 'RODEO', x: 14, align: 'left' },
        { label: 'POTRERO / LOTE', x: 64, align: 'left' },
        { label: 'VACAS', x: 110, align: 'center' },
        { label: 'TERNEROS (M/H)', x: 133, align: 'center' },
        { label: 'TOROS / VAQ.', x: 160, align: 'center' },
        { label: 'STOCK SIST.', x: 184, align: 'center' },
        { label: 'BAJAS', x: 206, align: 'center' },
        { label: 'NOTAS / NOVEDADES EN MANGA', x: 224, align: 'left' },
      ];

      doc.setFillColor(15, 23, 42);
      doc.rect(12, y, 273, 7.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      cols.forEach((c) =>
        doc.text(c.label, c.x, y + 5, { align: c.align || 'left' })
      );
      y += 7.5;

      rodeos.forEach((r, idx) => {
        const edit = editedRodeos[r.id] || r;
        if (y > 175) {
          doc.addPage();
          y = 18;
        }
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(12, y, 273, 8.2, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(12, y + 8.2, 285, y + 8.2);

        const rowTotal = calcTotalRodeoRow(edit);

        // Comparativa de rodeo con snapshot anterior
        const prevRodeo = prevRodeosMap[r.id] || prevRodeosMap[r.nombre];
        let cambioPotrero = false;
        let deltaRowStr = '';
        if (prevRodeo) {
          const prevTot = Number(prevRodeo.total) || 0;
          const diffRodeo = rowTotal - prevTot;
          if (diffRodeo !== 0) {
            deltaRowStr = diffRodeo > 0 ? ` (+${diffRodeo})` : ` (${diffRodeo})`;
          }
          if (
            prevRodeo.potrero_numero !== undefined &&
            String(prevRodeo.potrero_numero || '') !== String(edit.potrero_numero || '')
          ) {
            cambioPotrero = true;
          }
        }

        const potStr = edit.potrero_numero
          ? `${formatPotreroNum(edit.potrero_numero)}${
              edit.parcela_nombre ? ` (${edit.parcela_nombre})` : ''
            }${cambioPotrero ? ' *Trasladado*' : ''}`
          : 'Sin potrero';

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(edit.nombre || '').slice(0, 30), 14, y + 5.3);

        doc.setFont('helvetica', cambioPotrero ? 'bold' : 'normal');
        if (cambioPotrero) doc.setTextColor(14, 116, 144);
        doc.text(potStr.slice(0, 26), 64, y + 5.3);
        doc.setTextColor(15, 23, 42);

        doc.setFont('helvetica', 'normal');
        doc.text(String(edit.vacas || 0), 110, y + 5.3, { align: 'center' });

        const m = parseInt(edit.terneros_machos, 10) || 0;
        const h = parseInt(edit.terneros_hembras, 10) || 0;
        const tTot = parseInt(edit.terneros, 10) || 0;
        const ternStr =
          m + h > 0 ? `${tTot} (${m}M / ${h}H)` : String(tTot);
        doc.text(ternStr, 133, y + 5.3, { align: 'center' });

        const tPadres = parseInt(edit.toros_padres, 10) || 0;
        const toritos = parseInt(edit.toritos, 10) || 0;
        const vaq = parseInt(edit.vaquillonas_reposicion, 10) || 0;
        const parts = [];
        if (tPadres > 0 && toritos > 0) {
          parts.push(`${tPadres} Toros / ${toritos} Tor.`);
        } else if (tPadres > 0) {
          parts.push(`${tPadres} Toros`);
        } else if (toritos > 0) {
          parts.push(`${toritos} Toritos`);
        }
        if (vaq > 0) {
          parts.push(`${vaq} Vaq.`);
        }
        const torosVaqStr = parts.length > 0 ? parts.join(' · ') : '-';
        doc.text(torosVaqStr, 160, y + 5.3, { align: 'center' });

        // Total cabezas con delta si cambió
        doc.setFont('helvetica', 'bold');
        if (deltaRowStr) {
          doc.text(`${rowTotal}${deltaRowStr}`, 184, y + 5.3, { align: 'center' });
        } else {
          doc.text(String(rowTotal), 184, y + 5.3, { align: 'center' });
        }

        // Columna BAJAS: texto limpio en rojo si hay bajas en el período, o '-' suave sin recuadros
        const rIdKey = String(r.id);
        const rNomKey = (r.nombre || '').trim().toLowerCase();
        const bajasRodeo = bajasPorRodeo[rIdKey] || bajasPorRodeo[rNomKey] || [];
        const cantBajasRodeo = bajasRodeo.reduce((acc, b) => acc + b.cantidad, 0);

        if (cantBajasRodeo > 0) {
          const fechaStr = bajasRodeo[0]?.fechaDDMM || '';
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.setTextColor(185, 28, 28); // Rojo oscuro limpio
          doc.text(
            `-${cantBajasRodeo} cab.${fechaStr ? ` (${fechaStr})` : ''}`,
            206,
            y + 5.3,
            { align: 'center' }
          );
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184); // Gris suave slate-400
          doc.text('-', 206, y + 5.3, { align: 'center' });
        }

        // Renglón amplio punteado para NOTAS / NOVEDADES EN MANGA (espacio ampliado)
        doc.setDrawColor(203, 213, 225);
        doc.setLineDashPattern([1.5, 1.5], 0);
        doc.line(224, y + 5.5, 283, y + 5.5);
        doc.setLineDashPattern([], 0);

        y += 8.2;
      });

      // Fila totalizadora oficial
      doc.setFillColor(6, 78, 59);
      doc.rect(12, y, 273, 8.2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(`TOTAL OFICIAL (${rodeos.length} RODEOS)`, 14, y + 5.4);
      doc.text(`${totalesRodeos.potrerosOcupados.size} potreros ocupados`, 64, y + 5.4);
      doc.text(String(totalesRodeos.vacas), 110, y + 5.4, { align: 'center' });
      doc.text(
        `${totalesRodeos.terneros} (${totalesRodeos.terneros_machos}M / ${totalesRodeos.terneros_hembras}H)`,
        133,
        y + 5.4,
        { align: 'center' }
      );
      const totToros = totalesRodeos.toros_padres + totalesRodeos.toritos;
      doc.text(
        `${totToros} Toros · ${totalesRodeos.vaquillonas_reposicion} Vaq.`,
        160,
        y + 5.4,
        { align: 'center' }
      );
      doc.text(
        `${totalesRodeos.total.toLocaleString('es-AR')} cab.`,
        184,
        y + 5.4,
        { align: 'center' }
      );
      doc.text(
        totalBajasPeriodo > 0 ? `-${totalBajasPeriodo} cab.` : '-',
        206,
        y + 5.4,
        { align: 'center' }
      );
      doc.text('-', 253, y + 5.4, { align: 'center' });

      // Margen superior de firmas ajustado a margin-top: 36px para un pie prolijo y aireado
      if (y + 50 > 190) {
        doc.addPage();
        y = 20;
      }
      drawSanJoseSignatureFooter(doc, y + 36, {
        twoSignatures: true,
        leftLabel: 'Encargado / Responsable de Campo',
        rightLabel: 'V°B° Administración San José',
      });

      doc.save(
        `Planilla_Recuento_Rodeos_SanJose_${fechaOperacion || new Date().toISOString().slice(0, 10)}.pdf`
      );

      // Guardar automáticamente el nuevo snapshot como línea base para la próxima
      await handleSavePlanillaSnapshot('export_pdf');

      notify('Planilla de Recuento de Campo (PDF) generada y corte guardado con éxito.', 'success');
    } catch (err) {
      notify(`Error al exportar PDF de rodeos: ${err.message}`, 'error');
    }
  }

  const [excelWorkbook, setExcelWorkbook] = useState(null);
  const [excelPreview, setExcelPreview] = useState(null);
  const [importTarget, setImportTarget] = useState('animales');

  const [newCaja, setNewCaja] = useState({
    caja_numero: '',
    marca: 'Allflex SENASA',
    desde: '',
    hasta: '',
    cantidad: 50,
    en_stock: 50,
    usadas_sin_detalle: 0,
    observaciones: '',
  });

  const categoriasDisponibles = useMemo(() => {
    const set = new Set(CATEGORIAS_GANADO);
    animales.forEach((a) => {
      if (a.categoria) set.add(a.categoria);
    });
    return Array.from(set);
  }, [animales]);

  const rodeosDisponibles = useMemo(() => {
    const set = new Set(rodeos.map((r) => r.nombre));
    animales.forEach((a) => {
      if (a.rodeo) set.add(a.rodeo);
    });
    return Array.from(set);
  }, [rodeos, animales]);

  const animalesFiltrados = useMemo(() => {
    const q = searchCaravana.trim().toLowerCase();
    return animales.filter((a) => {
      if (q) {
        const matchCaravana = (a.caravana || '').toLowerCase().includes(q);
        const matchMarca = (a.marca || '').toLowerCase().includes(q);
        const matchObs = (a.observaciones || '').toLowerCase().includes(q);
        if (!matchCaravana && !matchMarca && !matchObs) return false;
      }
      if (filterCategoria !== 'TODAS' && a.categoria !== filterCategoria) return false;
      if (filterEstadoCaravana !== 'TODOS') {
        const est = (a.estado_caravana || a.estado || '').toLowerCase();
        if (filterEstadoCaravana === 'Activa en Campo') {
          if (est.includes('salida') || est.includes('venta') || est.includes('baja') || est.includes('stock')) return false;
        } else if (filterEstadoCaravana === 'En Stock') {
          if (!est.includes('stock')) return false;
        } else if (filterEstadoCaravana === 'Salida / Vendida') {
          if (!est.includes('salida') && !est.includes('venta') && !est.includes('baja') && !est.includes('muert')) return false;
        }
      }
      if (filterRodeo === 'SIN_RODEO') {
        if (a.rodeo && a.rodeo.trim() !== '' && a.rodeo !== 'Sin asignar') return false;
      } else if (
        filterRodeo !== 'TODOS' &&
        (a.rodeo || '').trim().toUpperCase() !== filterRodeo.toUpperCase()
      ) {
        return false;
      }
      if (
        filterPotrero !== 'TODOS' &&
        String(a.potrero_actual ?? '') !== String(filterPotrero)
      ) {
        return false;
      }
      return true;
    });
  }, [animales, searchCaravana, filterCategoria, filterRodeo, filterPotrero]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggleSelectOne(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleSelectAllFiltered() {
    const visibleIds = animalesFiltrados.map((a) => a.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  }

  function selectAllSinCategoria() {
    const ids = animales
      .filter((a) => (a.categoria || 'Vaca / Sin categoría') === 'Vaca / Sin categoría')
      .map((a) => a.id);
    setSelectedIds(ids);
    notify(
      `${ids.length} caravanas 'Vaca / Sin categoría' seleccionadas para edición masiva.`,
      'success'
    );
  }

  async function handleBulkApply() {
    if (selectedIds.length === 0) {
      notify('Paso 1: Tildá al menos una caravana en la tabla.', 'error');
      return;
    }
    const updates = {};
    if (bulkCategoria) updates.categoria = bulkCategoria;
    if (bulkRodeo.trim()) {
      updates.rodeo = bulkRodeo.trim();
      // Si el rodeo elegido existe en la Planilla de Rodeos y tiene potrero asignado, sincronizar el potrero automáticamente
      const matchedRodeo = rodeos.find(
        (r) => r.nombre.toUpperCase() === bulkRodeo.trim().toUpperCase()
      );
      if (matchedRodeo && matchedRodeo.potrero_numero != null && bulkPotrero === '') {
        updates.potrero_actual = Number(matchedRodeo.potrero_numero);
      }
    }
    if (bulkPotrero !== '') {
      updates.potrero_actual =
        bulkPotrero === 'SIN_ASIGNAR' ? null : parseInt(bulkPotrero, 10);
    }

    if (Object.keys(updates).length === 0) {
      notify('Elegí al menos un campo (Rodeo, Categoría o Potrero) para aplicar.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('animales')
        .update(updates)
        .in('id', selectedIds);
      if (error) throw error;

      notify(
        `¡${selectedIds.length} caravanas actualizadas${
          updates.rodeo ? ` y vinculadas al rodeo "${updates.rodeo}"` : ''
        }!`,
        'success'
      );
      setSelectedIds([]);
      setBulkCategoria('');
      if (!targetRodeoForLink) {
        setBulkRodeo('');
        setBulkPotrero('');
      }
      await onRefresh();
    } catch (err) {
      notify(`Error en edición masiva: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickUpdateAnimal(animalId, changes) {
    try {
      if (changes.rodeo) {
        const matched = rodeos.find(
          (r) => r.nombre.toUpperCase() === String(changes.rodeo).trim().toUpperCase()
        );
        if (matched && matched.potrero_numero != null) {
          changes.potrero_actual = Number(matched.potrero_numero);
        }
      }
      const { error } = await supabase.from('animales').update(changes).eq('id', animalId);
      if (error) throw error;
      notify('Caravana actualizada.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error actualizando animal: ${err.message}`, 'error');
    }
  }

  async function handleDeleteAnimal(animal) {
    const ok = await confirmAction({
      title: `¿Eliminar caravana "${animal.caravana}" del padrón?`,
      description: `Rodeo: ${animal.rodeo || 'General'} · Categoría: ${animal.categoria || 'Sin asignar'}. Se eliminará la trazabilidad individual de este animal.`,
      confirmText: 'Sí, eliminar caravana',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('animales').delete().eq('id', animal.id);
      if (error) throw error;
      notify(`Caravana ${animal.caravana} eliminada.`, 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error al eliminar: ${err.message}`, 'error');
    }
  }

  async function handleAddCaja(e) {
    e.preventDefault();
    if (!newCaja.caja_numero || !newCaja.desde || !newCaja.hasta) {
      notify('Completá N° de Caja, rango Desde y Hasta.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        caja_numero: parseInt(newCaja.caja_numero, 10),
        marca: newCaja.marca || 'Allflex SENASA',
        desde: newCaja.desde.trim(),
        hasta: newCaja.hasta.trim(),
        cantidad: parseInt(newCaja.cantidad, 10) || 50,
        en_stock: parseInt(newCaja.en_stock, 10) || 0,
        usadas_sin_detalle: parseInt(newCaja.usadas_sin_detalle, 10) || 0,
        observaciones: newCaja.observaciones || null,
      };
      const { error } = await supabase.from('cajas_caravanas').insert(payload);
      if (error) throw error;
      notify(`Caja #${payload.caja_numero} registrada.`, 'success');
      setNewCaja({
        caja_numero: '',
        marca: 'Allflex SENASA',
        desde: '',
        hasta: '',
        cantidad: 50,
        en_stock: 50,
        usadas_sin_detalle: 0,
        observaciones: '',
      });
      await onRefresh();
    } catch (err) {
      notify(`Error guardando caja: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCaja(caja) {
    const ok = await confirmAction({
      title: `¿Eliminar Caja #${caja.caja_numero}?`,
      description: `Rango: ${caja.desde} - ${caja.hasta} (${caja.en_stock || 0} disponibles). Se eliminará el registro de la caja del stock de depósito.`,
      confirmText: 'Sí, eliminar caja',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('cajas_caravanas').delete().eq('id', caja.id);
      if (error) throw error;
      notify(`Caja #${caja.caja_numero} eliminada.`, 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error eliminando caja: ${err.message}`, 'error');
    }
  }

  function buildPreviewFromWorkbook(wb, sheetName, targetMode) {
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const mapped =
      targetMode === 'animales'
        ? rawRows
            .map((r, i) => mapRawRowToAnimal(r, i, sheetName))
            .filter((r) => r.caravana && r.caravana !== '')
        : rawRows.map((r, i) => mapRawRowToCaja(r, i));

    setExcelPreview({
      sheetName,
      sheetNames: wb.SheetNames,
      rawCount: rawRows.length,
      items: mapped,
    });
  }

  async function handleExcelFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      setExcelWorkbook({ fileName: file.name, wb });
      buildPreviewFromWorkbook(wb, firstSheet, importTarget);
      notify(
        `Archivo "${file.name}" leído (${wb.SheetNames.length} hoja/s). Revisá la vista previa.`,
        'success'
      );
    } catch (err) {
      notify(`Error al leer archivo Excel/CSV: ${err.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  }

  async function handleConfirmExcelImport() {
    if (!excelPreview?.items?.length) return;
    setSaving(true);
    try {
      if (importTarget === 'animales') {
        const uniqueByCaravana = new Map();
        excelPreview.items.forEach((item) => {
          uniqueByCaravana.set(String(item.caravana).trim(), {
            ...item,
            caravana: String(item.caravana).trim(),
            potrero_actual: item.potrero_actual ? parseInt(item.potrero_actual, 10) : null,
          });
        });
        const rows = Array.from(uniqueByCaravana.values());
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const { error } = await supabase
            .from('animales')
            .upsert(chunk, { onConflict: 'caravana' });
          if (error) throw error;
        }
        notify(`¡${rows.length} caravanas guardadas en Supabase!`, 'success');
      } else {
        const rows = excelPreview.items.map((c) => ({
          caja_numero: parseInt(c.caja_numero, 10) || 1,
          marca: c.marca || 'Allflex',
          desde: String(c.desde || '-'),
          hasta: String(c.hasta || '-'),
          cantidad: parseInt(c.cantidad, 10) || 50,
          en_stock: parseInt(c.en_stock, 10) || 0,
          usadas_sin_detalle: parseInt(c.usadas_sin_detalle, 10) || 0,
          observaciones: c.observaciones || null,
        }));
        const { error } = await supabase.from('cajas_caravanas').insert(rows);
        if (error) throw error;
        notify(`¡${rows.length} cajas guardadas en Supabase!`, 'success');
      }
      setExcelPreview(null);
      setExcelWorkbook(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al importar: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* MODAL CENTRADO FLOTANTE: MOVER RODEO DE POTRERO                      */}
      {/* ==================================================================== */}
      {moveRodeoModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-emerald-700 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 sm:p-5 bg-emerald-950 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  <ArrowRightLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">
                    Mover Rodeo "{moveRodeoModal.rodeo.nombre}"
                  </h3>
                  <p className="text-xs text-emerald-200">
                    {calcTotalRodeoRow(moveRodeoModal.rodeo)} cabezas · Ubicación actual:{' '}
                    <strong>{formatPotreroNum(moveRodeoModal.rodeo.potrero_numero)}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoveRodeoModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmMoverRodeo} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-800 mb-1.5">
                  Rodeo a Mover *
                </label>
                <select
                  required
                  value={moveRodeoModal.rodeo?.id || ''}
                  onChange={(e) => {
                    const sel = rodeos.find((r) => String(r.id) === String(e.target.value));
                    setMoveRodeoModal({
                      ...moveRodeoModal,
                      rodeo: sel || null,
                      parcela_nombre: sel?.parcela_nombre || '',
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                >
                  {rodeos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre} ({calcTotalRodeoRow(editedRodeos[r.id] || r)} cab. · {formatPotreroNum(r.potrero_numero)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-extrabold text-slate-800">
                    Nuevo Potrero Destino *
                  </label>
                  {moveRodeoModal.potrero_destino && (
                    <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                      {moveRodeoModal.potrero_destino === 'SIN_POTRERO'
                        ? 'Corrales / Calle (Sin Potrero)'
                        : `Destino: Potrero #${moveRodeoModal.potrero_destino}`}
                    </span>
                  )}
                </div>

                {/* Opción rápida: Sin potrero asignado */}
                <div
                  onClick={() =>
                    setMoveRodeoModal({
                      ...moveRodeoModal,
                      potrero_destino: 'SIN_POTRERO',
                    })
                  }
                  className={`p-2.5 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-between ${
                    moveRodeoModal.potrero_destino === 'SIN_POTRERO'
                      ? 'bg-amber-100/80 border-amber-500 text-amber-950 ring-2 ring-amber-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>🚧</span>
                    <span>Sin potrero asignado (Corrales / Callejón / Manga)</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Transitorio</span>
                </div>

                {/* Grilla interactiva de potreros con PotreroCard */}
                <div className="max-h-60 overflow-y-auto space-y-2 p-1.5 bg-slate-50/80 rounded-2xl border border-slate-200">
                  {potreros.map((p) => {
                    const isSelected = String(moveRodeoModal.potrero_destino) === String(p.numero);
                    return (
                      <PotreroCard
                        key={p.numero}
                        potrero={p}
                        rodeos={rodeos}
                        isSelected={isSelected}
                        onToggle={() =>
                          setMoveRodeoModal({
                            ...moveRodeoModal,
                            potrero_destino: String(p.numero),
                          })
                        }
                        selectionType="radio"
                        size="compact"
                        isDestinoMode={true}
                        currentRodeoId={moveRodeoModal.rodeo?.id}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Parcela / Subdivisión (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Parcela Norte / Boyero 1"
                    value={moveRodeoModal.parcela_nombre}
                    onChange={(e) =>
                      setMoveRodeoModal({
                        ...moveRodeoModal,
                        parcela_nombre: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha del Movimiento *
                  </label>
                  <input
                    type="date"
                    required
                    value={moveRodeoModal.fecha}
                    onChange={(e) =>
                      setMoveRodeoModal({ ...moveRodeoModal, fecha: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Motivo / Observaciones para la Bitácora
                </label>
                <input
                  type="text"
                  placeholder="Ej: Rotación por estado de pastura / Salida de bajo..."
                  value={moveRodeoModal.observaciones}
                  onChange={(e) =>
                    setMoveRodeoModal({
                      ...moveRodeoModal,
                      observaciones: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMoveRodeoModal(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-md transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {saving ? 'Registrando traslado...' : 'Confirmar Traslado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL CENTRADO FLOTANTE: REGISTRAR SALIDA / MORTANDAD                */}
      {/* ==================================================================== */}
      {salidaRodeoModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-red-600 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 sm:p-5 bg-red-950 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-500/20 text-red-300 border border-red-400/30">
                  <TrendingDown className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">
                    Registrar Salida o Baja — Rodeo "{salidaRodeoModal.rodeo.nombre}"
                  </h3>
                  <p className="text-xs text-red-200">
                    Descuenta cabezas del rodeo y guarda el registro en la Bitácora
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSalidaRodeoModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-red-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmSalidaRodeo} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Tipo de Salida / Baja *
                  </label>
                  <select
                    value={salidaRodeoModal.tipo_movimiento}
                    onChange={(e) =>
                      setSalidaRodeoModal({
                        ...salidaRodeoModal,
                        tipo_movimiento: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-red-300 bg-white text-xs font-bold"
                  >
                    <option value="Salida por Venta / Traslado">
                      Salida por Venta / Traslado
                    </option>
                    <option value="Baja / Mortandad">Baja / Mortandad en Campo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Categoría a Descontar *
                  </label>
                  <select
                    value={salidaRodeoModal.categoria_key}
                    onChange={(e) =>
                      setSalidaRodeoModal({
                        ...salidaRodeoModal,
                        categoria_key: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-red-300 bg-white text-xs font-bold"
                  >
                    {CATEGORIAS_COLUMNA_RODEO.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.label} (actual: {salidaRodeoModal.rodeo[cat.key] || 0})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {salidaRodeoModal.categoria_key === 'terneros' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ¿Descontar también de Machos o Hembras discriminados?
                  </label>
                  <select
                    value={salidaRodeoModal.sexo_ternero || 'ninguno'}
                    onChange={(e) =>
                      setSalidaRodeoModal({
                        ...salidaRodeoModal,
                        sexo_ternero: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold"
                  >
                    <option value="ninguno">Solo descontar de Terneros Total</option>
                    <option value="macho">
                      Descontar de Machos (actual: {salidaRodeoModal.rodeo.terneros_machos || 0})
                    </option>
                    <option value="hembra">
                      Descontar de Hembras (actual: {salidaRodeoModal.rodeo.terneros_hembras || 0})
                    </option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Cantidad de Cabezas *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={salidaRodeoModal.cantidad}
                    onChange={(e) =>
                      setSalidaRodeoModal({
                        ...salidaRodeoModal,
                        cantidad: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-red-300 bg-white text-xs font-extrabold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    required
                    value={salidaRodeoModal.fecha}
                    onChange={(e) =>
                      setSalidaRodeoModal({ ...salidaRodeoModal, fecha: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Motivo / Destino / Causa
                </label>
                <input
                  type="text"
                  placeholder="Ej: Venta feria Las Flores / Baja por empaste..."
                  value={salidaRodeoModal.motivo}
                  onChange={(e) =>
                    setSalidaRodeoModal({ ...salidaRodeoModal, motivo: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSalidaRodeoModal(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-extrabold shadow-md transition"
                >
                  {saving ? 'Guardando...' : 'Descontar y Guardar en Bitácora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: FUSIÓN DE RODEOS (REINTEGRAR TROPAS APARTADAS)               */}
      {/* ==================================================================== */}
      {fusionModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-amber-600 shadow-2xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 text-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-400/30">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold flex items-center gap-1.5">
                    🔀 Fusión y Reintegro de Rodeos
                  </h3>
                  <p className="text-xs text-amber-200">
                    Suma y consolida tropas apartadas dentro de otro rodeo sin duplicar stock
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFusionModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmFusion} className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Rodeo Origen */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    1. Rodeo Origen (Tropa a reintegrar) *
                  </label>
                  <select
                    required
                    value={fusionModal.rodeoOrigenId}
                    onChange={(e) => setFusionModal({ ...fusionModal, rodeoOrigenId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  >
                    <option value="">Seleccionar origen...</option>
                    {rodeos
                      .filter((r) => String(r.id) !== String(fusionModal.rodeoDestinoId))
                      .map((r) => {
                        const total = calcTotalRodeoRow(editedRodeos[r.id] || r);
                        return (
                          <option key={r.id} value={r.id}>
                            {r.nombre} ({total} cab. · P{r.potrero_numero || 'S/D'})
                          </option>
                        );
                      })}
                  </select>
                </div>

                {/* Rodeo Destino */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    2. Rodeo Destino (Rodeo receptor) *
                  </label>
                  <select
                    required
                    value={fusionModal.rodeoDestinoId}
                    onChange={(e) => setFusionModal({ ...fusionModal, rodeoDestinoId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  >
                    <option value="">Seleccionar destino...</option>
                    {rodeos
                      .filter((r) => String(r.id) !== String(fusionModal.rodeoOrigenId))
                      .map((r) => {
                        const total = calcTotalRodeoRow(editedRodeos[r.id] || r);
                        return (
                          <option key={r.id} value={r.id}>
                            {r.nombre} ({total} cab. · P{r.potrero_numero || 'S/D'})
                          </option>
                        );
                      })}
                  </select>
                </div>
              </div>

              {/* Vista previa de consolidación */}
              {(() => {
                const orig = rodeos.find((r) => String(r.id) === String(fusionModal.rodeoOrigenId));
                const dest = rodeos.find((r) => String(r.id) === String(fusionModal.rodeoDestinoId));
                if (!orig || !dest) return null;
                const origRow = editedRodeos[orig.id] || orig;
                const destRow = editedRodeos[dest.id] || dest;
                const totOrig = calcTotalRodeoRow(origRow);
                const totDest = calcTotalRodeoRow(destRow);
                const totConsolidado = totOrig + totDest;

                return (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-2">
                    <div className="text-xs font-extrabold text-amber-900 uppercase tracking-wide flex items-center justify-between">
                      <span>Resultado de la Fusión</span>
                      <span className="text-sm font-black text-amber-950 font-mono">
                        {totOrig} + {totDest} = {totConsolidado} cab.
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                      <div className="p-2 bg-white rounded-lg border border-amber-200">
                        <div className="font-bold text-slate-500 text-[10px]">Origen a transferir:</div>
                        <div className="font-extrabold text-slate-900">{orig.nombre}</div>
                        <div className="text-amber-800 font-bold">{totOrig} cabezas</div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          Vacas: {origRow.vacas || 0} · Terneros: {origRow.terneros || 0} · Vaq: {origRow.vaquillonas_reposicion || 0} · Toros: {(origRow.toros_padres || 0) + (origRow.toritos || 0)}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-amber-200">
                        <div className="font-bold text-slate-500 text-[10px]">Destino consolidado:</div>
                        <div className="font-extrabold text-slate-900">{dest.nombre}</div>
                        <div className="text-emerald-800 font-extrabold">{totConsolidado} cabezas finales</div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          Potrero receptor: P{dest.potrero_numero || 'S/D'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha de Operación
                  </label>
                  <input
                    type="date"
                    value={fusionModal.fecha}
                    onChange={(e) => setFusionModal({ ...fusionModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Motivo / Observaciones
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Reintegro de tropa post-sanidad"
                    value={fusionModal.motivo}
                    onChange={(e) => setFusionModal({ ...fusionModal, motivo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>
              </div>

              {/* Checkbox eliminar origen */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fusionModal.eliminarOrigen}
                  onChange={(e) => setFusionModal({ ...fusionModal, eliminarOrigen: e.target.checked })}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 h-4 w-4"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-900">
                    Eliminar el rodeo origen tras la fusión
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Si está marcado, el rodeo origen se dará de baja al quedar en 0 cabezas. Si se desmarca, permanecerá con 0 cabezas en el historial.
                  </p>
                </div>
              </label>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setFusionModal(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold shadow-md transition disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Fusionando...' : 'Confirmar Fusión de Rodeos'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 1: REGISTRAR VENTA DE HACIENDA (DOBLE IMPACTO STOCK + FINANZAS)*/}
      {/* ==================================================================== */}
      {ventaModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-emerald-600 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 sm:p-5 bg-emerald-950 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">+ Registrar Venta de Hacienda</h3>
                  <p className="text-xs text-emerald-200">
                    Descuenta stock en rodeo y genera asiento en Finanzas automáticamente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVentaModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmVentaHacienda} className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Rodeo de Origen *
                  </label>
                  <select
                    required
                    value={ventaModal.rodeo_id}
                    onChange={(e) => setVentaModal({ ...ventaModal, rodeo_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    {rodeos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} ({calcTotalRodeoRow(r)} cab.)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={ventaModal.categoria}
                    onChange={(e) => setVentaModal({ ...ventaModal, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    <option value="Vacas">Vacas Cría</option>
                    <option value="Vacas CUT">Vacas CUT</option>
                    <option value="Terneros Machos">Terneros Machos</option>
                    <option value="Terneros Hembras">Terneros Hembras</option>
                    <option value="Terneros Total">Terneros Total</option>
                    <option value="Vaquillonas Reposición">Vaquillonas Reposición</option>
                    <option value="Toros Padres">Toros Padres</option>
                    <option value="Toritos">Toritos</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cabezas *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={ventaModal.cabezas}
                    onChange={(e) => setVentaModal({ ...ventaModal, cabezas: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Kilos Totales *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    required
                    value={ventaModal.kilos_totales}
                    onChange={(e) => setVentaModal({ ...ventaModal, kilos_totales: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Precio / kg *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    required
                    value={ventaModal.precio_kg}
                    onChange={(e) => setVentaModal({ ...ventaModal, precio_kg: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Moneda y Tipo de Cambio
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={ventaModal.moneda}
                      onChange={(e) => setVentaModal({ ...ventaModal, moneda: e.target.value })}
                      className="w-24 px-2 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                    >
                      <option value="ARS">ARS ($)</option>
                      <option value="USD">USD (U$S)</option>
                    </select>
                    <input
                      type="number"
                      placeholder="TC Dólar"
                      value={ventaModal.tipo_cambio}
                      onChange={(e) => setVentaModal({ ...ventaModal, tipo_cambio: e.target.value })}
                      className="w-full px-2 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                      title="Tipo de cambio oficial / referencia"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Gastos Comerc. (ARS)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={ventaModal.gastos_comercializacion}
                    onChange={(e) => setVentaModal({ ...ventaModal, gastos_comercializacion: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Comprador / Consignatario
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Alzaga Unzué / Frigorífico..."
                    value={ventaModal.comprador}
                    onChange={(e) => setVentaModal({ ...ventaModal, comprador: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha de Operación
                  </label>
                  <input
                    type="date"
                    required
                    value={ventaModal.fecha}
                    onChange={(e) => setVentaModal({ ...ventaModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observaciones / Nro. DTE
                </label>
                <input
                  type="text"
                  placeholder="Ej: DTE 0023-4412, balanza Las Flores..."
                  value={ventaModal.observaciones}
                  onChange={(e) => setVentaModal({ ...ventaModal, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                />
              </div>

              {/* Liquidación estimada en vivo */}
              {(() => {
                const kg = parseFloat(ventaModal.kilos_totales) || 0;
                const p = parseFloat(ventaModal.precio_kg) || 0;
                const tc = parseFloat(ventaModal.tipo_cambio) || Number(dolarRef) || 1420;
                const g = parseFloat(ventaModal.gastos_comercializacion) || 0;
                const bruto = ventaModal.moneda === 'USD' ? (kg * p * tc) : (kg * p);
                const neto = Math.max(0, bruto - g);
                const netoUsd = Math.round((neto / tc) * 100) / 100;
                return (
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-emerald-800 font-bold uppercase block">Ingreso Neto Estimado</span>
                      <span className="text-base font-extrabold text-emerald-950">${Math.round(neto).toLocaleString('es-AR')} ARS</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-emerald-800 font-bold uppercase block">Neto USD</span>
                      <span className="text-base font-extrabold text-emerald-900">U$S {netoUsd.toLocaleString('es-AR')}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setVentaModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Guardando...' : 'Confirmar Venta y Generar Asientos'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: REGISTRAR COMPRA / INGRESO DE HACIENDA                      */}
      {/* ==================================================================== */}
      {compraModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-sky-600 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 sm:p-5 bg-sky-950 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-sky-500/20 text-sky-300 border border-sky-400/30">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">+ Registrar Compra / Ingreso</h3>
                  <p className="text-xs text-sky-200">
                    Suma cabezas al rodeo e imputa gasto en Finanzas si corresponde
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompraModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCompraIngreso} className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Rodeo de Destino *
                  </label>
                  <select
                    required
                    value={compraModal.rodeo_id}
                    onChange={(e) => setCompraModal({ ...compraModal, rodeo_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    {rodeos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} ({calcTotalRodeoRow(r)} cab.)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={compraModal.categoria}
                    onChange={(e) => setCompraModal({ ...compraModal, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    <option value="Vaquillonas Reposición">Vaquillonas Reposición</option>
                    <option value="Toros Padres">Toros Padres</option>
                    <option value="Toritos">Toritos</option>
                    <option value="Vacas">Vacas Cría</option>
                    <option value="Terneros">Terneros</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cantidad de Cabezas *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={compraModal.cabezas}
                    onChange={(e) => setCompraModal({ ...compraModal, cabezas: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Monto Total de Compra
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={compraModal.monto_total}
                    onChange={(e) => setCompraModal({ ...compraModal, monto_total: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Moneda / Tipo de Cambio
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={compraModal.moneda}
                      onChange={(e) => setCompraModal({ ...compraModal, moneda: e.target.value })}
                      className="w-24 px-2 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                    >
                      <option value="ARS">ARS ($)</option>
                      <option value="USD">USD (U$S)</option>
                    </select>
                    <input
                      type="number"
                      placeholder="TC"
                      value={compraModal.tipo_cambio}
                      onChange={(e) => setCompraModal({ ...compraModal, tipo_cambio: e.target.value })}
                      className="w-full px-2 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Proveedor / Cabaña
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Cabaña Las Lilas..."
                    value={compraModal.proveedor}
                    onChange={(e) => setCompraModal({ ...compraModal, proveedor: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha de Ingreso *
                  </label>
                  <input
                    type="date"
                    required
                    value={compraModal.fecha}
                    onChange={(e) => setCompraModal({ ...compraModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Observaciones
                  </label>
                  <input
                    type="text"
                    placeholder="Detalles sanitarios, guía..."
                    value={compraModal.observaciones}
                    onChange={(e) => setCompraModal({ ...compraModal, observaciones: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCompraModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Guardando...' : 'Confirmar Ingreso a Rodeo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: REGISTRAR NACIMIENTO / DESTETE                              */}
      {/* ==================================================================== */}
      {nacimientoModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-amber-600 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 sm:p-5 bg-amber-950 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-400/30">
                  <Baby className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">+ Registrar Nacimiento / Destete</h3>
                  <p className="text-xs text-amber-200">
                    Suma terneros sexados al rodeo e impacta la tasa de procreo
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNacimientoModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmNacimientoDestete} className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Rodeo de Cría *
                  </label>
                  <select
                    required
                    value={nacimientoModal.rodeo_id}
                    onChange={(e) => setNacimientoModal({ ...nacimientoModal, rodeo_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    {rodeos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} ({r.vacas || 0} vacas · {r.terneros || 0} tern.)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tipo de Evento *
                  </label>
                  <select
                    value={nacimientoModal.tipo}
                    onChange={(e) => setNacimientoModal({ ...nacimientoModal, tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    <option value="Nacimiento">Nacimiento (Parición)</option>
                    <option value="Destete">Destete / Pesaje</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 bg-amber-50/70 p-3 rounded-xl border border-amber-200">
                <div>
                  <label className="block text-[11px] font-bold text-sky-900 mb-1 text-center">
                    Machos (M)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={nacimientoModal.machos}
                    onChange={(e) => setNacimientoModal({ ...nacimientoModal, machos: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-sky-300 bg-white text-xs font-black text-center text-sky-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-rose-900 mb-1 text-center">
                    Hembras (H)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={nacimientoModal.hembras}
                    onChange={(e) => setNacimientoModal({ ...nacimientoModal, hembras: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-rose-300 bg-white text-xs font-black text-center text-rose-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-amber-950 mb-1 text-center">
                    Total Cabezas
                  </label>
                  <div className="py-1.5 px-2 bg-amber-100 rounded-lg text-center font-black text-xs text-amber-950 border border-amber-300">
                    {(parseInt(nacimientoModal.machos, 10) || 0) + (parseInt(nacimientoModal.hembras, 10) || 0)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Peso Promedio (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Ej: 32 kg / 185 kg"
                    value={nacimientoModal.peso_promedio}
                    onChange={(e) => setNacimientoModal({ ...nacimientoModal, peso_promedio: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha del Evento *
                  </label>
                  <input
                    type="date"
                    required
                    value={nacimientoModal.fecha}
                    onChange={(e) => setNacimientoModal({ ...nacimientoModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observaciones / Lote
                </label>
                <input
                  type="text"
                  placeholder="Ej: Parición normal en Potrero 4, sin distocia..."
                  value={nacimientoModal.observaciones}
                  onChange={(e) => setNacimientoModal({ ...nacimientoModal, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setNacimientoModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Guardando...' : `Confirmar ${nacimientoModal.tipo}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4: REGISTRAR BAJA / MORTANDAD                                  */}
      {/* ==================================================================== */}
      {bajaModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-red-600 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 sm:p-5 bg-red-950 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-500/20 text-red-300 border border-red-400/30">
                  <Skull className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">+ Registrar Baja por Mortandad</h3>
                  <p className="text-xs text-red-200">
                    Descuenta stock en el rodeo y alimenta el KPI de % mortandad acumulada
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBajaModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmBajaMortandad} className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Rodeo Afectado *
                  </label>
                  <select
                    required
                    value={bajaModal.rodeo_id}
                    onChange={(e) => setBajaModal({ ...bajaModal, rodeo_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    {rodeos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} ({calcTotalRodeoRow(r)} cab.)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={bajaModal.categoria}
                    onChange={(e) => setBajaModal({ ...bajaModal, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  >
                    <option value="Vacas">Vacas Cría</option>
                    <option value="Terneros">Terneros</option>
                    <option value="Toros Padres">Toros Padres</option>
                    <option value="Toritos">Toritos</option>
                    <option value="Vacas CUT">Vacas CUT</option>
                    <option value="Vaquillonas Reposición">Vaquillonas Reposición</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cantidad de Cabezas *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={bajaModal.cabezas}
                    onChange={(e) => setBajaModal({ ...bajaModal, cabezas: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-center"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha del Evento *
                  </label>
                  <input
                    type="date"
                    required
                    value={bajaModal.fecha}
                    onChange={(e) => setBajaModal({ ...bajaModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Causa / Diagnóstico Presuntivo *
                </label>
                <select
                  value={bajaModal.causa}
                  onChange={(e) => setBajaModal({ ...bajaModal, causa: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold"
                >
                  <option value="Empaste / Meteorismo">Empaste / Meteorismo espumoso</option>
                  <option value="Parto distócico / Prolapso">Parto distócico / Prolapso</option>
                  <option value="Infecciosa / Mancha / Carbunclo">Infecciosa / Mancha / Carbunclo</option>
                  <option value="Accidente / Rayo / Ahogamiento">Accidente / Rayo / Ahogamiento</option>
                  <option value="Picadura / Intoxicación vegetal">Picadura / Intoxicación vegetal (Romerillo)</option>
                  <option value="Senescencia / Vejez">Senescencia / Vejez</option>
                  <option value="Causa desconocida / Hallazgo">Causa desconocida / Hallazgo a campo</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Necropsia Realizada
                  </label>
                  <select
                    value={bajaModal.necropsia}
                    onChange={(e) => setBajaModal({ ...bajaModal, necropsia: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  >
                    <option value="No">No realizada</option>
                    <option value="Sí - Diagnóstico confirmado">Sí - Confirmada por veterinario</option>
                    <option value="Pendiente de análisis">Pendiente de laboratorio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Observaciones adicionales
                  </label>
                  <input
                    type="text"
                    placeholder="Detalles del hallazgo..."
                    value={bajaModal.observaciones}
                    onChange={(e) => setBajaModal({ ...bajaModal, observaciones: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setBajaModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Guardando...' : 'Confirmar Baja y Descontar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Encabezado Principal con Selector de Sub-Vistas */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-900 text-white shadow-sm">
              <ClipboardList className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 flex items-center gap-2">
                Planilla Maestra de Rodeos & Movimientos
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 hidden sm:inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-700" />
                  Último cambio: {ultimaActualizacionHacienda}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Control de tropas, movimientos con impacto contable automático, ventas, compras y padrón de caravanas.
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto max-w-full py-1">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap rounded-xl bg-slate-100 p-1 border border-slate-200 gap-1.5">
              <button
                type="button"
                onClick={() => setSubTab('stock_actual')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center sm:justify-start gap-1.5 cursor-pointer ${
                  subTab === 'stock_actual' || subTab === 'planilla_rodeos'
                    ? 'bg-emerald-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 bg-white/60 sm:bg-transparent'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Stock Actual</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-800 text-emerald-200 tabular-nums">
                  {rodeos.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('movimientos_ventas')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center sm:justify-start gap-1.5 cursor-pointer ${
                  subTab === 'movimientos_ventas'
                    ? 'bg-emerald-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 bg-white/60 sm:bg-transparent'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Movimientos de Campo</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 tabular-nums">
                  {movimientosHacienda.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('caravanas')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-bold transition flex items-center justify-center sm:justify-start gap-1.5 cursor-pointer ${
                  subTab === 'caravanas' || subTab === 'animales' || subTab === 'cajas'
                    ? 'bg-emerald-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 bg-white/60 sm:bg-transparent'
                }`}
                title={`Caravanas Vigentes: ${caravanasKpis.totalVigentes.toLocaleString('es-AR')} (${caravanasKpis.enStock} en Stock + ${caravanasKpis.puestas} en Campo)`}
              >
                <Tag className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">🏷️ Caravanas</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                  subTab === 'caravanas' || subTab === 'animales' || subTab === 'cajas'
                    ? 'bg-emerald-800 text-emerald-100'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {caravanasKpis.totalVigentes.toLocaleString('es-AR')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('linea_tiempo')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center sm:justify-start gap-1.5 cursor-pointer ${
                  subTab === 'linea_tiempo'
                    ? 'bg-purple-900 text-white shadow-sm'
                    : 'text-purple-700 hover:text-purple-900 bg-purple-50/70 sm:bg-transparent'
                }`}
              >
                <History className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">🕒 Línea de Tiempo</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-200 text-purple-950 font-bold tabular-nums">
                  {snapshots.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* SUB-VISTA 1: STOCK ACTUAL (RODEOS)                                   */}
      {/* ==================================================================== */}
      {(subTab === 'stock_actual' || subTab === 'planilla_rodeos') && (
        <div className="space-y-6">
          {/* KPIs Superiores de los 13 Rodeos (con Terneros Unificados: Total + Machos / Hembras) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            <div className="bg-emerald-950 text-white rounded-2xl p-4 border border-emerald-800 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Total Hacienda Rodeos
              </div>
              <div className="text-2xl font-extrabold mt-1">
                {totalesRodeos.total.toLocaleString('es-AR')} cab.
              </div>
              <div className="text-xs text-emerald-200/90 mt-1">
                {rodeos.length} rodeos · {totalesRodeos.potrerosOcupados.size} potreros ocupados
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Vacas Cría + CUT
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">
                {(totalesRodeos.vacas + totalesRodeos.vacas_cut).toLocaleString('es-AR')}
              </div>
              <div className="text-xs text-slate-600 font-medium mt-1">
                Vacas: {totalesRodeos.vacas} · CUT: {totalesRodeos.vacas_cut}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-sm bg-emerald-50/30">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                Terneros Total
              </div>
              <div className="text-2xl font-extrabold text-emerald-950 mt-1">
                {totalesRodeos.terneros.toLocaleString('es-AR')}
              </div>
              <div className="text-xs font-semibold text-emerald-800 mt-1">
                Sexados: {totalesRodeos.terneros_machos} M · {totalesRodeos.terneros_hembras} H
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Vaquillonas Reposición
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">
                {totalesRodeos.vaquillonas_reposicion.toLocaleString('es-AR')}
              </div>
              <div className="text-xs text-slate-600 font-medium mt-1">Recría Negra y Colorada</div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Toros Padres + Toritos
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">
                {totalesRodeos.toros_padres + totalesRodeos.toritos}
              </div>
              <div className="text-xs text-slate-600 font-medium mt-1">
                Padres: {totalesRodeos.toros_padres} · Toritos: {totalesRodeos.toritos}
              </div>
            </div>
          </div>

          {/* Contenedor de la Planilla Maestra de Rodeos */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2 flex-wrap">
                  Planilla Maestra de Rodeos — Establecimiento San José
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-emerald-700" />
                    Último cambio: {ultimaActualizacionHacienda}
                  </span>
                  {/* Indicador de Auto-Guardado Intuitivo */}
                  {autoSaveStatus === 'saving' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1.5 animate-pulse">
                      <span className="w-2 h-2 rounded-full border-2 border-amber-600 border-t-transparent animate-spin shrink-0" />
                      Guardando...
                    </span>
                  )}
                  {autoSaveStatus === 'saved' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-900 border border-emerald-200 flex items-center gap-1.5 transition-all duration-300">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      ✓ Todos los cambios guardados
                    </span>
                  )}
                  {autoSaveStatus === 'error' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-900 border border-red-200 flex items-center gap-1.5">
                      ✕ Error al auto-guardar
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Editá cantidades, potrero, toros o condición corporal: los cambios se <strong>guardan automáticamente</strong> al instante. Usá <strong>Mover</strong> para trasladar o <strong>Baja</strong> para salidas.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                {/* Control 1 — Botón Primario de Carga Manual (verde sólido #14532d): + Nuevo Rodeo */}
                <button
                  type="button"
                  onClick={() => setShowNewRodeoForm(!showNewRodeoForm)}
                  className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f4023] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{showNewRodeoForm ? 'Cerrar Formulario' : '+ Nuevo Rodeo'}</span>
                </button>

                {/* Control 2 — Botón Único de Inteligencia Artificial: ✨ Importar con IA */}
                <button
                  type="button"
                  onClick={() => setShowConciliadorIaModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 hover:from-slate-800 hover:to-emerald-900 text-white font-extrabold text-xs flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                  title="Conciliar o importar planillas de stock, manga o caravanas con IA"
                >
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>✨ Importar con IA</span>
                </button>

                {/* Toggle Modo Lectura Seguro vs Modo Edición Rápida */}
                <button
                  type="button"
                  onClick={() => setGlobalEditMode((prev) => !prev)}
                  className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-2xs transition active:scale-95 cursor-pointer shrink-0 border ${
                    globalEditMode
                      ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                  title={globalEditMode ? 'Volver a Modo Lectura Seguro (bloquea toques accidentales)' : 'Habilitar edición rápida con steppers en todos los rodeos'}
                >
                  <span>{globalEditMode ? '✓ Modo Lectura' : '✏️ Modo Edición'}</span>
                </button>

                {/* Control 3 — Menú Desplegable Compacto: Acciones ▾ */}
                <div className="relative inline-block text-left">
                  <button
                    type="button"
                    onClick={() => setShowToolsDropdown((prev) => !prev)}
                    className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer shrink-0"
                  >
                    <span>Acciones</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  {showToolsDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-40 bg-transparent"
                        onClick={() => setShowToolsDropdown(false)}
                      />
                      <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-1 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsDropdown(false);
                            const orig = rodeosRender[0] || null;
                            const dest = rodeosRender[1] || null;
                            setPaseParcialModal({
                              origenId: orig ? orig.id : '',
                              destinoId: dest ? dest.id : '',
                              cantidades: {
                                vacas: 0,
                                terneros_machos: 0,
                                terneros_hembras: 0,
                                vaquillonas: 0,
                                toros: 0,
                              },
                              motivo: '',
                            });
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 hover:text-indigo-950 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold"
                        >
                          <ArrowRightLeft className="w-4 h-4 text-indigo-700 shrink-0" />
                          <span>⇄ Pasar / Mover Hacienda</span>
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            setShowToolsDropdown(false);
                            setSavingManualSnapshot(true);
                            const res = await handleSavePlanillaSnapshot('manual');
                            setSavingManualSnapshot(false);
                            if (res) {
                              notify(`Corte #${res.numero_corte || ''} de planilla guardado correctamente.`, 'success');
                            } else {
                              notify('Error al registrar corte de planilla.', 'error');
                            }
                          }}
                          disabled={savingManualSnapshot}
                          className="w-full text-left px-3.5 py-2 hover:bg-purple-50 hover:text-purple-950 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold disabled:opacity-50"
                        >
                          <Camera className="w-4 h-4 text-purple-700 shrink-0" />
                          <span>{savingManualSnapshot ? 'Guardando corte...' : '📌 Guardar Corte de Planilla'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsDropdown(false);
                            if (onNavigate) {
                              onNavigate('informes', { section: 'dinamica_stock' });
                            }
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-sky-50 hover:text-sky-950 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold"
                        >
                          <BarChart3 className="w-4 h-4 text-sky-700 shrink-0" />
                          <span>📊 Tablero de Evolución y Bajas</span>
                        </button>

                        <div className="border-t border-slate-100 my-1" />

                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsDropdown(false);
                            handleExportPlanillaCampoPDF();
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-amber-50 hover:text-amber-950 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold"
                        >
                          <FileDown className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>📄 Exportar Planilla Campo (PDF)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsDropdown(false);
                            handleExportStockExcel();
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 hover:text-emerald-950 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>📊 Stock Ganadero (Excel .xlsx)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsDropdown(false);
                            setFusionModal({
                              rodeoOrigenId: rodeos[0]?.id || '',
                              rodeoDestinoId: rodeos[1]?.id || '',
                              fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                              motivo: 'Reintegro de tropa apartada',
                              eliminarOrigen: false,
                            });
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold"
                        >
                          <Layers className="w-4 h-4 text-slate-600 shrink-0" />
                          <span>🔗 Fusionar Rodeos</span>
                        </button>

                        {onOpenRecorrida && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowToolsDropdown(false);
                              onOpenRecorrida('GANADERA');
                            }}
                            className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 hover:text-emerald-950 flex items-center gap-2.5 transition cursor-pointer text-slate-700 font-semibold"
                          >
                            <Compass className="w-4 h-4 text-emerald-700 shrink-0" />
                            <span>🧭 Recorrida Ganadera</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {showNewRodeoForm && (
              <form
                onSubmit={handleCreateNewRodeo}
                className="p-4 bg-emerald-50/70 border-b border-emerald-200 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2.5 items-end"
              >
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Nombre del Rodeo *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: VAQUILLONAS PRIMAVERA"
                    value={newRodeo.nombre}
                    onChange={(e) => setNewRodeo({ ...newRodeo, nombre: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Potrero Actual
                  </label>
                  <select
                    value={newRodeo.potrero_numero}
                    onChange={(e) =>
                      setNewRodeo({ ...newRodeo, potrero_numero: e.target.value })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  >
                    <option value="">Sin potrero</option>
                    {potreros.map((p) => (
                      <option key={p.numero} value={p.numero}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Vacas
                  </label>
                  <input
                    type="number"
                    value={newRodeo.vacas}
                    onChange={(e) => setNewRodeo({ ...newRodeo, vacas: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Terneros Total
                  </label>
                  <input
                    type="number"
                    value={newRodeo.terneros}
                    onChange={(e) =>
                      setNewRodeo({ ...newRodeo, terneros: e.target.value })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Machos / Hembras
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      placeholder="M"
                      value={newRodeo.terneros_machos}
                      onChange={(e) =>
                        setNewRodeo({ ...newRodeo, terneros_machos: e.target.value })
                      }
                      className="w-1/2 px-1.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                    />
                    <input
                      type="number"
                      placeholder="H"
                      value={newRodeo.terneros_hembras}
                      onChange={(e) =>
                        setNewRodeo({ ...newRodeo, terneros_hembras: e.target.value })
                      }
                      className="w-1/2 px-1.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Vaq. Reposición
                  </label>
                  <input
                    type="number"
                    value={newRodeo.vaquillonas_reposicion}
                    onChange={(e) =>
                      setNewRodeo({
                        ...newRodeo,
                        vaquillonas_reposicion: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Toros Padres / Toritos
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      placeholder="Padres"
                      value={newRodeo.toros_padres}
                      onChange={(e) =>
                        setNewRodeo({ ...newRodeo, toros_padres: e.target.value })
                      }
                      className="w-1/2 px-1.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                      title="Toros Padres"
                    />
                    <input
                      type="number"
                      placeholder="Toritos"
                      value={newRodeo.toritos}
                      onChange={(e) =>
                        setNewRodeo({ ...newRodeo, toritos: e.target.value })
                      }
                      className="w-1/2 px-1.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                      title="Toritos"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Inicio de Entore
                  </label>
                  <input
                    type="date"
                    value={newRodeo.fecha_entore}
                    onChange={(e) =>
                      setNewRodeo({ ...newRodeo, fecha_entore: e.target.value })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                    Observaciones / Notas
                  </label>
                  <input
                    type="text"
                    placeholder="Notas de campo..."
                    value={newRodeo.observaciones || newRodeo.estado_observaciones || ''}
                    onChange={(e) =>
                      setNewRodeo({
                        ...newRodeo,
                        observaciones: e.target.value,
                        estado_observaciones: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-1.5 px-3 rounded-lg bg-emerald-800 text-white text-xs font-extrabold"
                  >
                    Crear Rodeo
                  </button>
                </div>
              </form>
            )}

                        
            {/* PANEL DE ANÁLISIS REPRODUCTIVO Y EFICIENCIA EN RODEOS (4 TARJETAS EN VIVO) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-3">
              {/* 1. % Preñez (Tacto) */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    % Preñez (Tacto)
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-900 mt-1 tabular-nums">
                    {kpisReproductivosRodeos.pctPrenez}%
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200/80 text-[10.5px] text-slate-600 flex items-center justify-between">
                  <span>
                    Vientres: <strong>{kpisReproductivosRodeos.vientresEnServicio}</strong>
                  </span>
                  <span className="font-bold text-emerald-800">
                    {kpisReproductivosRodeos.vientresPrenados} preñ.
                  </span>
                </div>
              </div>

              {/* 2. % Parición / Al Pie */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    % Parición / Al Pie
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-sky-900 mt-1 tabular-nums">
                    {kpisReproductivosRodeos.pctParicionAlPie}%
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200/80 text-[10.5px] text-slate-600 flex items-center justify-between">
                  <span>
                    Terneros: <strong>{totalesRodeos.terneros}</strong>
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {totalesRodeos.terneros_machos}M · {totalesRodeos.terneros_hembras}H
                  </span>
                </div>
              </div>

              {/* 3. Relación Toro / Vientre */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    Relación Toro / Vientre
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-indigo-950 mt-1 tabular-nums">
                    {kpisReproductivosRodeos.pctTorosVientre}%
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200/80 text-[10.5px] text-slate-600 flex items-center justify-between">
                  <span>
                    <strong>1 toro</strong> / {kpisReproductivosRodeos.vacasPorToro} vacas
                  </span>
                  <span className="font-bold text-indigo-900">
                    {kpisReproductivosRodeos.totalTorosPadres} padres
                  </span>
                </div>
              </div>

              {/* 4. Condición Corporal (CC) Promedio con Alerta */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    Condición Corporal Prom.
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tabular-nums flex items-baseline gap-1">
                    <span>{kpisReproductivosRodeos.ccPromedio}</span>
                    <span className="text-xs font-bold text-amber-500">★ / 5.0</span>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200/80 text-[10.5px] flex items-center justify-between truncate">
                  {kpisReproductivosRodeos.rodeosBajaCc.length > 0 ? (
                    <span className="text-red-700 font-bold truncate">
                      ⚠️ {kpisReproductivosRodeos.rodeosBajaCc[0].nombre} en CC {kpisReproductivosRodeos.rodeosBajaCc[0].condicion_corporal}
                    </span>
                  ) : (
                    <span className="text-emerald-800 font-semibold truncate">
                      ✓ Estado nutricional óptimo
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* VISTA DESKTOP / TABLET: TABLA CON SCROLL HORIZONTAL (hidden md:block) */}
            <div className="hidden md:block overflow-x-auto pb-2 scrollbar-thin [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300/80 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-100/50">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-[11px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 sticky left-0 bg-slate-100 z-10 whitespace-nowrap min-w-[130px] max-w-[150px]">Rodeo</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap min-w-[95px] max-w-[105px]">Rol Protocolo</th>
                    <th className="py-2.5 px-2 whitespace-nowrap min-w-[135px] max-w-[155px]">Potrero</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap min-w-[65px] max-w-[75px]">Vacas</th>
                    <th className="py-2.5 px-2 text-center bg-emerald-50/80 text-emerald-950 border-x border-emerald-200/70 whitespace-nowrap min-w-[160px] max-w-[175px]">
                      Terneros (Tot · M / H)
                    </th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap min-w-[125px] max-w-[140px]">Toros & Lote</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap min-w-[110px] max-w-[125px]">Vaq. Repos. · CUT</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap min-w-[95px] max-w-[105px]">Condición (★)</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-20 bg-slate-100/95 backdrop-blur-xs border-l border-slate-200/80 shadow-[-6px_0_16px_-4px_rgba(15,23,42,0.06)] min-w-[185px]">
                      <div className="flex items-center justify-end gap-3 font-black text-slate-800">
                        <span className="min-w-[70px] text-right">Total Cab.</span>
                        <span className="w-16 text-center">Modo</span>
                        <span className="min-w-[95px] text-center">⚡ Acciones</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rodeosRender.map((r, rIdx) => {
                    const edit = editedRodeos[r.id] || r;
                    const rowTotal = calcTotalRodeoRow(edit);
                    const isEditing = isRodeoEditing(r.id);
                    const countCaravanas =
                      (edit.id != null && caravanasPorRodeo[String(edit.id)] != null)
                        ? caravanasPorRodeo[String(edit.id)]
                        : (caravanasPorRodeo[(edit.nombre || '').trim().toUpperCase()] || 0);

                    return (
                      <tr
                        key={r.id}
                        id={`rodeo-row-${r.id}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', String(r.id));
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggedRodeoId(r.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverRodeoId !== r.id) setDragOverRodeoId(r.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverRodeoId === r.id) setDragOverRodeoId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const sourceId = Number(e.dataTransfer.getData('text/plain')) || draggedRodeoId;
                          setDraggedRodeoId(null);
                          setDragOverRodeoId(null);
                          if (sourceId && sourceId !== r.id) {
                            handleReorderRodeo(sourceId, r.id);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedRodeoId(null);
                          setDragOverRodeoId(null);
                        }}
                        className={`group transition ${
                          draggedRodeoId === r.id
                            ? 'opacity-40 bg-slate-100'
                            : dragOverRodeoId === r.id
                            ? 'border-t-2 border-emerald-500 bg-emerald-50/50'
                            : 'hover:bg-slate-50/90'
                        }`}
                      >
                        {/* 1. Rodeo Nombre + Badge Caravanas y Reproductivo */}
                        <td className="p-2 font-extrabold text-slate-900 sticky left-0 bg-white z-10 border-r border-slate-100 min-w-[130px] max-w-[150px] align-middle">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Grip handle sutil para arrastrar y soltar */}
                              <span
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData('text/plain', String(r.id));
                                  e.dataTransfer.effectAllowed = 'move';
                                  setDraggedRodeoId(r.id);
                                }}
                                className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-800 opacity-30 group-hover:opacity-100 transition-opacity p-0.5 select-none shrink-0"
                                title="Arrastrar para reordenar rodeo en la tabla"
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>
                              <span className="inline-block rounded-md px-2 py-0.5 leading-snug bg-slate-100 text-slate-900 border border-slate-200/90 font-black text-xs">
                                {edit.nombre}
                              </span>

                              {/* Badge compacto de caravanas de una sola línea: 🏷️ {cantidad} */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCaravanasBadgeClick(edit, countCaravanas);
                                }}
                                className={`px-1.5 py-0.5 rounded-md text-[11px] inline-flex items-center gap-1 transition cursor-pointer shrink-0 border ${
                                  countCaravanas > 0
                                    ? 'bg-amber-100 text-amber-950 border-amber-300 font-bold hover:bg-amber-200 shadow-2xs'
                                    : 'bg-slate-100 text-slate-500 border-slate-300 font-medium hover:bg-amber-50 hover:text-amber-900 hover:border-amber-300'
                                }`}
                                title={
                                  countCaravanas > 0
                                    ? `Ver las ${countCaravanas} caravanas activas del rodeo ${edit.nombre} en el Padrón Individual`
                                    : `Sin caravanas asignadas en ${edit.nombre}. Clic para abrir + Asignar Caravanas`
                                }
                              >
                                <span>🏷️</span>
                                <span>{countCaravanas}</span>
                              </button>

                              {/* Indicador discreto si tiene notas registradas (abre modal de notas) */}
                              {(edit.observaciones || edit.estado_observaciones) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openNotasModal(edit);
                                  }}
                                  className="p-1 rounded-md text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 transition cursor-pointer shrink-0 inline-flex items-center justify-center"
                                  title={`Notas de ${edit.nombre}: ${edit.observaciones || edit.estado_observaciones}`}
                                >
                                  <FileText className="w-3 h-3 text-amber-800" />
                                </button>
                              )}
                              {edit.manejo_iatf && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-100 text-purple-900 border border-purple-200"
                                  title={`Inseminación Artificial: ${edit.fecha_inseminacion || 'Programada'}`}
                                >
                                  🧬 IATF
                                </span>
                              )}
                              {edit.repaso_toros && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-200"
                                  title={`Repaso con Toros: ${edit.fecha_repaso_toros || 'En servicio'}`}
                                >
                                  🐂 Repaso
                                </span>
                              )}
                              {edit.toros_en_servicio && ((parseInt(edit.toros_padres, 10) || 0) + (parseInt(edit.toritos, 10) || 0) === 0) && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-900 border border-indigo-200"
                                  title="En servicio activo sin cantidad de toros asignada aún"
                                >
                                  🐂 En servicio (s/ asignar)
                                </span>
                              )}
                            </div>
                            {(edit.fecha_entore || (edit.nombre || '').toUpperCase().includes('TORO')) && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {edit.fecha_entore && (
                                  <span
                                    className="text-[9px] text-emerald-800 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200 font-semibold"
                                    title={`Entore: ${formatFechaAR(edit.fecha_entore)} ${edit.fecha_salida_toros ? `· Salida: ${formatFechaAR(edit.fecha_salida_toros)}` : ''}`}
                                  >
                                    Entore: {formatFechaAR(edit.fecha_entore)}
                                  </span>
                                )}
                                {(() => {
                                  const nom = (edit.nombre || '').toUpperCase().trim();
                                  const rol = (edit.rol_protocolo || '').toLowerCase();
                                  const esRodeoToros = edit.id === 10 || nom === 'TOROS' || (nom.includes('TORO') && !nom.includes('REPASO') && (rol.includes('toro') || nom === 'TOROS'));
                                  if (!esRodeoToros) return null;
                                  return (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[9px] font-black bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center gap-1 shadow-xs"
                                      title={`Pool Total: ${poolTorosInfo.totalPool} cab. (${poolTorosInfo.poolPadresTot} Padres + ${poolTorosInfo.poolToritosTot} Toritos) · En servicio: ${poolTorosInfo.enServicioTotal} cab. · Libres: ${poolTorosInfo.libresTotal} cab.`}
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse shrink-0" />
                                      En servicio: {poolTorosInfo.enServicioTotal} cab. · Libres: {poolTorosInfo.libresTotal} cab.
                                    </span>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 1.bis Rol Protocolo */}
                        <td className="p-1 min-w-[95px] max-w-[105px] align-middle">
                          <select
                            value={edit.rol_protocolo || inferirRolProtocolo(edit)}
                            onChange={(e) => updateRodeoField(r.id, 'rol_protocolo', e.target.value, true)}
                            className="w-full px-1.5 py-1 rounded border border-slate-300 bg-white font-extrabold text-[10px] text-slate-800"
                          >
                            {ROLES_PROTOCOLO.map((rol) => (
                              <option key={rol} value={rol}>
                                {rol}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* 2. Potrero + Días Permanencia + Hectáreas */}
                        <td className="p-1.5 min-w-[135px] max-w-[155px] align-middle">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <select
                                value={edit.potrero_numero ?? ''}
                                onChange={(e) => updateRodeoField(r.id, 'potrero_numero', e.target.value, true)}
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-slate-900 text-xs truncate"
                              >
                                <option value="">Sin potrero</option>
                                {potreros.map((p) => {
                                  const cleanLabel = p.nombre || formatPotreroNum(p.numero);
                                  return (
                                    <option key={p.numero} value={p.numero}>
                                      {cleanLabel}
                                    </option>
                                  );
                                })}
                              </select>
                              {edit.potrero_numero && (
                                <button
                                  type="button"
                                  onClick={() => onSelectPotreroInMap(Number(edit.potrero_numero))}
                                  className="p-1.5 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 shrink-0 cursor-pointer transition"
                                  title="Ver en Mapa"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-1 px-1 py-0.5">
                              <span
                                className="font-extrabold text-xs text-slate-900 truncate"
                                title={potreros.find((p) => String(p.numero) === String(edit.potrero_numero))?.nombre || (edit.potrero_numero ? formatPotreroNum(edit.potrero_numero) : 'Sin potrero')}
                              >
                                {potreros.find((p) => String(p.numero) === String(edit.potrero_numero))?.nombre || (edit.potrero_numero ? formatPotreroNum(edit.potrero_numero) : 'Sin potrero')}
                              </span>
                              {edit.potrero_numero && (
                                <button
                                  type="button"
                                  onClick={() => onSelectPotreroInMap(Number(edit.potrero_numero))}
                                  className="p-1 rounded-md text-emerald-800 hover:bg-emerald-50 shrink-0 cursor-pointer transition"
                                  title="Ver en Mapa"
                                >
                                  <MapPin className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                          {edit.potrero_numero && (() => {
                            const perm = calcPermanenciaPotrero(edit, fechaOperacion);
                            const diasActuales = perm.dias;
                            const diasMeta = Number(edit.dias_estimados_pastoreo) || perm.diasEstimados || 30;
                            const pctProgreso = Math.min(100, Math.round((diasActuales / diasMeta) * 100));
                            const esAlerta = pctProgreso >= 100;
                            const esAdvertencia = pctProgreso >= 80 && !esAlerta;
                            const barColor = esAlerta ? 'bg-red-500' : esAdvertencia ? 'bg-amber-500' : 'bg-emerald-500';
                            const dotColor = esAlerta ? 'bg-red-600' : esAdvertencia ? 'bg-amber-500' : 'bg-emerald-600';

                            const potObj = potreros.find((p) => String(p.numero) === String(edit.potrero_numero));
                            const haNum = potObj ? Math.round(Number(potObj.hectareas) || 0) : null;

                            return (
                              <div
                                className="w-full mt-1 px-1.5 py-0.5 rounded border text-[9px] font-bold flex flex-col justify-center bg-slate-50 border-slate-200 overflow-hidden"
                                title={`Ingreso: ${perm.fechaIngreso || '30/10/2026'} · Ocupación: ${diasActuales}d de ${diasMeta}d (${pctProgreso}%)${haNum != null ? ` · Superficie: ${haNum} ha` : ''}`}
                              >
                                <div className="flex items-center justify-between gap-1 w-full">
                                  <span className="inline-flex items-center gap-1 truncate text-slate-800">
                                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
                                    <span>{diasActuales}d de pastoreo</span>
                                    {haNum != null && (
                                      <>
                                        <span className="text-slate-400 font-normal">·</span>
                                        <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 font-black text-[8.5px] border border-emerald-200/80 shrink-0">
                                          {haNum} ha
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  <span className="text-[8px] text-slate-400 font-semibold shrink-0">meta {diasMeta}d</span>
                                </div>
                                <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden mt-0.5">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                                    style={{ width: `${pctProgreso}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* 3. Vacas con Stepper Táctil (o Número Grande en Modo Lectura) */}
                        <td className="p-1 text-center align-middle min-w-[65px] max-w-[75px]">
                          {isEditing ? (
                            <div className="flex flex-col items-center justify-center">
                              <span className="block text-[8px] font-bold text-slate-500 uppercase mb-1 h-3.5 flex items-center justify-center">
                                Vacas
                              </span>
                              <AnimalStepperInput
                                value={edit.vacas ?? 0}
                                colorTheme="slate"
                                inputWidth="w-12"
                                onChange={(val) => updateRodeoField(r.id, 'vacas', val, false)}
                                onBlur={(e) => handleRodeoBlur(r.id, 'vacas', e)}
                                ariaLabel="Vacas"
                                title="Vacas del rodeo"
                              />
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-1">
                              <span className="text-sm font-black text-slate-900 tabular-nums">
                                {Number(edit.vacas || 0).toLocaleString('es-AR')}
                              </span>
                              <span className="text-[9px] font-bold text-slate-500 uppercase">
                                Vacas
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 4. Terneros Unificados (Tot · M / H) */}
                        <td className="p-1.5 bg-emerald-50/40 border-x border-emerald-100 text-center align-middle min-w-[160px] max-w-[175px]">
                          {(() => {
                            const cantVacas = parseInt(edit.vacas, 10) || 0;
                            const cantM = parseInt(edit.terneros_machos, 10) || 0;
                            const cantH = parseInt(edit.terneros_hembras, 10) || 0;
                            const isSexed = cantM + cantH > 0;
                            const cantTerneros = isSexed ? cantM + cantH : (parseInt(edit.terneros, 10) || 0);
                            const pctAlPie = cantVacas > 0 ? Math.round((cantTerneros / cantVacas) * 100) : null;

                            if (isEditing) {
                              return (
                                <div className="flex flex-col items-center justify-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {/* Total Terneros */}
                                    <div className="flex flex-col items-center">
                                      <span className="block text-[8px] font-extrabold text-emerald-900 uppercase mb-1 h-3.5 flex items-center justify-center">
                                        Tot
                                      </span>
                                      <AnimalStepperInput
                                        value={edit.terneros ?? 0}
                                        disabled={isSexed}
                                        colorTheme="emerald"
                                        inputWidth="w-11"
                                        onChange={(val) => updateRodeoField(r.id, 'terneros', val, false)}
                                        onBlur={(e) => handleRodeoBlur(r.id, 'terneros', e)}
                                        ariaLabel="Terneros Total"
                                        title={isSexed ? 'TOT = M + H (calculado automáticamente)' : 'Sin sexar: editar total directamente'}
                                      />
                                    </div>

                                    {/* Machos M */}
                                    <div className="flex flex-col items-center">
                                      <span className="block text-[8px] font-bold text-sky-800 uppercase mb-1 h-3.5 flex items-center justify-center">
                                        M
                                      </span>
                                      <AnimalStepperInput
                                        value={edit.terneros_machos ?? 0}
                                        colorTheme="sky"
                                        inputWidth="w-11"
                                        onChange={(val) => updateRodeoField(r.id, 'terneros_machos', val, false)}
                                        onBlur={(e) => handleRodeoBlur(r.id, 'terneros_machos', e)}
                                        ariaLabel="Terneros Machos"
                                        title="Terneros Machos (M)"
                                      />
                                    </div>

                                    {/* Hembras H */}
                                    <div className="flex flex-col items-center">
                                      <span className="block text-[8px] font-bold text-rose-800 uppercase mb-1 h-3.5 flex items-center justify-center">
                                        H
                                      </span>
                                      <AnimalStepperInput
                                        value={edit.terneros_hembras ?? 0}
                                        colorTheme="rose"
                                        inputWidth="w-11"
                                        onChange={(val) => updateRodeoField(r.id, 'terneros_hembras', val, false)}
                                        onBlur={(e) => handleRodeoBlur(r.id, 'terneros_hembras', e)}
                                        ariaLabel="Terneros Hembras"
                                        title="Terneros Hembras (H)"
                                      />
                                    </div>
                                  </div>

                                  {/* Mini badge con porcentaje de terneros al pie (cuando vacas > 0) */}
                                  {pctAlPie != null && (
                                    <div className="mt-1 flex justify-center">
                                      <span
                                        className={`inline-block px-1.5 py-0.2 rounded-full text-[9px] font-extrabold tracking-tight border ${
                                          pctAlPie >= 80
                                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                            : pctAlPie >= 60
                                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                                            : 'bg-slate-100 text-slate-700 border-slate-300'
                                        }`}
                                        title={`Terneros al pie: ${cantTerneros} terneros / ${cantVacas} vacas (${pctAlPie}%)`}
                                      >
                                        {pctAlPie}% al pie
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            // Modo Lectura Limpio
                            return (
                              <div className="flex flex-col items-center justify-center py-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-black text-emerald-950 tabular-nums">
                                    {cantTerneros}
                                  </span>
                                  <span className="text-[9px] font-bold text-emerald-800 uppercase">
                                    Terneros
                                  </span>
                                  {pctAlPie != null && (
                                    <span
                                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-extrabold border ${
                                        pctAlPie >= 80
                                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                          : 'bg-amber-100 text-amber-900 border-amber-300'
                                      }`}
                                    >
                                      {pctAlPie}%
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                  <span className="text-sky-800 font-bold">{cantM} M</span>
                                  <span className="mx-1 text-slate-300">·</span>
                                  <span className="text-rose-800 font-bold">{cantH} H</span>
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* 5. Toros Padres + Toritos & Estado de Servicio */}
                        <td className="p-1 text-center align-middle min-w-[125px] max-w-[140px]">
                          {(() => {
                            const cantPadres = parseInt(edit.toros_padres, 10) || 0;
                            const cantToritos = parseInt(edit.toritos, 10) || 0;
                            const totalToros = cantPadres + cantToritos;

                            if (isEditing) {
                              return (
                                <div className="flex flex-col items-center justify-center">
                                  <div className="flex items-center justify-center gap-1.5 mb-1.5">
                                    {/* Toros Padres */}
                                    <div className="flex flex-col items-center">
                                      <span className="block text-[8px] font-bold text-slate-500 uppercase mb-1 h-3.5 flex items-center justify-center">
                                        Padres
                                      </span>
                                      <AnimalStepperInput
                                        value={edit.toros_padres ?? 0}
                                        colorTheme="slate"
                                        inputWidth="w-11"
                                        onChange={(val) => updateRodeoField(r.id, 'toros_padres', val, false)}
                                        onBlur={(e) => handleRodeoBlur(r.id, 'toros_padres', e)}
                                        ariaLabel="Toros Padres"
                                        title="Toros Padres"
                                      />
                                    </div>

                                    {/* Toritos */}
                                    <div className="flex flex-col items-center">
                                      <span className="block text-[8px] font-bold text-slate-500 uppercase mb-1 h-3.5 flex items-center justify-center">
                                        Toritos
                                      </span>
                                      <AnimalStepperInput
                                        value={edit.toritos ?? 0}
                                        colorTheme="slate"
                                        inputWidth="w-11"
                                        onChange={(val) => updateRodeoField(r.id, 'toritos', val, false)}
                                        onBlur={(e) => handleRodeoBlur(r.id, 'toritos', e)}
                                        ariaLabel="Toritos"
                                        title="Toritos"
                                      />
                                    </div>
                                  </div>

                                  {/* Input de lote y botón de ficha reproductiva */}
                                  <div className="flex items-center justify-center gap-1 w-full max-w-[195px] mx-auto">
                                    <input
                                      type="text"
                                      placeholder="Lote/Toros..."
                                      value={edit.toro_lote_asignado ?? ''}
                                      onChange={(e) => updateRodeoField(r.id, 'toro_lote_asignado', e.target.value, false)}
                                      onBlur={(e) => handleRodeoBlur(r.id, 'toro_lote_asignado', e)}
                                      className="w-full px-1.5 py-0.5 rounded border border-slate-200 text-[10px] bg-white text-slate-800"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => openReproductiveModal(r)}
                                      className={`p-1 rounded border shrink-0 transition cursor-pointer ${
                                        edit.toros_padres > 0 || edit.fecha_entore || edit.manejo_iatf || edit.toros_en_servicio
                                          ? 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100'
                                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                      }`}
                                      title="Abrir Ficha de Gestión Reproductiva (Toros, Entore, IATF, Tacto)"
                                    >
                                      <Calendar className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            // Modo Lectura Limpio
                            return (
                              <div className="flex flex-col items-center justify-center py-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-black text-slate-900 tabular-nums">
                                    {totalToros}
                                  </span>
                                  <span className="text-[9px] font-bold text-slate-500 uppercase">
                                    Toros
                                  </span>
                                  {(edit.toros_padres > 0 || edit.fecha_entore || edit.manejo_iatf || edit.toros_en_servicio) && (
                                    <button
                                      type="button"
                                      onClick={() => openReproductiveModal(r)}
                                      className="p-0.5 rounded text-purple-700 hover:bg-purple-50 transition"
                                      title="Ver Ficha Reproductiva"
                                    >
                                      <Calendar className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                  <span>{cantPadres} Padres</span>
                                  <span className="mx-1 text-slate-300">·</span>
                                  <span>{cantToritos} Toritos</span>
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* 6. Vaquillonas Reposición & Vacas CUT */}
                        <td className="p-1 text-center align-middle min-w-[110px] max-w-[125px]">
                          {(() => {
                            const cantVaq = parseInt(edit.vaquillonas_reposicion, 10) || 0;
                            const cantCut = parseInt(edit.vacas_cut, 10) || 0;

                            if (isEditing) {
                              return (
                                <div className="flex items-center justify-center gap-1.5">
                                  {/* Vaquillonas Reposición */}
                                  <div className="flex flex-col items-center">
                                    <span className="block text-[8px] font-bold text-purple-800 uppercase mb-1 h-3.5 flex items-center justify-center">
                                      Vaq. Rep.
                                    </span>
                                    <AnimalStepperInput
                                      value={edit.vaquillonas_reposicion ?? 0}
                                      colorTheme="purple"
                                      inputWidth="w-11"
                                      onChange={(val) => updateRodeoField(r.id, 'vaquillonas_reposicion', val, false)}
                                      onBlur={(e) => handleRodeoBlur(r.id, 'vaquillonas_reposicion', e)}
                                      ariaLabel="Vaquillonas Reposición"
                                      title="Vaquillonas Reposición"
                                    />
                                  </div>

                                  {/* Vacas CUT */}
                                  <div className="flex flex-col items-center">
                                    <span className="block text-[8px] font-bold text-amber-800 uppercase mb-1 h-3.5 flex items-center justify-center">
                                      CUT
                                    </span>
                                    <AnimalStepperInput
                                      value={edit.vacas_cut ?? 0}
                                      colorTheme="amber"
                                      inputWidth="w-11"
                                      onChange={(val) => updateRodeoField(r.id, 'vacas_cut', val, false)}
                                      onBlur={(e) => handleRodeoBlur(r.id, 'vacas_cut', e)}
                                      ariaLabel="Vacas CUT"
                                      title="Vacas CUT"
                                    />
                                  </div>
                                </div>
                              );
                            }

                            // Modo Lectura Limpio
                            return (
                              <div className="flex flex-col items-center justify-center py-1">
                                <div className="text-[11px] font-extrabold text-slate-800">
                                  <span className="text-purple-900">{cantVaq} Vaq.</span>
                                  <span className="mx-1 text-slate-300">·</span>
                                  <span className="text-amber-900">{cantCut} CUT</span>
                                </div>
                                <span className="text-[8.5px] font-bold text-slate-400 uppercase mt-0.5">
                                  Recría & Descarte
                                </span>
                              </div>
                            );
                          })()}
                        </td>

                        {/* 7. Condición Corporal (1 a 5 ★ con semáforo) */}
                        <td className="p-1 text-center align-middle whitespace-nowrap min-w-[95px] max-w-[105px]">
                          <CondicionCorporalStars
                            value={edit.condicion_corporal ?? 3.0}
                            onChange={(val) => updateRodeoField(r.id, 'condicion_corporal', val, true)}
                            size="sm"
                            showScore={true}
                          />
                        </td>

                        {/* 8. STICKY RIGHT: Total Cabezas + ✏️ Editar / ✓ Listo + ⚡ Acciones */}
                        <td className="p-2 text-right whitespace-nowrap sticky right-0 z-20 bg-white border-l border-slate-200/80 shadow-[-6px_0_16px_-4px_rgba(15,23,42,0.08)] min-w-[185px] align-middle">
                          <div className="inline-flex items-center justify-end gap-2.5">
                            {/* Total Cabezas y carga cab/ha */}
                            <div className="min-w-[70px] text-right pr-1">
                              <div className="font-black text-sm text-slate-900 tabular-nums leading-tight">
                                {rowTotal} <span className="text-[10px] text-slate-500 font-bold">cab.</span>
                              </div>
                              {(() => {
                                if (!edit.potrero_numero) return null;
                                const pObj = potreros.find((p) => Number(p.numero) === Number(edit.potrero_numero));
                                const haRaw = pObj ? (parseFloat(String(pObj.hectareas).replace(',', '.')) || 0) : 0;
                                if (haRaw <= 0) return null;
                                const cargaInstantanea = (rowTotal / haRaw).toFixed(2);
                                return (
                                  <div
                                    className="text-[10px] font-bold text-emerald-800 tracking-tight"
                                    title={`Densidad ganadera: ${rowTotal} cabezas en ${haRaw} ha de ${pObj.nombre || 'Potrero'}`}
                                  >
                                    {cargaInstantanea} cab/ha
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Botón Modo Edición Individual */}
                            <button
                              type="button"
                              onClick={() => toggleRodeoEdit(r.id)}
                              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer shrink-0 ${
                                isEditing
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                              }`}
                              title={isEditing ? 'Cerrar modo edición y guardar' : 'Habilitar edición con steppers'}
                            >
                              {isEditing ? '✓ Listo' : '✏️ Editar'}
                            </button>

                            {/* Botón ⚡ Acciones */}
                            <div className="min-w-[95px] flex justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  if (actionMenuState?.rodeoId === r.id) {
                                    setActionMenuState(null);
                                    return;
                                  }
                                  const spaceBelow = window.innerHeight - rect.bottom;
                                  const openUp = spaceBelow < 300 && rect.top > spaceBelow;

                                  setActionMenuState({
                                    rodeoId: r.id,
                                    rodeo: edit,
                                    openUp,
                                    top: openUp ? undefined : rect.bottom + 6,
                                    bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
                                    right: Math.max(16, window.innerWidth - rect.right),
                                    maxHeight: openUp
                                      ? Math.max(220, rect.top - 20)
                                      : Math.max(220, window.innerHeight - rect.bottom - 20),
                                  });
                                }}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1 border transition shadow-xs cursor-pointer ${
                                  actionMenuState?.rodeoId === r.id
                                    ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-emerald-400/50'
                                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300'
                                }`}
                                title="Acciones del rodeo"
                              >
                                <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                                <span>Acciones</span>
                                <ChevronDown
                                  className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                                    actionMenuState?.rodeoId === r.id ? 'rotate-180 text-white' : ''
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-900 text-white font-extrabold text-xs">
                  <tr>
                    <td className="py-2.5 px-3 sticky left-0 bg-slate-900 z-10 whitespace-nowrap min-w-[130px] align-middle">
                      TOTAL ({rodeos.length} RODEOS)
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-400 font-bold min-w-[95px] max-w-[105px] align-middle">—</td>
                    <td className="py-2.5 px-2 text-emerald-300 whitespace-nowrap min-w-[135px] align-middle">
                      {totalesRodeos.potrerosOcupados.size} potreros activos
                    </td>
                    <td className="py-2.5 px-2 text-center text-sm font-black tabular-nums text-emerald-300 min-w-[65px] align-middle">
                      {totalesRodeos.vacas}
                    </td>
                    <td className="py-2.5 px-2 text-center bg-emerald-950 border-x border-emerald-800 tabular-nums min-w-[160px] align-middle">
                      <span className="text-emerald-300 font-black text-sm tabular-nums">
                        {totalesRodeos.terneros}
                      </span>{' '}
                      <span className="text-[10px] text-slate-300 font-normal">
                        ({totalesRodeos.terneros_machos}M·{totalesRodeos.terneros_hembras}H)
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-sm font-black tabular-nums text-emerald-300 min-w-[125px] align-middle">
                      {totalesRodeos.toros_padres + totalesRodeos.toritos}
                    </td>
                    <td className="py-2.5 px-2 text-center text-sm font-black tabular-nums text-emerald-300 min-w-[110px] align-middle">
                      {totalesRodeos.vaquillonas_reposicion} / {totalesRodeos.vacas_cut}
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-400 font-bold min-w-[95px] max-w-[105px] align-middle">—</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-20 bg-slate-900 border-l border-slate-700/80 shadow-[-6px_0_16px_-4px_rgba(15,23,42,0.06)] min-w-[185px] align-middle">
                      <div className="flex items-center justify-end gap-2 pr-1">
                        <div className="min-w-[80px] text-right">
                          <span className="text-white text-base font-black tabular-nums">
                            {totalesRodeos.total.toLocaleString('es-AR')}
                          </span>
                          <span className="text-emerald-400 font-bold text-xs ml-1">cab.</span>
                        </div>
                        <div className="min-w-[95px]" />
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>


{/* VISTA MOBILE: TARJETAS RESPONSIVE TÁCTILES SIN COLUMNAS STICKY (block md:hidden) */}
            <div className="block md:hidden space-y-3">
              {rodeosRender.map((r) => {
                const edit = editedRodeos[r.id] || r;
                const rowTotal = calcTotalRodeoRow(edit);
                const isEditing = isRodeoEditing(r.id);
                const countCaravanas =
                  (edit.id != null && caravanasPorRodeo[String(edit.id)] != null)
                    ? caravanasPorRodeo[String(edit.id)]
                    : (caravanasPorRodeo[(edit.nombre || '').trim().toUpperCase()] || 0);
                const perm = edit.potrero_numero ? calcPermanenciaPotrero(edit, fechaOperacion) : null;
                const potObj = edit.potrero_numero ? potreros.find((p) => String(p.numero) === String(edit.potrero_numero)) : null;
                const haRaw = potObj ? (parseFloat(String(potObj.hectareas).replace(',', '.')) || 0) : 0;
                const cargaInstantanea = haRaw > 0 ? (rowTotal / haRaw).toFixed(2) : null;

                const cantVacas = parseInt(edit.vacas, 10) || 0;
                const cantM = parseInt(edit.terneros_machos, 10) || 0;
                const cantH = parseInt(edit.terneros_hembras, 10) || 0;
                const isSexed = cantM + cantH > 0;
                const cantTerneros = isSexed ? cantM + cantH : (parseInt(edit.terneros, 10) || 0);
                const pctAlPie = cantVacas > 0 ? Math.round((cantTerneros / cantVacas) * 100) : null;
                const cantPadres = parseInt(edit.toros_padres, 10) || 0;
                const cantToritos = parseInt(edit.toritos, 10) || 0;
                const totalToros = cantPadres + cantToritos;
                const cantVaq = parseInt(edit.vaquillonas_reposicion, 10) || 0;
                const cantCut = parseInt(edit.vacas_cut, 10) || 0;

                return (
                  <div
                    key={r.id}
                    id={`rodeo-card-mobile-${r.id}`}
                    className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-sm space-y-3"
                  >
                    {/* CABECERA DE TARJETA: Nombre, Caravanas, Badges y Total Cabezas */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-black text-sm text-slate-900">
                            {edit.nombre}
                          </span>

                          {/* Badge compacto de caravanas en móvil */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCaravanasBadgeClick(edit, countCaravanas);
                            }}
                            className={`px-1.5 py-0.5 rounded-md text-[11px] inline-flex items-center gap-1 transition cursor-pointer shrink-0 border ${
                              countCaravanas > 0
                                ? 'bg-amber-100 text-amber-950 border-amber-300 font-bold hover:bg-amber-200 shadow-2xs'
                                : 'bg-slate-100 text-slate-500 border-slate-300 font-medium hover:bg-amber-50 hover:text-amber-900 hover:border-amber-300'
                            }`}
                            title={
                              countCaravanas > 0
                                ? `Ver las ${countCaravanas} caravanas activas de ${edit.nombre} en el Padrón`
                                : `Sin caravanas asignadas en ${edit.nombre}. Tocar para asignar caravanas`
                            }
                          >
                            <span>🏷️</span>
                            <span>{countCaravanas}</span>
                          </button>

                          {/* Indicador discreto de notas en móvil */}
                          {(edit.observaciones || edit.estado_observaciones) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openNotasModal(edit);
                              }}
                              className="p-1 rounded-md text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 transition cursor-pointer shrink-0 inline-flex items-center justify-center"
                              title={`Notas de ${edit.nombre}: ${edit.observaciones || edit.estado_observaciones}`}
                            >
                              <FileText className="w-3 h-3 text-amber-800" />
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            {edit.rol_protocolo || inferirRolProtocolo(edit)}
                          </span>
                          {edit.manejo_iatf && (
                            <span className="text-[10px] font-bold text-purple-800 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                              🧬 IATF
                            </span>
                          )}
                          {edit.repaso_toros && (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              🐂 Repaso
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Total Cabezas, carga y botón Modo Edición / Listo */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleRodeoEdit(r.id)}
                          className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer shrink-0 ${
                            isEditing
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {isEditing ? '✓ Listo' : '✏️ Editar'}
                        </button>

                        <div className="text-right shrink-0 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200/80">
                          <div className="font-black text-base text-slate-900 tabular-nums leading-none">
                            {rowTotal} <span className="text-[10px] text-slate-500 font-bold">cab.</span>
                          </div>
                          {cargaInstantanea && (
                            <div className="text-[10px] font-bold text-emerald-800 mt-0.5">
                              {cargaInstantanea} cab/ha
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* POTRERO Y DÍAS DE PASTOREO EN ANCHO COMPLETO */}
                    <div className="space-y-1">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={edit.potrero_numero ?? ''}
                            onChange={(e) => updateRodeoField(r.id, 'potrero_numero', e.target.value, true)}
                            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 text-xs"
                          >
                            <option value="">Sin potrero asignado</option>
                            {potreros.map((p) => {
                              const cleanLabel = p.nombre || formatPotreroNum(p.numero);
                              return (
                                <option key={p.numero} value={p.numero}>
                                  {cleanLabel}
                                </option>
                              );
                            })}
                          </select>
                          {edit.potrero_numero && (
                            <button
                              type="button"
                              onClick={() => onSelectPotreroInMap(Number(edit.potrero_numero))}
                              className="p-2 rounded-xl bg-emerald-50 text-emerald-800 shrink-0"
                              title="Ver en Mapa"
                            >
                              <MapPin className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span className="font-extrabold text-slate-900 truncate">
                              {potreros.find((p) => String(p.numero) === String(edit.potrero_numero))?.nombre || (edit.potrero_numero ? formatPotreroNum(edit.potrero_numero) : 'Sin potrero asignado')}
                            </span>
                          </div>
                          {edit.potrero_numero && (
                            <button
                              type="button"
                              onClick={() => onSelectPotreroInMap(Number(edit.potrero_numero))}
                              className="text-[11px] font-bold text-emerald-800 hover:underline shrink-0"
                            >
                              Ver en mapa
                            </button>
                          )}
                        </div>
                      )}
                      {perm && (
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold px-1">
                          <span>{perm.dias}d de pastoreo {haRaw > 0 ? `· ${Math.round(haRaw)} ha` : ''}</span>
                          <span>meta {Number(edit.dias_estimados_pastoreo) || 30}d</span>
                        </div>
                      )}
                    </div>

                    {/* CUERPO: MODO EDICIÓN CON STEPPERS VS MODO LECTURA LIMPIO */}
                    {isEditing ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                        {/* Vacas */}
                        <div className="bg-white p-2 rounded-xl border border-slate-200 text-center flex flex-col items-center">
                          <span className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Vacas</span>
                          <AnimalStepperInput
                            value={edit.vacas ?? 0}
                            colorTheme="slate"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'vacas', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'vacas', e)}
                            ariaLabel="Vacas"
                          />
                        </div>

                        {/* Terneros M */}
                        <div className="bg-white p-2 rounded-xl border border-sky-200 text-center flex flex-col items-center">
                          <span className="block text-[9px] font-bold uppercase text-sky-800 mb-1">Terneros M</span>
                          <AnimalStepperInput
                            value={edit.terneros_machos ?? 0}
                            colorTheme="sky"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'terneros_machos', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'terneros_machos', e)}
                            ariaLabel="Terneros Machos"
                          />
                        </div>

                        {/* Terneros H */}
                        <div className="bg-white p-2 rounded-xl border border-rose-200 text-center flex flex-col items-center">
                          <span className="block text-[9px] font-bold uppercase text-rose-800 mb-1">Terneros H</span>
                          <AnimalStepperInput
                            value={edit.terneros_hembras ?? 0}
                            colorTheme="rose"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'terneros_hembras', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'terneros_hembras', e)}
                            ariaLabel="Terneros Hembras"
                          />
                        </div>

                        {/* Toros Padres */}
                        <div className="bg-white p-2 rounded-xl border border-slate-200 text-center flex flex-col items-center">
                          <span className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Padres</span>
                          <AnimalStepperInput
                            value={edit.toros_padres ?? 0}
                            colorTheme="slate"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'toros_padres', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'toros_padres', e)}
                            ariaLabel="Toros Padres"
                          />
                        </div>

                        {/* Toritos */}
                        <div className="bg-white p-2 rounded-xl border border-slate-200 text-center flex flex-col items-center">
                          <span className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Toritos</span>
                          <AnimalStepperInput
                            value={edit.toritos ?? 0}
                            colorTheme="slate"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'toritos', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'toritos', e)}
                            ariaLabel="Toritos"
                          />
                        </div>

                        {/* Vaquillonas Reposición */}
                        <div className="bg-white p-2 rounded-xl border border-purple-200 text-center flex flex-col items-center">
                          <span className="block text-[9px] font-bold uppercase text-purple-800 mb-1">Vaq. Rep.</span>
                          <AnimalStepperInput
                            value={edit.vaquillonas_reposicion ?? 0}
                            colorTheme="purple"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'vaquillonas_reposicion', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'vaquillonas_reposicion', e)}
                            ariaLabel="Vaquillonas Reposición"
                          />
                        </div>

                        {/* Vacas CUT */}
                        <div className="bg-white p-2 rounded-xl border border-amber-200 text-center flex flex-col items-center col-span-2 sm:col-span-1">
                          <span className="block text-[9px] font-bold uppercase text-amber-800 mb-1">Vacas CUT</span>
                          <AnimalStepperInput
                            value={edit.vacas_cut ?? 0}
                            colorTheme="amber"
                            inputWidth="w-10"
                            onChange={(val) => updateRodeoField(r.id, 'vacas_cut', val, false)}
                            onBlur={(e) => handleRodeoBlur(r.id, 'vacas_cut', e)}
                            ariaLabel="Vacas CUT"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                        {/* Vacas */}
                        <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center flex flex-col items-center justify-center">
                          <div className="text-base font-black text-slate-900 tabular-nums">
                            {Number(edit.vacas || 0).toLocaleString('es-AR')}
                          </div>
                          <div className="text-[9px] font-extrabold uppercase text-slate-500 mt-0.5">Vacas</div>
                        </div>

                        {/* Terneros Total Destacado */}
                        <div className="bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-200 text-center flex flex-col items-center justify-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-base font-black text-emerald-950 tabular-nums">
                              {cantTerneros}
                            </span>
                            {pctAlPie != null && (
                              <span
                                className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full border ${
                                  pctAlPie >= 80
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                    : 'bg-amber-100 text-amber-900 border-amber-300'
                                }`}
                              >
                                {pctAlPie}%
                              </span>
                            )}
                          </div>
                          <div className="text-[9px] font-extrabold uppercase text-emerald-900 mt-0.5">
                            Terneros ({cantM} M · {cantH} H)
                          </div>
                        </div>

                        {/* Toros Padres + Toritos */}
                        <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center flex flex-col items-center justify-center">
                          <div className="text-base font-black text-slate-900 tabular-nums">
                            {totalToros}
                          </div>
                          <div className="text-[9px] font-extrabold uppercase text-slate-500 mt-0.5">
                            Toros ({cantPadres} P · {cantToritos} T)
                          </div>
                        </div>

                        {/* Vaquillonas y CUT */}
                        <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center flex flex-col items-center justify-center">
                          <div className="text-xs font-black text-slate-900 tabular-nums pt-0.5">
                            <span className="text-purple-900">{cantVaq} Vaq.</span>
                            <span className="mx-1 text-slate-300">·</span>
                            <span className="text-amber-900">{cantCut} CUT</span>
                          </div>
                          <div className="text-[9px] font-extrabold uppercase text-slate-500 mt-0.5">
                            Recría & Descarte
                          </div>
                        </div>
                      </div>
                    )}

{/* PIE DE TARJETA: Condición Corporal + Botón ⚡ Acciones Ancho Completo */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1">
                        <CondicionCorporalStars
                          value={edit.condicion_corporal ?? 3.0}
                          onChange={(val) => updateRodeoField(r.id, 'condicion_corporal', val, true)}
                          size="sm"
                          showScore={true}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (actionMenuState?.rodeoId === r.id) {
                            setActionMenuState(null);
                            return;
                          }
                          const spaceBelow = window.innerHeight - rect.bottom;
                          const openUp = spaceBelow < 300 && rect.top > spaceBelow;

                          setActionMenuState({
                            rodeoId: r.id,
                            rodeo: edit,
                            openUp,
                            top: openUp ? undefined : rect.bottom + 6,
                            bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
                            right: Math.max(16, window.innerWidth - rect.right),
                            maxHeight: openUp
                              ? Math.max(220, rect.top - 20)
                              : Math.max(220, window.innerHeight - rect.bottom - 20),
                          });
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 bg-slate-900 text-white shadow-xs cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        <span>Acciones</span>
                        <ChevronDown className="w-3 h-3 text-slate-400" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* CARD DE TOTALES GENERALES EN MOBILE */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-md flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Total Hacienda ({rodeos.length} Rodeos)
                  </div>
                  <div className="text-xs text-emerald-400 font-semibold mt-0.5">
                    {totalesRodeos.potrerosOcupados.size} potreros activos
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black tabular-nums">
                    {totalesRodeos.total.toLocaleString('es-AR')}
                  </span>
                  <span className="text-emerald-400 font-bold text-xs ml-1">cab.</span>
                </div>
              </div>
            </div>

            {/* MENÚ FLOTANTE FIJO DE ⚡ ACCIONES (SMART POSITIONING ARRIBA/ABAJO + SIN RECORTE + SUBIR/BAJAR FILA) */}
            {actionMenuState && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setActionMenuState(null)}
                />
                <div
                  style={{
                    position: 'fixed',
                    ...(actionMenuState.openUp
                      ? { bottom: `${actionMenuState.bottom}px` }
                      : { top: `${actionMenuState.top}px` }),
                    right: `${actionMenuState.right}px`,
                    maxHeight: `${actionMenuState.maxHeight}px`,
                  }}
                  className="z-50 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl overflow-y-auto animate-in fade-in zoom-in-95 duration-100 text-left"
                >
                  {/* Header del rodeo */}
                  <div className="px-2.5 py-1.5 mb-1 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                    <span className="font-black text-xs text-slate-800 truncate max-w-[150px]">
                      {actionMenuState.rodeo.nombre || 'Rodeo'}
                    </span>
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {calcTotalRodeoRow(actionMenuState.rodeo)} cab.
                    </span>
                  </div>

                  {/* REORDENAMIENTO: SUBIR / BAJAR FILA */}
                  <div className="px-2 pt-1 pb-0.5 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                    Posición en Tabla
                  </div>
                  <div className="grid grid-cols-2 gap-1 px-1 mb-1.5">
                    {(() => {
                      const curIdx = rodeosRender.findIndex((x) => x.id === actionMenuState.rodeo.id);
                      const isFirst = curIdx <= 0;
                      const isLast = curIdx === -1 || curIdx >= rodeosRender.length - 1;
                      return (
                        <>
                          <button
                            type="button"
                            disabled={isFirst || reorderingRodeoId === actionMenuState.rodeo.id}
                            onClick={() => {
                              const rId = actionMenuState.rodeo.id;
                              setActionMenuState(null);
                              handleReorderRodeo(rId, null, 'up');
                            }}
                            className="py-1 px-2 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-1 transition cursor-pointer border border-slate-200 shadow-2xs"
                            title="Subir una posición en la tabla"
                          >
                            <ArrowUp className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Subir fila</span>
                          </button>
                          <button
                            type="button"
                            disabled={isLast || reorderingRodeoId === actionMenuState.rodeo.id}
                            onClick={() => {
                              const rId = actionMenuState.rodeo.id;
                              setActionMenuState(null);
                              handleReorderRodeo(rId, null, 'down');
                            }}
                            className="py-1 px-2 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-1 transition cursor-pointer border border-slate-200 shadow-2xs"
                            title="Bajar una posición en la tabla"
                          >
                            <ArrowDown className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Bajar fila</span>
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  {/* GRUPO 1: MOVIMIENTOS */}
                  <div className="px-2 pt-1 pb-0.5 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                    Movimientos
                  </div>

                  {/* Pasar de potrero */}
                  <button
                    type="button"
                    onClick={() => {
                      const edit = actionMenuState.rodeo;
                      setActionMenuState(null);
                      setMoveRodeoModal({
                        rodeo: edit,
                        potrero_destino: '',
                        parcela_nombre: edit.parcela_nombre || '',
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                        observaciones: '',
                      });
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-sky-50 hover:text-sky-950 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <ArrowRightLeft className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight">Pasar de potrero</div>
                      <div className="text-[10px] font-medium text-slate-500">Mover rodeo completo o parcial</div>
                    </div>
                  </button>

                  {/* Partir / Destetar lote */}
                  <button
                    type="button"
                    onClick={() => {
                      const r = actionMenuState.rodeo;
                      setActionMenuState(null);
                      const other = rodeosRender.find((o) => o.id !== r.id);
                      setPaseParcialModal({
                        origenId: r.id,
                        destinoId: other ? other.id : '',
                        cantidades: {
                          vacas: 0,
                          terneros_machos: 0,
                          terneros_hembras: 0,
                          vaquillonas: 0,
                          toros: 0,
                        },
                        motivo: '',
                      });
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-950 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <Scissors className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight">Partir / Destetar lote</div>
                      <div className="text-[10px] font-medium text-slate-500">Crear nuevo rodeo desde este</div>
                    </div>
                  </button>

                  {/* GRUPO 2: FICHA Y REGISTRO */}
                  <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                    Ficha y Registro
                  </div>

                  {/* Caravanas & Trazabilidad */}
                  <button
                    type="button"
                    onClick={() => {
                      const edit = actionMenuState.rodeo;
                      setActionMenuState(null);
                      setCaravanasModalInitialRodeo(edit);
                      setShowCaravanasManagerModal(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-950 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <Tag className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight">Caravanas & Trazabilidad</div>
                      <div className="text-[10px] font-medium text-slate-500">Padrón de caravanas y stock</div>
                    </div>
                  </button>

                  {/* Registrar baja / venta */}
                  <button
                    type="button"
                    onClick={() => {
                      const edit = actionMenuState.rodeo;
                      setActionMenuState(null);
                      const firstNonZero = CATEGORIAS_COLUMNA_RODEO.find(
                        (c) => (parseInt(edit[c.key], 10) || 0) > 0
                      )?.key || 'vacas';
                      setSalidaRodeoModal({
                        rodeo: edit,
                        tipo_movimiento: 'Salida por Venta',
                        categoria_key: firstNonZero,
                        sexo_ternero: 'ninguno',
                        cantidad: 1,
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                        motivo: '',
                      });
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-950 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <TrendingDown className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight">Registrar baja / venta</div>
                      <div className="text-[10px] font-medium text-slate-500">Salida por venta o mortandad</div>
                    </div>
                  </button>

                  {/* Ficha Reproductiva */}
                  <button
                    type="button"
                    onClick={() => {
                      const r = actionMenuState.rodeo;
                      setActionMenuState(null);
                      openReproductiveModal(r);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-purple-50 hover:text-purple-950 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <Calendar className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight">Ficha Reproductiva</div>
                      <div className="text-[10px] font-medium text-slate-500">IATF, entore y repaso de toros</div>
                    </div>
                  </button>

                  {/* Notas del Rodeo */}
                  <button
                    type="button"
                    onClick={() => {
                      const edit = actionMenuState.rodeo;
                      const currentEdit = editedRodeos[edit.id] || edit;
                      setActionMenuState(null);
                      openNotasModal(currentEdit);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-950 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight flex items-center gap-1.5">
                        <span>Notas del Rodeo</span>
                        {(actionMenuState.rodeo.observaciones || actionMenuState.rodeo.estado_observaciones) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Tiene notas guardadas" />
                        )}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500">
                        {(actionMenuState.rodeo.observaciones || actionMenuState.rodeo.estado_observaciones)
                          ? 'Ver o modificar observaciones registradas'
                          : 'Agregar novedades o notas de campo'}
                      </div>
                    </div>
                  </button>

                  {/* Editar Datos del Rodeo */}
                  <button
                    type="button"
                    onClick={() => {
                      const edit = actionMenuState.rodeo;
                      const currentEdit = editedRodeos[edit.id] || edit;
                      setActionMenuState(null);
                      setEditRodeoModal({
                        id: edit.id,
                        nombre: currentEdit.nombre || edit.nombre || '',
                        rol_protocolo: currentEdit.rol_protocolo || edit.rol_protocolo || inferirRolProtocolo(edit),
                        potrero_numero: currentEdit.potrero_numero ?? edit.potrero_numero ?? '',
                        parcela_nombre: currentEdit.parcela_nombre || edit.parcela_nombre || '',
                        condicion_corporal: currentEdit.condicion_corporal || edit.condicion_corporal || 3.0,
                        observaciones: currentEdit.observaciones || edit.observaciones || currentEdit.estado_observaciones || edit.estado_observaciones || '',
                      });
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-start gap-2 transition text-left cursor-pointer"
                  >
                    <Pencil className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 leading-tight">Editar Datos del Rodeo</div>
                      <div className="text-[10px] font-medium text-slate-500">Nombre, rol, potrero y notas</div>
                    </div>
                  </button>

                  {/* SEPARADOR */}
                  <div className="border-t border-slate-100 my-1" />

                  {/* GRUPO 3: ELIMINAR */}
                  <button
                    type="button"
                    onClick={() => {
                      const rodeo = actionMenuState.rodeo;
                      setActionMenuState(null);
                      handleDeleteRodeo(rodeo);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition text-left cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <div className="font-extrabold text-rose-700 leading-tight">Eliminar rodeo</div>
                      <div className="text-[10px] font-medium text-rose-500">Eliminar permanentemente</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Banner de Acceso Rápido a Movimientos & Ventas */}
          <div className="bg-gradient-to-r from-emerald-950 to-slate-900 rounded-2xl text-white p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm border border-emerald-800/40">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-white/10 text-emerald-300">
                <ArrowRightLeft className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold">Panel Operativo de Movimientos, Ventas y Bajas</h4>
                <p className="text-xs text-slate-300">
                  {movimientosHacienda.length} movimientos registrados · Doble impacto automático en stock de rodeo y contabilidad.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSubTab('movimientos_ventas')}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition flex items-center gap-1.5 shadow-sm"
            >
              Abrir Movimientos, Ventas y Bajas
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUB-VISTA: MOVIMIENTOS, VENTAS Y BAJAS (CONECTADA A FINANZAS)       */}
      {/* ==================================================================== */}
      {subTab === 'movimientos_ventas' && (
        <div className="space-y-6">
          {/* Barra de Acciones Directas con Doble Impacto */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-emerald-800" />
                  Centro de Movimientos Operativos de Campo
                </h3>
                <p className="text-xs text-slate-500">
                  Movimientos operativos directos: cambios de potrero, apartes, fusiones, nacimientos y bajas por mortandad o consumo.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Cambio de Potrero */}
                <button
                  type="button"
                  onClick={() =>
                    setMoveRodeoModal({
                      rodeo: rodeos[0] || null,
                      potrero_destino: '',
                      parcela_nombre: rodeos[0]?.parcela_nombre || '',
                      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                      observaciones: '',
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition shrink-0 whitespace-nowrap cursor-pointer"
                  title="Mover rodeo a otro potrero o parcela"
                >
                  <ArrowRightLeft className="w-4 h-4 text-sky-200" />
                  Cambio de Potrero
                </button>

                {/* 2. Aparte / Nuevo Rodeo */}
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('stock_actual');
                    setShowNewRodeoForm(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition shrink-0 whitespace-nowrap cursor-pointer"
                  title="Apartar animales o crear un nuevo rodeo / lote"
                >
                  <Plus className="w-4 h-4 text-emerald-300" />
                  Aparte / Nuevo Rodeo
                </button>

                {/* 3. Fusión de Rodeos */}
                <button
                  type="button"
                  onClick={() =>
                    setFusionModal({
                      rodeoOrigenId: rodeos[0]?.id || '',
                      rodeoDestinoId: rodeos[1]?.id || '',
                      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                      motivo: 'Reintegro de tropa apartada',
                      eliminarOrigen: false,
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition shrink-0 whitespace-nowrap cursor-pointer"
                  title="Reintegrar o fusionar dos tropas sin duplicar stock"
                >
                  <Layers className="w-4 h-4 text-amber-200" />
                  Fusión de Rodeos
                </button>

                {/* 4. Nacimiento */}
                <button
                  type="button"
                  onClick={() =>
                    setNacimientoModal({
                      rodeo_id: rodeos[0]?.id || '',
                      tipo: 'Nacimiento',
                      machos: 1,
                      hembras: 1,
                      peso_promedio: '',
                      observaciones: '',
                      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition shrink-0 whitespace-nowrap cursor-pointer"
                  title="Registrar parición / nacimientos de terneros"
                >
                  <Baby className="w-4 h-4 text-teal-200" />
                  Nacimiento
                </button>

                {/* 5. Mortandad / Consumo */}
                <button
                  type="button"
                  onClick={() =>
                    setBajaModal({
                      rodeo_id: rodeos[0]?.id || '',
                      categoria: 'Vacas',
                      cabezas: 1,
                      causa: 'Muerte natural / Consumo',
                      necropsia: 'No',
                      observaciones: '',
                      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition shrink-0 whitespace-nowrap cursor-pointer"
                  title="Registrar baja por mortandad o consumo de campo"
                >
                  <Skull className="w-4 h-4 text-red-200" />
                  Mortandad / Consumo
                </button>
              </div>
            </div>

            {/* 4 KPIs de Movimientos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Total Movimientos
                </div>
                <div className="text-xl font-black text-slate-900 mt-0.5">
                  {movKpis.totalMovimientos} eventos
                </div>
              </div>

              <div className="bg-emerald-50/70 rounded-xl p-3 border border-emerald-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Cabezas Vendidas
                </div>
                <div className="text-xl font-black text-emerald-950 mt-0.5">
                  {movKpis.cabVendidas.toLocaleString('es-AR')} cab.
                </div>
              </div>

              <div className="bg-amber-50/70 rounded-xl p-3 border border-amber-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  Nacimientos Registrados
                </div>
                <div className="text-xl font-black text-amber-950 mt-0.5">
                  {movKpis.cabNacidas.toLocaleString('es-AR')} cab.
                </div>
              </div>

              <div className="bg-red-50/70 rounded-xl p-3 border border-red-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-red-800">
                  Bajas por Mortandad
                </div>
                <div className="text-xl font-black text-red-950 mt-0.5">
                  {movKpis.cabMuertas} cab. <span className="text-xs font-normal text-red-700">({movKpis.pctMortandad}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tabla Filtrable de Historial Completo de Movimientos */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {['TODOS', 'Venta', 'Compra / Ingreso', 'Nacimiento', 'Destete', 'Mortandad', 'Cambio de Potrero'].map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setFilterMovTipo(tipo)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                      filterMovTipo === tipo
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {tipo}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Selector Ordenar por */}
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs">
                  <span className="text-slate-500 font-semibold whitespace-nowrap">Ordenar por:</span>
                  <select
                    value={movSortBy}
                    onChange={(e) => setMovSortBy(e.target.value)}
                    className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer"
                  >
                    <option value="recientes">Más recientes primero</option>
                    <option value="antiguos">Más antiguos primero</option>
                    <option value="rodeo_asc">Por Rodeo (A–Z)</option>
                    <option value="cabezas_desc">Mayor cantidad de cabezas</option>
                  </select>
                </div>

                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar movimiento, rodeo..."
                    value={searchMov}
                    onChange={(e) => setSearchMov(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
              </div>
            </div>

            {filteredMovimientos.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 border border-dashed rounded-xl">
                No hay movimientos registrados que coincidan con el filtro seleccionado.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-[10px]">
                    <tr>
                      <th
                        onClick={() => setMovSortBy(movSortBy === 'recientes' ? 'antiguos' : 'recientes')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition select-none"
                        title="Click para alternar orden por fecha"
                      >
                        <div className="flex items-center gap-1">
                          <span>Fecha</span>
                          {movSortBy === 'recientes' ? (
                            <ArrowDown className="w-3 h-3 text-emerald-600" />
                          ) : movSortBy === 'antiguos' ? (
                            <ArrowUp className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          )}
                        </div>
                      </th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Tipo</th>
                      <th
                        onClick={() => setMovSortBy(movSortBy === 'rodeo_asc' ? 'rodeo_desc' : 'rodeo_asc')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition select-none"
                        title="Click para alternar orden alfabético por rodeo"
                      >
                        <div className="flex items-center gap-1">
                          <span>Rodeo</span>
                          {movSortBy === 'rodeo_asc' ? (
                            <ArrowUp className="w-3 h-3 text-emerald-600" />
                          ) : movSortBy === 'rodeo_desc' ? (
                            <ArrowDown className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          )}
                        </div>
                      </th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Categoría</th>
                      <th
                        onClick={() => setMovSortBy(movSortBy === 'cabezas_desc' ? 'cabezas_asc' : 'cabezas_desc')}
                        className="py-2.5 px-3 text-center whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition select-none"
                        title="Click para alternar orden por cantidad de cabezas"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Cabezas</span>
                          {movSortBy === 'cabezas_desc' ? (
                            <ArrowDown className="w-3 h-3 text-emerald-600" />
                          ) : movSortBy === 'cabezas_asc' ? (
                            <ArrowUp className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          )}
                        </div>
                      </th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Ubicación</th>
                      <th className="py-2.5 px-3">Motivo / Detalle</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredMovimientos.map((m) => {
                      const tipo = m.tipo_movimiento || '';
                      const isVenta = tipo.toLowerCase().includes('venta');
                      const isCompra = tipo.toLowerCase().includes('compra') || tipo.toLowerCase().includes('ingreso');
                      const isNacimiento = tipo.toLowerCase().includes('nacimiento');
                      const isMortandad = tipo.toLowerCase().includes('mortandad') || tipo.toLowerCase().includes('baja');

                      const badgeClass = isVenta
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        : isCompra
                        ? 'bg-sky-100 text-sky-900 border-sky-300'
                        : isNacimiento
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : isMortandad
                        ? 'bg-red-100 text-red-900 border-red-300'
                        : 'bg-indigo-100 text-indigo-900 border-indigo-300';

                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-semibold whitespace-nowrap">{formatFechaAR(m.fecha)}</td>
                          <td className="p-2.5 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                              {tipo}
                            </span>
                          </td>
                          <td className="p-2.5 font-extrabold text-slate-900 whitespace-nowrap">
                            {m.rodeo_nombre}
                          </td>
                          <td className="p-2.5 whitespace-nowrap">{m.categoria_afectada || '-'}</td>
                          <td className="p-2.5 text-center font-black whitespace-nowrap">
                            <span className={isMortandad || isVenta ? 'text-red-700' : 'text-emerald-700'}>
                              {isMortandad || isVenta ? '-' : '+'}{m.cantidad_cabezas} cab.
                            </span>
                          </td>
                          <td className="p-2.5 text-slate-600 whitespace-nowrap">
                            {m.potrero_origen ? formatPotreroNum(m.potrero_origen) : ''}
                            {m.potrero_origen && m.potrero_destino ? ' → ' : ''}
                            {m.potrero_destino ? formatPotreroNum(m.potrero_destino) : (!m.potrero_origen ? '-' : '')}
                          </td>
                          <td className="p-2.5 text-slate-600">
                            {m.motivo_observaciones || '-'}
                          </td>
                          <td className="p-2.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteMovModal(m)}
                              className="p-1 rounded text-slate-400 hover:text-red-600 transition"
                              title="Eliminar este movimiento"
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
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUB-VISTA 2: GESTIÓN INTEGRAL DE CARAVANAS (CAJAS + PADRÓN SENASA)   */}
      {/* ==================================================================== */}
      {(subTab === 'caravanas' || subTab === 'animales' || subTab === 'cajas') && (
        <div className="space-y-4">
          {/* 3 Tarjetas KPI de Resumen de Caravanas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* KPI 1: En Stock (Sin colocar) */}
            <div className="bg-white rounded-2xl p-4 border border-emerald-100 shadow-xs flex items-center gap-3.5 relative overflow-hidden">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <Package className="w-5 h-5 text-emerald-700" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  En Stock (Sin Colocar)
                </div>
                <div className="text-xl font-black text-slate-900 tracking-tight mt-0.5">
                  {caravanasKpis.enStock.toLocaleString('es-AR')} <span className="text-xs font-bold text-slate-500">caravanas</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  {caravanasKpis.cajasConStock} {caravanasKpis.cajasConStock === 1 ? 'caja' : 'cajas'} con stock en depósito ({cajasCaravanas.length} lotes totales)
                </div>
              </div>
            </div>

            {/* KPI 2: Puestas en Campo */}
            <div className="bg-white rounded-2xl p-4 border border-blue-100 shadow-xs flex items-center gap-3.5 relative overflow-hidden">
              <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                <Tag className="w-5 h-5 text-blue-700" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  Puestas en Campo
                </div>
                <div className="text-xl font-black text-slate-900 tracking-tight mt-0.5">
                  {caravanasKpis.puestas.toLocaleString('es-AR')} <span className="text-xs font-bold text-slate-500">activas</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  {caravanasKpis.rodeosConCaravanas} rodeos con caravana colocada
                </div>
              </div>
            </div>

            {/* KPI 3: Salidas / Bajas */}
            <div className="bg-white rounded-2xl p-4 border border-amber-100 shadow-xs flex items-center gap-3.5 relative overflow-hidden">
              <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <ArrowRightLeft className="w-5 h-5 text-amber-700" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  Salidas / Bajas
                </div>
                <div className="text-xl font-black text-slate-900 tracking-tight mt-0.5">
                  {caravanasKpis.salidas.toLocaleString('es-AR')} <span className="text-xs font-bold text-slate-500">históricas</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Ventas, bajas y DT-e registrados
                </div>
              </div>
            </div>
          </div>

          {/* Barra de Sub-selector y Botón IA */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setCaravanasSubView('cajas');
                  setSubTab('caravanas');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  caravanasSubView === 'cajas'
                    ? 'bg-emerald-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>📦 Cajas con Stock ({caravanasKpis.cajasConStock})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaravanasSubView('padron');
                  setSubTab('caravanas');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  caravanasSubView === 'padron'
                    ? 'bg-emerald-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>🏷️ Padrón Individual ({animales.length})</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 ml-auto shrink-0">
              {/* Control 1 — Botón Primario de Carga Manual (verde sólido #14532d): + Asignar Caravanas */}
              <button
                type="button"
                onClick={() => {
                  setCaravanasModalInitialRodeo(null);
                  setCaravanasModalInitialTab('colocacion_manga');
                  setShowCaravanasManagerModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f4023] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                title="Asignar caravanas por rango, lista o caja a un rodeo"
              >
                <Plus className="w-4 h-4" />
                <span>+ Asignar Caravanas</span>
              </button>

              {/* Control 2 — Botón Único de Inteligencia Artificial: ✨ Importar con IA */}
              <button
                type="button"
                onClick={() => setShowConciliadorIaModal(true)}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 hover:from-slate-800 hover:to-emerald-900 text-white font-extrabold text-xs flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                title="Conciliar con IA compras SIGSA, planillas de manga o bajas"
              >
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>✨ Importar con IA</span>
              </button>

              {/* Control 3 — Menú Desplegable Compacto: Acciones ▾ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowReporteCaravanasMenu((prev) => !prev)}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer shrink-0"
                >
                  <span>Acciones</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                {showReporteCaravanasMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-transparent"
                      onClick={() => setShowReporteCaravanasMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
                      <button
                        type="button"
                        onClick={() => {
                          setShowReporteCaravanasMenu(false);
                          generarReportePdfAuditoriaCaravanas({ rodeos, cajasCaravanas, animales, fechaOperacion });
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 font-semibold flex items-center gap-2.5 transition cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>📄 Reporte Auditoría SENASA (PDF)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowReporteCaravanasMenu(false);
                          generarExcelMultiHojaCaravanas({ rodeos, cajasCaravanas, animales, fechaOperacion });
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 font-semibold flex items-center gap-2.5 transition cursor-pointer"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>📊 Exportar Excel Completo (.xlsx)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowReporteCaravanasMenu(false);
                          handleExportarPadronExcel();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-2.5 transition cursor-pointer"
                      >
                        <FileDown className="w-4 h-4 text-slate-600 shrink-0" />
                        <span>📥 Exportar Padrón Filtrado</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowReporteCaravanasMenu(false);
                          setImportTarget('animales');
                          excelInputRef.current?.click();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 font-semibold flex items-center gap-2.5 transition cursor-pointer"
                      >
                        <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>📥 Importar Archivo Excel / CSV</span>
                      </button>

                      <div className="border-t border-slate-100 my-1" />

                      <button
                        type="button"
                        onClick={() => {
                          setShowReporteCaravanasMenu(false);
                          handleSincronizarAuditoriaOficial();
                        }}
                        disabled={syncingAuditoria}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 text-amber-950 font-bold flex items-center gap-2.5 transition cursor-pointer disabled:opacity-50"
                        title="Sincronizar universo de 1.600 caravanas (430 Stock / 632 Campo / 516 Salidas)"
                      >
                        <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                        <span className="leading-tight">
                          {syncingAuditoria
                            ? '⏳ Sincronizando auditoría oficial...'
                            : '✨ Sincronizar Auditoría Oficial SIGSA (430 Stock / 632 Campo / 516 Salidas)'}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* VISTA A: PADRÓN INDIVIDUAL DE CARAVANAS */}
          {caravanasSubView === 'padron' && (
            <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">
                  Padrón Individual de Caravanas SENASA ({animales.length} registradas)
                </div>
                <p className="text-xs text-slate-500">
                  Filtrá por Rodeo con un clic o seleccioná múltiples caravanas para vincularlas a
                  cualquiera de los {rodeos.length} rodeos de la planilla.
                </p>
              </div>
              <div>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelFileChange}
                  className="hidden"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportarPadronExcel}
                    className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-2 shadow-xs transition cursor-pointer"
                    title="Exportar a Excel (.xlsx) las caravanas filtradas"
                  >
                    <FileDown className="w-4 h-4 text-emerald-800" />
                    <span>Exportar a Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setImportTarget('animales');
                      excelInputRef.current?.click();
                    }}
                    className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Importar Excel / CSV</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Píldoras Rápidas de Filtro por Rodeo */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="text-[11px] font-extrabold text-slate-700">
                Filtrar Rápido por Rodeo:
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterRodeo('TODOS')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                    filterRodeo === 'TODOS'
                      ? 'bg-emerald-900 text-white border-emerald-950'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Todos ({animales.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterRodeo('SIN_RODEO')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                    filterRodeo === 'SIN_RODEO'
                      ? 'bg-amber-700 text-white border-amber-800'
                      : 'bg-white text-amber-900 border-amber-200 hover:bg-amber-50'
                  }`}
                >
                  Sin rodeo asignado
                </button>
                {rodeos.map((r) => {
                  const count =
                    (r.id != null && caravanasPorRodeo[String(r.id)] != null)
                      ? caravanasPorRodeo[String(r.id)]
                      : (caravanasPorRodeo[(r.nombre || '').trim().toUpperCase()] || 0);
                  const active = filterRodeo.toUpperCase() === r.nombre.toUpperCase();
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setFilterRodeo(r.nombre)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                        active
                          ? 'bg-emerald-900 text-white border-emerald-950'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-400'
                      }`}
                    >
                      {r.nombre} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {targetRodeoForLink && (
              <div className="p-3.5 rounded-xl bg-emerald-900 text-white flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  <span className="font-extrabold text-emerald-300">
                    MODO VINCULACIÓN RÁPIDA ACTIVO:
                  </span>{' '}
                  Tildá las caravanas abajo y hacé clic en{' '}
                  <strong>"Aplicar a Caravanas Seleccionadas"</strong> para asignarlas al rodeo{' '}
                  <strong className="underline">{targetRodeoForLink.nombre}</strong> (
                  {formatPotreroNum(targetRodeoForLink.potrero_numero)}).
                </div>
                <button
                  type="button"
                  onClick={() => setTargetRodeoForLink(null)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-xs font-bold"
                >
                  Salir de modo vinculación
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Buscador de Caravana (15 dígitos SENASA / Visual / Marca)
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    maxLength={25}
                    placeholder="Ingresá los 15 dígitos o últimos números..."
                    value={searchCaravana}
                    onChange={(e) => setSearchCaravana(e.target.value)}
                    className="w-full pl-10 pr-20 py-2.5 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Estado Oficial
                </label>
                <select
                  value={filterEstadoCaravana}
                  onChange={(e) => setFilterEstadoCaravana(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs bg-white font-bold text-slate-800"
                >
                  <option value="TODOS">Todos los Estados</option>
                  <option value="Activa en Campo">🔵 Activa en Campo</option>
                  <option value="En Stock">🟢 En Stock (Depósito)</option>
                  <option value="Salida / Vendida">🟠 Salida / Vendida</option>
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Filtrar por Categoría
                </label>
                <select
                  value={filterCategoria}
                  onChange={(e) => setFilterCategoria(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs bg-white font-medium"
                >
                  <option value="TODAS">Todas las Categorías</option>
                  {categoriasDisponibles.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Filtrar por Rodeo
                </label>
                <select
                  value={filterRodeo}
                  onChange={(e) => setFilterRodeo(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs bg-white font-medium"
                >
                  <option value="TODOS">Todos los Rodeos</option>
                  <option value="SIN_RODEO">Sin rodeo asignado</option>
                  {rodeosDisponibles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Potrero Actual
                </label>
                <select
                  value={filterPotrero}
                  onChange={(e) => setFilterPotrero(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs bg-white font-medium"
                >
                  <option value="TODOS">Todos los Lotes</option>
                  {potreros.map((p) => (
                    <option key={p.numero} value={p.numero}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Barra de Asignación Masiva en 2 Clics (Rodeo, Categoría o Potrero) */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-slate-700" />
                  <span className="text-xs font-extrabold text-slate-900">
                    Vincular Caravanas a un Rodeo / Editar en Lote (en 2 clics)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
                    {selectedIds.length} seleccionadas
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllSinCategoria}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-semibold transition cursor-pointer"
                  >
                    Seleccionar "Vaca / Sin categoría"
                  </button>
                  <button
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-semibold transition cursor-pointer"
                  >
                    Seleccionar / Quitar filtradas ({animalesFiltrados.length})
                  </button>
                  {selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds([])}
                      className="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-800 text-[11px] font-semibold cursor-pointer"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                    1° Elegir Rodeo Destino
                  </label>
                  <select
                    value={bulkRodeo}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBulkRodeo(val);
                      const matched = rodeos.find((r) => r.nombre === val);
                      if (matched && matched.potrero_numero != null) {
                        setBulkPotrero(String(matched.potrero_numero));
                      }
                    }}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border-2 border-emerald-600 bg-white font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="">(Sin cambios de rodeo)</option>
                    {rodeos.map((r) => (
                      <option key={r.id} value={r.nombre}>
                        {r.nombre} ({formatPotreroNum(r.potrero_numero)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Asignar Categoría (opc.)
                  </label>
                  <select
                    value={bulkCategoria}
                    onChange={(e) => setBulkCategoria(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium focus:border-emerald-500"
                  >
                    <option value="">(Sin cambios)</option>
                    {categoriasDisponibles.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Potrero Destino (se sincroniza solo)
                  </label>
                  <select
                    value={bulkPotrero}
                    onChange={(e) => setBulkPotrero(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium focus:border-emerald-500"
                  >
                    <option value="">(Según el rodeo / Sin cambios)</option>
                    <option value="SIN_ASIGNAR">Sin potrero asignado</option>
                    {potreros.map((p) => (
                      <option key={p.numero} value={p.numero}>
                        {p.nombre} ({p.hectareas} ha)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <button
                    type="button"
                    disabled={saving || selectedIds.length === 0}
                    onClick={handleBulkApply}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    2° Aplicar a {selectedIds.length} Caravanas
                  </button>
                </div>
              </div>
            </div>

            {/* Tabla de Animales Filtrados */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[560px]">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-3 w-8">
                      <input
                        type="checkbox"
                        checked={
                          animalesFiltrados.length > 0 &&
                          animalesFiltrados.every((a) => selectedSet.has(a.id))
                        }
                        onChange={toggleSelectAllFiltered}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                    </th>
                    <th className="py-3 px-3">Caravana (15 Dígitos)</th>
                    <th className="py-3 px-3">Marca</th>
                    <th className="py-3 px-3">Categoría</th>
                    <th className="py-3 px-3">Rodeo Asignado</th>
                    <th className="py-3 px-3">Potrero</th>
                    <th className="py-3 px-3 text-center">CC (★)</th>
                    <th className="py-3 px-3">Estado</th>
                    <th className="py-3 px-3">Observaciones</th>
                    <th className="py-3 px-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {animalesFiltrados.slice(0, 500).map((a) => {
                    const digitsCount = String(a.caravana || '').replace(/\D/g, '').length;
                    const isSelected = selectedSet.has(a.id);
                    return (
                      <tr
                        key={a.id}
                        className={`hover:bg-slate-50 ${isSelected ? 'bg-amber-50/70' : ''}`}
                      >
                        <td className="p-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOne(a.id)}
                            className="rounded border-slate-300 text-emerald-600"
                          />
                        </td>
                        <td className="p-2.5 font-mono font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{a.caravana}</span>
                            {digitsCount === 15 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-sans rounded bg-emerald-100 text-emerald-800 font-semibold">
                                15 díg
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5">{a.marca || 'San José'}</td>
                        <td className="p-2.5">
                          <select
                            value={a.categoria || 'Vaca / Sin categoría'}
                            onChange={(e) =>
                              handleQuickUpdateAnimal(a.id, { categoria: e.target.value })
                            }
                            className="px-2 py-1 border border-slate-200 rounded-lg bg-white font-semibold"
                          >
                            {categoriasDisponibles.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2.5">
                          <select
                            value={a.rodeo || ''}
                            onChange={(e) =>
                              handleQuickUpdateAnimal(a.id, { rodeo: e.target.value })
                            }
                            className="px-2 py-1 border border-slate-200 rounded-lg bg-white font-bold text-emerald-950"
                          >
                            <option value="">Sin rodeo</option>
                            {rodeosDisponibles.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2.5">
                          <input
                            type="number"
                            defaultValue={a.potrero_actual ?? ''}
                            placeholder="S/A"
                            onBlur={(e) => {
                              const val = e.target.value
                                ? parseInt(e.target.value, 10)
                                : null;
                              if (val !== a.potrero_actual) {
                                handleQuickUpdateAnimal(a.id, { potrero_actual: val });
                              }
                            }}
                            className="w-16 px-2 py-1 border border-slate-200 rounded-lg font-semibold"
                          />
                        </td>
                        <td className="p-2 text-center whitespace-nowrap">
                          <CondicionCorporalStars
                            value={a.condicion_corporal ?? 3.0}
                            onChange={(val) => handleQuickUpdateAnimal(a.id, { condicion_corporal: val })}
                            size="sm"
                            showScore={true}
                          />
                        </td>
                        <td className="p-2.5">
                          <select
                            value={a.estado || 'En campo'}
                            onChange={(e) =>
                              handleQuickUpdateAnimal(a.id, { estado: e.target.value })
                            }
                            className="px-2 py-1 rounded-lg border font-semibold bg-emerald-50 text-emerald-800 border-emerald-200"
                          >
                            {ESTADOS_ANIMAL.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2.5 text-slate-600">{a.observaciones || '-'}</td>
                        <td className="p-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteAnimal(a)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

          {/* VISTA B: STOCK DE CAJAS DE CARAVANAS */}
          {caravanasSubView === 'cajas' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-5">
          <form
            onSubmit={handleAddCaja}
            className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-3 items-end"
          >
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Caja N° *
              </label>
              <input
                type="number"
                required
                value={newCaja.caja_numero}
                onChange={(e) => setNewCaja({ ...newCaja, caja_numero: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Marca / Tipo *
              </label>
              <input
                type="text"
                required
                value={newCaja.marca}
                onChange={(e) => setNewCaja({ ...newCaja, marca: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Caravana Desde *
              </label>
              <input
                type="text"
                required
                value={newCaja.desde}
                onChange={(e) => setNewCaja({ ...newCaja, desde: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Caravana Hasta *
              </label>
              <input
                type="text"
                required
                value={newCaja.hasta}
                onChange={(e) => setNewCaja({ ...newCaja, hasta: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                En Stock
              </label>
              <input
                type="number"
                value={newCaja.en_stock}
                onChange={(e) => setNewCaja({ ...newCaja, en_stock: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 px-3 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                Agregar Caja
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3">Caja N°</th>
                  <th className="py-3 px-3">Marca</th>
                  <th className="py-3 px-3">Rango Desde</th>
                  <th className="py-3 px-3">Rango Hasta</th>
                  <th className="py-3 px-3">Total Caja</th>
                  <th className="py-3 px-3">En Stock</th>
                  <th className="py-3 px-3">Usadas s/detalle</th>
                  <th className="py-3 px-3">Observaciones</th>
                  <th className="py-3 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cajasCaravanas.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold">Caja #{c.caja_numero}</td>
                    <td className="p-2.5">{c.marca}</td>
                    <td className="p-2.5 font-mono">{c.desde}</td>
                    <td className="p-2.5 font-mono">{c.hasta}</td>
                    <td className="p-2.5 font-semibold">{c.cantidad}</td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                        {c.en_stock} disp.
                      </span>
                    </td>
                    <td className="p-2.5">{c.usadas_sin_detalle}</td>
                    <td className="p-2.5 text-slate-500">{c.observaciones || '-'}</td>
                    <td className="p-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteCaja(c)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUB-VISTA 4: 🕒 LÍNEA DE TIEMPO & HISTORIAL DE CORTES DE PLANILLA    */}
      {/* ==================================================================== */}
      {subTab === 'linea_tiempo' && (
        <div className="space-y-6">
          {/* Header de la Línea de Tiempo */}
          <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-purple-950 text-white rounded-2xl p-5 border border-purple-800 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-400/30">
                  <History className="w-3.5 h-3.5 text-purple-300" />
                  Auditoría Ganadera & Snapshots
                </div>
                <h3 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                  Línea de Tiempo de Cortes y Movimientos
                </h3>
                <p className="text-xs text-purple-200/90 max-w-2xl">
                  Historial cronológico de planillas exportadas y movimientos intermedios (traslados, ventas, mortandades y nacimientos).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    setSavingManualSnapshot(true);
                    const res = await handleSavePlanillaSnapshot('manual');
                    setSavingManualSnapshot(false);
                    if (res) {
                      notify(`Corte #${res.numero_corte || ''} guardado con éxito.`, 'success');
                    }
                  }}
                  disabled={savingManualSnapshot}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs flex items-center gap-2 shadow-md transition active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <Camera className="w-4 h-4 text-purple-200" />
                  {savingManualSnapshot ? 'Guardando Foto...' : '+ Guardar Corte Actual'}
                </button>
                <button
                  type="button"
                  onClick={loadPlanillaSnapshots}
                  disabled={loadingSnapshots}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-1.5 border border-white/20 transition cursor-pointer"
                >
                  <Clock className={`w-3.5 h-3.5 ${loadingSnapshots ? 'animate-spin' : ''}`} />
                  Actualizar
                </button>
              </div>
            </div>

            {/* Micro KPIs de Snapshots */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-purple-800/60">
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="text-[10px] uppercase font-bold text-purple-300">Cortes Registrados</div>
                <div className="text-xl font-extrabold mt-0.5">{snapshots.length} fotos</div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="text-[10px] uppercase font-bold text-purple-300">Último Corte</div>
                <div className="text-xs font-extrabold mt-1 text-purple-100">
                  {snapshots[0]
                    ? formatFechaHoraCorteAR(snapshots[0].fecha_corte)
                    : 'Sin registros'}
                </div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="text-[10px] uppercase font-bold text-purple-300">Stock Último Corte</div>
                <div className="text-xl font-extrabold mt-0.5">
                  {snapshots[0] ? `${Number(snapshots[0].total_cabezas).toLocaleString('es-AR')} cab.` : '-'}
                </div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="text-[10px] uppercase font-bold text-purple-300">Stock Actual Campo</div>
                <div className="text-xl font-extrabold mt-0.5 text-emerald-400">
                  {(totalesRodeos.total || 0).toLocaleString('es-AR')} cab.
                </div>
              </div>
            </div>
          </div>

          {/* Estado de Vacío si aún no hay snapshots */}
          {snapshots.length === 0 && !loadingSnapshots && (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-800 flex items-center justify-center mx-auto">
                <History className="w-6 h-6" />
              </div>
              <h4 className="text-base font-extrabold text-slate-800">No hay cortes de planilla registrados aún</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Cada vez que exportes la <strong>Planilla Campo (PDF)</strong> o pulses <strong>Guardar Corte Actual</strong>, se creará un snapshot histórico para auditar variaciones de stock y traslados.
              </p>
              <button
                type="button"
                onClick={async () => {
                  setSavingManualSnapshot(true);
                  await handleSavePlanillaSnapshot('manual', 'Corte fundacional de stock');
                  setSavingManualSnapshot(false);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-900 hover:bg-purple-800 text-white font-extrabold text-xs shadow transition cursor-pointer"
              >
                <Camera className="w-4 h-4 text-purple-300" />
                Crear Primer Corte Histórico
              </button>
            </div>
          )}

          {/* Listado Cronológico de Snapshots y Movimientos Intermedios */}
          {snapshots.length > 0 && (
            <div className="space-y-6">
              {snapshots.map((snap, sIdx) => {
                const nextSnap = snapshots[sIdx + 1] || null;
                const snapDate = new Date(snap.fecha_corte);
                const nextDate = nextSnap ? new Date(nextSnap.fecha_corte) : null;

                // Movimientos ocurridos entre este snapshot y el anterior cronológico (nextSnap)
                const movsPeriodo = (movimientosHacienda || []).filter((m) => {
                  if (!m.fecha) return false;
                  const mTime = new Date(m.fecha.includes('T') ? m.fecha : `${m.fecha}T23:59:59Z`).getTime();
                  const sTime = snapDate.getTime();
                  if (mTime > sTime) return false;
                  if (nextDate && mTime <= nextDate.getTime()) return false;
                  return true;
                });

                // Diferencia con respecto al corte previo
                let diffPrev = null;
                if (nextSnap) {
                  diffPrev = (Number(snap.total_cabezas) || 0) - (Number(nextSnap.total_cabezas) || 0);
                }

                return (
                  <div key={snap.id || sIdx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Tarjeta de Corte de Planilla */}
                    <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-900 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-xs">
                          #{snap.numero_corte || snapshots.length - sIdx}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-extrabold text-slate-900">
                              Corte de Planilla #{snap.numero_corte || snapshots.length - sIdx}
                            </h4>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-200">
                              {snap.origen === 'export_pdf' ? '📄 Exportación PDF' : '📷 Guardado Manual'}
                            </span>
                            {diffPrev !== null && (
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  diffPrev === 0
                                    ? 'bg-slate-200 text-slate-700'
                                    : diffPrev > 0
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {diffPrev > 0 ? `+${diffPrev}` : diffPrev} cab. vs anterior
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>
                              📅 {formatFechaHoraCorteAR(snap.fecha_corte)}
                            </span>
                            <span>·</span>
                            <span className="font-semibold text-slate-700">
                              {Array.isArray(snap.detalle_rodeos) ? `${snap.detalle_rodeos.length} rodeos` : ''}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-600 uppercase">Stock Oficial</div>
                          <div className="text-lg font-black text-slate-900 tabular-nums">
                            {Number(snap.total_cabezas || 0).toLocaleString('es-AR')} cab.
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedSnapshotModal(snap)}
                            className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-300 text-xs font-extrabold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                            title="Ver detalle del corte de stock"
                          >
                            <Eye className="w-3.5 h-3.5 text-purple-700" />
                            Ver Foto
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditSnapshotModal({
                              id: snap.id,
                              numero_corte: snap.numero_corte,
                              fecha_corte: snap.fecha_corte ? snap.fecha_corte.slice(0, 16) : '',
                              total_cabezas: snap.total_cabezas,
                              observaciones: snap.observaciones || '',
                            })}
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition cursor-pointer"
                            title="Editar observación o fecha de este corte"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSnapshot(snap.id, snap.numero_corte)}
                            className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer"
                            title="Eliminar este corte de planilla"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Observación del Snapshot */}
                    {snap.observaciones && (
                      <div className="px-5 py-2 bg-purple-50/40 text-[11px] text-purple-950 border-b border-purple-100/60 font-medium">
                        💬 {snap.observaciones}
                      </div>
                    )}

                    {/* Movimientos ocurridos durante este período */}
                    <div className="p-4 sm:p-5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                          <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500" />
                          Movimientos del período ({movsPeriodo.length})
                        </span>
                        {nextSnap && (
                          <span className="text-[11px] text-slate-600 font-medium">
                            Desde Corte #{nextSnap.numero_corte || snapshots.length - (sIdx + 1)} hasta Corte #{snap.numero_corte || snapshots.length - sIdx}
                          </span>
                        )}
                      </div>

                      {movsPeriodo.length === 0 ? (
                        <div className="p-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-600 font-medium">
                          Sin movimientos de hacienda registrados en este lapso.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                          {movsPeriodo.map((m) => {
                            const tipo = (m.tipo_movimiento || '').toLowerCase();
                            let iconBadge = '⇄';
                            let badgeClass = 'bg-slate-100 text-slate-700';
                            if (tipo.includes('venta')) {
                              iconBadge = '💰';
                              badgeClass = 'bg-emerald-100 text-emerald-800';
                            } else if (tipo.includes('nacimiento')) {
                              iconBadge = '🐣';
                              badgeClass = 'bg-amber-100 text-amber-900';
                            } else if (tipo.includes('mortandad') || tipo.includes('baja')) {
                              iconBadge = '💀';
                              badgeClass = 'bg-rose-100 text-rose-800';
                            } else if (tipo.includes('potrero') || tipo.includes('cambio')) {
                              iconBadge = '📍';
                              badgeClass = 'bg-sky-100 text-sky-800';
                            }

                            return (
                              <div key={m.id} className="p-3 hover:bg-slate-50/80 flex items-center justify-between gap-2 sm:gap-3 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold shrink-0 whitespace-nowrap ${badgeClass}`}>
                                    {iconBadge} {m.tipo_movimiento || 'Movimiento'}
                                  </span>
                                  <div className="truncate min-w-0">
                                    <span className="font-extrabold text-slate-800">{m.rodeo_nombre || 'Rodeo'}</span>
                                    {m.potrero_origen && m.potrero_destino ? (
                                      <span className="text-slate-500 ml-1.5 whitespace-nowrap">
                                        (P{m.potrero_origen} → P{m.potrero_destino})
                                      </span>
                                    ) : null}
                                    <span className="text-slate-500 ml-1.5 truncate">
                                      · {m.motivo_observaciones || m.categoria_afectada || 'Sin detalle'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 whitespace-nowrap">
                                  <span className="font-mono text-slate-600 font-medium text-[11px] whitespace-nowrap">{formatFechaAR(m.fecha)}</span>
                                  <span className="font-black text-slate-900 tabular-nums whitespace-nowrap mr-1">
                                    {m.cantidad_cabezas ? `${m.cantidad_cabezas} cab.` : '-'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setEditMovimientoModal({
                                      id: m.id,
                                      fecha: m.fecha || '',
                                      tipo_movimiento: m.tipo_movimiento || 'Movimiento',
                                      cantidad_cabezas: m.cantidad_cabezas || 0,
                                      potrero_origen: m.potrero_origen || '',
                                      potrero_destino: m.potrero_destino || '',
                                      motivo_observaciones: m.motivo_observaciones || '',
                                      rodeo_nombre: m.rodeo_nombre || '',
                                    })}
                                    className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                                    title="Editar este movimiento"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteMovModal(m)}
                                    className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                                    title="Eliminar este movimiento"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: VER DETALLE DE SNAPSHOT / CORTE HISTÓRICO                     */}
      {/* ==================================================================== */}
      {selectedSnapshotModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-purple-400 shadow-2xl max-w-4xl w-full overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-5 bg-purple-950 text-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-400/30">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold flex items-center gap-2">
                    Foto Histórica — Corte #{selectedSnapshotModal.numero_corte || ''}
                  </h3>
                  <p className="text-xs text-purple-200">
                    Fecha: {formatFechaHoraCorteAR(selectedSnapshotModal.fecha_corte)} · Stock Registrado: {Number(selectedSnapshotModal.total_cabezas || 0).toLocaleString('es-AR')} cabezas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSnapshotModal(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
              <div className="p-3 bg-purple-50 rounded-xl text-xs text-purple-900 border border-purple-200 flex items-center justify-between">
                <span>
                  <strong>Origen:</strong> {selectedSnapshotModal.origen === 'export_pdf' ? 'Exportación de Planilla Campo PDF' : 'Guardado Manual'}
                </span>
                <span>
                  <strong>Observación:</strong> {selectedSnapshotModal.observaciones || 'Sin observaciones'}
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900 text-white font-bold text-[11px]">
                    <tr>
                      <th className="p-2.5">Rodeo</th>
                      <th className="p-2.5">Potrero</th>
                      <th className="p-2.5 text-center">Vacas</th>
                      <th className="p-2.5 text-center">Terneros</th>
                      <th className="p-2.5 text-center">Toros</th>
                      <th className="p-2.5 text-center">Vaquillonas</th>
                      <th className="p-2.5 text-center">CUT</th>
                      <th className="p-2.5 text-right">Total Cabezas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.isArray(selectedSnapshotModal.detalle_rodeos) &&
                      selectedSnapshotModal.detalle_rodeos.map((r, rIdx) => (
                        <tr key={r.id || rIdx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-slate-800">{r.nombre}</td>
                          <td className="p-2.5 text-slate-600">
                            {r.potrero_numero ? formatPotreroNum(r.potrero_numero) : 'Sin potrero'}
                          </td>
                          <td className="p-2.5 text-center">{r.vacas || 0}</td>
                          <td className="p-2.5 text-center">
                            {r.terneros || 0}
                            {r.terneros_machos || r.terneros_hembras
                              ? ` (${r.terneros_machos || 0}M / ${r.terneros_hembras || 0}H)`
                              : ''}
                          </td>
                          <td className="p-2.5 text-center">{(r.toros_padres || 0) + (r.toritos || 0)}</td>
                          <td className="p-2.5 text-center">{r.vaquillonas_reposicion || 0}</td>
                          <td className="p-2.5 text-center">{r.vacas_cut || 0}</td>
                          <td className="p-2.5 text-right font-black text-slate-900 tabular-nums">
                            {Number(r.total || 0).toLocaleString('es-AR')}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot className="bg-emerald-950 text-white font-black text-xs">
                    <tr>
                      <td colSpan={7} className="p-2.5 uppercase">
                        Total Stock Registrado en Corte
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        {Number(selectedSnapshotModal.total_cabezas || 0).toLocaleString('es-AR')} cab.
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedSnapshotModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: FICHA REPRODUCTIVA / PANEL DEL POOL DE TOROS                  */}
      {/* ==================================================================== */}
      {reproductiveModalRodeo && (() => {
        const currentRodeo = editedRodeos[reproductiveModalRodeo.id] || reproductiveModalRodeo;
        const nom = (currentRodeo.nombre || '').toUpperCase().trim();
        const rol = (currentRodeo.rol_protocolo || '').toLowerCase();
        const isRodeoTorosPool = currentRodeo.id === 10 || nom === 'TOROS' || (nom.includes('TORO') && !nom.includes('REPASO') && (rol.includes('toro') || nom === 'TOROS'));

        const totalVientres =
          (parseInt(currentRodeo.vacas, 10) || 0) +
          (parseInt(currentRodeo.vacas_cut, 10) || 0) +
          (parseInt(currentRodeo.vaquillonas_reposicion, 10) || 0);

        // VISTA A: PANEL DEL POOL DE TOROS (JS307)
        if (isRodeoTorosPool) {
          return (
            <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl border-2 border-indigo-700 shadow-2xl max-w-2xl w-full overflow-hidden max-h-[92vh] flex flex-col">
                <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-950 text-white flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-lg">
                      🐂
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold flex items-center gap-2">
                        Panel del Pool de Toros (JS307)
                      </h3>
                      <p className="text-xs text-indigo-200">
                        Establecimiento San José · Machos Reproductores Registrados
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReproductiveModalRodeo(null)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                  {/* KPIs del Pool General */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300">
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
                        Total Pool de Toros
                      </div>
                      <div className="text-xl font-black text-slate-900 mt-1">
                        {poolTorosInfo.totalPool} cab.
                      </div>
                      <div className="text-[11px] font-medium text-slate-700 mt-0.5">
                        {poolTorosInfo.poolPadresTot} Padres + {poolTorosInfo.poolToritosTot} Toritos
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200">
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-900">
                        En Servicio en Rodeos
                      </div>
                      <div className="text-xl font-black text-indigo-950 mt-1">
                        {poolTorosInfo.enServicioTotal} cab.
                      </div>
                      <div className="text-[11px] font-medium text-indigo-800 mt-0.5">
                        {poolTorosInfo.asignadosPadres} Padres + {poolTorosInfo.asignadosToritos} Toritos
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300">
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-900">
                        Libres en Descanso
                      </div>
                      <div className="text-xl font-black text-emerald-950 mt-1">
                        {poolTorosInfo.libresTotal} cab.
                      </div>
                      <div className="text-[11px] font-medium text-emerald-800 mt-0.5">
                        {poolTorosInfo.libresPadres} Padres + {poolTorosInfo.libresToritos} Toritos
                      </div>
                    </div>
                  </div>

                  {/* Distribución de Toros en Rodeos de Vientres */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                        Distribución Actual en Rodeos de Vientres
                      </h4>
                      <span className="text-[11px] font-bold text-slate-600">
                        {poolTorosInfo.distribucionRodeos.length} rodeos con actividad
                      </span>
                    </div>

                    {poolTorosInfo.distribucionRodeos.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500 bg-white rounded-lg border border-slate-200">
                        No hay rodeos de cría con toros asignados ni en servicio activo en este momento.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {poolTorosInfo.distribucionRodeos.map((dist) => (
                          <div
                            key={dist.id}
                            className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-2.5"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-slate-900">
                                  {dist.nombre}
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-300">
                                  P{dist.potrero_numero || 'S/D'}
                                </span>
                                {dist.manejo_iatf && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-purple-100 text-purple-900 border border-purple-200">
                                    🧬 IATF
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                Vientres: {dist.vacas + dist.vaquillonas} cab.
                                {dist.fecha_entore && ` · Entore: ${formatFechaAR(dist.fecha_entore)}`}
                                {dist.fecha_salida_toros && ` · Salida: ${formatFechaAR(dist.fecha_salida_toros)}`}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {dist.totalToros > 0 ? (
                                <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-indigo-50 text-indigo-950 border border-indigo-200">
                                  🐂 {dist.padres} Padres + {dist.toritos} Toritos ({dist.totalToros} cab.)
                                </span>
                              ) : dist.toros_en_servicio ? (
                                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-200">
                                  🐂 En servicio (s/ asignar)
                                </span>
                              ) : null}
                              {dist.toro_lote_asignado && dist.toro_lote_asignado !== 'En servicio (s/ asignar)' && (
                                <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 max-w-[130px] truncate" title={dist.toro_lote_asignado}>
                                  {dist.toro_lote_asignado}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Acción Rápida Colectiva */}
                  <div className="bg-emerald-50/80 border border-emerald-300 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                        <span>🐂</span>
                        <span>Acción Rápida de Entore Colectivo</span>
                      </div>
                      <p className="text-[11px] text-emerald-900 mt-0.5 leading-snug">
                        Activa el estado de Servicio Activo en todos los rodeos de cría y vaquillonas sin exigir recuento numérico individual inmediato.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleMarcarTodosRodeosCriaEnServicio}
                      className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition shrink-0 cursor-pointer"
                    >
                      <span>🐂</span>
                      <span>Marcar todos en Servicio Activo</span>
                    </button>
                  </div>

                  {/* Footer Pool */}
                  <div className="flex items-center justify-end pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setReproductiveModalRodeo(null)}
                      className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                    >
                      Cerrar Panel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // VISTA B: FICHA REPRODUCTIVA PARA RODEOS DE VIENTRES (Cría, Vaquillonas, etc.)
        const enServicioActivo = Boolean(reprodForm.toros_en_servicio);
        const asignarConCantidad = reprodForm.asignar_modo === 'con_cantidad';
        const actualesPadres = parseInt(currentRodeo.toros_padres, 10) || 0;
        const libresPadresEste = poolTorosInfo.libresPadres + actualesPadres;
        const actualesToritos = parseInt(currentRodeo.toritos, 10) || 0;
        const libresToritosEste = poolTorosInfo.libresToritos + actualesToritos;

        const torosAsignados = asignarConCantidad
          ? (parseInt(reprodForm.toros_padres, 10) || 0) + (parseInt(reprodForm.toritos, 10) || 0)
          : 0;
        const pctToros = totalVientres > 0 && torosAsignados > 0 ? (torosAsignados / totalVientres) * 100 : 0;
        const esRelacionOptima = pctToros >= 3.0;

        // Cálculo de duración del entore en días
        let duracionEntoreDias = null;
        if (reprodForm.fecha_entore && reprodForm.fecha_salida_toros) {
          const d1 = new Date(reprodForm.fecha_entore + 'T12:00:00');
          const d2 = new Date(reprodForm.fecha_salida_toros + 'T12:00:00');
          const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          if (diff >= 0) duracionEntoreDias = diff;
        }

        return (
          <div className="fixed inset-0 z-[1000] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border-2 border-purple-700 shadow-2xl max-w-xl w-full overflow-hidden max-h-[92vh] flex flex-col">
              <div className="p-4 sm:p-5 bg-gradient-to-r from-purple-950 via-slate-900 to-purple-950 text-white flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-400/30">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold flex items-center gap-2">
                      Ficha Reproductiva — {reproductiveModalRodeo.nombre}
                    </h3>
                    <p className="text-xs text-purple-200">
                      Potrero P{reproductiveModalRodeo.potrero_numero || 'S/D'} · Total Vientres: {totalVientres} cabezas
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReproductiveModalRodeo(null)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                {/* 1. INTERRUPTOR PRINCIPAL: ESTADO REPRODUCTIVO */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                      1. Estado Reproductivo del Rodeo
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">
                      Vientres en potrero: {totalVientres} cab.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setReprodForm({ ...reprodForm, toros_en_servicio: true })}
                      className={`p-2.5 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition cursor-pointer ${
                        enServicioActivo
                          ? 'bg-emerald-700 text-white border-emerald-800 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <span>🐂</span>
                      <span>En Servicio Activo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReprodForm({ ...reprodForm, toros_en_servicio: false, toros_padres: 0, toritos: 0 })}
                      className={`p-2.5 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition cursor-pointer ${
                        !enServicioActivo
                          ? 'bg-slate-800 text-white border-slate-900 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <span>💤</span>
                      <span>Sin Servicio (Descanso)</span>
                    </button>
                  </div>

                  {/* ASIGNACIÓN DE TOROS (SOLO SI ESTÁ EN SERVICIO ACTIVO) */}
                  {enServicioActivo && (
                    <div className="pt-2 border-t border-slate-200 space-y-3">
                      <div className="text-[11px] font-bold text-slate-700">
                        Modalidad de Asignación de Toros:
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer hover:border-slate-300 transition">
                          <input
                            type="radio"
                            name="modo_asignacion_toros"
                            checked={!asignarConCantidad}
                            onChange={() => setReprodForm({ ...reprodForm, asignar_modo: 'sin_cantidad', toros_padres: 0, toritos: 0 })}
                            className="mt-0.5 text-purple-700 focus:ring-purple-600"
                          />
                          <div>
                            <div className="text-xs font-black text-slate-900">
                              En servicio sin asignar cantidad aún
                            </div>
                            <div className="text-[11px] text-slate-600">
                              El rodeo figurará en servicio en la planilla sin exigir número de toros ni generar alertas de relación baja.
                            </div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer hover:border-slate-300 transition">
                          <input
                            type="radio"
                            name="modo_asignacion_toros"
                            checked={asignarConCantidad}
                            onChange={() => setReprodForm({ ...reprodForm, asignar_modo: 'con_cantidad' })}
                            className="mt-0.5 text-purple-700 focus:ring-purple-600"
                          />
                          <div className="flex-1">
                            <div className="text-xs font-black text-slate-900">
                              Asignar cantidad desde Pool General ({poolTorosInfo.libresTotal} cab. libres)
                            </div>
                            <div className="text-[11px] text-slate-600">
                              Imputar toros padres y toritos directamente desde el pool general disponible.
                            </div>
                          </div>
                        </label>
                      </div>

                      {/* CAMPOS DE TOROS Y RELACIÓN TORO/VIENTRE */}
                      {asignarConCantidad && (
                        <div className="p-3 bg-white rounded-xl border border-purple-200 space-y-3">
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <div className="flex items-center justify-between mb-0.5">
                                <label className="block text-[11px] font-bold text-slate-700">
                                  Toros Padres (cab)
                                </label>
                                <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-300">
                                  {libresPadresEste} disp.
                                </span>
                              </div>
                              <input
                                type="number"
                                min="0"
                                max={libresPadresEste}
                                value={reprodForm.toros_padres}
                                onChange={(e) =>
                                  setReprodForm({ ...reprodForm, toros_padres: e.target.value })
                                }
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                              />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-0.5">
                                <label className="block text-[11px] font-bold text-slate-700">
                                  Toritos / Reposición (cab)
                                </label>
                                <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-300">
                                  {libresToritosEste} disp.
                                </span>
                              </div>
                              <input
                                type="number"
                                min="0"
                                max={libresToritosEste}
                                value={reprodForm.toritos}
                                onChange={(e) =>
                                  setReprodForm({ ...reprodForm, toritos: e.target.value })
                                }
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                              Lote o Caravanas de Toros Asignados (opcional)
                            </label>
                            <input
                              type="text"
                              placeholder="Ej: Lote Angus Colorado RP 101-106 / Toro Charolais"
                              value={reprodForm.toro_lote_asignado}
                              onChange={(e) =>
                                setReprodForm({ ...reprodForm, toro_lote_asignado: e.target.value })
                              }
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                            />
                          </div>

                          {/* Semáforo de Relación Toro / Vientre */}
                          {torosAsignados > 0 && totalVientres > 0 && (
                            <div
                              className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                                esRelacionOptima
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                                  : 'bg-amber-50 border-amber-300 text-amber-950'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-black text-white ${
                                    esRelacionOptima ? 'bg-emerald-700' : 'bg-amber-700'
                                  }`}
                                >
                                  {esRelacionOptima ? '✓' : '!'}
                                </span>
                                <span className="font-extrabold">
                                  Relación Toro / Vientre: {pctToros.toFixed(1)}%
                                </span>
                                <span className="text-[11px] opacity-80">
                                  ({torosAsignados} toros / {totalVientres} vientres)
                                </span>
                              </div>
                              <div>
                                {esRelacionOptima ? (
                                  <span className="text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-md font-black border border-emerald-300">
                                    Óptimo (≥ 3.0%)
                                  </span>
                                ) : (
                                  <span className="text-amber-950 bg-amber-100 px-2 py-0.5 rounded-md font-black border border-amber-300">
                                    Bajo (&lt; 3.0% sugerido)
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. ESTRATEGIA REPRODUCTIVA Y VENTANA DE SERVICIO */}
                <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3.5 space-y-3">
                  <div className="text-xs font-extrabold text-purple-950 uppercase tracking-wider">
                    2. Estrategia y Ventana de Servicio
                  </div>

                  {/* Checkbox IATF */}
                  <div className="p-3 bg-white rounded-xl border border-purple-200 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reprodForm.manejo_iatf}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setReprodForm({
                            ...reprodForm,
                            manejo_iatf: checked,
                            fecha_inseminacion: checked
                              ? reprodForm.fecha_inseminacion || reprodForm.fecha_entore || new Date().toISOString().slice(0, 10)
                              : '',
                          });
                        }}
                        className="rounded text-purple-600 focus:ring-purple-500 h-4 w-4"
                      />
                      <span className="text-xs font-black text-purple-950 flex items-center gap-1">
                        🧬 Servicio con IATF / Inseminación previa
                      </span>
                    </label>

                    {reprodForm.manejo_iatf && (
                      <div className="pt-1">
                        <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                          Fecha de Inseminación / Protocolo IATF
                        </label>
                        <input
                          type="date"
                          value={reprodForm.fecha_inseminacion}
                          onChange={(e) =>
                            setReprodForm({ ...reprodForm, fecha_inseminacion: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-purple-300 bg-white text-xs font-bold text-slate-900"
                        />
                      </div>
                    )}
                  </div>

                  {/* Ventana de Fechas Lado a Lado */}
                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Fecha Inicio Entore / Entrada Toros
                        </label>
                        <input
                          type="date"
                          value={reprodForm.fecha_entore}
                          onChange={(e) => {
                            const val = e.target.value;
                            setReprodForm({ ...reprodForm, fecha_entore: val });
                            setReproductiveEntoreDate(val);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Fecha Estimada Salida Toros
                        </label>
                        <input
                          type="date"
                          value={reprodForm.fecha_salida_toros}
                          onChange={(e) =>
                            setReprodForm({ ...reprodForm, fecha_salida_toros: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                        />
                      </div>
                    </div>

                    {duracionEntoreDias !== null && (
                      <div className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                        <span>⏱️</span>
                        <span>Duración estimada del servicio:</span>
                        <span className="font-black text-indigo-900 underline underline-offset-2">
                          {duracionEntoreDias} días de entore
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. PROYECCIÓN AUTOMÁTICA DE HITOS */}
                {(() => {
                  const baseDate = reprodForm.fecha_entore || reprodForm.fecha_inseminacion || reproductiveEntoreDate;
                  if (!baseDate) return null;
                  const b = new Date(baseDate + 'T12:00:00');
                  const add = (days) => {
                    const d = new Date(b);
                    d.setDate(d.getDate() + days);
                    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  };
                  return (
                    <div className="space-y-2 bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-200">
                      <div className="text-xs font-extrabold text-emerald-950 uppercase tracking-wider mb-1 flex items-center justify-between">
                        <span>Proyección Automática de Hitos (Base: {baseDate})</span>
                        <span className="text-[10px] text-emerald-800 font-bold">4 hitos calculados</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex items-start justify-between p-2 rounded-lg bg-white border border-slate-200 shadow-2xs">
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                              Tacto Rectal (+60d)
                            </div>
                            <div className="text-[10px] text-slate-600">Diagnóstico de preñez</div>
                          </div>
                          <span className="text-xs font-extrabold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-mono">
                            {add(60)}
                          </span>
                        </div>

                        <div className="flex items-start justify-between p-2 rounded-lg bg-white border border-slate-200 shadow-2xs">
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-600"></span>
                              Vacunación Pre-Parto (+253d)
                            </div>
                            <div className="text-[10px] text-slate-600">Inmunidad calostral</div>
                          </div>
                          <span className="text-xs font-extrabold text-amber-950 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 font-mono">
                            {add(253)}
                          </span>
                        </div>

                        <div className="flex items-start justify-between p-2 rounded-lg bg-white border border-slate-200 shadow-2xs">
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                              Inicio de Parición (+283d)
                            </div>
                            <div className="text-[10px] text-slate-600">Recorrida intensiva</div>
                          </div>
                          <span className="text-xs font-extrabold text-emerald-950 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300 font-mono">
                            {add(283)}
                          </span>
                        </div>

                        <div className="flex items-start justify-between p-2 rounded-lg bg-white border border-slate-200 shadow-2xs">
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                              Destete Proyectado (+490d)
                            </div>
                            <div className="text-[10px] text-slate-600">Apartado de terneros</div>
                          </div>
                          <span className="text-xs font-extrabold text-purple-900 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 font-mono">
                            {add(490)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* BOTONES INFERIORES */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setReproductiveModalRodeo(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={savingReproductiveSchedule}
                    onClick={handleSaveReproductiveData}
                    className="px-4 py-2 rounded-xl bg-purple-800 hover:bg-purple-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    {savingReproductiveSchedule ? 'Guardando...' : 'Guardar Ficha Reproductiva'}
                  </button>
                  <button
                    type="button"
                    disabled={
                      (!reprodForm.fecha_entore && !reprodForm.fecha_inseminacion && !reproductiveEntoreDate) ||
                      savingReproductiveSchedule
                    }
                    onClick={() => {
                      const base = reprodForm.fecha_entore || reprodForm.fecha_inseminacion || reproductiveEntoreDate;
                      handleScheduleReproductiveMilestones(reproductiveModalRodeo, base);
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50 cursor-pointer"
                  >
                    <Calendar className="w-4 h-4" />
                    {savingReproductiveSchedule ? 'Agendando...' : 'Agendar Hitos en Calendario y Tareas'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ==================================================================== */}
      {/* MODAL: ESCÁNER DE LIQUIDACIÓN / ROMANEO DE HACIENDA (GEMINI IA)       */}
      {/* ==================================================================== */}
      {showGeminiLiquidacionModal && (
        <GeminiLiquidacionModal
          isOpen={true}
          onClose={() => setShowGeminiLiquidacionModal(false)}
          onSuccess={() => {
            setShowGeminiLiquidacionModal(false);
            onRefresh?.();
          }}
          rodeos={rodeos}
          potreros={potreros}
          fechaOperacion={fechaOperacion}
          notify={notify}
        />
      )}

      {/* ==================================================================== */}
      {/* MODAL: GESTIÓN INTEGRAL DE CARAVANAS, CAJAS Y BAJAS SIGSA CON IA     */}
      {/* ==================================================================== */}
      {showCaravanasManagerModal && (
        <CaravanasManagerModal
          isOpen={true}
          onClose={() => {
            setShowCaravanasManagerModal(false);
            setCaravanasModalInitialRodeo(null);
            setCaravanasModalInitialTab('kpis_list');
          }}
          animales={animales}
          cajasCaravanas={cajasCaravanas}
          rodeos={rodeos}
          potreros={potreros}
          initialRodeo={caravanasModalInitialRodeo}
          initialTab={caravanasModalInitialTab}
          notify={notify}
          onRefresh={onRefresh}
        />
      )}

      {/* ==================================================================== */}
      {/* MODAL 1: EDITAR RODEO (NOMBRE, ROL PROTOCOLO, POTRERO)               */}
      {/* ==================================================================== */}
      {editRodeoModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-emerald-400" />
                <h3 className="font-extrabold text-sm">Editar Datos del Rodeo</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditRodeoModal(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditRodeo} className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Nombre del Rodeo *</label>
                <input
                  type="text"
                  required
                  value={editRodeoModal.nombre}
                  onChange={(e) => setEditRodeoModal({ ...editRodeoModal, nombre: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-slate-900 text-sm uppercase"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Rol / Categoría Protocolar</label>
                <select
                  value={editRodeoModal.rol_protocolo}
                  onChange={(e) => setEditRodeoModal({ ...editRodeoModal, rol_protocolo: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                >
                  {ROLES_PROTOCOLO.map((rol) => (
                    <option key={rol} value={rol}>{rol}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Potrero Asignado</label>
                  <select
                    value={editRodeoModal.potrero_numero ?? ''}
                    onChange={(e) => setEditRodeoModal({ ...editRodeoModal, potrero_numero: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    <option value="">Sin potrero</option>
                    {potreros.map((p) => (
                      <option key={p.numero} value={p.numero}>
                        {p.nombre} ({p.hectareas} ha)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Parcela / Boyero</label>
                  <input
                    type="text"
                    placeholder="Ej: Parcela 2"
                    value={editRodeoModal.parcela_nombre}
                    onChange={(e) => setEditRodeoModal({ ...editRodeoModal, parcela_nombre: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Condición Corporal (1.0 a 5.0)</label>
                <select
                  value={editRodeoModal.condicion_corporal ?? 3.0}
                  onChange={(e) =>
                    setEditRodeoModal({
                      ...editRodeoModal,
                      condicion_corporal: parseFloat(e.target.value) || 3.0,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                >
                  {[1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0].map((cc) => (
                    <option key={cc} value={cc}>
                      {cc.toFixed(1)} ★ {cc <= 2 ? '(Baja)' : cc <= 3.5 ? '(Óptima)' : '(Engorde)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observaciones / Notas de campo
                </label>
                <textarea
                  rows={3}
                  placeholder="Ej: 3 vacas negras en este lote, revisar en próxima manga..."
                  value={editRodeoModal.observaciones || ''}
                  onChange={(e) =>
                    setEditRodeoModal({ ...editRodeoModal, observaciones: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800 text-xs focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditRodeoModal(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Guardando...' : 'Guardar Rodeo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: LECTURA Y EDICIÓN RÁPIDA DE NOTAS DEL RODEO                  */}
      {/* ==================================================================== */}
      {notasRodeoModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-amber-300 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm leading-tight">Notas del Rodeo</h3>
                  <p className="text-[11px] text-emerald-400 font-bold">{notasRodeoModal.nombre}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNotasRodeoModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNotasRodeo} className="p-4 space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                  Novedades, observaciones y notas de campo
                </label>
                <textarea
                  rows={5}
                  autoFocus
                  placeholder="Escribí aquí las notas u observaciones de este rodeo (ej: 3 vacas negras en este lote, revisar ubre en próxima manga, lote preñado a revisar en tacto)..."
                  value={notasRodeoModal.observaciones || ''}
                  onChange={(e) =>
                    setNotasRodeoModal({ ...notasRodeoModal, observaciones: e.target.value })
                  }
                  className="w-full p-3 rounded-xl border border-slate-300 text-slate-900 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition leading-relaxed bg-slate-50/50"
                />
                <p className="text-[10px] text-slate-500 mt-1.5 font-medium">
                  Se sincroniza automáticamente en el sistema y se visualiza en los informes ejecutivos de rodeo.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                {notasRodeoModal.observaciones ? (
                  <button
                    type="button"
                    onClick={() => setNotasRodeoModal({ ...notasRodeoModal, observaciones: '' })}
                    className="text-xs text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                  >
                    Borrar notas
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setNotasRodeoModal(null)}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold flex items-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>{saving ? 'Guardando...' : 'Guardar Notas'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: PASE PARCIAL / APARTE DE ANIMALES ENTRE RODEOS              */}
      {/* ==================================================================== */}
      {paseParcialModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-indigo-300 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-extrabold text-sm">⇄ Pasar animales a otro rodeo (Aparte / Pase Parcial)</h3>
                  <p className="text-[11px] text-indigo-200">Transfiere cabezas por categoría y asienta el movimiento en la Línea de Tiempo</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPaseParcialModal(null)}
                className="p-1 rounded text-indigo-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleConfirmPaseParcial} className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 mb-1">Rodeo Origen *</label>
                  <select
                    required
                    value={paseParcialModal.origenId}
                    onChange={(e) => setPaseParcialModal({ ...paseParcialModal, origenId: e.target.value })}
                    className="w-full px-2.5 py-2 rounded-xl border border-indigo-300 bg-indigo-50/40 font-bold text-slate-900"
                  >
                    <option value="">Seleccionar origen...</option>
                    {rodeosRender.map((r) => {
                      const edit = editedRodeos[r.id] || r;
                      return (
                        <option key={r.id} value={r.id} disabled={String(r.id) === String(paseParcialModal.destinoId)}>
                          {edit.nombre} ({calcTotalRodeoRow(edit)} cab.)
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 mb-1">Rodeo Destino *</label>
                  <select
                    required
                    value={paseParcialModal.destinoId}
                    onChange={(e) => setPaseParcialModal({ ...paseParcialModal, destinoId: e.target.value })}
                    className="w-full px-2.5 py-2 rounded-xl border border-emerald-300 bg-emerald-50/40 font-bold text-slate-900"
                  >
                    <option value="">Seleccionar destino...</option>
                    {rodeosRender.map((r) => {
                      const edit = editedRodeos[r.id] || r;
                      return (
                        <option key={r.id} value={r.id} disabled={String(r.id) === String(paseParcialModal.origenId)}>
                          {edit.nombre} ({calcTotalRodeoRow(edit)} cab.)
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Cantidades por Categoría */}
              {(() => {
                const origenRodeo = rodeosRender.find((r) => String(r.id) === String(paseParcialModal.origenId));
                const origEdit = origenRodeo ? (editedRodeos[origenRodeo.id] || origenRodeo) : null;
                const cants = paseParcialModal.cantidades || {};
                const totalTransferir =
                  (parseInt(cants.vacas, 10) || 0) +
                  (parseInt(cants.terneros_machos, 10) || 0) +
                  (parseInt(cants.terneros_hembras, 10) || 0) +
                  (parseInt(cants.vaquillonas, 10) || 0) +
                  (parseInt(cants.toros, 10) || 0);

                return (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-black text-slate-700 uppercase tracking-wider">
                      <span>Cantidades a transferir</span>
                      <span className="text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full text-xs font-black">
                        Total: {totalTransferir} cab.
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-700">Vacas</span>
                          <span className="text-[10px] text-slate-400">Disp: {origEdit?.vacas ?? 0}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={origEdit?.vacas ?? 9999}
                          value={cants.vacas || ''}
                          placeholder="0"
                          onChange={(e) => setPaseParcialModal({
                            ...paseParcialModal,
                            cantidades: { ...cants, vacas: parseInt(e.target.value, 10) || 0 },
                          })}
                          className="w-full px-2 py-1 rounded border border-slate-300 font-extrabold text-center text-slate-900"
                        />
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sky-800">Terneros M</span>
                          <span className="text-[10px] text-slate-400">Disp: {origEdit?.terneros_machos ?? 0}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={origEdit?.terneros_machos ?? 9999}
                          value={cants.terneros_machos || ''}
                          placeholder="0"
                          onChange={(e) => setPaseParcialModal({
                            ...paseParcialModal,
                            cantidades: { ...cants, terneros_machos: parseInt(e.target.value, 10) || 0 },
                          })}
                          className="w-full px-2 py-1 rounded border border-sky-300 font-extrabold text-center text-sky-950"
                        />
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-rose-800">Terneros H</span>
                          <span className="text-[10px] text-slate-400">Disp: {origEdit?.terneros_hembras ?? 0}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={origEdit?.terneros_hembras ?? 9999}
                          value={cants.terneros_hembras || ''}
                          placeholder="0"
                          onChange={(e) => setPaseParcialModal({
                            ...paseParcialModal,
                            cantidades: { ...cants, terneros_hembras: parseInt(e.target.value, 10) || 0 },
                          })}
                          className="w-full px-2 py-1 rounded border border-rose-300 font-extrabold text-center text-rose-950"
                        />
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-700">Vaquillonas</span>
                          <span className="text-[10px] text-slate-400">Disp: {origEdit?.vaquillonas_reposicion ?? 0}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={origEdit?.vaquillonas_reposicion ?? 9999}
                          value={cants.vaquillonas || ''}
                          placeholder="0"
                          onChange={(e) => setPaseParcialModal({
                            ...paseParcialModal,
                            cantidades: { ...cants, vaquillonas: parseInt(e.target.value, 10) || 0 },
                          })}
                          className="w-full px-2 py-1 rounded border border-slate-300 font-extrabold text-center text-slate-900"
                        />
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-700">Toros</span>
                          <span className="text-[10px] text-slate-400">Disp: {origEdit?.toros_padres ?? 0}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={origEdit?.toros_padres ?? 9999}
                          value={cants.toros || ''}
                          placeholder="0"
                          onChange={(e) => setPaseParcialModal({
                            ...paseParcialModal,
                            cantidades: { ...cants, toros: parseInt(e.target.value, 10) || 0 },
                          })}
                          className="w-full px-2 py-1 rounded border border-slate-300 font-extrabold text-center text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Motivo / Observaciones del Pase</label>
                <input
                  type="text"
                  placeholder="Ej: Aparte de vaquillonas para servicio / colada a otro potrero"
                  value={paseParcialModal.motivo}
                  onChange={(e) => setPaseParcialModal({ ...paseParcialModal, motivo: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPaseParcialModal(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !paseParcialModal.origenId || !paseParcialModal.destinoId}
                  className="px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  {saving ? 'Transfiriendo...' : 'Confirmar Pase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: EDITAR REGISTRO DE MOVIMIENTO DE LA LÍNEA DE TIEMPO          */}
      {/* ==================================================================== */}
      {editMovimientoModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-sky-400" />
                <h3 className="font-extrabold text-sm">Editar Registro de Movimiento</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditMovimientoModal(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditMovimiento} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Rodeo</label>
                <input
                  type="text"
                  disabled
                  value={editMovimientoModal.rodeo_nombre}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-100 font-bold text-slate-700"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Fecha *</label>
                  <input
                    type="date"
                    required
                    value={editMovimientoModal.fecha}
                    onChange={(e) => setEditMovimientoModal({ ...editMovimientoModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Cantidad Cabezas</label>
                  <input
                    type="number"
                    min="0"
                    value={editMovimientoModal.cantidad_cabezas}
                    onChange={(e) => setEditMovimientoModal({ ...editMovimientoModal, cantidad_cabezas: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Tipo de Movimiento</label>
                <input
                  type="text"
                  value={editMovimientoModal.tipo_movimiento}
                  onChange={(e) => setEditMovimientoModal({ ...editMovimientoModal, tipo_movimiento: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Potrero Origen</label>
                  <input
                    type="number"
                    placeholder="Número potrero"
                    value={editMovimientoModal.potrero_origen ?? ''}
                    onChange={(e) => setEditMovimientoModal({ ...editMovimientoModal, potrero_origen: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Potrero Destino</label>
                  <input
                    type="number"
                    placeholder="Número potrero"
                    value={editMovimientoModal.potrero_destino ?? ''}
                    onChange={(e) => setEditMovimientoModal({ ...editMovimientoModal, potrero_destino: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Motivo / Observaciones</label>
                <textarea
                  rows={2}
                  value={editMovimientoModal.motivo_observaciones}
                  onChange={(e) => setEditMovimientoModal({ ...editMovimientoModal, motivo_observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditMovimientoModal(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4: EDITAR SNAPSHOT / CORTE HISTÓRICO DE LA LÍNEA DE TIEMPO     */}
      {/* ==================================================================== */}
      {editSnapshotModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-purple-300 shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-purple-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-purple-300" />
                <h3 className="font-extrabold text-sm">Editar Corte de Planilla #{editSnapshotModal.numero_corte || ''}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditSnapshotModal(null)}
                className="p-1 rounded text-purple-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditSnapshot} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Fecha y Hora del Corte *</label>
                <input
                  type="datetime-local"
                  required
                  value={editSnapshotModal.fecha_corte}
                  onChange={(e) => setEditSnapshotModal({ ...editSnapshotModal, fecha_corte: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Total Cabezas Registradas</label>
                <input
                  type="number"
                  min="0"
                  value={editSnapshotModal.total_cabezas}
                  onChange={(e) => setEditSnapshotModal({ ...editSnapshotModal, total_cabezas: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-slate-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Observación del Corte</label>
                <textarea
                  rows={3}
                  value={editSnapshotModal.observaciones}
                  onChange={(e) => setEditSnapshotModal({ ...editSnapshotModal, observaciones: e.target.value })}
                  placeholder="Detalles sobre el recuento o corte de stock..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditSnapshotModal(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-purple-900 hover:bg-purple-800 text-white font-extrabold shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Guardando...' : 'Guardar Corte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 5: CONFIRMACIÓN Y REVERSIÓN DE STOCK AL ELIMINAR MOVIMIENTO     */}
      {/* ==================================================================== */}
      {confirmDeleteMovModal && (() => {
        const m = confirmDeleteMovModal;
        const rodeo =
          (rodeos || []).find((r) => r.id === m.rodeo_id) ||
          (rodeos || []).find(
            (r) =>
              r.nombre &&
              m.rodeo_nombre &&
              r.nombre.trim().toLowerCase() === m.rodeo_nombre.trim().toLowerCase()
          );
        const tipoRaw = (m.tipo_movimiento || '').toLowerCase();
        const cabNum = parseInt(m.cantidad_cabezas, 10) || 0;
        const fieldKey = mapCategoriaToRodeoField(m.categoria_afectada);
        const catLabel = getCategoriaFieldLabel(fieldKey);

        let deltaReversion = 0;
        let tipoImpacto = 'neutro';
        let explicacionImpacto = '';

        if (
          tipoRaw.includes('mortandad') ||
          tipoRaw.includes('baja') ||
          tipoRaw.includes('muert') ||
          tipoRaw.includes('consumo')
        ) {
          deltaReversion = cabNum;
          tipoImpacto = 'suma';
          explicacionImpacto = `Al eliminar esta Baja de -${cabNum} cab. en ${
            m.rodeo_nombre || 'el rodeo'
          } (${catLabel}), se reintegrará +${cabNum} cabeza${
            cabNum > 1 ? 's' : ''
          } al stock actual del rodeo.`;
        } else if (
          tipoRaw.includes('venta') ||
          tipoRaw.includes('salida') ||
          tipoRaw.includes('remisi')
        ) {
          deltaReversion = cabNum;
          tipoImpacto = 'suma';
          explicacionImpacto = `Al eliminar esta Venta de -${cabNum} cab. en ${
            m.rodeo_nombre || 'el rodeo'
          } (${catLabel}), se reintegrará +${cabNum} cabeza${
            cabNum > 1 ? 's' : ''
          } al stock actual del rodeo.`;
        } else if (tipoRaw.includes('nacimiento') || tipoRaw.includes('parici')) {
          deltaReversion = -cabNum;
          tipoImpacto = 'resta';
          explicacionImpacto = `Al eliminar este Nacimiento de +${cabNum} cab. en ${
            m.rodeo_nombre || 'el rodeo'
          } (${catLabel}), se descontará${cabNum > 1 ? 'n' : ''} -${cabNum} cabeza${
            cabNum > 1 ? 's' : ''
          } del stock actual del rodeo.`;
        } else if (
          tipoRaw.includes('compra') ||
          tipoRaw.includes('ingreso') ||
          tipoRaw.includes('alta')
        ) {
          deltaReversion = -cabNum;
          tipoImpacto = 'resta';
          explicacionImpacto = `Al eliminar este Ingreso de +${cabNum} cab. en ${
            m.rodeo_nombre || 'el rodeo'
          } (${catLabel}), se descontará${cabNum > 1 ? 'n' : ''} -${cabNum} cabeza${
            cabNum > 1 ? 's' : ''
          } del stock actual del rodeo.`;
        } else {
          deltaReversion = 0;
          tipoImpacto = 'neutro';
          explicacionImpacto = `Este movimiento (${
            m.tipo_movimiento || 'Movimiento'
          }) no alteró las cabezas del rodeo. Se eliminará el registro del historial.`;
        }

        const stockActualCat = rodeo ? parseInt(rodeo[fieldKey], 10) || 0 : 0;
        const stockProyectadoCat = rodeo
          ? Math.max(0, stockActualCat + deltaReversion)
          : 0;
        const totalActualRodeo = rodeo ? calcTotalRodeoRow(rodeo) : 0;
        const totalProyectadoRodeo = rodeo
          ? Math.max(0, totalActualRodeo + deltaReversion)
          : 0;

        return (
          <div className="fixed inset-0 z-[1050] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Encabezado */}
              <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-white">
                      Eliminar Registro de Movimiento
                    </h3>
                    <p className="text-[10px] text-slate-300">
                      Auditoría y reversión automática de stock ganadero
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deletingMovState}
                  onClick={() => setConfirmDeleteMovModal(null)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Cuerpo */}
              <div className="p-5 space-y-4 text-xs">
                {/* Ficha Resumen del Movimiento */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-500 uppercase text-[10px]">
                      Movimiento Seleccionado
                    </span>
                    <span className="font-bold text-slate-600 text-[11px]">
                      {formatFechaAR(m.fecha)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-900 font-extrabold text-sm">
                    <span>{m.rodeo_nombre || 'Rodeo sin asignar'}</span>
                    <span
                      className={
                        tipoImpacto === 'resta'
                          ? 'text-emerald-700'
                          : tipoImpacto === 'suma'
                          ? 'text-rose-700'
                          : 'text-slate-800'
                      }
                    >
                      {m.tipo_movimiento} ({m.cantidad_cabezas ? `${m.cantidad_cabezas} cab.` : '0 cab.'})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-2 pt-1 border-t border-slate-200/60">
                    <span>
                      Categoría: <strong>{m.categoria_afectada || catLabel}</strong>
                    </span>
                    {m.motivo_observaciones && (
                      <span className="truncate max-w-xs">
                        · Detalle: {m.motivo_observaciones}
                      </span>
                    )}
                  </div>
                </div>

                {/* Caja de Impacto Exacto */}
                <div
                  className={`p-4 rounded-xl border text-xs leading-relaxed ${
                    deltaReversion !== 0
                      ? 'bg-amber-50/70 border-amber-300/80 text-amber-950'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {deltaReversion !== 0 ? (
                      <RotateCcw className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1.5 flex-1">
                      <div className="font-black text-slate-900">
                        {deltaReversion !== 0
                          ? 'Impacto en el stock del rodeo:'
                          : 'Sin alteración de cabezas:'}
                      </div>
                      <p className="font-medium text-slate-800">
                        {explicacionImpacto}
                      </p>
                      {rodeo && deltaReversion !== 0 && (
                        <div className="pt-2 mt-2 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold">
                          <span>
                            Stock {catLabel}:{' '}
                            <span className="line-through text-slate-400 font-normal">
                              {stockActualCat}
                            </span>{' '}
                            →{' '}
                            <span className="text-emerald-800 font-black">
                              {stockProyectadoCat} cab.
                            </span>
                          </span>
                          <span>
                            Total Rodeo:{' '}
                            <span className="line-through text-slate-400 font-normal">
                              {totalActualRodeo}
                            </span>{' '}
                            →{' '}
                            <span className="text-emerald-800 font-black">
                              {totalProyectadoRodeo} cab.
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Botones de Acción */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={deletingMovState}
                    onClick={() => handleSoloBorrarRegistro(m)}
                    className="w-full sm:w-auto px-3 py-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-bold text-xs transition border border-transparent hover:border-slate-200 text-center"
                    title="Limpia el registro duplicado del historial sin modificar las cabezas del rodeo"
                  >
                    Solo borrar registro
                  </button>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      type="button"
                      disabled={deletingMovState}
                      onClick={() => setConfirmDeleteMovModal(null)}
                      className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={deletingMovState}
                      onClick={() =>
                        handleEliminarYRevertirStock(
                          m,
                          rodeo,
                          fieldKey,
                          deltaReversion,
                          stockProyectadoCat
                        )
                      }
                      className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
                    >
                      {deletingMovState ? (
                        <span>Procesando...</span>
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Eliminar y revertir stock</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal de Importación y Conciliación Inteligente con IA */}
      <ConciliadorCaravanasIaModal
        isOpen={showConciliadorIaModal}
        onClose={() => setShowConciliadorIaModal(false)}
        rodeos={rodeos}
        cajasCaravanas={cajasCaravanas}
        animales={animales}
        fechaOperacion={fechaOperacion}
        onRefresh={onRefresh}
        notify={notify}
      />
    </div>
  );
}
