import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  Send,
  Mic,
  MicOff,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Edit2,
  Paperclip,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  Clock,
  Layers,
  FileText,
  FileDown,
  RefreshCw,
  Camera,
  MessageSquare,
  ShieldAlert,
  ArrowRight,
  Sliders,
  Sprout,
  BarChart3,
  PieChart,
  Palette,
  Maximize2,
  Minimize2,
  ChevronLeft,
  Copy,
  Printer,
  TrendingUp,
  Compass,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { confirmAction } from './ConfirmDialog';
import { crearSystemSnapshot } from '../utils/systemSnapshots';
import {
  enviarMensajeCopilotoSanJose,
  GEMINI_PRO_MODEL,
  formatGeminiErrorMessage,
  fileToBase64,
  getFileMimeType,
  compressImage,
  uploadCompressedImageIfStorageActive,
  isPdfFile,
} from '../lib/geminiService';
import {
  exportarInformeCopilotoPDF,
  normalizarBloquesEjecutivosJson,
  parseExecutiveJsonData,
  recortarCierreConversacional,
} from '../utils/pdfExport.js';

// ============================================================================
// HELPERS DE RENDERIZADO VISUAL PARA COPILOTO IA (INFOGRAFÍA, SVG, KPI, CHART, MARKDOWN)
// ============================================================================

// Mapeo de paleta institucional para Infografías Ejecutivas
function getInfografiaColorStyles(colorName) {
  const c = String(colorName || '').toLowerCase().trim();
  switch (c) {
    case 'emerald':
    case 'verde':
    case 'green':
      return {
        border: 'border-emerald-300',
        bg: 'bg-emerald-50/80',
        badgeBg: 'bg-emerald-100 text-emerald-950 border-emerald-300',
        accentBar: 'bg-emerald-600',
        text: 'text-emerald-950',
        progress: 'bg-emerald-600',
      };
    case 'amber':
    case 'amarillo':
    case 'yellow':
    case 'orange':
      return {
        border: 'border-amber-300',
        bg: 'bg-amber-50/80',
        badgeBg: 'bg-amber-100 text-amber-950 border-amber-300',
        accentBar: 'bg-amber-500',
        text: 'text-amber-950',
        progress: 'bg-amber-500',
      };
    case 'blue':
    case 'sky':
    case 'azul':
      return {
        border: 'border-sky-300',
        bg: 'bg-sky-50/80',
        badgeBg: 'bg-sky-100 text-sky-950 border-sky-300',
        accentBar: 'bg-sky-600',
        text: 'text-sky-950',
        progress: 'bg-sky-600',
      };
    case 'rose':
    case 'red':
    case 'rojo':
      return {
        border: 'border-rose-300',
        bg: 'bg-rose-50/80',
        badgeBg: 'bg-rose-100 text-rose-950 border-rose-300',
        accentBar: 'bg-rose-600',
        text: 'text-rose-950',
        progress: 'bg-rose-600',
      };
    case 'purple':
    case 'morado':
    case 'violeta':
      return {
        border: 'border-purple-300',
        bg: 'bg-purple-50/80',
        badgeBg: 'bg-purple-100 text-purple-950 border-purple-300',
        accentBar: 'bg-purple-600',
        text: 'text-purple-950',
        progress: 'bg-purple-600',
      };
    default:
      return {
        border: 'border-slate-300',
        bg: 'bg-slate-50/80',
        badgeBg: 'bg-slate-200 text-slate-800 border-slate-300',
        accentBar: 'bg-slate-700',
        text: 'text-slate-900',
        progress: 'bg-slate-700',
      };
  }
}

// Componente de Infografía Ejecutiva con layout automático en React (cero superposición)
export function InfografiaCopiloto({ data, onExportPdf, keyPrefix = 'info' }) {
  if (!data || typeof data !== 'object') return null;

  const titulo = data.titulo || 'Informe Visual Ejecutivo';
  const subtitulo = data.subtitulo || 'Establecimiento San José';
  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  const bloques = Array.isArray(data.bloques) ? data.bloques : [];
  const conclusion = data.conclusion || null;

  return (
    <div className="my-3 rounded-2xl border border-slate-200/90 bg-white shadow-md overflow-hidden animate-in fade-in duration-300">
      {/* Cabecera estilo San José con degradado verde estancia */}
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 px-4 py-3 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <h3 className="text-xs sm:text-sm font-black tracking-wide text-emerald-100 uppercase truncate">
              {titulo}
            </h3>
          </div>
          {subtitulo && (
            <p className="text-[11px] text-emerald-300/80 font-medium mt-0.5 truncate">
              {subtitulo}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-900/60 border border-emerald-700/50 text-emerald-200">
            {new Date().toLocaleDateString('es-AR')}
          </span>
          {onExportPdf && (
            <button
              type="button"
              onClick={onExportPdf}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
              title="Descargar o imprimir este informe en PDF A4 oficial"
            >
              <FileText className="w-3 h-3 text-white" />
              <span>Descargar PDF</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-3.5 sm:p-4 space-y-3.5 bg-slate-50/50">
        {/* Fila de KPIs destacados */}
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {kpis.map((k, idx) => {
              const styles = getInfografiaColorStyles(k.color);
              return (
                <div
                  key={`${keyPrefix}-kpi-${idx}`}
                  className={`p-2.5 sm:p-3 rounded-xl border ${styles.border} ${styles.bg} shadow-2xs flex flex-col justify-between relative overflow-hidden`}
                >
                  <div className={`absolute top-0 left-0 right-0 h-1 ${styles.accentBar}`} />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-500 block leading-tight break-words">
                    {k.label}
                  </span>
                  <div className={`text-lg sm:text-xl font-black mt-1 tracking-tight ${styles.text}`}>
                    {k.valor}
                  </div>
                  {k.detalle && (
                    <span className="text-[10px] text-slate-600 mt-0.5 font-medium block leading-tight break-words">
                      {k.detalle}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Grilla responsive de Bloques (2 columnas limpias) */}
        {bloques.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {bloques.map((b, bIdx) => {
              const styles = getInfografiaColorStyles(b.color);
              const items = Array.isArray(b.items) ? b.items : [];

              return (
                <div
                  key={`${keyPrefix}-bloque-${bIdx}`}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs space-y-2.5 flex flex-col justify-between"
                >
                  {/* Título del Bloque */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full ${styles.accentBar} shrink-0`} />
                      <h4 className="text-xs font-black text-slate-800 tracking-wide uppercase truncate">
                        {b.titulo || `Bloque ${bIdx + 1}`}
                      </h4>
                    </div>
                    {items.length > 0 && (
                      <span className="text-[10px] font-mono text-slate-400 font-semibold shrink-0">
                        {items.length} {items.length === 1 ? 'ítem' : 'ítems'}
                      </span>
                    )}
                  </div>

                  {/* Lista de Ítems con barras relativas */}
                  <div className="space-y-2">
                    {items.map((item, iIdx) => {
                      const pct = Math.min(100, Math.max(0, Number(item.porcentaje) || 0));
                      return (
                        <div key={`${keyPrefix}-item-${bIdx}-${iIdx}`} className="space-y-1">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="font-bold text-slate-800 truncate" title={item.nombre}>
                              {item.nombre}
                            </span>
                            <span className="font-black text-slate-900 font-mono shrink-0">
                              {item.valor}
                            </span>
                          </div>

                          {/* Barra de progreso */}
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-500 ${styles.progress}`}
                              style={{ width: `${pct > 0 ? pct : 100}%`, opacity: pct > 0 ? 1 : 0.4 }}
                            />
                          </div>

                          {item.nota && (
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span className="truncate">{item.nota}</span>
                              {pct > 0 && (
                                <span className="font-mono text-slate-400 shrink-0 ml-1">
                                  {pct}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Recomendación / Conclusión operativa destacada al pie */}
        {conclusion && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-3 flex items-start gap-2.5 text-xs text-emerald-950 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="font-black uppercase tracking-wider text-[10px] text-emerald-800 block mb-0.5">
                Conclusión & Recomendación Operativa:
              </span>
              <p className="font-medium leading-relaxed text-slate-800">
                {conclusion}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Renderizador seguro de Bloque Infografía JSON
function renderInfografiaBlock(rawContent, key, onExportPdf) {
  if (!rawContent) return null;
  let data = null;
  try {
    let clean = rawContent.trim();
    clean = clean.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    clean = clean.replace(/:::+$/, '').trim();
    data = JSON.parse(clean);
  } catch (err) {
    console.warn('Error al parsear bloque de infografia:', err);
    return null;
  }

  if (!data || typeof data !== 'object') return null;

  return (
    <InfografiaCopiloto
      key={key}
      data={data}
      keyPrefix={key}
      onExportPdf={onExportPdf}
    />
  );
}

// ============================================================================
// SANITIZACIÓN DE LATEX Y DELIMITADORES HUÉRFANOS
// ============================================================================

// Sanitizador previo de fórmulas y expresiones LaTeX
function sanitizarLatex(text) {
  if (!text || typeof text !== 'string') return '';
  let res = text;

  // Fracciones anidadas \frac{a}{b} -> (a / b)
  let prev;
  let iters = 0;
  do {
    prev = res;
    res = res.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)');
    iters++;
  } while (res !== prev && iters < 6);

  // \text{...}, \mathrm{...}, \mathit{...} -> $1
  res = res.replace(/\\(?:text|mathrm|mathit)\{([^{}]+)\}/g, '$1');

  // \textbf{...}, \mathbf{...} -> **$1**
  res = res.replace(/\\(?:textbf|mathbf)\{([^{}]+)\}/g, '**$1**');

  // Símbolos matemáticos LaTeX habituales
  res = res
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\div/g, '÷')
    .replace(/\\approx/g, '≈')
    .replace(/\\leq?/g, '≤')
    .replace(/\\geq?/g, '≥')
    .replace(/\\pm/g, '±')
    .replace(/\\neq/g, '≠')
    .replace(/\\infty/g, '∞')
    .replace(/\\quad/g, ' ')
    .replace(/\\qquad/g, '  ')
    .replace(/\\left\(/g, '(')
    .replace(/\\right\)/g, ')')
    .replace(/\\left\[/g, '[')
    .replace(/\\right\]/g, ']')
    .replace(/\\left\\\{/g, '{')
    .replace(/\\right\\\}/g, '}')
    .replace(/\\%/g, '%')
    .replace(/\\\$/g, '$');

  // Convertir bloques matemáticos $$...$$ o $...$ a texto plano limpio
  res = res.replace(/\$\$([\s\S]*?)\$\$/g, (m, p1) => {
    return ' ' + p1.replace(/\n+/g, ' ').trim() + ' ';
  });

  // Limpiar cualquier comando tipo \palabra{contenido} restante
  res = res.replace(/\\([a-zA-Z]+)\{([^{}]+)\}/g, '$2');
  // Limpiar comandos sueltos restantes como \palabra
  res = res.replace(/\\([a-zA-Z]+)/g, ' ');

  // Limpiar dobles signos de dólar sueltos
  res = res.replace(/\$\$/g, '');

  return res;
}

// Limpiador estricto de dos puntos y delimitadores huérfanos que quedan al extraer bloques
function limpiarDelimitadoresHuerfanos(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Eliminar líneas completas que solo tienen dos puntos, comillas invertidas o espacios
    .replace(/^[ \t]*:+[ \t]*$/gm, '')
    .replace(/^[ \t]*`+[ \t]*$/gm, '')
    // Eliminar dos puntos al inicio o final de línea que hayan quedado huérfanos
    .replace(/^[ \t]*:+[ \t]*/gm, '')
    .replace(/[ \t]*:+[ \t]*$/gm, '')
    // Reducir saltos de línea triples a dobles
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizarSvg(rawSvg) {
  if (!rawSvg) return '';
  let svg = rawSvg.trim();
  // Limpiar colons ::: o backticks que pudieran haber quedado
  svg = svg.replace(/:::+/g, '').trim();

  // Extraer el bloque <svg>...</svg> si viene con texto o backticks alrededor
  const match = svg.match(/<svg[\s\S]*?<\/svg>/i);
  if (match) {
    svg = match[0];
  } else if (!svg.startsWith('<svg')) {
    svg = `<svg viewBox="0 0 720 340" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  }

  // Sanitización de seguridad: eliminar scripts, eventos on*, javascript:
  svg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  svg = svg.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  svg = svg.replace(/\son\w+\s*=\s*[^>\s]+/gi, '');
  svg = svg.replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, '');

  // Asegurar atributo viewBox si no lo tiene
  if (!/viewBox\s*=/i.test(svg)) {
    const wMatch = svg.match(/width\s*=\s*["']?(\d+)["']?/i);
    const hMatch = svg.match(/height\s*=\s*["']?(\d+)["']?/i);
    const w = wMatch ? wMatch[1] : 720;
    const h = hMatch ? hMatch[1] : 340;
    svg = svg.replace(/<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }

  // Asegurar clases responsivas y max-h
  if (!/class\s*=/i.test(svg)) {
    svg = svg.replace(/<svg/i, '<svg class="w-full h-auto max-h-[380px] select-none block"');
  } else {
    svg = svg.replace(/class\s*=\s*["']([^"']*)["']/i, (m, cls) => {
      return `class="${cls} w-full h-auto max-h-[380px] select-none block"`;
    });
  }

  return svg;
}

// Renderizador de Bloque KPI estructurado
function renderKpiBlock(rawContent, key) {
  let items = [];
  try {
    const parsed = JSON.parse(rawContent.trim());
    if (Array.isArray(parsed)) items = parsed;
    else if (typeof parsed === 'object') items = [parsed];
  } catch {
    // Parser fallback por líneas con formato: Label | Valor | estado | detalle
    const lines = rawContent.split('\n').filter((l) => l.trim().length > 0);
    items = lines.map((l) => {
      const parts = l.split('|').map((p) => p.trim());
      return {
        label: parts[0] || 'Métrica',
        valor: parts[1] || '-',
        estado: parts[2] || 'info',
        detalle: parts[3] || '',
      };
    });
  }

  if (items.length === 0) return null;

  return (
    <div key={key} className="my-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
      {items.map((item, idx) => {
        const est = (item.estado || 'info').toLowerCase();
        const colors =
          est === 'optimo' || est === 'ok' || est === 'verde'
            ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
            : est === 'alerta' || est === 'amarillo' || est === 'warning'
            ? 'bg-amber-50/90 border-amber-300 text-amber-950'
            : est === 'critico' || est === 'rojo' || est === 'danger'
            ? 'bg-red-50/90 border-red-300 text-red-950'
            : 'bg-slate-50/90 border-slate-200 text-slate-900';

        return (
          <div key={idx} className={`p-3 rounded-2xl border shadow-2xs ${colors} flex flex-col justify-between`}>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block leading-tight break-words">
              {item.label}
            </span>
            <div className="text-xl sm:text-2xl font-black mt-1 tracking-tight">
              {item.valor}
            </div>
            {item.detalle && (
              <span className="text-[11px] text-slate-600 mt-1 font-medium block leading-tight break-words">
                {item.detalle}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Renderizador de Bloque Chart estructurado
function renderChartBlock(rawContent, key) {
  let data = null;
  try {
    data = JSON.parse(rawContent.trim());
  } catch {
    return null;
  }

  if (!data || !Array.isArray(data.datos) || data.datos.length === 0) return null;

  const total = data.datos.reduce((acc, d) => acc + (Number(d.valor) || 0), 0) || 1;
  const maxVal = Math.max(...data.datos.map((d) => Number(d.valor) || 0)) || 1;

  return (
    <div key={key} className="my-3 p-4 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-3">
      {data.titulo && (
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-emerald-800" />
            {data.titulo}
          </span>
          <span className="text-[10px] font-mono text-slate-400 font-bold">
            Total: {total.toLocaleString('es-AR')}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {data.datos.map((d, idx) => {
          const val = Number(d.valor) || 0;
          const pct = Math.round((val / total) * 100);
          const barWidth = Math.max(4, Math.round((val / maxVal) * 100));
          const barColor = d.color || '#064e3b';

          return (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">{d.nombre}</span>
                <div className="flex items-center gap-2 text-slate-600 font-mono text-[11px]">
                  <strong>{val.toLocaleString('es-AR')}</strong>
                  <span className="text-slate-400 text-[10px]">({pct}%)</span>
                </div>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Parser inline: negritas (**), cursiva (*), código (`)
function parseInlineMarkdown(text) {
  if (!text) return '';
  const tokens = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      return (
        <strong key={idx} className="font-extrabold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-100 text-emerald-900 font-mono text-[11px] border border-slate-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      return (
        <em key={idx} className="italic text-slate-700">
          {token.slice(1, -1)}
        </em>
      );
    }
    return token;
  });
}

// Formateador avanzado de bloques Markdown: Tablas HTML, Encabezados, Listas y Separadores
function renderTextWithMarkdown(text) {
  if (!text) return '';
  const cleanSource = sanitizarLatex(text);
  const lines = cleanSource.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Descartar líneas que solo contienen dos puntos o backticks sueltos huérfanos
    if (/^:+$/.test(trimmed) || /^`+$/.test(trimmed)) {
      i++;
      continue;
    }

    // 1. TABLA MARKDOWN: Bloque consecutivo de líneas que empiezan con '|'
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      // Procesar filas de la tabla
      const rows = tableLines.map((l) =>
        l
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
      );

      let headerRow = null;
      let dataRows = [];

      // Detectar si la fila 1 es el separador (|---|:---:|---:|)
      if (rows.length >= 2 && rows[1].every((c) => /^:?-+:?$/.test(c))) {
        headerRow = rows[0];
        dataRows = rows.slice(2);
      } else {
        headerRow = rows[0];
        dataRows = rows.slice(1);
      }

      elements.push(
        <div
          key={`tbl-${i}`}
          className="my-3 w-full overflow-x-auto rounded-xl border border-slate-200 shadow-2xs"
        >
          <table className="w-full text-xs border-collapse rounded-xl overflow-hidden">
            {headerRow && (
              <thead className="bg-emerald-950 text-white font-extrabold uppercase text-[10px] tracking-wider">
                <tr>
                  {headerRow.map((col, cIdx) => (
                    <th key={cIdx} className="px-2.5 py-2 text-left font-black whitespace-nowrap">
                      {parseInlineMarkdown(col)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="divide-y divide-slate-100 bg-white">
              {dataRows.map((row, rIdx) => (
                <tr key={rIdx} className="even:bg-slate-50 hover:bg-slate-100/70 transition">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1.5 text-slate-800 tabular-nums">
                      {parseInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 2. SEPARADOR HORIZONTAL (--- o *** o ___)
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-slate-200" />);
      i++;
      continue;
    }

    // 3. ENCABEZADO NIVEL 3 (### Subtítulo)
    if (trimmed.startsWith('### ')) {
      const headingText = trimmed.replace(/^###\s+/, '');
      elements.push(
        <div key={`h3-${i}`} className="text-sm font-bold text-slate-900 mt-3 mb-1.5 leading-snug">
          {parseInlineMarkdown(headingText)}
        </div>
      );
      i++;
      continue;
    }

    // 4. ENCABEZADO NIVEL 1 / 2 (## o # Título)
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      const headingText = trimmed.replace(/^#{1,2}\s+/, '');
      elements.push(
        <div key={`h2-${i}`} className="text-base font-extrabold text-slate-900 mt-4 mb-2 leading-snug">
          {parseInlineMarkdown(headingText)}
        </div>
      );
      i++;
      continue;
    }

    // 5. LISTA CON VIÑETAS (- , * , • )
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const bulletText = trimmed.replace(/^[•\-\*]\s+/, '');
      elements.push(
        <div key={`bullet-${i}`} className="flex items-start gap-1.5 pl-1 my-0.5">
          <span className="text-emerald-700 font-bold shrink-0 leading-relaxed">•</span>
          <span className="leading-relaxed">{parseInlineMarkdown(bulletText)}</span>
        </div>
      );
      i++;
      continue;
    }

    // 6. LÍNEA REGULAR
    elements.push(
      <div key={`p-${i}`} className="leading-relaxed min-h-[1.2em]">
        {parseInlineMarkdown(rawLine)}
      </div>
    );
    i++;
  }

  return elements;
}

// Renderizador integral con bloques visuales
function renderFormattedMessage(contenido, esUser, onAmpliarSvg, onExportPdf) {
  if (!contenido) return null;

  // Sanitizar expresiones LaTeX y normalizar bloques ejecutivos JSON a tarjetas visuales
  const contenidoLimpio = normalizarBloquesEjecutivosJson(sanitizarLatex(contenido));

  if (esUser) {
    return (
      <div className="whitespace-pre-wrap font-medium">
        {renderTextWithMarkdown(contenidoLimpio)}
      </div>
    );
  }

  // Regex robusta para bloques especiales: :::infografia, :::svg, :::kpi, :::chart
  // Captura y consume completamente cualquier número de dos puntos (3 o más) al inicio y al final
  const BLOCK_REGEX = /(?::{3,}|\x60{1,3})(infografia|svg|kpi|chart)\s*([\s\S]*?)(?::{3,}|\x60{1,3})/gi;

  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = BLOCK_REGEX.exec(contenidoLimpio)) !== null) {
    const rawBefore = contenidoLimpio.substring(lastIndex, match.index);
    const cleanBefore = limpiarDelimitadoresHuerfanos(rawBefore);
    if (cleanBefore) {
      elements.push(
        <div key={`txt-${lastIndex}`} className="space-y-0.5 font-medium">
          {renderTextWithMarkdown(cleanBefore)}
        </div>
      );
    }

    const blockType = (match[1] || '').toLowerCase();
    const blockContent = match[2] || '';

    if (blockType === 'infografia') {
      // Bloque 1: Infografía Ejecutiva
      const infoEl = renderInfografiaBlock(blockContent, `info-${match.index}`, onExportPdf);
      if (infoEl) {
        elements.push(infoEl);
      } else {
        // Fallback en caso de JSON dañado
        elements.push(
          <div key={`info-err-${match.index}`} className="my-2 p-3 rounded-xl bg-slate-100 text-slate-700 font-mono text-xs">
            {limpiarDelimitadoresHuerfanos(blockContent)}
          </div>
        );
      }
    } else if (blockType === 'svg') {
      // Bloque 2: SVG (retrocompatible)
      const cleanSvg = sanitizarSvg(blockContent);
      if (cleanSvg) {
        elements.push(
          <div
            key={`svg-${match.index}`}
            className="relative my-3 rounded-2xl border border-slate-200/90 bg-white p-3 sm:p-4 shadow-sm overflow-hidden flex flex-col items-center justify-center animate-in fade-in duration-300 group"
          >
            {onAmpliarSvg && (
              <button
                type="button"
                onClick={() => onAmpliarSvg(cleanSvg)}
                className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-white text-[10px] font-bold inline-flex items-center gap-1 shadow-sm transition opacity-80 hover:opacity-100 cursor-pointer z-10 backdrop-blur-xs"
                title="Ampliar diagrama en pantalla completa"
              >
                <Maximize2 className="w-3 h-3 text-emerald-400" />
                <span>🔍 Ampliar</span>
              </button>
            )}
            <div
              className="w-full overflow-x-auto flex justify-center py-1"
              dangerouslySetInnerHTML={{ __html: cleanSvg }}
            />
          </div>
        );
      }
    } else if (blockType === 'kpi') {
      // Bloque 3: KPI
      const kpiEl = renderKpiBlock(blockContent, `kpi-${match.index}`);
      if (kpiEl) elements.push(kpiEl);
    } else if (blockType === 'chart') {
      // Bloque 4: Chart
      const chartEl = renderChartBlock(blockContent, `chart-${match.index}`);
      if (chartEl) elements.push(chartEl);
    }

    lastIndex = BLOCK_REGEX.lastIndex;
  }

  const rawRemaining = contenidoLimpio.substring(lastIndex);
  const cleanRemaining = limpiarDelimitadoresHuerfanos(rawRemaining);
  if (cleanRemaining || elements.length === 0) {
    elements.push(
      <div key={`txt-${lastIndex}`} className="space-y-0.5 font-medium">
        {renderTextWithMarkdown(cleanRemaining || rawRemaining)}
      </div>
    );
  }

  return <div className="space-y-2">{elements}</div>;
}

export default function CopilotoSanJoseDrawer({
  isOpen = false,
  onClose,
  potreros = [],
  rodeos = [],
  tareas = [],
  alertas = [],
  registrosLluvias = [],
  insumos = [],
  maquinaria = [],
  gastos = [],
  ventas = [],
  laboresSiembras = [],
  fechaOperacion,
  dolarRef = 1540,
  dolarModoManual = false,
  preciosHacienda = null,
  activeTab = 'general',
  caminosEstado = 'Transitable',
  isSandboxMode = false,
  onRefresh,
  notify,
}) {
  // Identificador del hilo de conversación continua del Copiloto
  const [selectedTopicoId, setSelectedTopicoId] = useState(null);

  // Estado de mensajes del tópico activo
  const [mensajes, setMensajes] = useState([]);
  const [loadingMensajes, setLoadingMensajes] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  // Adjuntos (Soporte Multidocumento: Fotos, Remitos, Facturas, Recetas, Presupuestos)
  const [attachedFiles, setAttachedFiles] = useState([]); // [{ id, file, name, size, mimeType, base64, preview }]
  const [processingFiles, setProcessingFiles] = useState(false);

  // Reconocimiento de voz (micrófono)
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  // Ejecución de propuesta
  const [aplicandoPropuestaMsgId, setAplicandoPropuestaMsgId] = useState(null);
  const [editedPropuestaData, setEditedPropuestaData] = useState({});

  // Contexto vivo de Cuaderno Veterinario y Movimientos Pactados
  const [cuadernoVet, setCuadernoVet] = useState([]);
  const [movimientosPactados, setMovimientosPactados] = useState([]);

  // Estados para copia y visualización ampliada de SVG
  const [copiedMsgId, setCopiedMsgId] = useState(null);
  const [selectedSvgAmpliado, setSelectedSvgAmpliado] = useState(null);

  // Modo Full IA / Sala de Estrategia (Pantalla dividida con lienzo visual)
  const [isFullIaMode, setIsFullIaMode] = useState(false);
  const [selectedArtefactoIdx, setSelectedArtefactoIdx] = useState(null);
  const [mobileFullTab, setMobileFullTab] = useState('chat'); // 'chat' | 'lienzo'

  // Disparadores estratégicos de alto impacto
  const DISPARADORES_ESTRATEGICOS = [
    {
      label: 'Carga y Pastoreo',
      icono: '🌾',
      prompt: 'Detectar cuellos de botella de carga y pasto en cada potrero, cruzando con coberturas forrajeras y sugiriendo rotaciones urgentes.',
    },
    {
      label: 'Venta vs. Retención',
      icono: '⚖️',
      prompt: 'Simular escenarios de venta / retención de terneros y vacas CUT con números reales y costo proyectado.',
    },
    {
      label: 'Agenda vs. Insumos',
      icono: '🩺',
      prompt: 'Cruzar agenda sanitaria vs. stock de insumos y botiquín, calculando faltantes exactos a comprar y su presupuesto.',
    },
    {
      label: 'Eficiencia por Rodeo',
      icono: '🐄',
      prompt: 'Auditoría de eficiencia por rodeo (% terneros al pie, condición corporal y mermas comparativas).',
    },
  ];

  const messagesEndRef = useRef(null);

  // Cargar registros recientes de Cuaderno Veterinario y Movimientos Pactados
  const fetchCuadernoYMovimientos = async () => {
    try {
      const [resVet, resMov] = await Promise.all([
        supabase
          .from('cuaderno_veterinario')
          .select('*')
          .order('fecha', { ascending: false })
          .limit(20),
        supabase
          .from('movimientos_pactados')
          .select('*')
          .order('fecha_pactada', { ascending: false })
          .limit(20),
      ]);
      if (resVet.data) setCuadernoVet(resVet.data);
      if (resMov.data) setMovimientosPactados(resMov.data);
    } catch (err) {
      console.warn('Error fetching cuaderno/movimientos en Copiloto:', err);
    }
  };

  // 1. Cargar hilo único de conversación continua desde Supabase
  const fetchTopicos = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_topicos')
        .select('*')
        .order('id', { ascending: true })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        setSelectedTopicoId(data[0].id);
      } else {
        // Inicializar conversación general si la tabla estuviera vacía
        const { data: nuevo, error: errIns } = await supabase
          .from('chat_topicos')
          .insert({
            titulo: 'General Campo',
            modulo_origen: 'general',
            resumen_memoria: 'Conversación contextual continua de Establecimiento San José.',
          })
          .select()
          .single();
        if (!errIns && nuevo) {
          setSelectedTopicoId(nuevo.id);
        } else {
          setSelectedTopicoId(1);
        }
      }
    } catch (err) {
      console.warn('Fallback hilo copiloto:', err);
      setSelectedTopicoId((prev) => prev || 1);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTopicos();
      fetchCuadernoYMovimientos();
    }
  }, [isOpen]);

  // 2. Cargar mensajes del tópico seleccionado
  const fetchMensajes = async (topicoId) => {
    if (!topicoId) return;
    setLoadingMensajes(true);
    try {
      const { data, error } = await supabase
        .from('chat_mensajes')
        .select('*')
        .eq('topico_id', topicoId)
        .order('creado_en', { ascending: true });

      if (error) throw error;
      setMensajes(data || []);
    } catch (err) {
      console.error('Error al cargar chat_mensajes:', err);
    } finally {
      setLoadingMensajes(false);
    }
  };

  useEffect(() => {
    if (selectedTopicoId) {
      fetchMensajes(selectedTopicoId);
    }
  }, [selectedTopicoId]);

  // Scroll automático hacia el final del chat
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [mensajes, sending]);

  // Manejo de archivos adjuntos (Soporte simultáneo de múltiples documentos: Presupuestos, Remitos, Facturas, Recetas)
  const handleFileSelect = async (e) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0) return;

    const maxTotalFiles = 6;
    const remainingSlots = Math.max(0, maxTotalFiles - attachedFiles.length);
    if (remainingSlots === 0) {
      notify?.('Máximo 6 documentos adjuntos por mensaje.', 'info');
      return;
    }
    const filesToProcess = rawFiles.slice(0, remainingSlots);

    setProcessingFiles(true);
    try {
      const newItems = await Promise.all(
        filesToProcess.map(async (file) => {
          const mime = getFileMimeType(file);
          let b64 = '';
          let preview = null;

          if (mime.startsWith('image/') && !isPdfFile(file)) {
            try {
              const compressed = await compressImage(file, 1600, 0.82);
              b64 = await fileToBase64(compressed);
              preview = URL.createObjectURL(compressed);
            } catch (cErr) {
              b64 = await fileToBase64(file);
              preview = URL.createObjectURL(file);
            }
          } else {
            b64 = await fileToBase64(file);
            preview = null;
          }

          return {
            id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            file,
            name: file.name,
            size: file.size,
            mimeType: mime,
            base64: b64,
            preview,
          };
        })
      );

      setAttachedFiles((prev) => [...prev, ...newItems]);
      if (rawFiles.length > remainingSlots) {
        notify?.(`Se adjuntaron ${remainingSlots} archivos (límite máximo alcanzado).`, 'info');
      }
    } catch (err) {
      console.error('Error procesando archivos adjuntos:', err);
      notify?.('Error al leer uno o más archivos adjuntos.', 'error');
    } finally {
      setProcessingFiles(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleRemoveFile = (fileId) => {
    setAttachedFiles((prev) => {
      const target = prev.find((f) => f.id === fileId);
      if (target?.preview) {
        try {
          URL.revokeObjectURL(target.preview);
        } catch (_) {}
      }
      return prev.filter((f) => f.id !== fileId);
    });
  };

  const handleClearFiles = () => {
    attachedFiles.forEach((f) => {
      if (f.preview) {
        try {
          URL.revokeObjectURL(f.preview);
        } catch (_) {}
      }
    });
    setAttachedFiles([]);
  };

  // Reconocimiento de Voz (Micrófono)
  const toggleRecording = () => {
    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      notify?.('Tu navegador no soporta dictado por voz.', 'info');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-AR';
      recognition.interimResults = false;
      recognition.continuous = false;

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
      };

      recognition.onerror = (event) => {
        console.warn('Error reconocimiento voz:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Error al iniciar micrófono:', err);
      setIsRecording(false);
    }
  };

  // 3. Reiniciar / Limpiar la conversación continua con confirmación previa
  const handleClearChat = async () => {
    if (mensajes.length === 0) {
      notify?.('La conversación ya está vacía.', 'info');
      return;
    }

    const ok = await confirmAction({
      title: '¿Vaciar conversación del Copiloto IA?',
      description: 'Se eliminarán los mensajes anteriores de este chat para comenzar una conversación limpia. La base de datos del campo no se verá afectada.',
      confirmText: 'Sí, vaciar chat',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      if (selectedTopicoId) {
        const { error } = await supabase
          .from('chat_mensajes')
          .delete()
          .eq('topico_id', selectedTopicoId);
        if (error) throw error;
      }

      setMensajes([]);
      setSelectedArtefactoIdx(null);
      notify?.('Conversación reiniciada con éxito.', 'info');
    } catch (err) {
      console.warn('Error al limpiar chat en Supabase:', err);
      setMensajes([]);
      setSelectedArtefactoIdx(null);
      notify?.('Conversación reiniciada.', 'info');
    }
  };

  // 4. Enviar mensaje del usuario e invocar Copiloto con Gemini Pro
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const textoAEnviar = inputText.trim();
    if (!textoAEnviar && attachedFiles.length === 0) return;
    const currentTopicoId = selectedTopicoId || 1;

    setSending(true);
    setInputText('');

    const currentAttached = [...attachedFiles];
    handleClearFiles();

    // Subir imágenes opcionales a Storage si está activo
    const adjuntosJson = [];
    for (const item of currentAttached) {
      let publicUrl = null;
      if (item.file) {
        try {
          publicUrl = await uploadCompressedImageIfStorageActive(item.file, 'copiloto');
        } catch (stErr) {
          console.warn('Storage fallback:', stErr);
        }
      }
      adjuntosJson.push({
        name: item.name,
        size: item.size,
        mime: item.mimeType,
        url: publicUrl,
      });
    }

    let adjuntoUrl = null;
    let adjuntoTipo = null;
    if (adjuntosJson.length === 1) {
      adjuntoUrl = adjuntosJson[0].url;
      adjuntoTipo = adjuntosJson[0].mime;
    } else if (adjuntosJson.length > 1) {
      adjuntoUrl = JSON.stringify(adjuntosJson.map((a) => a.url).filter(Boolean));
      adjuntoTipo = 'multidocumento';
    }

    let contenidoFinal = textoAEnviar;
    if (!contenidoFinal && currentAttached.length > 0) {
      contenidoFinal = `[${currentAttached.length} documento(s) adjunto(s): ${currentAttached.map((a) => a.name).join(', ')}]`;
    }

    // 1) Guardar mensaje del usuario en Supabase
    let userMsgId = null;
    const userPayload = {
      topico_id: currentTopicoId,
      rol: 'user',
      contenido: contenidoFinal,
      adjunto_url: adjuntoUrl,
      adjunto_tipo: adjuntoTipo,
      adjuntos_json: adjuntosJson,
      creado_en: new Date().toISOString(),
    };

    try {
      const { data: userMsg, error: errUser } = await supabase
        .from('chat_mensajes')
        .insert(userPayload)
        .select()
        .single();
      if (!errUser && userMsg) {
        userMsgId = userMsg.id;
        setMensajes((prev) => [...prev, userMsg]);
      } else {
        setMensajes((prev) => [...prev, { ...userPayload, id: Date.now() }]);
      }
    } catch (eUser) {
      console.warn('Error guardando mensaje user:', eUser);
      setMensajes((prev) => [...prev, { ...userPayload, id: Date.now() }]);
    }

    // 2) Armar contexto en vivo completo de Supabase
    const liveContext = {
      rodeos,
      potreros,
      tareas,
      lluvias: registrosLluvias,
      insumos,
      maquinaria,
      ventas,
      gastos,
      laboresSiembras,
      cuadernoVet,
      movimientosPactados,
      fechaOperacion,
      dolarRef,
      dolarModoManual,
      preciosHacienda,
      moduloActivo: activeTab || 'general',
      caminosEstado,
      isSandboxMode,
    };

    // 3) Consultar al motor Gemini Pro
    try {
      const { respuestaTexto, propuestaJson } = await enviarMensajeCopilotoSanJose({
        messages: mensajes,
        nuevoMensaje: {
          texto: textoAEnviar,
          archivos: currentAttached.map((a) => ({
            base64: a.base64,
            mimeType: a.mimeType,
            name: a.name,
          })),
        },
        context: liveContext,
        model: GEMINI_PRO_MODEL,
      });

      // 4) Guardar respuesta de la IA en Supabase
      const modelPayload = {
        topico_id: currentTopicoId,
        rol: 'model',
        contenido: respuestaTexto,
        propuesta_json: propuestaJson,
        estado_propuesta: propuestaJson ? 'PENDIENTE' : null,
        creado_en: new Date().toISOString(),
      };

      const { data: modelMsg, error: errModel } = await supabase
        .from('chat_mensajes')
        .insert(modelPayload)
        .select()
        .single();

      if (!errModel && modelMsg) {
        setMensajes((prev) => [...prev, modelMsg]);
      } else {
        setMensajes((prev) => [...prev, { ...modelPayload, id: Date.now() + 1 }]);
      }

      // Actualizar fecha del tópico
      try {
        await supabase
          .from('chat_topicos')
          .update({ actualizado_en: new Date().toISOString() })
          .eq('id', currentTopicoId);
      } catch (_) {}
    } catch (err) {
      console.error('Error al consultar Copiloto San José:', err);
      const errTexto = `⚠️ ${formatGeminiErrorMessage(err)}`;
      setMensajes((prev) => [
        ...prev,
        {
          id: Date.now() + 2,
          topico_id: currentTopicoId,
          rol: 'model',
          contenido: errTexto,
          creado_en: new Date().toISOString(),
        },
      ]);
      notify?.(errTexto, 'error');
    } finally {
      setSending(false);
    }
  };

  // 7. APLICAR PROPUESTA CONFIRMADA POR EL USUARIO EN SUPABASE
  const handleConfirmarPropuesta = async (msgId, propuesta) => {
    if (!propuesta || !propuesta.operaciones) return;
    setAplicandoPropuestaMsgId(msgId);

    try {
      // AIRBAG AUTOMÁTICO: Respaldo previo a aplicar cambios sugeridos por IA
      try {
        const tituloSnapshot = `Auto Pre-IA: ${propuesta.titulo || propuesta.tipo || 'Acción confirmada'}`;
        await crearSystemSnapshot({
          titulo: tituloSnapshot,
          tipo: 'AUTO_PRE_IA',
        });
      } catch (airbagErr) {
        console.warn('Aviso: no se pudo crear el respaldo automático Airbag Pre-IA:', airbagErr);
      }

      const operaciones = propuesta.operaciones;

      for (const op of operaciones) {
        const tabla = op.tabla;
        let accion = op.accion;
        let valores = { ...(op.valores || {}) };

        // Si el usuario editó algún campo en la UI antes de confirmar, incorporar los cambios
        if (editedPropuestaData[msgId]) {
          valores = { ...valores, ...editedPropuestaData[msgId] };
        }

        // 1. RODEOS: Si es una actualización de terneros en rodeos, asegurar que TOT = M + H
        if (tabla === 'rodeos' && (valores.terneros_machos != null || valores.terneros_hembras != null)) {
          const m = parseInt(valores.terneros_machos, 10) || 0;
          const h = parseInt(valores.terneros_hembras, 10) || 0;
          if (m + h > 0) {
            valores.terneros = m + h;
          }
          valores.fecha_actualizacion = fechaOperacion || new Date().toISOString().slice(0, 10);
        }

        // 2. INSUMOS: Descuento relativo de stock o actualización de inventario
        if (tabla === 'stock_insumos') {
          if (accion === 'descontar' || valores.descontar_cantidad != null) {
            const insId = op.filtro?.id || op.id || valores.id;
            const insActual = insumos.find((i) => i.id === insId);
            const cantActual = Number(insActual?.cantidad_actual ?? insActual?.stock_campo) || 0;
            const cantADescontar = Number(valores.descontar_cantidad || valores.cantidad) || 0;
            const nuevoStock = Math.max(0, cantActual - cantADescontar);
            valores.cantidad_actual = nuevoStock;
            valores.stock_campo = nuevoStock;
            delete valores.descontar_cantidad;
            delete valores.cantidad;
            accion = 'update';
          }
        }

        // 3. GASTOS: Normalización de montos y moneda
        if (tabla === 'gastos_campo') {
          if (valores.monto_original != null) valores.monto_original = Number(valores.monto_original);
          if (valores.tipo_cambio != null) valores.tipo_cambio = Number(valores.tipo_cambio) || Number(dolarRef) || 1540;
          if (!valores.tipo_cambio) valores.tipo_cambio = Number(dolarRef) || 1540;
          if (!valores.moneda_carga) valores.moneda_carga = 'ARS';
          if (valores.monto_ars == null && valores.monto_original != null) {
            valores.monto_ars = valores.moneda_carga === 'USD' ? valores.monto_original * valores.tipo_cambio : valores.monto_original;
          }
          if (valores.monto_usd == null && valores.monto_original != null) {
            valores.monto_usd = valores.moneda_carga === 'ARS' ? valores.monto_original / valores.tipo_cambio : valores.monto_original;
          }
          if (!valores.fecha) valores.fecha = fechaOperacion || new Date().toISOString().slice(0, 10);
          if (!valores.estado_pago) valores.estado_pago = 'Pendiente';
          if (!valores.rubro) valores.rubro = 'Sanidad';
          if (!valores.concepto) valores.concepto = 'Gasto operativo San José';
        }

        // 4. CUADERNO VETERINARIO: Formato de notas clínicas
        if (tabla === 'cuaderno_veterinario') {
          if (!valores.fecha) valores.fecha = fechaOperacion || new Date().toISOString().slice(0, 10);
          if (!valores.veterinario) valores.veterinario = 'Veterinario San José';
          if (!valores.tipo_labor) valores.tipo_labor = 'Tratamiento Sanitario';
        }

        // 5. MOVIMIENTOS PACTADOS: Formato de órdenes de hacienda
        if (tabla === 'movimientos_pactados') {
          if (!valores.fecha_pactada) valores.fecha_pactada = fechaOperacion || new Date().toISOString().slice(0, 10);
          if (!valores.estado) valores.estado = 'Pendiente';
          if (valores.cantidad_cabezas != null) valores.cantidad_cabezas = Number(valores.cantidad_cabezas);
        }

        // 6. REGISTROS LLUVIAS: Formato de milímetros
        if (tabla === 'registros_lluvias') {
          if (!valores.fecha) valores.fecha = fechaOperacion || new Date().toISOString().slice(0, 10);
          if (valores.milimetros != null) valores.milimetros = Number(valores.milimetros);
          if (!valores.pluviometro) valores.pluviometro = 'Casco';
        }

        // 7. MAQUINARIA SERVICES: Formato de services
        if (tabla === 'maquinaria_services') {
          if (!valores.fecha) valores.fecha = fechaOperacion || new Date().toISOString().slice(0, 10);
          if (valores.costo_usd != null) valores.costo_usd = Number(valores.costo_usd);
          if (valores.costo_ars != null) valores.costo_ars = Number(valores.costo_ars);
        }

        // 8. SIEMBRAS: Sanitizar campos y evitar columna GENERATED ALWAYS costo_total
        if (tabla === 'labores_siembras') {
          delete valores.costo_total;

          if (valores.potrero_numero != null) valores.potrero_numero = Number(valores.potrero_numero);
          if (valores.hectareas != null) valores.hectareas = Number(valores.hectareas);
          if (valores.ha_sembradas != null) {
            valores.ha_sembradas = Number(valores.ha_sembradas);
          } else if (valores.hectareas != null) {
            valores.ha_sembradas = valores.hectareas;
          }
          if (valores.costo_insumos_usd != null) valores.costo_insumos_usd = Number(valores.costo_insumos_usd) || 0;
          if (valores.costo_labores_usd != null) valores.costo_labores_usd = Number(valores.costo_labores_usd) || 0;
          if (valores.costo_total_usd != null) {
            valores.costo_total_usd = Number(valores.costo_total_usd);
          } else {
            valores.costo_total_usd = (valores.costo_insumos_usd || 0) + (valores.costo_labores_usd || 0);
          }
          valores.costo_semilla = 0;
          valores.costo_fertilizante = 0;
          valores.costo_fumigacion = 0;
          valores.costo_mano_obra = 0;
          valores.moneda = 'USD';
          valores.tipo_cambio = Number(dolarRef) || 1540;
          if (!valores.fecha) valores.fecha = fechaOperacion || new Date().toISOString().slice(0, 10);
          if (!valores.vigencia) valores.vigencia = 'Activa';
          if (!valores.campana) valores.campana = '2026/2027';
          if (!valores.estado) valores.estado = 'Sembrado';
        }

        if (accion === 'update') {
          let query = supabase.from(tabla).update(valores);
          if (op.filtro) {
            Object.entries(op.filtro).forEach(([k, v]) => {
              query = query.eq(k, v);
            });
          } else if (op.id) {
            query = query.eq('id', op.id);
          }
          const { error } = await query;
          if (error) throw error;
        } else if (accion === 'insert') {
          const { error } = await supabase.from(tabla).insert(valores);
          if (error) throw error;
        }

        // Si es siembra activa con potrero asignado, sincronizar la cobertura del potrero
        if (tabla === 'labores_siembras' && valores.potrero_numero && valores.vigencia !== 'Histórica') {
          try {
            await supabase
              .from('potreros')
              .update({
                cultivo_actual: valores.cultivo_variedad || 'Cultivo',
                recurso_forrajero: valores.cultivo_variedad || 'Cultivo',
                ha_sembradas: valores.ha_sembradas || valores.hectareas,
                fecha_siembra: valores.fecha,
              })
              .eq('numero', Number(valores.potrero_numero));
          } catch (pErr) {
            console.warn('Error sincronizando potrero con siembra:', pErr);
          }
        }
      }

      // Marcar propuesta como APLICADA en chat_mensajes
      await supabase
        .from('chat_mensajes')
        .update({ estado_propuesta: 'APLICADA' })
        .eq('id', msgId);

      setMensajes((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, estado_propuesta: 'APLICADA' } : m
        )
      );

      notify?.(
        `✓ Cambios aplicados en Supabase: "${propuesta.titulo || 'Actualización'}"`,
        'success'
      );
      await onRefresh?.();
    } catch (err) {
      console.error('Error aplicando propuesta en Supabase:', err);
      notify?.(`Error al aplicar propuesta: ${err.message}`, 'error');
    } finally {
      setAplicandoPropuestaMsgId(null);
    }
  };

  // 8. Descartar propuesta
  const handleDescartarPropuesta = async (msgId) => {
    try {
      await supabase
        .from('chat_mensajes')
        .update({ estado_propuesta: 'DESCARTADA' })
        .eq('id', msgId);

      setMensajes((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, estado_propuesta: 'DESCARTADA' } : m
        )
      );
      notify?.('Propuesta descartada.');
    } catch (err) {
      console.warn('Error descartando propuesta:', err);
    }
  };

  // Copiar texto al portapapeles con feedback
  const handleCopyMessageText = (text, msgId) => {
    if (!text) return;
    try {
      const textLimpio = limpiarDelimitadoresHuerfanos(
        sanitizarLatex(text)
          .replace(/(?::{3,}|\`{1,3})(infografia|svg|kpi|chart)\s*([\s\S]*?)(?::{3,}|\`{1,3})/gi, '')
      );

      navigator.clipboard.writeText(textLimpio || text);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
      notify?.('Texto copiado al portapapeles', 'success');
    } catch {
      notify?.('No se pudo copiar al portapapeles', 'warning');
    }
  };

  // Exportar y descargar mensaje del Copiloto a formato PDF A4 oficial directo (sin window.print ni popups)
  const handleExportMessagePdf = async (msg) => {
    if (!msg || !msg.contenido) return;
    try {
      await exportarInformeCopilotoPDF({
        msg,
        dolarRef,
        fechaOperacion,
      });
      notify?.('✓ PDF ejecutivo A4 descargado con éxito', 'success');
    } catch (err) {
      console.error('Error al exportar PDF:', err);
      notify?.(`Error al exportar PDF: ${err.message}`, 'error');
    }
  };

  // Extraer artefactos visuales e infografías presentes en la conversación
  const artefactosVisuales = useMemo(() => {
    const list = [];
    mensajes.forEach((m) => {
      if (m.rol === 'user' || !m.contenido) return;
      const infoMatch = m.contenido.match(/(?:(?:::infografia|```infografia)\s*([\s\S]*?)(?:::|```))/i);
      let parsed = null;
      if (infoMatch && infoMatch[1]) {
        try {
          let clean = infoMatch[1].replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          clean = clean.replace(/:::+$/, '').trim();
          parsed = JSON.parse(clean);
        } catch {}
      }

      const tieneTablas =
        m.contenido.includes('|---') ||
        m.contenido.includes('| :---') ||
        m.contenido.includes('|:---');
      const tieneKpi = m.contenido.includes(':::kpi');
      const tieneChart = m.contenido.includes(':::chart');

      if (parsed || tieneTablas || tieneKpi || tieneChart) {
        list.push({
          id: m.id,
          mensaje: m,
          infografia: parsed,
          titulo:
            parsed?.titulo ||
            m.contenido.match(/^#+\s*(.+)$/m)?.[1]?.replace(/\*\*/g, '') ||
            `Informe Ejecutivo #${m.id}`,
          subtitulo:
            parsed?.subtitulo ||
            new Date(m.creado_en || Date.now()).toLocaleTimeString('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          fecha: m.creado_en,
        });
      }
    });
    return list;
  }, [mensajes]);

  // Artefacto activo para visualizar en el Lienzo Derecho
  const activeArtefacto = useMemo(() => {
    if (artefactosVisuales.length === 0) return null;
    if (
      selectedArtefactoIdx != null &&
      selectedArtefactoIdx >= 0 &&
      selectedArtefactoIdx < artefactosVisuales.length
    ) {
      return artefactosVisuales[selectedArtefactoIdx];
    }
    return artefactosVisuales[artefactosVisuales.length - 1];
  }, [artefactosVisuales, selectedArtefactoIdx]);

  // Barra de disparadores estratégicos de alto impacto
  const renderDisparadoresBar = () => (
    <div className="px-4 sm:px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-thin [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-slate-300">
      <div className="shrink-0 flex items-center gap-1.5 pl-0.5 pr-1 select-none">
        <Sparkles className="w-3.5 h-3.5 text-purple-700 shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-wider text-purple-950 whitespace-nowrap">
          Disparadores:
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {DISPARADORES_ESTRATEGICOS.map((disp, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              setInputText(disp.prompt);
            }}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-purple-400 hover:bg-purple-50 text-[11px] font-bold text-slate-700 hover:text-purple-950 transition shrink-0 shadow-2xs inline-flex items-center gap-1.5 cursor-pointer"
            title={disp.prompt}
          >
            <span>{disp.icono}</span>
            <span className="whitespace-nowrap">{disp.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // Hilo de mensajes de la conversación
  const renderMensajesThread = () => (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-100/50 min-h-0">
      {mensajes.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-xs">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">
              Copiloto San José Listo
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              Consultá sobre carga forrajera, escenarios de venta vs. retención, auditoría por rodeo o subí comprobantes para cruzar datos en tiempo real.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-1.5 pt-2 max-w-md">
            {DISPARADORES_ESTRATEGICOS.map((disp, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setInputText(disp.prompt)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-purple-500 text-[11px] font-semibold text-slate-700 transition shadow-2xs inline-flex items-center gap-1"
              >
                <span>{disp.icono}</span>
                <span>{disp.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        mensajes.map((msg) => {
          const esUser = msg.rol === 'user';
          const tienePropuesta = Boolean(msg.propuesta_json);

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${esUser ? 'items-end' : 'items-start'} space-y-1.5`}
            >
              {/* BURBUJA DE TEXTO */}
              <div
                className={`max-w-[95%] sm:max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${
                  esUser
                    ? 'bg-emerald-950 text-white rounded-br-xs'
                    : 'bg-white text-slate-800 border border-slate-200/90 rounded-bl-xs'
                }`}
              >
                {/* Adjuntos del mensaje (uno o varios) */}
                {Array.isArray(msg.adjuntos_json) && msg.adjuntos_json.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.adjuntos_json.map((adj, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold ${
                          esUser
                            ? 'bg-emerald-900/70 text-emerald-100 border border-emerald-700/60'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        <FileText className="w-3 h-3 text-emerald-300 shrink-0" />
                        <span className="truncate max-w-[130px]">{adj.name || `Doc ${i + 1}`}</span>
                        {adj.url && (
                          <a
                            href={adj.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-amber-300 ml-0.5"
                            title="Ver archivo"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : msg.adjunto_url && !msg.adjunto_url.startsWith('[') ? (
                  <div className="mb-2 rounded-xl overflow-hidden border border-white/20 max-h-48">
                    <img
                      src={msg.adjunto_url}
                      alt="Adjunto"
                      className="w-full h-auto object-cover"
                    />
                  </div>
                ) : null}

                <div className="font-medium text-xs sm:text-sm">
                  {renderFormattedMessage(
                    msg.contenido,
                    esUser,
                    (svg) => setSelectedSvgAmpliado(svg),
                    () => handleExportMessagePdf(msg)
                  )}
                </div>

                {!esUser ? (
                  <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleExportMessagePdf(msg)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border border-emerald-300/80 text-[10px] font-black inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-2xs"
                        title="Exportar informe oficial en PDF A4"
                      >
                        <FileText className="w-3 h-3 text-emerald-700" />
                        <span>📄 Descargar PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyMessageText(msg.contenido, msg.id)}
                        className="px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200/80 text-[10px] font-semibold inline-flex items-center gap-1 transition active:scale-95 cursor-pointer"
                        title="Copiar respuesta al portapapeles"
                      >
                        {copiedMsgId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">¡Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="text-[9px] text-slate-400 font-mono">
                      {new Date(msg.creado_en || Date.now()).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] mt-1.5 text-right font-mono text-emerald-400">
                    {new Date(msg.creado_en || Date.now()).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
              </div>

              {/* TARJETA DE PROPUESTA ESTRUCTURADA */}
              {tienePropuesta && (
                <div className="w-full max-w-[95%] sm:max-w-[90%] p-4 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 shadow-md space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-purple-200 pb-2">
                    <div className="flex items-center gap-2">
                      {msg.propuesta_json.tipo === 'NUEVA_SIEMBRA_LABOR' ? (
                        <Sprout className="w-4 h-4 text-emerald-600" />
                      ) : msg.propuesta_json.tipo === 'TRATAMIENTO_SANITARIO' ? (
                        <CheckCircle2 className="w-4 h-4 text-teal-600" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-purple-700" />
                      )}
                      <span className="text-[11px] font-black uppercase tracking-wider text-purple-900">
                        {msg.propuesta_json.tipo === 'NUEVA_SIEMBRA_LABOR'
                          ? '🌱 Propuesta de Siembra y Labores Agronómicas'
                          : msg.propuesta_json.tipo === 'TRATAMIENTO_SANITARIO'
                          ? '🩺 Tratamiento Sanitario y Descuento de Stock'
                          : msg.propuesta_json.tipo === 'REGISTRAR_GASTO'
                          ? '💵 Registro de Gasto Operativo'
                          : msg.propuesta_json.tipo === 'MOVIMIENTO_HACIENDA'
                          ? '⇄ Orden de Movimiento de Hacienda'
                          : msg.propuesta_json.tipo === 'ACTUALIZAR_RODEO'
                          ? '🐄 Actualización de Rodeo'
                          : 'Propuesta de Acción en Base de Datos'}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        msg.estado_propuesta === 'APLICADA'
                          ? 'bg-emerald-700 text-white'
                          : msg.estado_propuesta === 'DESCARTADA'
                          ? 'bg-slate-300 text-slate-700'
                          : 'bg-amber-400 text-slate-950 animate-pulse'
                      }`}
                    >
                      {msg.estado_propuesta === 'APLICADA'
                        ? '✅ APLICADA'
                        : msg.estado_propuesta === 'DESCARTADA'
                        ? '✕ DESCARTADA'
                        : '⏳ REQUIERE CONFIRMACIÓN'}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900">
                      {msg.propuesta_json.titulo || 'Actualización de Datos'}
                    </h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {msg.propuesta_json.resumen}
                    </p>
                  </div>

                  {msg.propuesta_json.datos && (
                    <div className="p-3 bg-white rounded-xl border border-purple-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Valores Cruce / Detectados:
                        </span>
                        {Object.values(msg.propuesta_json.datos).some(
                          (v) => v === '' || v == null || String(v).toLowerCase().includes('falta')
                        ) && (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                            ⚠️ Hay campos para completar en amarillo
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Object.entries(msg.propuesta_json.datos).map(([k, val]) => {
                          const isMissing =
                            val === '' ||
                            val == null ||
                            String(val).toLowerCase().includes('falta');
                          return (
                            <div
                              key={k}
                              className={`flex items-center justify-between gap-1.5 p-1.5 rounded-lg border transition ${
                                isMissing
                                  ? 'bg-amber-50/90 border-amber-400'
                                  : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-1">
                                <span className="font-semibold text-slate-700 capitalize text-[11px] truncate">
                                  {k.replace(/_/g, ' ')}:
                                </span>
                                {isMissing && (
                                  <span className="text-[9px] font-black text-amber-700 bg-amber-200 px-1 rounded shrink-0">
                                    Falta
                                  </span>
                                )}
                              </div>
                              <input
                                type="text"
                                defaultValue={val || ''}
                                placeholder={isMissing ? 'Completar...' : ''}
                                disabled={msg.estado_propuesta !== 'PENDIENTE' && msg.estado_propuesta != null}
                                onChange={(e) => {
                                  setEditedPropuestaData((prev) => ({
                                    ...prev,
                                    [msg.id]: {
                                      ...(prev[msg.id] || {}),
                                      [k]: e.target.value,
                                    },
                                  }));
                                }}
                                className={`w-28 px-2 py-0.5 rounded text-right font-black text-xs ${
                                  isMissing
                                    ? 'bg-amber-100 border-2 border-amber-400 text-amber-950 placeholder-amber-700 focus:bg-white'
                                    : 'border border-purple-300 text-slate-900 bg-white'
                                }`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {(!msg.estado_propuesta || msg.estado_propuesta === 'PENDIENTE') && (
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-purple-200">
                      <button
                        type="button"
                        onClick={() => handleDescartarPropuesta(msg.id)}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
                      >
                        Descartar
                      </button>
                      <button
                        type="button"
                        disabled={aplicandoPropuestaMsgId === msg.id}
                        onClick={() => handleConfirmarPropuesta(msg.id, msg.propuesta_json)}
                        className={`px-4 py-1.5 rounded-xl text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                          msg.propuesta_json.tipo === 'NUEVA_SIEMBRA_LABOR'
                            ? 'bg-emerald-700 hover:bg-emerald-600'
                            : msg.propuesta_json.tipo === 'TRATAMIENTO_SANITARIO'
                            ? 'bg-teal-700 hover:bg-teal-600'
                            : 'bg-purple-900 hover:bg-purple-800'
                        }`}
                      >
                        {msg.propuesta_json.tipo === 'NUEVA_SIEMBRA_LABOR' ? (
                          <Sprout className="w-4 h-4 text-emerald-200" />
                        ) : msg.propuesta_json.tipo === 'TRATAMIENTO_SANITARIO' ? (
                          <CheckCircle2 className="w-4 h-4 text-teal-200" />
                        ) : (
                          <Check className="w-4 h-4 text-purple-300" />
                        )}
                        <span>
                          {aplicandoPropuestaMsgId === msg.id
                            ? 'Aplicando...'
                            : msg.propuesta_json.tipo === 'NUEVA_SIEMBRA_LABOR'
                            ? '✓ Confirmar y Cargar en Siembras'
                            : msg.propuesta_json.tipo === 'TRATAMIENTO_SANITARIO'
                            ? '✓ Confirmar Tratamiento y Descontar Stock'
                            : msg.propuesta_json.tipo === 'REGISTRAR_GASTO'
                            ? '✓ Confirmar y Asentar Gasto'
                            : msg.propuesta_json.tipo === 'MOVIMIENTO_HACIENDA'
                            ? '✓ Confirmar Orden de Movimiento'
                            : msg.propuesta_json.tipo === 'ACTUALIZAR_RODEO'
                            ? '✓ Confirmar y Actualizar Rodeo'
                            : '✓ Confirmar y Aplicar en Base de Datos'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {sending && (
        <div className="flex items-center gap-2 p-3 bg-white rounded-2xl border border-slate-200 w-fit text-xs text-slate-600 animate-pulse">
          <Sparkles className="w-4 h-4 text-purple-600 animate-spin" />
          <span>Copiloto analizando variables agronómicas y financieras...</span>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );

  // Barra de entrada y formulario (con soporte multi-línea en Full IA)
  const renderInputBar = () => (
    <div className="shrink-0 bg-white border-t border-slate-200">
      {/* Preview de adjuntos */}
      {attachedFiles.length > 0 && (
        <div className="px-4 py-2 bg-purple-50/90 border-b border-purple-200 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-purple-700" />
              <span className="text-[11px] font-black uppercase tracking-wider text-purple-900">
                {attachedFiles.length}{' '}
                {attachedFiles.length === 1
                  ? 'documento adjunto'
                  : 'documentos adjuntos para cruce simultáneo'}
              </span>
              {processingFiles && (
                <RefreshCw className="w-3 h-3 text-purple-600 animate-spin" />
              )}
            </div>
            <button
              type="button"
              onClick={handleClearFiles}
              className="text-[10px] text-purple-700 hover:text-red-600 font-bold hover:underline cursor-pointer"
            >
              Quitar todos
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            {attachedFiles.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-1.5 pr-2.5 bg-white rounded-xl border border-purple-200 shadow-2xs shrink-0 max-w-[210px]"
              >
                {item.preview ? (
                  <img
                    src={item.preview}
                    alt={item.name}
                    className="w-8 h-8 rounded-lg object-cover border border-purple-300 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-purple-700" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-extrabold text-slate-900 truncate block">
                    {item.name}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    {(item.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(item.id)}
                  className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer shrink-0"
                  title="Quitar este archivo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulario de entrada */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 flex items-end gap-2"
      >
        <div className="flex items-center gap-1 shrink-0 pb-1">
          <label
            className="p-2.5 rounded-xl border border-slate-300 hover:border-purple-600 text-slate-600 hover:text-purple-700 hover:bg-purple-50 transition cursor-pointer"
            title="Adjuntar comprobantes, remitos, fotos o recetas"
          >
            <Camera className="w-4 h-4" />
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>

          <button
            type="button"
            onClick={toggleRecording}
            className={`p-2.5 rounded-xl border transition cursor-pointer ${
              isRecording
                ? 'bg-red-600 text-white border-red-700 animate-pulse'
                : 'border-slate-300 hover:border-purple-600 text-slate-600 hover:text-purple-700 hover:bg-purple-50'
            }`}
            title={isRecording ? 'Detener dictado' : 'Dictar por voz'}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>

        {isFullIaMode ? (
          <textarea
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
            placeholder={
              isRecording
                ? 'Escuchando dictado...'
                : 'Escribí tu hipótesis, consulta o escenario a simular en San José... (Shift + Enter para salto de línea)'
            }
            className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-600 text-slate-900 resize-none max-h-32 min-h-[50px]"
          />
        ) : (
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isRecording
                ? 'Escuchando dictado...'
                : 'Escribí tu consulta al Copiloto...'
            }
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-600 text-slate-900"
          />
        )}

        <button
          type="submit"
          disabled={sending || (!inputText.trim() && attachedFiles.length === 0)}
          className="p-2.5 rounded-xl bg-purple-950 hover:bg-purple-900 text-white font-bold transition disabled:opacity-40 cursor-pointer shrink-0 shadow-sm mb-0.5"
          title="Enviar al Copiloto"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );

  // Renderizado del Lienzo Visual / Pizarra Estratégica (Panel Derecho en Full IA)
  const renderLienzoVisual = () => {
    const totalArtefactos = artefactosVisuales.length;
    const currentIdx =
      selectedArtefactoIdx != null &&
      selectedArtefactoIdx >= 0 &&
      selectedArtefactoIdx < totalArtefactos
        ? selectedArtefactoIdx
        : totalArtefactos - 1;

    const tieneArtefacto = Boolean(activeArtefacto);

    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Cabecera del Lienzo */}
        <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <h3 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wide truncate">
                {activeArtefacto?.titulo || 'Lienzo Visual & Pizarra Estratégica'}
              </h3>
            </div>
            <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
              {activeArtefacto?.subtitulo ||
                'Proyecciones ejecutivas, balances forrajeros e infografías en alta resolución'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Navegación entre artefactos */}
            {totalArtefactos > 1 && (
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-0.5 border border-slate-200">
                <button
                  type="button"
                  disabled={currentIdx <= 0}
                  onClick={() => setSelectedArtefactoIdx(Math.max(0, currentIdx - 1))}
                  className="p-1 rounded-lg hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                  title="Informe anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[10px] font-mono font-bold px-1.5 text-slate-700">
                  {currentIdx + 1} / {totalArtefactos}
                </span>
                <button
                  type="button"
                  disabled={currentIdx >= totalArtefactos - 1}
                  onClick={() =>
                    setSelectedArtefactoIdx(Math.min(totalArtefactos - 1, currentIdx + 1))
                  }
                  className="p-1 rounded-lg hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                  title="Informe siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {tieneArtefacto && (
              <>
                <button
                  type="button"
                  onClick={() => handleExportMessagePdf(activeArtefacto.mensaje)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
                  title="Exportar informe activo en PDF A4 oficial"
                >
                  <FileText className="w-3.5 h-3.5 text-white" />
                  <span className="hidden sm:inline">📄 Descargar PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleCopyMessageText(activeArtefacto.mensaje.contenido, activeArtefacto.id)
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-xs inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                  title="Copiar texto y datos de este informe"
                >
                  {copiedMsgId === activeArtefacto.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">¡Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span className="hidden sm:inline">📋 Copiar Resumen</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Cuerpo del Lienzo con scroll propio */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {tieneArtefacto ? (
            <div className="space-y-4 max-w-4xl mx-auto">
              {activeArtefacto.infografia ? (
                <InfografiaCopiloto
                  data={activeArtefacto.infografia}
                  keyPrefix={`lienzo-${activeArtefacto.id}`}
                  onExportPdf={() => handleExportMessagePdf(activeArtefacto.mensaje)}
                />
              ) : null}

              {(() => {
                const cleanContent = limpiarDelimitadoresHuerfanos(
                  sanitizarLatex(activeArtefacto.mensaje?.contenido || '')
                    .replace(/(?::{3,}|\`{1,3})(infografia|svg|kpi|chart)\s*([\s\S]*?)(?::{3,}|\`{1,3})/gi, '')
                );

                if (!cleanContent) return null;

                return (
                  <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Detalle Analítico & Tablas Comparativas
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(activeArtefacto.fecha || Date.now()).toLocaleTimeString('es-AR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-xs sm:text-sm leading-relaxed text-slate-800">
                      {renderTextWithMarkdown(cleanContent)}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="h-full min-h-[380px] flex flex-col items-center justify-center text-center p-6 sm:p-10 rounded-3xl border-2 border-dashed border-slate-200 bg-white/60">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-800 to-slate-900 flex items-center justify-center text-white shadow-lg mb-4">
                <Compass className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
                Sala de Estrategia San José
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-1.5 leading-relaxed">
                Este lienzo proyectará en gran formato las infografías ejecutivas, matrices de rotación de potreros, simulaciones financieras y comparativas por rodeo generadas por el Copiloto.
              </p>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg w-full text-left">
                {DISPARADORES_ESTRATEGICOS.map((disp, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setInputText(disp.prompt);
                    }}
                    className="p-3 rounded-2xl bg-white hover:bg-emerald-50/80 border border-slate-200 hover:border-emerald-400 transition shadow-2xs group cursor-pointer"
                  >
                    <div className="text-base mb-1">{disp.icono}</div>
                    <div className="text-xs font-black text-slate-800 group-hover:text-emerald-950">
                      {disp.label}
                    </div>
                    <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 leading-tight">
                      {disp.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* BACKDROP SEMITRANSPARENTE OSCURO (solo si no está en Full IA) */}
      {!isFullIaMode && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200 cursor-pointer"
          onClick={onClose}
        />
      )}

      {/* CONTENEDOR PRINCIPAL: PANTALLA COMPLETA O DRAWER LATERAL */}
      <div
        className={
          isFullIaMode
            ? 'fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden animate-in fade-in duration-200'
            : 'fixed inset-y-0 right-0 z-50 w-full sm:w-[540px] md:w-[620px] lg:w-[680px] bg-white shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-250'
        }
      >
        {/* CABECERA PRINCIPAL */}
        <div className="px-4 sm:px-6 py-3 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-black tracking-tight text-white flex items-center gap-1.5 truncate">
                  <span>Copiloto San José</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-900/90 text-purple-200 border border-purple-700">
                    Gemini Pro
                  </span>
                </h2>
                {isFullIaMode && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Sala de Estrategia</span>
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                {isFullIaMode
                  ? 'Modo Full IA · Lienzo Visual en Vivo · Las Flores (2.068 ha)'
                  : 'Memoria contextual viva · Las Flores (2.068 ha)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsFullIaMode((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl font-black text-xs inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-sm ${
                isFullIaMode
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 border border-amber-300'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
              title={
                isFullIaMode
                  ? 'Volver a panel lateral'
                  : 'Desplegar a pantalla completa en Modo Full IA / Sala de Estrategia'
              }
            >
              {isFullIaMode ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>🗗 Vista Lateral</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>⛶ Modo Full IA</span>
                </>
              )}
            </button>

            {/* Botón discreto Limpiar chat */}
            <button
              type="button"
              onClick={handleClearChat}
              disabled={mensajes.length === 0}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-rose-500/20 text-slate-300 hover:text-rose-200 border border-white/5 hover:border-rose-400/40 transition text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Vaciar historial del chat e iniciar una conversación limpia"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Limpiar chat</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
              title="Cerrar Copiloto"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Selector de pestañas móvil (< md) en Modo Full IA */}
        {isFullIaMode && (
          <div className="flex md:hidden bg-slate-900 border-b border-slate-800 px-3 py-1.5 gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileFullTab('chat')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                mobileFullTab === 'chat'
                  ? 'bg-purple-900 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              💬 Diálogo ({mensajes.length})
            </button>
            <button
              type="button"
              onClick={() => setMobileFullTab('lienzo')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                mobileFullTab === 'lienzo'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🖼️ Lienzo Visual {artefactosVisuales.length > 0 ? `(${artefactosVisuales.length})` : ''}
            </button>
          </div>
        )}

        {/* CUERPO PRINCIPAL: VISTA DIVIDIDA (FULL IA) O DRAWER UNIFICADO */}
        {isFullIaMode ? (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden bg-slate-100">
            {/* PANEL IZQUIERDO: CONVERSACIÓN & BRAINSTORMING (md:col-span-5) */}
            <div
              className={`md:col-span-5 flex flex-col min-h-0 bg-white border-r border-slate-200 ${
                mobileFullTab === 'lienzo' ? 'hidden md:flex' : 'flex'
              }`}
            >
              {renderDisparadoresBar()}
              {renderMensajesThread()}
              {renderInputBar()}
            </div>

            {/* PANEL DERECHO: LIENZO VISUAL & PIZARRA ESTRATÉGICA (md:col-span-7) */}
            <div
              className={`md:col-span-7 flex flex-col min-h-0 bg-slate-50/90 overflow-hidden ${
                mobileFullTab === 'chat' ? 'hidden md:flex' : 'flex'
              }`}
            >
              {renderLienzoVisual()}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-100">
            {renderDisparadoresBar()}
            {renderMensajesThread()}
            {renderInputBar()}
          </div>
        )}
      </div>
      {/* MODAL PARA AMPLIAR SVG EN PANTALLA COMPLETA */}
      {selectedSvgAmpliado && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="font-black text-slate-900 text-sm flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-emerald-700" />
                Diagrama en Pantalla Completa
              </span>
              <button
                type="button"
                onClick={() => setSelectedSvgAmpliado(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 cursor-pointer"
                title="Cerrar vista ampliada"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              className="w-full overflow-x-auto flex justify-center py-2"
              dangerouslySetInnerHTML={{ __html: selectedSvgAmpliado }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
