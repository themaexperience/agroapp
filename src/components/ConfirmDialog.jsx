import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, HelpCircle } from 'lucide-react';

let globalConfirmHandler = null;

export function confirmAction(options) {
  if (globalConfirmHandler) {
    return globalConfirmHandler(options);
  }
  // Fallback si no está montado aún
  return Promise.resolve(true);
}

// Atajo global para máxima compatibilidad
if (typeof window !== 'undefined') {
  window.__confirmAction = confirmAction;
}

export function ConfirmDialog() {
  const [dialogState, setDialogState] = useState(null);

  useEffect(() => {
    globalConfirmHandler = (options) => {
      return new Promise((resolve) => {
        setDialogState({
          ...options,
          resolve,
        });
      });
    };
    return () => {
      globalConfirmHandler = null;
    };
  }, []);

  useEffect(() => {
    if (!dialogState) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogState]);

  if (!dialogState) return null;

  const {
    title = '¿Confirmar acción?',
    description = 'Esta acción no se puede deshacer.',
    confirmText = 'Sí, eliminar',
    cancelText = 'Cancelar',
    variant = 'danger',
    resolve,
  } = dialogState;

  const handleClose = (result) => {
    setDialogState(null);
    if (resolve) resolve(result);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => handleClose(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-md p-5 sm:p-6 overflow-hidden animate-in zoom-in-95 duration-150 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3.5">
          {variant === 'danger' && (
            <div className="w-11 h-11 rounded-2xl bg-red-100 border border-red-200 text-red-600 flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
          )}
          {variant === 'warning' && (
            <div className="w-11 h-11 rounded-2xl bg-amber-100 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          {variant !== 'danger' && variant !== 'warning' && (
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 border border-emerald-200 text-emerald-800 flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
          )}

          <div className="flex-1 min-w-0 pr-1">
            <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-snug">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-slate-600 font-medium leading-relaxed mt-1">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="min-h-[42px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs transition cursor-pointer flex-1 sm:flex-initial sm:min-w-[100px]"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => handleClose(true)}
            className={`min-h-[42px] px-4 py-2.5 rounded-xl text-white font-black text-xs transition cursor-pointer shadow-sm flex-1 sm:flex-initial sm:min-w-[120px] active:scale-95 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                : variant === 'warning'
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                : 'bg-emerald-800 hover:bg-emerald-900 shadow-emerald-800/20'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
