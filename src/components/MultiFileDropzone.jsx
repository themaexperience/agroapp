import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Image, Trash2, Plus, Sparkles, AlertCircle } from 'lucide-react';

/**
 * Componente reutilizable de Drag & Drop y selección múltiple de archivos
 * para todos los importadores asistidos por IA.
 * 
 * Arquitectura HTML5 infalible:
 * - Overlay transparente de <input type="file" multiple> cubriendo el 100% de la caja.
 * - Prevención global de window dragover/drop para evitar que Chrome abra archivos arrastrados en nuevas pestañas.
 * - Acumulación reactiva en bandeja previa (Array.from) sin duplicados.
 */
export default function MultiFileDropzone({
  files = [],
  onFilesChange,
  accept = '.pdf,.xlsx,.xls,.csv,.docx,.doc,image/*',
  disabled = false,
  isProcessing = false,
  onProcessBatch,
  title = 'Arrastrá o seleccioná uno o varios archivos',
  subtitle = 'Soporta PDFs, planillas Excel, CSVs, recetas, remitos, facturas y liquidaciones. Podés soltar varios a la vez.',
  processButtonText = '✨ Analizar y Cruzar Lote con IA',
  contextText = '',
  onContextTextChange,
  contextPlaceholder = 'Ej: Sembramos sorgo a 25 kg/ha (bolsa 25 kg a USD 79). El glifosato lo pagamos USD 4,20/L. El Lote 10 Loma es fumigación sobre maíz ya sembrado...',
  contextLabel = '📝 Contexto, Precios o Aclaraciones para la IA (Opcional)',
  allowTextOnly = true,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef(null);

  // Bloqueo global de Drag & Drop en window para evitar que Chrome abra archivos en pestaña nueva
  useEffect(() => {
    function preventGlobalDrop(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener('dragover', preventGlobalDrop, false);
    window.addEventListener('drop', preventGlobalDrop, false);
    return () => {
      window.removeEventListener('dragover', preventGlobalDrop, false);
      window.removeEventListener('drop', preventGlobalDrop, false);
    };
  }, []);

  function addFiles(incomingFiles) {
    if (disabled || isProcessing) return;
    const list = Array.from(incomingFiles || []);
    if (list.length === 0) return;

    const currentList = Array.isArray(files) ? [...files] : [];
    list.forEach((file) => {
      const exists = currentList.some(
        (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
      );
      if (!exists) {
        currentList.push(file);
      }
    });

    onFilesChange?.(currentList);
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer && e.dataTransfer.types) {
      setIsDragging(true);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const droppedFiles = Array.from(e.dataTransfer?.files || e.target?.files || []);
    addFiles(droppedFiles);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleFileInputChange(e) {
    const selectedFiles = Array.from(e.target?.files || []);
    addFiles(selectedFiles);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleRemoveFile(indexToRemove) {
    if (disabled || isProcessing) return;
    const updated = files.filter((_, idx) => idx !== indexToRemove);
    onFilesChange?.(updated);
  }

  function handleClearAll() {
    if (disabled || isProcessing) return;
    onFilesChange?.([]);
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  return (
    <div className="w-full space-y-3">
      {/* Zona de Drop / Clic HTML5 con overlay de input absolute */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-all select-none overflow-hidden cursor-pointer ${
          isDragging
            ? 'border-emerald-500 bg-emerald-50/90 ring-4 ring-emerald-200/60 scale-[1.01]'
            : 'border-slate-300 hover:border-emerald-500 hover:bg-slate-50/70 bg-white'
        } ${disabled || isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {/* Input invisible que cubre el 100% de la caja para que los clics y el drop caigan nativamente sobre él */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleFileInputChange}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          disabled={disabled || isProcessing}
          title=""
        />

        <div className="flex flex-col items-center justify-center pointer-events-none relative z-10">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-colors ${
              isDragging ? 'bg-emerald-600 text-white shadow-md' : 'bg-emerald-100/90 text-emerald-800'
            }`}
          >
            <UploadCloud className="w-7 h-7" />
          </div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md">{subtitle}</p>
          <div className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 shadow-2xs">
            <span>📎 Clic para explorar o arrastrá lote completo aquí</span>
          </div>
        </div>
      </div>

      {/* Caja de Contexto / Precios / Instrucciones para la IA (con o sin archivos) */}
      {typeof onContextTextChange === 'function' && (
        <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>{contextLabel}</span>
            </label>
            {contextText && contextText.trim() ? (
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                ⚡ Prioridad Alta IA
              </span>
            ) : null}
          </div>
          <textarea
            rows={3}
            value={contextText || ''}
            onChange={(e) => onContextTextChange(e.target.value)}
            disabled={disabled || isProcessing}
            placeholder={contextPlaceholder}
            className="w-full p-2.5 rounded-xl border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200/50 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none transition leading-relaxed resize-y"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              💡 Podés analizar con o sin archivos adjuntos: la IA tomará estas indicaciones como directiva prioritaria.
            </span>
            {allowTextOnly && files.length === 0 && contextText && contextText.trim().length > 0 && onProcessBatch && (
              <button
                type="button"
                onClick={onProcessBatch}
                disabled={disabled || isProcessing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold rounded-xl text-xs shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>✨ Analizar Indicaciones con IA</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bandeja de archivos en cola */}
      {files.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>📋 Cola de Archivos para Cruzar:</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                {files.length} {files.length === 1 ? 'archivo' : 'archivos'}
              </span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (fileInputRef.current) fileInputRef.current.click();
                }}
                disabled={disabled || isProcessing}
                className="text-xs font-medium text-emerald-800 hover:text-emerald-950 flex items-center gap-1 px-2 py-1 rounded bg-white border border-slate-200 hover:border-emerald-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar más</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearAll();
                }}
                disabled={disabled || isProcessing}
                className="text-xs text-rose-700 hover:text-rose-900 px-2 py-1 rounded hover:bg-rose-50 transition-colors"
              >
                Vaciar
              </button>
            </div>
          </div>

          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
            {files.map((file, idx) => {
              const isPdf = file.name.toLowerCase().endsWith('.pdf');
              return (
                <div
                  key={`${file.name}-${file.size}-${idx}`}
                  className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    {isPdf ? (
                      <FileText className="w-4 h-4 text-rose-700 shrink-0" />
                    ) : (
                      <Image className="w-4 h-4 text-blue-700 shrink-0" />
                    )}
                    <span className="font-medium text-slate-800 truncate" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-slate-600 shrink-0 text-[11px]">
                      ({formatFileSize(file.size)})
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(idx);
                    }}
                    disabled={disabled || isProcessing}
                    title="Quitar de la lista"
                    className="p-1 text-slate-500 hover:text-rose-700 rounded hover:bg-slate-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Botón de acción para procesar todo el lote */}
          {onProcessBatch && (
            <div className="pt-2 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={onProcessBatch}
                disabled={disabled || isProcessing || (files.length === 0 && (!contextText || !contextText.trim()))}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {isProcessing
                    ? 'Procesando y cruzando lote con IA...'
                    : `${processButtonText} (${files.length}${contextText && contextText.trim() ? ' + Contexto' : ''})`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
