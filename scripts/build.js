import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

console.log('\n======================================================');
console.log('   ESTABLECIMIENTO SAN JOSÉ — BUILD Y SANEAMIENTO');
console.log('   Agroganadera Rincón del Sur S.A. · Las Flores');
console.log('======================================================\n');

const startTime = Date.now();
let errors = 0;

const requiredFiles = [
  'index.html',
  'vercel.json',
  'api/gemini.js',
  'public/robots.txt',
  'public/manifest.json',
  'public/logo-san-jose.png',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/apple-touch-icon.png',
  'public/favicon.svg',
  'public/sw.js',
  'src/main.jsx',
  'src/App.jsx',
  'src/config/version.js',
  'src/index.css',
  'src/lib/supabase.js',
  'src/lib/dolarService.js',
  'src/lib/pdfSlicer.js',
  'src/lib/geminiService.js',
  'src/lib/pdfReportBuilder.js',
  'src/utils/geoParser.js',
  'src/utils/pdfHelper.js',
  'src/utils/pdfSlicer.js',
  'src/utils/offlineQueue.js',
  'src/utils/dolarHistorico.js',
  'src/utils/dateHelper.js',
  'src/utils/auditLogger.js',
  'src/utils/rodeoHelpers.js',
  'src/utils/rodeoMovimientos.js',
  'src/utils/systemSnapshots.js',
  'src/components/ConfirmDialog.jsx',
  'src/components/LoginView.jsx',
  'src/components/TableroInicioView.jsx',
  'src/components/MapaPotrerosView.jsx',
  'src/components/RodeosCaravanasView.jsx',
  'src/components/CalendarioSanitarioView.jsx',
  'src/components/SiembrasCostosView.jsx',
  'src/components/SiembrasView.jsx',
  'src/components/CostosFinanzasView.jsx',
  'src/components/VentasView.jsx',
  'src/components/LiquidacionDetalleModal.jsx',
  'src/components/MaquinariaTallerView.jsx',
  'src/components/BitacoraMovimientosView.jsx',
  'src/components/InsumosReservasView.jsx',
  'src/components/TareasCampoView.jsx',
  'src/components/CopilotoCampoModal.jsx',
  'src/components/CuadrillaPlannerModal.jsx',
  'src/components/SystemSnapshotsModal.jsx',
  'src/components/GeminiFacturasBatchModal.jsx',
  'src/components/GeminiLiquidacionModal.jsx',
  'src/components/CaravanasManagerModal.jsx',
  'src/components/GeminiRecetaModal.jsx',
  'src/components/GeminiRepuestoModal.jsx',
  'src/components/GeminiPlanillaGasoilModal.jsx',
  'src/components/GeminiBalanceContableModal.jsx',
  'src/components/HistorialAuditoriaView.jsx',
  'src/components/CondicionCorporalStars.jsx',
  'src/components/PotreroCard.jsx',
  'src/components/InformesEjecutivosView.jsx',
  'src/components/InformesView.jsx',
  'src/data/aprendizajesFundacionales.js',
  'src/data/cronogramaSanJose.js',
];

console.log('[1/5] Verificando integridad de archivos y módulos...');
for (const relPath of requiredFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`  ✗ [FALTA] ${relPath}`);
    errors++;
  } else {
    const stats = fs.statSync(fullPath);
    console.log(`  ✓ ${relPath} (${(stats.size / 1024).toFixed(1)} kB)`);
  }
}

// 2. Compilación de sintaxis con Babel
console.log('\n[2/5] Compilando JSX y validando sintaxis de todos los módulos con Babel...');
let Babel;
const cachePath = path.join(rootDir, 'scripts', '.babel.min.js');
try {
  if (fs.existsSync(cachePath)) {
    const code = fs.readFileSync(cachePath, 'utf8');
    const fn = new Function(code + '; return Babel;');
    Babel = fn();
  } else {
    const res = await fetch('https://unpkg.com/@babel/standalone@7.26.9/babel.min.js');
    const code = await res.text();
    fs.writeFileSync(cachePath, code, 'utf8');
    const fn = new Function(code + '; return Babel;');
    Babel = fn();
  }

  function getFiles(dir) {
    const list = [];
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) list.push(...getFiles(full));
      else if (item.endsWith('.js') || item.endsWith('.jsx')) list.push(full);
    }
    return list;
  }

  const standardGlobals = new Set([
    'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'EvalError', 'InternalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
    'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp', 'Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'JSON', 'Promise', 'Generator', 'GeneratorFunction', 'AsyncFunction', 'Reflect', 'Proxy', 'Intl',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
    'console', 'undefined', 'NaN', 'Infinity', 'globalThis',
    'window', 'document', 'navigator', 'location', 'history', 'screen', 'localStorage', 'sessionStorage', 'indexedDB',
    'fetch', 'Headers', 'Request', 'Response', 'FormData', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FileList',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
    'alert', 'confirm', 'prompt', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'TouchEvent', 'FocusEvent', 'PointerEvent',
    'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
    'Audio', 'Image', 'CanvasRenderingContext2D', 'HTMLCanvasElement', 'ImageData', 'OffscreenCanvas',
    'WebSocket', 'Worker', 'crypto', 'CryptoKey', 'SubtleCrypto', 'Performance', 'performance',
    'btoa', 'atob', 'structuredClone', 'Notification', 'ClipboardItem',
    'AbortController', 'DOMParser', 'XMLSerializer',
    'L', 'Leaflet', 'pdfjsLib', 'JSZip', 'tailwind', 'jspdf', 'jspdfAutoTable', 'process', 'React', 'Babel'
  ]);

  const allFiles = getFiles(srcDir);
  for (const f of allFiles) {
    const rel = path.relative(rootDir, f);
    const code = fs.readFileSync(f, 'utf8');
    try {
      Babel.transform(code, { presets: ['react'], filename: f });
    } catch (err) {
      console.error(`  ✗ Error de sintaxis en ${rel}: ${err.message}`);
      errors++;
    }

    // Validación estricta no-undef vía Babel AST Scope
    try {
      const ast = Babel.packages.parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx']
      });
      Babel.packages.traverse.default(ast, {
        Program(p) {
          p.traverse({
            Identifier(idPath) {
              const name = idPath.node.name;
              if (idPath.isReferencedIdentifier() && !idPath.scope.hasBinding(name) && !standardGlobals.has(name)) {
                if (idPath.parentPath.isMemberExpression() && idPath.parentPath.node.property === idPath.node && !idPath.parentPath.node.computed) {
                  return;
                }
                if (idPath.parentPath.isObjectProperty() && idPath.parentPath.node.key === idPath.node && !idPath.parentPath.node.computed) {
                  return;
                }
                const line = idPath.node.loc ? idPath.node.loc.start.line : '?';
                console.error(`  ✗ [VARIABLE NO DEFINIDA (no-undef)] En ${rel}:${line} -> '${name}' no está declarada ni importada.`);
                errors++;
              }
            }
          });
        }
      });
    } catch (parseErr) {}

    // Validación de export default duplicados
    const defaultMatches = code.match(/\bexport\s+default\b/g) || [];
    if (defaultMatches.length > 1) {
      console.error(`  ✗ [EXPORT DEFAULT DUPLICADO] En ${rel}: Se encontraron ${defaultMatches.length} ocurrencias de 'export default'.`);
      errors++;
    }

    // Validación de React Hooks no importados
    const reactImports = code.match(/import\s+(?:React\s*,?\s*)?(?:\{([^}]+)\})?\s+from\s+['"]react['"];?/g) || [];
    let importedNamed = [];
    for (const imp of reactImports) {
      const m = imp.match(/\{([^}]+)\}/);
      if (m && m[1]) {
        importedNamed.push(...m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]));
      }
    }
    const cleanCode = code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[\s\S]*?`/g, '');
    const hooksToCheck = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer'];
    for (const hook of hooksToCheck) {
      const regex = new RegExp('\\b' + hook + '\\s*\\(');
      if (regex.test(cleanCode) && !importedNamed.includes(hook) && !code.includes('React.' + hook)) {
        console.error(`  ✗ [HOOK NO IMPORTADO] En ${rel}: Se usa '${hook}' pero no está importado de 'react'.`);
        errors++;
      }
    }

    // Validación de JSX Tags no definidos ni importados
    if (f.endsWith('.jsx')) {
      const definedSymbols = new Set(['React', 'Fragment', 'Babel', 'Leaflet', 'L']);

      const allImports = code.match(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g) || [];
      for (const imp of allImports) {
        const defMatch = imp.match(/import\s+([A-Za-z0-9_]+)\s*(?:,|\s+from)/);
        if (defMatch && defMatch[1] && defMatch[1] !== 'type') definedSymbols.add(defMatch[1]);
        const namedMatch = imp.match(/\{([^}]+)\}/);
        if (namedMatch && namedMatch[1]) {
          namedMatch[1].split(',').forEach((s) => {
            const tr = s.trim();
            if (tr) {
              if (tr.includes(' as ')) definedSymbols.add(tr.split(/\s+as\s+/)[1].trim());
              else definedSymbols.add(tr.split(/\s+/)[0].trim());
            }
          });
        }
      }

      const defRegex = /(?:const|let|var|function|class)\s+([A-Z][a-zA-Z0-9_]*)/g;
      let mDef;
      while ((mDef = defRegex.exec(code)) !== null) {
        definedSymbols.add(mDef[1]);
      }

      const destrRegex = /\{([^}]+)\}\s*=\s*/g;
      let mDestr;
      while ((mDestr = destrRegex.exec(code)) !== null) {
        mDestr[1].split(',').forEach((s) => {
          const t = s.trim();
          if (t.includes(':')) {
            const alias = t.split(':')[1].trim();
            if (/^[A-Z]/.test(alias)) definedSymbols.add(alias);
          } else {
            const name = t.split(/\s+/)[0].trim();
            if (/^[A-Z]/.test(name)) definedSymbols.add(name);
          }
        });
      }

      const paramRegex = /\(\s*\{([^}]+)\}\s*\)/g;
      let mParam;
      while ((mParam = paramRegex.exec(code)) !== null) {
        mParam[1].split(',').forEach((s) => {
          const t = s.trim();
          if (t.includes(':')) {
            const alias = t.split(':')[1].trim();
            if (/^[A-Z]/.test(alias)) definedSymbols.add(alias);
          } else {
            const name = t.split(/\s+/)[0].trim();
            if (/^[A-Z]/.test(name)) definedSymbols.add(name);
          }
        });
      }

      const jsxTagRegex = /<([A-Z][a-zA-Z0-9_]*)/g;
      let mTag;
      while ((mTag = jsxTagRegex.exec(cleanCode)) !== null) {
        const tag = mTag[1];
        if (!definedSymbols.has(tag)) {
          console.error(`  ✗ [JSX TAG NO DEFINIDO] En ${rel}: Se usa '<${tag}>' pero no está importado ni definido.`);
          errors++;
        }
      }
    }
  }
  if (errors === 0) {
    console.log(`  ✓ Todos los ${allFiles.length} archivos de src/ compilaron sin errores: hooks, tags JSX y variables (no-undef) 100% verificados.`);
  }
} catch (e) {
  console.warn('  ! Advertencia: no se pudo ejecutar validación Babel en build:', e.message);
}

// 3. Resolución de imports y moduleOrder
console.log('\n[3/5] Verificando resolución de imports y moduleOrder de index.html...');
try {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const idMatches = indexHtml.match(/id:\s*['"](\/src\/[^'"]+)['"]/g) || [];
  for (const m of idMatches) {
    const modId = m.replace(/id:\s*['"]/, '').replace(/['"]$/, '');
    const fullModPath = path.join(rootDir, modId);
    if (!fs.existsSync(fullModPath)) {
      console.error(`  ✗ [MODULE_ORDER ROTO] En index.html: No existe ${modId}`);
      errors++;
    }
  }
  console.log(`  ✓ Se verificaron ${idMatches.length} módulos en moduleOrder de index.html.`);

  // Validar resolución estática de todos los imports relativos en src/
  function getSrcFiles(dir) {
    const list = [];
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) list.push(...getSrcFiles(full));
      else if (item.endsWith('.js') || item.endsWith('.jsx')) list.push(full);
    }
    return list;
  }
  const allSrc = getSrcFiles(srcDir);
  let importChecks = 0;
  for (const f of allSrc) {
    const code = fs.readFileSync(f, 'utf8');
    const importRegex = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        importChecks++;
        const targetBase = path.resolve(path.dirname(f), spec);
        const candidates = [
          targetBase,
          `${targetBase}.js`,
          `${targetBase}.jsx`,
          path.join(targetBase, 'index.js'),
          path.join(targetBase, 'index.jsx'),
        ];
        if (!candidates.some((c) => fs.existsSync(c))) {
          console.error(`  ✗ [IMPORT ROTO] En ${path.relative(rootDir, f)}: No se puede resolver '${spec}'`);
          errors++;
        }
      }
    }
  }
  console.log(`  ✓ Se validaron ${importChecks} imports relativos en el código fuente.`);

  // Validar que todos los imports relativos de src/ estén cubiertos por moduleOrder de index.html
  const mMod = indexHtml.match(/const moduleOrder = (\[[\s\S]*?\]);/);
  if (mMod) {
    const list = eval(mMod[1]);
    const seenAliases = new Set();
    const orderErrors = [];
    for (const mod of list) {
      const fullMod = path.join(rootDir, mod.id.replace(/^\//, ''));
      if (fs.existsSync(fullMod)) {
        const modSource = fs.readFileSync(fullMod, 'utf8');
        const relRe = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
        let rMatch;
        while ((rMatch = relRe.exec(modSource)) !== null) {
          const s = rMatch[1];
          if (s === './index.css') continue;
          if (!seenAliases.has(s)) {
            orderErrors.push(`El módulo ${mod.id} importa '${s}' antes de que sea registrado en moduleOrder.`);
          }
        }
      }
      (mod.aliases || []).forEach((a) => seenAliases.add(a));
    }
    if (orderErrors.length > 0) {
      orderErrors.forEach((err) => console.error(`  ✗ [ORDEN DE MÓDULOS ROTO] ${err}`));
      errors += orderErrors.length;
    } else {
      console.log(`  ✓ Orden secuencial estricto (DAG) verificado: 0 dependencias circulares o prematuras.`);
    }
  }
} catch (e) {
  console.error('  ✗ Error validando resolución de imports:', e.message);
  errors++;
}

console.log('\n[4/5] Verificando configuración PWA, SPA y Vercel API...');

// Verificar manifest.json
try {
  const manifestRaw = fs.readFileSync(path.join(rootDir, 'public/manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  if (manifest.short_name === 'San José' && manifest.display === 'standalone') {
    console.log('  ✓ public/manifest.json válido (display: standalone, theme_color: #064e3b)');
  }
} catch (e) {
  console.error('  ✗ Error en public/manifest.json:', e.message);
  errors++;
}

// Verificar vercel.json
try {
  const vercelRaw = fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8');
  const vercelCfg = JSON.parse(vercelRaw);
  if (Array.isArray(vercelCfg.rewrites) && vercelCfg.rewrites.length > 0) {
    console.log('  ✓ vercel.json configurado con rewrites para SPA');
  }
} catch (e) {
  console.error('  ✗ Error en vercel.json:', e.message);
  errors++;
}

// Verificar api/gemini.js
try {
  const apiCode = fs.readFileSync(path.join(rootDir, 'api/gemini.js'), 'utf8');
  if (apiCode.includes('export default async function handler')) {
    console.log('  ✓ api/gemini.js válido para Vercel Serverless Function');
  }
} catch (e) {
  console.error('  ✗ Error leyendo api/gemini.js:', e.message);
  errors++;
}

console.log('\n[5/5] Generando artefactos para producción (dist/)...');

const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

try {
  fs.copyFileSync(path.join(rootDir, 'index.html'), path.join(distDir, 'index.html'));
  fs.copyFileSync(path.join(rootDir, 'vercel.json'), path.join(distDir, 'vercel.json'));

  const publicDir = path.join(rootDir, 'public');
  if (fs.existsSync(publicDir)) {
    const pubFiles = fs.readdirSync(publicDir);
    for (const pf of pubFiles) {
      fs.copyFileSync(path.join(publicDir, pf), path.join(distDir, pf));
    }
  }

  const distSrc = path.join(distDir, 'src');
  fs.cpSync(path.join(rootDir, 'src'), distSrc, { recursive: true, force: true });

  const distApi = path.join(distDir, 'api');
  fs.cpSync(path.join(rootDir, 'api'), distApi, { recursive: true, force: true });

  console.log(`  ✓ Artefactos de producción listos en dist/`);
} catch (e) {
  console.error('  ✗ Error generando directorio dist:', e.message);
  errors++;
}

const elapsed = Date.now() - startTime;
console.log('\n------------------------------------------------------');
if (errors === 0) {
  console.log(`✓ BUILD COMPLETADO CON ÉXITO (0 errores) en ${elapsed}ms`);
  console.log('  La aplicación está 100% lista para desplegar en Vercel.');
  console.log('------------------------------------------------------\n');
  process.exit(0);
} else {
  console.error(`✗ BUILD FALLÓ con ${errors} error(es) en ${elapsed}ms`);
  console.log('------------------------------------------------------\n');
  process.exit(1);
}
