// src/lib/pdfSlicer.js
// Utilidad central de procesamiento, corte y compresión de PDFs multipágina en el navegador
// Convierte cada página de un PDF en imagen JPEG optimizada (< 800 KB por página)
// y orquesta el despacho en lotes con concurrencia controlada para no desbordar Vercel (límite 4.5 MB).
// Configurado con worker compatible con Vite y fallback automático a PDF directo (<= 2.5 MB).

import * as pdfjsDist from 'pdfjs-dist';

let cachedPdfJs = null;

// Límite para envío directo de PDF nativo sin necesidad obligatoria de trozado
export const MAX_DIRECT_PDF_BYTES = 2.5 * 1024 * 1024; // 2.5 MB

// URL CDN de contingencia para el worker de PDF.js
export const PDFJS_WORKER_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/**
 * Configura el worker de PDF.js de forma compatible con Vite y el navegador
 * @param {Object} lib Instancia de pdfjsLib
 */
export function configurePdfJsWorker(lib) {
  if (!lib) return;
  try {
    if (!lib.GlobalWorkerOptions) {
      lib.GlobalWorkerOptions = {};
    }
    if (lib.GlobalWorkerOptions.workerSrc) return;

    // 1. Probar URL generada por Vite si import.meta.url no es un blob
    if (
      typeof import.meta !== 'undefined' &&
      import.meta.url &&
      !import.meta.url.startsWith('blob:')
    ) {
      try {
        lib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
        return;
      } catch (e) {}
    }

    // 2. Fallback a CDN oficial
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  } catch (err) {
    console.warn('[pdfSlicer] Advertencia al configurar GlobalWorkerOptions.workerSrc:', err);
  }
}

// Configurar inmediatamente si window.pdfjsLib ya existe por el script CDN en index.html
if (typeof window !== 'undefined' && window.pdfjsLib) {
  configurePdfJsWorker(window.pdfjsLib);
}

/**
 * Determina si un archivo dado es de tipo PDF
 * @param {File|Blob|Object} file
 * @returns {boolean}
 */
export function isPdfFile(file) {
  if (!file) return false;
  const mime = file.type || '';
  if (mime === 'application/pdf') return true;
  const name = file.name || '';
  return name.toLowerCase().endsWith('.pdf');
}

/**
 * Obtiene o inicializa la librería PDF.js (vía window.pdfjsLib, importmap de Vite o esm.sh)
 */
export async function getPdfJs() {
  if (cachedPdfJs) return cachedPdfJs;

  // 1. Probar instancia global (cargada vía CDN en index.html)
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    configurePdfJsWorker(window.pdfjsLib);
    cachedPdfJs = window.pdfjsLib;
    return cachedPdfJs;
  }

  // 2. Probar módulo estático importado (resolución Vite / ESM importmap)
  try {
    const lib = pdfjsDist?.getDocument
      ? pdfjsDist
      : pdfjsDist?.default?.getDocument
      ? pdfjsDist.default
      : null;

    if (lib) {
      configurePdfJsWorker(lib);
      cachedPdfJs = lib;
      return cachedPdfJs;
    }
  } catch (err) {
    console.warn('[pdfSlicer] Advertencia resolviendo import estático:', err);
  }

  // 3. Probar import map o dynamic import de esm.sh
  try {
    const mod = await import('https://esm.sh/pdfjs-dist@3.11.174');
    const lib = mod.default?.getDocument ? mod.default : (mod.getDocument ? mod : mod.default);
    if (lib) {
      configurePdfJsWorker(lib);
      cachedPdfJs = lib;
      return cachedPdfJs;
    }
  } catch (err) {
    console.warn('[pdfSlicer] Error importando pdfjs-dist desde esm.sh:', err);
  }

  // 4. Reintento sobre window
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    configurePdfJsWorker(window.pdfjsLib);
    cachedPdfJs = window.pdfjsLib;
    return cachedPdfJs;
  }

  throw new Error('No se pudo inicializar el lector de PDFs en el navegador.');
}

/**
 * Renderiza una página individual de un PDF en un canvas y la exporta como File JPEG < 800 KB
 *
 * @param {Object} pdfDocument Documento cargado con PDF.js
 * @param {number} pageNumber Número de página (1-based)
 * @param {number} [maxWidth=1600] Ancho máximo del render
 * @param {number} [quality=0.82] Calidad de compresión JPEG
 * @returns {Promise<File|null>}
 */
export async function convertPdfPageToImage(
  pdfDocument,
  pageNumber,
  maxWidth = 1600,
  quality = 0.82
) {
  const page = await pdfDocument.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1 });

  // Escalar para que el ancho sea de ~1600px (nitidez óptima para tipografía fiscal)
  let scale = 1.35;
  if (unscaledViewport.width > 0) {
    if (unscaledViewport.width > maxWidth) {
      scale = maxWidth / unscaledViewport.width;
    } else if (unscaledViewport.width < 1000) {
      scale = 1000 / unscaledViewport.width;
    }
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error(`No se pudo obtener el contexto 2D para renderizar la página ${pageNumber}.`);
  }

  // Fondo blanco obligatorio para evitar fondos negros en documentos PDF transparentes
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: ctx,
    viewport,
  };

  await page.render(renderContext).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0) {
          reject(new Error(`El renderizado de la página ${pageNumber} produjo una imagen vacía.`));
          return;
        }
        const file = new File(
          [blob],
          `pagina_${pageNumber}.jpg`,
          { type: 'image/jpeg', lastModified: Date.now() }
        );
        resolve(file);
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Troza un archivo PDF completo en un array de archivos JPEG (File/Blob), uno por página.
 * Con FALLBACK AUTOMÁTICO:
 * - Si el PDF pesa <= 2.5 MB (factura típica de 1-2 págs) y el renderizado falla por cualquier motivo,
 *   retorna directamente el archivo PDF original con mimeType 'application/pdf'.
 * - Si pesa > 2.5 MB, lo renderiza página por página a JPEG (quality: 0.82, ancho máx 1600px).
 *
 * @param {File|Blob} pdfFile Archivo PDF
 * @param {Object} [options]
 * @param {number} [options.maxPages=50] Máximo de páginas a procesar
 * @param {number} [options.maxWidth=1600] Ancho máximo en píxeles
 * @param {number} [options.quality=0.82] Calidad de compresión
 * @param {Function} [options.onProgress] Callback de progreso ({ current, total })
 * @returns {Promise<Array<{ pageNumber: number, file: File, totalPages: number, isPdf: boolean, mimeType: string }>>}
 */
export async function slicePdfToImages(
  pdfFile,
  {
    maxPages = 50,
    maxWidth = 1600,
    quality = 0.82,
    onProgress = null,
  } = {}
) {
  if (!isPdfFile(pdfFile)) {
    return [{
      pageNumber: 1,
      file: pdfFile,
      totalPages: 1,
      isPdf: false,
      mimeType: pdfFile?.type || 'image/jpeg',
    }];
  }

  const isSmallPdf = (pdfFile.size || 0) <= MAX_DIRECT_PDF_BYTES;

  try {
    const pdfjs = await getPdfJs();
    const arrayBuffer = await pdfFile.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const totalPages = pdf.numPages || 1;

    // Si es un PDF de 1 página <= 2.5 MB, Gemini lo procesa directamente con mayor fidelidad
    if (totalPages === 1 && isSmallPdf) {
      return [{
        pageNumber: 1,
        file: pdfFile,
        totalPages: 1,
        isPdf: true,
        mimeType: 'application/pdf',
      }];
    }

    const pagesToProcess = Math.min(totalPages, maxPages);
    const results = [];

    for (let i = 1; i <= pagesToProcess; i++) {
      onProgress?.({ current: i, total: pagesToProcess });
      const imgFile = await convertPdfPageToImage(pdf, i, maxWidth, quality);
      if (imgFile && imgFile.size > 0) {
        results.push({
          pageNumber: i,
          file: imgFile,
          totalPages,
          isPdf: false,
          mimeType: 'image/jpeg',
        });
      }
    }

    if (results.length > 0) {
      return results;
    }

    throw new Error('No se generaron imágenes válidas a partir de las páginas del PDF.');
  } catch (err) {
    console.warn('[pdfSlicer] Renderizado canvas no disponible o falló. Activando fallback automático:', err.message);

    // Fallback automático para PDFs <= 2.5 MB (o hasta 4 MB si no desborda Vercel)
    if (isSmallPdf || (pdfFile.size || 0) <= 4.0 * 1024 * 1024) {
      return [{
        pageNumber: 1,
        file: pdfFile,
        totalPages: 1,
        isPdf: true,
        mimeType: 'application/pdf',
      }];
    }

    // Si es un archivo muy grande (>4 MB) y falló el renderizado, reportar causa técnica
    throw new Error(
      `El PDF es superior a 4 MB (${((pdfFile.size || 0) / (1024 * 1024)).toFixed(1)} MB) y falló la partición por páginas: ${err.message}`
    );
  }
}

/**
 * Ejecuta una lista de tareas asíncronas con concurrencia controlada (ej: lotes de 3 a la vez)
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} workerFn
 * @param {number} [concurrency=3]
 * @returns {Promise<R[]>}
 */
export async function runWithControlledConcurrency(items, workerFn, concurrency = 3) {
  if (!items || items.length === 0) return [];
  const results = new Array(items.length);
  let currentIndex = 0;

  const workersCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workersCount }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      try {
        results[idx] = await workerFn(items[idx], idx);
      } catch (err) {
        console.error(`[pdfSlicer] Error en tarea concurrent #${idx}:`, err);
        results[idx] = { error: err };
      }
    }
  });

  await Promise.all(workers);
  return results;
}
