import React from 'react';
import { Star } from 'lucide-react';

/**
 * Componente interactivo y visual para Condición Corporal (1.0 a 5.0 ★)
 * Escala ganadera de cría con semáforo automático:
 * - Verde (>= 3.0 ★): Óptimo / Bueno
 * - Amarillo (2.5 ★): Alerta / Aceptable
 * - Rojo (<= 2.0 ★): Crítico / Bajo
 */
export default function CondicionCorporalStars({
  value = 3.0,
  onChange,
  readOnly = false,
  size = 'md', // 'sm' | 'md' | 'lg'
  showScore = true,
  showLabel = false,
}) {
  const numericVal = Math.min(5.0, Math.max(1.0, Number(value) || 3.0));

  // Determinar color de semáforo
  const isGreen = numericVal >= 3.0;
  const isYellow = numericVal >= 2.5 && numericVal < 3.0;
  const isRed = numericVal <= 2.0;

  const colorClass = isGreen
    ? 'text-emerald-500 fill-emerald-500'
    : isYellow
    ? 'text-amber-500 fill-amber-500'
    : 'text-red-500 fill-red-500';

  const badgeBg = isGreen
    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
    : isYellow
    ? 'bg-amber-50 text-amber-900 border-amber-300'
    : 'bg-red-50 text-red-900 border-red-300';

  const labelText = isGreen
    ? 'Óptima'
    : isYellow
    ? 'Aceptable'
    : 'Baja / Crítica';

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  const currentIconSize = iconSizes[size] || iconSizes.md;

  const handleStarClick = (starIndex, isHalf) => {
    if (readOnly || !onChange) return;
    const newVal = isHalf ? starIndex - 0.5 : starIndex;
    onChange(newVal);
  };

  return (
    <div className="inline-flex items-center gap-1.5 select-none whitespace-nowrap shrink-0">
      <div className="inline-flex items-center gap-0.5" title={`Condición Corporal: ${numericVal.toFixed(1)} ★ (${labelText})`}>
        {[1, 2, 3, 4, 5].map((starIndex) => {
          const isFull = numericVal >= starIndex;
          const isHalf = !isFull && numericVal >= starIndex - 0.5;

          return (
            <div
              key={starIndex}
              className={`relative inline-block ${readOnly ? '' : 'cursor-pointer hover:scale-110 transition-transform'}`}
              onClick={() => handleStarClick(starIndex, false)}
            >
              {/* Click izquierdo para media estrella si es interactivo */}
              {!readOnly && (
                <div
                  className="absolute inset-y-0 left-0 w-1/2 z-10 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStarClick(starIndex, true);
                  }}
                  title={`${(starIndex - 0.5).toFixed(1)} ★`}
                />
              )}

              {isFull ? (
                <Star className={`${currentIconSize} ${colorClass}`} />
              ) : isHalf ? (
                <div className="relative">
                  <Star className={`${currentIconSize} text-slate-300`} />
                  <div className="absolute inset-0 overflow-hidden w-[50%]">
                    <Star className={`${currentIconSize} ${colorClass}`} />
                  </div>
                </div>
              ) : (
                <Star className={`${currentIconSize} text-slate-200`} />
              )}
            </div>
          );
        })}
      </div>

      {showScore && (
        <span
          className={`px-1.5 py-0.5 rounded-md text-[10px] font-black border tabular-nums ${badgeBg}`}
        >
          {numericVal.toFixed(1)}
        </span>
      )}

      {showLabel && (
        <span
          className={`text-[10px] font-extrabold uppercase tracking-wider ${
            isGreen ? 'text-emerald-700' : isYellow ? 'text-amber-700' : 'text-red-700'
          }`}
        >
          {labelText}
        </span>
      )}
    </div>
  );
}
