# Establecimiento San José
**Agroganadera Rincón del Sur S.A. · Las Flores, Pcia. de Buenos Aires**  
*Superficie Total: 2.068 ha · Sistema de Gestión Integral Ganadera, Agrícola, Financiera y Operativa*

---

## 📌 Control de Versiones y Sprints

El estado y la versión activa de la aplicación se centralizan en [`src/config/version.js`](./src/config/version.js):

- **Versión Activa:** `Sprint 8 Activo (v2.8)`
- **Fecha de Despliegue:** 16 de Noviembre de 2026

> ### ⚠️ REGLA OBLIGATORIA DE VERSIONADO
> En cada sprint, funcionalidad o hotfix desplegado, se debe **incrementar obligatoriamente** el identificador en `src/config/version.js` (y en `package.json`) antes de ejecutar `npm run build` y publicar.

---

## 🚀 Arquitectura Técnica

- **Frontend:** React 18 SPA con Tailwind CSS y componentes modulares.
- **Carga Modular:** Módulos ES con transpilación Babel Standalone y resolución en `index.html`.
- **Base de Datos & Auth:** Supabase PostgreSQL con autenticación, sincronización en tiempo real y soporte offline (`offlineQueue.js`).
- **Inteligencia Artificial:** Google Gemini 2.5 Flash / 2.0 Flash con endpoint Serverless `/api/gemini` en Vercel.
- **Procesamiento de Documentos:**
  - Facturas y comprobantes con OCR y auditoría fiscal.
  - Partición y compresión de PDFs multipágina (`src/lib/pdfSlicer.js`) con fallback automático a PDF nativo.
  - Romaneos y liquidaciones de hacienda con desglose por categorías y kilos.
  - Balances contables anuales del Estudio Contable.

---

## 🛠️ Scripts del Proyecto

```bash
# Validar compilación de todos los módulos, resolución de imports y generar dist/
npm run build

# Desplegar a producción en Vercel
vercel --scope agroganadera --prod --yes
```
