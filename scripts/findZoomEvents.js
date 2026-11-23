import fs from 'fs';
const content = fs.readFileSync('src/components/MapaPotrerosView.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((l, idx) => {
  if (l.includes('setCurrentZoom') || l.includes('map.on(\'zoomend\'') || l.includes('map.on(\'zoom\'')) {
    console.log((idx+1) + ': ' + l.trim());
  }
});
