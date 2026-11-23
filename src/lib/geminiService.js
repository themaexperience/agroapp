// Servicio Central de Integración con Google Gemini IA para Establecimiento San José
// Configurado con URL oficial, modelo gemini-2.5-flash y header X-goog-api-key
// En desarrollo y en producción usa /api/gemini con fallback ultra-rápido y compresión en cliente.
import { isPdfFile, slicePdfToImages, runWithControlledConcurrency } from './pdfSlicer.js';
import { supabase } from './supabase.js';
import { optimizarRutaGeografica } from '../utils/geoParser';
import { calcRodeoCabezas, calcRodeoToros, isRodeoEnServicio } from '../utils/rodeoHelpers.js';
import {
  buscarUltimoPrecioInsumo,
  buscarUltimoPrecioLabor,
  normalizarNombreInsumo,
  getPreciosHaciendaRef,
  getHistorialPresupuestos,
  guardarPresupuestoEnCatalogo,
} from '../utils/preciosRefHelper.js';
import * as XLSX from 'xlsx';

export {
  isPdfFile,
  buscarUltimoPrecioInsumo,
  buscarUltimoPrecioLabor,
  normalizarNombreInsumo,
  getPreciosHaciendaRef,
  getHistorialPresupuestos,
  guardarPresupuestoEnCatalogo,
};

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const GEMINI_PRO_MODEL = 'gemini-2.5-pro';
export const RESILIENT_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const PREFERRED_FLASH_MODELS = RESILIENT_MODELS;

/**
 * Obtiene el contexto vivo operativo, financiero y agronómico actual de Establecimiento San José
 */
export function obtenerContextoVivoEstablecimiento(customOverrides = {}) {
  let dolarRef = 1665;
  try {
    const storedDolar = localStorage.getItem('sanjose_dolar_ref') || localStorage.getItem('dolar_referencia');
    if (storedDolar) {
      const parsedDolar = parseFloat(storedDolar);
      if (parsedDolar > 0) dolarRef = parsedDolar;
    }
  } catch {}
  if (customOverrides.dolarRef && Number(customOverrides.dolarRef) > 0) {
    dolarRef = Number(customOverrides.dolarRef);
  }

  let sandboxData = null;
  try {
    const raw = localStorage.getItem('san_jose_sandbox_data');
    if (raw) sandboxData = JSON.parse(raw);
  } catch {}

  const potreros = customOverrides.potreros || sandboxData?.potreros || [];
  const siembras = customOverrides.siembras || sandboxData?.labores_siembras || sandboxData?.siembras || [];
  const rodeos = customOverrides.rodeos || sandboxData?.rodeos || [];

  return {
    dolarRef,
    potreros,
    siembras,
    rodeos,
  };
}

/**
 * Compila una sección de texto para el System Prompt con el contexto vivo de San José
 */
export function compilarPromptContextoVivo(contexto = {}) {
  const ctx = { ...obtenerContextoVivoEstablecimiento(), ...contexto };
  const { dolarRef, potreros, siembras, rodeos } = ctx;

  let txt = `\n=== CONTEXTO OPERATIVO Y CONTABLE VIVO DE ESTABLECIMIENTO SAN JOSÉ ===\n`;
  txt += `• Ubicación: Las Flores, Pcia. de Buenos Aires. Titular: Agroganadera Rincón del Sur S.A. (2.068 ha).\n`;
  txt += `• Cotización Dólar Referencia vigente en el sistema: ARS $${dolarRef.toLocaleString('es-AR')} por USD 1.\n`;

  if (Array.isArray(potreros) && potreros.length > 0) {
    txt += `• Potreros Oficiales del Establecimiento (${potreros.length} potreros registrados):\n`;
    potreros.slice(0, 45).forEach((p) => {
      const num = p.numero || p.id;
      const nom = p.nombre ? `"${p.nombre}"` : '';
      const ha = p.hectareas || p.superficie_ha || 0;
      const sec = p.sector ? ` (Sector: ${p.sector})` : '';
      const cult = p.cultivo_actual ? ` [Cultivo actual: ${p.cultivo_actual}]` : '';
      txt += `   - Potrero #${num} ${nom} - ${ha} ha${sec}${cult}\n`;
    });
  }

  const siembrasActivas = Array.isArray(siembras)
    ? siembras.filter((s) => {
        const st = String(s.estado || '').toLowerCase();
        return (
          !s.archivado &&
          !s.archivada &&
          !['archivado', 'archivada', 'finalizado', 'finalizada', 'cerrado'].includes(st)
        );
      })
    : [];

  if (siembrasActivas.length > 0) {
    txt += `• Siembras y Cultivos ACTIVOS en curso en los lotes (¡ATENCIÓN: Si un documento refiere a estos lotes con tareas de fumigación/fertilización/disco, se trata de una labor o aplicación sobre el cultivo existente, no de una siembra nueva desde cero!):\n`;
    siembrasActivas.slice(0, 20).forEach((s) => {
      const pNum = s.potrero_numero || s.potrero_id || (s.potreros && s.potreros.numero) || '?';
      const cult = s.cultivo || s.cultivo_o_labor || s.cultivo_variedad || 'Cultivo';
      const ha = s.superficie_ha || s.hectareas || 0;
      const sec = s.sector ? ` (Sector: ${s.sector})` : '';
      txt += `   - Potrero #${pNum}${sec}: ${cult} (${ha} ha)\n`;
    });
  }

  if (Array.isArray(rodeos) && rodeos.length > 0) {
    txt += `• Rodeos y Categorías Ganaderas Activas en San José:\n`;
    rodeos.slice(0, 15).forEach((r) => {
      const nom = r.nombre || r.categoria || 'Rodeo';
      const cab = r.cabezas || r.cantidad || 0;
      txt += `   - ${nom}: ${cab} cabezas\n`;
    });
  }

  txt += `========================================================================\n`;
  return txt;
}

export function isProduction() {
  if (typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD)) {
    return true;
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1' && h !== '0.0.0.0') {
      return true;
    }
  }
  return false;
}

export function formatGeminiErrorMessage(rawError) {
  if (!rawError) return 'Error desconocido al invocar Gemini IA.';
  let msg = typeof rawError === 'string' ? rawError : rawError.message || JSON.stringify(rawError);

  // Si contiene un objeto JSON de error embebido {"error": ...}
  if (msg.includes('{"error"') || msg.includes('{\n  "error"') || msg.includes('{\\n  "error"')) {
    try {
      const startIdx = msg.indexOf('{');
      const endIdx = msg.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = msg.slice(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.error?.message) {
          msg = parsed.error.message;
        } else if (typeof parsed.error === 'string') {
          msg = parsed.error;
        }
      }
    } catch {}
  }

  msg = String(msg).replace(/^Error:\s*/i, '').trim();
  return msg || 'Error al procesar con Gemini IA.';
}

export function getGeminiEndpoint(targetModel = DEFAULT_GEMINI_MODEL) {
  // En desarrollo (Vite) y en producción (Vercel Serverless Function), siempre enruta vía /api/gemini.
  // Esto protege la API key en el servidor y evita bloqueos de CORS o petición de claves al usuario en celular.
  return '/api/gemini';
}

export function getGeminiApiKey() {
  try {
    if (typeof window !== 'undefined' && window.__ENV__?.VITE_GEMINI_API_KEY) {
      const k = window.__ENV__.VITE_GEMINI_API_KEY.trim();
      if (k.length > 5) return k;
    }
  } catch {}
  try {
    const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY;
    if (fromEnv && fromEnv.trim().length > 5) return fromEnv.trim();
  } catch {}
  try {
    const fromStorage = localStorage.getItem('sanjose_gemini_api_key');
    if (fromStorage && fromStorage.trim().length > 5) return fromStorage.trim();
  } catch {}
  return '';
}

export function setGeminiApiKey(key) {
  try {
    if (!key) {
      localStorage.removeItem('sanjose_gemini_api_key');
    } else {
      localStorage.setItem('sanjose_gemini_api_key', key.trim());
    }
  } catch (e) {
    console.error('Error guardando clave de Gemini:', e);
  }
}

export function hasGeminiKey() {
  // En producción (online) el servidor Vercel provee la API Key automáticamente sin pedirla al usuario
  if (isProduction()) return true;
  return Boolean(getGeminiApiKey());
}

export async function getActiveGeminiModel() {
  return DEFAULT_GEMINI_MODEL;
}

export async function testGeminiConnection() {
  const apiKey = getGeminiApiKey();
  if (!apiKey && !isProduction()) {
    throw new Error('Falta VITE_GEMINI_API_KEY en .env o en el almacenamiento local.');
  }
  try {
    const res = await callGeminiApi({
      prompt: 'Respondé solo: Conexión OK con Establecimiento San José',
      timeoutMs: 25000,
    });
    return res.trim();
  } catch (err) {
    throw new Error(formatGeminiErrorMessage(err));
  }
}
export const probarConexionIA = testGeminiConnection;

// Helper de compresión automática de imágenes (evita desbordar Gemini y bloquea Base64 en localStorage)
export async function compressImage(file, maxWidth = 1200, quality = 0.72) {
  if (!file || !(file instanceof Blob)) return file;
  const mime = file.type || '';
  if (!mime.startsWith('image/')) return file;
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const { width, height } = img;

        let targetWidth = width;
        let targetHeight = height;

        if (width > maxWidth) {
          targetWidth = maxWidth;
          targetHeight = Math.round((height * maxWidth) / width);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        // Fondo blanco para imágenes con canal alfa convertidas a JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const originalName = file.name || 'comprobante.jpg';
            const newName = originalName.replace(/\.[^.]+$/, '') + '.jpg';
            const compressedFile = new File([blob], newName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };

      img.src = objectUrl;
    } catch (e) {
      console.warn('Error en compressImage, usando archivo original:', e);
      resolve(file);
    }
  });
}

// Subida opcional a Firebase Storage o Supabase Storage si está activo (solo guarda downloadURL)
export async function uploadCompressedImageIfStorageActive(compressedFile, folder = 'comprobantes') {
  if (!compressedFile) return null;

  // 1. Firebase Storage si está configurado en el navegador
  try {
    if (typeof window !== 'undefined' && window.firebaseStorage) {
      const storageRef = window.firebaseStorage.ref(`${folder}/${Date.now()}_${compressedFile.name || 'foto.jpg'}`);
      const snapshot = await storageRef.put(compressedFile);
      const downloadURL = await snapshot.ref.getDownloadURL();
      return downloadURL;
    }
  } catch (err) {
    console.warn('Firebase Storage no activo o error al subir:', err);
  }

  // 2. Supabase Storage si está disponible el cliente con bucket
  try {
    if (typeof window !== 'undefined' && window.__SUPABASE_CLIENT__) {
      const client = window.__SUPABASE_CLIENT__;
      const fileName = `${folder}/${Date.now()}_${compressedFile.name || 'foto.jpg'}`;
      const { data, error } = await client.storage.from('documentos').upload(fileName, compressedFile);
      if (!error && data?.path) {
        const { data: pubUrl } = client.storage.from('documentos').getPublicUrl(data.path);
        return pubUrl?.publicUrl || null;
      }
    }
  } catch (err) {}

  return null;
}

export function getFileMimeType(file) {
  if (!file) return 'image/jpeg';
  if (isPdfFile(file) || file.type === 'application/pdf') return 'application/pdf';
  if (file.type && file.type.startsWith('image/')) return file.type;
  return file.type || 'image/jpeg';
}

export async function fileToBase64(file) {
  if (!file) return null;
  let fileToConvert = file;
  // Solo aplicar compressImage si es imagen pura y no es PDF
  if (file.type?.startsWith('image/') && !isPdfFile(file)) {
    try {
      fileToConvert = await compressImage(file, 1600, 0.82);
    } catch (err) {
      console.warn('Compresión previa omitida:', err);
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Formato de lectura de archivo no válido.'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(fileToConvert);
  });
}

function cleanJsonResponse(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Quitar bloques de código ```json ... ```
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/i, '');
  }
  return cleaned.trim();
}

export async function callGeminiApi({
  prompt,
  systemPrompt,
  fileBase64 = null,
  mimeType = null,
  files = null,
  responseJson = false,
  model = DEFAULT_GEMINI_MODEL,
  timeoutMs = 50000,
  maxOutputTokens = 8192,
  temperature = null,
  contents: customContents = null,
  tools = null,
}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey && !isProduction()) {
    throw new Error(
      'Falta configurar la clave de Gemini IA (VITE_GEMINI_API_KEY). Podés cargarla en el botón de Configuración IA.'
    );
  }

  const cleanApiKey = apiKey ? apiKey.trim() : '';
  const fallbackList = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const modelsToTry = [model || DEFAULT_GEMINI_MODEL, ...fallbackList].filter(
    (m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx
  );
  const MAX_RETRIES_PER_MODEL = 1; // máximo 1 reintento rápido ante error 503 o 429
  const RETRY_WAIT_MS = 1000;

  let lastError = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    const isLastModel = mIdx === modelsToTry.length - 1;
    const url = getGeminiEndpoint(currentModel);

    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      let contents = [];
      if (Array.isArray(customContents) && customContents.length > 0) {
        contents = customContents;
      } else {
        const parts = [];
        if (Array.isArray(files) && files.length > 0) {
          files.forEach((f) => {
            const data = f.data || f.fileBase64 || f.base64;
            const mime = f.mimeType || f.type || 'application/pdf';
            if (data) {
              parts.push({
                inlineData: {
                  mimeType: mime,
                  data,
                },
              });
            }
          });
        } else if (fileBase64 && mimeType) {
          parts.push({
            inlineData: {
              mimeType,
              data: fileBase64,
            },
          });
        }
        if (prompt) {
          parts.push({ text: prompt });
        }
        contents.push({
          role: 'user',
          parts,
        });
      }

      const body = {
        contents,
        model: currentModel,
      };

      if (tools) {
        body.tools = tools;
      }

      if (systemPrompt) {
        body.systemInstruction = {
          parts: [{ text: systemPrompt }],
        };
      }

      const generationConfig = {
        temperature: temperature !== null ? temperature : (responseJson ? 0.1 : 0.4),
        maxOutputTokens: maxOutputTokens || 4096,
      };
      if (responseJson) {
        generationConfig.responseMimeType = 'application/json';
      }
      body.generationConfig = generationConfig;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      // Obtener token Bearer de sesión activa de Supabase Auth para autenticar en /api/gemini
      let authToken = '';
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        authToken = sessionData?.session?.access_token || '';
      } catch (authErr) {
        console.warn('[geminiService] Error al obtener token de sesión de Supabase:', authErr);
      }

      try {
        const headers = {
          'Content-Type': 'application/json',
        };
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }
        if (cleanApiKey) {
          headers['X-goog-api-key'] = cleanApiKey;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Si responde 503 (alta demanda) o 429 (límite de solicitudes)
        if (res.status === 503 || res.status === 429) {
          if (attempt < MAX_RETRIES_PER_MODEL) {
            console.warn(
              `[geminiService] HTTP ${res.status} en modelo ${currentModel}. Reintento ${attempt + 1}/${MAX_RETRIES_PER_MODEL} en ${RETRY_WAIT_MS}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
            continue;
          }
          if (!isLastModel) {
            console.warn(
              `[geminiService] Agotados reintentos en ${currentModel} (${res.status}). Cambiando a modelo fallback ${modelsToTry[mIdx + 1]} en ${RETRY_WAIT_MS}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
            break; // salta al siguiente modelo
          }
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error('[geminiService] Error Gemini API:', res.status, errText);

          let parsedMsg = errText;
          try {
            const parsedJson = JSON.parse(errText);
            parsedMsg = parsedJson.error?.message || parsedJson.error || errText;
          } catch {}

          if (res.status === 503 || res.status === 429) {
            if (attempt < MAX_RETRIES_PER_MODEL) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
              continue;
            }
            if (!isLastModel) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
              break;
            }
          }
          throw new Error(`HTTP ${res.status}: ${formatGeminiErrorMessage(parsedMsg)}`);
        }

        const rawResponseText = await res.text();
        if (rawResponseText.trim().startsWith('<')) {
          throw new Error('El endpoint /api/gemini devolvió HTML en lugar de JSON. Verificá la configuración de rutas en Vercel.');
        }

        let data;
        try {
          data = JSON.parse(rawResponseText);
        } catch {
          throw new Error(`Respuesta inválida de Gemini IA: ${rawResponseText.slice(0, 200)}`);
        }

        if (data?.error) {
          const isTransient =
            String(data.error).includes('503') ||
            String(data.error).includes('429') ||
            String(data.error?.message).includes('503') ||
            String(data.error?.message).includes('429') ||
            String(data.error?.message).toLowerCase().includes('demand') ||
            String(data.error?.message).toLowerCase().includes('quota');

          if (isTransient) {
            if (attempt < MAX_RETRIES_PER_MODEL) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
              continue;
            }
            if (!isLastModel) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
              break;
            }
          }
          throw new Error(formatGeminiErrorMessage(data.error.message || data.error));
        }

        const candidateParts = data?.candidates?.[0]?.content?.parts || [];
        const rawText = candidateParts.map((p) => p.text || '').filter(Boolean).join('\n') || '';

        if (responseJson) {
          const cleaned = cleanJsonResponse(rawText);
          return JSON.parse(cleaned);
        }

        return rawText;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        const isAbortOrNetwork =
          err.name === 'AbortError' ||
          controller.signal.aborted ||
          String(err.message).toLowerCase().includes('fetch');

        if (isAbortOrNetwork) {
          if (attempt < MAX_RETRIES_PER_MODEL) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
            continue;
          }
          if (!isLastModel) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
            break;
          }
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
          continue;
        }
        if (!isLastModel) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
          break;
        }
        throw new Error(formatGeminiErrorMessage(err));
      }
    }
  }

  throw new Error(formatGeminiErrorMessage(lastError) || 'No se pudo obtener respuesta de Gemini IA.');
}

// 1. Escáner Inteligente de Facturas, Remitos y Notas de Crédito
export async function analizarFacturaRemito(file, contextoUsuario = '') {
  const tieneContexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (!file && !tieneContexto) {
    throw new Error('No se recibió comprobante ni texto de contexto para analizar.');
  }

  let base64 = null;
  let mimeType = null;

  if (file) {
    let fileToAnalyze = file;
    mimeType = getFileMimeType(file);

    if (isPdfFile(file)) {
      // Si pesa más de 2.5 MB, intentar trozar la primera página a JPEG
      if ((file.size || 0) > 2.5 * 1024 * 1024) {
        try {
          const pages = await slicePdfToImages(file, { maxPages: 1, maxWidth: 1600, quality: 0.82 });
          if (pages && pages.length > 0 && pages[0].file) {
            fileToAnalyze = pages[0].file;
            mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
          }
        } catch (e) {
          console.warn('Fallback al trozar PDF en analizarFacturaRemito:', e);
          fileToAnalyze = file;
          mimeType = 'application/pdf';
        }
      } else {
        // PDF <= 2.5 MB: enviar directo como application/pdf nativo para máxima fidelidad
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      mimeType = getFileMimeType(fileToAnalyze);
    }

    base64 = await fileToBase64(fileToAnalyze);
    if (!base64 || base64.trim() === '') {
      throw new Error('El comprobante procesado no generó datos base64 válidos.');
    }
  }

  const systemPrompt = `Sos el auditor contable y analista financiero y fiscal de Establecimiento San José (Las Flores, Pcia. de Buenos Aires, Agroganadera Rincón del Sur S.A.).
Tu tarea es leer detalladamente ${file ? 'la factura, remito, nota de crédito, ticket agropecuario o presupuesto adjunto' : 'el detalle de gasto/compra provisto en lenguaje natural por el usuario'} y razonar con máxima precisión fiscal y analítica.
${compilarPromptContextoVivo()}
${tieneContexto ? `
========================================================================
ACLARACIONES, PRECIOS O CONTEXTO DEL USUARIO (PRIORIDAD ALTA):
"""
${String(contextoUsuario).trim()}
"""
ATENCIÓN: Estas aclaraciones del usuario tienen prioridad para clasificar categorías, proveedores, montos, moneda y deducciones.
========================================================================
` : ''}`;

  const prompt = `${file ? 'Analizá este comprobante comercial / fiscal' : 'Analizá las siguientes especificaciones de compra o gasto ingresadas por el usuario'} y devolvé ÚNICAMENTE un objeto JSON con los siguientes campos exactos:
{
  "fecha": "YYYY-MM-DD (fecha exacta de emisión del comprobante)",
  "proveedor": "Nombre o Razón Social del emisor (ej: YPF Directo, Vet. Las Flores, ACA, etc.)",
  "cuit_proveedor": "CUIT si figura o null",
  "numero_comprobante": "Punto de venta y número (ej: 0004-00012845) o null",
  "tipo_comprobante": "Factura A | Factura B | Factura C | Nota de Crédito A | Nota de Crédito B | Nota de Crédito C | Remito | Ticket | Nota de Débito",
  "es_nota_credito": true si es Nota de Crédito (descuento/devolución que disminuye el gasto) o false si es factura/remito/ticket,
  "categoria": "Categoría operativa recomendada (Elegir exactamente una: Sanidad / Vacunas | Suplementación / Reservas | Maquinaria / Repuestos | Combustible | Infraestructura / Proveedores Externos | Honorarios Veterinarios | Siembras y Labores Agrícolas | Alambrados / Mejoras | Administración / Estructura)",
  "descripcion_resumen": "Resumen claro del concepto (ej: 1.500 Lts Gasoil Grado 2 / 10 Frascos Ivermectina)",
  "moneda": "ARS | USD",
  "moneda_detectada": "ARS | USD",
  "neto_gravado": número flotante de la base imponible neta gravada sin impuestos,
  "alicuota_iva": número flotante del porcentaje de IVA principal (ej: 10.5 para hacienda/granos/fertilizantes, 21.0 para insumos generales, 27.0 para energía/telecomunicaciones, 0 si no aplica),
  "monto_iva": número flotante del impuesto al valor agregado (IVA Crédito Fiscal) o 0,
  "percepciones_iva": número flotante de percepciones de IVA RG AFIP/ARCA o 0,
  "percepciones_iibb": número flotante de percepciones de Ingresos Brutos (ARBA, AGIP, etc.) o 0,
  "otras_percepciones": número flotante de tasas municipales, percepciones de Ganancias u otros o 0,
  "subtotal_neto": número flotante del subtotal antes de impuestos,
  "iva_detectado": número flotante del IVA total,
  "monto_sin_facturar": número flotante si hay montos adicionales no facturados, pagos en negro, flete informal o notas al pie o 0,
  "total_documento": número flotante del importe final facturado o declarado,
  "total": número flotante del importe final facturado,
  "nota_manuscrita_util": "Texto sintético de ANOTACIONES MANUSCRITAS financieras o de destino útiles detectadas a birome/lápiz (ej: tipo de cambio acordado 'TC 1420', destino 'Potrero 8', pagador 'yo tarjeta mía', condición 'cheque 30 días') o null si no hay",
  "nota_manuscrita_descartada": "Texto explicativo de anotaciones manuscritas descartadas por ser mero cálculo aritmético auxiliar en el margen, firma, sello de recepción o tildes (ej: 'Cálculo de multiplicación en margen inferior descartado') o null",
  "tipo_cambio_manuscrito": número flotante si hay una cotización del dólar escrita a mano en el comprobante o null,
  "notas_auditoria_ia": "Texto breve en español rioplatense con tu dictamen de auditoría contable (ej: 'Factura A con 21% de IVA; incluye $1.200.000 gravados y $252.000 de IVA. Se detectó anotación a birome indicando Potrero 14')",
  "partidas_detalle": [
    {
      "concepto": "Detalle del producto, labor o servicio",
      "cantidad": número,
      "unidad": "Litros | Bolsas | Kg | Unidades | Horas | ha | etc.",
      "precio_unitario": número,
      "subtotal": número
    }
  ],
  "items": [
    {
      "descripcion": "Detalle del producto o servicio",
      "cantidad": número,
      "unidad": "Litros | Bolsas | Kg | Unidades | Horas | etc.",
      "precio_unitario": número,
      "total": número
    }
  ],
  "observaciones": "Cualquier nota relevante, condición de pago o vencimiento"
}

REGLAS CRÍTICAS DE AUDITORÍA:
1. DETECCIÓN ESTRICTA DE MONEDA (ARS vs. USD): Si el comprobante usa el signo '$' sin especificar 'USD' o 'U$S', y las tarifas son montos en pesos argentinos (ej: gasoil a $1.300/L, mano de obra o insumos > 1.000), 'moneda' y 'moneda_detectada' son OBLIGATORIAMENTE 'ARS'.
2. NOTAS DE CRÉDITO (NC): Si el comprobante dice 'NOTA DE CRÉDITO' (A, B o C), marcá 'es_nota_credito': true.
3. ANOTACIONES MANUSCRITAS: Distinguí con agudeza si alguien anotó a birome un tipo de cambio ('a 1420', 'dólar 1390'), el pagador ('yo tarjeta mía') o el potrero de destino, colocándolo en 'nota_manuscrita_util', y descartá sumas y firmas auxiliares en 'nota_manuscrita_descartada'.
4. DESGLOSE DE IVA Y MONTOS SIN FACTURAR: Extraé obligatoriamente el neto gravado, la alícuota de IVA (10.5%, 21%, 27%), las percepciones y si existen montos adicionales en negro/sin facturar.`;

  const parsed = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  if (!parsed) return parsed;

  // Normalizar Notas de Crédito (NC): Signo negativo automático
  const isNC =
    Boolean(parsed.es_nota_credito) ||
    parsed.tipo_comprobante?.toLowerCase().includes('crédito') ||
    parsed.tipo_comprobante?.toLowerCase().includes('credito') ||
    parsed.descripcion_resumen?.toLowerCase().includes('nota de crédito');

  if (isNC) {
    parsed.es_nota_credito = true;
    if (parsed.total && Number(parsed.total) > 0) parsed.total = -Math.abs(Number(parsed.total));
    if (parsed.subtotal_neto && Number(parsed.subtotal_neto) > 0) parsed.subtotal_neto = -Math.abs(Number(parsed.subtotal_neto));
    if (parsed.neto_gravado && Number(parsed.neto_gravado) > 0) parsed.neto_gravado = -Math.abs(Number(parsed.neto_gravado));
    if (parsed.iva && Number(parsed.iva) > 0) parsed.iva = -Math.abs(Number(parsed.iva));
    if (parsed.monto_iva && Number(parsed.monto_iva) > 0) parsed.monto_iva = -Math.abs(Number(parsed.monto_iva));
    if (parsed.percepciones_iva && Number(parsed.percepciones_iva) > 0) parsed.percepciones_iva = -Math.abs(Number(parsed.percepciones_iva));
  } else {
    parsed.es_nota_credito = false;
  }

  // Asegurar campos contables y de auditoría estandarizados
  parsed.moneda_detectada = parsed.moneda_detectada || parsed.moneda || 'ARS';
  parsed.subtotal_neto = Number(parsed.subtotal_neto) || Number(parsed.neto_gravado) || 0;
  parsed.iva_detectado = Number(parsed.iva_detectado) || Number(parsed.monto_iva) || Number(parsed.iva) || 0;
  parsed.monto_sin_facturar = Number(parsed.monto_sin_facturar) || 0;
  parsed.total_documento = Number(parsed.total_documento) || Number(parsed.total) || (parsed.subtotal_neto + parsed.iva_detectado + parsed.monto_sin_facturar);

  if (!Array.isArray(parsed.partidas_detalle) || parsed.partidas_detalle.length === 0) {
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      parsed.partidas_detalle = parsed.items.map((it) => ({
        concepto: it.descripcion || it.concepto || 'Ítem',
        cantidad: Number(it.cantidad) || 1,
        unidad: it.unidad || 'u',
        precio_unitario: Number(it.precio_unitario) || 0,
        subtotal: Number(it.total) || ((Number(it.cantidad) || 1) * (Number(it.precio_unitario) || 0)),
      }));
    } else {
      parsed.partidas_detalle = [
        {
          concepto: parsed.descripcion_resumen || 'Comprobante comercial',
          cantidad: 1,
          unidad: 'u',
          precio_unitario: parsed.total_documento,
          subtotal: parsed.total_documento,
        },
      ];
    }
  }

  if (!parsed.notas_auditoria_ia) {
    const ivaTxt = parsed.iva_detectado > 0 ? `IVA: $${Math.round(parsed.iva_detectado).toLocaleString('es-AR')}` : 'Sin IVA discriminado';
    const noFactTxt = parsed.monto_sin_facturar > 0 ? ` · Monto no facturado: $${Math.round(parsed.monto_sin_facturar).toLocaleString('es-AR')}` : '';
    parsed.notas_auditoria_ia = `${parsed.tipo_comprobante || 'Comprobante'} de ${parsed.proveedor || 'Proveedor'}. ${ivaTxt}${noFactTxt}. Importe total: ${parsed.moneda_detectada} $${Math.round(parsed.total_documento).toLocaleString('es-AR')}.`;
  }

  return parsed;
}

// 1.b Escáner Inteligente de Etiquetas de Cajas de Caravanas y Remitos SENASA (Sprint N)
export async function analizarEtiquetaCajaCaravanas(file) {
  let fileToAnalyze = file;
  let mimeType = getFileMimeType(file);

  if (isPdfFile(file)) {
    if ((file.size || 0) > 2.5 * 1024 * 1024) {
      try {
        const pages = await slicePdfToImages(file, { maxPages: 1, maxWidth: 1600, quality: 0.82 });
        if (pages && pages.length > 0 && pages[0].file) {
          fileToAnalyze = pages[0].file;
          mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
        }
      } catch (e) {
        console.warn('Fallback al trozar PDF en analizarEtiquetaCajaCaravanas:', e);
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      fileToAnalyze = file;
      mimeType = 'application/pdf';
    }
  } else {
    mimeType = getFileMimeType(fileToAnalyze);
  }

  const base64 = await fileToBase64(fileToAnalyze);
  if (!base64 || base64.trim() === '') {
    throw new Error('La imagen o documento de la caja no generó datos base64 válidos.');
  }

  const systemPrompt = `Sos el experto en identificación animal oficial SENASA de Establecimiento San José (Agroganadera Rincón del Sur S.A., Las Flores, Bs. As.).
Tu misión es leer la etiqueta de la caja de caravanas, certificado oficial o remito de entrega y extraer con máxima fidelidad el CUIG, rango de numeración, cantidad y características.`;

  const prompt = `Analizá esta etiqueta de caja de caravanas o remito SENASA y devolvé ÚNICAMENTE un objeto JSON con los siguientes campos:
{
  "caja_numero": "Número de caja si figura (ej: 14) o null",
  "marca": "Fabricante / Marca (ej: Allflex, Villanueva, Datamars, etc.)",
  "color_tipo": "Color y formato (ej: Amarilla Botón / Tarjeta, Caravana Electrónica RFID, etc.)",
  "cuig": "Código Único de Identificación Ganadera (CUIG de 5 o 6 caracteres, ej: SJ001) si está presente o null",
  "desde": "Número o código de caravana inicial (ej: 0001 o AR000123)",
  "hasta": "Número o código de caravana final (ej: 0100 o AR000222)",
  "cantidad": 100,
  "fecha_compra": "YYYY-MM-DD si figura fecha o null",
  "proveedor": "Nombre del proveedor o distribuidor si figura o null",
  "remito_numero": "N° de remito o pedido si figura o null",
  "observaciones": "Anotaciones adicionales o advertencias"
}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });
}

// 1.c Parser Inteligente de Documento de Tránsito Electrónico (DT-e / SIGSA) o Listado de Bajas
export async function analizarDteOSigsaBajas(file) {
  let fileToAnalyze = file;
  let mimeType = getFileMimeType(file);

  if (isPdfFile(file)) {
    if ((file.size || 0) > 2.5 * 1024 * 1024) {
      try {
        const pages = await slicePdfToImages(file, { maxPages: 2, maxWidth: 1600, quality: 0.82 });
        if (pages && pages.length > 0 && pages[0].file) {
          fileToAnalyze = pages[0].file;
          mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
        }
      } catch (e) {
        console.warn('Fallback al trozar PDF en analizarDteOSigsaBajas:', e);
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      fileToAnalyze = file;
      mimeType = 'application/pdf';
    }
  } else {
    mimeType = getFileMimeType(fileToAnalyze);
  }

  const base64 = await fileToBase64(fileToAnalyze);
  if (!base64 || base64.trim() === '') {
    throw new Error('El documento DT-e no generó datos base64 válidos.');
  }

  const systemPrompt = `Sos el despachante de hacienda, auditor ganadero y operador de SIGSA / SENASA de Establecimiento San José.
${compilarPromptContextoVivo()}
Tu tarea es leer el Documento de Tránsito Electrónico (DT-e) o certificado de carga de hacienda y extraer la lista completa de caravanas individuales amparadas para venta o traslado, verificando su concordancia con los rodeos del campo.`;

  const prompt = `Analizá este DT-e o planilla de caravanas de salida y devolvé ÚNICAMENTE un objeto JSON:
{
  "dte_numero": "Número de DT-e si figura (ej: 26-004-0012845) o null",
  "fecha": "YYYY-MM-DD",
  "destinatario": "Comprador o frigorífico destino si figura",
  "motivo": "Venta | Faena | Traslado a Invernada",
  "cantidad_cabezas": 50,
  "caravanas": ["Lista de strings con cada caravana individual identificada"],
  "rangos": [
    { "desde": "0001", "hasta": "0050", "cantidad": 50 }
  ],
  "notas_auditoria_ia": "Dictamen de auditoría sobre la consistencia del DT-e y las cabezas de hacienda",
  "observaciones": "Notas sobre tropa o precintos"
}`;

  const raw = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  if (!raw) return raw;
  if (!raw.notas_auditoria_ia) {
    raw.notas_auditoria_ia = `DT-e ${raw.dte_numero || 'S/N'}: ${raw.cantidad_cabezas || (raw.caravanas || []).length} cabezas con destino ${raw.destinatario || 'a designar'}.`;
  }
  return raw;
}

// 3b. Escáner Integral de Receta Agronómica o Remito de Insumos para Siembras (Multi-Lote y Multi-Formato)


// 2. Asignador Inteligente de Repuestos y Mantenimiento de Maquinaria
// 1.d Conciliador IA de Compras & Rangos SIGSA de Caravanas
export async function analizarComprasCaravanasIa(fileOrText) {
  let base64 = null;
  let mimeType = null;
  let textData = null;

  if (typeof fileOrText === 'string') {
    textData = fileOrText;
  } else if (fileOrText instanceof File || fileOrText instanceof Blob) {
    if (isPdfFile(fileOrText)) {
      if ((fileOrText.size || 0) > 2.5 * 1024 * 1024) {
        try {
          const pages = await slicePdfToImages(fileOrText, { maxPages: 2, maxWidth: 1600, quality: 0.82 });
          if (pages && pages.length > 0 && pages[0].file) {
            base64 = await fileToBase64(pages[0].file);
            mimeType = pages[0].mimeType || 'image/jpeg';
          }
        } catch {
          base64 = await fileToBase64(fileOrText);
          mimeType = 'application/pdf';
        }
      } else {
        base64 = await fileToBase64(fileOrText);
        mimeType = 'application/pdf';
      }
    } else {
      base64 = await fileToBase64(fileOrText);
      mimeType = getFileMimeType(fileOrText);
    }
  }

  const systemPrompt = `Sos el especialista en identificación animal oficial SENASA y compras ganaderas de Establecimiento San José (Agroganadera Rincón del Sur S.A., Las Flores, Bs. As.).
${compilarPromptContextoVivo()}
Tu misión es leer la captura de pantalla de SIGSA, factura de proveedor (Villanueva, Datamars, Allflex, Biogénesis, etc.), remito o etiquetas de cajas de caravanas y extraer TODOS los rangos de caravanas adquiridos.
Tené en cuenta que una misma factura o pantalla puede listar múltiples cajas o rangos.`;

  const prompt = `Analizá el documento o texto adjunto y extraé todas las cajas y rangos de caravanas comprados en formato JSON estricto:
{
  "cajas": [
    {
      "caja_numero": número entero si figura (o null si es a designar),
      "marca": "Allflex SENASA | Durflex | Datamars | Villanueva | etc.",
      "desde": "Número o código de caravana inicial (ej: 0001 o AR000123)",
      "hasta": "Número o código de caravana final (ej: 0100 o AR000222)",
      "cantidad": número entero de unidades (ej: 50 o 100),
      "color_tipo": "Color y formato (ej: Amarilla Botón / Tarjeta, RFID Electrónica, etc.)",
      "cuig": "CUIG oficial si figura (ej: SJ001) o null",
      "proveedor": "Nombre de la veterinaria o distribuidor",
      "fecha_compra": "YYYY-MM-DD si figura o null",
      "observaciones": "Detalles adicionales"
    }
  ],
  "moneda": "ARS",
  "moneda_detectada": "ARS",
  "notas_auditoria_ia": "Dictamen sobre la correlatividad de los rangos oficiales de caravanas y stock actual",
  "resumen": "Resumen breve de la compra detectada"
}
${textData ? `\n\nCONTENIDO DE LA PLANILLA / TEXTO:\n${textData}` : ''}`;

  const raw = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  if (!raw) return raw;
  raw.moneda_detectada = raw.moneda_detectada || 'ARS';
  if (!raw.notas_auditoria_ia) {
    const totUnid = (raw.cajas || []).reduce((a, b) => a + (Number(b.cantidad) || 0), 0);
    raw.notas_auditoria_ia = `Adquisición de ${totUnid} caravanas en ${(raw.cajas || []).length} caja/s. ${raw.resumen || ''}`.trim();
  }
  return raw;
}

/**
 * Prepara un archivo (PDF o Imagen) para ser enviado como part a Gemini API
 */
export async function prepareFileForGemini(file) {
  let fileToAnalyze = file;
  let mimeType = getFileMimeType(file);

  if (isPdfFile(file)) {
    // Si es un PDF multipágina o pesado, trozar sus páginas clave
    if ((file.size || 0) > 3.5 * 1024 * 1024) {
      try {
        const pages = await slicePdfToImages(file, { maxPages: 2, maxWidth: 1600, quality: 0.82 });
        if (pages && pages.length > 0 && pages[0].file) {
          fileToAnalyze = pages[0].file;
          mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
        }
      } catch (e) {
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      fileToAnalyze = file;
      mimeType = 'application/pdf';
    }
  }

  const base64 = await fileToBase64(fileToAnalyze);
  return {
    name: file.name,
    data: base64,
    mimeType,
  };
}

/**
 * Analiza y cruza un lote de múltiples documentos (Recetas RAO, remitos y facturas de insumos)
 */
export async function analizarLoteRecetasAgronomicas({ files = [], potrerosList = [], contextoUsuario = '' }) {
  const tieneContexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if ((!files || files.length === 0) && !tieneContexto) {
    throw new Error('No se seleccionó ningún archivo ni se ingresaron indicaciones en texto.');
  }

  const preparedFiles = [];
  for (const f of files || []) {
    const prep = await prepareFileForGemini(f);
    if (prep && prep.data) {
      preparedFiles.push(prep);
    }
  }

  if (preparedFiles.length === 0 && !tieneContexto) {
    throw new Error('No se pudieron procesar los archivos seleccionados.');
  }

  const listaPotrerosTxt = potrerosList
    .map(
      (p) =>
        `P#${p.numero} "${p.nombre}" (${p.hectareas || 0} ha, Actual: ${
          p.cultivo_actual || 'Campo Natural'
        })`
    )
    .join(', ');

  const systemPrompt = `Sos el asesor agronómico, auditor técnico y perito agrícola de Establecimiento San José (Las Flores, Bs. As., Agroganadera Rincón del Sur S.A.).
Los potreros oficiales del campo son: ${listaPotrerosTxt}.
Tu tarea es leer minuciosamente ${preparedFiles.length > 0 ? 'el lote de documentos adjuntos (pueden ser múltiples Recetas Agronómicas RAO de distintos potreros, remitos de insumos/agroquímicos, o facturas)' : 'las prescripciones e indicaciones agronómicas ingresadas por el usuario'} y extraer, consolidar y CRUZAR toda la información entre ellos.
${tieneContexto ? `
========================================================================
INDICACIONES Y CONTEXTO DEL USUARIO (PRIORIDAD ALTA):
"""
${String(contextoUsuario).trim()}
"""
ATENCIÓN: Estas indicaciones del usuario tienen prioridad absoluta para dosis por ha, potrero/sector o precios de insumos.
========================================================================
` : ''}

CRITERIOS CLAVE DE CRUCE:
1. Si hay varias recetas de distintos potreros, generá un elemento en "recetas" para CADA potrero o labor identificada.
2. Si un documento es una receta y otro es una factura/remito de agroquímicos, vinculá los insumos y precios detectados en la factura con los productos prescriptos en la receta.
3. Extraé con máxima precisión las coordenadas GPS y el potrero sugerido para cada receta/labor.
Devolvé ÚNICAMENTE un objeto JSON válido con la estructura solicitada.`;

  const prompt = `${preparedFiles.length > 0 ? `Analizá los ${preparedFiles.length} documentos adjuntos del lote` : 'Analizá las siguientes prescripciones y recetas ingresadas en texto por el usuario'} y devolvé un JSON con la siguiente estructura:
{
  "resumen_lote": "Resumen ejecutivo del lote analizado (ej: Se analizaron 3 recetas agronómicas correspondientes a barbecho y fertilización en P2, P3 y P8)",
  "archivos_procesados": ["nombre1.pdf", "nombre2.pdf"],
  "cruce_realizado": "Explicación de qué cruce se detectó y realizó",
  "recetas": [
    {
      "archivo_origen": "nombre del archivo del cual surge",
      "numero_receta": "Número oficial RAO o de orden",
      "fecha_emision": "YYYY-MM-DD",
      "fecha_limite_aplicacion": "YYYY-MM-DD o null",
      "tiempo_reingreso_horas": 24,
      "tiempo_carencia_dias": 7,
      "ingeniero_agronomo": "Nombre del profesional",
      "matricula_profesional": "Matrícula",
      "lote_declarado": "Nombre o número de lote declarado en el documento",
      "potrero_sugerido_numero": número entero de potrero en San José si coincide (ej: 2, 3, 14) o null,
      "hectareas_declaradas": número de hectáreas,
      "cultivo_tratado": "Cultivo o destino (ej: Barbecho, Pastura, Maíz)",
      "coordenadas_gps": {
        "latitud": número flotante negativo o null,
        "longitud": número flotante negativo o null,
        "texto_original": "texto original si figura"
      },
      "tipo_aplicacion": "Terrestre | Aérea",
      "volumen_agua_lts_ha": 80,
      "productos": [
        {
          "marca_comercial": "Nombre del producto",
          "principio_activo": "Principio activo",
          "dosis_ha": 2.5,
          "unidad": "Lt | Kg | cm3 | g",
          "cantidad_total": 100,
          "precio_unitario_usd": número si se detectó en factura/remito adjunto o null,
          "clase_toxicologica": "Clase si figura"
        }
      ],
      "observaciones_clave": "Observaciones relevantes"
    }
  ]
}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    files: preparedFiles,
    responseJson: true,
    timeoutMs: 45000,
  });
}

/**
 * Analiza y consolida un lote de múltiples liquidaciones de venta de hacienda
 */
export async function analizarLoteLiquidacionesHacienda(files = []) {
  if (!files || files.length === 0) {
    throw new Error('No se seleccionó ningún comprobante para analizar.');
  }

  const preparedFiles = [];
  for (const f of files) {
    const prep = await prepareFileForGemini(f);
    if (prep && prep.data) {
      preparedFiles.push(prep);
    }
  }

  const systemPrompt = `Sos el liquidador y auditor ganadero senior de Establecimiento San José (Las Flores, Bs. As., Agroganadera Rincón del Sur S.A.).
Tu tarea es leer y consolidar las liquidaciones de venta de hacienda adjuntas (pueden ser comprobantes de distintas fechas, consignatarios o tropas) y extraer un JSON con la lista de liquidaciones y tropas detectadas sin duplicar.`;

  const prompt = `Analizá las ${preparedFiles.length} liquidaciones/comprobantes adjuntos y devolvé un JSON con esta estructura:
{
  "resumen_lote": "Resumen de ventas analizadas",
  "liquidaciones": [
    {
      "archivo_origen": "nombre del archivo",
      "consignatario": "Nombre de la consignataria o comprador",
      "numero_liquidacion": "Número de liquidación o factura",
      "fecha": "YYYY-MM-DD",
      "total_cabezas": 50,
      "total_kilos": 18500,
      "importe_bruto_total": 45000000,
      "gastos_comisiones_total": 3500000,
      "importe_neto_total": 41500000,
      "renglones": [
        {
          "categoria": "Vacas Gordas | Vacas Manufactura/Conserva | Terneros | Terneras | Vaquillonas | Toros | Novillitos",
          "cabezas": 50,
          "kilos_totales": 18500,
          "kilos_promedio": 370,
          "precio_por_kg": 2432.43,
          "importe_bruto": 45000000
        }
      ]
    }
  ]
}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    files: preparedFiles,
    responseJson: true,
    timeoutMs: 45000,
  });
}

// 1.e Conciliador IA de Planillas de Colocación de Caravanas en Manga
export async function analizarPlanillaCaravanasMangaIa(fileOrText, rodeosList = []) {
  let base64 = null;
  let mimeType = null;
  let textData = null;

  if (typeof fileOrText === 'string') {
    textData = fileOrText;
  } else if (fileOrText instanceof File || fileOrText instanceof Blob) {
    if (isPdfFile(fileOrText)) {
      if ((fileOrText.size || 0) > 2.5 * 1024 * 1024) {
        try {
          const pages = await slicePdfToImages(fileOrText, { maxPages: 2, maxWidth: 1600, quality: 0.82 });
          if (pages && pages.length > 0 && pages[0].file) {
            base64 = await fileToBase64(pages[0].file);
            mimeType = pages[0].mimeType || 'image/jpeg';
          }
        } catch {
          base64 = await fileToBase64(fileOrText);
          mimeType = 'application/pdf';
        }
      } else {
        base64 = await fileToBase64(fileOrText);
        mimeType = 'application/pdf';
      }
    } else {
      base64 = await fileToBase64(fileOrText);
      mimeType = getFileMimeType(fileOrText);
    }
  }

  const rodeosNombres = (rodeosList || []).map((r) => r.nombre || `Rodeo #${r.id}`).join(', ');

  const systemPrompt = `Sos el encargado de manga y veterinario de Establecimiento San José (Las Flores, Bs. As.).
Rodeos oficiales actuales del campo: ${rodeosNombres || 'COLA, CUERPO, CABEZA, COLORADAS, VAQUILLONAS, DESTETADOS, etc.'}.
Tu misión es interpretar la planilla de manga (manuscrita o impresa), Excel de vacunación/caravaneo o informe de campo y extraer las caravanas colocadas a los animales, asignándoles el rodeo y categoría correspondientes.`;

  const prompt = `Analizá la planilla de manga o texto adjunto y devolvé un JSON estricto:
{
  "fecha_colocacion": "YYYY-MM-DD",
  "rodeo_sugerido": "Nombre del rodeo de San José al que se le colocaron las caravanas",
  "categoria_sugerida": "Terneros | Terneras | Vacas | Vaquillonas Reposición | Toros | Toritos | CUT",
  "operador_responsable": "Nombre del responsable en manga si figura",
  "caravanas_individuales": [
    {
      "caravana": "Código o número de caravana individual (ej: AR000125)",
      "rodeo": "Nombre del rodeo",
      "categoria": "Categoría animal",
      "sexo": "Macho | Hembra | Indistinto"
    }
  ],
  "rangos_colocados": [
    {
      "desde": "Número inicial del rango continuo colocado (ej: 0001)",
      "hasta": "Número final del rango continuo colocado (ej: 0050)",
      "cantidad": 50,
      "rodeo": "Nombre del rodeo",
      "categoria": "Categoría"
    }
  ],
  "observaciones": "Novedades de manga (ej: terneros nacidos en octubre, caravaneo al pie de la madre)"
}
${textData ? `\n\nCONTENIDO DE LA PLANILLA / TEXTO:\n${textData}` : ''}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });
}

// 1.f Conciliador IA de Salidas de Caravanas (DT-e, Ventas, Bajas)
export async function analizarSalidasCaravanasDteIa(fileOrText) {
  let base64 = null;
  let mimeType = null;
  let textData = null;

  if (typeof fileOrText === 'string') {
    textData = fileOrText;
  } else if (fileOrText instanceof File || fileOrText instanceof Blob) {
    if (isPdfFile(fileOrText)) {
      if ((fileOrText.size || 0) > 2.5 * 1024 * 1024) {
        try {
          const pages = await slicePdfToImages(fileOrText, { maxPages: 2, maxWidth: 1600, quality: 0.82 });
          if (pages && pages.length > 0 && pages[0].file) {
            base64 = await fileToBase64(pages[0].file);
            mimeType = pages[0].mimeType || 'image/jpeg';
          }
        } catch {
          base64 = await fileToBase64(fileOrText);
          mimeType = 'application/pdf';
        }
      } else {
        base64 = await fileToBase64(fileOrText);
        mimeType = 'application/pdf';
      }
    } else {
      base64 = await fileToBase64(fileOrText);
      mimeType = getFileMimeType(fileOrText);
    }
  }

  const systemPrompt = `Sos el despachante de hacienda y operador de SIGSA / SENASA de Establecimiento San José.
Tu misión es leer Documentos de Tránsito Electrónico (DT-e), liquidaciones de venta de hacienda, certificados de carga o actas de mortandad y extraer la totalidad de las caravanas que salieron del campo o fueron dadas de baja.`;

  const prompt = `Analizá el DT-e, liquidación o acta adjunta y devolvé un JSON estricto:
{
  "dte_numero": "Número de DT-e si figura (ej: 26-004-0012845) o null",
  "fecha": "YYYY-MM-DD",
  "motivo": "Venta | Faena | Baja / Mortandad | Traslado a Invernada",
  "destinatario": "Comprador, frigorífico o destino",
  "cantidad_cabezas": 50,
  "caravanas_individuales": ["Lista de strings con cada caravana individual"],
  "rangos_salidos": [
    {
      "desde": "Número inicial",
      "hasta": "Número final",
      "cantidad": 50
    }
  ],
  "observaciones": "Observaciones sobre precintos, transportista o causa de baja"
}
${textData ? `\n\nCONTENIDO DEL DOCUMENTO / TEXTO:\n${textData}` : ''}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });
}

export async function analizarRepuestoMaquinaria(file, maquinariaList = [], contextoUsuario = '') {
  const tieneContexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (!file && !tieneContexto) {
    throw new Error('No se recibió comprobante ni texto descriptivo del repuesto.');
  }

  let base64 = null;
  let mimeType = null;
  if (file) {
    base64 = await fileToBase64(file);
    mimeType = getFileMimeType(file);
  }

  const listaMaquinariaTxt = maquinariaList
    .map((m) => `#${m.id}: ${m.tipo} - ${m.marca} ${m.modelo || ''} (Interno: ${m.codigo_interno || '-'})`)
    .join('\n');

  const systemPrompt = `Sos el jefe de taller, mecánica pesada y auditor de mantenimiento de Establecimiento San José.
Conocés a la perfección los tractores, cosechadoras, camionetas e implementos del campo.
${compilarPromptContextoVivo()}
${tieneContexto ? `
========================================================================
ACLARACIONES Y CONTEXTO DEL USUARIO (PRIORIDAD ALTA):
"""
${String(contextoUsuario).trim()}
"""
========================================================================
` : ''}
El parque de maquinaria cargado en el establecimiento es:
${listaMaquinariaTxt || 'Tractores John Deere, Case, Pauny; Camionetas Toyota Hilux; Cosechadoras; Sembradoras.'}`;

  const prompt = `${file ? 'Analizá la imagen/documento del repuesto, factura de taller o etiqueta de la pieza' : 'Analizá las especificaciones del repuesto o servicio de maquinaria ingresadas por el usuario'} y devolvé un JSON con:
{
  "codigo_repuesto": "Código de pieza o número de parte del fabricante (ej: RE504836, 15601-00011) o null",
  "descripcion": "Nombre y especificación de la pieza (ej: Filtro de Aceite Motor, Correa de Alternador, Disco de Sembradora)",
  "marca_repuesto": "Marca del fabricante del repuesto (ej: John Deere, Donaldson, Fleetguard, Bosch)",
  "maquinaria_sugerida_id": número ID de la maquinaria sugerida de la lista anterior (o null si es de uso general/taller),
  "maquinaria_sugerida_nombre": "Nombre de la máquina asignada",
  "cantidad": número de unidades,
  "costo_unitario": número de costo si figura o 0,
  "moneda": "ARS | USD",
  "moneda_detectada": "ARS | USD",
  "subtotal_neto": número flotante del subtotal,
  "iva_detectado": 0,
  "monto_sin_facturar": 0,
  "total_documento": número flotante total,
  "notas_auditoria_ia": "Dictamen técnico sobre compatibilidad de la pieza con la maquinaria de San José",
  "partidas_detalle": [
    {
      "concepto": "Pieza o repuesto",
      "cantidad": número,
      "unidad": "u",
      "precio_unitario": número,
      "subtotal": número
    }
  ],
  "proveedor": "Comercio o concesionario emisor",
  "es_service_preventivo": booleano (true si es para mantenimiento por horas/km como filtros y lubricantes),
  "horas_o_km_sugeridos": número estimado de horas de motor o km para el service o null,
  "detalle_trabajo": "Recomendación de montaje o revisión para el mecánico"
}`;

  const raw = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  if (!raw) return raw;
  raw.moneda_detectada = raw.moneda_detectada || raw.moneda || 'ARS';
  raw.total_documento = Number(raw.total_documento) || (Number(raw.cantidad || 1) * Number(raw.costo_unitario || 0));
  if (!raw.notas_auditoria_ia) {
    raw.notas_auditoria_ia = `Repuesto: ${raw.descripcion || 'Pieza'} para ${raw.maquinaria_sugerida_nombre || 'taller general'}. Costo: ${raw.moneda_detectada} $${Math.round(raw.total_documento).toLocaleString('es-AR')}.`;
  }
  return raw;
}

// 3b. Escáner Integral de Receta Agronómica o Remito de Insumos para Siembras (Multi-Lote y Multi-Formato)


// 3. Intérprete de Recetas y Prescripciones Agronómicas
export async function analizarRecetaAgronomicaRAO(file, potrerosList = [], contextoUsuario = '') {
  const tieneContexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (!file && !tieneContexto) {
    throw new Error('No se recibió documento de receta ni indicaciones de contexto.');
  }

  let base64 = null;
  let mimeType = null;

  if (file) {
    let fileToAnalyze = file;
    mimeType = getFileMimeType(file);

    if (isPdfFile(file)) {
      if ((file.size || 0) > 2.5 * 1024 * 1024) {
        try {
          const pages = await slicePdfToImages(file, { maxPages: 2, maxWidth: 1600, quality: 0.82 });
          if (pages && pages.length > 0 && pages[0].file) {
            fileToAnalyze = pages[0].file;
            mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
          }
        } catch (e) {
          console.warn('[geminiService] Fallback al procesar PDF de RAO:', e);
          fileToAnalyze = file;
          mimeType = 'application/pdf';
        }
      } else {
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    }

    base64 = await fileToBase64(fileToAnalyze);
    if (!base64 || base64.trim() === '') {
      throw new Error('El documento de receta procesado no generó datos base64 válidos.');
    }
  }

  const listaPotrerosTxt = potrerosList
    .map((p) => `P#${p.numero} "${p.nombre}" (${p.hectareas || 0} ha, Actual: ${p.cultivo_actual || 'Campo Natural'})`)
    .join(', ');

  const systemPrompt = `Sos el asesor agronómico y auditor técnico de Establecimiento San José (Las Flores, Pcia. de Buenos Aires, Agroganadera Rincón del Sur S.A.).
Los potreros oficiales del campo son: ${listaPotrerosTxt}.
Tu tarea es leer minuciosamente ${file ? 'la Receta Agronómica de Aplicación (RAO oficial MDA PBA u orden equivalente)' : 'las especificaciones agronómicas provistas en texto por el usuario'} y extraer la totalidad de los datos técnicos, potreros, dosis y productos prescriptos en un JSON estructurado.
${tieneContexto ? `
========================================================================
INDICACIONES Y CONTEXTO DEL USUARIO (PRIORIDAD ALTA):
"""
${String(contextoUsuario).trim()}
"""
ATENCIÓN: Estas indicaciones del usuario tienen prioridad para dosis por ha, potrero/sector o precios de insumos.
========================================================================
` : ''}`;

  const prompt = `${file ? 'Analizá la Receta Agronómica de Aplicación (RAO) o prescripción agronómica adjunta' : 'Analizá las siguientes especificaciones y prescripciones agronómicas ingresadas por el usuario'} y devolvé ÚNICAMENTE un objeto JSON válido con los siguientes campos:
{
  "numero_receta": "Número oficial de la receta o RAO (ej: RAO-2026-004812, MDA-9821, etc.)",
  "fecha_emision": "YYYY-MM-DD",
  "fecha_limite_aplicacion": "YYYY-MM-DD o null si no figura",
  "ventana_aplicacion_dias": número entero de días de vigencia de la receta (ej: 10, 15 o null),
  "tiempo_reingreso_horas": número entero de horas de restricción de reingreso al lote (ej: 24, 48 o null),
  "tiempo_carencia_dias": número entero de días de carencia previa a pastoreo/cosecha (ej: 7, 14, 21, 30 o null),
  "ingeniero_agronomo": "Nombre completo del Ingeniero/a Agrónomo/a emisor",
  "matricula_profesional": "Matrícula profesional (ej: CIAFBA N° 1245, CPIA, etc.)",
  "lote_declarado": "Nombre o número del lote según figura en la receta (ej: Lote 10, Potrero 17, P7 Agropiro, Bajo Dulce)",
  "hectareas_declaradas": número flotante de la superficie a tratar en hectáreas,
  "cultivo_tratado": "Cultivo, pastura o destino (ej: Barbecho químico, Agropiro alargado, Festuca, Verdeo de Invierno, Maíz)",
  "coordenadas_gps": {
    "latitud": número flotante en grados decimales con signo negativo (ej: -35.868 o -36.0123) o null si no figura,
    "longitud": número flotante en grados decimales con signo negativo (ej: -58.945 o -59.1023) o null si no figura,
    "texto_original": "Texto de coordenadas tal como figura en el documento (ej: 35°52'05\"S 58°56'42\"W o -35.868, -58.945)"
  },
  "tipo_aplicacion": "Terrestre | Aérea",
  "volumen_agua_lts_ha": número flotante de volumen de caldo de aplicación (ej: 80, 100, 120 Lts/ha) o null,
  "productos": [
    {
      "marca_comercial": "Nombre comercial del producto (ej: Roundup ControlMAX, 2,4-D Dédalo Elite, Starane Extra, Cletodim 24%)",
      "principio_activo": "Droga activa y concentración declarada",
      "dosis_ha": número flotante de dosis por hectárea,
      "unidad": "Lt | Kg | cm3 | g",
      "cantidad_total": número flotante de la cantidad total prescripta para el lote,
      "clase_toxicologica": "Clase toxicológica (ej: Clase II, Clase III, Clase IV, Banda Azul, Banda Verde, etc.) o null",
      "carencia_dias": número de días de carencia específico de este producto si figura o null
    }
  ],
  "condiciones_ambientales": "Límites de viento, temperatura y humedad si figuran",
  "observaciones_clave": "Observaciones críticas de la receta (ej: distancia a colmenas, cursos de agua, escuelas rurales o mezclas recomendadas)"
}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });
}

export async function analizarRecetaAgronomica(file, potrerosList = []) {
  const base64 = await fileToBase64(file);
  const mimeType = getFileMimeType(file);

  const listaPotrerosTxt = potrerosList
    .map((p) => `Potrero #${p.numero}: ${p.nombre} (${p.hectareas || 0} ha, Cultivo/Estado: ${p.cultivo_actual || 'Campo Natural'})`)
    .join('\n');

  const systemPrompt = `Sos el asesor técnico y administrador de siembras de Establecimiento San José (Las Flores, Bs. As.).
Los potreros del campo y sus superficies oficiales son:
${listaPotrerosTxt}`;

  const prompt = `Analizá la orden agronómica o receta de pulverización adjunta y devolvé un JSON estructurado:
{
  "ingeniero_agronomo": "Nombre del profesional o agronomía emisora si figura",
  "fecha_prescripcion": "YYYY-MM-DD",
  "objetivo_labor": "Objetivo técnico (ej: Barbecho químico para sorgo, Control de malezas en verdeo de invierno, Fertilización)",
  "potreros_afectados": [array con los números de potrero indicados, ej: [8, 9, 16]],
  "productos": [
    {
      "nombre_producto": "Nombre comercial (ej: Roundup Full II, 2,4-D Dedalo Elite, Cletodim)",
      "principio_activo": "Droga activa y concentración",
      "dosis_por_ha": número flotante de la dosis por hectárea,
      "unidad_dosis": "Lts/ha | Kg/ha | cm3/ha | gr/ha",
      "funcion": "Herbicida | Insecticida | Fertilizante Foliar | Coadyuvante"
    }
  ],
  "caldo_lts_ha": número de volumen de caldo de aplicación (ej: 80 o 100 Lts/ha) o null,
  "condiciones_ambientales_recomendadas": "Requisitos de viento, humedad y temperatura",
  "observaciones": "Instrucciones de carga, orden de mezcla en tanque o precauciones de seguridad"
}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });
}

// 3b. Escáner Integral de Receta Agronómica o Remito de Insumos para Siembras (Multi-Lote y Multi-Formato)

export function sanitizarCantidadYUnidadOCR(rawCant, rawUnidad, fallbackHa = 0, fallbackDosis = 0) {
  let cantidadTotal = 0;
  if (typeof rawCant === 'number' && !isNaN(rawCant)) {
    cantidadTotal = rawCant;
  } else if (typeof rawCant === 'string' && rawCant.trim()) {
    const cleaned = rawCant.replace(',', '.');
    const match = cleaned.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      cantidadTotal = parseFloat(match[1]);
    }
  }

  if (cantidadTotal <= 0 && fallbackHa > 0 && fallbackDosis > 0) {
    cantidadTotal = Number((fallbackHa * fallbackDosis).toFixed(2));
  }

  let unidad = String(rawUnidad || '').trim();
  const rawCombined = `${String(rawCant || '')} ${unidad}`.toLowerCase();
  if (/kboasal|kboas|bolsa|bols|bls|bsas/i.test(rawCombined)) {
    unidad = 'bolsas';
  } else if (/bidon|bidón|bdo|bd/i.test(rawCombined)) {
    unidad = 'bidones';
  } else if (/litro|lt|lts|^l$/i.test(rawCombined)) {
    unidad = 'L';
  } else if (/kilo|kg|kgs|^k$/i.test(rawCombined)) {
    unidad = 'kg';
  } else if (/dosis|unidad|^u$/i.test(rawCombined)) {
    unidad = 'u';
  } else if (!unidad) {
    unidad = 'kg';
  }

  return { cantidadTotal, unidad };
}

/**
 * Helper para asociar nombre o texto de potrero con la lista oficial de San José
 */
export function findMatchingPotreroHelper(detectado, potrerosList = []) {
  if (!detectado || !Array.isArray(potrerosList) || potrerosList.length === 0) {
    return potrerosList?.[0] || null;
  }
  const str = String(detectado).toLowerCase().trim();
  const m = str.match(/(?:p|lote|potrero)?\s*#?\s*(\d+)/i);
  if (m) {
    const num = Number(m[1]);
    const found = potrerosList.find((p) => Number(p.numero) === num);
    if (found) return found;
  }
  const byName = potrerosList.find((p) => {
    if (!p.nombre) return false;
    const n = p.nombre.toLowerCase();
    return str.includes(n) || n.includes(str);
  });
  if (byName) return byName;
  return potrerosList[0] || null;
}

/**
 * Prepara cualquier archivo (Excel, Word docx, PDF, imagen, texto) para consumo en Gemini IA
 */
export async function prepararArchivosParaGemini(filesOrData) {
  let items = [];
  if (Array.isArray(filesOrData)) {
    items = filesOrData;
  } else if (filesOrData && typeof filesOrData === 'object') {
    if (Array.isArray(filesOrData.files)) {
      items = filesOrData.files;
    } else {
      items = [filesOrData];
    }
  } else if (filesOrData) {
    items = [filesOrData];
  }
  items = items.filter(Boolean);

  const allFilesParts = [];
  let accumulatedText = '';

  for (const item of items) {
    if (!item) continue;

    // 1. Caso texto plano / OCR previo
    if (typeof item === 'object' && item.textContent) {
      accumulatedText += `\n--- CONTENIDO TEXTUAL (${item.fileName || 'Documento'}):\n${item.textContent}\n`;
      continue;
    }

    const file = item instanceof Blob ? item : (item.file || null);
    if (!file) continue;

    const name = file.name || 'documento';
    const ext = name.split('.').pop().toLowerCase();

    // 2. Planilla Excel o CSV
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      try {
        const arrayBuf = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuf, { type: 'array' });
        accumulatedText += `\n--- PLANILLA EXCEL: "${name}" ---\n`;
        wb.SheetNames.forEach((sName) => {
          const ws = wb.Sheets[sName];
          const csv = XLSX.utils.sheet_to_csv(ws);
          if (csv && csv.trim()) {
            accumulatedText += `\n[HOJA: ${sName}]\n${csv}\n`;
          }
        });
      } catch (xErr) {
        console.warn('Error leyendo Excel en geminiService:', xErr);
        accumulatedText += `\n[PLANILLA EXCEL: ${name} (No se pudo parsear texto directo)]\n`;
      }
    }
    // 3. Documento Word (.docx)
    else if (ext === 'docx') {
      try {
        const arrayBuf = await file.arrayBuffer();
        let JSZipLib = typeof window !== 'undefined' ? window.JSZip : null;
        if (!JSZipLib) {
          try {
            const mod = await import('jszip');
            JSZipLib = mod.default || mod;
          } catch (zErr) {
            console.warn('JSZip no disponible:', zErr);
          }
        }
        if (JSZipLib) {
          const zip = await JSZipLib.loadAsync(arrayBuf);
          const docXml = await zip.file('word/document.xml')?.async('string');
          if (docXml) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(docXml, 'text/xml');
            const paragraphs = xmlDoc.getElementsByTagName('w:p');
            let pText = '';
            for (let p of paragraphs) {
              const texts = p.getElementsByTagName('w:t');
              for (let t of texts) {
                pText += t.textContent;
              }
              pText += '\n';
            }
            if (pText.trim()) {
              accumulatedText += `\n--- DOCUMENTO WORD: "${name}" ---\n${pText}\n`;
            }
          }
        }
      } catch (wErr) {
        console.warn('Error leyendo Word en geminiService:', wErr);
      }
    }
    // 4. Imágenes (JPG, PNG, WEBP)
    else if (file.type?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      try {
        const compressed = await compressImage(file, 1600, 0.78);
        const b64 = await fileToBase64(compressed);
        allFilesParts.push({
          data: b64,
          mimeType: compressed.type || 'image/jpeg',
          name,
        });
      } catch (imgErr) {
        const b64 = await fileToBase64(file);
        allFilesParts.push({
          data: b64,
          mimeType: file.type || 'image/jpeg',
          name,
        });
      }
    }
    // 5. PDFs
    else if (file.type === 'application/pdf' || ext === 'pdf') {
      const b64 = await fileToBase64(file);
      allFilesParts.push({
        data: b64,
        mimeType: 'application/pdf',
        name,
      });
    }
  }

  return { items, allFilesParts, accumulatedText };
}

// ============================================================================
// 1. EXTRACTORES ESPECIALIZADOS CON JSON ESTRICTO (PROMPT SEPARADO POR ROL)
// ============================================================================

export function sanitizarRecetaAgronomicaOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      numero_receta: '',
      fecha: new Date().toLocaleDateString('es-AR'),
      lote_nombre: '',
      hectareas: 0,
      cultivo: 'Siembra Directa',
      productos: [],
      notas_fertilizacion: '',
    };
  }

  const numReceta = String(raw.numero_receta || raw.numero || raw.receta_nro || raw.receta_numero || '').trim();
  const fecha = String(raw.fecha || raw.fecha_emision || new Date().toLocaleDateString('es-AR')).trim();
  const loteNombre = String(raw.lote_nombre || raw.potrero_nombre || raw.lote || raw.potrero || '').trim();
  const ha = Number(raw.hectareas || raw.ha || raw.superficie_ha || raw.superficie) || 0;
  const cultivo = String(raw.cultivo || raw.cultivo_variedad || raw.especie || 'Siembra Directa').trim();
  const notasFert = String(raw.notas_fertilizacion || raw.fertilizacion || raw.recomendaciones || '').trim();

  const rawProds = Array.isArray(raw.productos)
    ? raw.productos
    : Array.isArray(raw.insumos)
    ? raw.insumos
    : Array.isArray(raw.agroquimicos)
    ? raw.agroquimicos
    : [];

  const productos = rawProds.map((p) => {
    const nom = String(p.nombre || p.producto || p.insumo || 'Insumo').trim();
    const pa = String(p.principio_activo || p.ingrediente_activo || nom).trim();
    const dosis = Number(String(p.dosis_ha || p.dosis || 0).replace(',', '.')) || 0;
    const rawCant = p.cantidad_total !== undefined && p.cantidad_total !== '' ? p.cantidad_total : (p.total || 0);
    const { cantidadTotal, unidad } = sanitizarCantidadYUnidadOCR(rawCant, p.unidad || 'kg', ha, dosis);

    return {
      nombre: nom,
      principio_activo: pa,
      dosis_ha: dosis,
      cantidad_total: cantidadTotal || (ha > 0 && dosis > 0 ? Number((dosis * ha).toFixed(2)) : 0),
      unidad,
    };
  });

  return {
    numero_receta: numReceta,
    fecha,
    lote_nombre: loteNombre,
    hectareas: ha,
    cultivo,
    productos,
    notas_fertilizacion: notasFert,
  };
}

export function sanitizarFacturaOCotizacionOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      tipo_documento: 'cotizacion',
      numero_comprobante: '',
      fecha: new Date().toLocaleDateString('es-AR'),
      proveedor: '',
      moneda: 'USD',
      incluye_iva: false,
      items: [],
    };
  }

  const tipoDoc = String(raw.tipo_documento || 'cotizacion').toLowerCase();
  const numComp = String(raw.numero_comprobante || raw.comprobante_numero || raw.numero || '').trim();
  const fecha = String(raw.fecha || new Date().toLocaleDateString('es-AR')).trim();
  const prov = String(raw.proveedor || raw.empresa || raw.cooperativa || '').trim();
  let moneda = String(raw.moneda || 'USD').toUpperCase();
  if (!['ARS', 'USD'].includes(moneda)) moneda = 'USD';
  const incluyeIva = Boolean(raw.incluye_iva || raw.iva_incluido);

  const rawItems = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.productos)
    ? raw.productos
    : Array.isArray(raw.insumos)
    ? raw.insumos
    : Array.isArray(raw.partidas)
    ? raw.partidas
    : [];

  const items = rawItems.map((it) => {
    const prod = String(it.producto || it.nombre || it.descripcion || 'Insumo').trim();
    const rawCant = it.cantidad !== undefined && it.cantidad !== '' ? it.cantidad : (it.cantidad_total || it.total || 1);
    const { cantidadTotal, unidad } = sanitizarCantidadYUnidadOCR(rawCant, it.unidad_compra || it.unidad || 'kg', 0, 0);

    let envase = Number(it.contenido_envase_kg_o_l) || 0;
    if (!envase) {
      const eMatch = (prod + ' ' + (it.unidad_compra || it.unidad || '')).match(/\b(\d+(?:[.,]\d+)?)\s*(kg|l|litros?)\b/i);
      if (eMatch) envase = parseFloat(eMatch[1].replace(',', '.'));
      else if (unidad.toLowerCase().includes('bolsa')) envase = 25;
      else if (unidad.toLowerCase().includes('bidon')) envase = 20;
      else envase = 1;
    }

    const pu = Number(String(it.precio_unitario || it.precio || 0).replace(',', '.')) || 0;

    return {
      producto: prod,
      cantidad: cantidadTotal || 1,
      unidad_compra: it.unidad_compra || unidad,
      contenido_envase_kg_o_l: envase,
      precio_unitario: pu,
    };
  });

  return {
    tipo_documento: tipoDoc,
    numero_comprobante: numComp,
    fecha,
    proveedor: prov,
    moneda,
    incluye_iva: incluyeIva,
    items,
  };
}

export function sanitizarPlanillaLaboresOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      tipo_documento: 'planilla_labores',
      lotes: [],
    };
  }

  const rawLotes = Array.isArray(raw.lotes)
    ? raw.lotes
    : Array.isArray(raw)
    ? raw
    : [raw];

  const lotes = rawLotes.map((l) => {
    const loteNom = String(l.lote_nombre || l.lote || l.potrero || 'Potrero').trim();
    const ha = Number(l.hectareas || l.ha || l.superficie_ha || l.superficie) || 0;

    const rawLabores = Array.isArray(l.labores)
      ? l.labores
      : Array.isArray(l.labores_detalle)
      ? l.labores_detalle
      : Array.isArray(l.pasadas)
      ? l.pasadas
      : [];

    const labores = rawLabores.map((lab) => {
      const conc = String(lab.labor || lab.concepto || lab.tarea || 'Labor de contratista').trim();
      const pasadas = Number(lab.pasadas) || 1;
      const tarifa = Number(String(lab.tarifa_ha || lab.precio_unitario || lab.tarifa || 0).replace(',', '.')) || 0;
      let mon = String(lab.moneda || l.moneda || 'ARS').toUpperCase();
      if (!['ARS', 'USD'].includes(mon)) mon = 'ARS';

      return {
        labor: conc,
        pasadas,
        tarifa_ha: tarifa,
        moneda: mon,
      };
    });

    return {
      lote_nombre: loteNom,
      hectareas: ha,
      labores,
    };
  });

  return {
    tipo_documento: 'planilla_labores',
    lotes,
  };
}

/**
 * MODO A: Extractor especializado de Recetas Agronómicas (RAO / MDA / Prescripciones)
 * JSON Estricto. PROHIBIDO inventar precios o importes monetarios.
 */
export async function extraerRecetaAgronomica(filesOrData, options = {}) {
  const { potrerosList = [], contextoUsuario = '', isSandbox = false } = options;
  const { items, allFilesParts, accumulatedText } = await prepararArchivosParaGemini(filesOrData);

  const tieneTexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (items.length === 0 && !tieneTexto && !accumulatedText) {
    throw new Error('No se recibieron documentos ni indicaciones para extraer la receta agronómica.');
  }

  if (isSandbox && !hasGeminiKey()) {
    return {
      numero_receta: 'RAO-2026-0891',
      fecha: new Date().toLocaleDateString('es-AR'),
      lote_nombre: 'Potrero 10 Loma',
      hectareas: 62.5,
      cultivo: 'Sorgo Forrajero',
      productos: [
        { nombre: 'Semilla Sorgo Silero BMR', principio_activo: 'Sorghum bicolor', dosis_ha: 25, cantidad_total: 1562.5, unidad: 'kg' },
        { nombre: 'Glifosato 66%', principio_activo: 'Glifosato', dosis_ha: 2.5, cantidad_total: 156.25, unidad: 'L' },
        { nombre: '2,4-D Éster', principio_activo: '2,4-D', dosis_ha: 0.8, cantidad_total: 50, unidad: 'L' },
      ],
      notas_fertilizacion: 'Fertilización arrancador a la siembra con Fosfato Monoamónico (MAP) 50 kg/ha',
    };
  }

  const systemPrompt = `Sos el extractor técnico agronómico oficial de Establecimiento San José (Las Flores, Bs. As., Agroganadera Rincón del Sur S.A.).
Tu ÚNICA función es leer la prescripción agronómica (Receta Agronómica Obligatoria RAO/MDA, orden de pulverización, plan de siembra) y extraer con fidelidad absoluta los datos agronómicos en formato JSON estricto.

REGLAS ESTRICTAS DE EXTRACCIÓN:
1. PROHIBICIÓN DE DINERO: ESTÁ TOTALMENTE PROHIBIDO inventar precios, costos, subtotales o tarifas monetarias en pesos o dólares. Este extractor NO extrae dinero.
2. NO HAGAS CÁLCULOS MATEMÁTICOS COMPLEJOS: Extraé exclusivamente las dosis por hectárea y las cantidades totales que figuren explícitamente en el documento. Los totales serán calculados por software en JavaScript.
3. Extraé exclusivamente:
   - "numero_receta": Número o identificador de receta / orden técnica (si no figura, string vacío "").
   - "fecha": Fecha indicada en formato DD/MM/YYYY.
   - "lote_nombre": Nombre o número del lote/potrero mencionado (ej. "Potrero 10", "Lote 9", "Bajo Dulce").
   - "hectareas": Superficie en hectáreas indicada en la receta (número decimal o entero, ej. 62.5).
   - "cultivo": Cultivo o labor agronómica (ej. "Sorgo Forrajero", "Maíz", "Barbecho Químico", "Pastura Festuca/Trébol").
   - "productos": Lista exacta de agroquímicos, semillas o fertilizantes prescriptos:
     * "nombre": Nombre comercial del producto.
     * "principio_activo": Principio activo o ingrediente principal (si no figura, dejar como el nombre).
     * "dosis_ha": Dosis por hectárea (número, ej. 2.5).
     * "cantidad_total": Cantidad total prescripta si figura en el documento, o 0 si no figura.
     * "unidad": "kg" | "L" | "bolsas" | "dosis" | "g"
   - "notas_fertilizacion": Recomendaciones técnicas de fertilización de base/arrancador o volumen de agua/caldo mencionadas por el agrónomo.

Devolvé EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "numero_receta": "string",
  "fecha": "DD/MM/YYYY",
  "lote_nombre": "string",
  "hectareas": 0.0,
  "cultivo": "string",
  "productos": [
    {
      "nombre": "string",
      "principio_activo": "string",
      "dosis_ha": 0.0,
      "cantidad_total": 0.0,
      "unidad": "kg | L | bolsas | dosis | g"
    }
  ],
  "notas_fertilizacion": "string"
}`;

  const promptText = `Extraé la receta agronómica de los siguientes documentos o texto:\n${accumulatedText ? `\n--- TEXTO DOCUMENTO ---\n${accumulatedText}\n--- FIN TEXTO ---\n` : ''}${tieneTexto ? `\n--- CONTEXTO ADICIONAL ---\n${contextoUsuario}\n` : ''}`;

  const parsed = await callGeminiApi({
    prompt: promptText,
    systemPrompt,
    files: allFilesParts.length > 0 ? allFilesParts : null,
    fileBase64: allFilesParts.length === 1 ? allFilesParts[0].data : null,
    mimeType: allFilesParts.length === 1 ? allFilesParts[0].mimeType : null,
    responseJson: true,
    timeoutMs: 45000,
  });

  return sanitizarRecetaAgronomicaOutput(parsed);
}

/**
 * MODO B: Extractor especializado de Facturas, Remitos y Cotizaciones comerciales
 * JSON Estricto. PROHIBIDO asignar potreros, prorratear o inventar hectáreas.
 */
export async function extraerFacturaOCotizacion(filesOrData, options = {}) {
  const { contextoUsuario = '', isSandbox = false } = options;
  const { items, allFilesParts, accumulatedText } = await prepararArchivosParaGemini(filesOrData);

  const tieneTexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (items.length === 0 && !tieneTexto && !accumulatedText) {
    throw new Error('No se recibieron documentos ni texto para extraer la cotización o factura.');
  }

  if (isSandbox && !hasGeminiKey()) {
    return {
      tipo_documento: 'cotizacion',
      numero_comprobante: 'COT-2026-4412',
      fecha: new Date().toLocaleDateString('es-AR'),
      proveedor: 'Cooperativa Agropecuaria de Las Flores',
      moneda: 'USD',
      incluye_iva: false,
      items: [
        { producto: 'Semilla Sorgo Silero BMR (Bolsa 25 kg)', cantidad: 50, unidad_compra: 'bolsas', contenido_envase_kg_o_l: 25, precio_unitario: 62.62 },
        { producto: 'Glifosato 66% (Bidón 20 L)', cantidad: 10, unidad_compra: 'bidones', contenido_envase_kg_o_l: 20, precio_unitario: 4.85 },
        { producto: 'Fosfato Monoamónico MAP (Bolsa 50 kg)', cantidad: 100, unidad_compra: 'bolsas', contenido_envase_kg_o_l: 50, precio_unitario: 42.50 },
      ],
    };
  }

  const systemPrompt = `Sos el extractor comercial y auditor contable de compras de insumos agropecuarios de Establecimiento San José (Las Flores, Bs. As., Agroganadera Rincón del Sur S.A.).
Tu ÚNICA función es leer el comprobante comercial (cotización, factura de insumos, remito con precios o lista de precios de Cooperativa/Agronomía) y extraer fielmente los ítems y sus precios unitarios crudos.

PROHIBICIONES ESTRICTAS:
1. PROHIBIDO ASIGNAR POTREROS O INVENTAR HECTÁREAS: Este extractor no asigna lotes a los insumos.
2. PROHIBIDO CALCULAR PRORRATEOS O SOBRANTES: No inventes distribuciones ni ítems residuales.
3. PROHIBIDO MULTIPLICAR ARITMÉTICAMENTE: Solo extraé la cantidad de compra y el precio unitario exactos indicados en el documento. La multiplicación se realizará en código JavaScript.
4. DETECCIÓN DE MONEDA ESTRICTA:
   - Si los precios unitarios son mayores a 1.000 o si el comprobante indica '$' sin aclarar dólares, la moneda es 'ARS'.
   - Solo clasificar como 'USD' si indica expresamente 'USD', 'U$S', 'dólares' o valores típicos en divisas (ej. 3 a 150 USD).
5. OCR RESILIENTE: En cooperativas agropecuarias, extraé siempre la cantidad numérica que figura en la columna de cantidad (ej: "5 KBOASAL" -> 5 bolsas).

Devolvé EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "tipo_documento": "cotizacion | factura | remito",
  "numero_comprobante": "string",
  "fecha": "DD/MM/YYYY",
  "proveedor": "string (ej: Cooperativa Agropecuaria Las Flores)",
  "moneda": "USD | ARS",
  "incluye_iva": true,
  "items": [
    {
      "producto": "string",
      "cantidad": 0.0,
      "unidad_compra": "bolsas | bidones | kg | L | unidades",
      "contenido_envase_kg_o_l": 25.0,
      "precio_unitario": 0.0
    }
  ]
}`;

  const promptText = `Extraé la factura o cotización comercial de los siguientes documentos o texto:\n${accumulatedText ? `\n--- TEXTO DOCUMENTO ---\n${accumulatedText}\n--- FIN TEXTO ---\n` : ''}${tieneTexto ? `\n--- CONTEXTO ADICIONAL ---\n${contextoUsuario}\n` : ''}`;

  const parsed = await callGeminiApi({
    prompt: promptText,
    systemPrompt,
    files: allFilesParts.length > 0 ? allFilesParts : null,
    fileBase64: allFilesParts.length === 1 ? allFilesParts[0].data : null,
    mimeType: allFilesParts.length === 1 ? allFilesParts[0].mimeType : null,
    responseJson: true,
    timeoutMs: 45000,
  });

  return sanitizarFacturaOCotizacionOutput(parsed);
}

/**
 * MODO C: Extractor especializado de Planillas de Labores de Contratistas (Excel, Word, PDF)
 * JSON Estricto. Extrae exclusivamente labores, pasadas y tarifas/ha por lote.
 */
export async function extraerPlanillaLabores(filesOrData, options = {}) {
  const { contextoUsuario = '', isSandbox = false } = options;
  const { items, allFilesParts, accumulatedText } = await prepararArchivosParaGemini(filesOrData);

  const tieneTexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (items.length === 0 && !tieneTexto && !accumulatedText) {
    throw new Error('No se recibieron documentos ni texto para extraer la planilla de labores.');
  }

  if (isSandbox && !hasGeminiKey()) {
    return {
      tipo_documento: 'planilla_labores',
      lotes: [
        {
          lote_nombre: 'Potrero 10 Loma',
          hectareas: 62.5,
          labores: [
            { labor: 'Siembra Directa Fina/Gruesa', pasadas: 1, tarifa_ha: 90000, moneda: 'ARS' },
            { labor: 'Pulverización Terrestre', pasadas: 2, tarifa_ha: 16500, moneda: 'ARS' },
          ],
        },
      ],
    };
  }

  const systemPrompt = `Sos el extractor de labores agrícolas y partes de contratistas de Establecimiento San José (Las Flores, Bs. As., Agroganadera Rincón del Sur S.A.).
Tu ÚNICA función es leer planillas de labores, partes de maquinaria o presupuestos de laboreo (Excel, Word, PDF) y extraer los lotes y las labores realizadas o presupuestadas con sus tarifas por hectárea.

REGLAS ESTRICTAS:
1. No inventes agroquímicos ni semillas: este extractor es exclusivo para labores de maquinaria y servicios de contratistas.
2. No calcules multiplicaciones complejas: solo extraé la superficie, pasadas y tarifa por hectárea. La multiplicación (hectáreas * pasadas * tarifa_ha) la calcula el código JavaScript.
3. Moneda: En partes de contratistas argentinos los valores habitualmente son en ARS (ej: $90.000/ha de siembra, $16.500/ha de fumigación). Clasificá como 'ARS' salvo mención explícita de USD.

Devolvé EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "tipo_documento": "planilla_labores",
  "lotes": [
    {
      "lote_nombre": "string",
      "hectareas": 0.0,
      "labores": [
        {
          "labor": "string",
          "pasadas": 1,
          "tarifa_ha": 0.0,
          "moneda": "ARS | USD"
        }
      ]
    }
  ]
}`;

  const promptText = `Extraé la planilla de labores de los siguientes documentos o texto:\n${accumulatedText ? `\n--- TEXTO DOCUMENTO ---\n${accumulatedText}\n--- FIN TEXTO ---\n` : ''}${tieneTexto ? `\n--- CONTEXTO ADICIONAL ---\n${contextoUsuario}\n` : ''}`;

  const parsed = await callGeminiApi({
    prompt: promptText,
    systemPrompt,
    files: allFilesParts.length > 0 ? allFilesParts : null,
    fileBase64: allFilesParts.length === 1 ? allFilesParts[0].data : null,
    mimeType: allFilesParts.length === 1 ? allFilesParts[0].mimeType : null,
    responseJson: true,
    timeoutMs: 45000,
  });

  return sanitizarPlanillaLaboresOutput(parsed);
}

// ============================================================================
// 2. MOTOR ARITMÉTICO 100% DETERMINÍSTICO EN JAVASCRIPT
// ============================================================================

export function calcularAritmeticaReceta(recetaExtraida, potrerosList = [], dolarRef = 1540, stockInsumos = [], siembrasExistentes = []) {
  if (!recetaExtraida) return null;
  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;

  const loteNombre = String(recetaExtraida.lote_nombre || '').trim();
  const matchedP = findMatchingPotreroHelper(loteNombre, potrerosList);
  const potreroNum = matchedP ? Number(matchedP.numero) : (parseInt(loteNombre.replace(/\D/g, ''), 10) || 1);
  const potreroNombre = matchedP ? matchedP.nombre : (loteNombre || `Potrero #${potreroNum}`);
  const ha = Number(recetaExtraida.hectareas) || Number(matchedP?.hectareas) || 40;

  let sector = '';
  const sMatch = loteNombre.match(/\b(bajo|loma|norte|sur|este|oeste|fondo|frente|rincon|alto|medio)\b/i);
  if (sMatch) sector = sMatch[0].charAt(0).toUpperCase() + sMatch[0].slice(1).toLowerCase();

  const productosRaw = Array.isArray(recetaExtraida.productos) ? recetaExtraida.productos : [];
  const insumosCalculados = productosRaw.map((p, idx) => {
    const prodNom = String(p.nombre || p.producto || 'Insumo').trim();
    const dosisHa = Number(p.dosis_ha) || 0;
    const { cantidadTotal: rawCant, unidad } = sanitizarCantidadYUnidadOCR(
      p.cantidad_total !== undefined && p.cantidad_total !== '' ? p.cantidad_total : 0,
      p.unidad || 'kg',
      ha,
      dosisHa
    );

    // Aritmética 100% determinística: si no viene cantidad total, se multiplica dosis * hectáreas
    const cantFinal = rawCant > 0 ? rawCant : (ha > 0 && dosisHa > 0 ? Number((dosisHa * ha).toFixed(2)) : 0);

    let pu = 0;
    let origenPrecio = 'Pendiente de cotización';
    const matchRef = buscarUltimoPrecioInsumo(prodNom, stockInsumos, siembrasExistentes, tc);
    if (matchRef && matchRef.precio_unitario > 0) {
      pu = matchRef.precio_unitario;
      origenPrecio = matchRef.fuente === 'stock_insumo' ? 'Ref. Stock Galpón' : 'Ref. Historial Compras';
    }

    const subtotalUsd = Number((cantFinal * pu).toFixed(2));
    const subtotalArs = Number((subtotalUsd * tc).toFixed(2));
    const costoHaUsd = ha > 0 ? Number((subtotalUsd / ha).toFixed(2)) : 0;

    return {
      id: `ins_${Date.now()}_${idx}`,
      producto: prodNom,
      principio_activo: p.principio_activo || prodNom,
      dosis_ha: dosisHa,
      unidad,
      cantidad_total: cantFinal,
      precio_unitario: pu,
      subtotal_usd: subtotalUsd,
      subtotal_ars: subtotalArs,
      costo_ha_usd: costoHaUsd,
      costo_total: subtotalUsd,
      origen_precio: origenPrecio,
    };
  });

  // Si hay notas de fertilización con dosis explícita (ej. "MAP 50 kg/ha")
  if (recetaExtraida.notas_fertilizacion && String(recetaExtraida.notas_fertilizacion).trim()) {
    const nFert = String(recetaExtraida.notas_fertilizacion);
    const fertMatch = nFert.match(/\b(map|monoam[oó]nico|dap|urea|superfosfato|sps|spt)\b.*?(\d+(?:[.,]\d+)?)\s*(kg|l|litros?)\/ha/i);
    if (fertMatch) {
      const nombreFert = fertMatch[1].toUpperCase() === 'MAP' ? 'Fosfato Monoamónico (MAP)' : fertMatch[1].toUpperCase();
      const yaEsta = insumosCalculados.some((i) => i.producto.toLowerCase().includes(fertMatch[1].toLowerCase()));
      if (!yaEsta) {
        const dFert = parseFloat(fertMatch[2].replace(',', '.'));
        const uFert = fertMatch[3].toLowerCase();
        const cantFert = ha > 0 ? Number((dFert * ha).toFixed(2)) : 0;
        let puFert = 0;
        const refFert = buscarUltimoPrecioInsumo(nombreFert, stockInsumos, siembrasExistentes, tc);
        if (refFert && refFert.precio_unitario > 0) puFert = refFert.precio_unitario;
        const subFert = Number((cantFert * puFert).toFixed(2));
        insumosCalculados.push({
          id: `ins_fert_${Date.now()}`,
          producto: nombreFert,
          principio_activo: nombreFert,
          dosis_ha: dFert,
          unidad: uFert,
          cantidad_total: cantFert,
          precio_unitario: puFert,
          subtotal_usd: subFert,
          subtotal_ars: Number((subFert * tc).toFixed(2)),
          costo_ha_usd: ha > 0 ? Number((subFert / ha).toFixed(2)) : 0,
          costo_total: subFert,
          origen_precio: 'Nota técnica de fertilización',
        });
      }
    }
  }

  const costoInsumosUSD = insumosCalculados.reduce((s, i) => s + (Number(i.subtotal_usd) || 0), 0);
  const costoInsumosARS = Number((costoInsumosUSD * tc).toFixed(2));

  return {
    id: `lote_receta_${Date.now()}`,
    selected: true,
    potrero_numero: potreroNum,
    potrero_nombre: potreroNombre,
    sector,
    cultivo_o_labor: recetaExtraida.cultivo || 'Siembra Directa',
    variedad_hibrido: '',
    fecha_estimada: recetaExtraida.fecha || new Date().toLocaleDateString('es-AR'),
    hectareas: ha,
    moneda: 'USD',
    costo_labor_ha: 0,
    costo_labor_total: 0,
    costo_insumos: costoInsumosUSD,
    costo_total: costoInsumosUSD,
    costo_total_usd: costoInsumosUSD,
    costo_total_ars: costoInsumosARS,
    costo_labor_usd: 0,
    costo_labor_ars: 0,
    costo_insumos_usd: costoInsumosUSD,
    costo_insumos_ars: costoInsumosARS,
    labores_detalle: [],
    insumos: insumosCalculados,
    observaciones: `${recetaExtraida.numero_receta ? `Receta N° ${recetaExtraida.numero_receta}. ` : ''}${recetaExtraida.notas_fertilizacion ? `Fertilización/Notas: ${recetaExtraida.notas_fertilizacion}. ` : ''}`.trim(),
    numero_receta: recetaExtraida.numero_receta || '',
    notas_fertilizacion: recetaExtraida.notas_fertilizacion || '',
    tipo_documento: 'receta_agronomica',
  };
}

export function calcularAritmeticaFacturaOCotizacion(cotizacionExtraida, dolarRef = 1540) {
  if (!cotizacionExtraida) return [];
  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
  const moneda = cotizacionExtraida.moneda || 'USD';
  const rawItems = Array.isArray(cotizacionExtraida.items) ? cotizacionExtraida.items : [];

  return rawItems.map((it, idx) => {
    const prodNom = String(it.producto || 'Insumo').trim();
    const cant = Number(it.cantidad) || 0;
    const pu = Number(it.precio_unitario) || 0;
    // Aritmética 100% determinística: cantidad * precio_unitario
    const subtotal = Number((cant * pu).toFixed(2));
    const subtotalUsd = moneda === 'ARS' ? Number((subtotal / tc).toFixed(2)) : subtotal;
    const subtotalArs = moneda === 'ARS' ? subtotal : Number((subtotal * tc).toFixed(2));
    const envase = Number(it.contenido_envase_kg_o_l) || (String(it.unidad_compra).toLowerCase().includes('bolsa') ? 25 : String(it.unidad_compra).toLowerCase().includes('bidon') ? 20 : 1);
    const totalKgOrL = (String(it.unidad_compra).toLowerCase().includes('bolsa') || String(it.unidad_compra).toLowerCase().includes('bidon'))
      ? Number((cant * envase).toFixed(2))
      : cant;

    return {
      id: `cot_${Date.now()}_${idx}`,
      producto: prodNom,
      cantidad_total: cant,
      unidad: it.unidad_compra || 'kg',
      contenido_envase_kg_o_l: envase,
      total_kg_o_l: totalKgOrL,
      precio_unitario: pu,
      moneda,
      subtotal,
      subtotal_usd: subtotalUsd,
      subtotal_ars: subtotalArs,
      costo_total: subtotal,
      proveedor: cotizacionExtraida.proveedor || '',
      numero_comprobante: cotizacionExtraida.numero_comprobante || '',
      fecha: cotizacionExtraida.fecha || new Date().toLocaleDateString('es-AR'),
      tipo_documento: cotizacionExtraida.tipo_documento || 'cotizacion',
      observaciones: `${cotizacionExtraida.proveedor ? `Proveedor: ${cotizacionExtraida.proveedor}. ` : ''}${cotizacionExtraida.numero_comprobante ? `N° ${cotizacionExtraida.numero_comprobante}. ` : ''}`.trim(),
    };
  });
}

export function calcularAritmeticaPlanillaLabores(planillaExtraida, potrerosList = [], dolarRef = 1540) {
  if (!planillaExtraida) return [];
  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
  const rawLotes = Array.isArray(planillaExtraida.lotes) ? planillaExtraida.lotes : [];

  return rawLotes.map((l, lIdx) => {
    const loteNombre = String(l.lote_nombre || 'Potrero').trim();
    const matchedP = findMatchingPotreroHelper(loteNombre, potrerosList);
    const potreroNum = matchedP ? Number(matchedP.numero) : (parseInt(loteNombre.replace(/\D/g, ''), 10) || 1);
    const potreroNombre = matchedP ? matchedP.nombre : loteNombre;
    const ha = Number(l.hectareas) || Number(matchedP?.hectareas) || 40;

    const rawLabores = Array.isArray(l.labores) ? l.labores : [];
    let loteMoneda = 'ARS';

    const laboresDetalle = rawLabores.map((lab, labIdx) => {
      const conc = String(lab.labor || `Labor #${labIdx + 1}`).trim();
      const pasadas = Number(lab.pasadas) || 1;
      const tarifa = Number(lab.tarifa_ha) || 0;
      const mon = lab.moneda || 'ARS';
      if (mon === 'USD') loteMoneda = 'USD';

      // Aritmética 100% determinística: ha * pasadas * tarifa_ha
      const subtotalLabor = Number((ha * pasadas * tarifa).toFixed(2));
      const subUsd = mon === 'ARS' ? Number((subtotalLabor / tc).toFixed(2)) : subtotalLabor;
      const subArs = mon === 'ARS' ? subtotalLabor : Number((subtotalLabor * tc).toFixed(2));

      return {
        id: `lab_${Date.now()}_${labIdx}`,
        concepto: conc,
        hectareas: ha,
        pasadas,
        precio_unitario: tarifa,
        subtotal: subtotalLabor,
        subtotal_usd: subUsd,
        subtotal_ars: subArs,
        moneda: mon,
      };
    });

    const costoLaboresTotal = laboresDetalle.reduce((s, lab) => s + (Number(lab.subtotal) || 0), 0);
    const costoLaboresUSD = loteMoneda === 'ARS' ? Number((costoLaboresTotal / tc).toFixed(2)) : costoLaboresTotal;
    const costoLaboresARS = loteMoneda === 'ARS' ? costoLaboresTotal : Number((costoLaboresTotal * tc).toFixed(2));
    const costoLaborHaUSD = ha > 0 ? Number((costoLaboresUSD / ha).toFixed(2)) : 0;

    return {
      id: `lote_labores_${Date.now()}_${lIdx}`,
      selected: true,
      potrero_numero: potreroNum,
      potrero_nombre: potreroNombre,
      cultivo_o_labor: laboresDetalle[0]?.concepto || 'Labor Agrícola / Contratista',
      hectareas: ha,
      moneda: loteMoneda,
      costo_labor_ha: costoLaborHaUSD,
      costo_labor_total: costoLaboresUSD,
      costo_insumos: 0,
      costo_total: costoLaboresUSD,
      costo_total_usd: costoLaboresUSD,
      costo_total_ars: costoLaboresARS,
      costo_labor_usd: costoLaboresUSD,
      costo_labor_ars: costoLaboresARS,
      costo_insumos_usd: 0,
      costo_insumos_ars: 0,
      labores_detalle: laboresDetalle,
      insumos: [],
      observaciones: `Planilla de labores de contratista (${laboresDetalle.length} labores)`,
      tipo_documento: 'planilla_labores',
    };
  });
}

export function cruzarRecetaConCotizacion(loteReceta, cotizacionItems = [], dolarRef = 1540) {
  if (!loteReceta) return loteReceta;
  const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
  const insumosActuales = Array.isArray(loteReceta.insumos) ? [...loteReceta.insumos] : [];
  const ha = Number(loteReceta.hectareas) || 1;

  let actualizados = 0;
  const insumosCruzados = insumosActuales.map((ins) => {
    const insNom = String(ins.producto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const insPa = String(ins.principio_activo || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const match = cotizacionItems.find((cg) => {
      const cgNom = String(cg.producto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!cgNom) return false;
      return (
        cgNom.includes(insNom) ||
        insNom.includes(cgNom) ||
        (insPa && (cgNom.includes(insPa) || insPa.includes(cgNom))) ||
        (insNom.length >= 4 && cgNom.length >= 4 && cgNom.slice(0, 5) === insNom.slice(0, 5))
      );
    });

    if (match && Number(match.precio_unitario) > 0) {
      actualizados++;
      const pu = Number(match.precio_unitario);
      const monedaItem = match.moneda || 'USD';
      const cant = Number(ins.cantidad_total) || Number((Number(ins.dosis_ha) * ha).toFixed(2)) || 0;
      const sub = Number((cant * pu).toFixed(2));
      const subUsd = monedaItem === 'ARS' ? Number((sub / tc).toFixed(2)) : sub;
      const subArs = monedaItem === 'ARS' ? sub : Number((sub * tc).toFixed(2));

      return {
        ...ins,
        precio_unitario: pu,
        moneda: monedaItem,
        subtotal_usd: subUsd,
        subtotal_ars: subArs,
        costo_total: subUsd,
        costo_ha_usd: ha > 0 ? Number((subUsd / ha).toFixed(2)) : 0,
        origen_precio: `Cotización: ${match.producto} (${monedaItem} $${pu})`,
      };
    }
    return ins;
  });

  const costoInsumosUSD = insumosCruzados.reduce((s, i) => s + (Number(i.subtotal_usd || i.costo_total) || 0), 0);
  const costoLaboresUSD = Number(loteReceta.costo_labor_usd) || 0;
  const costoTotalUSD = Number((costoInsumosUSD + costoLaboresUSD).toFixed(2));
  const costoTotalARS = Number((costoTotalUSD * tc).toFixed(2));

  return {
    ...loteReceta,
    insumos: insumosCruzados,
    costo_insumos: costoInsumosUSD,
    costo_insumos_usd: costoInsumosUSD,
    costo_insumos_ars: Number((costoInsumosUSD * tc).toFixed(2)),
    costo_total: costoTotalUSD,
    costo_total_usd: costoTotalUSD,
    costo_total_ars: costoTotalARS,
    _actualizadosCotizacion: actualizados,
  };
}

export async function analizarRecetaORemitoSiembra(
  filesOrData,
  potrerosList = [],
  isSandbox = false,
  onProgress = null,
  contextoUsuario = '',
  modoExtractor = 'auto'
) {
  // Normalizar a array de ítems/archivos
  let items = [];
  if (Array.isArray(filesOrData)) {
    items = filesOrData;
  } else if (filesOrData && typeof filesOrData === 'object') {
    if (Array.isArray(filesOrData.files)) {
      items = filesOrData.files;
    } else {
      items = [filesOrData];
    }
  } else if (filesOrData) {
    items = [filesOrData];
  }
  items = items.filter(Boolean);

  const tieneTextoContexto = Boolean(contextoUsuario && String(contextoUsuario).trim());

  if (items.length === 0 && !tieneTextoContexto) {
    throw new Error('No se recibieron archivos ni indicaciones de contexto en texto para analizar.');
  }

  // Si no hay key y estamos en Sandbox, o modo simulación
  if (isSandbox && !hasGeminiKey()) {
    return getMockSiembraMultiLoteSandbox(potrerosList, contextoUsuario);
  }

  try {
    // Determinar modo extractor
    let modoEfectivo = String(modoExtractor || 'auto').toLowerCase();
    
    // Heurística de autodetección si viene en 'auto'
    if (modoEfectivo === 'auto') {
      const filesNames = items.map((it) => (it?.name || it?.fileName || '').toLowerCase()).join(' ');
      const ctxLower = String(contextoUsuario || '').toLowerCase();
      const combinedMeta = filesNames + ' ' + ctxLower;

      if (/factura|cotizaci[oó]n|presupuesto|coop(?:erativa)?|listas*des*precios|agronom[ií]a/i.test(combinedMeta)) {
        if (/receta|rao|mda|ordens*des*trabajo|pulveriz/i.test(combinedMeta)) {
          modoEfectivo = 'cruce_mixto';
        } else {
          modoEfectivo = 'factura';
        }
      } else if (/labor|contratista|disco|pasada|tarifa|tractor|cosecha/i.test(combinedMeta) && !/receta|rao|mda/i.test(combinedMeta)) {
        modoEfectivo = 'labores';
      } else {
        modoEfectivo = 'receta';
      }
    }

    if (typeof onProgress === 'function') {
      onProgress(1, 1, `Analizando documentos con extractor especializado: ${modoEfectivo.toUpperCase()}...`);
    }

    // 1. MODO FACTURA O COTIZACIÓN DE INSUMOS
    if (modoEfectivo === 'factura' || modoEfectivo === 'cotizacion') {
      const rawFactura = await extraerFacturaOCotizacion(items, { contextoUsuario });
      const resultadoFactura = calcularAritmeticaFacturaOCotizacion(rawFactura);
      return resultadoFactura;
    }

    // 2. MODO PLANILLA DE LABORES / CONTRATISTA
    if (modoEfectivo === 'labores') {
      const rawLabores = await extraerPlanillaLabores(items, { potrerosList, contextoUsuario });
      const resultadoLabores = calcularAritmeticaPlanillaLabores(rawLabores, potrerosList);
      return resultadoLabores;
    }

    // 3. MODO CRUCE MIXTO (Receta + Cotización/Lista de precios)
    if (modoEfectivo === 'cruce_mixto') {
      const [rawReceta, rawFactura] = await Promise.all([
        extraerRecetaAgronomica(items, { potrerosList, contextoUsuario }).catch(() => null),
        extraerFacturaOCotizacion(items, { contextoUsuario }).catch(() => null),
      ]);

      if (rawReceta) {
        const resultadoReceta = calcularAritmeticaReceta(rawReceta, potrerosList);
        if (rawFactura) {
          const resultadoCotiz = calcularAritmeticaFacturaOCotizacion(rawFactura);
          const cotizacionItems = resultadoCotiz.compras_generales_campana || [];
          const lotesCruzados = resultadoReceta.lotes.map((lote) =>
            cruzarRecetaConCotizacion(lote, cotizacionItems, 1200)
          );
          resultadoReceta.lotes = lotesCruzados;
          resultadoReceta.compras_generales_campana = cotizacionItems;
          resultadoReceta.notas_auditoria_ia += ` | Se cruzaron determinísticamente precios de cotización de ${resultadoCotiz.ingeniero_o_proveedor || 'proveedor'}.`;
        }
        return resultadoReceta;
      }
    }

    // 4. MODO POR DEFECTO: RECETA AGRONÓMICA (Modo A)
    const rawReceta = await extraerRecetaAgronomica(items, { potrerosList, contextoUsuario });
    const resultadoReceta = calcularAritmeticaReceta(rawReceta, potrerosList);

    // Si no se extrajo ningún insumo (por ejemplo si el documento en realidad era una cotización o lista de precios)
    const tieneInsumos = Array.isArray(resultadoReceta?.lotes?.[0]?.insumos) && resultadoReceta.lotes[0].insumos.length > 0;
    if (!tieneInsumos && items.length > 0) {
      try {
        const rawCotiz = await extraerFacturaOCotizacion(items, { contextoUsuario });
        const resCotiz = calcularAritmeticaFacturaOCotizacion(rawCotiz);
        if (resCotiz.compras_generales_campana && resCotiz.compras_generales_campana.length > 0) {
          return resCotiz;
        }
      } catch (eCotiz) {
        // Mantener resultado original
      }
    }

    return resultadoReceta;
  } catch (err) {
    if (isSandbox) {
      console.warn('Fallo en llamada real Gemini en Modo Sandbox, usando simulador multi-lote:', err.message);
      return getMockSiembraMultiLoteSandbox(potrerosList);
    }

    // Fallback secuencial si hay múltiples archivos
    if (items.length > 1) {
      console.warn(`Llamada principal falló (${err.message}). Activando fallback archivo por archivo...`);
      const fallbackResultados = [];

      for (let i = 0; i < items.length; i++) {
        const itemIndividual = items[i];
        const fileName = itemIndividual?.name || itemIndividual?.fileName || `Archivo #${i + 1}`;
        if (typeof onProgress === 'function') {
          onProgress(i + 1, items.length, fileName);
        }

        try {
          const singleRes = await analizarRecetaORemitoSiembra([itemIndividual], potrerosList, isSandbox, null, '', 'auto');
          if (singleRes && (singleRes.lotes?.length > 0 || singleRes.compras_generales_campana?.length > 0)) {
            fallbackResultados.push(singleRes);
          }
        } catch (subErr) {
          console.warn(`Fallback falló para archivo "${fileName}":`, subErr.message);
        }
      }

      if (fallbackResultados.length > 0) {
        return consolidarResultadosSiembra(fallbackResultados);
      }
    }

    throw err;
  }
}

// Consolidar resultados obtenidos mediante fallback archivo por archivo
function consolidarResultadosSiembra(resultados = []) {
  const lotesConsolidados = [];
  const comprasConsolidadas = [];
  const partidasConsolidadas = [];
  let subtotalSum = 0;
  let totalSum = 0;
  let montoSinFacturarSum = 0;
  let monedaFinal = 'ARS';
  const notasList = [];
  let emisorFinal = '';
  let remitoFinal = '';

  resultados.forEach((res, rIdx) => {
    if (!res) return;
    if (res.moneda === 'ARS') monedaFinal = 'ARS';
    else if (rIdx === 0 && res.moneda) monedaFinal = res.moneda;

    if (Array.isArray(res.lotes)) {
      lotesConsolidados.push(...res.lotes);
    }
    if (Array.isArray(res.compras_generales_campana)) {
      comprasConsolidadas.push(...res.compras_generales_campana);
    }
    if (Array.isArray(res.partidas_detalle)) {
      partidasConsolidadas.push(...res.partidas_detalle);
    }

    subtotalSum += Number(res.subtotal_neto) || 0;
    totalSum += Number(res.total_documento) || 0;
    montoSinFacturarSum += Number(res.monto_sin_facturar) || 0;

    if (res.ingeniero_o_proveedor && !emisorFinal) {
      emisorFinal = res.ingeniero_o_proveedor;
    }
    if (res.remito_o_receta_nro) {
      remitoFinal = remitoFinal ? `${remitoFinal}, ${res.remito_o_receta_nro}` : res.remito_o_receta_nro;
    }
    if (res.notas_auditoria_ia) {
      notasList.push(`[Doc #${rIdx + 1}] ${res.notas_auditoria_ia}`);
    }
  });

  return {
    tipo_documento: 'receta_lote_consolidado',
    campana: resultados[0]?.campana || '2026/2027',
    moneda: monedaFinal,
    moneda_detectada: monedaFinal,
    subtotal_neto: subtotalSum,
    iva_detectado: 0,
    monto_sin_facturar: montoSinFacturarSum,
    total_documento: totalSum || subtotalSum,
    notas_auditoria_ia: `Procesamiento consolidado archivo por archivo (${resultados.length} documentos procesados con éxito). ${notasList.join(' · ')}`,
    partidas_detalle: partidasConsolidadas,
    ingeniero_o_proveedor: emisorFinal,
    remito_o_receta_nro: remitoFinal,
    observaciones_generales: `Lote consolidado de ${resultados.length} archivos individuales.`,
    lotes: lotesConsolidados,
    compras_generales_campana: comprasConsolidadas,
    potrero_numero: lotesConsolidados[0]?.potrero_detectado || null,
    cultivo_variedad: lotesConsolidados[0]?.cultivo_o_labor || null,
    variedad_hibrido: lotesConsolidados[0]?.variedad_hibrido || '',
    receta_productos: lotesConsolidados[0]?.insumos || [],
    insumos_aplicados: [],
  };
}

// Generador de datos simulados realistas para Modo Sandbox
function getMockSiembraMultiLoteSandbox(potrerosList = [], contextoUsuario = '') {
  const p1 = (potrerosList || []).find((p) => Number(p.numero) === 14) || (potrerosList || [])[0] || { numero: 14, nombre: 'Lote 14 (El Ombú)', hectareas: 62.5 };
  const p2 = (potrerosList || []).find((p) => Number(p.numero) === 9) || (potrerosList || [])[1] || { numero: 9, nombre: 'Lote 9 (La Cancha)', hectareas: 44.0 };
  const ctxLow = String(contextoUsuario || '').toLowerCase();
  const esSorgo = ctxLow.includes('sorgo');

  return {
    tipo_documento: 'receta_agronomica_multi_lote',
    campana: '2026/2027',
    moneda: ctxLow.includes('usd') || ctxLow.includes('dolar') || ctxLow.includes('dólar') ? 'USD' : 'ARS',
    ingeniero_o_proveedor: 'Ing. Agr. San José (Simulador Sandbox)',
    remito_o_receta_nro: 'REC-2026-884',
    observaciones_generales: contextoUsuario
      ? `Plan interpretado en Modo Sandbox a partir de indicaciones del usuario: "${contextoUsuario.slice(0, 90)}...".`
      : 'Plan de siembra y labores contratadas interpretado en Modo Sandbox.',
    lotes: [
      {
        potrero_detectado: `Potrero #${p1.numero} (${p1.nombre})`,
        sector: 'Loma',
        cultivo_o_labor: esSorgo ? 'Sorgo Forrajero' : 'Maíz Silaje / Grano',
        tipo_tarea: 'Siembra Directa',
        variedad_hibrido: esSorgo ? 'Sorgo ACA 727' : 'Dekalb 72-10 VT3P',
        fecha_estimada: '20/11/2026',
        superficie_ha: Number(p1.hectareas) || 62.5,
        moneda: 'ARS',
        costo_labor_ha: 90000,
        costo_total_declarado: 8950000,
        labores_detalle: [
          { concepto: '1 Pasada de disco', hectareas: Number(p1.hectareas) || 62.5, precio_unitario: 16000, subtotal: (Number(p1.hectareas) || 62.5) * 16000 },
          { concepto: 'Siembra directa', hectareas: Number(p1.hectareas) || 62.5, precio_unitario: 90000, subtotal: (Number(p1.hectareas) || 62.5) * 90000 },
        ],
        observaciones: 'Siembra directa sobre rastrojo de invierno. Aplicar con humedad de suelo adecuada.',
        insumos: [
          { producto: esSorgo ? 'Semilla Sorgo ACA 727' : 'Semilla Maíz Dekalb 72-10', dosis_ha: esSorgo ? 25 : 1.1, unidad: esSorgo ? 'kg' : 'bolsas', cantidad_total: Math.round((Number(p1.hectareas) || 62.5) * (esSorgo ? 25 : 1.1)), precio_unitario: esSorgo ? 3160 : 215000, costo_total: Math.round((Number(p1.hectareas) || 62.5) * (esSorgo ? 25 : 1.1) * (esSorgo ? 3160 : 215000)) },
          { producto: 'Fosfato Monoamónico (MAP)', dosis_ha: 90, unidad: 'kg', cantidad_total: (Number(p1.hectareas) || 62.5) * 90, precio_unitario: 1300, costo_total: Math.round((Number(p1.hectareas) || 62.5) * 90 * 1300) },
          { producto: 'Glifosato 66%', dosis_ha: 2.5, unidad: 'L', cantidad_total: (Number(p1.hectareas) || 62.5) * 2.5, precio_unitario: 9800, costo_total: Math.round((Number(p1.hectareas) || 62.5) * 2.5 * 9800) },
          { producto: 'Atrazina 50%', dosis_ha: 2.0, unidad: 'L', cantidad_total: (Number(p1.hectareas) || 62.5) * 2.0, precio_unitario: 8900, costo_total: Math.round((Number(p1.hectareas) || 62.5) * 2.0 * 8900) },
        ],
      },
      {
        potrero_detectado: `Potrero #${p2.numero} (${p2.nombre})`,
        sector: 'Bajo',
        cultivo_o_labor: 'Verdeo de Invierno (Avena + Vicia)',
        tipo_tarea: 'Siembra Directa',
        variedad_hibrido: 'Avena Bonaerense + Vicia Villosa',
        fecha_estimada: '22/11/2026',
        superficie_ha: Number(p2.hectareas) || 44.0,
        moneda: 'ARS',
        costo_labor_ha: 75000,
        costo_total_declarado: 3300000,
        labores_detalle: [
          { concepto: 'Siembra directa verdeo', hectareas: Number(p2.hectareas) || 44.0, precio_unitario: 75000, subtotal: (Number(p2.hectareas) || 44.0) * 75000 },
        ],
        observaciones: 'Pastoreo de invierno para recría de terneros.',
        insumos: [
          { producto: 'Semilla Avena Bonaerense', dosis_ha: 60, unidad: 'kg', cantidad_total: (Number(p2.hectareas) || 44.0) * 60, precio_unitario: 1050, costo_total: Math.round((Number(p2.hectareas) || 44.0) * 60 * 1050) },
          { producto: 'Urea Granulada 46%', dosis_ha: 75, unidad: 'kg', cantidad_total: (Number(p2.hectareas) || 44.0) * 75, precio_unitario: 980, costo_total: Math.round((Number(p2.hectareas) || 44.0) * 75 * 980) },
        ],
      },
    ],
  };
}

// 4. Lector de Romaneos y Liquidaciones de Hacienda
export async function analizarLiquidacionHacienda(file, contextoUsuario = '') {
  const tieneContexto = Boolean(contextoUsuario && String(contextoUsuario).trim());
  if (!file && !tieneContexto) {
    throw new Error('No se recibió liquidación ni indicaciones de venta para analizar.');
  }

  let base64 = null;
  let mimeType = null;

  if (file) {
    let fileToAnalyze = file;
    mimeType = getFileMimeType(file);

    if (isPdfFile(file)) {
      if ((file.size || 0) > 2.5 * 1024 * 1024) {
        try {
          const pages = await slicePdfToImages(file, { maxPages: 1, maxWidth: 1600, quality: 0.82 });
          if (pages && pages.length > 0 && pages[0].file) {
            fileToAnalyze = pages[0].file;
            mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
          }
        } catch (e) {
          console.warn('Fallback al trozar PDF en analizarLiquidacionHacienda:', e);
          fileToAnalyze = file;
          mimeType = 'application/pdf';
        }
      } else {
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      mimeType = getFileMimeType(fileToAnalyze);
    }

    base64 = await fileToBase64(fileToAnalyze);
  }

  const systemPrompt = `Sos el especialista en comercialización ganadera y auditor contable de Agroganadera Rincón del Sur S.A.
Tu rol es razonar y extraer con precisión matemática absoluta los datos de liquidaciones de hacienda (consignatarios como Saenz Valiente Bullrich, Madelan, Colombo y Magliano, remates feria, frigoríficos).
${compilarPromptContextoVivo()}
${tieneContexto ? `
========================================================================
INDICACIONES Y CONTEXTO DEL USUARIO (PRIORIDAD ALTA):
"""
${String(contextoUsuario).trim()}
"""
ATENCIÓN: Estas indicaciones del usuario tienen prioridad para categorías, precios por kg, cabezas o asignación de rodeos.
========================================================================
` : ''}

REGLAS CRÍTICAS PARA KILOS Y MULTI-LOTE:
1. SI LA LIQUIDACIÓN CONTIENE MÚLTIPLES LOTES O RENGLONES DE HACIENDA (ej: Lote 1 Vacas, Lote 2 Vacas CUT, Lote 3 Terneras):
   - "total_kilos" DEBE SER LA SUMA EXACTA DE LOS KILOS NETOS DE TODOS LOS RENGLONES VENDIDOS. NUNCA tomes los kilos de un solo renglón o sublote.
   - "total_cabezas" DEBE SER LA SUMA EXACTA DE CABEZAS DE TODOS LOS RENGLONES.
   - En cada renglón: "kilos_totales" son los kilos de ese lote, "cabezas" los animales de ese lote, "kilos_promedio" = kilos_totales / cabezas (generalmente entre 140 kg y 580 kg/cab según categoría).
2. PRECIO POR KG:
   - Debe calcularse sobre el IMPORTE BRUTO de la hacienda (sin restar comisiones ni fletes).
3. TOTALES IMPOSITIVOS Y DEUDAS/GASTOS:
   - "monto_iva" es el IVA Débito Fiscal facturado (típicamente 10.5% del neto gravado de hacienda).
   - "moneda" y "moneda_detectada" son casi siempre 'ARS' en remates locales; clasificar como 'USD' solo si está explícitamente en dólares.
   - Detallá en "notas_auditoria_ia" un dictamen técnico claro y preciso en español rioplatense.`;

  const prompt = `Analizá esta liquidación de venta de hacienda / cuenta de venta y líquido producto y devolvé un JSON con:
{
  "fecha": "YYYY-MM-DD",
  "consignataria_o_comprador": "Razón social del consignatario o frigorífico",
  "numero_liquidacion": "Número de liquidación o remate (ej: 0208-00015274)",
  "dta_guia_numero": "Número de Guía o DTA si figura o null",
  "moneda": "ARS | USD",
  "moneda_detectada": "ARS | USD",
  "subtotal_neto": número imponible de hacienda sujeto a IVA,
  "iva_detectado": número del IVA Débito Fiscal generado por la venta (10.5% sobre hacienda),
  "monto_sin_facturar": 0,
  "total_documento": número líquido a cobrar por el vendedor,
  "notas_auditoria_ia": "Dictamen de auditoría ganadera y contable en español rioplatense",
  "renglones": [
    {
      "categoria": "Vacas | Terneros | Terneras | Vaquillonas | Toros | Vacas CUT | Novillos",
      "cabezas": número entero de animales de este lote,
      "kilos_totales": número total de kg netos pesados para este renglón,
      "kilos_promedio": número de kg promedio por cabeza de este lote,
      "precio_por_kg": precio $ por kilo vivo pactado en remate/balanza (sobre bruto),
      "importe_bruto": número del total bruto de este renglón (kilos_totales * precio_por_kg)
    }
  ],
  "partidas_detalle": [
    {
      "concepto": "Categoría y detalle del lote",
      "cantidad": número de cabezas,
      "unidad": "cab",
      "precio_unitario": precio por cabeza o precio por kg,
      "subtotal": número bruto del lote
    }
  ],
  "total_cabezas": número total de animales liquidados (suma de todos los renglones),
  "total_kilos": número total de kg comercializados (SUMA EXACTA DE LOS KILOS DE TODOS LOS RENGLONES, nunca un lote parcial),
  "neto_gravado": número imponible de hacienda sujeto a IVA,
  "alicuota_iva": 10.5,
  "monto_iva": número del IVA Débito Fiscal generado por la venta (10.5% sobre hacienda),
  "percepciones_iva": número de percepciones de IVA si figuran o 0,
  "retenciones_iva": número de retenciones de IVA efectuadas por el consignatario (pago a cuenta) o 0,
  "importe_bruto_total": número de importe bruto total de hacienda antes de deducciones,
  "descuentos_comisiones_flete": número total de deducciones (comisiones, flete, SENASA, pesaje, etc.),
  "importe_neto_liquidado": número líquido a cobrar por el vendedor,
  "caravanas_detectadas": ["Lista de caravanas individuales mencionadas en el documento o null si no figuran"],
  "observaciones": "Condición de pago (ej: 30-60 días, e-check), destino (faena, invernada, etc.)"
}`;

  const raw = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });
  return normalizarLiquidacionMultiLote(raw);
}

/** Post-proceso: totales = suma de TODOS los renglones (multi-lote). */
export function normalizarLiquidacionMultiLote(res) {
  if (!res || typeof res !== 'object' || !Array.isArray(res.renglones) || res.renglones.length === 0) return res;
  const num = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.replace(/[^\d.,-]/g, '');
      const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };
  const renglones = res.renglones.map((r) => {
    const cab = num(r.cabezas);
    const kg = num(r.kilos_totales) || (num(r.kilos_promedio) * cab);
    return { ...r, cabezas: cab, kilos_totales: kg, kilos_promedio: cab > 0 ? Math.round((kg / cab) * 10) / 10 : num(r.kilos_promedio) };
  });
  const sumKg = renglones.reduce((a, r) => a + r.kilos_totales, 0);
  const sumCab = renglones.reduce((a, r) => a + r.cabezas, 0);
  const sumBruto = renglones.reduce((a, r) => a + num(r.importe_bruto), 0);
  const finalBruto = sumBruto > num(res.importe_bruto_total) ? sumBruto : (num(res.importe_bruto_total) || sumBruto);
  const finalIva = num(res.monto_iva) > 0 ? num(res.monto_iva) : Math.round(finalBruto * 0.105 * 100) / 100;

  const finalSubtotalNeto = num(res.subtotal_neto) || num(res.neto_gravado) || finalBruto;
  const finalDescuentos = num(res.descuentos_comisiones_flete);
  const finalLiquido = num(res.total_documento) || num(res.importe_neto_liquidado) || Math.max(0, finalBruto - finalDescuentos);
  const docMoneda = res.moneda_detectada || res.moneda || 'ARS';

  const partidasDetalle = Array.isArray(res.partidas_detalle) && res.partidas_detalle.length > 0
    ? res.partidas_detalle
    : renglones.map((r) => ({
        concepto: `${r.categoria || 'Hacienda'} (${r.cabezas} cab @ ${r.kilos_promedio || 0} kg/cab)`,
        cantidad: r.cabezas,
        unidad: 'cab',
        precio_unitario: r.precio_por_kg,
        subtotal: r.importe_bruto,
      }));

  let notasAuditoria = res.notas_auditoria_ia || '';
  if (!notasAuditoria) {
    const cats = renglones.map((r) => r.categoria + ' (' + r.cabezas + ' cab)').join(' + ');
    const totKg = sumKg > 0 ? Math.max(sumKg, num(res.total_kilos)) : num(res.total_kilos);
    const totCab = sumCab > 0 ? Math.max(sumCab, num(res.total_cabezas)) : num(res.total_cabezas);
    notasAuditoria = 'Liquidación de ' + totCab + ' cabezas (' + (cats || 'Hacienda') + ') por ' + totKg.toLocaleString('es-AR') + ' kg netos. Bruto: $' + Math.round(finalBruto).toLocaleString('es-AR') + '. Líquido: $' + Math.round(finalLiquido).toLocaleString('es-AR') + '.';
  }

  return {
    ...res,
    renglones,
    partidas_detalle: partidasDetalle,
    moneda_detectada: docMoneda,
    moneda: docMoneda,
    subtotal_neto: finalSubtotalNeto,
    iva_detectado: finalIva,
    monto_sin_facturar: num(res.monto_sin_facturar) || 0,
    total_documento: finalLiquido,
    notas_auditoria_ia: notasAuditoria,
    total_kilos: sumKg > 0 ? Math.max(sumKg, num(res.total_kilos)) : num(res.total_kilos),
    total_cabezas: sumCab > 0 ? Math.max(sumCab, num(res.total_cabezas)) : num(res.total_cabezas),
    importe_bruto_total: finalBruto,
    monto_iva: finalIva,
    importe_neto_liquidado: finalLiquido,
  };
}

/**
 * Analiza un documento de liquidación de hacienda multipágina procesando cada página en JPEG (<800 KB)
 * con concurrencia controlada (ej: 3 páginas a la vez) y fusionando renglones y totales.
 */
export async function analizarLiquidacionMultipage(pages = [], concurrency = 3) {
  if (!pages || pages.length === 0) {
    throw new Error('No se encontraron páginas para procesar en el PDF.');
  }

  if (pages.length === 1) {
    return await analizarLiquidacionHacienda(pages[0].file);
  }

  const results = await runWithControlledConcurrency(
    pages,
    async (p) => {
      try {
        return await analizarLiquidacionHacienda(p.file);
      } catch (err) {
        console.warn(`[analizarLiquidacionMultipage] Error en pág. ${p.pageNumber}:`, err);
        return null;
      }
    },
    concurrency
  );

  const validResults = results.filter(Boolean);
  if (validResults.length === 0) {
    throw new Error('No se pudo extraer información de las páginas del documento.');
  }

  // Fusionar renglones de todas las páginas sin duplicar
  const allRenglones = [];
  validResults.forEach((r) => {
    if (Array.isArray(r.renglones)) {
      allRenglones.push(...r.renglones);
    }
  });

  const base = validResults[0];
  const totalCab = allRenglones.reduce((acc, r) => acc + (Number(r.cabezas) || 0), 0) || Number(base.total_cabezas) || 0;
  const totalKg = allRenglones.reduce((acc, r) => acc + (Number(r.kilos_totales) || 0), 0) || Number(base.total_kilos) || 0;
  const totalBruto = allRenglones.reduce((acc, r) => acc + (Number(r.importe_bruto) || 0), 0) || Number(base.importe_bruto_total) || 0;
  const deducciones = validResults.reduce((acc, r) => acc + (Number(r.descuentos_comisiones_flete) || 0), 0);
  const totalNeto = Math.max(0, totalBruto - deducciones) || Number(base.importe_neto_liquidado) || 0;
  const totalIva = validResults.reduce((acc, r) => acc + (Number(r.monto_iva) || 0), 0) || Number(base.monto_iva) || 0;
  const totalRetIva = validResults.reduce((acc, r) => acc + (Number(r.retenciones_iva) || 0), 0) || Number(base.retenciones_iva) || 0;
  const totalPercIva = validResults.reduce((acc, r) => acc + (Number(r.percepciones_iva) || 0), 0) || Number(base.percepciones_iva) || 0;

  return {
    ...base,
    renglones: allRenglones,
    total_cabezas: totalCab,
    total_kilos: totalKg,
    importe_bruto_total: totalBruto,
    descuentos_comisiones_flete: deducciones,
    importe_neto_liquidado: totalNeto,
    monto_iva: totalIva,
    retenciones_iva: totalRetIva,
    percepciones_iva: totalPercIva,
  };
}

// 4b. Lector y Auditor de Balances Contables y Estados Financieros Anuales (Estudio Contable)
export async function analizarBalanceContablePdf(file, onProgress) {
  let pages = [];
  if (isPdfFile(file)) {
    try {
      pages = await slicePdfToImages(file, {
        maxPages: 30,
        maxWidth: 1600,
        quality: 0.82,
        onProgress: onProgress ? ({ current, total }) => onProgress({ current, total, phase: 'slicing' }) : undefined,
      });
    } catch (err) {
      console.warn('Error trozando PDF de balance:', err);
      pages = [{ file, pageNumber: 1, totalPages: 1, isPdf: true, mimeType: 'application/pdf' }];
    }
  } else {
    pages = [{ file, pageNumber: 1, totalPages: 1, isPdf: false, mimeType: getFileMimeType(file) }];
  }

  const systemPrompt = `Sos el Perito Auditor Contable y Asesor Financiero Agropecuario de Establecimiento San José (Agroganadera Rincón del Sur S.A., Las Flores, Bs. As., CUIT 30-71234567-8).
Tu especialidad es auditar balances contables cerrados emitidos por el Estudio Contable, con cierre de ejercicio al 31 de Julio (ejercicio agropecuario oficial Agosto–Julio).
Tu tarea es extraer el Estado de Resultados, el Anexo de Bienes de Cambio (Hacienda vacuna al 31/07 con desglose de categorías y cabezas) y los Gastos por Rubro cerrados para contrastarlos contra la gestión real.`;

  const pageResults = await runWithControlledConcurrency(
    pages,
    async (p, idx) => {
      onProgress?.({ current: idx + 1, total: pages.length, phase: 'analyzing' });
      const base64 = await fileToBase64(p.file);
      const prompt = `Analizá esta página (Pág. ${p.pageNumber}/${p.totalPages}) del Balance General / Estados Contables y extraé en JSON lo que corresponda a esta página:
{
  "ejercicio": "ej: 2024/2025 o 2025/2026",
  "fecha_inicio": "YYYY-08-01 o null",
  "fecha_cierre": "YYYY-07-31 o null",
  "razon_social": "Razón social o Agroganadera Rincón del Sur S.A.",
  "cuit": "CUIT si figura",
  "es_estado_resultado": boolean (true si contiene ventas, costos de explotación o resultado del ejercicio),
  "ventas_hacienda_ars": número o 0,
  "ventas_granos_ars": número o 0,
  "costo_ventas_hacienda_ars": número o 0,
  "gastos_administracion_ars": número o 0,
  "gastos_comercializacion_ars": número o 0,
  "resultado_ejercicio_ars": número o 0,
  "es_bienes_de_cambio": boolean (true si contiene el anexo de hacienda / vacas / terneros al cierre 31/07),
  "total_cabezas_hacienda": número entero de cabezas al cierre o 0,
  "valuacion_hacienda_ars": número total de valuación de hacienda o 0,
  "categorias_hacienda": [
    {
      "categoria": "Vacas | Vaquillonas | Terneros/as | Toros",
      "cabezas": número,
      "valuacion_unitaria_ars": número,
      "total_ars": número
    }
  ],
  "rubros_gastos_cerrados": [
    {
      "rubro": "Nombre del rubro contable",
      "monto_ars": número
    }
  ],
  "notas_auditor": "Observaciones o dictamen relevante"
}`;

      try {
        const pageMime = p.mimeType || getFileMimeType(p.file);
        return await callGeminiApi({
          prompt,
          systemPrompt,
          fileBase64: base64,
          mimeType: pageMime,
          responseJson: true,
        });
      } catch (e) {
        console.warn(`Error analizando página ${p.pageNumber} de balance:`, e);
        return null;
      }
    },
    2
  );

  const valid = pageResults.filter(Boolean);
  if (valid.length === 0) {
    throw new Error('No se pudo extraer información contable de las páginas del archivo.');
  }

  // Consolidar resultados del balance
  let ejercicio = valid.find((v) => v.ejercicio && v.ejercicio.includes('/'))?.ejercicio || '2025/2026';
  let fechaInicio = valid.find((v) => v.fecha_inicio)?.fecha_inicio || `${ejercicio.slice(0, 4)}-08-01`;
  let fechaCierre = valid.find((v) => v.fecha_cierre)?.fecha_cierre || `20${ejercicio.slice(5, 7)}-07-31`;
  let razonSocial = valid.find((v) => v.razon_social)?.razon_social || 'Agroganadera Rincón del Sur S.A.';
  let cuit = valid.find((v) => v.cuit)?.cuit || '30-71234567-8';

  const estadoResultado = {
    ventas_hacienda_ars: valid.reduce((max, v) => Math.max(max, Number(v.ventas_hacienda_ars) || 0), 0),
    ventas_granos_ars: valid.reduce((max, v) => Math.max(max, Number(v.ventas_granos_ars) || 0), 0),
    costo_ventas_hacienda_ars: valid.reduce((max, v) => Math.max(max, Number(v.costo_ventas_hacienda_ars) || 0), 0),
    gastos_administracion_ars: valid.reduce((max, v) => Math.max(max, Number(v.gastos_administracion_ars) || 0), 0),
    gastos_comercializacion_ars: valid.reduce((max, v) => Math.max(max, Number(v.gastos_comercializacion_ars) || 0), 0),
    resultado_ejercicio_ars: valid.find((v) => v.resultado_ejercicio_ars !== undefined && v.resultado_ejercicio_ars !== 0)?.resultado_ejercicio_ars || 0,
  };

  // Consolidar Bienes de Cambio
  const allCategorias = [];
  valid.forEach((v) => {
    if (Array.isArray(v.categorias_hacienda)) {
      v.categorias_hacienda.forEach((c) => {
        if (c.cabezas > 0 && !allCategorias.some((x) => x.categoria === c.categoria)) {
          allCategorias.push(c);
        }
      });
    }
  });

  const totalCabezas =
    allCategorias.reduce((acc, c) => acc + (Number(c.cabezas) || 0), 0) ||
    valid.reduce((max, v) => Math.max(max, Number(v.total_cabezas_hacienda) || 0), 0);
  const totalValuacionHacienda =
    allCategorias.reduce((acc, c) => acc + (Number(c.total_ars) || 0), 0) ||
    valid.reduce((max, v) => Math.max(max, Number(v.valuacion_hacienda_ars) || 0), 0);

  const bienesDeCambio = {
    fecha_valuacion: fechaCierre,
    total_cabezas_cierre: totalCabezas,
    valuacion_hacienda_ars: totalValuacionHacienda,
    detalle_categorias: allCategorias,
  };

  // Consolidar Rubros de Gastos
  const allRubros = [];
  valid.forEach((v) => {
    if (Array.isArray(v.rubros_gastos_cerrados)) {
      v.rubros_gastos_cerrados.forEach((rg) => {
        if (rg.monto_ars > 0 && !allRubros.some((x) => x.rubro === rg.rubro)) {
          allRubros.push(rg);
        }
      });
    }
  });

  const notas = valid.map((v) => v.notas_auditor).filter(Boolean).join(' · ');

  return {
    ejercicio,
    fecha_inicio: fechaInicio,
    fecha_cierre: fechaCierre,
    razon_social: razonSocial,
    cuit,
    estado_resultado: estadoResultado,
    bienes_de_cambio: bienesDeCambio,
    rubros_gastos: allRubros,
    notas_estudio_contable: notas || 'Balance general auditado de ejercicio agropecuario.',
    archivo_nombre: file.name || 'Balance_Estudio_Contable.pdf',
  };
}

// 3b. Escáner Integral de Receta Agronómica o Remito de Insumos para Siembras (Multi-Lote y Multi-Formato)


// 5. Escáner Inteligente de Planillas de Gasoil / Tanque de Combustible
export async function analizarPlanillaGasoil(file, maquinariaList = []) {
  const base64 = await fileToBase64(file);
  const mimeType = getFileMimeType(file);

  const systemPrompt = `Sos el Administrador y Encargado de Taller de Establecimiento San José (Agroganadera Rincón del Sur S.A., Las Flores, Bs. As.).
Tu rol es extraer con precisión matemática y técnica los despachos diarios de combustible del tanque de gasoil a partir de fotos de planillas de papel manuscritas de campo, remitos de carga o archivos Excel/PDF.
${compilarPromptContextoVivo()}`;

  const maqContext =
    maquinariaList && maquinariaList.length > 0
      ? `Parque de maquinaria de San José: ${maquinariaList
          .map((m) => `${m.nombre || m.tipo} (${m.marca || ''} ${m.modelo || ''})`)
          .join(', ')}.`
      : '';

  const prompt = `Analizá con precisión esta planilla de consumo / despacho de gasoil. ${maqContext}
Extraé todos los renglones de carga de combustible en un JSON estrictamente estructurado:
{
  "fecha_planilla": "YYYY-MM-DD",
  "tanque_o_origen": "Tanque Central Casco | Cisterna Móvil | Remito Proveedor",
  "moneda": "ARS",
  "moneda_detectada": "ARS",
  "notas_auditoria_ia": "Dictamen de auditoría sobre el consumo de combustible por máquina y labor",
  "renglones": [
    {
      "fecha": "YYYY-MM-DD",
      "maquina_vehiculo": "Nombre de la máquina o vehículo (ej: John Deere 6130J, Hilux Blanca, Grupo Casco)",
      "litros": número decimal o entero de litros cargados (ej: 140),
      "horometro_km": número de horómetro o kilometraje si figura o null,
      "labor_destino": "Labor agronómica, potrero o actividad (ej: Siembra P#12, Recorrida general, Rastrillado, Pulverización)",
      "responsable": "Nombre del tractorista, maquinista o peón que cargó"
    }
  ],
  "partidas_detalle": [
    {
      "concepto": "Máquina y labor",
      "cantidad": número de litros,
      "unidad": "L",
      "precio_unitario": 0,
      "subtotal": 0
    }
  ],
  "total_litros": número total de litros despachados en la planilla,
  "observaciones": "Novedades, observaciones de horómetros o condiciones del despacho"
}`;

  const raw = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  if (!raw) return raw;
  raw.moneda_detectada = raw.moneda_detectada || 'ARS';
  if (!raw.notas_auditoria_ia) {
    const totL = Number(raw.total_litros) || (raw.renglones || []).reduce((a, b) => a + (Number(b.litros) || 0), 0);
    raw.notas_auditoria_ia = `Planilla de despacho de gasoil: ${totL} litros totales distribuidos en ${(raw.renglones || []).length} despachos.`;
  }
  return raw;
}

// 3b. Escáner Integral de Receta Agronómica o Remito de Insumos para Siembras (Multi-Lote y Multi-Formato)


// Resumen inteligente de movimientos financieros para Copiloto IA
// Si hay más de 30 registros, compacta por campaña y rubro + últimos 25 movimientos
export function resumirMovimientosFinancierosIA({
  gastos = [],
  ventas = [],
  laboresSiembras = [],
  dolarRef = 1540,
}) {
  const LIMITE_RAW = 30;
  const LIMITE_RECIENTES = 25;

  // 1. Resumen de Gastos / Egresos
  let gastosTexto = '';
  if (gastos.length <= LIMITE_RAW) {
    gastosTexto =
      gastos.length > 0
        ? `${gastos.length} gastos: ` +
          gastos
            .map(
              (g) =>
                `${g.fecha}: ${g.rubro} - ${g.concepto} ($${Number(g.monto_usd || 0).toFixed(0)} USD)`
            )
            .join('; ')
        : 'Sin gastos registrados';
  } else {
    const porCampanaYRubro = {};
    let totalUsdGlobal = 0;

    gastos.forEach((g) => {
      const campana =
        g.campana || (g.fecha && g.fecha.startsWith('2025') ? '2025/2026' : '2026/2027');
      const rubro = g.rubro || 'General';
      const usd =
        Number(g.monto_usd) ||
        (Number(g.monto_ars) || 0) / (Number(g.tipo_cambio) || dolarRef || 1540);
      totalUsdGlobal += usd;

      if (!porCampanaYRubro[campana]) porCampanaYRubro[campana] = {};
      if (!porCampanaYRubro[campana][rubro]) porCampanaYRubro[campana][rubro] = { count: 0, usd: 0 };
      porCampanaYRubro[campana][rubro].count += 1;
      porCampanaYRubro[campana][rubro].usd += usd;
    });

    const desgloseCampanas = Object.entries(porCampanaYRubro)
      .map(([camp, rubros]) => {
        const rubrosTxt = Object.entries(rubros)
          .map(([r, data]) => `${r}: USD $${Math.round(data.usd).toLocaleString('es-AR')} (${data.count} comp.)`)
          .join(', ');
        return `[Campaña ${camp}]: ${rubrosTxt}`;
      })
      .join('\n  ');

    const ultimos25Gastos = [...gastos]
      .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
      .slice(0, LIMITE_RECIENTES)
      .map((g) => `${g.fecha}: ${g.rubro} - ${g.concepto} ($${Number(g.monto_usd || 0).toFixed(0)} USD)`)
      .join('; ');

    gastosTexto = `TOTAL CONSOLIDADO: ${gastos.length} comprobantes (USD $${Math.round(totalUsdGlobal).toLocaleString('es-AR')}).
  Desglose Agregado por Campaña y Rubro:
  ${desgloseCampanas}
  Últimos ${LIMITE_RECIENTES} movimientos recientes:
  ${ultimos25Gastos}`;
  }

  // 2. Resumen de Ventas / Ingresos
  let ventasTexto = '';
  if (ventas.length <= LIMITE_RAW) {
    ventasTexto =
      ventas.length > 0
        ? `${ventas.length} ventas/liquidaciones: ` +
          ventas
            .map(
              (v) =>
                `${v.fecha}: ${v.categoria || 'Hacienda'} ${v.cabezas || 0} cab. (${v.kilos_totales || 0} kg) -> USD $${Number(v.ingreso_neto_usd || 0).toFixed(0)}`
            )
            .join('; ')
        : 'Sin ventas registradas';
  } else {
    const porCampanaYCat = {};
    let totalIngresosUsd = 0;
    let totalCabezasVendidas = 0;

    ventas.forEach((v) => {
      const campana =
        v.campana || (v.fecha && v.fecha.startsWith('2025') ? '2025/2026' : '2026/2027');
      const cat = v.categoria || 'Ventas Hacienda';
      const usd =
        Number(v.ingreso_neto_usd) ||
        (Number(v.ingreso_neto_ars) || 0) / (Number(v.tipo_cambio) || dolarRef || 1540);
      const cab = Number(v.cabezas) || 0;
      totalIngresosUsd += usd;
      totalCabezasVendidas += cab;

      if (!porCampanaYCat[campana]) porCampanaYCat[campana] = {};
      if (!porCampanaYCat[campana][cat]) porCampanaYCat[campana][cat] = { count: 0, cabezas: 0, usd: 0 };
      porCampanaYCat[campana][cat].count += 1;
      porCampanaYCat[campana][cat].cabezas += cab;
      porCampanaYCat[campana][cat].usd += usd;
    });

    const desgloseCampanasVentas = Object.entries(porCampanaYCat)
      .map(([camp, cats]) => {
        const catsTxt = Object.entries(cats)
          .map(([c, data]) => `${c}: ${data.cabezas} cab. (USD $${Math.round(data.usd).toLocaleString('es-AR')})`)
          .join(', ');
        return `[Campaña ${camp}]: ${catsTxt}`;
      })
      .join('\n  ');

    const ultimas25Ventas = [...ventas]
      .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
      .slice(0, LIMITE_RECIENTES)
      .map(
        (v) =>
          `${v.fecha}: ${v.categoria} ${v.cabezas || 0} cab. (USD $${Number(v.ingreso_neto_usd || 0).toFixed(0)})`
      )
      .join('; ');

    ventasTexto = `TOTAL CONSOLIDADO: ${ventas.length} ventas (${totalCabezasVendidas} cab., USD $${Math.round(totalIngresosUsd).toLocaleString('es-AR')}).
  Desglose Agregado por Campaña y Categoría:
  ${desgloseCampanasVentas}
  Últimas ${LIMITE_RECIENTES} liquidaciones recientes:
  ${ultimas25Ventas}`;
  }

  // 3. Resumen de Siembras & Labores
  let siembrasTexto = '';
  if (laboresSiembras.length <= LIMITE_RAW) {
    siembrasTexto =
      laboresSiembras.length > 0
        ? `${laboresSiembras.length} siembras/lotes: ` +
          laboresSiembras
            .map(
              (s) =>
                `P#${s.potrero_numero} (${s.hectareas || 0} ha, ${s.cultivo_variedad}, ${s.campana || '2026/2027'}): USD $${Number(s.costo_total_usd || 0).toFixed(0)}`
            )
            .join('; ')
        : 'Sin siembras registradas';
  } else {
    const porCampanaYCultivo = {};
    let totalHaSiembras = 0;
    let totalCostoSiembrasUsd = 0;

    laboresSiembras.forEach((s) => {
      const campana = s.campana || '2026/2027';
      const cultivo = s.cultivo_variedad || 'Pastura / Siembra';
      const ha = Number(s.hectareas) || 0;
      const usd =
        Number(s.costo_total_usd) ||
        Number(s.costo_insumos_usd || 0) + Number(s.costo_labores_usd || 0);
      totalHaSiembras += ha;
      totalCostoSiembrasUsd += usd;

      if (!porCampanaYCultivo[campana]) porCampanaYCultivo[campana] = {};
      if (!porCampanaYCultivo[campana][cultivo])
        porCampanaYCultivo[campana][cultivo] = { count: 0, ha: 0, usd: 0 };
      porCampanaYCultivo[campana][cultivo].count += 1;
      porCampanaYCultivo[campana][cultivo].ha += ha;
      porCampanaYCultivo[campana][cultivo].usd += usd;
    });

    const desgloseCampanasSiembras = Object.entries(porCampanaYCultivo)
      .map(([camp, cultivos]) => {
        const cultsTxt = Object.entries(cultivos)
          .map(([c, data]) => `${c}: ${data.ha.toFixed(1)} ha, USD $${Math.round(data.usd).toLocaleString('es-AR')} (${data.count} lotes)`)
          .join(', ');
        return `[Campaña ${camp}]: ${cultsTxt}`;
      })
      .join('\n  ');

    const ultimas25Siembras = [...laboresSiembras]
      .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
      .slice(0, LIMITE_RECIENTES)
      .map(
        (s) =>
          `P#${s.potrero_numero} (${s.hectareas} ha, ${s.cultivo_variedad}): USD $${Number(s.costo_total_usd || 0).toFixed(0)}`
      )
      .join('; ');

    siembrasTexto = `TOTAL CONSOLIDADO: ${laboresSiembras.length} fichas (${totalHaSiembras.toFixed(1)} ha sembradas, USD $${Math.round(totalCostoSiembrasUsd).toLocaleString('es-AR')}).
  Desglose Agregado por Campaña y Cultivo/Pastura:
  ${desgloseCampanasSiembras}
  Últimas ${LIMITE_RECIENTES} siembras recientes:
  ${ultimas25Siembras}`;
  }

  return {
    gastosTexto,
    ventasTexto,
    siembrasTexto,
  };
}

// Roles de protocolo ganadero oficial de Establecimiento San José
export const ROLES_PROTOCOLO = [
  'Plantel Cría',
  'Reposición',
  'Toros / Toritos',
  'Refugo / CUT',
  'Destete / Venta',
];

// Helper para inferir o resolver el rol de protocolo de un rodeo
export function inferirRolProtocolo(rodeo) {
  if (!rodeo) return 'Plantel Cría';
  if (rodeo.rol_protocolo && ROLES_PROTOCOLO.includes(rodeo.rol_protocolo)) {
    return rodeo.rol_protocolo;
  }
  const nombre = (rodeo.nombre || '').toUpperCase();
  const cat = (rodeo.categoria || '').toUpperCase();

  if (
    nombre.includes('TORO') ||
    nombre.includes('TORITO') ||
    cat.includes('TORO') ||
    ((Number(rodeo.toros_padres) || 0) > 0 &&
      (Number(rodeo.vacas) || 0) === 0 &&
      (Number(rodeo.terneros) || 0) === 0)
  ) {
    return 'Toros / Toritos';
  }
  if (
    nombre.includes('RECR') ||
    nombre.includes('REPOSIC') ||
    cat.includes('RECR') ||
    cat.includes('VAQUILLONA') ||
    (Number(rodeo.vaquillonas_reposicion) || 0) > 0
  ) {
    return 'Reposición';
  }
  if (
    nombre.includes('CUT') ||
    nombre.includes('REFUGO') ||
    nombre.includes('INVERNADA') ||
    nombre.includes('VACIA') ||
    cat.includes('CUT') ||
    (Number(rodeo.vacas_cut) || 0) > 0
  ) {
    return 'Refugo / CUT';
  }
  if (
    nombre.includes('DESTET') ||
    nombre.includes('VENTA') ||
    cat.includes('DESTET') ||
    cat.includes('VENTA')
  ) {
    return 'Destete / Venta';
  }
  return 'Plantel Cría';
}

// Tablero de Seguimiento Vivo: Real vs. Metas del Protocolo
export function calcularProtocoloVivo(rodeos = [], potreros = []) {
  const potrerosMap = new Map((potreros || []).map((p) => [Number(p.numero), p]));

  const rodeosConRol = (rodeos || []).map((r) => {
    const rol = inferirRolProtocolo(r);
    const pot = potrerosMap.get(Number(r.potrero_numero));
    const totalCab =
      (Number(r.vacas) || 0) +
      (Number(r.terneros) || 0) +
      (Number(r.toros_padres) || 0) +
      (Number(r.toritos) || 0) +
      (Number(r.vacas_cut) || 0) +
      (Number(r.vaquillonas_reposicion) || 0);

    return {
      ...r,
      rol_protocolo: rol,
      potrero_nombre: pot
        ? `P#${pot.numero} (${pot.nombre || 'Lote'})`
        : r.potrero_numero
        ? `P#${r.potrero_numero}`
        : 'Sin potrero',
      potrero_ha: pot ? Number(pot.hectareas) || 0 : 0,
      total_cabezas_calc: totalCab,
    };
  });

  // 1. Plantel de Vientres en Servicio
  // Meta: 1.100 vientres (850 vacas + 250 vaquillonas)
  const rodeosPlantel = rodeosConRol.filter((r) => r.rol_protocolo === 'Plantel Cría');
  const vientresVacas = rodeosPlantel.reduce((sum, r) => sum + (Number(r.vacas) || 0), 0);
  const vientresVaquillonas = rodeosPlantel.reduce(
    (sum, r) => sum + (Number(r.vaquillonas_reposicion) || 0),
    0
  );
  // Si en rodeos de plantel no están desglosadas las vaquillonas, sumamos total de vientres presentes
  const vientresReal = vientresVacas + vientresVaquillonas;
  const metaVientres = 1100;
  const pctVientres = Math.round((vientresReal / metaVientres) * 100);
  const diffVientres = vientresReal - metaVientres;
  const estadoVientres =
    pctVientres >= 90 ? 'En meta' : pctVientres >= 75 ? 'Atención' : 'Déficit';

  // 2. Reposición Anual (Recría Hembras)
  // Meta: 250 vaquillonas seleccionadas para reposición (~22,7% de reemplazo anual)
  const rodeosReposicion = rodeosConRol.filter((r) => r.rol_protocolo === 'Reposición');
  const reposicionReal = rodeosReposicion.reduce((sum, r) => {
    const vaq = Number(r.vaquillonas_reposicion) || 0;
    const vac = Number(r.vacas) || 0;
    const tot = r.total_cabezas_calc || 0;
    return sum + (vaq > 0 ? vaq : vac > 0 ? vac : tot);
  }, 0);
  const metaReposicion = 250;
  const pctReposicion = Math.round((reposicionReal / metaReposicion) * 100);
  const diffReposicion = reposicionReal - metaReposicion;
  const estadoReposicion =
    pctReposicion >= 90 ? 'En meta' : pctReposicion >= 70 ? 'Atención' : 'Déficit';

  // 3. Toros Padres y Toritos
  // Meta: 4,0% de toros sobre vientres (~44 toros para 1.100 vientres) + 30 toritos en recría
  const rodeosToros = rodeosConRol.filter((r) => r.rol_protocolo === 'Toros / Toritos');
  const torosPadresReal = rodeosConRol.reduce((sum, r) => sum + (Number(r.toros_padres) || 0), 0);
  const toritosReal = rodeosConRol.reduce((sum, r) => sum + (Number(r.toritos) || 0), 0);
  const pctTorosSobreVientres =
    vientresReal > 0 ? Number(((torosPadresReal / vientresReal) * 100).toFixed(1)) : 0;
  const metaTorosPadres = Math.round(vientresReal > 0 ? vientresReal * 0.04 : 44);
  const metaToritos = 30;
  const estadoToros =
    pctTorosSobreVientres >= 3.8 && pctTorosSobreVientres <= 5.0
      ? 'En meta'
      : pctTorosSobreVientres >= 3.0
      ? 'Atención'
      : 'Déficit';

  // 4. Cosecha de Terneros (Al pie / Destetados)
  // Meta orientativa: ~900 terneros (~81.8% destete sobre 1.100 vientres)
  // Retención anual: ~280 hembras de reposición + 30 toritos = 310 cabezas retenidas
  const rodeosDestete = rodeosConRol.filter((r) => r.rol_protocolo === 'Destete / Venta');
  const ternerosReal = rodeosConRol.reduce((sum, r) => sum + (Number(r.terneros) || 0), 0);
  const ternerosMachosReal = rodeosConRol.reduce(
    (sum, r) => sum + (Number(r.terneros_machos) || 0),
    0
  );
  const ternerosHembrasReal = rodeosConRol.reduce(
    (sum, r) => sum + (Number(r.terneros_hembras) || 0),
    0
  );
  const metaTerneros = 900;
  const pctDesteteSobreVientres =
    vientresReal > 0 ? Number(((ternerosReal / vientresReal) * 100).toFixed(1)) : 0;
  const retencionReposicion = 310;
  const ternerosLibresVenta = Math.max(0, ternerosReal - retencionReposicion);
  const pctTerneros = Math.round((ternerosReal / metaTerneros) * 100);
  const estadoTerneros =
    pctTerneros >= 90 ? 'En meta' : pctTerneros >= 75 ? 'Atención' : 'Déficit';

  // 5. Vacas CUT / Refugo al Frente
  // Meta: descarte anual programado de ~230 cabezas para engorde y venta en potreros del frente (P1, P2, P3, P4, P5, P6)
  const rodeosCut = rodeosConRol.filter((r) => r.rol_protocolo === 'Refugo / CUT');
  const vacasCutEnRodeosEspeciales = rodeosCut.reduce(
    (sum, r) =>
      sum + (Number(r.vacas_cut) || Number(r.vacas) || r.total_cabezas_calc || 0),
    0
  );
  const vacasCutDispersas = rodeosConRol.reduce((sum, r) => sum + (Number(r.vacas_cut) || 0), 0);
  const cutReal = Math.max(vacasCutEnRodeosEspeciales, vacasCutDispersas);
  const metaCut = 230;
  const pctCut = Math.round((cutReal / metaCut) * 100);
  const estadoCut = cutReal >= 150 ? 'En meta' : cutReal > 0 ? 'Atención' : 'Déficit';

  return {
    rodeosConRol,
    vientres: {
      meta: metaVientres,
      real: vientresReal,
      vacas: vientresVacas,
      vaquillonas: vientresVaquillonas,
      porcentaje: pctVientres,
      diferencia: diffVientres,
      estado: estadoVientres,
      rodeos: rodeosPlantel,
    },
    reposicion: {
      meta: metaReposicion,
      real: reposicionReal,
      porcentaje: pctReposicion,
      diferencia: diffReposicion,
      estado: estadoReposicion,
      rodeos: rodeosReposicion,
    },
    toros: {
      metaPadres: metaTorosPadres,
      realPadres: torosPadresReal,
      metaToritos,
      realToritos: toritosReal,
      porcentajeReal: pctTorosSobreVientres,
      metaPorcentaje: 4.0,
      estado: estadoToros,
      rodeos: rodeosToros,
    },
    terneros: {
      meta: metaTerneros,
      real: ternerosReal,
      machos: ternerosMachosReal,
      hembras: ternerosHembrasReal,
      porcentajeDestete: pctDesteteSobreVientres,
      retencionReposicion,
      libresVenta: ternerosLibresVenta,
      porcentaje: pctTerneros,
      estado: estadoTerneros,
      rodeos: rodeosDestete.length > 0 ? rodeosDestete : rodeosPlantel,
    },
    cut: {
      meta: metaCut,
      real: cutReal,
      porcentaje: pctCut,
      estado: estadoCut,
      rodeos: rodeosCut,
    },
  };
}

// 6. Copiloto de Campo San José (Chat con contexto en vivo compacto de Supabase)
export async function copilotoCampoChat({
  messages = [],
  context = {},
}) {
  const {
    potreros = [],
    rodeos = [],
    infraestructura = [],
    tareas = [],
    lluvias = [],
    movimientos = [],
    alertas = [],
    caminosEstado = 'Transitable',
    maquinaria = [],
    insumos = [],
    aprendizajes = [],
    protocoloCria = null,
    fechaOperacion,
    gastos = [],
    ventas = [],
    laboresSiembras = [],
    dolarRef = 1540,
  } = context;

  const finanzasResumen = resumirMovimientosFinancierosIA({
    gastos,
    ventas,
    laboresSiembras,
    dolarRef,
  });

  const gasoilItem = insumos.find(
    (i) => i.categoria === 'Combustible' || i.nombre?.toLowerCase().includes('gasoil')
  );
  const stockGasoilLitros = Number(gasoilItem?.cantidad_actual || 0);
  const gasoilTexto = gasoilItem
    ? `${stockGasoilLitros.toLocaleString('es-AR')} Litros (${gasoilItem.nombre || 'Gasoil'})`
    : 'Stock disponible en tanques principales';

  // 1. Resumen de Potreros y Rodeos (sin serializar arrays gigantes)
  const potrerosOcupados = potreros.filter((p) =>
    rodeos.some((r) => Number(r.potrero_numero) === Number(p.numero))
  );
  const potrerosLibres = potreros.filter((p) =>
    !rodeos.some((r) => Number(r.potrero_numero) === Number(p.numero))
  );

  const resumenOcupados = potrerosOcupados
    .map((p) => {
      const rodeo = rodeos.find((r) => Number(r.potrero_numero) === Number(p.numero));
      const cabezas =
        (Number(rodeo?.vacas) || 0) +
        (Number(rodeo?.terneros) || 0) +
        (Number(rodeo?.toros_padres) || 0) +
        (Number(rodeo?.toritos) || 0) +
        (Number(rodeo?.vacas_cut) || 0) +
        (Number(rodeo?.vaquillonas_reposicion) || 0);
      const ha = Number(p.hectareas) || 0;
      const cargaCabHa = ha > 0 ? (cabezas / ha).toFixed(2) : '-';
      const ambiente = p.ambiente || 'Bajo dulce';
      const recurso = p.cultivo_actual || 'Campo Natural';
      return `P#${p.numero} (${ha} ha, Amb: ${ambiente}, Recurso: ${recurso}): "${rodeo?.nombre || 'Rodeo'}" [${rodeo?.categoria || 'Cría'}, ${cabezas} cab., Carga: ${cargaCabHa} cab/ha, estadía: ${rodeo?.dias_permanencia || 15}d]`;
    })
    .join('; ');

  const resumenLibres = potrerosLibres
    .map((p) => {
      const ha = Number(p.hectareas) || 0;
      const ambiente = p.ambiente || 'Bajo dulce';
      const recurso = p.cultivo_actual || 'Campo Natural';
      const estado = p.estado_semaforo || 'Disponible';
      return `P#${p.numero} (${ha} ha, Amb: ${ambiente}, Pastura: ${recurso}, Estado: ${estado})`;
    })
    .join('; ');

  // 2. Stock total oficial y desglose
  const totalCabezas =
    rodeos.reduce((sum, r) => {
      return (
        sum +
        (Number(r.vacas) || 0) +
        (Number(r.terneros) || 0) +
        (Number(r.toros_padres) || 0) +
        (Number(r.toritos) || 0) +
        (Number(r.vacas_cut) || 0) +
        (Number(r.vaquillonas_reposicion) || 0)
      );
    }, 0) || 2024;

  // 3. Infraestructura (29 puntos)
  const totalInfra = infraestructura.length > 0 ? infraestructura.length : 29;
  const infraIssues = infraestructura.filter(
    (i) => (i.estado || 'Operativo') !== 'Operativo'
  );
  const infraTexto =
    infraIssues.length > 0
      ? `${totalInfra} puntos registrados (${totalInfra - infraIssues.length} operativos). En alerta o reparación: ${infraIssues
          .map((i) => `${i.nombre} [P#${i.potrero_numero || 'Gral'}, ${i.estado}]`)
          .join(', ')}`
      : `${totalInfra} puntos registrados, todos 100% operativos.`;

  // 4. Últimas 5 Lluvias registradas
  const ultimas5Lluvias = lluvias.slice(0, 5);
  const totalLluviaCampana = lluvias.reduce((acc, l) => acc + (Number(l.milimetros) || 0), 0);
  const lluviasTexto =
    ultimas5Lluvias.length > 0
      ? `${ultimas5Lluvias.map((l) => `${l.fecha}: ${l.milimetros} mm (${l.pluviometro || 'Casco'})`).join(', ')} (Acumulado campaña: ${totalLluviaCampana} mm)`
      : 'Sin lluvias recientes registradas';

  // 5. Últimos 5 Movimientos de Hacienda
  const ultimos5Movimientos = movimientos.slice(0, 5);
  const movimientosTexto =
    ultimos5Movimientos.length > 0
      ? ultimos5Movimientos
          .map(
            (m) =>
              `${m.fecha}: ${m.tipo_movimiento || 'Movimiento'} ${m.cantidad_cabezas || 0} cab. (P#${m.potrero_origen_id || '-'} -> P#${m.potrero_destino_id || '-'})`
          )
          .join('; ')
      : 'Sin movimientos recientes registrados';

  // 6. Tareas y Alertas activas
  const tareasPendientes = tareas.filter((t) => !t.completada && t.estado !== 'Completada');
  const tareasTexto =
    tareasPendientes.length > 0
      ? `${tareasPendientes.length} pendientes: ${tareasPendientes
          .slice(0, 5)
          .map((t) => `${t.titulo} (${t.prioridad || 'Media'})`)
          .join(', ')}`
      : '0 tareas pendientes';

  const alertasTexto =
    alertas.length > 0
      ? `${alertas.length} alertas activas en mapa: ${alertas
          .slice(0, 4)
          .map((a) => `[P#${a.potrero_numero || '-'}: ${a.titulo || a.texto || 'Alerta'}]`)
          .join(', ')}`
      : 'Sin alertas críticas en el mapa';

  const aprendizajesTexto =
    aprendizajes && aprendizajes.length > 0
      ? aprendizajes
          .slice(0, 8)
          .map(
            (a) =>
              `- [${a.tipo || 'Manejo'} / ${a.entidad_id || 'Gral'}]: ${a.titulo} - ${a.aprendizaje}`
          )
          .join('\n')
      : 'Base de aprendizajes agronómicos activa.';

  const protoVivo = calcularProtocoloVivo(rodeos, potreros);

  const protoVivoTexto = `
- Plantel de Vientres en Servicio: ${protoVivo.vientres.real} cab. reales vs. Meta de ${protoVivo.vientres.meta} vientres (${protoVivo.vientres.porcentaje}%, Estado: ${protoVivo.vientres.estado}). Rodeos asignados: ${protoVivo.vientres.rodeos.map((r) => `"${r.nombre}" en ${r.potrero_nombre} [${r.total_cabezas_calc} cab]`).join(', ') || 'Sin rodeos'}.
- Reposición Anual (Recría Hembras): ${protoVivo.reposicion.real} vaquillonas reales vs. Meta de ${protoVivo.reposicion.meta} cabezas (${protoVivo.reposicion.porcentaje}%, Estado: ${protoVivo.reposicion.estado}, ${protoVivo.reposicion.diferencia >= 0 ? `Colchón de +${protoVivo.reposicion.diferencia} cab.` : `Faltante de ${Math.abs(protoVivo.reposicion.diferencia)} cab.`}). Rodeos: ${protoVivo.reposicion.rodeos.map((r) => `"${r.nombre}" en ${r.potrero_nombre} [${r.total_cabezas_calc} cab]`).join(', ') || 'Sin rodeos'}.
- Toros Padres y Toritos: ${protoVivo.toros.realPadres} toros padres (${protoVivo.toros.porcentajeReal}% sobre vientres reales vs. Meta del 4% / ~${protoVivo.toros.metaPadres} toros, Estado: ${protoVivo.toros.estado}) + ${protoVivo.toros.realToritos} toritos en recría (Meta: ${protoVivo.toros.metaToritos} toritos). Rodeos: ${protoVivo.toros.rodeos.map((r) => `"${r.nombre}" en ${r.potrero_nombre}`).join(', ') || 'Toros en lotes'}.
- Cosecha de Terneros: ${protoVivo.terneros.real} terneros al pie/destetados vs. Meta orientativa de ~${protoVivo.terneros.meta} (${protoVivo.terneros.porcentaje}%, Destete real: ${protoVivo.terneros.porcentajeDestete}% sobre vientres). Retención prevista para reposición: ${protoVivo.terneros.retencionReposicion} cabezas (280 hembras + 30 toritos) -> Libres estimados para venta: ${protoVivo.terneros.libresVenta} cabezas.
- Vacas CUT / Refugo al Frente: ${protoVivo.cut.real} cabezas asignadas a engorde vs. Meta de descarte de ${protoVivo.cut.meta} cab. (${protoVivo.cut.porcentaje}%, Estado: ${protoVivo.cut.estado}). Rodeos: ${protoVivo.cut.rodeos.map((r) => `"${r.nombre}" en ${r.potrero_nombre}`).join(', ') || 'Sin rodeos CUT específicos'}.
`;

  const systemPrompt = `Sos el Asesor Técnico Agropecuario y Administrador Senior de Establecimiento San José (Agroganadera Rincón del Sur S.A., 2.068,1 ha en Las Flores, Cuenca del Salado, Bs. As.).
Superficie total: 2.068,1 hectáreas divididas en 34 potreros oficiales.
Stock ganadero: 15 rodeos oficiales con ${totalCabezas} cabezas en total.
Sos experto de máxima referencia en ganadería de cría y ciclo completo extensivo, pastoreo rotacional racional (Voisin/PRV), sanidad preventiva, mejoramiento forrajero (promoción de raigrás, festucas, agropiros, lotus tenuis) y administración económica del campo en la Cuenca del Salado.

PROTOCOLO ORIENTATIVO DE CRÍA SAN JOSÉ:
- Rodeo de Madres: Meta objetivo de 1.100 madres de cría en servicio.
- Estructura Operativa: 7 rodeos de cría de ~160 vacas cada uno + 1 rodeo de vaquillonas de reposición/primer servicio.
- Toros y Servicio: Mantener 4% de toros padres. Obligatorio registrar fecha de servicio y número de caravana de cada toro asignado.
- Reposición Anual: 250 vaquillonas seleccionadas y 30 toritos de reposición (50% Angus Colorados / 50% Angus Negros).
- Rodeo de Coloradas: Unificado exclusivamente con hacienda colorada.
- Vacas CUT (Cría Último Ternero): Destinadas a potreros del frente (cercanos a casco y manga) para engorde y venta programada.
- Período de Entore de Vaquillonas: Septiembre a Diciembre.
- NOTA FUNDAMENTAL DE FLEXIBILIDAD: Estas pautas son metas técnicas orientativas y flexibles, que deben adaptarse y calibrarse dinámicamente según el régimen de precipitaciones del año y la oferta forrajera real de cada potrero.

TABLERO DE SEGUIMIENTO VIVO: REAL VS. PROTOCOLO SAN JOSÉ:
${protoVivoTexto}
Cuando evalúes el rodeo, razoná sobre estos desvíos, la holgura de vientres, el porcentaje real de toros para la época de servicio y los terneros libres que quedarán para venta tras retener las 280 hembras y 30 toritos.

MEMORIA Y APRENDIZAJES HISTÓRICOS DEL CAMPO (Consultar siempre antes de proponer traslados, cargas o clausuras):
${aprendizajesTexto}

REGLAS TÉCNICAS Y OPERATIVAS ESTRICTAS:
1. RAZONAMIENTO TÉCNICO PROFUNDO:
   Cuando te consulten sobre decisiones de manejo (rotaciones, carga animal, suplementación, servicio/destete, sanidad, labores de suelo o asignación de potreros), analizá siempre con criterio agronómico riguroso:
   (a) Carga actual (cab/ha y EV/ha estimada) vs receptividad del ambiente (Loma con pastura/festuca ~0.8-1.2 EV/ha, Media Loma ~0.6-0.8 EV/ha, Bajo dulce con campo natural/raigrás ~0.5-0.7 EV/ha, Bajo alcalino con agropiro/pelo de chancho ~0.3-0.5 EV/ha, verdeos de invierno/verano).
   (b) Días de permanencia actuales del rodeo vs días de descanso requeridos del recurso forrajero en potreros libres (30 a 60 días en primavera/verano, 60 a 90 días en otoño/invierno) para evitar sobrepastoreo y preservar el banco de semillas.
   (c) Estado de aguadas, molinos y bebederos en el potrero destino para asegurar caudal, presión y calidad de agua.
   (d) Impacto productivo y económico con números claros de campo (ganancia diaria de peso estimada - GDPV en g/día, kilos de carne por hectárea, costos operativos en USD o ARS, ahorro por preservación del tapiz).

2. CIERRE EJECUTIVO SIN PREGUNTAS DE CHATBOT:
   Está terminantemente prohibido cerrar con preguntas pasivas de chatbot (por ejemplo, nunca finalices con "¿Desea que programemos...?", "¿Querés que haga otra cosa?", "¿Te gustaría ver...?", "¿En qué más te ayudo?", etc.).
   Finalizá SIEMPRE de manera ejecutiva con un bloque titulado exactamente:
   ### Plan de Acción Recomendado
   Con 3 a 5 puntos operativos concretos, ordenados por prioridad de ejecución (inmediata, corto plazo, mediano plazo), asignando tareas claras para la peonada, el encargado o la administración.

3. HIGIENE DE FORMATO ESTRICTA:
   - Prohibido usar sintaxis LaTeX con signos de pesos para fechas, números o monedas. Escribí siempre fechas normales (ej. "12/11/2026", nunca "$12/11$"), cantidades en texto limpio (ej. "46 cabezas", nunca "$46$") y montos en moneda legible (ej. "USD 450", "ARS 85.000", nunca "$450$" ni "$85.000$").
   - Prohibido usar emojis Unicode (nada de caritas, flechas decorativas, animales o símbolos). Reemplazalos por etiquetas legibles entre corchetes cuando sea necesario destacar: [ALERTA], [OK], [PRIORIDAD], [RODEO], [AGUADA], [POTRERO], [SANIDAD], [CLIMA].
   - Usá formato Markdown limpio con títulos (###), negritas (**texto**) y listas con guiones (-).
   - Priorizá siempre listas estructuradas claras con guiones (-) y, si presentás datos comparativos o balances, usá tablas Markdown compactas de pocas columnas (máximo 3 o 4 columnas, ej: | Potrero | Rodeo | Cabezas | Estado |) para garantizar máxima legibilidad en pantalla y en PDF.

ESTADO OPERATIVO EN VIVO (${fechaOperacion || new Date().toISOString().slice(0, 10)}):
- Potreros con rodeo (${potrerosOcupados.length} ocupados): ${resumenOcupados}
- Potreros libres (${potrerosLibres.length} disponibles): ${resumenLibres || 'Ninguno'}
- Infraestructura (${totalInfra} puntos): ${infraTexto}
- Lluvias: ${lluviasTexto}
- Últimos movimientos: ${movimientosTexto}
- Caminos internos: ${caminosEstado}
- Tareas pendientes: ${tareasTexto}
- Alertas en mapa: ${alertasTexto}
- Maquinaria: ${maquinaria.length} unidades registradas
- Stock actual de Gasoil / Combustible: ${gasoilTexto}

ESTADO FINANCIERO Y AGRÍCOLA (Sintetizado):
- Gastos y Egresos Operativos:
  ${finanzasResumen.gastosTexto}
- Ventas y Liquidaciones de Hacienda:
  ${finanzasResumen.ventasTexto}
- Siembras y Pasturas:
  ${finanzasResumen.siembrasTexto}

ACCIONES OPERATIVAS DIRECTAS:
Si el usuario solicita registrar un consumo, carga de máquina o ingreso de combustible (por ejemplo: "Descontá 120 L de gasoil del tractor 7215 en P#4", "Ingresaron 4.000 L de gasoil", "Cargué 80 litros a la cosechadora", "Anotá consumo de 150 litros en P12"), registrar una lluvia, mover un rodeo o crear una tarea:
Confirmá la acción de manera ejecutiva e incluí obligatoriamente al final de tu respuesta:
ACTION_JSON:
{
  "action": "REGISTRAR_GASOIL" | "REGISTRAR_LLUVIA" | "MOVER_RODEO" | "CREAR_TAREA",
  "payload": {
    "tipo": "Consumo / Egreso" | "Ingreso / Compra",
    "litros": 120,
    "maquinaria": "Tractor John Deere 7215",
    "potrero_numero": 4,
    "fecha": "AAAA-MM-DD",
    "destino": "Tractor John Deere 7215 en Potrero #4",
    "responsable": "Nombre del operador o encargado",
    "observaciones": "Consumo de combustible registrado por Copiloto IA"
  }
}`;

  // Formatear historial de conversación (últimos mensajes)
  const lastUserMsg = messages[messages.length - 1]?.text || 'Hola';
  const conversationHistory = messages
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Productor' : 'Copiloto'}: ${m.text}`)
    .join('\n');

  const prompt = `${conversationHistory}\nProductor: ${lastUserMsg}\nCopiloto:`;

  const responseText = await callGeminiApi({
    prompt,
    systemPrompt,
    responseJson: false,
    temperature: 0.4,
    maxOutputTokens: 4096,
    timeoutMs: 40000,
    tools: [{ googleSearch: {} }],
  });

  // Analizar si contiene ACTION_JSON
  let parsedAction = null;
  let cleanText = responseText;
  if (responseText.includes('ACTION_JSON:')) {
    const parts = responseText.split('ACTION_JSON:');
    cleanText = parts[0].trim();
    try {
      const jsonStr = cleanJsonResponse(parts[1]);
      parsedAction = JSON.parse(jsonStr);
    } catch (e) {
      console.warn('No se pudo parsear ACTION_JSON del copiloto:', e);
    }
  }

  return {
    text: cleanText,
    action: parsedAction,
  };
}

// Alias de compatibilidad oficial
export const chatConCopiloto = copilotoCampoChat;
export const analizarFactura = analizarFacturaRemito;
export const analizarRepuesto = analizarRepuestoMaquinaria;
export const analizarRomaneo = analizarLiquidacionHacienda;

// 7. Analizador Inteligente de Informe de Recorrida / Multi-documento
export async function analizarInformeRecorrida({
  texto = '',
  file = null,
  potreros = [],
  rodeos = [],
  fechaOperacion = '',
}) {
  let fileBase64 = null;
  let mimeType = 'image/jpeg';
  if (file) {
    fileBase64 = await fileToBase64(file);
    mimeType = file.type || 'image/jpeg';
  }

  const systemPrompt = `Sos el Intérprete y Auditor Técnico de Recorridas de Establecimiento San José (Las Flores, Bs. As.).
Tu tarea es leer reportes de recorrida de campo, audios transcriptos, notas de WhatsApp del encargado/veterinario o fotos de libretas y extraer estructuradamente todas las novedades y órdenes operativas.

Devolvé obligatoriamente ÚNICAMENTE un JSON estricto con la siguiente estructura:
{
  "resumen_recorrida": "Síntesis clara de la recorrida en 2 o 3 renglones",
  "lluvias": [
    {
      "fecha": "YYYY-MM-DD",
      "milimetros": 25,
      "pluviometro": "Casco Principal | Puesto El Silencio | Manga Central | Potrero 8 | Potrero 26",
      "observaciones": "..."
    }
  ],
  "condiciones_corporales": [
    {
      "rodeo_nombre": "Rodeo 1...",
      "rodeo_id": 1,
      "condicion_corporal": 3.0,
      "observaciones": "..."
    }
  ],
  "combustible_gasoil": [
    {
      "tipo": "Consumo / Egreso | Ingreso / Compra",
      "litros": 120,
      "maquinaria": "Tractor JD 6130J",
      "potrero_numero": 4,
      "observaciones": "..."
    }
  ],
  "tareas_operativas": [
    {
      "titulo": "Revisar boyero P#16",
      "prioridad": "Alta | Normal | Urgente",
      "potrero_numero": 16,
      "responsable": "Equipo San José",
      "fecha_limite": "YYYY-MM-DD",
      "observaciones": "..."
    }
  ],
  "alertas_sanitarias_infra": [
    {
      "tipo": "Aguada | Alambrado | Sanidad | Pasto",
      "potrero_numero": 10,
      "descripcion": "..."
    }
  ]
}`;

  const potContext = potreros.length > 0 ? `Potreros oficiales: ${potreros.map((p) => `P#${p.numero} (${p.nombre})`).slice(0, 15).join(', ')}.` : '';
  const rodContext = rodeos.length > 0 ? `Rodeos oficiales: ${rodeos.map((r) => `${r.nombre} (P#${r.potrero_numero})`).slice(0, 10).join(', ')}.` : '';

  const prompt = `Analizá con precisión este informe de recorrida / novedades de San José.
${potContext} ${rodContext}
Fecha de referencia: ${fechaOperacion || new Date().toISOString().slice(0, 10)}.
Contenido del informe:
${texto || 'Analizá el archivo adjunto.'}`;

  return await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64,
    mimeType,
    responseJson: true,
  });
}

/**
 * PLANIFICADOR DE DÍA DE CUADRILLA CON RUTA ÓPTIMA Y CHECKLIST DE CAMIONETA
 * Genera el orden lógico de recorrido para la cuadrilla de campo y el checklist
 * consolidado de herramientas, repuestos y seguridad para cargar en la camioneta.
 */
export async function planificarDiaCuadrilla({
  itemsSeleccionados = [],
  cascoCoords = [-35.868, -58.945],
  fechaOperacion = new Date().toISOString().slice(0, 10),
  cuadrillaNombre = 'Cuadrilla Principal San José',
}) {
  if (!itemsSeleccionados || itemsSeleccionados.length === 0) {
    throw new Error('No se seleccionaron tareas, alertas o molinos para planificar la cuadrilla.');
  }

  const cascoLat = Number(Array.isArray(cascoCoords) ? cascoCoords[0] : (cascoCoords?.lat ?? cascoCoords?.latitud)) || -35.868;
  const cascoLng = Number(Array.isArray(cascoCoords) ? cascoCoords[1] : (cascoCoords?.lng ?? cascoCoords?.longitud)) || -58.945;

  const systemPrompt = `Sos el Jefe de Operaciones y Mantenimiento de Establecimiento San José (Las Flores, Bs. As., 2.068 ha).
Tu objetivo es armar la hoja de ruta óptima de trabajo diario para la camioneta de cuadrilla y consolidar el checklist de carga (herramientas, materiales y repuestos) antes de salir del galpón taller.

Punto de partida y retorno: Casco / Galpón Taller (Lat: ${cascoLat}, Lng: ${cascoLng}).

CRITERIOS DE OPTIMIZACIÓN:
1. Prioridad Operativa: Atender primero urgencias críticas de aguadas (molinos/bebidas) y alambrados caídos que arriesguen mezcla de hacienda.
2. Eficiencia Geográfica: Agrupar trabajos contiguos por cercanía para no gastar gasoil ni tiempo innecesario cruzando el campo.
3. Checklist de Carga: Deducir con realismo de campo argentino qué herramientas (llave Stilson, tester de boyero, pala, pinza alambre, tester, motosierra), materiales (aisladores, alambre, teflón, flotante, abrazaderas) y elementos de seguridad (guantes descarne, handy VHF, botiquín, agua) DEBEN cargarse en la caja de la camioneta para no tener que volver al casco a buscar repuestos.

Devolvé OBLIGATORIAMENTE un JSON estricto con esta estructura exacta:
{
  "resumen_operativo": "Explicación clara en 2 renglones de la lógica del circuito y estrategia del día",
  "tiempo_total_estimado": "3h 45m",
  "inicio_recomendado": "07:30 hs (Mañana)",
  "origen_casco": {
    "nombre": "Casco / Galpón Taller",
    "lat": ${cascoLat},
    "lng": ${cascoLng}
  },
  "paradas": [
    {
      "numero_parada": 1,
      "id_item": "id_del_item",
      "tipo": "Aguada / Molino | Alambrado / Tarea | Post-it Alerta",
      "titulo": "Título de la parada",
      "ubicacion": "Potrero 12 · Bebida Norte",
      "coordenadas": [-35.865, -58.940],
      "duracion_estimada": "40 min",
      "tiempo_viaje_desde_anterior": "10 min",
      "acciones": "Detalle técnico de qué se debe reparar o revisar in-situ.",
      "herramientas_especificas": ["Tester de boyero", "Pinza alambre"],
      "materiales_especificos": ["Aisladores campanita", "Alambre electroplástico"]
    }
  ],
  "checklist_camioneta": {
    "herramientas": [
      "Caja de herramientas completa (llaves fijas, tubo, destornilladores)",
      "Pinza de fuerza / corta-alambre",
      "Tester digital de boyero",
      "Llave Stilson 14 pulg y pico de loro"
    ],
    "materiales_repuestos": [
      "Flotante de bronce y gomas de repuesto",
      "Rollo de alambre electroplástico",
      "Aisladores campanita y esquineros (10 un)",
      "Abrazaderas cremallera y teflón"
    ],
    "seguridad_epp": [
      "Guantes de descarne y antiparras",
      "Bidón con 10L de agua fresca",
      "Handy VHF San José canal 1 / Casco",
      "Botiquín primeros auxilios"
    ]
  }
}`;

  const prompt = `Planificá la cuadrilla para la fecha ${fechaOperacion} (${cuadrillaNombre}).
Ítems seleccionados por el encargado (${itemsSeleccionados.length} trabajos):
${JSON.stringify(
  itemsSeleccionados.map((it, idx) => ({
    id: it.id || `item_${idx + 1}`,
    tipo: it.tipo || it.categoria || 'Tarea',
    titulo: it.titulo || it.nombre || 'Trabajo de campo',
    prioridad: it.prioridad || 'Normal',
    potrero_numero: it.potrero_numero || null,
    ubicacion: it.ubicacion || (it.potrero_numero ? `Potrero #${it.potrero_numero}` : 'San José'),
    lat: it.latitud || it.lat || null,
    lng: it.longitud || it.lng || null,
    observaciones: it.observaciones || it.descripcion || '',
  })),
  null,
  2
)}`;

  try {
    const aiResult = await callGeminiApi({
      prompt,
      systemPrompt,
      responseJson: true,
      timeoutMs: 20000,
    });

    if (aiResult && Array.isArray(aiResult.paradas) && aiResult.paradas.length > 0) {
      // Normalizar coordenadas por si faltaron
      aiResult.paradas.forEach((p, idx) => {
        if (!p.coordenadas || !Array.isArray(p.coordenadas) || p.coordenadas.length < 2) {
          const original = itemsSeleccionados.find((it) => String(it.id) === String(p.id_item)) || itemsSeleccionados[idx];
          if (original?.lat && original?.lng) {
            p.coordenadas = [Number(original.lat), Number(original.lng)];
          } else {
            p.coordenadas = [cascoLat, cascoLng];
          }
        }
      });
      return aiResult;
    }
  } catch (err) {
    console.warn('Gemini Cuadrilla Planner offline o demorado; usando optimizador heurístico local:', err);
  }

  // Generador local de contingencia 100% operativo
  return generarPlanCuadrillaFallback({
    itemsSeleccionados,
    cascoCoords: [cascoLat, cascoLng],
    fechaOperacion,
    cuadrillaNombre,
  });
}

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const nLat1 = Number(lat1) || -35.868;
  const nLng1 = Number(lng1) || -58.945;
  const nLat2 = Number(lat2) || -35.868;
  const nLng2 = Number(lng2) || -58.945;
  const dLat = (nLat2 - nLat1) * 111.32;
  const dLng = (nLng2 - nLng1) * 89.8;
  const dist = Math.hypot(dLat, dLng);
  return Number.isFinite(dist) ? dist : 1.0;
}

/**
 * Generador local de contingencia para el Día de Cuadrilla
 * Aplica algoritmo Greedy / Nearest Neighbor ponderado por urgencia y deduce
 * herramientas y repuestos específicos según palabras clave de campo.
 */
export function generarPlanCuadrillaFallback({
  itemsSeleccionados = [],
  cascoCoords = [-35.868, -58.945],
  fechaOperacion = new Date().toISOString().slice(0, 10),
  cuadrillaNombre = 'Cuadrilla San José',
}) {
  const cLat = Number(Array.isArray(cascoCoords) ? cascoCoords[0] : (cascoCoords?.lat ?? cascoCoords?.latitud)) || -35.868;
  const cLng = Number(Array.isArray(cascoCoords) ? cascoCoords[1] : (cascoCoords?.lng ?? cascoCoords?.longitud)) || -58.945;

  const pendientes = (itemsSeleccionados || []).map((it, idx) => {
    let lat = Number(it.latitud ?? it.lat);
    let lng = Number(it.longitud ?? it.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -36.0 || lat > -35.7 || lng < -59.1 || lng > -58.8) {
      lat = cLat;
      lng = cLng;
    }
    return {
      id: it.id || `item_${idx + 1}`,
      tipo: it.tipo || it.categoria || 'Tarea',
      titulo: it.titulo || it.nombre || 'Mantenimiento de campo',
      prioridad: it.prioridad || 'Media',
      potrero_numero: it.potrero_numero,
      ubicacion: it.ubicacion || (it.potrero_numero ? `Potrero #${it.potrero_numero}` : 'Campo'),
      lat,
      lng,
      observaciones: it.observaciones || it.descripcion || '',
    };
  });

  // Ordenar priorizando Urgencias y luego cercanía al punto actual
  const paradas = [];
  let currLat = cLat;
  let currLng = cLng;
  let totalMinutos = 0;
  let safetyLoop = pendientes.length + 5;

  while (pendientes.length > 0 && safetyLoop-- > 0) {
    // Buscar el mejor candidato: urgentes primero, o el más cercano
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < pendientes.length; i++) {
      const p = pendientes[i];
      const dist = calcularDistanciaKm(currLat, currLng, p.lat, p.lng);
      const isUrgente = p.prioridad === 'Urgente' || p.prioridad === 'Alta';
      // Ponderación: las urgencias reducen artificialmente la distancia en el algoritmo
      const score = isUrgente ? dist * 0.35 : dist;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const [elegido] = pendientes.splice(bestIdx, 1);
    if (!elegido) break;

    const distReal = calcularDistanciaKm(currLat, currLng, elegido.lat, elegido.lng);
    const isEnCasco =
      Number(elegido.potrero_numero) === 14 ||
      (elegido.ubicacion && elegido.ubicacion.toLowerCase().includes('casco')) ||
      distReal <= 0.35;
    const distCalc = isEnCasco ? 0.2 : distReal;
    const tiempoViajeMin = isEnCasco ? 5 : Math.max(5, Math.round((distCalc / 25) * 60)); // ~25 km/h en callejones
    const tiempoTrabajoMin = elegido.prioridad === 'Urgente' ? 50 : 35;

    totalMinutos += tiempoViajeMin + tiempoTrabajoMin;
    currLat = elegido.lat;
    currLng = elegido.lng;

    // Herramientas y materiales deducidos por el tipo de trabajo
    const txt = `${elegido.titulo} ${elegido.observaciones} ${elegido.tipo}`.toLowerCase();
    const herramientasEsp = [];
    const materialesEsp = [];

    if (txt.includes('agua') || txt.includes('molino') || txt.includes('flotante') || txt.includes('bebida') || txt.includes('bomba')) {
      herramientasEsp.push('Llave Stilson 14"', 'Pico de loro', 'Cinta teflón');
      materialesEsp.push('Flotante bronce 1.5"', 'Goma de pistón', 'Abrazaderas');
    }
    if (txt.includes('alambre') || txt.includes('boyero') || txt.includes('eléctrico') || txt.includes('varilla') || txt.includes('esquinero')) {
      herramientasEsp.push('Tester de boyero', 'Pinza corta-alambre', 'Pala pocera');
      materialesEsp.push('Aisladores campanita', 'Rollo alambre electroplástico', 'Torniquetas');
    }
    if (txt.includes('manga') || txt.includes('corral') || txt.includes('tranca') || txt.includes('tabla')) {
      herramientasEsp.push('Maza 3kg', 'Taladro a batería', 'Barreta');
      materialesEsp.push('Tornillos pasantes 3/8"', 'Tablas duras de repuesto');
    }
    if (herramientasEsp.length === 0) {
      herramientasEsp.push('Caja de herramientas de mano', 'Pala de punta');
    }

    paradas.push({
      numero_parada: paradas.length + 1,
      id_item: elegido.id,
      tipo: elegido.tipo,
      titulo: elegido.titulo,
      ubicacion: elegido.ubicacion,
      coordenadas: [elegido.lat, elegido.lng],
      duracion_estimada: `${tiempoTrabajoMin} min`,
      distancia_desde_anterior_km: isEnCasco ? 0.2 : Number(distReal.toFixed(1)),
      tiempo_viaje_desde_anterior: isEnCasco
        ? '5 min (~0,2 km · En Casco)'
        : `${tiempoViajeMin} min (~${distReal.toFixed(1)} km)`,
      acciones: elegido.observaciones || `Reparación y verificación operativa de ${elegido.titulo.toLowerCase()}.`,
      herramientas_especificas: herramientasEsp,
      materiales_especificos: materialesEsp,
    });
  }

  // Vuelta al Casco
  const distRetorno = calcularDistanciaKm(currLat, currLng, cLat, cLng);
  const tiempoRetorno = Math.max(5, Math.round((distRetorno / 25) * 60));
  totalMinutos += tiempoRetorno;

  const horas = Math.floor(totalMinutos / 60);
  const mins = totalMinutos % 60;
  const tiempoTotalEstimado = `${horas > 0 ? `${horas}h ` : ''}${mins}m`;

  const checklistConsolidado = inferirChecklistCompleto(paradas);

  return {
    resumen_operativo: `Circuito coordinado de ${paradas.length} paradas con partida y regreso al Galpón Taller. Prioriza atenciones urgentes y optimiza el consumo de gasoil agrupando puntos contiguos.`,
    tiempo_total_estimado: tiempoTotalEstimado,
    inicio_recomendado: '07:30 hs (Mañana temprano para aprovechar la luz y evitar horas de calor)',
    origen_casco: {
      nombre: 'Casco / Galpón Taller',
      lat: cLat,
      lng: cLng,
    },
    paradas,
    checklist_camioneta: checklistConsolidado,
  };
}

function inferirChecklistCompleto(paradas = []) {
  const herramientas = new Set([
    'Caja de herramientas manual (tubos, combinadas 10-24, destornilladores, pinza)',
    'Pinza de fuerza / corta-alambre de alta palanca',
    'Bidón con 10L combustible de reserva y embudo',
    'Pala de punta y barreta de hierro',
  ]);
  const materiales = new Set([
    'Rollo de alambre galvanizado y alambre electroplástico',
    'Aisladores campanita, rienda y esquineros (caja surtida)',
    'Torniquetas dobles y simples de repuesto',
    'Cintas aisladoras vulcanizadas y teflón para roscas de agua',
  ]);
  const seguridad = [
    'Guantes de descarne y antiparras de protección para todo el equipo',
    'Termo o bidón con agua fresca potable (10 L)',
    'Handy VHF San José en canal operativo del Casco',
    'Botiquín de primeros auxilios y repelente de insectos',
  ];

  paradas.forEach((p) => {
    (p.herramientas_especificas || []).forEach((h) => herramientas.add(h));
    (p.materiales_especificos || []).forEach((m) => materiales.add(m));
  });

  return {
    herramientas: Array.from(herramientas),
    materiales_repuestos: Array.from(materiales),
    seguridad_epp: seguridad,
  };
}

/**
 * PLANIFICA LA RECORRIDA GANADERA Y DE PASTURAS (RODEOS, POTREROS, CC, AGUADAS)
 * Optimiza geográficamente el circuito desde el Casco minimizando kilómetros y evitando volver atrás,
 * enriqueciendo cada potrero con objetivos de Condición Corporal, remanente forrajero y chequeo de toros/parición.
 */
export async function planificarRecorridaGanadera({
  potrerosSeleccionados = [],
  cascoCoords = [-35.868, -58.945],
  fechaOperacion = new Date().toISOString().slice(0, 10),
  recorredorNombre = 'Recorredor San José',
}) {
  if (!potrerosSeleccionados || potrerosSeleccionados.length === 0) {
    throw new Error('No se seleccionaron potreros o rodeos para la recorrida ganadera.');
  }

  const cascoLat = Number(Array.isArray(cascoCoords) ? cascoCoords[0] : (cascoCoords?.lat ?? cascoCoords?.latitud)) || -35.868;
  const cascoLng = Number(Array.isArray(cascoCoords) ? cascoCoords[1] : (cascoCoords?.lng ?? cascoCoords?.longitud)) || -58.945;

  // 1. Optimización Geográfica previa (Nearest Neighbor + 2-Opt)
  const itemsGeo = potrerosSeleccionados.map((p, idx) => ({
    ...p,
    id: p.id || `p_${p.numero || idx + 1}`,
    coordenadas: p.coordenadas || [cascoLat, cascoLng],
  }));

  const { rutaOrdenada, distanciaTotalKm } = optimizarRutaGeografica([cascoLat, cascoLng], itemsGeo);
  const totalCabezas = rutaOrdenada.reduce((acc, p) => acc + (Number(p.total_cabezas) || 0), 0);

  const systemPrompt = `Sos el Asesor Ganadero y Capataz General de Establecimiento San José (Las Flores, Bs. As., 2.068 ha).
Tu misión es estructurar una hoja de recorrida de campo profesional y práctica para el recorredor/puestero.
El circuito ya fue optimizado geográficamente para minimizar kilómetros y no volver atrás entre potreros.

Punto de partida y retorno: Casco / Puesto Central (Lat: ${cascoLat}, Lng: ${cascoLng}).
Fecha de recorrida: ${fechaOperacion}.

PAUTAS CRÍTICAS DE RELEVAMIENTO GANADERO:
1. Condición Corporal (Escala 1 a 5): Indicar el objetivo según categoría (vientres en servicio meta 3.0, vaquillonas 3.5, recría 2.8-3.0). Alertar sobre apartar vientres < 2.5 a suplementación.
2. Pastura y Recurso Forrajero: Altura mínima remanente (ej. raigrás 5-7 cm, festuca 8-10 cm) para evitar sobrepastoreo y asegurar rebrote rápido.
3. Aguadas y Bebidas: Estado del molino, caudal, boya y sarro (fundamental para evitar mermas en consumo diario).
4. Sanidad & Servicio Reproductivo: Monitoreo de actividad de toros en servicio (libido, prepucio, aplomos), detección de celos en IATF y vigor/curabichera de terneros nacidos.
5. Equipo del Recorredor: Libreta/app, binoculares, tester boyero, jeringa descartable con antibiótico/curabichera, lazo, handy VHF y agua.

Devolvé OBLIGATORIAMENTE un JSON estricto con esta estructura exacta:
{
  "tipo": "RECORRIDA_GANADERA",
  "resumen_operativo": "Explicación clara del circuito, cuadrantes a relevar y focos principales del día",
  "tiempo_total_estimado": "3h 00m",
  "distancia_total_km": ${distanciaTotalKm},
  "inicio_recomendado": "07:00 hs (Fresco de la mañana)",
  "origen_casco": {
    "nombre": "Casco / Puesto Central",
    "lat": ${cascoLat},
    "lng": ${cascoLng}
  },
  "total_cabezas_inspeccionar": ${totalCabezas},
  "paradas": [
    {
      "numero_parada": 1,
      "id_item": "id_del_potrero",
      "potrero_numero": 12,
      "potrero_nombre": "P#12 - El Ombú",
      "ubicacion": "Potrero 12 (El Ombú) · 85 ha",
      "coordenadas": [-35.865, -58.940],
      "duracion_estimada": "25 min",
      "titulo": "Relevamiento P#12: Vientres y Raigrás",
      "acciones": "Revisar CC de vientres, actividad de toros y nivel de aguada.",
      "puntos_relevamiento": {
        "condicion_corporal": "Verificar CC meta 3.0 (1-5). Apartar vientres flacos.",
        "disponibilidad_pasto": "Medir remanente de pastura (> 6 cm).",
        "aguadas": "Chequear boya y caudal en Bebida Central Molino M#3.",
        "sanidad_reproduccion": "Controlar aplomos y libido de toros en servicio."
      }
    }
  ],
  "checklist_camioneta": {
    "herramientas": [
      "Libreta de campo o celular con App San José",
      "Binoculares / Prismáticos",
      "Tester digital de boyero eléctrico y pinza multiuso",
      "Soga corta / lazo de campo"
    ],
    "materiales_repuestos": [
      "Frasco de curabichera en pasta/aerosol",
      "Jeringa descartable con aguja 25/8 y antibiótico/desparasitante",
      "Aisladores campanita de repuesto (5 un)"
    ],
    "seguridad_epp": [
      "Handy VHF San José (Canal 1 Casco)",
      "Termo con 2L de agua fresca",
      "Sombrero de ala ancha y protector solar",
      "Botiquín básico"
    ]
  }
}`;

  const prompt = `Planificá la recorrida ganadera para ${fechaOperacion} (${recorredorNombre}).
Circuito ordenado de ${rutaOrdenada.length} potreros (${distanciaTotalKm} km totales):
${JSON.stringify(
  rutaOrdenada.map((p, idx) => ({
    parada: idx + 1,
    id: p.id,
    potrero_numero: p.numero,
    potrero_nombre: p.nombre,
    hectareas: p.hectareas,
    recurso_forrajero: p.recurso_forrajero || p.cultivo_actual || 'Campo Natural',
    total_cabezas: p.total_cabezas || 0,
    rodeos: (p.rodeos || []).map((r) => ({
      nombre: r.nombre,
      categoria: r.rol_protocolo || r.categoria || 'Rodeo',
      cabezas: calcRodeoCabezas(r),
      toros: calcRodeoToros(r),
      en_servicio: isRodeoEnServicio(r),
      reproductivo: r.estado_observaciones || r.estado_reproductivo || '',
    })),
    molinos: (p.molinos || []).map((m) => `Molino M#${m.numero}: ${m.estado || 'OK'}`),
    lat: p.coordenadas?.[0],
    lng: p.coordenadas?.[1],
  })),
  null,
  2
)}`;

  try {
    const aiResult = await callGeminiApi({
      prompt,
      systemPrompt,
      responseJson: true,
      timeoutMs: 22000,
    });

    if (aiResult && Array.isArray(aiResult.paradas) && aiResult.paradas.length > 0) {
      aiResult.tipo = 'RECORRIDA_GANADERA';
      aiResult.distancia_total_km = distanciaTotalKm;
      aiResult.total_cabezas_inspeccionar = totalCabezas;
      aiResult.paradas.forEach((p, idx) => {
        const orig = rutaOrdenada[idx] || rutaOrdenada.find((r) => String(r.id) === String(p.id_item));
        if (orig) {
          p.potrero_numero = orig.numero || p.potrero_numero;
          p.potrero_nombre = orig.nombre || p.potrero_nombre;
          p.coordenadas = orig.coordenadas || p.coordenadas;
          p.rodeos_en_potrero = orig.rodeos || [];
          p.recurso_forrajero = orig.recurso_forrajero || orig.cultivo_actual || 'Campo Natural';
          p.molinos_en_potrero = (orig.molinos || []).map((m) => `Molino M#${m.numero}`);
          p.distancia_desde_anterior_km = orig.distancia_desde_anterior_km || 1.5;
        }
      });
      return aiResult;
    }
  } catch (err) {
    console.warn('Gemini Recorrida Planner offline o timeout; usando generador heurístico ganadero:', err);
  }

  // Fallback heurístico ganadero local inmediato
  return generarPlanRecorridaGanaderaFallback({
    rutaOrdenada,
    distanciaTotalKm,
    cascoCoords: [cascoLat, cascoLng],
    fechaOperacion,
    recorredorNombre,
    totalCabezas,
  });
}

/**
 * Fallback heurístico ganadero local para armar la recorrida al instante
 */
export function generarPlanRecorridaGanaderaFallback({
  rutaOrdenada = [],
  distanciaTotalKm = 10,
  cascoCoords = [-35.868, -58.945],
  fechaOperacion = new Date().toISOString().slice(0, 10),
  recorredorNombre = 'Recorredor San José',
  totalCabezas = 0,
}) {
  const cascoLat = cascoCoords[0];
  const cascoLng = cascoCoords[1];

  const totalMinutos = Math.round(rutaOrdenada.length * 25 + (distanciaTotalKm / 20) * 60);
  const horas = Math.floor(totalMinutos / 60);
  const mins = totalMinutos % 60;
  const tiempoEstimadoStr = `${horas}h ${mins > 0 ? `${mins}m` : ''}`.trim();

  const paradas = rutaOrdenada.map((p, idx) => {
    const rodeosP = p.rodeos || [];
    const rodeoNombres = rodeosP
      .map((r) => `${r.nombre} (${calcRodeoCabezas(r)} cab.)`)
      .join(', ') || 'Sin rodeo asignado';
    const torosTot = rodeosP.reduce((acc, r) => acc + calcRodeoToros(r), 0);
    const tieneServicio = rodeosP.some((r) => isRodeoEnServicio(r));
    const pastura = p.recurso_forrajero || p.cultivo_actual || 'Campo Natural';
    const isEnCasco =
      Number(p.numero) === 14 ||
      (p.nombre && p.nombre.toLowerCase().includes('casco')) ||
      (p.distancia_desde_anterior_km != null && p.distancia_desde_anterior_km <= 0.35);

    return {
      numero_parada: idx + 1,
      id_item: p.id || `p_${p.numero}`,
      potrero_numero: p.numero,
      potrero_nombre: p.nombre,
      ubicacion: `Potrero #${p.numero} (${p.nombre}) · ${p.hectareas || 80} ha`,
      coordenadas: p.coordenadas || [cascoLat + (idx + 1) * 0.005, cascoLng + (idx + 1) * 0.005],
      duracion_estimada: '25 min',
      distancia_desde_anterior_km: isEnCasco ? 0.2 : (p.distancia_desde_anterior_km || 1.2),
      titulo: `Relevamiento P#${p.numero}: ${rodeoNombres}`,
      acciones: `Revisar CC de lote (${tieneServicio ? 'Entore activo' : 'Mantenimiento'}), estado de pastura ${pastura} y aguada.`,
      rodeos_en_potrero: rodeosP,
      recurso_forrajero: pastura,
      molinos_en_potrero: (p.molinos || []).map((m) => `Molino M#${m.numero || m.id}`),
      puntos_relevamiento: {
        condicion_corporal: `Evaluar CC del lote (meta 3.0 en escala 1-5). Identificar animales con CC < 2.5.`,
        disponibilidad_pasto: `Medir remanente de ${pastura}. Entrada esperada: 12-16 cm, salida: > 6 cm.`,
        aguadas: p.molinos?.length
          ? `Revisar Molino M#${p.molinos[0].numero || ''}: nivel de agua, boya de bebida y limpieza.`
          : 'Verificar bebedero y disponibilidad de agua limpia.',
        sanidad_reproduccion: tieneServicio
          ? `Controlar ${torosTot > 0 ? `${torosTot} toros en servicio` : 'lote en reproducción'}: aplomos, libido y celos.`
          : 'Monitorear estado general de salud, ausencia de rengueras y diarreas.',
      },
      herramientas_especificas: ['Binoculares', 'Tester boyero'],
      materiales_especificos: ['Curabichera', 'Jeringa descartable'],
    };
  });

  return {
    tipo: 'RECORRIDA_GANADERA',
    resumen_operativo: `Circuito ganadero optimizado cubriendo ${rutaOrdenada.length} potreros (${distanciaTotalKm} km) con salida desde Casco Central. Enfoque en relevamiento de condición corporal, estado forrajero y monitoreo de aguadas.`,
    tiempo_total_estimado: tiempoEstimadoStr,
    distancia_total_km: distanciaTotalKm,
    inicio_recomendado: '07:00 hs (Fresco de la mañana)',
    origen_casco: {
      nombre: 'Casco / Puesto Central',
      lat: cascoLat,
      lng: cascoLng,
    },
    total_cabezas_inspeccionar: totalCabezas,
    paradas,
    checklist_camioneta: {
      herramientas: [
        'Libreta de campo o celular con App San José',
        'Binoculares / Prismáticos',
        'Tester digital de boyero eléctrico y pinza multiuso',
        'Soga corta / lazo de campo',
      ],
      materiales_repuestos: [
        'Frasco de curabichera en pasta/aerosol',
        'Jeringa descartable con aguja 25/8 y antibiótico/desparasitante',
        'Aisladores campanita de repuesto (5 un)',
      ],
      seguridad_epp: [
        'Handy VHF San José (Canal 1 Casco)',
        'Termo con 2L de agua fresca',
        'Sombrero de ala ancha y protector solar',
        'Botiquín básico',
      ],
    },
  };
}

/**
 * SUGIERE AUTOMÁTICAMENTE EL PAQUETE ÓPTIMO DE TRABAJOS PARA LA CUADRILLA
 * Filtra tareas pendientes, alertas de mapa activas y molinos con problemas,
 * seleccionando un lote armónico y realista de 3 a 6 trabajos prioritarios.
 */
export function isItemCompletado(item) {
  if (!item) return false;
  if (item.completada === true || item.realizado === true || item.hecho === true || item.resuelta === true) return true;
  const estado = String(item.estado || '').trim().toLowerCase();
  const estadosCompletados = ['completada', 'completado', 'realizada', 'realizado', 'resuelta', 'resuelto', 'operativo', 'ok', 'archivada'];
  return estadosCompletados.includes(estado);
}

export function sugerirCuadrillaOptima({
  tareas = [],
  alertas = [],
  molinos = [],
  maxItems = 5,
}) {
  const candidatos = [];

  // 1. Alertas de Post-its activas no resueltas
  alertas
    .filter((a) => !isItemCompletado(a))
    .forEach((a) => {
      candidatos.push({
        id: `alerta_${a.id}`,
        tipo: 'Post-it Alerta',
        titulo: a.titulo || `Alerta en ${a.tipo || 'campo'}`,
        prioridad: a.prioridad || 'Alta',
        potrero_numero: a.potrero_numero,
        latitud: a.latitud,
        longitud: a.longitud,
        observaciones: a.descripcion || '',
        score: a.prioridad === 'Urgente' ? 100 : a.prioridad === 'Alta' ? 80 : 50,
      });
    });

  // 2. Molinos que requieren atención o con novedad (Roto o Mantenimiento pendiente)
  molinos
    .filter((m) => (m.estado === 'Roto' || m.estado === 'Mantenimiento') && !isItemCompletado(m))
    .forEach((m) => {
      candidatos.push({
        id: `molino_${m.id || m.numero}`,
        tipo: 'Aguada / Molino',
        titulo: `Molino M#${m.numero}: ${m.estado || 'Revisar aguada'}`,
        prioridad: m.estado === 'Roto' ? 'Urgente' : 'Alta',
        potrero_numero: m.potrero_numero,
        latitud: m.latitud,
        longitud: m.longitud,
        observaciones: m.novedades || m.observaciones || 'Revisar molino y tanque',
        score: m.estado === 'Roto' ? 110 : 85,
      });
    });

  // 3. Tareas operativas pendientes (excluir estrictamente las completadas)
  tareas
    .filter((t) => !isItemCompletado(t))
    .forEach((t) => {
      candidatos.push({
        id: `tarea_${t.id}`,
        tipo: t.categoria || 'Tarea',
        titulo: t.titulo,
        prioridad: t.prioridad || 'Media',
        potrero_numero: t.potrero_numero,
        latitud: t.latitud,
        longitud: t.longitud,
        observaciones: t.observaciones || '',
        score: t.prioridad === 'Urgente' ? 95 : t.prioridad === 'Alta' ? 75 : 40,
      });
    });

  // Ordenar por score decreciente y devolver los top N
  candidatos.sort((a, b) => b.score - a.score);
  return candidatos.slice(0, maxItems);
}

// 7. Auditoría de Costos Operativos Unitarios y Evolución Interanual
export async function auditarEsfuerzosInteranuales({
  campanaActual = '2026/2027',
  campanaAnterior = '2025/2026',
  kpisActual = {},
  kpisAnterior = {},
  rubrosComparativa = [],
}) {
  const systemPrompt = `Sos el consultor senior en finanzas agropecuarias y auditor de costos ganaderos de Establecimiento San José (Las Flores, Pcia. de Buenos Aires, Agroganadera Rincón del Sur S.A.).
Tu objetivo es analizar la evolución de los costos operativos unitarios (USD/cabeza y USD/kg) y la comparativa interanual de los centros de esfuerzo de la empresa.`;

  const prompt = `Analizá la siguiente comparativa interanual de costos operativos para Establecimiento San José:

CAMPAÑA ACTUAL: ${campanaActual}
- Costo Operativo Total: USD $${Math.round(kpisActual.costoTotal || 0).toLocaleString('es-AR')}
- Stock Activo: ${kpisActual.cabezas || 0} cabezas
- Costo por Cabeza: USD $${(kpisActual.costoPorCab || 0).toFixed(1)} / cab / año (USD $${((kpisActual.costoPorCab || 0) / 12).toFixed(1)} / mes)
- Kilos Producidos: ${Math.round(kpisActual.kilosProducidos || 0).toLocaleString('es-AR')} kg
- Costo por Kilo Producido: USD $${(kpisActual.costoPorKg || 0).toFixed(2)} / kg
- Precio Venta Ref: USD $${(kpisActual.precioVenta || 0).toFixed(2)} / kg
- Margen Neto por Kilo: USD $${(kpisActual.margenKg || 0).toFixed(2)} / kg

CAMPAÑA ANTERIOR: ${campanaAnterior}
- Costo Operativo Total: USD $${Math.round(kpisAnterior.costoTotal || 0).toLocaleString('es-AR')}
- Stock Activo: ${kpisAnterior.cabezas || 0} cabezas
- Costo por Cabeza: USD $${(kpisAnterior.costoPorCab || 0).toFixed(1)} / cab / año
- Costo por Kilo Producido: USD $${(kpisAnterior.costoPorKg || 0).toFixed(2)} / kg

DESGLOSE POR CENTRO DE ESFUERZO / RUBRO:
${rubrosComparativa
  .map(
    (r) =>
      `- ${r.rubro}: Actual USD $${Math.round(r.totalActual || 0).toLocaleString('es-AR')} (${(r.usdCabActual || 0).toFixed(1)} USD/cab, ${(r.pctActual || 0).toFixed(1)}% del total) vs Anterior USD $${Math.round(r.totalAnterior || 0).toLocaleString('es-AR')} -> Variación: ${(r.variacionPct || 0) > 0 ? '+' : ''}${(r.variacionPct || 0).toFixed(1)}%`
  )
  .join('\n')}

Devolvé un JSON con este formato exacto:
{
  "diagnostico_ejecutivo": "Diagnóstico conciso de 2 párrafos de alto impacto sobre la eficiencia del ciclo y la evolución de los costos unitarios en Las Flores...",
  "concentracion_esfuerzo": "Explicación de los 2 o 3 rubros que absorbieron la mayor proporción del capital y su justificación agronómica/ganadera...",
  "rubros_criticos_alerta": [
    {
      "rubro": "Nombre del rubro",
      "desvio_pct": "+XX%",
      "analisis": "Por qué creció este rubro y si se tradujo en más kilos o fue ineficiencia/inflación"
    }
  ],
  "palancas_reduccion_costo_kg": [
    {
      "area": "Área de optimización",
      "recomendacion": "Acción concreta y realista",
      "impacto_esperado": "Impacto estimado en USD/cab o USD/kg"
    }
  ],
  "conclusion_directorio": "Frase ejecutiva de síntesis recomendada para presentar ante el Directorio de Agroganadera Rincón del Sur S.A."
}`;

  try {
    return await callGeminiApi({
      prompt,
      systemPrompt,
      responseJson: true,
    });
  } catch (err) {
    console.warn('Fallo llamada API Gemini para auditoría, usando fallback:', err);
    return generarAuditoriaEsfuerzosFallback({
      campanaActual,
      campanaAnterior,
      kpisActual,
      kpisAnterior,
      rubrosComparativa,
    });
  }
}

export function generarAuditoriaEsfuerzosFallback({
  campanaActual,
  campanaAnterior,
  kpisActual,
  kpisAnterior,
  rubrosComparativa = [],
}) {
  const mayorRubro = [...rubrosComparativa].sort(
    (a, b) => (b.totalActual || 0) - (a.totalActual || 0)
  )[0] || { rubro: 'Pasturas y Siembras', pctActual: 32 };

  const rubroMayorAlza = [...rubrosComparativa].sort(
    (a, b) => (b.variacionPct || 0) - (a.variacionPct || 0)
  )[0] || { rubro: 'Combustible y Maquinaria', variacionPct: 14.5 };

  return {
    diagnostico_ejecutivo: `La campaña ${campanaActual} muestra una estructura de costos operativos consolidada con un costo unitario de USD $${(kpisActual.costoPorCab || 0).toFixed(1)}/cabeza y USD $${(kpisActual.costoPorKg || 0).toFixed(2)}/kg producido en Establecimiento San José. El margen neto estimado de USD $${(kpisActual.margenKg || 0).toFixed(2)}/kg refleja una rentabilidad sólida sostenida en la alta tasa de destete y la receptividad de los bajos dulces.`,
    concentracion_esfuerzo: `El principal centro de esfuerzo financiero estuvo concentrado en "${mayorRubro.rubro}" (${(mayorRubro.pctActual || 0).toFixed(1)}% del presupuesto operativo total), seguido por Personal y Sanidad. Esta inversión forrajera permitió sostener la receptividad global en 0.85-0.90 EV/ha y evitar compras excesivas de suplementación comercial durante la salida del invierno.`,
    rubros_criticos_alerta: [
      {
        rubro: rubroMayorAlza.rubro || 'Combustible y Maquinaria',
        desvio_pct: `${(rubroMayorAlza.variacionPct || 0) > 0 ? '+' : ''}${(rubroMayorAlza.variacionPct || 0).toFixed(1)}%`,
        analisis: `Registró el mayor incremento respecto al ciclo ${campanaAnterior}, impulsado por el mantenimiento correctivo de implementos de siembra y mayor movimiento de hacienda por rotaciones intensivas.`,
      },
      {
        rubro: 'Suplementación / Rollos',
        desvio_pct: '-6.2%',
        analisis: `Presentó un ahorro positivo derivado de la buena implantación de verdeos y festucas consociadas, reduciendo la necesidad de grano comercial en autoconsumo.`,
      },
    ],
    palancas_reduccion_costo_kg: [
      {
        area: 'Forrajes & Siembras',
        recomendacion: 'Maximizar el pastoreo directo en bajos dulces fertilizados y diferir rollos propios para el bache estival.',
        impacto_esperado: '-0.12 USD/kg producido',
      },
      {
        area: 'Logística de Maquinaria & Gasoil',
        recomendacion: 'Agrupar labores por potreros vecinos con el Planificador de Cuadrilla para reducir horas de traslado y consumo.',
        impacto_esperado: '-4.8 USD/cabeza/año',
      },
      {
        area: 'Sanidad Preventiva',
        recomendacion: 'Mantener el esquema de raspaje de toros y doble dosis clostridial en terneros para minimizar mermas tacto-destete.',
        impacto_esperado: '+3% en kilos destetados/vaca',
      },
    ],
    conclusion_directorio: `El establecimiento mantiene un perfil de costos competitivo y predecible. La clave para la campaña ${campanaActual} radica en consolidar la producción de kilos por hectárea sobre pasturas implantadas sin incrementar el gasto en horas máquina externas.`,
  };
}



// ============================================================================
// ESCANEO IA DE ETIQUETA / FACTURA / REMITO DE MEDICAMENTO VETERINARIO
// ============================================================================
export async function analizarMedicamentoVeterinarioIA(file) {
  let fileToAnalyze = file;
  let mimeType = getFileMimeType(file);

  if (isPdfFile(file)) {
    if ((file.size || 0) > 2.5 * 1024 * 1024) {
      try {
        const pages = await slicePdfToImages(file, { maxPages: 1, maxWidth: 1600, quality: 0.82 });
        if (pages && pages.length > 0 && pages[0].file) {
          fileToAnalyze = pages[0].file;
          mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
        }
      } catch (e) {
        console.warn('Fallback al trozar PDF en analizarMedicamentoVeterinarioIA:', e);
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      fileToAnalyze = file;
      mimeType = 'application/pdf';
    }
  } else {
    mimeType = getFileMimeType(fileToAnalyze);
  }

  const base64 = await fileToBase64(fileToAnalyze);
  if (!base64 || base64.trim() === '') {
    throw new Error('El documento o foto no generó datos base64 válidos.');
  }

  const systemPrompt = `Sos el médico veterinario y farmacéutico de Establecimiento San José (Las Flores, Bs. As.).
Tu misión es leer la etiqueta de un frasco, caja de medicamento veterinario o factura/remito de farmacia veterinaria, y extraer con máxima precisión: nombre comercial, principio activo, lote, fecha de vencimiento (AAAA-MM-DD), presentación/unidad, stock o cantidad, dosis recomendada por animal y precauciones.`;

  const prompt = `Analizá esta etiqueta o comprobante veterinario y devolvé ÚNICAMENTE un objeto JSON válido con los siguientes campos:
{
  "nombre": "Nombre comercial del producto (ej: Maxibiotic L.A. 250ml, Bioclostrigen, Dexametasona, etc.)",
  "categoria": "Sanidad",
  "unidad": "Frascos, Ampollas, Dosis, Litros o Cajas",
  "cantidad": 1,
  "lote": "Código de lote si figura o null",
  "fecha_vencimiento": "Fecha de vencimiento en formato AAAA-MM-DD si figura o null",
  "dosis_por_animal": "Dosis indicada por cabeza (ej: 2 ml/cab, 5 ml/cab, 1 cm/50 kg) si figura o null",
  "precio_unitario_ref": 0,
  "moneda": "ARS",
  "observaciones": "Resumen breve de indicación terapéutica y vía de administración"
}`;

  const parsed = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  return parsed;
}


// ============================================================================
// TRANSCRIPCIÓN IA DE HOJA DE CUADERNO DE MANGA / NOTAS VETERINARIAS
// ============================================================================
export async function transcribirHojaCuadernoVeterinarioIA(file) {
  let fileToAnalyze = file;
  let mimeType = getFileMimeType(file);

  if (isPdfFile(file)) {
    if ((file.size || 0) > 2.5 * 1024 * 1024) {
      try {
        const pages = await slicePdfToImages(file, { maxPages: 1, maxWidth: 1600, quality: 0.82 });
        if (pages && pages.length > 0 && pages[0].file) {
          fileToAnalyze = pages[0].file;
          mimeType = pages[0].mimeType || getFileMimeType(pages[0].file);
        }
      } catch (e) {
        console.warn('Fallback al trozar PDF en transcribirHojaCuadernoVeterinarioIA:', e);
        fileToAnalyze = file;
        mimeType = 'application/pdf';
      }
    } else {
      fileToAnalyze = file;
      mimeType = 'application/pdf';
    }
  } else {
    mimeType = getFileMimeType(fileToAnalyze);
  }

  const base64 = await fileToBase64(fileToAnalyze);
  if (!base64 || base64.trim() === '') {
    throw new Error('La foto del cuaderno no generó datos base64 válidos.');
  }

  const systemPrompt = `Sos el transcriptor veterinario oficial de Establecimiento San José (Las Flores, Bs. As.).
Tu misión es leer notas manuscritas o impresas de campo dejadas por el médico veterinario en la manga o libreta, reconociendo terminología técnica ganadera argentina (tacto rectal, IATF, raspaje de toros, mermas, clostridiosis, queratoconjuntivitis, diarrea neonatal, etc.) y estructurar las observaciones.`;

  const prompt = `Analizá esta foto de libreta o cuaderno de manga veterinaria y devolvé ÚNICAMENTE un objeto JSON válido con los siguientes campos:
{
  "fecha": "Fecha detectada en formato AAAA-MM-DD o null",
  "veterinario": "Nombre o firma del veterinario si figura o null",
  "rodeo_nombre": "Rodeo o lote evaluado si figura o null",
  "tipo_labor": "Tacto, Sangrado / Venéreas, Tratamiento Clínico, Necropsia, Plan Sanitario u Otro",
  "diagnostico": "Diagnóstico clínico o resultado del recuento/tacto",
  "tratamiento_indicado": "Medicamento y posología prescrita",
  "medicamentos_usados": "Productos utilizados en la jornada",
  "recomendaciones": "Indicaciones para el puestero o recorredor",
  "transcripcion_texto_completo": "Transcripción textual literal de lo escrito a mano en la hoja"
}`;

  const parsed = await callGeminiApi({
    prompt,
    systemPrompt,
    fileBase64: base64,
    mimeType,
    responseJson: true,
  });

  return parsed;
}

// ============================================================================
// SPRINT R & R.1: MOTOR COPILOTO CONTEXTUAL SAN JOSÉ (CEREBRO CRUZADO INTEGRAL)
// ============================================================================

export const GUIA_VETERINARIA_SAN_JOSE = [
  { nombre: 'Maxibiotic L.A. 250ml', tipo: 'Antibiótico L.A. (Oxitetraciclina 20%)', dosis: '1 ml cada 10 kg de peso vivo', indicacion: 'Infecciones respiratorias, pietín, queratoconjuntivitis, infecciones puerperales' },
  { nombre: 'Dexametasona Ampolla', tipo: 'Antiinflamatorio esteroide / corticoide', dosis: '1 ampolla por animal adulto (10-20 mg)', indicacion: 'Inflamación aguda, shock, alergia, edema, cetosis bovina' },
  { nombre: 'Sulfaprim 100/250ml', tipo: 'Quimioterápico / Sulfametoxazol + Trimetoprima', dosis: '15 ml cada 100 kg de peso vivo', indicacion: 'Neumonías, diarreas bacterianas, pododermatitis, difteria de los terneros' },
  { nombre: 'Magnecal Plus 500ml', tipo: 'Mineralizante Hipomagnesemia', dosis: '100 ml por animal adulto (subcutánea o endovenosa lenta)', indicacion: 'Tetania de los pastos, prevención y choque de hipomagnesemia aguda en vacas' },
  { nombre: 'Magnecal 3000 100ml', tipo: 'Magnesio concentrado inyectable', dosis: '20 ml por animal adulto', indicacion: 'Prevención rápida de carencias de magnesio en verdeos y pasturas tiernas' },
  { nombre: 'Bioclostrigen', tipo: 'Vacuna Clostridial Polivalente', dosis: '2 ml por animal (subcutánea)', indicacion: 'Prevención de mancha, gangrena y enterotoxemia en terneros y vaquillonas' },
  { nombre: 'Biopoligen HS/Q', tipo: 'Vacuna Respiratoria y Reproductiva', dosis: '5 ml por animal', indicacion: 'Complejo respiratorio (IBR, DVB, Pasteurella multocida, Histophilus somni)' },
  { nombre: 'Bagomectina 500ml', tipo: 'Antiparasitario Ivermectina 1%', dosis: '1 cm³ (1 ml) cada 50 kg de peso vivo', indicacion: 'Parásitos gastrointestinales, pulmonares y sarna bovina' },
  { nombre: 'Paraxane 1L', tipo: 'Antiparasitario Ricobendazol / Albendazol', dosis: '10 ml cada 100 kg de peso vivo', indicacion: 'Fasciola hepática y parásitos internos en destete y recría' },
  { nombre: 'Suplenut Se 500ml', tipo: 'Mineralizante Cobre + Selenio', dosis: '5 cm³ (5 ml) por vaca/vaquillona', indicacion: 'Mineralización preservicio, preparto y destete para mejorar fertilidad y defensas' },
  { nombre: 'Rotatec J5', tipo: 'Vacuna Diarrea Neonatal del Ternero', dosis: '3 ml por animal (madres)', indicacion: 'Rotavirus, Coronavirus y E. coli en terneros (vacunación preparto a madres)' },
];

export function construirContextoSanJoseVivo(context = {}) {
  const {
    rodeos = [],
    potreros = [],
    tareas = [],
    lluvias = [],
    insumos = [],
    maquinaria = [],
    ventas = [],
    gastos = [],
    laboresSiembras = [],
    cuadernoVet = [],
    movimientosPactados = [],
    fechaOperacion,
    moduloActivo = 'general',
    dolarRef = 1540,
    dolarModoManual = false,
    preciosHacienda = null,
    caminosEstado = 'Transitable',
    isSandboxMode = false,
  } = context;

  const preciosHaciendaActuales = preciosHacienda || getPreciosHaciendaRef();

  const hoyStr = fechaOperacion || new Date().toISOString().slice(0, 10);

  // 1. RODEOS Y STOCK VIVO (PRE-CÁLCULO EXACTO DE TOTALES CONCILIADOS)
  const cantidadRodeosActivos = (rodeos || []).length;
  const totalVacas = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.vacas, 10) || 0), 0);
  const totalTerneros = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.terneros, 10) || 0), 0);
  const totalTernerosM = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.terneros_machos, 10) || 0), 0);
  const totalTernerosH = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.terneros_hembras, 10) || 0), 0);
  const totalPadres = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.toros_padres, 10) || 0), 0);
  const totalToritos = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.toritos, 10) || 0), 0);
  const totalVaquillonasRep = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.vaquillonas_reposicion, 10) || 0), 0);
  const totalCut = (rodeos || []).reduce((acc, r) => acc + (parseInt(r.vacas_cut, 10) || 0), 0);
  const totalCabezasGeneral = (rodeos || []).reduce((acc, r) => {
    return (
      acc +
      (parseInt(r.vacas, 10) || 0) +
      (parseInt(r.terneros, 10) || 0) +
      (parseInt(r.toros_padres, 10) || 0) +
      (parseInt(r.toritos, 10) || 0) +
      (parseInt(r.vaquillonas_reposicion, 10) || 0) +
      (parseInt(r.vacas_cut, 10) || 0)
    );
  }, 0);
  const totalCabezas = totalCabezasGeneral;

  const potrerosOcupadosSet = new Set();
  (rodeos || []).forEach((r) => {
    if (r.potrero_numero != null && String(r.potrero_numero).trim() !== '') {
      potrerosOcupadosSet.add(Number(r.potrero_numero));
    }
  });

  const detalleRodeos = rodeos.map((r) => {
    const totTerneros = parseInt(r.terneros, 10) || 0;
    const machos = parseInt(r.terneros_machos, 10) || 0;
    const hembras = parseInt(r.terneros_hembras, 10) || 0;
    const sumCat =
      (parseInt(r.vacas, 10) || 0) +
      totTerneros +
      (parseInt(r.toros_padres, 10) || 0) +
      (parseInt(r.toritos, 10) || 0) +
      (parseInt(r.vaquillonas_reposicion, 10) || 0) +
      (parseInt(r.vacas_cut, 10) || 0);
    return `• Rodeo ID #${r.id} "${r.nombre}" (${r.categoria}): Potrero Lote ${r.potrero_numero || 'S/N'}, Vacas: ${r.vacas || 0}, Terneros: ${totTerneros} (M: ${machos}, H: ${hembras}), Toros Padres: ${r.toros_padres || 0}, Toritos: ${r.toritos || 0}, Vaq. Reposición: ${r.vaquillonas_reposicion || 0}, CUT: ${r.vacas_cut || 0}. Total: ${sumCat} cab.`;
  }).join('\n');

  // 2. INSUMOS, BOTIQUÍN Y GUÍA VETERINARIA
  const detalleInsumos = insumos.map((i) => {
    const precioStr = i.precio_unitario_ref
      ? `$${i.precio_unitario_ref} ${i.moneda || 'ARS'}`
      : 'Sin precio cargado';
    return `• Insumo ID #${i.id} "${i.nombre}" (${i.categoria}): En Campo: ${i.stock_campo || i.cantidad_actual || 0} ${i.unidad || 'un'} | En Coop: ${i.stock_cooperativa || 0} ${i.unidad || 'un'} | Último Precio Compra: ${precioStr} | Vence: ${i.fecha_vencimiento || 'S/F'} | Dosis: ${i.dosis_por_animal || '-'}`;
  }).join('\n');

  const detalleGuiaVet = GUIA_VETERINARIA_SAN_JOSE.map((g) => {
    return `• ${g.nombre} (${g.tipo}): Dosis Oficial = ${g.dosis} | Indicación = ${g.indicacion}`;
  }).join('\n');

  const insumosVencidos = insumos.filter(
    (i) => i.fecha_vencimiento && i.fecha_vencimiento <= hoyStr
  );
  const insumosPorVencer = insumos.filter((i) => {
    if (!i.fecha_vencimiento) return false;
    const diff = Math.ceil(
      (new Date(i.fecha_vencimiento) - new Date(hoyStr)) / (1000 * 60 * 60 * 24)
    );
    return diff > 0 && diff <= 60;
  });

  // 3. AGRICULTURA, SIEMBRAS Y POTREROS
  const detallePotreros = potreros.map((p) => {
    return `• Potrero #${p.numero} (${p.nombre || 'Lote ' + p.numero}): ${p.hectareas || 0} ha | Cobertura/Cultivo: ${p.cultivo_actual || p.recurso_forrajero || 'Campo Natural'}${p.ha_sembradas ? ` (${p.ha_sembradas} ha sembradas)` : ''}`;
  }).join('\n');

  const detalleSiembras = (laboresSiembras || []).slice(0, 6).map((s) => {
    const haS = Number(s.hectareas) || 1;
    const cTot = Number(s.costo_total_usd) || 0;
    return `• Siembra #${s.id} [${s.vigencia || 'Activa'}]: Potrero #${s.potrero_numero} (${haS} ha) - ${s.cultivo_variedad || 'Cultivo'} ${s.variedad_hibrido || ''} (${s.campana || '2026/2027'}, Estado: ${s.estado || 'Sembrado'}, Costo Total: USD $${Math.round(cTot)} = ${(cTot / haS).toFixed(1)} USD/ha)`;
  }).join('\n');

  // 4. DESGLOSE MENSUAL REAL DE FINANZAS (CALCULADO EXACTO POR CÓDIGO)
  const totalGastosUsd = (gastos || []).reduce((acc, g) => acc + (Number(g.monto_usd) || 0), 0);
  const totalGastosArs = (gastos || []).reduce((acc, g) => acc + (Number(g.monto_ars) || 0), 0);

  // Agrupamiento mensual estricto por año-mes (ej: 2026-07, 2026-08, etc.)
  const gastosPorMes = {};
  const gastosPorRubro = {};
  const mesesNombre = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  (gastos || []).forEach((g) => {
    const rubro = g.rubro || 'Otros';
    const mUsd = Number(g.monto_usd) || 0;
    const mArs = Number(g.monto_ars) || 0;
    gastosPorRubro[rubro] = (gastosPorRubro[rubro] || 0) + mUsd;

    if (g.fecha) {
      const key = String(g.fecha).slice(0, 7);
      if (!gastosPorMes[key]) {
        gastosPorMes[key] = { usd: 0, ars: 0, cant: 0 };
      }
      gastosPorMes[key].usd += mUsd;
      gastosPorMes[key].ars += mArs;
      gastosPorMes[key].cant += 1;
    }
  });

  const detalleRubros = Object.entries(gastosPorRubro)
    .sort((a, b) => b[1] - a[1])
    .map(([rubro, total]) => `• ${rubro}: USD $${Math.round(total).toLocaleString('es-AR')} (${((total / (totalGastosUsd || 1)) * 100).toFixed(1)}% del gasto total)`)
    .join('\n');

  const mesesConGastosKeys = Object.keys(gastosPorMes).sort();
  const cantidadMesesConGastos = mesesConGastosKeys.length || 1;
  const promedioMensualGastosUsd = Math.round(totalGastosUsd / cantidadMesesConGastos);
  const promedioMensualGastosArs = Math.round(totalGastosArs / cantidadMesesConGastos);

  const detalleMesesGastos = mesesConGastosKeys.map((key) => {
    const [y, m] = key.split('-');
    const mNum = parseInt(m, 10);
    const nombreMes = (mNum >= 1 && mNum <= 12) ? mesesNombre[mNum - 1] : m;
    const datos = gastosPorMes[key];
    return `  - ${nombreMes} ${y}: USD $${Math.round(datos.usd).toLocaleString('es-AR')} (ARS $${Math.round(datos.ars).toLocaleString('es-AR')} · ${datos.cant} comprobantes)`;
  }).join('\n');

  const costoPorCabUSD = totalCabezas > 0 ? (totalGastosUsd / totalCabezas).toFixed(1) : '0';
  const costoPorCabARS = totalCabezas > 0 ? Math.round(totalGastosArs / totalCabezas).toLocaleString('es-AR') : '0';

  const totalVentasUsd = (ventas || []).reduce((acc, v) => acc + (Number(v.ingreso_neto_usd) || 0), 0);
  const totalCabezasVendidas = (ventas || []).reduce((acc, v) => acc + (Number(v.cantidad_cabezas) || 0), 0);
  const detalleVentas = (ventas || []).slice(0, 5).map((v) => {
    return `• Venta #${v.id} (${v.fecha}): ${v.cantidad_cabezas || 0} cab. ${v.categoria || ''} a ${v.comprador || 'Comprador'} | ${v.kilos_totales || 0} kg | Precio: $${v.precio_kg || 0}/kg vivo | Ingreso Neto: USD $${Math.round(v.ingreso_neto_usd || 0)}`;
  }).join('\n');

  // Ventas agrupadas por mes
  const ventasPorMes = {};
  (ventas || []).forEach((v) => {
    if (!v.fecha) return;
    const key = String(v.fecha).slice(0, 7);
    if (!ventasPorMes[key]) {
      ventasPorMes[key] = { usd: 0, cabezas: 0 };
    }
    ventasPorMes[key].usd += Number(v.ingreso_neto_usd) || 0;
    ventasPorMes[key].cabezas += Number(v.cantidad_cabezas) || 0;
  });
  const mesesConVentasKeys = Object.keys(ventasPorMes).sort();
  const detalleMesesVentas = mesesConVentasKeys.map((key) => {
    const [y, m] = key.split('-');
    const mNum = parseInt(m, 10);
    const nombreMes = (mNum >= 1 && mNum <= 12) ? mesesNombre[mNum - 1] : m;
    const datos = ventasPorMes[key];
    return `  - ${nombreMes} ${y}: USD $${Math.round(datos.usd).toLocaleString('es-AR')} (${datos.cabezas} cabezas)`;
  }).join('\n');

  // 5. AGENDA, SANIDAD Y CAMPO
  const totalLluvia = lluvias.reduce((acc, ll) => acc + (Number(ll.milimetros) || 0), 0);
  const ultimasLluvias = lluvias
    .slice(0, 5)
    .map((ll) => `${ll.fecha}: ${ll.milimetros} mm (${ll.pluviometro || 'Casco'})`)
    .join(', ');

  const movsPendientes = (movimientosPactados || []).filter((m) => m.estado === 'Pendiente');
  const detalleMovs = movsPendientes
    .map(
      (m) =>
        `• Orden #${m.id} [${m.tipo_movimiento}]: ${m.rodeo_origen_nombre || 'Origen'} -> ${
          m.rodeo_destino_nombre || 'Lote ' + m.potrero_destino
        } (${m.cantidad_cabezas || 0} cab.) [Previsto: ${m.fecha_pactada}] [Motivo: ${m.motivo || 'Manejo'}]`
    )
    .join('\n');

  const detalleCuadernoVet = (cuadernoVet || []).slice(0, 6).map((c) => {
    return `• Cuaderno #${c.id} (${c.fecha} - ${c.rodeo_nombre || 'Rodeo'}): Labor: ${c.tipo_labor || 'Clínica'} | Diagnóstico: ${c.diagnostico || '-'} | Tratamiento: ${c.tratamiento_indicado || '-'} | Medicamentos: ${c.medicamentos_usados || '-'}`;
  }).join('\n');

  // FOCO DINÁMICO
  let focoModulo = `El usuario tiene abierta la vista: "${String(
    moduloActivo
  ).toUpperCase()}", pero vos disponés de toda la información cruzada del establecimiento.`;

  return `Sos el Socio Estratégico y Asesor Agropecuario de Establecimiento San José (Las Flores, Cuenca del Salado, Agroganadera Rincón del Sur S.A.).
Tu interlocutor es el dueño y administrador general del campo. La relación es de confianza mutua, rigor profesional, agilidad ejecutiva y visión integral de negocio mano a mano.

================================================================================
PAUTAS DE PERSONALIDAD, TONO Y LENGUAJE (OBLIGATORIAS):
================================================================================
1. TONO RIOPLATENSE NATURAL, CERCANO Y PROFESIONAL:
   - Hablá en español rioplatense natural, claro, fluido y directo (usá "vos", "tenés", "fijate", "mirá", "calculemos", "te sugiero", "vamos viendo").
   - Cero introducciones acartonadas, ni frases de bot ("Como modelo de lenguaje...", "A continuación presento el informe..."), ni saludos corporativos largos. Entrá directo al tema con criterio agronómico, financiero y ganadero real.
   - NUNCA recites obviedades que el productor ya sabe de memoria (como repetir que el campo tiene 2.068 ha o cuántos potreros hay), salvo que estés analizando específicamente la carga o superficie de un lote concreto.
   - Sé conciso y concreto cuando la consulta sea puntual, y estratégico, analítico y profundo cuando te pidan evaluar escenarios, proyecciones o balances.

2. 🚫 PROHIBICIÓN ABSOLUTA DE SINTAXIS LATEX:
   - NUNCA uses sintaxis de LaTeX: PROHIBIDO TERMINANTEMENTE usar "$$", "$...$", "\\frac", "\\text", "\\mathbf", "\\times", "\\div".
   - Escribí TODAS las fórmulas, desgloses matemáticos, relaciones numéricas y costos en TEXTO PLANO DIRECTO y limpio con operadores estándar:
     * División: "÷" o "/"
     * Multiplicación: "×" o "*"
     * Igualdad: "="
     * Ejemplo OBLIGATORIO: "USD $74.616 ÷ ${cantidadMesesConGastos} meses = USD $${promedioMensualGastosUsd.toLocaleString('es-AR')}/mes"
     * Ejemplo OBLIGATORIO: "USD $111.924 ÷ ${totalCabezasGeneral.toLocaleString('es-AR')} cabezas = USD $54,00 / cabeza / año"

3. 🔍 RIGOR LÓGICO SOBRE DATOS REALES (PROHIBIDO ADIVINAR O ASUMIR):
   - Apoyate SIEMPRE en los TOTALES OFICIALES EXACTOS y en el DESGLOSE MENSUAL REAL inyectados abajo.
   - Si los gastos registrados corresponden a ${cantidadMesesConGastos} meses reales (${mesesConGastosKeys.join(', ')}), NUNCA asumas 12 meses ni inventes datos que no figuran. El promedio mensual real es exactamente USD $${promedioMensualGastosUsd.toLocaleString('es-AR')}/mes.
   - Si falta un dato para una simulación (ej. precio futuro del ternero o flete), preguntáselo al usuario o planteale un rango explícito de estimación.

4. 📊 REPORTES E INFOGRAFÍAS (:::infografia ... :::, :::kpi ... :::):
   - Cuando estructures balances, comparativas, rotaciones o planes, utilizá los bloques visuales limpios :::infografia ... ::: o :::kpi ... ::: en sus propias líneas.
   - Cero SVG manuales. Cero dos puntos huérfanos antes o después de los bloques.

================================================================================
ESTADO VIVO ACTUAL DEL ESTABLECIMIENTO (${hoyStr}):
• Modo Operativo: ${isSandboxMode ? 'MODO SANDBOX (SIMULADOR / PRUEBAS)' : 'PRODUCCIÓN EN VIVO SUPABASE'}
• Superficie Total: 2.068 ha distribuidas en ${potreros.length} potreros.
• Hacienda Total en Campo: ${totalCabezasGeneral.toLocaleString('es-AR')} cabezas vacunas conciliadas.
• Estado de Caminos: ${caminosEstado}
• Registro de Lluvias: ${totalLluvia} mm acumulados en campaña. Recientes: ${ultimasLluvias || 'Sin registros recientes'}.
• Dólar Referencia: $${dolarRef}/USD (${dolarModoManual ? 'Fijado Manualmente' : 'Cotización Auto BNA / DolarApi'}).
• Pizarra de Precios Hacienda de Referencia (MAG Cañuelas / Rosgan):
  - Ternero Invernada (160-180 kg): $${Number(preciosHaciendaActuales.ternero_kg_ars || 6300).toLocaleString('es-AR')} ARS/kg (aprox. ${(Number(preciosHaciendaActuales.ternero_kg_ars || 6300) / (Number(dolarRef) || 1540)).toFixed(2)} USD/kg)
  - Novillito / Consumo: $${Number(preciosHaciendaActuales.novillito_kg_ars || 4400).toLocaleString('es-AR')} ARS/kg
  - Vaca Invernada / Descarte: $${Number(preciosHaciendaActuales.vaca_kg_ars || 3100).toLocaleString('es-AR')} ARS/kg (aprox. ${(Number(preciosHaciendaActuales.vaca_kg_ars || 3100) / (Number(dolarRef) || 1540)).toFixed(2)} USD/kg)
  - Toro: $${Number(preciosHaciendaActuales.toro_kg_ars || 3300).toLocaleString('es-AR')} ARS/kg (aprox. ${(Number(preciosHaciendaActuales.toro_kg_ars || 3300) / (Number(dolarRef) || 1540)).toFixed(2)} USD/kg)
• Google Search Grounding: ACTIVO EN VIVO. Cuando el usuario pregunte por precios del día del MAG, Rosgan, clima o cotización de insumos, consultá a internet en tiempo real para citar valores actualizados.

1. RODEOS Y STOCK ACTUAL EN BASE DE DATOS (TOTALES OFICIALES EXACTOS):
================================================================================
• Modo de Datos: ${isSandboxMode ? 'MODO SANDBOX (DATOS AISLADOS DE PRUEBA)' : 'PRODUCCIÓN VIVA SUPABASE'}
• Cantidad de Rodeos Activos: ${cantidadRodeosActivos} rodeos.
• Vacas: ${totalVacas.toLocaleString('es-AR')} cabezas.
• Terneros Total: ${totalTerneros.toLocaleString('es-AR')} cabezas (Machos: ${totalTernerosM.toLocaleString('es-AR')}, Hembras: ${totalTernerosH.toLocaleString('es-AR')}).
• Vaquillonas Reposición: ${totalVaquillonasRep.toLocaleString('es-AR')} cabezas.
• Vacas CUT: ${totalCut.toLocaleString('es-AR')} cabezas.
• Toros Padres: ${totalPadres.toLocaleString('es-AR')} cabezas.
• Toritos: ${totalToritos.toLocaleString('es-AR')} cabezas.
• Toros Totales (Padres + Toritos): ${(totalPadres + totalToritos).toLocaleString('es-AR')} cabezas.
• STOCK TOTAL GENERAL CONCILIADO: ${totalCabezasGeneral.toLocaleString('es-AR')} cabezas.
• Potreros Ocupados con Hacienda: ${potrerosOcupadosSet.size} potreros.

DESGLOSE INDIVIDUAL POR RODEO:
${detalleRodeos}
================================================================================

2. FINANZAS REALES Y DESGLOSE MENSUAL EXACTO (CALCULADO POR CÓDIGO):
================================================================================
• Total Gastos Acumulado: USD $${Math.round(totalGastosUsd).toLocaleString('es-AR')} (ARS $${Math.round(totalGastosArs).toLocaleString('es-AR')}).
• Período con Movimientos Registrados: ${cantidadMesesConGastos} meses reales (${mesesConGastosKeys.join(', ')}).
• Promedio Mensual Real de Gastos: USD $${promedioMensualGastosUsd.toLocaleString('es-AR')}/mes (calculado como USD $${Math.round(totalGastosUsd).toLocaleString('es-AR')} ÷ ${cantidadMesesConGastos} meses).
• Costo Operativo Unitario Acumulado: USD $${costoPorCabUSD} / cabeza / período (sobre ${totalCabezasGeneral.toLocaleString('es-AR')} cabezas).
• Desglose Mensual Real de Gastos:
${detalleMesesGastos || '  (Sin desglose mensual disponible)'}
• Gastos por Rubro:
${detalleRubros || '  (Sin gastos clasificados)'}
• Ingresos por Ventas de Hacienda: Total USD $${Math.round(totalVentasUsd).toLocaleString('es-AR')} (${totalCabezasVendidas} cabezas).
${detalleMesesVentas ? '• Desglose Mensual Real de Ventas:\n' + detalleMesesVentas : ''}
================================================================================

3. INSUMOS Y BOTIQUÍN EN STOCK (CON PRECIOS Y DOSIS):
${detalleInsumos || 'Sin insumos cargados'}

GUÍA VETERINARIA OFICIAL SAN JOSÉ:
${detalleGuiaVet}

ALERTAS SANITARIAS / INSUMOS:
• Insumos vencidos: ${insumosVencidos.length} ítems.
• Insumos por vencer en próximos 60 días: ${
    insumosPorVencer.map((i) => `${i.nombre} (Vence: ${i.fecha_vencimiento})`).join(', ') || 'Ninguno'
  }

4. POTREROS Y COBERTURA FORRAJERA:
${detallePotreros || 'Sin potreros cargados'}

SIEMBRAS Y LABORES REGISTRADAS:
${detalleSiembras || 'Sin siembras recientes'}

5. AGENDA Y CUADERNO DE CAMPO:
ÓRDENES DE MOVIMIENTOS PENDIENTES:
${detalleMovs || 'No hay movimientos pendientes'}

ÚLTIMAS NOTAS EN CUADERNO VETERINARIO:
${detalleCuadernoVet || 'Sin notas veterinarias recientes'}

FOCO DE CONTEXTO:
${focoModulo}

INSTRUCCIONES CLAVE DE FORMATO Y PROPUESTAS DE ACCIÓN:
- Cuando la respuesta requiera modificar o insertar registros en la base de datos (descontar insumos, registrar labor, pactar movimiento), incluí al final un bloque JSON con la clave "propuesta" para que la UI presente la tarjeta interactiva de confirmación humana:
  \`\`\`json
  {
    "propuesta": {
      "tipo": "TRATAMIENTO_SANITARIO" | "NUEVA_SIEMBRA_LABOR" | "ACTUALIZAR_RODEO" | "MOVIMIENTO_HACIENDA" | "BAJA_HACIENDA" | "NACIMIENTOS" | "CARGAR_INSUMO" | "DESCONTAR_STOCK" | "REGISTRAR_GASTO" | "NOTA_VETERINARIA" | "REGISTRAR_LLUVIA" | "SERVICE_MAQUINARIA",
      "titulo": "Título breve y descriptivo de la acción",
      "resumen": "Resumen claro de lo que se va a modificar o registrar en el sistema.",
      "datos": { "campo1": "valor1" },
      "operaciones": [
        {
          "tabla": "nombre_tabla_supabase",
          "accion": "update" | "insert" | "descontar",
          "filtro": { "id": 123 },
          "valores": { "campo": "valor" }
        }
      ]
    }
  }
  \`\`\`
- Para informes visuales ejecutivos utilizá el bloque estructurado:
  :::infografia
  {
    "titulo": "Título del Reporte",
    "subtitulo": "Contexto operativo",
    "kpis": [{ "label": "Stock Total", "valor": "2.079 cab.", "detalle": "1,00 cab/ha", "color": "emerald" }],
    "bloques": [
      {
        "titulo": "Nombre del Grupo",
        "color": "emerald",
        "items": [{ "nombre": "Cola · Pot. 26", "valor": "233 cab.", "porcentaje": 75, "nota": "2,65 cab/ha" }]
      }
    ],
    "conclusion": "Recomendación operativa concreta."
  }
  :::
- Para tarjetas métricas rápidas:
  :::kpi
  [
    { "label": "Carga Global", "valor": "0.98 EV/ha", "estado": "optimo", "detalle": "2.024 cabezas en 2.068 ha" }
  ]
  :::
- Para gráficos horizontales:
  :::chart
  {
    "tipo": "bar",
    "titulo": "Hacienda por Categoría",
    "datos": [{ "nombre": "Vacas", "valor": 1285, "color": "#064e3b" }]
  }
  :::
- DELIMITADORES DE BLOQUES ESTRICTOS: Cada bloque (:::infografia, :::kpi, :::chart) DEBE abrir y cerrar en su propia línea aislada exactamente con ::: (sin :::: ni dos puntos huérfanos).`;
}

export async function enviarMensajeCopilotoSanJose({
  messages = [],
  nuevoMensaje = {},
  context = {},
  model = GEMINI_PRO_MODEL,
}) {
  const systemPrompt = construirContextoSanJoseVivo(context);

  // Armar historial Gemini
  const chatContents = [];

  // Agregar mensajes previos del tópico (últimos 15 mensajes para no saturar tokens)
  const ultimosMensajes = messages.slice(-15);
  for (const m of ultimosMensajes) {
    const role = m.rol === 'user' ? 'user' : 'model';
    const parts = [];
    if (Array.isArray(m.archivos) && m.archivos.length > 0) {
      for (const a of m.archivos) {
        if (a.base64 && a.mimeType) {
          parts.push({
            inlineData: {
              mimeType: a.mimeType,
              data: a.base64,
            },
          });
        }
      }
    } else if (Array.isArray(m.adjuntos_json) && m.adjuntos_json.length > 0) {
      for (const a of m.adjuntos_json) {
        if (a.base64 && a.mimeType) {
          parts.push({
            inlineData: {
              mimeType: a.mimeType,
              data: a.base64,
            },
          });
        }
      }
    } else if (m.adjunto_base64 && m.adjunto_tipo) {
      parts.push({
        inlineData: {
          mimeType: m.adjunto_tipo,
          data: m.adjunto_base64,
        },
      });
    }
    parts.push({ text: m.contenido || '' });
    chatContents.push({ role, parts });
  }

  // Agregar el mensaje actual del usuario (con soporte multidocumento)
  const userParts = [];
  if (Array.isArray(nuevoMensaje.archivos) && nuevoMensaje.archivos.length > 0) {
    for (const arch of nuevoMensaje.archivos) {
      if (arch.base64 && arch.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: arch.mimeType,
            data: arch.base64,
          },
        });
      }
    }
  } else if (nuevoMensaje.fileBase64 && nuevoMensaje.mimeType) {
    userParts.push({
      inlineData: {
        mimeType: nuevoMensaje.mimeType,
        data: nuevoMensaje.fileBase64,
      },
    });
  }
  userParts.push({ text: nuevoMensaje.texto || 'Analizá estos documentos o fotos según el contexto agronómico y ganadero de San José.' });
  chatContents.push({ role: 'user', parts: userParts });

  // Invocar Gemini con modelo Pro y fallback a Flash (análisis profundo de 8192 tokens con Google Search Grounding en vivo)
  const rawResponse = await callGeminiApi({
    systemPrompt,
    contents: chatContents,
    model: model || GEMINI_PRO_MODEL,
    temperature: 0.55,
    maxOutputTokens: 8192,
    tools: [{ googleSearch: {} }],
  });

  // Extraer propuesta JSON si viene en el texto
  let respuestaTexto = rawResponse;
  let propuestaJson = null;

  const jsonMatch = rawResponse.match(/```json\s*(\{[\s\S]*?"propuesta"[\s\S]*?\})\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.propuesta) {
        propuestaJson = parsed.propuesta;
        // Limpiar el bloque JSON del texto visible para que la UI lo renderice como tarjeta interactiva
        respuestaTexto = rawResponse.replace(jsonMatch[0], '').trim();
      }
    } catch (err) {
      console.warn('No se pudo parsear el bloque propuesta JSON:', err);
    }
  }

  return {
    respuestaTexto,
    propuestaJson,
  };
}

/**
 * Consulta en la web vía Gemini con Google Search Grounding las cotizaciones vigentes
 * del Mercado Agroganadero de Cañuelas (MAG) y remates de invernada en pesos $/kg vivo.
 */
export async function consultarPreciosHaciendaWebIA() {
  const prompt = `Consultá en internet con Google Search los precios promedio vigentes más recientes de hacienda vacuna en Argentina (Mercado Agroganadero de Cañuelas MAG y remates de invernada Rosgan / consignatarios) para Noviembre 2026.
Extraé los valores en pesos argentinos por kilo vivo ($/kg) para:
1. Ternero de invernada (160-180 kg)
2. Novillito / consumo liviano
3. Vaca (invernada / conserva / manufactura)
4. Toro

Devolvé EXCLUSIVAMENTE un bloque JSON con esta estructura exacta (sin texto previo ni posterior):
{
  "ternero_kg_ars": 6300,
  "novillito_kg_ars": 4400,
  "vaca_kg_ars": 3100,
  "toro_kg_ars": 3300,
  "fuente": "MAG Cañuelas / Rosgan",
  "fecha": "22/11/2026",
  "resumen": "Cotizaciones promedio de plaza..."
}`;

  try {
    const raw = await callGeminiApi({
      prompt,
      tools: [{ googleSearch: {} }],
      responseJson: true,
      temperature: 0.2,
      timeoutMs: 35000,
    });

    if (raw && typeof raw === 'object') {
      return {
        ternero_kg_ars: Number(raw.ternero_kg_ars) || 6300,
        novillito_kg_ars: Number(raw.novillito_kg_ars) || 4400,
        vaca_kg_ars: Number(raw.vaca_kg_ars) || 3100,
        toro_kg_ars: Number(raw.toro_kg_ars) || 3300,
        fuente: raw.fuente || 'MAG Cañuelas / Google Search',
        fecha: raw.fecha || new Date().toLocaleDateString('es-AR'),
        resumen: raw.resumen || 'Precios consultados en internet.',
      };
    }
  } catch (err) {
    console.warn('Fallo en consulta online de hacienda con grounding, usando valores de referencia de Noviembre 2026:', err.message);
  }

  return {
    ternero_kg_ars: 6300,
    novillito_kg_ars: 4400,
    vaca_kg_ars: 3100,
    toro_kg_ars: 3300,
    fuente: 'Referencia Invernada Noviembre 2026',
    fecha: new Date().toLocaleDateString('es-AR'),
    resumen: 'Valores promedio estimados de plaza para Noviembre 2026.',
  };
}
