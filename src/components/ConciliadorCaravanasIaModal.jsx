// src/components/ConciliadorCaravanasIaModal.jsx
// Importador, Conciliador y Asignador Inteligente de Caravanas SENASA con Escudo Anti-Duplicados
// Establecimiento San José · Agroganadera Rincón del Sur S.A.
// Soporta 3 Modalidades: Archivo/Foto con IA, Números Sueltos/Bastón y Tramo con Exclusiones

import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  X,
  Upload,
  Package,
  Tag,
  ArrowUpRight,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Check,
  Calendar,
  Layers,
  ArrowRight,
  ClipboardList,
  Filter,
  Sliders,
  HelpCircle,
  Eye,
  Info,
  ShieldCheck,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase.js';
import {
  analizarComprasCaravanasIa,
  analizarPlanillaCaravanasMangaIa,
  analizarSalidasCaravanasDteIa,
} from '../lib/geminiService.js';
import { formatFechaAR } from '../utils/dateHelper.js';
import {
  LOTES_OFICIALES_SIGSA,
  resolverCaravanaCompleta,
} from '../utils/caravanasAuditoriaOficial.js';
import MultiFileDropzone from './MultiFileDropzone.jsx';

// Helper inteligente para expandir rangos SENASA (ej: 0001 a 0050 -> ['0001', '0002', ...])
function expandirRangoCaravanas(desdeStr, hastaStr, maxLimit = 2500) {
  const d = String(desdeStr || '').trim();
  const h = String(hastaStr || '').trim();
  if (!d) return [];
  if (!h || d === h) return [d];

  const mD = d.match(/^(.*?)(\d+)$/);
  const mH = h.match(/^(.*?)(\d+)$/);

  if (mD && mH && mD[1] === mH[1]) {
    const prefix = mD[1];
    const nD = BigInt(mD[2]);
    const nH = BigInt(mH[2]);
    const padLen = mD[2].length;
    if (nH >= nD) {
      const diff = Number(nH - nD) + 1;
      const count = Math.min(diff, maxLimit);
      const list = [];
      for (let i = 0; i < count; i++) {
        list.push(prefix + String(nD + BigInt(i)).padStart(padLen, '0'));
      }
      return list;
    }
  }
  return [d, h];
}

export default function ConciliadorCaravanasIaModal({
  isOpen,
  onClose,
  rodeos = [],
  cajasCaravanas = [],
  animales = [],
  fechaOperacion = '',
  onRefresh,
  notify,
}) {
  if (!isOpen) return null;

  // Modalidad de Carga: '1' (Archivo/Foto con IA) | '2' (Números Sueltos / Bastón) | '3' (Tramo con Exclusiones)
  const [modalidad, setModalidad] = useState('1');

  // Tipo de operación: 'manga' (Puestas en campo) | 'salida' (Salidas/Venta) | 'cajas' (Compras SIGSA)
  const [subTipoOperacion, setSubTipoOperacion] = useState('manga');

  // Estado del flujo: 'input' | 'preview'
  const [step, setStep] = useState('input');
  const [loadingIa, setLoadingIa] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);

  // Modalidad 1: Archivo o Texto libre
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [textInputIa, setTextInputIa] = useState('');

  // Modalidad 2: Pegar números sueltos / bastón
  const [numerosSueltosRaw, setNumerosSueltosRaw] = useState('');

  // Modalidad 3: Tramo con exclusiones
  const [tramoDesde, setTramoDesde] = useState('');
  const [tramoHasta, setTramoHasta] = useState('');
  const [tramoExclusiones, setTramoExclusiones] = useState(''); // ej: '4636, 032010010604639'

  // Metadata global
  const [metaInfo, setMetaInfo] = useState({
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    rodeo: rodeos[0]?.nombre || 'COLA',
    categoria: 'Terneros',
    motivoSalida: 'Venta',
    dteNumero: '',
    observaciones: '',
    actualizarDuplicados: false, // Checkbox opcional: "Actualizar rodeo/fecha en existentes"
  });

  // Lista de items analizados en la vista previa editable
  // { id, caravana, cajaEmparejada, estadoDeseado, rodeo, categoria, fecha, motivoSalida, dteNumero, clasificacion: 'nueva' | 'duplicada' | 'fuera_rango', incluir }
  const [itemsPreview, setItemsPreview] = useState([]);
  const [cajasPreview, setCajasPreview] = useState([]); // Para Modo Compras SIGSA

  // Conjunto de caravanas ya existentes en el padrón para detección instantánea
  const padronExistenteMap = useMemo(() => {
    const map = new Map();
    (animales || []).forEach((a) => {
      const c = String(a.caravana || '').trim();
      if (c) map.set(c, a);
    });
    return map;
  }, [animales]);

  // Lista de lotes a usar para resolución (cajas existentes o lotes oficiales de SIGSA)
  const lotesDisponibles = useMemo(() => {
    if (cajasCaravanas && cajasCaravanas.length > 0) return cajasCaravanas;
    return LOTES_OFICIALES_SIGSA;
  }, [cajasCaravanas]);

  // Emparejar una caravana con su caja en stock correspondiente
  function emparejarCaja(caravanaStr) {
    const q = String(caravanaStr || '').trim();
    if (!q) return null;

    return lotesDisponibles.find((c) => {
      const d = String(c.desde || '').trim();
      const h = String(c.hasta || '').trim();
      if (!d || !h) return false;
      return q >= d && q <= h;
    });
  }

  // Clasificador Anti-Duplicados y Validación de Rangos
  function clasificarCaravana(caravanaResuelta) {
    if (!caravanaResuelta) return 'fuera_rango';
    if (padronExistenteMap.has(caravanaResuelta)) return 'duplicada';
    const caja = emparejarCaja(caravanaResuelta);
    if (!caja) return 'fuera_rango';
    return 'nueva';
  }

  // --------------------------------------------------------------------------
  // PROCESAMIENTO SEGÚN MODALIDAD
  // --------------------------------------------------------------------------

  // MODALIDAD 1: Interpretar archivo(s) / foto con IA
  async function handleProcesarModalidad1() {
    if (selectedFiles.length === 0 && !textInputIa.trim()) {
      notify?.('Seleccioná uno o más archivos (fotos, PDFs, Excel) o pegá el texto para analizar.', 'error');
      return;
    }

    setLoadingIa(true);
    try {
      const inputs = [];

      // Convertir cada archivo a su formato apto para Gemini
      for (const file of selectedFiles) {
        if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
          notify?.(`Extrayendo hoja de cálculo ${file.name}...`, 'info');
          const arrayBuf = await file.arrayBuffer();
          const wb = XLSX.read(arrayBuf, { type: 'array' });
          let textAcc = '';
          wb.SheetNames.forEach((sheetName) => {
            const ws = wb.Sheets[sheetName];
            if (ws) {
              const csv = XLSX.utils.sheet_to_csv(ws);
              if (csv && csv.trim()) {
                textAcc += `\n--- HOJA: ${sheetName} (${file.name}) ---\n${csv}\n`;
              }
            }
          });
          inputs.push(textAcc || (await file.text()));
        } else {
          inputs.push(file);
        }
      }

      if (textInputIa.trim()) {
        inputs.push(textInputIa.trim());
      }

      if (subTipoOperacion === 'cajas') {
        notify?.('Gemini IA interpretando rangos de compras SIGSA...', 'info');
        let allCajas = [];
        for (const inp of inputs) {
          const res = await analizarComprasCaravanasIa(inp);
          const cajasRaw = Array.isArray(res?.cajas) ? res.cajas : (res?.desde ? [res] : []);
          allCajas = allCajas.concat(cajasRaw);
        }
        if (allCajas.length === 0) throw new Error('No se detectaron rangos de cajas en el lote de documentos.');

        const formatted = allCajas.map((c, i) => {
          const dStr = String(c.desde || '').trim();
          const hStr = String(c.hasta || '').trim();
          const cant = Number(c.cantidad) || 50;
          const yaExiste = lotesDisponibles.some(
            (exist) => (exist.desde === dStr && exist.hasta === hStr)
          );
          return {
            id: `caja_prev_${Date.now()}_${i}`,
            caja_numero: c.caja_numero || lotesDisponibles.length + i + 1,
            marca: c.marca || 'Allflex SENASA',
            desde: dStr,
            hasta: hStr,
            cantidad: cant,
            en_stock: cant,
            color_tipo: c.color_tipo || 'Amarilla Botón / Tarjeta',
            cuig: c.cuig || 'JS307',
            proveedor: c.proveedor || 'Veterinaria Oficial / SIGSA',
            fecha_compra: c.fecha_compra || metaInfo.fecha,
            observaciones: c.observaciones || 'Importado con Gemini IA',
            yaExiste,
            incluir: !yaExiste,
          };
        });
        setCajasPreview(formatted);
        setStep('preview');
        return;
      }

      if (subTipoOperacion === 'manga') {
        notify?.('Gemini IA analizando planillas de manga y caravanas colocadas...', 'info');
        const rodeosNombres = rodeos.map((r) => r.nombre);
        const listaExp = [];
        const seen = new Set();

        for (const inp of inputs) {
          const res = await analizarPlanillaCaravanasMangaIa(inp, rodeosNombres);
          const itemsRaw = Array.isArray(res?.caravanas) ? res.caravanas : [];

          itemsRaw.forEach((it) => {
            const dStr = String(it.desde || it.caravana || '').trim();
            const hStr = String(it.hasta || it.caravana || '').trim();
            const expanded = expandirRangoCaravanas(dStr, hStr);
            expanded.forEach((num) => {
              const car15 = resolverCaravanaCompleta(num, lotesDisponibles) || num;
              if (seen.has(car15)) return;
              seen.add(car15);

              const clasif = clasificarCaravana(car15);
              const caja = emparejarCaja(car15);
              listaExp.push({
                id: `item_${car15}_${Math.random()}`,
                caravana: car15,
                cajaEmparejada: caja,
                estadoDeseado: 'Activa en Campo',
                rodeo: it.rodeo_sugerido || metaInfo.rodeo,
                categoria: it.categoria || metaInfo.categoria,
                fecha: it.fecha || metaInfo.fecha,
                motivoSalida: null,
                dteNumero: null,
                clasificacion: clasif,
                incluir: clasif !== 'duplicada',
              });
            });
          });
        }

        if (listaExp.length === 0) throw new Error('No se detectaron números de caravana en el lote de documentos.');

        setItemsPreview(listaExp);
        setStep('preview');
        return;
      }

      if (subTipoOperacion === 'salida') {
        notify?.('Gemini IA interpretando DT-e, ventas y bajas de caravanas...', 'info');
        const listaExp = [];
        const seen = new Set();

        for (const inp of inputs) {
          const res = await analizarSalidasCaravanasDteIa(inp);
          const itemsRaw = Array.isArray(res?.caravanas) ? res.caravanas : [];

          itemsRaw.forEach((it) => {
            const dStr = String(it.desde || it.caravana || '').trim();
            const hStr = String(it.hasta || it.caravana || '').trim();
            const expanded = expandirRangoCaravanas(dStr, hStr);
            expanded.forEach((num) => {
              const car15 = resolverCaravanaCompleta(num, lotesDisponibles) || num;
              if (seen.has(car15)) return;
              seen.add(car15);

              const existente = padronExistenteMap.get(car15);
              const yaEsSalida = existente && (existente.estado_caravana || existente.estado || '').toLowerCase().includes('salida');
              const caja = emparejarCaja(car15);
              listaExp.push({
                id: `item_salida_${car15}_${Math.random()}`,
                caravana: car15,
                cajaEmparejada: caja,
                estadoDeseado: 'Salida / Vendida',
                rodeo: 'SALIDA / DESPACHO',
                categoria: it.categoria || 'Venta',
                fecha: it.fecha || res?.fecha || metaInfo.fecha,
                motivoSalida: it.motivo || res?.motivo || metaInfo.motivoSalida,
                dteNumero: it.dte_numero || res?.dte_numero || metaInfo.dteNumero,
                clasificacion: yaEsSalida ? 'duplicada' : (caja ? 'nueva' : 'fuera_rango'),
                incluir: !yaEsSalida,
              });
            });
          });
        }

        if (listaExp.length === 0) throw new Error('No se detectaron caravanas de salida en los comprobantes analizados.');

        setItemsPreview(listaExp);
        setStep('preview');
        return;
      }
    } catch (err) {
      console.error('Error al procesar con IA:', err);
      notify?.(err.message || 'Error interpretando el documento con Gemini.', 'error');
    } finally {
      setLoadingIa(false);
    }
  }

  // MODALIDAD 2: Procesar números sueltos / bastón
  function handleProcesarModalidad2() {
    const raw = numerosSueltosRaw.trim();
    if (!raw) {
      notify?.('Pegá al menos un número de caravana o lectura de bastón.', 'error');
      return;
    }

    // Dividir por saltos de línea, comas, puntos y comas o espacios
    const tokens = raw.split(/[\r\n,;\s]+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) {
      notify?.('No se encontraron números válidos en el texto ingresado.', 'error');
      return;
    }

    const items = tokens.map((tok) => {
      const car15 = resolverCaravanaCompleta(tok, lotesDisponibles) || tok.padStart(15, '0');
      const clasif = clasificarCaravana(car15);
      const caja = emparejarCaja(car15);
      const esSalida = subTipoOperacion === 'salida';

      return {
        id: `bast_${car15}_${Math.random()}`,
        caravana: car15,
        cajaEmparejada: caja,
        estadoDeseado: esSalida ? 'Salida / Vendida' : 'Activa en Campo',
        rodeo: esSalida ? 'SALIDA / DESPACHO' : metaInfo.rodeo,
        categoria: metaInfo.categoria,
        fecha: metaInfo.fecha,
        motivoSalida: esSalida ? metaInfo.motivoSalida : null,
        dteNumero: esSalida ? metaInfo.dteNumero : null,
        clasificacion: clasif,
        incluir: clasif !== 'duplicada',
      };
    });

    setItemsPreview(items);
    setStep('preview');
  }

  // MODALIDAD 3: Procesar tramo con exclusiones
  function handleProcesarModalidad3() {
    const dRaw = tramoDesde.trim();
    const hRaw = tramoHasta.trim();
    if (!dRaw || !hRaw) {
      notify?.('Ingresá el número inicial (Desde) y final (Hasta) del tramo.', 'error');
      return;
    }

    const d15 = resolverCaravanaCompleta(dRaw, lotesDisponibles) || dRaw;
    const h15 = resolverCaravanaCompleta(hRaw, lotesDisponibles) || hRaw;

    // Parsear exclusiones
    const exclusionesSet = new Set(
      tramoExclusiones
        .split(/[\r\n,;\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => resolverCaravanaCompleta(t, lotesDisponibles) || t)
    );

    const expandidos = expandirRangoCaravanas(d15, h15, 3000);
    const esSalida = subTipoOperacion === 'salida';

    const items = [];
    expandidos.forEach((car) => {
      // Si está en la lista de exclusiones (ej. rotas o saltadas), se omite
      if (exclusionesSet.has(car)) return;

      const clasif = clasificarCaravana(car);
      const caja = emparejarCaja(car);

      items.push({
        id: `tramo_${car}_${Math.random()}`,
        caravana: car,
        cajaEmparejada: caja,
        estadoDeseado: esSalida ? 'Salida / Vendida' : 'Activa en Campo',
        rodeo: esSalida ? 'SALIDA / DESPACHO' : metaInfo.rodeo,
        categoria: metaInfo.categoria,
        fecha: metaInfo.fecha,
        motivoSalida: esSalida ? metaInfo.motivoSalida : null,
        dteNumero: esSalida ? metaInfo.dteNumero : null,
        clasificacion: clasif,
        incluir: clasif !== 'duplicada',
      });
    });

    if (items.length === 0) {
      notify?.('El tramo no produjo caravanas válidas (todas excluidas o rango inválido).', 'warning');
      return;
    }

    setItemsPreview(items);
    setStep('preview');
  }

  // Estadísticas del preview
  const previewStats = useMemo(() => {
    const total = itemsPreview.length;
    const nuevas = itemsPreview.filter((i) => i.clasificacion === 'nueva').length;
    const duplicadas = itemsPreview.filter((i) => i.clasificacion === 'duplicada').length;
    const fueraRango = itemsPreview.filter((i) => i.clasificacion === 'fuera_rango').length;
    const seleccionadas = itemsPreview.filter((i) => i.incluir).length;
    return { total, nuevas, duplicadas, fueraRango, seleccionadas };
  }, [itemsPreview]);

  // Aplicar cambios masivos en vista previa
  function handleAplicarCambiosMasivosPreview(campo, valor) {
    setItemsPreview((prev) =>
      prev.map((it) => (it.incluir ? { ...it, [campo]: valor } : it))
    );
    notify?.(`Actualizado ${campo} en las caravanas seleccionadas`, 'info');
  }

  // --------------------------------------------------------------------------
  // GUARDADO DEFINITIVO Y ATÓMICO (SUPABASE Y SANDBOX)
  // --------------------------------------------------------------------------
  async function handleConfirmarYGuardar() {
    setSavingChanges(true);

    try {
      const isSandboxMode =
        typeof window !== 'undefined' &&
        localStorage.getItem('san_jose_sandbox_data') !== null;

      // CASO A: GUARDAR NUEVAS CAJAS
      if (subTipoOperacion === 'cajas' && cajasPreview.length > 0) {
        const cajasAInsertar = cajasPreview.filter((c) => c.incluir);
        if (cajasAInsertar.length === 0) {
          notify?.('No seleccionaste ninguna caja nueva para incorporar.', 'warning');
          setSavingChanges(false);
          return;
        }

        if (isSandboxMode) {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          const sData = raw ? JSON.parse(raw) : {};
          const existCajas = sData.cajasCaravanas || [];
          sData.cajasCaravanas = [...existCajas, ...cajasAInsertar];
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: sData }));
        } else {
          const { error } = await supabase.from('cajas_caravanas').insert(
            cajasAInsertar.map((c) => ({
              caja_numero: c.caja_numero,
              marca: c.marca,
              desde: c.desde,
              hasta: c.hasta,
              cantidad: c.cantidad,
              en_stock: c.en_stock,
              color_tipo: c.color_tipo,
              cuig: c.cuig,
              proveedor: c.proveedor,
              fecha_compra: c.fecha_compra,
              observaciones: c.observaciones,
            }))
          );
          if (error) throw error;
        }

        notify?.(`Se incorporaron ${cajasAInsertar.length} cajas nuevas a Cajas en Stock.`, 'success');
        onRefresh?.();
        onClose?.();
        return;
      }

      // CASO B: GUARDAR CARAVANAS EN PADRÓN INDIVIDUAL
      const itemsAProcesar = itemsPreview.filter((it) => it.incluir);
      if (itemsAProcesar.length === 0) {
        notify?.('No seleccionaste ninguna caravana para confirmar.', 'warning');
        setSavingChanges(false);
        return;
      }

      // Conteo de descuentos por caja
      const descuentosPorCaja = new Map(); // cajaId -> count
      itemsAProcesar.forEach((it) => {
        if (it.cajaEmparejada && it.estadoDeseado === 'Activa en Campo') {
          const cid = it.cajaEmparejada.id || it.cajaEmparejada.caja_numero;
          descuentosPorCaja.set(cid, (descuentosPorCaja.get(cid) || 0) + 1);
        }
      });

      if (isSandboxMode) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        const sData = raw ? JSON.parse(raw) : {};
        const animalesMap = new Map();
        (sData.animales || []).forEach((a) => animalesMap.set(String(a.caravana), a));

        itemsAProcesar.forEach((it) => {
          const prev = animalesMap.get(String(it.caravana)) || {};
          animalesMap.set(String(it.caravana), {
            ...prev,
            id: prev.id || `animal_${it.caravana}`,
            caravana: it.caravana,
            marca: prev.marca || 'San José (JS307)',
            categoria: it.categoria || prev.categoria || 'Vaca Cría',
            rodeo: it.rodeo || prev.rodeo,
            estado: it.estadoDeseado,
            estado_caravana: it.estadoDeseado,
            fecha_colocacion: it.estadoDeseado === 'Activa en Campo' ? it.fecha : prev.fecha_colocacion,
            fecha_salida: it.estadoDeseado === 'Salida / Vendida' ? it.fecha : prev.fecha_salida,
            motivo_salida: it.motivoSalida || prev.motivo_salida,
            dte_numero: it.dteNumero || prev.dte_numero,
            observaciones: prev.observaciones || 'Conciliado con Escudo Anti-Duplicados',
          });
        });

        // Descontar en stock de cajas sandbox
        if (sData.cajasCaravanas) {
          sData.cajasCaravanas = sData.cajasCaravanas.map((c) => {
            const cid = c.id || c.caja_numero;
            const desc = descuentosPorCaja.get(cid) || 0;
            if (desc > 0) {
              const nuevoStock = Math.max(0, (Number(c.en_stock) || 0) - desc);
              const nuevoUsadas = (Number(c.usadas) || 0) + desc;
              return { ...c, en_stock: nuevoStock, usadas: nuevoUsadas };
            }
            return c;
          });
        }

        sData.animales = Array.from(animalesMap.values());
        localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
        window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: sData }));
      } else {
        // MODO PRODUCCIÓN SUPABASE
        const upsertPayload = itemsAProcesar.map((it) => ({
          caravana: it.caravana,
          marca: 'San José (JS307)',
          categoria: it.categoria || 'Vaca Cría',
          rodeo: it.rodeo,
          estado: it.estadoDeseado,
          estado_caravana: it.estadoDeseado,
          fecha_colocacion: it.estadoDeseado === 'Activa en Campo' ? it.fecha : null,
          fecha_salida: it.estadoDeseado === 'Salida / Vendida' ? it.fecha : null,
          motivo_salida: it.motivoSalida || null,
          dte_numero: it.dteNumero || null,
          observaciones: 'Conciliado en Padrón con Escudo Anti-Duplicados',
        }));

        // Upsert en batches de 200
        for (let i = 0; i < upsertPayload.length; i += 200) {
          const chunk = upsertPayload.slice(i, i + 200);
          const { error } = await supabase.from('animales').upsert(chunk, { onConflict: 'caravana' });
          if (error) throw error;
        }

        // Actualizar stock de cajas en Supabase
        for (const [cajaId, cantDescontar] of descuentosPorCaja.entries()) {
          const caja = cajasCaravanas.find((c) => (c.id === cajaId || c.caja_numero === cajaId));
          if (caja) {
            const nuevoStock = Math.max(0, (Number(caja.en_stock) || 0) - cantDescontar);
            const nuevoUsadas = (Number(caja.usadas) || 0) + cantDescontar;
            await supabase
              .from('cajas_caravanas')
              .update({ en_stock: nuevoStock, usadas: nuevoUsadas })
              .eq('id', caja.id);
          }
        }
      }

      notify?.(
        `¡Padrón actualizado! ${itemsAProcesar.length} caravanas procesadas con éxito sin duplicados.`,
        'success'
      );
      onRefresh?.();
      onClose?.();
    } catch (err) {
      console.error('Error guardando caravanas:', err);
      notify?.('Error al guardar: ' + (err.message || err), 'error');
    } finally {
      setSavingChanges(false);
    }
  }

  // --------------------------------------------------------------------------
  // RENDER PRINCIPAL
  // --------------------------------------------------------------------------
  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        
        {/* Cabecera institucional San José */}
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5 text-emerald-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-black tracking-wide text-emerald-100 uppercase">
                  Importador & Conciliador de Caravanas SENASA
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-900/80 text-emerald-300 border border-emerald-700/60">
                  RENSPA JS307
                </span>
              </div>
              <p className="text-xs text-emerald-300/80 font-medium">
                Escudo anti-duplicados por ID único (15 dígitos) · Auditoría oficial cuadrada
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-emerald-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo del Modal */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {step === 'input' ? (
            <>
              {/* Selector de Modalidad Operativa */}
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                  Seleccionar Modalidad de Carga:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setModalidad('1')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition flex flex-col justify-between cursor-pointer ${
                      modalidad === '1'
                        ? 'border-emerald-600 bg-emerald-50/70 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="p-2 rounded-xl bg-emerald-100 text-emerald-800">
                        <Upload className="w-4 h-4" />
                      </span>
                      {modalidad === '1' && <Check className="w-4 h-4 text-emerald-700" />}
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-black text-slate-900">Modalidad 1: Archivo / Foto IA</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        PDF, Foto de manga, DT-e o Excel con Gemini
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalidad('2')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition flex flex-col justify-between cursor-pointer ${
                      modalidad === '2'
                        ? 'border-emerald-600 bg-emerald-50/70 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="p-2 rounded-xl bg-blue-100 text-blue-800">
                        <ClipboardList className="w-4 h-4" />
                      </span>
                      {modalidad === '2' && <Check className="w-4 h-4 text-emerald-700" />}
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-black text-slate-900">Modalidad 2: Números Sueltos / Bastón</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Pegar lista de 4-6 dígitos o completos
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalidad('3')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition flex flex-col justify-between cursor-pointer ${
                      modalidad === '3'
                        ? 'border-emerald-600 bg-emerald-50/70 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="p-2 rounded-xl bg-amber-100 text-amber-800">
                        <Sliders className="w-4 h-4" />
                      </span>
                      {modalidad === '3' && <Check className="w-4 h-4 text-emerald-700" />}
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-black text-slate-900">Modalidad 3: Tramo con Exclusiones</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Desde – Hasta con saltos/roturas omitidas
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Selector de Tipo de Operación */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Tipo de Operación a Registrar:
                  </span>
                  <div className="flex items-center gap-1.5 p-1 bg-white rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setSubTipoOperacion('manga')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                        subTipoOperacion === 'manga'
                          ? 'bg-emerald-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      🏷️ Puestas en Manga (Campo)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubTipoOperacion('salida')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                        subTipoOperacion === 'salida'
                          ? 'bg-amber-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      🚛 Salidas / Ventas / DT-e
                    </button>
                    {modalidad === '1' && (
                      <button
                        type="button"
                        onClick={() => setSubTipoOperacion('cajas')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                          subTipoOperacion === 'cajas'
                            ? 'bg-blue-900 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        📦 Compras Cajas SIGSA
                      </button>
                    )}
                  </div>
                </div>

                {/* Parámetros de asignación rápida */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/70">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Fecha de Operación:
                    </label>
                    <input
                      type="date"
                      value={metaInfo.fecha}
                      onChange={(e) => setMetaInfo({ ...metaInfo, fecha: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium"
                    />
                  </div>

                  {subTipoOperacion === 'manga' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Rodeo de Destino:
                        </label>
                        <select
                          value={metaInfo.rodeo}
                          onChange={(e) => setMetaInfo({ ...metaInfo, rodeo: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                        >
                          {rodeos.map((r) => (
                            <option key={r.id} value={r.nombre}>
                              {r.nombre} (Potrero {r.potrero_numero || 'S/N'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Categoría Ganadera:
                        </label>
                        <select
                          value={metaInfo.categoria}
                          onChange={(e) => setMetaInfo({ ...metaInfo, categoria: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium"
                        >
                          <option value="Terneros">Terneros / Terneras</option>
                          <option value="Vaquillonas Reposición">Vaquillonas Reposición</option>
                          <option value="Vaca Cría">Vaca Cría</option>
                          <option value="Toros Padres">Toros Padres</option>
                          <option value="Toritos">Toritos</option>
                          <option value="Vacas CUT">Vacas CUT</option>
                        </select>
                      </div>
                    </>
                  ) : subTipoOperacion === 'salida' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Motivo de Salida:
                        </label>
                        <select
                          value={metaInfo.motivoSalida}
                          onChange={(e) => setMetaInfo({ ...metaInfo, motivoSalida: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium"
                        >
                          <option value="Venta">Venta Comercial / Frigorífico</option>
                          <option value="Traslado">Traslado a otro establecimiento</option>
                          <option value="Baja / Mortandad">Baja / Mortandad</option>
                          <option value="Merma o rotura">Merma o rotura en manga</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          N° de DT-e / Remito (Opcional):
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: DTE-2026-00412"
                          value={metaInfo.dteNumero}
                          onChange={(e) => setMetaInfo({ ...metaInfo, dteNumero: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-mono"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              {/* CONTENIDO ESPECÍFICO SEGÚN LA MODALIDAD SELECCIONADA */}
              {modalidad === '1' && (
                <div className="space-y-4">
                  <MultiFileDropzone
                    files={selectedFiles}
                    onFilesChange={setSelectedFiles}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
                    disabled={loadingIa}
                    isProcessing={loadingIa}
                    title="Arrastrá o seleccioná uno o varios archivos de caravanas"
                    subtitle="Admite fotos de manga (JPG/PNG), PDFs de SIGSA, Facturas de compra o Excel/CSV. Podés soltar varios a la vez."
                  />

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      O pegá texto directo extraído o notas de manga:
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Ej: Lote 14/04/2026 desde 032010007455750 hasta 032010007455949..."
                      value={textInputIa}
                      onChange={(e) => setTextInputIa(e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-300 text-xs font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={loadingIa || (selectedFiles.length === 0 && !textInputIa.trim())}
                    onClick={handleProcesarModalidad1}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-800 to-teal-800 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    {loadingIa ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Interpretando con Gemini 2.5 Pro...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-emerald-300" />
                        <span>Analizar Documento con IA y Conciliar Padrón</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {modalidad === '2' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200 text-xs text-blue-950 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-extrabold">Resolución Inteligente de Números Cortos:</div>
                      <p className="text-[11px] text-blue-900/80 mt-0.5">
                        Podés pegar números de 4 a 6 dígitos (ej: <code>4680, 4681, 2255</code>) o los 15 dígitos completos.
                        El sistema buscará automáticamente a qué caja oficial de SIGSA pertenece cada animal y lo resolverá al instante.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Pegar lista de números (separados por coma, espacio o salto de línea):
                    </label>
                    <textarea
                      rows={6}
                      placeholder="Ejemplo:
4680, 4681, 4682
4630, 4631, 4632
2250, 2251, 2252"
                      value={numerosSueltosRaw}
                      onChange={(e) => setNumerosSueltosRaw(e.target.value)}
                      className="w-full p-3 rounded-2xl border border-slate-300 text-xs font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleProcesarModalidad2}
                    className="w-full py-3 rounded-2xl bg-emerald-800 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    <span>Resolver Números contra SIGSA y Ver Vista Previa</span>
                  </button>
                </div>
              )}

              {modalidad === '3' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-extrabold">Asignación Masiva Continua con Saltos y Roturas:</div>
                      <p className="text-[11px] text-amber-900/80 mt-0.5">
                        Ingresá el rango de la caja. En el campo de exclusiones podés colocar los números que se hayan roto, saltado o que no se colocaron (ej: <code>4636</code>). Esos números quedarán intactos y no se asignarán erróneamente.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Caravana Desde (15 dígitos o últimos números):
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: 032010010604630 o 4630"
                        value={tramoDesde}
                        onChange={(e) => setTramoDesde(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Caravana Hasta (15 dígitos o últimos números):
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: 032010010604664 o 4664"
                        value={tramoHasta}
                        onChange={(e) => setTramoHasta(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Excluir Números Rotos / Saltados (Opcional, separados por coma):
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: 4636, 032010010604639"
                      value={tramoExclusiones}
                      onChange={(e) => setTramoExclusiones(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono text-red-700"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleProcesarModalidad3}
                    className="w-full py-3 rounded-2xl bg-emerald-800 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    <span>Expandir Tramo con Exclusiones y Ver Vista Previa</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            /* STEP 2: VISTA PREVIA EDITABLE CON ESCUDO ANTI-DUPLICADOS */
            <div className="space-y-4">
              {/* Barra de Estadísticas y Escudo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-black uppercase text-slate-500">Detectadas</div>
                  <div className="text-lg font-black text-slate-900 mt-0.5">{previewStats.total}</div>
                </div>

                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                  <div className="text-[10px] font-black uppercase text-emerald-800">Nuevas a incorporar</div>
                  <div className="text-lg font-black text-emerald-700 mt-0.5">{previewStats.nuevas}</div>
                </div>

                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                  <div className="text-[10px] font-black uppercase text-amber-800 flex items-center gap-1">
                    <span>⚠️ Ya Registradas</span>
                  </div>
                  <div className="text-lg font-black text-amber-700 mt-0.5">{previewStats.duplicadas}</div>
                </div>

                <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200">
                  <div className="text-[10px] font-black uppercase text-blue-800">Seleccionadas</div>
                  <div className="text-lg font-black text-blue-700 mt-0.5">{previewStats.seleccionadas}</div>
                </div>
              </div>

              {/* Controles de selección y acciones en lote */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setItemsPreview((prev) => prev.map((it) => ({ ...it, incluir: true })));
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-bold hover:bg-slate-100"
                  >
                    Tildar Todas
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemsPreview((prev) =>
                        prev.map((it) => ({ ...it, incluir: it.clasificacion === 'nueva' }))
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-bold hover:bg-emerald-200"
                  >
                    Solo Nuevas (Omitir Duplicadas)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemsPreview((prev) => prev.map((it) => ({ ...it, incluir: false })));
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-100"
                  >
                    Desmarcar Todas
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                >
                  <span>← Modificar entrada / Volver</span>
                </button>
              </div>

              {/* Tabla de Vista Previa */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-[380px]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-black sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-8">
                        <Check className="w-3.5 h-3.5 text-slate-500" />
                      </th>
                      <th className="py-2.5 px-3">Caravana (15 Díg.)</th>
                      <th className="py-2.5 px-3">Estado / Escudo</th>
                      <th className="py-2.5 px-3">Caja Origen</th>
                      <th className="py-2.5 px-3">Rodeo Asignado</th>
                      <th className="py-2.5 px-3">Categoría</th>
                      <th className="py-2.5 px-3">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {itemsPreview.map((it, idx) => (
                      <tr
                        key={it.id || idx}
                        className={`hover:bg-slate-50 transition ${
                          !it.incluir ? 'opacity-40 bg-slate-50/50' : ''
                        }`}
                      >
                        <td className="p-2.5">
                          <input
                            type="checkbox"
                            checked={it.incluir}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setItemsPreview((prev) =>
                                prev.map((p, pIdx) => (pIdx === idx ? { ...p, incluir: checked } : p))
                              );
                            }}
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="p-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                          {it.caravana}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {it.clasificacion === 'nueva' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
                              🟢 Nueva a incorporar
                            </span>
                          ) : it.clasificacion === 'duplicada' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                              ⚠️ Ya en padrón
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">
                              Fuera de SIGSA
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">
                          {it.cajaEmparejada ? `Caja ${it.cajaEmparejada.caja_numero}` : 'S/Caja'}
                        </td>
                        <td className="p-2.5">
                          <select
                            value={it.rodeo || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setItemsPreview((prev) =>
                                prev.map((p, pIdx) => (pIdx === idx ? { ...p, rodeo: val } : p))
                              );
                            }}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white font-bold text-emerald-950"
                          >
                            {rodeos.map((r) => (
                              <option key={r.id} value={r.nombre}>
                                {r.nombre}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2.5">
                          <select
                            value={it.categoria || 'Terneros'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setItemsPreview((prev) =>
                                prev.map((p, pIdx) => (pIdx === idx ? { ...p, categoria: val } : p))
                              );
                            }}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white font-medium"
                          >
                            <option value="Terneros">Terneros</option>
                            <option value="Vaquillonas Reposición">Vaquillonas Reposición</option>
                            <option value="Vaca Cría">Vaca Cría</option>
                            <option value="Toros Padres">Toros Padres</option>
                            <option value="Toritos">Toritos</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                          {formatFechaAR(it.fecha)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Botón de Confirmación Definitiva */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200">
                <div className="text-xs text-slate-500">
                  Se actualizarán <strong>{previewStats.seleccionadas}</strong> registros sin tocar las no tildadas.
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setStep('input')}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50"
                  >
                    Volver
                  </button>

                  <button
                    type="button"
                    disabled={savingChanges || previewStats.seleccionadas === 0}
                    onClick={handleConfirmarYGuardar}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-800 to-teal-800 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    {savingChanges ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Guardando en Padrón...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                        <span>Confirmar y Actualizar Stock de Caravanas ({previewStats.seleccionadas})</span>
                      </>
                    )}
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
