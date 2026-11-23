import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

console.log('======================================================');
console.log('   ESTABLECIMIENTO SAN JOSÉ — VALIDACIÓN DE SINTAXIS');
console.log('   Babel Standalone + Resolución de Imports + Lucide');
console.log('======================================================\n');

// 1. Obtener Babel
let Babel;
const cachePath = path.join(rootDir, 'scripts', '.babel.min.js');
if (fs.existsSync(cachePath)) {
  const code = fs.readFileSync(cachePath, 'utf8');
  const fn = new Function(code + '; return Babel;');
  Babel = fn();
} else {
  console.log('Descargando @babel/standalone para pruebas de compilación...');
  const res = await fetch('https://unpkg.com/@babel/standalone@7.26.9/babel.min.js');
  const code = await res.text();
  fs.writeFileSync(cachePath, code, 'utf8');
  const fn = new Function(code + '; return Babel;');
  Babel = fn();
}

console.log('Babel listo (v' + Babel.version + '). Analizando archivos en src/...\n');

function getFiles(dir) {
  const list = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      list.push(...getFiles(full));
    } else if (item.endsWith('.js') || item.endsWith('.jsx')) {
      list.push(full);
    }
  }
  return list;
}

const files = getFiles(srcDir);
let errors = 0;

console.log('[1/3] Compilando JSX y validando sintaxis de todos los archivos...');
for (const f of files) {
  const rel = path.relative(rootDir, f);
  const code = fs.readFileSync(f, 'utf8');
  try {
    Babel.transform(code, {
      presets: ['react'],
      filename: f,
    });
    console.log(`  ✓ ${rel}`);
  } catch (err) {
    console.error(`\n  ✗ ERROR DE SINTAXIS EN ${rel}:`);
    console.error(`    ${err.message}\n`);
    errors++;
  }
}

console.log('\n[2/3] Verificando resolución de imports relativos internos...');
for (const f of files) {
  const rel = path.relative(rootDir, f);
  const code = fs.readFileSync(f, 'utf8');
  const importRegex = /(?:import|from)\s+['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const importPath = match[1];
    if (importPath.endsWith('.css')) continue;

    const baseDir = path.dirname(f);
    const resolvedPath = path.resolve(baseDir, importPath);

    // Comprobar extensiones posibles: exacto, .js, .jsx, /index.js, /index.jsx
    const exists =
      fs.existsSync(resolvedPath) ||
      fs.existsSync(resolvedPath + '.js') ||
      fs.existsSync(resolvedPath + '.jsx') ||
      fs.existsSync(path.join(resolvedPath, 'index.js')) ||
      fs.existsSync(path.join(resolvedPath, 'index.jsx'));

    if (!exists) {
      console.error(`  ✗ [IMPORT ROTO] En ${rel}: No se encuentra "${importPath}"`);
      errors++;
    }
  }
}
if (errors === 0) {
  console.log('  ✓ Todos los imports relativos resuelven a archivos existentes.');
}

console.log('\n[3/3] Verificando módulos declarados en index.html (moduleOrder)...');
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

console.log('\n======================================================');
if (errors === 0) {
  console.log(`✓ SANEAMIENTO COMPLETADO: 0 ERRORES EN TODOS LOS MÓDULOS.`);
  console.log('======================================================\n');
  process.exit(0);
} else {
  console.error(`✗ FALLÓ CON ${errors} ERROR(ES).`);
  console.log('======================================================\n');
  process.exit(1);
}
