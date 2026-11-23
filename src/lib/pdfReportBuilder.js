// src/lib/pdfReportBuilder.js
// Motor unificado de diseño y renderizado PDF corporativo para Establecimiento San José
// Agroganadera Rincón del Sur S.A. · Las Flores, Bs. As.
// Integra jsPDF + renderizado nativo/canvas con control estricto de tipografía, márgenes,
// tarjetas KPI superiores, sanitización de caracteres Unicode/emojis y numeración de páginas.

import { jsPDF } from 'jspdf';

/**
 * Helper seguro para garantizar que nunca se pase null, undefined o tipos incompatibles a jsPDF
 */
export function safeStr(v, fallback = '-') {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

/**
 * Sanitiza texto para jsPDF eliminando emojis y traduciendo caracteres especiales
 * que provocan símbolos rotos o signos de interrogación invertidos.
 */
export function sanitizePdfText(text) {
  if (text == null) return '';
  let str = String(text);

  // Mapeo de reemplazos frecuentes para caracteres y símbolos de campo
  const replacements = [
    [/[\u{1F300}-\u{1F9FF}]/gu, ''], // Emojis generales
    [/[\u{2600}-\u{26FF}]/gu, ''],   // Símbolos varios (paraguas, sol, etc.)
    [/[\u{2700}-\u{27BF}]/gu, ''],   // Dingbats (checkmarks, cruces, etc.)
    [/[\u{FE00}-\u{FE0F}]/gu, ''],   // Variation selectors
    [/[\u{1F1E0}-\u{1F1FF}]/gu, ''], // Banderas
    [/•/g, '-'],
    [/✓/g, '[X]'],
    [/✔/g, '[X]'],
    [/✗/g, '[ ]'],
    [/✕/g, '[ ]'],
    [/—/g, '-'],
    [/–/g, '-'],
    [/“|”/g, '"'],
    [/‘|’/g, "'"],
    [/…/g, '...'],
    [/°/g, 'o.'],
    [/²/g, '2'],
    [/³/g, '3'],
  ];

  replacements.forEach(([regex, rep]) => {
    str = str.replace(regex, rep);
  });

  // Limpiar espacios múltiples producidos por remoción de emojis
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Dibuja la cabecera corporativa estandarizada en cualquier orientación (portrait / landscape)
 */
export function drawCorporateHeader(
  doc,
  {
    title = 'INFORME OPERATIVO EJECUTIVO',
    subtitle = '',
    campana = 'Campaña 2026/2027',
    fechaOperacion = '',
    logoDataUrl = null,
  } = {}
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  // Franja institucional Verde Bosque (#064e3b)
  doc.setFillColor(6, 78, 59);
  doc.rect(0, 0, pageWidth, 28, 'F');

  let textX = margin;
  if (logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, 3.5, 21, 21, 2, 2, 'F');
      doc.addImage(logoDataUrl, 'PNG', margin + 1, 4.5, 19, 19);
      textX = margin + 25;
    } catch {
      textX = margin;
    }
  }

  const safeX = Number.isFinite(textX) ? textX : margin;

  // Línea 1: Razón Social
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(safeStr('AGROGANADERA RINCÓN DEL SUR S.A.'), safeX, 9);

  // Línea 2: Establecimiento & Ubicación
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(209, 250, 229); // Verde esmeralda claro
  const fechaStr = safeStr(fechaOperacion || new Date().toISOString().slice(0, 10));
  doc.text(
    safeStr(`Establecimiento San José · Las Flores, Bs. As. (2.068 ha) · ${safeStr(campana)}`),
    safeX,
    14
  );

  // Línea 3: Título del Documento
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(safeStr(sanitizePdfText(title)).toUpperCase(), safeX, 20);

  // Subtítulo a la derecha si existe
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(209, 250, 229);
    doc.text(safeStr(sanitizePdfText(subtitle)), safeX, 24.5);
  }

  // Fecha y hora en esquina superior derecha
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(209, 250, 229);
  doc.text(`Fecha: ${fechaStr}`, pageWidth - margin, 9, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Sistema San José', pageWidth - margin, 14, { align: 'right' });

  return 32; // Retorna posición Y inicial para el contenido
}

/**
 * Renderiza tarjetas de KPIs superiores alineadas con fondo suave y sin superposiciones
 */
export function drawKpiCards(
  doc,
  cards = [],
  { startY = 32, margin = 12, cardHeight = 16 } = {}
) {
  if (!cards || cards.length === 0) return startY;

  const pageWidth = doc.internal.pageSize.getWidth();
  const availableWidth = pageWidth - margin * 2;
  const count = cards.length;
  const gap = 3;
  const cardWidth = (availableWidth - gap * (count - 1)) / count;
  const effectiveHeight = Number.isFinite(cardHeight) && cardHeight > 10 ? cardHeight : 16;
  const effectiveStartY = Number.isFinite(startY) ? startY : 32;

  cards.forEach((card, idx) => {
    const x = margin + idx * (cardWidth + gap);

    // Fondo y borde
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, effectiveStartY, cardWidth, effectiveHeight, 1.5, 1.5, 'FD');

    // Barra superior de acento de color
    let accent = [6, 78, 59];
    if (Array.isArray(card.accentColor) && card.accentColor.length === 3) {
      accent = card.accentColor;
    } else if (typeof card.color === 'string') {
      const hex = card.color.replace('#', '');
      if (hex.length === 6) {
        accent = [
          parseInt(hex.slice(0, 2), 16) || 6,
          parseInt(hex.slice(2, 4), 16) || 78,
          parseInt(hex.slice(4, 6), 16) || 59,
        ];
      }
    }
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(x + 1.5, effectiveStartY + 1.5, cardWidth - 3, 1, 'F');

    // Título / Etiqueta KPI
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(safeStr(sanitizePdfText(card.label), 'KPI').toUpperCase(), x + 2.5, effectiveStartY + 5.5);

    // Valor Principal
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42); // Slate-900
    doc.text(safeStr(sanitizePdfText(card.value), '-'), x + 2.5, effectiveStartY + 10.5);

    // Subtexto / Detalle inferior si existe (soporta subtext o subtitle)
    const sub = card.subtext || card.subtitle;
    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(71, 85, 105);
      doc.text(safeStr(sanitizePdfText(sub), ''), x + 2.5, effectiveStartY + 14);
    }
  });

  return effectiveStartY + effectiveHeight + 4;
}

/**
 * Dibuja una tabla profesional con auto-paginación, cabecera oscura y alternancia de filas
 */
export function drawStandardTable(
  doc,
  {
    startY = 52,
    columns = [],
    rows = [],
    margin = 12,
    rowHeight = 6.5,
    headerColor = [6, 78, 59],
    checkPageBreak = null,
  } = {}
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = Number.isFinite(startY) ? startY : 52;

  // Normalizar columnas para garantizar que col.x y col.width sean números finitos y válidos
  let accumulatedX = 0;
  const safeColumns = (columns || []).map((col) => {
    const width = Number.isFinite(col.width) && col.width > 0 ? col.width : 25;
    const x = Number.isFinite(col.x) ? col.x : accumulatedX;
    accumulatedX = x + width;
    return {
      ...col,
      width,
      x,
    };
  });

  // Helper local seguro para doc.text con validación estricta de coordenadas y tipos
  const safeDocText = (text, xPos, yPos, options = {}) => {
    if (!Number.isFinite(xPos) || !Number.isFinite(yPos)) return;
    const clean = safeStr(text, '');
    if (!clean && clean !== '0') return;
    try {
      doc.text(clean, xPos, yPos, options);
    } catch (e) {
      console.warn('[PDF] Error al renderizar texto en doc.text:', e, { text: clean, x: xPos, y: yPos });
    }
  };

  // Dibujar cabecera
  const drawTableHeader = () => {
    doc.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
    doc.rect(margin, y, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(255, 255, 255);

    safeColumns.forEach((col) => {
      let align = col.align || 'left';
      let xPos = margin + col.x;
      if (align === 'right') xPos = margin + col.x + (col.width || 0);
      else if (align === 'center') xPos = margin + col.x + (col.width || 0) / 2;

      safeDocText(sanitizePdfText(safeStr(col.header, '-')), xPos, y + 4.8, { align });
    });
    y += 7;
  };

  drawTableHeader();

  // Dibujar filas
  (rows || []).forEach((row, idx) => {
    // Control de salto de página
    if (y + rowHeight > pageHeight - 25) {
      if (checkPageBreak) {
        y = checkPageBreak();
        drawTableHeader();
      } else {
        doc.addPage();
        y = 20;
        drawTableHeader();
      }
    }

    const isEven = idx % 2 === 0;
    const isSpecial = Boolean(row._isSpecial);

    if (isSpecial) {
      doc.setFillColor(250, 245, 255); // Violeta suave
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    } else if (isEven) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + rowHeight, margin + contentWidth, y + rowHeight);

    safeColumns.forEach((col) => {
      const cellVal = row[col.key] != null ? row[col.key] : '';
      const isBold = Boolean(col.bold || row._bold);
      const isCustomColor = col.textColor || (isSpecial ? [147, 51, 234] : [15, 23, 42]);

      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setFontSize(col.fontSize || 6.5);
      doc.setTextColor(isCustomColor[0], isCustomColor[1], isCustomColor[2]);

      let align = col.align || 'left';
      let xPos = margin + col.x;
      if (align === 'right') xPos = margin + col.x + (col.width || 0);
      else if (align === 'center') xPos = margin + col.x + (col.width || 0) / 2;

      // Si tiene casilla de verificación especial (ej. para mangas o cuadrilla)
      if (col.isCheckbox) {
        doc.setDrawColor(100, 116, 139);
        doc.setLineWidth(0.3);
        doc.roundedRect(xPos - 2, y + (rowHeight - 4) / 2, 4, 4, 0.5, 0.5, 'S');
      } else {
        let textToPrint = safeStr(cellVal, '-');
        if (col.maxWidth && Number.isFinite(col.maxWidth)) {
          const lines = doc.splitTextToSize(sanitizePdfText(textToPrint), col.maxWidth);
          textToPrint = (lines && lines.length > 0 && lines[0] != null) ? lines[0] : '-';
        } else {
          textToPrint = sanitizePdfText(textToPrint);
        }
        safeDocText(textToPrint, xPos, y + rowHeight * 0.65, { align });
      }
    });

    y += rowHeight;
  });

  return y;
}

/**
 * Añade la numeración estándar 'Página X de Y' y pie institucional a todas las páginas
 */
export function addPageNumbersAndFooters(
  doc,
  {
    footerText = 'Establecimiento San José · Las Flores, Bs. As. · Documento de Uso Interno Confidencial',
  } = {}
) {
  const totalPages = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Línea divisoria de pie
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);

    // Leyenda izquierda
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(148, 163, 184);
    doc.text(safeStr(sanitizePdfText(footerText)), margin, pageHeight - 7);

    // Numeración derecha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 7, {
      align: 'right',
    });
  }
}
