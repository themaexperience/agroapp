// src/config/version.js
// Configuración centralizada de versión y sprint de Establecimiento San José
// Agroganadera Rincón del Sur S.A. · Las Flores, Bs. As.
//
// ============================================================================
// ⚠️  REGLA PERMANENTE Y OBLIGATORIA DE VERSIONADO PARA AGENTES Y DESARROLLADORES:
// En cada nuevo sprint, feature o hotfix desplegado a producción, SE DEBE
// INCREMENTAR obligatoriamente este número de sprint/versión antes de ejecutar
// `npm run build` y publicar en Vercel / GitHub.
// ============================================================================

export const APP_VERSION = 'Sprint 30.97 — Hotfix Calendario: Reparación de Cierre JSX en Celdas Mensuales (v2.30.97)';
export const APP_SPRINT = 'Sprint 30.97 — Hotfix CalendarioView: Reparar Cierre de className JSX en Celdas del Mes';
export const APP_VERSION_LABEL = 'Sprint 30.97 Activo — Hotfix Celdas de Calendario';
export const APP_LAST_DEPLOY = '22/11/2026';

export default {
  APP_VERSION,
  APP_SPRINT,
  APP_VERSION_LABEL,
  APP_LAST_DEPLOY,
};
