// src/components/CaravanasManagerModal.jsx
// Módulo Integral de Gestión de Caravanas & Trazabilidad SIGSA (Sprint N)
// Establecimiento San José · Agroganadera Rincón del Sur S.A.
// Maneja el ciclo de vida: EN_CAJA, PUESTA_CAMPO, BAJA_VENTA / BAJA_MUERTE

import React, { useState, useMemo, useEffect } from 'react';
import {
  Tag,
  X,
  Plus,
  Search,
  Sparkles,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  FileText,
  Trash2,
  Filter,
  Check,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import {
  analizarEtiquetaCajaCaravanas,
  analizarDteOSigsaBajas,
} from '../lib/geminiService.js';
import { confirmAction } from './ConfirmDialog.jsx';

// Helper inteligente para expandir rangos numéricos o alfanuméricos con prefijo SENASA
function expandirRangoCaravanas(desdeStr, hastaStr) {
  const d = String(desdeStr || '').trim();
  const h = String(hastaStr || '').trim();
  if (!d) return [];
  if (!h || d === h) return [d];

  const mD = d.match(/^(.*?)(\d+)$/);
  const mH = h.match(/^(.*?)(\d+)$/);

  if (mD && mH && mD[1] === mH[1]) {
    const prefix = mD[1];
    const nD = parseInt(mD[2], 10);
    const nH = parseInt(mH[2], 10);
    const padLen = mD[2].length;
    if (!isNaN(nD) && !isNaN(nH) && nH >= nD) {
      const list = [];
      for (let i = nD; i <= nH; i++) {
        list.push(prefix + String(i).padStart(padLen, '0'));
      }
      return list;
    }
  }
  return [d, h];
}

export default function CaravanasManagerModal({
  isOpen,
  onClose,
  animales = [],
  cajasCaravanas = [],
  rodeos = [],
  potreros = [],
  fechaOperacion = '',
  initialRodeo = null,
  initialTab = 'kpis_list',
  onRefresh,
  notify,
}) {
  if (!isOpen) return null;

  // Pestañas del modal: 'kpis_list' | 'alta_compra' | 'colocacion_manga' | 'buscador_sigsa'
  const [activeTab, setActiveTab] = useState(initialTab || 'kpis_list');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialRodeo) {
      if (initialRodeo.nombre) setFilterRodeo(initialRodeo.nombre);
      if (initialRodeo.id != null) {
        setColocacionForm((prev) => ({
          ...prev,
          rodeo_destino_id: String(initialRodeo.id),
        }));
      }
    }
  }, [initialRodeo]);

  // Filtros de listado
  const [filterEstado, setFilterEstado] = useState('TODOS'); // 'TODOS' | 'PUESTA_CAMPO' | 'EN_CAJA' | 'BAJA'
  const [filterRodeo, setFilterRodeo] = useState(initialRodeo ? initialRodeo.nombre : 'TODOS');
  const [searchCaravana, setSearchCaravana] = useState('');

  // Estados de carga / IA
  const [loading, setLoading] = useState(false);
  const [analyzingIa, setAnalyzingIa] = useState(false);

  // Formulario Alta de Compra
  const [compraForm, setCompraForm] = useState({
    caja_numero: '',
    marca: 'Allflex SENASA',
    color_tipo: 'Amarilla Botón / Tarjeta',
    cuig: 'SJ001',
    desde: '',
    hasta: '',
    cantidad: 100,
    fecha_compra: fechaOperacion || new Date().toISOString().slice(0, 10),
    proveedor: '',
    observaciones: '',
  });

  // Formulario Colocación en Manga / Asignación Multi-Caja
  const [colocacionForm, setColocacionForm] = useState({
    modo: 'multicaja', // 'multicaja' | 'rango_manual' | 'lista'
    rodeo_destino_id: initialRodeo ? String(initialRodeo.id) : '',
    categoria: 'Terneros',
    fecha_colocacion: fechaOperacion || new Date().toISOString().slice(0, 10),
    observaciones: '',
    // Modo manual por rango único
    caja_origen_id: '',
    desde: '',
    hasta: '',
    lista_caravanas: '',
  });

  // Tramos seleccionados en modo multi-caja: { [cajaId]: { seleccionada: boolean, desde: string, hasta: string, cantidad: number } }
  const [multiCajaSelections, setMultiCajaSelections] = useState({});

  // Formulario Buscador & Descarga Masiva SIGSA
  const [sigsaSearchInput, setSigsaSearchInput] = useState('');
  const [sigsaMassText, setSigsaMassText] = useState('');
  const [motivoBaja, setMotivoBaja] = useState('Venta'); // 'Venta' | 'Muerte' | 'Descarte'
  const [dteNumero, setDteNumero] = useState('');

  // 1. KPIs SUPERIORES DE CARAVANAS
  const kpis = useMemo(() => {
    let puestas = 0;
    let sinRodeo = 0;
    let bajas = 0;

    animales.forEach((a) => {
      const est = (a.estado_caravana || a.estado || 'En campo').toUpperCase();
      if (est.includes('BAJA') || est.includes('VENTA') || est.includes('MUERTE')) {
        bajas += 1;
      } else {
        puestas += 1;
        if (!a.rodeo || a.rodeo === 'Sin asignar' || a.rodeo.trim() === '') {
          sinRodeo += 1;
        }
      }
    });

    let enCaja = 0;
    cajasCaravanas.forEach((c) => {
      enCaja += Number(c.en_stock ?? c.cantidad ?? 0);
    });

    return {
      enCaja,
      puestas,
      sinRodeo,
      bajas,
    };
  }, [animales, cajasCaravanas]);

  // Búsqueda instantánea de caravana individual
  const busquedaResultado = useMemo(() => {
    const q = sigsaSearchInput.trim().toUpperCase();
    if (!q || q.length < 2) return null;

    // Buscar coincidencia exacta o parcial en animales
    const foundAnimal = animales.find(
      (a) => (a.caravana || '').toUpperCase().includes(q)
    );

    // Buscar si cae dentro de algún rango de cajas en stock
    const foundCaja = cajasCaravanas.find((c) => {
      const d = String(c.desde || '').toUpperCase();
      const h = String(c.hasta || '').toUpperCase();
      return q >= d && q <= h;
    });

    return {
      query: q,
      animal: foundAnimal || null,
      caja: foundCaja || null,
    };
  }, [sigsaSearchInput, animales, cajasCaravanas]);

  // Listado filtrado de animales / caravanas
  const animalesFiltrados = useMemo(() => {
    const q = searchCaravana.trim().toLowerCase();
    return animales.filter((a) => {
      if (q && !(a.caravana || '').toLowerCase().includes(q)) return false;
      if (filterRodeo !== 'TODOS' && (a.rodeo || '') !== filterRodeo) return false;
      if (filterEstado !== 'TODOS') {
        const est = (a.estado_caravana || a.estado || 'PUESTA_CAMPO').toUpperCase();
        if (filterEstado === 'PUESTA_CAMPO' && (est.includes('BAJA') || est.includes('CAJA'))) return false;
        if (filterEstado === 'BAJA' && !est.includes('BAJA') && !est.includes('VENTA') && !est.includes('MUERTE')) return false;
      }
      return true;
    });
  }, [animales, searchCaravana, filterRodeo, filterEstado]);

  // A) ALTA CON IA (Foto de Etiqueta de Caja o Remito SENASA)
  async function handleFileEtiquetaIA(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzingIa(true);
    try {
      notify?.('Analizando etiqueta de caja / remito oficial con Gemini IA...', 'info');
      const data = await analizarEtiquetaCajaCaravanas(file);

      if (data) {
        setCompraForm((prev) => ({
          ...prev,
          caja_numero: data.caja_numero || prev.caja_numero,
          marca: data.marca || prev.marca,
          color_tipo: data.color_tipo || prev.color_tipo,
          cuig: data.cuig || prev.cuig,
          desde: data.desde || prev.desde,
          hasta: data.hasta || prev.hasta,
          cantidad: Number(data.cantidad) || prev.cantidad,
          fecha_compra: data.fecha_compra || prev.fecha_compra,
          proveedor: data.proveedor || prev.proveedor,
          observaciones: data.observaciones || 'Importado con Gemini IA desde etiqueta',
        }));
        notify?.('¡Datos de la caja de caravanas extraídos con éxito!', 'success');
      }
    } catch (err) {
      console.error('Error analizando etiqueta:', err);
      notify?.(`Error con IA: ${err.message}`, 'error');
    } finally {
      setAnalyzingIa(false);
      e.target.value = '';
    }
  }

  // Guardar nueva compra en Supabase (cajas_caravanas + lote) con validación estricta
  async function handleGuardarCompra(e) {
    e.preventDefault();
    const dStr = String(compraForm.desde || '').trim();
    const hStr = String(compraForm.hasta || '').trim();
    if (!dStr || !hStr) {
      notify?.('Completá los números Desde y Hasta.', 'error');
      return;
    }

    // Calcular cantidad automáticamente si los rangos terminan en números
    let cantCalc = Number(compraForm.cantidad);
    const mD = dStr.match(/^(.*?)(\d+)$/);
    const mH = hStr.match(/^(.*?)(\d+)$/);
    if (mD && mH && mD[1] === mH[1]) {
      const nD = parseInt(mD[2], 10);
      const nH = parseInt(mH[2], 10);
      if (!isNaN(nD) && !isNaN(nH) && nH >= nD) {
        cantCalc = nH - nD + 1;
      }
    }
    const finalCant = Math.max(1, isNaN(cantCalc) ? 50 : cantCalc);

    setLoading(true);
    try {
      let numCaja = parseInt(compraForm.caja_numero, 10);
      if (isNaN(numCaja) || numCaja <= 0) {
        const maxNum = cajasCaravanas.reduce((max, c) => Math.max(max, Number(c.caja_numero) || 0), 0);
        numCaja = maxNum + 1;
      }

      const payload = {
        caja_numero: numCaja,
        marca: compraForm.marca || 'Allflex SENASA',
        color_tipo: compraForm.color_tipo || 'Amarilla Botón / Tarjeta',
        cuig: compraForm.cuig || 'SJ001',
        desde: dStr,
        hasta: hStr,
        cantidad: finalCant,
        en_stock: finalCant,
        usadas: 0,
        usadas_sin_detalle: 0,
        fecha_compra: compraForm.fecha_compra || new Date().toISOString().slice(0, 10),
        proveedor: compraForm.proveedor?.trim() || null,
        observaciones: compraForm.observaciones?.trim() || null,
      };

      const { data, error } = await supabase.from('cajas_caravanas').insert(payload).select().single();
      if (error) {
        console.error('Error insertando en cajas_caravanas:', error);
        throw new Error(error.message || 'Error de base de datos al guardar caja.');
      }

      notify?.(`Caja #${payload.caja_numero} (${payload.desde} a ${payload.hasta} · ${payload.cantidad} caravanas) guardada con éxito en Pañol (EN_CAJA).`, 'success');
      await onRefresh?.();
      setActiveTab('kpis_list');
    } catch (err) {
      console.error('Error guardando caja:', err);
      notify?.(`Error al registrar caja en stock: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // B) COLOCACIÓN EN MANGA / ASIGNACIÓN A RODEO
  async function handleGuardarColocacion(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const rodeoDestino = rodeos.find((r) => String(r.id) === String(colocacionForm.rodeo_destino_id));
      const rodeoNombre = rodeoDestino ? rodeoDestino.nombre : 'Rodeo a identificar en campo';
      const potreroActual = rodeoDestino ? rodeoDestino.potrero_numero : null;

      let caravanasColocar = [];

      if (colocacionForm.modo === 'rango') {
        const dNum = parseInt(colocacionForm.desde, 10);
        const hNum = parseInt(colocacionForm.hasta, 10);
        if (!isNaN(dNum) && !isNaN(hNum) && hNum >= dNum) {
          const padLen = String(colocacionForm.desde).length;
          for (let i = dNum; i <= hNum; i++) {
            caravanasColocar.push(String(i).padStart(padLen, '0'));
          }
        } else {
          caravanasColocar.push(String(colocacionForm.desde).trim());
          if (colocacionForm.hasta) caravanasColocar.push(String(colocacionForm.hasta).trim());
        }
      } else {
        caravanasColocar = colocacionForm.lista_caravanas
          .split(/[\n,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (caravanasColocar.length === 0) {
        notify?.('Ingresá al menos una caravana válida para colocar.', 'error');
        setLoading(false);
        return;
      }

      // Preparar registros para upsert en tabla animales
      const records = caravanasColocar.map((cNum) => ({
        caravana: cNum,
        rodeo: rodeoNombre,
        categoria: colocacionForm.categoria || 'Terneros',
        potrero_actual: potreroActual,
        estado: 'En campo',
        estado_caravana: 'PUESTA_CAMPO',
        fecha_colocacion: colocacionForm.fecha_colocacion,
        observaciones: colocacionForm.observaciones || 'Colocada en manga San José',
      }));

      // Inserción / Upsert en lotes de 100
      for (let i = 0; i < records.length; i += 100) {
        const chunk = records.slice(i, i + 100);
        const { error } = await supabase.from('animales').upsert(chunk, { onConflict: 'caravana' });
        if (error) throw error;
      }

      // Si seleccionó una caja de origen, descontar stock
      if (colocacionForm.caja_origen_id) {
        const cajaObj = cajasCaravanas.find((c) => String(c.id) === String(colocacionForm.caja_origen_id));
        if (cajaObj) {
          const stockActual = cajaObj.en_stock !== undefined && cajaObj.en_stock !== null
            ? Number(cajaObj.en_stock)
            : Number(cajaObj.cantidad || 0);
          const nuevoStock = Math.max(0, stockActual - records.length);
          const nuevasUsadas = (cajaObj.usadas || 0) + records.length;
          await supabase
            .from('cajas_caravanas')
            .update({ en_stock: nuevoStock, usadas: nuevasUsadas })
            .eq('id', cajaObj.id);
        }
      }

      notify?.(`¡Se colocaron ${records.length} caravanas y se asignaron al rodeo "${rodeoNombre}"!`, 'success');
      await onRefresh?.();
      setActiveTab('kpis_list');
    } catch (err) {
      console.error('Error colocando caravanas:', err);
      notify?.(`Error al colocar caravanas: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // C) PROCESAR BAJAS MASIVAS (DT-e o texto SIGSA)
  async function handleProcesarBajasMasivas() {
    const caravanasBaja = sigsaMassText
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (caravanasBaja.length === 0) {
      notify?.('Pegá al menos una caravana para procesar la baja.', 'error');
      return;
    }

    const okBaja = await confirmAction({
      title: `¿Dar de baja ${caravanasBaja.length} caravanas?`,
      description: `Motivo: ${motivoBaja} · Documento DT-e: ${dteNumero || 'S/N'}. Se actualizará su estado oficial en el padrón.`,
      confirmText: 'Sí, registrar baja',
      variant: 'warning',
    });
    if (!okBaja) {
      return;
    }

    setLoading(true);
    try {
      const estadoFinal = motivoBaja === 'Muerte' ? 'BAJA_MUERTE' : 'BAJA_VENTA';

      const { error } = await supabase
        .from('animales')
        .update({
          estado: 'Baja',
          estado_caravana: estadoFinal,
          dte_numero: dteNumero || null,
          motivo_baja: motivoBaja,
        })
        .in('caravana', caravanasBaja);

      if (error) throw error;

      notify?.(`¡Se procesaron ${caravanasBaja.length} bajas de caravanas con éxito!`, 'success');
      setSigsaMassText('');
      await onRefresh?.();
      setActiveTab('kpis_list');
    } catch (err) {
      console.error('Error procesando bajas masivas:', err);
      notify?.(`Error al procesar bajas: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // C2) REGISTRAR MORTANDAD DESDE BUSCADOR INSTANTÁNEO
  async function handleRegistrarMortandadBuscador(animal) {
    const okMort = await confirmAction({
      title: `¿Confirmar mortandad de caravana "${animal.caravana}"?`,
      description: `Rodeo: ${animal.rodeo || 'General'}. La caravana se marcará como baja por mortandad en campo.`,
      confirmText: 'Sí, confirmar mortandad',
      variant: 'danger',
    });
    if (!okMort) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('animales')
        .update({
          estado: 'Baja',
          estado_caravana: 'BAJA_MUERTE',
          motivo_baja: 'Mortandad en campo',
        })
        .eq('id', animal.id);

      if (error) throw error;

      notify?.(`Caravana "${animal.caravana}" dada de baja por mortandad.`, 'success');
      setSigsaSearchInput('');
      await onRefresh?.();
    } catch (err) {
      console.error('Error registrando mortandad:', err);
      notify?.(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* CABECERA MODAL */}
        <div className="bg-slate-900 text-white p-4 sm:p-5 border-b border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Tag className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                    Sistema Integral SENASA / SIGSA
                  </span>
                  <span className="text-[10px] text-slate-400 font-semibold hidden sm:inline">
                    CUIG: SJ001 · San José
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-white mt-0.5 leading-tight">
                  Gestión Inteligente de Caravanas
                </h3>
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

          {/* BARRA DE PESTAÑAS INTERNAS */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-800/80 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('kpis_list')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === 'kpis_list'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span>Stock & Listado</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('alta_compra')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === 'alta_compra'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>+ Alta Compra (IA / Caja)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('colocacion_manga')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === 'colocacion_manga'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
              <span>Asignar a Rodeo (Manga)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('buscador_sigsa')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === 'buscador_sigsa'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-sky-400" />
              <span>Buscador & DT-e / Bajas</span>
            </button>
          </div>
        </div>

        {/* CUERPO PRINCIPAL SEGÚN PESTAÑA */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs bg-slate-50/60">
          {/* TARJETAS KPIS SUPERIORES (Visibles en todas las sub-vistas) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">En Caja (Pañol)</span>
              <span className="text-lg font-black text-slate-900 tabular-nums">
                {kpis.enCaja.toLocaleString('es-AR')}
              </span>
              <span className="text-[10px] text-emerald-800 font-bold block mt-0.5">Listas para colocar</span>
            </div>

            <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Puestas en Campo</span>
              <span className="text-lg font-black text-emerald-900 tabular-nums">
                {kpis.puestas.toLocaleString('es-AR')}
              </span>
              <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Identificadas activas</span>
            </div>

            <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Sin Asignar Rodeo</span>
              <span className={`text-lg font-black tabular-nums ${kpis.sinRodeo > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
                {kpis.sinRodeo.toLocaleString('es-AR')}
              </span>
              <span className="text-[10px] text-amber-700 font-bold block mt-0.5">Pendientes de ubicar</span>
            </div>

            <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Bajas / Vendidas</span>
              <span className="text-lg font-black text-slate-600 tabular-nums">
                {kpis.bajas.toLocaleString('es-AR')}
              </span>
              <span className="text-[10px] text-slate-600 font-semibold block mt-0.5">DT-e / Mortandad</span>
            </div>
          </div>

          {/* VISTA 1: LISTADO & TABLA DE CARAVANAS */}
          {activeTab === 'kpis_list' && (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar por N° caravana..."
                    value={searchCaravana}
                    onChange={(e) => setSearchCaravana(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={filterRodeo}
                    onChange={(e) => setFilterRodeo(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                  >
                    <option value="TODOS">Todos los Rodeos</option>
                    {(rodeos || []).map((r) => (
                      <option key={r.id} value={r.nombre}>
                        🐄 {r.nombre}
                      </option>
                    ))}
                  </select>

                  <select
                    value={filterEstado}
                    onChange={(e) => setFilterEstado(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                  >
                    <option value="TODOS">Todos los Estados</option>
                    <option value="PUESTA_CAMPO">Puestas en Campo</option>
                    <option value="BAJA">Bajas / Vendidas</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-bold sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3">Caravana</th>
                      <th className="py-2.5 px-3">Rodeo Actual</th>
                      <th className="py-2.5 px-3">Categoría</th>
                      <th className="py-2.5 px-3">Potrero</th>
                      <th className="py-2.5 px-3">Estado</th>
                      <th className="py-2.5 px-3">Fecha Coloc.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {animalesFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-600 font-medium">
                          No se encontraron caravanas con ese criterio de búsqueda.
                        </td>
                      </tr>
                    ) : (
                      animalesFiltrados.slice(0, 100).map((a) => (
                        <tr key={a.id || a.caravana} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-mono font-bold text-slate-900">
                            {a.caravana}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">
                            {a.rodeo ? `🐄 ${a.rodeo}` : <span className="text-amber-800 font-bold">Sin asignar</span>}
                          </td>
                          <td className="py-2 px-3 text-slate-600">{a.categoria || 'Hacienda'}</td>
                          <td className="py-2 px-3 text-slate-600">
                            {a.potrero_actual ? `P#${a.potrero_actual}` : '-'}
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900">
                              {a.estado_caravana || a.estado || 'En campo'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-500 font-mono">
                            {a.fecha_colocacion || a.fecha_alta || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {animalesFiltrados.length > 100 && (
                <div className="text-[11px] text-slate-500 text-center font-medium">
                  Mostrando las primeras 100 de {animalesFiltrados.length} caravanas. Usá el buscador para acotar.
                </div>
              )}
            </div>
          )}

          {/* VISTA 2: ALTA DE COMPRA (FOTO ETIQUETA IA / MANUAL) */}
          {activeTab === 'alta_compra' && (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500 text-slate-950 shadow-sm">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900">
                      Escanear Etiqueta de Caja o Remito SENASA con IA
                    </h4>
                    <p className="text-[11px] text-slate-600">
                      Subí la foto de la caja para autocompletar CUIG, rango Desde/Hasta y cantidad.
                    </p>
                  </div>
                </div>

                <label className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition active:scale-95">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>{analyzingIa ? 'Analizando con IA...' : 'Subir Foto / PDF Caja'}</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileEtiquetaIA}
                    disabled={analyzingIa}
                    className="hidden"
                  />
                </label>
              </div>

              <form onSubmit={handleGuardarCompra} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Caja N°</label>
                    <input
                      type="text"
                      value={compraForm.caja_numero}
                      onChange={(e) => setCompraForm({ ...compraForm, caja_numero: e.target.value })}
                      placeholder="Ej: 14"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Marca / Formato</label>
                    <input
                      type="text"
                      value={compraForm.marca}
                      onChange={(e) => setCompraForm({ ...compraForm, marca: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">CUIG</label>
                    <input
                      type="text"
                      value={compraForm.cuig}
                      onChange={(e) => setCompraForm({ ...compraForm, cuig: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Cantidad Lote</label>
                    <input
                      type="number"
                      required
                      value={compraForm.cantidad}
                      onChange={(e) => setCompraForm({ ...compraForm, cantidad: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Caravana Desde *</label>
                    <input
                      type="text"
                      required
                      value={compraForm.desde}
                      onChange={(e) => setCompraForm({ ...compraForm, desde: e.target.value })}
                      placeholder="Ej: 0001"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Caravana Hasta *</label>
                    <input
                      type="text"
                      required
                      value={compraForm.hasta}
                      onChange={(e) => setCompraForm({ ...compraForm, hasta: e.target.value })}
                      placeholder="Ej: 0100"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Fecha de Compra</label>
                    <input
                      type="date"
                      value={compraForm.fecha_compra}
                      onChange={(e) => setCompraForm({ ...compraForm, fecha_compra: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Proveedor / Remito</label>
                    <input
                      type="text"
                      value={compraForm.proveedor}
                      onChange={(e) => setCompraForm({ ...compraForm, proveedor: e.target.value })}
                      placeholder="Ej: Villanueva / Vet. Las Flores"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold text-xs"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold text-xs flex items-center gap-2 shadow-sm transition active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    {loading ? 'Guardando...' : 'Registrar Lote en Pañol (EN_CAJA)'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* VISTA 3: COLOCACIÓN EN MANGA / ASIGNAR A RODEO (MULTI-CAJA & MULTI-RANGO) */}
          {activeTab === 'colocacion_manga' && (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4">
              <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black text-slate-900">
                    Colocación de Caravanas en Manga & Asignación Multi-Caja
                  </h4>
                  <p className="text-xs text-slate-500">
                    Permite combinar remanentes de una caja + cajas completas + inicio de otra caja en una sola tanda, pasando a <strong>PUESTA_CAMPO</strong>.
                  </p>
                </div>

                {/* Selector de modo */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setColocacionForm({ ...colocacionForm, modo: 'multicaja' })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                      colocacionForm.modo === 'multicaja'
                        ? 'bg-emerald-800 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    📦 Multi-Caja (Recomendado)
                  </button>
                  <button
                    type="button"
                    onClick={() => setColocacionForm({ ...colocacionForm, modo: 'rango_manual' })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                      colocacionForm.modo === 'rango_manual'
                        ? 'bg-emerald-800 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Rango Manual
                  </button>
                  <button
                    type="button"
                    onClick={() => setColocacionForm({ ...colocacionForm, modo: 'lista' })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                      colocacionForm.modo === 'lista'
                        ? 'bg-emerald-800 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Lista Suelta
                  </button>
                </div>
              </div>

              <form onSubmit={handleGuardarColocacion} className="space-y-4">
                {/* Rodeo Destino, Categoría y Fecha */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Rodeo Destino *</label>
                    <select
                      value={colocacionForm.rodeo_destino_id}
                      onChange={(e) => setColocacionForm({ ...colocacionForm, rodeo_destino_id: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-black text-xs bg-white text-emerald-950"
                    >
                      <option value="">Aplicada en campo / sin rodeo aún</option>
                      {(rodeos || []).map((r) => (
                        <option key={r.id} value={r.id}>
                          🐂 {r.nombre} ({r.vacas || 0} vacas · P#{r.potrero_numero || 'S/N'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Categoría Animal</label>
                    <select
                      value={colocacionForm.categoria}
                      onChange={(e) => setColocacionForm({ ...colocacionForm, categoria: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                    >
                      <option value="Terneros">Terneros / Terneras</option>
                      <option value="Vaquillonas">Vaquillonas Reposición</option>
                      <option value="Vacas">Vacas</option>
                      <option value="Toros">Toros</option>
                      <option value="Hacienda General">Hacienda General</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Fecha de Colocación</label>
                    <input
                      type="date"
                      value={colocacionForm.fecha_colocacion}
                      onChange={(e) => setColocacionForm({ ...colocacionForm, fecha_colocacion: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                    >
                    </input>
                  </div>
                </div>

                {/* MODO MULTI-CAJA (SELECCIÓN MÚLTIPLE DE CAJAS Y RANGOS) */}
                {colocacionForm.modo === 'multicaja' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                        Cajas con Stock Disponible en Pañol (Seleccioná las que usarás en la tropa)
                      </span>
                      {(() => {
                        let totalSel = 0;
                        Object.keys(multiCajaSelections).forEach((id) => {
                          if (multiCajaSelections[id]?.seleccionada) {
                            const exp = expandirRangoCaravanas(multiCajaSelections[id].desde, multiCajaSelections[id].hasta);
                            totalSel += exp.length;
                          }
                        });
                        return (
                          <span className="text-xs font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
                            Total a colocar: {totalSel} caravanas
                          </span>
                        );
                      })()}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                      {cajasCaravanas
                        .filter((c) => Number(c.en_stock ?? c.cantidad ?? 0) > 0)
                        .map((c) => {
                          const cId = String(c.id);
                          const isSel = Boolean(multiCajaSelections[cId]?.seleccionada);
                          const sel = multiCajaSelections[cId] || {
                            desde: c.desde || '',
                            hasta: c.hasta || '',
                          };
                          const stockDisp = Number(c.en_stock ?? c.cantidad ?? 0);
                          const cantEnRango = expandirRangoCaravanas(sel.desde, sel.hasta).length;

                          return (
                            <div
                              key={c.id}
                              className={`p-3.5 rounded-xl border transition ${
                                isSel
                                  ? 'bg-emerald-50/60 border-emerald-400 ring-2 ring-emerald-500/20'
                                  : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setMultiCajaSelections((prev) => ({
                                        ...prev,
                                        [cId]: {
                                          seleccionada: checked,
                                          desde: prev[cId]?.desde || c.desde,
                                          hasta: prev[cId]?.hasta || c.hasta,
                                        },
                                      }));
                                    }}
                                    className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                                  />
                                  <span className="font-extrabold text-xs text-slate-900">
                                    Caja #{c.caja_numero} ({c.marca || 'Durflex'})
                                  </span>
                                </label>
                                <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                                  Stock: {stockDisp} cab.
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 mb-2">
                                Rango caja: <span className="font-mono text-slate-700">{c.desde}</span> a <span className="font-mono text-slate-700">{c.hasta}</span>
                              </div>

                              {isSel && (
                                <div className="space-y-1.5 pt-2 border-t border-emerald-200/60">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[10px] font-bold text-emerald-950 uppercase">Desde N°</label>
                                      <input
                                        type="text"
                                        value={sel.desde}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setMultiCajaSelections((prev) => ({
                                            ...prev,
                                            [cId]: { ...prev[cId], desde: val },
                                          }));
                                        }}
                                        className="w-full px-2 py-1 rounded border border-emerald-300 bg-white font-mono font-bold text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-emerald-950 uppercase">Hasta N°</label>
                                      <input
                                        type="text"
                                        value={sel.hasta}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setMultiCajaSelections((prev) => ({
                                            ...prev,
                                            [cId]: { ...prev[cId], hasta: val },
                                          }));
                                        }}
                                        className="w-full px-2 py-1 rounded border border-emerald-300 bg-white font-mono font-bold text-xs"
                                      />
                                    </div>
                                  </div>
                                  <div className="text-[10px] text-right text-emerald-800 font-semibold">
                                    Tanda de esta caja: <strong>{cantEnRango}</strong> caravanas
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* MODO RANGO MANUAL */}
                {colocacionForm.modo === 'rango_manual' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Caja Origen (Opcional)</label>
                      <select
                        value={colocacionForm.caja_origen_id}
                        onChange={(e) => setColocacionForm({ ...colocacionForm, caja_origen_id: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                      >
                        <option value="">Sin asociar a caja de pañol</option>
                        {cajasCaravanas.map((c) => (
                          <option key={c.id} value={c.id}>
                            Caja #{c.caja_numero} ({c.desde} a {c.hasta} · {c.en_stock !== undefined && c.en_stock !== null ? c.en_stock : (c.cantidad || 0)} en stock)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Desde Caravana *</label>
                      <input
                        type="text"
                        required
                        value={colocacionForm.desde}
                        onChange={(e) => setColocacionForm({ ...colocacionForm, desde: e.target.value })}
                        placeholder="Ej: 032010011048280"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Hasta Caravana *</label>
                      <input
                        type="text"
                        required
                        value={colocacionForm.hasta}
                        onChange={(e) => setColocacionForm({ ...colocacionForm, hasta: e.target.value })}
                        placeholder="Ej: 032010011048299"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* MODO LISTA DE CARAVANAS */}
                {colocacionForm.modo === 'lista' && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Pegar caravanas (separadas por espacio, coma o renglón)
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={colocacionForm.lista_caravanas}
                      onChange={(e) => setColocacionForm({ ...colocacionForm, lista_caravanas: e.target.value })}
                      placeholder="Ej: 032010011048280, 032010011048281, 032010011048282..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs"
                    />
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold text-xs flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    {loading ? 'Asignando en manga...' : 'Asignar Caravanas (PUESTA_CAMPO)'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* VISTA 4: BUSCADOR INSTANTÁNEO & DESCARGA MASIVA SIGSA */}
          {activeTab === 'buscador_sigsa' && (
            <div className="space-y-4">
              {/* Buscador Instantáneo de Caravana Suelta */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center gap-1.5">
                  <Search className="w-4 h-4 text-emerald-700" />
                  1. Localizador de Caravana Suelta (Animal Muerto / Extraviado)
                </h4>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Escribí el número de caravana (ej: 0045)..."
                    value={sigsaSearchInput}
                    onChange={(e) => setSigsaSearchInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-sm"
                  />
                </div>

                {busquedaResultado && busquedaResultado.query.length >= 2 && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    {busquedaResultado.animal ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-mono font-black text-sm text-slate-900">
                            Caravana #{busquedaResultado.animal.caravana}
                          </div>
                          <div className="text-xs text-slate-600 font-semibold">
                            Rodeo: <strong className="text-emerald-900">{busquedaResultado.animal.rodeo || 'Sin asignar'}</strong> · Potrero #{busquedaResultado.animal.potrero_actual || 'S/N'} · Estado: {busquedaResultado.animal.estado_caravana || busquedaResultado.animal.estado}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRegistrarMortandadBuscador(busquedaResultado.animal)}
                          disabled={loading}
                          className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-xs transition active:scale-95"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Registrar Mortandad (-1 cab.)
                        </button>
                      </div>
                    ) : busquedaResultado.caja ? (
                      <div className="text-xs text-slate-700 font-medium">
                        La caravana <strong>{busquedaResultado.query}</strong> pertenece a la <strong>Caja #{busquedaResultado.caja.caja_numero}</strong> (Rango: {busquedaResultado.caja.desde} a {busquedaResultado.caja.hasta}) y aún figura como <strong>EN_CAJA</strong> (sin colocar en animal).
                      </div>
                    ) : (
                      <div className="text-xs text-slate-600 font-medium">
                        No se encontró ningún animal ni caja registrada con la caravana "{busquedaResultado.query}".
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Descarga Masiva SIGSA / DT-e */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-700" />
                      2. Descarga Masiva de Caravanas (DT-e / Ventas / Mortandad Masiva)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Pegá las caravanas exportadas de SIGSA o subí el PDF de DT-e para darlas de baja del stock en campo.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">N° de DT-e / Remito</label>
                    <input
                      type="text"
                      value={dteNumero}
                      onChange={(e) => setDteNumero(e.target.value)}
                      placeholder="Ej: 26-004-0012845"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-semibold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Motivo de Baja</label>
                    <select
                      value={motivoBaja}
                      onChange={(e) => setMotivoBaja(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-xs bg-white"
                    >
                      <option value="Venta">Salida por Venta / Frigorífico</option>
                      <option value="Muerte">Mortandad / Baja Sanitaria</option>
                      <option value="Descarte">Descarte / Reemplazo de Caravana</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Listado de Caravanas a dar de baja (Pegar texto libre)
                  </label>
                  <textarea
                    rows={4}
                    value={sigsaMassText}
                    onChange={(e) => setSigsaMassText(e.target.value)}
                    placeholder="Pegá aquí el texto de SIGSA (ej: 0012 0014 0015 o 0020, 0021, 0022)..."
                    className="w-full p-3 rounded-xl border border-slate-300 font-mono text-xs"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleProcesarBajasMasivas}
                    disabled={loading || !sigsaMassText.trim()}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-2 shadow-sm transition active:scale-95"
                  >
                    <Check className="w-4 h-4 text-emerald-400" />
                    {loading ? 'Procesando Bajas...' : 'Dar de Baja Caravanas Seleccionadas'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
