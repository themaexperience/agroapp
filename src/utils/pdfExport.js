// src/utils/pdfExport.js
// Generador y Exportador Directo de Informes PDF Ejecutivos A4 para Copiloto IA San José
// Agroganadera Rincón del Sur S.A. · Establecimiento San José (Las Flores, Buenos Aires)
//
// CARACTERÍSTICAS PRINCIPALES:
// 1. Descarga directa en el navegador de archivo .pdf en A4 vertical (sin window.print ni popups).
// 2. Encabezado institucional con logo oficial, Razón Social, ubicación Las Flores y Dólar de referencia.
// 3. Limpieza de JSONs crudos y conversión automática a tarjetas de KPIs y tablas estilizadas.
// 4. Recorte automático de preguntas conversacionales de cierre de chat para acabado ejecutivo formal.
// 5. Pie de página institucional con numeración "Página X de Y" sin texto residual.

import { jsPDF } from 'jspdf';
import {
  safeStr,
  sanitizePdfText,
  drawKpiCards,
  drawStandardTable,
  addPageNumbersAndFooters,
} from '../lib/pdfReportBuilder.js';
import { getSanJoseLogoDataUrl } from './pdfHelper.js';

/**
 * Parsea y extrae datos estructurados de infografía / análisis ejecutivo de un JSON
 */
export function parseExecutiveJsonData(str) {
  if (!str) return null;
  try {
    let clean = String(str).trim();
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    clean = clean.replace(/^:::+(?:infografia)?\s*/i, '').replace(/:::+\s*$/i, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object') {
      const hasTitulo = Boolean(parsed.titulo || parsed.title);
      const hasKpis = Array.isArray(parsed.kpis) && parsed.kpis.length > 0;
      const hasBloques = Array.isArray(parsed.bloques || parsed.blocks) && (parsed.bloques || parsed.blocks).length > 0;
      const hasConclusion = Boolean(parsed.conclusion);
      if (hasTitulo && (hasKpis || hasBloques || hasConclusion)) {
        return {
          titulo: parsed.titulo || parsed.title,
          subtitulo: parsed.subtitulo || parsed.subtitle || '',
          kpis: Array.isArray(parsed.kpis) ? parsed.kpis : [],
          bloques: Array.isArray(parsed.bloques || parsed.blocks) ? (parsed.bloques || parsed.blocks) : [],
          conclusion: parsed.conclusion || null,
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Normaliza bloques de infografía en el texto reemplazando codeblocks json o raw json
 */
export function normalizarBloquesEjecutivosJson(texto) {
  if (!texto || typeof texto !== 'string') return '';
  let res = texto;

  // 1. Detectar bloques ```json ... ``` o ``` ... ```
  const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
  res = res.replace(codeBlockRegex, (match, jsonCandidate) => {
    const data = parseExecutiveJsonData(jsonCandidate);
    if (data) {
      return `:::infografia\n${JSON.stringify(data, null, 2)}\n:::`;
    }
    return match;
  });

  // 2. Detectar JSONs crudos { "titulo": ..., ("kpis"|"bloques"|"conclusion"): ... } fuera de code fences
  let startIdx = res.search(/\{[\s\r\n]*"(?:titulo|title)"\s*:/i);
  let guard = 0;
  while (startIdx !== -1 && guard < 5) {
    guard++;
    const prevText = res.substring(Math.max(0, startIdx - 30), startIdx);
    if (prevText.includes(':::infografia')) {
      const nextSearch = res.indexOf(':::', startIdx);
      if (nextSearch === -1) break;
      const sub = res.substring(nextSearch + 3);
      const subIdx = sub.search(/\{[\s\r\n]*"(?:titulo|title)"\s*:/i);
      if (subIdx === -1) break;
      startIdx = nextSearch + 3 + subIdx;
      continue;
    }

    let depth = 0;
    let endIdx = -1;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < res.length; i++) {
      const char = res[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
    }

    if (endIdx !== -1) {
      const candidate = res.substring(startIdx, endIdx + 1);
      const data = parseExecutiveJsonData(candidate);
      if (data) {
        res = res.substring(0, startIdx) + `:::infografia\n${JSON.stringify(data, null, 2)}\n:::` + res.substring(endIdx + 1);
        startIdx = res.search(/\{[\s\r\n]*"(?:titulo|title)"\s*:/i);
        continue;
      }
    }
    break;
  }

  return res;
}

/**
 * Recorta preguntas conversacionales y fórmulas de cierre de chat al final de las respuestas
 * para que el PDF se descargue como un informe ejecutivo formal.
 */
export function recortarCierreConversacional(texto = '') {
  if (!texto) return '';
  let lines = String(texto).split('\n');

  const regexPreguntas = /^(?:¿|\?|\*{0,2}(?:decime|avisame|contame|querés|queremos|te gustaría|cómo lo ves|si te parece|cualquier duda|avanzamos|seguimos|fijate si|confirmame))/i;

  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    // Si la línea es una pregunta de cierre conversacional típica de IA
    if (
      regexPreguntas.test(last) ||
      (last.endsWith('?') && last.length < 120) ||
      last.endsWith('¿') ||
      last.toLowerCase().includes('afinar el lápiz') ||
      last.toLowerCase().includes('avanzamos con') ||
      last.toLowerCase().includes('te parece bien') ||
      last.toLowerCase().includes('cómo ves estos números') ||
      last.toLowerCase().includes('avísame si querés') ||
      last.toLowerCase().includes('avisame si querés')
    ) {
      lines.pop();
      continue;
    }
    break;
  }

  return lines.join('\n').trim();
}

/**
 * Genera y descarga directamente un archivo PDF A4 vertical estilizado para un mensaje del Copiloto IA
 */
export async function exportarInformeCopilotoPDF({
  msg,
  contenido = '',
  titulo = null,
  subtitulo = null,
  dolarRef = null,
  fechaOperacion = null,
}) {
  const rawSource = msg?.contenido || contenido || '';
  if (!rawSource || !rawSource.trim()) {
    throw new Error('No hay contenido para exportar a PDF.');
  }

  const normalized = normalizarBloquesEjecutivosJson(rawSource);

  // 1. Extraer datos de infografía / bloque ejecutivo si existen
  let infografia = null;
  const infoMatch = normalized.match(/(?:(?:::infografia|```infografia)\s*([\s\S]*?)(?:::|```))/i);
  if (infoMatch && infoMatch[1]) {
    try {
      let clean = infoMatch[1].replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      clean = clean.replace(/:::+$/, '').trim();
      infografia = JSON.parse(clean);
    } catch (e) {
      console.warn('Error al parsear bloque de infografía para PDF:', e);
    }
  }

  // 2. Extraer títulos y metadatos
  const docTitle =
    titulo ||
    infografia?.titulo ||
    normalized.match(/^#+\s*(.+)$/m)?.[1]?.replace(/\*\*/g, '').trim() ||
    'INFORME EJECUTIVO DE OPERACIONES';

  const docSubtitle =
    subtitulo ||
    infografia?.subtitulo ||
    'Agroganadera Rincón del Sur S.A. · Establecimiento San José';

  const fechaDoc = fechaOperacion || new Date().toISOString().slice(0, 10);
  let fechaFormateada = fechaDoc;
  try {
    const [y, m, d] = fechaDoc.split('-');
    if (y && m && d) fechaFormateada = `${d}/${m}/${y}`;
  } catch {}

  const horaEmision = new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const tipoCambioStr = dolarRef ? `$${Number(dolarRef).toLocaleString('es-AR')}/USD` : null;

  // 3. Limpieza de texto para el cuerpo del reporte
  let textoCuerpo = normalized
    // Remover bloques de infografía / kpi / chart / svg
    .replace(/(?::{3,}|\`{1,3})(infografia|svg|kpi|chart)\s*([\s\S]*?)(?::{3,}|\`{1,3})/gi, '')
    // Remover ACTION_JSON si vino
    .replace(/ACTION_JSON:\s*\{[\s\S]*?\}/gi, '')
    // Remover bloques JSON crudos sueltos
    .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, '')
    .trim();

  // Recortar cierres conversacionales finales
  textoCuerpo = recortarCierreConversacional(textoCuerpo);

  // 4. Inicializar jsPDF (A4 Portrait: 210 x 297 mm)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297 mm
  const margin = 14; // márgenes cómodos
  const contentWidth = pageWidth - margin * 2; // 182 mm
  const maxContentY = pageHeight - 18;

  // Cargar logo institucional San José
  const logoDataUrl = await getSanJoseLogoDataUrl();

  // Función para dibujar encabezado institucional en página 1
  function drawHeaderPage1() {
    // Franja institucional Verde Bosque (#064e3b)
    doc.setFillColor(6, 78, 59);
    doc.rect(0, 0, pageWidth, 30, 'F');

    let textX = margin;
    if (logoDataUrl) {
      try {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(margin, 4, 22, 22, 2, 2, 'F');
        doc.addImage(logoDataUrl, 'PNG', margin + 1, 5, 20, 20);
        textX = margin + 26;
      } catch {
        textX = margin;
      }
    }

    // Línea 1: Razón Social
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('AGROGANADERA RINCÓN DEL SUR S.A.', textX, 10);

    // Línea 2: Establecimiento & Ubicación Oficial
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(209, 250, 229);
    doc.text('Establecimiento San José · Las Flores, Buenos Aires (2.068 ha)', textX, 15.5);

    // Línea 3: Título del Documento
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    const titleClean = sanitizePdfText(docTitle).toUpperCase();
    doc.text(doc.splitTextToSize(titleClean, contentWidth - 45)[0] || titleClean, textX, 22);

    // Metadatos a la derecha (Fecha, Hora, Dólar)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(209, 250, 229);
    doc.text(`Fecha: ${fechaFormateada} (${horaEmision} hs)`, pageWidth - margin, 10, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    if (tipoCambioStr) {
      doc.text(`Dólar Ref: ${tipoCambioStr}`, pageWidth - margin, 15.5, { align: 'right' });
    }
    doc.text('Copiloto Agropecuario IA', pageWidth - margin, 21, { align: 'right' });

    return 36; // posición Y después del header
  }

  // Función para dibujar encabezado breve en páginas subsecuentes
  function drawSubsequentHeader() {
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, 8, contentWidth, 8, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, 16, margin + contentWidth, 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 78, 59);
    doc.text(safeStr(sanitizePdfText(docTitle)).toUpperCase(), margin + 2, 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Establecimiento San José · ${fechaFormateada}`, pageWidth - margin - 2, 13, { align: 'right' });

    return 22;
  }

  let y = drawHeaderPage1();

  // Función helper para salto de página automático
  function checkPageBreak(neededHeight = 10) {
    if (y + neededHeight > maxContentY) {
      doc.addPage();
      y = drawSubsequentHeader();
    }
  }

  // 5. Renderizar Subtítulo si existe
  if (docSubtitle && docSubtitle.toLowerCase() !== docTitle.toLowerCase()) {
    checkPageBreak(8);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(sanitizePdfText(docSubtitle), margin, y);
    y += 5.5;
  }

  // 6. Renderizar Tarjetas de KPIs si la infografía contiene kpis
  if (Array.isArray(infografia?.kpis) && infografia.kpis.length > 0) {
    checkPageBreak(24);
    const formattedKpis = infografia.kpis.map((k) => ({
      label: k.label || 'KPI',
      value: k.valor || k.value || '-',
      subtext: k.detalle || k.subtext || '',
      color: k.color || '#064e3b',
    }));

    y = drawKpiCards(doc, formattedKpis, {
      startY: y,
      margin,
      cardHeight: 18,
    });
    y += 2;
  }

  // 7. Renderizar Bloques de Datos / Tablas Estructuradas de la Infografía
  if (Array.isArray(infografia?.bloques) && infografia.bloques.length > 0) {
    for (const bloque of infografia.bloques) {
      const items = Array.isArray(bloque.items) ? bloque.items : [];
      if (items.length === 0) continue;

      checkPageBreak(18 + items.length * 6);

      // Título del bloque
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, contentWidth, 6, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, y + 6, margin + contentWidth, y + 6);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(6, 78, 59);
      doc.text(sanitizePdfText(bloque.titulo || 'Desglose Operativo').toUpperCase(), margin + 2.5, y + 4.2);
      y += 8;

      const columns = [
        { header: 'Concepto / Detalle', key: 'concepto', x: 0, width: 95, align: 'left', bold: true },
        { header: 'Observación / Nota', key: 'nota', x: 95, width: 50, align: 'left' },
        { header: 'Valor / Importe', key: 'valor', x: 145, width: 37, align: 'right', bold: true },
      ];

      const rows = items.map((it) => ({
        concepto: it.nombre || it.concepto || '-',
        nota: it.nota || it.detalle || (it.porcentaje ? `${it.porcentaje}%` : '-'),
        valor: it.valor || it.importe || '-',
      }));

      y = drawStandardTable(doc, {
        startY: y,
        columns,
        rows,
        margin,
        rowHeight: 6,
        headerColor: [6, 78, 59],
        checkPageBreak: () => {
          doc.addPage();
          return drawSubsequentHeader();
        },
      });
      y += 4;
    }
  }

  // 8. Renderizar Recuadro Destacado de Conclusión / Recomendación si existe
  if (infografia?.conclusion) {
    checkPageBreak(22);

    const concText = sanitizePdfText(infografia.conclusion);
    const concLines = doc.splitTextToSize(concText, contentWidth - 10);
    const boxHeight = Math.max(16, concLines.length * 4.2 + 9);

    // Fondo verde claro (#ecfdf5) y borde verde (#6ee7b7)
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(110, 231, 183);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 2, 2, 'FD');

    // Barra de acento izquierda
    doc.setFillColor(5, 150, 105);
    doc.rect(margin, y, 2.5, boxHeight, 'F');

    // Título de recomendación
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 95, 70);
    doc.text('RECOMENDACIÓN OPERATIVA CLAVE:', margin + 5, y + 5);

    // Texto de la conclusión
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(concLines, margin + 5, y + 9.5);

    y += boxHeight + 5;
  }

  // 9. Renderizar Texto Narrativo / Análisis de Campo Formateado
  if (textoCuerpo) {
    const rawLines = textoCuerpo.split('\n');

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) {
        y += 2.5;
        continue;
      }

      // Separador horizontal
      if (line === '---' || line === '***' || line === '___') {
        checkPageBreak(5);
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, y, margin + contentWidth, y);
        y += 4;
        continue;
      }

      // Títulos Markdown (# o ## o ###)
      if (line.startsWith('#')) {
        checkPageBreak(10);
        const titleText = sanitizePdfText(line.replace(/^#+\s*/, '').replace(/\*\*/g, ''));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(line.startsWith('###') ? 8.5 : 9.5);
        doc.setTextColor(6, 78, 59);
        doc.text(titleText, margin, y + 4);
        y += 7.5;
        continue;
      }

      // Viñetas de lista (- o * o • o números 1.)
      const isBullet = /^[-*•]\s+/.test(line);
      const isNumbered = /^\d+\.\s+/.test(line);

      if (isBullet || isNumbered) {
        checkPageBreak(7);
        const cleanItem = sanitizePdfText(line.replace(/^[-*•\d.]+\s+/, '').replace(/\*\*/g, ''));
        const itemLines = doc.splitTextToSize(cleanItem, contentWidth - 6);

        // Viñeta verde estilizada
        doc.setFillColor(6, 78, 59);
        doc.circle(margin + 2, y + 1.8, 0.8, 'F');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(30, 41, 59);
        doc.text(itemLines, margin + 5.5, y + 2.5);

        y += itemLines.length * 3.8 + 1.2;
        continue;
      }

      // Párrafo de texto común
      checkPageBreak(6);
      const cleanPara = sanitizePdfText(line.replace(/\*\*/g, ''));
      const paraLines = doc.splitTextToSize(cleanPara, contentWidth);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      doc.text(paraLines, margin, y + 2.5);

      y += paraLines.length * 3.8 + 1.5;
    }
  }

  // 10. Agregar numeración de página y pie institucional limpio a TODAS las páginas
  addPageNumbersAndFooters(doc, {
    footerText: 'Página {P} · Documento interno confidencial — Establecimiento San José, Las Flores',
  });

  // 11. Descarga directa del archivo .pdf
  const safeDateSlug = fechaDoc.replace(/[^0-9-]/g, '');
  const fileName = `Informe_San_Jose_${safeDateSlug}.pdf`;
  doc.save(fileName);

  return {
    success: true,
    fileName,
    pages: doc.internal.getNumberOfPages(),
  };
}

export default {
  exportarInformeCopilotoPDF,
  parseExecutiveJsonData,
  normalizarBloquesEjecutivosJson,
  recortarCierreConversacional,
};
