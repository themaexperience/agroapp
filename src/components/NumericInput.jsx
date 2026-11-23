import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

/**
 * Convierte un número o cadena en representación formateada con separador de miles argentino (punto)
 * y coma decimal (es-AR). Ej: 90000 -> "90.000", 62.62 -> "62,62".
 */
export function formatArgentineNumber(val, allowDecimals = true, maxDecimals = 2) {
  if (val === null || val === undefined || val === '') {
    return '';
  }

  const str = String(val).trim();
  const isNegative = str.startsWith('-');
  const cleanStr = str.replace(/^-/, '');

  // Separar entero y decimal
  const parts = cleanStr.replace(',', '.').split('.');
  const intRaw = parts[0] || '0';
  const decRaw = parts.length > 1 ? parts[1] : null;

  const intNum = parseInt(intRaw, 10);
  const formattedInt = isNaN(intNum) ? '0' : intNum.toLocaleString('es-AR');

  if (allowDecimals && decRaw !== null && decRaw !== undefined) {
    const decClean = decRaw.slice(0, maxDecimals);
    return (isNegative ? '-' : '') + formattedInt + (decClean.length > 0 ? ',' + decClean : ',');
  }

  return (isNegative ? '-' : '') + formattedInt;
}

/**
 * Parsea un texto con formato argentino a número puro (o string vacío si no es válido)
 */
export function parseArgentineNumber(rawStr) {
  if (rawStr === null || rawStr === undefined || rawStr === '') return '';
  if (typeof rawStr === 'number') return isNaN(rawStr) ? '' : rawStr;

  const str = String(rawStr).trim();
  const isNegative = str.startsWith('-');
  const clean = str.replace(/^-/, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  if (isNaN(num)) return '';
  return isNegative ? -num : num;
}

/**
 * Limpia y formatea en tiempo real la entrada del usuario mientras tipea
 */
function cleanAndFormatInput(raw, allowDecimals = true, maxDecimals = 2) {
  if (raw === null || raw === undefined || raw === '') {
    return { formatted: '', numericValue: '' };
  }

  let str = String(raw).trim();
  const isNegative = str.startsWith('-');
  str = str.replace(/^-/, '');

  // Normalizar punto y coma
  if (str.includes(',') && str.includes('.')) {
    // Si contiene ambos, los puntos son miles y la coma es decimal
    str = str.replace(/\./g, '');
  } else if (!str.includes(',') && str.includes('.')) {
    // Si sólo contiene puntos: si tiene exactamente 1 punto y se permiten decimales
    const dotParts = str.split('.');
    if (allowDecimals && dotParts.length === 2 && dotParts[1].length <= maxDecimals) {
      str = str.replace('.', ',');
    } else {
      str = str.replace(/\./g, '');
    }
  }

  let [intRaw, ...decParts] = str.split(',');
  const hasComma = str.includes(',');

  // Quitar todo lo no numérico de la parte entera
  let intDigits = (intRaw || '').replace(/\D/g, '');

  // Eliminar el 0 inicial si el usuario tipea otros dígitos (ej. "09" -> "9")
  if (intDigits.length > 1) {
    intDigits = intDigits.replace(/^0+/, '') || '0';
  } else if (intDigits.length === 0 && hasComma) {
    intDigits = '0';
  }

  // Formatear enteros con punto de miles argentino
  let formattedInt = intDigits ? Number(intDigits).toLocaleString('es-AR') : '';
  if (!intDigits && hasComma) formattedInt = '0';

  let formattedDec = '';
  if (hasComma && allowDecimals) {
    const decDigits = decParts.join('').replace(/\D/g, '').slice(0, maxDecimals);
    formattedDec = ',' + decDigits;
  }

  const formatted = (isNegative ? '-' : '') + (formattedInt || (hasComma ? '0' : '')) + formattedDec;

  let numericValue = '';
  if (formattedInt || formattedDec) {
    const cleanDec = formattedDec.replace(',', '.');
    const numStr = (intDigits || '0') + cleanDec;
    const n = Number((isNegative ? '-' : '') + numStr);
    numericValue = isNaN(n) ? '' : n;
  }

  return { formatted, numericValue };
}

/**
 * NumericInput: Input numérico con separador de miles argentino (90.000 / 62,62)
 * tipo text con inputMode="decimal" para máxima compatibilidad móvil y de escritorio.
 */
export const NumericInput = forwardRef(function NumericInput(
  {
    value,
    onChange,
    onBlur,
    onFocus,
    onKeyDown,
    placeholder = '0',
    className = '',
    allowDecimals = true,
    maxDecimals = 2,
    selectOnFocus = true,
    min,
    max,
    disabled = false,
    readOnly = false,
    id,
    name,
    title,
    autoFocus = false,
    required = false,
    ...rest
  },
  ref
) {
  const internalInputRef = useRef(null);
  useImperativeHandle(ref, () => internalInputRef.current);

  const [isFocused, setIsFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(() => {
    return formatArgentineNumber(value, allowDecimals, maxDecimals);
  });

  // Sincronizar displayValue cuando el value externo cambia y el usuario no está tipeando activamente
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatArgentineNumber(value, allowDecimals, maxDecimals));
    } else {
      // Si está en foco, sincronizar solo si el valor numérico cambió sustancialmente desde afuera
      const currentParsed = parseArgentineNumber(displayValue);
      const incomingParsed = value === '' || value === null || value === undefined ? '' : Number(value);
      if (incomingParsed !== currentParsed && incomingParsed !== '') {
        setDisplayValue(formatArgentineNumber(value, allowDecimals, maxDecimals));
      }
    }
  }, [value, isFocused, allowDecimals, maxDecimals]);

  const handleChange = (e) => {
    const input = e.target;
    const rawVal = input.value;
    const selStart = input.selectionStart || 0;

    // Contar caracteres significativos (dígitos y coma) antes del cursor
    let meaningfulCharsBefore = 0;
    for (let i = 0; i < selStart; i++) {
      if (rawVal[i] !== '.') {
        meaningfulCharsBefore++;
      }
    }

    const { formatted, numericValue } = cleanAndFormatInput(rawVal, allowDecimals, maxDecimals);

    setDisplayValue(formatted);

    if (onChange) {
      onChange(numericValue, e);
    }

    // Preservar la posición del cursor para evitar saltos molestos al insertar puntos de miles
    requestAnimationFrame(() => {
      if (!internalInputRef.current) return;
      let newCursorPos = 0;
      let counted = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (counted >= meaningfulCharsBefore) {
          newCursorPos = i;
          break;
        }
        if (formatted[i] !== '.') {
          counted++;
        }
        newCursorPos = i + 1;
      }
      internalInputRef.current.setSelectionRange(newCursorPos, newCursorPos);
    });
  };

  const handleKeyDown = (e) => {
    // Si el usuario presiona el punto decimal en el teclado numérico o teclado común,
    // convertirlo automáticamente en coma decimal si se permiten decimales
    if (allowDecimals && (e.key === '.' || e.key === 'Decimal')) {
      e.preventDefault();
      const input = e.currentTarget;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const current = input.value;

      // Si ya tiene coma, no agregar otra
      if (current.includes(',')) return;

      const before = current.slice(0, start);
      const after = current.slice(end);
      const injected = before + ',' + after;

      const { formatted, numericValue } = cleanAndFormatInput(injected, allowDecimals, maxDecimals);
      setDisplayValue(formatted);
      if (onChange) onChange(numericValue, e);

      requestAnimationFrame(() => {
        if (!internalInputRef.current) return;
        const commaIdx = formatted.indexOf(',');
        const targetPos = commaIdx >= 0 ? commaIdx + 1 : formatted.length;
        internalInputRef.current.setSelectionRange(targetPos, targetPos);
      });
      return;
    }

    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const handleFocus = (e) => {
    setIsFocused(true);
    if (selectOnFocus || displayValue === '0') {
      e.target.select();
    }
    if (onFocus) {
      onFocus(e);
    }
  };

  const handleBlur = (e) => {
    setIsFocused(false);

    // Al perder el foco, eliminar coma final suelta (ej: "62," -> "62")
    let cleaned = displayValue;
    if (cleaned.endsWith(',')) {
      cleaned = cleaned.slice(0, -1);
      setDisplayValue(cleaned);
      const num = parseArgentineNumber(cleaned);
      if (onChange) onChange(num, e);
    }

    // Verificar límites min y max si fueron provistos
    if (min !== undefined && min !== null) {
      const curNum = parseArgentineNumber(cleaned);
      if (curNum !== '' && curNum < Number(min)) {
        const clamped = Number(min);
        setDisplayValue(formatArgentineNumber(clamped, allowDecimals, maxDecimals));
        if (onChange) onChange(clamped, e);
      }
    }
    if (max !== undefined && max !== null) {
      const curNum = parseArgentineNumber(cleaned);
      if (curNum !== '' && curNum > Number(max)) {
        const clamped = Number(max);
        setDisplayValue(formatArgentineNumber(clamped, allowDecimals, maxDecimals));
        if (onChange) onChange(clamped, e);
      }
    }

    if (onBlur) {
      onBlur(e);
    }
  };

  return (
    <input
      ref={internalInputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      readOnly={readOnly}
      id={id}
      name={name}
      title={title}
      autoFocus={autoFocus}
      required={required}
      {...rest}
    />
  );
});

export default NumericInput;
