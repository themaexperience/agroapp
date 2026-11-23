import React, { useState, useMemo } from 'react';
import {
  Truck,
  Sparkles,
  MapPin,
  Clock,
  CheckSquare,
  Square,
  FileDown,
  Share2,
  X,
  AlertTriangle,
  Wrench,
  ShieldCheck,
  Package,
  Layers,
  ChevronRight,
  RotateCcw,
  ExternalLink,
  Copy,
  Check,
  Compass,
  Sprout,
  Droplets,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import {
  planificarDiaCuadrilla,
  sugerirCuadrillaOptima,
  planificarRecorridaGanadera,
  isItemCompletado,
} from '../lib/geminiService';
import { exportarHojaCuadrillaPDF, exportarHojaRecorridaGanaderaPDF } from '../utils/pdfHelper';
import { getPaddockCentroid } from './MapaPotrerosView.jsx';
import { calcPotreroHacienda, calcRodeoCabezas } from '../utils/rodeoHelpers.js';
import PotreroCard from './PotreroCard.jsx';

export default function CuadrillaPlannerModal({
  isOpen,
  onClose,
  tareas = [],
  alertasMapa = [],
  molinos = [],
  potreros = [],
  rodeos = [],
  infraestructura = [],
  fechaOperacion = new Date().toISOString().slice(0, 10),
  initialMode = 'GANADERA', // 'GANADERA' | 'CUADRILLA'
  initialView = 'seleccion', // 'seleccion' | 'hoja'
  activeRoute = null,
  onSaveRoute,
  onClearRoute,
  onViewRouteInMap,
  notify,
}) {
  if (!isOpen) return null;

  // Modo: 'GANADERA' (Recorrida de Rodeos y Pasturas) | 'CUADRILLA' (Mantenimiento e Infraestructura)
  const [modoPlanner, setModoPlanner] = useState(() => {
    if (initialView === 'hoja' && activeRoute) {
      return activeRoute.tipo === 'RECORRIDA_GANADERA' ? 'GANADERA' : 'CUADRILLA';
    }
    return initialMode || 'GANADERA';
  });
  // Paso: 'SELECCION' | 'PLAN'
  const [step, setStep] = useState(() => {
    if (initialView === 'hoja' && activeRoute) return 'PLAN';
    return 'SELECCION';
  });
  const [loading, setLoading] = useState(false);

  // Filtros
  const [filterCuadrilla, setFilterCuadrilla] = useState('TODOS'); // 'TODOS' | 'TAREAS' | 'ALERTAS' | 'MOLINOS'
  const [filterGanadera, setFilterGanadera] = useState('CON_HACIENDA'); // 'TODOS' | 'CON_HACIENDA' | 'EN_SERVICIO' | 'PASTURAS'

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [planResult, setPlanResult] = useState(() => {
    if (initialView === 'hoja' && activeRoute) return activeRoute;
    return null;
  });
  const [checkedItems, setCheckedItems] = useState(() => {
    if (activeRoute?.checkedItems) return new Set(activeRoute.checkedItems);
    return new Set();
  });
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);

  // Coordenadas del Casco / Galpón Taller (Punto 0: Centroide real de Potrero #14 Casco)
  const cascoCoords = useMemo(() => {
    // 1. Buscar el Potrero #14 (Casco) en los potreros GIS del campo
    const potreroCasco = potreros.find(
      (p) => Number(p.numero) === 14 || (p.nombre && p.nombre.toLowerCase().includes('casco'))
    );
    if (potreroCasco) {
      const idx = potreros.indexOf(potreroCasco);
      const centroid = getPaddockCentroid(potreroCasco, idx >= 0 ? idx : 0);
      if (centroid && !isNaN(centroid[0]) && !isNaN(centroid[1])) {
        return centroid;
      }
    }

    // 2. Buscar en infraestructura Casco
    const cascoInfra = infraestructura.find(
      (inf) =>
        inf.tipo === 'Edificación / Casco' ||
        (inf.nombre && (inf.nombre.toLowerCase().includes('casco') || inf.nombre.toLowerCase().includes('galpón')))
    );
    if (cascoInfra?.latitud && cascoInfra?.longitud) {
      return [Number(cascoInfra.latitud), Number(cascoInfra.longitud)];
    }
    return [-35.868, -58.945]; // Centro operativo Las Flores
  }, [potreros, infraestructura]);

  // Bounding box de seguridad de Establecimiento San José (Las Flores, P1 a P37)
  const isInsideSanJose = (lat, lng) => {
    const nLat = Number(lat);
    const nLng = Number(lng);
    return (
      !isNaN(nLat) &&
      !isNaN(nLng) &&
      nLat >= -36.1 &&
      nLat <= -35.6 &&
      nLng >= -59.2 &&
      nLng <= -58.7
    );
  };

  // Geolocalización segura y precisa de cada ítem de trabajo (sin desplazamientos arbitrarios hacia el oeste)
  const getItemCoords = (item) => {
    // 1. Si ya cuenta con latitud/longitud válidas dentro del perímetro de San José
    if (isInsideSanJose(item?.latitud, item?.longitud)) {
      return [Number(item.latitud), Number(item.longitud)];
    }
    if (isInsideSanJose(item?.lat, item?.lng)) {
      return [Number(item.lat), Number(item.lng)];
    }

    // 2. Si es un Molino o infraestructura específica
    if (item?.tipo === 'Molino' || item?.infraestructura_id || item?.molino_numero) {
      const molinoMatch = molinos.find(
        (m) =>
          Number(m.numero) === Number(item.molino_numero || item.numero || item.rawId) ||
          m.id === (item.infraestructura_id || item.rawId)
      );
      if (molinoMatch && isInsideSanJose(molinoMatch.latitud, molinoMatch.longitud)) {
        return [Number(molinoMatch.latitud), Number(molinoMatch.longitud)];
      }

      const infraMatch = infraestructura.find(
        (inf) =>
          inf.id === (item.infraestructura_id || item.rawId) ||
          (item.infraestructura_nombre && inf.nombre === item.infraestructura_nombre)
      );
      if (infraMatch && isInsideSanJose(infraMatch.latitud, infraMatch.longitud)) {
        return [Number(infraMatch.latitud), Number(infraMatch.longitud)];
      }
    }

    // 3. Si pertenece a un Potrero: usar centroide poligonal real con getPaddockCentroid
    if (item?.potrero_numero) {
      const potNum = Number(item.potrero_numero);
      const pot = potreros.find((p) => Number(p.numero) === potNum);
      if (pot) {
        const idx = potreros.indexOf(pot);
        const centroid = getPaddockCentroid(pot, idx >= 0 ? idx : 0);
        if (centroid && isInsideSanJose(centroid[0], centroid[1])) {
          return centroid;
        }
      }
    }

    // 4. Fallback seguro: Casco (P#14)
    return cascoCoords;
  };

  // ==========================================
  // CANDIDATOS PARA MODO CUADRILLA
  // ==========================================
  const candidatosCuadrilla = useMemo(() => {
    const list = [];
    tareas
      .filter((t) => !isItemCompletado(t))
      .forEach((t) => {
        const [lat, lng] = getItemCoords(t);
        list.push({
          id: `tarea_${t.id}`,
          rawId: t.id,
          tipo: 'Tarea',
          subtipo: t.categoria || 'Mantenimiento',
          titulo: t.titulo,
          prioridad: t.prioridad || 'Media',
          potrero_numero: t.potrero_numero,
          ubicacion: t.potrero_numero ? `Potrero #${t.potrero_numero}` : t.infraestructura_nombre || 'Casco / General',
          lat,
          lng,
          observaciones: t.observaciones || '',
          responsable: t.responsable || 'Cuadrilla',
        });
      });

    alertasMapa
      .filter((a) => !isItemCompletado(a))
      .forEach((a) => {
        const [lat, lng] = getItemCoords(a);
        list.push({
          id: `alerta_${a.id}`,
          rawId: a.id,
          tipo: 'Alerta',
          subtipo: a.tipo || 'Alerta Mapa',
          titulo: a.titulo || 'Novedad de campo',
          prioridad: a.prioridad || 'Alta',
          potrero_numero: a.potrero_numero,
          ubicacion: a.potrero_numero ? `Potrero #${a.potrero_numero}` : 'Punto en mapa',
          lat,
          lng,
          observaciones: a.descripcion || '',
          responsable: 'Cuadrilla',
        });
      });

    molinos
      .filter((m) => (m.estado === 'Roto' || m.estado === 'Mantenimiento' || m.novedades) && !isItemCompletado(m))
      .forEach((m) => {
        const [lat, lng] = getItemCoords({ ...m, tipo: 'Molino' });
        list.push({
          id: `molino_${m.id || m.numero}`,
          rawId: m.id || m.numero,
          tipo: 'Molino',
          subtipo: 'Aguada',
          titulo: `Molino M#${m.numero}: ${m.nombre || 'Aguada'}`,
          prioridad: m.estado === 'Roto' ? 'Urgente' : 'Alta',
          potrero_numero: m.potrero_numero,
          ubicacion: `Molino #${m.numero}${m.potrero_numero ? ` (P#${m.potrero_numero})` : ''}`,
          lat,
          lng,
          observaciones: m.novedades || m.observaciones || `Estado: ${m.estado}`,
          responsable: 'Molinero / Cuadrilla',
        });
      });

    return list;
  }, [tareas, alertasMapa, molinos, potreros, infraestructura, cascoCoords]);

  // ==========================================
  // CANDIDATOS PARA MODO RECORRIDA GANADERA
  // ==========================================
  const candidatosGanadera = useMemo(() => {
    return potreros.map((p, idx) => {
      const pNum = Number(p.numero);
      const [cLat, cLng] = getPaddockCentroid(p, idx);

      // Conteo oficial y rodeos asociados al potrero
      const { rodeos: rodeosEnPotrero, totalCabezas, totalToros, enServicio } = calcPotreroHacienda(p, rodeos);

      const pastura = p.recurso_forrajero || p.cultivo_actual || 'Campo Natural';
      const esPasturaImplantada =
        pastura.toLowerCase().includes('raigrás') ||
        pastura.toLowerCase().includes('festuca') ||
        pastura.toLowerCase().includes('avena') ||
        pastura.toLowerCase().includes('trébol') ||
        pastura.toLowerCase().includes('agropiro') ||
        pastura.toLowerCase().includes('verdeo') ||
        pastura.toLowerCase().includes('alfalfa');

      // Molinos en el potrero
      const molinosEnPotrero = molinos.filter((m) => Number(m.potrero_numero) === pNum);

      return {
        id: `potrero_${p.id || p.numero}`,
        rawId: p.id || p.numero,
        numero: p.numero,
        nombre: p.nombre,
        hectareas: Number(p.hectareas) || 80,
        recurso_forrajero: pastura,
        esPasturaImplantada,
        coordenadas: [cLat, cLng],
        rodeos: rodeosEnPotrero,
        total_cabezas: totalCabezas,
        total_toros: totalToros,
        en_servicio: enServicio,
        molinos: molinosEnPotrero,
      };
    });
  }, [potreros, rodeos, molinos]);

  // Filtrado de candidatos según pestaña activa
  const itemsFiltrados = useMemo(() => {
    if (modoPlanner === 'CUADRILLA') {
      if (filterCuadrilla === 'TODOS') return candidatosCuadrilla;
      if (filterCuadrilla === 'TAREAS') return candidatosCuadrilla.filter((c) => c.tipo === 'Tarea');
      if (filterCuadrilla === 'ALERTAS') return candidatosCuadrilla.filter((c) => c.tipo === 'Alerta');
      if (filterCuadrilla === 'MOLINOS') return candidatosCuadrilla.filter((c) => c.tipo === 'Molino');
      return candidatosCuadrilla;
    } else {
      // GANADERA
      if (filterGanadera === 'TODOS') return candidatosGanadera;
      if (filterGanadera === 'CON_HACIENDA') return candidatosGanadera.filter((c) => c.total_cabezas > 0);
      if (filterGanadera === 'EN_SERVICIO') return candidatosGanadera.filter((c) => c.en_servicio);
      if (filterGanadera === 'PASTURAS') return candidatosGanadera.filter((c) => c.esPasturaImplantada);
      return candidatosGanadera;
    }
  }, [modoPlanner, filterCuadrilla, filterGanadera, candidatosCuadrilla, candidatosGanadera]);

  // Selección y deselección
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      itemsFiltrados.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Sugerencia Inteligente IA
  const handleAutoSuggest = () => {
    if (modoPlanner === 'CUADRILLA') {
      const sugeridos = sugerirCuadrillaOptima({
        tareas,
        alertas: alertasMapa,
        molinos,
        maxItems: 5,
      });
      if (!sugeridos || sugeridos.length === 0) {
        notify?.('No se encontraron trabajos o alertas pendientes para sugerir.', 'info');
        return;
      }
      const newSet = new Set(sugeridos.map((s) => s.id));
      setSelectedIds(newSet);
      notify?.(`✨ IA seleccionó ${newSet.size} trabajos prioritarios por cercanía y urgencia.`, 'success');
    } else {
      // Sugerir Circuito Ganadero Óptimo
      // Priorizar potreros en servicio/entore, con pasturas implantadas o mayor cantidad de cabezas
      const priorizados = [...candidatosGanadera]
        .filter((p) => p.total_cabezas > 0 || p.en_servicio)
        .sort((a, b) => {
          const scoreA = (a.en_servicio ? 100 : 0) + (a.esPasturaImplantada ? 50 : 0) + a.total_cabezas;
          const scoreB = (b.en_servicio ? 100 : 0) + (b.esPasturaImplantada ? 50 : 0) + b.total_cabezas;
          return scoreB - scoreA;
        })
        .slice(0, 6);

      if (priorizados.length === 0) {
        notify?.('No se detectaron potreros con hacienda activa para sugerir.', 'info');
        return;
      }
      const newSet = new Set(priorizados.map((p) => p.id));
      setSelectedIds(newSet);
      notify?.(
        `🐂 IA seleccionó circuito óptimo de ${newSet.size} potreros (vientres en servicio y pasturas clave).`,
        'success'
      );
    }
  };

  // Generar Plan de Recorrida
  const handleGenerarPlan = async () => {
    if (selectedIds.size === 0) {
      notify?.('Seleccioná al menos un ítem para armar la recorrida.', 'warning');
      return;
    }

    setLoading(true);
    try {
      let plan = null;
      if (modoPlanner === 'GANADERA') {
        const potrerosElegidos = candidatosGanadera.filter((p) => selectedIds.has(p.id));
        plan = await planificarRecorridaGanadera({
          potrerosSeleccionados: potrerosElegidos,
          cascoCoords,
          fechaOperacion,
          recorredorNombre: 'Puestero / Recorredor San José',
        });
      } else {
        const elegidos = candidatosCuadrilla.filter((c) => selectedIds.has(c.id));
        plan = await planificarDiaCuadrilla({
          itemsSeleccionados: elegidos,
          cascoCoords,
          fechaOperacion,
          cuadrillaNombre: 'Cuadrilla San José',
        });
      }

      if (plan) {
        const planConMeta = {
          ...plan,
          checkedItems: [],
          savedAt: new Date().toISOString(),
        };
        setPlanResult(planConMeta);
        setCheckedItems(new Set());
        if (onSaveRoute) onSaveRoute(planConMeta);
        setStep('PLAN');
        notify?.('✨ Hoja de ruta generada exitosamente.', 'success');
      }
    } catch (err) {
      console.error('Error generando plan:', err);
      notify?.(`Error al planificar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Checklist interactivo persistido
  const toggleChecklist = (key) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);

      if (planResult && onSaveRoute) {
        onSaveRoute({
          ...planResult,
          checkedItems: Array.from(next),
        });
      }
      return next;
    });
  };

  // Compartir por WhatsApp
  const handleShareWhatsApp = () => {
    if (!planResult) return;
    const isGanadera = planResult.tipo === 'RECORRIDA_GANADERA';

    let paradasTxt = '';
    if (isGanadera) {
      paradasTxt = (planResult.paradas || [])
        .map((p, idx) => {
          const rodeosTxt = (p.rodeos_en_potrero || [])
            .map((r) => {
              const cab = calcRodeoCabezas(r);
              const toros = (parseInt(r.toros_padres, 10) || 0) + (parseInt(r.toritos, 10) || 0) + (parseInt(r.toros, 10) || 0);
              return `${r.nombre} (${cab} cab.${toros > 0 ? ` · ${toros}T` : ''})`;
            })
            .join(', ') || 'Sin hacienda fija';
          const relev = p.puntos_relevamiento || {};
          return (
            `${idx + 1}️⃣ *Parada ${idx + 1}:* ${p.ubicacion || `Potrero #${p.potrero_numero}`}\n` +
            `   • _Hacienda:_ ${rodeosTxt}\n` +
            `   • _Pastura:_ ${p.recurso_forrajero || 'Campo Natural'}\n` +
            `   • _Foco Relevamiento:_ CC (meta 3.0), pasto remanente, aguada y sanidad.`
          );
        })
        .join('\n\n');
    } else {
      paradasTxt = (planResult.paradas || [])
        .map(
          (p, idx) =>
            `${idx + 1}️⃣ *Parada ${idx + 1}:* ${p.ubicacion || 'Campo'} (~${p.duracion_estimada})\n` +
            `   • _Trabajo:_ ${p.titulo || ''} — ${p.acciones || ''}\n` +
            `   • _Herramientas:_ ${(p.herramientas_especificas || []).join(', ') || 'Estándar'}`
        )
        .join('\n\n');
    }

    const checklistTxt = [
      `📦 *CHECKLIST ${isGanadera ? 'DEL RECORREDOR' : 'CARGA CAMIONETA'}:*`,
      '▫️ *Equipo:* ' + (planResult.checklist_camioneta?.herramientas || []).slice(0, 5).join(', '),
      `▫️ *${isGanadera ? 'Sanidad' : 'Materiales'}:* ` + (planResult.checklist_camioneta?.materiales_repuestos || []).slice(0, 5).join(', '),
      '▫️ *Seguridad:* ' + (planResult.checklist_camioneta?.seguridad_epp || []).slice(0, 3).join(', '),
    ].join('\n');

    const mensaje = [
      `🐎 *ESTABLECIMIENTO SAN JOSÉ — ${isGanadera ? 'HOJA DE RECORRIDA GANADERA' : 'DÍA DE CUADRILLA'}*`,
      `📅 *Fecha:* ${fechaOperacion} | ⏱️ *Tiempo est.:* ${planResult.tiempo_total_estimado}${planResult.distancia_total_km ? ` | 📏 *${planResult.distancia_total_km} km*` : ''}`,
      `🏁 *Salida:* ${planResult.inicio_recomendado || 'Casco Central'}`,
      `📋 *Estrategia:* ${planResult.resumen_operativo}`,
      '',
      checklistTxt,
      '',
      '🗺️ *ORDEN DE RECORRIDO (SIN VUELTAS ATRÁS):*',
      paradasTxt,
      '',
      '_Generado por Sistema Agroganadera Rincón del Sur S.A._',
    ].join('\n');

    navigator.clipboard?.writeText(mensaje);
    setCopiedWhatsApp(true);
    setTimeout(() => setCopiedWhatsApp(false), 3000);

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`;
    window.open(waUrl, '_blank');
    notify?.('Texto copiado y listo para enviar por WhatsApp al recorredor/cuadrilla.', 'success');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto">
        {/* Cabecera Principal */}
        <div
          className={`px-6 py-4.5 text-white flex flex-wrap items-center justify-between border-b gap-3 shrink-0 ${
            modoPlanner === 'GANADERA'
              ? 'bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 border-emerald-500/20'
              : 'bg-gradient-to-r from-amber-950 via-slate-900 to-emerald-950 border-amber-500/20'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                modoPlanner === 'GANADERA'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}
            >
              {modoPlanner === 'GANADERA' ? <Compass className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white tracking-wide truncate">
                  {modoPlanner === 'GANADERA'
                    ? 'Planificador de Recorridas Ganaderas'
                    : 'Planificador de Día de Cuadrilla'}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 ${
                    modoPlanner === 'GANADERA' ? 'bg-emerald-400 text-slate-950' : 'bg-amber-400 text-slate-950'
                  }`}
                >
                  {modoPlanner === 'GANADERA' ? 'Ganadería' : 'Mantenimiento'}
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate">
                {modoPlanner === 'GANADERA'
                  ? 'Ruta óptima por potreros, rodeos en servicio, CC y pasturas · San José'
                  : 'Ruta óptima de trabajos, tiempos y checklist de camioneta · San José'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle entre Recorrida Ganadera y Cuadrilla */}
            {step === 'SELECCION' && (
              <div className="inline-flex rounded-xl bg-white/10 p-1 border border-white/15">
                <button
                  type="button"
                  onClick={() => {
                    setModoPlanner('GANADERA');
                    setSelectedIds(new Set());
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${
                    modoPlanner === 'GANADERA'
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>🐂 Ganadera</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModoPlanner('CUADRILLA');
                    setSelectedIds(new Set());
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${
                    modoPlanner === 'CUADRILLA'
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>🛻 Cuadrilla</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cuerpo del Modal */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {step === 'SELECCION' ? (
            /* ============================================================== */
            /* PASO 1: SELECCIÓN DE POTREROS O TRABAJOS                       */
            /* ============================================================== */
            <div className="space-y-4">
              {/* Barra de Asistente IA y Acciones */}
              <div
                className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border ${
                  modoPlanner === 'GANADERA'
                    ? 'bg-gradient-to-r from-emerald-500/10 via-slate-50 to-transparent border-emerald-200'
                    : 'bg-gradient-to-r from-amber-500/10 via-slate-50 to-transparent border-amber-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-xl text-white shadow-sm ${
                      modoPlanner === 'GANADERA' ? 'bg-emerald-600' : 'bg-amber-500'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                      {modoPlanner === 'GANADERA'
                        ? 'Circuito de Relevamiento Ganadero'
                        : 'Selección de Trabajos para el Día'}
                    </h3>
                    <p className="text-xs text-slate-600">
                      {modoPlanner === 'GANADERA'
                        ? 'Elegí los potreros a recorrer. La ruta se ordenará geográficamente para no volver atrás.'
                        : 'Elegí manualmente las tareas o dejá que la IA arme el paquete óptimo.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleAutoSuggest}
                    className={`px-3.5 py-2 rounded-xl text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition active:scale-95 ${
                      modoPlanner === 'GANADERA' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                    <span>{modoPlanner === 'GANADERA' ? '✨ Sugerir Circuito Ganadero' : '✨ Sugerir Cuadrilla Óptima'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                  >
                    Seleccionar visibles ({itemsFiltrados.length})
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                    >
                      Limpiar ({selectedIds.size})
                    </button>
                  )}
                </div>
              </div>

              {/* Filtros */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {modoPlanner === 'GANADERA' ? (
                    [
                      { key: 'CON_HACIENDA', label: 'Con Hacienda', count: candidatosGanadera.filter((p) => p.total_cabezas > 0).length },
                      { key: 'EN_SERVICIO', label: 'En Servicio / Toros', count: candidatosGanadera.filter((p) => p.en_servicio).length },
                      { key: 'PASTURAS', label: 'Pasturas Implantadas', count: candidatosGanadera.filter((p) => p.esPasturaImplantada).length },
                      { key: 'TODOS', label: 'Todos los Potreros', count: candidatosGanadera.length },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setFilterGanadera(tab.key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          filterGanadera === tab.key
                            ? 'bg-emerald-900 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {tab.label} ({tab.count})
                      </button>
                    ))
                  ) : (
                    [
                      { key: 'TODOS', label: 'Todos', count: candidatosCuadrilla.length },
                      { key: 'TAREAS', label: 'Tareas', count: candidatosCuadrilla.filter((c) => c.tipo === 'Tarea').length },
                      { key: 'ALERTAS', label: 'Post-its', count: candidatosCuadrilla.filter((c) => c.tipo === 'Alerta').length },
                      { key: 'MOLINOS', label: 'Molinos', count: candidatosCuadrilla.filter((c) => c.tipo === 'Molino').length },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setFilterCuadrilla(tab.key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          filterCuadrilla === tab.key
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {tab.label} ({tab.count})
                      </button>
                    ))
                  )}
                </div>

                <div className="text-xs text-slate-500 font-bold shrink-0">
                  {selectedIds.size} elegidos
                </div>
              </div>

              {/* Grilla de Ítems Disponibles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
                {itemsFiltrados.length === 0 ? (
                  <div className="col-span-full py-10 text-center text-slate-400 text-xs font-semibold">
                    No hay elementos que coincidan con el filtro seleccionado.
                  </div>
                ) : modoPlanner === 'GANADERA' ? (
                  itemsFiltrados.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <PotreroCard
                        key={item.id}
                        potrero={item}
                        rodeos={item.rodeos}
                        isSelected={isSelected}
                        onToggle={() => toggleSelect(item.id)}
                        selectionType="checkbox"
                        molinos={item.molinos}
                      />
                    );
                  })
                ) : (
                  itemsFiltrados.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleSelect(item.id)}
                        className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-start gap-3 select-none ${
                          isSelected
                            ? 'bg-amber-50/80 border-amber-500 ring-2 ring-amber-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="pt-0.5">
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-amber-700 shrink-0" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-300 shrink-0" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-extrabold text-xs text-slate-900 truncate">
                              {item.titulo}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 ${
                                item.prioridad === 'Urgente'
                                  ? 'bg-red-100 text-red-700'
                                  : item.prioridad === 'Alta'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {item.prioridad}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{item.ubicacion}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-semibold text-slate-600">{item.subtipo}</span>
                          </div>

                          {item.observaciones && (
                            <p className="text-[11px] text-slate-600 line-clamp-1 italic">
                              "{item.observaciones}"
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* ============================================================== */
            /* PASO 2: HOJA DE RUTA OPTIMIZADA (PLAN)                         */
            /* ============================================================== */
            <div className="space-y-5 animate-fadeIn">
              {/* Tarjeta Resumen de Estrategia */}
              <div
                className={`p-5 rounded-3xl text-white shadow-lg border ${
                  planResult?.tipo === 'RECORRIDA_GANADERA'
                    ? 'bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 border-emerald-500/30'
                    : 'bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 border-amber-500/30'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        planResult?.tipo === 'RECORRIDA_GANADERA'
                          ? 'bg-emerald-400 text-slate-950'
                          : 'bg-amber-400 text-slate-950'
                      }`}
                    >
                      {planResult?.tipo === 'RECORRIDA_GANADERA'
                        ? 'Circuito de Relevamiento Ganadero'
                        : 'Plan de Operaciones Cuadrilla'}
                    </span>
                    <h3 className="text-lg font-black text-white mt-1">
                      {planResult?.tipo === 'RECORRIDA_GANADERA'
                        ? `Hoja de Recorrida · ${planResult.paradas?.length || 0} Potreros`
                        : `Día de Cuadrilla · ${planResult?.paradas?.length || 0} Paradas`}
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {planResult?.resumen_operativo}
                    </p>
                  </div>

                  {/* Botones de Exportar / WhatsApp / Mapa */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {onViewRouteInMap && (
                      <button
                        type="button"
                        onClick={() => onViewRouteInMap(planResult)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md transition active:scale-95 ${
                          planResult?.tipo === 'RECORRIDA_GANADERA'
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                            : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                        }`}
                      >
                        <MapPin className="w-4 h-4" />
                        <span>Ver en Mapa</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (planResult?.tipo === 'RECORRIDA_GANADERA') {
                          exportarHojaRecorridaGanaderaPDF(planResult, { fechaOperacion, notify });
                        } else {
                          exportarHojaCuadrillaPDF(planResult, { fechaOperacion, notify });
                        }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 border border-white/10 transition"
                    >
                      <FileDown className="w-4 h-4" />
                      <span>Descargar PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleShareWhatsApp}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 shadow-md transition active:scale-95"
                    >
                      {copiedWhatsApp ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                      <span>{copiedWhatsApp ? 'Copiado!' : 'WhatsApp'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep('SELECCION')}
                      className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition"
                    >
                      Editar
                    </button>
                  </div>
                </div>

                {/* Métricas del Circuito */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Tiempo Estimado</span>
                    <span className="font-extrabold text-white text-sm">
                      ⏱️ {planResult?.tiempo_total_estimado}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Distancia Total</span>
                    <span className="font-extrabold text-white text-sm">
                      📏 {planResult?.distancia_total_km || 10} km
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Horario de Salida</span>
                    <span className="font-extrabold text-white text-sm">
                      🏁 {planResult?.inicio_recomendado || '07:00 hs'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      {planResult?.tipo === 'RECORRIDA_GANADERA' ? 'Cabezas a Relevar' : 'Paradas Totales'}
                    </span>
                    <span className="font-extrabold text-white text-sm">
                      {planResult?.tipo === 'RECORRIDA_GANADERA'
                        ? `🐮 ${planResult.total_cabezas_inspeccionar || 0} cab.`
                        : `📍 ${planResult?.paradas?.length || 0} paradas`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Checklist de Carga / Equipo */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-800 tracking-wide flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    Checklist del Recorredor (Verificar antes de salir al campo)
                  </h4>
                  <span className="text-[11px] text-slate-500 font-bold">
                    {checkedItems.size} marcados
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {/* Herramientas / Equipo */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-2">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      Equipo & Óptica
                    </span>
                    {(planResult?.checklist_camioneta?.herramientas || []).map((item, idx) => {
                      const key = `h_${idx}`;
                      const isTicked = checkedItems.has(key);
                      return (
                        <div
                          key={key}
                          onClick={() => toggleChecklist(key)}
                          className={`flex items-start gap-2 p-1 rounded-lg cursor-pointer transition select-none ${
                            isTicked ? 'bg-slate-100 line-through text-slate-400' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {isTicked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                          )}
                          <span className="text-[11px] leading-tight">{item}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sanidad y Materiales */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-2">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      Sanidad Rápida & Repuestos
                    </span>
                    {(planResult?.checklist_camioneta?.materiales_repuestos || []).map((item, idx) => {
                      const key = `m_${idx}`;
                      const isTicked = checkedItems.has(key);
                      return (
                        <div
                          key={key}
                          onClick={() => toggleChecklist(key)}
                          className={`flex items-start gap-2 p-1 rounded-lg cursor-pointer transition select-none ${
                            isTicked ? 'bg-slate-100 line-through text-slate-400' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {isTicked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                          )}
                          <span className="text-[11px] leading-tight">{item}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Comunicación & Seguridad */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-2">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      VHF, Agua & EPP
                    </span>
                    {(planResult?.checklist_camioneta?.seguridad_epp || []).map((item, idx) => {
                      const key = `s_${idx}`;
                      const isTicked = checkedItems.has(key);
                      return (
                        <div
                          key={key}
                          onClick={() => toggleChecklist(key)}
                          className={`flex items-start gap-2 p-1 rounded-lg cursor-pointer transition select-none ${
                            isTicked ? 'bg-slate-100 line-through text-slate-400' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {isTicked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                          )}
                          <span className="text-[11px] leading-tight">{item}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Orden Secuencial de Paradas */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-800 tracking-wide flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-emerald-700" />
                    Circuito Optimizado de Paradas (Orden Geográfico sin Cruces)
                  </h4>
                  <span className="text-xs text-slate-500 font-bold">
                    {planResult?.paradas?.length || 0} potreros
                  </span>
                </div>

                <div className="space-y-3">
                  {(planResult?.paradas || []).map((p, idx) => {
                    const stopKey = `stop_${idx}`;
                    const isCompleted = checkedItems.has(stopKey);
                    const isGanadera = planResult?.tipo === 'RECORRIDA_GANADERA';

                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-2xl border transition shadow-xs ${
                          isCompleted
                            ? 'bg-slate-50 border-slate-200 opacity-80'
                            : isGanadera
                            ? 'bg-white border-slate-200 hover:border-emerald-400'
                            : 'bg-white border-slate-200 hover:border-amber-400'
                        }`}
                      >
                        <div className="flex items-start gap-3.5">
                          {/* N° Parada con Checkbox */}
                          <div
                            onClick={() => toggleChecklist(stopKey)}
                            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 cursor-pointer text-white font-black text-sm shadow-sm transition active:scale-95 ${
                              isCompleted
                                ? 'bg-slate-400'
                                : isGanadera
                                ? 'bg-emerald-700'
                                : 'bg-amber-600'
                            }`}
                            title="Tocar para marcar parada relevada"
                          >
                            {isCompleted ? <Check className="w-5 h-5" /> : p.numero_parada || idx + 1}
                          </div>

                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`font-black text-sm ${isCompleted ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                                  {p.ubicacion || (p.potrero_nombre ? `Potrero #${p.potrero_numero} ${p.potrero_nombre}` : `Parada ${idx + 1}`)}
                                </span>
                                {p.recurso_forrajero && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-200">
                                    🌱 {p.recurso_forrajero}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-xs font-bold">
                                {p.distancia_desde_anterior_km > 0 && (
                                  <span className="text-slate-500 font-medium">
                                    {Number(p.potrero_numero) === 14 ||
                                    (p.ubicacion && p.ubicacion.toLowerCase().includes('casco')) ||
                                    p.distancia_desde_anterior_km <= 0.35
                                      ? '~0,2 km · En Casco'
                                      : `+${p.distancia_desde_anterior_km} km`}
                                  </span>
                                )}
                                <span className={isGanadera ? 'text-emerald-800' : 'text-amber-800'}>
                                  ⏱️ {p.duracion_estimada}
                                </span>
                              </div>
                            </div>

                            {/* Título y Acciones */}
                            <p className="text-xs text-slate-700 leading-snug">
                              <strong>{p.titulo}</strong> — {p.acciones}
                            </p>

                            {/* Detalle Ganadero de Relevamiento */}
                            {isGanadera && p.puntos_relevamiento && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                                  <div className="text-[10px] font-black uppercase text-slate-500">
                                    🥩 Condición Corporal
                                  </div>
                                  <div className="text-slate-800 font-medium text-[11px]">
                                    {p.puntos_relevamiento.condicion_corporal}
                                  </div>
                                </div>

                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                                  <div className="text-[10px] font-black uppercase text-slate-500">
                                    🌱 Pastura / Remanente
                                  </div>
                                  <div className="text-slate-800 font-medium text-[11px]">
                                    {p.puntos_relevamiento.disponibilidad_pasto}
                                  </div>
                                </div>

                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                                  <div className="text-[10px] font-black uppercase text-slate-500">
                                    💧 Aguada / Molino
                                  </div>
                                  <div className="text-slate-800 font-medium text-[11px]">
                                    {p.puntos_relevamiento.aguadas}
                                  </div>
                                </div>

                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                                  <div className="text-[10px] font-black uppercase text-slate-500">
                                    🩺 Sanidad & Toros
                                  </div>
                                  <div className="text-slate-800 font-medium text-[11px]">
                                    {p.puntos_relevamiento.sanidad_reproduccion}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Rodeos presentes en la parada */}
                            {isGanadera && p.rodeos_en_potrero && p.rodeos_en_potrero.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                {p.rodeos_en_potrero.map((r, ri) => (
                                  <span
                                    key={ri}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200"
                                  >
                                    🐮 {r.nombre} ({r.cabezas || r.cantidad_cabezas || 0} cab.)
                                    {r.toros ? ` · ${r.toros} Toros` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pie del Modal */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          {step === 'SELECCION' ? (
            <>
              <div className="text-xs text-slate-600 font-medium">
                <strong>{selectedIds.size}</strong> potreros/trabajos seleccionados
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || loading}
                  onClick={handleGenerarPlan}
                  className={`px-5 py-2.5 rounded-xl text-white text-xs font-black flex items-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-50 disabled:scale-100 ${
                    modoPlanner === 'GANADERA' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Optimizando Ruta sin Cruces...
                    </>
                  ) : (
                    <>
                      {modoPlanner === 'GANADERA' ? <Compass className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                      <span>
                        {modoPlanner === 'GANADERA'
                          ? `Armar Recorrida Ganadera (${selectedIds.size})`
                          : `Armar Día de Cuadrilla (${selectedIds.size})`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {onClearRoute && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearRoute();
                      notify?.('Ruta archivada y jornada finalizada con éxito.', 'info');
                      onClose();
                    }}
                    className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition flex items-center gap-1.5"
                    title="Archivar y limpiar esta hoja de ruta activa"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Finalizar / Limpiar Ruta</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep('SELECCION')}
                  className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
                >
                  ✏️ Editar Selección
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
                >
                  Listo / Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
