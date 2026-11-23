import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

console.log('--- REVISANDO IMPORTS DE LUCIDE-REACT ---');

// Descargar lista de exportaciones de lucide-react (o importar dinámicamente)
const res = await fetch('https://esm.sh/lucide-react@0.475.0');
const text = await res.text();
// esm.sh exports or d.ts
const dtsRes = await fetch('https://esm.sh/lucide-react@0.475.0/dist/lucide-react.d.ts');
const dtsText = await dtsRes.text();

function getFiles(dir) {
  const list = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) list.push(...getFiles(full));
    else if (item.endsWith('.jsx') || item.endsWith('.js')) list.push(full);
  }
  return list;
}

const files = getFiles(srcDir);
const usedIcons = new Map();

for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const regex = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  let m;
  while ((m = regex.exec(code)) !== null) {
    const icons = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const ic of icons) {
      if (!usedIcons.has(ic)) usedIcons.set(ic, []);
      usedIcons.get(ic).push(path.relative(rootDir, f));
    }
  }
}

console.log(`Se encontraron ${usedIcons.size} iconos únicos de lucide-react en uso.\n`);

let missing = 0;
for (const icon of usedIcons.keys()) {
  // Check if declared in dts
  const exists =
    dtsText.includes(`declare const ${icon}:`) ||
    dtsText.includes(`export { ${icon}`) ||
    dtsText.includes(`${icon} as default`) ||
    dtsText.includes(`const ${icon} =`) ||
    text.includes(icon);

  if (!exists) {
    console.error(`  ✗ [ICONO NO ENCONTRADO EN LUCIDE]: ${icon} (usado en: ${usedIcons.get(icon).join(', ')})`);
    missing++;
  } else {
    // console.log(`  ✓ ${icon}`);
  }
}

if (missing === 0) {
  console.log(`✓ Todos los ${usedIcons.size} iconos de lucide-react existen y son 100% válidos.`);
  process.exit(0);
} else {
  console.error(`✗ Se encontraron ${missing} iconos no reconocidos.`);
  process.exit(1);
}
