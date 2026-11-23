import React from 'react';
import { Sprout, CheckSquare, Square, CheckCircle2, Circle, Droplets } from 'lucide-react';
import { calcPotreroHacienda, calcRodeoCabezas } from '../utils/rodeoHelpers.js';

/**
 * Componente Reutilizable de Tarjeta de Potrero (PotreroCard)
 * Establecimiento San José · Agroganadera Rincón del Sur S.A.
 *
 * Muestra:
 * - Código y nombre de potrero (P#14 · Casco)
 * - Superficie en hectáreas a la derecha (85.0 ha)
 * - Pastura activa en verde con icono Sprout
 * - Badge amarillo con rodeo ocupante y cabezas reales (🐮 Rodeo 1 (340 cab.))
 * - Badges de toros en servicio, molinos y disponibilidad
 */
export default function PotreroCard({
  potrero,
  rodeos = [],
  isSelected = false,
  onToggle,
  selectionType = 'checkbox', // 'checkbox' | 'radio' | 'none'
  theme = 'light', // 'light' | 'dark'
  size = 'normal', // 'normal' | 'compact'
  molinos = [],
  isDestinoMode = false,
  currentRodeoId = null,
  badgeExtra = null,
}) {
  if (!potrero) return null;

  // Si rodeos ya viene filtrado en potrero.rodeos o se calcula desde el array global
  const hacienda = Array.isArray(potrero.rodeos)
    ? {
        rodeos: potrero.rodeos,
        totalCabezas:
          potrero.total_cabezas ??
          potrero.rodeos.reduce((s, r) => s + calcRodeoCabezas(r), 0),
        totalToros:
          potrero.total_toros ??
          potrero.rodeos.reduce(
            (s, r) =>
              s +
              ((parseInt(r.toros_padres, 10) || 0) +
                (parseInt(r.toritos, 10) || 0) +
                (parseInt(r.toros, 10) || 0)),
            0
          ),
        enServicio: potrero.en_servicio ?? false,
      }
    : calcPotreroHacienda(potrero, rodeos);

  // En modo movimiento/destino, si hay un rodeo origen, diferenciarlo
  const otrosRodeos =
    isDestinoMode && currentRodeoId
      ? hacienda.rodeos.filter((r) => String(r.id) !== String(currentRodeoId))
      : hacienda.rodeos;

  const pastura =
    potrero.recurso_forrajero ||
    potrero.cultivo_actual ||
    potrero.cultivo ||
    'Campo Natural';

  const ha = Number(potrero.hectareas) || 0;
  const isDark = theme === 'dark';

  // Molinos asociados
  const molinosP =
    Array.isArray(potrero.molinos) && potrero.molinos.length > 0
      ? potrero.molinos
      : molinos.filter((m) => Number(m.potrero_numero) === Number(potrero.numero));

  return (
    <div
      onClick={onToggle}
      className={`rounded-2xl transition cursor-pointer select-none border ${
        size === 'compact' ? 'p-2.5' : 'p-3.5'
      } ${
        isDark
          ? isSelected
            ? 'bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/30 text-white'
            : 'bg-slate-900 border-slate-700/80 hover:border-slate-500 text-slate-200'
          : isSelected
          ? 'bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/25 text-slate-900 shadow-xs'
          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800 shadow-2xs'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {selectionType !== 'none' && (
          <div className="pt-0.5 shrink-0">
            {selectionType === 'radio' ? (
              isSelected ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <Circle
                  className={`w-5 h-5 ${
                    isDark ? 'text-slate-600' : 'text-slate-300'
                  } shrink-0`}
                />
              )
            ) : isSelected ? (
              <CheckSquare className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <Square
                className={`w-5 h-5 ${
                  isDark ? 'text-slate-600' : 'text-slate-300'
                } shrink-0`}
              />
            )}
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          {/* Fila 1: Nombre a la izquierda, Hectáreas a la derecha */}
          <div className="flex items-center justify-between gap-2">
            <span
              className={`font-black text-xs truncate ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              P#{potrero.numero} · {potrero.nombre || `Potrero ${potrero.numero}`}
            </span>
            <span
              className={`text-[11px] font-mono font-bold shrink-0 ${
                isDark ? 'text-emerald-400' : 'text-slate-600'
              }`}
            >
              {ha.toFixed(1)} ha
            </span>
          </div>

          {/* Fila 2: Pastura activa en verde */}
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-bold truncate">
            <Sprout className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
            <span className="truncate">{pastura}</span>
          </div>

          {/* Fila 3: Badges de Rodeos, Toros y Estado */}
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {otrosRodeos.length > 0 ? (
              otrosRodeos.map((r, ri) => {
                const cabezasR = calcRodeoCabezas(r);
                return (
                  <span
                    key={ri}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-950 border border-amber-300/80 shadow-2xs"
                    title={`Rodeo ocupante: ${r.nombre}`}
                  >
                    <span>🐮 {r.nombre}</span>
                    <span className="font-mono">({cabezasR} cab.)</span>
                  </span>
                );
              })
            ) : (
              <span
                className={`text-[10px] font-medium italic ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {isDestinoMode ? '✓ Potrero disponible (libre)' : 'Sin hacienda asignada'}
              </span>
            )}

            {hacienda.totalToros > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">
                🐂 {hacienda.totalToros} Toros
              </span>
            )}

            {hacienda.enServicio && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">
                En Servicio
              </span>
            )}

            {molinosP.length > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
                <Droplets className="w-2.5 h-2.5" />
                <span>M#{molinosP[0].numero}</span>
              </span>
            )}

            {badgeExtra}
          </div>
        </div>
      </div>
    </div>
  );
}
