import React, { useState, useMemo, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import {
  Syringe,
  Calendar,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Edit3,
  ShieldCheck,
  Filter,
  X,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Sprout,
  CheckSquare,
  Truck,
  Search,
  Sparkles,
  RotateCcw,
  CalendarDays,
  Columns,
  LayoutGrid,
  Check,
  MapPin,
  Users,
  AlertCircle,
  HelpCircle,
  Layers,
  ClipboardList,
  Tags,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  formatFechaAR,
  buildGoogleCalendarUrl,
  calcularRangoSemanal,
  formatRangoProveedorAR,
} from '../utils/dateHelper';
import {
  getSanJoseLogoDataUrl,
  drawSanJosePdfHeader,
  drawSanJoseSignatureFooter,
} from '../utils/pdfHelper';
import { CRONOGRAMA_SAN_JOSE_2026 } from '../data/cronogramaSanJose.js';
import { confirmAction } from './ConfirmDialog';

const MESES = [
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

const DIAS_SEMANA_COMPLETOS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

const DIAS_SEMANA_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const TIPOS_EVENTO = [
  'Vacunación',
  'Antiparasitario / Mineral',
  'Manejo Reproductivo',
  'Manejo General',
  'Tarea Operativa',
  'Mantenimiento',
];

export default function CalendarioSanitarioView({
  eventosSanitarios = [],
  rodeos = [],
  siembras = [],
  tareas = [],
  proveedoresEsperados = [],
  potreros = [],
  fechaOperacion = '',
  onNavigate,
  navContext = null,
  onClearNavContext,
  onRefresh,
  notify,
}) {
  // 1. SELECTOR DE MODO: 'calendario' | 'tarjetas' | 'mixta'
  const [viewMode, setViewMode] = useState('calendario');

  // Carga complementaria o fallback de Proveedores Esperados
  const [localProveedores, setLocalProveedores] = useState([]);
  useEffect(() => {
    if (proveedoresEsperados && proveedoresEsperados.length > 0) return;
    async function fetchProveedores() {
      try {
        const { data, error } = await supabase
          .from('proveedores_esperados')
          .select('*')
          .order('semana_estimada', { ascending: true });
        if (!error && data) setLocalProveedores(data);
      } catch (e) {
        console.warn('Error cargando proveedores en Calendario:', e);
      }
    }
    fetchProveedores();
  }, [proveedoresEsperados]);

  const effectiveProveedores = proveedoresEsperados?.length > 0 ? proveedoresEsperados : localProveedores;

  // Navegación de mes y año
  // Se inicializa en Noviembre 2026 (mes 10) si la fecha de operación o sistema es 2026-11
  const initDate = useMemo(() => {
    if (fechaOperacion) {
      const parts = fechaOperacion.split('-');
      if (parts.length >= 2) {
        return {
          year: parseInt(parts[0], 10),
          month: parseInt(parts[1], 10) - 1,
        };
      }
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [fechaOperacion]);

  const [currentYear, setCurrentYear] = useState(initDate.year);
  const [currentMonth, setCurrentMonth] = useState(initDate.month);
  const [selectedDateStr, setSelectedDateStr] = useState(
    fechaOperacion || new Date().toISOString().slice(0, 10)
  );
  const [mobileCalendarSubView, setMobileCalendarSubView] = useState('agenda'); // 'agenda' | 'grilla' en móviles

  // Filtros
  const [filterTipo, setFilterTipo] = useState('TODOS');
  const [filterEstado, setFilterEstado] = useState('TODOS'); // 'TODOS' | 'PENDIENTES' | 'REALIZADOS'
  const [searchQuery, setSearchQuery] = useState('');

  // Capas activas en la agenda del calendario
  const [layers, setLayers] = useState({
    sanidad: true, // Ámbar / Naranja (Vacunaciones y antiparasitarios)
    manejo: true, // Esmeralda (Reproductivo y manejo: Entore, Tacto, etc.)
    siembras: true, // Azul / Cian (Siembras y labores)
    tareas: true, // Violeta (Tareas de campo con fecha)
    proveedores: true, // Naranja / Ámbar (Proveedores y logística de campo)
  });

  // Modales y estados de trabajo
  const [saving, setSaving] = useState(false);
  const [modalNewOpen, setModalNewOpen] = useState(false);
  const [modalEventDetail, setModalEventDetail] = useState(null);
  const [modalWeekProveedores, setModalWeekProveedores] = useState(null); // { weekLabel, items: [...] }
  const [editingEvento, setEditingEvento] = useState(null);

  // Formulario nuevo evento
  const [newEvento, setNewEvento] = useState({
    tipo: 'Vacunación',
    nombre_protocolo: '',
    producto_sugerido: '',
    categoria_destino: 'Vacas y Vaquillonas preñadas',
    rodeo_aplicado: 'Todos los rodeos de cría',
    mes_epoca: 'Noviembre 2026',
    fecha_programada: fechaOperacion || new Date().toISOString().slice(0, 10),
    dosis_via: '5 ml SC',
    observaciones: '',
  });

  // Si no hay eventos sanitarios en la base de datos, sugerir precarga
  const needsSeed = eventosSanitarios.length === 0;

  // Sanitarios efectivos: si no hay en la base de datos aún, usar el cronograma oficial de San José 2026
  const effectiveSanitarios = useMemo(() => {
    return (eventosSanitarios && eventosSanitarios.length > 0)
      ? eventosSanitarios
      : CRONOGRAMA_SAN_JOSE_2026;
  }, [eventosSanitarios]);

  // Fecha de hoy de referencia
  const hoyStr = fechaOperacion || new Date().toISOString().slice(0, 10);

  // =========================================================================
  // NORMALIZACIÓN Y FUSIÓN DE LA AGENDA MULTICOLOR
  // =========================================================================
  const allAgendaEvents = useMemo(() => {
    const list = [];

    // 1 & 2. Eventos Sanitarios y de Manejo (o Tareas / Mantenimiento agendadas)
    effectiveSanitarios.forEach((ev, idx) => {
      const tipo = ev.tipo || 'Vacunación';
      const tipoLower = (ev.tipo || '').toLowerCase();
      const catDestinoLower = (ev.categoria_destino || '').toLowerCase();
      const nombreLower = (ev.nombre_protocolo || '').toLowerCase();

      const isTarea =
        tipoLower.includes('tarea') ||
        tipoLower.includes('operativa') ||
        tipoLower.includes('mantenimiento') ||
        catDestinoLower.includes('tarea') ||
        catDestinoLower.includes('operativa') ||
        catDestinoLower.includes('mantenimiento');

      const isManejo =
        !isTarea &&
        (tipo === 'Manejo Reproductivo' ||
          tipo === 'Manejo General' ||
          tipoLower.includes('manejo') ||
          tipoLower.includes('reproductivo'));

      let categoryGroup = 'sanidad';
      let colorCategory = 'amber';
      let badge = 'Sanidad';

      if (isTarea) {
        categoryGroup = 'tareas';
        colorCategory = 'purple';
        badge = 'Tareas Operativas';
      } else if (isManejo) {
        categoryGroup = 'manejo';
        colorCategory = 'emerald';
        badge = 'Manejo Reproductivo';
      }

      if (!layers[categoryGroup]) return;

      const dStr = ev.fecha_programada || (ev.fecha_realizada ? ev.fecha_realizada : null);
      if (!dStr) return;

      list.push({
        id: ev.id ? `san_${ev.id}` : `san_cron_${ev.orden || idx}`,
        originalId: ev.id || null,
        orden: ev.orden || idx + 1,
        source: isTarea ? 'tarea' : 'sanidad',
        categoryGroup,
        colorCategory,
        badge,
        tipo: ev.tipo,
        title: ev.nombre_protocolo,
        date: dStr,
        realizado: Boolean(ev.realizado),
        producto: ev.producto_sugerido || '',
        categoria: ev.categoria_destino || '',
        rodeo: ev.rodeo_aplicado || 'Todos los rodeos',
        dosis: ev.dosis_via || '',
        mes_epoca: ev.mes_epoca || '',
        observaciones: ev.observaciones || '',
        raw: ev,
      });
    });

    // 3. Siembras y Labores Agrícolas (Azul / Cian)
    if (layers.siembras) {
      siembras.forEach((s) => {
        if (!s.fecha) return;
        const potreroHa = potreros.find((p) => p.numero === s.potrero_numero)?.hectareas || 0;
        const ha = Number(s.ha_sembradas || s.hectareas) || potreroHa || 0;
        const isPastoreoOrDone =
          s.estado === 'En Pastoreo' || s.estado === 'Cosechado' || s.estado === 'Sembrado';

        list.push({
          id: `siembra_${s.id}`,
          originalId: s.id,
          source: 'siembra',
          categoryGroup: 'siembras',
          colorCategory: 'cyan',
          badge: 'Siembras & Labores',
          tipo: 'Labor / Siembra Agrícola',
          title: `P#${s.potrero_numero} · ${s.cultivo_variedad} (${ha.toFixed(1)} ha)`,
          date: s.fecha,
          realizado: isPastoreoOrDone,
          producto: s.variedad_hibrido || s.cultivo_variedad,
          categoria: `Superficie: ${ha.toFixed(1)} ha`,
          rodeo: `Potrero #${s.potrero_numero}`,
          dosis: s.campana || '2026/2027',
          mes_epoca: s.estado || 'Siembra',
          observaciones: s.observaciones || s.insumos_detalle || '',
          raw: s,
        });
      });
    }

    // 4. Tareas Operativas de Campo (Violeta)
    if (layers.tareas) {
      tareas.forEach((t) => {
        const dStr = t.fecha_limite || t.fecha || (t.created_at ? t.created_at.slice(0, 10) : null);
        if (!dStr) return;

        list.push({
          id: `tarea_${t.id}`,
          originalId: t.id,
          source: 'tarea',
          categoryGroup: 'tareas',
          colorCategory: 'purple',
          badge: 'Tareas Operativas',
          tipo: t.categoria ? `Tarea (${t.categoria})` : 'Tarea de Campo',
          title: t.titulo || t.descripcion || 'Tarea operativa',
          date: dStr,
          realizado: Boolean(t.completada),
          producto: t.responsable || t.asignado_a || 'Equipo campo',
          categoria: t.prioridad ? `Prioridad: ${t.prioridad}` : (t.categoria || 'Operativo'),
          rodeo: t.potrero_numero ? `Potrero #${t.potrero_numero}` : 'San José',
          dosis: t.estado || 'En curso',
          mes_epoca: 'Campo',
          observaciones: t.observaciones || t.notas || t.descripcion || '',
          raw: t,
        });
      });
    }

    // 5. Proveedores y Servicios Esperados (Naranja / Ámbar cálido)
    if (layers.proveedores) {
      (effectiveProveedores || []).forEach((p) => {
        const dStr = p.semana_estimada || p.fecha || (p.created_at ? p.created_at.slice(0, 10) : null);
        if (!dStr) return;

        let fechaInicio = dStr;
        let fechaFin = p.semana_fin || null;
        let esSemanaORango = false;
        let labelRango = '';

        if (p.modalidad_fecha === 'dia') {
          fechaInicio = dStr;
          fechaFin = dStr;
          esSemanaORango = false;
          labelRango = formatFechaAR(dStr);
        } else if (p.semana_fin) {
          fechaInicio = dStr;
          fechaFin = p.semana_fin;
          esSemanaORango = p.semana_fin !== dStr;
          labelRango = formatRangoProveedorAR(fechaInicio, fechaFin);
        } else {
          // Si no tiene semana_fin ni modalidad_fecha explícita pero tiene semana_estimada
          const r = calcularRangoSemanal(dStr, 0, 1);
          fechaInicio = r.fechaInicio;
          fechaFin = r.fechaFin;
          esSemanaORango = true;
          labelRango = r.label;
        }

        const isRecibido = p.estado === 'Recibido';

        list.push({
          id: `prov_${p.id}`,
          originalId: p.id,
          source: 'proveedor',
          categoryGroup: 'proveedores',
          colorCategory: 'orange',
          badge: 'Proveedores & Logística',
          tipo: 'Proveedor & Logística',
          title: `🚚 ${p.proveedor_o_rubro || 'Entrega / Servicio'}`,
          date: fechaInicio,
          fechaInicio,
          fechaFin,
          esSemanaORango,
          labelRango,
          realizado: isRecibido,
          producto: p.proveedor_o_rubro || '',
          categoria: p.estado || 'Esperando',
          rodeo: p.indicaciones || 'Establecimiento San José',
          dosis: p.estado || 'Esperando',
          mes_epoca: 'Logística & Proveedores',
          observaciones: [
            p.indicaciones ? `Indicaciones: ${p.indicaciones}` : '',
            p.notas ? `Notas: ${p.notas}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          raw: p,
        });
      });
    }

    return list;
  }, [effectiveSanitarios, siembras, tareas, effectiveProveedores, potreros, layers]);

  // Mapa de eventos indexados por fecha 'YYYY-MM-DD'
  // Nota: Los proveedores de semana o rango se excluyen de las celdas diarias puntuales
  // para evitar duplicar 7 pastillas idénticas por semana; se renderizan en la barra continua semanal.
  const eventsByDate = useMemo(() => {
    const map = {};
    allAgendaEvents.forEach((item) => {
      if (item.source === 'proveedor' && item.esSemanaORango) {
        return;
      }
      if (!map[item.date]) {
        map[item.date] = [];
      }
      map[item.date].push(item);
    });
    return map;
  }, [allAgendaEvents]);

  // Deep-linking cruzado recibido desde otros módulos (Inicio / Mapa / Tareas / Rodeos)
  useEffect(() => {
    if (!navContext) return;
    if (navContext.date) {
      setSelectedDateStr(navContext.date);
      const parts = navContext.date.split('-');
      if (parts.length >= 2) {
        setCurrentYear(parseInt(parts[0], 10));
        setCurrentMonth(parseInt(parts[1], 10) - 1);
      }
    }
    if (navContext.search) {
      setSearchQuery(navContext.search);
    }
    if (navContext.eventoId) {
      const found = allAgendaEvents.find(
        (e) => String(e.originalId || e.id) === String(navContext.eventoId)
      );
      if (found) {
        setModalEventDetail(found);
      }
    }
    onClearNavContext?.();
  }, [navContext, allAgendaEvents, onClearNavContext]);

  // Eventos filtrados para la vista de listado o panel lateral
  const eventosFiltradosList = useMemo(() => {
    return allAgendaEvents.filter((e) => {
      if (filterTipo !== 'TODOS') {
        if (e.source !== 'sanidad') return false;
        if (e.tipo !== filterTipo) return false;
      }
      if (filterEstado === 'PENDIENTES' && e.realizado) return false;
      if (filterEstado === 'REALIZADOS' && !e.realizado) return false;

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchTitle = (e.title || '').toLowerCase().includes(q);
        const matchProd = (e.producto || '').toLowerCase().includes(q);
        const matchRodeo = (e.rodeo || '').toLowerCase().includes(q);
        const matchCat = (e.categoria || '').toLowerCase().includes(q);
        if (!matchTitle && !matchProd && !matchRodeo && !matchCat) return false;
      }

      return true;
    });
  }, [allAgendaEvents, filterTipo, filterEstado, searchQuery]);

  // Eventos del día seleccionado (o del mes actual si no hay día seleccionado)
  const eventosDiaSeleccionado = useMemo(() => {
    if (!selectedDateStr) return [];
    return eventosFiltradosList.filter((e) => e.date === selectedDateStr);
  }, [eventosFiltradosList, selectedDateStr]);

  // Eventos del mes visualizado actualmente
  const eventosMesActual = useMemo(() => {
    const padMonth = String(currentMonth + 1).padStart(2, '0');
    const prefix = `${currentYear}-${padMonth}`;
    return eventosFiltradosList.filter((e) => e.date.startsWith(prefix));
  }, [eventosFiltradosList, currentYear, currentMonth]);

  // KPIs de la sección y alineación de tareas en mes visible vs. total
  const stats = useMemo(() => {
    // Sanitarios & Manejo puros (excluyendo los que actúan como tarea operativa)
    const sanitariosPuros = effectiveSanitarios.filter((ev) => {
      const tipoLower = (ev.tipo || '').toLowerCase();
      const catDestinoLower = (ev.categoria_destino || '').toLowerCase();
      return !(
        tipoLower.includes('tarea') ||
        tipoLower.includes('operativa') ||
        tipoLower.includes('mantenimiento') ||
        catDestinoLower.includes('tarea') ||
        catDestinoLower.includes('operativa') ||
        catDestinoLower.includes('mantenimiento')
      );
    });

    const sanTotal = sanitariosPuros.length;
    const sanRealizados = sanitariosPuros.filter((e) => e.realizado).length;
    const sanPendientes = sanTotal - sanRealizados;
    const siembrasCount = siembras.length;

    // Tareas provenientes de eventos_sanitarios
    const tareasFromSanitarios = effectiveSanitarios
      .filter((ev) => {
        const tipoLower = (ev.tipo || '').toLowerCase();
        const catDestinoLower = (ev.categoria_destino || '').toLowerCase();
        return (
          tipoLower.includes('tarea') ||
          tipoLower.includes('operativa') ||
          tipoLower.includes('mantenimiento') ||
          catDestinoLower.includes('tarea') ||
          catDestinoLower.includes('operativa') ||
          catDestinoLower.includes('mantenimiento')
        );
      })
      .map((e, idx) => ({
        id: e.id ? `san_${e.id}` : `san_${idx}`,
        titulo: e.nombre_protocolo || 'Tarea Operativa',
        date: e.fecha_programada || e.fecha_realizada || null,
        completada: Boolean(e.realizado),
      }));

    // Tareas provenientes de Cuaderno de Campo (tareas_campo)
    const tareasFromCampo = (tareas || []).map((t) => ({
      id: `tarea_${t.id}`,
      titulo: t.titulo || t.descripcion || 'Tarea de Campo',
      date: t.fecha_limite || t.fecha || (t.created_at ? t.created_at.slice(0, 10) : null),
      completada: Boolean(t.completada),
    }));

    const todasTareas = [...tareasFromCampo, ...tareasFromSanitarios];
    const tareasTotal = todasTareas.length;
    const tareasPendientesTotal = todasTareas.filter((t) => !t.completada).length;

    // Tareas en el mes visible actualmente
    const padMonth = String(currentMonth + 1).padStart(2, '0');
    const prefix = `${currentYear}-${padMonth}`;
    const tareasMes = todasTareas.filter((t) => t.date && t.date.startsWith(prefix));
    const tareasMesCount = tareasMes.length;
    const tareasPendientesMes = tareasMes.filter((t) => !t.completada).length;

    // Buscar si hay tareas en otro mes para navegación rápida en la tarjeta KPI
    const tareasFueraMes = todasTareas.filter((t) => t.date && !t.date.startsWith(prefix));
    let otraTareaTarget = null;
    if (tareasFueraMes.length > 0) {
      const sorted = [...tareasFueraMes].sort((a, b) => (a.date > b.date ? 1 : -1));
      // Priorizar la próxima en el futuro respecto al mes visible, o la primera disponible
      const proxima = sorted.find((t) => t.date > prefix) || sorted[0];
      if (proxima && proxima.date) {
        const parts = proxima.date.split('-');
        if (parts.length >= 2) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1; // 0-indexed
          otraTareaTarget = {
            year: y,
            month: m,
            mesNombre: MESES[m] || 'otro mes',
            date: proxima.date,
            titulo: proxima.titulo,
            isNext: y > currentYear || (y === currentYear && m > currentMonth),
          };
        }
      }
    }

    return {
      sanTotal,
      sanRealizados,
      sanPendientes,
      siembrasCount,
      tareasCount: tareasMesCount, // Alinear contador con los eventos reales que renderiza la grilla
      tareasTotal,
      tareasMesCount,
      tareasPendientesMes,
      tareasPendientesTotal,
      otraTareaTarget,
    };
  }, [effectiveSanitarios, siembras, tareas, currentYear, currentMonth]);

  // =========================================================================
  // NAVEGACIÓN DEL CALENDARIO MENSUAL (LUNES A DOMINGO)
  // =========================================================================
  function handlePrevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  function handleGoToday() {
    if (fechaOperacion) {
      const parts = fechaOperacion.split('-');
      if (parts.length >= 2) {
        setCurrentYear(parseInt(parts[0], 10));
        setCurrentMonth(parseInt(parts[1], 10) - 1);
        setSelectedDateStr(fechaOperacion);
        return;
      }
    }
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDateStr(now.toISOString().slice(0, 10));
  }

  // Generación de celdas de la cuadrícula mensual
  const calendarCells = useMemo(() => {
    const cells = [];
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    // En JS getDay(): 0=Domingo, 1=Lunes... Para que Lunes sea 0:
    const startDayIndex = (firstDayOfMonth.getDay() + 6) % 7;
    const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    // 1. Días del mes anterior para rellenar la primera semana
    for (let i = startDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = currentMonth === 0 ? 11 : currentMonth - 1;
      const prevY = currentMonth === 0 ? currentYear - 1 : currentYear;
      const dateStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        dayNumber: d,
        dateStr,
        isCurrentMonth: false,
        events: eventsByDate[dateStr] || [],
      });
    }

    // 2. Días del mes actual
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(
        d
      ).padStart(2, '0')}`;
      cells.push({
        dayNumber: d,
        dateStr,
        isCurrentMonth: true,
        events: eventsByDate[dateStr] || [],
      });
    }

    // 3. Días del mes siguiente para completar la cuadrícula (hasta 35 o 42 celdas)
    const totalCells = cells.length > 35 ? 42 : 35;
    const remaining = totalCells - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextM = currentMonth === 11 ? 0 : currentMonth + 1;
      const nextY = currentMonth === 11 ? currentYear + 1 : currentYear;
      const dateStr = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        dayNumber: d,
        dateStr,
        isCurrentMonth: false,
        events: eventsByDate[dateStr] || [],
      });
    }

    return cells;
  }, [currentYear, currentMonth, eventsByDate]);

  // Agrupación de celdas en semanas de 7 días (Lunes a Domingo) para renderizar franjas continuas
  const calendarWeeks = useMemo(() => {
    const weeks = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      weeks.push(calendarCells.slice(i, i + 7));
    }
    return weeks;
  }, [calendarCells]);

  // Proveedores que abarcan una semana o rango de semanas
  const proveedoresSemanales = useMemo(() => {
    if (!layers.proveedores) return [];
    return allAgendaEvents.filter((e) => e.source === 'proveedor' && e.esSemanaORango);
  }, [allAgendaEvents, layers.proveedores]);

  // Helper para obtener los proveedores activos en una semana (weekStart a weekEnd)
  const getProveedoresDeSemana = (weekStart, weekEnd) => {
    return proveedoresSemanales.filter((p) => {
      const fIni = p.fechaInicio || p.date;
      const fFin = p.fechaFin || fIni;
      return fIni <= weekEnd && fFin >= weekStart;
    });
  };

  // Proveedores de la semana en la que cae el día seleccionado
  const proveedoresSemanaSeleccionada = useMemo(() => {
    if (!selectedDateStr || !layers.proveedores) return [];
    const r = calcularRangoSemanal(selectedDateStr, 0, 1);
    return getProveedoresDeSemana(r.fechaInicio, r.fechaFin);
  }, [selectedDateStr, layers.proveedores, proveedoresSemanales]);

  // Bloques semanales para la vista móvil en formato Agenda
  const mobileWeeklyBlocks = useMemo(() => {
    return calendarWeeks
      .filter((week) => week.some((c) => c.isCurrentMonth))
      .map((week, idx) => {
        const weekStart = week[0].dateStr;
        const weekEnd = week[6].dateStr;
        const weekProvs = getProveedoresDeSemana(weekStart, weekEnd);

        // Días de esta semana que tienen eventos o coinciden con hoy/seleccionado
        const daysWithEvents = week
          .map((cell) => ({
            dateStr: cell.dateStr,
            dayNumber: cell.dayNumber,
            isCurrentMonth: cell.isCurrentMonth,
            isToday: cell.dateStr === hoyStr,
            isSelected: cell.dateStr === selectedDateStr,
            events: cell.events,
          }))
          .filter((c) => c.events.length > 0 || c.isToday || c.isSelected);

        const isCurrentWeek = week.some((c) => c.dateStr === hoyStr);
        const isSelectedWeek = selectedDateStr && week.some((c) => c.dateStr === selectedDateStr);

        const [y1, m1, d1] = weekStart.split('-');
        const [y2, m2, d2] = weekEnd.split('-');
        const labelSemana = isCurrentWeek
          ? `📍 Esta Semana (${d1}/${m1} – ${d2}/${m2})`
          : `Semana ${d1}/${m1} – ${d2}/${m2}`;

        const totalItems =
          weekProvs.length + daysWithEvents.reduce((acc, d) => acc + d.events.length, 0);

        return {
          id: `week_${idx}`,
          weekIndex: idx,
          weekStart,
          weekEnd,
          labelSemana,
          isCurrentWeek,
          isSelectedWeek,
          weekProvs,
          daysWithEvents,
          totalItems,
        };
      });
  }, [calendarWeeks, proveedoresSemanales, hoyStr, selectedDateStr]);

  // =========================================================================
  // ACCIONES CRUD DE EVENTOS SANITARIOS
  // =========================================================================
  async function handleToggleRealizado(item) {
    if (item.source === 'proveedor') {
      const nextEstado = item.realizado ? 'Esperando' : 'Recibido';
      try {
        const { error } = await supabase
          .from('proveedores_esperados')
          .update({ estado: nextEstado, updated_at: new Date().toISOString() })
          .eq('id', item.originalId);
        if (error) throw error;
        notify?.(`Entrega/servicio de "${item.producto}" marcado como ${nextEstado}.`, 'success');
        if (modalEventDetail && modalEventDetail.id === item.id) {
          setModalEventDetail({
            ...modalEventDetail,
            realizado: nextEstado === 'Recibido',
            categoria: nextEstado,
            dosis: nextEstado,
            raw: { ...modalEventDetail.raw, estado: nextEstado },
          });
        }
        if (modalWeekProveedores && Array.isArray(modalWeekProveedores.items)) {
          setModalWeekProveedores({
            ...modalWeekProveedores,
            items: modalWeekProveedores.items.map((p) =>
              p.id === item.id || p.originalId === item.originalId
                ? {
                    ...p,
                    realizado: nextEstado === 'Recibido',
                    categoria: nextEstado,
                    dosis: nextEstado,
                    raw: { ...(p.raw || {}), estado: nextEstado },
                  }
                : p
            ),
          });
        }
        onRefresh?.();
      } catch (err) {
        notify?.('Error actualizando proveedor: ' + err.message, 'error');
      }
      return;
    }

    if (item.source !== 'sanidad') {
      notify?.('Para modificar este evento, accedé al módulo correspondiente.', 'info');
      return;
    }
    const nextVal = !item.realizado;
    try {
      if (!item.originalId) {
        // Si aún no está en Supabase, insertar con el nuevo estado
        const { error } = await supabase.from('eventos_sanitarios').insert({
          orden: item.orden || 1,
          tipo: item.tipo,
          nombre_protocolo: item.title,
          producto_sugerido: item.producto || null,
          categoria_destino: item.categoria || 'General',
          rodeo_aplicado: item.rodeo || 'Todos los rodeos',
          mes_epoca: item.mes_epoca || '',
          fecha_programada: item.raw?.fecha_programada || item.date,
          fecha_realizada: nextVal ? (fechaOperacion || new Date().toISOString().slice(0, 10)) : null,
          dosis_via: item.dosis || null,
          observaciones: item.observaciones || null,
          realizado: nextVal,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('eventos_sanitarios')
          .update({
            realizado: nextVal,
            fecha_realizada: nextVal ? (fechaOperacion || new Date().toISOString().slice(0, 10)) : null,
          })
          .eq('id', item.originalId);
        if (error) throw error;
      }

      notify?.(
        nextVal
          ? `✓ Protocolo "${item.title}" marcado como realizado.`
          : `Protocolo "${item.title}" reabierto como pendiente.`,
        'success'
      );
      if (modalEventDetail && modalEventDetail.id === item.id) {
        setModalEventDetail((prev) => ({ ...prev, realizado: nextVal }));
      }
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al actualizar estado: ${err.message}`, 'error');
    }
  }

  async function handleCreateEvento(e) {
    e.preventDefault();
    if (!newEvento.nombre_protocolo.trim()) {
      notify?.('Ingresá el nombre del protocolo sanitario o tratamiento.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('eventos_sanitarios').insert({
        orden: eventosSanitarios.length + 1,
        tipo: newEvento.tipo,
        nombre_protocolo: newEvento.nombre_protocolo.trim(),
        producto_sugerido: newEvento.producto_sugerido.trim() || null,
        categoria_destino: newEvento.categoria_destino.trim() || 'Rodeo General',
        rodeo_aplicado: newEvento.rodeo_aplicado.trim() || 'Todos los rodeos',
        mes_epoca: newEvento.mes_epoca.trim() || `${MESES[currentMonth]} ${currentYear}`,
        fecha_programada: newEvento.fecha_programada || null,
        dosis_via: newEvento.dosis_via.trim() || null,
        observaciones: newEvento.observaciones.trim() || null,
        realizado: false,
      });
      if (error) throw error;
      notify?.(`Protocolo "${newEvento.nombre_protocolo}" agendado con éxito.`, 'success');
      setModalNewOpen(false);
      setNewEvento({
        tipo: 'Vacunación',
        nombre_protocolo: '',
        producto_sugerido: '',
        categoria_destino: 'Vacas y Vaquillonas preñadas',
        rodeo_aplicado: 'Todos los rodeos de cría',
        mes_epoca: `${MESES[currentMonth]} ${currentYear}`,
        fecha_programada: fechaOperacion || new Date().toISOString().slice(0, 10),
        dosis_via: '5 ml SC',
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al agendar evento: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEditEvento(e) {
    e.preventDefault();
    if (!editingEvento) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('eventos_sanitarios')
        .update({
          tipo: editingEvento.tipo,
          nombre_protocolo: editingEvento.nombre_protocolo.trim(),
          producto_sugerido: editingEvento.producto_sugerido?.trim() || null,
          categoria_destino: editingEvento.categoria_destino?.trim() || 'General',
          rodeo_aplicado: editingEvento.rodeo_aplicado?.trim() || 'Todos',
          mes_epoca: editingEvento.mes_epoca?.trim() || '',
          fecha_programada: editingEvento.fecha_programada || null,
          dosis_via: editingEvento.dosis_via?.trim() || null,
          observaciones: editingEvento.observaciones?.trim() || null,
        })
        .eq('id', editingEvento.id);

      if (error) throw error;
      notify?.('Protocolo sanitario actualizado con éxito.', 'success');
      setEditingEvento(null);
      setModalEventDetail(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al actualizar protocolo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEvento(item) {
    if (item.source !== 'sanidad') return;
    const ok = await confirmAction({
      title: `¿Eliminar "${item.title}"?`,
      description: 'El protocolo será eliminado definitivamente del calendario sanitario.',
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('eventos_sanitarios')
        .delete()
        .eq('id', item.originalId);
      if (error) throw error;
      notify?.('Protocolo eliminado del calendario.', 'success');
      setModalEventDetail(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al eliminar: ${err.message}`, 'error');
    }
  }

  // Restablecer / Precargar Cronograma Real de San José 2026
  async function handleRestablecerCronograma() {
    const ok = await confirmAction({
      title: '¿Cargar Cronograma Oficial San José 2026?',
      description: 'Se sincronizarán los 16 protocolos con las fechas previas a noviembre 2026 marcadas como Realizadas (✓).',
      confirmText: 'Sí, sincronizar',
      variant: 'warning',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await supabase.from('eventos_sanitarios').delete().gt('id', 0);
      const { error } = await supabase.from('eventos_sanitarios').insert(CRONOGRAMA_SAN_JOSE_2026);
      if (error) throw error;
      notify?.('Cronograma Oficial San José 2026 cargado y sincronizado con éxito.', 'success');
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al precargar cronograma: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Abrir nuevo evento con día preseteado desde el calendario
  function handleOpenNewEventOnDate(dateStr) {
    setNewEvento((prev) => ({
      ...prev,
      fecha_programada: dateStr,
      mes_epoca: `${MESES[currentMonth]} ${currentYear}`,
    }));
    setModalNewOpen(true);
  }

  // Exportar Hoja de Manga PDF
  async function handleExportHojaMangaPDF() {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const logoDataUrl = await getSanJoseLogoDataUrl();
      let y = drawSanJosePdfHeader(doc, {
        title: 'HOJA DE TRABAJO SANITARIO EN MANGA',
        subtitle: 'Protocolos pendientes del período + Planilla de Rodeos a encerrar y dosificar',
        fechaOperacion,
        logoDataUrl,
      });

      const pendientes = eventosFiltradosList.filter((e) => e.source === 'sanidad' && !e.realizado);
      const lista = pendientes.length > 0 ? pendientes : eventosFiltradosList.filter((e) => e.source === 'sanidad');

      doc.setFillColor(6, 78, 59);
      doc.rect(14, y, 182, 7.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('1. TRATAMIENTOS / PROTOCOLOS SANITARIOS A APLICAR EN MANGA', 17, y + 5.2);
      y += 8.5;

      doc.setFillColor(241, 245, 249);
      doc.rect(14, y, 182, 6.5, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(7);
      doc.text('OK', 16, y + 4.5);
      doc.text('TRATAMIENTO / PROTOCOLO', 24, y + 4.5);
      doc.text('PRODUCTO / DOSIS', 88, y + 4.5);
      doc.text('CATEGORÍA / RODEO', 132, y + 4.5);
      doc.text('ÉPOCA / FECHA', 171, y + 4.5);
      y += 6.5;

      lista.forEach((ev, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 18;
        }
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 8.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 8.5, 196, y + 8.5);

        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.35);
        doc.rect(16, y + 2, 4, 4);

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(ev.title || '').slice(0, 36), 24, y + 5.3);

        doc.setFont('helvetica', 'normal');
        const prodDosis = `${ev.producto || '-'} (${ev.dosis || 's/d'})`;
        doc.text(prodDosis.slice(0, 26), 88, y + 5.3);
        doc.text(`${ev.categoria || ''} · ${ev.rodeo || ''}`.slice(0, 24), 132, y + 5.3);
        doc.text(String(ev.date || ev.mes_epoca || '-').slice(0, 14), 171, y + 5.3);
        y += 8.5;
      });

      y += 6;
      if (y > 220) {
        doc.addPage();
        y = 18;
      }

      doc.setFillColor(15, 23, 42);
      doc.rect(14, y, 182, 7.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('2. RODEOS A ENCERRAR (UBICACIÓN ACTUAL, STOCK Y CONTROL DE DOSIS)', 17, y + 5.2);
      y += 8.5;

      doc.setFillColor(241, 245, 249);
      doc.rect(14, y, 182, 6.5, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(7);
      doc.text('OK', 16, y + 4.5);
      doc.text('RODEO', 24, y + 4.5);
      doc.text('POTRERO', 68, y + 4.5);
      doc.text('VACAS', 95, y + 4.5);
      doc.text('TERN.', 110, y + 4.5);
      doc.text('TOTAL', 125, y + 4.5);
      doc.text('ENCERRADAS', 141, y + 4.5);
      doc.text('DOSIS APLIC.', 163, y + 4.5);
      doc.text('NOTAS', 183, y + 4.5);
      y += 6.5;

      const rodeosActivos = rodeos.filter(
        (r) =>
          (parseInt(r.vacas, 10) || 0) +
            (parseInt(r.terneros, 10) || 0) +
            (parseInt(r.toros_padres, 10) || 0) +
            (parseInt(r.toritos, 10) || 0) +
            (parseInt(r.vaquillonas_reposicion, 10) || 0) >
          0
      );

      rodeosActivos.forEach((r, idx) => {
        if (y > 260) {
          doc.addPage();
          y = 18;
        }
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 7.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 7.5, 196, y + 7.5);

        doc.setDrawColor(15, 23, 42);
        doc.rect(16, y + 1.8, 3.8, 3.8);

        const tot =
          (parseInt(r.vacas, 10) || 0) +
          (parseInt(r.terneros, 10) || 0) +
          (parseInt(r.toros_padres, 10) || 0) +
          (parseInt(r.toritos, 10) || 0) +
          (parseInt(r.vacas_cut, 10) || 0) +
          (parseInt(r.vaquillonas_reposicion, 10) || 0);

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(r.nombre || '').slice(0, 22), 24, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.text(r.potrero_numero ? `Potrero ${r.potrero_numero}` : 'Sin potrero', 68, y + 5);
        doc.text(String(r.vacas || 0), 97, y + 5);
        doc.text(String(r.terneros || 0), 112, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.text(String(tot), 127, y + 5);

        doc.setDrawColor(148, 163, 184);
        doc.rect(141, y + 1.3, 18, 4.8);
        doc.rect(163, y + 1.3, 17, 4.8);
        doc.line(182, y + 6, 195, y + 6);

        y += 7.5;
      });

      drawSanJoseSignatureFooter(doc, y + 8, {
        leftLabel: 'Firma Veterinario / Responsable Manga',
        rightLabel: 'Control Encargado San José',
      });

      doc.save(`Hoja_Trabajo_Manga_SanJose_${fechaOperacion || new Date().toISOString().slice(0, 10)}.pdf`);
      notify?.('Hoja de Trabajo Sanitario en Manga (PDF) descargada.', 'success');
    } catch (err) {
      notify?.(`Error al exportar PDF: ${err.message}`, 'error');
    }
  }

  // Helper para color de pastillas en calendario (alto contraste sobre fondo claro)
  function getPillClasses(colorCategory, realizado) {
    if (colorCategory === 'purple') {
      return realizado
        ? 'bg-purple-100 text-purple-900 border border-purple-300 font-bold opacity-85'
        : 'bg-purple-100 text-purple-900 border border-purple-300 hover:bg-purple-200 font-bold';
    }
    if (realizado) {
      return 'bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold';
    }
    switch (colorCategory) {
      case 'amber':
        return 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200';
      case 'orange':
        return 'bg-orange-100 text-orange-900 border border-orange-300 hover:bg-orange-200';
      case 'emerald':
        return 'bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200';
      case 'cyan':
        return 'bg-sky-100 text-sky-900 border border-sky-300 hover:bg-sky-200';
      default:
        return 'bg-slate-100 text-slate-800 border border-slate-300';
    }
  }

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. CABECERA PRINCIPAL CON SELECTOR DE 3 MODOS Y ACCIONES EJECUTIVAS      */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 shrink-0">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                San José · Campaña 2026 / 2027
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
                Parición de Invierno
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1">
              Calendario Sanitario, Reproductivo & Agrícola
            </h1>
            <p className="text-xs text-slate-600 mt-0.5 font-medium">
              Agenda unificada de protocolos sanitarios, eventos reproductivos, siembras y tareas de campo.
            </p>
          </div>
        </div>

        {/* CONTROLES: Toggle de Modo + Botones de Acción */}
        <div className="flex flex-wrap items-center gap-3">
          {/* TOGGLE SEGMENTADO DE 3 MODOS */}
          <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode('calendario')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'calendario'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Vista de cuadrícula mensual completa de Lunes a Domingo"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>📅 Calendario</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('tarjetas')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'tarjetas'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Vista de listado de tarjetas ejecutables"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>📋 Tarjetas</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('mixta')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'mixta'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Vista combinada: Calendario a la izquierda y tarjetas ejecutables del día a la derecha"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>◫ Mixta</span>
            </button>
          </div>

          {/* Botón Exportar PDF */}
          <button
            type="button"
            onClick={handleExportHojaMangaPDF}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shadow-xs active:scale-95"
            title="Exportar Hoja de Manga para imprimir y anotar en el corral"
          >
            <FileDown className="w-4 h-4 text-amber-600" />
            <span className="hidden sm:inline">Hoja de Manga</span>
            <span className="sm:hidden">Manga</span>
          </button>

          {/* Botón Nuevo Evento */}
          <button
            type="button"
            onClick={() => {
              setNewEvento((prev) => ({
                ...prev,
                fecha_programada: fechaOperacion || new Date().toISOString().slice(0, 10),
              }));
              setModalNewOpen(true);
            }}
            className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shadow-sm active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>+ Agendar</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. TARJETAS KPI EJECUTIVAS                                                */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* KPI 1: Sanitarios Totales */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
              Plan Sanitario Anual
            </span>
            <span className="text-xl sm:text-2xl font-black text-slate-900 mt-1 block">
              {stats.sanTotal}{' '}
              <span className="text-xs font-normal text-slate-600">protocolos</span>
            </span>
            <span className="text-[11px] text-emerald-700 font-bold mt-0.5 block">
              {stats.sanRealizados} cumplidos ({stats.sanTotal > 0 ? Math.round((stats.sanRealizados / stats.sanTotal) * 100) : 0}%)
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
            <Syringe className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2: Pendientes */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
              Pendientes Próximos
            </span>
            <span className="text-xl sm:text-2xl font-black text-amber-800 mt-1 block">
              {stats.sanPendientes}{' '}
              <span className="text-xs font-normal text-slate-600">hitos</span>
            </span>
            <span className="text-[11px] text-slate-600 mt-0.5 block">
              Noviembre en curso
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 3: Siembras Programadas */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
              Siembras & Labores
            </span>
            <span className="text-xl sm:text-2xl font-black text-sky-800 mt-1 block">
              {stats.siembrasCount}{' '}
              <span className="text-xs font-normal text-slate-600">lotes</span>
            </span>
            <span className="text-[11px] text-sky-700 font-semibold mt-0.5 block">
              Campaña agrícola
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
            <Sprout className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 4: Tareas de Campo */}
        <div
          onClick={() => setLayers({ sanidad: false, manejo: false, siembras: false, tareas: true, proveedores: false })}
          className="bg-white border border-slate-200/90 hover:border-purple-300 rounded-2xl p-4 shadow-sm flex items-center justify-between cursor-pointer transition group"
          title="Clic para filtrar solo Tareas Operativas en el calendario"
        >
          <div className="min-w-0 flex-1 pr-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
              Tareas Operativas
            </span>
            <span className="text-xl sm:text-2xl font-black text-purple-800 mt-1 block">
              {stats.tareasMesCount}{' '}
              <span className="text-xs font-normal text-slate-600">
                {stats.tareasMesCount === 1 ? 'tarea' : 'tareas'}
              </span>
            </span>
            <span className="text-[11px] text-purple-700 font-semibold mt-0.5 block truncate">
              {stats.tareasMesCount} en {MESES[currentMonth]} · {stats.tareasTotal} total
              {stats.tareasPendientesTotal > 0 ? ` (${stats.tareasPendientesTotal} pend.)` : ''}
            </span>
            {stats.otraTareaTarget && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentYear(stats.otraTareaTarget.year);
                  setCurrentMonth(stats.otraTareaTarget.month);
                  setSelectedDateStr(stats.otraTareaTarget.date);
                  setLayers({ sanidad: false, manejo: false, siembras: false, tareas: true, proveedores: false });
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 hover:text-purple-900 hover:underline mt-1 cursor-pointer transition"
                title={`Ir a ${stats.otraTareaTarget.mesNombre} ${stats.otraTareaTarget.year} (${stats.otraTareaTarget.titulo})`}
              >
                <span>
                  {stats.otraTareaTarget.isNext
                    ? `Ver en ${stats.otraTareaTarget.mesNombre} →`
                    : `Ver en ${stats.otraTareaTarget.mesNombre} ←`}
                </span>
              </button>
            )}
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700 shrink-0 group-hover:scale-105 transition">
            <CheckSquare className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BARRA UNIFICADA DE FILTROS Y CAPAS DEL CALENDARIO                        */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/90 rounded-2xl px-4 py-2.5 shadow-sm flex flex-wrap items-center gap-2 text-xs">
        {/* Botón rápido 'Todas' */}
        <button
          type="button"
          onClick={() =>
            setLayers({
              sanidad: true,
              manejo: true,
              siembras: true,
              tareas: true,
              proveedores: true,
            })
          }
          className={`px-3 py-1.5 rounded-xl font-black text-xs transition cursor-pointer shrink-0 border ${
            layers.sanidad && layers.manejo && layers.siembras && layers.tareas && layers.proveedores
              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
          }`}
          title="Activar todas las capas del calendario"
        >
          Todas
        </button>

        <div className="h-4 w-px bg-slate-200 shrink-0 hidden sm:block" />

        {/* 1. Capa Sanidad (Ámbar / Naranja) */}
        <button
          type="button"
          onClick={() => setLayers({ ...layers, sanidad: !layers.sanidad })}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border shrink-0 ${
            layers.sanidad
              ? 'bg-amber-50 text-amber-950 border-amber-300 shadow-xs'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
          }`}
          title="Sanidad (Vacunas / Antiparasitarios)"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              layers.sanidad ? 'bg-amber-500 shadow-xs' : 'bg-slate-400'
            }`}
          />
          <span className="font-extrabold">Sanidad</span>
          <span
            className={`text-[11px] font-normal hidden lg:inline ${
              layers.sanidad ? 'text-amber-900 font-semibold' : 'text-slate-500'
            }`}
          >
            (Vacunas / Antiparasitarios)
          </span>
        </button>

        {/* 2. Capa Manejo & Reproductivo (Esmeralda) */}
        <button
          type="button"
          onClick={() => setLayers({ ...layers, manejo: !layers.manejo })}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border shrink-0 ${
            layers.manejo
              ? 'bg-emerald-50 text-emerald-950 border-emerald-300 shadow-xs'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
          }`}
          title="Manejo Reproductivo (Entore / Tacto / Yerra)"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              layers.manejo ? 'bg-emerald-600 shadow-xs' : 'bg-slate-400'
            }`}
          />
          <span className="font-extrabold">Manejo & Reprod.</span>
          <span
            className={`text-[11px] font-normal hidden lg:inline ${
              layers.manejo ? 'text-emerald-900 font-semibold' : 'text-slate-500'
            }`}
          >
            (Entore / Tacto / Yerra)
          </span>
        </button>

        {/* 3. Capa Siembras & Labores (Cian / Azul) */}
        <button
          type="button"
          onClick={() => setLayers({ ...layers, siembras: !layers.siembras })}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border shrink-0 ${
            layers.siembras
              ? 'bg-sky-50 text-sky-950 border-sky-300 shadow-xs'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
          }`}
          title="Siembras y Labores Agrícolas"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              layers.siembras ? 'bg-sky-500 shadow-xs' : 'bg-slate-400'
            }`}
          />
          <span className="font-extrabold">Siembras & Labores</span>
        </button>

        {/* 4. Capa Tareas (Violeta) */}
        <button
          type="button"
          onClick={() => setLayers({ ...layers, tareas: !layers.tareas })}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border shrink-0 ${
            layers.tareas
              ? 'bg-purple-50 text-purple-950 border-purple-300 shadow-xs'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
          }`}
          title="Tareas Operativas de Campo"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              layers.tareas ? 'bg-purple-500 shadow-xs' : 'bg-slate-400'
            }`}
          />
          <span className="font-extrabold">Tareas</span>
        </button>

        {/* 5. Capa Proveedores (Naranja) */}
        <button
          type="button"
          onClick={() => setLayers({ ...layers, proveedores: !layers.proveedores })}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border shrink-0 ${
            layers.proveedores
              ? 'bg-orange-50 text-orange-950 border-orange-300 shadow-xs'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
          }`}
          title="Proveedores y Logística de Campo"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              layers.proveedores ? 'bg-orange-500 shadow-xs' : 'bg-slate-400'
            }`}
          />
          <span className="font-extrabold">Proveedores</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. VISTAS SEGÚN MODO: 'calendario' | 'tarjetas' | 'mixta'                 */}
      {/* ========================================================================= */}

      {/* MODO 1: 📅 CALENDARIO MENSUAL COMPLETO (Lunes a Domingo) */}
      {viewMode === 'calendario' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden space-y-4 p-4 sm:p-5">
          {/* Barra de Navegación del Mes */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition border border-slate-200"
                title="Mes Anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight min-w-[170px] text-center">
                {MESES[currentMonth]} {currentYear}
              </h2>

              <button
                type="button"
                onClick={handleNextMonth}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition border border-slate-200"
                title="Mes Siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleGoToday}
                className="ml-2 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold cursor-pointer transition"
              >
                Hoy
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle de sub-vista en pantallas móviles y tablets < 768px */}
              <div className="md:hidden flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setMobileCalendarSubView('agenda')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    mobileCalendarSubView === 'agenda'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📱 Agenda
                </button>
                <button
                  type="button"
                  onClick={() => setMobileCalendarSubView('grilla')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    mobileCalendarSubView === 'grilla'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📅 Grilla
                </button>
              </div>

              <div className="hidden md:flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">
                  {eventosMesActual.length}{' '}
                  {eventosMesActual.length === 1 ? 'evento en el mes' : 'eventos en el mes'}
                </span>
                <span>·</span>
                <span className="text-emerald-800 font-bold">
                  {eventosMesActual.filter((e) => e.realizado).length} realizados
                </span>
              </div>
            </div>
          </div>

          {/* VISTA MÓVIL (< 768px): AGENDA ORGANIZADA POR SEMANAS CON BANDAS DE PROVEEDORES E HITOS DIARIOS */}
          {mobileCalendarSubView === 'agenda' && (
            <div className="md:hidden space-y-4">
              {/* Selector horizontal de días del mes para navegación táctil rápida */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium px-1">
                  <span>Días de {MESES[currentMonth]}:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDateStr(null)}
                    className="text-emerald-800 font-bold hover:underline cursor-pointer"
                  >
                    Ver todo el mes ({eventosMesActual.length})
                  </button>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
                  {calendarCells
                    .filter((c) => c.isCurrentMonth)
                    .map((cell) => {
                      const isToday = cell.dateStr === hoyStr;
                      const isSelected = cell.dateStr === selectedDateStr;
                      const hasEvents = cell.events.length > 0;
                      const hasPending = cell.events.some((e) => !e.realizado);

                      const dayDate = new Date(`${cell.dateStr}T12:00:00`);
                      const dayOfWeek = DIAS_SEMANA_CORTOS[(dayDate.getDay() + 6) % 7];

                      return (
                        <button
                          key={cell.dateStr}
                          type="button"
                          onClick={() => setSelectedDateStr(cell.dateStr)}
                          className={`shrink-0 w-11 py-2 rounded-xl flex flex-col items-center justify-center transition border cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-600 text-white border-emerald-400 shadow-md scale-105'
                              : isToday
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-bold'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span className="text-[10px] font-semibold uppercase">{dayOfWeek}</span>
                          <span className="text-sm font-black">{cell.dayNumber}</span>
                          <div className="flex items-center gap-0.5 mt-0.5 h-1.5">
                            {hasEvents && (
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  hasPending ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                              />
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Contenido de la Agenda: Vista por Día Seleccionado o por Bloques Semanales */}
              {selectedDateStr ? (
                /* Detalle enfocado del día seleccionado */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Día enfocado</span>
                      <h3 className="text-sm font-black text-slate-900">
                        {formatFechaAR(selectedDateStr)}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedDateStr(null)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        Ver semanas
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenNewEventOnDate(selectedDateStr)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agendar</span>
                      </button>
                    </div>
                  </div>

                  {/* Proveedores de la semana del día seleccionado */}
                  {proveedoresSemanaSeleccionada.length > 0 && (
                    <div className="p-3 rounded-2xl bg-amber-50/90 border border-amber-200 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-950">
                        <Truck className="w-3.5 h-3.5 text-amber-800" />
                        <span>Proveedores esperados en esta semana ({proveedoresSemanaSeleccionada.length})</span>
                      </div>
                      <div className="space-y-2">
                        {proveedoresSemanaSeleccionada.map((prov) => (
                          <div
                            key={prov.id}
                            onClick={() => setModalEventDetail(prov)}
                            className="p-2.5 rounded-xl bg-white/95 border border-amber-300/80 shadow-xs space-y-1.5 cursor-pointer"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-black text-slate-900 block break-words">
                                  {prov.producto || prov.title}
                                </span>
                                <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                                  🗓️ {prov.labelRango}
                                </span>
                                {prov.observaciones && (
                                  <p className="text-[11px] text-slate-600 italic font-medium break-words mt-1">
                                    {prov.observaciones}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${
                                  prov.realizado
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                                }`}
                              >
                                {prov.realizado ? '✓ Recibido' : 'Esperando'}
                              </span>
                            </div>
                            <div className="pt-1.5 border-t border-amber-100 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleRealizado(prov);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                                  prov.realizado
                                    ? 'bg-slate-800 text-slate-300'
                                    : 'bg-emerald-600 text-white'
                                }`}
                              >
                                <Check className="w-3 h-3" />
                                <span>{prov.realizado ? 'Reabrir' : '✓ Marcar Recibido'}</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Eventos del día */}
                  {eventosDiaSeleccionado.length === 0 ? (
                    <div className="p-5 text-center rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                      <Calendar className="w-7 h-7 text-slate-400 mx-auto" />
                      <p className="text-xs text-slate-500 font-medium">
                        Sin labores ni eventos sanitarios puntuales para este día.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleOpenNewEventOnDate(selectedDateStr)}
                        className="mt-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agendar labor para el {formatFechaAR(selectedDateStr)}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {eventosDiaSeleccionado.map((ev) => (
                        <div
                          key={ev.id}
                          onClick={() => setModalEventDetail(ev)}
                          className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-xs space-y-2 cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${getPillClasses(
                                    ev.colorCategory,
                                    ev.realizado
                                  )}`}
                                >
                                  {ev.badge || ev.colorCategory}
                                </span>
                                <span className="text-xs font-black text-slate-900 break-words">
                                  {ev.title}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 font-medium mt-1 break-words">
                                {ev.rodeo} {ev.dosis ? `· ${ev.dosis}` : ''}
                              </p>
                              {ev.observaciones && (
                                <p className="text-[11px] text-slate-500 italic font-medium break-words mt-0.5">
                                  {ev.observaciones}
                                </p>
                              )}
                            </div>
                            <span
                              className={`text-[10px] font-bold shrink-0 ${
                                ev.realizado ? 'text-emerald-800' : 'text-amber-900'
                              }`}
                            >
                              {ev.realizado ? '✓ Hecho' : 'Pendiente'}
                            </span>
                          </div>
                          {ev.source === 'sanidad' && (
                            <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleRealizado(ev);
                                }}
                                className={`px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                                  ev.realizado
                                    ? 'bg-slate-800 text-slate-300'
                                    : 'bg-emerald-600 text-white'
                                }`}
                              >
                                <Check className="w-3 h-3" />
                                <span>{ev.realizado ? 'Reabrir' : '✓ Marcar Realizado'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Vista general mensual organizada por bloques semanales */
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Agenda por Semanas · {MESES[currentMonth]} {currentYear}
                    </h3>
                    <span className="text-[11px] text-slate-500 font-semibold">
                      {eventosMesActual.length} eventos
                    </span>
                  </div>

                  {mobileWeeklyBlocks.length === 0 ? (
                    <div className="p-6 text-center rounded-2xl bg-slate-50 border border-slate-200">
                      <p className="text-xs text-slate-500">No hay eventos en este mes con los filtros aplicados.</p>
                    </div>
                  ) : (
                    mobileWeeklyBlocks.map((block) => (
                      <div
                        key={block.id}
                        className={`rounded-2xl border p-3 sm:p-3.5 space-y-3 ${
                          block.isCurrentWeek
                            ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-400/50'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        {/* Cabecera del Bloque Semanal */}
                        <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🗓️</span>
                            <span
                              className={`text-xs font-black ${
                                block.isCurrentWeek ? 'text-emerald-950' : 'text-slate-800'
                              }`}
                            >
                              {block.labelSemana}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            {block.totalItems} {block.totalItems === 1 ? 'actividad' : 'actividades'}
                          </span>
                        </div>

                        {/* Bandas de Proveedores Esperados en esta semana */}
                        {block.weekProvs.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-[10px] font-extrabold uppercase text-amber-900 tracking-wide block">
                              🚚 Proveedores & Servicios de la semana
                            </span>
                            {block.weekProvs.map((prov) => (
                              <div
                                key={prov.id}
                                onClick={() => setModalEventDetail(prov)}
                                className="p-3 rounded-xl bg-amber-50/95 border border-amber-300 text-amber-950 shadow-xs space-y-2 cursor-pointer"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="px-1.5 py-0.2 rounded text-[9.5px] font-black bg-amber-200 text-amber-950 border border-amber-300">
                                        🚚 Proveedor
                                      </span>
                                      <span className="text-xs font-black text-amber-950 break-words">
                                        {prov.producto || prov.title}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-amber-900 font-bold mt-1">
                                      🗓️ {prov.labelRango}
                                    </p>
                                    {prov.observaciones && (
                                      <p className="text-[11px] text-amber-900/90 italic font-medium break-words mt-0.5">
                                        {prov.observaciones}
                                      </p>
                                    )}
                                  </div>
                                  <span
                                    className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${
                                      prov.realizado
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-amber-200 text-amber-900'
                                    }`}
                                  >
                                    {prov.realizado ? '✓ Recibido' : 'Esperando'}
                                  </span>
                                </div>
                                <div className="pt-2 border-t border-amber-200/80 flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleRealizado(prov);
                                    }}
                                    className={`px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                                      prov.realizado
                                        ? 'bg-slate-800 text-slate-300'
                                        : 'bg-emerald-600 text-white'
                                    }`}
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>{prov.realizado ? 'Reabrir' : '✓ Marcar Recibido'}</span>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Hitos y Labores diarias de esta semana */}
                        {block.daysWithEvents.length > 0 ? (
                          <div className="space-y-2.5">
                            {block.daysWithEvents.map((day) => (
                              <div key={day.dateStr} className="space-y-1.5 pl-2 border-l-2 border-emerald-500/40">
                                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDateStr(day.dateStr)}
                                    className="hover:underline text-left cursor-pointer"
                                  >
                                    {formatFechaAR(day.dateStr)}
                                  </button>
                                  {day.isToday && (
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase">
                                      Hoy
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-1.5">
                                  {day.events.map((ev) => (
                                    <div
                                      key={ev.id}
                                      onClick={() => setModalEventDetail(ev)}
                                      className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs cursor-pointer space-y-1.5"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span
                                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${getPillClasses(
                                                ev.colorCategory,
                                                ev.realizado
                                              )}`}
                                            >
                                              {ev.badge || ev.colorCategory}
                                            </span>
                                            <span className="text-xs font-black text-slate-900 break-words">
                                              {ev.title}
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-slate-600 font-medium mt-0.5 break-words">
                                            {ev.rodeo} {ev.dosis ? `· ${ev.dosis}` : ''}
                                          </p>
                                          {ev.observaciones && (
                                            <p className="text-[11px] text-slate-500 italic break-words mt-0.5">
                                              {ev.observaciones}
                                            </p>
                                          )}
                                        </div>
                                        <span
                                          className={`text-[10px] font-bold shrink-0 ${
                                            ev.realizado ? 'text-emerald-800' : 'text-amber-900'
                                          }`}
                                        >
                                          {ev.realizado ? '✓ Hecho' : 'Pendiente'}
                                        </span>
                                      </div>
                                      {ev.source === 'sanidad' && (
                                        <div className="pt-1.5 border-t border-slate-100 flex items-center justify-end">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleToggleRealizado(ev);
                                            }}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                                              ev.realizado
                                                ? 'bg-slate-800 text-slate-300'
                                                : 'bg-emerald-600 text-white'
                                            }`}
                                          >
                                            <Check className="w-3 h-3" />
                                            <span>{ev.realizado ? 'Reabrir' : '✓ Marcar Realizado'}</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : block.weekProvs.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic py-1 text-center">
                            Sin labores ni entregas agendadas en esta semana.
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* VISTA GRILLA: EN ESCRITORIO O CUANDO EN MÓVIL SE ELIJA 'grilla' */}
          <div className={`${mobileCalendarSubView === 'agenda' ? 'hidden md:block' : 'block'} space-y-4`}>
            {/* Grilla Semanal: Cabecera Lunes a Domingo */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-xs font-bold text-slate-600 uppercase tracking-wider py-1 border-b border-slate-200">
              {DIAS_SEMANA_COMPLETOS.map((d, i) => (
                <div key={d} className="py-1">
                  <span className="hidden md:inline">{d}</span>
                  <span className="md:hidden">{DIAS_SEMANA_CORTOS[i]}</span>
                </div>
              ))}
            </div>

            {/* Grilla Semanal por Filas: Permite dibujar franjas continuas de Proveedores por encima de las celdas */}
            <div className="space-y-2 sm:space-y-2.5">
              {calendarWeeks.map((week, wIdx) => {
                const weekStart = week[0].dateStr;
                const weekEnd = week[6].dateStr;
                const weekProvs = getProveedoresDeSemana(weekStart, weekEnd);

                return (
                  <div key={wIdx} className="space-y-1">
                    {/* Fila de 7 Celdas Diarias de la Semana con Cinta Superior Integrada para Proveedores */}
                    <div className="grid grid-cols-7 gap-1 sm:gap-2">
                      {week.map((cell, idx) => {
                        const isToday = cell.dateStr === hoyStr;
                        const isSelected = cell.dateStr === selectedDateStr;
                        const tieneProveedores = weekProvs.length > 0;

                        return (
                          <div
                            key={idx}
                            onClick={() => setSelectedDateStr(cell.dateStr)}
                            className={`min-h-[92px] sm:min-h-[115px] p-1.5 sm:p-2 rounded-xl border flex flex-col justify-between transition cursor-pointer relative group overflow-hidden ${
                              isSelected
                                ? 'border-emerald-600 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-500'
                                : cell.isCurrentMonth
                                ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                                : 'border-slate-100 bg-slate-50/70 opacity-70 text-slate-500 font-medium'
                            }`}
                          >
                            {/* Cinta superior sutil integrada dentro de las celdas de la semana si hay proveedores esperados */}
                            {tieneProveedores && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (weekProvs.length > 1) {
                                    setModalWeekProveedores({
                                      weekLabel: `${formatFechaAR(weekStart)} al ${formatFechaAR(weekEnd)}`,
                                      items: weekProvs,
                                    });
                                  } else {
                                    setModalEventDetail(weekProvs[0]);
                                  }
                                }}
                                className={`-mx-1.5 sm:-mx-2 -mt-1.5 sm:-mt-2 px-1.5 py-0.5 border-t-2 border-amber-400 bg-amber-50/80 hover:bg-amber-100 text-amber-950 font-bold mb-1 flex items-center justify-between text-[10px] sm:text-[10.5px] transition cursor-pointer truncate ${
                                  idx === 0 ? 'rounded-tl-lg' : idx === 6 ? 'rounded-tr-lg' : ''
                                }`}
                                title={
                                  weekProvs.length > 1
                                    ? `Semana con ${weekProvs.length} entregas/servicios: ${weekProvs.map((p) => p.producto || p.title).join(' · ')} (Clic para ver todos)`
                                    : `${weekProvs[0].producto || weekProvs[0].title} (${weekProvs[0].labelRango})`
                                }
                              >
                                {idx === 0 ? (
                                  <div className="flex items-center gap-1 min-w-0 truncate">
                                    <span className="shrink-0 text-[10px]">🚚</span>
                                    <span className="truncate font-black text-amber-900">
                                      {weekProvs[0].producto || weekProvs[0].title}
                                    </span>
                                    {weekProvs.length > 1 && (
                                      <span className="text-[9px] bg-amber-200 text-amber-900 font-extrabold px-1 rounded-full shrink-0 animate-pulse">
                                        +{weekProvs.length - 1}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="w-full flex items-center justify-center py-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80"></span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Encabezado del Día */}
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-black inline-flex items-center justify-center w-6 h-6 rounded-lg ${
                                  isToday
                                    ? 'bg-emerald-600 text-white font-black shadow-sm ring-2 ring-emerald-500/40'
                                    : isSelected
                                    ? 'bg-emerald-100 text-emerald-900 font-bold'
                                    : cell.isCurrentMonth
                                    ? 'text-slate-800 font-semibold'
                                    : 'text-slate-500 font-medium'
                                }`}
                              >
                                {cell.dayNumber}
                              </span>

                              {/* Botón rápido + para agendar en este día */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenNewEventOnDate(cell.dateStr);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-md bg-slate-100 hover:bg-emerald-800 text-slate-600 hover:text-white transition cursor-pointer"
                                title={`Agendar tratamiento o labor el ${cell.dateStr}`}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Pastillas de Eventos */}
                            <div className="space-y-1 mt-1 overflow-hidden">
                              {cell.events.slice(0, 3).map((ev) => (
                                <div
                                  key={ev.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModalEventDetail(ev);
                                  }}
                                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold truncate flex items-center justify-between cursor-pointer transition select-none ${getPillClasses(
                                    ev.colorCategory,
                                    ev.realizado
                                  )}`}
                                  title={`${ev.title} (${ev.rodeo}) · Clic para ver detalle`}
                                >
                                  <span className="truncate">{ev.title}</span>
                                  {ev.realizado && (
                                    <span className="text-[10px] font-black text-emerald-400 shrink-0 ml-1">✓</span>
                                  )}
                                </div>
                              ))}

                              {/* Badge +N más si hay más de 3 eventos */}
                              {cell.events.length > 3 && (
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDateStr(cell.dateStr);
                                    setViewMode('mixta');
                                  }}
                                  className="text-[9.5px] font-bold text-slate-400 hover:text-emerald-300 text-center py-0.2"
                                >
                                  +{cell.events.length - 3} más
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* TARJETA EXPANDIDA EN MÓVIL (< 768px): MUESTRA EL DÍA SELECCIONADO Y PROVEEDORES DE SU SEMANA */}
            <div className="md:hidden mt-4 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Día seleccionado</span>
                  <h4 className="text-sm font-black text-slate-900">
                    {formatFechaAR(selectedDateStr)}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenNewEventOnDate(selectedDateStr)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Agendar</span>
                </button>
              </div>

              {/* Proveedores de la semana en la que cae el día seleccionado */}
              {proveedoresSemanaSeleccionada.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50/90 border border-amber-200 space-y-2">
                  <span className="text-[11px] font-extrabold text-amber-950 flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5 text-amber-800" />
                    Proveedores / Servicios de esta semana ({proveedoresSemanaSeleccionada.length})
                  </span>
                  <div className="space-y-2">
                    {proveedoresSemanaSeleccionada.map((prov) => (
                      <div
                        key={prov.id}
                        onClick={() => setModalEventDetail(prov)}
                        className="p-2.5 rounded-xl bg-white border border-amber-300 shadow-xs space-y-1.5 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-black text-slate-900 block break-words">
                              {prov.producto || prov.title}
                            </span>
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                              🗓️ {prov.labelRango}
                            </span>
                            {prov.observaciones && (
                              <p className="text-[11px] text-slate-600 italic font-medium break-words mt-1">
                                {prov.observaciones}
                              </p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${
                              prov.realizado
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-amber-100 text-amber-900 border border-amber-300'
                            }`}
                          >
                            {prov.realizado ? '✓ Recibido' : 'Esperando'}
                          </span>
                        </div>
                        <div className="pt-1.5 border-t border-amber-100 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleRealizado(prov);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                              prov.realizado ? 'bg-slate-800 text-slate-300' : 'bg-emerald-600 text-white'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                            <span>{prov.realizado ? 'Reabrir' : '✓ Marcar Recibido'}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Eventos del día seleccionado */}
              {(eventsByDate[selectedDateStr] || []).length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2 text-center">
                  Sin labores agendadas en esta fecha. Tocá "+ Agendar" para cargar una labor o tratamiento.
                </p>
              ) : (
                <div className="space-y-2">
                  {(eventsByDate[selectedDateStr] || []).map((ev) => (
                    <div
                      key={ev.id}
                      onClick={() => setModalEventDetail(ev)}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 shadow-xs cursor-pointer space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${getPillClasses(
                                ev.colorCategory,
                                ev.realizado
                              )}`}
                            >
                              {ev.badge || ev.colorCategory}
                            </span>
                            <span className="text-xs font-black text-slate-900 break-words">
                              {ev.title}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-medium mt-0.5 break-words">
                            {ev.rodeo} {ev.dosis ? `· ${ev.dosis}` : ''}
                          </p>
                          {ev.observaciones && (
                            <p className="text-[11px] text-slate-500 italic break-words mt-0.5">
                              {ev.observaciones}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-bold shrink-0 ${
                            ev.realizado ? 'text-emerald-800' : 'text-amber-900'
                          }`}
                        >
                          {ev.realizado ? '✓ Hecho' : 'Pendiente'}
                        </span>
                      </div>
                      {ev.source === 'sanidad' && (
                        <div className="pt-1.5 border-t border-slate-200 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleRealizado(ev);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                              ev.realizado ? 'bg-slate-800 text-slate-300' : 'bg-emerald-600 text-white'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                            <span>{ev.realizado ? 'Reabrir' : '✓ Marcar Realizado'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODO 2: 📋 TARJETAS EJECUTABLES CON FILTROS Y EXPORTACIÓN */}
      {viewMode === 'tarjetas' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden p-5 sm:p-6 space-y-5">
          {/* Barra de Filtros y Buscador */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro Estado */}
              <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterEstado('TODOS')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filterEstado === 'TODOS'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todos ({allAgendaEvents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEstado('PENDIENTES')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filterEstado === 'PENDIENTES'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pendientes ({allAgendaEvents.filter((e) => !e.realizado).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEstado('REALIZADOS')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filterEstado === 'REALIZADOS'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Realizados ({allAgendaEvents.filter((e) => e.realizado).length})
                </button>
              </div>

              {/* Filtro Tipo */}
              <select
                value={filterTipo}
                onChange={(e) => setFilterTipo(e.target.value)}
                className="bg-white border border-slate-200 text-slate-800 text-xs font-bold px-3 py-1.5 rounded-xl focus:outline-none focus:border-emerald-600 cursor-pointer"
              >
                <option value="TODOS">Todos los Protocolos Sanitarios</option>
                {TIPOS_EVENTO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Buscador */}
            <div className="relative w-full md:w-72">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar vacuna, rodeo, lote..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 transition"
              />
            </div>
          </div>

          {/* Listado de Tarjetas Grandes */}
          {eventosFiltradosList.length === 0 ? (
            <div className="p-12 text-center text-slate-500 italic">
              No hay protocolos ni eventos registrados para los filtros seleccionados.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {eventosFiltradosList.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition flex flex-col justify-between gap-3 shadow-sm ${
                    item.realizado
                      ? 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                      : 'bg-white border-slate-200/90 hover:border-emerald-600/50'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                          item.colorCategory === 'amber'
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : item.colorCategory === 'emerald'
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            : item.colorCategory === 'cyan'
                            ? 'bg-sky-100 text-sky-900 border-sky-300'
                            : item.colorCategory === 'orange'
                            ? 'bg-orange-100 text-orange-900 border-orange-300'
                            : 'bg-purple-100 text-purple-900 border-purple-300'
                        }`}
                      >
                        {item.badge || item.tipo}
                      </span>

                      <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatFechaAR(item.date)}</span>
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-baseline gap-2">
                      <span>{item.title}</span>
                      {item.realizado && (
                        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.2 rounded border border-emerald-500/30">
                          ✓ Realizado
                        </span>
                      )}
                    </h3>

                    {item.producto && (
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                        <span className="font-semibold text-slate-300">Producto / Dosis:</span>
                        <span>
                          {item.producto} {item.dosis ? `(${item.dosis})` : ''}
                        </span>
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-400">
                      {item.rodeo && (
                        <span className="flex items-center gap-1 text-slate-300 font-medium">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span>{item.rodeo}</span>
                        </span>
                      )}
                      {item.categoria && (
                        <span>
                          <strong className="text-slate-400">Categoría:</strong> {item.categoria}
                        </span>
                      )}
                    </div>

                    {item.observaciones && (
                      <p className="text-[11px] text-slate-500 italic mt-2 border-t border-slate-800/80 pt-2 line-clamp-2">
                        {item.observaciones}
                      </p>
                    )}
                  </div>

                  {/* Acciones de la Tarjeta */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setModalEventDetail(item)}
                      className="text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition"
                    >
                      Ver detalle / editar
                    </button>

                    {item.source === 'sanidad' && (
                      <button
                        type="button"
                        onClick={() => handleToggleRealizado(item)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                          item.realizado
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                            : 'bg-emerald-800 hover:bg-emerald-700 text-white shadow-xs'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{item.realizado ? 'Reabrir como Pendiente' : '✓ Marcar Realizado'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODO 3: ◫ MIXTA (Calendario a la izquierda + Tarjetas ejecutables a la derecha) */}
      {viewMode === 'mixta' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Columna Izquierda: Calendario Mensual */}
          <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <h2 className="text-base font-black text-slate-900">
                  {MESES[currentMonth]} {currentYear}
                </h2>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleGoToday}
                className="px-2.5 py-1 rounded-xl bg-emerald-600/20 text-emerald-300 text-xs font-bold border border-emerald-500/40"
              >
                Hoy
              </button>
            </div>

            {/* Días semana */}
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-600 py-1 border-b border-slate-200">
              {DIAS_SEMANA_CORTOS.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            {/* Grilla compacta */}
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((cell, idx) => {
                const isToday = cell.dateStr === hoyStr;
                const isSelected = cell.dateStr === selectedDateStr;

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDateStr(cell.dateStr)}
                    className={`min-h-[70px] sm:min-h-[82px] p-1 rounded-lg border flex flex-col justify-between transition cursor-pointer ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-950/30'
                        : cell.isCurrentMonth
                        ? 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700'
                        : 'border-slate-900 bg-slate-950/20 opacity-40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-md ${
                          isToday
                            ? 'bg-emerald-500 text-slate-950 font-black'
                            : isSelected
                            ? 'bg-emerald-600/30 text-emerald-300'
                            : 'text-slate-300'
                        }`}
                      >
                        {cell.dayNumber}
                      </span>
                    </div>

                    <div className="space-y-0.5 mt-0.5 overflow-hidden">
                      {cell.events.slice(0, 2).map((ev) => (
                        <div
                          key={ev.id}
                          className={`px-1 py-0.2 rounded text-[9px] font-bold truncate flex items-center justify-between ${getPillClasses(
                            ev.colorCategory,
                            ev.realizado
                          )}`}
                        >
                          <span className="truncate">{ev.title}</span>
                          {ev.realizado && <span>✓</span>}
                        </div>
                      ))}
                      {cell.events.length > 2 && (
                        <span className="text-[8.5px] font-bold text-slate-400 block text-center">
                          +{cell.events.length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Columna Derecha: Tarjetas del Día Seleccionado */}
          <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl shadow-sm p-4 sm:p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Agenda del Día
                  </span>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                    <span>{formatFechaAR(selectedDateStr)}</span>
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenNewEventOnDate(selectedDateStr)}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Agregar</span>
                </button>
              </div>

              {/* Lista de eventos del día */}
              <div className="mt-4 space-y-3 max-h-[580px] overflow-y-auto pr-1">
                {eventosDiaSeleccionado.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                    <CalendarDays className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-400">
                      No hay eventos agendados para el día {formatFechaAR(selectedDateStr)}.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleOpenNewEventOnDate(selectedDateStr)}
                      className="text-xs font-bold text-emerald-400 hover:underline cursor-pointer"
                    >
                      + Agendar tratamiento o labor en esta fecha
                    </button>
                  </div>
                ) : (
                  eventosDiaSeleccionado.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-xl border transition space-y-2.5 shadow-sm ${
                        item.realizado
                          ? 'bg-slate-50/70 border-slate-200'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded border ${
                            item.colorCategory === 'amber'
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : item.colorCategory === 'emerald'
                              ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              : item.colorCategory === 'cyan'
                              ? 'bg-sky-100 text-sky-900 border-sky-300'
                              : item.colorCategory === 'orange'
                              ? 'bg-orange-100 text-orange-900 border-orange-300'
                              : 'bg-purple-100 text-purple-900 border-purple-300'
                          }`}
                        >
                          {item.badge || item.tipo}
                        </span>

                        {item.realizado && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.2 rounded border border-emerald-500/30">
                            ✓ Realizado
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 tracking-tight">{item.title}</h4>

                      {item.producto && (
                        <div className="text-xs text-slate-400">
                          <strong className="text-slate-300 font-semibold">Producto:</strong>{' '}
                          {item.producto} {item.dosis ? `(${item.dosis})` : ''}
                        </div>
                      )}

                      {item.rodeo && (
                        <div className="text-xs text-slate-400 flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-slate-500" />
                          <span>{item.rodeo}</span>
                        </div>
                      )}

                      {item.source === 'sanidad' && (
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setModalEventDetail(item)}
                            className="text-xs font-semibold text-slate-400 hover:text-white"
                          >
                            Detalle
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleRealizado(item)}
                            className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition ${
                              item.realizado
                                ? 'bg-slate-800 text-slate-300'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{item.realizado ? 'Reabrir' : '✓ Realizado'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Resumen del mes inferior */}
            <div className="pt-3 border-t border-slate-800 text-xs text-slate-500 flex items-center justify-between">
              <span>{MESES[currentMonth]} {currentYear}</span>
              <span>{eventosMesActual.length} eventos en total</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: DETALLE Y EJECUCIÓN DE PROTOCOLO SANITARIO                       */}
      {/* ========================================================================= */}
      {modalEventDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                    modalEventDetail.colorCategory === 'amber'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : modalEventDetail.colorCategory === 'orange'
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : modalEventDetail.colorCategory === 'emerald'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : modalEventDetail.colorCategory === 'cyan'
                      ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                      : 'bg-purple-50 text-purple-800 border-purple-200'
                  }`}
                >
                  {modalEventDetail.badge || modalEventDetail.tipo}
                </span>
                <span className="text-xs font-mono font-bold text-slate-500">
                  {formatFechaAR(modalEventDetail.date)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalEventDetail(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-lg font-black text-slate-900">{modalEventDetail.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{modalEventDetail.mes_epoca}</p>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
              {modalEventDetail.source === 'siembra' ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Cultivo / Especie:</span>
                    <span className="font-bold text-cyan-800 text-right">
                      {modalEventDetail.raw?.cultivo_variedad || modalEventDetail.producto || 'Pastura / Verdeleo'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Campaña:</span>
                    <span className="font-mono text-slate-800 font-bold">
                      {modalEventDetail.raw?.campana || modalEventDetail.dosis || '2026/2027'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Superficie (ha):</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {(Number(modalEventDetail.raw?.ha_sembradas || modalEventDetail.raw?.hectareas) || 0).toFixed(1)} ha
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Potrero:</span>
                    <span className="font-bold text-emerald-800">
                      {modalEventDetail.raw?.potrero_numero ? `Potrero #${modalEventDetail.raw.potrero_numero}` : (modalEventDetail.rodeo || 'General')}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 items-center">
                    <span className="text-slate-500">Estado Actual:</span>
                    <span className={`font-bold ${modalEventDetail.realizado ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {modalEventDetail.raw?.estado || (modalEventDetail.realizado ? '✓ Cumplido / Sembrado' : 'Pendiente')}
                    </span>
                  </div>
                </>
              ) : modalEventDetail.source === 'tarea' ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Prioridad:</span>
                    <span className={`font-extrabold px-2 py-0.5 rounded text-[10px] ${
                      (modalEventDetail.raw?.prioridad === 'Urgente' || modalEventDetail.raw?.prioridad === 'Alta')
                        ? 'bg-rose-50 text-rose-800 border border-rose-200'
                        : 'bg-purple-50 text-purple-800 border border-purple-200'
                    }`}>
                      {modalEventDetail.raw?.prioridad || 'Media'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Infraestructura / Ubicación:</span>
                    <span className="font-semibold text-slate-800 text-right">
                      {modalEventDetail.raw?.infraestructura_nombre
                        ? `${modalEventDetail.raw.infraestructura_nombre}${modalEventDetail.raw.potrero_numero ? ` (P#${modalEventDetail.raw.potrero_numero})` : ''}`
                        : modalEventDetail.raw?.potrero_numero
                        ? `Potrero #${modalEventDetail.raw.potrero_numero}`
                        : 'San José (General)'}
                    </span>
                  </div>
                  {modalEventDetail.raw?.responsable && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Responsable / Asignado:</span>
                      <span className="font-medium text-slate-700">{modalEventDetail.raw.responsable}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2 items-center">
                    <span className="text-slate-500">Estado Actual:</span>
                    <span className={`font-bold ${modalEventDetail.realizado ? 'text-emerald-700' : 'text-purple-700'}`}>
                      {modalEventDetail.raw?.estado || (modalEventDetail.realizado ? '✓ Tarea Completada' : 'Pendiente de ejecución')}
                    </span>
                  </div>
                </>
              ) : modalEventDetail.source === 'proveedor' ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Proveedor / Servicio:</span>
                    <span className="font-bold text-amber-800 text-right">
                      {modalEventDetail.raw?.proveedor_o_rubro || modalEventDetail.producto || modalEventDetail.title}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">
                      {modalEventDetail.esSemanaORango ? 'Semana / Rango:' : 'Fecha Estimada:'}
                    </span>
                    <span className="font-mono text-slate-800 font-bold">
                      {modalEventDetail.labelRango || formatFechaAR(modalEventDetail.date)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Estado Actual:</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                        modalEventDetail.raw?.estado === 'Recibido' || modalEventDetail.realizado
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : modalEventDetail.raw?.estado === 'En Camino'
                          ? 'bg-cyan-50 text-cyan-800 border border-cyan-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {modalEventDetail.realizado ? '✓ Recibido en Establecimiento' : modalEventDetail.raw?.estado || 'Esperando'}
                    </span>
                  </div>
                  {modalEventDetail.raw?.indicaciones && (
                    <div className="flex justify-between items-start gap-2 border-t border-slate-200 pt-2">
                      <span className="text-slate-500 shrink-0">Indicaciones:</span>
                      <span className="font-semibold text-slate-800 text-right">
                        {modalEventDetail.raw.indicaciones}
                      </span>
                    </div>
                  )}
                  {modalEventDetail.raw?.notas && (
                    <div className="flex justify-between items-start gap-2 border-t border-slate-200 pt-2">
                      <span className="text-slate-500 shrink-0">Notas:</span>
                      <span className="text-slate-700 text-right italic">
                        {modalEventDetail.raw.notas}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {modalEventDetail.producto && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Tratamiento / Producto:</span>
                      <span className="font-bold text-slate-900 text-right">{modalEventDetail.producto}</span>
                    </div>
                  )}
                  {modalEventDetail.dosis && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Dosis / Vía:</span>
                      <span className="font-mono text-amber-800 font-bold">{modalEventDetail.dosis}</span>
                    </div>
                  )}
                  {modalEventDetail.categoria && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Categoría Destino:</span>
                      <span className="font-semibold text-slate-800">{modalEventDetail.categoria}</span>
                    </div>
                  )}
                  {modalEventDetail.rodeo && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Rodeo Aplicado:</span>
                      <span className="font-bold text-emerald-800">{modalEventDetail.rodeo}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2 items-center">
                    <span className="text-slate-500">Estado Actual:</span>
                    <span className={`font-bold ${modalEventDetail.realizado ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {modalEventDetail.realizado ? '✓ Realizado / Cumplido' : 'Pendiente de aplicación'}
                    </span>
                  </div>
                </>
              )}
            </div>

            {modalEventDetail.observaciones && (
              <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <strong className="text-slate-800 block mb-1">Notas técnicas / Observaciones:</strong>
                <p className="italic">{modalEventDetail.observaciones}</p>
              </div>
            )}

            {/* BOTÓN OFICIAL: AGENDAR EN GOOGLE CALENDAR / CALENDARIO DEL CELULAR */}
            <div className="pt-1">
              <a
                href={buildGoogleCalendarUrl({
                  title: `San José · ${modalEventDetail.title || 'Evento'}`,
                  fecha: modalEventDetail.date,
                  details: `Protocolo/Labor: ${modalEventDetail.title || ''}\nCategoría/Rodeo: ${modalEventDetail.categoria || modalEventDetail.rodeo || ''}\nProducto/Dosis: ${modalEventDetail.producto || ''} ${modalEventDetail.dosis || ''}\nIndicaciones: ${modalEventDetail.raw?.indicaciones || modalEventDetail.observaciones || ''}\nEstablecimiento San José · Agroganadera Rincón del Sur S.A.`,
                  location: 'Establecimiento San José, Las Flores, Pcia. de Buenos Aires',
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-slate-50 text-sky-700 border border-slate-300 font-bold text-xs flex items-center justify-center gap-2 transition shadow-2xs"
                title="Agendar en el calendario de Google en celular o PC con recordatorio"
              >
                <span>📅 Agendar en mi Calendar</span>
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
              {modalEventDetail.source === 'siembra' ? (
                <div className="flex flex-wrap items-center justify-between w-full gap-2">
                  <span className="text-[11px] text-cyan-800 font-medium flex items-center gap-1">
                    <Sprout className="w-3.5 h-3.5" /> Sincronizado desde Siembras
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const sId = modalEventDetail.originalId;
                      const pNum = modalEventDetail.raw?.potrero_numero;
                      setModalEventDetail(null);
                      onNavigate?.('siembras', {
                        siembraId: sId,
                        potreroNumero: pNum,
                        action: 'edit',
                      });
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                  >
                    <Sprout className="w-4 h-4" />
                    <span>Abrir en Siembras →</span>
                  </button>
                </div>
              ) : modalEventDetail.source === 'tarea' ? (
                <div className="flex flex-wrap items-center justify-between w-full gap-2">
                  <span className="text-[11px] text-purple-800 font-medium flex items-center gap-1">
                    <ClipboardList className="w-3.5 h-3.5" /> Sincronizado desde Tareas
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const tId = modalEventDetail.originalId;
                      setModalEventDetail(null);
                      onNavigate?.('tareas', {
                        tareaId: tId,
                        action: 'edit',
                      });
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                  >
                    <ClipboardList className="w-4 h-4" />
                    <span>Abrir en Tareas →</span>
                  </button>
                </div>
              ) : modalEventDetail.source === 'proveedor' ? (
                <div className="flex flex-wrap items-center justify-between w-full gap-2">
                  <span className="text-[11px] text-amber-800 font-medium flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5" /> Proveedor & Logística
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleRealizado(modalEventDetail)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer ${
                        modalEventDetail.realizado
                          ? 'bg-white hover:bg-slate-50 text-amber-800 border border-slate-300'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      <span>{modalEventDetail.realizado ? 'Reabrir como Pendiente' : '✓ Marcar Recibido'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModalEventDetail(null);
                        onNavigate?.('insumos', { subTab: 'proveedores_esperados' });
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                    >
                      <Truck className="w-4 h-4" />
                      <span>Ver en Insumos →</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between w-full gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEvento(modalEventDetail.raw);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Editar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteEvento(modalEventDetail)}
                      className="p-1.5 rounded-xl bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 cursor-pointer transition shadow-2xs"
                      title="Eliminar protocolo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {(modalEventDetail.categoryGroup === 'manejo' ||
                      modalEventDetail.tipo?.toLowerCase().includes('reproductivo') ||
                      modalEventDetail.raw?.rodeo_aplicado) && (
                      <button
                        type="button"
                        onClick={() => {
                          const rName = modalEventDetail.raw?.rodeo_aplicado;
                          setModalEventDetail(null);
                          onNavigate?.('rodeos', {
                            rodeoNombre: rName,
                            action: 'reproductivo',
                          });
                        }}
                        className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        title="Ver ficha reproductiva del rodeo"
                      >
                        <Tags className="w-3.5 h-3.5" />
                        <span>Abrir en Rodeos →</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleRealizado(modalEventDetail)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer ${
                      modalEventDetail.realizado
                        ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {modalEventDetail.realizado ? 'Reabrir como Pendiente' : '✓ Marcar Realizado'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1.B: LISTA UNIFICADA DE PROVEEDORES / SERVICIOS DE LA SEMANA        */}
      {/* ========================================================================= */}
      {modalWeekProveedores && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setModalWeekProveedores(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <span>Proveedores y Servicios de la Semana</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-mono font-bold">
                      {modalWeekProveedores.items?.length || 0}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Semana del {modalWeekProveedores.weekLabel}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalWeekProveedores(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Listado scrolleable de proveedores */}
            <div className="space-y-3 overflow-y-auto pr-1 flex-1">
              {(modalWeekProveedores.items || []).map((prov) => {
                const isRecibido = prov.realizado || prov.raw?.estado === 'Recibido';

                return (
                  <div
                    key={prov.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-amber-400 transition space-y-3 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                            <span className="text-base">🚚</span>
                            <span>{prov.raw?.proveedor_o_rubro || prov.producto || prov.title}</span>
                          </h4>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10.5px] font-black border ${
                              isRecibido
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : prov.raw?.estado === 'En Camino'
                                ? 'bg-cyan-50 text-cyan-800 border-cyan-300'
                                : 'bg-amber-50 text-amber-800 border-amber-300'
                            }`}
                          >
                            {isRecibido ? '✓ Recibido en Campo' : prov.raw?.estado || 'Esperando'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium mt-1">
                          📅 {prov.labelRango || formatFechaAR(prov.date)}
                        </div>
                      </div>
                    </div>

                    {/* Indicaciones y Notas */}
                    {(prov.raw?.indicaciones || prov.raw?.notas) && (
                      <div className="text-xs bg-white p-2.5 rounded-lg border border-slate-200 space-y-1 shadow-2xs">
                        {prov.raw?.indicaciones && (
                          <div>
                            <span className="text-slate-500 font-bold">Indicaciones: </span>
                            <span className="text-slate-800">{prov.raw.indicaciones}</span>
                          </div>
                        )}
                        {prov.raw?.notas && (
                          <div>
                            <span className="text-slate-500 font-bold">Notas: </span>
                            <span className="text-slate-700 italic">{prov.raw.notas}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Botones de acción individual por proveedor */}
                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleToggleRealizado(prov)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm ${
                          isRecibido
                            ? 'bg-white hover:bg-slate-50 text-amber-800 border border-slate-300'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isRecibido ? 'Reabrir como Pendiente' : '✓ Marcar Recibido'}</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setModalWeekProveedores(null);
                            setModalEventDetail(prov);
                          }}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition cursor-pointer shadow-2xs"
                        >
                          Ver Detalle
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalWeekProveedores(null);
                            onNavigate?.('insumos', { subTab: 'proveedores_esperados' });
                          }}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1 transition cursor-pointer shadow-sm"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>Ver en Insumos →</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Podés gestionar insumos y acopios desde la solapa Insumos.
              </span>
              <button
                type="button"
                onClick={() => setModalWeekProveedores(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition cursor-pointer shadow-2xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: FORMULARIO NUEVO PROTOCOLO SANITARIO                             */}
      {/* ========================================================================= */}
      {modalNewOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateEvento}
            className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 text-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
                  <Syringe className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Agendar Nuevo Protocolo Sanitario</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalNewOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Tipo de Evento
                </label>
                <select
                  value={newEvento.tipo}
                  onChange={(e) => setNewEvento({ ...newEvento, tipo: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                >
                  {TIPOS_EVENTO.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Fecha Programada *
                </label>
                <input
                  type="date"
                  required
                  value={newEvento.fecha_programada}
                  onChange={(e) => setNewEvento({ ...newEvento, fecha_programada: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Nombre del Protocolo / Vacuna / Manejo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Aftosa 2da Campaña / Refuerzo Clostridial..."
                  value={newEvento.nombre_protocolo}
                  onChange={(e) => setNewEvento({ ...newEvento, nombre_protocolo: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Producto Comercial
                </label>
                <input
                  type="text"
                  placeholder="Ej: Biostar / Rotatec / Suplenut"
                  value={newEvento.producto_sugerido}
                  onChange={(e) => setNewEvento({ ...newEvento, producto_sugerido: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Dosis y Vía de Aplicación
                </label>
                <input
                  type="text"
                  placeholder="Ej: 5 ml SC / 2 ml IM"
                  value={newEvento.dosis_via}
                  onChange={(e) => setNewEvento({ ...newEvento, dosis_via: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Categoría Destino
                </label>
                <input
                  type="text"
                  placeholder="Ej: Terneros al pie / Vientres"
                  value={newEvento.categoria_destino}
                  onChange={(e) => setNewEvento({ ...newEvento, categoria_destino: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Rodeo a Aplicar
                </label>
                <input
                  type="text"
                  list="rodeos-list-modal"
                  placeholder="Todos los rodeos de cría"
                  value={newEvento.rodeo_aplicado}
                  onChange={(e) => setNewEvento({ ...newEvento, rodeo_aplicado: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
                <datalist id="rodeos-list-modal">
                  <option value="Todos los rodeos de cría" />
                  {rodeos.map((r) => (
                    <option key={r.id} value={r.nombre} />
                  ))}
                </datalist>
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Observaciones / Instrucciones de Manga
                </label>
                <textarea
                  rows={2}
                  placeholder="Instrucciones para la cuadrilla, jeringas, cadena de frío..."
                  value={newEvento.observaciones}
                  onChange={(e) => setNewEvento({ ...newEvento, observaciones: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setModalNewOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer transition shadow-2xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-700/20 flex items-center gap-1.5 cursor-pointer transition"
              >
                <Check className="w-4 h-4" />
                <span>Agendar Protocolo</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: EDICIÓN COMPLETA DE PROTOCOLO EXISTENTE                         */}
      {/* ========================================================================= */}
      {editingEvento && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditEvento}
            className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 text-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Editar Protocolo Sanitario</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingEvento(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Tipo</label>
                <select
                  value={editingEvento.tipo}
                  onChange={(e) => setEditingEvento({ ...editingEvento, tipo: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                >
                  {TIPOS_EVENTO.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Fecha</label>
                <input
                  type="date"
                  value={editingEvento.fecha_programada || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, fecha_programada: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Nombre del Protocolo
                </label>
                <input
                  type="text"
                  required
                  value={editingEvento.nombre_protocolo || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, nombre_protocolo: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Producto Comercial
                </label>
                <input
                  type="text"
                  value={editingEvento.producto_sugerido || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, producto_sugerido: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Dosis y Vía
                </label>
                <input
                  type="text"
                  value={editingEvento.dosis_via || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, dosis_via: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Categoría Destino
                </label>
                <input
                  type="text"
                  value={editingEvento.categoria_destino || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, categoria_destino: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Rodeo Aplicado
                </label>
                <input
                  type="text"
                  value={editingEvento.rodeo_aplicado || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, rodeo_aplicado: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Observaciones
                </label>
                <textarea
                  rows={2}
                  value={editingEvento.observaciones || ''}
                  onChange={(e) =>
                    setEditingEvento({ ...editingEvento, observaciones: e.target.value })
                  }
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingEvento(null)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer transition shadow-2xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-700/20 flex items-center gap-1.5 cursor-pointer transition"
              >
                <Check className="w-4 h-4" />
                <span>Guardar Cambios</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
