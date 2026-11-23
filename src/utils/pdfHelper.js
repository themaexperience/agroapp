// Helper compartido para las 5 Hojas de Trabajo e Informes PDF de Establecimiento San José
import { jsPDF } from 'jspdf';
import { formatFechaAR } from './dateHelper.js';
import {
  safeStr,
  sanitizePdfText,
  drawCorporateHeader,
  drawKpiCards,
  drawStandardTable,
  addPageNumbersAndFooters,
} from '../lib/pdfReportBuilder.js';
import {
  isPdfFile,
  slicePdfToImages,
  runWithControlledConcurrency,
  convertPdfPageToImage,
} from '../lib/pdfSlicer.js';

export {
  safeStr,
  isPdfFile,
  slicePdfToImages,
  runWithControlledConcurrency,
  convertPdfPageToImage,
  sanitizePdfText,
  drawCorporateHeader,
  drawKpiCards,
  drawStandardTable,
  addPageNumbersAndFooters,
};

let cachedLogoDataUrl = null;
let loadingPromise = null;

export function getSanJoseLogoDataUrl() {
  if (cachedLogoDataUrl) return Promise.resolve(cachedLogoDataUrl);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 256;
        canvas.height = img.naturalHeight || 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        cachedLogoDataUrl = canvas.toDataURL('image/png');
        resolve(cachedLogoDataUrl);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = '/logo-san-jose.png';
  });

  return loadingPromise;
}

// Precargar al iniciar la app
if (typeof window !== 'undefined') {
  getSanJoseLogoDataUrl();
}

export function drawSanJosePdfHeader(
  doc,
  {
    title = 'HOJA DE TRABAJO OPERATIVA',
    subtitle = '',
    customSubline = '',
    fechaOperacion = '',
    logoDataUrl = cachedLogoDataUrl,
  } = {}
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  // Membrete Verde Bosque Institucional
  doc.setFillColor(6, 78, 59); // #064e3b
  doc.rect(0, 0, pageWidth, 33, 'F');

  let textX = margin;
  if (logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, 4, 23, 23, 2.5, 2.5, 'F');
      doc.addImage(logoDataUrl, 'PNG', margin + 1.5, 5.5, 20, 20);
      textX = margin + 27;
    } catch {
      textX = margin;
    }
  }

  // Fila 1 (Y: 10 mm)
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('AGROGANADERA RINCÓN DEL SUR S.A.', textX, 10);

  const emisionStr = fechaOperacion ? formatFechaAR(fechaOperacion) : new Date().toLocaleDateString('es-AR');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`Fecha Operativa: ${emisionStr}`, pageWidth - margin, 10, {
    align: 'right',
  });

  // Fila 2 (Y: 16 mm) - Establecimiento a la izquierda, resumen a la derecha con maxWidth estricto sin solapamiento
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(167, 243, 208);
  const sublineText =
    customSubline ||
    'ESTABLECIMIENTO SAN JOSÉ — Las Flores, Bs. As. (2.068 ha)';
  doc.text(sublineText, textX, 16, { maxWidth: 95 });

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(209, 250, 229);
    // Limpiar notas largas entre paréntesis para que no choque
    const cleanSub = String(subtitle).replace(/\s*\([^)]*\)/g, '').trim();
    doc.text(cleanSub, pageWidth - margin, 16, { align: 'right', maxWidth: 68 });
  }

  // Fila 3 (Y: 24.5 mm) - Título del documento
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text(title, textX, 24.5, { maxWidth: pageWidth - margin - textX });

  return 37; // siguiente coordenada Y disponible
}

export function drawSanJoseSignatureFooter(
  doc,
  yPosOrOptions = {},
  optionsMaybe = {}
) {
  const options =
    typeof yPosOrOptions === 'object' && yPosOrOptions !== null
      ? yPosOrOptions
      : optionsMaybe || {};
  const explicitY =
    typeof yPosOrOptions === 'number' ? yPosOrOptions : null;

  const leftLabel = options.leftLabel || 'Encargado / Responsable de Campo';
  const middleLabel = options.middleLabel ?? null;
  const rightLabel = options.rightLabel || 'V°B° Administración San José';
  const twoSignatures = options.twoSignatures ?? !middleLabel;

  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  // En la última página, agregar bloque de firmas para planillas de campo
  doc.setPage(pageCount);
  const sigY = explicitY && explicitY < pageHeight - 16 ? explicitY : pageHeight - 21;

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);

  if (twoSignatures) {
    const boxW = Math.min(85, (pageWidth - margin * 2 - 36) / 2);
    // Firma 1 (Izquierda)
    doc.line(margin + 8, sigY, margin + 8 + boxW, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(safeStr(leftLabel), margin + 8 + boxW / 2, sigY + 4, { align: 'center' });

    // Firma 2 (Derecha)
    const xRight = pageWidth - margin - 8 - boxW;
    doc.line(xRight, sigY, xRight + boxW, sigY);
    doc.text(safeStr(rightLabel), xRight + boxW / 2, sigY + 4, { align: 'center' });
  } else {
    const boxW = (pageWidth - margin * 2 - 16) / 3;
    doc.line(margin, sigY, margin + boxW, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(safeStr(leftLabel), margin + boxW / 2, sigY + 4, { align: 'center' });

    const x2 = margin + boxW + 8;
    doc.line(x2, sigY, x2 + boxW, sigY);
    doc.text(safeStr(middleLabel), x2 + boxW / 2, sigY + 4, { align: 'center' });

    const x3 = x2 + boxW + 8;
    doc.line(x3, sigY, x3 + boxW, sigY);
    doc.text(safeStr(rightLabel), x3 + boxW / 2, sigY + 4, { align: 'center' });
  }

  // Numeración de páginas en todas las hojas
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Establecimiento San José · Agroganadera Rincón del Sur S.A. (Las Flores, Bs. As.) — Hoja ${i} de ${pageCount}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }
}

// Helper compartido para calcular días de permanencia en potrero y semáforo de rotación
export function calcPermanenciaPotrero(rodeo, fechaOperacionStr) {
  if (!rodeo || !rodeo.potrero_numero) {
    return {
      enPotrero: false,
      dias: 0,
      diasEstimados: Number(rodeo?.dias_estimados_pastoreo) || 30,
      fechaIngreso: rodeo?.fecha_ingreso_potrero || null,
      semaforo: 'NEUTRO', // 'VERDE' | 'AMBAR' | 'ROJO' | 'NEUTRO'
      label: 'Sin potrero',
    };
  }

  const fechaIngresoStr = rodeo.fecha_ingreso_potrero || '2026-10-30';
  const refStr = fechaOperacionStr || new Date().toISOString().slice(0, 10);

  const dIng = new Date(`${fechaIngresoStr}T00:00:00`);
  const dRef = new Date(`${refStr}T00:00:00`);
  const diffMs = dRef.getTime() - dIng.getTime();
  const dias = Number.isNaN(diffMs) ? 0 : Math.max(0, Math.round(diffMs / 86400000));
  const diasEstimados = Number(rodeo.dias_estimados_pastoreo) || 30;

  let semaforo = 'VERDE';
  let estadoTexto = 'En rango';
  if (diasEstimados > 0) {
    if (dias >= diasEstimados) {
      semaforo = 'ROJO';
      estadoTexto = 'Rotación sugerida / cumplida';
    } else if (dias >= Math.ceil(diasEstimados * 0.8)) {
      semaforo = 'AMBAR';
      estadoTexto = 'Próximo a rotar';
    }
  }

  return {
    enPotrero: true,
    dias,
    diasEstimados,
    fechaIngreso: fechaIngresoStr,
    semaforo,
    estadoTexto,
    label: `Lleva ${dias} ${dias === 1 ? 'día' : 'días'}`,
  };
}

// Exportar Hoja de Tareas Semanal / Mensual en PDF con membrete y casillas [ ] para tildar a lapicera
export async function exportarHojaTareasPDF(
  tareas = [],
  {
    periodoLabel = 'Planilla Operativa para Personal',
    fechaOperacion = '',
    notify = null,
  } = {}
) {
  try {
    const logoDataUrl = await getSanJoseLogoDataUrl();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;

    let y = drawSanJosePdfHeader(doc, {
      title: 'HOJA DE TAREAS OPERATIVAS DE CAMPO — PERSONAL Y RECORRIDAS',
      subtitle: periodoLabel,
      fechaOperacion,
      logoDataUrl,
    });

    const enCurso = tareas.filter((t) => !t.completada && (t.estado === 'en_curso' || t.estado === 'En Curso'));
    const pendientes = tareas.filter((t) => !t.completada && t.estado !== 'en_curso' && t.estado !== 'En Curso');
    const altas = tareas.filter(
      (t) => !t.completada && (t.prioridad === 'Urgente' || t.prioridad === 'Alta')
    );

    // Barra resumen
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 13, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Total: ${tareas.length}`, margin + 4, y + 5.5);
    doc.text(`Pendientes: ${pendientes.length}`, margin + 35, y + 5.5);
    doc.text(`En Curso: ${enCurso.length}`, margin + 78, y + 5.5);
    doc.text(`Alta / Urgente: ${altas.length}`, margin + 122, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Instrucciones: Tildar [ X ] cada tarea al finalizarla, anotar avances del día en campo y firmar al pie.',
      margin + 4,
      y + 10.5
    );

    y += 17;

    // Cabecera de tabla con anchos geométricos fijos (Total: 186mm)
    doc.setFillColor(6, 78, 59);
    doc.rect(margin, y, pageWidth - margin * 2, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text('[  ]', margin + 2.5, y + 4.8);
    doc.text('ESTADO / PRIORIDAD', margin + 10.5, y + 4.8);
    doc.text('TAREA / DESCRIPCIÓN & AVANCE DIARIO', margin + 42.5, y + 4.8);
    doc.text('POTRERO / UBICACIÓN', margin + 108.5, y + 4.8);
    doc.text('RESPONSABLE', margin + 144.5, y + 4.8);
    doc.text('LÍMITE', margin + 168.5, y + 4.8);
    y += 7;

    const listToRender = tareas.length > 0 ? tareas : [];

    listToRender.forEach((t, idx) => {
      const isEnCurso = !t.completada && (t.estado === 'en_curso' || t.estado === 'En Curso');
      const ultAvance = Array.isArray(t.avances) && t.avances.length > 0
        ? t.avances[t.avances.length - 1]
        : null;

      let avanceTexto = '';
      if (ultAvance) {
        const pctStr = ultAvance.porcentaje != null ? ` (${ultAvance.porcentaje}%)` : '';
        const autorStr = ultAvance.autor ? ` [${ultAvance.autor}]` : '';
        avanceTexto = `\n↳ Último avance ${ultAvance.fecha || ''}${pctStr}${autorStr}: ${ultAvance.nota}`;
      }

      const descFull = `${isEnCurso ? '[EN CURSO] ' : ''}${[t.titulo, t.observaciones].filter(Boolean).join(' — ')}${avanceTexto}`;
      const descLines = doc.splitTextToSize(descFull || '-', 64);

      const potStr = t.potrero_numero
        ? t.potrero_numero === 2
          ? 'Potrero 2/3'
          : t.potrero_numero === 38
          ? 'Potrero NN'
          : `Potrero #${t.potrero_numero}`
        : '';
      const ubicStr = [potStr, t.infraestructura_nombre, t.categoria]
        .filter(Boolean)
        .join(' · ');
      const ubicLines = doc.splitTextToSize(ubicStr || 'General', 35);

      const respStr = String(t.responsable || 'Personal');
      const respLines = doc.splitTextToSize(respStr, 24);

      const fechaStr = String(t.fecha_limite || 'S/F');
      const fechaLines = doc.splitTextToSize(fechaStr, 18);

      const maxLines = Math.max(
        descLines.length,
        ubicLines.length,
        respLines.length,
        fechaLines.length,
        1
      );
      const rowH = Math.max(8.5, maxLines * 3.8 + 3.5);

      if (y + rowH > pageHeight - 34) {
        doc.addPage();
        y = 16;
      }

      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, pageWidth - margin * 2, rowH, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, pageWidth - margin * 2, rowH, 'S');

      // Casilla cuadrada [ ] para tildar a lapicera
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.35);
      doc.rect(margin + 2.5, y + 2.2, 4.2, 4.2);
      if (t.completada) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(6, 78, 59);
        doc.text('X', margin + 3.6, y + 5.4);
      }

      // Estado / Prioridad
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      if (isEnCurso) {
        doc.setTextColor(2, 132, 199);
        doc.text('EN CURSO', margin + 9.5, y + 4.2);
        doc.setFontSize(6.2);
        doc.setTextColor(100, 116, 139);
        doc.text(`Prio: ${t.prioridad || 'Normal'}`, margin + 9.5, y + 7.8);
      } else {
        if (t.prioridad === 'Urgente' || t.prioridad === 'Alta') {
          doc.setTextColor(180, 83, 9);
        } else {
          doc.setTextColor(51, 65, 85);
        }
        doc.text(String(t.prioridad || 'Normal'), margin + 9.5, y + 5);
      }

      // Tarea y detalle (con word-wrap sin truncar)
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text(descLines, margin + 42.5, y + 4.8);

      // Potrero / Ubicación
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(ubicLines, margin + 108.5, y + 4.8);

      // Responsable
      doc.text(respLines, margin + 144.5, y + 4.8);

      // Fecha límite
      doc.text(fechaLines, margin + 168.5, y + 4.8);

      y += rowH;
    });

    // Agregar 4 filas en blanco para anotar tareas adicionales a mano en el campo
    for (let b = 0; b < 4; b++) {
      const rowH = 9;
      if (y + rowH <= pageHeight - 34) {
        doc.setDrawColor(203, 213, 225);
        doc.rect(margin, y, pageWidth - margin * 2, rowH, 'S');
        doc.setDrawColor(100, 116, 139);
        doc.rect(margin + 3, y + 2.4, 4.2, 4.2);
        y += rowH;
      }
    }

    drawSanJoseSignatureFooter(doc, {
      leftLabel: 'Firma Encargado / Personal Asignado',
      middleLabel: 'Aclaración y Fecha de Ejecución',
      rightLabel: 'Control Administración San José',
    });

    const suffix = (fechaOperacion || new Date().toISOString().slice(0, 10)).replace(
      /-/g,
      ''
    );
    doc.save(`Hoja_Tareas_San_Jose_${suffix}.pdf`);
    if (notify) {
      notify(`¡Hoja de Tareas PDF descargada! (Hoja_Tareas_San_Jose_${suffix}.pdf)`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF de Tareas:', err);
    if (notify) notify(`Error al exportar PDF: ${err.message}`, 'error');
  }
}

/**
 * Exporta la Hoja de Ruta y Logística de Cuadrilla en PDF con checklist de camioneta
 * y paradas secuenciales listas para imprimir y tildar a lapicera.
 */
export async function exportarHojaCuadrillaPDF(plan, { fechaOperacion, notify } = {}) {
  try {
    if (!plan || !plan.paradas || plan.paradas.length === 0) {
      if (notify) notify('No hay datos de cuadrilla para exportar en PDF.', 'warning');
      return;
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;

    const logoDataUrl = await getSanJoseLogoDataUrl();

    const cleanInicio = (plan.inicio_recomendado || '07:30 hs').replace(/\s*\([^)]*\)/g, '').trim();
    const duracionStr = plan.tiempo_total_estimado || '~3h 30m';
    const paradasStr = `${plan.paradas.length} Parada${plan.paradas.length === 1 ? '' : 's'}`;
    const distStr = plan.distancia_total_km ? ` · ${plan.distancia_total_km} km` : '';

    let y = drawSanJosePdfHeader(doc, {
      title: 'HOJA DE RUTA Y LOGÍSTICA — DÍA DE CUADRILLA',
      subtitle: `${duracionStr} est. · ${paradasStr}${distStr} · Inicio: ${cleanInicio}`,
      fechaOperacion,
      logoDataUrl,
    });

    // 1. Resumen Operativo de la Cuadrilla & Distancias Reales
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 13, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('ESTRATEGIA OPERATIVA DEL DÍA (DESDE P#14 CASCO):', margin + 3.5, y + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    const distText = plan.distancia_total_km ? `Distancia total estimada: ${plan.distancia_total_km} km desde el Casco.` : '';
    const cleanResumen = sanitizePdfText(plan.resumen_operativo || `Circuito de ${plan.paradas.length} trabajos con partida desde el Galpón Taller.`);
    const resumenLines = doc.splitTextToSize(
      `${cleanResumen} ${distText}`,
      pageWidth - margin * 2 - 7
    );
    doc.text(resumenLines.slice(0, 2), margin + 3.5, y + 8.5);

    y += 16;

    // 2. Bloque Checklist de Carga de Camioneta
    const checklist = plan.checklist_camioneta || {};
    const herramientas = checklist.herramientas || [];
    const materiales = checklist.materiales_repuestos || [];
    const seguridad = checklist.seguridad_epp || [];

    doc.setFillColor(180, 83, 9); // Ámbar oscuro / óxido institucional
    doc.rect(margin, y, pageWidth - margin * 2, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(255, 255, 255);
    doc.text('CHECKLIST DE CARGA EN CAMIONETA (VERIFICAR ANTES DE SALIR DEL GALPÓN TALLER)', margin + 3, y + 4.2);

    y += 6;

    // Caja de 2 columnas para herramientas y materiales
    const colW = (pageWidth - margin * 2) / 2;
    const maxItemsCol = Math.max(herramientas.length, materiales.length, 3);
    const checkRowH = 4.2;
    const checkH = Math.min(42, maxItemsCol * checkRowH + 6);

    doc.setFillColor(254, 252, 232); // Fondo cálido suave
    doc.setDrawColor(251, 191, 36);
    doc.rect(margin, y, pageWidth - margin * 2, checkH, 'FD');

    // Columna 1: Herramientas
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(120, 53, 15);
    doc.text('HERRAMIENTAS Y EQUIPOS:', margin + 3, y + 4);

    let checkY1 = y + 7.5;
    herramientas.slice(0, 8).forEach((h) => {
      doc.setDrawColor(120, 53, 15);
      doc.setLineWidth(0.3);
      doc.rect(margin + 3, checkY1 - 2.8, 3, 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(doc.splitTextToSize(h, colW - 10)[0], margin + 7.5, checkY1 - 0.4);
      checkY1 += checkRowH;
    });

    // Columna 2: Materiales y Repuestos
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(120, 53, 15);
    doc.text('MATERIALES, REPUESTOS Y SEGURIDAD:', margin + colW + 3, y + 4);

    let checkY2 = y + 7.5;
    const matSeg = [...materiales, ...seguridad].slice(0, 8);
    matSeg.forEach((m) => {
      doc.setDrawColor(120, 53, 15);
      doc.setLineWidth(0.3);
      doc.rect(margin + colW + 3, checkY2 - 2.8, 3, 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(doc.splitTextToSize(m, colW - 10)[0], margin + colW + 7.5, checkY2 - 0.4);
      checkY2 += checkRowH;
    });

    y += checkH + 3.5;

    // 3. Tabla de Paradas de la Cuadrilla
    doc.setFillColor(6, 78, 59); // Verde institucional
    doc.rect(margin, y, pageWidth - margin * 2, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(255, 255, 255);
    doc.text('N°', margin + 2, y + 4.5);
    doc.text('UBICACIÓN', margin + 11, y + 4.5);
    doc.text('TRABAJO / ACCIONES A EJECUTAR', margin + 45, y + 4.5);
    doc.text('HERRAMIENTAS / REPUESTOS', margin + 120, y + 4.5);
    doc.text('TIEMPO', margin + 165, y + 4.5);
    doc.text('[ X ]', margin + 179, y + 4.5);

    y += 6.5;

    plan.paradas.forEach((p, idx) => {
      const ubicLines = doc.splitTextToSize(p.ubicacion || `Parada ${idx + 1}`, 32);
      const accFull = `${p.titulo ? `[${p.titulo}] ` : ''}${p.acciones || ''}`;
      const accLines = doc.splitTextToSize(accFull, 72);
      const repFull = [
        ...(p.herramientas_especificas || []),
        ...(p.materiales_especificos || []),
      ].join(' · ') || 'Herramientas estándar';
      const repLines = doc.splitTextToSize(repFull, 42);

      const maxLines = Math.max(ubicLines.length, accLines.length, repLines.length, 1);
      const rowH = Math.max(9, maxLines * 3.6 + 3.5);

      if (y + rowH > pageHeight - 34) {
        doc.addPage();
        y = 16;
      }

      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, pageWidth - margin * 2, rowH, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, pageWidth - margin * 2, rowH, 'S');

      // N° Parada con círculo
      doc.setFillColor(15, 23, 42);
      doc.circle(margin + 5, y + 4.5, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(255, 255, 255);
      doc.text(String(p.numero_parada || idx + 1), margin + 5, y + 5.7, { align: 'center' });

      // Ubicación
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(ubicLines, margin + 11, y + 4.5);

      // Trabajo / Acciones
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(51, 65, 85);
      doc.text(accLines, margin + 45, y + 4.5);

      // Herramientas / Repuestos
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(repLines, margin + 120, y + 4.5);

      // Tiempo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(180, 83, 9);
      doc.text(p.duracion_estimada || '30 min', margin + 165, y + 4.5);

      // Casilla [ ]
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.35);
      doc.rect(margin + 180, y + 2.5, 4.2, 4.2);

      y += rowH;
    });

    // 2 Filas en blanco para tareas o novedades agregadas en campo ("Lista para Recordar")
    const boxRecordarH = 15;
    if (y + boxRecordarH <= pageHeight - 34) {
      doc.setFillColor(254, 252, 232);
      doc.setDrawColor(251, 191, 36);
      doc.roundedRect(margin, y, pageWidth - margin * 2, boxRecordarH, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(180, 83, 9);
      doc.text('LISTA PARA RECORDAR & NOVEDADES EN CAMPO:', margin + 3.5, y + 4.5);

      // Casilla 1
      doc.setDrawColor(180, 83, 9);
      doc.setLineWidth(0.3);
      doc.rect(margin + 4, y + 6.5, 3.5, 3.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(51, 65, 85);
      doc.text('Anotar detalle de aguada, alambrado o rodeo...', margin + 9.5, y + 9.2);

      // Casilla 2
      doc.rect(margin + 4, y + 11, 3.5, 3.5);
      doc.text('Materiales o repuestos a reponer en galpón taller...', margin + 9.5, y + 13.7);

      y += boxRecordarH + 2;
    } else {
      for (let b = 0; b < 2; b++) {
        const rowH = 8.5;
        if (y + rowH <= pageHeight - 34) {
          doc.setDrawColor(203, 213, 225);
          doc.rect(margin, y, pageWidth - margin * 2, rowH, 'S');
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(6.5);
          doc.setTextColor(148, 163, 184);
          doc.text('Novedad o trabajo adicional en campo...', margin + 11, y + 5.5);
          doc.setDrawColor(100, 116, 139);
          doc.rect(margin + 180, y + 2.2, 4.2, 4.2);
          y += rowH;
        }
      }
    }

    drawSanJoseSignatureFooter(doc, {
      leftLabel: 'Firma Encargado de Cuadrilla',
      middleLabel: 'Aclaración y Horario Real de Retorno',
      rightLabel: 'V°B° Capataz / Administración',
    });

    const suffix = (fechaOperacion || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    doc.save(`Hoja_Cuadrilla_San_Jose_${suffix}.pdf`);
    if (notify) {
      notify(`¡Hoja de Cuadrilla PDF descargada! (Hoja_Cuadrilla_San_Jose_${suffix}.pdf)`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF de Cuadrilla:', err);
    if (notify) notify(`Error al exportar PDF de Cuadrilla: ${err.message}`, 'error');
  }
}

/**
 * 5.b HOJA DE RUTA DE RECORRIDA GANADERA Y RELEVAMIENTO DE PASTURAS (PDF)
 * Diseñada para el recorredor o puestero de a caballo o en cuatriciclo, con casilleros
 * de Condición Corporal (1-5), altura de pasto (cm), control de aguadas y servicio/toros.
 */
export async function exportarHojaRecorridaGanaderaPDF(plan, { fechaOperacion, notify } = {}) {
  try {
    if (!plan || !plan.paradas || plan.paradas.length === 0) {
      if (notify) notify('No hay datos de recorrida ganadera para exportar en PDF.', 'warning');
      return;
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;

    const logoDataUrl = await getSanJoseLogoDataUrl();

    const cleanInicio = (plan.inicio_recomendado || '07:00 hs').replace(/\s*\([^)]*\)/g, '').trim();
    const potrerosStr = `${plan.paradas.length} Potrero${plan.paradas.length === 1 ? '' : 's'}`;
    const cabezasStr = `${plan.total_cabezas_inspeccionar || 0} Cab.`;
    const distStr = plan.distancia_total_km ? `${plan.distancia_total_km} km` : '10 km';

    let y = drawSanJosePdfHeader(doc, {
      title: 'HOJA DE RECORRIDA GANADERA Y RELEVAMIENTO DE PASTURAS',
      subtitle: `${distStr} · ${potrerosStr} · ${cabezasStr} · Inicio: ${cleanInicio}`,
      fechaOperacion,
      logoDataUrl,
    });

    // 1. Resumen Estratégico
    doc.setFillColor(240, 253, 244); // Verde menta muy suave
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 13, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(6, 78, 59);
    doc.text('ESTRATEGIA Y ENFOQUE GANADERO DEL DÍA:', margin + 3.5, y + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(22, 101, 52);
    const resumenLines = doc.splitTextToSize(
      plan.resumen_operativo ||
        `Circuito de relevamiento ganadero en ${plan.paradas.length} potreros con partida desde el Casco Central.`,
      pageWidth - margin * 2 - 7
    );
    doc.text(resumenLines.slice(0, 2), margin + 3.5, y + 8.5);

    y += 16;

    // 2. Checklist del Recorredor
    const checklist = plan.checklist_camioneta || {};
    const herramientas = checklist.herramientas || [];
    const materiales = checklist.materiales_repuestos || [];
    const seguridad = checklist.seguridad_epp || [];

    doc.setFillColor(4, 120, 87); // Verde esmeralda institucional
    doc.rect(margin, y, pageWidth - margin * 2, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(255, 255, 255);
    doc.text('CHECKLIST DEL RECORREDOR (VERIFICAR ANTES DE SALIR AL CAMPO)', margin + 3, y + 4.2);

    y += 6;

    const colW = (pageWidth - margin * 2) / 2;
    const maxItemsCol = Math.max(herramientas.length, materiales.length, 3);
    const checkRowH = 4.2;
    const checkH = Math.min(38, maxItemsCol * checkRowH + 6);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, pageWidth - margin * 2, checkH, 'FD');

    // Columna 1: Equipo de campo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(15, 23, 42);
    doc.text('EQUIPOS, ÓPTICA Y MEDICIÓN:', margin + 3, y + 4);

    let checkY1 = y + 7.5;
    herramientas.slice(0, 6).forEach((h) => {
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.3);
      doc.rect(margin + 3, checkY1 - 2.8, 3, 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(doc.splitTextToSize(h, colW - 10)[0], margin + 7.5, checkY1 - 0.4);
      checkY1 += checkRowH;
    });

    // Columna 2: Sanidad y Seguridad
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(15, 23, 42);
    doc.text('SANIDAD RÁPIDA, COMUNICACIÓN Y AGUA:', margin + colW + 3, y + 4);

    let checkY2 = y + 7.5;
    const sanSeg = [...materiales, ...seguridad].slice(0, 6);
    sanSeg.forEach((m) => {
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.3);
      doc.rect(margin + colW + 3, checkY2 - 2.8, 3, 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(doc.splitTextToSize(m, colW - 10)[0], margin + colW + 7.5, checkY2 - 0.4);
      checkY2 += checkRowH;
    });

    y += checkH + 3.5;

    // 3. Tabla de Paradas de Recorrida Ganadera
    doc.setFillColor(15, 23, 42); // Azul noche pizarra
    doc.rect(margin, y, pageWidth - margin * 2, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(255, 255, 255);
    doc.text('N°', margin + 2, y + 4.5);
    doc.text('POTRERO / SUP.', margin + 11, y + 4.5);
    doc.text('RODEOS & HACIENDA', margin + 44, y + 4.5);
    doc.text('PASTURA & AGUADA', margin + 96, y + 4.5);
    doc.text('RELEVAMIENTO IN-SITU (CC / CM / SANIDAD)', margin + 140, y + 4.5);
    doc.text('[ X ]', margin + 179, y + 4.5);

    y += 6.5;

    plan.paradas.forEach((p, idx) => {
      const potLines = doc.splitTextToSize(p.potrero_nombre ? `P#${p.potrero_numero} ${p.potrero_nombre}` : p.ubicacion || `Parada ${idx + 1}`, 31);
      
      const rodeosTxt = (p.rodeos_en_potrero || [])
        .map((r) => `${r.nombre || 'Rodeo'} (${r.cabezas || r.cantidad_cabezas || 0} cab.${r.toros ? ` · ${r.toros}T` : ''})`)
        .join('\n') || 'Sin hacienda fija';
      const rodLines = doc.splitTextToSize(rodeosTxt, 50);

      const pastMolTxt = `${p.recurso_forrajero || 'C. Natural'}${p.molinos_en_potrero?.length ? `\n${p.molinos_en_potrero.join(', ')}` : ''}`;
      const pastLines = doc.splitTextToSize(pastMolTxt, 42);

      const relevTxt = `CC: [ ]1 [ ]2 [ ]3 [ ]4 [ ]5\nPasto: ___ cm | Agua: [ ]OK\nObs: ________________`;
      const relevLines = doc.splitTextToSize(relevTxt, 38);

      const maxLines = Math.max(potLines.length, rodLines.length, pastLines.length, relevLines.length, 3);
      const rowH = Math.max(12, maxLines * 3.8 + 3.5);

      if (y + rowH > pageHeight - 34) {
        doc.addPage();
        y = 16;
      }

      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, pageWidth - margin * 2, rowH, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, pageWidth - margin * 2, rowH, 'S');

      // N° Parada Verde Esmeralda
      doc.setFillColor(4, 120, 87);
      doc.circle(margin + 5, y + 4.5, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(255, 255, 255);
      doc.text(String(p.numero_parada || idx + 1), margin + 5, y + 5.7, { align: 'center' });

      // Potrero
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(potLines, margin + 11, y + 4.5);

      // Rodeos
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(51, 65, 85);
      doc.text(rodLines, margin + 44, y + 4.5);

      // Pastura y Aguadas
      doc.setFontSize(6.5);
      doc.setTextColor(71, 85, 105);
      doc.text(pastLines, margin + 96, y + 4.5);

      // Casilleros in-situ
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      doc.setTextColor(15, 23, 42);
      doc.text(relevLines, margin + 140, y + 4.2);

      // Checkbox
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.35);
      doc.rect(margin + 180, y + 3.5, 4.2, 4.2);

      y += rowH;
    });

    drawSanJoseSignatureFooter(doc, {
      leftLabel: 'Firma Puestero / Recorredor',
      middleLabel: 'Aclaración y Horario Real de Retorno',
      rightLabel: 'V°B° Capataz / Administración',
    });

    const suffix = (fechaOperacion || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    doc.save(`Hoja_Recorrida_Ganadera_San_Jose_${suffix}.pdf`);
    if (notify) {
      notify(`¡Hoja de Recorrida Ganadera PDF descargada! (Hoja_Recorrida_Ganadera_San_Jose_${suffix}.pdf)`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF de Recorrida Ganadera:', err);
    if (notify) notify(`Error al exportar PDF: ${err.message}`, 'error');
  }
}

// 6. Ficha Técnica de Siembra y Recurso Forrajero por Potrero
export async function exportarFichaSiembraPDF(
  siembra,
  potrero,
  { fechaOperacion = '', notify = null } = {}
) {
  try {
    if (!siembra) {
      if (notify) notify('No hay datos de siembra para exportar en PDF.', 'warning');
      return;
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - margin * 2;

    const logoDataUrl = await getSanJoseLogoDataUrl();

    let y = drawSanJosePdfHeader(doc, {
      title: 'FICHA TÉCNICA DE SIEMBRA & RECURSO FORRAJERO',
      subtitle: `Potrero #${siembra.potrero_numero} (${potrero?.nombre || 'Potrero'}) · Campaña ${siembra.campana || '2026/2027'}`,
      fechaOperacion,
      logoDataUrl,
    });

    const checkPageBreak = (neededHeight) => {
      if (y + neededHeight > pageHeight - 25) {
        doc.addPage();
        y = drawSanJosePdfHeader(doc, {
          title: 'FICHA TÉCNICA DE SIEMBRA & RECURSO FORRAJERO (Cont.)',
          subtitle: `Potrero #${siembra.potrero_numero} (${potrero?.nombre || 'Potrero'})`,
          fechaOperacion,
          logoDataUrl,
        });
      }
    };

    // 1. Resumen Ejecutivo del Lote
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, contentWidth, 22, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`POTRERO #${siembra.potrero_numero} — ${potrero?.nombre || 'Lote Campo'}`, margin + 4, y + 5.5);
    doc.text(`Campaña: ${siembra.campana || '2026/2027'}`, margin + 110, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`Superficie: ${siembra.hectareas || potrero?.hectareas || 0} ha`, margin + 4, y + 10.5);
    doc.text(`Cultivo/Pastura: ${siembra.cultivo_variedad || 'S/D'}`, margin + 50, y + 10.5);
    doc.text(`Variedad/Híbrido: ${siembra.variedad_hibrido || 'S/D'}`, margin + 110, y + 10.5);

    doc.text(`Fecha Siembra: ${siembra.fecha || 'S/D'}`, margin + 4, y + 15.5);
    doc.text(`Estado: ${siembra.estado || 'Sembrado'}`, margin + 50, y + 15.5);
    const haNum = Number(siembra.hectareas || potrero?.hectareas || 1) || 1;
    const totalUsd = Number(siembra.costo_total_usd || 0);
    const usdHa = haNum > 0 ? (totalUsd / haNum).toFixed(1) : '0';
    doc.text(`Inversión Total: USD ${totalUsd.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, margin + 110, y + 15.5);
    doc.text(`Promedio: USD ${usdHa}/ha`, margin + 155, y + 15.5);

    if (siembra.observaciones) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.text(`Obs: ${siembra.observaciones}`, margin + 4, y + 19.5);
    }

    y += 26;

    // 2. Receta Agronómica Prescripta
    const receta = Array.isArray(siembra.receta_json) ? siembra.receta_json : [];
    checkPageBreak(12 + Math.max(receta.length, 1) * 6);

    doc.setFillColor(6, 78, 59);
    doc.rect(margin, y, contentWidth, 5.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('1. RECETA AGRONÓMICA PRESCRIPTA (ASESOR TÉCNICO)', margin + 3, y + 4);

    y += 6.5;

    // Encabezados tabla receta
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('PRODUCTO PRESCRIPTO', margin + 3, y + 3.5);
    doc.text('DOSIS / HA', margin + 100, y + 3.5);
    doc.text('UNIDAD', margin + 130, y + 3.5);
    doc.text('TOTAL REQUERIDO LOTE', margin + 155, y + 3.5);

    y += 5.5;

    if (receta.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Sin prescripción agronómica registrada para este lote.', margin + 3, y + 4);
      y += 6;
    } else {
      receta.forEach((r, idx) => {
        checkPageBreak(6);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, contentWidth, 5, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(15, 23, 42);
        doc.text(String(r.producto || ''), margin + 3, y + 3.5);
        doc.text(String(r.dosis_ha || ''), margin + 100, y + 3.5);
        doc.text(String(r.unidad || 'L/ha'), margin + 130, y + 3.5);
        doc.setFont('helvetica', 'bold');
        doc.text(String(r.total_lote ? Number(r.total_lote).toFixed(1) : (Number(r.dosis_ha || 0) * haNum).toFixed(1)), margin + 155, y + 3.5);
        y += 5.5;
      });
    }

    y += 3;

    // 3. Insumos y Remitos Aplicados
    const insumos = Array.isArray(siembra.insumos_json) ? siembra.insumos_json : [];
    checkPageBreak(12 + Math.max(insumos.length, 1) * 6);

    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, contentWidth, 5.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('2. INSUMOS Y REMITOS APLICADOS EN EL LOTE', margin + 3, y + 4);

    y += 6.5;

    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('FECHA', margin + 3, y + 3.5);
    doc.text('REMITO / PROVEEDOR', margin + 25, y + 3.5);
    doc.text('PRODUCTO', margin + 75, y + 3.5);
    doc.text('CANTIDAD', margin + 120, y + 3.5);
    doc.text('DOSIS REAL/HA', margin + 145, y + 3.5);
    doc.text('COSTO (USD)', margin + 168, y + 3.5);

    y += 5.5;

    if (insumos.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Sin remitos de insumos cargados para este lote.', margin + 3, y + 4);
      y += 6;
    } else {
      let subtotalIns = 0;
      insumos.forEach((ins, idx) => {
        checkPageBreak(6);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, contentWidth, 5, 'F');
        }
        subtotalIns += Number(ins.costo_usd || 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(15, 23, 42);
        doc.text(String(ins.fecha || ''), margin + 3, y + 3.5);
        doc.text(String(ins.remito || ins.proveedor || '').slice(0, 28), margin + 25, y + 3.5);
        doc.text(String(ins.producto || '').slice(0, 26), margin + 75, y + 3.5);
        doc.text(`${ins.cantidad_total || 0} ${ins.unidad || ''}`, margin + 120, y + 3.5);
        doc.text(`${ins.dosis_real_ha || (haNum > 0 ? (Number(ins.cantidad_total || 0) / haNum).toFixed(2) : 0)}`, margin + 145, y + 3.5);
        doc.setFont('helvetica', 'bold');
        doc.text(`USD ${Number(ins.costo_usd || 0).toLocaleString('es-AR', { minimumFractionDigits: 1 })}`, margin + 168, y + 3.5);
        y += 5.5;
      });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(6, 78, 59);
      doc.text(`Subtotal Insumos: USD ${subtotalIns.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${(subtotalIns / haNum).toFixed(1)} USD/ha)`, margin + 115, y + 4);
      y += 6;
    }

    y += 3;

    // 4. Labores Agrícolas Realizadas
    const labores = Array.isArray(siembra.labores_json) ? siembra.labores_json : [];
    checkPageBreak(12 + Math.max(labores.length, 1) * 6);

    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, contentWidth, 5.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('3. LABORES AGRÍCOLAS REALIZADAS', margin + 3, y + 4);

    y += 6.5;

    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('FECHA', margin + 3, y + 3.5);
    doc.text('LABOR REALIZADA', margin + 25, y + 3.5);
    doc.text('CONTRATISTA / EQUIPO', margin + 80, y + 3.5);
    doc.text('USD / HA', margin + 140, y + 3.5);
    doc.text('SUBTOTAL (USD)', margin + 165, y + 3.5);

    y += 5.5;

    if (labores.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Sin labores agrícolas registradas para este lote.', margin + 3, y + 4);
      y += 6;
    } else {
      let subtotalLab = 0;
      labores.forEach((l, idx) => {
        checkPageBreak(6);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, contentWidth, 5, 'F');
        }
        subtotalLab += Number(l.subtotal_usd || 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(15, 23, 42);
        doc.text(String(l.fecha || ''), margin + 3, y + 3.5);
        doc.text(String(l.labor || '').slice(0, 32), margin + 25, y + 3.5);
        doc.text(String(l.contratista || 'Propio').slice(0, 32), margin + 80, y + 3.5);
        doc.text(`USD ${Number(l.costo_usd_ha || 0).toFixed(1)}`, margin + 140, y + 3.5);
        doc.setFont('helvetica', 'bold');
        doc.text(`USD ${Number(l.subtotal_usd || 0).toLocaleString('es-AR', { minimumFractionDigits: 1 })}`, margin + 165, y + 3.5);
        y += 5.5;
      });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(6, 78, 59);
      doc.text(`Subtotal Labores: USD ${subtotalLab.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${(subtotalLab / haNum).toFixed(1)} USD/ha)`, margin + 115, y + 4);
      y += 6;
    }

    y += 4;

    // 5. Cuadro Consolidado Final de Inversión
    checkPageBreak(18);
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(16, 185, 129);
    doc.roundedRect(margin, y, contentWidth, 14, 2, 2, 'FD');

    const insTotal = Number(siembra.costo_insumos_usd || 0);
    const labTotal = Number(siembra.costo_labores_usd || 0);
    const totalGral = Number(siembra.costo_total_usd || (insTotal + labTotal));
    const gralHa = haNum > 0 ? (totalGral / haNum).toFixed(1) : '0';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(6, 78, 59);
    doc.text('BALANCE ECONÓMICO FINAL DE LA SIEMBRA:', margin + 4, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`• Insumos: USD ${insTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, margin + 4, y + 10);
    doc.text(`• Labores: USD ${labTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, margin + 55, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(4, 120, 87);
    doc.text(`• Inversión Total: USD ${totalGral.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, margin + 105, y + 10);
    doc.text(`• Costo / ha: USD ${gralHa}/ha`, margin + 155, y + 10);

    y += 18;

    drawSanJoseSignatureFooter(doc, {
      leftLabel: 'Ingeniero Agrónomo / Asesor Técnico',
      middleLabel: 'Encargado de Siembras y Pulverización',
      rightLabel: 'Administración San José',
    });

    const potreroCode = siembra.potrero_numero === 2 ? '2-3' : siembra.potrero_numero === 38 ? 'NN' : siembra.potrero_numero;
    const cleanCultivo = (siembra.cultivo_variedad || 'Siembra').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Ficha_Siembra_P${potreroCode}_${cleanCultivo}_${(siembra.campana || '2026-2027').replace('/', '-')}.pdf`;
    doc.save(filename);

    if (notify) {
      notify(`¡Ficha de Siembra exportada en PDF! (${filename})`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF de Siembra:', err);
    if (notify) notify(`Error al exportar PDF de Siembra: ${err.message}`, 'error');
  }
}

/**
 * EXPORTAR LISTADO DE GASTOS EN PDF (EJECUTIVO CORPORATIVO SPRINT M)
 * Resumen consolidado por rubro, totales en ARS, Crédito Fiscal IVA + Percepciones y Total USD.
 */
export async function exportarListadoGastosPDF(
  gastos = [],
  {
    filtroRubro = 'TODOS',
    periodoLabel = 'Historial General',
    fechaOperacion = '',
    dolarRef = 1600,
    notify = null,
  } = {}
) {
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logoDataUrl = await getSanJoseLogoDataUrl();

    const subtitleText = filtroRubro === 'TODOS'
      ? `LISTADO GENERAL DE GASTOS · ${periodoLabel}`
      : `GASTOS DEL RUBRO: ${filtroRubro.toUpperCase()} · ${periodoLabel}`;

    const startY = drawCorporateHeader(doc, {
      title: 'INFORME DE GASTOS & CRÉDITO FISCAL IVA',
      subtitle: subtitleText,
      campana: 'Campaña 2026/2027',
      fechaOperacion,
      logoDataUrl,
    });

    // Cálculos de Totales y Agrupación por Rubro
    let totalArs = 0;
    let totalUsd = 0;
    let totalNeto = 0;
    let totalIva = 0;
    let totalPerc = 0;
    const rubrosMap = {};

    gastos.forEach((g) => {
      const isNC = Boolean(g.es_nota_credito || Number(g.monto_ars) < 0);
      const sign = isNC ? -1 : 1;
      const ars = Math.abs(Number(g.monto_ars) || 0) * sign;
      const usd = Math.abs(Number(g.monto_usd) || 0) * sign;
      const neto = Math.abs(Number(g.neto_gravado) || 0) * sign;
      const iva = Math.abs(Number(g.monto_iva) || 0) * sign;
      const perc = Math.abs(Number(g.percepciones_iva) || 0) * sign;

      totalArs += ars;
      totalUsd += usd;
      totalNeto += neto;
      totalIva += iva;
      totalPerc += perc;

      const rName = g.rubro || 'Otros Gastos';
      if (!rubrosMap[rName]) rubrosMap[rName] = { ars: 0, usd: 0, count: 0 };
      rubrosMap[rName].ars += ars;
      rubrosMap[rName].usd += usd;
      rubrosMap[rName].count += 1;
    });

    // Tarjetas KPI superiores alineadas
    const kpiCards = [
      {
        label: 'Total Gastos ARS',
        value: `$${Math.round(totalArs).toLocaleString('es-AR')}`,
        subtext: `${gastos.length} comprobantes`,
        accentColor: [6, 78, 59],
      },
      {
        label: 'Total Equiv. USD',
        value: `USD ${Math.round(totalUsd).toLocaleString('es-AR')}`,
        subtext: `TC Ref: $${Number(dolarRef || 1600).toLocaleString('es-AR')}`,
        accentColor: [5, 150, 105],
      },
      {
        label: 'Crédito Fiscal IVA',
        value: `$${Math.round(totalIva).toLocaleString('es-AR')}`,
        subtext: `+ $${Math.round(totalPerc).toLocaleString('es-AR')} Perc.`,
        accentColor: [37, 99, 235],
      },
      {
        label: 'Neto Gravado',
        value: `$${Math.round(totalNeto).toLocaleString('es-AR')}`,
        subtext: `Base imponible`,
        accentColor: [217, 119, 6],
      },
    ];

    let currentY = drawKpiCards(doc, kpiCards, { startY, margin: 12 });

    // Cuadro resumen de Rubros en 2 columnas compactas
    const rubrosList = Object.entries(rubrosMap);
    if (rubrosList.length > 1) {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(12, currentY, doc.internal.pageSize.getWidth() - 24, 15, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(6, 78, 59);
      doc.text('DISTRIBUCIÓN POR RUBRO:', 15, currentY + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(30, 41, 59);

      const topRubros = rubrosList.sort((a, b) => b[1].ars - a[1].ars).slice(0, 4);
      topRubros.forEach(([rName, rData], idx) => {
        const xPos = 15 + idx * 45;
        const pct = totalArs > 0 ? ((rData.ars / totalArs) * 100).toFixed(0) : 0;
        doc.text(
          safeStr(`${sanitizePdfText(rName).slice(0, 18)}: $${Math.round(rData.ars).toLocaleString('es-AR')} (${pct}%)`),
          xPos,
          currentY + 10
        );
      });
      currentY += 19;
    }

    // Definición de columnas de la tabla de comprobantes con x explícita
    const columns = [
      { header: 'FECHA', key: 'fecha', x: 2, width: 18, align: 'left' },
      { header: 'PROVEEDOR / DETALLE', key: 'proveedor', x: 22, width: 62, align: 'left', maxWidth: 60 },
      { header: 'COMPROBANTE', key: 'comprobante', x: 86, width: 28, align: 'left', maxWidth: 26 },
      { header: 'RUBRO / IMPUT.', key: 'rubro', x: 116, width: 34, align: 'left', maxWidth: 32 },
      { header: 'TOTAL ARS', key: 'monto_ars', x: 152, width: 22, align: 'right', bold: true },
      { header: 'EQUIV. USD', key: 'monto_usd', x: 176, width: 20, align: 'right', bold: true, textColor: [6, 78, 59] },
    ];

    const rows = gastos.map((g) => {
      const isNC = Boolean(g.es_nota_credito || Number(g.monto_ars) < 0);
      const provName = g.proveedor ? `${g.proveedor} · ` : '';
      const conceptoStr = `${isNC ? '[NC] ' : ''}${provName}${g.concepto || ''}`;
      const destinoStr = g.potrero_numero ? `P#${g.potrero_numero}` : (g.rodeo_nombre ? `R:${g.rodeo_nombre}` : 'General');
      const arsVal = Number(g.monto_ars || 0);
      const usdVal = Number(g.monto_usd || 0);

      return {
        _isSpecial: isNC,
        fecha: safeStr(String(g.fecha || '').slice(0, 10)),
        proveedor: safeStr(conceptoStr, 'Comprobante'),
        comprobante: safeStr(g.comprobante || g.tipo_comprobante, 'S/N'),
        rubro: safeStr(`${(g.rubro || 'General').slice(0, 16)} (${destinoStr})`),
        monto_ars: safeStr(`${isNC ? '-' : ''}$${Math.abs(arsVal).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`),
        monto_usd: safeStr(`${isNC ? '-' : ''}USD ${Math.abs(usdVal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
      };
    });

    const checkPageBreakFn = () => {
      doc.addPage();
      return drawCorporateHeader(doc, {
        title: 'INFORME DE GASTOS & CRÉDITO FISCAL IVA',
        subtitle: `${subtitleText} (Continuación)`,
        campana: 'Campaña 2026/2027',
        fechaOperacion,
        logoDataUrl,
      });
    };

    drawStandardTable(doc, {
      startY: currentY,
      columns,
      rows,
      rowHeight: 6.2,
      checkPageBreak: checkPageBreakFn,
    });

    // Agregar pie y numeración "Página X de Y"
    addPageNumbersAndFooters(doc, {
      footerText: 'Agroganadera Rincón del Sur S.A. · Establecimiento San José · Reporte Oficial de Compras y Gastos',
    });

    const nowIso = new Date().toISOString().slice(0, 10);
    const filename = `Gastos_San_Jose_${nowIso}.pdf`;
    doc.save(filename);

    if (notify) {
      notify(`¡Listado de Gastos exportado en PDF! (${filename})`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF de Gastos:', err);
    if (notify) notify(`Error al exportar PDF de Gastos: ${err.message}`, 'error');
  }
}

/**
 * Exporta el Listado Oficial de Ventas & Liquidaciones de Hacienda en PDF Ejecutivo A4
 */
export async function exportarListadoVentasPDF(
  ventas = [],
  {
    periodoLabel = 'Historial General',
    fechaOperacion = '',
    dolarRef = 1600,
    notify = null,
  } = {}
) {
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logoDataUrl = await getSanJoseLogoDataUrl();

    const subtitleText = `LIQUIDACIONES GANADERAS & DÉBITO FISCAL IVA (10,5%) · ${periodoLabel}`;

    const startY = drawCorporateHeader(doc, {
      title: 'INFORME DE VENTAS & LIQUIDACIONES DE HACIENDA',
      subtitle: subtitleText,
      campana: 'Campaña 2026/2027',
      fechaOperacion,
      logoDataUrl,
    });

    let totalCab = 0;
    let totalKg = 0;
    let totalBruto = 0;
    let totalGastos = 0;
    let totalNetoArs = 0;
    let totalNetoUsd = 0;
    let totalIvaDeb = 0;

    ventas.forEach((v) => {
      totalCab += Number(v.cantidad_cabezas) || 0;
      totalKg += Number(v.kilos_totales) || 0;
      totalBruto += Number(v.importe_bruto_ars) || 0;
      totalGastos += Number(v.gastos_comercializacion_ars) || 0;
      totalNetoArs += Number(v.ingreso_neto_ars) || 0;
      totalNetoUsd += Number(v.ingreso_neto_usd) || ((Number(v.ingreso_neto_ars) || 0) / (Number(v.tipo_cambio) || dolarRef || 1600));
      totalIvaDeb += Number(v.monto_iva) || ((Number(v.importe_bruto_ars) || 0) * 0.105);
    });

    const precioPromKgArs = totalKg > 0 ? (totalBruto / totalKg).toFixed(2) : '0';
    const precioPromKgUsd = totalKg > 0 && totalNetoUsd > 0 ? (totalNetoUsd / totalKg).toFixed(2) : '0';

    const kpiCards = [
      {
        label: 'TOTAL NETO (USD)',
        value: `USD ${Math.round(totalNetoUsd).toLocaleString('es-AR')}`,
        subtext: `ARS $${Math.round(totalNetoArs).toLocaleString('es-AR')}`,
        accentColor: [6, 78, 59],
      },
      {
        label: 'CABEZAS VENDIDAS',
        value: `${totalCab.toLocaleString('es-AR')} cab.`,
        subtext: `${ventas.length} liquidaciones`,
        accentColor: [15, 118, 110],
      },
      {
        label: 'KILOS VENDIDOS',
        value: `${Math.round(totalKg).toLocaleString('es-AR')} kg`,
        subtext: totalCab > 0 ? `Prom: ${Math.round(totalKg / totalCab)} kg/cab` : '0 kg/cab',
        accentColor: [29, 78, 216],
      },
      {
        label: 'PRECIO PROMEDIO',
        value: `$${Number(precioPromKgArs).toLocaleString('es-AR')}/kg`,
        subtext: `USD ${precioPromKgUsd}/kg`,
        accentColor: [217, 119, 6],
      },
    ];

    let currentY = drawKpiCards(doc, kpiCards, { startY, cardHeight: 16 });

    // Definición de columnas con x explícito para evitar NaN en jsPDF
    const columns = [
      { header: 'FECHA', key: 'fecha', x: 2, width: 18, align: 'center' },
      { header: 'CONSIGNATARIO / COMPRADOR', key: 'comprador', x: 22, width: 46, align: 'left', maxWidth: 44 },
      { header: 'COMPR. / DTA', key: 'comprobante', x: 70, width: 24, align: 'left', maxWidth: 22 },
      { header: 'CATEGORÍA & RODEO', key: 'categoria', x: 96, width: 38, align: 'left', maxWidth: 36 },
      { header: 'CAB & KG', key: 'cab_kg', x: 136, width: 20, align: 'right' },
      { header: 'NETO ARS', key: 'neto_ars', x: 158, width: 20, align: 'right', bold: true },
      { header: 'NETO USD', key: 'neto_usd', x: 180, width: 18, align: 'right', bold: true, textColor: [6, 78, 59] },
    ];

    const rows = ventas.map((v) => {
      const cab = Number(v.cantidad_cabezas) || 0;
      const kg = Number(v.kilos_totales) || 0;
      const ars = Number(v.ingreso_neto_ars) || 0;
      const usd = Number(v.ingreso_neto_usd) || (ars / (Number(v.tipo_cambio) || dolarRef || 1600));

      const compStr = safeStr(v.comprador || v.destino_consignatario, 'Consignatario');
      const rodeoStr = safeStr(v.rodeo_nombre, 'General');
      const catStr = `${safeStr(v.categoria, 'Hacienda')} (${rodeoStr})`;
      const numLiq = v.observaciones?.match(/Liquidación N°\s*([^\s·]+)/i)?.[1]
        || v.tipo_comprobante
        || v.comprobante
        || 'Liq. Vta';

      return {
        fecha: safeStr(String(v.fecha || '').slice(0, 10)),
        comprador: safeStr(compStr),
        comprobante: safeStr(String(numLiq).slice(0, 14)),
        categoria: safeStr(catStr),
        cab_kg: safeStr(`${cab} cab · ${kg > 0 ? `${Math.round(kg).toLocaleString('es-AR')} kg` : '-'}`),
        neto_ars: safeStr(`$${Math.round(ars).toLocaleString('es-AR')}`),
        neto_usd: safeStr(`USD ${Math.round(usd).toLocaleString('es-AR')}`),
      };
    });

    const checkPageBreakFn = () => {
      doc.addPage();
      return drawCorporateHeader(doc, {
        title: 'INFORME DE VENTAS & LIQUIDACIONES DE HACIENDA',
        subtitle: `${subtitleText} (Continuación)`,
        campana: 'Campaña 2026/2027',
        fechaOperacion,
        logoDataUrl,
      });
    };

    drawStandardTable(doc, {
      startY: currentY,
      columns,
      rows,
      rowHeight: 6.8,
      checkPageBreak: checkPageBreakFn,
    });

    addPageNumbersAndFooters(doc, {
      footerText: 'Agroganadera Rincón del Sur S.A. · Establecimiento San José · Ventas y Liquidaciones de Hacienda',
    });

    const nowIso = new Date().toISOString().slice(0, 10);
    const filename = `Ventas_Hacienda_San_Jose_${nowIso}.pdf`;
    doc.save(filename);

    if (notify) {
      notify(`¡Listado de Ventas exportado en PDF! (${filename})`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF de Ventas:', err);
    if (notify) notify(`Error al exportar PDF de Ventas: ${err.message}`, 'error');
  }
}

/**
 * EXPORTA EL COMPROBANTE CONSOLIDADO DETALLE DE UNA LIQUIDACIÓN INDIVIDUAL EN PDF
 */
export async function exportarDetalleLiquidacionPDF(
  venta,
  {
    dolarRef = 1600,
    fechaOperacion = '',
    notify = null,
  } = {}
) {
  if (!venta) {
    if (notify) notify('No se especificó la liquidación para exportar.', 'error');
    return;
  }

  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logoDataUrl = await getSanJoseLogoDataUrl();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;

    const numLiq = venta.observaciones?.match(/Liquidación N°\s*([^\s·]+)/i)?.[1]
      || venta.tipo_comprobante
      || venta.comprobante
      || 'S/N';

    const startY = drawCorporateHeader(doc, {
      title: 'COMPROBANTE OFICIAL DE VENTA DE HACIENDA',
      subtitle: `LIQUIDACIÓN: ${safeStr(numLiq)} · ${safeStr(venta.comprador || venta.destino_consignatario || 'CONSIGNATARIO')}`,
      campana: 'Campaña 2026/2027',
      fechaOperacion: venta.fecha || fechaOperacion,
      logoDataUrl,
    });

    const cab = Number(venta.cantidad_cabezas) || 0;
    const kg = Number(venta.kilos_totales) || 0;
    const promKg = cab > 0 ? (kg / cab).toFixed(1) : '0';
    const bruto = Number(venta.importe_bruto_ars) || 0;
    const gastos = Number(venta.gastos_comercializacion_ars) || 0;
    const ivaDeb = Number(venta.monto_iva) || (bruto * 0.105);
    const netoArs = Number(venta.ingreso_neto_ars) || (bruto - gastos + ivaDeb);
    const tc = Number(venta.tipo_cambio) || Number(dolarRef) || 1600;
    const netoUsd = Number(venta.ingreso_neto_usd) || (netoArs / tc);
    const precioKg = Number(venta.precio_kg) || (kg > 0 ? bruto / kg : 0);

    // Tarjetas KPI principales
    const kpiCards = [
      {
        label: 'INGRESO NETO (ARS)',
        value: `$${Math.round(netoArs).toLocaleString('es-AR')}`,
        subtext: `Equiv: USD ${Math.round(netoUsd).toLocaleString('es-AR')}`,
        accentColor: [6, 78, 59],
      },
      {
        label: 'CABEZAS VENDIDAS',
        value: `${cab.toLocaleString('es-AR')} cab.`,
        subtext: `${safeStr(venta.categoria, 'Hacienda')} (${safeStr(venta.rodeo_nombre, 'General')})`,
        accentColor: [15, 118, 110],
      },
      {
        label: 'KILOS EN BALANZA',
        value: `${Math.round(kg).toLocaleString('es-AR')} kg`,
        subtext: `Promedio: ${promKg} kg/cab`,
        accentColor: [29, 78, 216],
      },
      {
        label: 'PRECIO UNITARIO',
        value: `$${Number(precioKg).toLocaleString('es-AR', { maximumFractionDigits: 2 })}/kg`,
        subtext: `TC: $${tc.toLocaleString('es-AR')}`,
        accentColor: [217, 119, 6],
      },
    ];

    let y = drawKpiCards(doc, kpiCards, { startY, cardHeight: 16 });

    // Cuadro 1: Datos de la Operación y Hacienda
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 28, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 78, 59);
    doc.text('1. DATOS DE LA OPERACIÓN Y HACIENDA VENDIDA', margin + 3.5, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(30, 41, 59);

    const col1X = margin + 3.5;
    const col2X = margin + 65;
    const col3X = margin + 125;

    doc.text(`Fecha Operación: ${safeStr(formatFechaAR(venta.fecha))}`, col1X, y + 11);
    doc.text(`Consignatario: ${safeStr(venta.comprador || venta.destino_consignatario, 'Consignatario')}`, col1X, y + 17);
    doc.text(`Comprobante / Liq: ${safeStr(numLiq)}`, col1X, y + 23);

    doc.text(`Categoría: ${safeStr(venta.categoria, 'Hacienda')}`, col2X, y + 11);
    doc.text(`Rodeo Origen: ${safeStr(venta.rodeo_nombre, 'General')}`, col2X, y + 17);
    doc.text(`Cantidad Cabezas: ${cab} cabezas`, col2X, y + 23);

    doc.text(`Kilos Totales: ${Math.round(kg).toLocaleString('es-AR')} kg`, col3X, y + 11);
    doc.text(`Promedio Balanza: ${promKg} kg/cabeza`, col3X, y + 17);
    doc.text(`Precio Acordado: $${Number(precioKg).toLocaleString('es-AR', { maximumFractionDigits: 2 })} / kg`, col3X, y + 23);

    y += 33;

    // Cuadro 2: Desglose Económico e Impositivo
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 42, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 78, 59);
    doc.text('2. LIQUIDACIÓN COMERCIAL E IMPOSITIVA', margin + 3.5, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);

    const leftX = margin + 4;
    const rightValX = pageWidth - margin - 4;

    const drawMoneyRow = (label, valStr, yPos, isBold = false, isHighlight = false) => {
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setFontSize(isHighlight ? 8 : 7);
      if (isHighlight) {
        doc.setTextColor(6, 78, 59);
      } else {
        doc.setTextColor(30, 41, 59);
      }
      doc.text(safeStr(label), leftX, yPos);
      doc.text(safeStr(valStr), rightValX, yPos, { align: 'right' });
    };

    drawMoneyRow('Importe Bruto de Venta (Hacienda en Pie):', `$${Math.round(bruto).toLocaleString('es-AR')}`, y + 11);
    drawMoneyRow('(-) Gastos de Comercialización, Fletes, Comisión y Sellados:', `-$${Math.round(gastos).toLocaleString('es-AR')}`, y + 16.5);
    drawMoneyRow('(=) Base Neta Imponible Gravada:', `$${Math.round(Number(venta.neto_gravado) || (bruto - gastos)).toLocaleString('es-AR')}`, y + 22);
    drawMoneyRow('(+) IVA Débito Fiscal Ganadero (10,5%):', `+$${Math.round(ivaDeb).toLocaleString('es-AR')}`, y + 27.5);

    // Retenciones o percepciones si hubiera
    const ret = Number(venta.retenciones_iva) || 0;
    const perc = Number(venta.percepciones_iva) || 0;
    if (ret > 0 || perc > 0) {
      drawMoneyRow(`Retenciones (-$${Math.round(ret).toLocaleString('es-AR')}) / Percepciones (+$${Math.round(perc).toLocaleString('es-AR')}):`, `$${Math.round(perc - ret).toLocaleString('es-AR')}`, y + 32.5);
    }

    doc.setDrawColor(6, 78, 59);
    doc.setLineWidth(0.4);
    doc.line(leftX, y + 34, rightValX, y + 34);

    drawMoneyRow('TOTAL NETO A COBRAR / LIQUIDADO:', `$${Math.round(netoArs).toLocaleString('es-AR')} (USD ${Math.round(netoUsd).toLocaleString('es-AR')})`, y + 38.5, true, true);

    y += 48;

    // Cuadro 3: Observaciones y Trazabilidad (DTA, Guía, Remate)
    if (venta.observaciones) {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, y, pageWidth - margin * 2, 22, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(6, 78, 59);
      doc.text('3. OBSERVACIONES, GUÍA DE TRASLADO Y DTA', margin + 3.5, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(51, 65, 85);
      const splitObs = doc.splitTextToSize(safeStr(sanitizePdfText(venta.observaciones)), pageWidth - margin * 2 - 8);
      doc.text(splitObs, margin + 3.5, y + 10);

      y += 26;
    }

    // Firmas institucionales
    drawSanJoseSignatureFooter(doc, {
      leftLabel: 'Responsable de Ventas / Administración',
      rightLabel: 'Dirección San José · Rincón del Sur S.A.',
      sigY: doc.internal.pageSize.getHeight() - 32,
    });

    addPageNumbersAndFooters(doc, {
      footerText: 'Agroganadera Rincón del Sur S.A. · Establecimiento San José · Comprobante Oficial de Liquidación Ganadera',
    });

    const safeFileNum = String(numLiq).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Liquidacion_San_Jose_${safeFileNum}_${venta.fecha || 's-f'}.pdf`;
    doc.save(filename);

    if (notify) {
      notify(`¡Comprobante de liquidación descargado en PDF! (${filename})`, 'success');
    }
  } catch (err) {
    console.error('Error exportando PDF detalle de liquidación:', err);
    if (notify) notify(`Error al exportar PDF: ${err.message}`, 'error');
  }
}




