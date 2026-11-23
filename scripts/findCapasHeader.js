import fs from 'fs';
const content = fs.readFileSync('src/components/MapaPotrerosView.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((l, idx) => {
  if (l.includes('Capas y Modos de Mapa') || l.includes('1. Pintura de Fondo') || l.includes('2. Capas Superpuestas')) {
    console.log((idx+1) + ': ' + l.trim());
  }
});
