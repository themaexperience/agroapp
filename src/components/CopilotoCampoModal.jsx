import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  Send,
  Mic,
  MicOff,
  X,
  Sparkles,
  Key,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  CloudRain,
  ArrowRightLeft,
  ClipboardList,
  Trash2,
  FileText,
  FileDown,
  Fuel,
  Plus,
  Save,
  BookOpen,
  UploadCloud,
  Check,
  Layers,
  Award,
  RotateCcw,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { confirmAction } from './ConfirmDialog.jsx';
import { InfografiaCopiloto } from './CopilotoSanJoseDrawer.jsx';
import { exportarInformeCopilotoPDF, parseExecutiveJsonData } from '../utils/pdfExport.js';
import {
  hasGeminiKey,
  getGeminiApiKey,
  setGeminiApiKey,
  copilotoCampoChat,
  analizarInformeRecorrida,
  testGeminiConnection,
  isProduction,
  formatGeminiErrorMessage,
  calcularProtocoloVivo,
  inferirRolProtocolo,
  ROLES_PROTOCOLO,
} from '../lib/geminiService';
import { supabase } from '../lib/supabase';
import {
  getSanJoseLogoDataUrl,
} from '../utils/pdfHelper';
import { APRENDIZAJES_FUNDACIONALES_SAN_JOSE } from '../data/aprendizajesFundacionales.js';

// Sanitizador integral para chat y exportación a PDF
export function sanitizeTextForDisplayAndPdf(text) {
  if (!text) return '';
  let res = text;

  // 1. Quitar delimitadores LaTeX con signos de pesos ($...$, $$...$$, \$...\$)
  // E.g. $12/11/2026$ -> 12/11/2026, $46$ -> 46, $1.2 EV/ha$ -> 1.2 EV/ha
  res = res.replace(/\\?\$\$(?!\s)([^\$\n]+?)(?<!\s)\\?\$\$/g, '$1');
  res = res.replace(/\\?\$(?!\s)([^\$\n]+?)(?<!\s)\\?\$/g, '$1');
  // Escapes huérfanos
  res = res.replace(/\\\$/g, '$');
  // Signo $ pegado a fechas sueltas $12/11 o $12/11/2026
  res = res.replace(/\$(?=\d{1,2}\/\d{1,2})/g, '');

  // 2. Mapear emojis conocidos a etiquetas legibles entre corchetes
  const emojiMap = [
    [/[\u{1F6A8}\u{26A0}\u{2757}\u{203C}\u{274C}\u{274E}]/gu, '[ALERTA] '],
    [/[\u{2705}\u{2714}\u{2713}\u{1F7E2}]/gu, '[OK] '],
    [/[\u{1F4CC}\u{1F3AF}\u{2B50}\u{26A1}\u{1F525}]/gu, '[PRIORIDAD] '],
    [/[\u{1F404}\u{1F402}\u{1F40E}\u{1F411}]/gu, '[RODEO] '],
    [/[\u{1F4A7}\u{1F6B0}\u{1F30A}\u{1F327}\u{2614}]/gu, '[AGUA] '],
    [/[\u{1F33E}\u{1F331}\u{1F33F}\u{1F69C}]/gu, '[CAMPO] '],
    [/[\u{1F4CA}\u{1F4C8}\u{1F4C9}\u{1F4D1}\u{1F4C4}\u{1F4CB}\u{1F4DD}]/gu, '[INFORME] '],
    [/[\u{1F5D3}\u{1F4C5}\u{1F4C6}]/gu, '[FECHA] '],
    [/[\u{1F4A1}\u{1F50D}\u{1F50E}]/gu, '[NOTA] '],
    [/[\u{1F916}\u{2728}\u{1F4AC}]/gu, ''],
  ];

  for (const [regex, replacement] of emojiMap) {
    res = res.replace(regex, replacement);
  }

  // 3. Remover cualquier emoji Unicode residual para que jsPDF no genere caracteres corruptos
  res = res.replace(
    /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA70}-\u{1FAFF}]/gu,
    ''
  );

  // 4. Normalizar espacios múltiples
  res = res.replace(/[ \t]{2,}/g, ' ');

  return res;
}

export function stripMarkdownForPdf(str) {
  if (!str) return '';
  return str
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*]+?)\*/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();
}

function isTableRow(line) {
  const t = line ? line.trim() : '';
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
}

function parseTableRowCells(line) {
  const trimmed = line ? line.trim() : '';
  const inner = trimmed.slice(1, -1);
  return inner.split('|').map((c) => c.trim());
}

function isTableSeparator(line) {
  const cells = parseTableRowCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function formatInline(text) {
  if (!text) return text;
  const parts = [];
  let keyIdx = 0;
  // Soporta **negrita**, *cursiva*, `código`
  const regex = /(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const boldText = token.slice(2, -2);
      parts.push(
        <strong key={`b-${keyIdx++}`} className="font-extrabold text-slate-900">
          {boldText}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const italicText = token.slice(1, -1);
      parts.push(
        <em key={`i-${keyIdx++}`} className="italic text-slate-800">
          {italicText}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const codeText = token.slice(1, -1);
      parts.push(
        <code
          key={`c-${keyIdx++}`}
          className="font-mono text-[11px] bg-emerald-50 text-emerald-900 px-1 py-0.5 rounded border border-emerald-200/60"
        >
          {codeText}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function MarkdownRenderer({ text }) {
  if (!text) return null;

  const cleanText = sanitizeTextForDisplayAndPdf(text);
  const rawLines = cleanText.split('\n');
  const elements = [];
  let currentList = [];
  let keyCounter = 0;

  function flushList() {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`ul-${keyCounter++}`} className="space-y-1.5 my-1.5 pl-0.5">
          {currentList.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs text-slate-800 leading-relaxed">
              {item.isNumber ? (
                <span className="font-mono font-black text-[10px] text-emerald-800 bg-emerald-100/90 border border-emerald-200 px-1.5 py-0.2 rounded-md shrink-0 mt-0.5">
                  {item.num}
                </span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0 mt-1.5" />
              )}
              <span className="flex-1">{formatInline(item.text)}</span>
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushList();
      elements.push(
        <hr key={`hr-${keyCounter++}`} className="my-2.5 border-slate-200/90" />
      );
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushList();
      const hText = trimmed.replace(/^###\s+/, '').replace(/\*\*/g, '');
      elements.push(
        <h4
          key={`h4-${keyCounter++}`}
          className="text-xs font-black text-emerald-950 uppercase tracking-wide mt-3 mb-1.5 px-2.5 py-1 bg-emerald-100/60 rounded-lg border-l-3 border-emerald-700 flex items-center gap-1.5 shadow-2xs"
        >
          {formatInline(hText)}
        </h4>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      const hText = trimmed.replace(/^##\s+/, '').replace(/\*\*/g, '');
      elements.push(
        <h3
          key={`h3-${keyCounter++}`}
          className="text-sm font-black text-slate-900 mt-3.5 mb-2 px-2.5 py-1 bg-slate-100 rounded-lg border-l-4 border-slate-700 shadow-2xs"
        >
          {formatInline(hText)}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      const hText = trimmed.replace(/^#\s+/, '').replace(/\*\*/g, '');
      elements.push(
        <h2
          key={`h2-${keyCounter++}`}
          className="text-base font-black text-emerald-950 mt-4 mb-2 pb-1 border-b border-emerald-200"
        >
          {formatInline(hText)}
        </h2>
      );
      continue;
    }

    // Tablas Markdown (| col1 | col2 | ...)
    if (isTableRow(trimmed)) {
      flushList();
      const tableLines = [trimmed];
      while (i + 1 < rawLines.length && isTableRow(rawLines[i + 1])) {
        i++;
        tableLines.push(rawLines[i].trim());
      }

      if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
        const headers = parseTableRowCells(tableLines[0]);
        const dataRows = tableLines.slice(2).map(parseTableRowCells);

        elements.push(
          <div
            key={`tbl-${keyCounter++}`}
            className="my-3 overflow-x-auto rounded-xl border border-emerald-200/90 shadow-2xs bg-white"
          >
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-emerald-50/90 text-emerald-950 font-black text-[11px] border-b border-emerald-200">
                <tr>
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className="py-2.5 px-3.5 whitespace-nowrap">
                      {formatInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/80 transition">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2 px-3.5 text-slate-700 leading-relaxed whitespace-nowrap">
                        {formatInline(cell)}
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
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      currentList.push({ isNumber: false, text: bulletMatch[1] });
      continue;
    }

    const numberMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (numberMatch) {
      currentList.push({ isNumber: true, num: numberMatch[1], text: numberMatch[2] });
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${keyCounter++}`} className="my-1 text-xs text-slate-800 leading-relaxed">
        {formatInline(trimmed)}
      </p>
    );
  }

  flushList();
  return <div className="space-y-1">{elements}</div>;
}

const DEFAULT_WELCOME_MESSAGE = {
  role: 'assistant',
  text: '¡Hola! Soy el Asesor Técnico Agropecuario y Copiloto IA de Establecimiento San José (2.068,1 ha, Las Flores). Tengo sincronizados en vivo los 34 potreros, los 15 rodeos oficiales, los 29 puntos de infraestructura y el historial de lluvias. ¿En qué decisión agronómica o de manejo te puedo asesorar hoy? Podés escribir o dictarme por voz.',
};

const EXECUTIVE_ACTIONS = [
  {
    id: 'situacion',
    label: 'Análisis de situación',
    icon: '📊',
    prompt:
      'Haceme un análisis de situación completo de Establecimiento San José hoy: evaluá carga animal por potrero, rodeos con más días de estadía que convenga rotar, estado de aguadas/molinos con novedades y alertas activas.',
    theme: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border-emerald-300',
  },
  {
    id: 'reporte',
    label: 'Reporte mensual',
    icon: '📑',
    prompt:
      'Generá un reporte mensual ejecutivo del establecimiento con resumen de hacienda por categoría, movimientos registrados, lluvias acumuladas del mes, labores agrícolas y resumen de costos/insumos.',
    theme: 'bg-blue-50 hover:bg-blue-100 text-blue-950 border-blue-300',
  },
  {
    id: 'tareas',
    label: 'Repasar tareas',
    icon: '✅',
    prompt:
      'Repasá todas las tareas de campo pendientes, los vencimientos próximos del calendario sanitario y los post-its de alerta del mapa, ordenados por urgencia para organizar la semana.',
    theme: 'bg-amber-50 hover:bg-amber-100 text-amber-950 border-amber-300',
  },
  {
    id: 'rotacion',
    label: 'Sugerir rotación',
    icon: '🌿',
    prompt:
      'Analizá los potreros libres, su superficie y tipo de pastura/ambiente, y sugerime las mejores rotaciones para los rodeos que llevan más días en el mismo lote.',
    theme: 'bg-teal-50 hover:bg-teal-100 text-teal-950 border-teal-300',
  },
];

// Parser inteligente para detectar órdenes de modificación de combustible en texto o dictado por voz
function detectGasoilCommand(text, maquinaria = [], potreros = [], fechaOperacion = '') {
  if (!text) return null;
  const lower = text.toLowerCase();

  const isFuel =
    lower.includes('gasoil') ||
    lower.includes('combustible') ||
    lower.includes('diesel') ||
    lower.includes('gas oil');
  const hasVerb =
    lower.includes('descont') ||
    lower.includes('carg') ||
    lower.includes('consum') ||
    lower.includes('ingres') ||
    lower.includes('entrad') ||
    lower.includes('gast') ||
    lower.includes('anot') ||
    lower.includes('registr');

  if (!isFuel && !hasVerb) return null;
  if (!isFuel && !lower.includes('litro') && !lower.includes(' lts') && !lower.includes(' l ')) return null;

  // Extraer litros
  const litersMatch =
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:l\b|litros?|lts?\b)/) ||
    lower.match(/(?:descont[aá]|carg[aáoó]|consum[ií]o?|ingres[oó]|entraron|gast[oó]|anot[aá])\s+(\d+(?:[.,]\d+)?)/);
  if (!litersMatch) return null;

  let rawNum = litersMatch[1];
  if (rawNum.includes('.') && !rawNum.includes(',')) {
    if (/^\d{1,3}\.\d{3}$/.test(rawNum)) {
      rawNum = rawNum.replace('.', '');
    }
  } else if (rawNum.includes(',')) {
    rawNum = rawNum.replace(',', '.');
  }
  const litros = parseFloat(rawNum);
  if (isNaN(litros) || litros <= 0) return null;

  const isIngreso =
    lower.includes('ingres') ||
    lower.includes('entr') ||
    lower.includes('compr') ||
    lower.includes('descarg') ||
    lower.includes('al tanque');
  const tipo = isIngreso ? 'Ingreso / Compra' : 'Consumo / Egreso';

  const potreroMatch = lower.match(/(?:p#?|potrero\s*#?)\s*(\d+)/);
  const potrero_numero = potreroMatch ? parseInt(potreroMatch[1], 10) : null;

  let matchedMaq = '';
  let matchedMaqId = null;
  for (const m of maquinaria || []) {
    const maqName = (m.nombre || m.modelo || '').toLowerCase();
    if (maqName && lower.includes(maqName)) {
      matchedMaq = m.nombre || m.modelo;
      matchedMaqId = m.id;
      break;
    }
  }
  if (!matchedMaq) {
    const vMatch = text.match(
      /(tractor\s*[\w\d]*|hilux|camioneta|cosechadora|pulverizadora|mosquito|pala|camión|chata)/i
    );
    if (vMatch) matchedMaq = vMatch[0].trim();
  }

  const destino = matchedMaq
    ? `${matchedMaq}${potrero_numero ? ` en Potrero #${potrero_numero}` : ''}`
    : potrero_numero
    ? `Potrero #${potrero_numero}`
    : isIngreso
    ? 'Tanque Central de Campo'
    : 'Consumo operativo';

  return {
    id: `gasoil-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    tipo,
    litros,
    maquinaria: matchedMaq,
    maquinaria_id: matchedMaqId,
    potrero_numero,
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    destino,
    observaciones: 'Registrado vía Copiloto IA',
    status: 'pending',
    stockResult: null,
  };
}

// Tarjeta interactiva y editable para confirmar movimiento de gasoil antes de impactar Supabase
function GasoilConfirmationCard({
  card,
  stockActual = 0,
  potreros = [],
  onConfirm,
  onCancel,
  saving = false,
}) {
  const [editTipo, setEditTipo] = useState(card.tipo || 'Consumo / Egreso');
  const [editLitros, setEditLitros] = useState(card.litros || '');
  const [editDestino, setEditDestino] = useState(card.destino || card.maquinaria || '');
  const [editPotrero, setEditPotrero] = useState(card.potrero_numero || '');
  const [editFecha, setEditFecha] = useState(card.fecha || new Date().toISOString().slice(0, 10));

  if (card.status === 'confirmed') {
    return (
      <div className="mt-3 p-3.5 bg-emerald-950/90 border border-emerald-500/60 rounded-2xl shadow-md text-white animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-400/40">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-emerald-300 uppercase tracking-wide">
                ✓ Stock de Gasoil Actualizado en Supabase
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/30 text-emerald-200">
                Confirmado
              </span>
            </div>
            <div className="text-xs text-white mt-1">
              <strong>{card.tipo === 'Ingreso / Compra' ? 'Ingreso' : 'Consumo'}:</strong>{' '}
              <span className="text-amber-300 font-black">{Number(card.litros)?.toLocaleString('es-AR')} Litros</span>{' '}
              ({card.destino || 'Operativo'})
            </div>
            <div className="text-[11px] text-emerald-300/80 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Fecha: {card.fecha}</span>
              {card.stockResult !== null && (
                <span>Nuevo Stock en Tanque: <strong className="text-white font-bold">{Number(card.stockResult)?.toLocaleString('es-AR')} L</strong></span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (card.status === 'cancelled') {
    return (
      <div className="mt-2 p-2 px-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-[11px] italic flex items-center justify-between">
        <span>Movimiento de combustible cancelado / descartado.</span>
        <span className="text-[10px] uppercase font-bold text-slate-400">Descartado</span>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3.5 sm:p-4 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-amber-500/50 rounded-2xl shadow-xl text-white animate-in fade-in duration-150">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30">
            <Fuel className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-amber-300 uppercase tracking-wide">
              Registrar Movimiento de Combustible
            </h4>
            <div className="text-[10px] text-slate-400">
              Stock actual en tanque:{' '}
              <strong className="text-emerald-400 font-bold">{stockActual.toLocaleString('es-AR')} L</strong>
            </div>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse shrink-0">
          Confirmación
        </span>
      </div>

      <div className="mt-3 space-y-2.5 text-xs">
        {/* Selector de Tipo */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">Tipo de Movimiento:</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setEditTipo('Consumo / Egreso')}
              className={`py-1.5 px-2 rounded-xl font-bold text-[11px] border transition flex items-center justify-center gap-1.5 ${
                editTipo === 'Consumo / Egreso'
                  ? 'bg-rose-500/30 border-rose-400 text-rose-200 ring-1 ring-rose-400'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <span>📉 Consumo / Carga (-)</span>
            </button>
            <button
              type="button"
              onClick={() => setEditTipo('Ingreso / Compra')}
              className={`py-1.5 px-2 rounded-xl font-bold text-[11px] border transition flex items-center justify-center gap-1.5 ${
                editTipo === 'Ingreso / Compra'
                  ? 'bg-emerald-500/30 border-emerald-400 text-emerald-200 ring-1 ring-emerald-400'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <span>📈 Ingreso Tanque (+)</span>
            </button>
          </div>
        </div>

        {/* Litros y Fecha */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Cantidad en Litros:</label>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="1"
                value={editLitros}
                onChange={(e) => setEditLitros(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-sm font-black text-amber-300 focus:outline-none focus:border-amber-400"
              />
              <span className="absolute right-2.5 top-1.5 text-xs text-slate-400 font-bold">L</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Fecha:</label>
            <input
              type="date"
              value={editFecha}
              onChange={(e) => setEditFecha(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Máquina o Destino */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Máquina / Destino:</label>
          <input
            type="text"
            value={editDestino}
            onChange={(e) => setEditDestino(e.target.value)}
            placeholder="Ej: Tractor John Deere 7215 o Tanque Central"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
          />
        </div>

        {/* Potrero */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Potrero (Opcional):</label>
          <select
            value={editPotrero || ''}
            onChange={(e) => setEditPotrero(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
          >
            <option value="">Sin potrero asignado (Casco / General)</option>
            {(potreros || []).map((p) => (
              <option key={p.numero} value={p.numero}>
                Potrero #{p.numero} — {p.nombre || `Potrero ${p.numero}`} ({p.hectareas} ha)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Botones de Confirmación */}
      <div className="mt-3.5 pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold transition"
        >
          Descartar
        </button>
        <button
          type="button"
          disabled={saving || !editLitros || Number(editLitros) <= 0}
          onClick={() =>
            onConfirm({
              ...card,
              tipo: editTipo,
              litros: Number(editLitros),
              destino: editDestino,
              potrero_numero: editPotrero ? Number(editPotrero) : null,
              fecha: editFecha,
            })
          }
          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md transition flex items-center gap-1.5 disabled:opacity-50"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{saving ? 'Actualizando...' : 'Confirmar y Actualizar Stock'}</span>
        </button>
      </div>
    </div>
  );
}

// Tarjeta interactiva y editable para confirmar creación de tarea de campo desde el Copiloto IA
function TaskPreviewCard({
  card,
  potreros = [],
  rodeos = [],
  onConfirm,
  onCancel,
  saving = false,
}) {
  const [formData, setFormData] = useState({
    titulo: card.titulo || '',
    categoria: card.categoria || 'General',
    potrero_numero: card.potrero_numero ? String(card.potrero_numero) : '',
    rodeo_id: card.rodeo_id ? String(card.rodeo_id) : '',
    prioridad: card.prioridad || 'Media',
    fecha_limite: card.fecha_limite || '',
    responsable: card.responsable || 'Equipo San José',
    observaciones: card.observaciones || '',
  });

  if (card.status === 'confirmed') {
    return (
      <div className="mt-3 p-3.5 bg-emerald-950/90 border border-emerald-500/60 rounded-2xl shadow-md text-white animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-400/40">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-emerald-300 uppercase tracking-wide">
                ✓ Tarea Agendada en Tablero
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/30 text-emerald-200">
                Confirmada
              </span>
            </div>
            <div className="text-xs text-white mt-1">
              <strong>{card.titulo}</strong>
            </div>
            <div className="text-[11px] text-emerald-300/80 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Categoría: <strong>{card.categoria}</strong></span>
              <span>Prioridad: <strong>{card.prioridad}</strong></span>
              <span>Ubicación: <strong>{card.potrero_numero ? `Potrero #${card.potrero_numero}` : 'General del establecimiento'}</strong></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (card.status === 'cancelled') {
    return (
      <div className="mt-2 p-2 px-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-[11px] italic flex items-center justify-between">
        <span>Creación de tarea descartada.</span>
        <span className="text-[10px] uppercase font-bold text-slate-400">Descartada</span>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3.5 sm:p-4 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-emerald-500/50 rounded-2xl shadow-xl text-white animate-in fade-in duration-150">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center border border-emerald-500/30">
            <ClipboardList className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-emerald-300 uppercase tracking-wide">
              Vista Previa: Agendar Tarea Operativa
            </h4>
            <div className="text-[10px] text-slate-400">
              Revisá o editá antes de guardar en el tablero oficial
            </div>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse shrink-0">
          Editable
        </span>
      </div>

      <div className="mt-3 space-y-2.5 text-xs">
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">
            Título de la Tarea *
          </label>
          <input
            type="text"
            required
            value={formData.titulo}
            onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
            className="w-full px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="Ej: Revisar aguada en Potrero 4..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Categoría:</label>
            <select
              value={formData.categoria}
              onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="General">General</option>
              <option value="Aguadas">Aguadas</option>
              <option value="Alambrados">Alambrados</option>
              <option value="Hacienda">Hacienda</option>
              <option value="Caminos">Caminos</option>
              <option value="Maquinaria">Maquinaria</option>
              <option value="Pasturas / Siembra">Pasturas / Siembra</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Prioridad:</label>
            <select
              value={formData.prioridad}
              onChange={(e) => setFormData({ ...formData, prioridad: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="Urgente">🔴 Urgente</option>
              <option value="Alta">🟡 Alta</option>
              <option value="Media">🔵 Media</option>
              <option value="Baja">⚪ Baja</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">
              Potrero (Totalmente Opcional):
            </label>
            <select
              value={formData.potrero_numero}
              onChange={(e) => setFormData({ ...formData, potrero_numero: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">General del establecimiento (Sin potrero)</option>
              {potreros.map((p) => (
                <option key={p.numero} value={p.numero}>
                  Potrero #{p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero} · {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">
              Rodeo (Totalmente Opcional):
            </label>
            <select
              value={formData.rodeo_id}
              onChange={(e) => setFormData({ ...formData, rodeo_id: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Sin rodeo asociado</option>
              {rodeos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Fecha Límite:</label>
            <input
              type="date"
              value={formData.fecha_limite}
              onChange={(e) => setFormData({ ...formData, fecha_limite: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
            </input>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Encargado / Responsable:</label>
            <input
              type="text"
              value={formData.responsable}
              onChange={(e) => setFormData({ ...formData, responsable: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Ej: Equipo San José / Juan"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">
            Instrucciones / Observaciones:
          </label>
          <input
            type="text"
            value={formData.observaciones}
            onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="Detalles operativos, materiales necesarios..."
          />
        </div>
      </div>

      <div className="mt-3.5 pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold transition whitespace-nowrap shrink-0"
        >
          Descartar
        </button>
        <button
          type="button"
          disabled={saving || !formData.titulo?.trim()}
          onClick={() =>
            onConfirm({
              ...card,
              ...formData,
              potrero_numero: formData.potrero_numero ? Number(formData.potrero_numero) : null,
              rodeo_id: formData.rodeo_id ? Number(formData.rodeo_id) : null,
            })
          }
          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md transition flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{saving ? 'Guardando tarea...' : 'Confirmar y Crear Tarea'}</span>
        </button>
      </div>
    </div>
  );
}

export default function CopilotoCampoModal({
  isOpen = true,
  onClose,
  potreros = [],
  rodeos = [],
  infraestructura = [],
  tareas = [],
  lluvias = [],
  registrosLluvias = [],
  alertas = [],
  alertasMapa = [],
  caminosEstado = 'Transitable',
  maquinaria = [],
  insumos = [],
  stockInsumos = [],
  gastos = [],
  gastosCampo = [],
  ventas = [],
  ventasHacienda = [],
  laboresSiembras = [],
  siembras = [],
  dolarRef = 1540,
  fechaOperacion,
  onRefresh,
  notify,
}) {
  const actualLluvias = lluvias && lluvias.length > 0 ? lluvias : registrosLluvias || [];
  const actualAlertas = alertas && alertas.length > 0 ? alertas : alertasMapa || [];
  const effectiveInsumos = insumos && insumos.length > 0 ? insumos : stockInsumos || [];
  const effectiveGastos = gastos && gastos.length > 0 ? gastos : gastosCampo || [];
  const effectiveVentas = ventas && ventas.length > 0 ? ventas : ventasHacienda || [];
  const effectiveSiembras = laboresSiembras && laboresSiembras.length > 0 ? laboresSiembras : siembras || [];

  const [infraList, setInfraList] = useState(infraestructura);
  const [movimientosList, setMovimientosList] = useState([]);

  useEffect(() => {
    if (infraestructura && infraestructura.length > 0) {
      setInfraList(infraestructura);
    } else {
      supabase
        .from('infraestructura')
        .select('*')
        .order('id', { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) setInfraList(data);
        })
        .catch(() => {});
    }
  }, [infraestructura]);

  useEffect(() => {
    supabase
      .from('movimientos_hacienda')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data && data.length > 0) setMovimientosList(data);
      })
      .catch(() => {});
  }, []);

  // Cierre limpio al presionar tecla Escape
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose?.();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('sanjose_ia_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Error leyendo historial de chat de localStorage', e);
    }
    return [DEFAULT_WELCOME_MESSAGE];
  });
  const [inputText, setInputText] = useState(() => {
    try {
      return localStorage.getItem('sanjose_ia_chat_draft') || '';
    } catch (e) {
      return '';
    }
  });
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [savingGasoil, setSavingGasoil] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // Subvistas del Copiloto IA: 'chat' | 'protocolo' | 'recorrida'
  const [subVista, setSubVista] = useState('chat');
  const [aprendizajesList, setAprendizajesList] = useState(APRENDIZAJES_FUNDACIONALES_SAN_JOSE);
  const [protocoloConfig, setProtocoloConfig] = useState(null);
  const [showNuevoAprendizaje, setShowNuevoAprendizaje] = useState(false);
  const [nuevoAprendizaje, setNuevoAprendizaje] = useState({
    tipo: 'Manejo Forrajero',
    entidad_tipo: 'potrero',
    entidad_id: 'P12',
    titulo: '',
    aprendizaje: '',
    autor: 'Asesor Técnico',
  });
  const [savingAprendizaje, setSavingAprendizaje] = useState(false);
  const [updatingRodeoId, setUpdatingRodeoId] = useState(null);

  // Tablero Vivo: cálculo dinámico de Protocolo vs. Planilla Maestra de Rodeos
  const protocoloVivo = useMemo(() => {
    return calcularProtocoloVivo(rodeos, potreros);
  }, [rodeos, potreros]);

  const handleUpdateRodeoRole = async (rodeoId, newRole) => {
    setUpdatingRodeoId(rodeoId);
    try {
      const { error } = await supabase
        .from('rodeos')
        .update({ rol_protocolo: newRole })
        .eq('id', rodeoId);
      if (error) throw error;
      notify?.(`Rol de protocolo actualizado a "${newRole}"`, 'success');
      onRefresh?.();
    } catch (err) {
      console.error('Error al actualizar rol de protocolo:', err);
      notify?.('Error guardando rol en la base de datos', 'error');
    } finally {
      setUpdatingRodeoId(null);
    }
  };

  // Estados para Informe de Recorrida y Multi-documento
  const [informeTexto, setInformeTexto] = useState('');
  const [informeFile, setInformeFile] = useState(null);
  const [analizandoRecorrida, setAnalizandoRecorrida] = useState(false);
  const [resultadoRecorrida, setResultadoRecorrida] = useState(null);
  const [savingRecorridaImpacto, setSavingRecorridaImpacto] = useState(false);
  const fileInputRef = useRef(null);

  // Cargar aprendizajes históricos y protocolo de cría desde Supabase
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

    supabase
      .from('protocolo_cria_config')
      .select('*')
      .single()
      .then(({ data }) => {
        if (data) setProtocoloConfig(data);
      })
      .catch(() => {});
  }, []);

  const gasoilItem =
    effectiveInsumos.find(
      (i) => i.categoria === 'Combustible' || i.nombre?.toLowerCase().includes('gasoil')
    ) || effectiveInsumos[0];
  const stockGasoilActual = Number(gasoilItem?.cantidad_actual || 0);

  // Guardar historial de mensajes en localStorage (nunca almacenar Base64 para proteger los 5MB)
  useEffect(() => {
    try {
      if (messages && messages.length > 0) {
        const cleanMessages = messages.map((m) => {
          if (!m.text) return m;
          // Si por error viniera una imagen Base64 grande incrustada en el texto, sanearla
          if (m.text.includes('data:image/')) {
            return {
              ...m,
              text: m.text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[Imagen analizada y comprimida]'),
            };
          }
          return m;
        });
        localStorage.setItem('sanjose_ia_chat_history', JSON.stringify(cleanMessages));
      }
    } catch (e) {
      console.warn('Error guardando historial de chat en localStorage', e);
    }
  }, [messages]);

  // Guardar borrador en localStorage mientras el usuario escribe
  useEffect(() => {
    try {
      localStorage.setItem('sanjose_ia_chat_draft', inputText || '');
    } catch (e) {
      console.warn('Error guardando borrador de chat en localStorage', e);
    }
  }, [inputText]);

  async function handleClearChat() {
    if (messages.length > 1) {
      const ok = await confirmAction({
        title: '¿Reiniciar conversación con el Copiloto IA?',
        description: 'Se vaciará el historial actual de mensajes del chat de campo.',
        confirmText: 'Sí, reiniciar',
        variant: 'warning',
      });
      if (!ok) return;
    }
    const initial = [DEFAULT_WELCOME_MESSAGE];
    setMessages(initial);
    setInputText('');
    try {
      localStorage.setItem('sanjose_ia_chat_history', JSON.stringify(initial));
      localStorage.removeItem('sanjose_ia_chat_draft');
    } catch (e) {}
    notify?.('Conversación con Copiloto IA reiniciada.', 'info');
  }

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  async function handleTestKey() {
    setTestingKey(true);
    setTestResult(null);
    try {
      const res = await testGeminiConnection();
      setTestResult({ ok: true, message: res });
      notify?.('✓ Conexión con Gemini IA verificada con éxito.', 'success');
    } catch (err) {
      const cleanErrMsg = formatGeminiErrorMessage(err);
      setTestResult({ ok: false, message: cleanErrMsg });
      notify?.(`Error de conexión Gemini: ${cleanErrMsg}`, 'error');
    } finally {
      setTestingKey(false);
    }
  }

  // Inicializar Speech Recognition si el navegador lo soporta
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'es-AR';

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  function toggleListening() {
    if (!recognitionRef.current) {
      notify?.('El reconocimiento por voz no es soportado por este navegador.', 'info');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.warn('Error iniciando micrófono:', err);
      }
    }
  }

  async function handleSendMessage(e, customPrompt) {
    if (e) e.preventDefault();
    const query = (typeof customPrompt === 'string' ? customPrompt : inputText).trim();
    if (!query || loading) return;

    if (!hasGeminiKey() && !isProduction()) {
      setShowKeyModal(true);
      return;
    }

    const detectedGasoil = detectGasoilCommand(query, maquinaria, potreros, fechaOperacion);

    const newMsgs = [...messages, { role: 'user', text: query }];
    setMessages(newMsgs);
    if (!customPrompt) {
      setInputText('');
    }
    setLoading(true);

    try {
      const res = await copilotoCampoChat({
        messages: newMsgs,
        context: {
          potreros,
          rodeos,
          infraestructura: infraList,
          tareas,
          lluvias: actualLluvias,
          movimientos: movimientosList,
          alertas: actualAlertas,
          caminosEstado,
          maquinaria,
          insumos: effectiveInsumos,
          aprendizajes: aprendizajesList,
          protocoloCria: protocoloConfig,
          fechaOperacion,
          gastos: effectiveGastos,
          ventas: effectiveVentas,
          laboresSiembras: effectiveSiembras,
          dolarRef,
        },
      });

      let gasoilCard = null;
      if (res.action?.action === 'REGISTRAR_GASOIL' && res.action.payload) {
        gasoilCard = {
          id: `gasoil-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          tipo: res.action.payload.tipo || 'Consumo / Egreso',
          litros: Number(res.action.payload.litros) || 0,
          maquinaria: res.action.payload.maquinaria || '',
          potrero_numero: res.action.payload.potrero_numero ? Number(res.action.payload.potrero_numero) : null,
          fecha: res.action.payload.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
          destino: res.action.payload.destino || res.action.payload.maquinaria || 'Consumo operativo',
          observaciones: res.action.payload.observaciones || 'Registrado vía Copiloto IA',
          status: 'pending',
          stockResult: null,
        };
      } else if (detectedGasoil) {
        gasoilCard = detectedGasoil;
      }

      // Si Gemini sugirió crear tarea, NO crearla en segundo plano: generar tarjeta de vista previa editable
      let taskCard = null;
      if (res.action?.action === 'CREAR_TAREA' && res.action.payload) {
        taskCard = {
          id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          titulo:
            res.action.payload.titulo ||
            res.action.payload.tarea ||
            res.action.payload.labor ||
            res.action.payload.descripcion ||
            'Nueva labor operativa',
          categoria: res.action.payload.categoria || 'General',
          potrero_numero: res.action.payload.potrero_numero ? Number(res.action.payload.potrero_numero) : null,
          rodeo_id: res.action.payload.rodeo_id ? Number(res.action.payload.rodeo_id) : null,
          prioridad: res.action.payload.prioridad || 'Media',
          fecha_limite:
            res.action.payload.fecha_limite ||
            fechaOperacion ||
            new Date().toISOString().slice(0, 10),
          responsable: res.action.payload.responsable || 'Equipo San José',
          observaciones:
            res.action.payload.observaciones ||
            res.action.payload.justificacion ||
            res.action.payload.instrucciones ||
            '',
          status: 'pending',
        };
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.text,
          gasoilCard,
          taskCard,
        },
      ]);

      // Si Gemini detectó otra acción operativa (lluvia, mover rodeo), ejecutarla automáticamente
      if (
        res.action &&
        res.action.action !== 'REGISTRAR_GASOIL' &&
        res.action.action !== 'CREAR_TAREA'
      ) {
        await handleExecuteCopilotoAction(res.action);
      }
    } catch (err) {
      const cleanErrMsg = formatGeminiErrorMessage(err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `⚠️ ${cleanErrMsg}`,
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmGasoil(msgIndex, cardData) {
    setSavingGasoil(true);
    try {
      let targetInsumo = effectiveInsumos.find(
        (i) => i.categoria === 'Combustible' || i.nombre?.toLowerCase().includes('gasoil')
      );

      if (!targetInsumo) {
        const { data: dbInsumos } = await supabase
          .from('stock_insumos')
          .select('*')
          .or('categoria.eq.Combustible,nombre.ilike.%gasoil%')
          .limit(1);
        if (dbInsumos && dbInsumos.length > 0) {
          targetInsumo = dbInsumos[0];
        }
      }

      const currentQty = Number(targetInsumo?.cantidad_actual || 0);
      const delta = Number(cardData.litros) || 0;
      const isIngreso = cardData.tipo === 'Ingreso / Compra';
      const newQty = isIngreso ? currentQty + delta : Math.max(0, currentQty - delta);

      if (targetInsumo?.id) {
        await supabase
          .from('stock_insumos')
          .update({
            cantidad_actual: newQty,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetInsumo.id);
      }

      await supabase.from('movimientos_insumos').insert({
        insumo_id: targetInsumo?.id || null,
        tipo: cardData.tipo,
        cantidad: delta,
        fecha: cardData.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
        destino: cardData.destino || cardData.maquinaria || 'Consumo Operativo',
        potrero_numero: cardData.potrero_numero ? Number(cardData.potrero_numero) : null,
        maquinaria_id: cardData.maquinaria_id || null,
        responsable: cardData.responsable || 'Copiloto IA',
        observaciones: cardData.observaciones || 'Registrado vía Copiloto IA de Campo',
      });

      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]) {
          next[msgIndex] = {
            ...next[msgIndex],
            gasoilCard: {
              ...cardData,
              status: 'confirmed',
              stockResult: newQty,
            },
          };
        }
        return next;
      });

      notify?.(
        `⛽ ${isIngreso ? 'Ingreso' : 'Consumo'} de ${delta.toLocaleString('es-AR')} L registrado. Nuevo stock: ${newQty.toLocaleString('es-AR')} L.`,
        'success'
      );
      onRefresh?.();
    } catch (err) {
      console.error('Error confirmando movimiento de gasoil:', err);
      notify?.(`Error al actualizar stock de combustible: ${err.message}`, 'error');
    } finally {
      setSavingGasoil(false);
    }
  }

  function handleCancelGasoil(msgIndex) {
    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex]) {
        next[msgIndex] = {
          ...next[msgIndex],
          gasoilCard: {
            ...next[msgIndex].gasoilCard,
            status: 'cancelled',
          },
        };
      }
      return next;
    });
    notify?.('Movimiento de combustible cancelado.', 'info');
  }

  async function handleConfirmTask(msgIndex, cardData) {
    if (!cardData.titulo?.trim()) {
      notify?.('Ingresá un título para la tarea.', 'error');
      return;
    }
    setSavingTask(true);
    try {
      const payload = {
        titulo: cardData.titulo.trim(),
        categoria: cardData.categoria || 'General',
        potrero_numero: cardData.potrero_numero ? Number(cardData.potrero_numero) : null,
        prioridad: cardData.prioridad || 'Media',
        fecha_limite:
          cardData.fecha_limite || fechaOperacion || new Date().toISOString().slice(0, 10),
        responsable: cardData.responsable || 'Equipo San José',
        observaciones: cardData.observaciones || 'Creada vía Copiloto IA de Campo',
        estado: 'Pendiente',
        completada: false,
      };

      const { error } = await supabase.from('tareas_campo').insert(payload);
      if (error) throw error;

      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]) {
          next[msgIndex] = {
            ...next[msgIndex],
            taskCard: {
              ...cardData,
              status: 'confirmed',
            },
          };
        }
        return next;
      });

      notify?.(`📋 Tarea "${cardData.titulo}" agendada con éxito en el tablero.`, 'success');
      onRefresh?.();
    } catch (err) {
      console.error('Error creando tarea desde Copiloto:', err);
      notify?.(`Error al crear tarea: ${err.message}`, 'error');
    } finally {
      setSavingTask(false);
    }
  }

  function handleCancelTask(msgIndex) {
    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex]) {
        next[msgIndex] = {
          ...next[msgIndex],
          taskCard: {
            ...next[msgIndex].taskCard,
            status: 'cancelled',
          },
        };
      }
      return next;
    });
    notify?.('Tarea descartada.', 'info');
  }

  function handleConvertMessageToTask(msgIndex, messageText) {
    const firstLine = (messageText || '')
      .replace(/^[#*\s-]+/, '')
      .split('\n')[0]
      .replace(/[*_#]/g, '')
      .trim();
    const cleanTitle = firstLine ? firstLine.slice(0, 65) : 'Labor recomendada por Copiloto';

    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex]) {
        next[msgIndex] = {
          ...next[msgIndex],
          taskCard: {
            id: `task-${Date.now()}`,
            titulo: cleanTitle,
            categoria: 'General',
            potrero_numero: null, // Totalmente opcional
            rodeo_id: null, // Totalmente opcional
            prioridad: 'Media',
            fecha_limite: fechaOperacion || new Date().toISOString().slice(0, 10),
            responsable: 'Equipo San José',
            observaciones: (messageText || '').slice(0, 180),
            status: 'pending',
          },
        };
      }
      return next;
    });
  }

  async function handleExecuteCopilotoAction(actionObj) {
    const { action, payload } = actionObj;
    try {
      if (action === 'REGISTRAR_LLUVIA') {
        const mm = Number(payload.milimetros) || 0;
        if (mm > 0) {
          await supabase.from('registros_lluvias').insert({
            fecha: payload.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
            milimetros: mm,
            pluviometro: payload.pluviometro || 'Casco Principal',
            estado_caminos: payload.estado_caminos || caminosEstado,
            observaciones: payload.observaciones || 'Registrado mediante Copiloto IA',
          });
          notify?.(`🌧️ Lluvia de ${mm} mm registrada automáticamente en Supabase.`, 'success');
          onRefresh?.();
        }
      } else if (action === 'MOVER_RODEO') {
        const rodeoTarget = rodeos.find(
          (r) =>
            r.nombre.toLowerCase().includes(payload.rodeo?.toLowerCase()) ||
            Number(r.id) === Number(payload.rodeo_id)
        );
        const potreroDest = potreros.find((p) => Number(p.numero) === Number(payload.potrero_numero));

        if (rodeoTarget && potreroDest) {
          await supabase
            .from('rodeos')
            .update({ potrero_numero: potreroDest.numero })
            .eq('id', rodeoTarget.id);

          await supabase.from('movimientos_hacienda').insert({
            fecha: payload.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
            tipo_movimiento: 'Traslado Interno',
            rodeo_id: rodeoTarget.id,
            rodeo_nombre: rodeoTarget.nombre,
            potrero_origen_id: rodeoTarget.potrero_numero,
            potrero_destino_id: potreroDest.numero,
            cantidad_cabezas:
              (Number(rodeoTarget.vacas) || 0) + (Number(rodeoTarget.terneros) || 0),
            observaciones: `Traslado ordenado por Copiloto IA al Potrero #${potreroDest.numero}`,
          });

          notify?.(
            `🐄 Rodeo "${rodeoTarget.nombre}" movido con éxito al Potrero #${potreroDest.numero}.`,
            'success'
          );
          onRefresh?.();
        }
      }
    } catch (err) {
      console.error('Error ejecutando acción de copiloto:', err);
      notify?.(`Error ejecutando acción automática: ${err.message}`, 'error');
    }
  }

  function handleSaveKey(e) {
    if (e) e.preventDefault();
    if (keyInput.trim()) {
      setGeminiApiKey(keyInput.trim());
      notify?.('Clave de Gemini API configurada con éxito.', 'success');
      setShowKeyModal(false);
      setKeyInput('');
    }
  }

  // Guardar nuevo aprendizaje histórico para la memoria de la IA
  async function handleSaveNuevoAprendizaje(e) {
    if (e) e.preventDefault();
    if (!nuevoAprendizaje.titulo?.trim() || !nuevoAprendizaje.aprendizaje?.trim()) {
      notify?.('Completá el título y el aprendizaje a registrar.', 'error');
      return;
    }
    setSavingAprendizaje(true);
    try {
      const payload = {
        tipo: nuevoAprendizaje.tipo || 'Manejo Forrajero',
        entidad_tipo: nuevoAprendizaje.entidad_tipo || 'potrero',
        entidad_id: nuevoAprendizaje.entidad_id || 'General',
        titulo: nuevoAprendizaje.titulo.trim(),
        aprendizaje: nuevoAprendizaje.aprendizaje.trim(),
        autor: nuevoAprendizaje.autor || 'Asesor Técnico',
        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
      };
      const { data, error } = await supabase.from('aprendizajes_campo').insert(payload).select().single();
      if (error) throw error;
      setAprendizajesList((prev) => [data || payload, ...prev]);
      notify?.('✓ Aprendizaje histórico guardado en la memoria de San José.', 'success');
      setShowNuevoAprendizaje(false);
      setNuevoAprendizaje({
        tipo: 'Manejo Forrajero',
        entidad_tipo: 'potrero',
        entidad_id: 'P12',
        titulo: '',
        aprendizaje: '',
        autor: 'Asesor Técnico',
      });
    } catch (err) {
      notify?.(`Error al guardar aprendizaje: ${err.message}`, 'error');
    } finally {
      setSavingAprendizaje(false);
    }
  }

  // Analizar informe de recorrida (texto, notas de voz o foto/PDF)
  async function handleAnalizarRecorrida() {
    if (!informeTexto.trim() && !informeFile) {
      notify?.('Ingresá texto, audio transcripto o subí un archivo de recorrida.', 'error');
      return;
    }
    setAnalizandoRecorrida(true);
    try {
      const res = await analizarInformeRecorrida({
        texto: informeTexto,
        file: informeFile,
        potreros,
        rodeos,
        fechaOperacion,
      });
      setResultadoRecorrida(res);
      notify?.('✓ Informe de recorrida analizado por la IA.', 'success');
    } catch (err) {
      notify?.(`Error analizando recorrida: ${formatGeminiErrorMessage(err)}`, 'error');
    } finally {
      setAnalizandoRecorrida(false);
    }
  }

  // Impactar simultáneamente todas las acciones del informe de recorrida
  async function handleConfirmarImpactoRecorrida() {
    if (!resultadoRecorrida) return;
    setSavingRecorridaImpacto(true);
    let totalImpactos = 0;
    try {
      // 1. Lluvias
      if (Array.isArray(resultadoRecorrida.lluvias)) {
        for (const ll of resultadoRecorrida.lluvias) {
          const mm = parseFloat(ll.milimetros);
          if (mm > 0) {
            await supabase.from('registros_lluvias').insert({
              fecha: ll.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
              milimetros: mm,
              pluviometro: ll.pluviometro || 'Casco Principal',
              observaciones: ll.observaciones || 'Extraído de Informe de Recorrida IA',
            });
            totalImpactos++;
          }
        }
      }

      // 2. Condición Corporal en Rodeos
      if (Array.isArray(resultadoRecorrida.condiciones_corporales)) {
        for (const cc of resultadoRecorrida.condiciones_corporales) {
          const val = parseFloat(cc.condicion_corporal);
          if (val > 0) {
            let targetRodeo = null;
            if (cc.rodeo_id) {
              targetRodeo = rodeos.find((r) => Number(r.id) === Number(cc.rodeo_id));
            }
            if (!targetRodeo && cc.rodeo_nombre) {
              targetRodeo = rodeos.find((r) => r.nombre.toLowerCase().includes(cc.rodeo_nombre.toLowerCase()));
            }
            if (targetRodeo) {
              await supabase.from('rodeos').update({ condicion_corporal: val }).eq('id', targetRodeo.id);
              totalImpactos++;
            }
          }
        }
      }

      // 3. Tareas Operativas
      if (Array.isArray(resultadoRecorrida.tareas_operativas)) {
        for (const t of resultadoRecorrida.tareas_operativas) {
          if (t.titulo) {
            await supabase.from('tareas_campo').insert({
              titulo: t.titulo,
              prioridad: t.prioridad || 'Alta',
              potrero_numero: t.potrero_numero ? Number(t.potrero_numero) : null,
              responsable: t.responsable || 'Equipo San José',
              fecha_limite: t.fecha_limite || fechaOperacion || new Date().toISOString().slice(0, 10),
              observaciones: t.observaciones || 'Ingresado por Informe de Recorrida IA',
              completada: false,
              estado: 'Pendiente',
            });
            totalImpactos++;
          }
        }
      }

      // 4. Gasoil / Combustible
      if (Array.isArray(resultadoRecorrida.combustible_gasoil)) {
        for (const g of resultadoRecorrida.combustible_gasoil) {
          const lts = parseFloat(g.litros);
          if (lts > 0) {
            await supabase.from('movimientos_insumos').insert({
              insumo_id: gasoilItem?.id || null,
              tipo_movimiento: g.tipo || 'Consumo / Egreso',
              cantidad: lts,
              unidad: 'Litros',
              fecha: g.fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
              motivo_destino: g.maquinaria ? `${g.maquinaria}${g.potrero_numero ? ` en P#${g.potrero_numero}` : ''}` : 'Consumo operativo',
              observaciones: g.observaciones || 'Ingresado por Informe de Recorrida IA',
            });
            totalImpactos++;
          }
        }
      }

      // 5. Registrar Aprendizaje / Hallazgo automático en aprendizajes_campo
      try {
        const resumenObservaciones = [
          resultadoRecorrida.lluvias?.length
            ? `Lluvias: ${resultadoRecorrida.lluvias.map((l) => `${l.milimetros}mm (${l.pluviometro || 'Casco'})`).join(', ')}`
            : null,
          resultadoRecorrida.condiciones_corporales?.length
            ? `CC: ${resultadoRecorrida.condiciones_corporales.map((c) => `${c.rodeo_nombre || 'Rodeo'} (CC ${c.condicion_corporal})`).join(', ')}`
            : null,
          resultadoRecorrida.resumen_ejecutivo ||
            resultadoRecorrida.observaciones_generales ||
            resultadoRecorrida.recomendaciones_ia ||
            'Observación registrada en recorrida de campo',
        ]
          .filter(Boolean)
          .join(' · ');

        const nuevoAprendizajeObj = {
          tipo: 'Monitoreo de Campo',
          entidad_tipo: 'recorrida',
          entidad_id: resultadoRecorrida.potrero_numero ? `P${resultadoRecorrida.potrero_numero}` : 'General',
          titulo: `Recorrida ${new Date().toLocaleDateString('es-AR')}: Novedades & Hallazgos`,
          aprendizaje: resumenObservaciones.slice(0, 450),
          autor: 'Copiloto IA (Recorrida)',
        };

        const { data: apData } = await supabase
          .from('aprendizajes_campo')
          .insert(nuevoAprendizajeObj)
          .select()
          .single();
        if (apData) {
          setAprendizajesList((prev) => [apData, ...prev]);
        }
      } catch (errAp) {
        console.warn('Registro automático de aprendizaje no bloqueante:', errAp);
      }

      notify?.(`✓ Recorrida confirmada: ${totalImpactos} registros impactaron en San José.`, 'success');
      setResultadoRecorrida(null);
      setInformeTexto('');
      setInformeFile(null);
      setSubVista('chat');
      onRefresh?.();
    } catch (err) {
      notify?.(`Error impactando recorrida: ${err.message}`, 'error');
    } finally {
      setSavingRecorridaImpacto(false);
    }
  }

  // Exportar informe a PDF oficial con membrete, KPIs y tablas ejecutivas
  async function handleExportPDF(reportText = null) {
    try {
      let rawContent = reportText;
      let docTitle = 'INFORME TÉCNICO DE COPILOTO IA DE CAMPO';

      if (!rawContent) {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isError && m.text);
        if (lastAssistant) {
          rawContent = lastAssistant.text;
        } else {
          rawContent = messages
            .map((m) => `${m.role === 'user' ? 'OPERADOR' : 'COPILOTO IA'}:\n${m.text}`)
            .join('\n\n---\n\n');
          docTitle = 'HISTORIAL DE CONSULTAS Y COPILOTO IA';
        }
      }

      await exportarInformeCopilotoPDF({
        contenido: rawContent,
        titulo: docTitle,
        fechaOperacion,
        dolarRef,
      });
      notify?.('📄 Documento PDF generado y descargado con éxito.', 'success');
    } catch (err) {
      console.error('Error exportando PDF:', err);
      notify?.(`Error al exportar PDF: ${err.message}`, 'error');
    }
  }

  const isModalOpen = isOpen !== undefined ? isOpen : true;
  if (!isModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex justify-end bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        // Evitar que el panel se cierre al hacer clic accidental afuera
        e.stopPropagation();
      }}
    >
      <div
        className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Copiloto (sin superposición de botones ni cortes) */}
        <div className="px-3 py-2.5 sm:px-4 sm:py-3 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 text-white flex flex-wrap items-center justify-between gap-2 shadow-md shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-700/40 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
              <Bot className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <h3 className="font-extrabold text-xs sm:text-sm text-white shrink-0">
                Copiloto IA
              </h3>
              {hasGeminiKey() ? (
                <span className="px-2 py-0.5 rounded-full text-[9.5px] sm:text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1 shadow-2xs whitespace-nowrap shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>IA Activa</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[9.5px] sm:text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1 shadow-2xs whitespace-nowrap shrink-0">
                  <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>Sin Clave</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
            <button
              type="button"
              onClick={() => handleExportPDF()}
              className="px-2 sm:px-2.5 py-1 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white border border-emerald-500/50 text-[10.5px] sm:text-[11px] font-extrabold flex items-center gap-1 transition shadow-xs shrink-0 whitespace-nowrap"
              title="Descargar informe ejecutivo en PDF (A4) con membrete y tablas"
            >
              <FileDown className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span>Descargar PDF</span>
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              className="px-2 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[10.5px] sm:text-[11px] font-bold flex items-center gap-1 transition shrink-0 whitespace-nowrap"
              title="Limpiar historial de chat e iniciar nueva charla"
            >
              <Trash2 className="w-3 h-3 text-slate-400 shrink-0" />
              <span>Limpiar</span>
            </button>
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testingKey}
              className="px-2 py-1 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/30 text-purple-200 text-[10.5px] sm:text-[11px] font-extrabold flex items-center gap-1 transition disabled:opacity-50 shrink-0 whitespace-nowrap"
              title="Probar conexión con Gemini IA"
            >
              <RefreshCw className={`w-3 h-3 shrink-0 ${testingKey ? 'animate-spin text-purple-300' : ''}`} />
              <span>{testingKey ? '...' : 'Probar'}</span>
            </button>
            {!isProduction() && (
              <button
                type="button"
                onClick={() => {
                  setKeyInput(getGeminiApiKey());
                  setShowKeyModal(true);
                }}
                title="Configurar clave API de Gemini"
                className="p-1 sm:p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition shrink-0"
              >
                <Key className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 sm:p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition shrink-0"
              title="Cerrar panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Selector de Vistas del Copiloto IA: Chat / Protocolo / Recorrida */}
        <div className="bg-slate-900 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between gap-1.5 shrink-0">
          <div className="inline-flex rounded-xl bg-slate-800/90 p-0.5 border border-slate-700/80 text-[11px] font-bold w-full">
            <button
              type="button"
              onClick={() => setSubVista('chat')}
              className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 ${
                subVista === 'chat'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Chat Asesor</span>
            </button>
            <button
              type="button"
              onClick={() => setSubVista('protocolo')}
              className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 ${
                subVista === 'protocolo'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Protocolo & Sabiduría</span>
            </button>
            <button
              type="button"
              onClick={() => setSubVista('recorrida')}
              className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 ${
                subVista === 'recorrida'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Informe Recorrida</span>
            </button>
          </div>
        </div>

        {/* Banner de Resultado de Prueba de Conexión */}
        {testResult && (
          <div
            className={`p-2.5 px-4 text-xs font-bold flex items-center justify-between border-b ${
              testResult.ok
                ? 'bg-emerald-950 text-emerald-200 border-emerald-800'
                : 'bg-red-950 text-red-200 border-red-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setTestResult(null)}
              className="p-0.5 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Modal de Carga de Clave API si falta */}
        {showKeyModal && (
          <div className="p-4 bg-amber-50 border-b border-amber-200 animate-in slide-in-from-top duration-150">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-900">
                <Key className="w-4 h-4 text-amber-700 shrink-0" />
                Configurar Clave Google Gemini IA
              </div>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="text-amber-800 hover:text-amber-950 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-amber-800 mt-1">
              Ingresá tu clave de Gemini API (o configurala en <code>.env</code> como{' '}
              <code>VITE_GEMINI_API_KEY</code>). Podés obtenerla gratis en{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline font-bold text-amber-950"
              >
                Google AI Studio
              </a>
              .
            </p>
            <form onSubmit={handleSaveKey} className="mt-2.5 flex items-center gap-2">
              <input
                type="password"
                placeholder="AIzaSy..."
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-xl border border-amber-300 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-600"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-extrabold text-xs transition"
              >
                Guardar
              </button>
            </form>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VISTA 1: CHAT ASESOR IA (MENSAJES, ACCIONES Y ENTRADA DE TEXTO/VOZ)  */}
        {/* ==================================================================== */}
        {subVista === 'chat' && (
          <>
            {/* Mensajes del Chat */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${
                    m.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${
                      m.role === 'user'
                        ? 'bg-emerald-800 text-white rounded-br-xs whitespace-pre-wrap'
                        : m.isError
                        ? 'bg-red-50 text-red-900 border border-red-300 rounded-bl-xs whitespace-pre-wrap'
                        : 'bg-white text-slate-800 border border-slate-200/90 rounded-bl-xs'
                    }`}
                  >
                    {m.role === 'assistant' && !m.isError ? (
                      <div>
                        {(() => {
                          const execData = parseExecutiveJsonData(m.text);
                          if (execData) {
                            const cleanText = m.text
                              .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, '')
                              .replace(/\{[\s\r\n]*"(?:titulo|title)"\s*:[\s\S]*?\n\}/gi, '')
                              .trim();
                            return (
                              <>
                                {cleanText && <MarkdownRenderer text={cleanText} />}
                                <InfografiaCopiloto data={execData} />
                              </>
                            );
                          }
                          return <MarkdownRenderer text={m.text} />;
                        })()}
                        {m.gasoilCard && (
                          <GasoilConfirmationCard
                            card={m.gasoilCard}
                            stockActual={stockGasoilActual}
                            potreros={potreros}
                            onConfirm={(confirmedCard) => handleConfirmGasoil(idx, confirmedCard)}
                            onCancel={() => handleCancelGasoil(idx)}
                            saving={savingGasoil}
                          />
                        )}
                        {m.taskCard && (
                          <TaskPreviewCard
                            card={m.taskCard}
                            potreros={potreros}
                            rodeos={rodeos}
                            onConfirm={(confirmedCard) => handleConfirmTask(idx, confirmedCard)}
                            onCancel={() => handleCancelTask(idx)}
                            saving={savingTask}
                          />
                        )}
                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                            Copiloto Gemini IA
                          </span>
                          <div className="flex items-center gap-1.5">
                            {!m.taskCard && (
                              <button
                                type="button"
                                onClick={() => handleConvertMessageToTask(idx, m.text)}
                                className="text-[10px] font-extrabold text-blue-800 hover:text-blue-950 bg-blue-50 hover:bg-blue-100 border border-blue-300/80 px-2 py-1 rounded-lg flex items-center gap-1 transition shadow-2xs whitespace-nowrap shrink-0"
                                title="Convertir esta recomendación en una tarea operativa editable"
                              >
                                <ClipboardList className="w-3 h-3 text-blue-700 shrink-0" />
                                <span>➕ Convertir en Tarea</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleExportPDF(m.text)}
                              className="text-[10px] font-extrabold text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300/80 px-2.5 py-1 rounded-lg flex items-center gap-1 transition shadow-2xs whitespace-nowrap shrink-0"
                              title="Descargar este informe en PDF (A4) con membrete oficial"
                            >
                              <FileDown className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              <span>📄 Descargar PDF</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <span className="whitespace-pre-wrap">{m.text}</span>
                        {m.isError && (
                          <div className="mt-2.5 pt-2 border-t border-red-200/80 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                const lastUser = [...messages.slice(0, idx)].reverse().find((msg) => msg.role === 'user');
                                if (lastUser?.text) {
                                  handleSendMessage(null, lastUser.text);
                                }
                              }}
                              className="text-[11px] font-bold text-red-800 hover:text-red-950 bg-red-100 hover:bg-red-200 border border-red-300 px-3 py-1 rounded-xl flex items-center gap-1.5 transition active:scale-95 shadow-2xs cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reintentar</span>
                            </button>
                          </div>
                        )}
                        {m.gasoilCard && (
                          <GasoilConfirmationCard
                            card={m.gasoilCard}
                            stockActual={stockGasoilActual}
                            potreros={potreros}
                            onConfirm={(confirmedCard) => handleConfirmGasoil(idx, confirmedCard)}
                            onCancel={() => handleCancelGasoil(idx)}
                            saving={savingGasoil}
                          />
                        )}
                        {m.taskCard && (
                          <TaskPreviewCard
                            card={m.taskCard}
                            potreros={potreros}
                            rodeos={rodeos}
                            onConfirm={(confirmedCard) => handleConfirmTask(idx, confirmedCard)}
                            onCancel={() => handleCancelTask(idx)}
                            saving={savingTask}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-600 p-2.5 bg-emerald-50/80 border border-emerald-200 rounded-xl w-fit animate-in fade-in">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-800 shrink-0" />
                  <span>Analizando contexto de San José con Gemini...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Acciones Ejecutivas de Campo (4 Acciones Directas) */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 shrink-0">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2 px-0.5">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-emerald-700" />
                  Acciones Ejecutivas IA
                </span>
                <span className="text-slate-400 font-normal">Clic para consultar</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {EXECUTIVE_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={loading}
                    onClick={() => handleSendMessage(null, action.prompt)}
                    className={`p-2 rounded-xl border text-[11px] font-bold flex items-center gap-2 transition text-left shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-50 ${action.theme}`}
                    title={action.prompt}
                  >
                    <span className="text-base shrink-0">{action.icon}</span>
                    <span className="truncate leading-tight">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Input Bar con Soporte de Voz */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
            >
              <button
                type="button"
                onClick={toggleListening}
                title={isListening ? 'Detener dictado por voz' : 'Dictar por voz'}
                className={`p-2.5 rounded-xl border transition ${
                  isListening
                    ? 'bg-red-500 text-white border-red-600 animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                }`}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  isListening ? 'Escuchando tu voz...' : 'Escribí tu consulta o instrucción de campo...'
                }
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />

              <button
                type="submit"
                disabled={!inputText.trim() || loading}
                className="p-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white disabled:opacity-40 transition shadow-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        )}

        {/* ==================================================================== */}
        {/* VISTA 2: PROTOCOLO DE CRÍA Y SABIDURÍA / APRENDIZAJES HISTÓRICOS     */}
        {/* ==================================================================== */}
        {subVista === 'protocolo' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            {/* Banner de Seguimiento Vivo Conectado a Rodeos */}
            <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-900 text-white rounded-2xl p-4 sm:p-5 border border-emerald-800/80 shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 bg-emerald-900/90 px-2.5 py-1 rounded-full border border-emerald-700 shadow-xs flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Tablero Vivo · Protocolo San José
                  </span>
                  <span className="text-[10px] font-bold text-slate-300 bg-white/10 px-2 py-0.5 rounded-md">
                    {rodeos.length} Rodeos · {potreros.length} Potreros
                  </span>
                </div>
                <span className="text-[10px] font-extrabold text-emerald-300/90 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-emerald-400" />
                  Metas Técnicas Orientativas & Flexibles
                </span>
              </div>
              <h4 className="text-base sm:text-lg font-black text-white mt-2">
                Seguimiento Reproductivo y Plan de Reposición en Tiempo Real
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed max-w-3xl">
                Este tablero calcula dinámicamente las metas del protocolo de San José contrastándolas con la <strong>Planilla Maestra de Rodeos activa</strong>. Podés recalibrar el rol asignado a cada lote con el selector desplegable. La IA adapta estas metas al régimen pluvial y a la receptividad forrajera del ciclo.
              </p>
            </div>

            {/* 5 Tarjetas de Seguimiento Vivo con Barras de Progreso y Semáforo */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {/* 1. Plantel de Vientres en Servicio */}
              {(() => {
                const item = protocoloVivo.vientres;
                const sem =
                  item.estado === 'En meta'
                    ? { badge: 'bg-emerald-100 text-emerald-900 border-emerald-300', bar: 'bg-emerald-500' }
                    : item.estado === 'Atención'
                    ? { badge: 'bg-amber-100 text-amber-900 border-amber-300', bar: 'bg-amber-500' }
                    : { badge: 'bg-rose-100 text-rose-900 border-rose-300', bar: 'bg-rose-500' };
                return (
                  <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          Plantel de Vientres en Servicio
                        </div>
                        <div className="text-lg font-black text-slate-900 mt-0.5">
                          {item.real.toLocaleString('es-AR')}{' '}
                          <span className="text-xs font-bold text-slate-500">
                            / Meta: {item.meta.toLocaleString('es-AR')} vientres
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-xs ${sem.badge}`}>
                        {item.estado} ({item.porcentaje}%)
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${sem.bar}`}
                          style={{ width: `${Math.min(item.porcentaje, 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>{item.vacas} vacas + {item.vaquillonas} vaquillonas</span>
                        <span className={item.diferencia >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                          {item.diferencia >= 0
                            ? `+${item.diferencia} cab (Cumplida)`
                            : `${item.diferencia} cab vs meta`}
                        </span>
                      </div>
                    </div>

                    {/* Listado de Rodeos en este Rol */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Rodeos Asignados ({item.rodeos.length})</span>
                        <span>Rol · Cabezas</span>
                      </div>
                      {item.rodeos.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No hay rodeos con rol Plantel Cría.</p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {item.rodeos.map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                            >
                              <div className="truncate min-w-0">
                                <span className="font-extrabold text-slate-900 block truncate">{r.nombre}</span>
                                <span className="text-[10px] text-slate-500 font-semibold">{r.potrero_nombre}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-emerald-950 text-xs">{r.total_cabezas_calc} cab.</span>
                                <select
                                  value={r.rol_protocolo}
                                  disabled={updatingRodeoId === r.id}
                                  onChange={(e) => handleUpdateRodeoRole(r.id, e.target.value)}
                                  className="text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-slate-300 bg-white"
                                >
                                  {ROLES_PROTOCOLO.map((rol) => (
                                    <option key={rol} value={rol}>{rol}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 2. Reposición Anual (Recría Hembras) */}
              {(() => {
                const item = protocoloVivo.reposicion;
                const sem =
                  item.estado === 'En meta'
                    ? { badge: 'bg-emerald-100 text-emerald-900 border-emerald-300', bar: 'bg-emerald-500' }
                    : item.estado === 'Atención'
                    ? { badge: 'bg-amber-100 text-amber-900 border-amber-300', bar: 'bg-amber-500' }
                    : { badge: 'bg-rose-100 text-rose-900 border-rose-300', bar: 'bg-rose-500' };
                return (
                  <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          Reposición Anual (Recría Hembras)
                        </div>
                        <div className="text-lg font-black text-slate-900 mt-0.5">
                          {item.real.toLocaleString('es-AR')}{' '}
                          <span className="text-xs font-bold text-slate-500">
                            / Meta: {item.meta.toLocaleString('es-AR')} vaquillonas
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-xs ${sem.badge}`}>
                        {item.estado} ({item.porcentaje}%)
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${sem.bar}`}
                          style={{ width: `${Math.min(item.porcentaje, 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>Renovación anual estimada: ~22,7%</span>
                        <span className={item.diferencia >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                          {item.diferencia >= 0
                            ? `Colchón de +${item.diferencia} cab.`
                            : `Faltante de ${Math.abs(item.diferencia)} cab.`}
                        </span>
                      </div>
                    </div>

                    {/* Listado de Rodeos en este Rol */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Rodeos de Recría / Reposición ({item.rodeos.length})</span>
                        <span>Rol · Cabezas</span>
                      </div>
                      {item.rodeos.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No hay rodeos asignados a Reposición.</p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {item.rodeos.map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                            >
                              <div className="truncate min-w-0">
                                <span className="font-extrabold text-slate-900 block truncate">{r.nombre}</span>
                                <span className="text-[10px] text-slate-500 font-semibold">{r.potrero_nombre}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-emerald-950 text-xs">{r.total_cabezas_calc} cab.</span>
                                <select
                                  value={r.rol_protocolo}
                                  disabled={updatingRodeoId === r.id}
                                  onChange={(e) => handleUpdateRodeoRole(r.id, e.target.value)}
                                  className="text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-slate-300 bg-white"
                                >
                                  {ROLES_PROTOCOLO.map((rol) => (
                                    <option key={rol} value={rol}>{rol}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 3. Toros Padres y Toritos */}
              {(() => {
                const item = protocoloVivo.toros;
                const sem =
                  item.estado === 'En meta'
                    ? { badge: 'bg-emerald-100 text-emerald-900 border-emerald-300', bar: 'bg-emerald-500' }
                    : item.estado === 'Atención'
                    ? { badge: 'bg-amber-100 text-amber-900 border-amber-300', bar: 'bg-amber-500' }
                    : { badge: 'bg-rose-100 text-rose-900 border-rose-300', bar: 'bg-rose-500' };
                const pctMeta = Math.min(Math.round((item.porcentajeReal / 4.0) * 100), 100);
                return (
                  <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          Toros Padres y Toritos en Recría
                        </div>
                        <div className="text-lg font-black text-slate-900 mt-0.5">
                          {item.realPadres} Toros Padres{' '}
                          <span className="text-xs font-bold text-slate-500">
                            ({item.porcentajeReal}% s/vientres · Meta: 4%)
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-xs ${sem.badge}`}>
                        {item.estado}
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${sem.bar}`}
                          style={{ width: `${pctMeta}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>Recría: {item.realToritos} / {item.metaToritos} toritos</span>
                        <span className="text-slate-500">
                          50% Angus Negros / 50% Colorados
                        </span>
                      </div>
                    </div>

                    {/* Listado de Rodeos en este Rol */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Rodeos de Toros ({item.rodeos.length})</span>
                        <span>Rol · Cabezas</span>
                      </div>
                      {item.rodeos.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">Toros distribuidos dentro de rodeos de vientres.</p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {item.rodeos.map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                            >
                              <div className="truncate min-w-0">
                                <span className="font-extrabold text-slate-900 block truncate">{r.nombre}</span>
                                <span className="text-[10px] text-slate-500 font-semibold">{r.potrero_nombre}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-emerald-950 text-xs">{r.total_cabezas_calc} cab.</span>
                                <select
                                  value={r.rol_protocolo}
                                  disabled={updatingRodeoId === r.id}
                                  onChange={(e) => handleUpdateRodeoRole(r.id, e.target.value)}
                                  className="text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-slate-300 bg-white"
                                >
                                  {ROLES_PROTOCOLO.map((rol) => (
                                    <option key={rol} value={rol}>{rol}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 4. Cosecha de Terneros (Al pie / Destetados) */}
              {(() => {
                const item = protocoloVivo.terneros;
                const sem =
                  item.estado === 'En meta'
                    ? { badge: 'bg-emerald-100 text-emerald-900 border-emerald-300', bar: 'bg-emerald-500' }
                    : item.estado === 'Atención'
                    ? { badge: 'bg-amber-100 text-amber-900 border-amber-300', bar: 'bg-amber-500' }
                    : { badge: 'bg-rose-100 text-rose-900 border-rose-300', bar: 'bg-rose-500' };
                return (
                  <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          Cosecha de Terneros (Al pie / Destetados)
                        </div>
                        <div className="text-lg font-black text-slate-900 mt-0.5">
                          {item.real.toLocaleString('es-AR')}{' '}
                          <span className="text-xs font-bold text-slate-500">
                            / Meta: ~{item.meta.toLocaleString('es-AR')} (~82% destete)
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-xs ${sem.badge}`}>
                        {item.estado} ({item.porcentaje}%)
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${sem.bar}`}
                          style={{ width: `${Math.min(item.porcentaje, 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>{item.machos} machos · {item.hembras} hembras</span>
                        <span className="text-slate-700">Destete real: {item.porcentajeDestete}%</span>
                      </div>
                    </div>

                    {/* Tarjeta Destacada de Libres para Venta */}
                    <div className="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-extrabold uppercase text-emerald-900">
                          Libres Estimados para Venta
                        </div>
                        <div className="text-[11px] text-emerald-800">
                          Tras retener {item.retencionReposicion} cabezas (280 hembras + 30 toritos)
                        </div>
                      </div>
                      <div className="text-base font-black text-emerald-950 px-2 py-0.5 bg-emerald-200/70 rounded-lg">
                        {item.libresVenta.toLocaleString('es-AR')} cab.
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 5. Vacas CUT / Refugo al Frente */}
              {(() => {
                const item = protocoloVivo.cut;
                const sem =
                  item.estado === 'En meta'
                    ? { badge: 'bg-emerald-100 text-emerald-900 border-emerald-300', bar: 'bg-emerald-500' }
                    : item.estado === 'Atención'
                    ? { badge: 'bg-amber-100 text-amber-900 border-amber-300', bar: 'bg-amber-500' }
                    : { badge: 'bg-rose-100 text-rose-900 border-rose-300', bar: 'bg-rose-500' };
                return (
                  <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3 lg:col-span-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          Vacas CUT / Refugo al Frente (Engorde & Venta)
                        </div>
                        <div className="text-lg font-black text-slate-900 mt-0.5">
                          {item.real.toLocaleString('es-AR')}{' '}
                          <span className="text-xs font-bold text-slate-500">
                            / Meta anual estimada: ~{item.meta.toLocaleString('es-AR')} vacas de descarte
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-xs ${sem.badge}`}>
                        {item.estado} ({item.porcentaje}%)
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${sem.bar}`}
                          style={{ width: `${Math.min(item.porcentaje, 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>Pautas: Asignar a potreros del frente (P1, P2/3, P4, P5, P6) cercanos a casco y manga</span>
                        <span className="text-slate-500">Descarte planificado tras tacto de otoño</span>
                      </div>
                    </div>

                    {/* Listado de Rodeos en este Rol */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Rodeos de Refugo / CUT ({item.rodeos.length})</span>
                        <span>Rol · Cabezas</span>
                      </div>
                      {item.rodeos.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">
                          Sin tropa de CUT segregada actualmente. El rodeo de vacas vacías/refugo se unifica tras el tacto.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {item.rodeos.map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                            >
                              <div className="truncate min-w-0">
                                <span className="font-extrabold text-slate-900 block truncate">{r.nombre}</span>
                                <span className="text-[10px] text-slate-500 font-semibold">{r.potrero_nombre}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-emerald-950 text-xs">{r.total_cabezas_calc} cab.</span>
                                <select
                                  value={r.rol_protocolo}
                                  disabled={updatingRodeoId === r.id}
                                  onChange={(e) => handleUpdateRodeoRole(r.id, e.target.value)}
                                  className="text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-slate-300 bg-white"
                                >
                                  {ROLES_PROTOCOLO.map((rol) => (
                                    <option key={rol} value={rol}>{rol}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Bitácora de Aprendizajes Históricos */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-teal-100 text-teal-800">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      Bitácora de Aprendizajes de Campo
                    </h5>
                    <p className="text-[11px] text-slate-500">
                      Memoria histórica que el Copiloto IA consulta en cada recomendación
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNuevoAprendizaje(!showNuevoAprendizaje)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showNuevoAprendizaje ? 'Cerrar' : '+ Anotar Aprendizaje'}</span>
                </button>
              </div>

              {showNuevoAprendizaje && (
                <form onSubmit={handleSaveNuevoAprendizaje} className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-300 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-700 block mb-0.5">
                        Categoría
                      </label>
                      <select
                        value={nuevoAprendizaje.tipo}
                        onChange={(e) => setNuevoAprendizaje({ ...nuevoAprendizaje, tipo: e.target.value })}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 text-xs bg-white font-bold"
                      >
                        <option value="Manejo Forrajero">Manejo Forrajero</option>
                        <option value="Carga Animal">Carga Animal</option>
                        <option value="Sanidad">Sanidad</option>
                        <option value="Aguadas">Aguadas</option>
                        <option value="Clima">Clima</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-700 block mb-0.5">
                        Potrero / Rodeo / Gral
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: P#8 / Rodeo 1 / General"
                        value={nuevoAprendizaje.entidad_id}
                        onChange={(e) => setNuevoAprendizaje({ ...nuevoAprendizaje, entidad_id: e.target.value })}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 text-xs bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-700 block mb-0.5">
                      Título Breve *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Respuesta a anegamiento primaveral"
                      value={nuevoAprendizaje.titulo}
                      onChange={(e) => setNuevoAprendizaje({ ...nuevoAprendizaje, titulo: e.target.value })}
                      className="w-full px-2 py-1 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-700 block mb-0.5">
                      Lección / Criterio Aprendido *
                    </label>
                    <textarea
                      rows={2}
                      required
                      placeholder="Detallá la experiencia agronómica o lección aprendida..."
                      value={nuevoAprendizaje.aprendizaje}
                      onChange={(e) => setNuevoAprendizaje({ ...nuevoAprendizaje, aprendizaje: e.target.value })}
                      className="w-full px-2 py-1 rounded-lg border border-slate-300 text-xs bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowNuevoAprendizaje(false)}
                      className="px-3 py-1 rounded-lg text-slate-600 hover:text-slate-800 text-xs font-bold"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingAprendizaje}
                      className="px-3.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold flex items-center gap-1 shadow-xs"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingAprendizaje ? 'Guardando...' : 'Guardar Lección'}
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {aprendizajesList.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Sin lecciones registradas aún. Usá el formulario arriba para registrar la primera.
                  </div>
                ) : (
                  aprendizajesList.map((a) => (
                    <div key={a.id || a.titulo} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-black uppercase text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          {a.tipo || 'Manejo'} · {a.entidad_id || 'General'}
                        </span>
                        <span className="text-[10px] text-slate-400">{a.autor || 'Técnico'}</span>
                      </div>
                      <div className="text-xs font-black text-slate-900 mt-0.5">{a.titulo}</div>
                      <div className="text-[11px] text-slate-600 mt-1 leading-snug">{a.aprendizaje}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VISTA 3: INFORME DE RECORRIDA INTELIGENTE (MULTI-DOCUMENTO / VOZ)     */}
        {/* ==================================================================== */}
        {subVista === 'recorrida' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            <div className="bg-gradient-to-br from-blue-950 to-slate-900 text-white rounded-2xl p-4 border border-blue-800 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-300 bg-blue-900/80 px-2 py-0.5 rounded-full border border-blue-700">
                Auditoría de Campo Rápida
              </span>
              <h4 className="text-sm font-extrabold text-white mt-1.5">
                Ingreso Inteligente de Informe de Recorrida
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Pegá novedades de WhatsApp, notas de voz transcriptas o fotos de libretas. La IA detectará <strong>lluvias, condición corporal (★), tareas operativas y combustible</strong> en una sola confirmación unificada.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <label className="text-xs font-bold text-slate-800 block">
                Texto / Transcripción del Informe:
              </label>
              <textarea
                rows={4}
                value={informeTexto}
                onChange={(e) => setInformeTexto(e.target.value)}
                placeholder="Ej: Llovió 35 mm en el Casco y 28 mm en Puesto El Silencio. Rodeo 1 en P#4 con condición corporal 3.5 estrellas. El tractor JD 6130 gastó 140 L en P#12. Hay que cambiar varillas en boyero de P#16 antes del viernes..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*,application/pdf"
                    onChange={(e) => setInformeFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 transition"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-slate-600" />
                    <span>{informeFile ? informeFile.name.slice(0, 18) + '...' : 'Subir Foto / Libreta'}</span>
                  </button>
                  {informeFile && (
                    <button
                      type="button"
                      onClick={() => setInformeFile(null)}
                      className="text-slate-400 hover:text-red-600 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  disabled={analizandoRecorrida || (!informeTexto.trim() && !informeFile)}
                  onClick={handleAnalizarRecorrida}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-sm transition flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4 text-blue-200" />
                  <span>{analizandoRecorrida ? 'Analizando con IA...' : 'Analizar Informe'}</span>
                </button>
              </div>
            </div>

            {/* Tarjeta de Confirmación Unificada del Informe de Recorrida */}
            {resultadoRecorrida && (
              <div className="bg-white rounded-2xl border-2 border-emerald-600 p-4 space-y-3.5 shadow-md animate-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <div>
                      <h5 className="text-xs font-black uppercase tracking-wider text-emerald-950">
                        Novedades Detectadas en la Recorrida
                      </h5>
                      <p className="text-[11px] text-slate-500">
                        {resultadoRecorrida.resumen_recorrida}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                    Listo para Confirmar
                  </span>
                </div>

                {/* Precipitaciones */}
                {Array.isArray(resultadoRecorrida.lluvias) && resultadoRecorrida.lluvias.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-1">
                    <span className="text-[10px] font-black uppercase text-blue-900">🌧️ Precipitaciones:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {resultadoRecorrida.lluvias.map((ll, idx) => (
                        <span key={idx} className="px-2 py-1 rounded-lg bg-white border border-blue-300 text-xs font-extrabold text-blue-900">
                          {ll.milimetros} mm · {ll.pluviometro || 'Casco'} ({ll.fecha || 'Hoy'})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Condición Corporal */}
                {Array.isArray(resultadoRecorrida.condiciones_corporales) && resultadoRecorrida.condiciones_corporales.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1">
                    <span className="text-[10px] font-black uppercase text-amber-900">★ Condición Corporal Evaluada:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {resultadoRecorrida.condiciones_corporales.map((cc, idx) => (
                        <span key={idx} className="px-2 py-1 rounded-lg bg-white border border-amber-300 text-xs font-extrabold text-amber-900">
                          {cc.rodeo_nombre}: {cc.condicion_corporal} ★
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tareas Operativas */}
                {Array.isArray(resultadoRecorrida.tareas_operativas) && resultadoRecorrida.tareas_operativas.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
                    <span className="text-[10px] font-black uppercase text-emerald-900">📋 Tareas Operativas Detectadas:</span>
                    <div className="space-y-1">
                      {resultadoRecorrida.tareas_operativas.map((t, idx) => (
                        <div key={idx} className="p-1.5 rounded-lg bg-white border border-emerald-200 text-xs font-semibold text-slate-800 flex items-center justify-between">
                          <span>{t.titulo} {t.potrero_numero ? `(P#${t.potrero_numero})` : ''}</span>
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                            {t.prioridad || 'Alta'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Combustible */}
                {Array.isArray(resultadoRecorrida.combustible_gasoil) && resultadoRecorrida.combustible_gasoil.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-300 space-y-1">
                    <span className="text-[10px] font-black uppercase text-slate-800">⛽ Combustible / Gasoil:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {resultadoRecorrida.combustible_gasoil.map((g, idx) => (
                        <span key={idx} className="px-2 py-1 rounded-lg bg-white border border-slate-300 text-xs font-extrabold text-slate-900">
                          {g.litros} L en {g.maquinaria || 'Equipo'} {g.potrero_numero ? `(P#${g.potrero_numero})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Botón de Confirmación Total */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setResultadoRecorrida(null)}
                    disabled={savingRecorridaImpacto}
                    className="px-3 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 text-xs font-bold"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    disabled={savingRecorridaImpacto}
                    onClick={handleConfirmarImpactoRecorrida}
                    className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold text-xs shadow-md transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    <span>{savingRecorridaImpacto ? 'Impactando en Supabase...' : 'Confirmar e Impactar en San José'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
