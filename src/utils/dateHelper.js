/**
 * src/utils/dateHelper.js
 * Utilidades Centralizadas de Fechas en Formato Argentino (DD/MM/YYYY)
 * Establecimiento San José · Agroganadera Rincón del Sur S.A.
 */

/**
 * Convierte cualquier fecha ISO (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss...)
 * a formato argentino DD/MM/YYYY sin desfases de huso horario.
 *
 * Ejemplos:
 *  - '2026-11-23' -> '23/11/2026'
 *  - '2026-11-23T14:30:00Z' -> '23/11/2026'
 *  - '23/11/2026' -> '23/11/2026'
 *  - null / undefined / '' -> '—'
 *
 * @param {string|Date} fechaInput
 * @param {string} fallback Texto si es nulo o vacío (por defecto '—')
 * @returns {string} Fecha formateada en DD/MM/YYYY
 */
export function formatFechaAR(fechaInput, fallback = '—') {
  if (!fechaInput) return fallback;

  if (typeof fechaInput !== 'string') {
    if (fechaInput instanceof Date && !isNaN(fechaInput.getTime())) {
      const y = fechaInput.getFullYear();
      const m = String(fechaInput.getMonth() + 1).padStart(2, '0');
      const d = String(fechaInput.getDate()).padStart(2, '0');
      return `${d}/${m}/${y}`;
    }
    fechaInput = String(fechaInput);
  }

  const clean = fechaInput.trim();
  if (!clean || clean === '-' || clean === 'null' || clean === 'undefined') return fallback;

  // Si ya viene en formato DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('/');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // Si viene en formato YYYY-MM-DD o timestamp ISO
  const datePart = clean.split('T')[0].split(' ')[0];
  const parts = datePart.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const [y, m, d] = parts;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  return clean;
}

/**
 * Formatea un timestamp o Date a fecha y hora real en Argentina en formato 24 horas:
 * 'vie, 20/11/2026 · 02:35 hs' usando 'America/Argentina/Buenos_Aires' y hour12: false.
 *
 * @param {string|Date} fechaInput
 * @param {string} fallback
 * @returns {string}
 */
export function formatFechaHoraCorteAR(fechaInput, fallback = '—') {
  if (!fechaInput) return fallback;
  try {
    let dateObj;
    if (fechaInput instanceof Date) {
      dateObj = fechaInput;
    } else {
      dateObj = new Date(fechaInput);
    }
    if (isNaN(dateObj.getTime())) return fallback;

    const weekdayStr = new Intl.DateTimeFormat('es-AR', {
      weekday: 'short',
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(dateObj);

    const dayStr = new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(dateObj);

    const timeStr = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(dateObj);

    const cleanWeekday = (weekdayStr || '').replace('.', '').trim().toLowerCase();
    return `${cleanWeekday}, ${dayStr} · ${timeStr} hs`;
  } catch {
    return fallback;
  }
}

/**
 * Genera la URL oficial de Google Calendar para agendar un evento en 1 toque
 * desde el celular o computadora con recordatorio predefinido.
 *
 * @param {Object} options
 * @param {string} options.title Título del evento
 * @param {string} options.fecha Fecha en formato YYYY-MM-DD o DD/MM/YYYY o ISO
 * @param {string} [options.details] Descripción o indicaciones del evento
 * @param {string} [options.location] Ubicación (ej: 'Establecimiento San José, Las Flores')
 * @returns {string} URL lista para abrir con window.open()
 */
export function buildGoogleCalendarUrl({ title, fecha, details = '', location = 'Establecimiento San José, Las Flores, Bs. As.' }) {
  if (!fecha) return '#';

  let datePart = '';
  if (typeof fecha === 'string') {
    const clean = fecha.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
      const [d, m, y] = clean.split('/');
      datePart = `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
    } else {
      const isoDate = clean.split('T')[0].split(' ')[0];
      const parts = isoDate.split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        datePart = `${parts[0]}${parts[1].padStart(2, '0')}${parts[2].padStart(2, '0')}`;
      }
    }
  } else if (fecha instanceof Date && !isNaN(fecha.getTime())) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    datePart = `${y}${m}${d}`;
  }

  if (!datePart || datePart.length !== 8) {
    const today = new Date();
    datePart = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  }

  // Evento de todo el día: YYYYMMDD/YYYYMMDD (siguiente día para fin inclusivo)
  const y = parseInt(datePart.slice(0, 4), 10);
  const m = parseInt(datePart.slice(4, 6), 10) - 1;
  const d = parseInt(datePart.slice(6, 8), 10);
  const nextDay = new Date(y, m, d + 1);
  const nextDatePart = `${nextDay.getFullYear()}${String(nextDay.getMonth() + 1).padStart(2, '0')}${String(nextDay.getDate()).padStart(2, '0')}`;

  const datesParam = `${datePart}/${nextDatePart}`;
  const textParam = encodeURIComponent(title || 'San José · Tarea de Campo');
  const detailsParam = encodeURIComponent(details || 'Establecimiento San José · Agroganadera Rincón del Sur S.A.');
  const locationParam = encodeURIComponent(location);

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${textParam}&dates=${datesParam}&details=${detailsParam}&location=${locationParam}`;
}

/**
 * Calcula lunes y domingo de la semana correspondiente a una fecha ISO (o base hoy).
 * @param {string|Date} [baseDate] Fecha de referencia (YYYY-MM-DD o Date)
 * @param {number} [offsetWeeks=0] Desplazamiento en semanas (0 = esta semana, 1 = próxima semana)
 * @param {number} [totalWeeks=1] Cantidad de semanas que abarca el rango (1, 2, 3...)
 * @returns {{ fechaInicio: string, fechaFin: string, label: string, lunesDate: Date, domingoDate: Date }}
 */
export function calcularRangoSemanal(baseDate = null, offsetWeeks = 0, totalWeeks = 1) {
  const d = baseDate ? (typeof baseDate === 'string' ? new Date(baseDate + 'T12:00:00') : new Date(baseDate)) : new Date();
  if (isNaN(d.getTime())) {
    return { fechaInicio: '', fechaFin: '', label: '', lunesDate: new Date(), domingoDate: new Date() };
  }
  const day = d.getDay(); // 0 Dom, 1 Lun, ..., 6 Sab
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diffToMonday + (offsetWeeks * 7));

  const cantDias = Math.max(1, totalWeeks) * 7 - 1;
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + cantDias);

  const toIso = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const dayStr = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayStr}`;
  };

  const toShortAR = (dt) => {
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const dayStr = String(dt.getDate()).padStart(2, '0');
    return `${dayStr}/${m}`;
  };

  const fechaInicio = toIso(lunes);
  const fechaFin = toIso(domingo);

  let label = '';
  if (totalWeeks === 1) {
    label = `Semana ${toShortAR(lunes)} – ${toShortAR(domingo)}`;
  } else {
    label = `${totalWeeks} semanas (${toShortAR(lunes)} – ${toShortAR(domingo)})`;
  }

  return {
    fechaInicio,
    fechaFin,
    label,
    lunesDate: lunes,
    domingoDate: domingo,
  };
}

/**
 * Formatea un rango o fecha de proveedor para visualización compacta y elegante.
 * Si tiene fechaInicio y fechaFin: 'Semana 23/11 – 29/11' o '2 semanas (23/11 – 06/12)'
 * Si es puntual: '23/11/2026'
 *
 * @param {string} fechaInicio
 * @param {string} fechaFin
 * @returns {string}
 */
export function formatRangoProveedorAR(fechaInicio, fechaFin) {
  if (!fechaInicio) return '—';
  if (!fechaFin || fechaFin === fechaInicio) {
    return formatFechaAR(fechaInicio);
  }
  const d1 = new Date(fechaInicio + 'T12:00:00');
  const d2 = new Date(fechaFin + 'T12:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
    return `${formatFechaAR(fechaInicio)} – ${formatFechaAR(fechaFin)}`;
  }
  const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const semanas = Math.round(diffDays / 7);

  const toShort = (dt) => {
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const dayStr = String(dt.getDate()).padStart(2, '0');
    return `${dayStr}/${m}`;
  };

  if (semanas <= 1) {
    return `Semana ${toShort(d1)} – ${toShort(d2)}`;
  }
  return `${semanas} semanas (${toShort(d1)} – ${toShort(d2)})`;
}

export default {
  formatFechaAR,
  formatFechaHoraCorteAR,
  buildGoogleCalendarUrl,
  calcularRangoSemanal,
  formatRangoProveedorAR,
};
