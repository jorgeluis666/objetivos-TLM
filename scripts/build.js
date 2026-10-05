#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

// La pantalla de acceso vive fuera del HTML inlineado, asi que dist/ necesita
// una copia del script y de la imagen de fondo o el build sale sin login.
function copyLoginAssets() {
  for (const asset of ['auth-login.js', 'login-bg.jpg']) {
    const source = path.join(ROOT, asset);
    if (!fs.existsSync(source)) {
      console.warn(`[build] falta ${asset}; dist quedara sin ese archivo`);
      continue;
    }
    fs.copyFileSync(source, path.join(DIST_DIR, asset));
  }
}

// El logo y el favicon se sirven como archivos: sin esta copia dist/ sale con
// la marca rota aunque el CSS y el HTML si esten inlineados.
function copyBrandAssets() {
  const source = path.join(ROOT, 'assets');
  if (!fs.existsSync(source)) {
    console.warn('[build] falta assets/; dist quedara sin logo ni favicon');
    return;
  }
  const target = path.join(DIST_DIR, 'assets');
  fs.mkdirSync(target, { recursive: true });
  for (const asset of ['logo-tlm.png', 'favicon.png']) {
    if (!fs.existsSync(path.join(source, asset))) {
      console.warn(`[build] falta assets/${asset}; dist quedara sin ese archivo`);
      continue;
    }
    fs.copyFileSync(path.join(source, asset), path.join(target, asset));
  }
}

function main() {
  let html = readFile('index.html');
  const css = readFile('css/dashboard.css').replace(/url\('\.\.\/assets\//g, "url('assets/");
  const app = readFile('js/objectives.js');
  const navigation = readFile('js/navigation.js');
  const sidebar = readFile('js/sidebar.js');
  const projections = readFile('js/projections.js');
  const bitacora = readFile('js/bitacora.js');
  const data = readFile('data/tlm-ads-2026.json').replace(/</g, '\\u003c');
  const bitacoraData = readFile('data/tlm-bitacora-2026.json').replace(/</g, '\\u003c');

  html = html.replace(
    new RegExp('<link rel=\"stylesheet\" href=\"css/dashboard\\.css(?:\\?v=[^\"]+)?\">'),
    `<style>${css}</style>`
  );
  html = html.replace(
    new RegExp('<script src=\"js/objectives\\.js(?:\\?v=[^\"]+)?\"><\\/script>'),
    `<script>${app}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/navigation\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${navigation}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/sidebar\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${sidebar}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/projections\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${projections}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/bitacora\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${bitacora}</script>`
  );
  html = html.replace(
    '</head>',
    `<script>window.TLM_ADS_DATA = ${data};window.TLM_BITACORA = ${bitacoraData};</script></head>`
  );

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, 'data'), { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  fs.copyFileSync(
    path.join(ROOT, 'data', 'tlm-ads-2026.json'),
    path.join(DIST_DIR, 'data', 'tlm-ads-2026.json')
  );

  fs.copyFileSync(
    path.join(ROOT, 'data', 'tlm-bitacora-2026.json'),
    path.join(DIST_DIR, 'data', 'tlm-bitacora-2026.json')
  );

  copyLoginAssets();
  copyBrandAssets();

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

try {
  main();
} catch (error) {
  console.error('[build] error:', error.message);
  process.exit(1);
}
