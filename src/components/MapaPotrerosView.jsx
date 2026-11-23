import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import {
  MapPin,
  Upload,
  Plus,
  Save,
  Trash2,
  Droplets,
  Layers,
  CheckCircle2,
  Edit3,
  Eye,
  X,
  ArrowRightLeft,
  ArrowRight,
  ChevronDown,
  Calendar,
  Tags,
  StickyNote,
  Route,
  Wrench,
  ClipboardList,
  Sprout,
  SlidersHorizontal,
  Sun,
  Building2,
  Clock,
  Move,
  Home,
  Lock,
  Unlock,
  Edit,
  Maximize2,
  Minimize2,
  Zap,
  Truck,
  Compass,
  Target,
  Search,
  Filter,
  MoreVertical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LAS_FLORES_CENTER, parseGeoFileContent } from '../utils/geoParser';
import { calcPermanenciaPotrero } from '../utils/pdfHelper';
import { confirmAction } from './ConfirmDialog';

const AMBIENTES = [
  'Loma',
  'Loma (25%)',
  'Bajo Dulce',
  'Bajo Salino',
  'Bajo Anegable',
  'Mixto Loma/Bajo',
];

const ESTADOS_SEMAFORO = [
  'Disponible',
  'En pastoreo',
  'Sobrecargado',
  'En descanso',
  'Anegado',
  'En siembra',
];

export const TIPOS_INFRAESTRUCTURA = [
  'Molino',
  'Tanque Australiano',
  'Bebida',
  'Corrales y Mangas',
  'Mangrullo / Bomba Casco',
  'Tranquera',
  'Tranquerón',
  'Monte / Sombra',
  'Edificación / Casco',
  'Camino Operativo',
];

export const ESTADOS_INFRAESTRUCTURA = [
  'Operativo',
  'A revisar',
  'En reparación',
  'Fuera de servicio',
];

// Paleta curada de 12 íconos agropecuarios y operativos para marcadores del satélite
export const ICONOS_MAPA_CURADOS = [
  { emoji: '🚪', label: 'Tranquera', tipo: 'Tranquera' },
  { emoji: '🚧', label: 'Tranquerón / Acceso', tipo: 'Tranquerón' },
  { emoji: '🔗', label: 'Alambrado / Paso', tipo: 'Alambrado' },
  { emoji: '💧', label: 'Bebida / Aguada', tipo: 'Bebida' },
  { emoji: '⚙️', label: 'Molino / Bomba', tipo: 'Molino' },
  { emoji: '🏠', label: 'Casco / Puesto', tipo: 'Edificación / Casco' },
  { emoji: '🐄', label: 'Manga / Corrales', tipo: 'Corrales y Mangas' },
  { emoji: '🚜', label: 'Galpón / Maquinaria', tipo: 'Galpón' },
  { emoji: '⛽', label: 'Combustible / Gasoil', tipo: 'Combustible' },
  { emoji: '🌳', label: 'Monte / Sombra', tipo: 'Monte / Sombra' },
  { emoji: '🌾', label: 'Silo / Rollos', tipo: 'Silo / Rollos' },
  { emoji: '⚠️', label: 'Alerta / Revisar', tipo: 'Alerta' },
];

export function getDefaultEmojiForTipo(tipo = '') {
  const t = String(tipo).toLowerCase();
  if (t.includes('tranquerón') || t.includes('tranqueron')) return '🚧';
  if (t.includes('tranquera')) return '🚪';
  if (t.includes('alambrado') || t.includes('boyero') || t.includes('eléctrico') || t.includes('electrico') || t.includes('paso')) return '🔗';
  if (t.includes('bebida') || t.includes('tanque') || t.includes('aguada')) return '💧';
  if (t.includes('molino') || t.includes('bomba') || t.includes('mangrullo')) return '⚙️';
  if (t.includes('casco') || t.includes('puesto') || t.includes('casa') || t.includes('edific')) return '🏠';
  if (t.includes('corral') || t.includes('manga') || t.includes('báscula') || t.includes('bascula')) return '🐄';
  if (t.includes('galpón') || t.includes('galpon') || t.includes('maquinaria') || t.includes('taller')) return '🚜';
  if (t.includes('combustible') || t.includes('gasoil') || t.includes('nafta')) return '⛽';
  if (t.includes('monte') || t.includes('sombra') || t.includes('arboleda') || t.includes('árbol') || t.includes('arbol')) return '🌳';
  if (t.includes('silo') || t.includes('rollo') || t.includes('grano') || t.includes('fardo')) return '🌾';
  if (t.includes('alerta') || t.includes('revisar') || t.includes('peligro') || t.includes('rot')) return '⚠️';
  return '🚪';
}

export function getInfraEmoji(inf) {
  if (!inf) return '🚪';
  if (inf.icono) return inf.icono;
  if (inf.emoji) return inf.emoji;
  const rawText = `${inf.observaciones || ''} ${inf.componentes_detalle || ''} ${inf.nombre || ''}`;
  const match = rawText.match(/\[?icono[:=]\s*([^\s\]]+)\]?/i);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (ICONOS_MAPA_CURADOS.some((c) => c.emoji === candidate)) {
      return candidate;
    }
  }
  for (const ico of ICONOS_MAPA_CURADOS) {
    if (rawText.includes(ico.emoji)) {
      return ico.emoji;
    }
  }
  return getDefaultEmojiForTipo(inf.tipo);
}

export function getEmojiMarkerIcon(inf, emoji, isDraggable = true, isHighlighted = false) {
  const isAlert = (inf?.estado || 'Operativo') !== 'Operativo';
  const borderColor = isAlert
    ? '#ef4444'
    : (inf?.tipo === 'Tranquera' || inf?.tipo === 'Tranquerón')
    ? '#0f172a'
    : (inf?.tipo === 'Bebida' || inf?.tipo === 'Tanque Australiano')
    ? '#0284c7'
    : (inf?.tipo === 'Monte / Sombra' || (inf?.tipo || '').toLowerCase().includes('monte'))
    ? '#15803d'
    : '#059669';
  const cursorStyle = isDraggable ? 'cursor:grab;' : 'cursor:pointer;';
  const highlightRing = isHighlighted ? 'box-shadow: 0 0 0 3.5px #f59e0b, 0 0 18px rgba(245, 158, 11, 0.95); transform: translate(-50%,-50%) scale(1.15); z-index: 5000;' : 'transform:translate(-50%,-50%);';
  const title = `${inf?.nombre || 'Punto'} (${inf?.tipo || ''})`;

  return L.divIcon({
    className: 'infra-curated-emoji-marker',
    html: `<div style="${highlightRing}display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:rgba(255,255,255,0.95);border:1.5px solid ${borderColor};box-shadow:0 1.5px 4px rgba(0,0,0,0.35);font-size:13px;line-height:1;${cursorStyle}transition:transform 0.15s;" title="${title}">
      ${emoji}
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export const TIPOS_ALERTA_MAPA = [
  'Falta agua',
  'Arreglar alambrado',
  'Camino cortado',
  'Animal caído / Sanidad',
  'Observación',
];

export const TIPOS_TRAZA_CAMINO = [
  'Camino Interno',
  'Camino Principal',
  'Parcela Eléctrica / Boyero',
];

export const ESTADOS_CAMINO = [
  'Transitable',
  'Con precaución',
  'Cortado por barro',
  'Eléctrico Activo',
  'Eléctrico Apagado',
];

export function getReceptividadDefault(potrero) {
  const cult = (potrero?.cultivo_actual || potrero?.recurso_forrajero || '').toLowerCase();
  // 1. Verdeos / Cultivos (Maíz, Sorgo, Avena, Raigrás, etc.) = 1.80 EV/ha
  if (
    cult.includes('maiz') ||
    cult.includes('maíz') ||
    cult.includes('sorgo') ||
    cult.includes('avena') ||
    cult.includes('raigras') ||
    cult.includes('raigrás') ||
    cult.includes('verdeo') ||
    cult.includes('centeno') ||
    cult.includes('cultivo')
  ) {
    return 1.80;
  }
  // 2. Pasturas Consociadas / Festuca / Agropiro / Alfalfa / Trébol / Lotus = 1.35 EV/ha
  if (
    cult.includes('festuca') ||
    cult.includes('consociada') ||
    cult.includes('agropiro') ||
    cult.includes('alfalfa') ||
    cult.includes('trébol') ||
    cult.includes('trebol') ||
    cult.includes('lotus') ||
    cult.includes('pastura')
  ) {
    return 1.35;
  }
  // 3. Campo Natural / Bajo Dulce / Salino / Pajonal = 0.85 EV/ha
  return 0.85;
}

export function getReceptividadEfectiva(potrero) {
  const custom = Number(potrero?.receptividad_ev_ha ?? potrero?.receptividad_ha);
  if (!isNaN(custom) && custom > 0 && custom !== 0.90) {
    return custom;
  }
  return getReceptividadDefault(potrero);
}

export function esSiembraActiva(s) {
  if (!s) return false;
  if (s.archivado === true || s.archivada === true) return false;
  if (s.activa_en_mapa === false) return false;

  const vig = String(s.vigencia || '').trim().toLowerCase();
  if (
    vig.includes('archivad') ||
    vig.includes('historic') ||
    vig.includes('pasad') ||
    vig.includes('finaliz') ||
    vig.includes('cerrad') ||
    vig.includes('inactiv') ||
    vig.includes('baja') ||
    vig.includes('cancel')
  ) {
    return false;
  }

  const est = String(s.estado || '').trim().toLowerCase();
  if (
    est.includes('archivad') ||
    est.includes('historic') ||
    est.includes('cosechad') ||
    est.includes('barbech') ||
    est.includes('finaliz') ||
    est.includes('cerrad') ||
    est.includes('inactiv') ||
    est.includes('baja') ||
    est.includes('cancel')
  ) {
    return false;
  }

  return true;
}

export function getPotreroRecursoInfo(p, siembrasMap = {}) {
  const pNum = Number(p?.numero);
  const siembraActiva = siembrasMap[pNum];
  const potreroHa = Number(p?.hectareas) || 0;

  if (siembraActiva && esSiembraActiva(siembraActiva)) {
    const cultivo = siembraActiva.cultivo_variedad || 'Pastura / Verdeo';
    const haSembradas = Number(siembraActiva.ha_sembradas || siembraActiva.hectareas) || potreroHa;
    const esParcial = potreroHa > 0 && haSembradas < potreroHa - 0.05;

    let etiqueta = cultivo;
    let etiquetaCorta = cultivo;
    if (esParcial) {
      etiqueta = `${cultivo} ${haSembradas.toFixed(1)}/${potreroHa.toFixed(1)} ha`;
      etiquetaCorta = `${cultivo} ${haSembradas.toFixed(0)}/${potreroHa.toFixed(0)} ha`;
    }

    return {
      cultivo,
      haSembradas,
      potreroHa,
      esParcial,
      etiqueta,
      etiquetaCorta,
      origenSiembra: true,
      siembraId: siembraActiva.id,
      estadoSiembra: siembraActiva.estado,
      tieneSiembraActiva: true,
    };
  }

  return {
    cultivo: 'Campo Natural',
    haSembradas: potreroHa,
    potreroHa,
    esParcial: false,
    etiqueta: 'Campo Natural',
    etiquetaCorta: 'Campo Natural',
    origenSiembra: false,
    tieneSiembraActiva: false,
  };
}

export function getSemaforoColor(estado, cargaHa = 0, cabezas = 0, receptividad = 0.85) {
  const norm = (estado || '').toLowerCase();
  const cHa = Number(cargaHa) || 0;
  const heads = Number(cabezas) || 0;
  const recep = Number(receptividad) || 0.85;
  const sobrecargaThreshold = Number((recep * 1.25).toFixed(2));

  // 1. Sobrecarga (> receptividad * 1.25 EV/ha o estado crítico / anegado)
  if (norm.includes('sobrecargado') || norm.includes('anegado') || cHa > sobrecargaThreshold) {
    return {
      stroke: '#EF4444',
      fill: '#EF4444',
      badge: 'bg-red-100 text-red-800 border-red-300',
      dot: 'bg-red-500',
      label: cHa > sobrecargaThreshold ? `Sobrecarga (${cHa} cab/ha > ${sobrecargaThreshold})` : (estado || 'Sobrecarga / Crítico'),
    };
  }

  // 2. Carga media/alta (entre receptividad y receptividad * 1.25)
  if (cHa > recep) {
    return {
      stroke: '#F59E0B',
      fill: '#F59E0B',
      badge: 'bg-amber-100 text-amber-800 border-amber-300',
      dot: 'bg-amber-500',
      label: `Carga media/alta (${cHa} cab/ha)`,
    };
  }

  // 3. Carga óptima (<= receptividad EV/ha)
  if (cHa > 0 || heads > 0 || norm.includes('pastoreo') || norm.includes('ocupado')) {
    return {
      stroke: '#10B981',
      fill: '#10B981',
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      dot: 'bg-emerald-500',
      label: cHa > 0 ? `Carga óptima (${cHa} cab/ha)` : 'Carga óptima',
    };
  }

  // 4. En Siembra Activa
  if (norm.includes('siembra')) {
    return {
      stroke: '#06B6D4',
      fill: '#0891B2',
      badge: 'bg-cyan-100 text-cyan-800 border-cyan-300',
      dot: 'bg-cyan-500',
      label: 'En siembra',
    };
  }

  // 5. En descanso / Disponible (0 cab.) -> Gris pizarra / Celeste suave
  return {
    stroke: '#38BDF8',
    fill: '#64748B',
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    dot: 'bg-slate-400',
    label: estado || 'En descanso (0 cab.)',
  };
}

export function getPasturaStyle(potrero, siembrasMap = {}) {
  const pNum = Number(potrero?.numero);
  const siembra = siembrasMap[pNum];
  const siembraActiva = siembra && esSiembraActiva(siembra) ? siembra : null;

  // Si no hay una siembra activa para este potrero, retornar estilo limpio de Campo Natural
  if (!siembraActiva) {
    return {
      stroke: '#65A30D',
      fill: '#84CC16',
      label: 'Campo Natural',
      badge: 'bg-lime-100 text-lime-900 border-lime-300',
    };
  }

  const cult = (siembraActiva.cultivo_variedad || '').toLowerCase();
  const labelBase = siembraActiva.cultivo_variedad || 'Pastura / Verdeo';

  // 1. Maíz / Sorgo / Granos = tono ámbar / dorado
  if (cult.includes('maiz') || cult.includes('maíz') || cult.includes('sorgo')) {
    return {
      stroke: '#D97706',
      fill: '#F59E0B',
      label: labelBase,
      badge: 'bg-amber-100 text-amber-900 border-amber-300',
    };
  }

  // 2. Pastura Consociada / Festuca / Trébol = verde esmeralda intenso
  if (
    cult.includes('festuca') ||
    cult.includes('consociada') ||
    cult.includes('trébol') ||
    cult.includes('trebol') ||
    cult.includes('lotus') ||
    cult.includes('pastura')
  ) {
    return {
      stroke: '#047857',
      fill: '#059669',
      label: labelBase,
      badge: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    };
  }

  // 3. Verdeo de Invierno / Avena / Raigrás = turquesa
  if (
    cult.includes('avena') ||
    cult.includes('verdeo') ||
    cult.includes('raigrás') ||
    cult.includes('raigras') ||
    cult.includes('centeno')
  ) {
    return {
      stroke: '#0891B2',
      fill: '#06B6D4',
      label: labelBase,
      badge: 'bg-cyan-100 text-cyan-900 border-cyan-300',
    };
  }

  // 4. Alfalfa = violeta / índigo
  if (cult.includes('alfalfa')) {
    return {
      stroke: '#6366F1',
      fill: '#8B5CF6',
      label: labelBase,
      badge: 'bg-purple-100 text-purple-900 border-purple-300',
    };
  }

  // 5. Agropiro / Halófitas = naranja / ocre
  if (cult.includes('agropiro')) {
    return {
      stroke: '#C2410C',
      fill: '#EA580C',
      label: labelBase,
      badge: 'bg-orange-100 text-orange-900 border-orange-300',
    };
  }

  // 6. Campo Natural = verde suave (oliva suave)
  if (cult.includes('natural') || cult.includes('campo') || cult.includes('pastizal') || cult === '') {
    return {
      stroke: '#65A30D',
      fill: '#84CC16',
      label: 'Campo Natural',
      badge: 'bg-lime-100 text-lime-900 border-lime-300',
    };
  }

  // 7. Sin asignar = gris pizarra
  return {
    stroke: '#64748B',
    fill: '#475569',
    label: labelBase || 'Sin asignar',
    badge: 'bg-slate-100 text-slate-900 border-slate-300',
  };
}

export function getAmbienteStyle(potrero) {
  const amb = (potrero?.ambiente || '').toLowerCase();

  // Loma = verde claro
  if (amb.includes('loma') && !amb.includes('mixto')) {
    return {
      stroke: '#16A34A',
      fill: '#22C55E',
      label: potrero?.ambiente || 'Loma',
      badge: 'bg-green-100 text-green-900 border-green-300',
    };
  }

  // Mixto Loma/Bajo = ámbar / ocre
  if (amb.includes('mixto')) {
    return {
      stroke: '#D97706',
      fill: '#F59E0B',
      label: potrero?.ambiente || 'Mixto Loma/Bajo',
      badge: 'bg-amber-100 text-amber-900 border-amber-300',
    };
  }

  // Bajo Salino = rosa / rojo
  if (amb.includes('salino')) {
    return {
      stroke: '#E11D48',
      fill: '#F43F5E',
      label: potrero?.ambiente || 'Bajo Salino',
      badge: 'bg-rose-100 text-rose-900 border-rose-300',
    };
  }

  // Bajo Anegable = púrpura
  if (amb.includes('anegable')) {
    return {
      stroke: '#7C3AED',
      fill: '#8B5CF6',
      label: potrero?.ambiente || 'Bajo Anegable',
      badge: 'bg-purple-100 text-purple-900 border-purple-300',
    };
  }

  // Bajo Dulce / Natural = azul / turquesa
  return {
    stroke: '#0284C7',
    fill: '#06B6D4',
    label: potrero?.ambiente || 'Bajo Dulce / Natural',
    badge: 'bg-sky-100 text-sky-900 border-sky-300',
  };
}

function calcRodeoHeads(r) {
  if (!r) return 0;
  return (
    (Number(r.vacas) || 0) +
    (Number(r.terneros) || 0) +
    (Number(r.toros_padres) || 0) +
    (Number(r.toritos) || 0) +
    (Number(r.vacas_cut) || 0) +
    (Number(r.vaquillonas_reposicion) || 0)
  );
}

export function getLayerKeyForInfra(item) {
  if (!item) return 'molinos';
  const tipo = item.tipo || 'Molino';
  if (tipo === 'Molino') return 'molinos';
  if (tipo === 'Tanque Australiano' || tipo === 'Bebida') return 'tanques_bebidas';
  if (tipo === 'Corrales y Mangas') return 'corrales_mangas';
  if (tipo === 'Tranquera' || tipo === 'Tranquerón') return 'tranqueras';
  if (
    tipo === 'Monte / Sombra' ||
    tipo.toLowerCase().includes('monte') ||
    tipo.toLowerCase().includes('sombra')
  ) {
    return 'montes_sombra';
  }
  if (tipo === 'Mangrullo / Bomba Casco') return 'mangrullo';
  if (tipo === 'Camino Operativo' || tipo.toLowerCase().includes('camino')) return 'caminos';
  if (
    tipo.toLowerCase().includes('eléctric') ||
    tipo.toLowerCase().includes('boyero') ||
    tipo.toLowerCase().includes('alambrado')
  ) {
    return 'alambres_electricos';
  }
  const isSolar =
    item.solarizado ||
    tipo === 'Paneles Solares' ||
    (item.nombre || '').toLowerCase().includes('panel');
  if (isSolar) return 'paneles_solares';
  return 'casco_edificaciones';
}

export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function clusterWaterElements(items, maxDistance = 75) {
  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < items.length; i++) {
    if (visited.has(items[i].id)) continue;
    const cluster = [items[i]];
    visited.add(items[i].id);

    for (let j = i + 1; j < items.length; j++) {
      if (visited.has(items[j].id)) continue;
      const d = getDistanceMeters(
        Number(items[i].latitud),
        Number(items[i].longitud),
        Number(items[j].latitud),
        Number(items[j].longitud)
      );
      if (d <= maxDistance) {
        cluster.push(items[j]);
        visited.add(items[j].id);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// Helper para determinar el estilo visual del marcador: 'chip' (defecto) | 'tarjeta' | 'icono'
export function getInfraEstilo(inf) {
  if (inf?.estilo_marcador && ['chip', 'tarjeta', 'icono'].includes(inf.estilo_marcador)) {
    return inf.estilo_marcador;
  }
  const combined = `${inf?.componentes_detalle || ''} ${inf?.observaciones || ''}`;
  const match = combined.match(/\[?estilo:([a-z]+)\]?/i);
  if (match && ['chip', 'tarjeta', 'icono'].includes(match[1].toLowerCase())) {
    return match[1].toLowerCase();
  }
  return 'chip';
}

// Configuración visual nítida por tipo de infraestructura para marcadores autoexplicativos
export function getInfraVisualInfo(inf) {
  const tipo = inf?.tipo || 'Molino';
  const t = tipo.toLowerCase();
  const nombre = inf?.nombre || 'Punto';
  const codigo = inf?.codigo || '';
  const isAlert = (inf?.estado || 'Operativo') !== 'Operativo';
  const isSolar = Boolean(
    inf?.solarizado ||
    tipo === 'Paneles Solares' ||
    (inf?.nombre || '').toLowerCase().includes('panel') ||
    (inf?.componentes_detalle || '').toLowerCase().includes('solar')
  );

  let cat = 'otro';
  let icon = '📍';
  let bg = '#f8fafc';
  let border = '#94a3b8';
  let text = '#0f172a';
  let badgeBg = '#e2e8f0';
  let badgeText = '#334155';

  if (tipo === 'Molino' || t.includes('molino')) {
    cat = 'molino';
    icon = isSolar ? '☀️💨' : '💨';
    bg = isAlert ? '#fef2f2' : '#f0f9ff';
    border = isAlert ? '#ef4444' : '#0284c7';
    text = isAlert ? '#991b1b' : '#0369a1';
    badgeBg = '#e0f2fe';
    badgeText = '#0369a1';
  } else if (tipo === 'Tanque Australiano' || t.includes('tanque')) {
    cat = 'tanque';
    icon = '🛢️';
    bg = isAlert ? '#fef2f2' : '#eff6ff';
    border = isAlert ? '#ef4444' : '#2563eb';
    text = isAlert ? '#991b1b' : '#1d4ed8';
    badgeBg = '#dbeafe';
    badgeText = '#1e40af';
  } else if (tipo === 'Bebida' || t.includes('bebida')) {
    cat = 'bebida';
    icon = '💧';
    bg = isAlert ? '#fffbeb' : '#f0f9ff';
    border = isAlert ? '#f59e0b' : '#0ea5e9';
    text = isAlert ? '#b45309' : '#0369a1';
    badgeBg = '#e0f2fe';
    badgeText = '#0284c7';
  } else if (tipo === 'Corrales y Mangas' || t.includes('corral') || t.includes('manga')) {
    cat = 'corral';
    icon = '🚧'; // Ícono cerco/manga para no confundir con rodeos activos
    bg = isAlert ? '#fef2f2' : '#fffbeb';
    border = isAlert ? '#ef4444' : '#f59e0b';
    text = isAlert ? '#991b1b' : '#b45309';
    badgeBg = '#fef3c7';
    badgeText = '#92400e';
  } else if (tipo === 'Tranquera' || tipo === 'Tranquerón' || t.includes('tranquera') || t.includes('tranquer')) {
    cat = 'tranquera';
    icon = tipo === 'Tranquerón' || t.includes('tranquer') ? '🚜' : '🚪';
    bg = isAlert ? '#fef2f2' : '#f0fdf4';
    border = isAlert ? '#ef4444' : '#16a34a';
    text = isAlert ? '#991b1b' : '#15803d';
    badgeBg = '#dcfce7';
    badgeText = '#166534';
  } else if (
    tipo === 'Edificación / Casco' ||
    t.includes('casco') ||
    t.includes('galpón') ||
    t.includes('galpon') ||
    t.includes('taller') ||
    t.includes('edific')
  ) {
    cat = 'casco';
    icon = t.includes('galpón') || t.includes('galpon') || t.includes('taller') ? '🏢' : '🏡';
    bg = isAlert ? '#fef2f2' : '#f5f3ff';
    border = isAlert ? '#ef4444' : '#8b5cf6';
    text = isAlert ? '#991b1b' : '#6d28d9';
    badgeBg = '#ede9fe';
    badgeText = '#5b21b6';
  } else if (tipo === 'Mangrullo / Bomba Casco' || t.includes('mangrullo') || t.includes('bomba')) {
    cat = 'mangrullo';
    icon = '🗼';
    bg = isAlert ? '#fef2f2' : '#f0fdfa';
    border = isAlert ? '#ef4444' : '#0f766e';
    text = isAlert ? '#991b1b' : '#0f766e';
    badgeBg = '#ccfbf1';
    badgeText = '#115e59';
  } else if (tipo === 'Monte / Sombra' || t.includes('monte') || t.includes('sombra')) {
    cat = 'monte';
    icon = '🌳';
    bg = '#f0fdf4';
    border = '#15803d';
    text = '#166534';
    badgeBg = '#dcfce7';
    badgeText = '#14532d';
  } else if (isSolar) {
    cat = 'solar';
    icon = '☀️';
    bg = isAlert ? '#fef2f2' : '#fefce8';
    border = isAlert ? '#ef4444' : '#eab308';
    text = isAlert ? '#991b1b' : '#854d0e';
    badgeBg = '#fef9c3';
    badgeText = '#713f12';
  }

  // Si tiene emoji personalizado en icono o emoji, usarlo
  if (inf?.icono) icon = inf.icono;
  else if (inf?.emoji) icon = inf.emoji;

  // Etiqueta corta legible autoexplicativa
  let shortLabel = nombre;
  if (tipo === 'Molino') {
    const mNum = inf?.molino_id_ref || codigo.replace(/^M/i, '') || '';
    if (mNum) {
      if (!nombre.toUpperCase().startsWith('M') && !nombre.toLowerCase().includes('molino')) {
        shortLabel = `M${mNum} · ${nombre}`;
      } else {
        shortLabel = nombre.includes('·') ? nombre : `M${mNum} · ${nombre.replace(/^M\d+\s*[-·]?\s*/i, '')}`;
      }
    }
  } else if (tipo === 'Tanque Australiano' && codigo) {
    shortLabel = `${codigo} · ${nombre.replace(/tanque\s*australiano/i, 'Tanque')}`;
  } else if (codigo && !nombre.includes(codigo)) {
    shortLabel = `${codigo} · ${nombre}`;
  }

  let subtitle = `${inf?.estado || 'Operativo'}`;
  if (tipo === 'Molino' && isSolar) subtitle = `Bomba Solar · ${inf?.estado || 'Operativo'}`;
  else if (inf?.potreros_abastecidos) subtitle = `Abastece: ${inf.potreros_abastecidos}`;
  else if (inf?.potrero_numero) subtitle = `Potrero #${inf.potrero_numero}`;

  return {
    cat,
    icon,
    bg,
    border,
    text,
    badgeBg,
    badgeText,
    shortLabel,
    subtitle,
    isAlert,
  };
}

// Formatea el título evitando repeticiones redundantes (ej: "Monte / Sombra: Monte / Sombra P4" -> "Monte / Sombra P4")
export function formatInfraTitulo(inf) {
  if (!inf) return '';
  const tipo = (inf.tipo || '').trim();
  const nombre = (inf.nombre || '').trim();
  if (!tipo) return nombre;
  if (!nombre) return tipo;

  const normTipo = tipo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normNombre = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const primerPalabraTipo = normTipo.split(/[\s/]/)[0];

  if (normNombre.startsWith(normTipo) || (primerPalabraTipo.length >= 3 && normNombre.startsWith(primerPalabraTipo))) {
    return nombre;
  }

  if (normNombre === normTipo) {
    return nombre;
  }

  return `${tipo}: ${nombre}`;
}

// Limpia componentes_detalle excluyendo metadatos de renderizado como icono: o estilo:
export function limpiarComponentesDetalle(comp) {
  if (!comp || typeof comp !== 'string') return '';
  const items = comp
    .split(/[|,;]/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !s.toLowerCase().startsWith('icono:') &&
        !s.toLowerCase().startsWith('estilo:') &&
        !s.toLowerCase().startsWith('potreros:')
    );
  return items.join(' · ');
}

// Limpia observaciones removiendo tags crudos entre corchetes como [icono:...], [estilo:...], etc.
export function limpiarTextoObservaciones(txt) {
  if (!txt || typeof txt !== 'string') return '';
  return txt
    .replace(/\[(?:icono|estilo|estilo_marcador)\s*:[^\]]*\]/gi, '')
    .replace(/\[potreros:[^\]]*\]/gi, '')
    .replace(/\[conecta:[^\]]*\]/gi, '')
    .replace(/\bicono\s*:\s*[^\s|,;]+/gi, '')
    .replace(/\bestilo\s*:\s*[^\s|,;]+/gi, '')
    .replace(/\|\s*\|/g, '|')
    .trim();
}

// Generador de marcadores DivIcon de alto contraste con 3 estilos: 'chip' | 'tarjeta' | 'icono'
export function buildInfraDivIcon(inf, userStyle = null, isDraggable = false, globalShowLabels = true, isHighlighted = false) {
  const info = getInfraVisualInfo(inf);
  const cursorStyle = isDraggable ? 'cursor:grab;' : 'cursor:pointer;';
  const highlightRing = isHighlighted
    ? 'box-shadow: 0 0 0 3.5px #f59e0b, 0 0 18px rgba(245, 158, 11, 0.95); transform: scale(1.12); z-index: 5000;'
    : '';
  
  let estilo = userStyle || getInfraEstilo(inf);
  if (!globalShowLabels) {
    estilo = 'icono';
  }

  const alertDot = info.isAlert
    ? `<span style="width:7px;height:7px;border-radius:9999px;background:#ef4444;box-shadow:0 0 5px #ef4444;margin-left:3px;flex-shrink:0;display:inline-block;" title="Alerta / Fuera de servicio"></span>`
    : '';

  // 1. ESTILO CHIP (POR DEFECTO): Píldora de alto contraste con Ícono + Texto
  if (estilo === 'chip') {
    const html = `<div style="${highlightRing}display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 6px;border-radius:9999px;background:${info.bg};border:1.5px solid ${isHighlighted ? '#f59e0b' : info.border};box-shadow:0 2px 7px rgba(0,0,0,0.42);font-family:inherit;font-size:11.5px;font-weight:800;color:${info.text};white-space:nowrap;line-height:1.2;${cursorStyle}transition:transform 0.15s;user-select:none;" title="${inf.nombre} (${inf.tipo})">
      <span style="font-size:13px;line-height:1;display:flex;align-items:center;">${info.icon}</span>
      <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${info.shortLabel}</span>
      ${alertDot}
    </div>`;

    return L.divIcon({
      className: 'infra-chip-marker-wrapper',
      html,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  // 2. ESTILO TARJETA (2 LÍNEAS): Tarjeta compacta con Ícono, Título y Subtítulo
  if (estilo === 'tarjeta') {
    const html = `<div style="${highlightRing}display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:10px;background:#ffffff;border:1.5px solid ${info.border};box-shadow:0 3px 10px rgba(0,0,0,0.45);font-family:inherit;${cursorStyle}transition:transform 0.15s;user-select:none;min-width:110px;max-width:180px;" title="${inf.nombre} (${inf.tipo})">
      <span style="font-size:16px;line-height:1;padding:4px;border-radius:8px;background:${info.bg};border:1px solid ${info.border};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${info.icon}</span>
      <div style="min-width:0;flex:1;">
        <div style="font-size:11.5px;font-weight:900;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2;display:flex;align-items:center;gap:3px;">
          <span style="overflow:hidden;text-overflow:ellipsis;">${info.shortLabel}</span>
          ${alertDot}
        </div>
        <div style="font-size:9.5px;font-weight:700;color:${info.text};opacity:0.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2;margin-top:1px;">
          ${info.subtitle}
        </div>
      </div>
    </div>`;

    return L.divIcon({
      className: 'infra-chip-marker-wrapper',
      html,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  // 3. ESTILO SOLO ÍCONO: Círculo compacto con ícono solo
  const html = `<div style="${highlightRing}display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:${info.bg};border:2px solid ${info.border};box-shadow:0 2px 7px rgba(0,0,0,0.45);font-size:13px;line-height:1;${cursorStyle}transition:transform 0.15s;position:relative;" title="${inf.nombre} (${inf.tipo})">
    ${info.icon}
    ${info.isAlert ? `<span style="position:absolute;top:-2px;right:-2px;width:7px;height:7px;border-radius:9999px;background:#ef4444;border:1px solid #ffffff;box-shadow:0 0 4px #ef4444;"></span>` : ''}
  </div>`;

  return L.divIcon({
    className: 'infra-chip-marker-wrapper',
    html,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function getInfraIconConfig(item) {
  const tipo = item.tipo || 'Molino';
  const est = item.estado || 'Operativo';
  const isAlert = est !== 'Operativo';

  if (tipo === 'Molino') {
    const baseCode = item.codigo || `M${item.molino_id_ref || ''}`;
    return {
      bg: isAlert ? '#dc2626' : item.solarizado ? '#059669' : '#0284c7',
      shape: '999px',
      code: item.solarizado ? `☀️${baseCode}` : baseCode,
      size: item.solarizado ? 26 : 24,
    };
  }
  if (tipo === 'Corrales y Mangas') {
    return {
      bg: isAlert ? '#dc2626' : '#c2410c',
      shape: '7px',
      code: item.codigo || 'COR',
      size: 26,
    };
  }
  if (tipo === 'Mangrullo / Bomba Casco') {
    return {
      bg: isAlert ? '#dc2626' : '#0f766e',
      shape: '8px',
      code: item.codigo || 'MGR',
      size: 25,
    };
  }
  if (tipo === 'Tanque Australiano') {
    return {
      bg: isAlert ? '#dc2626' : '#0d9488',
      shape: '999px',
      code: item.codigo || 'TA',
      size: 24,
    };
  }
  if (tipo === 'Bebida') {
    return {
      bg: isAlert ? '#d97706' : '#0284c7',
      shape: '7px',
      code: item.codigo && item.codigo.startsWith('BEB-') ? '💧' : (item.codigo || '💧'),
      size: 22,
    };
  }
  if (tipo === 'Tranquera') {
    return {
      bg: isAlert ? '#dc2626' : '#1e293b',
      shape: '6px',
      code: '🚪',
      size: 22,
    };
  }
  if (tipo === 'Tranquerón') {
    return {
      bg: '#dc2626',
      shape: '6px',
      code: '🚜 TQN',
      size: 26,
    };
  }
  if (
    tipo === 'Monte / Sombra' ||
    tipo.toLowerCase().includes('monte') ||
    tipo.toLowerCase().includes('sombra')
  ) {
    return {
      bg: '#166534',
      shape: '999px',
      code: '🌳',
      size: 24,
    };
  }
  const isSolar =
    item.solarizado ||
    tipo === 'Paneles Solares' ||
    (item.nombre || '').toLowerCase().includes('panel');
  if (isSolar) {
    return {
      bg: isAlert ? '#dc2626' : '#eab308',
      shape: '6px',
      code: item.codigo || '☀️SOL',
      size: 25,
    };
  }
  return {
    bg: isAlert ? '#dc2626' : '#475569',
    shape: '6px',
    code: item.codigo || '🏛️',
    size: 24,
  };
}

export function isMinimalistInfra(inf) {
  if (!inf || !inf.tipo) return false;
  const t = inf.tipo.toLowerCase();
  return (
    inf.tipo === 'Tranquera' ||
    inf.tipo === 'Tranquerón' ||
    inf.tipo === 'Bebida' ||
    t.includes('tranquera') ||
    t.includes('tranquer') ||
    t.includes('bebida') ||
    t.includes('monte') ||
    t.includes('sombra')
  );
}

export function getMinimalistInfraIcon(inf, isDraggable = true) {
  const tipo = inf.tipo || '';
  const t = tipo.toLowerCase();
  const isAlert = (inf.estado || 'Operativo') !== 'Operativo';
  const cursorStyle = isDraggable ? 'cursor:grab;' : 'cursor:pointer;';

  // 1. TRANQUERA: Ícono SVG fino y compacto (16px), hoja de tranquera en negro/gris oscuro (#1e293b) con halo sutil
  if (tipo === 'Tranquera' || (t.includes('tranquera') && !t.includes('tranquer'))) {
    const strokeColor = isAlert ? '#dc2626' : '#1e293b';
    return L.divIcon({
      className: 'infra-minimalist-marker infra-tranquera-marker',
      html: `<div style="display:flex;align-items:center;justify-content:center;width:16px;height:16px;${cursorStyle}transition:transform 0.15s;" title="${inf.nombre || 'Tranquera'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 1.5px #ffffff) drop-shadow(0 0 3px #ffffff) drop-shadow(0 1px 2px rgba(0,0,0,0.6));">
          <path d="M4 4v16" stroke-width="3" />
          <path d="M20 4v16" stroke-width="3" />
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
          <path d="M4 7l16 10" stroke-width="1.8" />
        </svg>
      </div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  // 2. TRANQUERÓN: Ícono SVG compacto (18px) con doble barra transversal en rojo carmesí fino (#dc2626)
  if (tipo === 'Tranquerón' || t.includes('tranquer')) {
    return L.divIcon({
      className: 'infra-minimalist-marker infra-tranqueron-marker',
      html: `<div style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;${cursorStyle}transition:transform 0.15s;" title="${inf.nombre || 'Tranquerón'}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 1.5px #ffffff) drop-shadow(0 0 3.5px #ffffff) drop-shadow(0 1px 3px rgba(0,0,0,0.6));">
          <path d="M3 4v16" stroke-width="3" />
          <path d="M21 4v16" stroke-width="3" />
          <path d="M3 6h18" />
          <path d="M3 11h18" />
          <path d="M3 15h18" />
          <path d="M3 19h18" />
          <path d="M3 6l18 13" stroke-width="2" />
          <path d="M3 19l18-13" stroke-width="2" />
        </svg>
      </div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  // 3. BEBIDA: Ícono SVG compacto (15px) de bebedero/gota en azul celeste limpio (#0284c7)
  if (tipo === 'Bebida' || t.includes('bebida')) {
    const fillColor = isAlert ? '#d97706' : '#0284c7';
    return L.divIcon({
      className: 'infra-minimalist-marker infra-bebida-marker',
      html: `<div style="display:flex;align-items:center;justify-content:center;width:15px;height:15px;${cursorStyle}transition:transform 0.15s;" title="${inf.nombre || 'Bebida'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${fillColor}" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 2px #ffffff) drop-shadow(0 1px 3px rgba(0,0,0,0.6));">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
          <path d="M7 16c1.5-0.8 3-0.8 4.5 0s3 0.8 4.5 0" fill="none" stroke="#ffffff" stroke-width="1.8" />
        </svg>
      </div>`,
      iconSize: [15, 15],
      iconAnchor: [7.5, 7.5],
    });
  }

  // 4. MONTE: Ícono SVG compacto (16px) de árbol/arboleda en verde bosque (#15803d)
  if (t.includes('monte') || t.includes('sombra')) {
    return L.divIcon({
      className: 'infra-minimalist-marker infra-monte-marker',
      html: `<div style="display:flex;align-items:center;justify-content:center;width:16px;height:16px;${cursorStyle}transition:transform 0.15s;" title="${inf.nombre || 'Monte / Sombra'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#15803d" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 2px #ffffff) drop-shadow(0 1px 3px rgba(0,0,0,0.6));">
          <path d="M12 2C7.8 2 4.5 5.3 4.5 9.5c0 2 0.8 3.8 2.1 5.1C6.2 15.3 6 16.1 6 17c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2 0-.9-.2-1.7-.6-2.4 1.3-1.3 2.1-3.1 2.1-5.1C19.5 5.3 16.2 2 12 2z" />
          <path d="M12 14v7" stroke="#ffffff" stroke-width="2.2" />
        </svg>
      </div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  return null;
}

// ============================================================================
// CÁLCULO GEOGRÁFICO DE DISTANCIA PUNTO-A-POLÍGONO Y AUTO-VINCULACIÓN DE ALAMBRADOS
// ============================================================================

// Distancia ortogonal mínima en metros entre un punto P(lat, lng) y el segmento AB
export function distPointToSegmentMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
  const midLat = (aLat + bLat) / 2;
  const rad = (midLat * Math.PI) / 180;
  const mPerLat = 110940;
  const mPerLng = 111320 * Math.cos(rad);

  const xP = (pLng - aLng) * mPerLng;
  const yP = (pLat - aLat) * mPerLat;
  const xB = (bLng - aLng) * mPerLng;
  const yB = (bLat - aLat) * mPerLat;

  const lenSq = xB * xB + yB * yB;
  if (lenSq < 1e-6) {
    return Math.sqrt(xP * xP + yP * yP);
  }

  const t = Math.max(0, Math.min(1, (xP * xB + yP * yB) / lenSq));
  const dx = xP - t * xB;
  const dy = yP - t * yB;
  return Math.sqrt(dx * dx + dy * dy);
}

// Determina si un punto [lat, lng] está contenido en un anillo [lng, lat]
export function isPointInRingCoords(lat, lng, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const xi = Number(ring[a][0]);
    const yi = Number(ring[a][1]);
    const xj = Number(ring[b][0]);
    const yj = Number(ring[b][1]);
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Calcula la distancia mínima en metros entre un punto y el contorno/alambrado de un potrero
// Si el punto está adentro, devuelve 0 (en el lote)
export function calcularDistanciaPuntoAPotreroMeters(lat, lng, potrero, idx = 0) {
  if (!potrero || lat == null || lng == null) return Infinity;

  const geom = potrero.geojson_polygon || buildFallbackPolygon(potrero.numero, idx, Number(potrero.hectareas) || 80);
  if (!geom || !geom.coordinates || !Array.isArray(geom.coordinates[0])) return Infinity;

  const ring = geom.coordinates[0]; // [lng, lat]
  if (isPointInRingCoords(lat, lng, ring)) {
    return 0;
  }

  let minDist = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const aLng = Number(ring[i][0]);
    const aLat = Number(ring[i][1]);
    const bLng = Number(ring[i + 1][0]);
    const bLat = Number(ring[i + 1][1]);
    const d = distPointToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng);
    if (d < minDist) {
      minDist = d;
    }
  }

  return minDist;
}

// Detecta todos los potreros adyacentes o que contienen el punto dentro de un radio de tolerancia (20m)
export function detectarPotrerosConectados(lat, lng, potreros, maxDistMetros = 20) {
  if (!potreros || !Array.isArray(potreros) || lat == null || lng == null) return [];
  const matches = [];

  for (let i = 0; i < potreros.length; i++) {
    const p = potreros[i];
    const dist = calcularDistanciaPuntoAPotreroMeters(lat, lng, p, i);
    if (dist <= maxDistMetros) {
      matches.push({
        potrero: p,
        numero: Number(p.numero),
        nombre: p.nombre || `Potrero ${p.numero}`,
        distancia: dist,
      });
    }
  }

  matches.sort((a, b) => a.distancia - b.distancia);
  return matches;
}

// Genera nombre auto-explicativo para Tranqueras o Tranquerones según los potreros conectados
export function generarNombreTranquera(tipo, potrerosConectados) {
  const t = tipo || 'Tranquera';
  if (!potrerosConectados || potrerosConectados.length === 0) return t;

  if (potrerosConectados.length >= 2) {
    const p1 = potrerosConectados[0].numero;
    const p2 = potrerosConectados[1].numero;
    return `${t} P${p1} ↔ P${p2}`;
  }

  return `${t} P${potrerosConectados[0].numero}`;
}

// Obtiene los números de potreros conectados por un ítem de infraestructura
export function getPotrerosConectadosInfra(inf, potreros) {
  if (!inf) return [];
  const encontrados = new Set();

  if (inf.potrero_numero != null && !Number.isNaN(Number(inf.potrero_numero))) {
    encontrados.add(Number(inf.potrero_numero));
  }

  // Escanear observaciones o nombre en busca de [potreros:6,8] o P6 ↔ P8
  const text = `${inf.observaciones || ''} ${inf.componentes_detalle || ''} ${inf.nombre || ''}`;
  const mTags = text.match(/\[potreros:([^\]]+)\]/i);
  if (mTags) {
    mTags[1].split(',').forEach((num) => {
      const n = parseInt(num.trim(), 10);
      if (!Number.isNaN(n)) encontrados.add(n);
    });
  }

  const mPair = text.match(/P(\d+)\s*(?:↔|<->|-)\s*P(\d+)/i);
  if (mPair) {
    encontrados.add(parseInt(mPair[1], 10));
    encontrados.add(parseInt(mPair[2], 10));
  }

  // Si tiene coordenadas GPS válidas, calcular proximidad en vivo a los polígonos
  const lat = Number(inf.latitud);
  const lng = Number(inf.longitud);
  if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0 && Array.isArray(potreros)) {
    const list = detectarPotrerosConectados(lat, lng, potreros, 20);
    list.forEach((m) => encontrados.add(m.numero));
  }

  return Array.from(encontrados).sort((a, b) => a - b);
}

export function detectarPotreroEnPunto(lat, lng, potreros) {
  if (!potreros || !Array.isArray(potreros)) return null;
  // 1. Interior con ray-casting
  for (let i = 0; i < potreros.length; i++) {
    const p = potreros[i];
    const geom = p?.geojson_polygon || buildFallbackPolygon(p?.numero, i, Number(p?.hectareas) || 80);
    if (geom && geom.coordinates && geom.type === 'Polygon' && Array.isArray(geom.coordinates[0])) {
      if (isPointInRingCoords(lat, lng, geom.coordinates[0])) {
        return p;
      }
    }
  }

  // 2. Proximidad al alambrado (tolerancia de 20 metros)
  let closest = null;
  let minD = Infinity;
  for (let i = 0; i < potreros.length; i++) {
    const p = potreros[i];
    const d = calcularDistanciaPuntoAPotreroMeters(lat, lng, p, i);
    if (d <= 20 && d < minD) {
      minD = d;
      closest = p;
    }
  }
  return closest;
}

// Helper: Extraer vértices únicos [lat, lng] de un potrero para edición interactiva
function getPotreroVertices(potrero, idx = 0) {
  if (!potrero) return [];
  const geom = potrero.geojson_polygon || buildFallbackPolygon(potrero.numero, idx, Number(potrero.hectareas) || 80);
  if (geom && geom.coordinates && Array.isArray(geom.coordinates[0])) {
    const ring = geom.coordinates[0];
    // GeoJSON es [lng, lat], convertimos a [lat, lng] para Leaflet
    const pts = ring.map((pt) => [Number(pt[1]), Number(pt[0])]);
    // Si el primer y último punto son iguales, quitamos el último para vértices únicos
    if (pts.length > 1) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) {
        pts.pop();
      }
    }
    return pts;
  }
  return [];
}

// Helper: Convertir vértices [lat, lng] a GeoJSON Polygon cerrado [lng, lat]
function verticesToGeoJson(vertices) {
  if (!vertices || vertices.length < 3) return null;
  const ring = vertices.map((pt) => [Number(Number(pt[1]).toFixed(6)), Number(Number(pt[0]).toFixed(6))]);
  // Cerrar el anillo agregando el primer punto al final
  ring.push([ring[0][0], ring[0][1]]);
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

function buildFallbackPolygon(numero, index, hectareas = 80) {
  const cols = 5;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const baseLat = LAS_FLORES_CENTER[0] - 0.015 + row * 0.0085;
  const baseLng = LAS_FLORES_CENTER[1] - 0.025 + col * 0.011;
  const scale = Math.max(0.004, Math.min(0.01, Math.sqrt(Number(hectareas) || 80) * 0.0008));

  return {
    type: 'Polygon',
    coordinates: [
      [
        [baseLng, baseLat],
        [baseLng + scale * 1.25, baseLat],
        [baseLng + scale * 1.25, baseLat + scale * 0.85],
        [baseLng, baseLat + scale * 0.85],
        [baseLng, baseLat],
      ],
    ],
  };
}

export function getPaddockCentroid(p, index = 0) {
  const geom = p?.geojson_polygon || buildFallbackPolygon(p?.numero, index, Number(p?.hectareas) || 80);
  if (geom && geom.coordinates) {
    let coords = [];
    if (geom.type === 'Polygon') {
      coords = geom.coordinates[0] || [];
    } else if (geom.type === 'MultiPolygon') {
      coords = geom.coordinates.flat(2) || [];
    } else if (Array.isArray(geom.coordinates)) {
      coords = geom.coordinates.flat(1) || [];
    }

    if (coords.length > 0) {
      let sumLat = 0;
      let sumLng = 0;
      let count = 0;
      for (const pt of coords) {
        if (Array.isArray(pt) && pt.length >= 2) {
          const lng = Number(pt[0]);
          const lat = Number(pt[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            sumLat += lat;
            sumLng += lng;
            count++;
          }
        }
      }
      if (count > 0) {
        return [sumLat / count, sumLng / count];
      }
    }
  }
  if (p?.latitud && p?.longitud) {
    const lat = Number(p.latitud);
    const lng = Number(p.longitud);
    if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
  }
  return LAS_FLORES_CENTER;
}

// Persistencia en sessionStorage de la cámara del mapa (coordenadas de centro y zoom)
export const STORAGE_KEY_MAPA_CAMARA = 'mapa_ultima_camara';

export const getSavedCamera = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_MAPA_CAMARA);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === 'number' &&
      !Number.isNaN(parsed.lat) &&
      typeof parsed?.lng === 'number' &&
      !Number.isNaN(parsed.lng) &&
      typeof parsed?.zoom === 'number' &&
      !Number.isNaN(parsed.zoom)
    ) {
      return parsed;
    }
  } catch (e) {
    console.warn('Error al leer cámara guardada:', e);
  }
  return null;
};

export const saveCameraToStorage = (map) => {
  if (!map || typeof window === 'undefined') return null;
  try {
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (
      center &&
      typeof center.lat === 'number' &&
      !Number.isNaN(center.lat) &&
      typeof center.lng === 'number' &&
      !Number.isNaN(center.lng) &&
      typeof zoom === 'number' &&
      !Number.isNaN(zoom)
    ) {
      const data = {
        lat: Number(center.lat.toFixed(6)),
        lng: Number(center.lng.toFixed(6)),
        zoom: Math.round(zoom),
      };
      sessionStorage.setItem(STORAGE_KEY_MAPA_CAMARA, JSON.stringify(data));
      return data;
    }
  } catch (e) {
    console.warn('Error al persistir cámara de mapa:', e);
  }
  return null;
};

export default function MapaPotrerosView({
  potreros = [],
  setPotreros = null,
  siembras = [],
  molinos = [],
  infraestructura = [],
  setInfraestructura = null,
  alertasMapa = [],
  caminos = [],
  rodeos = [],
  animales = [],
  fechaOperacion,
  isSandboxMode = false,
  initialSelectedPotreroNum,
  initialTargetInfra,
  onClearInitialPotrero,
  onClearTargetInfra,
  onCreateTareaFromItem,
  onOpenCuadrilla,
  activeCuadrillaRoute,
  onClearCuadrillaRoute,
  onNavigate,
  onRefresh,
  notify,
  isVisible = true,
  appMode = 'admin',
  isAdmin,
}) {
  const effectiveIsAdmin = typeof isAdmin === 'boolean'
    ? isAdmin
    : (appMode ? appMode === 'admin' : true);
  const mapWrapperRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);
  const tileLayersRef = useRef({});
  const fileInputRef = useRef(null);
  const hasFittedBoundsRef = useRef(false);
  const initialBoundsAppliedRef = useRef(false);

  // Modo Ampliar Mapa a Pantalla Completa y rotación cenital
  const [isExpanded, setIsExpanded] = useState(false);
  const [mapReadyToken, setMapReadyToken] = useState(0);

  // Zoom actual del mapa (para etiquetas y agrupación en Nodo de Aguada)
  const [currentZoom, setCurrentZoom] = useState(13);
  // Selector de densidad de carteles en mapa ('auto' | 'compacto' | 'detallado')
  const [labelDensity, setLabelDensity] = useState('auto');

  // Modo Arrastre libre (Drag & Drop) de pines de infraestructura
  const [dragMarkersEnabled, setDragMarkersEnabled] = useState(false);

  // Modal de Edición Completa para Infraestructura
  const [editingInfra, setEditingInfra] = useState(null);
  const [savingEditingInfra, setSavingEditingInfra] = useState(false);

  // Edición Visual de Trazas (Caminos y Alambrados Eléctricos por pines arrastrables)
  const [editingCamino, setEditingCamino] = useState(null);
  const [savingEditingCamino, setSavingEditingCamino] = useState(false);
  const [showCaminoDetailsModal, setShowCaminoDetailsModal] = useState(false);

  // Edición Visual de Vértices de Polígonos de Potreros (Ajuste fino de alambrados)
  const [editingPolygonPotreroId, setEditingPolygonPotreroId] = useState(null);
  const [editingPolygonCoords, setEditingPolygonCoords] = useState(null);
  const [backupPolygonCoords, setBackupPolygonCoords] = useState(null);
  const [savingPolygonGeom, setSavingPolygonGeom] = useState(false);

  // Visibilidad del Drawer de Potrero en Pantalla Completa
  const [fullscreenDrawerOpen, setFullscreenDrawerOpen] = useState(true);

  // Modo Reubicación Explícita de Marcador Específico (Bloqueo de arrastre accidental)
  const [movingInfra, setMovingInfra] = useState(null);
  const [savingMovingInfra, setSavingMovingInfra] = useState(false);

  const editingCaminoDistanceKm = useMemo(() => {
    if (
      !editingCamino ||
      !Array.isArray(editingCamino.coordenadas_json) ||
      editingCamino.coordenadas_json.length < 2
    ) {
      return '0.00';
    }
    let totalMeters = 0;
    const pts = editingCamino.coordenadas_json;
    for (let i = 0; i < pts.length - 1; i++) {
      if (Array.isArray(pts[i]) && Array.isArray(pts[i + 1])) {
        totalMeters += getDistanceMeters(
          Number(pts[i][0]),
          Number(pts[i][1]),
          Number(pts[i + 1][0]),
          Number(pts[i + 1][1])
        );
      }
    }
    return (totalMeters / 1000).toFixed(2);
  }, [editingCamino]);

  // Modal Detalle de Rodeo al hacer clic sobre su pastilla en el mapa
  const [rodeoDetailModal, setRodeoDetailModal] = useState(null);

  // Base map: 'google_hybrid' (evita cartel gris al hacer zoom) | 'esri_sat' | 'osm'
  const [mapStyle, setMapStyle] = useState('google_hybrid');

  // BLOQUE 1 — Pintura de Fondo de Potreros (selección única):
  // 'contornos' | 'semaforo' | 'pasturas' | 'ambientes'
  const [mapViewMode, setMapViewMode] = useState('semaforo');
  const [floatingPanelOpen, setFloatingPanelOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  const [activeSubTab, setActiveSubTab] = useState('potreros'); // 'potreros' | 'infraestructura' | 'alertas_caminos'
  const [selectedPotreroNum, setSelectedPotreroNum] = useState(
    initialSelectedPotreroNum || null
  );
  const [savingId, setSavingId] = useState(null);

  // Estados de Búsqueda y Filtros de la Tabla de Potreros
  const [potSearchTerm, setPotSearchTerm] = useState('');
  const [potFilterEstado, setPotFilterEstado] = useState('TODOS'); // 'TODOS' | 'CON_HACIENDA' | 'LIBRES'

  // BLOQUE 2 — Capas Superpuestas Independientes con Filtro Jerárquico
  const [layersVisible, setLayersVisible] = useState({
    potreros: true,
    potreros_numeros: true,
    rodeos_labels: true,
    etiquetas_marcadores: true,
    molinos: true,
    tanques_bebidas: true,
    corrales_mangas: true,
    tranqueras: true,
    montes_sombra: true,
    casco_edificaciones: false,
    mangrullo: false,
    paneles_solares: false,
    caminos: false,
    alambres_electricos: true,
    alertas: true,
  });

  const caminosOperativos = useMemo(() => {
    return (caminos || []).filter((c) => {
      const t = (c.tipo_traza || '').toLowerCase();
      const n = (c.nombre || '').toLowerCase();
      const isElec =
        t.includes('eléctric') ||
        t.includes('boyero') ||
        t.includes('alambrado') ||
        n.includes('eléctric') ||
        n.includes('boyero') ||
        n.includes('parcela');
      return !isElec;
    });
  }, [caminos]);

  const alambresElectricos = useMemo(() => {
    return (caminos || []).filter((c) => {
      const t = (c.tipo_traza || '').toLowerCase();
      const n = (c.nombre || '').toLowerCase();
      const isElec =
        t.includes('eléctric') ||
        t.includes('boyero') ||
        t.includes('alambrado') ||
        n.includes('eléctric') ||
        n.includes('boyero') ||
        n.includes('parcela');
      return isElec;
    });
  }, [caminos]);

  // Mapa de siembras activas por potrero (prevalece siempre la siembra Activa de fecha más reciente)
  const siembrasActivasMap = useMemo(() => {
    const map = {};
    const activas = (siembras || []).filter(
      (s) => esSiembraActiva(s) && Number(s.potrero_numero)
    );
    // Ordenar de más reciente a más antigua por fecha
    activas.sort((a, b) => {
      const dateA = a.fecha ? new Date(a.fecha).getTime() : 0;
      const dateB = b.fecha ? new Date(b.fecha).getTime() : 0;
      return dateB - dateA;
    });
    // La primera en aparecer para cada potrero es la más reciente
    activas.forEach((s) => {
      const pNum = Number(s.potrero_numero);
      if (!map[pNum]) {
        map[pNum] = s;
      }
    });
    return map;
  }, [siembras]);

  const [infraGroupOpen, setInfraGroupOpen] = useState(true);
  const [pinningInfra, setPinningInfra] = useState(null);
  const pinningInfraRef = useRef(null);
  const infraMarkersRef = useRef({});

  // Herramienta interactiva sobre el mapa: 'explore' | 'pin_infra' | 'add_infra' | 'add_alerta' | 'draw_camino'
  const [mapToolMode, setMapToolMode] = useState('explore');
  const [clickedCoords, setClickedCoords] = useState(null); // { lat, lng }
  const [drawingPoints, setDrawingPoints] = useState([]); // [[lat, lng], ...]

  // Modo de colocación manual rápida de puntos minimalistas (Tranquera, Tranquerón, Bebida, Monte)
  const [quickMarkType, setQuickMarkType] = useState(null); // 'Tranquera' | 'Tranquerón' | 'Bebida' | 'Monte / Sombra' | null
  const quickMarkTypeRef = useRef(null);
  quickMarkTypeRef.current = quickMarkType;
  const [showQuickMarkMenu, setShowQuickMarkMenu] = useState(false);
  const [activeInfraMenuId, setActiveInfraMenuId] = useState(null); // ID de infraestructura con menú ⋮ abierto
  const [showNewPointModal, setShowNewPointModal] = useState(false);
  const [pendingPointCoords, setPendingPointCoords] = useState(null);
  const [newPointForm, setNewPointForm] = useState({
    tipo: 'Tranquera',
    icono: '🚪',
    nombre: '',
    potrero_numero: '',
    estado: 'Operativo',
  });

  // Formulario para ubicar Infraestructura haciendo clic en el mapa (o en tabla)
  const [newInfra, setNewInfra] = useState({
    tipo: 'Tanque Australiano',
    codigo: '',
    nombre: '',
    potrero_numero: '',
    potreros_abastecidos: '',
    estado: 'Operativo',
    latitud: '',
    longitud: '',
    componentes_detalle: '',
    solarizado: false,
    observaciones: '',
  });
  const [filterTipoInfra, setFilterTipoInfra] = useState('TODOS');
  const [infraSubView, setInfraSubView] = useState('campo'); // 'campo' | 'edificaciones'

  // Formulario para clavar un Post-it / Alerta en el mapa
  const [newAlerta, setNewAlerta] = useState({
    titulo: '',
    tipo: 'Falta agua',
    prioridad: 'Alta',
    potrero_numero: '',
    observaciones: '',
  });
  const [editingAlerta, setEditingAlerta] = useState(null);
  const [updatingAlerta, setUpdatingAlerta] = useState(false);

  // Formulario para guardar Camino Operativo o Parcela Eléctrica trazada
  const [newCamino, setNewCamino] = useState({
    nombre: '',
    tipo_traza: 'Camino Interno',
    estado: 'Transitable',
    potrero_numero: '',
    observaciones: '',
  });

  // Estado del Panel Lateral Derecho del Potrero Seleccionado
  const [sideForm, setSideForm] = useState({
    nombre: '',
    hectareas: '',
    ambiente: 'Bajo Dulce',
    molino_id: '',
    cultivo_actual: '',
    recurso_forrajero: 'Campo Natural',
    receptividad_ev_ha: '0.90',
    estado_semaforo: 'Disponible',
    observaciones: '',
  });

  // Estado para mover un Rodeo desde el Panel Lateral del Mapa
  const [showMoveRodeoBox, setShowMoveRodeoBox] = useState(false);
  const [showArchivedSiembras, setShowArchivedSiembras] = useState(false);
  const [selectedRodeoIdToMove, setSelectedRodeoIdToMove] = useState('');
  const [moveTargetPotrero, setMoveTargetPotrero] = useState('');
  const [moveParcela, setMoveParcela] = useState('');
  const [moveFecha, setMoveFecha] = useState(
    fechaOperacion || new Date().toISOString().slice(0, 10)
  );
  const [moveObs, setMoveObs] = useState('');
  const [movingHacienda, setMovingHacienda] = useState(false);

  useEffect(() => {
    if (fechaOperacion) {
      setMoveFecha(fechaOperacion);
    }
  }, [fechaOperacion]);

  // Vista previa de importación GeoJSON / KML
  const [geoPreview, setGeoPreview] = useState(null);
  const [importingGeo, setImportingGeo] = useState(false);

  // Ediciones locales en la tabla inferior de potreros con auto-guardado
  const [editedPotreros, setEditedPotreros] = useState({});
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const autoSaveTimerRef = useRef(null);
  const debouncePotreroTimersRef = useRef({}); // { [potreroId]: timerId }
  const pendingPotrerosRef = useRef({}); // { [potreroId]: latestPotrero }

  useEffect(() => {
    if (initialSelectedPotreroNum != null) {
      setSelectedPotreroNum(initialSelectedPotreroNum);
      if (onClearInitialPotrero) onClearInitialPotrero();
    }
  }, [initialSelectedPotreroNum, onClearInitialPotrero]);

  useEffect(() => {
    const pMap = {};
    potreros.forEach((p) => {
      pMap[p.id] = { ...p };
    });
    setEditedPotreros(pMap);
  }, [potreros]);

  // Agrupar Rodeos por potrero_numero (fuente principal de carga ganadera en el mapa)
  const rodeosPorPotrero = useMemo(() => {
    const map = {};
    rodeos.forEach((r) => {
      if (r.potrero_numero != null) {
        const num = Number(r.potrero_numero);
        if (!map[num]) map[num] = [];
        map[num].push(r);
      }
    });
    return map;
  }, [rodeos]);

  // Conteo de cabezas por potrero (priorizando Planilla Maestra de Rodeos + caravanas individuales si un lote no tiene rodeo)
  const cabezasPorPotrero = useMemo(() => {
    const counts = {};
    // 1. Sumar desde la Planilla de Rodeos
    Object.entries(rodeosPorPotrero).forEach(([potNum, list]) => {
      counts[potNum] = list.reduce((acc, r) => acc + calcRodeoHeads(r), 0);
    });
    // 2. Si algún potrero tiene caravanas individuales y no tiene rodeo en planilla, sumarlas
    animales.forEach((a) => {
      if ((a.estado || 'En campo') === 'En campo' && a.potrero_actual != null) {
        const num = Number(a.potrero_actual);
        if (!rodeosPorPotrero[num] || rodeosPorPotrero[num].length === 0) {
          counts[num] = (counts[num] || 0) + 1;
        }
      }
    });
    return counts;
  }, [rodeosPorPotrero, animales]);

  // Potrero actualmente seleccionado en el Panel Lateral
  const selectedPotrero = useMemo(
    () => potreros.find((p) => Number(p.numero) === Number(selectedPotreroNum)) || null,
    [potreros, selectedPotreroNum]
  );

  const rodeosEnPotreroSeleccionado = useMemo(() => {
    if (!selectedPotrero) return [];
    return rodeosPorPotrero[Number(selectedPotrero.numero)] || [];
  }, [rodeosPorPotrero, selectedPotrero]);

  const prevSelectedPotreroNumRef = useRef(null);

  useEffect(() => {
    if (!selectedPotrero) {
      prevSelectedPotreroNumRef.current = null;
      return;
    }
    const currentNum = Number(selectedPotrero.numero);
    const potreroChanged = prevSelectedPotreroNumRef.current !== currentNum;
    prevSelectedPotreroNumRef.current = currentNum;

    // Solo re-inicializar formulario si el usuario seleccionó un potrero diferente
    if (potreroChanged) {
      setShowArchivedSiembras(false);
      setShowMoveRodeoBox(false);

      const autoRecep = getReceptividadDefault(selectedPotrero);
      const currRecep = selectedPotrero.receptividad_ev_ha;
      const hasCustom = currRecep && Number(currRecep) > 0 && Number(currRecep) !== 0.90;
      const recepStr = hasCustom ? String(currRecep) : '';

      const pNum = Number(selectedPotrero.numero);
      const tieneSiembraActiva = Boolean(siembrasActivasMap[pNum]);
      let initialEstado = selectedPotrero.estado_semaforo || 'Disponible';
      if (initialEstado === 'En siembra' && !tieneSiembraActiva) {
        const rods = rodeosPorPotrero[pNum] || [];
        const cab = rods.reduce((acc, r) => acc + (calcRodeoHeads(r) || 0), 0);
        initialEstado = cab > 0 ? 'En pastoreo' : 'Disponible';
      }

      setSideForm({
        nombre: selectedPotrero.nombre || `Potrero ${selectedPotrero.numero}`,
        hectareas: selectedPotrero.hectareas ?? '',
        ambiente: selectedPotrero.ambiente || 'Bajo Dulce',
        molino_id: selectedPotrero.molino_id ?? '',
        cultivo_actual: selectedPotrero.cultivo_actual || 'Campo Natural',
        recurso_forrajero: selectedPotrero.recurso_forrajero || selectedPotrero.cultivo_actual || 'Campo Natural',
        receptividad_ev_ha: recepStr,
        estado_semaforo: initialEstado,
        observaciones: selectedPotrero.observaciones || '',
      });

      const rods = rodeosPorPotrero[currentNum] || [];
      setSelectedRodeoIdToMove((prev) => {
        if (prev && rodeos.some((r) => String(r.id) === String(prev))) {
          return prev;
        }
        if (rods.length > 0) return String(rods[0].id);
        if (rodeos.length > 0) return String(rodeos[0].id);
        return '';
      });
      setMoveTargetPotrero((prev) => {
        if (prev) return prev;
        return rods.length === 0 ? String(currentNum) : '';
      });
    } else {
      // Re-render o sincronización en segundo plano sobre el mismo potrero:
      // PRESERVAR INTACTA la selección del usuario. Solo actualizar si el rodeo seleccionado fue eliminado.
      setSelectedRodeoIdToMove((prev) => {
        if (prev && rodeos.some((r) => String(r.id) === String(prev))) {
          return prev;
        }
        const rods = rodeosPorPotrero[currentNum] || [];
        if (rods.length > 0) return String(rods[0].id);
        if (rodeos.length > 0) return String(rodeos[0].id);
        return prev;
      });
    }

    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 200);
  }, [selectedPotrero?.numero, rodeosPorPotrero, rodeos, siembrasActivasMap]);

  // Infraestructura y accesos vinculados al potrero seleccionado (interiores + tranqueras en alambrados adyacentes)
  const infraEnPotreroSeleccionado = useMemo(() => {
    if (!selectedPotrero) return [];
    const selNum = Number(selectedPotrero.numero);
    const pIdx = potreros.findIndex((p) => Number(p.numero) === selNum);

    return infraestructura.filter((inf) => {
      // 1. Vinculación directa histórica por potrero_numero
      if (Number(inf.potrero_numero) === selNum) return true;

      // 2. Vinculación por molino_id_ref
      if (inf.molino_id_ref && Number(inf.molino_id_ref) === Number(selectedPotrero.molino_id)) return true;

      // 3. Vinculación explícita en texto o tags (ej. [potreros:6,8] o P6 ↔ P8)
      const textToScan = `${inf.observaciones || ''} ${inf.componentes_detalle || ''} ${inf.nombre || ''}`;
      if (new RegExp(`\\b(P|Potrero\\s*#?)${selNum}\\b`, 'i').test(textToScan)) {
        return true;
      }

      // 4. Detección geográfica por proximidad (<= 20m del alambrado o interior del potrero)
      const lat = Number(inf.latitud);
      const lng = Number(inf.longitud);
      if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
        const dist = calcularDistanciaPuntoAPotreroMeters(lat, lng, selectedPotrero, pIdx >= 0 ? pIdx : 0);
        if (dist <= 20) {
          return true;
        }
      }

      return false;
    });
  }, [infraestructura, selectedPotrero, potreros]);

  // Todas las siembras asociadas al potrero seleccionado (ordenadas de más reciente a más antigua)
  const siembrasEnPotreroSeleccionado = useMemo(() => {
    if (!selectedPotrero || !Array.isArray(siembras)) return [];
    const list = siembras.filter(
      (s) => Number(s.potrero_numero) === Number(selectedPotrero.numero)
    );
    return list.sort((a, b) => {
      const dateA = a.fecha ? new Date(a.fecha).getTime() : 0;
      const dateB = b.fecha ? new Date(b.fecha).getTime() : 0;
      return dateB - dateA;
    });
  }, [selectedPotrero, siembras]);

  // Siembras exclusivamente activas en el potrero
  const siembrasActivasEnPotrero = useMemo(() => {
    return siembrasEnPotreroSeleccionado.filter(esSiembraActiva);
  }, [siembrasEnPotreroSeleccionado]);

  // Siembras archivadas / finalizadas en el potrero (para historial)
  const siembrasArchivadasEnPotrero = useMemo(() => {
    return siembrasEnPotreroSeleccionado.filter((s) => !esSiembraActiva(s));
  }, [siembrasEnPotreroSeleccionado]);

  // Conteos calculados para el filtro jerárquico de infraestructura
  const infraCounts = useMemo(() => {
    let molinos = 0;
    let molinosSolares = 0;
    let tanquesBebidas = 0;
    let corrales = 0;
    let tranqueras = 0;
    let tranquerones = 0;
    let montesSombra = 0;
    let casco = 0;
    let mangrullo = 0;
    let panelesSolares = 0;

    infraestructura.forEach((i) => {
      const key = getLayerKeyForInfra(i);
      if (key === 'molinos') {
        molinos++;
        if (i.solarizado) molinosSolares++;
      } else if (key === 'tanques_bebidas') {
        tanquesBebidas++;
      } else if (key === 'corrales_mangas') {
        corrales++;
      } else if (key === 'tranqueras') {
        tranqueras++;
        if (i.tipo === 'Tranquerón') tranquerones++;
      } else if (key === 'montes_sombra') {
        montesSombra++;
      } else if (key === 'mangrullo') {
        mangrullo++;
      } else if (key === 'paneles_solares') {
        panelesSolares++;
      } else if (key === 'casco_edificaciones') {
        casco++;
      }
    });

    return {
      molinos,
      molinosSolares,
      tanquesBebidas,
      corrales,
      tranqueras,
      tranquerones,
      montesSombra,
      casco,
      mangrullo,
      panelesSolares,
    };
  }, [infraestructura]);

  // Toggle Maestro: ¿Hay alguna capa de infraestructura encendida?
  const isAnyInfraOn = Boolean(
    layersVisible.molinos ||
    layersVisible.tanques_bebidas ||
    layersVisible.corrales_mangas ||
    layersVisible.tranqueras ||
    layersVisible.montes_sombra ||
    layersVisible.casco_edificaciones ||
    layersVisible.mangrullo ||
    layersVisible.paneles_solares ||
    layersVisible.caminos ||
    layersVisible.alambres_electricos
  );

  function handleToggleAllInfra(e) {
    if (e) e.stopPropagation();
    if (isAnyInfraOn) {
      setLayersVisible((prev) => ({
        ...prev,
        molinos: false,
        tanques_bebidas: false,
        corrales_mangas: false,
        tranqueras: false,
        montes_sombra: false,
        casco_edificaciones: false,
        mangrullo: false,
        paneles_solares: false,
        caminos: false,
        alambres_electricos: false,
      }));
      notify?.('Todas las capas de infraestructura desactivadas.', 'info');
    } else {
      setLayersVisible((prev) => ({
        ...prev,
        molinos: true,
        tanques_bebidas: true,
        corrales_mangas: true,
        tranqueras: true,
        montes_sombra: true,
        casco_edificaciones: true,
        mangrullo: true,
        paneles_solares: true,
        caminos: true,
        alambres_electricos: true,
      }));
      notify?.('Todas las capas de infraestructura activadas.', 'info');
    }
  }

  // VÍNCULO BIDIRECCIONAL: Ver en Mapa (centra, enciende capa, resalta con halo y abre popup)
  function handleVerEnMapa(inf) {
    if (!inf) return;
    const lat = Number(inf.latitud);
    const lng = Number(inf.longitud);
    if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) {
      notify(
        `"${inf.nombre}" figura como "Sin ubicar". Usá el botón "Fijar Pin en Mapa".`,
        'error'
      );
      return;
    }

    const map = mapInstanceRef.current;
    if (!map) return;

    // 1. Encender automáticamente su capa si estaba apagada
    const layerKey = getLayerKeyForInfra(inf);
    setLayersVisible((prev) => ({ ...prev, [layerKey]: true }));

    // 2. Scroll suave al mapa
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 3. Centrar cámara en sus coordenadas con zoom 17
    map.setView([lat, lng], 17, { animate: true });

    // 4. Crear halo pulsante durante 3.5 segundos
    const halo = L.circle([lat, lng], {
      radius: 24,
      color: '#f59e0b',
      weight: 3,
      fillColor: '#fbbf24',
      fillOpacity: 0.55,
    }).addTo(map);

    setTimeout(() => {
      if (map && map.hasLayer(halo)) map.removeLayer(halo);
    }, 3500);

    // 5. Abrir popup del marcador
    setTimeout(() => {
      const m = infraMarkersRef.current[inf.id];
      if (m) m.openPopup();
    }, 300);

    notify(
      `Mostrando "${inf.nombre}" en el mapa. Capa "${layerKey}" activada.`,
      'success'
    );
  }

  // VÍNCULO BIDIRECCIONAL: Fijar Pin en Mapa (modo interactivo con 1 clic satelital)
  function handleStartFijarPin(inf) {
    if (!inf) return;
    setPinningInfra(inf);
    pinningInfraRef.current = inf;
    setMapToolMode('pin_infra');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify(
      `Modo Ubicación Activo: Hacé 1 solo clic en la foto satelital para ubicar "${inf.nombre}".`,
      'info'
    );
  }

  async function handleSavePinCoordinates(inf, lat, lng) {
    if (!inf) return;
    setSavingId(`pin-${inf.id}`);
    try {
      const isTranqueraOTranqueron = inf.tipo === 'Tranquera' || inf.tipo === 'Tranquerón';
      const potrerosConectados = detectarPotrerosConectados(lat, lng, potreros, 20);
      const numsList = potrerosConectados.map((x) => x.numero);

      let updatedNombre = inf.nombre;
      let newPotNum = inf.potrero_numero;

      if (isTranqueraOTranqueron) {
        if (numsList.length >= 2) {
          newPotNum = numsList[0];
          if (/^(Tranquera|Tranquer[oó]n)/i.test(inf.nombre) || !inf.nombre) {
            updatedNombre = `${inf.tipo} P${numsList[0]} ↔ P${numsList[1]}`;
          }
        } else if (numsList.length === 1) {
          newPotNum = numsList[0];
          if (/^(Tranquera|Tranquer[oó]n)/i.test(inf.nombre) || !inf.nombre) {
            updatedNombre = `${inf.tipo} P${numsList[0]}`;
          }
        }
      } else if (numsList.length > 0) {
        newPotNum = numsList[0];
      }

      const conectaTag = numsList.length >= 2 ? `[potreros:${numsList.join(',')}] [conecta:P${numsList[0]}↔P${numsList[1]}]` : numsList.length === 1 ? `[potreros:${numsList[0]}]` : '';
      const cleanObs = (inf.observaciones || '').replace(/\[potreros:[^\]]+\]/gi, '').replace(/\[conecta:[^\]]+\]/gi, '').trim();
      const finalObs = `${cleanObs} ${conectaTag}`.trim();

      const updateData = {
        latitud: lat,
        longitud: lng,
        nombre: updatedNombre,
        potrero_numero: newPotNum,
        observaciones: finalObs,
      };

      const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.infraestructura)) {
            const idx = sData.infraestructura.findIndex((x) => x.id === inf.id);
            if (idx >= 0) {
              sData.infraestructura[idx] = { ...sData.infraestructura[idx], ...updateData };
              localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
              window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'infraestructura' } }));
            }
          }
        }
      } else {
        const { error } = await supabase
          .from('infraestructura')
          .update(updateData)
          .eq('id', inf.id);
        if (error) throw error;
      }

      // Encender su capa automáticamente
      const layerKey = getLayerKeyForInfra(inf);
      setLayersVisible((prev) => ({ ...prev, [layerKey]: true }));

      notify(
        `¡Ubicación guardada! "${inf.nombre}" fijado en el mapa (${lat.toFixed(5)}, ${lng.toFixed(5)}).`,
        'success'
      );
      setPinningInfra(null);
      pinningInfraRef.current = null;
      setMapToolMode('explore');
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar coordenadas: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // Límites geográficos calculados para los 34 potreros de Establecimiento San José
  const boundsPotreros = useMemo(() => {
    const bounds = L.latLngBounds([]);
    potreros.forEach((p, idx) => {
      const geom = p.geojson_polygon || buildFallbackPolygon(p.numero, idx, p.hectareas);
      if (geom?.coordinates) {
        const coords =
          geom.type === 'MultiPolygon'
            ? geom.coordinates.flat(2)
            : geom.coordinates.flat(1);
        coords.forEach(([lng, lat]) => {
          if (lat && lng && !Number.isNaN(lat) && !Number.isNaN(lng)) {
            bounds.extend([lat, lng]);
          }
        });
      }
    });
    return bounds.isValid() ? bounds : null;
  }, [potreros]);

  // Encuadrar el campo ajustado a los 34 potreros (Vista General solicitada por el usuario)
  const handleFitFieldBounds = useCallback(
    (targetMap = null) => {
      const map = targetMap || mapInstanceRef.current;
      if (!map) return;
      if (boundsPotreros) {
        map.fitBounds(boundsPotreros, { padding: [24, 24], maxZoom: 14 });
      } else {
        map.setView(LAS_FLORES_CENTER, 13);
      }
      setTimeout(() => {
        saveCameraToStorage(map);
      }, 350);
    },
    [boundsPotreros]
  );

  // Manejo de navegación desde Alertas Operativas ("1 aguada(s) / infra. a revisar")
  useEffect(() => {
    if (!initialTargetInfra) return;

    const lat = Number(initialTargetInfra.latitud);
    const lng = Number(initialTargetInfra.longitud);

    // Caso A: Tiene coordenadas GPS válidas
    if (lat && lng && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      setActiveSubTab('potreros');
      const layerKey = getLayerKeyForInfra(initialTargetInfra);
      setLayersVisible((prev) => ({ ...prev, [layerKey]: true }));

      const map = mapInstanceRef.current;
      if (map) {
        // Zoom 16 equilibrado (contexto de potreros sin quedar vacío)
        map.setView([lat, lng], 16, { animate: true });

        const halo = L.circle([lat, lng], {
          radius: 28,
          color: '#f59e0b',
          weight: 3,
          fillColor: '#fbbf24',
          fillOpacity: 0.55,
        }).addTo(map);

        setTimeout(() => {
          if (map && map.hasLayer(halo)) map.removeLayer(halo);
        }, 3500);

        setTimeout(() => {
          const m = infraMarkersRef.current[initialTargetInfra.id];
          if (m) m.openPopup();
        }, 350);
      }
      notify(
        `Centrando en "${initialTargetInfra.nombre}" (Zoom 16 equilibrado). Capa "${layerKey}" activada.`,
        'success'
      );
    } else {
      // Caso B: NO tiene GPS (figura Sin ubicar) -> Redirigir a sub-pestaña Infraestructura
      setActiveSubTab('infraestructura');
      const isEdif =
        initialTargetInfra.es_edificacion_casco ||
        initialTargetInfra.tipo === 'Edificación / Casco' ||
        initialTargetInfra.tipo === 'Corrales y Mangas' ||
        initialTargetInfra.tipo === 'Mangrullo / Bomba Casco';
      setInfraSubView(isEdif ? 'edificaciones' : 'campo');
      setFilterTipoInfra('TODOS');
      notify(
        `"${initialTargetInfra.nombre}" figura como "Sin ubicar". Usá el botón "Fijar Pin en Mapa" para posicionarlo.`,
        'info'
      );
    }

    if (onClearTargetInfra) onClearTargetInfra();
  }, [initialTargetInfra, onClearTargetInfra, notify]);

  // Observador de cambio de dimensiones sobre el contenedor fijo del mapa
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const triggerRedraw = () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
      const layers = tileLayersRef.current;
      if (layers) {
        Object.values(layers).forEach((layer) => {
          if (layer && map.hasLayer(layer) && typeof layer.redraw === 'function') {
            layer.redraw();
          }
        });
      }
    };

    const ro = new ResizeObserver(() => {
      triggerRedraw();
      setTimeout(triggerRedraw, 150);
      setTimeout(triggerRedraw, 400);
    });
    ro.observe(mapContainerRef.current);
    return () => ro.disconnect();
  }, [isExpanded, mapReadyToken]);

  // Forzar recarga de mapa satelital y tamaño al cambiar isExpanded o presionar Esc
  useEffect(() => {
    const triggerRedraw = () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
      const layers = tileLayersRef.current;
      if (layers) {
        Object.values(layers).forEach((layer) => {
          if (layer && map.hasLayer(layer) && typeof layer.redraw === 'function') {
            layer.redraw();
          }
        });
      }
    };

    triggerRedraw();
    const t1 = setTimeout(triggerRedraw, 150);
    const t2 = setTimeout(triggerRedraw, 400);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (activeInfraMenuId !== null) {
          setActiveInfraMenuId(null);
        }
        if (isExpanded) {
          setIsExpanded(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, activeInfraMenuId]);

  // Forzar redibujado de tiles y tamaño al cambiar Modo de Vista (Contornos, Semáforo, Pasturas, Ambientes)
  useEffect(() => {
    const triggerRedraw = () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
      const layers = tileLayersRef.current;
      if (layers) {
        Object.values(layers).forEach((layer) => {
          if (layer && map.hasLayer(layer) && typeof layer.redraw === 'function') {
            layer.redraw();
          }
        });
      }
    };
    triggerRedraw();
    const t = setTimeout(triggerRedraw, 100);
    return () => clearTimeout(t);
  }, [mapViewMode]);

  // Forzar redibujado de tiles y ajuste de tamaño al abrir o cerrar el panel lateral de potrero
  useEffect(() => {
    const triggerRedraw = () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
      const layers = tileLayersRef.current;
      if (layers) {
        Object.values(layers).forEach((layer) => {
          if (layer && map.hasLayer(layer) && typeof layer.redraw === 'function') {
            layer.redraw();
          }
        });
      }
    };
    triggerRedraw();
    const t1 = setTimeout(triggerRedraw, 80);
    const t2 = setTimeout(triggerRedraw, 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [selectedPotreroNum]);

  const handleToggleExpand = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      const runInvalidate = () => {
        const map = mapInstanceRef.current;
        if (!map) return;
        map.invalidateSize({ animate: false });
        const layers = tileLayersRef.current;
        if (layers) {
          Object.values(layers).forEach((layer) => {
            if (layer && map.hasLayer(layer) && typeof layer.redraw === 'function') {
              layer.redraw();
            }
          });
        }
      };
      setTimeout(runInvalidate, 80);
      setTimeout(runInvalidate, 250);
      return next;
    });
  };

  // Guardar cambios desde el modal de edición completa de infraestructura
  async function handleSaveEditedInfra(e) {
    if (e) e.preventDefault();
    if (!editingInfra) return;
    setSavingEditingInfra(true);
    try {
      const isEdif = editingInfra.tipo === 'Edificación / Casco';
      const finalEmoji = editingInfra.icono || getInfraEmoji(editingInfra);
      const cleanObs = (editingInfra.observaciones || '')
        .replace(/\[?(?:icono|estilo|estilo_marcador)[:=]\s*[^\]]+\]?/gi, '')
        .trim();
      const finalObs = cleanObs || null;

      const estiloMarcador = editingInfra.estilo_marcador || 'chip';
      const cleanComp = (editingInfra.componentes_detalle || '')
        .replace(/\[?(?:icono|estilo|estilo_marcador)[:=]\s*[^\]]+\]?/gi, '')
        .replace(/\bicono\s*:[^\s|,;]+/gi, '')
        .replace(/\bestilo\s*:[^\s|,;]+/gi, '')
        .trim();
      const finalComp = cleanComp || null;

      const payload = {
        tipo: editingInfra.tipo,
        codigo: editingInfra.codigo?.trim() || null,
        nombre: editingInfra.nombre.trim(),
        potrero_numero: editingInfra.potrero_numero
          ? parseInt(editingInfra.potrero_numero, 10)
          : null,
        potreros_abastecidos: editingInfra.potreros_abastecidos?.trim() || null,
        estado: editingInfra.estado || 'Operativo',
        latitud: editingInfra.latitud ? parseFloat(editingInfra.latitud) : null,
        longitud: editingInfra.longitud ? parseFloat(editingInfra.longitud) : null,
        componentes_detalle: finalComp,
        estilo_marcador: estiloMarcador,
        solarizado: Boolean(editingInfra.solarizado),
        sistema_bombeo:
          editingInfra.tipo === 'Molino'
            ? editingInfra.solarizado
              ? 'Bomba Sumergible + Paneles Solares'
              : 'Molino de Viento Convencional'
            : null,
        es_edificacion_casco: isEdif,
        estado_camino:
          editingInfra.estado_camino ||
          (editingInfra.tipo === 'Camino Operativo' || editingInfra.tipo?.toLowerCase().includes('camino')
            ? editingInfra.estado
            : null),
        observaciones: finalObs,
      };

      if (isSandboxMode) {
        const updated = infraestructura.map((x) =>
          x.id === editingInfra.id ? { ...x, ...payload, icono: finalEmoji, emoji: finalEmoji } : x
        );
        setInfraestructura && setInfraestructura(updated);
        try {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          const d = raw ? JSON.parse(raw) : {};
          d.infraestructura = updated;
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(d));
        } catch (err) {}
      } else {
        let updateErr = null;
        try {
          const res = await supabase
            .from('infraestructura')
            .update({ ...payload, icono: finalEmoji, estilo_marcador: estiloMarcador })
            .eq('id', editingInfra.id);
          updateErr = res.error;
        } catch (err) {
          updateErr = err;
        }

        if (updateErr) {
          const fallbackPayload = { ...payload };
          delete fallbackPayload.estilo_marcador;
          const { error: retryErr } = await supabase
            .from('infraestructura')
            .update(fallbackPayload)
            .eq('id', editingInfra.id);
          if (retryErr) throw retryErr;
        }
      }

      if (editingInfra.tipo === 'Camino Operativo' || editingInfra.tipo?.toLowerCase().includes('camino')) {
        await supabase
          .from('caminos')
          .update({
            nombre: payload.nombre,
            estado: editingInfra.estado_camino || payload.estado,
            estado_camino: editingInfra.estado_camino || payload.estado,
            observaciones: payload.observaciones,
          })
          .eq('nombre', editingInfra.nombre);
      }

      if (editingInfra.molino_id_ref) {
        await supabase
          .from('molinos')
          .update({
            estado: payload.estado,
            solarizado: payload.solarizado,
            sistema_bombeo: payload.sistema_bombeo,
          })
          .eq('numero', editingInfra.molino_id_ref);
      }

      notify(`Infraestructura "${payload.nombre}" actualizada correctamente.`, 'success');
      setEditingInfra(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar cambios: ${err.message}`, 'error');
    } finally {
      setSavingEditingInfra(false);
    }
  }

  // Inicializar o re-montar mapa Leaflet centrado en la última cámara guardada o Las Flores
  // Se monta limpio con dimensiones exactas al alternar entre modo embebido y pantalla completa
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove();
      } catch (err) {
        console.warn('Error al remover instancia anterior de Leaflet:', err);
      }
      mapInstanceRef.current = null;
    }

    const savedCam = getSavedCamera();
    const initialCenter = savedCam ? [savedCam.lat, savedCam.lng] : LAS_FLORES_CENTER;
    const initialZoom = savedCam ? savedCam.zoom : 13;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      maxZoom: 21,
      scrollWheelZoom: true,
      preferCanvas: true,
      fadeAnimation: false,
    });

    // Escuchar cambios de zoom para etiquetas dinámicas y persistencia
    map.on('zoomend', () => {
      setCurrentZoom(map.getZoom());
      saveCameraToStorage(map);
    });

    // Escuchar movimiento y arrastre del mapa para persistir coordenadas del usuario
    map.on('moveend', () => {
      saveCameraToStorage(map);
    });

    setCurrentZoom(map.getZoom());

    // Google Satellite Hybrid: imágenes satelitales de alta resolución con nombres de parajes y rutas
    // Sin crossOrigin: 'anonymous' para evitar bloqueo de Google Maps tiles y pantalla negra
    const google_hybrid = L.tileLayer(
      'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: 'Imágenes Satelitales &copy; Google Satellite Hybrid — Las Flores, Bs. As.',
        maxNativeZoom: 20,
        maxZoom: 21,
        keepBuffer: 6,
        updateWhenIdle: false,
      }
    );

    // Fallback automático a Esri World Imagery si un tile satelital de Google falla o demora
    google_hybrid.on('tileerror', (error) => {
      if (error?.tile && error?.coords) {
        const { z, x, y } = error.coords;
        error.tile.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      }
    });

    // Esri World Imagery: resolución satelital nítida con fallback suave
    const esri_sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri World Imagery — Las Flores, Buenos Aires',
        maxNativeZoom: 18,
        maxZoom: 21,
        keepBuffer: 6,
        updateWhenIdle: false,
      }
    );

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxNativeZoom: 19,
      maxZoom: 21,
      keepBuffer: 6,
      updateWhenIdle: false,
    });

    const currentBase =
      mapStyle === 'esri_sat' ? esri_sat : mapStyle === 'osm' ? osm : google_hybrid;
    currentBase.addTo(map);

    tileLayersRef.current = { google_hybrid, esri_sat, osm };

    const fg = L.featureGroup().addTo(map);
    layerGroupRef.current = fg;
    mapInstanceRef.current = map;

    // Invalidar tamaño inmediatamente
    map.invalidateSize({ animate: false });

    // Si ya existe cámara guardada, respetarla y no disparar encuadre general automático
    if (savedCam) {
      initialBoundsAppliedRef.current = true;
      hasFittedBoundsRef.current = true;
    } else if (!initialBoundsAppliedRef.current && boundsPotreros) {
      // ÚNICAMENTE si no hay cámara guardada y es el primer montaje con geometrías
      map.fitBounds(boundsPotreros, { padding: [24, 24], maxZoom: 14 });
      initialBoundsAppliedRef.current = true;
      hasFittedBoundsRef.current = true;
      setTimeout(() => saveCameraToStorage(map), 300);
    }

    const t1 = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    }, 80);

    const t2 = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    }, 250);

    setMapReadyToken((prev) => prev + 1);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {}
        mapInstanceRef.current = null;
      }
      layerGroupRef.current = null;
    };
  }, [isExpanded]);

  // Proteger la vista contra reseteos al cambiar de ventana (Alt+Tab) o volver a enfocar la pestaña
  useEffect(() => {
    const handleWindowFocusOrVisibility = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    };

    window.addEventListener('focus', handleWindowFocusOrVisibility);
    document.addEventListener('visibilitychange', handleWindowFocusOrVisibility);

    return () => {
      window.removeEventListener('focus', handleWindowFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleWindowFocusOrVisibility);
    };
  }, []);

  // Recalcular tamaño instantáneamente al volver a la pestaña del Mapa (cacheado en DOM)
  useEffect(() => {
    if (isVisible && mapInstanceRef.current) {
      const map = mapInstanceRef.current;
      map.invalidateSize({ animate: false });
      const timer = setTimeout(() => {
        if (!mapInstanceRef.current) return;
        mapInstanceRef.current.invalidateSize({ animate: false });
        const layers = tileLayersRef.current;
        if (layers) {
          Object.values(layers).forEach((layer) => {
            if (layer && mapInstanceRef.current.hasLayer(layer) && typeof layer.redraw === 'function') {
              layer.redraw();
            }
          });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  // Escuchar clics en el mapa según el modo activo ('pin_infra', 'add_infra', 'add_alerta', 'draw_camino')
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    function onMapClick(e) {
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));

      if (quickMarkTypeRef.current) {
        const type = quickMarkTypeRef.current;
        const isTranqueraOTranqueron = type === 'Tranquera' || type === 'Tranquerón';
        const potrerosConectados = detectarPotrerosConectados(lat, lng, potreros, 20);

        let potNum = null;
        let suggestedName = type;

        if (isTranqueraOTranqueron) {
          if (potrerosConectados.length >= 2) {
            const p1 = potrerosConectados[0].numero;
            const p2 = potrerosConectados[1].numero;
            suggestedName = `${type} P${p1} ↔ P${p2}`;
            potNum = p1;
          } else if (potrerosConectados.length === 1) {
            potNum = potrerosConectados[0].numero;
            suggestedName = `${type} P${potNum}`;
          }
        } else {
          const potreroMatch = potrerosConectados[0]?.potrero || detectarPotreroEnPunto(lat, lng, potreros);
          potNum = potreroMatch ? potreroMatch.numero : null;
          const potLabel = potreroMatch ? `P${potreroMatch.numero}` : '';
          suggestedName = potLabel ? `${type} ${potLabel}` : type;
        }

        const defaultEmoji = getDefaultEmojiForTipo(type);
        setPendingPointCoords({
          lat,
          lng,
          potreroNumero: potNum,
          potrerosConectados: potrerosConectados.map((x) => x.numero),
        });
        setNewPointForm({
          tipo: type,
          icono: defaultEmoji,
          nombre: suggestedName,
          potrero_numero: potNum ? String(potNum) : '',
          estado: 'Operativo',
        });
        setShowNewPointModal(true);
        return;
      }

      if (mapToolMode === 'pin_infra' && pinningInfraRef.current) {
        handleSavePinCoordinates(pinningInfraRef.current, lat, lng);
      } else if (mapToolMode === 'add_infra') {
        setClickedCoords({ lat, lng });
        setNewInfra((prev) => ({
          ...prev,
          latitud: String(lat),
          longitud: String(lng),
        }));
      } else if (mapToolMode === 'add_alerta') {
        setClickedCoords({ lat, lng });
      } else if (mapToolMode === 'draw_camino') {
        setDrawingPoints((prev) => [...prev, [lat, lng]]);
      }
    }

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [mapToolMode, mapReadyToken]);

  // Cambiar capa base Satélite Google / Satélite Esri / Mapa Claro
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layers = tileLayersRef.current;
    if (!map || !layers.google_hybrid) return;

    Object.entries(layers).forEach(([key, layer]) => {
      if (key === mapStyle) {
        if (!map.hasLayer(layer)) layer.addTo(map);
        if (typeof layer.redraw === 'function') layer.redraw();
      } else if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });
    map.invalidateSize({ animate: false });
    const timer = setTimeout(() => {
      if (!mapInstanceRef.current) return;
      mapInstanceRef.current.invalidateSize({ animate: false });
      const cur = layers[mapStyle];
      if (cur && typeof cur.redraw === 'function') cur.redraw();
    }, 50);
    return () => clearTimeout(timer);
  }, [mapStyle, mapReadyToken]);

  // Exponer funciones globales para botones dentro de popups de Leaflet
  useEffect(() => {
    window.__sanJoseResolveAlerta = async (alertaId) => {
      try {
        const { error } = await supabase
          .from('alertas_mapa')
          .update({
            resuelta: true,
            fecha_resolucion: new Date().toISOString().slice(0, 10),
          })
          .eq('id', alertaId);
        if (error) throw error;
        notify('Post-it / Alerta marcada como resuelta.', 'success');
        await onRefresh();
      } catch (err) {
        notify(`Error al resolver alerta: ${err.message}`, 'error');
      }
    };

    window.__sanJoseToggleCamino = async (caminoId, nuevoEstado) => {
      try {
        const { error } = await supabase
          .from('caminos')
          .update({ estado: nuevoEstado, estado_camino: nuevoEstado })
          .eq('id', caminoId);
        if (error) throw error;
        notify(`Estado del camino actualizado a "${nuevoEstado}".`, 'success');
        await onRefresh();
      } catch (err) {
        notify(`Error al actualizar camino: ${err.message}`, 'error');
      }
    };

    window.__sanJoseToggleSolarMolino = async (infraId, nextSolar) => {
      try {
        const { data: updated, error } = await supabase
          .from('infraestructura')
          .update({
            solarizado: nextSolar,
            sistema_bombeo: nextSolar
              ? 'Bomba Sumergible + Paneles Solares'
              : 'Molino de Viento Convencional',
          })
          .eq('id', infraId)
          .select()
          .single();
        if (error) throw error;

        if (updated?.molino_id_ref) {
          await supabase
            .from('molinos')
            .update({
              solarizado: nextSolar,
              sistema_bombeo: nextSolar
                ? 'Bomba Sumergible + Paneles Solares'
                : 'Molino de Viento Convencional',
            })
            .eq('numero', updated.molino_id_ref);
        }
        notify(
          nextSolar
            ? 'Molino marcado con Bomba Sumergible + Paneles Solares.'
            : 'Molino marcado como Molino de Viento Convencional.',
          'success'
        );
        await onRefresh();
      } catch (err) {
        notify(`Error al actualizar sistema solar del molino: ${err.message}`, 'error');
      }
    };

    window.__sanJoseStartMovingInfra = (infraId) => {
      const item = infraestructura.find((x) => x.id === infraId);
      if (item) handleStartMovingInfra(item);
    };

    window.__sanJoseEditInfra = (infraId) => {
      const item = infraestructura.find((x) => x.id === infraId);
      if (item) setEditingInfra({ ...item, estilo_marcador: getInfraEstilo(item) });
    };

    window.__sanJoseEditCamino = (caminoId) => {
      const item = caminos.find((x) => String(x.id) === String(caminoId));
      if (item) {
        setEditingCamino({
          ...item,
          coordenadas_json: Array.isArray(item.coordenadas_json)
            ? item.coordenadas_json.map((pt) => [...pt])
            : [],
        });
        setShowCaminoDetailsModal(false);
        if (Array.isArray(item.coordenadas_json) && item.coordenadas_json.length >= 2 && mapInstanceRef.current) {
          try {
            const bounds = L.latLngBounds(item.coordenadas_json);
            mapInstanceRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
          } catch {}
        }
      }
    };

    window.__sanJoseDeletePolygonVertex = (vertexIdx) => {
      setEditingPolygonCoords((prev) => {
        if (!prev || !Array.isArray(prev) || prev.length <= 3) {
          notify('El potrero debe conservar al menos 3 vértices para formar un polígono.', 'warning');
          return prev;
        }
        const newCoords = prev.filter((_, i) => i !== vertexIdx);
        return newCoords;
      });
    };

    window.__sanJoseDeleteVertex = (vertexIdx) => {
      setEditingCamino((prev) => {
        if (!prev || !Array.isArray(prev.coordenadas_json) || prev.coordenadas_json.length <= 2) {
          notify('La traza debe conservar al menos 2 puntos.', 'warning');
          return prev;
        }
        const newCoords = prev.coordenadas_json.filter((_, i) => i !== vertexIdx);
        return { ...prev, coordenadas_json: newCoords };
      });
    };

    window.__sanJoseEditAlerta = (alertaId) => {
      const item = alertasMapa.find((x) => x.id === alertaId);
      if (item) setEditingAlerta({ ...item });
    };

    window.__sanJoseReubicarPin = (infraId) => {
      const item = infraestructura.find((x) => x.id === infraId);
      if (item) handleStartFijarPin(item);
    };

    window.__sanJoseEliminarInfra = (infraId) => {
      const item = infraestructura.find((x) => x.id === infraId);
      if (item) handleDeleteInfra(item);
    };

    window.__sanJoseCreateTareaFromInfra = (infraId) => {
      const item =
        infraestructura.find((x) => String(x.id) === String(infraId)) ||
        molinos.find(
          (x) => String(x.id) === String(infraId) || String(x.numero) === String(infraId)
        );
      if (!item) {
        notify('Elemento de infraestructura no encontrado.', 'warning');
        return;
      }
      const tipo = item.tipo || 'Infraestructura';
      const nom = item.nombre || (item.numero ? `Molino ${item.numero}` : 'Elemento');
      let cat = 'General';
      if (
        ['Molino', 'Bebida', 'Tanque', 'Tanque Australiano', 'Pozo', 'Bomba', 'Aguada'].includes(
          tipo
        )
      ) {
        cat = 'Aguadas';
      } else if (
        ['Alambrado', 'Tranquera', 'Tranquerón', 'Boyero', 'Parcela Eléctrica'].includes(tipo)
      ) {
        cat = 'Alambrados';
      } else if (['Manga', 'Corral', 'Balanza', 'Cargador', 'Embarcadero'].includes(tipo)) {
        cat = 'Hacienda';
      }

      if (onCreateTareaFromItem) {
        onCreateTareaFromItem({
          titulo: `Mantenimiento ${tipo}: ${nom}`,
          categoria: cat,
          potrero_numero: item.potrero_numero ? String(item.potrero_numero) : '',
          infraestructura_nombre: `${nom} (${tipo})`,
          prioridad: item.estado && item.estado !== 'Operativo' ? 'Alta' : 'Normal',
        });
      }
    };

    return () => {
      delete window.__sanJoseResolveAlerta;
      delete window.__sanJoseEditAlerta;
      delete window.__sanJoseToggleCamino;
      delete window.__sanJoseToggleSolarMolino;
      delete window.__sanJoseEditInfra;
    delete window.__sanJoseStartMovingInfra;
      delete window.__sanJoseEditCamino;
      delete window.__sanJoseDeleteVertex;
    delete window.__sanJoseDeletePolygonVertex;
      delete window.__sanJoseReubicarPin;
      delete window.__sanJoseEliminarInfra;
      delete window.__sanJoseCreateTareaFromInfra;
    };
  }, [notify, onRefresh, infraestructura, molinos, caminos, alertasMapa, onCreateTareaFromItem]);

  // Renderizar Polígonos (según el Modo de Vista elegido), Infraestructura, Post-its y Caminos
  useEffect(() => {
    const map = mapInstanceRef.current;
    const fg = layerGroupRef.current;
    if (!map || !fg) return;

    fg.clearLayers();

    // 1. DIBUJAR POTREROS (si la capa está activa)
    if (layersVisible.potreros) {
      potreros.forEach((p, idx) => {
        const numCode = p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero;
        const cabezas = cabezasPorPotrero[p.numero] || 0;
        const rodeosLote = rodeosPorPotrero[p.numero] || [];
        const ha = Number(p.hectareas) || 0;
        const carga = ha > 0 ? Number((cabezas / ha).toFixed(2)) : 0;
        const isSelected = Number(selectedPotreroNum) === Number(p.numero);
        const isEditingThisPolygon = editingPolygonPotreroId != null && (editingPolygonPotreroId === p.id || editingPolygonPotreroId === p.numero);

        const geometry = p.geojson_polygon || buildFallbackPolygon(p.numero, idx, ha || 80);
        const isSchematic = !p.geojson_polygon;

        // BLOQUE 1: Pintura de Fondo de Potreros (selección única con alto contraste visual)
        let strokeColor = '#10B981';
        let fillColor = '#10B981';
        let fillOpacity = 0.44;
        let weight = isSelected ? 4 : 2.5;
        let subLabelHtml = '';

        if (mapViewMode === 'contornos') {
          // Solo Contornos: Relleno transparente (fillOpacity: 0.05) con borde blanco/cian nítido para ver limpio el suelo satelital
          strokeColor = isSelected ? '#ffffff' : '#06B6D4';
          fillColor = '#06B6D4';
          fillOpacity = isSelected ? 0.15 : 0.05;
          weight = isSelected ? 4 : 2;
        } else if (mapViewMode === 'pasturas') {
          // Pasturas / Siembras: Colores diferenciados según cultivo / pastura implantada vs campo natural
          const past = getPasturaStyle(p, siembrasActivasMap);
          const recInfo = getPotreroRecursoInfo(p, siembrasActivasMap);
          strokeColor = isSelected ? '#ffffff' : past.stroke;
          fillColor = past.fill;
          fillOpacity = isSelected ? 0.70 : (past.label === 'Campo Natural' ? 0.32 : 0.58);
          subLabelHtml = `<div style="font-weight:800;color:#fef08a;font-size:10px">${recInfo.etiqueta}</div>`;
        } else if (mapViewMode === 'ambientes') {
          // Ambientes (Loma / Bajo Dulce / Bajo Salino / Bajo Anegable)
          const amb = getAmbienteStyle(p);
          strokeColor = isSelected ? '#ffffff' : amb.stroke;
          fillColor = amb.fill;
          fillOpacity = isSelected ? 0.65 : 0.45;
          subLabelHtml = `<div style="font-weight:800;color:#fde047;font-size:10px">${amb.label}</div>`;
        } else {
          // Semáforo de Carga con Receptividad dinámica (Cuenca del Salado)
          const recepEfectiva = getReceptividadEfectiva(p);
          const tieneSiembraActivaP = Boolean(siembrasActivasMap[p.numero]);
          const estadoEfectivoP =
            p.estado_semaforo === 'En siembra' && !tieneSiembraActivaP
              ? cabezas > 0
                ? 'En pastoreo'
                : 'Disponible'
              : p.estado_semaforo;
          const sem = getSemaforoColor(estadoEfectivoP, carga, cabezas, recepEfectiva);
          strokeColor = isSelected ? '#ffffff' : sem.stroke;
          fillColor = sem.fill;
          fillOpacity = isSelected ? 0.65 : (cabezas === 0 ? 0.22 : 0.45);
          if (cabezas > 0 && !layersVisible.rodeos_labels) {
            subLabelHtml = `<div style="color:#fef08a;font-size:10px">${carga} cab/ha</div>`;
          }
        }

        const isPasturasMode = mapViewMode === 'pasturas';
        const isAmbientesMode = mapViewMode === 'ambientes';
        const isResourceMode = isPasturasMode || isAmbientesMode;

        const recInfo = getPotreroRecursoInfo(p, siembrasActivasMap);
        const pastStyle = getPasturaStyle(p, siembrasActivasMap);
        const ambStyle = getAmbienteStyle(p);
        const recursoLabel = isPasturasMode
          ? recInfo.etiqueta
          : isAmbientesMode
          ? (ambStyle.label || p.ambiente || 'Bajo Dulce / Natural')
          : '';

        const hasRodeoActivo = Boolean(layersVisible.rodeos_labels && (cabezas > 0 || rodeosLote.length > 0));

        // 1.a DIBUJAR ETIQUETA DE POTRERO CENTRADA EN EL POLÍGONO
        // Visible en todos los potreros sin rodeo (en los lotes con rodeo, el dato de pastura/ambiente se integra dentro de la pastilla del rodeo)
        const shouldShowPotreroLabel = (layersVisible.potreros_numeros || isResourceMode) && !hasRodeoActivo;

        if (shouldShowPotreroLabel) {
          const [cLat, cLng] = getPaddockCentroid(p, idx);
          if (cLat && cLng) {
            const labelBorder = isPasturasMode ? '#059669' : isAmbientesMode ? '#0284c7' : 'rgba(255,255,255,0.45)';
            const labelColor = isPasturasMode ? '#86efac' : isAmbientesMode ? '#7dd3fc' : '#fde68a';

            let displayName = `P${numCode}`;
            if (p.nombre && p.nombre.trim()) {
              const trimmed = p.nombre.trim();
              if (/^potrero\s+\d+$/i.test(trimmed)) {
                displayName = `P${numCode}`;
              } else if (/^potrero\s+/i.test(trimmed)) {
                displayName = trimmed.replace(/^potrero\s+/i, 'P');
              } else {
                displayName = trimmed;
              }
            }

            const showNames = Boolean(layersVisible.etiquetas_marcadores ?? true);
            const effectiveDensity = !showNames
              ? 'compacto'
              : (currentZoom <= 13 ? 'intermedio' : 'detallado');

            let labelHtml = '';
            if (effectiveDensity === 'compacto') {
              labelHtml = `
                <div class="potrero-label-box label-compact" style="pointer-events:none;transform:translate(-50%, -50%);background:rgba(15,23,42,0.92);border:1.5px solid ${isResourceMode ? labelBorder : 'rgba(255,255,255,0.5)'};color:#ffffff;border-radius:9999px;padding:2px 7px;box-shadow:0 2px 6px rgba(0,0,0,0.65);white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;user-select:none;">
                  <span style="font-size:11px;font-weight:900;color:#ffffff;line-height:1;letter-spacing:-0.2px;">${displayName}</span>
                </div>
              `;
            } else if (effectiveDensity === 'intermedio') {
              labelHtml = `
                <div class="potrero-label-box label-intermediate" style="pointer-events:none;transform:translate(-50%, -50%);background:rgba(15,23,42,0.90);border:1.5px solid ${isResourceMode ? labelBorder : 'rgba(255,255,255,0.45)'};color:#ffffff;border-radius:8px;padding:2.5px 8px;box-shadow:0 2px 7px rgba(0,0,0,0.6);white-space:nowrap;display:inline-flex;align-items:center;gap:4px;user-select:none;">
                  <span style="font-size:11px;font-weight:900;color:#ffffff;line-height:1;">${displayName}</span>
                  <span style="color:#10b981;font-weight:900;">·</span>
                  <span style="font-size:10px;font-weight:700;color:#cbd5e1;line-height:1;">${ha > 0 ? Number(ha.toFixed(1)) + ' ha' : ''}</span>
                </div>
              `;
            } else {
              labelHtml = isResourceMode
                ? `
                  <div class="potrero-label-box resource-pill" style="pointer-events:none;transform:translate(-50%, -50%);background:rgba(15,23,42,0.92);border:1.5px solid ${labelBorder};color:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.65);white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;user-select:none;">
                    <span style="font-size:11px;font-weight:900;color:#ffffff;line-height:1.2;">${displayName}</span>
                    <span style="color:#10b981;font-weight:900;margin:0 3px">·</span>
                    <span style="color:${labelColor};font-weight:800;font-size:10.5px;">${recursoLabel}</span>
                    ${!recInfo.esParcial ? `<span style="color:#cbd5e1;font-size:9.5px;font-weight:700;margin-left:3px">(${ha} ha)</span>` : ''}
                  </div>
                `
                : `
                  <div class="potrero-label-box" style="pointer-events:none;transform:translate(-50%, -50%);background:rgba(15,23,42,0.88);border:1px solid rgba(255,255,255,0.45);color:#ffffff;border-radius:6px;padding:2px 6px;box-shadow:0 2px 6px rgba(0,0,0,0.6);white-space:nowrap;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;user-select:none;">
                    <span style="font-size:11.5px;font-weight:900;color:#ffffff;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,0.85)">${displayName}</span>
                    <span style="font-size:9.5px;font-weight:700;color:#cbd5e1;line-height:1;margin-top:2px">${ha} ha</span>
                  </div>
                `;
            }

            const labelIcon = L.divIcon({
              className: 'potrero-clean-label-marker',
              html: labelHtml,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            });

            const labelMarker = L.marker([cLat, cLng], {
              icon: labelIcon,
              interactive: false,
              zIndexOffset: 700,
            });
            fg.addLayer(labelMarker);
          }
        }

        try {
          const layer = L.geoJSON(
            { type: 'Feature', geometry, properties: p },
            {
              style: () => ({
                color: strokeColor,
                weight,
                dashArray: isSchematic ? '5, 5' : null,
                fillColor,
                fillOpacity,
              }),
            }
          );

          layer.on('click', (e) => {
            if (quickMarkTypeRef.current) {
              const lat = Number(e.latlng.lat.toFixed(6));
              const lng = Number(e.latlng.lng.toFixed(6));
              const type = quickMarkTypeRef.current;
              const isTranqueraOTranqueron = type === 'Tranquera' || type === 'Tranquerón';
              const potrerosConectados = detectarPotrerosConectados(lat, lng, potreros, 20);

              let potNum = p?.numero || null;
              let suggestedName = type;

              if (isTranqueraOTranqueron) {
                if (potrerosConectados.length >= 2) {
                  const p1 = potrerosConectados[0].numero;
                  const p2 = potrerosConectados[1].numero;
                  suggestedName = `${type} P${p1} ↔ P${p2}`;
                  potNum = p1;
                } else if (potrerosConectados.length === 1) {
                  potNum = potrerosConectados[0].numero;
                  suggestedName = `${type} P${potNum}`;
                } else {
                  suggestedName = p?.numero ? `${type} P${p.numero}` : type;
                }
              } else {
                const potLabel = p?.numero ? `P${p.numero}` : '';
                suggestedName = potLabel ? `${type} ${potLabel}` : type;
              }

              const defaultEmoji = getDefaultEmojiForTipo(type);
              setPendingPointCoords({
                lat,
                lng,
                potreroNumero: potNum,
                potrerosConectados: potrerosConectados.map((x) => x.numero),
              });
              setNewPointForm({
                tipo: type,
                icono: defaultEmoji,
                nombre: suggestedName,
                potrero_numero: potNum ? String(potNum) : '',
                estado: 'Operativo',
              });
              setShowNewPointModal(true);
              return;
            }

            if (mapToolMode === 'explore') {
              setSelectedPotreroNum(p.numero);
            } else {
              const lat = Number(e.latlng.lat.toFixed(6));
              const lng = Number(e.latlng.lng.toFixed(6));
              if (mapToolMode === 'pin_infra' && pinningInfraRef.current) {
                handleSavePinCoordinates(pinningInfraRef.current, lat, lng);
              } else if (mapToolMode === 'add_infra') {
                setClickedCoords({ lat, lng });
                setNewInfra((prev) => ({
                  ...prev,
                  potrero_numero: String(p.numero),
                  latitud: String(lat),
                  longitud: String(lng),
                }));
              } else if (mapToolMode === 'add_alerta') {
                setClickedCoords({ lat, lng });
                setNewAlerta((prev) => ({
                  ...prev,
                  potrero_numero: String(p.numero),
                }));
              } else if (mapToolMode === 'draw_camino') {
                setDrawingPoints((prev) => [...prev, [lat, lng]]);
              }
            }
          });

          fg.addLayer(layer);

          // Si este potrero está en modo edición de vértices, renderizar pines arrastrables
          if (isEditingThisPolygon && editingPolygonCoords) {
            // Pines arrastrables en cada vértice
            editingPolygonCoords.forEach((pt, vIdx) => {
              const pinIcon = L.divIcon({
                className: 'polygon-vertex-marker',
                html: `<div style="background:#f59e0b;color:#0f172a;font-weight:900;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.7);font-size:11px;cursor:grab;" title="Vértice #${vIdx + 1} (Arrastrá para ajustar alambrado)">${vIdx + 1}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              });

              const vMarker = L.marker([pt[0], pt[1]], {
                icon: pinIcon,
                draggable: true,
                zIndexOffset: 3000,
              });

              vMarker.on('drag', (e) => {
                const latlng = e.target.getLatLng();
                const newLat = Number(latlng.lat.toFixed(6));
                const newLng = Number(latlng.lng.toFixed(6));
                setEditingPolygonCoords((prev) => {
                  if (!prev) return null;
                  const copy = [...prev];
                  copy[vIdx] = [newLat, newLng];
                  return copy;
                });
              });

              vMarker.bindPopup(`
                <div style="text-align:center;padding:4px;min-width:130px">
                  <div style="font-weight:900;font-size:12px;color:#0f172a;margin-bottom:2px">Vértice #${vIdx + 1}</div>
                  <div style="font-size:10px;color:#64748b;margin-bottom:6px">${Number(pt[0]).toFixed(5)}, ${Number(pt[1]).toFixed(5)}</div>
                  ${
                    editingPolygonCoords.length > 3
                      ? `<button onclick="window.__sanJoseDeletePolygonVertex(${vIdx})" style="padding:4px 8px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
                          🗑️ Eliminar vértice
                        </button>`
                      : '<div style="font-size:10px;color:#94a3b8;font-weight:600">Mínimo 3 vértices</div>'
                  }
                </div>
              `);

              fg.addLayer(vMarker);
            });

            // Marcadores intermedios (+) para añadir nuevos vértices
            for (let i = 0; i < editingPolygonCoords.length; i++) {
              const p1 = editingPolygonCoords[i];
              const p2 = editingPolygonCoords[(i + 1) % editingPolygonCoords.length];
              const midLat = (p1[0] + p2[0]) / 2;
              const midLng = (p1[1] + p2[1]) / 2;

              const addIcon = L.divIcon({
                className: 'polygon-add-vertex-marker',
                html: `<div style="background:#10b981;color:#ffffff;font-weight:900;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.5);font-size:12px;cursor:pointer;" title="Hacé clic para añadir un vértice de alambrado aquí">+</div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9],
              });

              const addMarker = L.marker([midLat, midLng], {
                icon: addIcon,
                zIndexOffset: 2900,
              });

              const insertIdx = i + 1;
              addMarker.on('click', () => {
                setEditingPolygonCoords((prev) => {
                  if (!prev) return null;
                  const copy = [...prev];
                  copy.splice(insertIdx, 0, [Number(midLat.toFixed(6)), Number(midLng.toFixed(6))]);
                  return copy;
                });
                notify('Nuevo vértice añadido. Arrastralo para ubicarlo con precisión.', 'info');
              });

              fg.addLayer(addMarker);
            }
          }
        } catch (err) {
          console.warn('Error dibujando polígono de potrero', p.numero, err);
        }
      });
    }

    // 1.b DIBUJAR TARJETAS COMPACTAS DE RODEOS Y CABEZAS EN EL CENTROIDE (MÁX 115px, 2 RENGLONES)
    if (layersVisible.rodeos_labels) {
      potreros.forEach((p, idx) => {
        const numCode = p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero;
        const cabezas = cabezasPorPotrero[p.numero] || 0;
        const rodeosLote = rodeosPorPotrero[p.numero] || [];
        if (cabezas === 0 && rodeosLote.length === 0) return;

        const [cLat, cLng] = getPaddockCentroid(p, idx);
        if (!cLat || !cLng) return;

        const ha = Number(p.hectareas) || 0;
        const carga = ha > 0 ? Number((cabezas / ha).toFixed(2)) : 0;
        const nombresRodeo =
          rodeosLote.length > 0 ? rodeosLote.map((r) => r.nombre).join(' + ') : 'Hacienda';
        const permInfo =
          rodeosLote.length > 0 ? calcPermanenciaPotrero(rodeosLote[0], fechaOperacion) : null;
        const borderPerm =
          permInfo?.semaforo === 'ROJO'
            ? '#EF4444'
            : permInfo?.semaforo === 'AMBAR'
            ? '#F59E0B'
            : '#10B981';
        const diasTag = permInfo ? ` · ${permInfo.dias}d` : '';
        const diasMeta = rodeosLote[0]?.dias_estimados_pastoreo
          ? `${rodeosLote[0].dias_estimados_pastoreo}d`
          : '';
        const pasturaInfo = p.cultivo_actual || p.ambiente || 'Campo Natural';

        const isPasturasMode = mapViewMode === 'pasturas';
        const isAmbientesMode = mapViewMode === 'ambientes';
        const isResourceMode = isPasturasMode || isAmbientesMode;

        const recInfo = getPotreroRecursoInfo(p, siembrasActivasMap);
        const pastStyle = getPasturaStyle(p, siembrasActivasMap);
        const ambStyle = getAmbienteStyle(p);
        const recursoLabel = isPasturasMode
          ? (recInfo.tieneSiembraActiva ? (recInfo.esParcial ? `${recInfo.cultivo} ${recInfo.haSembradas.toFixed(0)}/${ha.toFixed(0)} ha` : recInfo.etiqueta) : 'Campo Natural')
          : isAmbientesMode
          ? (ambStyle.label || p.ambiente || 'Bajo Dulce / Natural')
          : '';
        const recursoColor = isPasturasMode ? '#86efac' : '#7dd3fc';

        let displayName = `P${numCode}`;
        if (p.nombre && p.nombre.trim()) {
          const trimmed = p.nombre.trim();
          if (/^potrero\s+\d+$/i.test(trimmed)) {
            displayName = `P${numCode}`;
          } else if (/^potrero\s+/i.test(trimmed)) {
            displayName = trimmed.replace(/^potrero\s+/i, 'P');
          } else {
            displayName = trimmed;
          }
        }

        const showNames = Boolean(layersVisible.etiquetas_marcadores ?? true);
        const effectiveDensity = !showNames
          ? 'compacto'
          : (currentZoom <= 13 ? 'intermedio' : 'detallado');

        const badgeBorder = isResourceMode
          ? (isPasturasMode ? '#059669' : '#0284c7')
          : borderPerm;

        let rodeoBadgeHtml = '';
        if (effectiveDensity === 'compacto') {
          rodeoBadgeHtml = `
            <div class="rodeo-badge-box rodeo-compact" style="pointer-events:auto;transform:translate(-50%, -50%);background:rgba(15,23,42,0.95);border:1.5px solid ${badgeBorder};box-shadow:0 2px 7px rgba(0,0,0,0.65);cursor:pointer;white-space:nowrap;border-radius:9999px;padding:2px 7px;display:inline-flex;align-items:center;justify-content:center;user-select:none;" title="${displayName}: ${cabezas} cabezas (${nombresRodeo})">
              <span style="font-size:11px;font-weight:900;color:#ffffff;line-height:1;">${displayName}</span>
              <span style="color:#10b981;font-weight:900;margin:0 3px">·</span>
              <span style="color:#fef08a;font-weight:900;font-size:11px;line-height:1;">${cabezas}</span>
            </div>
          `;
        } else if (effectiveDensity === 'intermedio') {
          rodeoBadgeHtml = `
            <div class="rodeo-badge-box rodeo-intermediate" style="pointer-events:auto;transform:translate(-50%, -50%);background:rgba(15,23,42,0.95);border:1.5px solid ${badgeBorder};box-shadow:0 3px 8px rgba(0,0,0,0.65);cursor:pointer;white-space:nowrap;border-radius:9999px;padding:2.5px 8px;display:inline-flex;align-items:center;justify-content:center;user-select:none;" title="${displayName}: ${cabezas} cabezas (${nombresRodeo})">
              <span style="font-size:11px;font-weight:900;color:#ffffff;line-height:1.2;">${displayName}</span>
              <span style="color:#10b981;font-weight:900;margin:0 3px">·</span>
              <span style="color:#fef08a;font-weight:800;font-size:10.5px;">${cabezas} cab.</span>
            </div>
          `;
        } else {
          rodeoBadgeHtml = `
            <div class="rodeo-badge-box rodeo-detailed" style="${
              isResourceMode
                ? 'width:auto;max-width:240px;padding:2.5px 8px;border-radius:8px;'
                : 'width:115px;max-width:115px;padding:2.5px 6px;border-radius:8px;'
            }background:rgba(15,23,42,0.95);border:1.5px solid ${badgeBorder};box-shadow:0 3px 8px rgba(0,0,0,0.65);cursor:pointer;text-align:center;user-select:none;pointer-events:auto;transform:translate(-50%, -50%);transition:transform 0.15s ease;box-sizing:border-box;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;">
              <!-- Línea 1 -->
              <div style="font-size:11px;font-weight:900;color:#ffffff;line-height:1.2;white-space:nowrap;letter-spacing:-0.2px;display:flex;align-items:center;justify-content:center;">
                <span>${displayName}</span>
                <span style="color:#10b981;font-weight:900;margin:0 3px">·</span>
                <span style="color:#fef08a;font-weight:800">${cabezas} cab.</span>
                ${
                  isResourceMode && recursoLabel
                    ? `
                  <span style="color:#10b981;font-weight:900;margin:0 3px">·</span>
                  <span style="color:${recursoColor};font-weight:800;font-size:10.5px">${recursoLabel}</span>
                `
                    : ''
                }
              </div>
              <!-- Línea 2 -->
              <div class="rodeo-sub-label" style="font-size:9.5px;font-weight:700;color:#cbd5e1;line-height:1.2;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${isResourceMode ? '220px' : '105px'};letter-spacing:-0.1px;" title="${nombresRodeo}${diasTag} · ${ha} ha">
                ${nombresRodeo}${diasTag} · ${ha} ha
              </div>
            </div>
          `;
        }

        const rodeoIcon = L.divIcon({
          className: 'rodeo-floating-badge',
          html: rodeoBadgeHtml,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        const rodeoMarker = L.marker([cLat, cLng], {
          icon: rodeoIcon,
          zIndexOffset: 1500,
        });

        // Hover Card nativo / informativo detallado sin recortes
        const hoverCardHtml = `
          <div style="min-width:180px;max-width:240px;padding:3px 2px;line-height:1.4;font-size:11.5px">
            <div style="font-weight:900;font-size:12.5px;color:#0f172a;margin-bottom:3px;display:flex;align-items:center;gap:4px">
              <span>🐄</span>
              <span style="color:#047857">${nombresRodeo}</span>
            </div>
            <div style="font-weight:800;color:#334155;font-size:11px">
              Potrero #${numCode} · ${p.nombre} <span style="font-weight:600;color:#64748b">(${ha} ha)</span>
            </div>
            <div style="margin-top:4px;padding-top:4px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between">
              <span style="color:#64748b">Carga:</span>
              <strong style="color:#0f172a">${cabezas} cab. (${carga} cab/ha)</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span style="color:#64748b">Estadía:</span>
              <strong style="color:${borderPerm}">
                ${permInfo ? `${permInfo.dias} días` : '-'} ${diasMeta ? `(Meta ${diasMeta})` : ''}
              </strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span style="color:#64748b">Pastura / Amb.:</span>
              <strong style="color:#0284c7">${pasturaInfo}</strong>
            </div>
            <div style="margin-top:6px;font-size:10px;color:#94a3b8;text-align:center;font-weight:700">
              Hacé clic para ver desglose o mover
            </div>
          </div>
        `;

        rodeoMarker.bindTooltip(hoverCardHtml, {
          direction: 'top',
          offset: [0, -14],
          opacity: 0.98,
        });

        rodeoMarker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setRodeoDetailModal({
            potrero: p,
            rodeos: rodeosLote,
            cabezas,
            permInfo,
          });
        });

        fg.addLayer(rodeoMarker);
      });
    }

    // 2. DIBUJAR CAMINOS OPERATIVOS Y PARCELAS ELÉCTRICAS / ALAMBRADOS
    if (layersVisible.caminos || layersVisible.alambres_electricos) {
      caminos.forEach((c) => {
        if (editingCamino && String(c.id) === String(editingCamino.id)) {
          // Se dibuja en el bloque interactivo de editingCamino
          return;
        }
        const pts = Array.isArray(c.coordenadas_json) ? c.coordenadas_json : [];
        if (pts.length < 2) return;

        const normEst = (c.estado_camino || c.estado || 'Transitable').toLowerCase();
        const tipoTraza = (c.tipo_traza || '').toLowerCase();
        const nomTraza = (c.nombre || '').toLowerCase();
        const isElectrico =
          tipoTraza.includes('eléctric') ||
          tipoTraza.includes('boyero') ||
          tipoTraza.includes('alambrado') ||
          nomTraza.includes('eléctric') ||
          nomTraza.includes('boyero') ||
          nomTraza.includes('parcela');

        // Filtrar según capa encendida
        if (isElectrico && !layersVisible.alambres_electricos) return;
        if (!isElectrico && !layersVisible.caminos) return;

        const isCortado =
          normEst.includes('cortado') ||
          normEst.includes('anegado') ||
          normEst.includes('apagado');
        const isPrecaucion = normEst.includes('precauci') || normEst.includes('barro');

        let color = '#cbd5e1';
        let weight = 2.5;
        let opacity = 0.85;
        let dashArray = null;

        if (isElectrico) {
          // Alambres Eléctricos / Parcelas: fina punteada ámbar/dorado de boyero (#f59e0b, weight: 2, dashArray: 6, 6, opacity: 0.9)
          color = isCortado ? '#ef4444' : '#f59e0b';
          weight = 2;
          dashArray = '6, 6';
          opacity = 0.9;
        } else {
          // Caminos Operativos: línea fina continua estilo huella rural (#cbd5e1, weight: 2.5, opacity: 0.85)
          color = isCortado ? '#ef4444' : isPrecaucion ? '#f97316' : '#cbd5e1';
          weight = 2.5;
          dashArray = isCortado ? '4, 4' : null;
          opacity = 0.85;
        }

        const polyline = L.polyline(pts, {
          color,
          weight,
          dashArray,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
        });

        const currentStatus = isCortado
          ? isElectrico
            ? 'Apagado / Cortado'
            : 'Cortado por barro'
          : isPrecaucion
          ? 'Con precaución'
          : isElectrico
          ? 'Eléctrico Activo'
          : 'Transitable';

        const iconHeader = isElectrico ? '⚡' : '🛣️';

        polyline.bindPopup(
          `<div style="min-width:260px;font-size:12px;line-height:1.45;padding:4px">
            <div style="font-weight:900;font-size:13px;color:#0f172a;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span>${iconHeader} ${c.nombre}</span>
              <span style="font-size:10px;padding:2px 6px;border-radius:6px;background:${color}22;color:${color};font-weight:800;border:1px solid ${color};white-space:nowrap">
                ${currentStatus}
              </span>
            </div>
            <div style="font-size:11px;color:#334155"><strong>Tipo:</strong> ${c.tipo_traza || (isElectrico ? 'Alambrado Eléctrico' : 'Camino Operativo')}</div>
            <div style="font-size:11px;color:#64748b"><strong>Puntos / Vértices:</strong> ${pts.length} puntos trazados</div>
            ${c.observaciones ? `<div style="margin-top:4px;color:#475569;font-size:11px;background:#f8fafc;padding:4px 6px;border-radius:4px;border:1px solid #e2e8f0">${c.observaciones}</div>` : ''}

            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:6px">
              <button onclick="window.__sanJoseEditCamino(${c.id})" style="width:100%;padding:6px 10px;border-radius:8px;background:#0f172a;color:#38bdf8;font-size:11px;font-weight:800;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px">
                ✏️ Editar Puntos & Datos
              </button>

              <div style="display:flex;gap:4px;margin-top:2px">
                <button onclick="window.__sanJoseToggleCamino(${c.id}, '${isElectrico ? 'Eléctrico Activo' : 'Transitable'}')" style="flex:1;padding:4px 6px;border-radius:6px;background:${currentStatus === 'Transitable' || currentStatus === 'Eléctrico Activo' ? '#047857' : '#f1f5f9'};color:${currentStatus === 'Transitable' || currentStatus === 'Eléctrico Activo' ? '#fff' : '#0f172a'};font-size:10px;font-weight:800;border:${currentStatus === 'Transitable' || currentStatus === 'Eléctrico Activo' ? 'none' : '1px solid #cbd5e1'};cursor:pointer">
                  ${isElectrico ? '⚡ Activo' : '🟢 Transitable'}
                </button>
                <button onclick="window.__sanJoseToggleCamino(${c.id}, '${isElectrico ? 'Eléctrico Apagado' : 'Cortado por barro'}')" style="flex:1;padding:4px 6px;border-radius:6px;background:${isCortado ? '#dc2626' : '#f1f5f9'};color:${isCortado ? '#fff' : '#0f172a'};font-size:10px;font-weight:800;border:${isCortado ? 'none' : '1px solid #cbd5e1'};cursor:pointer">
                  ${isElectrico ? '🔌 Apagado' : '🔴 Cortado'}
                </button>
              </div>
            </div>
          </div>`
        );
        fg.addLayer(polyline);
      });
    }

    // 2.B EDICIÓN VISUAL INTERACTIVA DE TRAZA (Pines arrastrables + Puntos intermedios +)
    if (
      editingCamino &&
      Array.isArray(editingCamino.coordenadas_json) &&
      editingCamino.coordenadas_json.length > 0
    ) {
      const editPts = editingCamino.coordenadas_json;
      const isElectrico =
        (editingCamino.tipo_traza || '').toLowerCase().includes('eléctric') ||
        (editingCamino.tipo_traza || '').toLowerCase().includes('boyero') ||
        (editingCamino.tipo_traza || '').toLowerCase().includes('alambrado');
      const lineColor = isElectrico ? '#06b6d4' : '#f59e0b';

      if (editPts.length >= 2) {
        const haloLine = L.polyline(editPts, {
          color: '#0f172a',
          weight: 8,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        });
        fg.addLayer(haloLine);

        const livePolyline = L.polyline(editPts, {
          color: lineColor,
          weight: 4.5,
          dashArray: isElectrico ? '8, 8' : null,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
        });
        fg.addLayer(livePolyline);
      }

      // Vértices arrastrables con numeración 1, 2, 3...
      editPts.forEach((pt, idx) => {
        const pinIcon = L.divIcon({
          className: 'trace-vertex-marker',
          html: `<div class="trace-vertex-pin" style="background:${lineColor};" title="Punto #${idx + 1} (Arrastrá para mover)">${idx + 1}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        const vMarker = L.marker([pt[0], pt[1]], {
          icon: pinIcon,
          draggable: true,
          zIndexOffset: 2500,
        });

        vMarker.on('dragend', (e) => {
          const latlng = e.target.getLatLng();
          const newLat = Number(latlng.lat.toFixed(6));
          const newLng = Number(latlng.lng.toFixed(6));
          setEditingCamino((prev) => {
            if (!prev) return null;
            const newCoords = prev.coordenadas_json.map((cCoord, i) =>
              i === idx ? [newLat, newLng] : cCoord
            );
            return { ...prev, coordenadas_json: newCoords };
          });
        });

        vMarker.bindPopup(`
          <div style="text-align:center;padding:4px;min-width:130px">
            <div style="font-weight:900;font-size:12px;color:#0f172a;margin-bottom:2px">Vértice #${idx + 1}</div>
            <div style="font-size:10px;color:#64748b;margin-bottom:6px">${Number(pt[0]).toFixed(5)}, ${Number(pt[1]).toFixed(5)}</div>
            ${
              editPts.length > 2
                ? `<button onclick="window.__sanJoseDeleteVertex(${idx})" style="padding:4px 8px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
                    🗑️ Eliminar punto
                  </button>`
                : '<div style="font-size:10px;color:#94a3b8;font-weight:600">Mínimo 2 puntos</div>'
            }
          </div>
        `);

        fg.addLayer(vMarker);
      });

      // Puntos intermedios (+) para agregar nuevos vértices
      for (let i = 0; i < editPts.length - 1; i++) {
        const p1 = editPts[i];
        const p2 = editPts[i + 1];
        if (Array.isArray(p1) && Array.isArray(p2)) {
          const midLat = Number(((p1[0] + p2[0]) / 2).toFixed(6));
          const midLng = Number(((p1[1] + p2[1]) / 2).toFixed(6));

          const midIcon = L.divIcon({
            className: 'trace-midpoint-marker',
            html: `<div class="trace-midpoint-pin" title="Hacé clic para insertar un vértice aquí">+</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });

          const midMarker = L.marker([midLat, midLng], {
            icon: midIcon,
            zIndexOffset: 2400,
          });

          midMarker.on('click', () => {
            setEditingCamino((prev) => {
              if (!prev) return null;
              const newCoords = [...prev.coordenadas_json];
              newCoords.splice(i + 1, 0, [midLat, midLng]);
              return { ...prev, coordenadas_json: newCoords };
            });
          });

          fg.addLayer(midMarker);
        }
      }
    }

    // Dibujar línea en vivo si el usuario está trazando un camino ahora mismo
    if (mapToolMode === 'draw_camino' && drawingPoints.length > 0) {
      drawingPoints.forEach((pt, i) => {
        const dot = L.circleMarker(pt, {
          radius: 5,
          color: '#ffffff',
          weight: 2,
          fillColor: '#facc15',
          fillOpacity: 1,
        }).bindTooltip(`Punto ${i + 1}`);
        fg.addLayer(dot);
      });
      if (drawingPoints.length >= 2) {
        const previewLine = L.polyline(drawingPoints, {
          color: '#facc15',
          weight: 4,
          dashArray: '6, 6',
        });
        fg.addLayer(previewLine);
      }
    }

    // 3. DIBUJAR INFRAESTRUCTURA (Molinos, Tanques, Bebidas, Corrales, Tranqueras, Casco, etc.)
    infraMarkersRef.current = {};

    function renderIndividualInfraMarker(inf) {
      const lat = Number(inf.latitud);
      const lng = Number(inf.longitud);
      if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) return;

      const isMinimal = isMinimalistInfra(inf);
      const isMonte =
        inf.tipo === 'Monte / Sombra' ||
        (inf.tipo || '').toLowerCase().includes('monte') ||
        (inf.tipo || '').toLowerCase().includes('sombra');

      if (isMonte) {
        // Polígono/círculo verde bosque translúcido (#15803d, opacity 0.20)
        const monteArea = L.circle([lat, lng], {
          radius: 50,
          color: '#15803d',
          weight: 1.2,
          fillColor: '#15803d',
          fillOpacity: 0.20,
          interactive: false,
        });
        fg.addLayer(monteArea);
      }

      const hasCustomEmoji = Boolean(
        inf.icono ||
        inf.emoji ||
        (inf.observaciones && inf.observaciones.includes('[icono:')) ||
        (inf.componentes_detalle && inf.componentes_detalle.includes('icono:'))
      );
      // Si Mostrar nombres en marcadores está ON, se muestra la cápsula completa de texto (o al reubicar/seleccionar).
      // Si está OFF, se muestra sólo el ícono circular compacto con tooltip al hover/tap para una vista ultra limpia.
      const showNames = Boolean(layersVisible.etiquetas_marcadores ?? true);
      const isBeingMoved = Boolean(movingInfra && movingInfra.id === inf.id);
      const isSelected = Boolean(editingInfra && editingInfra.id === inf.id);
      const isDraggable = Boolean(isBeingMoved || dragMarkersEnabled);

      const globalShowLabels = Boolean(showNames || isBeingMoved || isSelected);
      const effectiveStyle = globalShowLabels ? (inf.estilo_marcador || 'chip_icono_texto') : 'icono';

      const icon = buildInfraDivIcon(inf, effectiveStyle, isDraggable, globalShowLabels, isBeingMoved);

      const marker = L.marker([lat, lng], {
        icon,
        draggable: isDraggable,
        zIndexOffset: isBeingMoved ? 4000 : 0,
      });
      infraMarkersRef.current[inf.id] = marker;

      if (isDraggable) {
        marker.on('drag', (e) => {
          if (isBeingMoved) {
            const latlng = e.target.getLatLng();
            setMovingInfra((prev) =>
              prev ? { ...prev, currentLat: Number(latlng.lat.toFixed(6)), currentLng: Number(latlng.lng.toFixed(6)) } : null
            );
          }
        });

        marker.on('dragend', async (e) => {
          const nextPos = e.target.getLatLng();
          const newLat = Number(nextPos.lat.toFixed(6));
          const newLng = Number(nextPos.lng.toFixed(6));

          if (isBeingMoved) {
            setMovingInfra((prev) =>
              prev ? { ...prev, currentLat: newLat, currentLng: newLng } : null
            );
            return;
          }
          const isTranqueraOTranqueron = inf.tipo === 'Tranquera' || inf.tipo === 'Tranquerón';
          const potrerosConectados = detectarPotrerosConectados(newLat, newLng, potreros, 20);
          const numsList = potrerosConectados.map((x) => x.numero);

          let updatedNombre = inf.nombre;
          let newPotNum = inf.potrero_numero;

          if (isTranqueraOTranqueron) {
            if (numsList.length >= 2) {
              newPotNum = numsList[0];
              if (/^(Tranquera|Tranquer[oó]n)/i.test(inf.nombre) || !inf.nombre) {
                updatedNombre = `${inf.tipo} P${numsList[0]} ↔ P${numsList[1]}`;
              }
            } else if (numsList.length === 1) {
              newPotNum = numsList[0];
              if (/^(Tranquera|Tranquer[oó]n)/i.test(inf.nombre) || !inf.nombre) {
                updatedNombre = `${inf.tipo} P${numsList[0]}`;
              }
            }
          } else if (numsList.length > 0) {
            newPotNum = numsList[0];
          }

          const conectaTag = numsList.length >= 2 ? `[potreros:${numsList.join(',')}] [conecta:P${numsList[0]}↔P${numsList[1]}]` : numsList.length === 1 ? `[potreros:${numsList[0]}]` : '';
          const cleanObs = (inf.observaciones || '')
            .replace(/\[?(?:icono|estilo|estilo_marcador)[:=]\s*[^\]]+\]?/gi, '')
            .replace(/\[potreros:[^\]]+\]/gi, '')
            .replace(/\[conecta:[^\]]+\]/gi, '')
            .trim();
          const finalObs = cleanObs ? (conectaTag ? `${cleanObs} ${conectaTag}` : cleanObs) : (conectaTag || null);

          const updateData = {
            latitud: newLat,
            longitud: newLng,
            nombre: updatedNombre,
            potrero_numero: newPotNum,
            observaciones: finalObs,
          };

          try {
            if (isSandboxMode) {
              const updated = infraestructura.map((x) =>
                x.id === inf.id ? { ...x, ...updateData } : x
              );
              setInfraestructura && setInfraestructura(updated);
              try {
                const raw = localStorage.getItem('san_jose_sandbox_data');
                const d = raw ? JSON.parse(raw) : {};
                d.infraestructura = updated;
                localStorage.setItem('san_jose_sandbox_data', JSON.stringify(d));
              } catch (err) {}
              const labelInfo = numsList.length >= 2 ? ` (conecta P${numsList[0]} ↔ P${numsList[1]})` : '';
              notify(`Ubicación de "${updatedNombre}" actualizada${labelInfo}.`, 'success');
            } else {
              const { error } = await supabase
                .from('infraestructura')
                .update(updateData)
                .eq('id', inf.id);
              if (error) throw error;
              const labelInfo = numsList.length >= 2 ? ` (conecta P${numsList[0]} ↔ P${numsList[1]})` : '';
              notify(
                `Ubicación de "${updatedNombre}" actualizada por arrastre${labelInfo}.`,
                'success'
              );
              await onRefresh();
            }
          } catch (err) {
            notify(`Error al arrastrar pin: ${err.message}`, 'error');
          }
        });
      }

      marker.bindTooltip(
        `${inf.nombre} · ${inf.tipo} (${inf.estado || 'Operativo'})`,
        { className: 'infra-hover-tooltip', direction: 'top' }
      );

      const isMolino = inf.tipo === 'Molino';
      const solarHtml = isMolino
        ? `<div style="margin-top:4px;padding:3px 6px;border-radius:6px;background:${
            inf.solarizado ? '#dcfce7' : '#f1f5f9'
          };color:${inf.solarizado ? '#065f46' : '#334155'};font-weight:700;font-size:11px">
            ${
              inf.solarizado
                ? '☀️ Bomba Sumergible + Paneles Solares'
                : '💨 Molino de Viento Convencional'
            }
          </div>
          <div style="margin-top:6px">
            <button onclick="window.__sanJoseToggleSolarMolino(${inf.id}, ${!inf.solarizado})" style="padding:4px 8px;border-radius:6px;background:${
            inf.solarizado ? '#475569' : '#059669'
          };color:#fff;font-size:10.5px;font-weight:700;border:none;cursor:pointer">
              ${
                inf.solarizado
                  ? 'Pasar a Molino Convencional'
                  : '☀️ Marcar Bomba Sumergible + Paneles Solares'
              }
            </button>
          </div>`
        : '';

      const cleanTitulo = formatInfraTitulo(inf);
      const infraEmoji = getInfraEmoji(inf);
      const compLimpio = limpiarComponentesDetalle(inf.componentes_detalle);
      const compHtml = compLimpio
        ? `<div style="margin-top:3px;padding:3px 6px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:11px"><strong>Componentes:</strong> ${compLimpio}</div>`
        : '';
      const obsLimpia = limpiarTextoObservaciones(inf.observaciones);

      marker.bindPopup(
        `<div style="min-width:230px;font-size:12px;line-height:1.45">
          <div style="font-weight:800;font-size:13px;margin-bottom:3px;color:#0f172a;display:flex;align-items:center;justify-content:space-between">
            <span>${infraEmoji} ${cleanTitulo}</span>
            <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:#f1f5f9;color:#475569">${inf.estado || 'Operativo'}</span>
          </div>
          ${inf.potrero_numero ? `<div><strong>Potrero:</strong> #${inf.potrero_numero}</div>` : ''}
          ${inf.potreros_abastecidos ? `<div><strong>Abastece:</strong> ${inf.potreros_abastecidos}</div>` : ''}
          ${compHtml}
          ${solarHtml}
          <div style="margin-top:3px;color:#64748b;font-size:11px"><strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          ${obsLimpia ? `<div style="margin-top:4px;color:#475569">${obsLimpia}</div>` : ''}
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:6px">
            <button onclick="window.__sanJoseCreateTareaFromInfra(${inf.id})" style="width:100%;padding:6px 10px;border-radius:6px;background:#064e3b;color:#ffffff;font-size:11px;font-weight:800;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px">
              🔧 + Asignar Tarea de Mantenimiento
            </button>
            <div style="display:flex;align-items:center;gap:6px">
              <button onclick="window.__sanJoseStartMovingInfra(${inf.id})" style="flex:1;padding:5px 8px;border-radius:6px;background:#f59e0b;color:#0f172a;font-size:11px;font-weight:800;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px">
                📍 Mover
              </button>
              <button onclick="window.__sanJoseEditInfra(${inf.id})" style="flex:1;padding:5px 8px;border-radius:6px;background:#0f172a;color:#fff;font-size:11px;font-weight:700;border:none;cursor:pointer">
                ✏️ Editar
              </button>
              <button onclick="window.__sanJoseEliminarInfra(${inf.id})" style="flex:1;padding:5px 8px;border-radius:6px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-size:11px;font-weight:800;cursor:pointer">
                🗑️ Eliminar
              </button>
            </div>
          </div>
        </div>`
      );
      fg.addLayer(marker);
    }

    // Filtrar elementos con GPS cuyas capas estén visibles
    const validInfra = infraestructura.filter((inf) => {
      const lat = Number(inf.latitud);
      const lng = Number(inf.longitud);
      if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) return false;
      const layerKey = getLayerKeyForInfra(inf);
      return Boolean(layersVisible[layerKey]);
    });

    const waterElements = [];
    const otherElements = [];

    validInfra.forEach((inf) => {
      // Bebidas se renderizan individualmente con su ícono minimalista fino
      const isWater =
        inf.tipo === 'Molino' ||
        inf.tipo === 'Tanque Australiano';
      if (isWater) {
        waterElements.push(inf);
      } else {
        otherElements.push(inf);
      }
    });

    // En zoom <= 15: Agrupar elementos de aguada que estén a menos de 75m en un "Nodo de Aguada"
    if (currentZoom <= 15) {
      const clusters = clusterWaterElements(waterElements, 75);
      clusters.forEach((cluster) => {
        if (cluster.length > 1) {
          const isAlert = cluster.some((x) => (x.estado || 'Operativo') !== 'Operativo');
          const leadMolino = cluster.find((x) => x.tipo === 'Molino');
          const badgeText = leadMolino
            ? `M${leadMolino.molino_id_ref || leadMolino.codigo?.replace('M', '') || ''} +${cluster.length - 1}`
            : `💧 +${cluster.length}`;

          const icon = L.divIcon({
            className: 'infra-cluster-marker',
            html: `<div style="display:flex;align-items:center;justify-content:center;padding:0 7px;height:26px;border-radius:999px;background:${
              isAlert ? '#dc2626' : '#0284c7'
            };color:#ffffff;font-weight:900;font-size:10.5px;border:2px solid #ffffff;box-shadow:0 3px 8px rgba(0,0,0,0.55);cursor:pointer;white-space:nowrap;">
              💧 ${badgeText}
            </div>`,
            iconSize: [52, 26],
            iconAnchor: [26, 13],
          });

          const lat = Number(cluster[0].latitud);
          const lng = Number(cluster[0].longitud);
          const marker = L.marker([lat, lng], { icon });

          cluster.forEach((item) => {
            infraMarkersRef.current[item.id] = marker;
          });

          marker.bindTooltip(
            `Nodo de Aguada (${cluster.length} elementos): ${cluster.map((c) => c.nombre).join(' · ')}`,
            { className: 'infra-hover-tooltip', direction: 'top' }
          );

          const itemsHtml = cluster
            .map((item) => {
              const isOk = (item.estado || 'Operativo') === 'Operativo';
              const isMol = item.tipo === 'Molino';
              const solarBtn = isMol
                ? `<button onclick="window.__sanJoseToggleSolarMolino(${item.id}, ${!item.solarizado})" style="margin-top:3px;padding:2px 6px;border-radius:5px;background:${
                    item.solarizado ? '#475569' : '#059669'
                  };color:#fff;font-size:10px;font-weight:700;border:none;cursor:pointer">
                    ${item.solarizado ? '☀️ Solar' : '💨 Molino'}
                  </button>`
                : '';

              return `<div style="padding:6px 8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:6px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
                  <span style="font-weight:800;color:#0f172a;font-size:11.5px">${formatInfraTitulo(item)}</span>
                  <span style="font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;background:${
                    isOk ? '#dcfce7' : '#fee2e2'
                  };color:${isOk ? '#166534' : '#991b1b'}">${item.estado || 'Operativo'}</span>
                </div>
                ${item.potreros_abastecidos ? `<div style="font-size:10.5px;color:#64748b;margin-top:2px">Abastece: ${item.potreros_abastecidos}</div>` : ''}
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;gap:4px">
                  ${solarBtn}
                  <div style="display:flex;gap:4px;margin-left:auto">
                    <button onclick="window.__sanJoseCreateTareaFromInfra(${item.id})" style="padding:3px 7px;border-radius:5px;background:#064e3b;color:#ffffff;font-size:10px;font-weight:800;border:none;cursor:pointer">
                      🔧 + Tarea
                    </button>
                    <button onclick="window.__sanJoseEditInfra(${item.id})" style="padding:3px 7px;border-radius:5px;background:#0f172a;color:#fff;font-size:10px;font-weight:700;border:none;cursor:pointer">
                      Editar
                    </button>
                    <button onclick="window.__sanJoseReubicarPin(${item.id})" style="padding:3px 7px;border-radius:5px;background:#f59e0b;color:#000;font-size:10px;font-weight:800;border:none;cursor:pointer">
                      Mover pin
                    </button>
                  </div>
                </div>
              </div>`;
            })
            .join('');

          marker.bindPopup(
            `<div style="min-width:270px;font-size:12px;line-height:1.4">
              <div style="font-weight:900;font-size:13px;color:#0284c7;border-bottom:1.5px solid #e2e8f0;padding-bottom:5px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
                <span>💧 Nodo de Aguada</span>
                <span style="font-size:11px;font-weight:700;color:#64748b">${cluster.length} componentes</span>
              </div>
              <div style="max-height:260px;overflow-y:auto;padding-right:2px">
                ${itemsHtml}
              </div>
              <div style="font-size:10px;color:#94a3b8;margin-top:6px;text-align:center">
                Acercá el zoom (zoom ≥ 16) para verlos y arrastrarlos por separado.
              </div>
            </div>`
          );

          fg.addLayer(marker);
        } else {
          renderIndividualInfraMarker(cluster[0]);
        }
      });
    } else {
      // Zoom >= 16: Desplegar cada elemento de aguada de forma individual
      waterElements.forEach((inf) => renderIndividualInfraMarker(inf));
    }

    // Dibujar elementos no-aguada de forma individual siempre
    otherElements.forEach((inf) => renderIndividualInfraMarker(inf));

    // 4. DIBUJAR POST-ITS / ALERTAS EN EL MAPA (solo las no resueltas)
    if (layersVisible.alertas) {
      alertasMapa
        .filter((a) => !a.resuelta)
        .forEach((a) => {
          let lat = Number(a.latitud);
          let lng = Number(a.longitud);

          // Si no tiene GPS pero sí potrero asociado, ubicar en el centroide de ese potrero
          if ((!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) && a.potrero_numero) {
            const pot = potreros.find((x) => Number(x.numero) === Number(a.potrero_numero));
            if (pot) {
              const [cLat, cLng] = getPaddockCentroid(pot, 0);
              if (cLat && cLng) {
                lat = cLat + 0.0012; // leve offset para no tapar el centroide
                lng = cLng + 0.0012;
              }
            }
          }

          if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) return;

          const isHigh = a.prioridad === 'Alta';
          const bgPostIt = isHigh ? '#fef08a' : '#fef9c3';
          const borderPostIt = isHigh ? '#dc2626' : '#ca8a04';

          const postItIcon = L.divIcon({
            className: 'postit-alert-marker',
            html: `<div style="background:${bgPostIt};color:#0f172a;border:2px solid ${borderPostIt};border-radius:8px;padding:3px 7px;font-size:10px;font-weight:800;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.45);display:inline-flex;align-items:center;gap:4px;">
              <span>📌</span>
              <span>${a.tipo}: ${a.titulo.slice(0, 18)}</span>
            </div>`,
            iconSize: [130, 26],
            iconAnchor: [65, 13],
          });

          const marker = L.marker([lat, lng], { icon: postItIcon });
          marker.bindPopup(
            `<div style="min-width:210px;font-size:12px;line-height:1.45">
              <div style="font-weight:800;font-size:13px;color:#b91c1c;margin-bottom:3px">
                📌 ${a.tipo} (${a.prioridad})
              </div>
              <div style="font-weight:700;color:#0f172a">${a.titulo}</div>
              ${a.potrero_numero ? `<div><strong>Potrero:</strong> #${a.potrero_numero}</div>` : ''}
              <div style="color:#64748b;font-size:11px">Fecha: ${a.fecha_creacion || '-'}</div>
              ${a.observaciones ? `<div style="margin-top:4px;color:#334155">${a.observaciones}</div>` : ''}
              <div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <button onclick="window.__sanJoseEditAlerta(${a.id})" style="padding:5px 9px;border-radius:6px;background:#0284c7;color:#fff;font-size:11px;font-weight:700;border:none;cursor:pointer">
                  ✎ Editar
                </button>
                <button onclick="window.__sanJoseResolveAlerta(${a.id})" style="padding:5px 9px;border-radius:6px;background:#15803d;color:#fff;font-size:11px;font-weight:700;border:none;cursor:pointer">
                  ✓ Marcar como Resuelta
                </button>
              </div>
            </div>`
          );
          fg.addLayer(marker);
        });
    }

    // Marcador temporal donde el usuario acaba de hacer clic
    if (
      (mapToolMode === 'add_infra' || mapToolMode === 'add_alerta') &&
      clickedCoords
    ) {
      const tempMarker = L.circleMarker([clickedCoords.lat, clickedCoords.lng], {
        radius: 9,
        color: '#ffffff',
        weight: 3,
        fillColor: '#f59e0b',
        fillOpacity: 1,
      }).bindTooltip('Punto GPS seleccionado', { permanent: true, direction: 'top' });
      fg.addLayer(tempMarker);
    }

    // DIBUJAR RUTA Y PARADAS DE CUADRILLA (si hay un plan activo)
    if (
      activeCuadrillaRoute &&
      Array.isArray(activeCuadrillaRoute.paradas) &&
      activeCuadrillaRoute.paradas.length > 0
    ) {
      const casco = activeCuadrillaRoute.origen_casco || {
        lat: -35.868,
        lng: -58.945,
        nombre: 'Casco / Galpón Taller',
      };
      const routePoints = [[casco.lat, casco.lng]];

      const isRecorrida = activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA';

      // Marcador del Casco / Base
      const cascoIcon = L.divIcon({
        className: 'cuadrilla-casco-pin',
        html: `<div style="background:#0f172a;color:${isRecorrida ? '#34d399' : '#f59e0b'};border:2.5px solid ${isRecorrida ? '#10b981' : '#f59e0b'};box-shadow:0 4px 12px rgba(0,0,0,0.6);border-radius:12px;padding:4px 8px;display:flex;align-items:center;gap:4px;font-size:11px;font-weight:900;white-space:nowrap;">
          <span>${isRecorrida ? '🏡 Casco Central' : '🛻 Galpón Base'}</span>
        </div>`,
        iconAnchor: [45, 16],
      });
      const cascoMarker = L.marker([casco.lat, casco.lng], {
        icon: cascoIcon,
        zIndexOffset: 1200,
      }).bindPopup(`
        <div style="font-family:sans-serif;font-size:12px;line-height:1.4;color:#0f172a;">
          <div style="font-weight:900;color:#1e293b;font-size:13px;">🏡 ${
            casco.nombre || 'Casco Central / Base Operativa'
          }</div>
          <div style="color:#64748b;font-size:11px;">Punto de partida y retorno ${isRecorrida ? 'de la Recorrida Ganadera' : 'de la Cuadrilla San José'}</div>
          <div style="margin-top:6px;font-weight:700;color:${isRecorrida ? '#047857' : '#b45309'};">⏱️ Salida: ${
            activeCuadrillaRoute.inicio_recomendado || '07:00 hs'
          }</div>
        </div>
      `);
      fg.addLayer(cascoMarker);

      // Dibujar cada parada numerada
      activeCuadrillaRoute.paradas.forEach((p, idx) => {
        if (!p.coordenadas || p.coordenadas.length < 2) return;
        const [pLat, pLng] = p.coordenadas;
        if (isNaN(pLat) || isNaN(pLng)) return;

        routePoints.push([pLat, pLng]);

        const stopNum = p.numero_parada || idx + 1;
        const stopBg = isRecorrida ? '#047857' : '#d97706';
        const stopIcon = L.divIcon({
          className: 'cuadrilla-stop-pin',
          html: `<div style="background:${stopBg};color:#ffffff;border:2.5px solid #ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.6);border-radius:9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;text-shadow:0 1px 2px rgba(0,0,0,0.5);">${stopNum}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -18],
        });

        const popupContent = `
          <div style="font-family:sans-serif;font-size:12px;min-width:210px;color:#0f172a;line-height:1.4;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="background:${isRecorrida ? '#dcfce7' : '#fef3c7'};color:${isRecorrida ? '#14532d' : '#92400e'};font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;">
                PARADA ${stopNum} · ${isRecorrida ? 'Recorrida Ganadera' : p.tipo || 'Trabajo'}
              </span>
              <span style="font-weight:800;color:${isRecorrida ? '#047857' : '#b45309'};font-size:11px;">⏱️ ${
                p.duracion_estimada || '25m'
              }</span>
            </div>
            <div style="font-weight:900;font-size:13px;color:#0f172a;margin-bottom:2px;">
              ${p.ubicacion || (p.potrero_nombre ? `P#${p.potrero_numero} ${p.potrero_nombre}` : 'San José')}
            </div>
            <div style="font-weight:700;color:#334155;margin-bottom:6px;">
              ${p.titulo || ''}
            </div>
            <div style="font-size:11px;color:#64748b;background:#f8fafc;padding:6px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:6px;">
              ${p.acciones || ''}
            </div>
            ${
              isRecorrida && p.puntos_relevamiento
                ? `<div style="font-size:10px;color:#334155;line-height:1.5;">
                    <div><strong>🥩 Cond. Corporal:</strong> ${p.puntos_relevamiento.condicion_corporal || 'Meta 3.0'}</div>
                    <div><strong>🌱 Pasto:</strong> ${p.puntos_relevamiento.disponibilidad_pasto || p.recurso_forrajero || 'Medir remanente'}</div>
                    <div><strong>💧 Aguada:</strong> ${p.puntos_relevamiento.aguadas || 'Verificar bebida'}</div>
                    <div><strong>🩺 Sanidad:</strong> ${p.puntos_relevamiento.sanidad_reproduccion || 'Chequeo general'}</div>
                  </div>`
                : ''
            }
            ${
              !isRecorrida && p.herramientas_especificas?.length
                ? `<div style="margin-top:6px;font-size:10px;color:#475569;"><strong>🔧 Herramientas:</strong> ${p.herramientas_especificas.join(
                    ', '
                  )}</div>`
                : ''
            }
          </div>
        `;

        const marker = L.marker([pLat, pLng], {
          icon: stopIcon,
          zIndexOffset: 1100,
        }).bindPopup(popupContent);
        fg.addLayer(marker);
      });

      // Retorno al Casco para cerrar el circuito
      routePoints.push([casco.lat, casco.lng]);

      // Trazado de ruta con halo oscuro + línea punteada de alta visibilidad
      const routeHalo = L.polyline(routePoints, {
        color: '#0f172a',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      });
      fg.addLayer(routeHalo);

      const routeLine = L.polyline(routePoints, {
        color: isRecorrida ? '#10b981' : '#fbbf24',
        weight: 3.5,
        dashArray: '8, 6',
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      });
      fg.addLayer(routeLine);
    }

    // Ajustar zoom automáticamente al cargar por primera vez SOLO si no hay cámara previa guardada
    if (
      !hasFittedBoundsRef.current &&
      !initialBoundsAppliedRef.current &&
      !getSavedCamera() &&
      potreros.length > 0
    ) {
      handleFitFieldBounds();
      hasFittedBoundsRef.current = true;
      initialBoundsAppliedRef.current = true;
    }
  }, [
    potreros,
    infraestructura,
    alertasMapa,
    caminos,
    editingCamino,
    activeCuadrillaRoute,
    cabezasPorPotrero,
    rodeosPorPotrero,
    selectedPotreroNum,
    layersVisible,
    mapViewMode,
    mapToolMode,
    clickedCoords,
    drawingPoints,
    currentZoom,
    editingInfra,
    movingInfra,
    labelDensity,
    dragMarkersEnabled,
    handleFitFieldBounds,
    mapReadyToken,
  ]);

  // Encuadrar automáticamente el mapa cuando se activa una nueva ruta de cuadrilla
  useEffect(() => {
    if (!activeCuadrillaRoute || !activeCuadrillaRoute.paradas?.length) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const bounds = L.latLngBounds([]);
    const casco = activeCuadrillaRoute.origen_casco || { lat: -35.868, lng: -58.945 };
    bounds.extend([casco.lat, casco.lng]);
    activeCuadrillaRoute.paradas.forEach((p) => {
      if (p.coordenadas && p.coordenadas.length >= 2) {
        bounds.extend(p.coordenadas);
      }
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [activeCuadrillaRoute]);

  async function ensureMolinoExists(molinoNumero) {
    if (!molinoNumero) return;
    const num = parseInt(molinoNumero, 10);
    if (Number.isNaN(num)) return;
    const exists = molinos.some((m) => Number(m.numero) === num);
    if (!exists) {
      await supabase.from('molinos').upsert(
        {
          numero: num,
          nombre: `Molino ${num}`,
          estado: 'Operativo',
        },
        { onConflict: 'numero' }
      );
    }
  }

  // Guardar punto colocado manualmente en satélite (Tranquera, Tranquerón, Bebida, Monte)
  async function handleSaveNewPoint(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!pendingPointCoords) return;

    const tipo = newPointForm.tipo || 'Tranquera';
    const isTranqueraOTranqueron = tipo === 'Tranquera' || tipo === 'Tranquerón';
    const potrerosConectados = pendingPointCoords?.potrerosConectados?.length
      ? pendingPointCoords.potrerosConectados
      : detectarPotrerosConectados(pendingPointCoords.lat, pendingPointCoords.lng, potreros, 20).map((x) => x.numero);

    const potNum = newPointForm.potrero_numero ? parseInt(newPointForm.potrero_numero, 10) : (potrerosConectados[0] || null);
    const defaultNombre = potrerosConectados.length >= 2
      ? `${tipo} P${potrerosConectados[0]} ↔ P${potrerosConectados[1]}`
      : potNum
      ? `${tipo} P${potNum}`
      : tipo;
    const finalNombre = (newPointForm.nombre || '').trim() || defaultNombre;
    const finalEmoji = newPointForm.icono || getDefaultEmojiForTipo(tipo);

    const conectaTag = potrerosConectados.length >= 2
      ? `[potreros:${potrerosConectados.join(',')}] [conecta:P${potrerosConectados[0]}↔P${potrerosConectados[1]}]`
      : potrerosConectados.length === 1
      ? `[potreros:${potrerosConectados[0]}]`
      : '';

    const payload = {
      tipo,
      nombre: finalNombre,
      codigo: tipo === 'Tranquera' ? 'TQ' : tipo === 'Tranquerón' ? 'TQN' : tipo === 'Bebida' ? 'BEB' : 'PTO',
      potrero_numero: potNum,
      estado: newPointForm.estado || 'Operativo',
      latitud: pendingPointCoords.lat,
      longitud: pendingPointCoords.lng,
      observaciones: conectaTag || null,
      componentes_detalle: null,
      icono: finalEmoji,
      estilo_marcador: 'chip',
      solarizado: false,
      es_edificacion_casco: false,
    };

    setSavingId('new-point');
    try {
      if (isSandboxMode) {
        const newId = Date.now();
        const created = { id: newId, ...payload, icono: finalEmoji, emoji: finalEmoji, origen: 'manual', manual: true };
        const updated = [...infraestructura, created];
        setInfraestructura && setInfraestructura(updated);
        try {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          const d = raw ? JSON.parse(raw) : {};
          d.infraestructura = updated;
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(d));
        } catch (err) {}
        notify(`✅ ${finalEmoji} ${tipo} "${finalNombre}" guardada correctamente en el mapa.`, 'success');
        onRefresh && onRefresh();
      } else {
        // Intentar guardar con icono explícito; si la columna no existe en Supabase, reintentar con payload limpio
        let insertErr = null;
        try {
          const res = await supabase.from('infraestructura').insert({ ...payload, icono: finalEmoji });
          insertErr = res.error;
        } catch (e) {
          insertErr = e;
        }

        if (insertErr) {
          const { error: retryErr } = await supabase.from('infraestructura').insert(payload);
          if (retryErr) throw retryErr;
        }
        notify(`✅ ${finalEmoji} ${tipo} "${finalNombre}" guardada en mapa satelital.`, 'success');
        await onRefresh();
      }
      setShowNewPointModal(false);
      setPendingPointCoords(null);
      setQuickMarkType(null);
    } catch (err) {
      notify(`Error guardando punto: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // Guardar nuevo elemento de Infraestructura
  async function handleSaveNewInfra(e) {
    e.preventDefault();
    if (!newInfra.nombre.trim()) {
      notify('Ingresá un nombre o identificación para la infraestructura.', 'error');
      return;
    }
    setSavingId('new-infra');
    try {
      const isEdif = newInfra.tipo === 'Edificación / Casco';
      const estiloMarcador = newInfra.estilo_marcador || 'chip';
      const cleanComp = (newInfra.componentes_detalle || '')
        .replace(/\[?estilo:[a-z]+\]?/gi, '')
        .trim();
      const finalComp = `${cleanComp ? cleanComp + ' ' : ''}[estilo:${estiloMarcador}]`;

      const payload = {
        tipo: newInfra.tipo,
        codigo: newInfra.codigo.trim() || null,
        nombre: newInfra.nombre.trim(),
        potrero_numero: newInfra.potrero_numero
          ? parseInt(newInfra.potrero_numero, 10)
          : null,
        potreros_abastecidos: newInfra.potreros_abastecidos.trim() || null,
        estado: newInfra.estado || 'Operativo',
        latitud: !isEdif && newInfra.latitud ? parseFloat(newInfra.latitud) : null,
        longitud: !isEdif && newInfra.longitud ? parseFloat(newInfra.longitud) : null,
        componentes_detalle: finalComp,
        estilo_marcador: estiloMarcador,
        solarizado: Boolean(newInfra.solarizado),
        sistema_bombeo:
          newInfra.tipo === 'Molino'
            ? newInfra.solarizado
              ? 'Bomba Sumergible + Paneles Solares'
              : 'Molino de Viento Convencional'
            : null,
        es_edificacion_casco: isEdif,
        observaciones: newInfra.observaciones.trim() || null,
      };

      let insertErr = null;
      try {
        const res = await supabase.from('infraestructura').insert(payload);
        insertErr = res.error;
      } catch (err) {
        insertErr = err;
      }

      if (insertErr) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.estilo_marcador;
        const { error: retryErr } = await supabase.from('infraestructura').insert(fallbackPayload);
        if (retryErr) throw retryErr;
      }

      notify(`${payload.tipo} "${payload.nombre}" guardado.`, 'success');
      setNewInfra({
        tipo: newInfra.tipo,
        codigo: '',
        nombre: '',
        potrero_numero: '',
        potreros_abastecidos: '',
        estado: 'Operativo',
        latitud: '',
        longitud: '',
        componentes_detalle: '',
        solarizado: false,
        observaciones: '',
      });
      setClickedCoords(null);
      setMapToolMode('explore');
      await onRefresh();
    } catch (err) {
      notify(`Error guardando infraestructura: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleUpdateInfraStatus(inf, nuevoEstado) {
    try {
      const { error } = await supabase
        .from('infraestructura')
        .update({ estado: nuevoEstado })
        .eq('id', inf.id);
      if (error) throw error;

      if (inf.molino_id_ref) {
        await supabase
          .from('molinos')
          .update({ estado: nuevoEstado })
          .eq('numero', inf.molino_id_ref);
      }

      notify(`${inf.nombre} actualizado a "${nuevoEstado}".`, 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error actualizando estado: ${err.message}`, 'error');
    }
  }

  async function handleDeleteInfra(inf) {
    const ok = await confirmAction({
      title: `¿Eliminar "${inf.nombre || 'este elemento'}" del mapa?`,
      description: `Tipo: ${inf.tipo || 'Infraestructura'}. Se eliminará la georreferenciación en el mapa interactivo.`,
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      if (isSandboxMode) {
        const updated = infraestructura.filter((x) => x.id !== inf.id);
        setInfraestructura && setInfraestructura(updated);
        try {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          const d = raw ? JSON.parse(raw) : {};
          d.infraestructura = updated;
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(d));
        } catch (err) {}
        notify(`${inf.nombre} eliminado del mapa.`, 'info');
        onRefresh && onRefresh();
      } else {
        const { error } = await supabase
          .from('infraestructura')
          .delete()
          .eq('id', inf.id);
        if (error) throw error;
        notify(`${inf.nombre} eliminado.`, 'success');
        await onRefresh();
      }
    } catch (err) {
      notify(`Error al eliminar infraestructura: ${err.message}`, 'error');
    }
  }

  // Guardar nuevo Post-it / Alerta en el Mapa
  async function handleSaveNewAlerta(e) {
    e.preventDefault();
    if (!clickedCoords) {
      notify('Hacé clic primero en el punto del mapa donde querés clavar el Post-it.', 'error');
      return;
    }
    if (!newAlerta.titulo.trim()) {
      notify('Escribí un mensaje corto para el Post-it de alerta.', 'error');
      return;
    }
    setSavingId('new-alerta');
    try {
      const payload = {
        titulo: newAlerta.titulo.trim(),
        tipo: newAlerta.tipo,
        prioridad: newAlerta.prioridad,
        potrero_numero: newAlerta.potrero_numero
          ? parseInt(newAlerta.potrero_numero, 10)
          : null,
        latitud: clickedCoords.lat,
        longitud: clickedCoords.lng,
        resuelta: false,
        observaciones: newAlerta.observaciones.trim() || null,
      };

      const { error } = await supabase.from('alertas_mapa').insert(payload);
      if (error) throw error;

      notify(`Post-it "${payload.titulo}" clavado en el mapa.`, 'success');
      setNewAlerta({
        titulo: '',
        tipo: 'Falta agua',
        prioridad: 'Alta',
        potrero_numero: '',
        observaciones: '',
      });
      setClickedCoords(null);
      setMapToolMode('explore');
      await onRefresh();
    } catch (err) {
      notify(`Error guardando Post-it: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // Actualizar Post-it / Alerta editado
  async function handleUpdateAlerta(e) {
    if (e) e.preventDefault();
    if (!editingAlerta) return;
    if (!editingAlerta.titulo?.trim()) {
      notify('El Post-it debe tener un texto o título.', 'error');
      return;
    }
    setUpdatingAlerta(true);
    try {
      const payload = {
        titulo: editingAlerta.titulo.trim(),
        tipo: editingAlerta.tipo || 'Falta agua',
        prioridad: editingAlerta.prioridad || 'Alta',
        potrero_numero: editingAlerta.potrero_numero
          ? parseInt(editingAlerta.potrero_numero, 10)
          : null,
        observaciones: editingAlerta.observaciones?.trim() || null,
      };

      const { error } = await supabase
        .from('alertas_mapa')
        .update(payload)
        .eq('id', editingAlerta.id);
      if (error) throw error;

      notify(`Post-it "${payload.titulo}" actualizado correctamente.`, 'success');
      setEditingAlerta(null);
      await onRefresh();
    } catch (err) {
      notify(`Error actualizando Post-it: ${err.message}`, 'error');
    } finally {
      setUpdatingAlerta(false);
    }
  }

  async function handleToggleResolveAlerta(alerta) {
    try {
      const next = !alerta.resuelta;
      const { error } = await supabase
        .from('alertas_mapa')
        .update({
          resuelta: next,
          fecha_resolucion: next ? new Date().toISOString().slice(0, 10) : null,
        })
        .eq('id', alerta.id);
      if (error) throw error;
      notify(
        next ? 'Alerta marcada como resuelta.' : 'Alerta reactivada en el mapa.',
        'success'
      );
      await onRefresh();
    } catch (err) {
      notify(`Error actualizando alerta: ${err.message}`, 'error');
    }
  }

  async function handleDeleteAlerta(alerta) {
    const ok = await confirmAction({
      title: '¿Eliminar Post-it del mapa?',
      description: `Se eliminará la nota "${alerta.titulo || alerta.mensaje || 'Alerta'}" de este potrero.`,
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('alertas_mapa')
        .delete()
        .eq('id', alerta.id);
      if (error) throw error;
      notify('Post-it eliminado.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error eliminando Post-it: ${err.message}`, 'error');
    }
  }

  // Guardar Camino Operativo o Parcela Eléctrica trazada
  async function handleSaveNewCamino(e) {
    e.preventDefault();
    if (drawingPoints.length < 2) {
      notify('Hacé clic en al menos 2 puntos sobre el mapa para trazar la línea.', 'error');
      return;
    }
    if (!newCamino.nombre.trim()) {
      notify('Ingresá un nombre para identificar el camino o parcela eléctrica.', 'error');
      return;
    }
    setSavingId('new-camino');
    try {
      const payload = {
        nombre: newCamino.nombre.trim(),
        tipo_traza: newCamino.tipo_traza,
        estado: newCamino.estado,
        potrero_numero: newCamino.potrero_numero
          ? parseInt(newCamino.potrero_numero, 10)
          : null,
        coordenadas_json: drawingPoints,
        observaciones: newCamino.observaciones.trim() || null,
      };

      const { error } = await supabase.from('caminos').insert(payload);
      if (error) throw error;

      notify(`${payload.tipo_traza} "${payload.nombre}" guardado en el mapa.`, 'success');
      setNewCamino({
        nombre: '',
        tipo_traza: 'Camino Interno',
        estado: 'Transitable',
        potrero_numero: '',
        observaciones: '',
      });
      setDrawingPoints([]);
      setMapToolMode('explore');
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar camino: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteCamino(camino) {
    const ok = await confirmAction({
      title: `¿Eliminar traza "${camino.nombre || 'esta traza'}"?`,
      description: `Tipo: ${camino.tipo_traza || 'Camino'}. Se eliminará el trazado del mapa.`,
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('caminos').delete().eq('id', camino.id);
      if (error) throw error;
      notify('Traza eliminada.', 'success');
      await onRefresh();
    } catch (err) {
      notify(`Error eliminando traza: ${err.message}`, 'error');
    }
  }

  async function handleSaveEditedCamino(e) {
    if (e) e.preventDefault();
    if (!editingCamino) return;
    if (!editingCamino.nombre?.trim()) {
      notify('Ingresá un nombre para la traza.', 'error');
      return;
    }
    if (
      !Array.isArray(editingCamino.coordenadas_json) ||
      editingCamino.coordenadas_json.length < 2
    ) {
      notify('La traza debe contener al menos 2 puntos geográficos.', 'error');
      return;
    }
    setSavingEditingCamino(true);
    try {
      const estadoNorm =
        editingCamino.estado_camino || editingCamino.estado || 'Transitable';
      const { error } = await supabase
        .from('caminos')
        .update({
          nombre: editingCamino.nombre.trim(),
          tipo_traza: editingCamino.tipo_traza || 'Camino Interno',
          estado: estadoNorm,
          estado_camino: estadoNorm,
          observaciones: editingCamino.observaciones?.trim() || null,
          coordenadas_json: editingCamino.coordenadas_json,
        })
        .eq('id', editingCamino.id);

      if (error) throw error;
      notify(`Traza "${editingCamino.nombre}" actualizada con éxito.`, 'success');
      setEditingCamino(null);
      await onRefresh();
    } catch (err) {
      console.error('Error guardando traza:', err);
      notify(`Error guardando traza: ${err.message}`, 'error');
    } finally {
      setSavingEditingCamino(false);
    }
  }

  // Sincronización bidireccional automática con labores_siembras
  async function syncSiembraFromMapa(pNum, nuevoCultivo, hectareas) {
    const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
    const normCultivo = (nuevoCultivo || 'Campo Natural').trim();
    const esCampoNatural = !normCultivo || normCultivo.toLowerCase() === 'campo natural' || normCultivo.toLowerCase().startsWith('campo natural');

    if (isSandbox) {
      const raw = localStorage.getItem('san_jose_sandbox_data');
      if (raw) {
        const sData = JSON.parse(raw);
        if (!Array.isArray(sData.labores_siembras)) sData.labores_siembras = [];

        if (esCampoNatural) {
          sData.labores_siembras = sData.labores_siembras.map((s) => {
            if (Number(s.potrero_numero) === Number(pNum) && (s.vigencia || 'Activa') === 'Activa') {
              return { ...s, vigencia: 'Pasada / Histórica', estado: 'Cosechado' };
            }
            return s;
          });
        } else {
          const existingIdx = sData.labores_siembras.findIndex(
            (s) => Number(s.potrero_numero) === Number(pNum) && (s.vigencia || 'Activa') === 'Activa' && s.estado !== 'Cosechado'
          );
          if (existingIdx >= 0) {
            sData.labores_siembras[existingIdx] = {
              ...sData.labores_siembras[existingIdx],
              cultivo_variedad: normCultivo,
              hectareas: Number(hectareas) || sData.labores_siembras[existingIdx].hectareas,
            };
          } else {
            sData.labores_siembras.push({
              id: Date.now(),
              potrero_numero: Number(pNum),
              campana: '2026/2027',
              cultivo_variedad: normCultivo,
              variedad_hibrido: '',
              hectareas: Number(hectareas) || 0,
              fecha: new Date().toISOString().slice(0, 10),
              estado: 'Sembrado',
              vigencia: 'Activa',
              tarea: 'Siembra Directa',
              observaciones: `Actualizado desde el Mapa de Potreros (#${pNum}).`,
            });
          }
        }

        localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
        window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'labores_siembras' } }));
      }
    } else {
      if (esCampoNatural) {
        await supabase
          .from('labores_siembras')
          .update({ vigencia: 'Pasada / Histórica', estado: 'Cosechado' })
          .eq('potrero_numero', Number(pNum))
          .eq('vigencia', 'Activa');
      } else {
        const { data: activas } = await supabase
          .from('labores_siembras')
          .select('id')
          .eq('potrero_numero', Number(pNum))
          .eq('vigencia', 'Activa')
          .neq('estado', 'Cosechado')
          .limit(1);

        if (activas && activas.length > 0) {
          await supabase
            .from('labores_siembras')
            .update({
              cultivo_variedad: normCultivo,
              hectareas: Number(hectareas) || undefined,
            })
            .eq('id', activas[0].id);
        } else {
          await supabase.from('labores_siembras').insert({
            potrero_numero: Number(pNum),
            campana: '2026/2027',
            cultivo_variedad: normCultivo,
            variedad_hibrido: '',
            hectareas: Number(hectareas) || 0,
            fecha: new Date().toISOString().slice(0, 10),
            estado: 'Sembrado',
            vigencia: 'Activa',
            tarea: 'Siembra Directa',
            observaciones: `Actualizado desde el Mapa de Potreros (#${pNum}).`,
          });
        }
      }
    }
  }

  // Guardar edición directa desde el Panel Lateral Derecho con sincronización bidireccional hacia Siembras
    // Handlers para MODO REUBICACIÓN EXPLÍCITA de marcadores de infraestructura
  function handleStartMovingInfra(inf) {
    if (!inf || inf.latitud == null || inf.longitud == null) return;
    const lat = Number(inf.latitud);
    const lng = Number(inf.longitud);
    setMovingInfra({
      ...inf,
      originalLat: lat,
      originalLng: lng,
      currentLat: lat,
      currentLng: lng,
    });
    const map = mapInstanceRef.current;
    if (map) {
      map.setView([lat, lng], Math.max(map.getZoom(), 15));
    }
    notify(`Modo Reubicar Activo: Arrastrá "${inf.nombre}" a su nueva posición y tocá Confirmar.`, 'info');
  }

  function handleCancelMovingInfra() {
    if (!movingInfra) return;
    const marker = infraMarkersRef.current[movingInfra.id];
    if (marker && movingInfra.originalLat && movingInfra.originalLng) {
      marker.setLatLng([movingInfra.originalLat, movingInfra.originalLng]);
    }
    setMovingInfra(null);
    notify('Reubicación cancelada. Coordenadas previas restauradas.', 'info');
  }

  async function handleConfirmMovingInfra() {
    if (!movingInfra) return;
    const lat = movingInfra.currentLat;
    const lng = movingInfra.currentLng;
    if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) {
      notify('Coordenadas no válidas.', 'error');
      return;
    }

    setSavingMovingInfra(true);
    try {
      const isTranqueraOTranqueron = movingInfra.tipo === 'Tranquera' || movingInfra.tipo === 'Tranquerón';
      const potrerosConectados = detectarPotrerosConectados(lat, lng, potreros, 20);
      const numsList = potrerosConectados.map((x) => x.numero);

      let updatedNombre = movingInfra.nombre;
      let newPotNum = movingInfra.potrero_numero;

      if (isTranqueraOTranqueron) {
        if (numsList.length >= 2) {
          newPotNum = numsList[0];
          if (/^(Tranquera|Tranquer[oó]n)/i.test(movingInfra.nombre) || !movingInfra.nombre) {
            updatedNombre = `${movingInfra.tipo} P${numsList[0]} ↔ P${numsList[1]}`;
          }
        } else if (numsList.length === 1) {
          newPotNum = numsList[0];
          if (/^(Tranquera|Tranquer[oó]n)/i.test(movingInfra.nombre) || !movingInfra.nombre) {
            updatedNombre = `${movingInfra.tipo} P${numsList[0]}`;
          }
        }
      } else if (numsList.length > 0) {
        newPotNum = numsList[0];
      }

      const conectaTag = numsList.length >= 2 ? `[potreros:${numsList.join(',')}] [conecta:P${numsList[0]}↔P${numsList[1]}]` : numsList.length === 1 ? `[potreros:${numsList[0]}]` : '';
      const cleanObs = (movingInfra.observaciones || '')
        .replace(/\[?(?:icono|estilo|estilo_marcador)[:=]\s*[^\]]+\]?/gi, '')
        .replace(/\[potreros:[^\]]+\]/gi, '')
        .replace(/\[conecta:[^\]]+\]/gi, '')
        .trim();
      const finalObs = cleanObs ? (conectaTag ? `${cleanObs} ${conectaTag}` : cleanObs) : (conectaTag || null);

      const updateData = {
        latitud: lat,
        longitud: lng,
        nombre: updatedNombre,
        potrero_numero: newPotNum,
        observaciones: finalObs,
      };

      const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
      if (isSandbox) {
        const updated = infraestructura.map((x) =>
          x.id === movingInfra.id ? { ...x, ...updateData } : x
        );
        setInfraestructura && setInfraestructura(updated);
        try {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          const d = raw ? JSON.parse(raw) : {};
          d.infraestructura = updated;
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(d));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'infraestructura' } }));
        } catch (err) {}
      } else {
        const { error } = await supabase
          .from('infraestructura')
          .update(updateData)
          .eq('id', movingInfra.id);
        if (error) throw error;
      }

      setInfraestructura && setInfraestructura((prev) =>
        prev.map((x) => (x.id === movingInfra.id ? { ...x, ...updateData } : x))
      );

      const labelConecta = numsList.length >= 2 ? ` (conecta P${numsList[0]} ↔ P${numsList[1]})` : '';
      notify(`¡Ubicación de "${updatedNombre}" confirmada y guardada${labelConecta}!`, 'success');
      setMovingInfra(null);
      onRefresh && onRefresh();
    } catch (err) {
      notify(`Error al guardar reubicación: ${err.message}`, 'error');
    } finally {
      setSavingMovingInfra(false);
    }
  }

  // Handlers para edición interactiva de vértices de polígonos de potreros
  function handleStartEditVertices(p) {
    if (!p) return;
    const pIdx = potreros.findIndex((x) => x.id === p.id || x.numero === p.numero);
    const verts = getPotreroVertices(p, pIdx >= 0 ? pIdx : 0);
    if (verts.length < 3) {
      notify('No se pudieron extraer suficientes coordenadas para editar los vértices de este potrero.', 'error');
      return;
    }
    setEditingPolygonPotreroId(p.id || p.numero);
    setEditingPolygonCoords(verts);
    setBackupPolygonCoords(JSON.parse(JSON.stringify(verts)));
    notify(`Modo edición de vértices activo para ${p.nombre || 'Potrero #' + p.numero}. Arrastrá los pines amarillos para calzar el alambrado.`, 'info');
  }

  function handleCancelEditVertices() {
    setEditingPolygonPotreroId(null);
    setEditingPolygonCoords(null);
    setBackupPolygonCoords(null);
    notify('Edición de vértices cancelada. Coordenadas restauradas.', 'info');
  }

  async function handleSavePolygonGeom() {
    if (!editingPolygonPotreroId || !editingPolygonCoords) return;
    const isValid =
      editingPolygonCoords.length >= 3 &&
      editingPolygonCoords.every(
        (pt) => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
      );
    if (!isValid) {
      notify('El polígono debe tener al menos 3 vértices válidos.', 'error');
      return;
    }

    setSavingPolygonGeom(true);
    try {
      const newGeoJson = verticesToGeoJson(editingPolygonCoords);
      const targetPotrero = potreros.find(
        (p) => p.id === editingPolygonPotreroId || p.numero === editingPolygonPotreroId
      );
      if (!targetPotrero) throw new Error('Potrero no encontrado');

      const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');

      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.potreros)) {
            const pIdx = sData.potreros.findIndex(
              (p) => p.id === targetPotrero.id || Number(p.numero) === Number(targetPotrero.numero)
            );
            if (pIdx >= 0) {
              sData.potreros[pIdx] = { ...sData.potreros[pIdx], geojson_polygon: newGeoJson };
              localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
              window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'potreros' } }));
            }
          }
        }
      } else {
        const { error } = await supabase
          .from('potreros')
          .update({ geojson_polygon: newGeoJson })
          .eq('id', targetPotrero.id);
        if (error) throw error;
      }

      // Actualización optimista inmediata en memoria
      setPotreros && setPotreros((prev) =>
        prev.map((p) =>
          p.id === targetPotrero.id || p.numero === targetPotrero.numero
            ? { ...p, geojson_polygon: newGeoJson }
            : p
        )
      );

      notify(`Geometría y alambrados de ${targetPotrero.nombre || 'Potrero #' + targetPotrero.numero} guardados con éxito.`, 'success');
      setEditingPolygonPotreroId(null);
      setEditingPolygonCoords(null);
      setBackupPolygonCoords(null);
    } catch (err) {
      notify(`Error al guardar geometría: ${err.message}`, 'error');
    } finally {
      setSavingPolygonGeom(false);
    }
  }

async function handleSaveSidePanel(e) {
    e.preventDefault();
    if (!selectedPotrero) return;
    setSavingId('side-panel');
    const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
    try {
      const molId = sideForm.molino_id ? parseInt(sideForm.molino_id, 10) : null;
      if (molId) await ensureMolinoExists(molId);

      const autoRecep = getReceptividadDefault(sideForm);
      const userRecep = parseFloat(sideForm.receptividad_ev_ha);
      const finalRecep = (!isNaN(userRecep) && userRecep > 0) ? userRecep : autoRecep;

      // Parseo robusto de superficie admitiendo punto o coma decimal (ej. "50,82" -> 50.82)
      const rawHa = String(sideForm.hectareas || '').trim().replace(',', '.');
      const cleanHa = parseFloat(rawHa);
      const finalHa = (!isNaN(cleanHa) && cleanHa > 0) ? cleanHa : selectedPotrero.hectareas;

      // Detección automática de nuevo número si el usuario renombró "Potrero 6", "Lote 6", etc.
      const matchNum = sideForm.nombre.trim().match(/^(?:potrero|lote|p)\s*#?\s*(\d+)/i);
      const newNum = matchNum ? parseInt(matchNum[1], 10) : null;

      const potreroPayload = {
        nombre: sideForm.nombre.trim() || `Potrero ${selectedPotrero.numero}`,
        hectareas: finalHa,
        ambiente: sideForm.ambiente || 'Bajo Dulce',
        molino_id: molId,
        cultivo_actual: sideForm.cultivo_actual.trim() || 'Campo Natural',
        recurso_forrajero: (sideForm.recurso_forrajero || sideForm.cultivo_actual || 'Campo Natural').trim(),
        receptividad_ev_ha: finalRecep,
        estado_semaforo: sideForm.estado_semaforo || 'Disponible',
        observaciones: sideForm.observaciones.trim() || null,
        ...(newNum && newNum !== selectedPotrero.numero ? { numero: newNum, codigo: `P${newNum}` } : {}),
      };

      // Actualización optimista inmediata en memoria de potreros para renderizado en vivo
      setPotreros && setPotreros((prev) =>
        prev.map((p) =>
          p.id === selectedPotrero.id || Number(p.numero) === Number(selectedPotrero.numero)
            ? { ...p, ...potreroPayload }
            : p
        )
      );

      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.potreros)) {
            const pIdx = sData.potreros.findIndex((p) => p.id === selectedPotrero.id || Number(p.numero) === Number(selectedPotrero.numero));
            if (pIdx >= 0) {
              sData.potreros[pIdx] = { ...sData.potreros[pIdx], ...potreroPayload };
              localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
              window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'potreros' } }));
            }
          }
        }
      } else {
        const { error } = await supabase
          .from('potreros')
          .update(potreroPayload)
          .eq('id', selectedPotrero.id);
        if (error) throw error;
      }

      // Sincronizar bidireccionalmente con la tabla labores_siembras
      await syncSiembraFromMapa(
        selectedPotrero.numero,
        sideForm.cultivo_actual || sideForm.recurso_forrajero,
        finalHa
      );

      notify(
        `Ficha de ${sideForm.nombre || `Potrero #${selectedPotrero.numero}`} actualizada y sincronizada con Siembras.`,
        'success'
      );
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar el potrero: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // Mover un Rodeo completo desde el Panel Lateral del Mapa (conectado a Planilla de Rodeos + movimientos_hacienda)
  async function handleConfirmMoveRodeo(e) {
    e.preventDefault();
    const rodeoObj = rodeos.find((r) => String(r.id) === String(selectedRodeoIdToMove));
    if (!rodeoObj) {
      notify('Seleccioná qué Rodeo querés trasladar.', 'error');
      return;
    }

    const destNum = moveTargetPotrero ? parseInt(moveTargetPotrero, 10) : null;
    if (!destNum) {
      notify('Seleccioná el Potrero de destino.', 'error');
      return;
    }

    setMovingHacienda(true);
    try {
      const origNum = rodeoObj.potrero_numero ?? null;
      const totalCab = calcRodeoHeads(rodeoObj);
      const fechaEfectiva = moveFecha || new Date().toISOString().slice(0, 10);
      const permAnt = calcPermanenciaPotrero(rodeoObj, fechaEfectiva);
      const textoPermAnt = origNum
        ? `Permaneció ${permAnt.dias} días en Potrero ${origNum === 2 ? '2/3' : origNum}. `
        : '';

      const { error: errUpd } = await supabase
        .from('rodeos')
        .update({
          potrero_numero: destNum,
          parcela_nombre: moveParcela.trim() || null,
          fecha_ingreso_potrero: destNum ? fechaEfectiva : null,
          fecha_actualizacion: fechaEfectiva,
        })
        .eq('id', rodeoObj.id);
      if (errUpd) throw errUpd;

      // Actualizar estado semáforo de los potreros involucrados
      await supabase
        .from('potreros')
        .update({ estado_semaforo: 'En pastoreo' })
        .eq('numero', destNum);

      if (origNum && origNum !== destNum) {
        const remaining = rodeos.filter(
          (r) => r.id !== rodeoObj.id && Number(r.potrero_numero) === Number(origNum)
        );
        if (remaining.length === 0) {
          await supabase
            .from('potreros')
            .update({ estado_semaforo: 'En descanso' })
            .eq('numero', origNum);
        }
      }

      // Guardar en historial movimientos_hacienda con días de permanencia en potrero anterior
      const obsResto = [
        moveParcela.trim() ? `Parcela: ${moveParcela.trim()}` : null,
        moveObs.trim() || 'Rotación de potrero desde Mapa Vivo',
      ]
        .filter(Boolean)
        .join(' · ');
      const obsDetalle = `${textoPermAnt}${obsResto}`;

      await supabase.from('movimientos_hacienda').insert({
        fecha: fechaEfectiva,
        rodeo_id: rodeoObj.id,
        rodeo_nombre: rodeoObj.nombre,
        tipo_movimiento: 'Cambio de Potrero',
        potrero_origen: origNum,
        potrero_destino: destNum,
        categoria_afectada: 'Rodeo Completo',
        cantidad_cabezas: totalCab,
        motivo_observaciones: obsDetalle,
      });

      notify(
        `¡Rodeo "${rodeoObj.nombre}" (${totalCab} cab.) trasladado al Potrero #${destNum}!`,
        'success'
      );
      setShowMoveRodeoBox(false);
      setMoveObs('');
      setMoveParcela('');
      await onRefresh();
    } catch (err) {
      notify(`Error al mover rodeo: ${err.message}`, 'error');
    } finally {
      setMovingHacienda(false);
    }
  }

  async function handleSavePotreroRow(id, rowOverride = null, silent = true) {
    const row = rowOverride || editedPotreros[id] || pendingPotrerosRef.current[id];
    if (!row) return;
    setSavingId(`pot-${id}`);
    setAutoSaveStatus('saving');
    try {
      const molId = row.molino_id ? parseInt(row.molino_id, 10) : null;
      if (molId) await ensureMolinoExists(molId);

      const isSandbox = isSandboxMode || (typeof window !== 'undefined' && localStorage.getItem('san_jose_sandbox_mode') === 'true');
      const potPayload = {
        numero: parseInt(row.numero, 10),
        nombre: row.nombre,
        hectareas: parseFloat(row.hectareas) || 0,
        ambiente: row.ambiente,
        molino_id: molId,
        cultivo_actual: row.cultivo_actual || null,
        recurso_forrajero: row.cultivo_actual || null,
        fecha_siembra: row.fecha_siembra || null,
        estado_semaforo: row.estado_semaforo || 'Disponible',
        observaciones: row.observaciones || null,
      };

      if (isSandbox) {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.potreros)) {
            const pIdx = sData.potreros.findIndex((p) => p.id === id || Number(p.numero) === Number(row.numero));
            if (pIdx >= 0) {
              sData.potreros[pIdx] = { ...sData.potreros[pIdx], ...potPayload };
              localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
              window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'potreros' } }));
            }
          }
        }
      } else {
        const { error } = await supabase
          .from('potreros')
          .update(potPayload)
          .eq('id', id);
        if (error) throw error;
      }

      if (row.cultivo_actual) {
        await syncSiembraFromMapa(row.numero, row.cultivo_actual, row.hectareas);
      }

      delete pendingPotrerosRef.current[id];
      setAutoSaveStatus('saved');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2000);
      if (!silent) {
        notify(`Potrero #${row.numero} actualizado y sincronizado con Siembras.`, 'success');
      }
      await onRefresh();
    } catch (err) {
      console.error('Error al guardar potrero:', err);
      setAutoSaveStatus('error');
      notify(`Error actualizando potrero: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  const updatePotreroField = (id, field, val, immediate = false) => {
    let nextRow = null;
    setEditedPotreros((prev) => {
      const curr = prev[id] || potreros.find((p) => p.id === id) || {};
      nextRow = { ...curr, [field]: val };
      pendingPotrerosRef.current[id] = nextRow;
      return { ...prev, [id]: nextRow };
    });

    if (immediate) {
      if (debouncePotreroTimersRef.current[id]) {
        clearTimeout(debouncePotreroTimersRef.current[id]);
        delete debouncePotreroTimersRef.current[id];
      }
      handleSavePotreroRow(id, nextRow, true);
    } else {
      if (debouncePotreroTimersRef.current[id]) {
        clearTimeout(debouncePotreroTimersRef.current[id]);
      }
      debouncePotreroTimersRef.current[id] = setTimeout(() => {
        delete debouncePotreroTimersRef.current[id];
        const rowToSave = pendingPotrerosRef.current[id];
        if (rowToSave) {
          handleSavePotreroRow(id, rowToSave, true);
        }
      }, 700);
    }
  };

  const handlePotreroBlur = (id) => {
    if (debouncePotreroTimersRef.current[id]) {
      clearTimeout(debouncePotreroTimersRef.current[id]);
      delete debouncePotreroTimersRef.current[id];
      const rowToSave = pendingPotrerosRef.current[id];
      if (rowToSave) {
        handleSavePotreroRow(id, rowToSave, true);
      }
    }
  };

  async function handleGeoFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsedItems = parseGeoFileContent(file.name, text);
      if (!parsedItems.length) {
        notify('No se encontraron polígonos válidos en el archivo seleccionado.', 'error');
        return;
      }
      setGeoPreview({
        fileName: file.name,
        items: parsedItems,
      });
      notify(
        `Se leyeron ${parsedItems.length} polígonos de "${file.name}". Revisá la vista previa para guardar.`,
        'success'
      );
    } catch (err) {
      notify(`Error leyendo archivo GIS (${file.name}): ${err.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  }

  const totalHaCargadas = useMemo(
    () => potreros.reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0),
    [potreros]
  );

  const alertasActivasCount = useMemo(
    () => alertasMapa.filter((a) => !a.resuelta).length,
    [alertasMapa]
  );

  const infraFiltrada = useMemo(() => {
    if (filterTipoInfra === 'TODOS') return infraestructura;
    return infraestructura.filter((i) => i.tipo === filterTipoInfra);
  }, [infraestructura, filterTipoInfra]);

  const selectedHa = Number(selectedPotrero?.hectareas) || 0;
  const selectedCabezas = selectedPotrero ? cabezasPorPotrero[selectedPotrero.numero] || 0 : 0;
  const selectedCarga =
    selectedHa > 0 ? Number((selectedCabezas / selectedHa).toFixed(2)) : 0;
  const selectedRecep = selectedPotrero ? getReceptividadEfectiva(selectedPotrero) : 0.85;
  const tieneSiembraActivaSelected = Boolean(
    selectedPotrero &&
    siembrasActivasMap[Number(selectedPotrero.numero)] &&
    esSiembraActiva(siembrasActivasMap[Number(selectedPotrero.numero)])
  );
  const estadoPotreroEfectivo =
    sideForm.estado_semaforo === 'En siembra' && !tieneSiembraActivaSelected
      ? selectedCabezas > 0
        ? 'En pastoreo'
        : 'Disponible'
      : sideForm.estado_semaforo;
  const selectedSem = getSemaforoColor(estadoPotreroEfectivo, selectedCarga, selectedCabezas, selectedRecep);

  const renderMapOverlays = () => (
    <>
      {/* BANNER FLOTANTE DE REUBICACIÓN EXPLÍCITA DE MARCADOR */}
      {movingInfra && (
        <div className={`absolute ${isExpanded ? 'top-16 left-3 right-3 sm:left-4 sm:right-auto' : 'top-3 left-3 right-3 sm:right-auto'} z-[500] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl border-2 border-amber-400 shadow-2xl p-2.5 sm:p-3 flex flex-wrap items-center gap-2.5 max-w-2xl animate-in fade-in duration-150`}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-amber-400 text-slate-950 font-black shrink-0 animate-bounce">
              <Move className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-sm text-white">
                  Reubicando {movingInfra.tipo}: <strong className="text-amber-300">{movingInfra.nombre}</strong>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                  Arrastre activo
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Arrastrá el pin resaltado en la foto satelital a su nueva posición y tocá confirmar.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto shrink-0 pt-1 sm:pt-0">
            <button
              type="button"
              disabled={savingMovingInfra}
              onClick={handleConfirmMovingInfra}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-95"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
              <span>{savingMovingInfra ? 'Guardando...' : '✓ Confirmar ubicación'}</span>
            </button>
            <button
              type="button"
              disabled={savingMovingInfra}
              onClick={handleCancelMovingInfra}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 transition cursor-pointer whitespace-nowrap active:scale-95"
            >
              ✕ Cancelar
            </button>
          </div>
        </div>
      )}

      {/* BANNER FLOTANTE DE AJUSTE DE VÉRTICES DE POTREROS */}
      {editingPolygonPotreroId && (
        <div className={`absolute ${isExpanded ? 'top-16 left-3 right-3 sm:left-4 sm:right-auto' : 'top-3 left-3 right-3 sm:right-auto'} z-[500] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl border border-amber-500/50 shadow-2xl p-2.5 sm:p-3 flex flex-wrap items-center gap-2.5 max-w-2xl animate-in fade-in duration-150`}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm text-white">
                  Ajustando Vértices de {potreros.find((p) => p.id === editingPolygonPotreroId || p.numero === editingPolygonPotreroId)?.nombre || `Potrero #${editingPolygonPotreroId}`}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                  {editingPolygonCoords?.length || 0} vértices
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Arrastrá los pines amarillos para calzar los alambrados o tocá '+' para añadir vértices
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto shrink-0 pt-1 sm:pt-0">
            <button
              type="button"
              disabled={savingPolygonGeom}
              onClick={handleSavePolygonGeom}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
              <span>{savingPolygonGeom ? 'Guardando...' : '✓ Guardar Geometría'}</span>
            </button>
            <button
              type="button"
              disabled={savingPolygonGeom}
              onClick={handleCancelEditVertices}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 transition cursor-pointer whitespace-nowrap"
            >
              ✕ Cancelar
            </button>
          </div>
        </div>
      )}

      {/* BARRA SUPERIOR FLOTANTE DE EDICIÓN DE TRAZA POR PINES */}
            {editingCamino && (
              <div className={`absolute ${isExpanded ? 'top-16 left-3 right-3 sm:left-4 sm:right-auto' : 'top-3 left-3 right-3 sm:right-auto'} z-[500] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl border border-sky-500/50 shadow-2xl p-2.5 sm:p-3 flex flex-wrap items-center gap-2.5 max-w-2xl animate-in fade-in duration-150`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 shrink-0">
                    <Route className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="text"
                        value={editingCamino.nombre}
                        onChange={(e) =>
                          setEditingCamino({ ...editingCamino, nombre: e.target.value })
                        }
                        className="bg-slate-800 text-white font-extrabold text-xs px-2.5 py-1 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 w-36 sm:w-48"
                        placeholder="Nombre de la traza"
                      />
                      <select
                        value={editingCamino.tipo_traza || 'Camino Interno'}
                        onChange={(e) =>
                          setEditingCamino({ ...editingCamino, tipo_traza: e.target.value })
                        }
                        className="bg-slate-800 text-sky-300 font-bold text-[11px] px-2 py-1 rounded-lg border border-slate-700 focus:outline-none"
                      >
                        <option value="Camino Interno">Camino Interno</option>
                        <option value="Camino Principal">Camino Principal</option>
                        <option value="Parcela Eléctrica / Boyero">Parcela Eléctrica</option>
                        <option value="Alambrado Eléctrico">Alambrado Eléctrico</option>
                        <option value="Picada Cortafuego">Picada Cortafuego</option>
                      </select>
                      <select
                        value={editingCamino.estado_camino || editingCamino.estado || 'Transitable'}
                        onChange={(e) =>
                          setEditingCamino({
                            ...editingCamino,
                            estado: e.target.value,
                            estado_camino: e.target.value,
                          })
                        }
                        className="bg-slate-800 text-amber-300 font-bold text-[11px] px-2 py-1 rounded-lg border border-slate-700 focus:outline-none"
                      >
                        {ESTADOS_CAMINO.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-[10px] text-slate-300 mt-1 flex items-center gap-2">
                      <span className="font-mono font-bold text-white">
                        {editingCamino.coordenadas_json?.length || 0} puntos
                      </span>
                      <span>·</span>
                      <span className="text-emerald-400 font-bold">{editingCaminoDistanceKm} km</span>
                      <span className="hidden sm:inline text-slate-400">
                        (Arrastrá los pines o tocá '+' para sumar)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-auto shrink-0 pt-1 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => setShowCaminoDetailsModal(true)}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition cursor-pointer"
                    title="Ver observaciones y sentido de traza"
                  >
                    ⚙️
                  </button>
                  <button
                    type="button"
                    disabled={savingEditingCamino}
                    onClick={handleSaveEditedCamino}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    <span>{savingEditingCamino ? 'Guardando...' : 'Guardar traza'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingEditingCamino}
                    onClick={() => setEditingCamino(null)}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 transition cursor-pointer whitespace-nowrap"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* BANNER FLOTANTE DE RUTA DE CUADRILLA / RECORRIDA ACTIVA */}
            {activeCuadrillaRoute && (
              <div
                className={`absolute ${
                  isExpanded
                    ? 'top-16 left-3 right-3 sm:left-4 sm:right-auto'
                    : 'top-3 left-3 right-3 sm:right-auto'
                } z-[500] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl border ${
                  activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                    ? 'border-emerald-500/70'
                    : 'border-amber-500/60'
                } shadow-2xl p-2.5 sm:p-3 flex flex-wrap items-center gap-2.5 max-w-xl animate-in fade-in duration-150`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`p-2 rounded-xl shrink-0 border ${
                      activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA' ? (
                      <Compass className="w-4 h-4" />
                    ) : (
                      <Truck className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-black text-xs tracking-wide ${
                          activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                          ? 'Recorrida Ganadera Activa'
                          : 'Ruta de Cuadrilla Activa'}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                            ? 'bg-emerald-400/20 text-emerald-300'
                            : 'bg-amber-400/20 text-amber-300'
                        }`}
                      >
                        {activeCuadrillaRoute.paradas?.length || 0} Potreros
                      </span>
                      {activeCuadrillaRoute.distancia_total_km && (
                        <span className="text-[10px] text-slate-400 font-bold">
                          {activeCuadrillaRoute.distancia_total_km} km
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300 truncate">
                      ⏱️ {activeCuadrillaRoute.tiempo_total_estimado} · Salida: {activeCuadrillaRoute.inicio_recomendado || 'Casco'}
                      {activeCuadrillaRoute.total_cabezas_inspeccionar ? ` · ${activeCuadrillaRoute.total_cabezas_inspeccionar} cabezas` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenCuadrilla && onOpenCuadrilla(activeCuadrillaRoute, 'hoja')}
                    className={`px-3 py-1.5 rounded-xl font-extrabold text-xs flex items-center gap-1.5 shadow-sm transition active:scale-95 ${
                      activeCuadrillaRoute.tipo === 'RECORRIDA_GANADERA'
                        ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                        : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                    }`}
                    title="Ver hoja completa de recorrida y relevamiento in-situ"
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    <span>Ver Hoja</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onClearCuadrillaRoute && onClearCuadrillaRoute()}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                    title="Ocultar ruta del mapa"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* PANEL FLOTANTE DE CAPAS Y MODOS DE VISTA SOBRE EL MAPA (con scroll para no cortarse abajo) */}
            <div className={`absolute ${isExpanded ? 'top-16 right-4 bottom-4' : 'top-3 right-3 bottom-3'} z-[400] max-w-xs flex flex-col pointer-events-none`}>
              {!floatingPanelOpen ? (
                <button
                  type="button"
                  onClick={() => setFloatingPanelOpen(true)}
                  className="pointer-events-auto px-3.5 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 text-white text-xs font-extrabold border border-slate-700 shadow-lg flex items-center gap-2 self-end"
                >
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Capas y Vista
                </button>
              ) : (
                <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md text-white rounded-2xl border border-slate-700 shadow-2xl p-3.5 w-64 max-h-[calc(100%-12px)] flex flex-col overflow-hidden text-xs">
                  {/* Cabecera fija del panel */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 shrink-0">
                    <span className="font-extrabold text-emerald-300 flex items-center gap-1.5">
                      <Layers className="w-4 h-4" />
                      Capas y Modos de Mapa
                    </span>
                    <button
                      type="button"
                      onClick={() => setFloatingPanelOpen(false)}
                      className="text-slate-400 hover:text-white p-0.5 cursor-pointer transition"
                      title="Minimizar panel de capas"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Contenedor scrolleable interno con todas las capas */}
                  <div className="overflow-y-auto flex-1 pr-1 pb-4 pt-3 space-y-3 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
                    {/* Bloque 1: Pintura de Fondo de Potreros (selección única) */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        1. Pintura de Fondo (Potreros)
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {[
                          { id: 'contornos', label: '🔲 Solo Contornos' },
                          { id: 'semaforo', label: '🚦 Semáforo Carga' },
                          { id: 'pasturas', label: '🌱 Pasturas' },
                          { id: 'ambientes', label: '🏞️ Ambientes' },
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setMapViewMode(m.id)}
                            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold text-left transition border ${
                              mapViewMode === m.id
                                ? 'bg-emerald-600 text-white border-emerald-400'
                                : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Bloque 2: Capas Superpuestas Independientes con Filtro Jerárquico */}
                    <div className="space-y-2 pt-1.5 border-t border-slate-800">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        2. Capas Superpuestas
                      </div>

                      {/* Números de Potrero */}
                      <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/60 px-1.5 py-1 rounded-lg">
                        <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-200">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                          🏷️ Números de Potrero (P#)
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(layersVisible.potreros_numeros)}
                          onChange={() =>
                            setLayersVisible((prev) => ({
                              ...prev,
                              potreros_numeros: !prev.potreros_numeros,
                            }))
                          }
                          className="rounded border-slate-600 text-emerald-500 focus:ring-0"
                        />
                      </label>

                      {/* Etiqueta de Rodeos y Cabezas */}
                      <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/60 px-1.5 py-1 rounded-lg">
                        <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-200">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                          🐄 Rodeos y Cabezas
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(layersVisible.rodeos_labels)}
                          onChange={() =>
                            setLayersVisible((prev) => ({
                              ...prev,
                              rodeos_labels: !prev.rodeos_labels,
                            }))
                          }
                          className="rounded border-slate-600 text-emerald-500 focus:ring-0"
                        />
                      </label>

                      {/* Control Unificado: Mostrar nombres en marcadores */}
                      <label
                        className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/60 px-1.5 py-1.5 rounded-lg border border-slate-700/60 bg-slate-900/60 transition"
                        title="Activado (ON): Muestra cápsulas con texto explicativo en infraestructura y detalles en potreros. Desactivado (OFF): Muestra solo íconos compactos para máxima visibilidad."
                      >
                        <span className="flex items-center gap-2 text-[11px] font-bold text-sky-200">
                          <Tags className="w-3.5 h-3.5 text-sky-400" />
                          Mostrar nombres en marcadores
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(layersVisible.etiquetas_marcadores ?? true)}
                          onChange={() =>
                            setLayersVisible((prev) => ({
                              ...prev,
                              etiquetas_marcadores: !(prev.etiquetas_marcadores ?? true),
                            }))
                          }
                          className="rounded border-slate-600 text-sky-500 focus:ring-0 w-3.5 h-3.5"
                        />
                      </label>

                      {/* FILTRO JERÁRQUICO DESPLEGABLE DE INFRAESTRUCTURA CON TOGGLE MAESTRO */}
                      <div className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2">
                        <div className="w-full flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-emerald-300">
                          <button
                            type="button"
                            onClick={() => setInfraGroupOpen(!infraGroupOpen)}
                            className="flex items-center gap-1.5 hover:text-emerald-200"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            <span>Infraestructura ({infraestructura.length})</span>
                            <span className="text-[10px] text-slate-400 font-bold ml-1">
                              {infraGroupOpen ? '▼' : '▶'}
                            </span>
                          </button>

                          {/* Toggle Maestro Toda la Infraestructura */}
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[9px] font-bold text-slate-400 lowercase">
                              {isAnyInfraOn ? 'todas on' : 'todas off'}
                            </span>
                            <label
                              className="relative inline-flex items-center cursor-pointer"
                              title={
                                isAnyInfraOn
                                  ? 'Apagar toda la infraestructura con 1 clic (mapa limpio)'
                                  : 'Prender todas las categorías de infraestructura con 1 clic'
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isAnyInfraOn}
                                onChange={handleToggleAllInfra}
                                className="sr-only peer"
                              />
                              <div className="w-7 h-4 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                          </div>
                        </div>

                        {infraGroupOpen && (
                          <div className="space-y-2.5 pt-1 border-t border-slate-700/60">
                            {/* 1. Esenciales / Operativos */}
                            <div className="space-y-1">
                              <div className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                Esenciales (Activos)
                              </div>
                              {[
                                {
                                  key: 'molinos',
                                  label: `Molinos (${infraCounts.molinos})`,
                                  count: infraCounts.molinos,
                                  badge:
                                    infraCounts.molinosSolares > 0
                                      ? `☀️ ${infraCounts.molinosSolares}`
                                      : '',
                                  dot: 'bg-sky-500',
                                  checked: Boolean(layersVisible.molinos),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      molinos: !prev.molinos,
                                    })),
                                },
                                {
                                  key: 'tanques_bebidas',
                                  label: `Tanques y Bebidas (${infraCounts.tanquesBebidas})`,
                                  count: infraCounts.tanquesBebidas,
                                  dot: 'bg-cyan-400',
                                  checked: Boolean(layersVisible.tanques_bebidas),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      tanques_bebidas: !prev.tanques_bebidas,
                                    })),
                                },
                                {
                                  key: 'corrales_mangas',
                                  label: `Corrales y Mangas (${infraCounts.corrales})`,
                                  count: infraCounts.corrales,
                                  dot: 'bg-orange-500',
                                  checked: Boolean(layersVisible.corrales_mangas),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      corrales_mangas: !prev.corrales_mangas,
                                    })),
                                },
                                {
                                  key: 'tranqueras',
                                  label: `Tranqueras (${infraCounts.tranqueras})`,
                                  count: infraCounts.tranqueras,
                                  badge:
                                    infraCounts.tranquerones > 0
                                      ? `🚜 ${infraCounts.tranquerones} TQN`
                                      : '',
                                  dot: 'bg-slate-900',
                                  checked: Boolean(layersVisible.tranqueras),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      tranqueras: !prev.tranqueras,
                                    })),
                                },
                                {
                                  key: 'montes_sombra',
                                  label: `Montes / Sombra (${infraCounts.montesSombra})`,
                                  count: infraCounts.montesSombra,
                                  dot: 'bg-emerald-700',
                                  checked: Boolean(layersVisible.montes_sombra),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      montes_sombra: !prev.montes_sombra,
                                    })),
                                },
                              ]
                                .filter((item) => item.count > 0)
                                .map((item) => (
                                <label
                                  key={item.key}
                                  className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-700/50 px-1.5 py-0.5 rounded-lg"
                                >
                                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                                    <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                                    <span>{item.label}</span>
                                    {item.badge && (
                                      <span className="text-[9.5px] px-1 rounded bg-emerald-900/80 text-emerald-300 font-extrabold border border-emerald-600/40">
                                        {item.badge}
                                      </span>
                                    )}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={item.checked}
                                    onChange={item.onToggle}
                                    className="rounded border-slate-600 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                                  />
                                </label>
                              ))}
                            </div>

                            {/* 2. Edificaciones / Secundarios */}
                            <div className="space-y-1 pt-1.5 border-t border-slate-700/60">
                              <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                <Eye className="w-3 h-3 text-slate-400" />
                                Edificaciones / Secundarios
                              </div>
                              {[
                                {
                                  key: 'casco_edificaciones',
                                  label: `Casco, Casas y Galpones (${infraCounts.casco})`,
                                  count: infraCounts.casco,
                                  dot: 'bg-slate-400',
                                  checked: Boolean(layersVisible.casco_edificaciones),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      casco_edificaciones: !prev.casco_edificaciones,
                                    })),
                                },
                                {
                                  key: 'mangrullo',
                                  label: `Mangrullo / Bomba Casco (${infraCounts.mangrullo})`,
                                  count: infraCounts.mangrullo,
                                  dot: 'bg-teal-400',
                                  checked: Boolean(layersVisible.mangrullo),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      mangrullo: !prev.mangrullo,
                                    })),
                                },
                                {
                                  key: 'paneles_solares',
                                  label: `Paneles Solares (${infraCounts.panelesSolares})`,
                                  count: infraCounts.panelesSolares,
                                  dot: 'bg-yellow-400',
                                  checked: Boolean(layersVisible.paneles_solares),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      paneles_solares: !prev.paneles_solares,
                                    })),
                                },
                                {
                                  key: 'caminos',
                                  label: `Caminos Operativos (${caminosOperativos.length})`,
                                  count: caminosOperativos.length,
                                  dot: 'bg-slate-300',
                                  checked: Boolean(layersVisible.caminos),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      caminos: !prev.caminos,
                                    })),
                                },
                                {
                                  key: 'alambres_electricos',
                                  label: `Alambres Eléctricos / Parcelas (${alambresElectricos.length})`,
                                  count: alambresElectricos.length,
                                  dot: 'bg-amber-400',
                                  checked: Boolean(layersVisible.alambres_electricos),
                                  onToggle: () =>
                                    setLayersVisible((prev) => ({
                                      ...prev,
                                      alambres_electricos: !prev.alambres_electricos,
                                    })),
                                },
                              ]
                                .filter((item) => item.count > 0)
                                .map((item) => (
                                <label
                                  key={item.key}
                                  className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-700/50 px-1.5 py-0.5 rounded-lg"
                                >
                                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                                    <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                                    <span>{item.label}</span>
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={item.checked}
                                    onChange={item.onToggle}
                                    className="rounded border-slate-600 text-slate-400 focus:ring-0 w-3.5 h-3.5"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Post-its de Alerta */}
                      <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/60 px-1.5 py-1 rounded-lg">
                        <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-200">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                          📌 Post-its de Alerta ({alertasActivasCount})
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(layersVisible.alertas)}
                          onChange={() =>
                            setLayersVisible((prev) => ({
                              ...prev,
                              alertas: !prev.alertas,
                            }))
                          }
                          className="rounded border-slate-600 text-emerald-500 focus:ring-0"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

      {/* BANNER FLOTANTE: MODO MARCAR PUNTO ACTIVO (Tranquera, Tranquerón, Bebida, Monte) */}
      {quickMarkType && (
        <div
          className={`absolute ${
            isExpanded ? 'top-16 left-1/2 -translate-x-1/2' : 'top-3 left-1/2 -translate-x-1/2'
          } z-[550] bg-slate-900/95 backdrop-blur-md text-white border-2 border-emerald-400 rounded-2xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center gap-3 animate-fadeIn text-xs max-w-[95vw]`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-black text-emerald-300">
              Modo Colocación: Tocá sobre el satélite para colocar {quickMarkType === 'Monte / Sombra' ? 'el Monte' : `la ${quickMarkType}`}
            </span>
          </div>

          <div className="flex items-center gap-1 flex-wrap max-w-xl">
            {ICONOS_MAPA_CURADOS.map((item) => (
              <button
                key={item.emoji}
                type="button"
                onClick={() => setQuickMarkType(item.tipo)}
                title={item.label}
                className={`px-2 py-1 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1 ${
                  quickMarkType === item.tipo
                    ? 'bg-emerald-400 text-slate-950 shadow-sm ring-1 ring-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>{item.emoji}</span>
                <span className="hidden sm:inline text-[10px]">{item.label.split('/')[0].trim()}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setQuickMarkType(null)}
            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white font-bold transition ml-auto cursor-pointer"
          >
            Cancelar ✕
          </button>
        </div>
      )}

      {/* MODAL COMPACTO: CONFIRMAR Y GUARDAR NUEVO PUNTO EN EL MAPA */}
      {showNewPointModal && pendingPointCoords && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-3 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center justify-center font-bold text-xl shadow-xs">
                  {newPointForm.icono || getDefaultEmojiForTipo(newPointForm.tipo)}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Guardar {newPointForm.tipo}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    GPS: {pendingPointCoords.lat.toFixed(5)}, {pendingPointCoords.lng.toFixed(5)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowNewPointModal(false);
                  setPendingPointCoords(null);
                }}
                className="text-slate-400 hover:text-slate-700 p-1 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveNewPoint} className="space-y-3.5 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-black text-slate-700 uppercase tracking-wide">
                    Emoticón del Pin (12 Opciones) *
                  </label>
                  <span className="text-[10px] font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    {newPointForm.icono || getDefaultEmojiForTipo(newPointForm.tipo)} {newPointForm.tipo}
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1 p-1.5 bg-slate-50 rounded-2xl border border-slate-200">
                  {ICONOS_MAPA_CURADOS.map((ico) => {
                    const isSel = (newPointForm.icono || getDefaultEmojiForTipo(newPointForm.tipo)) === ico.emoji;
                    return (
                      <button
                        key={ico.emoji}
                        type="button"
                        onClick={() => {
                          const potLabel = newPointForm.potrero_numero ? `P${newPointForm.potrero_numero}` : '';
                          const isDefaultName = !newPointForm.nombre || ICONOS_MAPA_CURADOS.some((c) => newPointForm.nombre.startsWith(c.tipo));
                          setNewPointForm((prev) => ({
                            ...prev,
                            tipo: ico.tipo,
                            icono: ico.emoji,
                            nombre: isDefaultName ? `${ico.tipo} ${potLabel}`.trim() : prev.nombre,
                          }));
                        }}
                        title={ico.label}
                        className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition cursor-pointer ${
                          isSel
                            ? 'bg-emerald-700 text-white shadow-md ring-2 ring-emerald-500 scale-105 z-10'
                            : 'bg-white hover:bg-slate-200 text-slate-800 border border-slate-200/80'
                        }`}
                      >
                        <span className="text-base leading-none">{ico.emoji}</span>
                        <span className={`text-[8.5px] mt-0.5 truncate max-w-full font-bold ${isSel ? 'text-white' : 'text-slate-500'}`}>
                          {ico.label.split('/')[0].trim()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                {pendingPointCoords?.potrerosConectados?.length >= 2 && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-bold flex items-center gap-2 shadow-xs">
                  <span className="text-base">🚪</span>
                  <div>
                    <span className="font-extrabold text-emerald-900">Acceso Divisorio Auto-detectado:</span>
                    <span className="text-emerald-800 ml-1">
                      Conecta Potrero {pendingPointCoords.potrerosConectados.join(' ↔ Potrero ')}
                    </span>
                  </div>
                </div>
              )}

              <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wide mb-1">
                Nombre Corto / Identificación
              </label>
                <input
                  type="text"
                  placeholder="Ej: P2 - P3 / Bajada sur"
                  value={newPointForm.nombre}
                  onChange={(e) => setNewPointForm({ ...newPointForm, nombre: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wide mb-1">
                  Potrero Asociado
                </label>
                <select
                  value={newPointForm.potrero_numero}
                  onChange={(e) => setNewPointForm({ ...newPointForm, potrero_numero: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none cursor-pointer"
                >
                  <option value="">(Sin asignar o General)</option>
                  {potreros.map((p) => (
                    <option key={p.numero} value={p.numero}>
                      Potrero #{p.numero} — {p.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewPointModal(false);
                    setPendingPointCoords(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition cursor-pointer text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingId === 'new-point'}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black shadow-md transition cursor-pointer disabled:opacity-50 text-xs flex items-center justify-center gap-1.5"
                >
                  {savingId === 'new-point' ? 'Guardando...' : 'Guardar Punto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );

  const renderSidePanelContent = () => {
    if (!selectedPotrero) return null;
    return (
      <>
        {/* Cabecera del Panel Lateral */}
              <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3 sticky top-0 z-10">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-900 text-white text-xs font-extrabold shrink-0">
                      Lote #
                      {selectedPotrero.numero === 2
                        ? '2/3'
                        : selectedPotrero.numero === 38
                        ? 'NN'
                        : selectedPotrero.numero}
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900 truncate">
                      {selectedPotrero.nombre}
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-600">
                    <span className="shrink-0">
                      Superficie: <strong>{selectedHa} ha</strong>
                    </span>
                    <span>·</span>
                    <span className="shrink-0">
                      Carga: <strong>{selectedCabezas} cab.</strong> ({selectedCarga} cab/ha)
                    </span>
                    <span>·</span>
                    <span className="shrink-0">
                      Receptividad: <strong>{(Number(selectedPotrero.receptividad_ev_ha) > 0 && Number(selectedPotrero.receptividad_ev_ha) !== 0.90) ? selectedPotrero.receptividad_ev_ha : (sideForm.receptividad_ev_ha || getReceptividadDefault(selectedPotrero).toFixed(2))} EV/ha</strong>
                    </span>
                    <span>·</span>
                    <span className="font-semibold text-slate-700 shrink-0">
                      {selectedCabezas > 0 || estadoPotreroEfectivo === 'En pastoreo'
                        ? 'En pastoreo'
                        : `${selectedPotrero.dias_descanso ?? 45}d descanso`}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${selectedSem.badge}`}
                    >
                      {estadoPotreroEfectivo}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onCreateTareaFromItem({
                        titulo: `Tarea en ${selectedPotrero.nombre}`,
                        categoria: 'Alambrados',
                        potrero_numero: selectedPotrero.numero,
                        prioridad: 'Media',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 text-[11px] font-extrabold flex items-center gap-1 transition shrink-0 whitespace-nowrap shadow-xs"
                    title="Crear tarea vinculada a este potrero"
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    + Tarea
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPotreroNum(null);
                      setShowMoveRodeoBox(false);
                      setTimeout(() => mapInstanceRef.current?.invalidateSize(), 150);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 shrink-0"
                    title="Cerrar panel lateral"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-5">
                {/* Bloque 1: Rodeos en este Potrero + Botón Mover Rodeo */}
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Tags className="w-4 h-4 text-emerald-800" />
                      <span className="text-xs font-extrabold text-slate-900">
                        Rodeos en este Lote ({selectedCabezas} cab.)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextOpen = !showMoveRodeoBox;
                        setShowMoveRodeoBox(nextOpen);
                        if (nextOpen) {
                          setSelectedRodeoIdToMove((prev) => {
                            if (prev && rodeos.some((r) => String(r.id) === String(prev))) {
                              return prev;
                            }
                            const rods = rodeosPorPotrero[Number(selectedPotrero?.numero)] || [];
                            if (rods.length > 0) return String(rods[0].id);
                            if (rodeos.length > 0) return String(rodeos[0].id);
                            return '';
                          });
                          setMoveTargetPotrero((prev) => {
                            if (prev) return prev;
                            const rods = rodeosPorPotrero[Number(selectedPotrero?.numero)] || [];
                            if (rods.length === 0 && selectedPotrero) {
                              return String(selectedPotrero.numero);
                            }
                            return '';
                          });
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      {showMoveRodeoBox ? 'Cerrar Traslado' : 'Mover Rodeo'}
                    </button>
                  </div>

                  {rodeosEnPotreroSeleccionado.length > 0 ? (
                    <div className="space-y-2">
                      {rodeosEnPotreroSeleccionado.map((r) => {
                        const tot = calcRodeoHeads(r);
                        const partes = [];
                        if (r.vacas > 0) partes.push(`${r.vacas} Vacas`);
                        if (r.terneros > 0) {
                          const sexInfo =
                            (Number(r.terneros_machos) || 0) > 0 ||
                            (Number(r.terneros_hembras) || 0) > 0
                              ? ` (${r.terneros_machos || 0}M/${r.terneros_hembras || 0}H)`
                              : '';
                          partes.push(`${r.terneros} Terneros${sexInfo}`);
                        }
                        if (r.vaquillonas_reposicion > 0)
                          partes.push(`${r.vaquillonas_reposicion} Vaq. Rep.`);
                        if (r.toros_padres > 0) partes.push(`${r.toros_padres} Toros`);
                        if (r.toritos > 0) partes.push(`${r.toritos} Toritos`);
                        if (r.vacas_cut > 0) partes.push(`${r.vacas_cut} CUT`);

                        const perm = calcPermanenciaPotrero(r, fechaOperacion);
                        const permBadge =
                          perm.semaforo === 'ROJO'
                            ? 'bg-red-100 text-red-900 border-red-300'
                            : perm.semaforo === 'AMBAR'
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300';

                        return (
                          <div
                            key={r.id}
                            className="p-2.5 rounded-xl bg-white border border-emerald-200 flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="text-xs font-extrabold text-slate-900 flex flex-wrap items-center gap-1.5">
                                <span>🐄 {r.nombre}</span>
                                <span
                                  className={`px-2 py-0.5 rounded-md border text-[10px] font-extrabold inline-flex items-center gap-1 ${permBadge}`}
                                  title={`Ingresó: ${perm.fechaIngreso} · Meta: ${perm.meta} días`}
                                >
                                  <Clock className="w-2.5 h-2.5" />
                                  Lleva {perm.dias} días (meta {perm.meta}d)
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                {partes.join(' · ')}
                              </div>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-1.5">
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-900 text-white text-xs font-extrabold">
                                {tot} cab.
                              </span>
                              {onNavigate && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onNavigate('rodeos', {
                                      rodeoId: r.id,
                                      potreroNumero: selectedPotrero.numero,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer"
                                  title="Abrir rodeo en Rodeos y Caravanas"
                                >
                                  <span>Rodeos →</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-600 bg-white/80 rounded-lg p-2.5 border border-emerald-100">
                      Este potrero está libre en la Planilla de Rodeos. Usá{' '}
                      <strong>"Mover Rodeo"</strong> para trasladar un rodeo hacia este lote.
                    </div>
                  )}

                  {showMoveRodeoBox && (
                    <form
                      onSubmit={handleConfirmMoveRodeo}
                      className="p-3 rounded-xl bg-white border-2 border-emerald-600 space-y-3 shadow-sm"
                    >
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Seleccionar Rodeo a Mover *
                        </label>
                        <select
                          required
                          value={selectedRodeoIdToMove}
                          onChange={(e) => setSelectedRodeoIdToMove(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-bold"
                        >
                          <option value="">Elegir rodeo...</option>
                          {rodeos.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.nombre} ({calcRodeoHeads(r)} cab. · Actualmente en{' '}
                              {r.potrero_numero ? `P#${r.potrero_numero}` : 'Sin lote'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Potrero Destino *
                          </label>
                          <select
                            required
                            value={moveTargetPotrero}
                            onChange={(e) => setMoveTargetPotrero(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-semibold"
                          >
                            <option value="">Elegir destino...</option>
                            {potreros.map((p) => (
                              <option key={p.numero} value={p.numero}>
                                {p.nombre} ({p.hectareas} ha)
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Parcela Eléctrica (opc.)
                          </label>
                          <input
                            type="text"
                            placeholder="Ej: Parcela Norte"
                            value={moveParcela}
                            onChange={(e) => setMoveParcela(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Fecha del Cambio *
                          </label>
                          <input
                            type="date"
                            required
                            value={moveFecha}
                            onChange={(e) => setMoveFecha(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Observación
                          </label>
                          <input
                            type="text"
                            placeholder="Rotación pastoreo..."
                            value={moveObs}
                            onChange={(e) => setMoveObs(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={movingHacienda}
                        className="w-full py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {movingHacienda
                          ? 'Guardando traslado...'
                          : 'Confirmar Traslado de Rodeo'}
                      </button>
                    </form>
                  )}
                </div>

                {/* Bloque Siembra Activa / Pastura del Potrero */}
                {siembrasActivasEnPotrero.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-cyan-50/70 border border-cyan-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sprout className="w-4 h-4 text-cyan-800" />
                        <span className="text-xs font-extrabold text-slate-900">
                          Labor / Siembra Agrícola en Lote
                          {siembrasActivasEnPotrero.length > 1 ? ` (${siembrasActivasEnPotrero.length})` : ''}
                        </span>
                      </div>
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate('siembras', {
                              siembraId: siembrasActivasEnPotrero[0].id,
                              potreroNumero: selectedPotrero.numero,
                              action: 'edit',
                            })
                          }
                          className="px-2.5 py-1 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-[11px] font-bold inline-flex items-center gap-1 transition shadow-2xs cursor-pointer"
                        >
                          <span>Abrir en Siembras →</span>
                        </button>
                      )}
                    </div>
                    {siembrasActivasEnPotrero.map((sActiva) => (
                      <div
                        key={sActiva.id}
                        className="p-2.5 rounded-lg bg-white border border-cyan-100 flex items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <div className="font-extrabold text-slate-900">
                            {sActiva.cultivo_variedad}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Campaña {sActiva.campana || '2026/2027'} · {Number(sActiva.ha_sembradas || sActiva.hectareas || selectedHa).toFixed(1)} ha
                            {sActiva.fecha ? ` · ${sActiva.fecha}` : ''}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-100 text-cyan-800 border border-cyan-200 shrink-0">
                          {sActiva.estado || 'Activa'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bloque Historial de Siembras Archivadas */}
                {siembrasArchivadasEnPotrero.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowArchivedSiembras((prev) => !prev)}
                      className="w-full flex items-center justify-between text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">🗂️</span>
                        <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900">
                          Historial de Siembras Archivadas ({siembrasArchivadasEnPotrero.length})
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
                          showArchivedSiembras ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {showArchivedSiembras && (
                      <div className="space-y-2 pt-2 border-t border-slate-200/80 mt-1 animate-in fade-in duration-150">
                        {siembrasArchivadasEnPotrero.map((sArch) => (
                          <div
                            key={sArch.id}
                            className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <div className="font-bold text-slate-700">
                                {sArch.cultivo_variedad}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Campaña {sArch.campana || 'Anterior'} · {Number(sArch.ha_sembradas || sArch.hectareas || selectedHa).toFixed(1)} ha
                                {sArch.fecha ? ` · ${sArch.fecha}` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 text-slate-700 border border-slate-300">
                                Archivada
                              </span>
                              {onNavigate && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onNavigate('siembras', {
                                      siembraId: sArch.id,
                                      potreroNumero: selectedPotrero.numero,
                                      action: 'view',
                                    })
                                  }
                                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                                  title="Ver en Siembras"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Bloque 2: Infraestructura y Accesos vinculados a este potrero (interiores y alambrados) */}
                {infraEnPotreroSeleccionado.length > 0 && (
                  <div className="p-3 rounded-xl bg-sky-50/70 border border-sky-200 space-y-2">
                    <div className="text-[11px] font-extrabold uppercase tracking-wider text-sky-900 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span>🚪</span>
                        <span>Infraestructura y Accesos del Potrero</span>
                      </span>
                      <span className="text-[10px] text-sky-700 font-bold">
                        {infraEnPotreroSeleccionado.length} elementos
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {infraEnPotreroSeleccionado.map((inf) => {
                        const hasGps =
                          inf.latitud != null &&
                          inf.longitud != null &&
                          !Number.isNaN(Number(inf.latitud)) &&
                          !Number.isNaN(Number(inf.longitud));
                        return (
                          <div
                            key={inf.id}
                            className="p-2 rounded-lg bg-white border border-sky-100 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span className="font-bold text-slate-900 min-w-0 break-words">
                                  {formatInfraTitulo(inf)}
                                </span>
                                {hasGps ? (
                                  <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300 inline-flex items-center gap-0.5 whitespace-nowrap shrink-0">
                                    <MapPin className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                    En mapa
                                  </span>
                                ) : (
                                  <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold border border-amber-300 inline-flex items-center gap-0.5 whitespace-nowrap shrink-0">
                                    <MapPin className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                                    Sin ubicar
                                  </span>
                                )}
                              </div>
                              {/* Conexión entre potreros detectada para Tranqueras / Tranquerones */}
                              {(() => {
                                const isTranquera = inf.tipo === 'Tranquera' || inf.tipo === 'Tranquerón';
                                const potrerosConectados = getPotrerosConectadosInfra(inf, potreros);
                                const otrosPotreros = potrerosConectados.filter((n) => Number(n) !== Number(selectedPotrero.numero));
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px]">
                                    <span className="text-slate-600 font-medium">
                                      Estado: <strong className="text-slate-900">{inf.estado || 'Operativo'}</strong>
                                    </span>
                                    {inf.solarizado && <span className="text-emerald-700 font-bold">· ☀️ Bomba Solar</span>}
                                    {isTranquera && otrosPotreros.length > 0 && (
                                      <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 font-extrabold border border-emerald-300 inline-flex items-center gap-1">
                                        <span>↔</span>
                                        <span>Conecta con P{otrosPotreros.join(', P')}</span>
                                      </span>
                                    )}
                                    {isTranquera && otrosPotreros.length === 0 && (
                                      <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-bold border border-slate-200">
                                        Acceso P{selectedPotrero.numero}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-auto sm:ml-0">
                              {hasGps ? (
                                <button
                                  type="button"
                                  onClick={() => handleVerEnMapa(inf)}
                                  className="px-2 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-900 text-[10px] font-extrabold inline-flex items-center gap-1 transition whitespace-nowrap shrink-0"
                                  title="Centrar en el mapa con halo pulsante"
                                >
                                  <Eye className="w-3 h-3 text-sky-700 shrink-0" />
                                  Ver
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleStartFijarPin(inf)}
                                  className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-extrabold inline-flex items-center gap-1 shadow-2xs transition whitespace-nowrap shrink-0"
                                  title="Fijar pin con 1 clic en el mapa satelital"
                                >
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  Ubicar
                                </button>
                              )}
                              {hasGps && (
                                <button
                                  type="button"
                                  onClick={() => handleStartMovingInfra(inf)}
                                  className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold inline-flex items-center gap-1 transition whitespace-nowrap shrink-0 cursor-pointer"
                                  title="Reubicar este pin arrastrándolo en el satélite"
                                >
                                  <Move className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                  Mover
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  onCreateTareaFromItem({
                                    titulo: `Revisar ${inf.tipo} ${inf.nombre}`,
                                    categoria: 'Aguadas',
                                    potrero_numero: selectedPotrero.numero,
                                    infraestructura_nombre: `${inf.nombre} (${inf.tipo})`,
                                    prioridad: 'Alta',
                                  })
                                }
                                className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold whitespace-nowrap shrink-0"
                              >
                                + Tarea
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Bloque 3: Edición Directa de los Datos del Potrero */}
                <form onSubmit={handleSaveSidePanel} className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                      Ficha Técnica Editable del Potrero
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingPolygonPotreroId === (selectedPotrero.id || selectedPotrero.numero)) {
                          handleCancelEditVertices();
                        } else {
                          handleStartEditVertices(selectedPotrero);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        editingPolygonPotreroId === (selectedPotrero.id || selectedPotrero.numero)
                          ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 border-amber-500 ring-2 ring-amber-400/50 animate-pulse'
                          : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                      }`}
                      title="Ajustar los vértices y alambrado del potrero según el satélite GPS"
                    >
                      <span>📐</span>
                      <span>
                        {editingPolygonPotreroId === (selectedPotrero.id || selectedPotrero.numero)
                          ? 'Cancelando ajuste...'
                          : 'Ajustar Vértices'}
                      </span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Nombre del Lote
                      </label>
                      <input
                        type="text"
                        value={sideForm.nombre}
                        onChange={(e) =>
                          setSideForm({ ...sideForm, nombre: e.target.value })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Superficie (ha)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="ej. 50,82 o 50.82"
                        value={sideForm.hectareas}
                        onChange={(e) =>
                          setSideForm({ ...sideForm, hectareas: e.target.value })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Ambiente
                      </label>
                      <select
                        value={sideForm.ambiente}
                        onChange={(e) =>
                          setSideForm({ ...sideForm, ambiente: e.target.value })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-semibold"
                      >
                        {AMBIENTES.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                        {sideForm.ambiente && !AMBIENTES.includes(sideForm.ambiente) && (
                          <option value={sideForm.ambiente}>{sideForm.ambiente}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Molino Asignado (M1–M11)
                      </label>
                      <select
                        value={sideForm.molino_id}
                        onChange={(e) =>
                          setSideForm({ ...sideForm, molino_id: e.target.value })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-semibold"
                      >
                        <option value="">Sin molino</option>
                        {molinos.map((m) => (
                          <option key={m.numero} value={m.numero}>
                            M{m.numero} — {m.nombre} ({m.estado})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Cultivo / Recurso Forrajero
                      </label>
                      <input
                        type="text"
                        placeholder="Campo Natural / Festuca..."
                        value={sideForm.recurso_forrajero || sideForm.cultivo_actual}
                        onChange={(e) =>
                          setSideForm({
                            ...sideForm,
                            recurso_forrajero: e.target.value,
                            cultivo_actual: e.target.value,
                          })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-slate-700">
                          Receptividad (EV/ha)
                        </label>
                        <span className="text-[10px] text-emerald-700 font-semibold" title="Receptividad sugerida de la Cuenca del Salado según el recurso">
                          Auto: {getReceptividadDefault(selectedPotrero || sideForm).toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="3.0"
                        placeholder={`Auto (${getReceptividadDefault(selectedPotrero || sideForm).toFixed(2)})`}
                        value={sideForm.receptividad_ev_ha}
                        onChange={(e) =>
                          setSideForm({ ...sideForm, receptividad_ev_ha: e.target.value })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Estado Semáforo
                      </label>
                      <select
                        value={sideForm.estado_semaforo}
                        onChange={(e) =>
                          setSideForm({ ...sideForm, estado_semaforo: e.target.value })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-bold"
                      >
                        {ESTADOS_SEMAFORO.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Descanso Acumulado
                      </label>
                      <div className="px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                        {selectedCabezas > 0 || sideForm.estado_semaforo === 'En pastoreo'
                          ? '0 d (En pastoreo)'
                          : `${selectedPotrero.dias_descanso ?? 45} días`}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Observaciones del Potrero (alambres, piso, aguada, pasto)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Anotá observaciones sobre estado del pasto, bebidas, eléctrico o piso..."
                      value={sideForm.observaciones}
                      onChange={(e) =>
                        setSideForm({ ...sideForm, observaciones: e.target.value })
                      }
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingId === 'side-panel'}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition"
                  >
                    <Save className="w-4 h-4" />
                    {savingId === 'side-panel'
                      ? 'Guardando cambios...'
                      : 'Guardar Ficha del Potrero'}
                  </button>
                </form>
              </div>
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Contenedor Principal del Mapa Vivo + Herramientas Operativas + Panel Lateral */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Cabecera Móvil Compacta Arriba del Mapa (< 768px) */}
        <div className="md:hidden px-3.5 py-2.5 bg-emerald-950 text-white flex items-center justify-between border-b border-emerald-900">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-extrabold text-xs truncate block">Mapa & Rodeos</span>
              <span className="text-[10px] text-emerald-300 font-medium">
                {potreros.length} lotes · {totalHaCargadas.toLocaleString('es-AR')} ha
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setMobileActionsOpen(!mobileActionsOpen)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-black border transition flex items-center gap-1 cursor-pointer ${
                mobileActionsOpen
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm'
                  : 'bg-emerald-900 hover:bg-emerald-800 text-emerald-100 border-emerald-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>⚡ Acciones de Mapa</span>
            </button>
            <button
              type="button"
              onClick={handleToggleExpand}
              className="p-1.5 rounded-xl bg-slate-900 border border-slate-700 text-emerald-400 hover:text-white transition cursor-pointer"
              title="Ampliar mapa a pantalla completa"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra Superior del Mapa (Escritorio >= 768px) */}
        <div className="hidden md:flex p-4 sm:p-5 border-b border-slate-200 flex-wrap items-center justify-between gap-4 bg-emerald-950 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                Mapa Operativo, Rodeos & Infraestructura
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  {potreros.length} Lotes · {totalHaCargadas.toLocaleString('es-AR')} ha
                </span>
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Zoom HD activo (Google Satellite Hybrid). Alterná entre{' '}
                <strong className="text-emerald-300">
                  Modo Rodeos, Carga Semáforo, Infraestructura Limpia y Pasturas
                </strong>
                .
              </p>
            </div>
          </div>

          {/* Botones de Herramientas Interactivas sobre el Mapa */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Botón 🎯 Vista General ajustado a los 34 potreros */}
            <button
              type="button"
              onClick={() => handleFitFieldBounds()}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-sm"
              title="Ajustar zoom al total de los 34 potreros del campo (Vista General)"
            >
              <Target className="w-4 h-4 text-emerald-400" />
              <span>🎯 Vista General</span>
            </button>

            {/* Modo Arrastre libre (Drag & Drop) de pines */}
            <button
              type="button"
              onClick={() => {
                const next = !dragMarkersEnabled;
                setDragMarkersEnabled(next);
                notify(
                  next
                    ? 'Modo Arrastre Activo: arrastrá los pines en el mapa para corregir su posición.'
                    : 'Modo Arrastre Desactivado.',
                  'info'
                );
              }}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border transition ${
                dragMarkersEnabled
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-md animate-pulse'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
              }`}
              title="Permite arrastrar y soltar marcadores en el mapa para corregir su GPS"
            >
              <Move className="w-4 h-4 text-amber-400" />
              {dragMarkersEnabled ? 'Arrastre Activo (Mover)' : 'Editar ubicaciones en mapa'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMapToolMode(mapToolMode === 'add_alerta' ? 'explore' : 'add_alerta');
                setClickedCoords(null);
              }}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border transition ${
                mapToolMode === 'add_alerta'
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-lg'
                  : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-slate-700'
              }`}
            >
              <StickyNote className="w-4 h-4" />
              + Post-it / Alerta
            </button>

            {/* Botón Discreto + Marcar Punto (Tranquera, Tranquerón, Bebida, Monte) */}
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => {
                  setShowQuickMarkMenu(!showQuickMarkMenu);
                  if (mapToolMode !== 'explore') setMapToolMode('explore');
                }}
                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 border transition cursor-pointer active:scale-95 ${
                  quickMarkType
                    ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-md ring-2 ring-emerald-400/40'
                    : 'bg-slate-900 hover:bg-slate-800 text-emerald-300 border-slate-700'
                }`}
                title="Colocar manualmente en el satélite: Tranquera, Tranquerón, Bebida o Monte"
              >
                <Plus className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{quickMarkType ? `Marcando: ${quickMarkType === 'Monte / Sombra' ? 'Monte' : quickMarkType}` : '+ Marcar Punto'}</span>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>

              {showQuickMarkMenu && (
                <div className="absolute left-0 mt-1.5 w-64 bg-slate-900/98 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl p-2.5 z-[600] space-y-2 text-xs animate-fadeIn">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider">
                      Elegir punto a colocar:
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">12 opciones</span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {ICONOS_MAPA_CURADOS.map((ico) => (
                      <button
                        key={ico.emoji}
                        type="button"
                        onClick={() => {
                          setQuickMarkType(ico.tipo);
                          setShowQuickMarkMenu(false);
                          notify(`Modo ${ico.label} (${ico.emoji}) activo: tocá en el satélite donde está ubicado.`, 'info');
                        }}
                        title={ico.label}
                        className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-emerald-950 hover:border-emerald-500 border border-slate-700 flex flex-col items-center justify-center text-center transition cursor-pointer active:scale-95 group"
                      >
                        <span className="text-base group-hover:scale-110 transition">{ico.emoji}</span>
                        <span className="text-[8.5px] font-bold text-slate-300 group-hover:text-white mt-0.5 truncate max-w-full">
                          {ico.label.split('/')[0].trim()}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setShowQuickMarkMenu(false);
                        setMapToolMode('add_infra');
                        setQuickMarkType(null);
                      }}
                      className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Formulario avanzado...</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQuickMarkMenu(false)}
                      className="text-slate-400 hover:text-white text-xs px-2 py-0.5"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setMapToolMode(mapToolMode === 'draw_camino' ? 'explore' : 'draw_camino');
                setDrawingPoints([]);
              }}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border transition ${
                mapToolMode === 'draw_camino'
                  ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-lg'
                  : 'bg-slate-900 hover:bg-slate-800 text-emerald-300 border-slate-700'
              }`}
            >
              <Route className="w-4 h-4" />
              + Trazar Camino / Eléctrico
            </button>

            <button
              type="button"
              onClick={() => onOpenCuadrilla && onOpenCuadrilla()}
              className="px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border border-amber-500/50 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition shadow-sm active:scale-95"
              title="Planificar día de cuadrilla y ruta óptima"
            >
              <Truck className="w-4 h-4 text-amber-400" />
              🛻 Armar Cuadrilla
            </button>

            {/* Toggle Rápido Etiquetas ON/OFF */}
            <button
              type="button"
              onClick={() =>
                setLayersVisible((prev) => ({
                  ...prev,
                  etiquetas_marcadores: !(prev.etiquetas_marcadores ?? true),
                }))
              }
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                Boolean(layersVisible.etiquetas_marcadores ?? true)
                  ? 'bg-sky-950/80 text-sky-200 border-sky-600/70 shadow-sm'
                  : 'bg-slate-900/90 text-slate-400 border-slate-700 hover:text-white'
              }`}
              title={
                Boolean(layersVisible.etiquetas_marcadores ?? true)
                  ? 'Nombres en marcadores activados (cápsula completa). Clic para compactar a solo íconos.'
                  : 'Nombres en marcadores desactivados (solo íconos compactos). Clic para mostrar nombres.'
              }
            >
              <Tags className={`w-3.5 h-3.5 ${Boolean(layersVisible.etiquetas_marcadores ?? true) ? 'text-sky-400' : 'text-slate-500'}`} />
              <span>{Boolean(layersVisible.etiquetas_marcadores ?? true) ? 'Nombres ON' : 'Nombres OFF'}</span>
            </button>

            {/* Selector de Mapa Base Satélite HD */}
            <div className="inline-flex rounded-xl bg-slate-900/90 p-1 border border-slate-700">
              <button
                type="button"
                onClick={() => setMapStyle('google_hybrid')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  mapStyle === 'google_hybrid'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Satélite HD
              </button>
              <button
                type="button"
                onClick={() => setMapStyle('esri_sat')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  mapStyle === 'esri_sat'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Esri
              </button>
              <button
                type="button"
                onClick={() => setMapStyle('osm')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  mapStyle === 'osm'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Mapa Claro
              </button>
            </div>

            {/* Botón de Ampliar Mapa / Pantalla Completa */}
            <button
              type="button"
              onClick={handleToggleExpand}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold border border-slate-700 shadow-sm flex items-center gap-1.5 transition shrink-0 whitespace-nowrap cursor-pointer"
              title={isExpanded ? 'Cerrar mapa ampliado (Esc)' : 'Ampliar mapa a pantalla completa'}
            >
              {isExpanded ? (
                <>
                  <X className="w-4 h-4 text-red-400" />
                  <span>✕ Cerrar mapa</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4 text-emerald-400" />
                  <span>Ampliar Mapa</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Barra Superior Limpia de Pintura de Fondo y Selector de Potreros (Escritorio >= 768px) */}
        <div className="hidden md:flex px-4 py-3 bg-slate-100 border-b border-slate-200 flex-wrap items-center justify-between gap-3 text-xs">
          {/* Bloque 1: Pintura de Fondo de Potreros (selección única) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-extrabold text-slate-700 mr-1 flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-800" />
              Pintura de Fondo:
            </span>

            {[
              {
                id: 'contornos',
                label: '🔲 Solo Contornos (Transparente)',
                desc: 'Bordes nítidos sin relleno para resaltar foto satelital e infraestructura',
              },
              {
                id: 'semaforo',
                label: '🚦 Semáforo de Carga (cab/ha)',
                desc: 'Colorea en alto contraste según estado y carga instantánea',
              },
              {
                id: 'pasturas',
                label: '🌱 Pasturas / Siembras',
                desc: 'Colorea según recurso forrajero implantado o campo natural',
              },
              {
                id: 'ambientes',
                label: '🏞️ Ambientes',
                desc: 'Colorea según Loma, Bajo Dulce, Bajo Salino o Bajo Anegable',
              },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.desc}
                onClick={() => setMapViewMode(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition ${
                  mapViewMode === m.id
                    ? 'bg-emerald-900 text-white border-emerald-950 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-emerald-50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedPotreroNum || ''}
              onChange={(e) => {
                setMapToolMode('explore');
                if (!e.target.value) {
                  setSelectedPotreroNum(null);
                  handleFitFieldBounds();
                } else {
                  setSelectedPotreroNum(Number(e.target.value));
                }
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800"
            >
              <option value="">Ir a potrero... (Vista General)</option>
              {potreros.map((p) => {
                const cab = cabezasPorPotrero[p.numero] || 0;
                return (
                  <option key={p.numero} value={p.numero}>
                    {p.nombre} ({p.hectareas} ha{cab > 0 ? ` · ${cab} cab.` : ''})
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Barra de Mini-Leyenda de Colores según Modo de Pintura Activo (Escritorio >= 768px) */}
        <div className="hidden md:flex px-4 py-2 bg-slate-900 text-white border-b border-slate-800 flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span>🎨 Leyenda:</span>
            </span>

            {mapViewMode === 'contornos' && (
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded border-2 border-cyan-400 bg-cyan-400/10 inline-block" />
                  <strong className="text-cyan-300">Solo Contornos:</strong>
                  <span className="text-slate-300">Relleno transparente al 5% con borde cian para inspección satelital nítida</span>
                </span>
              </div>
            )}

            {mapViewMode === 'semaforo' && (
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" />
                  <span className="text-emerald-300 font-bold">Óptima (≤ Receptividad EV/ha)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm" />
                  <span className="text-amber-300 font-bold">Media / Alta (Recep a +25%)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm" />
                  <span className="text-red-300 font-bold">Sobrecarga (&gt; +25%)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-400" />
                  <span className="text-slate-300 font-medium">Descanso (0 cab.)</span>
                </span>
              </div>
            )}

            {mapViewMode === 'pasturas' && (
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#84cc16] shadow-sm" />
                  <span className="text-lime-300 font-bold">Campo Natural (Verde Suave)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#f59e0b] shadow-sm" />
                  <span className="text-amber-300 font-bold">Maíz / Sorgo (Ámbar Dorado)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#059669] shadow-sm" />
                  <span className="text-emerald-300 font-bold">Festuca / Consociada (Esmeralda)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#06b6d4] shadow-sm" />
                  <span className="text-cyan-300 font-bold">Verdeo / Avena (Turquesa)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#8b5cf6] shadow-sm" />
                  <span className="text-purple-300 font-bold">Alfalfa (Violeta)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#ea580c] shadow-sm" />
                  <span className="text-orange-300 font-bold">Agropiro (Naranja)</span>
                </span>
              </div>
            )}

            {mapViewMode === 'ambientes' && (
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#06b6d4] shadow-sm" />
                  <span className="text-cyan-300 font-bold">Bajo Dulce / Natural</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#f59e0b] shadow-sm" />
                  <span className="text-amber-300 font-bold">Mixto Loma / Bajo</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#22c55e] shadow-sm" />
                  <span className="text-emerald-300 font-bold">Loma</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-[#f43f5e] shadow-sm" />
                  <span className="text-rose-300 font-bold">Bajo Salino / Anegable</span>
                </span>
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-400">
            <span>🏷️ Números (P#)</span>
            <span>•</span>
            <span>🐄 Rodeos activos</span>
            <span>•</span>
            <span>📌 Post-its ({alertasActivasCount})</span>
          </div>
        </div>

        {/* Banner interactivo: Fijar Pin en Mapa con 1 solo clic satelital */}
        {mapToolMode === 'pin_infra' && pinningInfra && (
          <div className="p-3.5 bg-amber-400 text-slate-950 border-b-2 border-amber-600 flex flex-wrap items-center justify-between gap-3 shadow-md animate-pulse">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-slate-950 text-amber-400 font-extrabold shadow-sm">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-slate-950">
                  📍 MODO FIJAR PIN EN EL MAPA ACTIVO
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  Hacé 1 solo clic sobre la foto satelital para ubicar{' '}
                  <span className="underline decoration-slate-950 font-black">
                    {pinningInfra.nombre}
                  </span>{' '}
                  ({pinningInfra.tipo})
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMapToolMode('explore');
                setPinningInfra(null);
                pinningInfraRef.current = null;
              }}
              className="px-3.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-900 text-white text-xs font-bold transition shadow-sm"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Formularios desplegables cuando hay una herramienta de Mapa activa */}
        {mapToolMode === 'add_alerta' && (
          <form
            onSubmit={handleSaveNewAlerta}
            className="p-4 bg-amber-50 border-b-2 border-amber-400 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-950">
                <StickyNote className="w-4 h-4 text-amber-700" />
                <span>
                  MODO POST-IT ACTIVO:{' '}
                  {clickedCoords
                    ? `Punto GPS capturado (${clickedCoords.lat}, ${clickedCoords.lng})`
                    : '👉 Hacé clic en cualquier lugar del mapa para clavar la nota de alerta'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMapToolMode('explore');
                  setClickedCoords(null);
                }}
                className="text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Tipo de Alerta *
                </label>
                <select
                  value={newAlerta.tipo}
                  onChange={(e) => setNewAlerta({ ...newAlerta, tipo: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-amber-300 bg-white text-xs font-bold"
                >
                  {TIPOS_ALERTA_MAPA.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Prioridad *
                </label>
                <select
                  value={newAlerta.prioridad}
                  onChange={(e) =>
                    setNewAlerta({ ...newAlerta, prioridad: e.target.value })
                  }
                  className="w-full px-2.5 py-2 rounded-lg border border-amber-300 bg-white text-xs font-bold"
                >
                  <option value="Alta">Alta (Urgente)</option>
                  <option value="Media">Media</option>
                  <option value="Baja">Baja</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Mensaje corto del Post-it *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Alambre cortado lado calle / Bebida sin agua"
                  value={newAlerta.titulo}
                  onChange={(e) => setNewAlerta({ ...newAlerta, titulo: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-white text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Potrero Asociado
                </label>
                <select
                  value={newAlerta.potrero_numero}
                  onChange={(e) =>
                    setNewAlerta({ ...newAlerta, potrero_numero: e.target.value })
                  }
                  className="w-full px-2.5 py-2 rounded-lg border border-amber-300 bg-white text-xs"
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
                <button
                  type="submit"
                  disabled={savingId === 'new-alerta' || !clickedCoords}
                  className="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold text-xs shadow-sm transition"
                >
                  📌 Clavar Post-it
                </button>
              </div>
            </div>
          </form>
        )}

        {mapToolMode === 'add_infra' && (
          <form
            onSubmit={handleSaveNewInfra}
            className="p-4 bg-sky-50 border-b-2 border-sky-400 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-sky-950">
                <Wrench className="w-4 h-4 text-sky-700" />
                <span>
                  UBICAR INFRAESTRUCTURA EN MAPA:{' '}
                  {clickedCoords
                    ? `Coordenadas listas (${clickedCoords.lat}, ${clickedCoords.lng})`
                    : '👉 Hacé clic en el punto exacto del mapa donde está el elemento'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMapToolMode('explore');
                  setClickedCoords(null);
                }}
                className="text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Categoría *
                </label>
                <select
                  value={newInfra.tipo}
                  onChange={(e) => setNewInfra({ ...newInfra, tipo: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-sky-300 bg-white text-xs font-bold"
                >
                  {TIPOS_INFRAESTRUCTURA.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Código Corto
                </label>
                <input
                  type="text"
                  placeholder="Ej: TA1, B4, TQ2"
                  value={newInfra.codigo}
                  onChange={(e) => setNewInfra({ ...newInfra, codigo: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-sky-300 bg-white text-xs font-bold"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Nombre / Identificación *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Tanque Australiano Lote 8 / Tranquera Casco"
                  value={newInfra.nombre}
                  onChange={(e) => setNewInfra({ ...newInfra, nombre: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-sky-300 bg-white text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Potrero Asociado
                </label>
                <select
                  value={newInfra.potrero_numero}
                  onChange={(e) =>
                    setNewInfra({ ...newInfra, potrero_numero: e.target.value })
                  }
                  className="w-full px-2.5 py-2 rounded-lg border border-sky-300 bg-white text-xs"
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
                  Estado *
                </label>
                <select
                  value={newInfra.estado}
                  onChange={(e) => setNewInfra({ ...newInfra, estado: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-sky-300 bg-white text-xs font-bold"
                >
                  {ESTADOS_INFRAESTRUCTURA.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Modo de Visualización en el Mapa
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewInfra({ ...newInfra, estilo_marcador: 'chip' })}
                    className={`p-2 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      (newInfra.estilo_marcador || 'chip') === 'chip'
                        ? 'bg-sky-50 border-sky-600 ring-2 ring-sky-500 font-bold'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-black text-xs text-slate-900">🏷️ Chip</div>
                    <div className="text-[9.5px] text-slate-500">Ícono + Texto</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewInfra({ ...newInfra, estilo_marcador: 'tarjeta' })}
                    className={`p-2 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      newInfra.estilo_marcador === 'tarjeta'
                        ? 'bg-sky-50 border-sky-600 ring-2 ring-sky-500 font-bold'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-black text-xs text-slate-900">📋 Tarjeta</div>
                    <div className="text-[9.5px] text-slate-500">2 Líneas</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewInfra({ ...newInfra, estilo_marcador: 'icono' })}
                    className={`p-2 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      newInfra.estilo_marcador === 'icono'
                        ? 'bg-sky-50 border-sky-600 ring-2 ring-sky-500 font-bold'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-black text-xs text-slate-900">🔘 Solo Ícono</div>
                    <div className="text-[9.5px] text-slate-500">Compacto</div>
                  </button>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={savingId === 'new-infra'}
                  className="w-full py-2 px-3 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-extrabold text-xs shadow-sm transition"
                >
                  Guardar en Mapa
                </button>
              </div>
            </div>

            {(newInfra.tipo === 'Corrales y Mangas' ||
              newInfra.tipo === 'Mangrullo / Bomba Casco' ||
              newInfra.tipo === 'Molino') && (
              <div className="pt-2 border-t border-sky-200 flex flex-wrap items-center gap-4">
                {(newInfra.tipo === 'Corrales y Mangas' ||
                  newInfra.tipo === 'Mangrullo / Bomba Casco') && (
                  <div className="flex-1 min-w-[240px]">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Detalle de Componentes (Manga, casilla, cargador, cepo, balanza, bomba)
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Manga, casilla de operar, cargador, cepo y balanza"
                      value={newInfra.componentes_detalle || ''}
                      onChange={(e) =>
                        setNewInfra({ ...newInfra, componentes_detalle: e.target.value })
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-sky-300 bg-white text-xs"
                    />
                  </div>
                )}
                {newInfra.tipo === 'Molino' && (
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-950 text-xs font-extrabold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(newInfra.solarizado)}
                      onChange={(e) =>
                        setNewInfra({ ...newInfra, solarizado: e.target.checked })
                      }
                      className="w-4 h-4 rounded text-emerald-700"
                    />
                    <span>☀️ Tiene Bomba Sumergible + Paneles Solares</span>
                  </label>
                )}
              </div>
            )}
          </form>
        )}

        {mapToolMode === 'draw_camino' && (
          <form
            onSubmit={handleSaveNewCamino}
            className="p-4 bg-emerald-50 border-b-2 border-emerald-500 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">
                <Route className="w-4 h-4 text-emerald-700" />
                <span>
                  TRAZAR CAMINO O PARCELA ELÉCTRICA: Hacé clic en varios puntos del mapa (
                  <strong>{drawingPoints.length} puntos</strong> marcados)
                </span>
              </div>
              <div className="flex items-center gap-3">
                {drawingPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDrawingPoints((prev) => prev.slice(0, -1))}
                    className="text-xs font-bold text-amber-800 hover:underline"
                  >
                    Deshacer último punto
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMapToolMode('explore');
                    setDrawingPoints([]);
                  }}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900"
                >
                  Cancelar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Nombre del Camino / Eléctrico *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Camino Principal al Bajo / Boyero Potrero 14"
                  value={newCamino.nombre}
                  onChange={(e) => setNewCamino({ ...newCamino, nombre: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-300 bg-white text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Tipo de Traza *
                </label>
                <select
                  value={newCamino.tipo_traza}
                  onChange={(e) =>
                    setNewCamino({ ...newCamino, tipo_traza: e.target.value })
                  }
                  className="w-full px-2.5 py-2 rounded-lg border border-emerald-300 bg-white text-xs font-bold"
                >
                  {TIPOS_TRAZA_CAMINO.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Estado Actual *
                </label>
                <select
                  value={newCamino.estado}
                  onChange={(e) => setNewCamino({ ...newCamino, estado: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-emerald-300 bg-white text-xs font-bold"
                >
                  {ESTADOS_CAMINO.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observaciones
                </label>
                <input
                  type="text"
                  placeholder="Alcantarilla / Huella..."
                  value={newCamino.observaciones}
                  onChange={(e) =>
                    setNewCamino({ ...newCamino, observaciones: e.target.value })
                  }
                  className="w-full px-2.5 py-2 rounded-lg border border-emerald-300 bg-white text-xs"
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={savingId === 'new-camino' || drawingPoints.length < 2}
                  className="w-full py-2 px-3 rounded-lg bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white font-extrabold text-xs shadow-sm transition"
                >
                  Guardar Traza ({drawingPoints.length} pts)
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Grilla: Mapa a la izquierda (con Panel Flotante de Capas) + Panel Lateral Derecho al hacer clic en un potrero */}
        <div
          ref={mapWrapperRef}
          className="relative overflow-hidden isolate z-0 grid grid-cols-1 lg:grid-cols-12 bg-white rounded-2xl shadow-sm border border-slate-200"
        >
          {isExpanded ? (
            <div className="lg:col-span-12 w-full h-[68vh] min-h-[420px] md:h-[680px] bg-slate-900 rounded-2xl flex flex-col items-center justify-center text-slate-400 gap-3 border border-slate-800 p-6 text-center shadow-inner">
              <Maximize2 className="w-10 h-10 text-emerald-400 animate-pulse" />
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-white">
                  Mapa en Pantalla Completa
                </h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  Estás visualizando el mapa en modo ampliado sin restricciones de interfaz. Podés presionar Esc o hacer clic abajo para restaurarlo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-600 transition flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Minimize2 className="w-4 h-4 text-emerald-400" />
                Restaurar vista normal (Esc)
              </button>
            </div>
          ) : (
            <>
              {/* Contenedor del Mapa Embebido */}
              <div
                className={`relative overflow-hidden ${
                  selectedPotrero
                    ? 'lg:col-span-7 xl:col-span-8'
                    : 'lg:col-span-12'
                }`}
              >
                <div
                  key="map-embedded"
                  ref={mapContainerRef}
                  className="w-full h-[68vh] min-h-[420px] md:h-[680px] bg-slate-900 overflow-hidden"
                />

                {renderMapOverlays()}
              </div>

              {/* Panel Lateral Derecho del Potrero Seleccionado en vista embebida */}
              {selectedPotrero && (
                <div className="lg:col-span-5 xl:col-span-4 border-t lg:border-t-0 lg:border-l border-slate-200 bg-white flex flex-col h-auto md:h-[680px] md:max-h-[680px] overflow-y-auto">
                  {renderSidePanelContent()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Panel Desplegable de Acciones de Mapa para Celular (debajo del mapa) */}
        {mobileActionsOpen && (
          <div className="md:hidden p-3.5 bg-slate-900 text-white border-t border-slate-800 space-y-3 animate-in fade-in duration-150">
            <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Acciones de Mapa
              </span>
              <button
                type="button"
                onClick={() => setMobileActionsOpen(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded-lg bg-slate-800 cursor-pointer"
              >
                Cerrar ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  handleFitFieldBounds();
                  setMobileActionsOpen(false);
                }}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                title="Ajustar zoom al total de los 34 potreros del campo (Vista General)"
              >
                <Target className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>🎯 Vista General</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !dragMarkersEnabled;
                  setDragMarkersEnabled(next);
                  notify(
                    next
                      ? 'Modo Arrastre Activo: arrastrá los pines en el mapa para moverlos.'
                      : 'Modo Arrastre Desactivado.',
                    'info'
                  );
                }}
                className={`p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                  dragMarkersEnabled
                    ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                <Move className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{dragMarkersEnabled ? 'Arrastre Activo' : 'Editar GPS'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMapToolMode(mapToolMode === 'add_alerta' ? 'explore' : 'add_alerta');
                  setClickedCoords(null);
                  setMobileActionsOpen(false);
                }}
                className={`p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                  mapToolMode === 'add_alerta'
                    ? 'bg-amber-400 text-slate-950 border-amber-300'
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                }`}
              >
                <StickyNote className="w-4 h-4 shrink-0" />
                <span>+ Post-it Alerta</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setQuickMarkType('Tranquera');
                  setMobileActionsOpen(false);
                  notify('Modo Marcar Punto activo: tocá en el satélite para colocar y elegir entre los 12 emoticones.', 'info');
                }}
                className="col-span-2 p-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 border transition cursor-pointer bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-500 shadow-sm"
              >
                <Plus className="w-4 h-4 text-emerald-300" />
                <span>+ Marcar Punto (12 Emoticones Curados)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMapToolMode(mapToolMode === 'draw_camino' ? 'explore' : 'draw_camino');
                  setDrawingPoints([]);
                  setMobileActionsOpen(false);
                }}
                className={`p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                  mapToolMode === 'draw_camino'
                    ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                    : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-700'
                }`}
              >
                <Route className="w-4 h-4 shrink-0" />
                <span>+ Trazar Camino</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (onOpenCuadrilla) onOpenCuadrilla();
                  setMobileActionsOpen(false);
                }}
                className="p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 border border-amber-500/50 bg-amber-500/20 text-amber-200 cursor-pointer"
              >
                <Truck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>🛻 Cuadrilla</span>
              </button>
            </div>

            {/* Selector de Mapa Base y Potrero en móvil */}
            <div className="pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-slate-800 p-0.5 border border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={() => setMapStyle('google_hybrid')}
                  className={`px-2 py-1 rounded-lg font-bold cursor-pointer ${
                    mapStyle === 'google_hybrid' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Satélite HD
                </button>
                <button
                  type="button"
                  onClick={() => setMapStyle('esri_sat')}
                  className={`px-2 py-1 rounded-lg font-bold cursor-pointer ${
                    mapStyle === 'esri_sat' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Esri
                </button>
                <button
                  type="button"
                  onClick={() => setMapStyle('osm')}
                  className={`px-2 py-1 rounded-lg font-bold cursor-pointer ${
                    mapStyle === 'osm' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Claro
                </button>
              </div>

              <select
                value={selectedPotreroNum || ''}
                onChange={(e) => {
                  setMapToolMode('explore');
                  if (!e.target.value) {
                    setSelectedPotreroNum(null);
                    handleFitFieldBounds();
                  } else {
                    setSelectedPotreroNum(Number(e.target.value));
                  }
                  setMobileActionsOpen(false);
                }}
                className="px-2 py-1 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white max-w-[145px] truncate"
              >
                <option value="">Ir a potrero...</option>
                {potreros.map((p) => (
                  <option key={p.numero} value={p.numero}>
                    P#{p.numero} · {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Barra Móvil Compacta de Pintura de Fondo */}
        <div className="md:hidden px-3 py-2 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
          {[
            { id: 'contornos', label: '🔲 Contornos' },
            { id: 'semaforo', label: '🚦 Semáforo' },
            { id: 'pasturas', label: '🌱 Pasturas' },
            { id: 'ambientes', label: '🏞️ Ambientes' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMapViewMode(m.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border shrink-0 transition cursor-pointer ${
                mapViewMode === m.id
                  ? 'bg-emerald-900 text-white border-emerald-950 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Leyenda Compacta en Móvil según Modo de Pintura Activo */}
        <div className="md:hidden px-3 py-2 bg-slate-900 text-white border-t border-slate-800 text-[11px] overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">🎨 Leyenda:</span>
            {mapViewMode === 'contornos' && (
              <span className="text-cyan-300 font-bold">🔲 Contornos transparentes al 5%</span>
            )}
            {mapViewMode === 'semaforo' && (
              <div className="flex items-center gap-2.5">
                <span className="text-emerald-300 font-bold flex items-center gap-1">● ≤ Recept. Óptima</span>
                <span className="text-amber-300 font-bold flex items-center gap-1">● +25% Media</span>
                <span className="text-red-300 font-bold flex items-center gap-1">● &gt; +25% Sobrecarga</span>
                <span className="text-slate-400 flex items-center gap-1">● Descanso</span>
              </div>
            )}
            {mapViewMode === 'pasturas' && (
              <div className="flex items-center gap-2.5">
                <span className="text-lime-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#84cc16] inline-block" /> Campo Natural
                </span>
                <span className="text-amber-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#f59e0b] inline-block" /> Maíz / Sorgo
                </span>
                <span className="text-emerald-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#059669] inline-block" /> Festuca / Consociada
                </span>
                <span className="text-cyan-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#06b6d4] inline-block" /> Verdeo / Avena
                </span>
                <span className="text-purple-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#8b5cf6] inline-block" /> Alfalfa
                </span>
                <span className="text-orange-400 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#ea580c] inline-block" /> Agropiro
                </span>
              </div>
            )}
            {mapViewMode === 'ambientes' && (
              <div className="flex items-center gap-2.5">
                <span className="text-cyan-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#06b6d4] inline-block" /> Bajo Dulce
                </span>
                <span className="text-amber-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#f59e0b] inline-block" /> Mixto
                </span>
                <span className="text-emerald-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#22c55e] inline-block" /> Loma
                </span>
                <span className="text-rose-300 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-[#f43f5e] inline-block" /> Salino / Anegable
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Portal Pantalla Completa a document.body */}
        {isExpanded &&
          createPortal(
            <div
              key="map-portal-fullscreen"
              className="fixed inset-0 z-[9999] w-screen h-screen bg-slate-950 flex flex-col overflow-hidden"
            >
              {/* BARRA SUPERIOR FLOTANTE INTEGRADA EN PANTALLA COMPLETA */}
              <div className="absolute top-3 left-3 right-3 z-[10000] flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
                {/* Herramientas a la izquierda */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 bg-slate-900/95 backdrop-blur-md p-1.5 sm:p-2 rounded-2xl border border-slate-700 shadow-2xl">
                  {/* Badge */}
                  <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-emerald-950 text-emerald-300 border border-emerald-800 text-[11px] font-black shrink-0">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    <span>San José · Satélite Full</span>
                  </div>

                  {/* Botón 🎯 Vista General */}
                  <button
                    type="button"
                    onClick={() => handleFitFieldBounds()}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-600 flex items-center gap-1 transition cursor-pointer active:scale-95"
                    title="Ajustar zoom al campo completo"
                  >
                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">🎯 General</span>
                  </button>

                  {/* Botón + Marcar Punto con menú de 12 opciones */}
                  <div className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => {
                        setShowQuickMarkMenu(!showQuickMarkMenu);
                        if (mapToolMode !== 'explore') setMapToolMode('explore');
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 border transition cursor-pointer active:scale-95 ${
                        quickMarkType
                          ? 'bg-emerald-400 text-slate-950 border-emerald-300 ring-2 ring-emerald-400/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-600'
                      }`}
                      title="Colocar marcador de infraestructura en el satélite"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{quickMarkType ? quickMarkType.split('/')[0].trim() : '+ Marcador'}</span>
                      <span className="text-[9px] text-slate-400">▾</span>
                    </button>
                    {showQuickMarkMenu && (
                      <div className="absolute left-0 mt-2 w-64 bg-slate-900/98 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl p-2.5 z-[10100] space-y-2 text-xs animate-fadeIn">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider">
                            Elegir punto a colocar:
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">12 opciones</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {ICONOS_MAPA_CURADOS.map((ico) => (
                            <button
                              key={ico.emoji}
                              type="button"
                              onClick={() => {
                                setQuickMarkType(ico.tipo);
                                setShowQuickMarkMenu(false);
                                notify(`Modo ${ico.label} (${ico.emoji}) activo: tocá en el satélite donde está ubicado.`, 'info');
                              }}
                              title={ico.label}
                              className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-emerald-950 hover:border-emerald-500 border border-slate-700 flex flex-col items-center justify-center text-center transition cursor-pointer"
                            >
                              <span className="text-base">{ico.emoji}</span>
                              <span className="text-[8.5px] font-bold text-slate-300 truncate max-w-full">
                                {ico.label.split('/')[0].trim()}
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => {
                              setShowQuickMarkMenu(false);
                              setMapToolMode('add_infra');
                              setQuickMarkType(null);
                            }}
                            className="px-2 py-1 rounded-lg text-slate-400 hover:text-white text-[11px] font-bold"
                          >
                            Formulario avanzado...
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowQuickMarkMenu(false)}
                            className="text-slate-400 hover:text-white text-xs px-2 py-0.5"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Botón + Post-it */}
                  <button
                    type="button"
                    onClick={() => {
                      setMapToolMode(mapToolMode === 'add_alerta' ? 'explore' : 'add_alerta');
                      setClickedCoords(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
                      mapToolMode === 'add_alerta'
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-600'
                    }`}
                    title="Agregar alerta o post-it en mapa"
                  >
                    <StickyNote className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">+ Alerta</span>
                  </button>

                  {/* Botón + Trazar Camino */}
                  <button
                    type="button"
                    onClick={() => {
                      setMapToolMode(mapToolMode === 'draw_camino' ? 'explore' : 'draw_camino');
                      setDrawingPoints([]);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
                      mapToolMode === 'draw_camino'
                        ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                        : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-600'
                    }`}
                    title="Trazar nuevo camino o boyero eléctrico"
                  >
                    <Route className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">+ Traza</span>
                  </button>

                  {/* Toggle Rápido Nombres ON/OFF en Pantalla Completa */}
                  <button
                    type="button"
                    onClick={() =>
                      setLayersVisible((prev) => ({
                        ...prev,
                        etiquetas_marcadores: !(prev.etiquetas_marcadores ?? true),
                      }))
                    }
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                      Boolean(layersVisible.etiquetas_marcadores ?? true)
                        ? 'bg-sky-950/80 text-sky-200 border-sky-600/70 shadow-sm'
                        : 'bg-slate-800 text-slate-400 border-slate-600 hover:text-white'
                    }`}
                    title={
                      Boolean(layersVisible.etiquetas_marcadores ?? true)
                        ? 'Nombres en marcadores activados (cápsula completa). Clic para compactar a solo íconos.'
                        : 'Nombres en marcadores desactivados (solo íconos compactos). Clic para mostrar nombres.'
                    }
                  >
                    <Tags className={`w-3.5 h-3.5 ${Boolean(layersVisible.etiquetas_marcadores ?? true) ? 'text-sky-400' : 'text-slate-500'}`} />
                    <span className="hidden sm:inline">{Boolean(layersVisible.etiquetas_marcadores ?? true) ? 'Nombres ON' : 'Nombres OFF'}</span>
                  </button>

                  {/* Selector de Satélite */}
                  <div className="inline-flex rounded-xl bg-slate-800 p-0.5 border border-slate-600 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setMapStyle('google_hybrid')}
                      className={`px-2 py-1 rounded-lg font-bold transition ${
                        mapStyle === 'google_hybrid' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      HD
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapStyle('esri_sat')}
                      className={`px-2 py-1 rounded-lg font-medium transition ${
                        mapStyle === 'esri_sat' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Esri
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapStyle('osm')}
                      className={`px-2 py-1 rounded-lg font-medium transition ${
                        mapStyle === 'osm' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Claro
                    </button>
                  </div>

                  {/* Botón Capas y Vista */}
                  <button
                    type="button"
                    onClick={() => setFloatingPanelOpen(!floatingPanelOpen)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
                      floatingPanelOpen
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
                    }`}
                    title="Abrir panel de capas y modos de vista"
                  >
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">Capas</span>
                  </button>

                  {/* Toggle Ficha del Potrero Seleccionado si hay uno activo */}
                  {selectedPotrero && (
                    <button
                      type="button"
                      onClick={() => setFullscreenDrawerOpen(!fullscreenDrawerOpen)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                        fullscreenDrawerOpen
                          ? 'bg-emerald-900 text-emerald-200 border-emerald-700 shadow-sm'
                          : 'bg-slate-800 text-slate-300 border-slate-600 hover:text-white'
                      }`}
                      title="Mostrar u ocultar la ficha técnica lateral"
                    >
                      <span>📋</span>
                      <span className="max-w-[110px] truncate">
                        {selectedPotrero.nombre || `P#${selectedPotrero.numero}`}
                      </span>
                      <span className="text-[10px] text-emerald-400">
                        {fullscreenDrawerOpen ? '▲' : '▼'}
                      </span>
                    </button>
                  )}
                </div>

                {/* Botón Salir Arriba a la derecha */}
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-900/95 hover:bg-red-950 text-white hover:text-red-300 text-xs font-black border-2 border-red-500/80 shadow-2xl flex items-center gap-1.5 transition cursor-pointer backdrop-blur-md active:scale-95 shrink-0"
                  title="Salir de pantalla completa (Esc)"
                >
                  <X className="w-4 h-4 text-red-400 shrink-0" />
                  <span>✕ Salir (Esc)</span>
                </button>
              </div>

              {/* Contenedor del mapa en pantalla completa */}
              <div className="relative w-full h-full flex-1 overflow-hidden">
                <div
                  key="map-fullscreen"
                  ref={mapContainerRef}
                  className="w-full h-full bg-slate-900"
                />

                {renderMapOverlays()}

                {/* Ficha lateral en modo ampliado como drawer flotante si hay potrero seleccionado y drawer está abierto */}
                {selectedPotrero && fullscreenDrawerOpen && (
                  <div className="absolute top-16 right-4 bottom-4 w-96 max-w-[92vw] z-[9999] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-y-auto animate-in slide-in-from-right duration-200">
                    {renderSidePanelContent()}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
      </div>

      {/* Pestañas Inferiores: 1. Potreros (34) | 2. Infraestructura | 3. Instalaciones & Edificaciones | 4. Post-its & Caminos */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('potreros')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap shrink-0 ${
                activeSubTab === 'potreros'
                  ? 'bg-emerald-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Potreros ({potreros.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('infraestructura');
                setInfraSubView('campo');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap shrink-0 ${
                activeSubTab === 'infraestructura' && infraSubView === 'campo'
                  ? 'bg-emerald-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Droplets className="w-4 h-4 text-sky-400" />
              <span>Infraestructura ({infraestructura.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('infraestructura');
                setInfraSubView('edificaciones');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap shrink-0 ${
                activeSubTab === 'infraestructura' && infraSubView === 'edificaciones'
                  ? 'bg-emerald-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Building2 className="w-4 h-4 text-amber-400" />
              <span>
                Instalaciones & Edificaciones (
                {
                  infraestructura.filter(
                    (i) =>
                      i.es_edificacion_casco ||
                      i.tipo === 'Edificación / Casco' ||
                      i.tipo === 'Corrales y Mangas' ||
                      i.tipo === 'Mangrullo / Bomba Casco'
                  ).length
                }
                )
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('alertas_caminos')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap shrink-0 ${
                activeSubTab === 'alertas_caminos'
                  ? 'bg-emerald-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <StickyNote className="w-4 h-4 text-amber-400" />
              <span>Post-its ({alertasActivasCount}) & Caminos ({caminos.length})</span>
            </button>
          </div>
        </div>

        {activeSubTab === 'potreros' && (() => {
          // Filtrado de potreros por buscador y por pills rápidas
          const filteredPotrerosList = potreros.filter((p) => {
            const edit = editedPotreros[p.id] || p;
            const rodeosLote = rodeosPorPotrero[p.numero] || [];
            const cabezas = cabezasPorPotrero[p.numero] || 0;
            const hasHacienda = rodeosLote.length > 0 || cabezas > 0;

            if (potFilterEstado === 'CON_HACIENDA' && !hasHacienda) return false;
            if (potFilterEstado === 'LIBRES' && hasHacienda) return false;

            if (potSearchTerm.trim()) {
              const q = potSearchTerm.toLowerCase().trim();
              const numStr = String(p.numero);
              const nom = (edit.nombre || '').toLowerCase();
              const rec = (edit.cultivo_actual || edit.recurso_forrajero || '').toLowerCase();
              const amb = (edit.ambiente || '').toLowerCase();
              const rodeosStr = rodeosLote.map((r) => r.nombre || '').join(' ').toLowerCase();
              const match =
                numStr.includes(q) ||
                nom.includes(q) ||
                rec.includes(q) ||
                amb.includes(q) ||
                rodeosStr.includes(q);
              if (!match) return false;
            }

            return true;
          });

          const countConHacienda = potreros.filter((p) => {
            const cab = cabezasPorPotrero[p.numero] || 0;
            const rLote = rodeosPorPotrero[p.numero] || [];
            return rLote.length > 0 || cab > 0;
          }).length;
          const countLibres = potreros.length - countConHacienda;

          return (
            <div className="p-4 sm:p-5 space-y-4">
              {/* Barra superior compacta con Buscador Instantáneo y Pills de Filtro Rápido */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 p-3 rounded-2xl border border-slate-200">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={potSearchTerm}
                    onChange={(e) => setPotSearchTerm(e.target.value)}
                    placeholder="Buscar por N°, nombre, rodeo o recurso..."
                    className="w-full pl-9 pr-8 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-transparent transition"
                  />
                  {potSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setPotSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Indicador de Auto-Guardado Intuitivo */}
                {autoSaveStatus === 'saving' && (
                  <span className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1.5 animate-pulse shrink-0">
                    <span className="w-2 h-2 rounded-full border-2 border-amber-600 border-t-transparent animate-spin shrink-0" />
                    Guardando...
                  </span>
                )}
                {autoSaveStatus === 'saved' && (
                  <span className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-emerald-50 text-emerald-900 border border-emerald-200 flex items-center gap-1.5 shrink-0 transition-all duration-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ✓ Todos los cambios guardados
                  </span>
                )}
                {autoSaveStatus === 'error' && (
                  <span className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-red-50 text-red-900 border border-red-200 flex items-center gap-1.5 shrink-0">
                    ✕ Error al auto-guardar
                  </span>
                )}

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
                    <Filter className="w-3 h-3" />
                    Filtrar:
                  </span>
                  <button
                    type="button"
                    onClick={() => setPotFilterEstado('TODOS')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                      potFilterEstado === 'TODOS'
                        ? 'bg-emerald-900 text-white border-emerald-900 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Todos ({potreros.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPotFilterEstado('CON_HACIENDA')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border flex items-center gap-1.5 ${
                      potFilterEstado === 'CON_HACIENDA'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                    Con Hacienda ({countConHacienda})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPotFilterEstado('LIBRES')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border flex items-center gap-1.5 ${
                      potFilterEstado === 'LIBRES'
                        ? 'bg-slate-800 text-white border-slate-800 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
                    Libres / En Descanso ({countLibres})
                  </button>
                </div>
              </div>

              {/* VISTA 1: TABLA EN DESKTOP (hidden md:block) CON COLUMNAS OPTIMIZADAS Y BOTÓN ABRIR PANEL VISIBLE */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 max-h-[560px] shadow-xs">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-extrabold text-[10px] border-b border-slate-200 sticky top-0 z-10 tracking-wider">
                    <tr>
                      <th className="py-3 px-3 w-14 text-center">N°</th>
                      <th className="py-3 px-3 min-w-[140px]">Nombre del Potrero</th>
                      <th className="py-3 px-3 w-24">Hectáreas</th>
                      <th className="py-3 px-3 min-w-[160px]">Rodeo Actual</th>
                      <th className="py-3 px-3 min-w-[130px]">Ambiente</th>
                      <th className="py-3 px-3 min-w-[100px]">Molino</th>
                      <th className="py-3 px-3 min-w-[140px]">Cultivo / Recurso</th>
                      <th className="py-3 px-3 min-w-[110px]">Cabezas / Carga</th>
                      <th className="py-3 px-3 min-w-[130px]">Semáforo</th>
                      <th className="py-3 px-3 text-right sticky right-0 bg-slate-100 z-10 min-w-[170px] shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.06)]">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredPotrerosList.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-400 font-medium">
                          No se encontraron potreros con los filtros actuales.
                        </td>
                      </tr>
                    ) : (
                      filteredPotrerosList.map((p) => {
                        const edit = editedPotreros[p.id] || p;
                        const cabezas = cabezasPorPotrero[p.numero] || 0;
                        const rodeosLote = rodeosPorPotrero[p.numero] || [];
                        const ha = Number(edit.hectareas) || 0;
                        const carga = ha > 0 ? Number((cabezas / ha).toFixed(2)) : 0;
                        const sem = getSemaforoColor(edit.estado_semaforo, carga, cabezas, getReceptividadEfectiva(edit));

                        // Estilo semántico refinado para el semáforo
                        const semEstado = (edit.estado_semaforo || '').toLowerCase();
                        let semClasses = 'bg-slate-100 text-slate-700 border-slate-300';
                        if (semEstado.includes('pastoreo') || semEstado.includes('ocupado')) {
                          semClasses = 'bg-red-50 text-red-900 border-red-300 font-black';
                        } else if (semEstado.includes('disponible') || semEstado.includes('óptima')) {
                          semClasses = 'bg-emerald-50 text-emerald-900 border-emerald-300 font-bold';
                        } else if (semEstado.includes('descanso')) {
                          semClasses = 'bg-amber-50 text-amber-900 border-amber-300 font-bold';
                        } else if (semEstado.includes('sobrecarg') || semEstado.includes('anegado')) {
                          semClasses = 'bg-red-100 text-red-900 border-red-400 font-black';
                        }

                        return (
                          <tr
                            key={p.id}
                            className={`hover:bg-slate-50/90 transition group ${
                              selectedPotreroNum === p.numero ? 'bg-emerald-50/70' : ''
                            }`}
                          >
                            {/* N° en badge circular/pill */}
                            <td className="p-2.5 text-center">
                              <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-full bg-slate-900 text-white font-mono font-black text-[11px] shadow-2xs">
                                #{p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero}
                              </span>
                            </td>

                            <td className="p-2.5">
                              <input
                                type="text"
                                value={edit.nombre ?? ''}
                                onChange={(e) => updatePotreroField(p.id, 'nombre', e.target.value, false)}
                                onBlur={() => handlePotreroBlur(p.id)}
                                className="w-full px-2 py-1 border border-slate-200 rounded-lg font-semibold text-slate-800 text-xs focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 bg-white"
                              />
                            </td>

                            <td className="p-2.5">
                              <div className="relative">
                                <input
                                  type="number"
                                  step="0.1"
                                  value={edit.hectareas ?? ''}
                                  onChange={(e) => updatePotreroField(p.id, 'hectareas', e.target.value, false)}
                                  onBlur={() => handlePotreroBlur(p.id)}
                                  className="w-20 px-2 py-1 pr-6 border border-slate-200 rounded-lg font-bold text-slate-800 text-xs focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 bg-white"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold pointer-events-none">
                                  ha
                                </span>
                              </div>
                            </td>

                            {/* Rodeo Actual: Badge whitespace-nowrap que nunca se parte */}
                            <td className="p-2.5 whitespace-nowrap">
                              {rodeosLote.length > 0 ? (
                                <span className="inline-block px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 font-black text-[11px] border border-amber-300 shadow-2xs whitespace-nowrap">
                                  🐂 {rodeosLote.map((r) => r.nombre).join(', ')}
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded-md text-[11px] text-slate-400 font-medium bg-slate-100/70 border border-slate-200 whitespace-nowrap">
                                  Libre / Sin Hacienda
                                </span>
                              )}
                            </td>

                            <td className="p-2.5">
                              <select
                                value={edit.ambiente ?? 'Bajo Dulce'}
                                onChange={(e) => updatePotreroField(p.id, 'ambiente', e.target.value, true)}
                                className="w-full px-2 py-1 border border-slate-200 rounded-lg bg-white text-xs font-medium text-slate-700"
                              >
                                {AMBIENTES.map((a) => (
                                  <option key={a} value={a}>
                                    {a}
                                  </option>
                                ))}
                                {edit.ambiente && !AMBIENTES.includes(edit.ambiente) && (
                                  <option value={edit.ambiente}>{edit.ambiente}</option>
                                )}
                              </select>
                            </td>

                            <td className="p-2.5">
                              <select
                                value={edit.molino_id ?? ''}
                                onChange={(e) => updatePotreroField(p.id, 'molino_id', e.target.value, true)}
                                className="w-full px-2 py-1 border border-slate-200 rounded-lg bg-white text-xs font-semibold text-sky-900"
                              >
                                <option value="">Sin asignar</option>
                                {molinos.map((m) => (
                                  <option key={m.numero} value={m.numero}>
                                    M{m.numero}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-2.5">
                              <input
                                type="text"
                                value={edit.cultivo_actual ?? ''}
                                placeholder="Campo Natural..."
                                onChange={(e) => updatePotreroField(p.id, 'cultivo_actual', e.target.value, false)}
                                onBlur={() => handlePotreroBlur(p.id)}
                                className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
                              />
                            </td>

                            <td className="p-2.5 whitespace-nowrap">
                              <div className="font-extrabold text-slate-900">{cabezas} cab.</div>
                              <div className="text-[10px] font-bold text-slate-500">{carga} cab/ha</div>
                            </td>

                            {/* Semáforo con colores claros */}
                            <td className="p-2.5 whitespace-nowrap">
                              <select
                                value={edit.estado_semaforo ?? 'Disponible'}
                                onChange={(e) => updatePotreroField(p.id, 'estado_semaforo', e.target.value, true)}
                                className={`px-2.5 py-1 rounded-lg border text-xs font-extrabold shadow-2xs ${semClasses}`}
                              >
                                {ESTADOS_SEMAFORO.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Acciones fijas a la derecha con sombra sutil y sin cortes */}
                            <td className="p-2.5 text-right whitespace-nowrap space-x-1.5 sticky right-0 bg-white group-hover:bg-slate-50/90 z-10 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.06)]">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPotreroNum(p.numero);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-950 font-bold border border-emerald-300 inline-flex items-center gap-1 transition shadow-2xs"
                                title="Abrir ficha y mapa interactivo del potrero"
                              >
                                <span>Abrir Panel</span>
                                <span className="text-emerald-700 font-extrabold">→</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* VISTA 2: GRID DE TARJETAS 100% RESPONSIVE EN MOBILE / TABLET (< md) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:hidden">
                {filteredPotrerosList.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-slate-400 font-medium bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    No se encontraron potreros con los filtros actuales.
                  </div>
                ) : (
                  filteredPotrerosList.map((p) => {
                    const edit = editedPotreros[p.id] || p;
                    const cabezas = cabezasPorPotrero[p.numero] || 0;
                    const rodeosLote = rodeosPorPotrero[p.numero] || [];
                    const ha = Number(edit.hectareas) || 0;
                    const carga = ha > 0 ? Number((cabezas / ha).toFixed(2)) : 0;
                    const sem = getSemaforoColor(edit.estado_semaforo, carga, cabezas, getReceptividadEfectiva(edit));

                    const semEstado = (edit.estado_semaforo || '').toLowerCase();
                    let semClasses = 'bg-slate-100 text-slate-700 border-slate-300';
                    if (semEstado.includes('pastoreo') || semEstado.includes('ocupado')) {
                      semClasses = 'bg-red-50 text-red-900 border-red-300 font-black';
                    } else if (semEstado.includes('disponible') || semEstado.includes('óptima')) {
                      semClasses = 'bg-emerald-50 text-emerald-900 border-emerald-300 font-bold';
                    } else if (semEstado.includes('descanso')) {
                      semClasses = 'bg-amber-50 text-amber-900 border-amber-300 font-bold';
                    } else if (semEstado.includes('sobrecarg') || semEstado.includes('anegado')) {
                      semClasses = 'bg-red-100 text-red-900 border-red-400 font-black';
                    }

                    return (
                      <div
                        key={`mob-pot-${p.id}`}
                        className={`p-3.5 rounded-2xl border bg-white shadow-xs flex flex-col justify-between gap-3 transition ${
                          selectedPotreroNum === p.numero
                            ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/20'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {/* Header de la Tarjeta Móvil: N° + Nombre + Hectáreas y Semáforo */}
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 text-white font-mono font-black text-xs shadow-2xs shrink-0">
                                #{p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero}
                              </span>
                              <div>
                                <h4 className="text-sm font-extrabold text-slate-900 leading-snug">
                                  {edit.nombre || `Potrero ${p.numero}`}
                                </h4>
                                <span className="text-[11px] font-bold text-slate-500">
                                  {ha} hectáreas
                                </span>
                              </div>
                            </div>

                            <select
                              value={edit.estado_semaforo ?? 'Disponible'}
                              onChange={(e) => updatePotreroField(p.id, 'estado_semaforo', e.target.value, true)}
                              className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold shrink-0 ${semClasses}`}
                            >
                              {ESTADOS_SEMAFORO.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Cuerpo: Rodeo Actual + Cabezas / Carga */}
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Rodeo Actual:
                              </span>
                              {rodeosLote.length > 0 ? (
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 font-black text-[11px] border border-amber-300 truncate max-w-[170px]">
                                  🐂 {rodeosLote.map((r) => r.nombre).join(', ')}
                                </span>
                              ) : (
                                <span className="text-[11px] font-semibold text-slate-400">
                                  Libre / Sin Hacienda
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/50">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Ocupación:
                              </span>
                              <span className="font-extrabold text-slate-900">
                                {cabezas} cab. <span className="text-slate-400 font-normal">·</span> {carga} cab/ha
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/50 text-[11px]">
                              <div>
                                <span className="text-[10px] text-slate-400 block font-medium">Recurso:</span>
                                <span className="font-bold text-slate-800 truncate block">
                                  {edit.cultivo_actual || 'Campo Natural'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block font-medium">Ambiente / Agua:</span>
                                <span className="font-bold text-slate-800 truncate block">
                                  {edit.ambiente || 'Bajo'} {edit.molino_id ? `· M${edit.molino_id}` : ''}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Botón Ancho Inferior */}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPotreroNum(p.numero);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="w-full py-2 px-3 rounded-xl bg-emerald-900 hover:bg-emerald-950 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition shadow-xs"
                          >
                            <span>Abrir Panel de Lote</span>
                            <span className="text-emerald-300 font-bold">→</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })()}

        {activeSubTab === 'infraestructura' && (
          <div className="p-5 space-y-5">
            {/* Selector interno entre Infraestructura de Campo vs Instalaciones & Edificaciones */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setInfraSubView('campo')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition ${
                    infraSubView === 'campo'
                      ? 'bg-emerald-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  💧 Infraestructura de Campo y Molinos Solarizados
                </button>
                <button
                  type="button"
                  onClick={() => setInfraSubView('edificaciones')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition ${
                    infraSubView === 'edificaciones'
                      ? 'bg-emerald-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🏛️ Instalaciones & Edificaciones (Casco, Casas, Galpones y Corrales)
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMapToolMode('add_infra');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
              >
                <MapPin className="w-4 h-4" />
                + Ubicar Nuevo en el Mapa con un Clic
              </button>
            </div>

            {infraSubView === 'edificaciones' ? (
              <div className="space-y-5">
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-amber-700" />
                      Sub-pestaña: Instalaciones & Edificaciones del Casco + Corrales y Mangas
                    </h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Seguimiento de mantenimiento, componentes (manga, casilla, cargador, cepo/balanza) y notas de las casas, galpones y paneles solares del casco sin saturar el mapa.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {infraestructura
                    .filter(
                      (i) =>
                        i.es_edificacion_casco ||
                        i.tipo === 'Edificación / Casco' ||
                        i.tipo === 'Corrales y Mangas' ||
                        i.tipo === 'Mangrullo / Bomba Casco'
                    )
                    .map((inf) => {
                      const isOk = (inf.estado || 'Operativo') === 'Operativo';
                      return (
                        <div
                          key={inf.id}
                          className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
                                  {inf.codigo || inf.tipo}
                                </span>
                                <h5 className="text-sm font-extrabold text-slate-900 mt-1">
                                  {inf.nombre}
                                </h5>
                                <div className="text-[11px] text-slate-500">
                                  {inf.tipo}
                                  {inf.potrero_numero ? ` · Potrero #${inf.potrero_numero}` : ' · Casco Principal'}
                                </div>
                              </div>

                              <select
                                value={inf.estado || 'Operativo'}
                                onChange={(e) => handleUpdateInfraStatus(inf, e.target.value)}
                                className={`px-2 py-1 rounded-lg border text-[11px] font-bold ${
                                  isOk
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : 'bg-amber-50 text-amber-900 border-amber-300'
                                }`}
                              >
                                {ESTADOS_INFRAESTRUCTURA.map((st) => (
                                  <option key={st} value={st}>
                                    {st}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                                Componentes / Detalle Constructivo
                              </label>
                              <input
                                type="text"
                                defaultValue={inf.componentes_detalle || ''}
                                placeholder="Manga, casilla, cargador, cepo, balanza..."
                                onBlur={async (e) => {
                                  const val = e.target.value.trim();
                                  if (val !== (inf.componentes_detalle || '')) {
                                    await supabase
                                      .from('infraestructura')
                                      .update({ componentes_detalle: val || null })
                                      .eq('id', inf.id);
                                    notify(`Componentes de "${inf.nombre}" actualizados.`);
                                    onRefresh();
                                  }
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                                Notas y Mantenimiento
                              </label>
                              <input
                                type="text"
                                defaultValue={inf.observaciones || ''}
                                placeholder="Anotar mantenimiento o estado..."
                                onBlur={async (e) => {
                                  const val = e.target.value.trim();
                                  if (val !== (inf.observaciones || '')) {
                                    await supabase
                                      .from('infraestructura')
                                      .update({ observaciones: val || null })
                                      .eq('id', inf.id);
                                    notify(`Notas de "${inf.nombre}" guardadas.`);
                                    onRefresh();
                                  }
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700"
                              />
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              {inf.latitud && inf.longitud ? (
                                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1 font-mono whitespace-nowrap shrink-0">
                                  <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                                  En mapa
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                                  <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
                                  Sin ubicar
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              {inf.latitud && inf.longitud ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleVerEnMapa(inf)}
                                    className="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-900 text-[11px] font-extrabold inline-flex items-center gap-1 transition whitespace-nowrap shrink-0"
                                    title="Centrar en el mapa, resaltar con halo y abrir tarjeta"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                    Ver
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStartFijarPin(inf)}
                                    className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 text-[11px] font-extrabold inline-flex items-center gap-1 transition whitespace-nowrap shrink-0"
                                    title="Reubicar pin en el mapa satelital"
                                  >
                                    <MapPin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                    Reubicar
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleStartFijarPin(inf)}
                                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-extrabold inline-flex items-center gap-1 shadow-2xs transition whitespace-nowrap shrink-0"
                                  title="Fijar pin con 1 clic en el mapa satelital"
                                >
                                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                                  Ubicar
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingInfra({ ...inf, estilo_marcador: getInfraEstilo(inf) })}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 transition whitespace-nowrap shrink-0"
                                title="Editar datos completos"
                              >
                                <Edit className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onCreateTareaFromItem({
                                    titulo: `Mantenimiento en ${inf.nombre}`,
                                    categoria: 'General',
                                    potrero_numero: inf.potrero_numero || '',
                                    infraestructura_nombre: inf.nombre,
                                    prioridad: 'Media',
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1"
                              >
                                <ClipboardList className="w-3 h-3" />
                                + Tarea
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteInfra(inf)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                title="Eliminar infraestructura"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFilterTipoInfra('TODOS')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                      filterTipoInfra === 'TODOS'
                        ? 'bg-emerald-900 text-white border-emerald-900'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Todos ({infraestructura.length})
                  </button>
                  {TIPOS_INFRAESTRUCTURA.map((t) => {
                    const count = infraestructura.filter((i) => i.tipo === t).length;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFilterTipoInfra(t)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                          filterTipoInfra === t
                            ? 'bg-emerald-900 text-white border-emerald-900'
                            : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {t} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* TABLA EN DESKTOP (hidden md:block) - COMPRIMIDA SIN SCROLL HORIZONTAL CON BOTÓN ⋮ */}
                <div className="hidden md:block rounded-xl border border-slate-200 bg-white shadow-xs">
                  <table className="w-full table-fixed text-xs text-left">
                    <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 w-auto">Elemento</th>
                        <th className="py-2.5 px-3 w-28">Potrero</th>
                        <th className="py-2.5 px-3 w-32">Estado</th>
                        <th className="py-2.5 px-3 w-28">Ubicación</th>
                        <th className="py-2.5 px-3 w-16 text-center">⋮</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {infraFiltrada.map((inf) => {
                        const isOk = (inf.estado || 'Operativo') === 'Operativo';
                        const emoji = getInfraEmoji(inf);
                        const cleanNom = formatInfraTitulo(inf);
                        const isMenuOpen = activeInfraMenuId === inf.id;

                        return (
                          <tr key={inf.id} className="hover:bg-slate-50 transition">
                            {/* 1. Ícono + Nombre */}
                            <td className="py-2.5 px-3 font-bold text-slate-900 truncate">
                              <div className="flex items-center gap-2 min-w-0" title={`${inf.nombre} (${inf.tipo})`}>
                                <span className="text-base shrink-0 select-none">{emoji}</span>
                                <div className="min-w-0 truncate">
                                  <div className="font-extrabold text-slate-900 truncate text-[12.5px] leading-tight">
                                    {inf.codigo ? <span className="font-mono text-sky-800 mr-1">{inf.codigo} ·</span> : null}
                                    {cleanNom}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-medium truncate">
                                    {inf.tipo} {inf.solarizado ? '☀️ Solar' : ''}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* 2. Potrero */}
                            <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                              {inf.potrero_numero ? (
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-extrabold text-[11px] border border-slate-200">
                                  P#{inf.potrero_numero}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[11px] italic">General</span>
                              )}
                              {inf.potreros_abastecidos && (
                                <span className="block text-[10px] text-slate-400 font-medium truncate max-w-[90px]" title={inf.potreros_abastecidos}>
                                  {inf.potreros_abastecidos}
                                </span>
                              )}
                            </td>

                            {/* 3. Estado (pill compacto) */}
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10.5px] font-extrabold border inline-flex items-center gap-1 ${
                                  isOk
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : 'bg-amber-50 text-amber-900 border-amber-300'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${isOk ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                {inf.estado || 'Operativo'}
                              </span>
                            </td>

                            {/* 4. Ubicación */}
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {inf.latitud && inf.longitud ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1 font-mono">
                                  <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                                  En mapa
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-amber-500 shrink-0" />
                                  Sin pin
                                </span>
                              )}
                            </td>

                            {/* 5. Botón universal ⋮ con menú flotante z-[9999] */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap relative">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveInfraMenuId(isMenuOpen ? null : inf.id);
                                }}
                                className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                  isMenuOpen
                                    ? 'bg-emerald-900 text-white border-emerald-900 shadow-sm'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                }`}
                                title="Más opciones"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {/* MENÚ DESPLEGABLE FLOTANTE UNIVERSAL */}
                              {isMenuOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-[9998]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveInfraMenuId(null);
                                    }}
                                  />
                                  <div
                                    className="absolute right-3 top-10 w-48 bg-slate-900/98 backdrop-blur-md text-white rounded-xl shadow-2xl border border-slate-700 py-1.5 z-[9999] text-left text-xs animate-in fade-in duration-100 divide-y divide-slate-800"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="py-1">
                                      {inf.latitud && inf.longitud ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveInfraMenuId(null);
                                              handleVerEnMapa(inf);
                                            }}
                                            className="w-full px-3 py-1.5 hover:bg-slate-800 text-sky-300 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                          >
                                            <Eye className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                            <span>Ver en mapa</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveInfraMenuId(null);
                                              handleStartFijarPin(inf);
                                            }}
                                            className="w-full px-3 py-1.5 hover:bg-slate-800 text-amber-300 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                          >
                                            <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                            <span>Reubicar pin en mapa</span>
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveInfraMenuId(null);
                                            handleStartFijarPin(inf);
                                          }}
                                          className="w-full px-3 py-1.5 hover:bg-slate-800 text-amber-300 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                        >
                                          <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                          <span>Ubicar pin en mapa</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveInfraMenuId(null);
                                          setEditingInfra({ ...inf, estilo_marcador: getInfraEstilo(inf) });
                                        }}
                                        className="w-full px-3 py-1.5 hover:bg-slate-800 text-slate-200 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                      >
                                        <Edit className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        <span>Editar datos / ícono</span>
                                      </button>
                                    </div>

                                    {/* Cambiar Estado Rápido */}
                                    <div className="py-1 px-3">
                                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                                        Cambiar Estado
                                      </label>
                                      <select
                                        value={inf.estado || 'Operativo'}
                                        onChange={(e) => {
                                          handleUpdateInfraStatus(inf, e.target.value);
                                          setActiveInfraMenuId(null);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 text-white rounded-lg text-[11px] font-bold focus:outline-none"
                                      >
                                        {ESTADOS_INFRAESTRUCTURA.map((st) => (
                                          <option key={st} value={st}>
                                            {st}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Molino: toggle solar rápido */}
                                    {inf.tipo === 'Molino' && (
                                      <div className="py-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            window.__sanJoseToggleSolarMolino?.(inf.id, !inf.solarizado);
                                            setActiveInfraMenuId(null);
                                          }}
                                          className="w-full px-3 py-1.5 hover:bg-slate-800 text-amber-300 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                        >
                                          <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                          <span>{inf.solarizado ? 'Pasar a Convencional' : '☀️ Marcar Solar'}</span>
                                        </button>
                                      </div>
                                    )}

                                    {/* Crear tarea / Eliminar */}
                                    <div className="py-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveInfraMenuId(null);
                                          onCreateTareaFromItem({
                                            titulo: `Reparar / Revisar ${inf.tipo}: ${inf.nombre}`,
                                            categoria:
                                              inf.tipo === 'Tranquera' || inf.tipo === 'Tranquerón'
                                                ? 'Alambrados'
                                                : 'Aguadas',
                                            potrero_numero: inf.potrero_numero || '',
                                            infraestructura_nombre: `${inf.nombre} (${inf.tipo})`,
                                            prioridad: 'Alta',
                                          });
                                        }}
                                        className="w-full px-3 py-1.5 hover:bg-slate-800 text-emerald-300 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                      >
                                        <ClipboardList className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                        <span>+ Asignar Tarea</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveInfraMenuId(null);
                                          handleDeleteInfra(inf);
                                        }}
                                        className="w-full px-3 py-1.5 hover:bg-red-950/60 text-red-400 font-bold flex items-center gap-2 cursor-pointer transition text-left"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                        <span>Eliminar</span>
                                      </button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* VISTA EN MOBILE / TABLET (< md): GRID DE TARJETAS LIMPIAS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:hidden">
                  {infraFiltrada.map((inf) => {
                    const isOk = (inf.estado || 'Operativo') === 'Operativo';
                    return (
                      <div
                        key={`mob-inf-${inf.id}`}
                        className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-xs flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
                                  {inf.tipo}
                                </span>
                                {inf.codigo && (
                                  <span className="text-[11px] font-mono font-bold text-sky-800">
                                    {inf.codigo}
                                  </span>
                                )}
                              </div>
                              <h5 className="text-sm font-extrabold text-slate-900 mt-1 leading-snug">
                                {inf.nombre}
                              </h5>
                              <div className="text-[11px] text-slate-500 font-medium">
                                {inf.potrero_numero ? `Potrero #${inf.potrero_numero}` : 'General / Casco'}{' '}
                                {inf.potreros_abastecidos ? `· ${inf.potreros_abastecidos}` : ''}
                              </div>
                            </div>

                            <select
                              value={inf.estado || 'Operativo'}
                              onChange={(e) => handleUpdateInfraStatus(inf, e.target.value)}
                              className={`px-2 py-1 rounded-lg border text-[11px] font-bold shrink-0 ${
                                isOk
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : 'bg-amber-50 text-amber-900 border-amber-300'
                              }`}
                            >
                              {ESTADOS_INFRAESTRUCTURA.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                          </div>

                          {inf.tipo === 'Molino' && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  window.__sanJoseToggleSolarMolino?.(inf.id, !inf.solarizado)
                                }
                                className={`w-full py-1.5 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                                  inf.solarizado
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                    : 'bg-slate-50 text-slate-700 border-slate-300'
                                }`}
                              >
                                <Sun className={`w-3.5 h-3.5 ${inf.solarizado ? 'text-amber-500' : 'text-slate-400'}`} />
                                <span>{inf.solarizado ? 'Bomba Sumergible Solar' : 'Molino a Viento'}</span>
                              </button>
                            </div>
                          )}

                          {inf.observaciones && (
                            <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
                              {inf.observaciones}
                            </div>
                          )}
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            {inf.latitud && inf.longitud ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1 font-mono">
                                <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                                En mapa
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
                                Sin ubicar
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {inf.latitud && inf.longitud ? (
                              <button
                                type="button"
                                onClick={() => handleVerEnMapa(inf)}
                                className="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-900 text-xs font-bold inline-flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Ver
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartFijarPin(inf)}
                                className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                Ubicar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingInfra({ ...inf, estilo_marcador: getInfraEstilo(inf) })}
                              className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                              title="Editar"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {activeSubTab === 'alertas_caminos' && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-amber-600" />
                  Post-its / Alertas en Mapa ({alertasMapa.length})
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onOpenCuadrilla && onOpenCuadrilla()}
                    className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow-sm"
                    title="Armar día de cuadrilla incluyendo post-its y alertas"
                  >
                    <Truck className="w-3.5 h-3.5 text-amber-200" />
                    🛻 Armar Cuadrilla
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapToolMode('add_alerta');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold"
                  >
                    + Clavar Post-it en Mapa
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {alertasMapa.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-600 font-medium border border-dashed rounded-xl">
                    No hay Post-its clavados en el mapa. Usá el botón "+ Post-it / Alerta" arriba.
                  </div>
                ) : (
                  alertasMapa.map((a) => (
                    <div
                      key={a.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        a.resuelta
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : 'bg-amber-50/70 border-amber-300'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          📌 {a.tipo}: {a.titulo}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Prioridad: <strong>{a.prioridad}</strong>
                          {a.potrero_numero ? ` · Potrero #${a.potrero_numero}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingAlerta(a)}
                          className="px-2.5 py-1 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-bold shrink-0 transition"
                          title="Editar alerta"
                        >
                          ✎ Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleResolveAlerta(a)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-800 text-white text-[11px] font-bold shrink-0 transition"
                        >
                          {a.resuelta ? 'Reactivar' : '✓ Resolver'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAlerta(a)}
                          className="p-1.5 text-slate-400 hover:text-red-600 shrink-0 transition"
                          title="Eliminar Post-it"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Route className="w-4 h-4 text-emerald-700" />
                  Caminos Operativos & Eléctricos ({caminos.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setMapToolMode('draw_camino');
                    setDrawingPoints([]);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="px-3 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold"
                >
                  + Trazar en Mapa
                </button>
              </div>

              <div className="space-y-2">
                {caminos.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-600 font-medium border border-dashed rounded-xl">
                    No hay caminos ni parcelas eléctricas trazadas aún. Usá el botón "+ Trazar
                    Camino / Eléctrico" arriba.
                  </div>
                ) : (
                  caminos.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          {((c.tipo_traza || '').toLowerCase().includes('eléctric') || (c.tipo_traza || '').toLowerCase().includes('boyero') || (c.nombre || '').toLowerCase().includes('eléctric')) ? '⚡' : '🛣️'} {c.nombre}{' '}
                          <span className="font-normal text-slate-500">({c.tipo_traza})</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Estado: <strong>{c.estado}</strong>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={c.estado_camino || c.estado}
                          onChange={(e) => window.__sanJoseToggleCamino?.(c.id, e.target.value)}
                          className="px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-bold bg-white whitespace-nowrap"
                        >
                          {ESTADOS_CAMINO.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingCamino({
                              ...c,
                              coordenadas_json: Array.isArray(c.coordenadas_json)
                                ? c.coordenadas_json.map((pt) => [...pt])
                                : [],
                            })
                          }
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1 transition whitespace-nowrap shrink-0"
                          title="Editar nombre, tipo, estado y vértices"
                        >
                          <Edit className="w-3.5 h-3.5 text-slate-600" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCamino(c)}
                          className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"
                          title="Eliminar traza"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Edición Completa de Infraestructura */}
      {editingInfra && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
            <div className="px-5 py-4 bg-gradient-to-r from-slate-900 to-emerald-950 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-2">
                  <Edit className="w-4 h-4 text-emerald-400" />
                  Editar Infraestructura / Instalación
                </h3>
                <p className="text-xs text-emerald-200/80 mt-0.5">
                  Modificá datos, potrero asociado o reubicá el pin en el mapa satelital.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingInfra(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedInfra} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Categoría / Tipo *
                  </label>
                  <select
                    value={editingInfra.tipo || 'Molino'}
                    onChange={(e) => setEditingInfra({ ...editingInfra, tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  >
                    {TIPOS_INFRAESTRUCTURA.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nombre / Identificación *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingInfra.nombre || ''}
                    onChange={(e) => setEditingInfra({ ...editingInfra, nombre: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                    placeholder="Ej: Molino 2, Tanque P5, Casco Principal..."
                  />
                </div>
              </div>

              {/* Selector Curado de 12 Emoticones para el Marcador */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Emoticón / Marcador del Satélite (12 opciones)
                  </label>
                  <span className="text-[10px] font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    Activo: {getInfraEmoji(editingInfra)}
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1.5 p-2 bg-slate-50 rounded-2xl border border-slate-200">
                  {ICONOS_MAPA_CURADOS.map((ico) => {
                    const currentEmoji = getInfraEmoji(editingInfra);
                    const isSel = currentEmoji === ico.emoji;
                    return (
                      <button
                        key={ico.emoji}
                        type="button"
                        onClick={() => setEditingInfra({ ...editingInfra, icono: ico.emoji })}
                        title={ico.label}
                        className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition cursor-pointer ${
                          isSel
                            ? 'bg-emerald-700 text-white shadow-md ring-2 ring-emerald-500 scale-105 z-10'
                            : 'bg-white hover:bg-slate-200 text-slate-800 border border-slate-200/80'
                        }`}
                      >
                        <span className="text-base leading-none">{ico.emoji}</span>
                        <span className={`text-[8.5px] mt-0.5 truncate max-w-full font-bold ${isSel ? 'text-white' : 'text-slate-500'}`}>
                          {ico.label.split('/')[0].trim()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selector Visual de Estilo de Marcador (Chip / Tarjeta / Solo Ícono) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Modo de Visualización en el Mapa
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingInfra({ ...editingInfra, estilo_marcador: 'chip' })}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      (editingInfra.estilo_marcador || 'chip') === 'chip'
                        ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500 shadow-xs'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-black text-xs text-slate-900">
                      <span>🏷️ Chip</span>
                      <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-800 font-extrabold">Por defecto</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-semibold mt-1">Ícono + Nombre legible</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingInfra({ ...editingInfra, estilo_marcador: 'tarjeta' })}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      editingInfra.estilo_marcador === 'tarjeta'
                        ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500 shadow-xs'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black text-xs text-slate-900 flex items-center gap-1.5">
                      <span>📋 Tarjeta</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-semibold mt-1">2 líneas con estado</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingInfra({ ...editingInfra, estilo_marcador: 'icono' })}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      editingInfra.estilo_marcador === 'icono'
                        ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500 shadow-xs'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black text-xs text-slate-900 flex items-center gap-1.5">
                      <span>🔘 Solo Ícono</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-semibold mt-1">Mínimo tamaño visual</div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Código Corto
                  </label>
                  <input
                    type="text"
                    value={editingInfra.codigo || ''}
                    onChange={(e) => setEditingInfra({ ...editingInfra, codigo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                    placeholder="Ej: M2, TA1, TQ Casco"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Estado Operativo *
                  </label>
                  <select
                    value={editingInfra.estado || 'Operativo'}
                    onChange={(e) => setEditingInfra({ ...editingInfra, estado: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  >
                    {ESTADOS_INFRAESTRUCTURA.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Potrero Asociado
                  </label>
                  <select
                    value={editingInfra.potrero_numero || ''}
                    onChange={(e) =>
                      setEditingInfra({
                        ...editingInfra,
                        potrero_numero: e.target.value || null,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  >
                    <option value="">General / Casco</option>
                    {potreros.map((p) => (
                      <option key={p.numero} value={p.numero}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Potreros Abastecidos / Afectados
                </label>
                <input
                  type="text"
                  value={editingInfra.potreros_abastecidos || ''}
                  onChange={(e) =>
                    setEditingInfra({ ...editingInfra, potreros_abastecidos: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  placeholder="Ej: Potreros 2, 3 y 4"
                />
              </div>

              {editingInfra.tipo === 'Molino' && (
                <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
                      <Sun className="w-4 h-4 text-amber-600" />
                      Sistema Solarizado
                    </div>
                    <div className="text-[11px] text-amber-700">
                      Bomba sumergible alimentada por paneles solares (distintivo especial en mapa).
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingInfra.solarizado)}
                      onChange={(e) =>
                        setEditingInfra({ ...editingInfra, solarizado: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                  </label>
                </div>
              )}

              {(editingInfra.tipo === 'Camino Operativo' || (editingInfra.tipo || '').toLowerCase().includes('camino')) && (
                <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl space-y-1.5">
                  <label className="block text-[11px] font-black text-blue-900 uppercase tracking-wider">
                    🛣️ Transitabilidad del Camino (estado_camino) *
                  </label>
                  <div className="flex gap-2">
                    {['Transitable', 'Con precaución', 'Cortado por barro'].map((st) => {
                      const isCur = (editingInfra.estado_camino || editingInfra.estado || 'Transitable') === st;
                      const color = st === 'Transitable' ? 'bg-emerald-600' : st === 'Con precaución' ? 'bg-amber-600' : 'bg-red-600';
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setEditingInfra({ ...editingInfra, estado_camino: st, estado: st })}
                          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition ${
                            isCur ? `${color} text-white shadow-sm ring-2 ring-white/50` : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {st === 'Transitable' ? '🟢 Transitable' : st === 'Con precaución' ? '🟡 Con precaución' : '🔴 Cortado'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Detalle de Componentes / Instalaciones
                </label>
                <input
                  type="text"
                  value={editingInfra.componentes_detalle || ''}
                  onChange={(e) =>
                    setEditingInfra({ ...editingInfra, componentes_detalle: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  placeholder="Ej: Bebida 6.000L hormigón, boya de 1 pulgada, manga 12m con cepo..."
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Observaciones / Mantenimiento
                </label>
                <textarea
                  rows={2}
                  value={editingInfra.observaciones || ''}
                  onChange={(e) =>
                    setEditingInfra({ ...editingInfra, observaciones: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  placeholder="Notas de estado, revisiones pendientes, repuestos necesarios..."
                />
              </div>

              {/* Ubicación GPS y botón de reubicación */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-slate-800">
                      {editingInfra.latitud && editingInfra.longitud
                        ? `Ubicado: [${Number(editingInfra.latitud).toFixed(5)}, ${Number(
                            editingInfra.longitud
                          ).toFixed(5)}]`
                        : 'Sin ubicación GPS asignada'}
                    </div>
                    <div className="text-[10.5px] text-slate-500">
                      Podés arrastrar el marcador con el modo edición o reubicar con 1 clic.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {editingInfra.latitud && editingInfra.longitud && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = { ...editingInfra };
                        setEditingInfra(null);
                        handleStartMovingInfra(target);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs font-extrabold inline-flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                      title="Mover este pin arrastrándolo en la foto satelital con confirmación"
                    >
                      <Move className="w-3.5 h-3.5 text-slate-950" />
                      Mover en mapa
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const target = { ...editingInfra };
                      setEditingInfra(null);
                      handleStartFijarPin(target);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition cursor-pointer border border-slate-600"
                    title="Fijar o reubicar haciendo 1 clic en el satélite"
                  >
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    {editingInfra.latitud && editingInfra.longitud
                      ? 'Reubicar con 1 clic'
                      : 'Fijar Pin en Mapa'}
                  </button>
                </div>
              </div>

              {/* Botones de acción modal */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const toDelete = { ...editingInfra };
                      setEditingInfra(null);
                      handleDeleteInfra(toDelete);
                    }}
                    className="px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const item = { ...editingInfra };
                      setEditingInfra(null);
                      window.__sanJoseCreateTareaFromInfra?.(item.id);
                    }}
                    className="px-3 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                    title="Crear tarea de mantenimiento para este elemento"
                  >
                    <Wrench className="w-3.5 h-3.5 text-emerald-300" />
                    <span>+ Asignar Tarea</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingInfra(null)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingEditingInfra}
                    className="px-5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold shadow-sm transition disabled:opacity-50"
                  >
                    {savingEditingInfra ? 'Guardando cambios...' : 'Guardar Cambios'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Opciones y Datos de Caminos y Alambrados Eléctricos */}
      {editingCamino && showCaminoDetailsModal && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
            <div className="px-5 py-4 bg-gradient-to-r from-slate-900 to-sky-950 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-2">
                  {editingCamino.tipo_traza?.toLowerCase().includes('eléctric') ||
                  editingCamino.tipo_traza?.toLowerCase().includes('boyero') ||
                  editingCamino.tipo_traza?.toLowerCase().includes('alambrado') ? (
                    <Zap className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <Route className="w-4 h-4 text-amber-400" />
                  )}
                  Datos y Opciones de la Traza
                </h3>
                <p className="text-xs text-sky-200/80 mt-0.5">
                  Modificá nombre, transitabilidad, tipo o invertí el sentido de la traza.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCaminoDetailsModal(false)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedCamino} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Nombre de la Traza *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingCamino.nombre}
                    onChange={(e) =>
                      setEditingCamino({ ...editingCamino, nombre: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    placeholder="Ej: Camino Central a Manga / Alambrado Boyero P#4"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Tipo de Traza
                  </label>
                  <select
                    value={editingCamino.tipo_traza || 'Camino Interno'}
                    onChange={(e) =>
                      setEditingCamino({ ...editingCamino, tipo_traza: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                  >
                    <option value="Camino Interno">Camino Interno (Ámbar continuo)</option>
                    <option value="Camino Principal">Camino Principal (Ámbar continuo)</option>
                    <option value="Parcela Eléctrica / Boyero">
                      Parcela Eléctrica / Boyero (Cian punteado)
                    </option>
                    <option value="Alambrado Eléctrico">
                      Alambrado Eléctrico (Cian punteado)
                    </option>
                    <option value="Picada Cortafuego">Picada Cortafuego</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Estado / Transitabilidad
                  </label>
                  <select
                    value={editingCamino.estado_camino || editingCamino.estado || 'Transitable'}
                    onChange={(e) =>
                      setEditingCamino({
                        ...editingCamino,
                        estado: e.target.value,
                        estado_camino: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                  >
                    {ESTADOS_CAMINO.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Observaciones / Estado operativo
                  </label>
                  <textarea
                    rows={2}
                    value={editingCamino.observaciones || ''}
                    onChange={(e) =>
                      setEditingCamino({ ...editingCamino, observaciones: e.target.value })
                    }
                    placeholder="Detalles de mantenimiento, estado de picada o electrificación..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
              </div>

              {/* Información de Vértices y Sentido */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Route className="w-3.5 h-3.5 text-sky-600" />
                    Vértices en el Mapa ({editingCamino.coordenadas_json?.length || 0} puntos · {editingCaminoDistanceKm} km)
                  </span>
                  {editingCamino.coordenadas_json?.length >= 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingCamino({
                          ...editingCamino,
                          coordenadas_json: [...editingCamino.coordenadas_json].reverse(),
                        })
                      }
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[11px] font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1 transition shadow-xs"
                      title="Invertir orden de los puntos inicio ↔ fin"
                    >
                      <ArrowRightLeft className="w-3 h-3 text-sky-600" />
                      Invertir Sentido
                    </button>
                  )}
                </div>

                <div className="p-3 bg-sky-50 rounded-xl border border-sky-200 text-xs text-sky-950 font-medium leading-relaxed">
                  🎯 <strong>Edición directa activa en el mapa:</strong> Podés arrastrar cualquiera de los marcadores circulares numerados sobre la imagen satelital, hacer clic sobre los puntos intermedios <strong>(+)</strong> para insertar nuevos vértices o tocar un punto existente para eliminarlo.
                </div>
              </div>

              {/* Botones de acción modal */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const toDelete = { ...editingCamino };
                    setEditingCamino(null);
                    setShowCaminoDetailsModal(false);
                    handleDeleteCamino(toDelete);
                  }}
                  className="px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold inline-flex items-center gap-1.5 transition whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar Traza
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCaminoDetailsModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition whitespace-nowrap shrink-0"
                  >
                    Volver al Mapa
                  </button>
                  <button
                    type="submit"
                    disabled={savingEditingCamino}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Save className="w-3.5 h-3.5 text-white" />
                    {savingEditingCamino ? 'Guardando...' : 'Guardar traza'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ==================================================================== */}
      {/* MODAL: DETALLE COMPLETO DE RODEO DESDE EL MAPA                       */}
      {/* ==================================================================== */}
      {rodeoDetailModal && createPortal(
        <div className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-emerald-600 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🐄</span>
                <div>
                  <h3 className="text-sm font-black text-white">
                    {rodeoDetailModal.rodeos.length > 0
                      ? rodeoDetailModal.rodeos.map((r) => r.nombre).join(' + ')
                      : 'Hacienda'}
                  </h3>
                  <p className="text-[11px] text-emerald-300 font-bold">
                    Potrero #{rodeoDetailModal.potrero.numero === 2 ? '2/3' : rodeoDetailModal.potrero.numero === 38 ? 'NN' : rodeoDetailModal.potrero.numero} · {rodeoDetailModal.potrero.nombre} ({rodeoDetailModal.potrero.hectareas} ha)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRodeoDetailModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Cabezas totales & permanencia */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500">Cabezas Totales</span>
                  <div className="text-2xl font-black text-slate-900 mt-0.5">
                    {rodeoDetailModal.cabezas} <span className="text-xs font-bold text-slate-600">cab.</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-semibold mt-1">
                    Carga:{' '}
                    {Number(rodeoDetailModal.potrero.hectareas) > 0
                      ? (rodeoDetailModal.cabezas / Number(rodeoDetailModal.potrero.hectareas)).toFixed(2)
                      : 0}{' '}
                    cab/ha
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500">Permanencia en Lote</span>
                  <div className="text-2xl font-black text-slate-900 mt-0.5 flex items-center gap-1.5">
                    <span>{rodeoDetailModal.permInfo?.dias ?? 0}</span>
                    <span className="text-xs font-bold text-slate-600">días</span>
                    {rodeoDetailModal.permInfo?.semaforo && (
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          rodeoDetailModal.permInfo.semaforo === 'ROJO'
                            ? 'bg-red-500'
                            : rodeoDetailModal.permInfo.semaforo === 'AMBAR'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 font-semibold mt-1">
                    {rodeoDetailModal.rodeos[0]?.dias_estimados_pastoreo
                      ? `Meta: ${rodeoDetailModal.rodeos[0].dias_estimados_pastoreo} días de pastoreo`
                      : 'Sin meta de pastoreo definida'}
                  </div>
                </div>
              </div>

              {/* Desglose de rodeos y categorías */}
              <div className="space-y-2">
                <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  Composición por Rodeo y Categoría
                </span>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {rodeoDetailModal.rodeos.map((r) => {
                    const parts = [];
                    if (r.vacas) parts.push(`${r.vacas} Vacas`);
                    if (r.terneros) parts.push(`${r.terneros} Terneros/as`);
                    if (r.toros_padres || r.toros) parts.push(`${r.toros_padres || r.toros} Toros`);
                    if (r.toritos) parts.push(`${r.toritos} Toritos`);
                    if (r.vacas_cut) parts.push(`${r.vacas_cut} Vacas CUT`);
                    if (r.vaquillonas_reposicion || r.vaquillonas) parts.push(`${r.vaquillonas_reposicion || r.vaquillonas} Vaquillonas`);
                    if (r.novillos) parts.push(`${r.novillos} Novillos`);
                    return (
                      <div key={r.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">{r.nombre}</div>
                          <div className="text-[11px] text-slate-600 font-semibold mt-0.5">
                            {parts.join(' · ') || 'Sin desglose detallado'}
                          </div>
                          {r.observaciones && (
                            <div className="text-[10px] text-slate-400 mt-0.5 italic">{r.observaciones}</div>
                          )}
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-extrabold shrink-0">
                          {calcRodeoHeads(r)} cab.
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 gap-3">
                <button
                  type="button"
                  onClick={() => setRodeoDetailModal(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const rod = rodeoDetailModal.rodeos[0];
                    if (rod) {
                      setSelectedRodeoIdToMove(String(rod.id));
                    }
                    setSelectedPotreroNum(rodeoDetailModal.potrero.numero);
                    setShowMoveRodeoBox(true);
                    setRodeoDetailModal(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-2 shadow-sm transition"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Mover de Potrero
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Editar Post-it de Alerta */}
      {editingAlerta && createPortal(
        <div className="fixed inset-0 z-[1400] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden space-y-0">
            <div className="p-4 bg-gradient-to-r from-slate-900 to-amber-950 text-white flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">📌</span>
                <div>
                  <h3 className="font-extrabold text-sm text-white">Editar Post-it de Alerta</h3>
                  <p className="text-[11px] text-amber-300">Modificá el texto, urgencia o potrero asignado</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingAlerta(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateAlerta} className="p-5 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Tipo de Alerta *
                  </label>
                  <select
                    value={editingAlerta.tipo || 'Falta agua'}
                    onChange={(e) => setEditingAlerta({ ...editingAlerta, tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  >
                    <option value="Falta agua">Falta agua / Bebida seca</option>
                    <option value="Rotura alambrado">Rotura de alambrado</option>
                    <option value="Empaste / Sanidad">Empaste / Sanidad animal</option>
                    <option value="Boyero sin chispa">Boyero / Eléctrico sin chispa</option>
                    <option value="Peligro / Tronco">Peligro en camino / Tronco</option>
                    <option value="Maleza / Rama cada">Maleza / Rama caída</option>
                    <option value="Otro">Otro aviso operativo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Urgencia *
                  </label>
                  <select
                    value={editingAlerta.prioridad || 'Alta'}
                    onChange={(e) => setEditingAlerta({ ...editingAlerta, prioridad: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  >
                    <option value="Alta">🔴 Alta (Inmediata)</option>
                    <option value="Media">🟡 Media (En el día)</option>
                    <option value="Baja">🟢 Baja (Para revisar)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Descripción / Mensaje del Post-it *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Reparar boyero o alambre roto..."
                  value={editingAlerta.titulo || ''}
                  onChange={(e) => setEditingAlerta({ ...editingAlerta, titulo: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Potrero Vinculado
                </label>
                <select
                  value={editingAlerta.potrero_numero || ''}
                  onChange={(e) => setEditingAlerta({ ...editingAlerta, potrero_numero: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                >
                  <option value="">Sin potrero específico</option>
                  {potreros.map((p) => (
                    <option key={p.numero} value={p.numero}>
                      Potrero #{p.numero === 2 ? '2/3' : p.numero === 38 ? 'NN' : p.numero} - {p.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Observaciones Detalladas
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles adicionales para la cuadrilla..."
                  value={editingAlerta.observaciones || ''}
                  onChange={(e) => setEditingAlerta({ ...editingAlerta, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAlerta(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updatingAlerta}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black shadow-sm transition disabled:opacity-50"
                >
                  {updatingAlerta ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
