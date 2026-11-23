// src/utils/gemini.js - Puente y re-export del Servicio Central de Google Gemini IA
// Establecimiento San José · Agroganadera Rincón del Sur S.A.
export * from '../lib/geminiService.js';
export * from './preciosRefHelper.js';
export {
  extraerRecetaAgronomica,
  extraerFacturaOCotizacion,
  extraerPlanillaLabores,
  calcularAritmeticaReceta,
  calcularAritmeticaFacturaOCotizacion,
  calcularAritmeticaPlanillaLabores,
  cruzarRecetaConCotizacion,
  prepararArchivosParaGemini,
  findMatchingPotreroHelper,
  sanitizarRecetaAgronomicaOutput,
  sanitizarFacturaOCotizacionOutput,
  sanitizarPlanillaLaboresOutput,
} from '../lib/geminiService.js';
export { default } from '../lib/geminiService.js';
