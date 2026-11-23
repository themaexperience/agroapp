import React, { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import {
  BookOpen,
  FileDown,
  Plus,
  Calendar,
  ArrowRightLeft,
  TrendingDown,
  Sprout,
  Syringe,
  ClipboardCheck,
  StickyNote,
  Search,
  Trash2,
  Sparkles,
  MapPin,
  Printer,
  Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import { calcResumenRodeosOficial } from './RodeosCaravanasView.jsx';
import { calcPermanenciaPotrero } from '../utils/pdfHelper';
import GeminiLiquidacionModal from './GeminiLiquidacionModal';
import { APRENDIZAJES_FUNDACIONALES_SAN_JOSE } from '../data/aprendizajesFundacionales.js';
import { confirmAction } from './ConfirmDialog.jsx';

const MESES_NOMBRES = [
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

const CATEGORIAS_NOTA_MANUAL = [
  'Recorrida General',
  'Lluvia / Clima',
  'Hacienda / Parición',
  'Aguadas / Molinos',
  'Alambrados / Caminos',
  'Novedad Operativa',
];

function formatPotreroCode(num) {
  if (num == null || num === '') return '';
  if (Number(num) === 2) return 'Potrero 2/3';
  if (Number(num) === 38) return 'Potrero NN';
  return `Potrero #${num}`;
}

function formatMonthLabel(yyyyMm) {
  if (!yyyyMm || yyyyMm === 'TODOS') return 'Todos los Períodos';
  const [y, m] = yyyyMm.split('-');
  const mIdx = parseInt(m, 10) - 1;
  return `${MESES_NOMBRES[mIdx] || m} ${y}`;
}

export default function BitacoraMovimientosView({
  movimientosHacienda = [],
  laboresSiembras = [],
  eventosSanitarios = [],
  tareas = [],
  bitacoraNotas = [],
  rodeos = [],
  potreros = [],
  fechaOperacion,
  onSelectPotreroInMap,
  onNavigate,
  onRefresh,
  notify,
}) {
  const currentMonthStr = (fechaOperacion || new Date().toISOString().slice(0, 10)).slice(
    0,
    7
  ); // 'YYYY-MM'
  const [selectedMonth, setSelectedMonth] = useState('TODOS');
  const [filterTipo, setFilterTipo] = useState('TODOS');
  const [searchText, setSearchText] = useState('');
  const [showNewNotaForm, setShowNewNotaForm] = useState(false);
  const [showVentaModal, setShowVentaModal] = useState(false);
  const [showAprendizajesBox, setShowAprendizajesBox] = useState(false);
  const [aprendizajesList, setAprendizajesList] = useState(APRENDIZAJES_FUNDACIONALES_SAN_JOSE);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState(null);

  // Cargar aprendizajes de campo (Supabase + fundacionales)
  useEffect(() => {
    supabase
      .from('aprendizajes_campo')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          const titlesSupabase = new Set(data.map((d) => d.titulo));
          const complementarios = APRENDIZAJES_FUNDACIONALES_SAN_JOSE.filter(
            (f) => !titlesSupabase.has(f.titulo)
          );
          setAprendizajesList([...data, ...complementarios]);
        }
      })
      .catch(() => {});
  }, []);

  // Resumen narrativo editable (estructura lista para Gemini IA)
  const [resumenNarrativo, setResumenNarrativo] = useState('');

  useEffect(() => {
    let active = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!active) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 256;
        canvas.height = img.naturalHeight || 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setLogoDataUrl(canvas.toDataURL('image/png'));
      } catch {
        // ignore canvas error
      }
    };
    img.src = '/logo-san-jose.png';
    return () => {
      active = false;
    };
  }, []);

  const [newNota, setNewNota] = useState({
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    categoria: 'Recorrida General',
    titulo: '',
    potrero_numero: '',
    rodeo_nombre: '',
    descripcion: '',
  });

  useEffect(() => {
    if (fechaOperacion) {
      setNewNota((prev) => ({ ...prev, fecha: fechaOperacion }));
    }
  }, [fechaOperacion]);

  // Unificar todos los eventos del campo en una sola línea de tiempo cronológica
  const unifiedEvents = useMemo(() => {
    const list = [];

    // 1. Movimientos de Rodeos y Salidas/Bajas desde movimientos_hacienda
    movimientosHacienda.forEach((m) => {
      const isTraslado = m.tipo_movimiento === 'Cambio de Potrero';
      const origTxt = m.potrero_origen ? formatPotreroCode(m.potrero_origen) : 'Sin potrero';
      const destTxt = m.potrero_destino ? formatPotreroCode(m.potrero_destino) : 'Sin potrero';

      list.push({
        uid: `mov-${m.id}`,
        fecha: m.fecha || '2026-10-30',
        grupo: isTraslado ? 'ROTACION_RODEO' : 'SALIDA_BAJA',
        categoriaBadge: isTraslado ? 'Movimiento de Rodeo' : m.tipo_movimiento || 'Salida / Baja',
        titulo: isTraslado
          ? `Rodeo "${m.rodeo_nombre}" trasladado (${origTxt} → ${destTxt})`
          : `${m.tipo_movimiento}: Rodeo "${m.rodeo_nombre}" (-${m.cantidad_cabezas || 0} ${
              m.categoria_afectada || 'cab.'
            })`,
        subtitulo: `Cabezas involucradas: ${m.cantidad_cabezas || 0} cab. · Categoría: ${
          m.categoria_afectada || 'General'
        }`,
        descripcion: m.motivo_observaciones || '',
        potrero_numero: m.potrero_destino || m.potrero_origen || null,
        rodeo_nombre: m.rodeo_nombre || null,
        impacto: `${m.cantidad_cabezas || 0} cab.`,
      });
    });

    // 2. Siembras y Labores Agrícolas desde labores_siembras
    laboresSiembras.forEach((l) => {
      const s = Number(l.costo_semilla) || 0;
      const fe = Number(l.costo_fertilizante) || 0;
      const fu = Number(l.costo_fumigacion) || 0;
      const mo = Number(l.costo_mano_obra) || 0;
      const tot = Number(l.costo_total) || s + fe + fu + mo;
      const ha = Number(l.hectareas) || 0;

      list.push({
        uid: `lab-${l.id}`,
        fecha: l.fecha || '2026-10-30',
        grupo: 'SIEMBRA_LABOR',
        categoriaBadge: 'Siembra / Labor Agrícola',
        titulo: `${l.tarea || 'Labor'}: ${l.cultivo_variedad || 'Pastura'} (${ha} ha)`,
        subtitulo: `${
          l.potreros_detalle || (l.potrero_numero ? formatPotreroCode(l.potrero_numero) : 'Gral.')
        }${l.insumos_detalle ? ` · Insumos: ${l.insumos_detalle}` : ''}`,
        descripcion: l.observaciones || '',
        potrero_numero: l.potrero_numero || null,
        rodeo_nombre: null,
        impacto:
          tot > 0
            ? `${ha} ha · $${tot.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
            : `${ha} ha`,
      });
    });

    // 3. Eventos Sanitarios realizados desde eventos_sanitarios
    eventosSanitarios
      .filter((e) => e.realizado)
      .forEach((e) => {
        list.push({
          uid: `san-${e.id}`,
          fecha: e.fecha_realizada || e.fecha_programada || '2026-10-30',
          grupo: 'SANIDAD_TAREA',
          categoriaBadge: 'Sanidad / Manejo Realizado',
          titulo: `${e.nombre_protocolo} (${e.producto_sugerido || e.tipo})`,
          subtitulo: `Categoría: ${e.categoria_destino || 'General'} · Rodeo: ${
            e.rodeo_aplicado || 'Todos'
          }`,
          descripcion: e.observaciones || '',
          potrero_numero: null,
          rodeo_nombre: e.rodeo_aplicado || null,
          impacto: 'Realizado',
        });
      });

    // 4. Tareas de campo completadas desde tareas_campo
    tareas
      .filter((t) => t.completada)
      .forEach((t) => {
        list.push({
          uid: `tar-${t.id}`,
          fecha: t.fecha_completada || t.fecha_limite || '2026-10-30',
          grupo: 'SANIDAD_TAREA',
          categoriaBadge: `Tarea Completada (${t.categoria || 'Campo'})`,
          titulo: t.titulo,
          subtitulo: `${
            t.potrero_numero ? formatPotreroCode(t.potrero_numero) : 'General'
          }${t.infraestructura_nombre ? ` · ${t.infraestructura_nombre}` : ''}`,
          descripcion: t.observaciones || '',
          potrero_numero: t.potrero_numero || null,
          rodeo_nombre: null,
          impacto: 'Completada',
        });
      });

    // 5. Notas Operativas Manuales desde bitacora_notas
    bitacoraNotas.forEach((n) => {
      list.push({
        uid: `not-${n.id}`,
        rawNotaId: n.id,
        fecha: n.fecha || '2026-11-14',
        grupo: 'NOTA_MANUAL',
        categoriaBadge: n.categoria || 'Nota Operativa',
        titulo: n.titulo,
        subtitulo: [
          n.potrero_numero ? formatPotreroCode(n.potrero_numero) : null,
          n.rodeo_nombre ? `Rodeo: ${n.rodeo_nombre}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        descripcion: n.descripcion || '',
        potrero_numero: n.potrero_numero || null,
        rodeo_nombre: n.rodeo_nombre || null,
        impacto: n.categoria || 'Nota',
      });
    });

    return list.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [movimientosHacienda, laboresSiembras, eventosSanitarios, tareas, bitacoraNotas]);

  // Lista de meses disponibles para el selector Mes / Año
  const availableMonths = useMemo(() => {
    const set = new Set([currentMonthStr, '2026-11', '2026-10']);
    unifiedEvents.forEach((ev) => {
      if (ev.fecha && ev.fecha.length >= 7) {
        set.add(ev.fecha.slice(0, 7));
      }
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [unifiedEvents, currentMonthStr]);

  // Filtrado por Mes/Año, Tipo y Búsqueda
  const filteredEvents = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return unifiedEvents.filter((ev) => {
      if (selectedMonth !== 'TODOS' && !String(ev.fecha).startsWith(selectedMonth)) {
        return false;
      }
      if (filterTipo !== 'TODOS' && ev.grupo !== filterTipo) {
        return false;
      }
      if (q) {
        const hay = `${ev.titulo} ${ev.subtitulo} ${ev.descripcion} ${ev.categoriaBadge}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [unifiedEvents, selectedMonth, filterTipo, searchText]);

  // Estadísticas del período filtrado
  const statsPeriodo = useMemo(() => {
    const rotaciones = filteredEvents.filter((e) => e.grupo === 'ROTACION_RODEO').length;
    const salidas = filteredEvents.filter((e) => e.grupo === 'SALIDA_BAJA').length;
    const labores = filteredEvents.filter((e) => e.grupo === 'SIEMBRA_LABOR').length;
    const notasYSanidad = filteredEvents.filter(
      (e) => e.grupo === 'NOTA_MANUAL' || e.grupo === 'SANIDAD_TAREA'
    ).length;

    const totalCabezasActual = calcResumenRodeosOficial(rodeos).total;

    return {
      totalEventos: filteredEvents.length,
      rotaciones,
      salidas,
      labores,
      notasYSanidad,
      totalCabezasActual,
    };
  }, [filteredEvents, rodeos]);

  // Generar borrador automático de Síntesis Ejecutiva (estructura lista para Gemini IA)
  function handleGenerarSintesisAutomatica() {
    const periodoTxt = formatMonthLabel(selectedMonth);
    const texto = `SÍNTESIS OPERATIVA (${periodoTxt.toUpperCase()}): En el Establecimiento San José (2.068 ha, Las Flores) se mantiene un stock activo de ${statsPeriodo.totalCabezasActual.toLocaleString(
      'es-AR'
    )} cabezas distribuidas en ${
      rodeos.length
    } rodeos. Durante el período seleccionado se registraron ${
      statsPeriodo.rotaciones
    } cambios de potrero/rotaciones de hacienda, ${
      statsPeriodo.salidas
    } movimientos de salida o baja, ${
      statsPeriodo.labores
    } labores agrícolas/siembras y ${
      statsPeriodo.notasYSanidad
    } eventos sanitarios o notas operativas de campo.`;
    setResumenNarrativo(texto);
    notify('Síntesis ejecutiva del período generada y lista para incluir en el PDF.', 'success');
  }

  async function handleAddNotaManual(e) {
    e.preventDefault();
    if (!newNota.titulo.trim()) {
      notify('Ingresá un título corto para la nota de bitácora.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        fecha: newNota.fecha || new Date().toISOString().slice(0, 10),
        categoria: newNota.categoria,
        titulo: newNota.titulo.trim(),
        potrero_numero: newNota.potrero_numero
          ? parseInt(newNota.potrero_numero, 10)
          : null,
        rodeo_nombre: newNota.rodeo_nombre || null,
        descripcion: newNota.descripcion.trim() || null,
      };

      const { error } = await supabase.from('bitacora_notas').insert(payload);
      if (error) throw error;

      notify('Nota registrada en la Bitácora del campo.', 'success');
      setNewNota({
        fecha: new Date().toISOString().slice(0, 10),
        categoria: 'Recorrida General',
        titulo: '',
        potrero_numero: '',
        rodeo_nombre: '',
        descripcion: '',
      });
      setShowNewNotaForm(false);
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar nota: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteNotaManual(id) {
    const ok = await confirmAction({
      title: '¿Eliminar nota de la bitácora?',
      description: 'Esta observación de campo será removida del registro histórico.',
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('bitacora_notas').delete().eq('id', id);
      if (error) throw error;
      notify('Nota eliminada de la bitácora.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error al eliminar nota: ${err.message}`, 'error');
    }
  }

  // Exportar Informe Mensual prolijo en PDF usando jsPDF
  function handleExportPDF() {
    setExportingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 14;
      let y = 16;

      // Encabezado Institucional Verde Bosque con Logo Oficial
      doc.setFillColor(6, 78, 59); // #064e3b
      doc.rect(0, 0, pageWidth, 32, 'F');

      let textLeftX = margin;
      if (logoDataUrl) {
        try {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(margin, 4.5, 23, 23, 2.5, 2.5, 'F');
          doc.addImage(logoDataUrl, 'PNG', margin + 1.5, 6, 20, 20);
          textLeftX = margin + 27;
        } catch {
          textLeftX = margin;
        }
      }

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13.5);
      doc.text('AGROGANADERA RINCON DEL SUR S.A.', textLeftX, 12);

      doc.setFontSize(10.5);
      doc.setTextColor(167, 243, 208);
      doc.text(
        'ESTABLECIMIENTO SAN JOSE — Las Flores, Pcia. de Buenos Aires (2.068 ha)',
        textLeftX,
        19
      );

      const periodoLabel = formatMonthLabel(selectedMonth);
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text(
        `INFORME DE BITACORA, MOVIMIENTOS Y LABORES · Periodo: ${periodoLabel}`,
        textLeftX,
        26
      );

      const fechaEmision = new Date().toLocaleDateString('es-AR');
      doc.text(`Emision: ${fechaEmision}`, pageWidth - margin, 12, { align: 'right' });

      y = 40;

      // Bloque de KPIs Resumen del Período
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, y, pageWidth - margin * 2, 20, 2, 2, 'FD');

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Stock Activo: ${statsPeriodo.totalCabezasActual} cab. (${rodeos.length} rodeos)`, margin + 4, y + 7);
      doc.text(`Rotaciones de Potrero: ${statsPeriodo.rotaciones}`, margin + 72, y + 7);
      doc.text(`Salidas / Bajas: ${statsPeriodo.salidas}`, margin + 132, y + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`Siembras y Labores: ${statsPeriodo.labores}`, margin + 4, y + 14);
      doc.text(`Sanidad, Tareas y Notas: ${statsPeriodo.notasYSanidad}`, margin + 72, y + 14);
      doc.text(`Total Registros en Informe: ${statsPeriodo.totalEventos}`, margin + 132, y + 14);

      y += 26;

      // Síntesis Narrativa (si está cargada o generada)
      const narrativoFinal =
        resumenNarrativo.trim() ||
        `Informe operativo correspondiente a ${periodoLabel}. Stock actual en campo: ${statsPeriodo.totalCabezasActual} cabezas en ${rodeos.length} rodeos sobre 34 potreros GIS (2.068 ha).`;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(6, 78, 59);
      doc.text('1. SINTESIS EJECUTIVA DEL PERIODO', margin, y);
      y += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      const splitNarrativo = doc.splitTextToSize(narrativoFinal, pageWidth - margin * 2);
      doc.text(splitNarrativo, margin, y);
      y += splitNarrativo.length * 4.5 + 4;

      // Resumen actual de Rodeos
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(6, 78, 59);
      doc.text('2. ESTADO ACTUAL DE RODEOS EN CAMPO', margin, y);
      y += 4;

      // Encabezado tabla de rodeos
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y, pageWidth - margin * 2, 6.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7.5);
      doc.text('RODEO', margin + 2, y + 4.5);
      doc.text('POTRERO', margin + 52, y + 4.5);
      doc.text('VACAS', margin + 88, y + 4.5);
      doc.text('TERNEROS (M/H)', margin + 108, y + 4.5);
      doc.text('VAQ. REP.', margin + 142, y + 4.5);
      doc.text('TOROS', margin + 162, y + 4.5);
      doc.text('TOTAL', pageWidth - margin - 2, y + 4.5, { align: 'right' });
      y += 6.5;

      rodeos.forEach((r, idx) => {
        if (y > pageHeight - 22) {
          doc.addPage();
          y = 18;
        }
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, pageWidth - margin * 2, 5.5, 'F');
        }
        const tot =
          (parseInt(r.vacas, 10) || 0) +
          (parseInt(r.terneros, 10) || 0) +
          (parseInt(r.toros_padres, 10) || 0) +
          (parseInt(r.toritos, 10) || 0) +
          (parseInt(r.vacas_cut, 10) || 0) +
          (parseInt(r.vaquillonas_reposicion, 10) || 0);

        const m = parseInt(r.terneros_machos, 10) || 0;
        const h = parseInt(r.terneros_hembras, 10) || 0;
        const ternStr =
          m + h > 0 ? `${r.terneros || 0} (${m}M/${h}H)` : String(r.terneros || 0);

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(r.nombre || '').slice(0, 26), margin + 2, y + 4);

        doc.setFont('helvetica', 'normal');
        doc.text(
          r.potrero_numero ? formatPotreroCode(r.potrero_numero) : 'Sin potrero',
          margin + 52,
          y + 4
        );
        doc.text(String((r.vacas || 0) + (r.vacas_cut || 0)), margin + 88, y + 4);
        doc.text(ternStr, margin + 108, y + 4);
        doc.text(String(r.vaquillonas_reposicion || 0), margin + 142, y + 4);
        doc.text(String((r.toros_padres || 0) + (r.toritos || 0)), margin + 162, y + 4);

        doc.setFont('helvetica', 'bold');
        doc.text(`${tot} cab.`, pageWidth - margin - 2, y + 4, { align: 'right' });
        y += 5.5;
      });

      y += 7;

      // 3. Tabla Cronológica de Movimientos, Labores y Eventos
      if (y > pageHeight - 35) {
        doc.addPage();
        y = 18;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(6, 78, 59);
      doc.text(
        `3. DETALLE CRONOLOGICO DE MOVIMIENTOS Y LABORES (${filteredEvents.length} registros)`,
        margin,
        y
      );
      y += 4;

      doc.setFillColor(6, 78, 59);
      doc.rect(margin, y, pageWidth - margin * 2, 6.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7.5);
      doc.text('FECHA', margin + 2, y + 4.5);
      doc.text('CATEGORIA', margin + 24, y + 4.5);
      doc.text('DETALLE DEL MOVIMIENTO / LABOR / NOVEDAD', margin + 66, y + 4.5);
      doc.text('IMPACTO', pageWidth - margin - 2, y + 4.5, { align: 'right' });
      y += 6.5;

      if (filteredEvents.length === 0) {
        doc.setTextColor(100, 116, 139);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.text(
          'No hay movimientos ni labores registradas para el filtro seleccionado.',
          margin + 2,
          y + 6
        );
      } else {
        filteredEvents.forEach((ev, idx) => {
          const fullDetail = [ev.titulo, ev.subtitulo, ev.descripcion]
            .filter(Boolean)
            .join(' — ');
          const lines = doc.splitTextToSize(fullDetail, 92);
          const rowH = Math.max(6.5, lines.length * 4 + 2);

          if (y + rowH > pageHeight - 16) {
            doc.addPage();
            y = 18;
          }

          if (idx % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, y, pageWidth - margin * 2, rowH, 'F');
          }

          doc.setTextColor(15, 23, 42);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.text(String(ev.fecha || '-'), margin + 2, y + 4.2);

          doc.setTextColor(6, 78, 59);
          doc.text(String(ev.categoriaBadge || '').slice(0, 23), margin + 24, y + 4.2);

          doc.setTextColor(30, 41, 59);
          doc.setFont('helvetica', 'normal');
          doc.text(lines, margin + 66, y + 4.2);

          doc.setFont('helvetica', 'bold');
          doc.text(String(ev.impacto || '-'), pageWidth - margin - 2, y + 4.2, {
            align: 'right',
          });

          y += rowH;
        });
      }

      // Numeración de páginas al pie
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Establecimiento San Jose (Las Flores, Bs. As.) — Pagina ${i} de ${pageCount}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: 'center' }
        );
      }

      const fileSuffix = selectedMonth === 'TODOS' ? 'Historico_Completo' : selectedMonth;
      doc.save(`Informe_Mensual_San_Jose_${fileSuffix}.pdf`);
      notify(`¡Informe PDF descargado! (Informe_Mensual_San_Jose_${fileSuffix}.pdf)`, 'success');
    } catch (err) {
      console.error('Error generando PDF:', err);
      notify(`Error al generar el PDF: ${err.message}`, 'error');
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Encabezado Ejecutivo de la Bitácora + Botón Exportar Informe Mensual (PDF) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <img
              src="/logo-san-jose.png"
              alt="Establecimiento San José"
              className="w-12 h-12 rounded-2xl bg-white p-1 border border-slate-200 object-contain shadow-sm shrink-0"
            />
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200 text-[11px] font-bold mb-1">
                Agroganadera Rincón del Sur S.A. · Establecimiento San José
              </div>
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                Bitácora Unificada de Movimientos, Labores y Novedades
              </h2>
              <p className="text-xs text-slate-500">
                Línea de tiempo cronológica de traslados de rodeos, salidas/bajas, siembras,
                sanidad y notas operativas con exportación directa a PDF.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowVentaModal(true)}
              className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 hover:from-emerald-900 hover:to-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition border border-emerald-500/30"
              title="Cargar liquidación de venta de hacienda con Gemini IA"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Cargar Venta de Hacienda (IA)
            </button>

            <button
              type="button"
              onClick={() => setShowAprendizajesBox(!showAprendizajesBox)}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-extrabold flex items-center gap-1.5 transition"
              title="Ver aprendizajes y protocolos fundacionales de la Cuenca del Salado"
            >
              <BookOpen className="w-4 h-4 text-emerald-700" />
              {showAprendizajesBox ? 'Cerrar Sabiduría IA' : `Sabiduría & Aprendizajes (${aprendizajesList.length})`}
            </button>

            <button
              type="button"
              onClick={() => setShowNewNotaForm(!showNewNotaForm)}
              className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4 text-emerald-800" />
              {showNewNotaForm ? 'Cerrar Nota' : '+ Nota en Bitácora'}
            </button>

            <button
              type="button"
              disabled={exportingPdf}
              onClick={handleExportPDF}
              className="px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center gap-2 shadow-sm transition"
            >
              <FileDown className="w-4 h-4 text-emerald-300" />
              {exportingPdf ? 'Generando PDF...' : 'Exportar Informe Mensual (PDF)'}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="p-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 text-xs font-bold transition"
              title="Imprimir vista actual"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Sabiduría y Aprendizajes de Campo (Cuenca del Salado / San José) */}
      {showAprendizajesBox && (
        <div className="bg-white rounded-2xl border-2 border-emerald-600 p-5 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧠</span>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Sabiduría y Protocolos de Manejo Ganadero · Cuenca del Salado
                </h3>
                <p className="text-xs text-slate-500">
                  Aprendizajes fundacionales y registros aprendidos por el Copiloto IA en recorridas
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAprendizajesBox(false)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              ✕ Cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {aprendizajesList.map((a) => (
              <div
                key={a.id || a.titulo}
                className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between hover:border-emerald-300 transition"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-black uppercase text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      {a.tipo || 'Manejo'}
                    </span>
                    <span className="text-[10px] font-bold text-slate-600">{a.autor || 'Técnico'}</span>
                  </div>
                  <h4 className="text-xs font-extrabold text-slate-900 mb-1">{a.titulo}</h4>
                  <p className="text-[11px] text-slate-600 leading-snug">{a.aprendizaje}</p>
                </div>
                {a.entidad_id && (
                  <div className="mt-2 pt-2 border-t border-slate-200/80 text-[10px] text-slate-600 font-semibold">
                    Ámbito: {a.entidad_id}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulario Desplegable para Cargar Nota Operativa Manual en Bitácora */}
      {showNewNotaForm && (
        <form
          onSubmit={handleAddNotaManual}
          className="bg-emerald-50/80 rounded-2xl border-2 border-emerald-600 p-5 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-emerald-950 flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-emerald-800" />
              Registrar Novedad / Nota Operativa Manual en la Bitácora
            </h3>
            <span className="text-[11px] text-emerald-800 font-semibold">
              Se incluye automáticamente en la línea de tiempo y en el PDF mensual
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Fecha *
              </label>
              <input
                type="date"
                required
                value={newNota.fecha}
                onChange={(e) => setNewNota({ ...newNota, fecha: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Categoría *
              </label>
              <select
                value={newNota.categoria}
                onChange={(e) => setNewNota({ ...newNota, categoria: e.target.value })}
                className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
              >
                {CATEGORIAS_NOTA_MANUAL.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Título / Evento *
              </label>
              <input
                type="text"
                required
                placeholder="Ej: Lluvia 38 mm / Revisación bebida Lote 16 / Nacimiento mellizos"
                value={newNota.titulo}
                onChange={(e) => setNewNota({ ...newNota, titulo: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Potrero (opc.)
              </label>
              <select
                value={newNota.potrero_numero}
                onChange={(e) =>
                  setNewNota({ ...newNota, potrero_numero: e.target.value })
                }
                className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-xs"
              >
                <option value="">General</option>
                {potreros.map((p) => (
                  <option key={p.numero} value={p.numero}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Rodeo (opc.)
              </label>
              <select
                value={newNota.rodeo_nombre}
                onChange={(e) =>
                  setNewNota({ ...newNota, rodeo_nombre: e.target.value })
                }
                className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-xs"
              >
                <option value="">Ninguno</option>
                {rodeos.map((r) => (
                  <option key={r.id} value={r.nombre}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            <div className="lg:col-span-9">
              <input
                type="text"
                placeholder="Detalle u observaciones adicionales (opcional)..."
                value={newNota.descripcion}
                onChange={(e) =>
                  setNewNota({ ...newNota, descripcion: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs"
              />
            </div>
            <div className="lg:col-span-3">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold shadow-sm transition"
              >
                {saving ? 'Guardando...' : 'Guardar en Bitácora'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Tarjetas de Resumen del Período Seleccionado */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Rotaciones de Rodeos
          </div>
          <div className="text-2xl font-extrabold text-sky-900 mt-1">
            {statsPeriodo.rotaciones}
          </div>
          <div className="text-xs text-slate-600 font-medium mt-0.5">Cambios de potrero registrados</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Salidas / Bajas
          </div>
          <div className="text-2xl font-extrabold text-red-800 mt-1">
            {statsPeriodo.salidas}
          </div>
          <div className="text-xs text-slate-600 font-medium mt-0.5">Ventas, traslados o mortandad</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Siembras & Laboreos
          </div>
          <div className="text-2xl font-extrabold text-emerald-900 mt-1">
            {statsPeriodo.labores}
          </div>
          <div className="text-xs text-slate-600 font-medium mt-0.5">Trabajos agrícolas terminados</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Sanidad, Tareas y Notas
          </div>
          <div className="text-2xl font-extrabold text-amber-800 mt-1">
            {statsPeriodo.notasYSanidad}
          </div>
          <div className="text-xs text-slate-600 font-medium mt-0.5">Eventos operativos asentados</div>
        </div>
      </div>

      {/* Bloque de Síntesis Narrativa del Mes (Preparado para Gemini IA y Exportación PDF) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-extrabold text-slate-900">
              Síntesis Ejecutiva para el Informe Mensual PDF ({formatMonthLabel(selectedMonth)})
            </h3>
          </div>
          <button
            type="button"
            onClick={handleGenerarSintesisAutomatica}
            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-extrabold flex items-center gap-1.5 transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
            Autocompletar Resumen del Mes
          </button>
        </div>
        <textarea
          rows={2}
          placeholder="Escribí o autocompletá acá el resumen ejecutivo del mes que saldrá impreso en la portada del Informe PDF (estructura lista para conectar con resumen narrativo Gemini)..."
          value={resumenNarrativo}
          onChange={(e) => setResumenNarrativo(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 bg-slate-50/60 focus:bg-white outline-none"
        />
      </div>

      {/* Control de Días de Permanencia en Potrero y Alerta de Rotación */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-800" />
            <h3 className="text-sm font-extrabold text-slate-900">
              Permanencia Actual en Potrero & Semáforo de Rotación de Rodeos
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-500">
            Calculado contra Fecha Operativa: <strong>{fechaOperacion}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {rodeos
            .filter((r) => r.potrero_numero != null)
            .map((r) => {
              const perm = calcPermanenciaPotrero(r, fechaOperacion);
              const badgeCls =
                perm.semaforo === 'ROJO'
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : perm.semaforo === 'AMBAR'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-950';
              const dotCls =
                perm.semaforo === 'ROJO'
                  ? 'bg-red-600'
                  : perm.semaforo === 'AMBAR'
                  ? 'bg-amber-500'
                  : 'bg-emerald-600';
              return (
                <div
                  key={r.id}
                  onClick={() => onSelectPotreroInMap?.(Number(r.potrero_numero))}
                  className={`p-3 rounded-xl border cursor-pointer hover:shadow-xs transition flex items-center justify-between gap-2 ${badgeCls}`}
                >
                  <div>
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${dotCls}`} />
                      <span>{r.nombre}</span>
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      {formatPotreroCode(r.potrero_numero)} · Ingresó {perm.fechaIngreso || '30/10'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black">Lleva {perm.dias} d</div>
                    <div className="text-[10px] opacity-75">meta {perm.meta} d</div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Controles de Filtro por Mes / Año, Categoría y Búsqueda + Línea de Tiempo */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pb-4 border-b border-slate-100">
          <div className="md:col-span-3">
            <label className="block text-xs font-extrabold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-800" />
              Filtrar por Mes / Año
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-emerald-600 bg-emerald-50/20 text-xs font-extrabold text-slate-900"
            >
              <option value="TODOS">Todos los períodos ({unifiedEvents.length})</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Tipo de Movimiento o Registro
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'TODOS', label: 'Todos' },
                { id: 'ROTACION_RODEO', label: 'Rotaciones' },
                { id: 'SALIDA_BAJA', label: 'Salidas / Bajas' },
                { id: 'SIEMBRA_LABOR', label: 'Siembras' },
                { id: 'NOTA_MANUAL', label: 'Notas' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTipo(tab.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-extrabold border transition ${
                    filterTipo === tab.id
                      ? 'bg-emerald-900 text-white border-emerald-950'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Buscar por rodeo, potrero o palabra clave
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Ej: CABEZA, Potrero 5, Festuca..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Línea de Tiempo Cronológica */}
        {filteredEvents.length === 0 ? (
          <div className="py-12 text-center space-y-2 border border-dashed border-slate-200 rounded-2xl">
            <div className="text-sm font-extrabold text-slate-700">
              No hay eventos registrados para este filtro ({formatMonthLabel(selectedMonth)}).
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Cada vez que muevas un rodeo de potrero, registres una salida/baja, cargues una
              siembra o agregues una nota con el botón "+ Nota en Bitácora", aparecerá ordenado
              cronológicamente acá.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map((ev) => {
              let iconBox = 'bg-sky-100 text-sky-800 border-sky-200';
              let badgeStyle = 'bg-sky-100 text-sky-900 border-sky-300';
              let IconComp = ArrowRightLeft;

              if (ev.grupo === 'SALIDA_BAJA') {
                iconBox = 'bg-red-100 text-red-800 border-red-200';
                badgeStyle = 'bg-red-100 text-red-900 border-red-300';
                IconComp = TrendingDown;
              } else if (ev.grupo === 'SIEMBRA_LABOR') {
                iconBox = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                badgeStyle = 'bg-emerald-100 text-emerald-900 border-emerald-300';
                IconComp = Sprout;
              } else if (ev.grupo === 'SANIDAD_TAREA') {
                iconBox = 'bg-purple-100 text-purple-800 border-purple-200';
                badgeStyle = 'bg-purple-100 text-purple-900 border-purple-300';
                IconComp = ev.uid.startsWith('san-') ? Syringe : ClipboardCheck;
              } else if (ev.grupo === 'NOTA_MANUAL') {
                iconBox = 'bg-amber-100 text-amber-800 border-amber-200';
                badgeStyle = 'bg-amber-100 text-amber-900 border-amber-300';
                IconComp = StickyNote;
              }

              return (
                <div
                  key={ev.uid}
                  className="p-4 rounded-2xl bg-slate-50/80 hover:bg-white border border-slate-200/90 transition flex flex-wrap sm:flex-nowrap items-start justify-between gap-4 shadow-sm"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className={`p-2.5 rounded-xl border shrink-0 ${iconBox}`}>
                      <IconComp className="w-5 h-5" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                          {formatFechaAR(ev.fecha)}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${badgeStyle}`}
                        >
                          {ev.categoriaBadge}
                        </span>
                      </div>

                      <div className="text-sm font-extrabold text-slate-900">
                        {ev.titulo}
                      </div>

                      {ev.subtitulo && (
                        <div className="text-xs font-semibold text-slate-600">
                          {ev.subtitulo}
                        </div>
                      )}

                      {ev.descripcion && (
                        <div className="text-xs text-slate-500 bg-white/80 px-2.5 py-1.5 rounded-lg border border-slate-200/70">
                          {ev.descripcion}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-center">
                    <span className="px-3 py-1 rounded-xl bg-white border border-slate-200 text-xs font-extrabold text-slate-900">
                      {ev.impacto}
                    </span>

                    {ev.potrero_numero && (
                      <button
                        type="button"
                        onClick={() => onSelectPotreroInMap(Number(ev.potrero_numero))}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        title="Ver potrero en el Mapa Vivo"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        Mapa
                      </button>
                    )}

                    {onNavigate && ev.grupo === 'SIEMBRA_LABOR' && (
                      <button
                        type="button"
                        onClick={() => onNavigate('siembras', { potreroNumero: ev.potrero_numero })}
                        className="px-2.5 py-1.5 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-900 border border-cyan-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        title="Abrir en Siembras"
                      >
                        <Sprout className="w-3.5 h-3.5" />
                        Siembras →
                      </button>
                    )}

                    {onNavigate && ev.grupo === 'ROTACION_RODEO' && (
                      <button
                        type="button"
                        onClick={() => onNavigate('rodeos', { potreroNumero: ev.potrero_numero, rodeoNombre: ev.rodeoNombre || ev.titulo })}
                        className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        title="Abrir en Rodeos"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        Rodeos →
                      </button>
                    )}

                    {onNavigate && ev.grupo === 'SANIDAD_TAREA' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (ev.uid?.startsWith('san-')) {
                            onNavigate('calendario');
                          } else {
                            onNavigate('tareas');
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        title="Abrir en Tareas / Calendario"
                      >
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        {ev.uid?.startsWith('san-') ? 'Sanidad →' : 'Tareas →'}
                      </button>
                    )}

                    {ev.rawNotaId && (
                      <button
                        type="button"
                        onClick={() => handleDeleteNotaManual(ev.rawNotaId)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600"
                        title="Eliminar nota manual"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showVentaModal && (
        <GeminiLiquidacionModal
          isOpen={true}
          onClose={() => setShowVentaModal(false)}
          rodeos={rodeos}
          fechaOperacion={fechaOperacion}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
    </div>
  );
}
