// src/utils/gemini.js - Extractor Multimodal Oficial para Google Gemini IA
// Establecimiento San José · Agroganadera Rincón del Sur S.A.
import {
  callGeminiApi,
  compressImage,
} from '../lib/geminiService.js';

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

/**
 * Convierte un archivo (imagen o PDF) a Base64 limpio sin encabezado "data:...;base64,"
 * y normaliza el MIME type oficial compatible con Google Gemini.
 */
export async function fileToBase64Clean(file) {
  if (!file) return { base64Clean: '', mimeType: '' };

  let mimeType = file.type || '';
  const name = (file.name || '').toLowerCase();
  if (!mimeType || mimeType === 'application/octet-stream') {
    if (name.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (name.endsWith('.png')) mimeType = 'image/png';
    else if (name.endsWith('.webp')) mimeType = 'image/webp';
    else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else mimeType = 'application/pdf';
  }

  let fileToConvert = file;
  if (mimeType.startsWith('image/')) {
    try {
      fileToConvert = await compressImage(file, 1600, 0.82);
    } catch {
      fileToConvert = file;
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Formato de archivo no legible como Base64.'));
        return;
      }
      // Eliminar el prefijo data:...;base64,
      const base64Clean = result.includes(',') ? result.split(',')[1].trim() : result.trim();
      resolve({ base64Clean, mimeType: fileToConvert.type || mimeType });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(fileToConvert);
  });
}

/**
 * Extractor Multimodal Flexible para Recetas Agronómicas, Remitos, Cotizaciones y Listas de Precios
 * Envía el archivo adjunto como inlineData multimodal a gemini-2.5-flash con responseMimeType: "application/json"
 */
export async function extraerInsumosYRecetaMultimodal(file, options = {}) {
  const { potreros = [], totHa = 0, contexto = '' } = options;
  const { base64Clean, mimeType } = await fileToBase64Clean(file);

  if (!base64Clean) {
    throw new Error('El archivo adjunto está vacío o no pudo ser procesado.');
  }

  const systemPrompt = `Sos el extractor agronómico y comercial de Establecimiento San José (Las Flores, Bs. As., Argentina).
Tu función es analizar fotos, capturas o PDFs de recetas agronómicas (RAO/MDA), prescripciones de agrónomos, remitos de entrega, presupuestos, facturas o listas de precios de cooperativas y agronomías.

REGLAS DE EXTRACCIÓN Y RESPUESTA:
1. Extraé CUALQUIER insumo agrícola (semillas, fertilizantes, herbicidas, insecticidas, fungicidas, coadyuvantes, inoculantes, curasemillas) o labor de contratistas que aparezca en el documento.
2. Para cada producto o labor, devolvé obligatoriamente en el array "items":
   - "nombre": string. Nombre comercial del producto o concepto de labor (ej. "Glifosato 66%", "Urea Granulada", "Semilla Sorgo BMR", "Atrazina 90%", "Siembra Directa").
   - "categoria": uno de estos valores exactos: "Semilla" | "Fertilizante" | "Agroquímico" | "Labor".
   - "presentacion": la presentación más adecuada entre: "Bolsa 25 kg" | "Bolsa 20 kg" | "Bolsa 40 kg" | "Bidón 20 L" | "Kg" | "Litros (L)" (o null si es labor).
   - "dosis_ha": number | null. Dosis por hectárea recomendada o aplicada (ej. 2.5), o null si el documento no especifica dosis por hectárea.
   - "cantidad_total": number | null. Cantidad total prescripta, entregada o presupuestada (número), o null si no figura.
   - "precio_unitario": number | null. Precio unitario detectado en el documento (número, ej. 62.50), o null si el documento no indica precios.
   - "moneda": "USD" | "ARS". Moneda detectada (por defecto "USD" en cotizaciones agrícolas o semillas/químicos; "ARS" si se especifica pesos argentinos o $ con IVA local).
3. LISTAS DE PRECIOS Y COTIZACIONES:
   - Si el documento es una lista de precios, cotización o presupuesto sin dosis por hectárea ni potrero asignado, extraé igualmente TODOS los productos listados con su precio_unitario, moneda y presentacion, colocando "dosis_ha": null y "cantidad_total": null.
4. RECETAS AGRONÓMICAS Y REMITOS SIN PRECIOS:
   - Extraé todos los insumos prescriptos o aplicados con su dosis_ha y cantidad_total, colocando "precio_unitario": null.
5. INFORMACIÓN GENERAL DEL COMPROBANTE:
   - "tipo_documento": "receta" | "cotizacion" | "remito" | "factura" | "lista_precios" | "labores" | "otro"
   - "proveedor_o_emisor": string | null. Nombre de la cooperativa, agronomía, técnico o contratista si figura.
   - "numero_comprobante": string | null. N° de receta, remito, factura o cotización si figura.
   - "fecha": string | null. Fecha indicada en el documento (formato YYYY-MM-DD o DD/MM/YYYY).
   - "potrero_mencionado": string | null. Nombre o número de potrero si figura.
   - "hectareas_mencionadas": number | null. Superficie en hectáreas si figura.
   - "cultivo_mencionado": string | null. Cultivo mencionado (ej. "Sorgo", "Maíz", "Soja", "Pastura").
   - "moneda": "USD" | "ARS".
6. FORMATO: Devolvé EXCLUSIVAMENTE un objeto JSON válido con esta estructura exacta, sin texto ni bloques Markdown fuera del JSON:
{
  "tipo_documento": "receta",
  "proveedor_o_emisor": null,
  "numero_comprobante": null,
  "fecha": null,
  "potrero_mencionado": null,
  "hectareas_mencionadas": null,
  "cultivo_mencionado": null,
  "moneda": "USD",
  "items": [
    {
      "nombre": "string",
      "categoria": "Semilla | Fertilizante | Agroquímico | Labor",
      "presentacion": "Bolsa 25 kg | Bolsa 20 kg | Bolsa 40 kg | Bidón 20 L | Kg | Litros (L)",
      "dosis_ha": null,
      "cantidad_total": null,
      "precio_unitario": null,
      "moneda": "USD"
    }
  ],
  "observaciones": null
}`;

  const prompt = `Analizá con precisión agronómica el documento adjunto y extraé en JSON estructurado todos los insumos agrícolas, dosis, cantidades y precios:\n${contexto ? `Contexto adicional: ${contexto}` : ''}`;

  // Se envía el archivo adjunto como inlineData multimodal a gemini-2.5-flash
  // en contents.parts como { inlineData: { data: base64Clean, mimeType: file.type } }
  // y con responseMimeType: "application/json"
  const contents = [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            data: base64Clean,
            mimeType: mimeType || file.type || 'application/pdf',
          },
        },
        { text: prompt },
      ],
    },
  ];

  const response = await callGeminiApi({
    model: 'gemini-2.5-flash',
    systemPrompt,
    contents,
    responseJson: true,
    temperature: 0.1,
    maxOutputTokens: 8192,
    timeoutMs: 55000,
  });

  let parsed = response;
  if (typeof parsed === 'string') {
    try {
      const clean = parsed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.warn('Aviso parseando respuesta de Gemini:', parseErr);
    }
  }

  return parsed;
}
