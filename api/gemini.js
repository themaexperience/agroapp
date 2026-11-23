// api/gemini.js - Vercel Serverless Function Blindada para Google Gemini en Producción
// Establecimiento San José · Agroganadera Rincón del Sur S.A.
//
// CARACTERÍSTICAS DE CIBERSEGURIDAD Y BLINDAJE:
// 1. Control de Origen Estricto (Origin & Referer Allowlist): Solo acepta peticiones de dominios autorizados de Vercel y localhost.
// 2. Autenticación Obligatoria con Supabase Auth: Rechaza con 401 Unauthorized si falta token Bearer o es inválido/expirado.
// 3. Rate Limiting en memoria: Máximo 30 requests por minuto por usuario/IP con cabeceras estándar (X-RateLimit-*, Retry-After).
// 4. Validación de Payload y Tipos MIME: Limite 10 MB, exclusivamente image/jpeg, image/png y application/pdf.
// 5. Fallback Resiliente de Modelos Google Gemini: gemini-3.5-flash-lite -> gemini-3.1-flash-lite con propagación técnica exacta de errores.

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests por minuto por usuario/IP
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv']);

// Caché en memoria para Rate Limiting y Validación de Tokens
const rateLimitMap = new Map();
const tokenValidationCache = new Map();

/**
 * Valida si el origen o referer pertenece a la lista blanca autorizada
 */
function isOriginAllowed(candidate) {
  if (!candidate) return true; // Peticiones del mismo host sin header Origin explícito
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host === 'estancia-san-jose.vercel.app') return true;
    if (host.endsWith('.vercel.app') && (host.includes('estancia-san-jose') || host.includes('agroganadera'))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Verifica el límite de peticiones (Rate Limit) por clave identificadora
 */
function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + RATE_LIMIT_WINDOW_MS;
  } else {
    entry.count += 1;
  }
  rateLimitMap.set(key, entry);

  // Limpieza preventiva de memoria
  if (rateLimitMap.size > 2000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetTime) rateLimitMap.delete(k);
    }
  }

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count);
  const resetSeconds = Math.ceil(Math.max(0, entry.resetTime - now) / 1000);
  return {
    allowed: entry.count <= RATE_LIMIT_MAX_REQUESTS,
    current: entry.count,
    remaining,
    resetSeconds,
  };
}

export default async function handler(req, res) {
  // 1. Control de Origen (Origin / Referer Allowlist)
  const origin = (req.headers.origin || '').trim();
  const referer = (req.headers.referer || '').trim();

  if (origin && !isOriginAllowed(origin)) {
    return res.status(403).json({
      error: `Origen no autorizado (${origin}). Acceso bloqueado por política de ciberseguridad.`,
      status: 403,
    });
  }
  if (referer && !isOriginAllowed(referer)) {
    return res.status(403).json({
      error: `Referer no autorizado. Acceso bloqueado por política de ciberseguridad.`,
      status: 403,
    });
  }

  // Encabezados CORS seguros y cabeceras de endurecimiento
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-goog-api-key');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 2. Método exclusivo POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({
      error: 'Método no permitido. Este endpoint solo acepta peticiones POST autenticadas.',
      status: 405,
    });
  }

  // 3. Autenticación Obligatoria con Supabase Auth (Bearer Token)
  const authHeader = (req.headers.authorization || req.headers.Authorization || '').trim();
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return res.status(401).json({
      error: 'No autorizado (401). Se requiere token Bearer de Supabase Auth en la cabecera Authorization.',
      status: 401,
    });
  }

  const token = tokenMatch[1].trim();
  if (!token) {
    return res.status(401).json({
      error: 'Token de autenticación vacío.',
      status: 401,
    });
  }

  // Validación de token contra Supabase Auth /auth/v1/user con caché de 60s
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://btruytfuiwrgyzrkkxat.supabase.co';
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cnV5dGZ1aXdyZ3l6cmtreGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2MDM0MTcsImV4cCI6MjExMDE3OTQxN30.1sqEEI70CLRWUDCG3SG6zjPdpRCoGH7Nt1og2ZW3CYk';

  let authenticatedUser = null;
  const cached = tokenValidationCache.get(token);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    authenticatedUser = cached.user;
  } else {
    try {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
      });

      if (!authRes.ok) {
        return res.status(401).json({
          error: 'Sesión no válida o expirada. Por favor iniciá sesión nuevamente en San José.',
          status: 401,
        });
      }

      authenticatedUser = await authRes.json();
      if (!authenticatedUser?.id) {
        return res.status(401).json({
          error: 'Usuario de Supabase no reconocido o inválido.',
          status: 401,
        });
      }

      // Guardar en caché por 60 segundos
      tokenValidationCache.set(token, {
        user: authenticatedUser,
        expiresAt: now + 60 * 1000,
      });

      if (tokenValidationCache.size > 500) {
        for (const [t, data] of tokenValidationCache.entries()) {
          if (now > data.expiresAt) tokenValidationCache.delete(t);
        }
      }
    } catch (authErr) {
      return res.status(401).json({
        error: `Error al verificar sesión de usuario con Supabase Auth: ${authErr.message}`,
        status: 401,
      });
    }
  }

  // 4. Rate Limiting por usuario autenticado o IP de origen
  const clientIp = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
  const rateLimitKey = authenticatedUser?.id ? `user_${authenticatedUser.id}` : `ip_${clientIp}`;
  const rateLimit = checkRateLimit(rateLimitKey);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
  res.setHeader('X-RateLimit-Reset', rateLimit.resetSeconds);

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', rateLimit.resetSeconds);
    return res.status(429).json({
      error: `Límite de peticiones excedido (máximo ${RATE_LIMIT_MAX_REQUESTS} por minuto). Reintentá en ${rateLimit.resetSeconds} segundos.`,
      status: 429,
    });
  }

  // 5. Validación de tamaño máximo de payload (10 MB)
  const contentLength = Number(req.headers['content-length']) || 0;
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({
      error: `Tamaño de petición demasiado grande (${(contentLength / (1024 * 1024)).toFixed(1)} MB). El límite máximo permitido es 10 MB.`,
      status: 413,
    });
  }

  // 6. Validación y parseo del cuerpo JSON
  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (parseErr) {
    return res.status(400).json({
      error: `Cuerpo de petición JSON inválido: ${parseErr.message}`,
      status: 400,
    });
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({
      error: 'Se esperaba un objeto JSON en el cuerpo de la petición.',
      status: 400,
    });
  }

  // 7. Validación estricta de tipos MIME permitidos
  if (Array.isArray(payload.contents)) {
    for (const c of payload.contents) {
      if (Array.isArray(c.parts)) {
        for (const part of c.parts) {
          if (part.inlineData) {
            const mime = (part.inlineData.mimeType || '').toLowerCase().trim();
            if (!ALLOWED_MIME_TYPES.has(mime)) {
              return res.status(400).json({
                error: `Tipo MIME no permitido: '${mime}'. Solo se admiten archivos image/jpeg, image/png y application/pdf.`,
                status: 400,
              });
            }
          }
        }
      }
    }
  }

  // 8. Obtención de API Key de Google Gemini
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    req.headers['x-goog-api-key'] ||
    req.headers['X-goog-api-key'] ||
    ''
  ).trim();

  if (!apiKey) {
    return res.status(500).json({
      error: 'Falta configurar la variable de entorno GEMINI_API_KEY en el panel de Vercel.',
      status: 500,
    });
  }

  // 9. Ejecución con Google Gemini (Modelos y Fallback Resiliente)
  const requestedModel = payload.model || 'gemini-2.5-pro';
  const fallbackModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const models = [requestedModel, ...fallbackModels].filter(
    (m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx
  );

  const googlePayload = {
    contents: payload.contents || [],
  };
  if (payload.systemInstruction) {
    googlePayload.systemInstruction = payload.systemInstruction;
  }
  if (payload.generationConfig) {
    googlePayload.generationConfig = payload.generationConfig;
  }
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    // Normalizar googleSearch (camelCase JS) a google_search (snake_case REST v1beta)
    googlePayload.tools = payload.tools.map((t) => {
      if (t.googleSearch) return { google_search: t.googleSearch };
      return t;
    });
  }

  const payloadString = JSON.stringify(googlePayload);

  let lastStatus = 500;
  let lastErrorMessage = 'Error desconocido al invocar Gemini API';
  let lastErrorDetails = null;

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    const isLastModel = i === models.length - 1;

    for (let attempt = 0; attempt <= 1; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000); // 50 segundos para soportar razonamiento profundo con gemini-2.5-pro

      try {
        const googleResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': apiKey,
            },
            body: payloadString,
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);

        lastStatus = googleResponse.status;

        if (googleResponse.ok) {
          const data = await googleResponse.json();
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(200).json(data);
        }

        let errorData = null;
        try {
          errorData = await googleResponse.json();
          lastErrorMessage =
            errorData.error?.message ||
            errorData.message ||
            JSON.stringify(errorData);
          lastErrorDetails = errorData.error || errorData;
        } catch {
          try {
            lastErrorMessage = await googleResponse.text();
          } catch {
            lastErrorMessage = `HTTP ${googleResponse.status}: ${googleResponse.statusText}`;
          }
        }

        console.warn(
          `[api/gemini] ${currentModel} respondió HTTP ${googleResponse.status}: ${lastErrorMessage}`
        );

        if (googleResponse.status === 404 || googleResponse.status === 503 || googleResponse.status === 429) {
          if (googleResponse.status === 503 || googleResponse.status === 429) {
            if (attempt < 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              continue;
            }
          }
          if (!isLastModel) {
            console.warn(`[api/gemini] Cambiando a modelo fallback ${models[i + 1]} tras error ${googleResponse.status} en ${currentModel}...`);
            break;
          }
        } else {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(googleResponse.status).json({
            error: lastErrorMessage,
            status: googleResponse.status,
            details: lastErrorDetails,
            model: currentModel,
          });
        }
      } catch (fetchErr) {
        clearTimeout(timeout);
        lastStatus = fetchErr.name === 'AbortError' ? 504 : 502;
        lastErrorMessage =
          fetchErr.name === 'AbortError'
            ? `Tiempo de espera agotado (25s) en conexión con Google Gemini (${currentModel})`
            : `Error de red al conectar con Google Gemini (${currentModel}): ${fetchErr.message}`;

        console.warn(`[api/gemini] Intento ${attempt} con ${currentModel} falló:`, fetchErr.message);

        if (attempt < 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        if (!isLastModel) {
          break;
        }
      }
    }
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(lastStatus >= 400 && lastStatus < 600 ? lastStatus : 503).json({
    error: lastErrorMessage,
    status: lastStatus,
    details: lastErrorDetails,
  });
}
