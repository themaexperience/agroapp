import fs from 'fs';
const content = fs.readFileSync('src/components/MapaPotrerosView.jsx', 'utf8');
const lines = content.split('\n');

const targets = ['currentZoom', '1.a DIBUJAR ETIQUETA DE POTRERO', '1.b DIBUJAR TARJETAS COMPACTAS', 'rodeo-floating-badge', 'potrero-clean-label-marker'];
targets.forEach(t => {
  const matches = [];
  lines.forEach((l, idx) => {
    if (l.includes(t)) matches.push((idx+1) + ': ' + l.trim().substring(0, 85));
  });
  console.log('=== ' + t + ' === (' + matches.length + ')');
  console.log(matches.slice(0, 10).join('\n'));
});
