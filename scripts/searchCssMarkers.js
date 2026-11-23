import fs from 'node:fs';

const code = fs.readFileSync('src/index.css', 'utf8');
const lines = code.split('\n');

lines.forEach((l, idx) => {
  if (/infra-|marker/i.test(l)) {
    console.log((idx + 1) + ': ' + l.trim());
  }
});
