// Assembles the GitHub Pages site:
//   /            landing page          (pages/index.html + pages/assets)
//   /v1/ …       frozen older versions (pages/v1, … – prebuilt, committed as-is)
//   /v2/         current version       (built from this repo's source)
//
// New version: move the current one into pages/vN (copy dist/site), bump CURRENT below,
// add a card to pages/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT = 'v2';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'dist', 'pages');

await import('./build.mjs'); // builds the current version into dist/site

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'pages'), out, { recursive: true });
fs.cpSync(path.join(ROOT, 'dist', 'site'), path.join(out, CURRENT), { recursive: true });
fs.rmSync(path.join(out, CURRENT, '.nojekyll'), { force: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`✓ dist/pages/ (Landingpage + ${fs.readdirSync(out).filter((d) => /^v\d+$/.test(d)).join(', ')})`);
