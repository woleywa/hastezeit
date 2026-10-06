// Builds the hosted web demo: the real frontend (public/ + shared/) bundled into ONE html file,
// with the HTTP API swapped for demo/api-demo.js (data lives in the visitor's browser).
//
//   npm run build:demo   →  dist/bock-demo.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_API = path.join(ROOT, 'demo', 'api-demo.js');

const resolvePaths = {
  name: 'bock-paths',
  setup(b) {
    // Browser-absolute imports like '/shared/format.js' → repo folder
    b.onResolve({ filter: /^\/shared\// }, (args) => ({ path: path.join(ROOT, args.path) }));
    // Every import of the real API client gets the in-browser demo API instead
    b.onResolve({ filter: /\/api\.js$/ }, (args) =>
      args.importer === DEMO_API ? undefined : { path: DEMO_API },
    );
  },
};

const result = await build({
  entryPoints: [path.join(ROOT, 'public/js/app.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  charset: 'utf8',
  write: false,
  plugins: [resolvePaths],
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');

// Body of public/index.html without the head/script tags; the artifact host adds the document skeleton.
const html = `<title>Bock</title>
<meta name="description" content="Wer hat Zeit? Wer hat Bock? Wer braucht Hilfe? Demo der privaten Freundeskreis-App.">
<style>${css}</style>
<div id="app">
  <main id="view" class="view" aria-live="polite"><div class="splash"><div class="splash-logo">🤙</div></div></main>
  <nav id="tabbar" class="tabbar" hidden></nav>
</div>
<div id="sheet-root"></div>
<div id="toast-root" aria-live="assertive"></div>
<script>${js}</script>
`;

const out = path.join(ROOT, 'dist', 'bock-demo.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`✓ ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB)`);

// Static website version (GitHub Pages, Netlify, …): full HTML document + icons + manifest.
// All paths are relative, so it also works under a sub-path like /Haste-Bock-/.
const site = path.join(ROOT, 'dist', 'site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'public/icons'))) {
  fs.copyFileSync(path.join(ROOT, 'public/icons', f), path.join(site, 'icons', f));
}
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
manifest.start_url = './';
manifest.scope = './';
manifest.icons = manifest.icons.map((i) => ({ ...i, src: i.src.replace(/^\//, '') }));
manifest.shortcuts = manifest.shortcuts.map((s) => ({ ...s, url: s.url.replace(/^\//, './') }));
fs.writeFileSync(path.join(site, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(site, 'index.html'),
  `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f7f4ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151318" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Bock">
<meta property="og:title" content="Bock – Zeit mit Freunden">
<meta property="og:description" content="Wer hat Zeit? Wer hat Bock? Wer braucht Hilfe?">
<meta property="og:image" content="icons/og.png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
</head>
<body>
${html}</body>
</html>
`,
);
fs.writeFileSync(path.join(site, '.nojekyll'), '');
console.log(`✓ ${path.relative(ROOT, site)}/ (statische Website)`);
