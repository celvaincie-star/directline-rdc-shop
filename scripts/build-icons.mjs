// Génère assets/icons.js avec uniquement les icônes Lucide utilisées dans assets/app.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { icons } from 'lucide';

const source = readFileSync('assets/app.js', 'utf8');
const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const names = [...new Set([...source.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)].map((m) => m[1]))]
  .filter((name) => icons[pascal(name)])
  .sort();
const toSvg = (node) =>
  node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
const map = Object.fromEntries(names.map((name) => [name, toSvg(icons[pascal(name)])]));

writeFileSync(
  'assets/icons.js',
  `/* Généré par scripts/build-icons.mjs (icônes Lucide, licence ISC) — ne pas modifier à la main. */\nwindow.DL_ICONS=${JSON.stringify(map)};\n`,
);
console.log(`${names.length} icônes écrites dans assets/icons.js`);
