import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Sprout,
  Calendar,
  DollarSign,
  Layers,
  Search,
  Filter,
  Sparkles,
  Plus,
  FileText,
  FileSpreadsheet,
  FileDown,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Edit3,
  Copy,
  Receipt,
  X,
  RefreshCw,
  Droplets,
  Tractor,
  Package,
  PackageMinus,
  Check,
  ChevronDown,
  ChevronUp,
  Boxes,
  Calculator,
  Wheat,
  ClipboardList,
  UploadCloud,
  ArrowDownToLine,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import { confirmAction } from './ConfirmDialog';
import { analizarRecetaORemitoSiembra, hasGeminiKey, compressImage } from '../lib/geminiService';
import {
  buscarUltimoPrecioInsumo,
  buscarUltimoPrecioLabor,
  getHistorialPresupuestos,
  guardarPresupuestoEnCatalogo,
  eliminarPresupuestoCatalogo,
} from '../utils/preciosRefHelper.js';
import * as XLSX from 'xlsx';
import { exportarFichaSiembraPDF } from '../utils/pdfHelper';
import { registrarAuditLog } from '../utils/auditLogger';
import PotreroCard from './PotreroCard.jsx';
import GeminiRecetaModal from './GeminiRecetaModal.jsx';

const CAMPANAS_DISPONIBLES = ['2026/2027', '2025/2026', '2024/2025'];
const ESTADOS_SIEMBRA = ['Barbecho', 'Sembrado', 'En Pastoreo', 'Cosechado'];

const CULTIVOS_PREDEFINIDOS = [
  'Festuca + Trébol Blanco + Lotus',
  'Agropiro Alargado (Bajo Salino)',
  'Raigrás Anual (Verdeo Invierno)',
  'Avena Pastoreo',
  'Sorgo Forrajero / Silero',
  'Maíz Silaje / Grano',
  'Lotus Tenuis (Bajo Dulce)',
  'Alfalfa Pura / Consociada',
  'Campo Natural Mejorado',
  'Barbecho Químico / Limpieza',
];

const LABORES_PREDEFINIDAS = [
  'Barbecho Químico / Pulverización',
  'Siembra Directa',
  'Inter-siembra de Verdeo',
  'Fertilización Fosfatada / Nitrogenada',
  'Control de Malezas / Aplicación Selectiva',
  'Picado / Cosecha / Ensilado',
  'Corte y Confección de Rollos',
  'Rastra / Acondicionamiento de Suelo',
];

// =========================================================================
// HELPERS DE NORMALIZACIÓN Y DEDUPLICACIÓN DE CULTIVOS Y RECETAS
// =========================================================================

/**
 * Normaliza un nombre o variedad de cultivo/pastura a su especie base canónica
 * eliminando sufijos como (Receta RAO 22346), números de lote, etc., para agrupar
 * todas las hectáreas de Sorgo, Agropiro, Maíz, etc., en un único chip.
 */
export function normalizarEspecieBase(cultivoVariedad = '') {
  if (!cultivoVariedad) return 'Sin Definir';
  let str = String(cultivoVariedad).trim();
  // Quitar paréntesis y su contenido: ej. "(Receta RAO 22346)", "(Bajo Salino)", "(Lote 14)"
  str = str.replace(/\s*\([^)]*\)/g, '').trim();
  // Quitar guiones con recetas, remitos o facturas
  str = str.replace(/\s*[-–]\s*(?:Receta|RAO|Remito|Factura|Orden).*$/i, '').trim();

  const lower = str.toLowerCase();
  if (lower.includes('sorgo')) return 'Sorgo';
  if (lower.includes('agropiro')) return 'Agropiro';
  if (lower.includes('maiz') || lower.includes('maíz')) return 'Maíz';
  if (lower.includes('festuca')) return 'Festuca';
  if (lower.includes('raigras') || lower.includes('raigrás')) return 'Raigrás';
  if (lower.includes('alfalfa')) return 'Alfalfa';
  if (lower.includes('avena')) return 'Avena';
  if (lower.includes('vicia')) return 'Vicia';
  if (lower.includes('trebol') || lower.includes('trébol')) return 'Trébol';
  if (lower.includes('lotus')) return 'Lotus';
  if (lower.includes('pasto lloron') || lower.includes('pasto llorón')) return 'Pasto Llorón';
  if (lower.includes('cebadilla')) return 'Cebadilla';
  if (lower.includes('moha')) return 'Moha';
  if (lower.includes('soja')) return 'Soja';
  if (lower.includes('girasol')) return 'Girasol';
  if (lower.includes('campo natural')) return 'Campo Natural';
  if (lower.includes('barbecho')) return 'Barbecho';

  return str || 'Sin Definir';
}

/**
 * Deduplica automáticamente los ítems de receta agronómica dentro de un lote
 * para evitar que queden productos repetidos al importar o cruzar facturas.
 */
export function deduplicarReceta(recetaList = []) {
  if (!Array.isArray(recetaList) || recetaList.length === 0) return [];
  const map = new Map();
  for (const item of recetaList) {
    if (!item) continue;
    const prodName = String(item.producto || item.nombre || '').trim();
    if (!prodName) continue;
    const key = prodName.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { ...item, producto: prodName });
    } else {
      const existing = map.get(key);
      const existingDosis = Number(existing.dosis_ha) || 0;
      const newDosis = Number(item.dosis_ha) || 0;
      if (newDosis > existingDosis) {
        existing.dosis_ha = newDosis;
      }
      if (!existing.precio_unitario_usd && item.precio_unitario_usd) {
        existing.precio_unitario_usd = item.precio_unitario_usd;
      }
      if (!existing.funcion && item.funcion) {
        existing.funcion = item.funcion;
      }
      if (!existing.unidad && item.unidad) {
        existing.unidad = item.unidad;
      }
    }
  }
  return Array.from(map.values());
}

// =========================================================================
// COMPONENTE: STEPPER INPUT TÁCTIL [ − | N | + ] DE ALTO CONTRASTE
// =========================================================================
export function StepperInput({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  disabled = false,
  className = '',
  inputClassName = '',
  placeholder = '',
  theme = 'dark', // 'dark' | 'light'
  showButtons = false, // Por defecto ocultos para dar ancho libre y evitar recortes en números > 1.000
}) {
  const numVal = value === '' || value === null || value === undefined ? '' : Number(value);

  const handleStep = (direction) => {
    if (disabled) return;
    const current = numVal === '' ? 0 : Number(numVal);
    const delta = direction * (Number(step) || 1);
    let next = current + delta;
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    const rounded = Math.round(next * 100) / 100;
    onChange(rounded);
  };

  const handleInputChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange('');
      return;
    }
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      onChange(Math.round(parsed * 100) / 100);
    }
  };

  const isLight = theme === 'light';
  const containerStyle = isLight
    ? 'border-slate-300 bg-white focus-within:border-emerald-600'
    : 'border-slate-700 bg-slate-900 focus-within:border-emerald-500';
  const btnStyle = isLight
    ? 'bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 border-slate-200'
    : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border-slate-700/80';
  const textStyle = isLight ? 'text-slate-900' : 'text-white';

  return (
    <div className={`inline-flex items-stretch rounded-xl border overflow-hidden shadow-2xs transition ${containerStyle} ${className}`}>
      {showButtons && (
        <button
          type="button"
          disabled={disabled || (numVal !== '' && min !== undefined && numVal <= min)}
          onClick={() => handleStep(-1)}
          className={`w-7 sm:w-8 flex items-center justify-center font-bold border-r transition select-none cursor-pointer shrink-0 disabled:opacity-30 ${btnStyle}`}
          title="Disminuir"
        >
          −
        </button>
      )}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleInputChange}
        className={`w-full min-w-[115px] text-right font-bold font-mono bg-transparent py-1.5 px-2.5 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${textStyle} ${inputClassName}`}
      />
      {showButtons && (
        <button
          type="button"
          disabled={disabled || (numVal !== '' && max !== undefined && numVal >= max)}
          onClick={() => handleStep(1)}
          className={`w-7 sm:w-8 flex items-center justify-center font-bold border-l transition select-none cursor-pointer shrink-0 disabled:opacity-30 ${btnStyle}`}
          title="Aumentar"
        >
          +
        </button>
      )}
    </div>
  );
}

export default function SiembrasView({
  siembras = [],
  potreros = [],
  rodeos = [],
  stockInsumos = [],
  gastos = [],
  fechaOperacion = '',
  dolarRef = 1540,
  isSandboxMode = false,
  onNavigate,
  navContext = null,
  onClearNavContext,
  onRefresh,
  notify,
  appMode = 'admin',
  isAdmin,
}) {
  // Separación estricta: Modo Producción (100% técnico/operativo) vs Modo Admin (capa económica y financiera)
  const effectiveIsAdmin = typeof isAdmin === 'boolean'
    ? isAdmin
    : (appMode ? appMode === 'admin' : (typeof window !== 'undefined' ? localStorage.getItem('sanjose_app_mode') === 'admin' : false));

  // SPRINT D: Filtro inicial por defecto "Activas en mapa"
  const [campanaFiltro, setCampanaFiltro] = useState('2026/2027');
  const [estadoFiltro, setEstadoFiltro] = useState('TODOS');
  const [vigenciaFiltro, setVigenciaFiltro] = useState('Activa'); // 'Activa' (Activas en mapa) | 'Pasada / Histórica' | 'TODAS'
  const [cultivoFiltro, setCultivoFiltro] = useState('TODOS'); // 'TODOS' o especie seleccionada (Raigrás, Festuca, etc.)
  const [searchQuery, setSearchQuery] = useState('');

  // Modales
  const [modalEditOpen, setModalEditOpen] = useState(false);
  const [modalRaoOpen, setModalRaoOpen] = useState(false);
  const [modalIaOpen, setModalIaOpen] = useState(false);
  const [modalIaModo, setModalIaModo] = useState('nuevo'); // 'nuevo' | 'cruzar'
  const [cruzarTargetSiembra, setCruzarTargetSiembra] = useState(null);
  const [modalStockOpen, setModalStockOpen] = useState(false);
  const [modalGastoOpen, setModalGastoOpen] = useState(false);
  const [modalCatalogoPresupuestosOpen, setModalCatalogoPresupuestosOpen] = useState(false);
  const [menuAccionesOpen, setMenuAccionesOpen] = useState(false);

  // Estados de trabajo
  const [currentSiembra, setCurrentSiembra] = useState(null);
  const [saving, setSaving] = useState(false);
  const [stockItemToDeduct, setStockItemToDeduct] = useState(null);
  const [gastoItemToRecord, setGastoItemToRecord] = useState(null);

  // Expansión de secciones en tarjetas grandes (por ID)
  const [expandedSections, setExpandedSections] = useState({});

  function toggleSection(siembraId, sectionKey) {
    setExpandedSections((prev) => {
      const current = prev[`${siembraId}_${sectionKey}`];
      return {
        ...prev,
        [`${siembraId}_${sectionKey}`]: current === undefined ? true : !current,
      };
    });
  }

  function isSectionOpen(siembraId, sectionKey, defaultVal = true) {
    const val = expandedSections[`${siembraId}_${sectionKey}`];
    return val !== undefined ? val : defaultVal;
  }

  // Helper para buscar potrero
  function getPotrero(num) {
    return (potreros || []).find((p) => Number(p.numero) === Number(num)) || null;
  }

  // Helper para deduplicar siembras activas en un mismo potrero evitando sumar ciclos anteriores o reemplazados
  const deduplicarSiembrasActivas = useCallback((list = []) => {
    const porPotrero = {};
    const sinPotrero = [];

    list.forEach((s) => {
      const pNum = Number(s.potrero_numero);
      if (!pNum) {
        sinPotrero.push(s);
      } else {
        if (!porPotrero[pNum]) porPotrero[pNum] = [];
        porPotrero[pNum].push(s);
      }
    });

    const result = [...sinPotrero];

    Object.entries(porPotrero).forEach(([pNumStr, items]) => {
      if (items.length <= 1) {
        result.push(items[0]);
        return;
      }

      // Ordenar por fecha descendente (más reciente primero, y por ID descendente)
      items.sort((a, b) => {
        const dA = a.fecha ? new Date(a.fecha).getTime() : 0;
        const dB = b.fecha ? new Date(b.fecha).getTime() : 0;
        if (dB !== dA) return dB - dA;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });

      const pObj = getPotrero(Number(pNumStr));
      const potreroHa = Number(pObj?.hectareas) || 0;
      const totalHaItems = items.reduce(
        (sum, it) => sum + (Number(it.ha_sembradas || it.hectareas) || 0),
        0
      );

      // Si la suma de hectáreas excede la superficie del potrero (o si son de distintas campañas/fechas y reemplazan la anterior),
      // solo la siembra más reciente es la que está activa en el mapa.
      if (potreroHa > 0 && totalHaItems > potreroHa * 1.05) {
        result.push(items[0]);
      } else {
        // Son parcelas complementarias dentro del mismo potrero
        items.forEach((it) => result.push(it));
      }
    });

    return result;
  }, [potreros]);

  // Sincronización bidireccional automática: detectar cualquier potrero en potreros con pastura
  // implantada activa (distinta de "Campo Natural" y no vacía) que aún no tenga siembra activa
  const siembrasCompletasConPotreros = useMemo(() => {
    const list = [...(siembras || [])];

    (potreros || []).forEach((p) => {
      const pNum = Number(p.numero);
      if (!pNum) return;

      const pastura = (p.cultivo_actual || p.recurso_forrajero || '').trim();
      const isImplantada = pastura && !pastura.toLowerCase().includes('campo natural');

      if (isImplantada) {
        // Si ya existe cualquier registro de siembra (activo o archivado) para este potrero, NO sintetizar nada automático
        const yaExisteCualquiera = list.some(
          (s) => Number(s.potrero_numero) === pNum
        );

        if (!yaExisteCualquiera) {
          const haPot = Number(p.ha_sembradas) > 0 ? Number(p.ha_sembradas) : (Number(p.hectareas) || 0);
          list.push({
            id: `p_sync_${p.id || pNum}`,
            potrero_numero: pNum,
            campana: '2026/2027',
            cultivo_variedad: pastura,
            variedad_hibrido: '',
            hectareas: haPot,
            ha_sembradas: haPot,
            fecha: p.fecha_siembra || fechaOperacion || '2026-03-12',
            estado: 'Sembrado',
            vigencia: 'Activa',
            tarea: 'Siembra Directa / Pastura Perenne',
            insumos_detalle: 'Pastura perenne implantada según relevamiento forrajero',
            receta_json: [],
            insumos_json: [],
            labores_json: [],
            costo_insumos_usd: 0,
            costo_labores_usd: 0,
            costo_total_usd: 0,
            moneda: 'USD',
            tipo_cambio: Number(dolarRef) || 1540,
            observaciones: `Pastura implantada activa sincronizada desde el Mapa (Potrero #${pNum} - ${p.nombre || ''}).`,
            _isAutoSyncedFromMapa: true,
          });
        }
      }
    });

    return list;
  }, [siembras, potreros, fechaOperacion, dolarRef]);

  // Persistir en segundo plano en la base de datos o sandbox si falta el registro físico
  const syncedRef = useRef(new Set());
  useEffect(() => {
    async function autoPersistMissingSiembras() {
      const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
      for (const p of potreros || []) {
        const pNum = Number(p.numero);
        if (!pNum || syncedRef.current.has(pNum)) continue;
        const pastura = (p.cultivo_actual || p.recurso_forrajero || '').trim();
        const isImplantada = pastura && !pastura.toLowerCase().includes('campo natural');
        if (!isImplantada) continue;

        // Si ya existe cualquier registro de siembra (activo o archivado), no re-crear
        const yaExisteCualquiera = (siembras || []).some(
          (s) => Number(s.potrero_numero) === pNum
        );

        if (!yaExisteCualquiera) {
          syncedRef.current.add(pNum);
          const haPot = Number(p.ha_sembradas) > 0 ? Number(p.ha_sembradas) : (Number(p.hectareas) || 0);
          const payload = {
            potrero_numero: pNum,
            campana: '2026/2027',
            cultivo_variedad: pastura,
            variedad_hibrido: '',
            hectareas: haPot,
            fecha: p.fecha_siembra || fechaOperacion || '2026-03-12',
            estado: 'Sembrado',
            vigencia: 'Activa',
            tarea: 'Siembra Directa',
            observaciones: `Pastura perenne implantada según relevamiento del Mapa (Potrero #${pNum}).`,
          };

          if (isSandbox) {
            const raw = localStorage.getItem('san_jose_sandbox_data');
            const sData = raw ? JSON.parse(raw) : {};
            if (!Array.isArray(sData.labores_siembras)) sData.labores_siembras = [];
            sData.labores_siembras.push({ ...payload, id: Date.now() + pNum });
            localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
            window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
          } else {
            try {
              await supabase.from('labores_siembras').insert(payload);
            } catch (e) {
              console.warn('Auto-persist siembra error:', e);
            }
          }
        }
      }
    }
    if ((potreros || []).length > 0) {
      autoPersistMissingSiembras();
    }
  }, [potreros, siembras, isSandboxMode, fechaOperacion]);

  // Subconjunto base de siembras según filtros (Campaña, Estado, Vigencia y Búsqueda)
  const siembrasBaseParaKPIs = useMemo(() => {
    const rawFiltered = (siembrasCompletasConPotreros || []).filter((s) => {
      const matchCampana = campanaFiltro === 'TODAS' || (s.campana || '2026/2027') === campanaFiltro;
      const matchEstado = estadoFiltro === 'TODOS' || (s.estado || 'Sembrado') === estadoFiltro;

      const isArchivada = s.archivado === true || s.archivada === true || s.activa_en_mapa === false ||
        ['archivado', 'archivada', 'historico', 'historica', 'pasada / histórica', 'pasada', 'finalizado', 'finalizada'].includes(String(s.estado || '').toLowerCase().trim()) ||
        ['pasada / histórica', 'pasada', 'historica', 'historico', 'archivada', 'archivado'].includes(String(s.vigencia || '').toLowerCase().trim());

      let matchVigencia = true;
      if (vigenciaFiltro === 'Activa') {
        matchVigencia = !isArchivada;
      } else if (vigenciaFiltro === 'Pasada / Histórica') {
        matchVigencia = isArchivada;
      } else {
        matchVigencia = true; // 'TODAS'
      }

      const q = searchQuery.trim().toLowerCase();
      if (!q) return matchCampana && matchEstado && matchVigencia;

      const pNum = String(s.potrero_numero || '');
      const pNombre = (potreros.find((p) => p.numero === s.potrero_numero)?.nombre || '').toLowerCase();
      const cultivo = (s.cultivo_variedad || '').toLowerCase();
      const hibrido = (s.variedad_hibrido || '').toLowerCase();
      const obs = (s.observaciones || '').toLowerCase();

      const matchQuery =
        pNum.includes(q) ||
        `p${pNum}`.includes(q) ||
        `#${pNum}`.includes(q) ||
        pNombre.includes(q) ||
        cultivo.includes(q) ||
        hibrido.includes(q) ||
        obs.includes(q);

      return matchCampana && matchEstado && matchVigencia && matchQuery;
    });

    // Si estamos en filtro "Activa", deduplicar estrictamente por potrero para evitar duplicaciones
    if (vigenciaFiltro === 'Activa') {
      return deduplicarSiembrasActivas(rawFiltered);
    }

    return rawFiltered;
  }, [siembrasCompletasConPotreros, campanaFiltro, estadoFiltro, vigenciaFiltro, searchQuery, potreros, deduplicarSiembrasActivas]);

  // Resumen Dinámico de Hectáreas por Cultivo / Pastura (Agrupado por especie base canónica)
  const resumenPorCultivo = useMemo(() => {
    const map = {};
    let totalHaActivas = 0;
    (siembrasBaseParaKPIs || []).forEach((s) => {
      const c = normalizarEspecieBase(s.cultivo_variedad);
      const ha = Number(s.ha_sembradas || s.hectareas) || 0;
      map[c] = (map[c] || 0) + ha;
      totalHaActivas += ha;
    });
    const lista = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return { lista, totalHaActivas };
  }, [siembrasBaseParaKPIs]);

  // Filtrado final aplicando además el chip de pastura/especie seleccionada
  const siembrasFiltradas = useMemo(() => {
    return siembrasBaseParaKPIs.filter((s) => {
      if (cultivoFiltro === 'TODOS') return true;
      const especieBase = normalizarEspecieBase(s.cultivo_variedad);
      return (
        especieBase.toLowerCase() === cultivoFiltro.toLowerCase() ||
        (s.cultivo_variedad || '').trim().toLowerCase().includes(cultivoFiltro.toLowerCase())
      );
    });
  }, [siembrasBaseParaKPIs, cultivoFiltro]);

  // KPIs calculados estrictamente sobre el conjunto activo / filtrado (económicos para Admin, técnicos para Producción)
  const kpis = useMemo(() => {
    let haTotal = 0;
    let invTotalUSD = 0;
    let costoInsumosUSD = 0;
    let costoLaboresUSD = 0;
    let lotesActivos = 0;
    let conReceta = 0;
    let enPastoreo = 0;
    let barbechoCount = 0;
    let sembradoCount = 0;
    let enPastoreoCount = 0;
    let cosechadoCount = 0;
    let totalLaboresCount = 0;
    let totalRecetasCount = 0;

    siembrasFiltradas.forEach((s) => {
      const ha = Number(s.ha_sembradas || s.hectareas) || 0;
      haTotal += ha;

      const cInsumos = Number(s.costo_insumos_usd) || 0;
      const cLabores = Number(s.costo_labores_usd) || 0;
      let cTotal = Number(s.costo_total_usd);

      if (!cTotal || cTotal === 0) {
        cTotal = cInsumos + cLabores;
        if (!cTotal && s.costo_total) {
          cTotal = Number(s.costo_total) / (Number(s.tipo_cambio) || Number(dolarRef) || 1540);
        }
      }

      costoInsumosUSD += cInsumos;
      costoLaboresUSD += cLabores;
      invTotalUSD += cTotal;
      if ((s.vigencia || 'Activa') === 'Activa' && s.vigencia !== 'Pasada / Histórica') {
        lotesActivos++;
      } else {
        lotesActivos++;
      }

      const est = (s.estado || 'Sembrado').trim();
      if (est === 'Barbecho') barbechoCount++;
      else if (est === 'Sembrado') sembradoCount++;
      else if (est === 'En Pastoreo') {
        enPastoreo++;
        enPastoreoCount++;
      } else if (est === 'Cosechado') cosechadoCount++;
      else sembradoCount++;

      if (Array.isArray(s.receta_json) && s.receta_json.length > 0) {
        conReceta++;
        totalRecetasCount += s.receta_json.length;
      }
      if (Array.isArray(s.labores_json)) {
        totalLaboresCount += s.labores_json.length;
      }
    });

    const usdPorHaPromedio = haTotal > 0 ? invTotalUSD / haTotal : 0;

    return {
      haTotal,
      invTotalUSD,
      costoInsumosUSD,
      costoLaboresUSD,
      usdPorHaPromedio,
      lotesActivos: siembrasFiltradas.length,
      conReceta,
      enPastoreo,
      barbechoCount,
      sembradoCount,
      enPastoreoCount,
      cosechadoCount,
      totalLaboresCount,
      totalRecetasCount,
    };
  }, [siembrasFiltradas, dolarRef]);

  // Abrir modal de nueva siembra
  function handleNuevaSiembra() {
    const pFirst = potreros[0];
    const haInit = Number(pFirst?.hectareas) || 40;
    setCurrentSiembra({
      potrero_numero: pFirst?.numero || 1,
      hectareas: haInit,
      ha_sembradas: haInit,
      vigencia: 'Activa',
      cultivo_variedad: '',
      variedad_hibrido: '',
      campana: campanaFiltro !== 'TODAS' ? campanaFiltro : '2026/2027',
      estado: 'Sembrado',
      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
      receta_json: [],
      insumos_json: [],
      labores_json: [],
      costo_insumos_usd: 0,
      costo_labores_usd: 0,
      costo_total_usd: 0,
      observaciones: '',
    });
    setModalEditOpen(true);
  }

  // Abrir modal de edición
  function handleEditSiembra(siembra) {
    const pObj = getPotrero(siembra.potrero_numero);
    const ha = Number(siembra.ha_sembradas || siembra.hectareas) || Number(pObj?.hectareas) || 40;
    setCurrentSiembra({
      ...siembra,
      hectareas: ha,
      ha_sembradas: ha,
      vigencia: siembra.vigencia || 'Activa',
      receta_json: Array.isArray(siembra.receta_json) ? [...siembra.receta_json] : [],
      insumos_json: Array.isArray(siembra.insumos_json) ? [...siembra.insumos_json] : [],
      labores_json: Array.isArray(siembra.labores_json) ? [...siembra.labores_json] : [],
    });
    setModalEditOpen(true);
  }

  // Deep-linking cruzado recibido desde Calendario / Inicio / Mapa / Bitácora
  useEffect(() => {
    if (!navContext) return;
    if (navContext.siembraId) {
      const found = siembras.find((s) => String(s.id) === String(navContext.siembraId));
      if (found) {
        if (found.campana) setCampanaFiltro(found.campana);
        setEstadoFiltro('TODOS');
        if (found.vigencia === 'Pasada / Histórica' || found.vigencia === 'Reemplazada') {
          setVigenciaFiltro('Pasada / Histórica');
        } else {
          setVigenciaFiltro('Activa');
        }
        setCultivoFiltro('TODOS');
        handleEditSiembra(found);
        setTimeout(() => {
          const el = document.getElementById(`siembra-card-${found.id}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
        onClearNavContext?.();
      }
    } else if (navContext.openRaoModal) {
      setModalRaoOpen(true);
      onClearNavContext?.();
    } else if (navContext.potreroNumero != null) {
      setSearchQuery(`P#${navContext.potreroNumero}`);
      onClearNavContext?.();
    }
  }, [navContext, siembras, onClearNavContext]);

  // Clonar y repetir siembra
  function handleRepetirSiembra(siembra) {
    const potreroObj = getPotrero(siembra.potrero_numero);
    const ha = Number(siembra.ha_sembradas || siembra.hectareas) || Number(potreroObj?.hectareas) || 40;
    setCurrentSiembra({
      ...siembra,
      id: undefined, // Nueva inserción
      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
      campana: siembra.campana === '2025/2026' ? '2026/2027' : siembra.campana || '2026/2027',
      estado: 'Barbecho',
      vigencia: 'Activa',
      hectareas: ha,
      ha_sembradas: ha,
      receta_json: Array.isArray(siembra.receta_json)
        ? siembra.receta_json.map((r) => ({
            ...r,
            total_lote: Number(r.dosis_ha || 0) * ha,
          }))
        : [],
      insumos_json: [], // Aplicaciones se inician vacías para registrar los nuevos remitos
      labores_json: Array.isArray(siembra.labores_json)
        ? siembra.labores_json.map((l) => ({
            ...l,
            fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
            subtotal_usd: Number(l.costo_ha_usd || 0) * ha,
          }))
        : [],
      costo_insumos_usd: 0,
      costo_labores_usd: 0,
      costo_total_usd: 0,
      observaciones: `Clonado de ficha anterior (P#${siembra.potrero_numero} - ${siembra.campana}). Ajustar datos.`,
    });
    setModalEditOpen(true);
    notify?.('Estructura de siembra clonada. Modificá potrero o campaña y guardá.', 'info');
  }

  // Eliminar siembra con sincronización bidireccional hacia potreros
  async function handleDeleteSiembra(id, potreroNum) {
    const ok = await confirmAction({
      title: `¿Eliminar siembra del Potrero #${potreroNum}?`,
      description: 'Se eliminará el registro de labor agrícola y su sincronización de cultivo en el potrero.',
      confirmText: 'Sí, eliminar siembra',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }
    const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
    try {
      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.labores_siembras)) {
            sData.labores_siembras = sData.labores_siembras.filter((s) => String(s.id) !== String(id));
          }
          const quedanOtras = (sData.labores_siembras || []).some(
            (s) => Number(s.potrero_numero) === Number(potreroNum) && (s.vigencia || 'Activa') === 'Activa' && s.estado !== 'Cosechado'
          );
          if (!quedanOtras && Array.isArray(sData.potreros)) {
            const pIdx = sData.potreros.findIndex((p) => Number(p.numero) === Number(potreroNum));
            if (pIdx >= 0) {
              sData.potreros[pIdx] = {
                ...sData.potreros[pIdx],
                cultivo_actual: 'Campo Natural',
                recurso_forrajero: 'Campo Natural',
                ha_sembradas: 0,
              };
            }
          }
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
        }
      } else {
        const { error } = await supabase.from('labores_siembras').delete().eq('id', id);
        if (error) throw error;

        const { data: otras } = await supabase
          .from('labores_siembras')
          .select('id, cultivo_variedad, hectareas, ha_sembradas, fecha')
          .eq('potrero_numero', Number(potreroNum))
          .eq('vigencia', 'Activa')
          .neq('estado', 'Cosechado')
          .limit(1);

        if (otras && otras.length > 0) {
          await supabase.from('potreros').update({
            cultivo_actual: otras[0].cultivo_variedad,
            recurso_forrajero: otras[0].cultivo_variedad,
            ha_sembradas: Number(otras[0].ha_sembradas || otras[0].hectareas) || 0,
            fecha_siembra: otras[0].fecha,
          }).eq('numero', Number(potreroNum));
        } else {
          await supabase.from('potreros').update({
            cultivo_actual: 'Campo Natural',
            recurso_forrajero: 'Campo Natural',
            ha_sembradas: 0,
          }).eq('numero', Number(potreroNum));
        }
      }

      notify?.(`Siembra del Potrero #${potreroNum} eliminada con éxito.`, 'success');
      if (onRefresh) await onRefresh();
    } catch (err) {
      notify?.(`Error al eliminar siembra: ${err.message}`, 'error');
    }
  }

  // Eliminar una fila individual de insumo aplicado desde la tarjeta de siembra
  async function handleDeleteInsumoFromSiembra(siembra, insumoIdx) {
    const insumosActuales = Array.isArray(siembra.insumos_json) ? [...siembra.insumos_json] : [];
    const insumoTarget = insumosActuales[insumoIdx];
    if (!insumoTarget) return;

    const ok = await confirmAction({
      title: `¿Eliminar insumo "${insumoTarget.producto || 'Insumo'}"?`,
      description: `Se quitará este insumo del Potrero #${siembra.potrero_numero} y se recalcularán los costos de la siembra.`,
      confirmText: 'Sí, eliminar insumo',
      variant: 'danger',
    });
    if (!ok) return;

    const nuevosInsumos = insumosActuales.filter((_, idx) => idx !== insumoIdx);
    const nuevoCostoInsumosUSD = Number(nuevosInsumos.reduce((acc, item) => acc + (Number(item.costo_usd) || 0), 0).toFixed(2));
    const costoLaboresUSD = Number(siembra.costo_labores_usd) || 0;
    const nuevoCostoTotalUSD = Number((nuevoCostoInsumosUSD + costoLaboresUSD).toFixed(2));
    const nuevoInsumosDetalle = nuevosInsumos.map((i) => `${i.producto} (${i.dosis_real || i.dosis_ha || 0} ${i.unidad || ''})`).join(', ');

    // Actualizar también receta_json si correspondía
    let nuevaRecetaJson = Array.isArray(siembra.receta_json) ? [...siembra.receta_json] : [];
    if (insumoTarget.producto) {
      const prodTargetNorm = insumoTarget.producto.trim().toLowerCase();
      const quedaEnInsumos = nuevosInsumos.some((i) => i.producto && i.producto.trim().toLowerCase() === prodTargetNorm);
      if (!quedaEnInsumos) {
        nuevaRecetaJson = nuevaRecetaJson.filter((r) => !r.producto || r.producto.trim().toLowerCase() !== prodTargetNorm);
      }
    }

    const payload = {
      insumos_json: nuevosInsumos,
      receta_json: nuevaRecetaJson,
      insumos_detalle: nuevoInsumosDetalle,
      costo_insumos_usd: nuevoCostoInsumosUSD,
      costo_total_usd: nuevoCostoTotalUSD,
    };

    const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
    try {
      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.labores_siembras)) {
            const idxS = sData.labores_siembras.findIndex((s) => String(s.id) === String(siembra.id));
            if (idxS >= 0) {
              sData.labores_siembras[idxS] = { ...sData.labores_siembras[idxS], ...payload };
            }
          }
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
        }
      } else {
        const { error } = await supabase.from('labores_siembras').update(payload).eq('id', siembra.id);
        if (error) throw error;
      }

      notify?.(`Insumo "${insumoTarget.producto}" eliminado con éxito.`, 'success');
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error eliminando insumo de siembra:', err);
      notify?.(`Error al eliminar insumo: ${err.message}`, 'error');
    }
  }

  // Limpiar insumos duplicados, sobrantes o semillas ajenas incompatibles
  async function handleCleanSiembraInsumos(siembra) {
    const insumosActuales = Array.isArray(siembra.insumos_json) ? [...siembra.insumos_json] : [];
    if (insumosActuales.length === 0) {
      notify?.('Esta siembra no tiene insumos cargados para limpiar.', 'info');
      return;
    }

    const cultivoNom = String(siembra.cultivo_variedad || '').toLowerCase();
    const esSorgo = cultivoNom.includes('sorgo');
    const esMaiz = cultivoNom.includes('maiz') || cultivoNom.includes('maíz');

    const itemsAEliminar = [];
    const itemsConservados = [];
    const vistos = new Set();

    insumosActuales.forEach((ins, idx) => {
      const prodNom = String(ins.producto || '').trim();
      const prodLower = prodNom.toLowerCase();

      // 1. Detección de texto "sobrante", "cotizacion", "cotización", "remanente"
      const esSobranteTexto = /sobrante|cotizaci[oó]n|remanente/i.test(prodNom) || /sobrante|cotizaci[oó]n|remanente/i.test(String(ins.remito || ''));

      // 2. Detección de semillas ajenas incompatibles con el cultivo de la siembra
      let esSemillaIncompatible = false;
      let razonIncompatible = '';

      if (esSorgo) {
        if (/ryegrass|raigras|festuca|agropiro|moha|tr[eé]bol|vicia|alfalfa|ma[ií]z\s*(?:h[ií]brido|grano|silero|semilla|\d+)/i.test(prodLower)) {
          esSemillaIncompatible = true;
          razonIncompatible = 'Semilla ajena en lote de Sorgo';
        }
      } else if (esMaiz) {
        if (/sorgo|ryegrass|raigras|festuca|agropiro|moha|tr[eé]bol|vicia|alfalfa/i.test(prodLower)) {
          esSemillaIncompatible = true;
          razonIncompatible = 'Semilla ajena en lote de Maíz';
        }
      }

      // 3. Detección de duplicados exactos
      const claveUnica = `${prodLower}_${ins.cantidad}_${ins.remito || ''}`;
      const esDuplicado = vistos.has(claveUnica);

      if (esSobranteTexto || esSemillaIncompatible || esDuplicado) {
        itemsAEliminar.push({
          index: idx,
          producto: prodNom,
          motivo: esSobranteTexto
            ? 'Ítem de sobrante / cotización'
            : esSemillaIncompatible
            ? razonIncompatible
            : 'Registro duplicado',
          costo_usd: Number(ins.costo_usd) || 0,
        });
      } else {
        vistos.add(claveUnica);
        itemsConservados.push(ins);
      }
    });

    if (itemsAEliminar.length === 0) {
      notify?.('No se detectaron duplicados, sobrantes ni semillas ajenas en este lote. La lista está limpia.', 'info');
      return;
    }

    const detalleNombres = itemsAEliminar.map((it) => `• ${it.producto} (${it.motivo})`).join('\n');
    const ok = await confirmAction({
      title: `¿Limpiar ${itemsAEliminar.length} ítem(s) de insumos en Potrero #${siembra.potrero_numero}?`,
      description: `Se eliminarán los siguientes ítems mal imputados o duplicados:\n\n${detalleNombres}\n\nLos costos se recalcularán automáticamente.`,
      confirmText: `Sí, limpiar ${itemsAEliminar.length} ítem(s)`,
      variant: 'warning',
    });
    if (!ok) return;

    const nuevoCostoInsumosUSD = Number(itemsConservados.reduce((acc, item) => acc + (Number(item.costo_usd) || 0), 0).toFixed(2));
    const costoLaboresUSD = Number(siembra.costo_labores_usd) || 0;
    const nuevoCostoTotalUSD = Number((nuevoCostoInsumosUSD + costoLaboresUSD).toFixed(2));
    const nuevoInsumosDetalle = itemsConservados.map((i) => `${i.producto} (${i.dosis_real || i.dosis_ha || 0} ${i.unidad || ''})`).join(', ');

    const prodsConservadosLower = new Set(itemsConservados.map((i) => String(i.producto || '').trim().toLowerCase()));
    const nuevaRecetaJson = (Array.isArray(siembra.receta_json) ? siembra.receta_json : []).filter(
      (r) => r.producto && prodsConservadosLower.has(r.producto.trim().toLowerCase())
    );

    const payload = {
      insumos_json: itemsConservados,
      receta_json: nuevaRecetaJson,
      insumos_detalle: nuevoInsumosDetalle,
      costo_insumos_usd: nuevoCostoInsumosUSD,
      costo_total_usd: nuevoCostoTotalUSD,
    };

    const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
    try {
      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.labores_siembras)) {
            const idxS = sData.labores_siembras.findIndex((s) => String(s.id) === String(siembra.id));
            if (idxS >= 0) {
              sData.labores_siembras[idxS] = { ...sData.labores_siembras[idxS], ...payload };
            }
          }
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
        }
      } else {
        const { error } = await supabase.from('labores_siembras').update(payload).eq('id', siembra.id);
        if (error) throw error;
      }

      notify?.(`¡Se eliminaron ${itemsAEliminar.length} ítem(s) de sobrantes/duplicados! La siembra quedó saneada.`, 'success');
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Error limpiando insumos de siembra:', err);
      notify?.(`Error al limpiar insumos: ${err.message}`, 'error');
    }
  }

  // Cambio rápido de estado desde la tarjeta
  async function handleCambiarEstadoRapido(siembra, nuevoEstado) {
    try {
      const { error } = await supabase
        .from('labores_siembras')
        .update({ estado: nuevoEstado })
        .eq('id', siembra.id);
      if (error) throw error;

      // Si la siembra está activa y pasa a En Pastoreo o Sembrado, sincronizar potrero
      const isActiva = (siembra.vigencia || 'Activa') === 'Activa';
      if (isActiva && (nuevoEstado === 'En Pastoreo' || nuevoEstado === 'Sembrado')) {
        await supabase
          .from('potreros')
          .update({
            cultivo_actual: siembra.cultivo_variedad,
            recurso_forrajero: siembra.cultivo_variedad,
            ha_sembradas: Number(siembra.ha_sembradas || siembra.hectareas),
            fecha_siembra: siembra.fecha,
          })
          .eq('numero', siembra.potrero_numero);
      }

      notify?.(`Estado actualizado a "${nuevoEstado}".`, 'success');
      onRefresh?.();
    } catch (err) {
      notify?.(`Error actualizando estado: ${err.message}`, 'error');
    }
  }

  // Alternar vigencia: Activa vs. Pasada / Histórica (Archivar)
  async function handleToggleVigencia(siembra) {
    const isActivaActualmente = (siembra.vigencia || 'Activa') === 'Activa' &&
      !siembra.archivado && !siembra.archivada && siembra.activa_en_mapa !== false &&
      !['archivado', 'archivada', 'historico', 'historica', 'pasada / histórica', 'pasada', 'finalizado', 'finalizada'].includes(String(siembra.estado || '').toLowerCase().trim()) &&
      !['pasada / histórica', 'pasada', 'historica', 'historico', 'archivada', 'archivado'].includes(String(siembra.vigencia || '').toLowerCase().trim());

    const payloadSiembra = isActivaActualmente
      ? { archivado: true, archivada: true, activa_en_mapa: false, vigencia: 'Pasada / Histórica', estado: 'Archivado' }
      : { archivado: false, archivada: false, activa_en_mapa: true, vigencia: 'Activa', estado: 'Sembrado' };

    const pNum = Number(siembra.potrero_numero);
    const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');

    try {
      // 1. Sincronizar en localStorage / san_jose_sandbox_data si existe
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          try {
            const sData = JSON.parse(raw);
            if (Array.isArray(sData.labores_siembras)) {
              const idx = sData.labores_siembras.findIndex((s) => String(s.id) === String(siembra.id));
              if (idx >= 0) {
                sData.labores_siembras[idx] = { ...sData.labores_siembras[idx], ...payloadSiembra };
              }
            }
            if (pNum && Array.isArray(sData.potreros)) {
              const pIdx = sData.potreros.findIndex((p) => Number(p.numero) === pNum);
              if (pIdx >= 0) {
                if (isActivaActualmente) {
                  // Archivar: verificar si queda alguna otra siembra activa
                  const otraActiva = (sData.labores_siembras || []).find(
                    (s) => Number(s.potrero_numero) === pNum && String(s.id) !== String(siembra.id) &&
                      (s.vigencia || 'Activa') === 'Activa' && !s.archivado && !s.archivada && s.activa_en_mapa !== false &&
                      !['archivado', 'archivada', 'historico', 'historica', 'pasada / histórica', 'pasada'].includes(String(s.estado || '').toLowerCase().trim()) &&
                      !['pasada / histórica', 'pasada', 'historica', 'historico', 'archivada', 'archivado'].includes(String(s.vigencia || '').toLowerCase().trim())
                  );
                  if (otraActiva) {
                    sData.potreros[pIdx] = {
                      ...sData.potreros[pIdx],
                      cultivo_actual: otraActiva.cultivo_variedad,
                      recurso_forrajero: otraActiva.cultivo_variedad,
                      ha_sembradas: Number(otraActiva.ha_sembradas || otraActiva.hectareas),
                      fecha_siembra: otraActiva.fecha,
                    };
                  } else {
                    sData.potreros[pIdx] = {
                      ...sData.potreros[pIdx],
                      cultivo_actual: 'Campo Natural',
                      recurso_forrajero: 'Campo Natural',
                      ha_sembradas: null,
                      fecha_siembra: null,
                      estado_semaforo: sData.potreros[pIdx].estado_semaforo === 'En siembra' ? 'Disponible' : sData.potreros[pIdx].estado_semaforo,
                    };
                  }
                } else {
                  // Reactivar
                  const ha = Number(siembra.ha_sembradas || siembra.hectareas) || 0;
                  sData.potreros[pIdx] = {
                    ...sData.potreros[pIdx],
                    cultivo_actual: siembra.cultivo_variedad,
                    recurso_forrajero: siembra.cultivo_variedad,
                    ha_sembradas: ha,
                    fecha_siembra: siembra.fecha,
                  };
                }
              }
            }
            localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
            window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
          } catch (e) {
            console.warn('Error syncing localStorage in handleToggleVigencia:', e);
          }
        }
      }

      // 2. Sincronizar en Supabase
      if (!isSandbox) {
        const { error } = await supabase
          .from('labores_siembras')
          .update(payloadSiembra)
          .eq('id', siembra.id);
        if (error) throw error;

        if (pNum) {
          if (!isActivaActualmente) {
            // Reactivando
            const ha = Number(siembra.ha_sembradas || siembra.hectareas) || 0;
            await supabase
              .from('potreros')
              .update({
                cultivo_actual: siembra.cultivo_variedad,
                recurso_forrajero: siembra.cultivo_variedad,
                ha_sembradas: ha,
                fecha_siembra: siembra.fecha,
              })
              .eq('numero', pNum);
            notify?.(`Siembra reactivada. Potrero #${pNum} sincronizado con el Mapa.`, 'success');
          } else {
            // Archivando: buscar si existe otra siembra activa en el potrero
            const { data: otras } = await supabase
              .from('labores_siembras')
              .select('*')
              .eq('potrero_numero', pNum)
              .neq('id', siembra.id);

            const otraActiva = (otras || []).find(
              (s) => (s.vigencia || 'Activa') === 'Activa' && !s.archivado && !s.archivada && s.activa_en_mapa !== false &&
                !['archivado', 'archivada', 'historico', 'historica', 'pasada / histórica', 'pasada'].includes(String(s.estado || '').toLowerCase().trim()) &&
                !['pasada / histórica', 'pasada', 'historica', 'historico', 'archivada', 'archivado'].includes(String(s.vigencia || '').toLowerCase().trim())
            );

            if (otraActiva) {
              await supabase
                .from('potreros')
                .update({
                  cultivo_actual: otraActiva.cultivo_variedad,
                  recurso_forrajero: otraActiva.cultivo_variedad,
                  ha_sembradas: Number(otraActiva.ha_sembradas || otraActiva.hectareas),
                  fecha_siembra: otraActiva.fecha,
                })
                .eq('numero', pNum);
            } else {
              await supabase
                .from('potreros')
                .update({
                  cultivo_actual: 'Campo Natural',
                  recurso_forrajero: 'Campo Natural',
                  ha_sembradas: null,
                  estado_semaforo: 'Disponible',
                })
                .eq('numero', pNum);
            }
            notify?.(`Siembra archivada como Histórica. Cobertura del potrero liberada en el Mapa.`, 'info');
          }
        }
      } else {
        if (isActivaActualmente) {
          notify?.(`Siembra archivada como Histórica. Cobertura del potrero liberada en el Mapa.`, 'info');
        } else {
          notify?.(`Siembra reactivada. Potrero #${pNum} sincronizado con el Mapa.`, 'success');
        }
      }

      onRefresh?.();
    } catch (err) {
      notify?.(`Error al actualizar vigencia: ${err.message}`, 'error');
    }
  }

  // Guardar siembra (crear o actualizar)
  async function handleSaveSiembra(formData) {
    setSaving(true);
    try {
      const ha = Number(formData.ha_sembradas || formData.hectareas) || 0;
      const vigencia = formData.vigencia || 'Activa';
      const isActiva = vigencia === 'Activa' && formData.estado !== 'Archivado';

      // Calcular costos totales (pueden ser 0 al guardar una ficha preliminar)
      const costoInsumos = (formData.insumos_json || []).reduce(
        (sum, item) => sum + (Number(item.costo_usd) || 0),
        0
      );
      const costoLabores = (formData.labores_json || []).reduce(
        (sum, item) => sum + (Number(item.subtotal_usd) || 0),
        0
      );
      const costoTotal = costoInsumos + costoLabores;

      const payload = {
        potrero_numero: Number(formData.potrero_numero),
        hectareas: ha,
        ha_sembradas: ha,
        vigencia: vigencia,
        archivado: !isActiva,
        archivada: !isActiva,
        activa_en_mapa: isActiva,
        cultivo_variedad: formData.cultivo_variedad || 'Pastura / Verdeo',
        variedad_hibrido: formData.variedad_hibrido || '',
        campana: formData.campana || '2026/2027',
        estado: formData.estado || 'Sembrado',
        fecha: formData.fecha || new Date().toISOString().slice(0, 10),
        tarea: formData.cultivo_variedad?.toLowerCase().includes('barbecho') ? 'Barbecho Químico' : 'Siembra Directa',
        insumos_detalle: deduplicarReceta(formData.receta_json || []).map((r) => `${r.producto} (${r.dosis_ha} ${r.unidad})`).join(', '),
        receta_json: deduplicarReceta(formData.receta_json || []),
        insumos_json: formData.insumos_json || [],
        labores_json: formData.labores_json || [],
        costo_insumos_usd: costoInsumos,
        costo_labores_usd: costoLabores,
        costo_total_usd: costoTotal,
        // IMPORTANTE: NO ENVIAR columna costo_total (columna GENERATED ALWAYS en Postgres)
        costo_semilla: 0,
        costo_fertilizante: 0,
        costo_fumigacion: 0,
        costo_mano_obra: 0,
        moneda: 'USD',
        tipo_cambio: Number(dolarRef) || 1540,
        observaciones: formData.observaciones || '',
      };

      // SOPORTE MULTI-POTRERO: Si es una operación conjunta en varios potreros
      if (formData.is_multipotrero && Array.isArray(formData.potreros_seleccionados) && formData.potreros_seleccionados.length > 1) {
        const selectedList = formData.potreros_seleccionados;
        const totalHaConjunta = selectedList.reduce((sum, p) => sum + (Number(p.hectareas) || 0), 0) || 1;
        const multiInsertedIds = [];

        for (const pItem of selectedList) {
          const pNum = Number(pItem.numero);
          const pHa = Number(pItem.hectareas) || 1;
          const prop = pHa / totalHaConjunta;

          const insumosProrrateados = (formData.insumos_json || []).map((ins) => ({
            ...ins,
            cantidad: Math.round((Number(ins.cantidad || 0) * prop) * 100) / 100,
            costo_usd: Math.round((Number(ins.costo_usd || 0) * prop) * 100) / 100,
          }));

          const recetaProrrateada = (formData.receta_json || []).map((r) => ({
            ...r,
            total_lote: Math.round((Number(r.dosis_ha || 0) * pHa) * 100) / 100,
          }));

          const laboresProrrateadas = (formData.labores_json || []).map((l) => ({
            ...l,
            subtotal_usd: Math.round((Number(l.costo_ha_usd || 0) * pHa) * 100) / 100,
          }));

          const cIns = insumosProrrateados.reduce((sum, item) => sum + (Number(item.costo_usd) || 0), 0);
          const cLab = laboresProrrateadas.reduce((sum, item) => sum + (Number(item.subtotal_usd) || 0), 0);
          const cTot = cIns + cLab;

          const pPayload = {
            potrero_numero: pNum,
            hectareas: pHa,
            ha_sembradas: pHa,
            vigencia: vigencia,
            cultivo_variedad: formData.cultivo_variedad || 'Pastura / Verdeo',
            variedad_hibrido: formData.variedad_hibrido || '',
            campana: formData.campana || '2026/2027',
            estado: formData.estado || 'Sembrado',
            fecha: formData.fecha || new Date().toISOString().slice(0, 10),
            tarea: formData.cultivo_variedad?.toLowerCase().includes('barbecho') ? 'Barbecho Químico' : 'Siembra Directa',
            insumos_detalle: recetaProrrateada.map((r) => `${r.producto} (${r.dosis_ha} ${r.unidad})`).join(', '),
            receta_json: recetaProrrateada,
            insumos_json: insumosProrrateados,
            labores_json: laboresProrrateadas,
            costo_insumos_usd: cIns,
            costo_labores_usd: cLab,
            costo_total_usd: cTot,
            potreros_detalle: `Operación conjunta en ${selectedList.length} potreros (Total: ${totalHaConjunta} ha)`,
            costo_semilla: 0,
            costo_fertilizante: 0,
            costo_fumigacion: 0,
            costo_mano_obra: 0,
            moneda: 'USD',
            tipo_cambio: Number(dolarRef) || 1540,
            observaciones: `${formData.observaciones ? `${formData.observaciones} · ` : ''}Operación conjunta multi-potrero: ${selectedList.map((s) => `P#${s.numero} (${s.hectareas} ha)`).join(', ')}.`,
          };

          let insertedId = null;
          if (formData.id && pNum === Number(formData.potrero_numero)) {
            await supabase.from('labores_siembras').update(pPayload).eq('id', formData.id);
            insertedId = formData.id;
          } else {
            const { data: insData } = await supabase.from('labores_siembras').insert(pPayload).select('id').single();
            if (insData?.id) insertedId = insData.id;
          }
          if (insertedId) multiInsertedIds.push(insertedId);

          if (isActiva) {
            await supabase
              .from('potreros')
              .update({
                cultivo_actual: pPayload.cultivo_variedad,
                recurso_forrajero: pPayload.cultivo_variedad,
                ha_sembradas: pHa,
                fecha_siembra: pPayload.fecha,
              })
              .eq('numero', pNum);
          }
        }

        // Registrar en audit_logs
        try {
          await registrarAuditLog({
            tipo_operacion: 'SIEMBRA_MULTI_POTRERO',
            modulo: 'Siembras',
            descripcion: `Carga siembra multi-potrero: ${formData.cultivo_variedad || 'Pastura'} en ${selectedList.length} potreros (${totalHaConjunta.toFixed(1)} ha)`,
            afectados_tabla: 'labores_siembras',
            afectados_ids: multiInsertedIds,
            metadata: {
              cultivo: formData.cultivo_variedad,
              potreros: selectedList.map((s) => s.numero),
              hectareas_totales: totalHaConjunta,
            },
          });
        } catch (logErr) {
          console.warn('Error guardando audit log siembra:', logErr);
        }

        notify?.(
          `¡Operación conjunta guardada con éxito en ${selectedList.length} potreros (${totalHaConjunta.toFixed(1)} ha totales)!`,
          'success'
        );
        setModalEditOpen(false);
        setCurrentSiembra(null);
        onRefresh?.();
        return;
      }

      if (formData.id) {
        // Actualizar
        const { error } = await supabase.from('labores_siembras').update(payload).eq('id', formData.id);
        if (error) throw error;
        notify?.('Ficha de siembra actualizada correctamente.', 'success');
      } else {
        // Crear
        const { error } = await supabase.from('labores_siembras').insert(payload);
        if (error) throw error;
        notify?.('Nueva siembra registrada con éxito.', 'success');
      }

      // Sincronizar automáticamente con la tabla potreros solo si está Activa
      if (payload.potrero_numero) {
        if (isActiva) {
          await supabase
            .from('potreros')
            .update({
              cultivo_actual: payload.cultivo_variedad,
              recurso_forrajero: payload.cultivo_variedad,
              ha_sembradas: ha,
              fecha_siembra: payload.fecha,
            })
            .eq('numero', payload.potrero_numero);
        } else {
          // Si pasa a Pasada / Histórica, verificar si hay otra siembra activa en el potrero
          const { data: otrasActivas } = await supabase
            .from('labores_siembras')
            .select('*')
            .eq('potrero_numero', payload.potrero_numero)
            .eq('vigencia', 'Activa')
            .neq('id', formData.id || 0)
            .limit(1);

          if (otrasActivas && otrasActivas.length > 0) {
            const otra = otrasActivas[0];
            await supabase
              .from('potreros')
              .update({
                cultivo_actual: otra.cultivo_variedad,
                recurso_forrajero: otra.cultivo_variedad,
                ha_sembradas: Number(otra.ha_sembradas || otra.hectareas),
                fecha_siembra: otra.fecha,
              })
              .eq('numero', payload.potrero_numero);
          } else {
            await supabase
              .from('potreros')
              .update({
                cultivo_actual: 'Campo Natural',
                recurso_forrajero: 'Campo Natural',
                ha_sembradas: null,
              })
              .eq('numero', payload.potrero_numero);
          }
        }
      }

      setModalEditOpen(false);
      setCurrentSiembra(null);
      onRefresh?.();
    } catch (err) {
      notify?.(`Error al guardar siembra: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Exportar PDF de una siembra específica
  async function handleExportPDF(siembra) {
    const potreroObj = getPotrero(siembra.potrero_numero);
    await exportarFichaSiembraPDF(siembra, potreroObj, {
      fechaOperacion,
      notify,
    });
  }

  // Exportar Estado Forrajero y Costos de Siembras a CSV (Excel)
  function handleExportSiembrasCSV() {
    try {
      if (!siembrasFiltradas || siembrasFiltradas.length === 0) {
        notify?.('No hay siembras cargadas en el filtro actual.', 'error');
        return;
      }

      const headers = effectiveIsAdmin
        ? [
            'Potrero N°',
            'Nombre Potrero',
            'Hectáreas Totales',
            'Hectáreas Implantadas',
            'Campaña',
            'Cultivo / Especie',
            'Fecha Siembra',
            'Estado Forrajero',
            'Días Ocupación / Descanso',
            'Costo Insumos USD',
            'Costo Labores USD',
            'Inversión Total USD',
            'Costo USD / ha',
            'Observaciones',
          ]
        : [
            'Potrero N°',
            'Nombre Potrero',
            'Hectáreas Totales',
            'Hectáreas Implantadas',
            'Campaña',
            'Cultivo / Especie',
            'Fecha Siembra',
            'Estado Forrajero',
            'Días Ocupación / Descanso',
            'Observaciones',
          ];

      const escapeCSV = (val) => {
        if (val == null) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      const rows = siembrasFiltradas.map((s) => {
        const potObj = getPotrero(s.potrero_numero);
        const haPot = Number(potObj?.hectareas) || 0;
        const haImp = Number(s.ha_sembradas || s.hectareas) || haPot;
        const costIns = Number(s.costo_insumos_usd || 0);
        const costLab = Number(s.costo_labores_usd || 0);
        const costTot = Number(s.costo_total_usd || (costIns + costLab));
        const costHa = haImp > 0 ? (costTot / haImp).toFixed(1) : '0';

        let diasStr = '-';
        if (s.fecha_inicio_pastoreo) {
          const hoy = new Date();
          const fPast = new Date(s.fecha_inicio_pastoreo);
          const diffDays = Math.max(0, Math.round((hoy - fPast) / (1000 * 60 * 60 * 24)));
          diasStr = `${diffDays} días`;
        }

        const baseCols = [
          s.potrero_numero === 2 ? '2/3' : s.potrero_numero === 38 ? 'NN' : s.potrero_numero,
          escapeCSV(potObj?.nombre || `Potrero ${s.potrero_numero}`),
          haPot.toFixed(1),
          haImp.toFixed(1),
          escapeCSV(s.campana || '2026/2027'),
          escapeCSV(s.cultivo_variedad || s.cultivo || ''),
          s.fecha_siembra || s.fecha || '',
          escapeCSV(s.estado || 'Activa'),
          diasStr,
        ];

        if (effectiveIsAdmin) {
          baseCols.push(
            costIns.toFixed(2),
            costLab.toFixed(2),
            costTot.toFixed(2),
            costHa
          );
        }

        baseCols.push(escapeCSV(s.observaciones || ''));
        return baseCols.join(';');
      });

      const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const nowIso = new Date().toISOString().slice(0, 10);
      link.setAttribute('href', url);
      link.setAttribute('download', `siembras_pasturas_san_jose_${nowIso}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      notify?.(`¡Listado de Siembras exportado a Excel/CSV! (${siembrasFiltradas.length} lotes)`, 'success');
    } catch (err) {
      console.error('Error exportando CSV de siembras:', err);
      notify?.(`Error al exportar CSV: ${err.message}`, 'error');
    }
  }

  // Pre-completar desde Gemini IA
  function handleAplicarRecetaIA(datosIA) {
    const potreroNum = datosIA.potrero_numero || potreros[0]?.numero || 1;
    const potreroObj = getPotrero(potreroNum);
    const ha = Number(potreroObj?.hectareas) || 40;
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    const isARS = datosIA.moneda === 'ARS';

    // Convertir productos de receta
    const receta = (datosIA.receta_productos || []).map((r) => ({
      producto: r.producto || '',
      dosis_ha: Number(r.dosis_ha) || 0,
      unidad: r.unidad || 'L',
      total_lote: (Number(r.dosis_ha) || 0) * ha,
      funcion: r.funcion || '',
    }));

    // Convertir insumos aplicados
    const insumos = (datosIA.insumos_aplicados || []).map((ins) => {
      let cUsd = Number(ins.costo_usd) || 0;
      if (isARS && cUsd > 1000) cUsd = Number((cUsd / tc).toFixed(2));
      return {
        fecha: ins.fecha || datosIA.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
        remito: ins.remito || datosIA.remito_numero || '',
        proveedor: ins.proveedor || datosIA.ingeniero_o_proveedor || '',
        producto: ins.producto || '',
        cantidad: Number(ins.cantidad) || 0,
        unidad: ins.unidad || 'L',
        dosis_real: Number(ins.dosis_real) || (ha > 0 ? (Number(ins.cantidad) || 0) / ha : 0),
        costo_usd: cUsd,
      };
    });

    // Convertir labores
    const labores = (datosIA.labores_sugeridas || []).map((lab) => {
      let cHaUsd = Number(lab.costo_ha_usd) || 0;
      if (isARS && cHaUsd > 1000) cHaUsd = Number((cHaUsd / tc).toFixed(2));
      const sUsd = Number((cHaUsd * ha).toFixed(2));
      return {
        fecha: lab.fecha || datosIA.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
        labor: lab.labor || 'Siembra Directa',
        contratista: lab.contratista || 'Equipo propio',
        costo_ha_usd: cHaUsd,
        subtotal_usd: sUsd,
      };
    });

    setCurrentSiembra({
      potrero_numero: potreroNum,
      hectareas: ha,
      cultivo_variedad: datosIA.cultivo_variedad || '',
      variedad_hibrido: datosIA.variedad_hibrido || '',
      campana: datosIA.campana || '2026/2027',
      estado: datosIA.estado || 'Sembrado',
      fecha: datosIA.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
      receta_json: receta,
      insumos_json: insumos,
      labores_json: labores,
      costo_insumos_usd: insumos.reduce((sum, i) => sum + (Number(i.costo_usd) || 0), 0),
      costo_labores_usd: labores.reduce((sum, l) => sum + (Number(l.subtotal_usd) || 0), 0),
      costo_total_usd: 0,
      observaciones: datosIA.observaciones || `Cargado con Gemini IA desde ${datosIA.tipo_documento || 'documento'}.`,
    });

    setModalIaOpen(false);
    setModalEditOpen(true);
    notify?.('Datos de receta/remito procesados por IA. Verificá y confirmá los valores.', 'success');
  }

  // Confirmar descuento de stock
  async function handleConfirmDeductStock(insumoItem, stockId, cantidadDeducir) {
    try {
      const stockSelected = stockInsumos.find((s) => s.id === Number(stockId));
      if (!stockSelected) {
        notify?.('Seleccioná un insumo válido del inventario.', 'error');
        return;
      }

      const cantActual = Number(stockSelected.cantidad_actual) || 0;
      const cantRestar = Number(cantidadDeducir) || 0;
      const nuevaCantidad = Math.max(0, cantActual - cantRestar);

      const { error } = await supabase
        .from('stock_insumos')
        .update({
          cantidad_actual: nuevaCantidad,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stockSelected.id);

      if (error) throw error;

      notify?.(
        `Descontados ${cantRestar} ${stockSelected.unidad} de "${stockSelected.nombre}". Stock restante: ${nuevaCantidad}.`,
        'success'
      );
      setModalStockOpen(false);
      setStockItemToDeduct(null);
      onRefresh?.();
    } catch (err) {
      notify?.(`Error al descontar stock: ${err.message}`, 'error');
    }
  }

  // Confirmar asiento en gastos
  async function handleConfirmRecordExpense(insumoItem, siembraObj) {
    try {
      const usd = Number(insumoItem.costo_usd) || 0;
      const tc = Number(dolarRef) || 1540;
      const ars = Math.round(usd * tc);

      const payload = {
        fecha: insumoItem.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
        rubro: 'Insumos Agrícolas / Siembras',
        concepto: `${insumoItem.producto || 'Insumo'} (${insumoItem.cantidad || 0} ${insumoItem.unidad || ''}) - Lote P#${siembraObj.potrero_numero} (${siembraObj.cultivo_variedad})`,
        proveedor: insumoItem.proveedor || 'Agronomía',
        comprobante: insumoItem.remito ? `Remito ${insumoItem.remito}` : 'Receta / Remito',
        moneda_carga: 'USD',
        tipo_cambio: tc,
        monto_original: usd,
        monto_usd: usd,
        monto_ars: ars,
        potrero_numero: Number(siembraObj.potrero_numero),
        rodeo_nombre: null,
        estado_pago: 'Pendiente',
        observaciones: `Asentado automáticamente desde módulo Siembras. Campaña ${siembraObj.campana || '2026/2027'}.`,
      };

      const { error } = await supabase.from('gastos_campo').insert(payload);
      if (error) throw error;

      notify?.(`Gasto de USD $${usd.toLocaleString('es-AR')} asentado en Finanzas con éxito.`, 'success');
      setModalGastoOpen(false);
      setGastoItemToRecord(null);
      onRefresh?.();
    } catch (err) {
      notify?.(`Error al asentar gasto: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6 pb-20">
      {/* 1. CABECERA EJECUTIVA Y BOTONES PRINCIPALES */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-800 shrink-0">
                <Sprout className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span>Gestión Integral de Siembras & Lotes</span>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Campaña {campanaFiltro}
                  </span>
                </h1>
                <p className="text-xs text-slate-600 font-medium">
                  Planificación agronómica · Recetas del ingeniero · Remitos y aplicaciones · Labores · Costos USD/ha
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            {/* Control 1 — Botón Primario de Carga Manual (verde sólido #14532d) */}
            <button
              type="button"
              onClick={handleNuevaSiembra}
              className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f4023] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
              title="Registrar una nueva siembra o lote de forma manual"
            >
              <Plus className="w-4 h-4" />
              <span>+ Nueva Siembra</span>
            </button>

            {/* Control 2 — Botón Paso 1: Cargar Receta / Labores del Lote */}
            <button
              type="button"
              onClick={() => {
                setCruzarTargetSiembra(null);
                setModalIaModo('receta');
                setModalIaOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 hover:from-slate-800 hover:to-emerald-900 text-white font-extrabold text-xs flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
              title="Cargar recetas agronómicas (RAO / MDA / prescripción) o planillas de labores de contratistas"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>🌱 1. Cargar Receta / Labores</span>
            </button>

            {/* Control 2.5 — Botón Paso 2: Cargar Lista de Precios / Factura */}
            <button
              type="button"
              onClick={() => {
                setCruzarTargetSiembra(null);
                setModalIaModo('factura');
                setModalIaOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-950/80 hover:bg-amber-900 text-amber-200 hover:text-white font-extrabold text-xs flex items-center gap-1.5 border border-amber-500/50 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
              title="Cargar factura de Cooperativa, presupuesto o lista de precios para valorizar insumos y cruzar con los lotes"
            >
              <Receipt className="w-4 h-4 text-amber-400" />
              <span>🧾 2. Cargar Precios / Factura</span>
            </button>

            {/* Control 2.6 — Botón Catálogo de Presupuestos */}
            <button
              type="button"
              onClick={() => setModalCatalogoPresupuestosOpen(true)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition active:scale-95 cursor-pointer shrink-0"
              title="Ver presupuestos y listas de precios de cooperativa guardadas"
            >
              <Receipt className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Catálogo Presupuestos</span>
            </button>

            {/* Control 3 — Menú Desplegable Compacto (Acciones ▾) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuAccionesOpen(!menuAccionesOpen)}
                className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer shrink-0"
              >
                <span>Acciones</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {menuAccionesOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setMenuAccionesOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-50 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAccionesOpen(false);
                        handleExportSiembrasCSV();
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-semibold cursor-pointer transition"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>📊 Exportar Excel (.xlsx / CSV)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMenuAccionesOpen(false);
                        setModalRaoOpen(true);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-semibold cursor-pointer transition"
                    >
                      <ClipboardList className="w-4 h-4 text-teal-600 shrink-0" />
                      <span>📋 Receta Agronómica (RAO MDA)</span>
                    </button>

                    {effectiveIsAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuAccionesOpen(false);
                          setModalCatalogoPresupuestosOpen(true);
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-semibold cursor-pointer transition"
                      >
                        <Receipt className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>📋 Catálogo de Presupuestos</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setMenuAccionesOpen(false);
                        if (onNavigate) {
                          onNavigate('mapa');
                        } else {
                          notify?.('Navegando a Mapa de Potreros.', 'info');
                        }
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-semibold cursor-pointer transition"
                    >
                      <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>🗺️ Sincronizar / Ver en Mapa</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 3 TARJETAS KPI EJECUTIVAS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-5">
          {/* KPI 1: Superficie Sembrada */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex items-center justify-between shadow-xs">
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {vigenciaFiltro === 'Activa'
                  ? 'Superficie Implantada Activa en Mapa'
                  : vigenciaFiltro === 'Pasada / Histórica'
                  ? 'Superficie Histórica / Reemplazada'
                  : 'Superficie Total Registrada'}
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums tracking-tight">
                {kpis.haTotal.toLocaleString('es-AR', { maximumFractionDigits: 1 })}{' '}
                <span className="text-sm font-bold text-emerald-700">ha</span>
              </div>
              <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${vigenciaFiltro === 'Activa' ? 'bg-emerald-600' : 'bg-amber-500'}`} />
                <span>
                  {kpis.lotesActivos}{' '}
                  {vigenciaFiltro === 'Activa'
                    ? 'lotes activos en mapa'
                    : vigenciaFiltro === 'Pasada / Histórica'
                    ? 'lotes históricos / archivados'
                    : 'registros de siembra'}
                </span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-800 shrink-0">
              <Sprout className="w-6 h-6" />
            </div>
          </div>

          {/* KPI 2: Inversión Agrícola Acumulada (Modo Admin) vs Estado de Etapas Agronómicas (Modo Producción) */}
          {effectiveIsAdmin ? (
            <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex items-center justify-between shadow-xs">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <span>Inversión Agrícola Acumulada</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">Admin</span>
                </span>
                <div className="text-2xl font-black text-slate-900 tabular-nums tracking-tight">
                  <span className="text-sm font-bold text-emerald-700 mr-1">USD $</span>
                  {Math.round(kpis.invTotalUSD).toLocaleString('es-AR')}
                </div>
                <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-emerald-800">
                    USD ${kpis.usdPorHaPromedio.toFixed(1)}/ha
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-semibold text-slate-700">ARS ${Math.round(kpis.invTotalUSD * (Number(dolarRef) || 1665)).toLocaleString('es-AR')}</span>
                  <span className="text-slate-400">·</span>
                  <span>Ins: ${Math.round(kpis.costoInsumosUSD).toLocaleString('es-AR')}</span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                <DollarSign className="w-6 h-6" />
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex items-center justify-between shadow-xs">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <Tractor className="w-3.5 h-3.5 text-emerald-800" />
                  <span>Estado de Etapas Agronómicas</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold">Campo</span>
                </span>
                <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-baseline gap-2">
                  <span>{kpis.sembradoCount} Sembrados</span>
                  <span className="text-slate-400 font-normal text-base">·</span>
                  <span className="text-sky-800 text-lg font-bold">{kpis.enPastoreoCount} Pastoreo</span>
                </div>
                <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1.5 flex-wrap">
                  <span className="text-amber-800 font-bold">{kpis.barbechoCount} barbecho</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-800 font-semibold">{kpis.totalLaboresCount} labores registradas</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-emerald-800 font-semibold">{kpis.totalRecetasCount} productos técnicos</span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-800 shrink-0">
                <Tractor className="w-6 h-6" />
              </div>
            </div>
          )}

          {/* KPI 3: Lotes Activos en Campaña */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex items-center justify-between shadow-xs">
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {vigenciaFiltro === 'Activa' ? 'Lotes Activos en Mapa' : 'Lotes Filtrados'}
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums tracking-tight">
                {kpis.lotesActivos}{' '}
                <span className="text-sm font-semibold text-slate-600">lotes</span>
              </div>
              <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1.5">
                <span className="text-emerald-800 font-bold">{kpis.conReceta} con receta técnica</span>
                <span className="text-slate-500">·</span>
                <span className="text-sky-800 font-bold">{kpis.enPastoreo} en pastoreo</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0">
              <Layers className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* RESUMEN DINÁMICO POR CULTIVO / PASTURA (SIEMBRAS ACTIVAS) */}
        <div className="mt-5 pt-4 border-t border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sprout className="w-3.5 h-3.5 text-emerald-800" />
              {vigenciaFiltro === 'Activa'
                ? `Hectáreas Activas en Mapa por Pastura / Especie (${resumenPorCultivo.totalHaActivas.toFixed(1)} ha):`
                : vigenciaFiltro === 'Pasada / Histórica'
                ? `Hectáreas Históricas / Reemplazadas (${resumenPorCultivo.totalHaActivas.toFixed(1)} ha):`
                : `Hectáreas Totales Registradas por Especie (${resumenPorCultivo.totalHaActivas.toFixed(1)} ha):`}
            </span>
            {cultivoFiltro !== 'TODOS' && (
              <button
                type="button"
                onClick={() => setCultivoFiltro('TODOS')}
                className="text-[10px] text-amber-950 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg font-bold hover:bg-amber-200 cursor-pointer"
              >
                Limpiar filtro ({cultivoFiltro})
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pb-1 text-xs">
            <button
              type="button"
              onClick={() => setCultivoFiltro('TODOS')}
              className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 cursor-pointer ${
                cultivoFiltro === 'TODOS'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
              }`}
            >
              🌱 Todas ({resumenPorCultivo.totalHaActivas.toFixed(0)} ha)
            </button>

            {resumenPorCultivo.lista.map(([cultivo, ha]) => {
              const isSelected = cultivoFiltro.toLowerCase() === cultivo.toLowerCase();
              return (
                <button
                  key={cultivo}
                  type="button"
                  onClick={() => setCultivoFiltro(isSelected ? 'TODOS' : cultivo)}
                  className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-emerald-800 text-white font-bold shadow-xs'
                      : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  <span>{cultivo}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                      isSelected ? 'bg-emerald-950 text-white' : 'bg-slate-200 text-slate-800 font-bold'
                    }`}
                  >
                    {ha.toFixed(1)} ha
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* FILTROS Y BÚSQUEDA */}
        <div className="mt-4 pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtro Primario: Vigencia / Estado en Mapa */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition ${
                vigenciaFiltro === 'Activa'
                  ? 'bg-emerald-50 border-emerald-300 shadow-xs'
                  : 'bg-slate-100 border-slate-200'
              }`}
            >
              <span className="text-[11px] font-bold text-slate-600">Estado:</span>
              <select
                value={vigenciaFiltro}
                onChange={(e) => setVigenciaFiltro(e.target.value)}
                className={`bg-transparent text-xs font-bold focus:outline-none cursor-pointer ${
                  vigenciaFiltro === 'Activa' ? 'text-emerald-800 font-bold' : 'text-slate-700'
                }`}
              >
                <option value="Activa" className="bg-white text-emerald-800 font-bold">
                  🌱 Activas en mapa
                </option>
                <option value="Pasada / Histórica" className="bg-white text-slate-800 font-semibold">
                  📜 Históricas / Reemplazadas
                </option>
                <option value="TODAS" className="bg-white text-slate-800 font-semibold">
                  Todas (Archivo completo)
                </option>
              </select>
            </div>

            {/* Filtro Campaña */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-300">Campaña:</span>
              <select
                value={campanaFiltro}
                onChange={(e) => setCampanaFiltro(e.target.value)}
                className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                {CAMPANAS_DISPONIBLES.map((c) => (
                  <option key={c} value={c} className="bg-slate-900 text-white">
                    {c}
                  </option>
                ))}
                <option value="TODAS" className="bg-slate-900 text-white">
                  Todas las campañas
                </option>
              </select>
            </div>

            {/* Filtro Etapa / Estado fenológico */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-300">Etapa:</span>
              <select
                value={estadoFiltro}
                onChange={(e) => setEstadoFiltro(e.target.value)}
                className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                <option value="TODOS" className="bg-slate-900 text-white">
                  Todas las etapas
                </option>
                {ESTADOS_SIEMBRA.map((est) => (
                  <option key={est} value={est} className="bg-slate-900 text-white">
                    {est}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro Especie / Pastura Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1.5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-600">Pastura:</span>
              <select
                value={cultivoFiltro}
                onChange={(e) => setCultivoFiltro(e.target.value)}
                className="bg-transparent text-xs font-bold text-emerald-800 focus:outline-none cursor-pointer"
              >
                <option value="TODOS" className="bg-white text-slate-900">
                  Todas las especies
                </option>
                {resumenPorCultivo.lista.map(([c, ha]) => (
                  <option key={c} value={c} className="bg-white text-slate-900">
                    {c} ({ha.toFixed(1)} ha)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Buscador */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar potrero, cultivo, variedad..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 transition"
            />
          </div>
        </div>
      </div>

      {/* 2. TARJETAS GRANDES Y EDITABLES POR SIEMBRA / POTRERO */}
      {siembrasFiltradas.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center space-y-4 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto">
            <Sprout className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900">No hay siembras registradas</h3>
            <p className="text-xs text-slate-400">
              No encontramos fichas de siembra para los filtros seleccionados. Creá una nueva o cargá una receta con IA.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleNuevaSiembra}
              className="px-4 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f4023] text-white font-bold text-xs flex items-center gap-2 shadow-sm cursor-pointer transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>+ Nueva Siembra</span>
            </button>
            <button
              type="button"
              onClick={() => setModalIaOpen(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 hover:from-slate-800 hover:to-emerald-900 text-white font-extrabold text-xs flex items-center gap-2 cursor-pointer transition border border-emerald-500/40 shadow-sm active:scale-95"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>✨ Importar con IA</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {siembrasFiltradas.map((siembra) => {
            const potreroObj = getPotrero(siembra.potrero_numero);
            const potreroHa = Number(potreroObj?.hectareas) || 0;
            const ha = Number(siembra.ha_sembradas || siembra.hectareas) || potreroHa || 0;
            const esParcial = potreroHa > 0 && ha < potreroHa - 0.05;
            const isArchivada = siembra.archivado === true || siembra.archivada === true || siembra.activa_en_mapa === false ||
              ['archivado', 'archivada', 'historico', 'historica', 'pasada / histórica', 'pasada', 'finalizado', 'finalizada'].includes(String(siembra.estado || '').toLowerCase().trim()) ||
              ['pasada / histórica', 'pasada', 'historica', 'historico', 'archivada', 'archivado'].includes(String(siembra.vigencia || '').toLowerCase().trim());
            const isActiva = !isArchivada;

            const receta = deduplicarReceta(Array.isArray(siembra.receta_json) ? siembra.receta_json : []);
            const insumos = Array.isArray(siembra.insumos_json) ? siembra.insumos_json : [];
            const labores = Array.isArray(siembra.labores_json) ? siembra.labores_json : [];

            // Suma real y exacta de subtotales de cada fila calculada en vivo
            // Priorizar insumos reales y evitar duplicar productos de la receta técnica
            const itemsInsumosUnificados = insumos.length > 0 ? insumos : receta;
            const sumInsumosRows = itemsInsumosUnificados.reduce((acc, it) => acc + (calcularRenglonInsumo(it, ha, dolarRef).subtotalUsd || 0), 0);
            const sumLaboresRows = labores.reduce((acc, it) => acc + (calcularRenglonLabor(it, ha, dolarRef).subtotalUsd || 0), 0);

            const cInsumos = sumInsumosRows > 0 ? Math.round(sumInsumosRows * 100) / 100 : (Number(siembra.costo_insumos_usd) || 0);
            const cLabores = sumLaboresRows > 0 ? Math.round(sumLaboresRows * 100) / 100 : (Number(siembra.costo_labores_usd) || 0);
            const cTotal = Math.round((cInsumos + cLabores) * 100) / 100;
            const usdPorHa = ha > 0 ? cTotal / ha : 0;
            const insPorHa = ha > 0 ? cInsumos / ha : 0;
            const labPorHa = ha > 0 ? cLabores / ha : 0;

            // Limpieza estricta de sector (no mostrar 'vacio', 'null', 'sin especificar')
            const sectorValido = siembra.sector && !/^(vacio|vacío|null|undefined|sin especificar|none|no especificado|n\/a|general|-)$/i.test(String(siembra.sector).trim()) ? String(siembra.sector).trim() : '';

            // Color del badge de estado
            const estadoColors = {
              Barbecho: 'bg-amber-100 text-amber-950 border-amber-300 font-semibold',
              Sembrado: 'bg-emerald-100 text-emerald-950 border-emerald-300 font-semibold',
              'En Pastoreo': 'bg-blue-100 text-blue-950 border-blue-300 font-semibold',
              Cosechado: 'bg-purple-100 text-purple-950 border-purple-300 font-semibold',
            }[siembra.estado || 'Sembrado'] || 'bg-slate-100 text-slate-800 border-slate-300 font-semibold';

            return (
              <div
                key={siembra.id}
                id={`siembra-card-${siembra.id}`}
                className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden hover:border-slate-300 transition"
              >
                {/* CABECERA DE LA TARJETA */}
                <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="px-3 py-1.5 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 font-black text-sm tracking-wide">
                      P#{siembra.potrero_numero}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-slate-900 tracking-tight">
                          {potreroObj?.nombre || `Potrero #${siembra.potrero_numero}`}
                        </h2>
                        {esParcial ? (
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 border border-amber-300 font-semibold"
                            title={`Siembra parcial: ${ha.toFixed(1)} ha sobre ${potreroHa.toFixed(1)} ha totales del potrero`}
                          >
                            ⚠️ {ha.toFixed(1)} / {potreroHa.toFixed(1)} ha {sectorValido ? `· Sector ${sectorValido}` : '(Parcial)'}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                            {ha.toFixed(1)} ha {sectorValido ? `· Sector ${sectorValido}` : ''}
                          </span>
                        )}
                        {isActiva ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                            🌱 Activa en Mapa
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1">
                            📜 Histórica
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 font-medium flex items-center gap-2 mt-0.5">
                        <span className="font-bold text-emerald-800">{siembra.cultivo_variedad}</span>
                        {siembra.variedad_hibrido && (
                          <>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-700 font-mono text-[11px] font-medium">{siembra.variedad_hibrido}</span>
                          </>
                        )}
                        <span className="text-slate-500">·</span>
                        <span>Fecha: {formatFechaAR(siembra.fecha)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Botón Cruzar Factura / Insumos IA (Solo Modo Admin / Gestión) */}
                    {effectiveIsAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setCruzarTargetSiembra(siembra);
                          setModalIaModo('cruzar');
                          setModalIaOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold flex items-center gap-1.5 border border-amber-300 cursor-pointer transition shadow-2xs"
                        title={`Cruzar factura o presupuesto de la Cooperativa e imputar insumos/precios a P#${siembra.potrero_numero}`}
                      >
                        <Receipt className="w-3.5 h-3.5 text-amber-700" />
                        <span>📎 Cruzar Factura / Presupuesto</span>
                      </button>
                    )}

                    {/* Botón cambiar vigencia rápida (Activa vs Histórica) */}
                    <button
                      type="button"
                      onClick={() => handleToggleVigencia(siembra)}
                      className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 border cursor-pointer transition ${
                        isActiva
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                      }`}
                      title={isActiva ? 'Archivar siembra (deja de sobreescribir el mapa de potreros)' : 'Activar siembra en el mapa'}
                    >
                      <span>{isActiva ? '📜 Archivar' : '🌱 Pasar a Activa'}</span>
                    </button>

                    {/* Selector rápido de estado */}
                    <div className="flex items-center gap-1.5">
                      <select
                        value={siembra.estado || 'Sembrado'}
                        onChange={(e) => handleCambiarEstadoRapido(siembra, e.target.value)}
                        className={`text-xs font-bold px-2.5 py-1 rounded-xl border focus:outline-none cursor-pointer transition ${estadoColors}`}
                      >
                        {ESTADOS_SIEMBRA.map((st) => (
                          <option key={st} value={st} className="bg-white text-slate-900">
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Botón editar ficha completa */}
                    <button
                      type="button"
                      onClick={() => handleEditSiembra(siembra)}
                      className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5 border border-slate-200 cursor-pointer transition"
                      title="Editar todos los campos"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-emerald-800" />
                      <span>Editar</span>
                    </button>

                    {/* Botón eliminar */}
                    <button
                      type="button"
                      onClick={() => handleDeleteSiembra(siembra.id, siembra.potrero_numero)}
                      className="p-1 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-200 cursor-pointer transition"
                      title="Eliminar siembra"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 4 SECCIONES INTERNAS */}
                <div className="p-5 space-y-6">
                  {/* SECCIÓN 1: Identificación y Estado */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-600">Cultivo / Pastura</span>
                      <div className="font-bold text-slate-900 truncate">{siembra.cultivo_variedad}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-600">Variedad / Híbrido</span>
                      <div className="font-bold text-slate-900 truncate">{siembra.variedad_hibrido || 'No especificada'}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-600">Campaña Agrícola</span>
                      <div className="font-bold text-emerald-800">{siembra.campana || '2026/2027'}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-600">Fecha de Inicio / Siembra</span>
                      <div className="font-bold text-slate-900">{formatFechaAR(siembra.fecha)}</div>
                    </div>
                  </div>

                  {/* SECCIÓN 2: Receta Agronómica (Ingeniero) */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div
                      onClick={() => toggleSection(siembra.id, 'receta')}
                      className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2">
                        <Droplets className="w-4 h-4 text-emerald-800" />
                        <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Receta Agronómica (Ingeniero)
                        </span>
                        <span className="text-[11px] px-2 py-0.2 rounded-full bg-slate-200 text-slate-800 font-bold">
                          {receta.length} {receta.length === 1 ? 'producto' : 'productos'}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        {isSectionOpen(siembra.id, 'receta') ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>

                    {isSectionOpen(siembra.id, 'receta') && (
                      <div className="p-3.5">
                        {receta.length === 0 ? (
                          <div className="py-4 text-center text-xs text-slate-600 italic">
                            Sin receta agronómica cargada para este lote.{' '}
                            <button
                              type="button"
                              onClick={() => handleEditSiembra(siembra)}
                              className="text-emerald-800 underline font-semibold cursor-pointer ml-1"
                            >
                              + Agregar receta
                            </button>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                                  <th className="pb-2">Producto Prescripto</th>
                                  <th className="pb-2">Función / Tipo</th>
                                  <th className="pb-2 text-right">Dosis / ha</th>
                                  <th className="pb-2">Unidad</th>
                                  <th className="pb-2 text-right">Total Lote ({ha.toFixed(1)} ha)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {receta.map((r, idx) => {
                                  const dosis = Number(r.dosis_ha) || 0;
                                  const totalCalc = dosis * ha;
                                  return (
                                    <tr key={idx} className="hover:bg-slate-50 transition">
                                      <td className="py-2.5 font-bold text-slate-900">{r.producto}</td>
                                      <td className="py-2.5 text-slate-700 font-medium">{r.funcion || 'Agroquímico / Insumo'}</td>
                                      <td className="py-2.5 text-right font-mono text-emerald-900 font-bold">
                                        {dosis.toLocaleString('es-AR')}
                                      </td>
                                      <td className="py-2.5 text-slate-700 font-medium">{r.unidad || 'L'}</td>
                                      <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                                        {totalCalc.toLocaleString('es-AR', { maximumFractionDigits: 1 })}{' '}
                                        <span className="text-[10px] text-slate-600 font-medium">{r.unidad || 'L'}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* SECCIÓN 3: Insumos y Remitos Aplicados */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div
                      onClick={() => toggleSection(siembra.id, 'insumos')}
                      className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Receipt className="w-4 h-4 text-emerald-800" />
                        <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Insumos y Remitos Aplicados
                        </span>
                        <span className="text-[11px] px-2 py-0.2 rounded-full bg-slate-200 text-slate-800 font-bold">
                          {effectiveIsAdmin
                            ? `${insumos.length} aplicaciones · USD $${Math.round(cInsumos).toLocaleString('es-AR')}`
                            : `${insumos.length} ${insumos.length === 1 ? 'aplicación registrada' : 'aplicaciones registradas'}`}
                        </span>
                        {insumos.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCleanSiembraInsumos(siembra);
                            }}
                            className="ml-1 sm:ml-2 px-2 py-0.5 rounded-lg text-[10.5px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1 transition shadow-2xs cursor-pointer"
                            title="Eliminar automáticamente duplicados, ítems de sobrante y semillas incompatibles"
                          >
                            <span>🧹 Limpiar duplicados / sobrantes</span>
                          </button>
                        )}
                      </div>
                      <div className="text-slate-600">
                        {isSectionOpen(siembra.id, 'insumos') ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>

                    {isSectionOpen(siembra.id, 'insumos') && (
                      <div className="p-3.5">
                        {insumos.length === 0 ? (
                          <div className="py-4 text-center text-xs text-slate-600 italic">
                            Sin remitos ni insumos aplicados registrados aún.{' '}
                            <button
                              type="button"
                              onClick={() => handleEditSiembra(siembra)}
                              className="text-emerald-800 underline font-semibold cursor-pointer ml-1"
                            >
                              + Cargar remito / aplicación
                            </button>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                                  <th className="pb-2">Fecha</th>
                                  <th className="pb-2">N° Remito / Proveedor</th>
                                  <th className="pb-2">Producto</th>
                                  <th className="pb-2 text-right">Cantidad Total</th>
                                  <th className="pb-2 text-right">Dosis Real/ha</th>
                                  {effectiveIsAdmin && <th className="pb-2 text-right">Subtotal</th>}
                                  <th className="pb-2 text-center w-10">Acción</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {insumos.map((ins, idx) => {
                                  const cant = Math.round((Number(ins.cantidad) || 0) * 100) / 100;
                                  const dosisReal = Math.round((Number(ins.dosis_real) || (ha > 0 ? cant / ha : 0)) * 100) / 100;
                                  const costoUsd = Math.round((Number(ins.costo_usd) || 0) * 100) / 100;
                                  const costoArs = ins.costo_ars ? Math.round(Number(ins.costo_ars) * 100) / 100 : Math.round(costoUsd * (Number(dolarRef) || 1665) * 100) / 100;

                                  return (
                                    <tr key={idx} className="hover:bg-slate-50 transition">
                                      <td className="py-2.5 text-slate-700 font-medium whitespace-nowrap">{formatFechaAR(ins.fecha)}</td>
                                      <td className="py-2.5">
                                        <div className="font-bold text-slate-900">{ins.remito || 'S/N'}</div>
                                        <div className="text-[11px] text-slate-600 font-medium">{ins.proveedor || '-'}</div>
                                      </td>
                                      <td className="py-2.5 font-bold text-emerald-900">{ins.producto}</td>
                                      <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                                        {cant.toLocaleString('es-AR')}{' '}
                                        <span className="text-[10px] text-slate-600 font-medium">{ins.unidad || 'L'}</span>
                                      </td>
                                      <td className="py-2.5 text-right font-mono text-slate-700 font-medium">
                                        {dosisReal.toFixed(2)}{' '}
                                        <span className="text-[10px] text-slate-600">{ins.unidad || 'L'}/ha</span>
                                      </td>
                                      {effectiveIsAdmin && (
                                        <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                                          {ins.moneda === 'ARS' ? (
                                            <div>
                                              <div className="text-emerald-900 font-black">ARS ${Math.round(costoArs).toLocaleString('es-AR')}</div>
                                              <div className="text-[10px] text-slate-500 font-normal">≈ USD ${costoUsd.toLocaleString('es-AR')}</div>
                                            </div>
                                          ) : (
                                            <div>
                                              <div className="text-slate-900 font-black">USD ${costoUsd.toLocaleString('es-AR')}</div>
                                              <div className="text-[10px] text-slate-500 font-normal">≈ ARS ${Math.round(costoArs).toLocaleString('es-AR')}</div>
                                            </div>
                                          )}
                                        </td>
                                      )}
                                      <td className="py-2.5 text-center">
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteInsumoFromSiembra(siembra, idx)}
                                          className="p-1 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 transition cursor-pointer"
                                          title={`Eliminar ${ins.producto} de esta siembra`}
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
                    )}
                  </div>

                  {/* SECCIÓN 4: Labores Realizadas */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div
                      onClick={() => toggleSection(siembra.id, 'labores')}
                      className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2">
                        <Tractor className="w-4 h-4 text-indigo-800" />
                        <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Labores Agrícolas Realizadas
                        </span>
                        <span className="text-[11px] px-2 py-0.2 rounded-full bg-slate-200 text-slate-800 font-bold">
                          {effectiveIsAdmin
                            ? `${labores.length} labores · USD ${Math.round(cLabores).toLocaleString('es-AR')}`
                            : `${labores.length} ${labores.length === 1 ? 'labor ejecutada' : 'labores ejecutadas'}`}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        {isSectionOpen(siembra.id, 'labores') ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>

                    {isSectionOpen(siembra.id, 'labores') && (
                      <div className="p-3.5">
                        {labores.length === 0 ? (
                          <div className="py-4 text-center text-xs text-slate-600 italic">
                            Sin labores registradas para este lote.{' '}
                            <button
                              type="button"
                              onClick={() => handleEditSiembra(siembra)}
                              className="text-indigo-800 underline font-semibold cursor-pointer ml-1"
                            >
                              + Cargar labor
                            </button>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                                  <th className="pb-2">Fecha</th>
                                  <th className="pb-2">Labor Realizada</th>
                                  <th className="pb-2">Contratista / Equipo</th>
                                  {effectiveIsAdmin ? (
                                    <>
                                      <th className="pb-2 text-right">Costo USD/ha</th>
                                      <th className="pb-2 text-right">Subtotal USD</th>
                                    </>
                                  ) : (
                                    <th className="pb-2 text-right">Superficie Trabajada</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {labores.map((lab, idx) => {
                                  const cHa = Number(lab.costo_ha_usd) || 0;
                                  const sub = Number(lab.subtotal_usd) || cHa * ha;
                                  const labHa = Number(lab.ha !== undefined && lab.ha !== '' ? lab.ha : ha) || ha;

                                  return (
                                    <tr key={idx} className="hover:bg-slate-50 transition">
                                      <td className="py-2.5 text-slate-700 font-medium whitespace-nowrap">{lab.fecha || '-'}</td>
                                      <td className="py-2.5 font-bold text-slate-900">{lab.labor}</td>
                                      <td className="py-2.5 text-slate-700 font-medium">{lab.contratista || 'Propio'}</td>
                                      {effectiveIsAdmin ? (
                                        <>
                                          <td className="py-2.5 text-right font-mono font-bold text-slate-800">
                                            USD ${cHa.toFixed(2)}/ha
                                          </td>
                                          <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                                            USD ${Math.round(sub).toLocaleString('es-AR')}
                                          </td>
                                        </>
                                      ) : (
                                        <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                                          {labHa.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">ha</span>
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. RESUMEN: ECONÓMICO (MODO ADMIN) VS TÉCNICO-OPERATIVO (MODO PRODUCCIÓN) */}
                <div className="bg-slate-950 px-5 py-4 border-t border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {effectiveIsAdmin ? (
                    /* Desglose de Costos (Modo Admin) */
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-300 block">Insumos</span>
                        <span className="font-bold text-white font-mono">
                          USD ${Math.round(cInsumos).toLocaleString('es-AR')}
                        </span>
                        <span className="text-[11px] text-slate-300 ml-1">(${insPorHa.toFixed(1)}/ha)</span>
                      </div>

                      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-300 block">Labores</span>
                        <span className="font-bold text-white font-mono">
                          USD ${Math.round(cLabores).toLocaleString('es-AR')}
                        </span>
                        <span className="text-[11px] text-slate-300 ml-1">(${labPorHa.toFixed(1)}/ha)</span>
                      </div>

                      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

                      <div className="bg-emerald-500/10 px-3.5 py-2 rounded-xl border border-emerald-500/25">
                        <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">
                          Costo Total Lote ({ha.toFixed(1)} ha)
                        </span>
                        <div className="flex flex-wrap items-baseline gap-2 mt-0.5">
                          <span className="text-base font-black text-white font-mono tracking-tight">
                            USD ${Math.round(cTotal).toLocaleString('es-AR')}
                          </span>
                          <span className="text-xs font-bold text-emerald-300 font-mono">
                            (${usdPorHa.toFixed(1)} USD/ha)
                          </span>
                          <span className="text-xs font-mono text-slate-300">
                            · ARS ${Math.round(cTotal * (Number(dolarRef) || 1665)).toLocaleString('es-AR')}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Resumen Técnico Operativo (Modo Producción) */
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block">Superficie Lote</span>
                        <span className="font-black text-white font-mono text-sm">
                          {ha.toFixed(1)} ha
                        </span>
                        {esParcial && (
                          <span className="text-[10px] text-amber-400 ml-1 font-bold">(Parcial de {potreroHa.toFixed(1)} ha)</span>
                        )}
                      </div>

                      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block">Receta & Insumos</span>
                        <span className="font-bold text-emerald-400 font-mono">
                          {insumos.length} aplicaciones
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">({receta.length} prescriptos)</span>
                      </div>

                      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block">Labores de Campo</span>
                        <span className="font-bold text-indigo-300 font-mono">
                          {labores.length} labores
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">realizadas</span>
                      </div>

                      <div className="h-6 w-px bg-slate-800 hidden sm:block" />

                      <div className="bg-emerald-500/10 px-3.5 py-2 rounded-xl border border-emerald-500/25">
                        <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">
                          Estado Agronómico
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm font-bold text-white">
                            {siembra.cultivo_variedad}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-semibold border border-emerald-700">
                            {siembra.estado || 'Sembrado'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Botones de Acción Clave */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Botón Exportar PDF */}
                    <button
                      type="button"
                      onClick={() => handleExportPDF(siembra)}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center gap-2 border border-slate-700 cursor-pointer transition active:scale-95 shadow-xs"
                      title="Generar Ficha Técnica en PDF para impresión o auditoría"
                    >
                      <FileText className="w-4 h-4 text-red-400" />
                      <span>📄 Exportar PDF</span>
                    </button>

                    {/* Botón Repetir / Ajustar */}
                    <button
                      type="button"
                      onClick={() => handleRepetirSiembra(siembra)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-semibold text-xs flex items-center gap-2 border border-emerald-500/40 cursor-pointer transition active:scale-95 shadow-xs"
                      title="Clonar receta y labores para otra campaña o potrero"
                    >
                      <Copy className="w-4 h-4 text-emerald-400" />
                      <span>🔄 Repetir / Ajustar</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 0: LECTOR INTELIGENTE DE RECETAS AGRONÓMICAS (RAO / MDA PBA)         */}
      {/* ========================================================================= */}
      {modalRaoOpen && (
        <GeminiRecetaModal
          isOpen={true}
          onClose={() => setModalRaoOpen(false)}
          potreros={potreros}
          stockInsumos={stockInsumos}
          siembras={siembras}
          fechaOperacion={fechaOperacion}
          dolarRef={dolarRef}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: EDICIÓN COMPLETA DE SIEMBRA (4 SECCIONES INTERACTIVAS)          */}
      {/* ========================================================================= */}
      {modalEditOpen && currentSiembra && (
        <SiembraEditModal
          siembra={currentSiembra}
          potreros={potreros}
          rodeos={rodeos}
          dolarRef={dolarRef}
          isAdmin={effectiveIsAdmin}
          notify={notify}
          saving={saving}
          onClose={() => {
            setModalEditOpen(false);
            setCurrentSiembra(null);
          }}
          onSave={handleSaveSiembra}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: CARGA INTELIGENTE DE RECETA / REMITO / FACTURA CON GEMINI IA      */}
      {/* ========================================================================= */}
      {modalIaOpen && (
        <GeminiSiembraModal
          potreros={potreros}
          rodeos={rodeos}
          stockInsumos={stockInsumos}
          siembrasExistentes={siembras}
          targetSiembra={cruzarTargetSiembra}
          modoInicial={modalIaModo}
          fechaOperacion={fechaOperacion}
          dolarRef={dolarRef}
          isSandboxMode={isSandboxMode}
          isAdmin={effectiveIsAdmin}
          onClose={() => {
            setModalIaOpen(false);
            setCruzarTargetSiembra(null);
            setModalIaModo('nuevo');
          }}
          onApply={handleAplicarRecetaIA}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 2.5: CATÁLOGO DE PRESUPUESTOS Y LISTAS DE PRECIOS                   */}
      {/* ========================================================================= */}
      {modalCatalogoPresupuestosOpen && (
        <CatalogoPresupuestosModal
          isOpen={modalCatalogoPresupuestosOpen}
          onClose={() => setModalCatalogoPresupuestosOpen(false)}
          notify={notify}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: DESCONTAR DE STOCK INVENTARIO                                   */}
      {/* ========================================================================= */}
      {modalStockOpen && stockItemToDeduct && (
        <DescontarStockModal
          stockInsumos={stockInsumos}
          insumoItem={stockItemToDeduct.item}
          siembra={stockItemToDeduct.siembra}
          onClose={() => {
            setModalStockOpen(false);
            setStockItemToDeduct(null);
          }}
          onConfirm={handleConfirmDeductStock}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: ASENTAR GASTO EN FINANZAS                                       */}
      {/* ========================================================================= */}
      {modalGastoOpen && gastoItemToRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <DollarSign className="w-5 h-5 text-amber-400" />
                <span>Asentar Gasto en Finanzas</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalGastoOpen(false);
                  setGastoItemToRecord(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              ¿Deseás asentar este insumo como egreso en el módulo de{' '}
              <strong className="text-white">Finanzas / Gastos</strong>?
            </p>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Producto:</span>
                <span className="font-bold text-emerald-400">{gastoItemToRecord.item.producto}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cantidad:</span>
                <span className="text-white">
                  {gastoItemToRecord.item.cantidad} {gastoItemToRecord.item.unidad || 'L'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Lote Asignado:</span>
                <span className="text-white">Potrero #{gastoItemToRecord.siembra.potrero_numero}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 font-bold">
                <span className="text-slate-300">Monto:</span>
                <span className="text-amber-400 font-mono">
                  USD ${Number(gastoItemToRecord.item.costo_usd || 0).toLocaleString('es-AR')} (~$
                  {Math.round(
                    Number(gastoItemToRecord.item.costo_usd || 0) * (Number(dolarRef) || 1540)
                  ).toLocaleString('es-AR')}{' '}
                  ARS)
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalGastoOpen(false);
                  setGastoItemToRecord(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() =>
                  handleConfirmRecordExpense(gastoItemToRecord.item, gastoItemToRecord.siembra)
                }
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Confirmar y Asentar Gasto</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// SUBCOMPONENTE: MODAL DE EDICIÓN COMPLETA (4 SECCIONES) CON CALCULADORA AGRONÓMICA
// =========================================================================

export const PRESENTACIONES_INSUMOS = [
  { id: 'kg_directo', label: 'Kg directo (kg)', unidadBase: 'kg', factor: 1, tipo: 'kg', envase: null },
  { id: 'bolsa_20', label: 'Bolsa 20 kg', unidadBase: 'kg', factor: 20, tipo: 'kg', envase: 'bolsas' },
  { id: 'bolsa_25', label: 'Bolsa 25 kg', unidadBase: 'kg', factor: 25, tipo: 'kg', envase: 'bolsas' },
  { id: 'bolsa_30', label: 'Bolsa 30 kg', unidadBase: 'kg', factor: 30, tipo: 'kg', envase: 'bolsas' },
  { id: 'bolsa_40', label: 'Bolsa 40 kg', unidadBase: 'kg', factor: 40, tipo: 'kg', envase: 'bolsas' },
  { id: 'bolsa_50', label: 'Bolsa 50 kg', unidadBase: 'kg', factor: 50, tipo: 'kg', envase: 'bolsas' },
  { id: 'litro_directo', label: 'Litros (L)', unidadBase: 'L', factor: 1, tipo: 'lt', envase: null },
  { id: 'bidon_5', label: 'Bidón 5 L', unidadBase: 'L', factor: 5, tipo: 'lt', envase: 'bidones' },
  { id: 'bidon_10', label: 'Bidón 10 L', unidadBase: 'L', factor: 10, tipo: 'lt', envase: 'bidones' },
  { id: 'bidon_20', label: 'Bidón 20 L', unidadBase: 'L', factor: 20, tipo: 'lt', envase: 'bidones' },
  { id: 'tonelada', label: 'Tonelada (tn / 1.000 kg)', unidadBase: 'kg', factor: 1000, tipo: 'kg', envase: 'tn' },
  { id: 'unidad_dosis', label: 'Dosis / Unidad (u)', unidadBase: 'u', factor: 1, tipo: 'u', envase: null },
  { id: 'hectarea', label: 'Hectárea (ha / labor)', unidadBase: 'ha', factor: 1, tipo: 'ha', envase: null },
];

export function findPresentacion(pIdOrUnidad) {
  if (!pIdOrUnidad) return PRESENTACIONES_INSUMOS[0];
  const byId = PRESENTACIONES_INSUMOS.find((p) => p.id === pIdOrUnidad);
  if (byId) return byId;
  const str = String(pIdOrUnidad).toLowerCase();
  if (str.includes('bolsa 25') || str === 'bolsa25') return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bolsa_25');
  if (str.includes('bolsa 20') || str === 'bolsa20') return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bolsa_20');
  if (str.includes('bolsa 30') || str === 'bolsa30') return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bolsa_30');
  if (str.includes('bolsa 40') || str === 'bolsa40') return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bolsa_40');
  if (str.includes('bolsa 50') || str === 'bolsa50') return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bolsa_50');
  if (str.includes('bolsa')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bolsa_25');
  if (str.includes('bidon 20') || str.includes('bidón 20')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bidon_20');
  if (str.includes('bidon 10') || str.includes('bidón 10')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bidon_10');
  if (str.includes('bidon 5') || str.includes('bidón 5')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bidon_5');
  if (str.includes('bidon') || str.includes('bidón')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'bidon_20');
  if (str.includes('tn') || str.includes('tonelada')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'tonelada');
  if (str.includes('dosis') || str.includes('unidad') || str === 'u') return PRESENTACIONES_INSUMOS.find((p) => p.id === 'unidad_dosis');
  if (str === 'l' || str.includes('litro')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'litro_directo');
  if (str === 'ha' || str.includes('hectarea')) return PRESENTACIONES_INSUMOS.find((p) => p.id === 'hectarea');
  return PRESENTACIONES_INSUMOS.find((p) => p.id === 'kg_directo') || PRESENTACIONES_INSUMOS[0];
}

export function calcularRenglonInsumo(item, totHa, dolarRef = 1665) {
  if (!item) {
    return {
      pres: PRESENTACIONES_INSUMOS[0],
      hasEnvase: false,
      modoCalculo: 'total',
      cantCobro: 0,
      cantEnvases: 0,
      totalBase: 0,
      totalExacto: 0,
      totalKg: 0,
      envasesSugeridos: 0,
      totalRedondeado: 0,
      dosisReal: 0,
      moneda: 'USD',
      precioUnitario: 0,
      precioBase: 0,
      subtotalUsd: 0,
      subtotalArs: 0,
      costoHaUsd: 0,
      unidadPrecio: 'kg',
    };
  }

  const pres = findPresentacion(item.presentacion || item.unidad);
  const numHa = Number(String(totHa || '').replace(',', '.'));
  const ha = numHa > 0 ? numHa : 1;
  const hasEnvase = !!(pres.envase && pres.factor > 1);

  // Modo explícito de carga: 'dosis' (Por Dosis/ha) vs 'total' (Por Cantidad Total)
  const modoCalculo = item.modo_calculo || (item.dosis_ha !== undefined && item.dosis_ha !== '' && (item.cantidad === undefined || item.cantidad === '') ? 'dosis' : 'total');

  let cantEnvases = 0;
  let totalBase = 0; // Kilos o Litros o Unidades totales del lote
  let dosisReal = 0; // Dosis por ha en unidadBase

  if (modoCalculo === 'dosis') {
    const dosisHa = Number(String(item.dosis_ha || '').replace(',', '.')) || 0;
    totalBase = Math.round(dosisHa * ha * 100) / 100;
    if (hasEnvase) {
      cantEnvases = totalBase > 0 ? Math.ceil(totalBase / pres.factor) : 0;
      const totalRedondeadoEnvases = Math.round(cantEnvases * pres.factor * 100) / 100;
      dosisReal = ha > 0 ? Math.round((totalRedondeadoEnvases / ha) * 100) / 100 : dosisHa;
    } else {
      cantEnvases = 0;
      dosisReal = dosisHa;
    }
  } else {
    // modoCalculo === 'total'
    const cantInput = Number(String(item.cantidad || '').replace(',', '.')) || 0;
    if (hasEnvase) {
      cantEnvases = cantInput;
      totalBase = Math.round(cantEnvases * pres.factor * 100) / 100;
      dosisReal = ha > 0 ? Math.round((totalBase / ha) * 100) / 100 : 0;
    } else {
      cantEnvases = 0;
      totalBase = Math.round(cantInput * 100) / 100;
      dosisReal = ha > 0 ? Math.round((totalBase / ha) * 100) / 100 : 0;
    }
  }

  // Cantidad sobre la cual se aplica el precio unitario:
  // Si tiene envase (Bolsa 25 kg, etc.), el precio es por envase (Precio / Bolsa)
  // Si no tiene envase, el precio es por unidadBase (Precio / kg, Precio / L, etc.)
  const cantCobro = hasEnvase ? cantEnvases : totalBase;

  const moneda = item.moneda === 'ARS' ? 'ARS' : 'USD';
  const precioUnitario = Number(String(item.precio_unitario || '').replace(',', '.')) || 0;
  const numDolarRef = Number(String(dolarRef || '').replace(',', '.'));
  const dRef = numDolarRef > 0 ? numDolarRef : 1665;

  let subtotalUsd = 0;
  let subtotalArs = 0;

  if (precioUnitario > 0) {
    if (moneda === 'USD') {
      subtotalUsd = Math.round(cantCobro * precioUnitario * 100) / 100;
      subtotalArs = Math.round(subtotalUsd * dRef * 100) / 100;
    } else {
      subtotalArs = Math.round(cantCobro * precioUnitario * 100) / 100;
      subtotalUsd = dRef > 0 ? Math.round((subtotalArs / dRef) * 100) / 100 : 0;
    }
  } else if (item.costo_usd !== undefined && item.costo_usd !== '' && Number(String(item.costo_usd).replace(',', '.')) > 0) {
    subtotalUsd = Math.round(Number(String(item.costo_usd).replace(',', '.')) * 100) / 100;
    subtotalArs = Math.round(subtotalUsd * dRef * 100) / 100;
  }

  const precioBase = hasEnvase && pres.factor > 1 && precioUnitario > 0
    ? Math.round((precioUnitario / pres.factor) * 100) / 100
    : precioUnitario;
  const costoHaUsd = ha > 0 ? Math.round((subtotalUsd / ha) * 100) / 100 : 0;

  const unidadPrecio = hasEnvase
    ? (pres.envase === 'bolsas' ? 'Bolsa' : pres.envase === 'bidones' ? 'Bidón' : 'Envase')
    : pres.unidadBase;

  return {
    pres,
    hasEnvase,
    modoCalculo,
    cantCobro,
    cantEnvases,
    totalBase,
    totalExacto: totalBase,
    totalKg: totalBase,
    envasesSugeridos: cantEnvases,
    totalRedondeado: hasEnvase ? Math.round(cantEnvases * pres.factor * 100) / 100 : totalBase,
    dosisReal,
    moneda,
    precioUnitario,
    precioBase,
    subtotalUsd,
    subtotalArs,
    costoHaUsd,
    unidadPrecio,
  };
}

export function calcularRenglonLabor(item, totHa, dolarRef = 1665) {
  if (!item) {
    return {
      ha: 1,
      modoTarifa: 'por_ha',
      tarifaInput: 0,
      tarifaHa: 0,
      tarifaUsd: 0,
      moneda: 'USD',
      subtotalUsd: 0,
      subtotalArs: 0,
      costoHaUsd: 0,
    };
  }

  const numHa = Number(String(item.ha !== undefined && item.ha !== '' ? item.ha : totHa).replace(',', '.'));
  const ha = numHa > 0 ? numHa : 1;
  const modoTarifa = item.modo_tarifa || 'por_ha'; // 'por_ha' | 'monto_fijo'
  const moneda = item.moneda === 'ARS' ? 'ARS' : 'USD';
  const numDolarRef = Number(String(dolarRef || '').replace(',', '.'));
  const dRef = numDolarRef > 0 ? numDolarRef : 1665;
  const rawTarifa = item.tarifa_ha !== undefined && item.tarifa_ha !== '' ? item.tarifa_ha : (item.costo_ha_usd || item.subtotal_usd || 0);
  const tarifaInput = Number(String(rawTarifa || '').replace(',', '.')) || 0;

  let tarifaHa = 0;
  let subtotalMoneda = 0;

  if (modoTarifa === 'monto_fijo') {
    subtotalMoneda = tarifaInput;
    tarifaHa = ha > 0 ? Math.round((subtotalMoneda / ha) * 100) / 100 : 0;
  } else {
    tarifaHa = tarifaInput;
    subtotalMoneda = Math.round(ha * tarifaHa * 100) / 100;
  }

  let subtotalUsd = 0;
  let subtotalArs = 0;

  if (moneda === 'USD') {
    subtotalUsd = Math.round(subtotalMoneda * 100) / 100;
    subtotalArs = Math.round(subtotalUsd * dRef * 100) / 100;
  } else {
    subtotalArs = Math.round(subtotalMoneda * 100) / 100;
    subtotalUsd = dRef > 0 ? Math.round((subtotalArs / dRef) * 100) / 100 : 0;
  }

  const tarifaUsd = ha > 0 ? Math.round((subtotalUsd / ha) * 100) / 100 : 0;

  return {
    ha: Math.round(ha * 100) / 100,
    modoTarifa,
    tarifaInput,
    tarifaHa,
    tarifaUsd,
    moneda,
    subtotalUsd,
    subtotalArs,
    costoHaUsd: tarifaUsd,
  };
}

function SiembraEditModal({
  siembra,
  potreros = [],
  rodeos = [],
  dolarRef = 1665,
  isAdmin = true,
  notify,
  saving,
  onClose,
  onSave,
}) {
  const pObjInit = potreros.find((p) => Number(p.numero) === Number(siembra.potrero_numero)) || potreros[0];
  const pTotalHa = Number(pObjInit?.hectareas) || 40;
  const initHa = Number(siembra.ha_sembradas || siembra.hectareas) || pTotalHa;

  const [isMultiPotrero, setIsMultiPotrero] = useState(Boolean(siembra.potreros_detalle || false));
  const [selectedPotreros, setSelectedPotreros] = useState(() => {
    if (Array.isArray(siembra.potreros_detalle) && siembra.potreros_detalle.length > 0) {
      return siembra.potreros_detalle.map((sp) => ({
        numero: Number(sp.numero),
        nombre: sp.nombre || 'Potrero #' + sp.numero,
        hectareas: Number(sp.hectareas) || 40,
      }));
    }
    const initP = potreros.find((p) => Number(p.numero) === Number(siembra.potrero_numero)) || potreros[0];
    return [
      {
        numero: Number(initP?.numero || 1),
        nombre: initP?.nombre || 'Potrero',
        hectareas: initHa,
      },
    ];
  });

  const [form, setForm] = useState({
    id: siembra.id,
    potrero_numero: siembra.potrero_numero || potreros[0]?.numero || 1,
    hectareas: initHa,
    ha_sembradas: initHa,
    vigencia: siembra.vigencia || 'Activa',
    cultivo_variedad: siembra.cultivo_variedad || '',
    variedad_hibrido: siembra.variedad_hibrido || '',
    campana: siembra.campana || '2026/2027',
    estado: siembra.estado || 'Sembrado',
    fecha: siembra.fecha || new Date().toISOString().slice(0, 10),
    observaciones: siembra.observaciones || '',
    receta_json: Array.isArray(siembra.receta_json) ? [...siembra.receta_json] : [],
    insumos_json: Array.isArray(siembra.insumos_json) ? [...siembra.insumos_json] : [],
    labores_json: Array.isArray(siembra.labores_json) ? [...siembra.labores_json] : [],
  });

  // Combobox custom para Cultivo / Pastura
  const [showCultivoDropdown, setShowCultivoDropdown] = useState(false);
  const [isTypingCultivo, setIsTypingCultivo] = useState(false);
  const cultivoDropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (cultivoDropdownRef.current && !cultivoDropdownRef.current.contains(event.target)) {
        setShowCultivoDropdown(false);
        setIsTypingCultivo(false);
      }
    }
    if (showCultivoDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCultivoDropdown]);

  const opcionesCultivos = useMemo(() => {
    if (!isTypingCultivo) return CULTIVOS_PREDEFINIDOS;
    const q = (form.cultivo_variedad || '').trim().toLowerCase();
    if (!q) return CULTIVOS_PREDEFINIDOS;
    const matches = CULTIVOS_PREDEFINIDOS.filter((c) => c.toLowerCase().includes(q));
    return matches.length > 0 ? matches : CULTIVOS_PREDEFINIDOS;
  }, [isTypingCultivo, form.cultivo_variedad]);

  // Calculador de Semilla: Bolsas y Densidad kg/ha
  const [showSeedCalc, setShowSeedCalc] = useState(false);
  const [seedCalcMode, setSeedCalcMode] = useState('kgha'); // 'kgha' | 'bolsas'
  const [seedKgHa, setSeedKgHa] = useState(20);
  const [seedBolsas, setSeedBolsas] = useState(30);
  const [seedPesoBolsa, setSeedPesoBolsa] = useState(25);

  // Estados de escaneo IA
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [scanTargetSection, setScanTargetSection] = useState('receta');
  const fileInputRef = useRef(null);

  // Superficie total reactiva
  const totHaActual = useMemo(() => {
    if (isMultiPotrero) {
      return selectedPotreros.reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0);
    }
    return Number(form.ha_sembradas ?? form.hectareas) || 0;
  }, [isMultiPotrero, selectedPotreros, form.ha_sembradas, form.hectareas]);

  const currentPotrero = potreros.find((p) => Number(p.numero) === Number(form.potrero_numero));
  const currentPotreroHa = Number(currentPotrero?.hectareas) || 0;
  const esParcialModal = !isMultiPotrero && currentPotreroHa > 0 && totHaActual < currentPotreroHa - 0.05;

  // Manejo de multi-potreros
  function handleTogglePotrero(p) {
    setSelectedPotreros((prev) => {
      const exists = prev.find((item) => Number(item.numero) === Number(p.numero));
      let next;
      if (exists) {
        if (prev.length <= 1) return prev;
        next = prev.filter((item) => Number(item.numero) !== Number(p.numero));
      } else {
        next = [
          ...prev,
          {
            numero: Number(p.numero),
            nombre: p.nombre || 'Potrero #' + p.numero,
            hectareas: Number(p.hectareas) || 40,
          },
        ];
      }
      const sumHa = next.reduce((acc, it) => acc + (Number(it.hectareas) || 0), 0);
      handleHectareasChange(sumHa);
      return next;
    });
  }

  function handlePotreroHaEdit(pNum, val) {
    setSelectedPotreros((prev) => {
      const next = prev.map((item) => {
        if (Number(item.numero) === Number(pNum)) {
          return { ...item, hectareas: Number(val) || 0 };
        }
        return item;
      });
      const sumHa = next.reduce((acc, it) => acc + (Number(it.hectareas) || 0), 0);
      handleHectareasChange(sumHa);
      return next;
    });
  }

  // Al cambiar potrero único, auto-completar hectáreas oficiales
  function handlePotreroChange(pNum) {
    const pObj = potreros.find((p) => Number(p.numero) === Number(pNum));
    const newHa = Number(pObj?.hectareas) || form.hectareas;
    setForm((prev) => ({
      ...prev,
      potrero_numero: Number(pNum),
      hectareas: newHa,
      ha_sembradas: newHa,
    }));
    setSelectedPotreros([
      {
        numero: Number(pNum),
        nombre: pObj?.nombre || 'Potrero #' + pNum,
        hectareas: Number(newHa) || 40,
      },
    ]);
  }

  // Al cambiar superficie sembrada
  function handleHectareasChange(val) {
    setForm((prev) => ({
      ...prev,
      hectareas: val,
      ha_sembradas: val,
    }));
  }

  // Helpers para Receta
  function addRecetaRow() {
    setForm((prev) => ({
      ...prev,
      receta_json: [
        ...prev.receta_json,
        {
          producto: '',
          funcion: 'Herbicida',
          dosis_ha: 1,
          presentacion: 'litro_directo',
          unidad: 'L',
          precio_unitario: 0,
          moneda: 'USD',
        },
      ],
    }));
  }

  function updateRecetaRow(idx, field, value) {
    setForm((prev) => {
      const next = [...prev.receta_json];
      let cleanVal = value;
      if ((field === 'precio_unitario' || field === 'dosis_ha') && typeof cleanVal === 'string') {
        cleanVal = cleanVal.replace(',', '.');
      }
      next[idx] = { ...next[idx], [field]: cleanVal };
      if (field === 'presentacion') {
        const pres = findPresentacion(cleanVal);
        next[idx].unidad = pres.unidadBase;
      }
      return { ...prev, receta_json: next };
    });
  }

  function removeRecetaRow(idx) {
    setForm((prev) => ({
      ...prev,
      receta_json: prev.receta_json.filter((_, i) => i !== idx),
    }));
  }

  // Volcar renglón de prescripción a Insumos Reales con 1 clic
  function handleVolcarRecetaAInsumos(idx) {
    const r = form.receta_json[idx];
    if (!r) return;
    const calc = calcularRenglonInsumo(r, totHaActual, dolarRef);
    const pres = calc.pres;
    const hasEnv = !!(pres.envase && pres.factor > 1);
    const cantFinal = hasEnv
      ? (calc.envasesSugeridos > 0 ? calc.envasesSugeridos : (pres.factor > 1 ? Math.ceil(calc.totalExacto / pres.factor) : calc.totalExacto))
      : calc.totalExacto;

    const totalKg = hasEnv ? cantFinal * pres.factor : cantFinal;
    const dosisReal = totHaActual > 0 ? Math.round((totalKg / totHaActual) * 100) / 100 : (Number(String(r.dosis_ha || '').replace(',', '.')) || 1);
    const pu = Number(String(r.precio_unitario || '').replace(',', '.')) || 0;
    const subUsd = Math.round(calc.subtotalUsd * 100) / 100;
    const subArs = Math.round(calc.subtotalArs * 100) / 100;

    const nuevoInsumo = {
      fecha: form.fecha || new Date().toISOString().slice(0, 10),
      remito: '',
      proveedor: 'Cooperativa / Semillero',
      producto: r.producto || 'Insumo prescripto',
      presentacion: pres.id,
      modo_calculo: hasEnv ? 'total' : 'dosis',
      cantidad: cantFinal,
      dosis_ha: Number(String(r.dosis_ha || '').replace(',', '.')) || dosisReal,
      unidad: pres.unidadBase,
      dosis_real: dosisReal,
      precio_unitario: pu,
      moneda: r.moneda || 'USD',
      costo_usd: subUsd,
      costo_ars: subArs,
      funcion: r.funcion || (hasEnv && pres.tipo === 'kg' ? 'Semilla' : 'Agroquímico'),
    };

    setForm((prev) => ({
      ...prev,
      insumos_json: [...prev.insumos_json, nuevoInsumo],
    }));

    if (notify) {
      notify(
        `"${r.producto || 'Insumo'}" volcado a Insumos Reales (${cantFinal} ${hasEnv ? pres.envase : pres.unidadBase} · Subtotal USD $${Math.round(subUsd).toLocaleString('es-AR')}).`,
        'success'
      );
    }
  }

  // Helpers para Insumos
  function addInsumoRow() {
    setForm((prev) => ({
      ...prev,
      insumos_json: [
        ...prev.insumos_json,
        {
          fecha: prev.fecha || new Date().toISOString().slice(0, 10),
          remito: '',
          proveedor: '',
          producto: '',
          presentacion: 'bolsa_25',
          modo_calculo: 'total',
          cantidad: 10,
          dosis_ha: totHaActual > 0 ? Number(((10 * 25) / totHaActual).toFixed(2)) : 25,
          unidad: 'kg',
          dosis_real: totHaActual > 0 ? Number(((10 * 25) / totHaActual).toFixed(2)) : 25,
          precio_unitario: 0,
          moneda: 'USD',
          costo_usd: 0,
          costo_ars: 0,
        },
      ],
    }));
  }

  function updateInsumoRow(idx, field, value) {
    setForm((prev) => {
      const next = [...prev.insumos_json];
      let cleanVal = value;
      if ((field === 'precio_unitario' || field === 'cantidad' || field === 'dosis_ha') && typeof cleanVal === 'string') {
        cleanVal = cleanVal.replace(',', '.');
      }
      next[idx] = { ...next[idx], [field]: cleanVal };
      const calc = calcularRenglonInsumo(next[idx], totHaActual, dolarRef);
      next[idx].unidad = calc.pres.unidadBase;
      next[idx].dosis_real = calc.dosisReal;
      next[idx].costo_usd = calc.subtotalUsd;
      next[idx].costo_ars = calc.subtotalArs;
      next[idx].precio_unitario = cleanVal;
      return { ...prev, insumos_json: next };
    });
  }

  function removeInsumoRow(idx) {
    setForm((prev) => ({
      ...prev,
      insumos_json: prev.insumos_json.filter((_, i) => i !== idx),
    }));
  }

  // Helpers para Labores
  function addLaborRow() {
    setForm((prev) => ({
      ...prev,
      labores_json: [
        ...prev.labores_json,
        {
          fecha: prev.fecha || new Date().toISOString().slice(0, 10),
          labor: LABORES_PREDEFINIDAS[1],
          contratista: 'Equipo propio',
          ha: totHaActual,
          modo_tarifa: 'por_ha',
          tarifa_ha: 35,
          costo_ha_usd: 35,
          moneda: 'USD',
          subtotal_usd: Math.round(35 * (totHaActual || 1) * 100) / 100,
        },
      ],
    }));
  }

  function updateLaborRow(idx, field, value) {
    setForm((prev) => {
      const next = [...prev.labores_json];
      let cleanVal = value;
      if ((field === 'tarifa_ha' || field === 'ha') && typeof cleanVal === 'string') {
        cleanVal = cleanVal.replace(',', '.');
      }
      next[idx] = { ...next[idx], [field]: cleanVal };
      const calc = calcularRenglonLabor(next[idx], totHaActual, dolarRef);
      next[idx].subtotal_usd = calc.subtotalUsd;
      next[idx].subtotal_ars = calc.subtotalArs;
      next[idx].costo_ha_usd = calc.tarifaUsd;
      next[idx].tarifa_ha = cleanVal;
      return { ...prev, labores_json: next };
    });
  }

  function removeLaborRow(idx) {
    setForm((prev) => ({
      ...prev,
      labores_json: prev.labores_json.filter((_, i) => i !== idx),
    }));
  }

  // Asistente de Bolsas y Densidad
  const calcTotalKg =
    seedCalcMode === 'kgha'
      ? Math.round(Number(seedKgHa || 0) * (totHaActual || 1))
      : Math.round(Number(seedBolsas || 0) * Number(seedPesoBolsa || 25));
  const calcTotalBolsas =
    seedCalcMode === 'kgha'
      ? Number(seedPesoBolsa) > 0
        ? (calcTotalKg / Number(seedPesoBolsa)).toFixed(1)
        : 0
      : Number(seedBolsas || 0);
  const calcDensidadKgHa = totHaActual > 0 ? (calcTotalKg / totHaActual).toFixed(1) : 0;

  function applySeedCalcToReceta() {
    const prodName = form.cultivo_variedad ? 'Semilla ' + form.cultivo_variedad : 'Semilla de Pastura';
    const presId = 'bolsa_' + seedPesoBolsa;
    const presObj = findPresentacion(presId);

    setForm((prev) => ({
      ...prev,
      receta_json: [
        ...prev.receta_json,
        {
          producto: prodName + ' (' + seedPesoBolsa + ' kg/bolsa)',
          funcion: 'Semilla',
          dosis_ha: Number(calcDensidadKgHa),
          presentacion: presObj.id,
          unidad: 'kg',
          precio_unitario: 0,
          moneda: 'USD',
        },
      ],
      insumos_json: [
        ...prev.insumos_json,
        {
          fecha: prev.fecha || new Date().toISOString().slice(0, 10),
          remito: '',
          proveedor: 'Cooperativa / Semillero',
          producto: prodName + ' (' + calcTotalBolsas + ' bolsas x ' + seedPesoBolsa + ' kg)',
          presentacion: presObj.id,
          cantidad: calcTotalKg,
          unidad: 'kg',
          dosis_real: Number(calcDensidadKgHa),
          precio_unitario: 0,
          moneda: 'USD',
          costo_usd: 0,
        },
      ],
    }));
    setShowSeedCalc(false);
    if (notify) notify('Cálculo de semilla volcado a Receta e Insumos (' + calcTotalKg + ' kg en ' + calcTotalBolsas + ' bolsas).', 'success');
  }

  // Disparar Escaneo con IA para una Sección
  function triggerScanSection(section) {
    setScanTargetSection(section);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function handleFileScanChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanLoading(true);
    setScanMsg('Analizando documento con Gemini 2.5 Pro (' + file.name + ')...');
    try {
      const res = await analizarRecetaORemitoSiembra([file], potreros, false);
      const rawLotes = Array.isArray(res?.lotes) ? res.lotes : [];
      const lote = rawLotes[0] || {};
      const fallbackInsumos = Array.isArray(res?.compras_generales_campana) && res.compras_generales_campana.length > 0
        ? res.compras_generales_campana
        : Array.isArray(res?.productos) && res.productos.length > 0
          ? res.productos
          : Array.isArray(res?.items) && res.items.length > 0
            ? res.items
            : [];
      const insumosList = (Array.isArray(lote.insumos) && lote.insumos.length > 0)
        ? lote.insumos
        : fallbackInsumos;

      if (scanTargetSection === 'receta' && insumosList.length > 0) {
        const nuevos = insumosList.map((ins) => {
          const pres = findPresentacion(ins.unidad || ins.presentacion);
          return {
            producto: ins.producto || ins.nombre || '',
            funcion: ins.dosis_ha && Number(ins.dosis_ha) > 10 ? 'Semilla' : (ins.funcion || 'Prescripción'),
            dosis_ha: Number(ins.dosis_ha) || (totHaActual > 0 && ins.cantidad_total ? Math.round((Number(ins.cantidad_total) / totHaActual) * 100) / 100 : 1),
            unidad: pres.unidadBase,
            presentacion: pres.id,
            precio_unitario: Number(ins.precio_unitario) || 0,
            moneda: res?.moneda || ins.moneda || 'USD',
          };
        });
        setForm((prev) => ({
          ...prev,
          receta_json: [...prev.receta_json, ...nuevos],
        }));
        if (notify) notify('Se importaron ' + nuevos.length + ' productos de prescripción / cotización con Gemini IA.', 'success');
      } else if (scanTargetSection === 'insumos' && insumosList.length > 0) {
        const nuevos = insumosList.map((ins) => {
          const pres = findPresentacion(ins.unidad || ins.presentacion);
          const hasEnv = !!(pres.envase && pres.factor > 1);
          let cant = Number(ins.cantidad_total || ins.cantidad || 0);
          if (hasEnv) {
            if (cant > 50 && pres.factor > 1) {
              cant = Math.ceil(cant / pres.factor);
            }
          }
          if (cant <= 0) cant = 1;

          const costo = (res?.moneda === 'ARS' || ins.moneda === 'ARS')
            ? (Number(ins.costo_total || ins.subtotal) || 0) / (Number(dolarRef) || 1665)
            : Number(ins.costo_total || ins.subtotal) || 0;

          const totalKg = hasEnv ? cant * pres.factor : cant;
          const dosisReal = totHaActual > 0 ? Math.round((totalKg / totHaActual) * 100) / 100 : 1;

          return {
            fecha: lote.fecha_estimada || new Date().toISOString().slice(0, 10),
            remito: res?.remito_o_receta_nro || res?.presupuesto_nro || '',
            proveedor: res?.ingeniero_o_proveedor || res?.cooperativa || '',
            producto: ins.producto || ins.nombre || '',
            presentacion: pres.id,
            cantidad: cant,
            unidad: pres.unidadBase,
            dosis_real: dosisReal,
            precio_unitario: Number(ins.precio_unitario) || 0,
            moneda: res?.moneda || ins.moneda || 'USD',
            costo_usd: Math.round(costo * 100) / 100,
          };
        });
        setForm((prev) => ({
          ...prev,
          insumos_json: [...prev.insumos_json, ...nuevos],
        }));
        if (notify) notify('Se importaron ' + nuevos.length + ' insumos / cotizaciones con Gemini IA.', 'success');
      } else if (scanTargetSection === 'labores' && Array.isArray(lote.labores_detalle) && lote.labores_detalle.length > 0) {
        const nuevos = lote.labores_detalle.map((lab) => {
          const subUsd = res?.moneda === 'ARS'
            ? (Number(lab.subtotal) || 0) / (Number(dolarRef) || 1665)
            : Number(lab.subtotal) || 0;
          return {
            fecha: lote.fecha_estimada || new Date().toISOString().slice(0, 10),
            labor: lab.concepto || 'Labor Agrícola',
            contratista: res?.ingeniero_o_proveedor || 'Contratista',
            ha: Number(lab.hectareas) || totHaActual,
            tarifa_ha: Number(lab.precio_unitario) || 0,
            moneda: res?.moneda || 'USD',
            subtotal_usd: Math.round(subUsd * 100) / 100,
          };
        });
        setForm((prev) => ({
          ...prev,
          labores_json: [...prev.labores_json, ...nuevos],
        }));
        if (notify) notify('Se importaron ' + nuevos.length + ' labores agrícolas con Gemini IA.', 'success');
      } else {
        if (notify) notify('El documento fue analizado pero no contenía datos estructurados para ' + scanTargetSection + '.', 'warning');
      }
    } catch (err) {
      console.error('Error al analizar documento:', err);
      if (notify) notify('Error al analizar documento con IA: ' + err.message, 'error');
    } finally {
      setScanLoading(false);
      setScanMsg('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Totales en vivo desglosados (prioriza insumos reales y evita duplicar productos de la receta)
  const { totalSemillasUsd, totalAgroquimicosUsd, totalInsumosUsd } = useMemo(() => {
    let semUsd = 0;
    let agroUsd = 0;

    // 1. Identificar productos cargados en Insumos Reales (Sección 3)
    const insumosRealesNorm = new Set(
      form.insumos_json.map((i) => (i.producto || '').trim().toLowerCase()).filter(Boolean)
    );

    // 2. Unificar insumos reales + ítems de la receta agronómica que aún no están en insumos reales
    const sourceList = [
      ...form.insumos_json,
      ...form.receta_json.filter((r) => {
        const prod = (r.producto || '').trim().toLowerCase();
        return prod && !insumosRealesNorm.has(prod);
      }),
    ];

    sourceList.forEach((item) => {
      const calc = calcularRenglonInsumo(item, totHaActual, dolarRef);
      if (calc.subtotalUsd <= 0) return;

      const pLower = (item.producto || '').toLowerCase();
      const fLower = (item.funcion || '').toLowerCase();
      const presId = (item.presentacion || calc.pres?.id || '').toLowerCase();

      const isSemilla =
        fLower.includes('semilla') ||
        pLower.includes('semilla') ||
        pLower.includes('raigrás') ||
        pLower.includes('raigras') ||
        pLower.includes('festuca') ||
        pLower.includes('avena') ||
        pLower.includes('trébol') ||
        pLower.includes('trebol') ||
        pLower.includes('lotus') ||
        pLower.includes('sorgo') ||
        pLower.includes('maíz') ||
        pLower.includes('maiz') ||
        pLower.includes('alfalfa') ||
        pLower.includes('agropiro') ||
        pLower.includes('moha') ||
        pLower.includes('vicia') ||
        pLower.includes('cebada') ||
        pLower.includes('trigo') ||
        pLower.includes('centeno') ||
        pLower.includes('pasto') ||
        pLower.includes('consociad') ||
        item.tipo === 'Semilla' ||
        (presId.includes('bolsa') && !pLower.includes('urea') && !pLower.includes('fosfato') && !pLower.includes('fertiliz'));

      if (isSemilla) {
        semUsd += calc.subtotalUsd;
      } else {
        agroUsd += calc.subtotalUsd;
      }
    });

    return {
      totalSemillasUsd: Math.round(semUsd * 100) / 100,
      totalAgroquimicosUsd: Math.round(agroUsd * 100) / 100,
      totalInsumosUsd: Math.round((semUsd + agroUsd) * 100) / 100,
    };
  }, [form.insumos_json, form.receta_json, totHaActual, dolarRef]);

  const totalLaboresUsd = useMemo(() => {
    return form.labores_json.reduce((sum, item) => {
      const calc = calcularRenglonLabor(item, totHaActual, dolarRef);
      return sum + calc.subtotalUsd;
    }, 0);
  }, [form.labores_json, totHaActual, dolarRef]);

  const totalInversionUsd = totalInsumosUsd + totalLaboresUsd;
  const totalInversionArs = totalInversionUsd * (Number(dolarRef) || 1665);
  const usdPorHa = totHaActual > 0 ? totalInversionUsd / totHaActual : 0;

  // Guardado seguro
  function handleConfirmSave() {
    const normalizedInsumos = form.insumos_json.map((item) => {
      const calc = calcularRenglonInsumo(item, totHaActual, dolarRef);
      return {
        ...item,
        costo_usd: Math.round(calc.subtotalUsd * 100) / 100,
        costo_ars: Math.round(calc.subtotalArs * 100) / 100,
        cantidad: Number(item.cantidad) || (calc.hasEnvase ? calc.cantEnvases : calc.totalExacto),
        unidad: item.unidad || (calc.hasEnvase ? (calc.pres.envase || 'bolsas') : calc.pres.unidadBase),
        total_kg: calc.totalKg,
        dosis_real: calc.dosisReal,
        precio_unitario: calc.precioUnitario,
        modo_calculo: calc.modoCalculo,
      };
    });

    const normalizedLabores = form.labores_json.map((item) => {
      const calc = calcularRenglonLabor(item, totHaActual, dolarRef);
      return {
        ...item,
        ha: calc.ha,
        modo_tarifa: calc.modoTarifa,
        tarifa_ha: calc.tarifaHa,
        costo_ha_usd: calc.tarifaUsd,
        subtotal_usd: calc.subtotalUsd,
        subtotal_ars: calc.subtotalArs,
      };
    });

    const normalizedReceta = form.receta_json.map((item) => {
      const calc = calcularRenglonInsumo(item, totHaActual, dolarRef);
      return {
        ...item,
        total_lote: calc.totalExacto,
        envases_sugeridos: calc.envasesSugeridos,
        total_redondeado: calc.totalRedondeado,
        costo_usd: Math.round(calc.subtotalUsd * 100) / 100,
        costo_ars: Math.round(calc.subtotalArs * 100) / 100,
        precio_unitario: calc.precioUnitario,
      };
    });

    onSave({
      ...form,
      ha_sembradas: totHaActual,
      hectareas: totHaActual,
      costo_insumos_usd: totalInsumosUsd,
      costo_labores_usd: totalLaboresUsd,
      costo_total_usd: totalInversionUsd,
      receta_json: normalizedReceta,
      insumos_json: normalizedInsumos,
      labores_json: normalizedLabores,
      is_multipotrero: isMultiPotrero,
      potreros_seleccionados: isMultiPotrero
        ? selectedPotreros
        : [
            {
              numero: form.potrero_numero,
              hectareas: totHaActual,
              nombre: currentPotrero?.nombre || 'Potrero #' + form.potrero_numero,
            },
          ],
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      {/* Input oculto para escaneo IA */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileScanChange}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx"
        className="hidden"
      />

      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full my-auto shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/60 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sprout className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{form.id ? 'Editar Ficha de Siembra & Labores' : 'Registrar Nueva Siembra / Lote'}</span>
                {isMultiPotrero && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Multi-Potrero ({selectedPotreros.length} lotes · {totHaActual.toFixed(1)} ha)
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                Calculadora agronómica por fila, conversión de envases, labores de contratista y sincronización de costos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Spinner de procesamiento IA */}
        {scanLoading && (
          <div className="bg-emerald-950/80 border-b border-emerald-500/40 px-6 py-2.5 flex items-center gap-3 animate-pulse">
            <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
            <span className="text-xs text-emerald-200 font-semibold">{scanMsg || 'Interpretando con Gemini 2.5 Pro...'}</span>
          </div>
        )}

        {/* Cuerpo Scrolleable */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs">
          {/* SECCIÓN 1: Identificación y Superficie del Lote */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>1. Identificación y Superficie del Lote</span>
              </h4>

              {/* Toggle Multi-Potrero */}
              <label className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-700 cursor-pointer hover:border-emerald-500 transition">
                <input
                  type="checkbox"
                  checked={isMultiPotrero}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsMultiPotrero(checked);
                    if (checked && selectedPotreros.length <= 1) {
                      const initP = potreros.find((p) => Number(p.numero) === Number(form.potrero_numero)) || potreros[0];
                      setSelectedPotreros([
                        {
                          numero: Number(initP?.numero || 1),
                          nombre: initP?.nombre || 'Potrero',
                          hectareas: Number(initP?.hectareas) || 40,
                        },
                      ]);
                    }
                  }}
                  className="rounded text-emerald-500 focus:ring-emerald-400 h-3.5 w-3.5"
                />
                <span className="text-[11px] font-bold text-slate-200">
                  🌿 Operación Multi-Potrero (Varios lotes con misma receta)
                </span>
              </label>
            </div>

            {/* Selector Multi-Potrero o Potrero Único */}
            {isMultiPotrero ? (
              <div className="p-3 bg-slate-900/90 rounded-xl border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-emerald-300">
                    Seleccioná los potreros incluidos y ajustá las hectáreas de cada uno:
                  </span>
                  <span className="text-xs font-black text-white font-mono bg-emerald-950 px-2.5 py-1 rounded border border-emerald-800">
                    Total Conjunto: {selectedPotreros.length} potreros · {totHaActual.toFixed(1)} ha
                  </span>
                </div>

                {/* Selector visual de potreros con PotreroCard */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto p-1">
                  {potreros.map((p) => {
                    const isSelected = selectedPotreros.some((it) => Number(it.numero) === Number(p.numero));
                    return (
                      <PotreroCard
                        key={p.numero}
                        potrero={p}
                        rodeos={rodeos || []}
                        isSelected={isSelected}
                        onToggle={() => handleTogglePotrero(p)}
                        selectionType="checkbox"
                        theme="dark"
                        size="compact"
                      />
                    );
                  })}
                </div>

                {/* Desglose de hectáreas por potrero seleccionado */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                    Lotes incluidos en la operación:
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {selectedPotreros.map((sp) => (
                      <div
                        key={sp.numero}
                        className="flex items-center gap-2 bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-700"
                      >
                        <span className="font-extrabold text-white text-xs">P#{sp.numero}</span>
                        <StepperInput
                          value={sp.hectareas}
                          onChange={(val) => handlePotreroHaEdit(sp.numero, val)}
                          step={0.5}
                          min={0.1}
                          className="w-24"
                          inputClassName="text-xs text-emerald-400 py-0.5 px-1"
                        />
                        <span className="text-[10px] text-slate-400">ha</span>
                        <button
                          type="button"
                          onClick={() => handleTogglePotrero({ numero: sp.numero })}
                          className="text-slate-500 hover:text-rose-400 ml-0.5 cursor-pointer"
                          title="Quitar potrero"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Potrero / Lote</label>
                  <select
                    value={form.potrero_numero}
                    onChange={(e) => handlePotreroChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-emerald-500"
                  >
                    {potreros.map((p) => (
                      <option key={p.numero} value={p.numero}>
                        Potrero #{p.numero} - {p.nombre || 'Lote'} ({p.hectareas || 0} ha)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-300">Sup. Sembrada (ha)</label>
                    {esParcialModal && (
                      <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-500/40">
                        Parcial ({currentPotreroHa.toFixed(1)} ha tot)
                      </span>
                    )}
                  </div>
                  <StepperInput
                    value={form.ha_sembradas ?? form.hectareas}
                    onChange={(val) => handleHectareasChange(val)}
                    step={0.5}
                    min={0.1}
                    placeholder="Hectáreas a sembrar"
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Vigencia en Mapa</label>
                  <select
                    value={form.vigencia || 'Activa'}
                    onChange={(e) => setForm({ ...form, vigencia: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Activa">🌱 Activa (Impacta en Mapa)</option>
                    <option value="Pasada / Histórica">📜 Pasada / Histórica (Archivo)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Campaña</label>
                  <select
                    value={form.campana}
                    onChange={(e) => setForm({ ...form, campana: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-semibold focus:outline-none focus:border-emerald-500"
                  >
                    {CAMPANAS_DISPONIBLES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Fila 2 de Datos Generales */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div ref={cultivoDropdownRef} className="relative">
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Cultivo / Pastura</label>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={form.cultivo_variedad || ''}
                    onFocus={() => {
                      setIsTypingCultivo(false);
                      setShowCultivoDropdown(true);
                    }}
                    onClick={() => {
                      setIsTypingCultivo(false);
                      setShowCultivoDropdown(true);
                    }}
                    onChange={(e) => {
                      setIsTypingCultivo(true);
                      setShowCultivoDropdown(true);
                      setForm((prev) => ({ ...prev, cultivo_variedad: e.target.value }));
                    }}
                    placeholder="Seleccionar o escribir cultivo / pastura..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-3 pr-16 py-2 text-white font-semibold text-xs sm:text-sm placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition"
                  />
                  <div className="absolute right-1.5 flex items-center gap-0.5">
                    {form.cultivo_variedad && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForm((prev) => ({ ...prev, cultivo_variedad: '' }));
                          setIsTypingCultivo(false);
                          setShowCultivoDropdown(true);
                        }}
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                        title="Borrar texto"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsTypingCultivo(false);
                        setShowCultivoDropdown((prev) => !prev);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                      title="Ver lista de cultivos predefinidos"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          showCultivoDropdown ? 'rotate-180 text-emerald-400' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {showCultivoDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto py-1 divide-y divide-slate-800">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-950/90 flex items-center justify-between sticky top-0 z-10 backdrop-blur">
                      <span>Cultivos y Pasturas ({opcionesCultivos.length})</span>
                      {isTypingCultivo && (
                        <button
                          type="button"
                          onClick={() => setIsTypingCultivo(false)}
                          className="text-emerald-400 hover:underline cursor-pointer lowercase"
                        >
                          ver todos
                        </button>
                      )}
                    </div>
                    <div className="py-0.5">
                      {opcionesCultivos.map((c) => {
                        const isSelected = form.cultivo_variedad === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, cultivo_variedad: c }));
                              setShowCultivoDropdown(false);
                              setIsTypingCultivo(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-950/80 text-emerald-300 font-bold border-l-2 border-emerald-400'
                                : 'text-slate-200 hover:bg-slate-800 hover:text-white font-medium'
                            }`}
                          >
                            <span className="truncate">{c}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Variedad / Híbrido</label>
                <input
                  type="text"
                  value={form.variedad_hibrido}
                  onChange={(e) => setForm({ ...form, variedad_hibrido: e.target.value })}
                  placeholder="Ej: Dekalb 72-10, Barturbo..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Estado de la Siembra</label>
                <select
                  value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-emerald-500"
                >
                  {ESTADOS_SIEMBRA.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Fecha de Siembra / Inicio</label>
                <input
                  type="date"
                  value={form.fecha || ''}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-semibold cursor-pointer focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* SECCIÓN 2: Receta Agronómica y Calculadora por Fila */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-400" />
                <span>2. Receta Agronómica (Prescripción Técnica)</span>
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerScanSection('receta')}
                  className="px-2.5 py-1 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                  title="Subir archivo o foto de receta técnica con IA"
                >
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>✨ Leer Receta con IA</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSeedCalc(!showSeedCalc)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                >
                  <Boxes className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{showSeedCalc ? 'Ocultar Asistente' : '📦 Asistente Semilla'}</span>
                </button>
                <button
                  type="button"
                  onClick={addRecetaRow}
                  className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Agregar Producto</span>
                </button>
              </div>
            </div>

            {/* Asistente Interactivo de Bolsas y Densidad kg/ha */}
            {showSeedCalc && (
              <div className="bg-slate-900 p-3.5 rounded-xl border border-emerald-500/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                    <Calculator className="w-4 h-4" />
                    Cálculo Automático de Semilla por Bolsas / Densidad (Superficie: {totHaActual.toFixed(1)} ha)
                  </span>
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setSeedCalcMode('kgha')}
                      className={'px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ' + (seedCalcMode === 'kgha' ? 'bg-emerald-600 text-white' : 'text-slate-400')}
                    >
                      Por kg/ha
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeedCalcMode('bolsas')}
                      className={'px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ' + (seedCalcMode === 'bolsas' ? 'bg-emerald-600 text-white' : 'text-slate-400')}
                    >
                      Por Bolsas
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                  {seedCalcMode === 'kgha' ? (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-300 mb-1">
                        Densidad Deseada (kg/ha)
                      </label>
                      <StepperInput
                        value={seedKgHa}
                        onChange={(val) => setSeedKgHa(val)}
                        step={1}
                        min={1}
                        placeholder="kg/ha"
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-300 mb-1">
                        Cantidad de Bolsas a sembrar
                      </label>
                      <StepperInput
                        value={seedBolsas}
                        onChange={(val) => setSeedBolsas(val)}
                        step={1}
                        min={1}
                        placeholder="Bolsas"
                        className="w-full"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold text-slate-300 mb-1">
                      Peso de la Bolsa (kg)
                    </label>
                    <div className="flex items-center gap-1">
                      {[20, 25, 40].map((kg) => (
                        <button
                          key={kg}
                          type="button"
                          onClick={() => setSeedPesoBolsa(kg)}
                          className={'px-2 py-1 rounded text-xs font-bold cursor-pointer border ' + (Number(seedPesoBolsa) === kg ? 'bg-emerald-700 text-white border-emerald-500' : 'bg-slate-950 text-slate-400 border-slate-700')}
                        >
                          {kg}kg
                        </button>
                      ))}
                      <StepperInput
                        value={seedPesoBolsa}
                        onChange={(val) => setSeedPesoBolsa(val)}
                        step={5}
                        min={1}
                        className="w-24"
                        inputClassName="text-xs py-0.5"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 font-mono text-xs space-y-0.5">
                    <div className="text-slate-400 text-[10px]">
                      Total: <span className="text-white font-bold">{calcTotalKg} kg</span> ({calcTotalBolsas} bolsas)
                    </div>
                    <div className="text-emerald-400 font-bold">
                      Densidad: {calcDensidadKgHa} kg/ha
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={applySeedCalcToReceta}
                      className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-sm flex items-center justify-center gap-1.5 cursor-pointer transition"
                    >
                      <Plus className="w-4 h-4" />
                      Aplicar a Receta e Insumos
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TABLA DE RECETA CON CALCULADORA POR FILA */}
            {form.receta_json.length === 0 ? (
              <p className="text-slate-500 italic text-center py-3">
                No hay productos prescriptos cargados. Usá "+ Agregar Producto" o "✨ Leer Receta con IA".
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-teal-300 uppercase px-2 mb-1 tracking-wider">
                  <div className={isAdmin ? 'col-span-3' : 'col-span-4'}>Producto Prescripto</div>
                  <div className={isAdmin ? 'col-span-2' : 'col-span-3'}>Dosis / ha</div>
                  <div className="col-span-2">Presentación / Envase</div>
                  <div className="col-span-2 text-right">Requerimiento Lote</div>
                  {isAdmin && <div className="col-span-2 text-right">Precio Unit. / Subtotal</div>}
                  <div className="col-span-1 text-center">Acciones</div>
                </div>

                {form.receta_json.map((r, idx) => {
                  const calc = calcularRenglonInsumo(r, totHaActual, dolarRef);
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center bg-slate-900 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition"
                    >
                      {/* Producto y Función */}
                      <div className={(isAdmin ? 'col-span-3' : 'col-span-4') + ' space-y-1'}>
                        <input
                          type="text"
                          placeholder="Producto (ej: Raigrás, Glifosato...)"
                          value={r.producto || ''}
                          onChange={(e) => updateRecetaRow(idx, 'producto', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-white font-semibold text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Función (Semilla, Herbicida...)"
                          value={r.funcion || ''}
                          onChange={(e) => updateRecetaRow(idx, 'funcion', e.target.value)}
                          className="w-full bg-slate-950/60 border border-slate-800 rounded px-2 py-0.5 text-[10px] text-slate-400"
                        />
                      </div>

                      {/* Dosis / ha */}
                      <div className={isAdmin ? 'col-span-2' : 'col-span-3'}>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={r.dosis_ha ?? ''}
                            onChange={(e) => updateRecetaRow(idx, 'dosis_ha', e.target.value)}
                            placeholder="Dosis"
                            className="w-full min-w-[115px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-emerald-400 font-mono font-bold text-xs text-right focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                            {calc.pres.unidadBase}/ha
                          </span>
                        </div>
                      </div>

                      {/* Selector de Presentación / Unidad */}
                      <div className="col-span-2">
                        <select
                          value={r.presentacion || calc.pres.id}
                          onChange={(e) => updateRecetaRow(idx, 'presentacion', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-xs font-medium"
                        >
                          {PRESENTACIONES_INSUMOS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Requerimiento Total Lote + Envases sugeridos */}
                      <div className="col-span-2 text-right font-mono pr-1">
                        <div className="text-white font-bold text-xs">
                          {calc.totalExacto.toLocaleString('es-AR', { maximumFractionDigits: 1 })}{' '}
                          <span className="text-[10px] text-slate-400">{calc.pres.unidadBase}</span>
                        </div>
                        {calc.hasEnvase && calc.envasesSugeridos > 0 && (
                          <div className="text-[10px] text-teal-300 font-semibold">
                            📦 {calc.envasesSugeridos} {calc.pres.envase} (= {calc.totalRedondeado.toLocaleString('es-AR')}{' '}
                            {calc.pres.unidadBase})
                          </div>
                        )}
                      </div>

                      {/* Precio Unitario y Subtotal en USD y ARS (Solo Modo Admin) */}
                      {isAdmin && (
                        <div className="col-span-2 text-right space-y-0.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => updateRecetaRow(idx, 'moneda', calc.moneda === 'USD' ? 'ARS' : 'USD')}
                              className={'px-1.5 py-0.5 rounded text-[10px] font-black cursor-pointer ' + (calc.moneda === 'USD' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-blue-500/20 text-blue-300 border border-blue-500/40')}
                            >
                              {calc.moneda}
                            </button>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={r.precio_unitario ?? ''}
                              onChange={(e) => updateRecetaRow(idx, 'precio_unitario', e.target.value)}
                              placeholder={calc.hasEnvase ? `Precio/${calc.pres.envase === 'bolsas' ? 'Bolsa' : 'Envase'}` : `Precio/${calc.pres.unidadBase}`}
                              className="w-full min-w-[115px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-white font-mono font-bold text-xs text-right focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                          <div className="text-[9px] text-slate-400">
                            {calc.hasEnvase ? `Precio / ${calc.pres.envase === 'bolsas' ? 'Bolsa' : 'Envase'}` : `Precio / ${calc.pres.unidadBase}`}
                            {calc.hasEnvase && calc.precioBase > 0 && ` (≈ $${calc.precioBase.toFixed(2)}/${calc.pres.unidadBase})`}
                          </div>
                          {calc.subtotalUsd > 0 && (
                            <div className="text-[10px] font-mono font-bold text-emerald-400">
                              USD ${Math.round(calc.subtotalUsd).toLocaleString('es-AR')}{' '}
                              <span className="text-slate-400 font-normal">(${calc.costoHaUsd.toFixed(1)}/ha)</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Botón Volcar a Insumos y Borrar */}
                      <div className="col-span-1 flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleVolcarRecetaAInsumos(idx)}
                          className="p-1 rounded bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-400 hover:text-emerald-300 transition cursor-pointer"
                          title="Volcar automáticamente a Insumos Reales"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRecetaRow(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                          title="Eliminar fila"
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

          {/* SECCIÓN 3: Insumos y Remitos Aplicados (Reales) */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>3. Insumos y Remitos Aplicados (Reales)</span>
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerScanSection('insumos')}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                  title="Subir archivo o foto de remito/factura de insumos con IA"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>✨ Leer Remito con IA</span>
                </button>
                <button
                  type="button"
                  onClick={addInsumoRow}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Cargar Remito / Aplicación</span>
                </button>
              </div>
            </div>

            {form.insumos_json.length === 0 ? (
              <p className="text-slate-500 italic text-center py-3">
                No hay remitos ni insumos aplicados registrados aún. Usá "↓ Volcar" en la receta o "+ Cargar Remito".
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-amber-300 uppercase px-2 mb-1 tracking-wider">
                  <div className="col-span-2">Fecha & Remito</div>
                  <div className="col-span-2">Producto & Proveedor</div>
                  <div className="col-span-2">Presentación / Envase</div>
                  <div className={isAdmin ? 'col-span-2' : 'col-span-3'}>Modo & Cantidad</div>
                  {isAdmin && <div className="col-span-3 text-right">Precio Unitario & Subtotal</div>}
                  <div className="col-span-1 text-center">Acción</div>
                </div>

                {form.insumos_json.map((ins, idx) => {
                  const calc = calcularRenglonInsumo(ins, totHaActual, dolarRef);
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center bg-slate-900 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition"
                    >
                      {/* Fecha y Remito */}
                      <div className="col-span-2 space-y-1">
                        <input
                          type="date"
                          value={ins.fecha || ''}
                          onChange={(e) => updateInsumoRow(idx, 'fecha', e.target.value)}
                          onClick={(e) => e.currentTarget.showPicker?.()}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-white text-[10px] cursor-pointer focus:border-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="N° Remito"
                          value={ins.remito || ''}
                          onChange={(e) => updateInsumoRow(idx, 'remito', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-slate-300 text-[10px]"
                        />
                      </div>

                      {/* Producto y Proveedor */}
                      <div className="col-span-2 space-y-1">
                        <input
                          type="text"
                          placeholder="Producto / Insumo"
                          value={ins.producto || ''}
                          onChange={(e) => updateInsumoRow(idx, 'producto', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-amber-300 font-semibold text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Proveedor / Cooperativa"
                          value={ins.proveedor || ''}
                          onChange={(e) => updateInsumoRow(idx, 'proveedor', e.target.value)}
                          className="w-full bg-slate-950/60 border border-slate-800 rounded px-2 py-0.5 text-[10px] text-slate-400"
                        />
                      </div>

                      {/* Presentación / Envase */}
                      <div className="col-span-2 space-y-1">
                        <select
                          value={ins.presentacion || calc.pres.id}
                          onChange={(e) => updateInsumoRow(idx, 'presentacion', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200"
                        >
                          {PRESENTACIONES_INSUMOS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <div className="text-[9.5px] text-slate-400 px-0.5">
                          {calc.hasEnvase ? `${calc.pres.factor} ${calc.pres.unidadBase} / ${calc.pres.envase === 'bolsas' ? 'bolsa' : 'envase'}` : 'Unidad directa'}
                        </div>
                      </div>

                      {/* Modo & Cantidad (Dosis/ha vs Cantidad Total) */}
                      <div className={(isAdmin ? 'col-span-2' : 'col-span-3') + ' space-y-1'}>
                        <div className="flex items-center gap-1 mb-1">
                          <button
                            type="button"
                            onClick={() => {
                              updateInsumoRow(idx, 'modo_calculo', 'dosis');
                              if (!ins.dosis_ha && calc.dosisReal > 0) updateInsumoRow(idx, 'dosis_ha', calc.dosisReal);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold cursor-pointer transition ${
                              calc.modoCalculo === 'dosis'
                                ? 'bg-amber-500 text-slate-950 font-black shadow-2xs'
                                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                            title="Calcular a partir de la dosis prescripta por hectárea"
                          >
                            Dosis/ha
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateInsumoRow(idx, 'modo_calculo', 'total');
                              if (!ins.cantidad) updateInsumoRow(idx, 'cantidad', calc.hasEnvase ? calc.cantEnvases : calc.totalBase);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold cursor-pointer transition ${
                              calc.modoCalculo === 'total'
                                ? 'bg-amber-500 text-slate-950 font-black shadow-2xs'
                                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                            title="Ingresar cantidad total de envases o kilos aplicados"
                          >
                            Cant. Total
                          </button>
                        </div>

                        {calc.modoCalculo === 'dosis' ? (
                          <>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={ins.dosis_ha ?? ''}
                                placeholder="Dosis"
                                onChange={(e) => updateInsumoRow(idx, 'dosis_ha', e.target.value)}
                                className="w-full min-w-[115px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-white font-mono font-bold text-xs text-right focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-[10px] text-slate-300 shrink-0 font-bold uppercase">
                                {calc.pres.unidadBase}/ha
                              </span>
                            </div>
                            <div className="text-[9.5px] font-mono text-emerald-400 font-semibold mt-0.5 truncate">
                              = {calc.totalBase.toLocaleString('es-AR')} {calc.pres.unidadBase} totales
                              {calc.hasEnvase && ` (${calc.cantEnvases} ${calc.pres.envase})`}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={ins.cantidad ?? ''}
                                placeholder={calc.hasEnvase ? (calc.pres.envase || 'Bolsas') : 'Cantidad'}
                                onChange={(e) => updateInsumoRow(idx, 'cantidad', e.target.value)}
                                className="w-full min-w-[115px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-white font-mono font-bold text-xs text-right focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-[10px] text-slate-300 shrink-0 font-bold uppercase">
                                {calc.hasEnvase ? (calc.pres.envase || 'bolsas') : calc.pres.unidadBase}
                              </span>
                            </div>
                            <div className="text-[9.5px] font-mono text-emerald-400 font-semibold mt-0.5 truncate">
                              {calc.hasEnvase ? (
                                <>
                                  = {calc.totalBase.toLocaleString('es-AR')} {calc.pres.unidadBase} ·{' '}
                                  <span className="text-amber-300 font-bold">{calc.dosisReal.toFixed(2)} {calc.pres.unidadBase}/ha</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-amber-300 font-bold">{calc.dosisReal.toFixed(2)} {calc.pres.unidadBase}/ha</span>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Precio Unitario & Subtotal Calculado (Solo Modo Admin) */}
                      {isAdmin && (
                        <div className="col-span-3 text-right space-y-1">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => updateInsumoRow(idx, 'moneda', calc.moneda === 'USD' ? 'ARS' : 'USD')}
                              className={
                                'px-1.5 py-0.5 rounded text-[10px] font-black cursor-pointer border shrink-0 transition ' +
                                (calc.moneda === 'USD'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-blue-500/20 text-blue-300 border-blue-500/40')
                              }
                              title="Cambiar moneda (USD / ARS)"
                            >
                              {calc.moneda}
                            </button>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={ins.precio_unitario ?? ''}
                              placeholder={`P. Unit / ${calc.unidadPrecio}`}
                              onChange={(e) => updateInsumoRow(idx, 'precio_unitario', e.target.value)}
                              className="w-full min-w-[115px] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-amber-300 font-mono font-bold text-xs text-right focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                          <div className="text-[9.5px] text-slate-400 pr-1">
                            Precio / {calc.unidadPrecio}
                            {calc.hasEnvase && calc.precioBase > 0 && (
                              <span className="text-slate-500 font-mono"> (≈ ${calc.precioBase.toFixed(2)}/{calc.pres.unidadBase})</span>
                            )}
                          </div>
                          <div className="bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-right">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                              Subtotal Calculado:
                            </div>
                            <div className="text-xs font-mono font-black text-emerald-400">
                              {calc.moneda} ${calc.subtotalUsd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                              <span className="text-[9.5px] text-slate-400 font-normal">(${calc.costoHaUsd.toFixed(1)}/ha)</span>
                            </div>
                            <div className="text-[9.5px] font-mono text-slate-400">
                              ≈ ARS ${Math.round(calc.subtotalArs).toLocaleString('es-AR')}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Botón Borrar */}
                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeInsumoRow(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                          title="Eliminar insumo"
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

          {/* SECCIÓN 4: Labores Agrícolas & Contratista */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400" />
                <span>4. Labores Agrícolas & Contratista (Maquinaria)</span>
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerScanSection('labores')}
                  className="px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                  title="Subir archivo o foto de factura/orden de labor con IA"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>✨ Leer Labor con IA</span>
                </button>
                <button
                  type="button"
                  onClick={addLaborRow}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Agregar Labor</span>
                </button>
              </div>
            </div>

            {form.labores_json.length === 0 ? (
              <p className="text-slate-500 italic text-center py-3">
                No hay labores registradas. Agregá laboreo de suelo, siembra directa, pulverización o fertilización.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-indigo-300 uppercase px-2 mb-1 tracking-wider">
                  <div className="col-span-2">Fecha</div>
                  <div className={isAdmin ? 'col-span-3' : 'col-span-4'}>Labor Agrícola</div>
                  <div className={isAdmin ? 'col-span-2' : 'col-span-3'}>Contratista / Equipo</div>
                  <div className="col-span-2 text-right">Superficie (ha)</div>
                  {isAdmin && <div className="col-span-2 text-right">Tarifa & Subtotal</div>}
                  <div className="col-span-1 text-center">Acción</div>
                </div>

                {form.labores_json.map((lab, idx) => {
                  const calc = calcularRenglonLabor(lab, totHaActual, dolarRef);
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center bg-slate-900 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition"
                    >
                      {/* Fecha */}
                      <div className="col-span-2">
                        <input
                          type="date"
                          value={lab.fecha || ''}
                          onChange={(e) => updateLaborRow(idx, 'fecha', e.target.value)}
                          onClick={(e) => e.currentTarget.showPicker?.()}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-[11px] cursor-pointer focus:border-emerald-500"
                        />
                      </div>

                      {/* Labor Agrícola */}
                      <div className={isAdmin ? 'col-span-3' : 'col-span-4'}>
                        <input
                          type="text"
                          list="labores_modal_list"
                          placeholder="Labor agrícola"
                          value={lab.labor || ''}
                          onChange={(e) => updateLaborRow(idx, 'labor', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-white font-semibold text-xs"
                        />
                        <datalist id="labores_modal_list">
                          {LABORES_PREDEFINIDAS.map((l) => (
                            <option key={l} value={l} />
                          ))}
                        </datalist>
                      </div>

                      {/* Contratista */}
                      <div className={isAdmin ? 'col-span-2' : 'col-span-3'}>
                        <input
                          type="text"
                          placeholder="Contratista / Equipo"
                          value={lab.contratista || ''}
                          onChange={(e) => updateLaborRow(idx, 'contratista', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 text-xs"
                        />
                      </div>

                      {/* Hectáreas */}
                      <div className="col-span-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="any"
                            min="0.1"
                            value={lab.ha !== undefined && lab.ha !== '' ? lab.ha : totHaActual}
                            onChange={(e) => updateLaborRow(idx, 'ha', e.target.value)}
                            className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono font-bold text-xs text-right focus:outline-none focus:border-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-[10px] text-slate-400">ha</span>
                        </div>
                      </div>

                      {/* Tarifa / ha y Subtotal (Solo Modo Admin) */}
                      {isAdmin && (
                        <div className="col-span-2 text-right space-y-0.5">
                          <div className="flex items-center justify-end gap-1 mb-1">
                            <button
                              type="button"
                              onClick={() => updateLaborRow(idx, 'modo_tarifa', 'por_ha')}
                              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold cursor-pointer transition ${
                                calc.modoTarifa === 'por_ha'
                                  ? 'bg-indigo-600 text-white font-black shadow-2xs'
                                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              $/ha
                            </button>
                            <button
                              type="button"
                              onClick={() => updateLaborRow(idx, 'modo_tarifa', 'monto_fijo')}
                              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold cursor-pointer transition ${
                                calc.modoTarifa === 'monto_fijo'
                                  ? 'bg-indigo-600 text-white font-black shadow-2xs'
                                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Monto Fijo
                            </button>
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => updateLaborRow(idx, 'moneda', calc.moneda === 'USD' ? 'ARS' : 'USD')}
                              className={'px-1.5 py-0.5 rounded text-[10px] font-black cursor-pointer border ' + (calc.moneda === 'USD' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-blue-500/20 text-blue-300 border-blue-500/40')}
                            >
                              {calc.moneda}
                            </button>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={lab.tarifa_ha !== undefined && lab.tarifa_ha !== '' ? lab.tarifa_ha : (lab.costo_ha_usd || '')}
                              placeholder={calc.modoTarifa === 'por_ha' ? 'Tarifa/ha' : 'Monto total'}
                              onChange={(e) => updateLaborRow(idx, 'tarifa_ha', e.target.value)}
                              className="w-full min-w-[115px] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-indigo-300 font-mono font-bold text-xs text-right focus:outline-none focus:border-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5">
                            {calc.modoTarifa === 'por_ha' ? 'Tarifa por hectárea' : `Monto total del lote (≈ $${calc.tarifaHa.toFixed(1)}/ha)`}
                          </div>
                          <div className="bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800 mt-1">
                            <div className="text-[11px] font-mono font-black text-indigo-400">
                              USD ${Math.round(calc.subtotalUsd).toLocaleString('es-AR')}
                            </div>
                            <div className="text-[9.5px] font-mono text-slate-400">
                              ≈ ARS ${Math.round(calc.subtotalArs).toLocaleString('es-AR')}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Botón Borrar */}
                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeLaborRow(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                          title="Eliminar labor"
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

          {/* Observaciones agronómicas */}
          <div>
            <label className="text-[11px] font-semibold text-slate-300 block mb-1">
              Observaciones agronómicas / notas técnicas del lote
            </label>
            <textarea
              rows={2}
              value={form.observaciones}
              onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
              placeholder="Instrucciones de mezcla, condiciones climáticas, estado del rastrojo, humedad..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          {/* PANEL CONSOLIDADO: FINANCIERO (MODO ADMIN) VS TÉCNICO (MODO PRODUCCIÓN) */}
          {isAdmin ? (
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-emerald-500/40 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-emerald-400" />
                  <span>Consolidado de Inversión Agronómica en Vivo</span>
                </span>
                <span className="text-xs font-mono font-black text-emerald-300 bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-800">
                  Superficie Total: {totHaActual.toFixed(1)} ha ({isMultiPotrero ? (selectedPotreros.length + ' potreros') : ('Potrero #' + form.potrero_numero)})
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {/* Semillas */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-teal-400 font-bold block uppercase tracking-wider mb-0.5">🌱 Semillas</span>
                  <span className="text-sm font-black text-white font-mono block">
                    USD ${Math.round(totalSemillasUsd).toLocaleString('es-AR')}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ${(totHaActual > 0 ? totalSemillasUsd / totHaActual : 0).toFixed(1)}/ha
                  </span>
                </div>

                {/* Agroquímicos */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-amber-400 font-bold block uppercase tracking-wider mb-0.5">🧪 Insumos / Químicos</span>
                  <span className="text-sm font-black text-white font-mono block">
                    USD ${Math.round(totalAgroquimicosUsd).toLocaleString('es-AR')}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ${(totHaActual > 0 ? totalAgroquimicosUsd / totHaActual : 0).toFixed(1)}/ha
                  </span>
                </div>

                {/* Labores */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-indigo-400 font-bold block uppercase tracking-wider mb-0.5">🚜 Labores & Contratista</span>
                  <span className="text-sm font-black text-white font-mono block">
                    USD ${Math.round(totalLaboresUsd).toLocaleString('es-AR')}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ${(totHaActual > 0 ? totalLaboresUsd / totHaActual : 0).toFixed(1)}/ha
                  </span>
                </div>

                {/* Inversión Consolidada */}
                <div className="bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/50">
                  <span className="text-[10px] text-emerald-400 font-black block uppercase tracking-wider mb-0.5">💰 Inversión Total</span>
                  <span className="text-sm font-black text-emerald-300 font-mono block">
                    USD ${Math.round(totalInversionUsd).toLocaleString('es-AR')}
                  </span>
                  <span className="text-[10px] text-slate-300 font-mono">
                    ARS ${Math.round(totalInversionArs).toLocaleString('es-AR')} (${usdPorHa.toFixed(1)}/ha)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-emerald-500/30 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Sprout className="w-4 h-4 text-emerald-400" />
                  <span>Resumen Técnico Operativo de Siembra (Modo Campo)</span>
                </span>
                <span className="text-xs font-mono font-black text-emerald-300 bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-800">
                  Superficie Total: {totHaActual.toFixed(1)} ha ({isMultiPotrero ? (selectedPotreros.length + ' potreros') : ('Potrero #' + form.potrero_numero)})
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {/* Cultivo / Variedad */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-teal-400 font-bold block uppercase tracking-wider mb-0.5">🌱 Recurso Forrajero</span>
                  <span className="text-xs font-black text-white truncate block">
                    {form.cultivo_variedad || 'Pastura'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {form.variedad_hibrido || 'Campaña ' + (form.campana || '2026/2027')}
                  </span>
                </div>

                {/* Receta */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-teal-300 font-bold block uppercase tracking-wider mb-0.5">📋 Prescripción Técnica</span>
                  <span className="text-sm font-black text-teal-400 font-mono block">
                    {form.receta_json.length} {form.receta_json.length === 1 ? 'producto' : 'productos'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    dosificados para {totHaActual.toFixed(1)} ha
                  </span>
                </div>

                {/* Insumos */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-amber-400 font-bold block uppercase tracking-wider mb-0.5">🧪 Insumos Aplicados</span>
                  <span className="text-sm font-black text-amber-300 font-mono block">
                    {form.insumos_json.length} {form.insumos_json.length === 1 ? 'aplicación' : 'aplicaciones'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    con remitos de campo
                  </span>
                </div>

                {/* Labores */}
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-indigo-400 font-bold block uppercase tracking-wider mb-0.5">🚜 Maquinaria & Labores</span>
                  <span className="text-sm font-black text-indigo-300 font-mono block">
                    {form.labores_json.length} {form.labores_json.length === 1 ? 'labor' : 'labores'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Estado: {form.estado || 'Sembrado'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal con Acciones */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/90 rounded-b-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
          <div className="text-xs text-slate-400">
            {isAdmin ? (
              <>Dólar Ref: <span className="font-bold text-white font-mono">${dolarRef}</span> · Prorrateo automático por ha al guardar.</>
            ) : (
              <>Superficie: <span className="font-bold text-white font-mono">{totHaActual.toFixed(1)} ha</span> · Registro técnico operativo de campo.</>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmSave}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-2 cursor-pointer transition active:scale-95"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>
                    {isMultiPotrero
                      ? 'Guardar en ' + selectedPotreros.length + ' Potreros (' + totHaActual.toFixed(1) + ' ha)'
                      : 'Guardar Ficha de Siembra'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// =========================================================================
// SUBCOMPONENTE: MODAL IA PARA ESCANEAR RECETA O REMITO (MULTI-LOTE / MULTI-FORMATO)
// =========================================================================
function findMatchingPotrero(detectado, potrerosList = []) {
  if (!detectado) return potrerosList[0] || null;
  const str = String(detectado).toLowerCase().trim();
  const m = str.match(/(?:p|lote|potrero)?\s*#?\s*(\d+)/i);
  if (m) {
    const num = Number(m[1]);
    const found = potrerosList.find((p) => Number(p.numero) === num);
    if (found) return found;
  }
  const byName = potrerosList.find((p) => {
    if (!p.nombre) return false;
    const n = p.nombre.toLowerCase();
    return str.includes(n) || n.includes(str);
  });
  if (byName) return byName;
  return potrerosList[0] || null;
}

function calculateLoteData(loteRaw, matchedPotrero, stockInsumos = [], monedaOverride = null, dolarRef = 1540, siembrasExistentes = []) {
  const safeRaw = (loteRaw && typeof loteRaw === 'object') ? loteRaw : {};
  const potreroNum = matchedPotrero ? Number(matchedPotrero.numero) : (Number(safeRaw.potrero_detectado) || 1);
  const potreroNombre = matchedPotrero?.nombre || `Potrero #${potreroNum}`;
  const ha = Number(safeRaw.superficie_ha) > 0
    ? Number(safeRaw.superficie_ha)
    : (Number(matchedPotrero?.hectareas) || 50);

  // Sub-sector detectado (ej: Bajo, Loma, Norte) — Limpieza de 'vacio', 'sin especificar'
  let rawSector = String(safeRaw.sector || '').trim();
  if (/^(vacio|vacío|null|undefined|sin especificar|none|no especificado|n\/a|general|-)$/i.test(rawSector)) {
    rawSector = '';
  }
  let sector = rawSector;
  if (!sector && safeRaw.potrero_detectado) {
    const sMatch = String(safeRaw.potrero_detectado).match(/\b(bajo|loma|norte|sur|este|oeste|fondo|frente|rincon|alto|medio)\b/i);
    if (sMatch) {
      sector = sMatch[0].charAt(0).toUpperCase() + sMatch[0].slice(1).toLowerCase();
    }
  }

  // Detección estricta de moneda
  let moneda = monedaOverride || safeRaw.moneda;
  const rawInsumos = Array.isArray(safeRaw.insumos) ? safeRaw.insumos : [];
  if (!moneda) {
    const rawCostLab = Number(safeRaw.costo_labor_ha) || 0;
    const rawCostDec = Number(safeRaw.costo_total_declarado) || 0;
    const hasHighInsumos = rawInsumos.some(
      (i) => (Number(i.precio_unitario) || 0) > 1000 || (Number(i.costo_total) || 0) > 50000
    );
    if (rawCostLab > 1000 || rawCostDec > 50000 || hasHighInsumos) {
      moneda = 'ARS';
    } else {
      moneda = 'USD';
    }
  }

  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;

  // Labores desglosadas por lote (pasadas de disco, siembra, pulverización)
  const rawLabores = Array.isArray(safeRaw.labores_detalle)
    ? safeRaw.labores_detalle
    : Array.isArray(safeRaw.labores)
    ? safeRaw.labores
    : Array.isArray(safeRaw.pasadas)
    ? safeRaw.pasadas
    : [];

  const laboresCalculadas = rawLabores.map((lab, lIdx) => {
    const concepto = lab.concepto || lab.labor || lab.tarea || lab.nombre || `Labor #${lIdx + 1}`;
    const haLab = Number(lab.hectareas || lab.ha) > 0 ? Number(lab.hectareas || lab.ha) : ha;
    let puLab = Number(lab.precio_unitario || lab.precio || lab.precio_ha || lab.tarifa) || 0;
    let precioSugeridoRef = false;
    let refPrecioLabel = '';

    if (puLab === 0 && Array.isArray(siembrasExistentes) && siembrasExistentes.length > 0) {
      const matchLabor = buscarUltimoPrecioLabor(concepto, siembrasExistentes);
      if (matchLabor && matchLabor.precio_ha > 0) {
        puLab = matchLabor.precio_ha;
        precioSugeridoRef = true;
        refPrecioLabel = 'Ref. última labor';
      }
    }

    const subtotal = Number(lab.subtotal || lab.costo_total) > 0
      ? Number(lab.subtotal || lab.costo_total)
      : Number((haLab * puLab).toFixed(2));

    return {
      id: `lab_${lIdx}`,
      concepto,
      hectareas: haLab,
      precio_unitario: puLab,
      subtotal,
      precio_sugerido_ref: precioSugeridoRef,
      ref_precio_label: refPrecioLabel,
    };
  });

  const costoLaboresSum = laboresCalculadas.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);

  // Insumos calculados
  const insumosCalculados = (rawInsumos || []).map((ins, iIdx) => {
    const prodName = String(ins.producto || '').trim();
    const dosisHa = Number(ins.dosis_ha) || 0;
    const cantTotal = Number(ins.cantidad_total) > 0 ? Number(ins.cantidad_total) : Number((dosisHa * ha).toFixed(2));

    const matchStock = (stockInsumos || []).find((s) => {
      const sName = (s.nombre || '').toLowerCase();
      const pName = prodName.toLowerCase();
      return sName.includes(pName) || pName.includes(sName);
    });

    let precioUnitario = Number(ins.precio_unitario) || 0;
    let precioSugeridoRef = false;
    let refPrecioLabel = '';

    if (precioUnitario === 0 && matchStock) {
      const refStock = Number(matchStock.precio_unitario_ref || matchStock.costo_unitario_usd || 0);
      precioUnitario = moneda === 'ARS' ? refStock * tc : refStock;
      if (precioUnitario > 0) {
        precioSugeridoRef = true;
        refPrecioLabel = 'Ref. Stock Galpón';
      }
    }

    if (precioUnitario === 0) {
      const matchRef = buscarUltimoPrecioInsumo(prodName, stockInsumos, siembrasExistentes, tc);
      if (matchRef && matchRef.precio_unitario > 0) {
        precioUnitario = matchRef.precio_unitario;
        precioSugeridoRef = true;
        refPrecioLabel = matchRef.fuente === 'stock_insumo' ? 'Ref. Stock Galpón' : 'Ref. última compra';
      }
    }

    const costoTotal = Number(ins.costo_total) > 0 ? Number(ins.costo_total) : Number((cantTotal * precioUnitario).toFixed(2));
    const stockDisponible = matchStock ? Number(matchStock.stock_campo || matchStock.cantidad_actual || 0) : null;
    const stockInsuficiente = stockDisponible !== null && cantTotal > stockDisponible;

    return {
      id: `ins_${iIdx}`,
      producto: prodName,
      dosis_ha: dosisHa,
      unidad: ins.unidad || 'L',
      cantidad_total: cantTotal,
      precio_unitario: precioUnitario,
      costo_total: costoTotal,
      stock_disponible: stockDisponible,
      stock_insuficiente: stockInsuficiente,
      stock_id: matchStock?.id || null,
      precio_sugerido_ref: precioSugeridoRef,
      ref_precio_label: refPrecioLabel,
    };
  });

  const costoInsumos = insumosCalculados.reduce((sum, item) => sum + (Number(item.costo_total) || 0), 0);
  let costoLaborHa = Number(safeRaw.costo_labor_ha) || 0;
  let costoLaborTotal = 0;

  if (costoLaboresSum > 0) {
    costoLaborTotal = costoLaboresSum;
    if (costoLaborHa === 0 && ha > 0) {
      costoLaborHa = Math.round(costoLaborTotal / ha);
    }
  } else {
    costoLaborTotal = Number((costoLaborHa * ha).toFixed(2));
  }

  // Respetar subtotal explícito declarado en el documento si existe
  const costoDeclarado = Number(safeRaw.costo_total_declarado) || 0;
  let costoTotalLote = 0;
  if (costoDeclarado > 0) {
    if (insumosCalculados.length === 0 && costoLaboresSum === 0 && costoLaborTotal === 0) {
      costoLaborTotal = costoDeclarado;
      costoLaborHa = ha > 0 ? Math.round(costoLaborTotal / ha) : 0;
    }
    costoTotalLote = costoDeclarado;
  } else {
    costoTotalLote = Number((costoInsumos + costoLaborTotal).toFixed(2));
  }

  // Calcular equivalentes ARS y USD
  let costoTotalARS = 0;
  let costoTotalUSD = 0;
  let costoLaborARS = 0;
  let costoLaborUSD = 0;
  let costoInsumosARS = 0;
  let costoInsumosUSD = 0;

  if (moneda === 'ARS') {
    costoTotalARS = costoTotalLote;
    costoTotalUSD = Number((costoTotalARS / tc).toFixed(2));
    costoLaborARS = costoLaborTotal;
    costoLaborUSD = Number((costoLaborARS / tc).toFixed(2));
    costoInsumosARS = costoInsumos;
    costoInsumosUSD = Number((costoInsumosARS / tc).toFixed(2));
  } else {
    costoTotalUSD = costoTotalLote;
    costoTotalARS = Number((costoTotalUSD * tc).toFixed(2));
    costoLaborUSD = costoLaborTotal;
    costoLaborARS = Number((costoLaborUSD * tc).toFixed(2));
    costoInsumosUSD = costoInsumos;
    costoInsumosARS = Number((costoInsumosUSD * tc).toFixed(2));
  }

  return {
    id: `lote_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    selected: true,
    potrero_numero: potreroNum,
    potrero_nombre: potreroNombre,
    sector,
    potrero_detectado_original: safeRaw.potrero_detectado || '',
    cultivo_o_labor: safeRaw.cultivo_o_labor || 'Siembra Directa',
    variedad_hibrido: safeRaw.variedad_hibrido || '',
    fecha_estimada: safeRaw.fecha_estimada || new Date().toLocaleDateString('es-AR'),
    hectareas: ha,
    moneda,
    costo_labor_ha: costoLaborHa,
    costo_labor_total: costoLaborTotal,
    costo_insumos: costoInsumos,
    costo_total: costoTotalLote,
    costo_total_declarado: costoDeclarado,
    costo_total_ars: costoTotalARS,
    costo_total_usd: costoTotalUSD,
    costo_labor_ars: costoLaborARS,
    costo_labor_usd: costoLaborUSD,
    costo_insumos_ars: costoInsumosARS,
    costo_insumos_usd: costoInsumosUSD,
    labores_detalle: laboresCalculadas,
    insumos: insumosCalculados,
    observaciones: safeRaw.observaciones || '',
    rawLote: safeRaw,
    expanded: false,
  };
}

/**
 * Verifica si un producto cotizado o remito coincide agronómicamente con el lote destino:
 * 1. Tokens del cultivo / variedad del lote destino.
 * 2. Insumos ya prescriptos en la receta agronómica del lote destino.
 */
export function checkItemMatchesTargetSiembra(item, targetSiembra) {
  if (!item || !targetSiembra) return false;
  const prodName = String(item.producto || '').toLowerCase().trim();
  if (!prodName) return false;

  // 1. Coincidencia con cultivo o variedad del lote destino
  const cultivo = String(targetSiembra.cultivo_variedad || '').toLowerCase();
  const variedad = String(targetSiembra.variedad_hibrido || '').toLowerCase();
  const tokensTarget = [...cultivo.split(/[\s+/,-]+/), ...variedad.split(/[\s+/,-]+/)].filter(
    (t) => t.length >= 3 && !['para', 'con', 'mas', 'más', 'del', 'los', 'las', 'sur', 'lote', 'potrero'].includes(t)
  );

  for (const t of tokensTarget) {
    if (prodName.includes(t)) return true;
  }

  // 2. Coincidencia con insumos ya prescriptos en la receta del lote
  const insumosLote = Array.isArray(targetSiembra.insumos_json)
    ? targetSiembra.insumos_json
    : Array.isArray(targetSiembra.receta_json)
    ? targetSiembra.receta_json
    : [];

  const cleanProd = prodName.replace(/[^a-z0-9]/g, '');

  for (const ins of insumosLote) {
    const insNom = String(ins.producto || '').toLowerCase().trim();
    if (!insNom) continue;
    const cleanIns = insNom.replace(/[^a-z0-9]/g, '');
    if (cleanProd && cleanIns) {
      if (cleanProd.includes(cleanIns) || cleanIns.includes(cleanProd)) return true;
      if (cleanProd.length >= 4 && cleanIns.length >= 4 && cleanProd.slice(0, 5) === cleanIns.slice(0, 5)) return true;
    }
  }

  return false;
}

function initCompraGeneralItem(cg, currentLotes = [], cgIdx = 0, stockInsumos = [], siembrasExistentes = [], dolarRef = 1540) {
  const prodName = String(cg.producto || '').trim();
  const prodLower = prodName.toLowerCase();

  // Detectar peso del envase si es bolsa o bidón
  let pesoEnvase = 25; // default 25 kg
  const pMatch = (prodName + ' ' + (cg.unidad || '')).match(/\b(\d+)\s*(kg|l|litros?)\b/i);
  if (pMatch) {
    pesoEnvase = Number(pMatch[1]) || 25;
  }

  // Detectar precio unitario de referencia si no viene en el comprobante
  let pu = Number(cg.precio_unitario) || 0;
  let precioSugeridoRef = false;
  let refPrecioLabel = '';
  if (pu === 0) {
    const matchRef = buscarUltimoPrecioInsumo(prodName, stockInsumos, siembrasExistentes, dolarRef);
    if (matchRef && matchRef.precio_unitario > 0) {
      pu = matchRef.precio_unitario;
      precioSugeridoRef = true;
      refPrecioLabel = matchRef.fuente === 'stock_insumo' ? 'Ref. Stock Galpón' : 'Ref. última compra';
    }
  }

  const cantTotal = Number(cg.cantidad_total) || 0;
  const costoTotal = Number(cg.costo_total) > 0 ? Number(cg.costo_total) : Number((cantTotal * pu).toFixed(2));

  // Detectar destino inteligente por producto
  let destino = 'todos';
  if (prodLower.includes('sorgo')) {
    destino = 'sorgo';
  } else if (prodLower.includes('maiz') || prodLower.includes('maíz')) {
    destino = 'maiz';
  } else if (prodLower.includes('soja')) {
    destino = 'soja';
  } else if (prodLower.includes('girasol')) {
    destino = 'girasol';
  } else if (prodLower.includes('avena')) {
    destino = 'avena';
  }

  // Detectar dosis inicial si viene en observaciones o notas
  let dosisHa = 0;
  let dosisUnidad = 'kg/ha';
  const obs = String(cg.observaciones || '');
  const dMatch = obs.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|l|litros?|bolsas?)\/ha\b/i);
  if (dMatch) {
    dosisHa = parseFloat(dMatch[1].replace(',', '.'));
    dosisUnidad = `${dMatch[2].toLowerCase()}/ha`;
  } else {
    // Valores agronómicos estándar San José
    if (prodLower.includes('sorgo')) {
      dosisHa = 25;
      dosisUnidad = 'kg/ha';
    } else if (prodLower.includes('maiz') || prodLower.includes('maíz')) {
      dosisHa = 20;
      dosisUnidad = 'kg/ha';
    } else if (prodLower.includes('monoam') || prodLower.includes('map') || prodLower.includes('fosfat')) {
      dosisHa = 50;
      dosisUnidad = 'kg/ha';
    } else if (prodLower.includes('urea')) {
      dosisHa = 80;
      dosisUnidad = 'kg/ha';
    } else if (prodLower.includes('glifosato')) {
      dosisHa = 3;
      dosisUnidad = 'L/ha';
    } else if (prodLower.includes('2,4-d') || prodLower.includes('2.4-d')) {
      dosisHa = 0.8;
      dosisUnidad = 'L/ha';
    } else if (prodLower.includes('atrazina')) {
      dosisHa = 2;
      dosisUnidad = 'L/ha';
    } else {
      dosisHa = 1;
      dosisUnidad = String(cg.unidad || '').toLowerCase().includes('l') ? 'L/ha' : 'kg/ha';
    }
  }

  return {
    ...cg,
    id: cg.id || `cg_${Date.now()}_${cgIdx}`,
    precio_unitario: pu,
    costo_total: costoTotal,
    precio_sugerido_ref: precioSugeridoRef,
    ref_precio_label: refPrecioLabel,
    peso_envase: pesoEnvase,
    destino,
    dosis_ha: dosisHa,
    dosis_unidad: dosisUnidad,
  };
}

function calcularImputacionItem(cg, lotesList = []) {
  const activeLotes = lotesList.filter((l) => l.selected);
  let targetLotes = [];

  if (cg.destino === 'reserva') {
    targetLotes = [];
  } else if (cg.destino === 'todos') {
    targetLotes = activeLotes;
  } else if (cg.destino === 'sorgo') {
    targetLotes = activeLotes.filter((l) => (l.cultivo_o_labor || '').toLowerCase().includes('sorgo'));
  } else if (cg.destino === 'maiz') {
    targetLotes = activeLotes.filter((l) => (l.cultivo_o_labor || '').toLowerCase().includes('maiz') || (l.cultivo_o_labor || '').toLowerCase().includes('maíz'));
  } else {
    targetLotes = activeLotes.filter((l) => (l.cultivo_o_labor || '').toLowerCase().includes(String(cg.destino).toLowerCase()));
  }

  const haDestino = targetLotes.reduce((sum, l) => sum + (Number(l.hectareas) || 0), 0);
  const dosis = Number(cg.dosis_ha) || 0;
  const esEnvaseBolsa = String(cg.unidad || '').toLowerCase().includes('bolsa');
  const pesoEnv = Number(cg.peso_envase) > 0 ? Number(cg.peso_envase) : 25;

  let totalRequerido = 0; // en la unidad de compra (ej. bolsas o kg)
  let totalKgOrLRequerido = 0;

  if (esEnvaseBolsa) {
    if (cg.dosis_unidad === 'bolsas/ha') {
      totalRequerido = Math.ceil(haDestino * dosis);
      totalKgOrLRequerido = totalRequerido * pesoEnv;
    } else {
      // dosis en kg/ha
      totalKgOrLRequerido = Math.round(haDestino * dosis * 10) / 10;
      totalRequerido = Math.ceil(totalKgOrLRequerido / pesoEnv);
    }
  } else {
    // kg directo, L directo
    totalRequerido = Math.round(haDestino * dosis * 10) / 10;
    totalKgOrLRequerido = totalRequerido;
  }

  const comprado = Number(cg.cantidad_total) || 0;
  const aplicado = Math.min(comprado, totalRequerido);
  const remanente = Math.max(0, comprado - aplicado);
  const faltante = Math.max(0, totalRequerido - comprado);

  return {
    targetLotes,
    haDestino,
    totalRequerido,
    totalKgOrLRequerido,
    comprado,
    aplicado,
    remanente,
    faltante,
    esEnvaseBolsa,
    pesoEnv,
  };
}

function GeminiSiembraModal({
  potreros = [],
  rodeos = [],
  stockInsumos = [],
  siembrasExistentes = [],
  targetSiembra = null,
  modoInicial = 'nuevo',
  fechaOperacion = '',
  dolarRef = 1540,
  isSandboxMode = false,
  isAdmin = true,
  onClose,
  onApply,
  onRefresh,
  notify,
}) {
  const [modoOperacion, setModoOperacion] = useState(modoInicial || 'nuevo');
  const [extractorRole, setExtractorRole] = useState(
    modoInicial === 'factura' || modoInicial === 'cruzar'
      ? 'factura'
      : modoInicial === 'labores'
      ? 'labores'
      : modoInicial === 'receta'
      ? 'receta'
      : 'auto'
  );
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [contextoUsuario, setContextoUsuario] = useState('');
  const [scanning, setScanning] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [metaData, setMetaData] = useState(null);
  const [lotes, setLotes] = useState([]);
  const [comprasGenerales, setComprasGenerales] = useState([]);
  const [monedaDoc, setMonedaDoc] = useState('ARS');
  const [savingBatch, setSavingBatch] = useState(false);
  const fileInputRef = useRef(null);
  const isCancelledRef = useRef(false);

  const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');

  // Cancelar análisis en curso de forma limpia
  function handleCancelScan() {
    isCancelledRef.current = true;
    setScanning(false);
    setProcessingMsg('');
    notify?.('Análisis cancelado por el usuario.', 'info');
  }

  // Bloqueo global de Drag & Drop en window para evitar que Chrome abra archivos en pestaña nueva
  useEffect(() => {
    function preventGlobalDrop(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener('dragover', preventGlobalDrop, false);
    window.addEventListener('drop', preventGlobalDrop, false);
    return () => {
      window.removeEventListener('dragover', preventGlobalDrop, false);
      window.removeEventListener('drop', preventGlobalDrop, false);
    };
  }, []);

  function handleFilesAdded(incoming) {
    if (scanning) return;
    const list = Array.from(incoming || []);
    if (list.length === 0) return;
    setErrorMsg('');

    setSelectedFiles((prev) => {
      const next = [...prev];
      list.forEach((file) => {
        const exists = next.some(
          (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        if (!exists) next.push(file);
      });
      return next;
    });
  }

  function handleRemoveFile(idxToRemove) {
    if (scanning) return;
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove));
  }

  function handleClearFiles() {
    if (scanning) return;
    setSelectedFiles([]);
    setErrorMsg('');
  }

  async function handleAnalyzeBatch() {
    const hasFiles = selectedFiles.length > 0;
    const hasContext = Boolean(contextoUsuario && contextoUsuario.trim().length > 0);
    if (!hasFiles && !hasContext) {
      setErrorMsg('Seleccioná o arrastrá archivos, o escribí indicaciones y precios en el recuadro de contexto para analizar.');
      return;
    }

    if (!hasGeminiKey() && !isSandbox) {
      const msg = 'Configurá la clave API de Gemini en el Copiloto IA o en .env para usar el escáner.';
      setErrorMsg(msg);
      notify?.(msg, 'error');
      return;
    }

    isCancelledRef.current = false;
    setScanning(true);
    setProcessingMsg(
      hasFiles
        ? `Preparando análisis de ${selectedFiles.length} documento(s)${hasContext ? ' con contexto del usuario' : ''} con Gemini IA...`
        : 'Interpretando indicaciones y precios en lenguaje natural con Gemini IA...'
    );
    setErrorMsg('');

    try {
      const onProgress = (current, total, currentFileName) => {
        if (isCancelledRef.current) return;
        setProcessingMsg(`Analizando archivo ${current} de ${total}: "${currentFileName}"...`);
      };

      const response = await analizarRecetaORemitoSiembra(
        selectedFiles,
        potreros,
        isSandbox,
        onProgress,
        contextoUsuario,
        extractorRole
      );

      if (isCancelledRef.current) return;

      const detectedMoneda = response?.moneda || 'ARS';
      setMonedaDoc(detectedMoneda);

      const rawLotes = Array.isArray(response?.lotes) ? response.lotes : [];
      const generalItems = Array.isArray(response?.compras_generales_campana)
        ? [...response.compras_generales_campana]
        : Array.isArray(response?.compras_generales)
        ? [...response.compras_generales]
        : [];

      // Separar compras mayoristas / a granel sin potrero específico
      const lotesParaPotreros = [];
      rawLotes.forEach((lRaw) => {
        const safeLRaw = (lRaw && typeof lRaw === 'object') ? lRaw : {};
        const pNom = String(safeLRaw.potrero_detectado || '').trim().toLowerCase();
        const esGeneral =
          !pNom ||
          pNom === 'general' ||
          pNom === 'compra' ||
          pNom === 'compras' ||
          pNom === 'deposito' ||
          pNom === 'depósito' ||
          pNom === 'campana' ||
          pNom === 'campaña' ||
          pNom.includes('granel') ||
          safeLRaw.tipo_accion === 'compra_insumos';

        if (esGeneral && Array.isArray(safeLRaw.insumos) && safeLRaw.insumos.length > 0) {
          safeLRaw.insumos.forEach((ins) => {
            generalItems.push({
              producto: ins.producto || 'Insumo',
              cantidad_total: Number(ins.cantidad_total) || 0,
              unidad: ins.unidad || 'L',
              precio_unitario: Number(ins.precio_unitario) || 0,
              costo_total: Number(ins.costo_total) || 0,
              observaciones: safeLRaw.observaciones || 'Compra general de campaña',
            });
          });
        } else {
          lotesParaPotreros.push(safeLRaw);
        }
      });

      if (lotesParaPotreros.length === 0 && generalItems.length === 0) {
        throw new Error('No se detectaron lotes ni insumos válidos en los documentos o indicaciones.');
      }

      if (isCancelledRef.current) return;

      const processedLotes = lotesParaPotreros.map((lRaw) => {
        const matchedP = findMatchingPotrero(lRaw.potrero_detectado, potreros);
        return calculateLoteData(lRaw, matchedP, stockInsumos, detectedMoneda, dolarRef, siembrasExistentes);
      });

      // Si no se detectaron lotes nuevos pero se está cruzando factura con siembras ya cargadas:
      let lotesFinales = processedLotes;
      if (processedLotes.length === 0 && (modoOperacion === 'cruzar' || targetSiembra) && (siembrasExistentes || []).length > 0) {
        const fuentes = targetSiembra ? [targetSiembra] : siembrasExistentes;
        const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
        lotesFinales = fuentes.map((s) => {
          const matchedP = findMatchingPotrero(s.potrero_numero, potreros);
          const haS = Number(s.ha_sembradas || s.hectareas) || Number(matchedP?.hectareas) || 40;
          return {
            id: `siembra_existente_${s.id}`,
            vincular_siembra_id: s.id,
            selected: true,
            potrero_numero: Number(s.potrero_numero),
            potrero_nombre: matchedP?.nombre || `Potrero #${s.potrero_numero}`,
            sector: s.sector || '',
            cultivo_o_labor: s.cultivo_variedad || 'Siembra Directa',
            variedad_hibrido: s.variedad_hibrido || '',
            fecha_estimada: formatFechaAR(s.fecha),
            hectareas: haS,
            moneda: s.moneda || detectedMoneda,
            costo_labor_ha: Number(s.costo_labores_usd) || 0,
            costo_labor_total: Number(s.costo_labores_usd) || 0,
            costo_insumos: Number(s.costo_insumos_usd) || 0,
            costo_total: Number(s.costo_total_usd) || 0,
            costo_total_declarado: 0,
            costo_total_ars: (Number(s.costo_total_usd) || 0) * tc,
            costo_total_usd: Number(s.costo_total_usd) || 0,
            costo_labor_ars: (Number(s.costo_labores_usd) || 0) * tc,
            costo_labor_usd: Number(s.costo_labores_usd) || 0,
            costo_insumos_ars: (Number(s.costo_insumos_usd) || 0) * tc,
            costo_insumos_usd: Number(s.costo_insumos_usd) || 0,
            labores_detalle: Array.isArray(s.labores_json) ? s.labores_json : [],
            insumos: Array.isArray(s.insumos_json) ? s.insumos_json : [],
            observaciones: s.observaciones || '',
            expanded: false,
            es_existente: true,
          };
        });
      } else {
        lotesFinales = processedLotes.map((l) => {
          const matchEx = targetSiembra || (siembrasExistentes || []).find((s) => Number(s.potrero_numero) === Number(l.potrero_numero));
          return {
            ...l,
            vincular_siembra_id: (modoOperacion === 'cruzar' && matchEx) ? matchEx.id : null,
          };
        });
      }

      // Enriquecer compras generales con autodetect de cultivo y dosis
      const generalItemsEnriquecidos = generalItems.map((item, idx) => {
        const enriched = initCompraGeneralItem(item, lotesFinales, idx, stockInsumos, siembrasExistentes, dolarRef);
        const coincide = targetSiembra ? checkItemMatchesTargetSiembra(enriched, targetSiembra) : false;
        return {
          ...enriched,
          coincideConTarget: coincide,
          imputarALote: coincide, // Por defecto solo tildado si coincide con el lote destino
        };
      });

      if (targetSiembra) {
        // Ordenar: primero los coincidentes arriba
        generalItemsEnriquecidos.sort((a, b) => (b.coincideConTarget ? 1 : 0) - (a.coincideConTarget ? 1 : 0));
      }

      setMetaData({
        tipo_documento: response?.tipo_documento || 'receta',
        campana: response?.campana || '2026/2027',
        moneda: detectedMoneda,
        ingeniero_o_proveedor: response?.ingeniero_o_proveedor || '',
        remito_o_receta_nro: response?.remito_o_receta_nro || '',
        observaciones_generales: response?.observaciones_generales || '',
        notas_auditoria_ia: response?.notas_auditoria_ia || '',
        subtotal_neto: Number(response?.subtotal_neto) || 0,
        monto_sin_facturar: Number(response?.monto_sin_facturar) || 0,
        partidas_detalle: Array.isArray(response?.partidas_detalle) ? response.partidas_detalle : [],
        rawResponse: response,
      });
      setLotes(lotesFinales);
      setComprasGenerales(generalItemsEnriquecidos);
      setFileName(
        selectedFiles.length === 1
          ? selectedFiles[0].name
          : selectedFiles.length > 1
          ? `Lote de ${selectedFiles.length} documentos cruzados (${lotesFinales.length} potreros/labores)`
          : `Indicaciones en texto (${lotesFinales.length} potreros/labores)`
      );
      notify?.(
        `¡Lote interpretado con éxito! Se consolidaron ${lotesFinales.length} potreros/labores y ${generalItemsEnriquecidos.length} compras de insumos en ${detectedMoneda}.`,
        'success'
      );
    } catch (err) {
      if (isCancelledRef.current) return;
      console.error('Error interpretando siembra con IA:', err);
      const msg = err.message || 'Error desconocido al procesar documentos.';
      setErrorMsg(msg);
      notify?.(`Error en análisis: ${msg}`, 'error');
    } finally {
      if (!isCancelledRef.current) {
        setScanning(false);
        setProcessingMsg('');
      }
    }
  }

  // Aplicar precios de la cotización/factura a los insumos que ya figuran en los lotes
  function handleAplicarPreciosCotizacionALotes() {
    if (!comprasGenerales || comprasGenerales.length === 0) {
      notify?.('No hay ítems en la lista de cotización para aplicar.', 'info');
      return;
    }

    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    let actualizados = 0;

    // Si hay targetSiembra, solo considerar los ítems de comprasGenerales que coincidan o estén tildados
    const itemsDisponibles = targetSiembra
      ? comprasGenerales.filter((cg) => cg.imputarALote || cg.coincideConTarget)
      : comprasGenerales;

    if (targetSiembra && itemsDisponibles.length === 0) {
      notify?.('No hay insumos coincidentes ni seleccionados para aplicar a este lote.', 'warning');
      return;
    }

    setLotes((prev) =>
      prev.map((lote) => {
        if (!lote.selected) return lote;
        let loteModificado = false;
        const insumosActualizados = (lote.insumos || []).map((ins) => {
          const insNom = String(ins.producto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!insNom) return ins;

          // Buscar coincidencia en itemsDisponibles
          const matchCg = itemsDisponibles.find((cg) => {
            const cgNom = String(cg.producto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cgNom) return false;
            return cgNom.includes(insNom) || insNom.includes(cgNom) || (
              insNom.length >= 4 && cgNom.length >= 4 && (cgNom.slice(0, 5) === insNom.slice(0, 5))
            );
          });

          if (matchCg && Number(matchCg.precio_unitario) > 0) {
            const nuevoPU = Number(matchCg.precio_unitario);
            const haLote = Number(lote.hectareas) || 1;
            const updatedItem = {
              ...ins,
              precio_unitario: nuevoPU,
              moneda: matchCg.moneda || lote.moneda || 'USD',
            };
            const calc = calcularRenglonInsumo(updatedItem, haLote, tc);
            loteModificado = true;
            actualizados++;
            return {
              ...updatedItem,
              costo_total: calc.subtotalUsd,
              costo_usd: calc.subtotalUsd,
              costo_ars: calc.subtotalArs,
              origen_precio: `Cotización: ${matchCg.producto}`,
            };
          }
          return ins;
        });

        if (!loteModificado) return lote;

        const cInsumos = insumosActualizados.reduce((s, i) => s + (Number(i.costo_total) || 0), 0);
        const cTotal = Number((cInsumos + (Number(lote.costo_labor_total) || 0)).toFixed(2));
        const cTotalARS = lote.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = lote.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cInsumosARS = lote.moneda === 'ARS' ? cInsumos : Number((cInsumos * tc).toFixed(2));
        const cInsumosUSD = lote.moneda === 'ARS' ? Number((cInsumos / tc).toFixed(2)) : cInsumos;

        return {
          ...lote,
          insumos: insumosActualizados,
          costo_insumos: cInsumos,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_insumos_ars: cInsumosARS,
          costo_insumos_usd: cInsumosUSD,
        };
      })
    );

    if (actualizados > 0) {
      notify?.(`¡Se valorizaron ${actualizados} insumo(s) prescriptos con los precios unitarios de la cotización!`, 'success');
    } else {
      notify?.('No se encontraron coincidencias directas de nombres. Podés ajustar los precios manualmente en cada fila.', 'info');
    }
  }

  // Eliminar un insumo de un lote antes de guardar
  function handleRemoveInsumoLote(loteId, insId) {
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((lote) => {
        if (lote.id !== loteId) return lote;
        const insFiltrados = (lote.insumos || []).filter((i) => i.id !== insId);
        const cInsumos = insFiltrados.reduce((s, i) => s + (Number(i.costo_total) || 0), 0);
        const cTotal = Number((cInsumos + (Number(lote.costo_labor_total) || 0)).toFixed(2));
        const cTotalARS = lote.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = lote.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cInsumosARS = lote.moneda === 'ARS' ? cInsumos : Number((cInsumos * tc).toFixed(2));
        const cInsumosUSD = lote.moneda === 'ARS' ? Number((cInsumos / tc).toFixed(2)) : cInsumos;

        return {
          ...lote,
          insumos: insFiltrados,
          costo_insumos: cInsumos,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_insumos_ars: cInsumosARS,
          costo_insumos_usd: cInsumosUSD,
        };
      })
    );
  }

  // Agregar un insumo prescripto a un lote antes de guardar
  function handleAddInsumoLote(loteId) {
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const haLote = Number(l.hectareas) || 1;
        const nuevoIns = {
          id: `ins_add_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          producto: 'Nuevo Insumo',
          dosis_ha: 1,
          unidad: 'kg',
          cantidad_total: Number((1 * haLote).toFixed(2)),
          precio_unitario: 0,
          costo_total: 0,
          stock_disponible: null,
          stock_insuficiente: false,
          stock_id: null,
        };
        const insActualizados = [...(l.insumos || []), nuevoIns];
        return {
          ...l,
          insumos: insActualizados,
        };
      })
    );
  }

  // Modificar campo de un insumo prescripto
  function handleInsumoFieldChange(loteId, insId, field, value) {
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((lote) => {
        if (lote.id !== loteId) return lote;
        const haLote = Number(lote.hectareas) || 1;
        const insActualizados = (lote.insumos || []).map((ins) => {
          if (ins.id !== insId) return ins;

          const updated = { ...ins, [field]: value };
          if (field === 'dosis_ha') {
            const dosisNum = Math.max(0, parseFloat(value) || 0);
            updated.dosis_ha = dosisNum;
            updated.cantidad_total = Number((dosisNum * haLote).toFixed(2));
            updated.costo_total = Number((updated.cantidad_total * (Number(updated.precio_unitario) || 0)).toFixed(2));
          } else if (field === 'cantidad_total') {
            const cantNum = Math.max(0, parseFloat(value) || 0);
            updated.cantidad_total = cantNum;
            updated.dosis_ha = haLote > 0 ? Number((cantNum / haLote).toFixed(2)) : 0;
            updated.costo_total = Number((cantNum * (Number(updated.precio_unitario) || 0)).toFixed(2));
          } else if (field === 'precio_unitario') {
            const puNum = Math.max(0, parseFloat(value) || 0);
            updated.precio_unitario = puNum;
            updated.costo_total = Number(((Number(updated.cantidad_total) || 0) * puNum).toFixed(2));
          }
          return updated;
        });

        const cInsumos = insActualizados.reduce((s, i) => s + (Number(i.costo_total) || 0), 0);
        const cTotal = Number((cInsumos + (Number(lote.costo_labor_total) || 0)).toFixed(2));
        const cTotalARS = lote.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = lote.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cInsumosARS = lote.moneda === 'ARS' ? cInsumos : Number((cInsumos * tc).toFixed(2));
        const cInsumosUSD = lote.moneda === 'ARS' ? Number((cInsumos / tc).toFixed(2)) : cInsumos;

        return {
          ...lote,
          insumos: insActualizados,
          costo_insumos: cInsumos,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_insumos_ars: cInsumosARS,
          costo_insumos_usd: cInsumosUSD,
        };
      })
    );
  }

  // Eliminar una labor de un lote antes de guardar
  function handleRemoveLaborLote(loteId, labIdx) {
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const labFiltradas = (l.labores_detalle || []).filter((_, idx) => idx !== labIdx);
        const cLabor = labFiltradas.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
        const cTotal = Number(((Number(l.costo_insumos) || 0) + cLabor).toFixed(2));
        const cTotalARS = l.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = l.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cLaborARS = l.moneda === 'ARS' ? cLabor : Number((cLabor * tc).toFixed(2));
        const cLaborUSD = l.moneda === 'ARS' ? Number((cLabor / tc).toFixed(2)) : cLabor;

        return {
          ...l,
          labores_detalle: labFiltradas,
          costo_labor_total: cLabor,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_labor_ars: cLaborARS,
          costo_labor_usd: cLaborUSD,
        };
      })
    );
  }

  // Agregar una labor a un lote antes de guardar
  function handleAddLaborLote(loteId) {
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const haLote = Number(l.hectareas) || 1;
        const nuevaLab = {
          concepto: 'Labor Agrícola',
          hectareas: haLote,
          precio_unitario: 0,
          subtotal: 0,
        };
        const labActualizadas = [...(l.labores_detalle || []), nuevaLab];
        return {
          ...l,
          labores_detalle: labActualizadas,
        };
      })
    );
  }

  // Modificar campo de una labor
  function handleLaborFieldChange(loteId, labIdx, field, value) {
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const labActualizadas = (l.labores_detalle || []).map((lab, idx) => {
          if (idx !== labIdx) return lab;
          const updated = { ...lab, [field]: value };
          if (field === 'hectareas' || field === 'precio_unitario') {
            const ha = field === 'hectareas' ? Math.max(0, parseFloat(value) || 0) : (Number(lab.hectareas) || 0);
            const pu = field === 'precio_unitario' ? Math.max(0, parseFloat(value) || 0) : (Number(lab.precio_unitario) || 0);
            updated.hectareas = ha;
            updated.precio_unitario = pu;
            updated.subtotal = Number((ha * pu).toFixed(2));
          }
          return updated;
        });

        const cLabor = labActualizadas.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
        const cTotal = Number(((Number(l.costo_insumos) || 0) + cLabor).toFixed(2));
        const cTotalARS = l.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = l.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cLaborARS = l.moneda === 'ARS' ? cLabor : Number((cLabor * tc).toFixed(2));
        const cLaborUSD = l.moneda === 'ARS' ? Number((cLabor / tc).toFixed(2)) : cLabor;

        return {
          ...l,
          labores_detalle: labActualizadas,
          costo_labor_total: cLabor,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_labor_ars: cLaborARS,
          costo_labor_usd: cLaborUSD,
        };
      })
    );
  }

  function handleDescartarComprasGenerales() {
    notify?.('Lista de precios de cotización descartada.', 'info');
    setComprasGenerales([]);
  }

  // Editar precio unitario de un insumo directamente en la fila de vista previa
  function handleInsumoPriceChange(loteId, insId, newPrice) {
    const pUnit = Math.max(0, Number(newPrice) || 0);
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((lote) => {
        if (lote.id !== loteId) return lote;
        const updatedInsumos = (lote.insumos || []).map((ins) => {
          if (ins.id !== insId) return ins;
          const costo = Math.round(Number(ins.cantidad_total || 0) * pUnit * 100) / 100;
          return {
            ...ins,
            precio_unitario: pUnit,
            costo_total: costo,
          };
        });
        const cInsumos = updatedInsumos.reduce((s, i) => s + (Number(i.costo_total) || 0), 0);
        const cTotal = Number((cInsumos + (Number(lote.costo_labor_total) || 0)).toFixed(2));
        const cTotalARS = lote.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = lote.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cInsumosARS = lote.moneda === 'ARS' ? cInsumos : Number((cInsumos * tc).toFixed(2));
        const cInsumosUSD = lote.moneda === 'ARS' ? Number((cInsumos / tc).toFixed(2)) : cInsumos;

        return {
          ...lote,
          insumos: updatedInsumos,
          costo_insumos: cInsumos,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_insumos_ars: cInsumosARS,
          costo_insumos_usd: cInsumosUSD,
        };
      })
    );
  }

  // Cambiar moneda global de la importación (ARS / USD)
  function handleSwitchMoneda(newMoneda) {
    if (newMoneda === monedaDoc) return;
    setMonedaDoc(newMoneda);
    setLotes((prev) =>
      prev.map((l) => {
        const matchedP = findMatchingPotrero(l.potrero_numero, potreros);
        const recalculated = calculateLoteData(l.rawLote || l, matchedP, stockInsumos, newMoneda, dolarRef);
        return {
          ...recalculated,
          id: l.id,
          selected: l.selected,
          expanded: l.expanded,
          cultivo_o_labor: l.cultivo_o_labor,
          hectareas: l.hectareas,
          potrero_numero: l.potrero_numero,
          potrero_nombre: l.potrero_nombre,
          sector: l.sector,
        };
      })
    );
  }

  // Cambiar moneda individual de un lote
  function toggleLoteMoneda(loteId) {
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const nextMoneda = l.moneda === 'ARS' ? 'USD' : 'ARS';
        const matchedP = findMatchingPotrero(l.potrero_numero, potreros);
        const recalculated = calculateLoteData(l.rawLote || l, matchedP, stockInsumos, nextMoneda, dolarRef);
        return {
          ...recalculated,
          id: l.id,
          selected: l.selected,
          expanded: l.expanded,
          cultivo_o_labor: l.cultivo_o_labor,
          hectareas: l.hectareas,
          potrero_numero: l.potrero_numero,
          potrero_nombre: l.potrero_nombre,
          sector: l.sector,
        };
      })
    );
  }

  // Modificar potrero de un lote
  function handlePotreroChange(loteId, nuevoPotreroNum) {
    const pObj = potreros.find((p) => Number(p.numero) === Number(nuevoPotreroNum));
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const newHa = pObj?.hectareas ? Number(pObj.hectareas) : l.hectareas;
        const updatedInsumos = l.insumos.map((ins) => {
          const cTotal = Number((ins.dosis_ha * newHa).toFixed(2));
          const matchStock = (stockInsumos || []).find((s) => s.id === ins.stock_id);
          const stockDisp = matchStock ? Number(matchStock.stock_campo || matchStock.cantidad_actual || 0) : ins.stock_disponible;
          return {
            ...ins,
            cantidad_total: cTotal,
            costo_total: Number((cTotal * ins.precio_unitario).toFixed(2)),
            stock_insuficiente: stockDisp !== null && cTotal > stockDisp,
          };
        });
        const cInsumos = updatedInsumos.reduce((s, i) => s + i.costo_total, 0);
        const cLabor = Number((l.costo_labor_ha * newHa).toFixed(2));
        const cTotal = Number((cInsumos + cLabor).toFixed(2));

        const cTotalARS = l.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = l.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cLaborARS = l.moneda === 'ARS' ? cLabor : Number((cLabor * tc).toFixed(2));
        const cLaborUSD = l.moneda === 'ARS' ? Number((cLabor / tc).toFixed(2)) : cLabor;
        const cInsumosARS = l.moneda === 'ARS' ? cInsumos : Number((cInsumos * tc).toFixed(2));
        const cInsumosUSD = l.moneda === 'ARS' ? Number((cInsumos / tc).toFixed(2)) : cInsumos;

        return {
          ...l,
          potrero_numero: Number(nuevoPotreroNum),
          potrero_nombre: pObj?.nombre || `Potrero #${nuevoPotreroNum}`,
          hectareas: newHa,
          insumos: updatedInsumos,
          costo_insumos: cInsumos,
          costo_labor_total: cLabor,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_labor_ars: cLaborARS,
          costo_labor_usd: cLaborUSD,
          costo_insumos_ars: cInsumosARS,
          costo_insumos_usd: cInsumosUSD,
        };
      })
    );
  }

  // Modificar hectáreas de un lote
  function handleHectareasChange(loteId, newHaVal) {
    const newHa = Math.max(0.1, Number(newHaVal) || 0);
    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    setLotes((prev) =>
      prev.map((l) => {
        if (l.id !== loteId) return l;
        const updatedInsumos = l.insumos.map((ins) => {
          const cTotal = Number((ins.dosis_ha * newHa).toFixed(2));
          const matchStock = (stockInsumos || []).find((s) => s.id === ins.stock_id);
          const stockDisp = matchStock ? Number(matchStock.stock_campo || matchStock.cantidad_actual || 0) : ins.stock_disponible;
          return {
            ...ins,
            cantidad_total: cTotal,
            costo_total: Number((cTotal * ins.precio_unitario).toFixed(2)),
            stock_insuficiente: stockDisp !== null && cTotal > stockDisp,
          };
        });
        const cInsumos = updatedInsumos.reduce((s, i) => s + i.costo_total, 0);
        const cLabor = Number((l.costo_labor_ha * newHa).toFixed(2));
        const cTotal = Number((cInsumos + cLabor).toFixed(2));

        const cTotalARS = l.moneda === 'ARS' ? cTotal : Number((cTotal * tc).toFixed(2));
        const cTotalUSD = l.moneda === 'ARS' ? Number((cTotal / tc).toFixed(2)) : cTotal;
        const cLaborARS = l.moneda === 'ARS' ? cLabor : Number((cLabor * tc).toFixed(2));
        const cLaborUSD = l.moneda === 'ARS' ? Number((cLabor / tc).toFixed(2)) : cLabor;
        const cInsumosARS = l.moneda === 'ARS' ? cInsumos : Number((cInsumos * tc).toFixed(2));
        const cInsumosUSD = l.moneda === 'ARS' ? Number((cInsumos / tc).toFixed(2)) : cInsumos;

        return {
          ...l,
          hectareas: newHa,
          insumos: updatedInsumos,
          costo_insumos: cInsumos,
          costo_labor_total: cLabor,
          costo_total: cTotal,
          costo_total_ars: cTotalARS,
          costo_total_usd: cTotalUSD,
          costo_labor_ars: cLaborARS,
          costo_labor_usd: cLaborUSD,
          costo_insumos_ars: cInsumosARS,
          costo_insumos_usd: cInsumosUSD,
        };
      })
    );
  }

  // Modificar campo de texto del lote
  function handleFieldChange(loteId, field, val) {
    setLotes((prev) =>
      prev.map((l) => (l.id === loteId ? { ...l, [field]: val } : l))
    );
  }

  // Toggle selección
  function toggleLoteSelected(loteId) {
    setLotes((prev) =>
      prev.map((l) => (l.id === loteId ? { ...l, selected: !l.selected } : l))
    );
  }

  // Toggle expandir insumos
  function toggleLoteExpanded(loteId) {
    setLotes((prev) =>
      prev.map((l) => (l.id === loteId ? { ...l, expanded: !l.expanded } : l))
    );
  }

  // Cálculos consolidados para el footer y KPIs
  const selectedLotes = lotes.filter((l) => l.selected);
  const totalHa = selectedLotes.reduce((sum, l) => sum + (Number(l.hectareas) || 0), 0);
  const totalCostoARS = selectedLotes.reduce((sum, l) => sum + (Number(l.costo_total_ars) || 0), 0);
  const totalCostoUSD = selectedLotes.reduce((sum, l) => sum + (Number(l.costo_total_usd) || 0), 0);
  const totalInsumosItems = selectedLotes.reduce(
    (sum, l) => sum + (l.insumos?.length || 0) + (l.labores_detalle?.length || 0),
    0
  );

  // Confirmar y cargar en base de datos / sandbox
  async function handleConfirmBatch() {
    if (selectedLotes.length === 0) {
      notify?.('Seleccioná al menos 1 lote para confirmar y guardar.', 'warning');
      return;
    }

    setSavingBatch(true);
    try {
      const recordsToInsert = [];
      const recordsToUpdate = [];

      for (const lote of selectedLotes) {
        let fechaIso = new Date().toISOString().slice(0, 10);
        if (lote.fecha_estimada && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(lote.fecha_estimada.trim())) {
          const [d, m, y] = lote.fecha_estimada.trim().split('/');
          fechaIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;

        // Identificar si es siembra o tarea de pulverización/fertilización sobre lote existente
        let tarea = 'Siembra Directa';
        const cDesc = (lote.cultivo_o_labor || '').toLowerCase();
        if (cDesc.includes('barbecho')) tarea = 'Barbecho Químico';
        else if (cDesc.includes('fumig') || cDesc.includes('pulveriz') || cDesc.includes('herbicida') || cDesc.includes('insecticida')) tarea = 'Fumigación / Pulverización';
        else if (cDesc.includes('fertiliz') || cDesc.includes('urea') || cDesc.includes('fosfat')) tarea = 'Fertilización';
        else if (cDesc.includes('disco') || cDesc.includes('arada') || cDesc.includes('rolado')) tarea = 'Labor Mecánica / Suelo';

        // Labores detalladas / pasadas
        let laboresJson = [];
        if (Array.isArray(lote.labores_detalle) && lote.labores_detalle.length > 0) {
          laboresJson = lote.labores_detalle.map((lab) => ({
            labor: lab.concepto,
            hectareas: Number(lab.hectareas) || lote.hectareas,
            precio_unitario: Number(lab.precio_unitario) || 0,
            subtotal_usd: lote.moneda === 'ARS' ? Number((lab.subtotal / tc).toFixed(2)) : Number(lab.subtotal.toFixed(2)),
            subtotal_ars: lote.moneda === 'ARS' ? Number(lab.subtotal.toFixed(2)) : Number((lab.subtotal * tc).toFixed(2)),
          }));
        } else if (lote.costo_labor_ha > 0 || lote.costo_labor_total > 0) {
          laboresJson = [{
            labor: tarea,
            costo_ha_usd: Number((lote.costo_labor_usd / (lote.hectareas || 1)).toFixed(2)),
            subtotal_usd: lote.costo_labor_usd,
            subtotal_ars: lote.costo_labor_ars,
          }];
        }

        let safeInsumos = Array.isArray(lote.insumos) ? [...lote.insumos] : [];
        if (targetSiembra && comprasGenerales.length > 0) {
          comprasGenerales.forEach((cg) => {
            if (!cg.imputarALote) return;
            const cgClean = String(cg.producto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const yaEsta = safeInsumos.some((ins) => {
              const insClean = String(ins.producto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return insClean && (insClean.includes(cgClean) || cgClean.includes(insClean));
            });
            if (!yaEsta) {
              const haLote = Number(lote.hectareas) || 1;
              const cantTotal = Number(cg.cantidad_total) || 0;
              const dosisHa = cantTotal > 0 ? Number((cantTotal / haLote).toFixed(2)) : (Number(cg.dosis_ha) || 1);
              safeInsumos.push({
                producto: cg.producto,
                dosis_ha: dosisHa,
                cantidad_total: cantTotal || Number((dosisHa * haLote).toFixed(2)),
                unidad: cg.unidad || 'kg',
                precio_unitario: Number(cg.precio_unitario) || 0,
                costo_total: Number(cg.costo_total) || 0,
                moneda: cg.moneda || lote.moneda || 'USD',
              });
            }
          });
        }
        const payload = {
          potrero_numero: Number(lote.potrero_numero),
          campana: metaData?.campana || '2026/2027',
          cultivo_variedad: lote.cultivo_o_labor,
          variedad_hibrido: lote.variedad_hibrido || '',
          hectareas: Number(lote.hectareas) || 0,
          fecha: fechaIso,
          estado: 'Sembrado',
          vigencia: 'Activa',
          tarea,
          insumos_detalle: safeInsumos.map((i) => `${i.producto} (${i.dosis_ha} ${i.unidad})`).join(', '),
          receta_json: safeInsumos.map((i) => ({
            producto: i.producto,
            dosis_ha: i.dosis_ha,
            unidad: i.unidad,
            funcion: 'Insumo',
          })),
          insumos_json: safeInsumos.map((i) => ({
            producto: i.producto,
            cantidad: i.cantidad_total,
            unidad: i.unidad,
            dosis_real: i.dosis_ha,
            costo_usd: lote.moneda === 'ARS' ? Number((i.costo_total / tc).toFixed(2)) : i.costo_total,
            costo_ars: lote.moneda === 'ARS' ? i.costo_total : Number((i.costo_total * tc).toFixed(2)),
            precio_unitario: i.precio_unitario,
          })),
          labores_json: laboresJson,
          costo_insumos_usd: lote.costo_insumos_usd,
          costo_labores_usd: lote.costo_labor_usd,
          costo_total_usd: lote.costo_total_usd,
          moneda: lote.moneda,
          tipo_cambio: tc,
          observaciones: `${metaData?.ingeniero_o_proveedor ? `Ing/Proveedor: ${metaData.ingeniero_o_proveedor}. ` : ''}${lote.sector ? `Sector: ${lote.sector}. ` : ''}${lote.moneda === 'ARS' ? `Importe original: ARS $${Math.round(lote.costo_total_ars).toLocaleString('es-AR')} (TC $${tc}). ` : ''}${lote.observaciones || ''}`.trim(),
        };

        if (lote.vincular_siembra_id) {
          recordsToUpdate.push({
            siembraId: lote.vincular_siembra_id,
            lote,
            safeInsumos,
            tc,
            metaData,
            payload,
          });
        } else {
          recordsToInsert.push(payload);
        }
      }

      if (isSandbox) {
        // Guardar en san_jose_sandbox_data
        const raw = localStorage.getItem('san_jose_sandbox_data');
        const sData = raw ? JSON.parse(raw) : {};
        if (!Array.isArray(sData.labores_siembras)) sData.labores_siembras = [];
        if (!Array.isArray(sData.potreros)) sData.potreros = [];

        // 1. Actualizar registros vinculados existentes
        recordsToUpdate.forEach(({ siembraId, safeInsumos, tc, lote }) => {
          const sIdx = sData.labores_siembras.findIndex((s) => s.id === siembraId);
          if (sIdx >= 0) {
            const prevS = sData.labores_siembras[sIdx];
            const oldInsumos = Array.isArray(prevS.insumos_json) ? prevS.insumos_json : [];
            const mergedInsumos = [...oldInsumos];

            safeInsumos.forEach((nIns) => {
              const idxMatch = mergedInsumos.findIndex(
                (o) => o.producto && nIns.producto && o.producto.trim().toLowerCase() === nIns.producto.trim().toLowerCase()
              );
              const pu = Number(nIns.precio_unitario) || 0;
              const haLote = Number(prevS.ha_sembradas || prevS.hectareas) || Number(lote.hectareas) || 1;

              if (idxMatch >= 0) {
                const prevItem = mergedInsumos[idxMatch];
                const updatedPU = pu > 0 ? pu : (Number(prevItem.precio_unitario) || 0);
                const updatedItem = {
                  ...prevItem,
                  precio_unitario: updatedPU,
                };
                const calc = calcularRenglonInsumo(updatedItem, haLote, tc);
                mergedInsumos[idxMatch] = {
                  ...updatedItem,
                  costo_usd: calc.subtotalUsd,
                  costo_ars: calc.subtotalArs,
                  precio_unitario: updatedPU,
                };
              } else {
                const calc = calcularRenglonInsumo(nIns, haLote, tc);
                mergedInsumos.push({
                  ...nIns,
                  costo_usd: calc.subtotalUsd,
                  costo_ars: calc.subtotalArs,
                  precio_unitario: pu,
                });
              }
            });

            const costoInsumosUSD = mergedInsumos.reduce((s, i) => s + (Number(i.costo_usd) || 0), 0);
            const costoLaboresUSD = Number(prevS.costo_labores_usd) || Number(lote.costo_labor_usd) || 0;
            const costoTotalUSD = Number((costoInsumosUSD + costoLaboresUSD).toFixed(2));

            sData.labores_siembras[sIdx] = {
              ...prevS,
              insumos_detalle: mergedInsumos.map((i) => `${i.producto} (${i.dosis_real || i.dosis_ha || 0} ${i.unidad || ''})`).join(', '),
              receta_json: mergedInsumos.map((i) => ({
                producto: i.producto,
                dosis_ha: i.dosis_real || i.dosis_ha || 0,
                unidad: i.unidad,
                funcion: 'Insumo',
              })),
              insumos_json: mergedInsumos,
              costo_insumos_usd: costoInsumosUSD,
              costo_total_usd: costoTotalUSD,
              observaciones: `${prevS.observaciones ? `${prevS.observaciones} · ` : ''}[Factura/Remito Coop ${metaData?.remito_o_receta_nro || fileName || ''} vinculada]`.trim(),
            };
          }
        });

        // 2. Insertar registros nuevos
        recordsToInsert.forEach((rec, idx) => {
          const fakeId = Date.now() + idx;
          sData.labores_siembras.push({ ...rec, id: fakeId, created_at: new Date().toISOString() });

          const esSiembra = rec.tarea === 'Siembra Directa' || (!rec.tarea.toLowerCase().includes('fumig') && !rec.tarea.toLowerCase().includes('fertiliz'));
          if (esSiembra) {
            const pIdx = sData.potreros.findIndex((p) => Number(p.numero) === Number(rec.potrero_numero));
            if (pIdx >= 0) {
              sData.potreros[pIdx] = {
                ...sData.potreros[pIdx],
                cultivo_actual: rec.cultivo_variedad,
                recurso_forrajero: rec.cultivo_variedad,
                ha_sembradas: rec.hectareas,
                fecha_siembra: rec.fecha,
              };
            }
          }
        });

        localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
        window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
      } else {
        // Guardar en Supabase Producción
        // 1. Actualizar registros vinculados existentes
        for (const { siembraId, safeInsumos, tc, lote } of recordsToUpdate) {
          const { data: existingRows } = await supabase.from('labores_siembras').select('*').eq('id', siembraId).limit(1);
          const prevS = existingRows?.[0];
          const oldInsumos = Array.isArray(prevS?.insumos_json) ? prevS.insumos_json : [];
          const mergedInsumos = [...oldInsumos];

          safeInsumos.forEach((nIns) => {
            const idxMatch = mergedInsumos.findIndex(
              (o) => o.producto && nIns.producto && o.producto.trim().toLowerCase() === nIns.producto.trim().toLowerCase()
            );
            const pu = Number(nIns.precio_unitario) || 0;
            const haLote = Number(prevS?.ha_sembradas || prevS?.hectareas) || Number(lote.hectareas) || 1;

            if (idxMatch >= 0) {
              const prevItem = mergedInsumos[idxMatch];
              const updatedPU = pu > 0 ? pu : (Number(prevItem.precio_unitario) || 0);
              const updatedItem = {
                ...prevItem,
                precio_unitario: updatedPU,
              };
              const calc = calcularRenglonInsumo(updatedItem, haLote, tc);
              mergedInsumos[idxMatch] = {
                ...updatedItem,
                costo_usd: calc.subtotalUsd,
                costo_ars: calc.subtotalArs,
                precio_unitario: updatedPU,
              };
            } else {
              const calc = calcularRenglonInsumo(nIns, haLote, tc);
              mergedInsumos.push({
                ...nIns,
                costo_usd: calc.subtotalUsd,
                costo_ars: calc.subtotalArs,
                precio_unitario: pu,
              });
            }
          });

          const costoInsumosUSD = mergedInsumos.reduce((s, i) => s + (Number(i.costo_usd) || 0), 0);
          const costoLaboresUSD = Number(prevS?.costo_labores_usd) || Number(lote.costo_labor_usd) || 0;
          const costoTotalUSD = Number((costoInsumosUSD + costoLaboresUSD).toFixed(2));

          const { error: updErr } = await supabase
            .from('labores_siembras')
            .update({
              insumos_detalle: mergedInsumos.map((i) => `${i.producto} (${i.dosis_real || i.dosis_ha || 0} ${i.unidad || ''})`).join(', '),
              receta_json: mergedInsumos.map((i) => ({
                producto: i.producto,
                dosis_ha: i.dosis_real || i.dosis_ha || 0,
                unidad: i.unidad,
                funcion: 'Insumo',
              })),
              insumos_json: mergedInsumos,
              costo_insumos_usd: costoInsumosUSD,
              costo_total_usd: costoTotalUSD,
              observaciones: `${prevS?.observaciones ? `${prevS.observaciones} · ` : ''}[Factura/Remito Coop ${metaData?.remito_o_receta_nro || fileName || ''} vinculada]`.trim(),
            })
            .eq('id', siembraId);

          if (updErr) throw updErr;
        }

        // 2. Insertar registros nuevos
        for (const rec of recordsToInsert) {
          const { error: insErr } = await supabase.from('labores_siembras').insert(rec);
          if (insErr) throw insErr;

          const esSiembra = rec.tarea === 'Siembra Directa' || (!rec.tarea.toLowerCase().includes('fumig') && !rec.tarea.toLowerCase().includes('fertiliz'));
          if (esSiembra) {
            await supabase.from('potreros').update({
              cultivo_actual: rec.cultivo_variedad,
              recurso_forrajero: rec.cultivo_variedad,
              ha_sembradas: rec.hectareas,
              fecha_siembra: rec.fecha,
            }).eq('numero', rec.potrero_numero);
          }
        }
      }

      try {
        await registrarAuditLog({
          tipo_operacion: 'IMPORTACION_IA_MULTI_LOTE',
          modulo: 'Siembras',
          descripcion: `Carga masiva IA: ${selectedLotes.length} lotes (${totalHa.toFixed(1)} ha totales, ${monedaDoc} $${Math.round(monedaDoc === 'ARS' ? totalCostoARS : totalCostoUSD).toLocaleString('es-AR')})`,
          afectados_tabla: 'labores_siembras',
          metadata: {
            archivo: fileName,
            moneda: monedaDoc,
            dolarRef: Number(dolarRef) > 0 ? Number(dolarRef) : 1540,
            lotes: recordsToInsert.map((r) => `P#${r.potrero_numero} - ${r.cultivo_variedad}`),
          },
        });
      } catch (logErr) {
        console.warn('Error audit log siembra:', logErr);
      }

      // Asentar automáticamente en el Catálogo de Presupuestos si hubo cotización detectada
      if (comprasGenerales && comprasGenerales.length > 0) {
        try {
          guardarPresupuestoEnCatalogo({
            proveedor: metaData?.ingeniero_o_proveedor || 'Cooperativa / Proveedor',
            numero_documento: metaData?.remito_o_receta_nro || fileName || '',
            fecha: new Date().toISOString().slice(0, 10),
            moneda: monedaDoc,
            items: comprasGenerales.map((cg) => ({
              producto: cg.producto,
              unidad: cg.unidad,
              cantidad: cg.cantidad_total,
              precio_unitario: cg.precio_unitario,
              moneda: cg.moneda || monedaDoc,
              observaciones: cg.observaciones || '',
            })),
          });
        } catch (catErr) {
          console.warn('Error archivando cotización en catálogo:', catErr);
        }
      }

      notify?.(`¡Se cargaron exitosamente ${selectedLotes.length} lotes de siembra (${totalHa.toFixed(1)} ha)!`, 'success');
      onRefresh?.();
      onClose();
    } catch (saveErr) {
      console.error('Error guardando siembras multi-lote:', saveErr);
      notify?.(`Error al guardar lotes: ${saveErr.message}`, 'error');
    } finally {
      setSavingBatch(false);
    }
  }

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!scanning && !metaData) {
          handleFilesAdded(e.dataTransfer?.files);
        }
      }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full shadow-2xl my-auto max-h-[94vh] flex flex-col overflow-hidden">
        {/* Encabezado fijo */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900 rounded-t-2xl">
          <div className="flex items-center gap-2 text-white font-bold text-sm sm:text-base flex-wrap">
            {modoOperacion === 'cruzar' ? (
              <>
                <Receipt className="w-5 h-5 text-amber-400" />
                <span>
                  {targetSiembra
                    ? `Cruzar Factura / Presupuesto con P#${targetSiembra.potrero_numero} (${targetSiembra.cultivo_variedad})`
                    : 'Cruzar Factura / Presupuesto con Siembras Existentes'}
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Modo Cruzar Factura / Presupuesto
                </span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <span>Importador Inteligente de Siembras & Recetas</span>
              </>
            )}
            {isSandbox && (
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Sandbox
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Zona de Drop / Carga inicial */}
        {!metaData && (
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
            {/* Estado de Escaneo y Progreso Único (reemplaza toda la pantalla mientras procesa) */}
            {scanning ? (
              <div className="bg-slate-950/90 border border-emerald-500/40 rounded-2xl p-8 sm:p-12 text-center space-y-4 animate-in fade-in duration-200 flex flex-col items-center justify-center my-4 min-h-[300px]">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shadow-lg">
                  <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
                </div>
                <div className="space-y-1">
                  <div className="text-base font-bold text-white">
                    Interpretando documentos con Gemini IA
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-emerald-400 font-mono">
                    {processingMsg || 'Procesando archivos...'}
                  </div>
                </div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Extrayendo recetas, potreros y productos aplicados para cruzar con San José. Si el lote es extenso, el sistema activará análisis individual resiliente archivo por archivo.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleCancelScan}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <X className="w-3.5 h-3.5 text-rose-400" />
                    <span>Cancelar análisis</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Selector interactivo de Modo / Rol de Documento */}
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                    <span>Paso 1 · Seleccionar Tipo de Documento / Extractor:</span>
                    <span className="text-[10px] font-mono text-emerald-400 font-normal">
                      {extractorRole === 'receta' && 'Modo A: Prescripción agronómica y dosis (sin dinero)'}
                      {extractorRole === 'labores' && 'Modo C: Labores mecánicas y tarifas/ha'}
                      {extractorRole === 'factura' && 'Modo B: Catálogo de precios y compras (sin potreros)'}
                      {extractorRole === 'auto' && 'Modo Dual: Autodetección o Cruce inteligente'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setExtractorRole('receta')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                        extractorRole === 'receta'
                          ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-md ring-1 ring-emerald-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      <Sprout className={`w-4 h-4 ${extractorRole === 'receta' ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <span>🌱 1. Receta del Lote</span>
                      <span className="text-[10px] font-normal text-slate-400">RAO / Prescripción</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExtractorRole('labores')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                        extractorRole === 'labores'
                          ? 'bg-amber-950/80 border-amber-500 text-amber-200 shadow-md ring-1 ring-amber-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      <Tractor className={`w-4 h-4 ${extractorRole === 'labores' ? 'text-amber-400' : 'text-slate-500'}`} />
                      <span>🚜 2. Labores Contratista</span>
                      <span className="text-[10px] font-normal text-slate-400">Pasadas, disco, siembra</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExtractorRole('factura')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                        extractorRole === 'factura'
                          ? 'bg-blue-950/80 border-blue-500 text-blue-200 shadow-md ring-1 ring-blue-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      <Receipt className={`w-4 h-4 ${extractorRole === 'factura' ? 'text-blue-400' : 'text-slate-500'}`} />
                      <span>🧾 3. Factura / Cotización</span>
                      <span className="text-[10px] font-normal text-slate-400">Cooperativa / Insumos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExtractorRole('auto')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                        extractorRole === 'auto'
                          ? 'bg-slate-800 border-slate-600 text-white shadow-md ring-1 ring-slate-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      <Sparkles className={`w-4 h-4 ${extractorRole === 'auto' ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <span>⚡ Autodetectar</span>
                      <span className="text-[10px] font-normal text-slate-400">Archivos combinados</span>
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-300">
                  {extractorRole === 'factura'
                    ? 'Subí la factura de la Cooperativa, presupuesto o remito de insumos: los productos y precios unitarios reales se usarán como catálogo para valorizar tus lotes sin prorratear insumos a potreros ajenos.'
                    : extractorRole === 'labores'
                    ? 'Subí partes diarios o liquidaciones de contratistas: la IA extraerá por lote las hectáreas trabajadas, pasadas de disco o rastra, y tarifas por hectárea.'
                    : extractorRole === 'receta'
                    ? 'Subí recetas agronómicas (RAO / MDA) o prescripciones técnicas: la IA extraerá cultivo, potrero, dosis/ha y cantidad total de agroquímicos y fertilizantes con cálculo aritmético estricto.'
                    : 'Subí cualquier documento de siembra, pulverización o factura: Gemini detectará su rol y cruzará automáticamente los lotes.'}
                </p>

                {/* Dropzone HTML5 infalible con input overlay transparente */}
                <div
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFilesAdded(e.dataTransfer?.files);
                  }}
                  className="relative border-2 border-dashed border-slate-700 hover:border-emerald-500/80 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center cursor-pointer transition bg-slate-950/60 overflow-hidden group select-none"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,image/*"
                    onChange={(e) => {
                      handleFilesAdded(e.target.files);
                      e.target.value = '';
                    }}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleFilesAdded(e.dataTransfer?.files);
                      e.target.value = '';
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    title=""
                  />

                  <div className="flex flex-col items-center justify-center pointer-events-none relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-3 group-hover:scale-105 transition shadow-sm">
                      <UploadCloud className="w-7 h-7 text-emerald-400" />
                    </div>
                    <div className="text-sm font-bold text-white mb-1">
                      Hacé clic para seleccionar o arrastrá uno o varios archivos aquí
                    </div>
                    <div className="text-xs text-slate-400 max-w-md">
                      Admite PDFs, fotos de recetas, planillas Excel (.xlsx/.xls/.csv) y documentos Word (.docx)
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 shadow-2xs">
                      <span>📎 Podés arrastrar múltiples recetas de distintos potreros a la vez</span>
                    </div>
                  </div>
                </div>

                {/* Campo de Contexto / Precios en Lenguaje Natural (Opcional · con o sin archivos) */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="contexto-ia-siembras" className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <span>📝 Contexto, Precios o Aclaraciones para la IA</span>
                      <span className="text-[10px] font-normal text-slate-400">(Opcional · con o sin archivos)</span>
                    </label>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      ⚡ Prioridad Alta IA
                    </span>
                  </div>
                  <textarea
                    id="contexto-ia-siembras"
                    rows={2}
                    value={contextoUsuario}
                    onChange={(e) => setContextoUsuario(e.target.value)}
                    placeholder="Ej: Sembramos sorgo a 25 kg/ha (bolsa 25 kg a USD 79). El glifosato lo pagamos USD 4,20/L. El Lote 10 Loma es fumigación sobre maíz ya sembrado..."
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/80 resize-none transition leading-relaxed"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <span className="text-[11px] text-slate-400">
                      Podés indicar densidades, precios y detalles que no figuren en los comprobantes o analizar directamente desde texto.
                    </span>
                    {selectedFiles.length === 0 && Boolean(contextoUsuario && contextoUsuario.trim().length > 0) && (
                      <button
                        type="button"
                        onClick={handleAnalyzeBatch}
                        className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                        <span>✨ Analizar Indicaciones con IA</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Bandeja de archivos en cola */}
                {selectedFiles.length > 0 && (
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <span>📋 Archivos cargados para cruzar:</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {selectedFiles.length} {selectedFiles.length === 1 ? 'archivo' : 'archivos'}
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-emerald-500/50 transition cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Agregar más archivos</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClearFiles}
                          className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded hover:bg-rose-950/40 transition cursor-pointer"
                        >
                          Vaciar
                        </button>
                      </div>
                    </div>

                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {selectedFiles.map((file, idx) => (
                        <div
                          key={`${file.name}-${file.size}-${idx}`}
                          className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs hover:border-slate-700 transition"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                            <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="font-medium text-slate-200 truncate" title={file.name}>
                              {file.name}
                            </span>
                            <span className="text-slate-500 text-[11px] shrink-0">
                              ({(file.size / 1024).toFixed(1)} KB)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(idx)}
                            className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition cursor-pointer"
                            title="Quitar archivo del lote"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">
                        Se procesarán y cruzarán todos los documentos juntos con razonamiento profundo en Gemini IA.
                      </span>
                      <button
                        type="button"
                        onClick={handleAnalyzeBatch}
                        disabled={selectedFiles.length === 0 && (!contextoUsuario || !contextoUsuario.trim())}
                        className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-200" />
                        <span>
                          ✨ Analizar y Cruzar Lote ({selectedFiles.length} {selectedFiles.length === 1 ? 'archivo' : 'archivos'}{contextoUsuario.trim() ? ' + Contexto' : ''})
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Mensaje de error si falla con opciones de reintento */}
        {errorMsg && !scanning && (
          <div className="bg-rose-950/50 border border-rose-800/80 rounded-xl p-4 text-xs text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-150">
            <div className="flex items-start gap-2.5 flex-1">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <div className="font-bold text-white text-sm">No se pudo completar el análisis del lote</div>
                <div className="text-rose-300 mt-0.5 leading-relaxed">{errorMsg}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                type="button"
                onClick={() => setErrorMsg('')}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700 transition cursor-pointer"
              >
                ← Volver a archivos
              </button>
              <button
                type="button"
                onClick={handleAnalyzeBatch}
                disabled={selectedFiles.length === 0}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>↻ Reintentar</span>
              </button>
            </div>
          </div>
        )}

        {/* Vista Previa de Revisión y Carga Masiva */}
        {metaData && (
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 pr-2">
            {/* Metadatos detectados */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-white">{fileName || 'Documento analizado'}</span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 font-bold uppercase text-[10px]">
                  {metaData.tipo_documento}
                </span>
                <span className="text-slate-400">· Campaña {metaData.campana}</span>
              </div>
              {metaData.ingeniero_o_proveedor && (
                <div className="text-slate-400 text-[11px]">
                  Emisor / Agronomía: <span className="text-slate-200 font-medium">{metaData.ingeniero_o_proveedor}</span>
                </div>
              )}
            </div>

            {/* KPIs Rápidos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Lotes Seleccionados</div>
                <div className="text-lg font-bold text-white">{selectedLotes.length} <span className="text-xs text-slate-500">de {lotes.length}</span></div>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Superficie Total</div>
                <div className="text-lg font-bold text-emerald-400">{totalHa.toFixed(1)} <span className="text-xs text-slate-500">ha</span></div>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Insumos & Labores</div>
                <div className="text-lg font-bold text-amber-400">{totalInsumosItems} <span className="text-xs text-slate-500">partidas</span></div>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-xl flex flex-col justify-between">
                {isAdmin ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Inversión Estimada</div>
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-md p-0.5">
                        <button
                          type="button"
                          onClick={() => handleSwitchMoneda('ARS')}
                          className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition cursor-pointer ${
                            monedaDoc === 'ARS'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                          title="Ver y calcular en Pesos Argentinos (ARS)"
                        >
                          ARS $
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchMoneda('USD')}
                          className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition cursor-pointer ${
                            monedaDoc === 'USD'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                          title="Ver y calcular en Dólares (USD)"
                        >
                          USD
                        </button>
                      </div>
                    </div>
                    <div className="mt-1">
                      {monedaDoc === 'ARS' ? (
                        <>
                          <div className="text-sm sm:text-base font-black text-emerald-300 font-mono tracking-tight truncate">
                            ARS ${Math.round(totalCostoARS).toLocaleString('es-AR')}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">
                            ≈ USD ${Math.round(totalCostoUSD).toLocaleString('es-AR')} <span className="text-slate-500 font-normal">(@ ${dolarRef})</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm sm:text-base font-black text-emerald-300 font-mono tracking-tight truncate">
                            USD ${Math.round(totalCostoUSD).toLocaleString('es-AR')}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">
                            ≈ ARS ${Math.round(totalCostoARS).toLocaleString('es-AR')} <span className="text-slate-500 font-normal">(@ ${dolarRef})</span>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[10px] text-emerald-400 uppercase font-semibold flex items-center gap-1">
                      <Sprout className="w-3 h-3" />
                      <span>Modo Técnico Campo</span>
                    </div>
                    <div className="mt-1">
                      <div className="text-sm sm:text-base font-black text-white font-mono tracking-tight">
                        {totalInsumosItems} partidas
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">
                        en {totalHa.toFixed(1)} ha seleccionadas
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Tarjeta de Auditoría y Razonamiento Gemini 2.5 Pro */}
            {metaData?.notas_auditoria_ia && (
              <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-950 p-4 rounded-xl border border-emerald-600/30 text-xs shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-bold text-emerald-300 flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
                      <span>✨ Dictamen de Auditoría y Razonamiento IA</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-mono font-semibold">Gemini 2.5 Pro</span>
                    </span>
                  </div>
                  {metaData.moneda && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                      Moneda: {metaData.moneda}
                    </span>
                  )}
                </div>
                <p className="text-slate-300 leading-relaxed font-sans text-xs">
                  {metaData.notas_auditoria_ia}
                </p>
                {metaData.monto_sin_facturar > 0 && (
                  <div className="text-amber-300 bg-amber-950/30 border border-amber-800/40 px-2.5 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1.5">
                    <span>⚠️ Monto sin facturar / no gravado detectado:</span>
                    <span className="font-mono font-bold">${Math.round(metaData.monto_sin_facturar).toLocaleString('es-AR')}</span>
                  </div>
                )}
              </div>
            )}

            {/* Bloque: Catálogo de Precios de Referencia / Cotización */}
            {comprasGenerales.length > 0 && (
              <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 space-y-3.5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-200 uppercase tracking-wider">
                      📋 Lista de Precios de Referencia / Cotización ({comprasGenerales.length} insumos detectados)
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    Precios unitarios disponibles para valorizar recetas sin imputar sobrantes falsos a los lotes
                  </span>
                </div>

                {/* Alerta de Coincidencia o Incompatibilidad cuando se cruza desde un lote específico */}
                {targetSiembra && (() => {
                  const coincidentes = comprasGenerales.filter((cg) => cg.coincideConTarget);
                  if (coincidentes.length === 0) {
                    return (
                      <div className="bg-amber-950/50 border border-amber-500/60 rounded-xl p-3.5 text-xs text-amber-200 flex items-start gap-2.5 shadow-sm">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <div className="font-bold text-amber-300 text-sm">
                            ⚠️ Ningún ítem de este presupuesto coincide automáticamente con los insumos de P#{targetSiembra.potrero_numero} ({targetSiembra.cultivo_variedad})
                          </div>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            Los productos cotizados pertenecen a otros cultivos o insumos no prescriptos en este lote.
                            No se imputará ningún costo automáticamente a este potrero a menos que tildes manualmente la casilla en la columna izquierda.
                            Los precios unitarios quedan registrados en el <strong>Catálogo de Presupuestos</strong> para su consulta y reutilización.
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="bg-emerald-950/40 border border-emerald-500/50 rounded-xl p-2.5 px-3.5 text-xs text-emerald-200 flex items-center justify-between gap-2 shadow-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          Se detectaron <strong>{coincidentes.length} insumo(s) coincidente(s)</strong> con P#{targetSiembra.potrero_numero} ({targetSiembra.cultivo_variedad}) listados arriba en verde.
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Preseleccionados
                      </span>
                    </div>
                  );
                })()}

                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-semibold">
                        {targetSiembra && <th className="pb-1.5 w-16 text-center">Imputar</th>}
                        <th className="pb-1.5">Producto Cotizado</th>
                        <th className="pb-1.5 text-right">Cantidad</th>
                        <th className="pb-1.5 text-right">Precio Unitario</th>
                        <th className="pb-1.5 text-right">Total Cotizado</th>
                        <th className="pb-1.5 pl-3">Destino / Coincidencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {comprasGenerales.map((cg, cgIdx) => {
                        const isCoincidente = Boolean(cg.coincideConTarget);
                        return (
                          <tr
                            key={cg.id || cgIdx}
                            className={`transition ${
                              isCoincidente
                                ? 'bg-emerald-950/25 border-l-2 border-emerald-500 hover:bg-emerald-950/35'
                                : 'hover:bg-slate-800/40'
                            }`}
                          >
                            {targetSiembra && (
                              <td className="py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(cg.imputarALote)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setComprasGenerales((prev) =>
                                      prev.map((item, idx) => (idx === cgIdx ? { ...item, imputarALote: checked } : item))
                                    );
                                  }}
                                  className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-700 focus:ring-emerald-500 cursor-pointer"
                                  title="Tildar para imputar este insumo al lote destino"
                                />
                              </td>
                            )}
                            <td className="py-2 text-slate-200 font-bold font-sans">
                              <div className="flex items-center gap-1.5">
                                <span>{cg.producto}</span>
                                {isCoincidente && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Coincide P#{targetSiembra.potrero_numero}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              {cg.cantidad_total} <span className="text-[10px] text-slate-500">{cg.unidad}</span>
                            </td>
                            <td className="py-2 text-right text-emerald-300 font-bold">
                              {monedaDoc} ${Number(cg.precio_unitario || 0).toLocaleString('es-AR')}/{cg.unidad}
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              {monedaDoc} ${Number(cg.costo_total || 0).toLocaleString('es-AR')}
                            </td>
                            <td className="py-2 pl-3 font-sans text-slate-400 text-[10.5px]">
                              {isCoincidente ? (
                                <span className="text-emerald-300 font-medium">Receta de {targetSiembra.cultivo_variedad}</span>
                              ) : (
                                <span>{cg.observaciones || 'Lista de Precios / Referencia'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Acciones de la Lista de Precios */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                  <span className="text-[11px] text-slate-400">
                    💡 Podés valorizar automáticamente los insumos ya prescriptos que coincidan por nombre, sin inyectar productos ajenos a ningún lote.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        guardarPresupuestoEnCatalogo({
                          proveedor: metaData?.ingeniero_o_proveedor || 'Cooperativa / Proveedor',
                          numero_documento: metaData?.remito_o_receta_nro || fileName || '',
                          fecha: new Date().toISOString().slice(0, 10),
                          moneda: monedaDoc,
                          items: comprasGenerales.map((cg) => ({
                            producto: cg.producto,
                            unidad: cg.unidad,
                            cantidad: cg.cantidad_total,
                            precio_unitario: cg.precio_unitario,
                            moneda: cg.moneda || monedaDoc,
                            observaciones: cg.observaciones || '',
                          })),
                        });
                        notify?.('Presupuesto archivado en el Catálogo de Precios con éxito.', 'success');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/40 text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                      title="Guardar este presupuesto en el catálogo permanente de precios de referencia"
                    >
                      <Receipt className="w-3.5 h-3.5 text-emerald-400" />
                      <span>💾 Guardar en Catálogo</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDescartarComprasGenerales}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-semibold cursor-pointer transition"
                      title="Ocultar la lista de precios de cotización"
                    >
                      Descartar Lista
                    </button>
                    <button
                      type="button"
                      onClick={handleAplicarPreciosCotizacionALotes}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer transition active:scale-95"
                      title="Valorizar los insumos de cada lote con los precios unitarios detectados en la cotización"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                      <span>💲 Aplicar Precios a Insumos Prescriptos Coincidentes</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tabla interactiva de Lotes detectados */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center justify-between">
                <span>Lotes & Potreros Detectados ({lotes.length})</span>
                <span className="text-[11px] text-slate-500 font-normal">Revisá potreros, hectáreas, sectores y fórmulas antes de guardar</span>
              </div>

              {lotes.map((lote, idx) => (
                <div
                  key={lote.id}
                  className={`rounded-xl border transition ${
                    lote.selected
                      ? 'bg-slate-950/80 border-slate-700/80 shadow-sm'
                      : 'bg-slate-950/30 border-slate-800/40 opacity-60'
                  }`}
                >
                  {/* Fila principal del lote */}
                  <div className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="checkbox"
                        checked={lote.selected}
                        onChange={() => toggleLoteSelected(lote.id)}
                        className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="font-bold text-slate-400 text-xs">#{idx + 1}</span>

                      {/* Selector de potrero real */}
                      <select
                        value={lote.potrero_numero}
                        onChange={(e) => handlePotreroChange(lote.id, e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-emerald-300 font-bold rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                      >
                        {potreros.map((p) => (
                          <option key={p.numero} value={p.numero}>
                            Potrero #{p.numero} - {p.nombre || 'Lote'} ({p.hectareas || 0} ha)
                          </option>
                        ))}
                      </select>

                      {/* Chip de sub-sector detectado (ej: Bajo, Loma) — Ocultar si está vacío o 'vacio' */}
                      {Boolean(lote.sector && !/^(vacio|vacío|null|undefined|sin especificar|none|no especificado|n\/a|general|-)$/i.test(String(lote.sector).trim())) && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                          <span className="text-slate-400">Sector:</span>
                          <strong className="text-amber-200">{String(lote.sector).trim()}</strong>
                        </span>
                      )}

                      {/* Selector de vinculación a siembra existente (para cruzar factura sin duplicar) */}
                      {siembrasExistentes.length > 0 && (
                        <div className="flex items-center gap-1">
                          <select
                            value={lote.vincular_siembra_id || ''}
                            onChange={(e) => {
                              const val = e.target.value ? Number(e.target.value) : null;
                              setLotes((prev) =>
                                prev.map((l) => (l.id === lote.id ? { ...l, vincular_siembra_id: val } : l))
                              );
                            }}
                            className={`text-[11px] rounded-lg px-2 py-1 font-semibold cursor-pointer border max-w-[220px] truncate ${
                              lote.vincular_siembra_id
                                ? 'bg-amber-950/70 text-amber-200 border-amber-500/60'
                                : 'bg-slate-900 text-slate-400 border-slate-700'
                            }`}
                            title="Vincular insumos a esta siembra existente sin duplicar el registro"
                          >
                            <option value="">➕ Crear nueva siembra</option>
                            {siembrasExistentes.map((s) => (
                              <option key={s.id} value={s.id}>
                                🔗 Vincular a P#{s.potrero_numero} - {s.cultivo_variedad} ({s.ha_sembradas || s.hectareas} ha)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Inputs de cultivo y hectáreas */}
                    <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
                      <input
                        type="text"
                        value={lote.cultivo_o_labor}
                        onChange={(e) => handleFieldChange(lote.id, 'cultivo_o_labor', e.target.value)}
                        placeholder="Cultivo o Labor"
                        className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2 py-1 text-xs w-36 sm:w-44 focus:ring-1 focus:ring-emerald-500 font-medium"
                      />

                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                        <input
                          type="number"
                          step="0.1"
                          value={lote.hectareas}
                          onChange={(e) => handleHectareasChange(lote.id, e.target.value)}
                          className="w-14 bg-transparent text-white font-bold text-xs text-right focus:outline-none"
                        />
                        <span className="text-slate-500 text-[11px]">ha</span>
                      </div>

                      <div className="text-right pl-2 shrink-0">
                        {isAdmin ? (
                          <>
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleLoteMoneda(lote.id)}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/50 transition cursor-pointer"
                                title="Cambiar moneda de este lote (ARS / USD)"
                              >
                                {lote.moneda}
                              </button>
                              <div className="font-bold text-emerald-400 text-xs sm:text-sm font-mono">
                                {lote.moneda === 'ARS'
                                  ? `ARS $${Math.round(lote.costo_total_ars).toLocaleString('es-AR')}`
                                  : `USD $${Math.round(lote.costo_total_usd).toLocaleString('es-AR')}`}
                              </div>
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                              <span>
                                {lote.moneda === 'ARS'
                                  ? `≈ USD $${Math.round(lote.costo_total_usd).toLocaleString('es-AR')}`
                                  : `≈ ARS $${Math.round(lote.costo_total_ars).toLocaleString('es-AR')}`}
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-500 font-mono">
                                ${lote.moneda === 'ARS'
                                  ? `${Math.round(lote.costo_total_ars / (lote.hectareas || 1)).toLocaleString('es-AR')}/ha`
                                  : `${(lote.costo_total_usd / (lote.hectareas || 1)).toFixed(1)}/ha`}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-bold text-emerald-400 font-mono">
                              {lote.hectareas} ha
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {(lote.insumos || []).length} insumos · {(lote.labores_detalle || []).length} labores
                            </div>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleLoteExpanded(lote.id)}
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Ver insumos y detalles"
                      >
                        {lote.expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Detalle expandido de insumos y costos */}
                  {lote.expanded && (
                    <div className="border-t border-slate-800/80 p-3 bg-slate-900/40 space-y-3 text-xs">
                      {lote.variedad_hibrido && (
                        <div className="text-[11px] text-slate-400">
                          Variedad / Híbrido: <span className="text-white font-medium">{lote.variedad_hibrido}</span>
                        </div>
                      )}

                      {/* Labores & Pasadas detalladas */}
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[10px] font-bold text-teal-400 uppercase tracking-wide flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Tractor className="w-3.5 h-3.5" />
                            <span>Labores & Pasadas Contratadas ({(lote.labores_detalle || []).length})</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {isAdmin && (
                              <span className="text-slate-400 font-normal font-mono text-[11px]">
                                Subtotal: {lote.moneda === 'ARS' ? `ARS $${Math.round(lote.costo_labor_ars).toLocaleString('es-AR')}` : `USD $${Math.round(lote.costo_labor_usd).toLocaleString('es-AR')}`}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleAddLaborLote(lote.id)}
                              className="px-2 py-0.5 rounded bg-teal-900/60 hover:bg-teal-800 text-teal-200 border border-teal-700/60 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                              title="Agregar una pasada de disco, siembra o labor contratada a este lote"
                            >
                              <Plus className="w-3 h-3" />
                              <span>+ Labor</span>
                            </button>
                          </div>
                        </div>

                        {(lote.labores_detalle || []).length === 0 ? (
                          <div className="text-slate-500 text-[11px] italic bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
                            Sin labores registradas para este lote.{' '}
                            <button
                              type="button"
                              onClick={() => handleAddLaborLote(lote.id)}
                              className="text-teal-400 underline font-semibold ml-1 cursor-pointer"
                            >
                              + Agregar labor
                            </button>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                                  <th className="pb-1.5">Concepto / Pasada</th>
                                  <th className="pb-1.5 text-right w-20">Hectáreas</th>
                                  {isAdmin && <th className="pb-1.5 text-right w-24">Tarifa/ha</th>}
                                  {isAdmin && <th className="pb-1.5 text-right w-24">Subtotal</th>}
                                  <th className="pb-1.5 text-center w-8"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {lote.labores_detalle.map((lab, labIdx) => (
                                  <tr key={lab.id || labIdx} className="hover:bg-slate-950/40 transition">
                                    <td className="py-1.5 pr-2">
                                      <input
                                        type="text"
                                        value={lab.concepto || ''}
                                        onChange={(e) => handleLaborFieldChange(lote.id, labIdx, 'concepto', e.target.value)}
                                        placeholder="Concepto de labor"
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-medium focus:ring-1 focus:ring-teal-500"
                                      />
                                    </td>
                                    <td className="py-1.5 px-1 text-right">
                                      <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        value={lab.hectareas}
                                        onChange={(e) => handleLaborFieldChange(lote.id, labIdx, 'hectareas', e.target.value)}
                                        className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      />
                                    </td>
                                    {isAdmin && (
                                      <td className="py-1.5 px-1 text-right">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={lab.precio_unitario || ''}
                                          onChange={(e) => handleLaborFieldChange(lote.id, labIdx, 'precio_unitario', e.target.value)}
                                          placeholder="0"
                                          className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs text-teal-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                      </td>
                                    )}
                                    {isAdmin && (
                                      <td className="py-1.5 px-1 text-right font-mono font-bold text-teal-300 whitespace-nowrap">
                                        {lote.moneda === 'ARS'
                                          ? `ARS $${Math.round(lab.subtotal || 0).toLocaleString('es-AR')}`
                                          : `USD $${Math.round(lab.subtotal || 0).toLocaleString('es-AR')}`}
                                      </td>
                                    )}
                                    <td className="py-1.5 pl-1 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveLaborLote(lote.id, labIdx)}
                                        className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition cursor-pointer"
                                        title="Eliminar esta labor"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Insumos & Receta Prescripta */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                        <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Droplets className="w-3.5 h-3.5 text-emerald-400" />
                            <span>🧪 Insumos & Receta Prescripta ({(lote.insumos || []).length})</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {isAdmin && (
                              <span className="text-slate-400 font-normal font-mono text-[11px]">
                                Subtotal: {lote.moneda === 'ARS' ? `ARS $${Math.round(lote.costo_insumos_ars).toLocaleString('es-AR')}` : `USD $${Math.round(lote.costo_insumos_usd).toLocaleString('es-AR')}`}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleAddInsumoLote(lote.id)}
                              className="px-2 py-0.5 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                              title="Agregar una fila de insumo o agroquímico prescripto a este lote"
                            >
                              <Plus className="w-3 h-3" />
                              <span>+ Insumo</span>
                            </button>
                          </div>
                        </div>

                        {(lote.insumos || []).length === 0 ? (
                          <div className="text-slate-500 text-[11px] italic bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
                            Sin insumos prescriptos para este lote (solo labores contratadas).{' '}
                            <button
                              type="button"
                              onClick={() => handleAddInsumoLote(lote.id)}
                              className="text-emerald-400 underline font-semibold ml-1 cursor-pointer"
                            >
                              + Agregar insumo
                            </button>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                                  <th className="pb-1.5 min-w-[140px]">Producto Prescripto</th>
                                  <th className="pb-1.5 text-right w-24">Dosis/ha</th>
                                  <th className="pb-1.5 text-right w-24">Total Lote</th>
                                  {isAdmin && <th className="pb-1.5 text-right w-24">P. Unitario ({lote.moneda})</th>}
                                  {isAdmin && <th className="pb-1.5 text-right w-24">Subtotal</th>}
                                  <th className="pb-1.5 text-center w-8"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {(lote.insumos || []).map((ins) => (
                                  <tr key={ins.id} className="hover:bg-slate-950/40 transition">
                                    <td className="py-1.5 pr-2">
                                      <input
                                        type="text"
                                        value={ins.producto || ''}
                                        onChange={(e) => handleInsumoFieldChange(lote.id, ins.id, 'producto', e.target.value)}
                                        placeholder="Producto o principio activo"
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-medium focus:ring-1 focus:ring-emerald-500"
                                      />
                                      {ins.origen_precio && (
                                        <div className="text-[10px] text-emerald-400 font-mono italic mt-0.5">
                                          ✓ {ins.origen_precio}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-1 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={ins.dosis_ha}
                                          onChange={(e) => handleInsumoFieldChange(lote.id, ins.id, 'dosis_ha', e.target.value)}
                                          className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                        <span className="text-[10px] text-slate-500 font-mono w-6 text-left">{ins.unidad || 'L'}/ha</span>
                                      </div>
                                    </td>
                                    <td className="py-1.5 px-1 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <input
                                          type="number"
                                          step="0.1"
                                          min="0"
                                          value={ins.cantidad_total}
                                          onChange={(e) => handleInsumoFieldChange(lote.id, ins.id, 'cantidad_total', e.target.value)}
                                          className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs font-bold text-slate-200 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                        <span className="text-[10px] text-slate-500 font-mono w-6 text-left">{ins.unidad || 'L'}</span>
                                      </div>
                                    </td>
                                    {isAdmin && (
                                      <td className="py-1.5 px-1 text-right">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={ins.precio_unitario || ''}
                                          onChange={(e) => handleInsumoFieldChange(lote.id, ins.id, 'precio_unitario', e.target.value)}
                                          placeholder="0.00"
                                          className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs text-emerald-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                      </td>
                                    )}
                                    {isAdmin && (
                                      <td className="py-1.5 px-1 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                                        {lote.moneda === 'ARS'
                                          ? `ARS $${Math.round(ins.costo_total || 0).toLocaleString('es-AR')}`
                                          : `USD $${Math.round(ins.costo_total || 0).toLocaleString('es-AR')}`}
                                      </td>
                                    )}
                                    <td className="py-1.5 pl-1 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveInsumoLote(lote.id, ins.id)}
                                        className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition cursor-pointer"
                                        title={`Eliminar ${ins.producto || 'insumo'} de este lote`}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Subtotal explícito declarado (Solo Modo Admin) */}
                      {isAdmin && lote.costo_total_declarado > 0 && (
                        <div className="bg-slate-950/60 border border-slate-800 p-2 rounded-lg flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-medium">Subtotal explícito declarado en documento:</span>
                          <span className="font-bold text-white font-mono">
                            {lote.moneda === 'ARS'
                              ? `ARS $${Math.round(lote.costo_total_declarado).toLocaleString('es-AR')}`
                              : `USD $${Math.round(lote.costo_total_declarado).toLocaleString('es-AR')}`}
                          </span>
                        </div>
                      )}

                      {lote.observaciones && (
                        <div className="text-[11px] text-slate-400 italic pt-1 border-t border-slate-800/50">
                          Notas: {lote.observaciones}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer y Acciones sin recorte */}
        {metaData && (
          <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 rounded-b-2xl flex flex-wrap items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMetaData(null);
                setLotes([]);
                setComprasGenerales([]);
                setFileName('');
                setSelectedFiles([]);
              }}
              disabled={savingBatch}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
            >
              Cargar Otro Lote / Archivos
            </button>

            <div className="flex items-center gap-2">
              {lotes.length === 1 && (
                <button
                  type="button"
                  onClick={() => onApply && onApply(metaData.rawResponse)}
                  disabled={savingBatch}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold cursor-pointer transition border border-emerald-500/20"
                >
                  Abrir en Editor Manual
                </button>
              )}

              <button
                type="button"
                onClick={handleConfirmBatch}
                disabled={savingBatch || selectedLotes.length === 0}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer transition"
              >
                {savingBatch ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Guardando lotes...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Confirmar y Cargar {selectedLotes.length} {selectedLotes.length === 1 ? 'Lote' : 'Lotes'} ({totalHa.toFixed(1)} ha)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// SUBCOMPONENTE: MODAL DE DESCUENTO DE STOCK
// =========================================================================
function DescontarStockModal({ stockInsumos, insumoItem, siembra, onClose, onConfirm }) {
  // Intentar preseleccionar por coincidencia de nombre
  const matched = useMemo(() => {
    const q = (insumoItem.producto || '').toLowerCase();
    return stockInsumos.find((s) => s.nombre.toLowerCase().includes(q) || q.includes(s.nombre.toLowerCase()));
  }, [stockInsumos, insumoItem]);

  const [selectedStockId, setSelectedStockId] = useState(matched?.id || stockInsumos[0]?.id || '');
  const [cantidad, setCantidad] = useState(insumoItem.cantidad || 1);

  const selectedStockObj = stockInsumos.find((s) => s.id === Number(selectedStockId));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <PackageMinus className="w-5 h-5 text-teal-400" />
            <span>Descontar de Inventario de Insumos</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300">
          Seleccioná el insumo correspondiente en tu inventario para rebajar las unidades aplicadas en el Potrero #
          {siembra.potrero_numero}.
        </p>

        <div className="space-y-3 text-xs">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              Insumo en Stock (Inventario General)
            </label>
            <select
              value={selectedStockId}
              onChange={(e) => setSelectedStockId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-teal-500"
            >
              {stockInsumos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} (Stock actual: {s.cantidad_actual} {s.unidad}) - {s.ubicacion || 'Depósito'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">Cantidad a Descontar</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-teal-500"
              />
              <span className="text-xs font-semibold text-slate-400 px-2">
                {selectedStockObj?.unidad || insumoItem.unidad || 'L'}
              </span>
            </div>
          </div>

          {selectedStockObj && (
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div>
                Stock actual:{' '}
                <strong className="text-white">
                  {selectedStockObj.cantidad_actual} {selectedStockObj.unidad}
                </strong>
              </div>
              <div>
                Stock proyectado post-aplicación:{' '}
                <strong className="text-emerald-400">
                  {Math.max(0, Number(selectedStockObj.cantidad_actual || 0) - Number(cantidad || 0))}{' '}
                  {selectedStockObj.unidad}
                </strong>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(insumoItem, selectedStockId, cantidad)}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer transition active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Confirmar Descuento</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// SUBCOMPONENTE: MODAL CATÁLOGO DE PRESUPUESTOS Y LISTAS DE PRECIOS
// =========================================================================
function CatalogoPresupuestosModal({ isOpen, onClose, notify }) {
  const [presupuestos, setPresupuestos] = useState([]);
  const [selectedPresupuesto, setSelectedPresupuesto] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setPresupuestos(getHistorialPresupuestos());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleDelete(id, proveedor) {
    if (typeof confirmAction === 'function') {
      confirmAction({
        title: '¿Eliminar presupuesto del catálogo?',
        message: `Se eliminará el presupuesto de "${proveedor}". Esta acción no afecta las siembras ya registradas.`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        variant: 'danger',
        onConfirm: () => {
          eliminarPresupuestoCatalogo(id);
          const updated = getHistorialPresupuestos();
          setPresupuestos(updated);
          if (selectedPresupuesto?.id === id) {
            setSelectedPresupuesto(null);
          }
          notify?.('Presupuesto eliminado del catálogo.', 'info');
        },
      });
    } else {
      eliminarPresupuestoCatalogo(id);
      const updated = getHistorialPresupuestos();
      setPresupuestos(updated);
      if (selectedPresupuesto?.id === id) {
        setSelectedPresupuesto(null);
      }
      notify?.('Presupuesto eliminado del catálogo.', 'info');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full shadow-2xl max-h-[92vh] flex flex-col overflow-hidden my-auto">
        {/* Encabezado */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Receipt className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>Catálogo de Presupuestos & Cotizaciones</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {presupuestos.length} guardados
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Historial de cotizaciones guardadas para consulta y valorización automática en San José
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {presupuestos.length === 0 ? (
            <div className="text-center py-12 space-y-3 bg-slate-950/60 rounded-xl border border-slate-800/80 p-6">
              <Receipt className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="text-slate-300 font-bold text-sm">No hay presupuestos archivados aún</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Al usar "Cruzar Factura / Presupuesto" o escanear documentos de la Cooperativa, los precios unitarios se guardan automáticamente en este catálogo para consultar y sugerir cotizaciones en futuras siembras.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {presupuestos.map((p) => {
                const isSelected = selectedPresupuesto?.id === p.id;
                const itemsCount = (p.items || []).length;
                return (
                  <div
                    key={p.id}
                    className={`border rounded-xl p-4 transition ${
                      isSelected
                        ? 'bg-slate-950 border-emerald-500/60 shadow-md'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                          <Receipt className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{p.proveedor || 'Cooperativa / Proveedor'}</span>
                            {p.numero_documento && (
                              <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                #{p.numero_documento}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                            <span>📅 {formatFechaAR(p.fecha)}</span>
                            <span>•</span>
                            <span className="text-emerald-400 font-medium">{itemsCount} {itemsCount === 1 ? 'insumo cotizado' : 'insumos cotizados'}</span>
                            <span>•</span>
                            <span className="font-mono text-slate-300">{p.moneda || 'USD'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => setSelectedPresupuesto(isSelected ? null : p)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                          }`}
                        >
                          {isSelected ? 'Ocultar Detalle' : 'Ver Insumos'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id, p.proveedor)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 border border-transparent hover:border-rose-800/40 transition cursor-pointer"
                          title="Eliminar este presupuesto del catálogo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Detalle expandido de ítems */}
                    {isSelected && (
                      <div className="mt-4 pt-3 border-t border-slate-800/80 animate-in fade-in duration-150 space-y-2">
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Detalle de Insumos y Precios Unitarios
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-800 text-[11px] text-slate-500 font-semibold">
                                <th className="pb-1.5">Producto</th>
                                <th className="pb-1.5 text-right">Cantidad</th>
                                <th className="pb-1.5 text-right">Precio Unitario</th>
                                <th className="pb-1.5 pl-3">Observaciones</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                              {(p.items || []).map((it, itIdx) => (
                                <tr key={itIdx} className="hover:bg-slate-900/50">
                                  <td className="py-1.5 text-slate-200 font-sans font-medium">{it.producto}</td>
                                  <td className="py-1.5 text-right text-slate-400">
                                    {it.cantidad > 0 ? `${it.cantidad} ${it.unidad || ''}` : '-'}
                                  </td>
                                  <td className="py-1.5 text-right text-emerald-300 font-bold">
                                    {it.moneda || p.moneda || 'USD'} ${Number(it.precio_unitario || 0).toLocaleString('es-AR')}/{it.unidad || 'u'}
                                  </td>
                                  <td className="py-1.5 pl-3 font-sans text-slate-500 text-[10.5px]">
                                    {it.observaciones || '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer fijo */}
        <div className="px-6 py-3.5 bg-slate-900 border-t border-slate-800 rounded-b-2xl flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            Los precios archivados alimentan las sugerencias automáticas de precios en San José.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
