// Bundle the game into one self-contained HTML file (artifact body) plus a full
// standalone HTML (for the Android APK / local play), manifest and service worker.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const out = 'dist';
mkdirSync(out, { recursive: true });
const res = await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  loader: { '.json': 'json' },
  logLevel: 'warning',
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = readFileSync('tools/template.html', 'utf8');
const manifest = {
  name: 'VISTA COAST', short_name: 'VISTA COAST', start_url: '.', display: 'fullscreen', orientation: 'landscape',
  background_color: '#07090c', theme_color: '#07090c',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
};
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
const body = tpl.replace('<!--MANIFEST-->', '<link rel="manifest" href="manifest.json"><link rel="apple-touch-icon" href="icon-192.png">').replace('/*BUNDLE*/', () => js);
writeFileSync(`${out}/index.html`, body);
const standalone = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n` +
  body.replace('<canvas', '</head><body><canvas') + '</body></html>';
writeFileSync(`${out}/standalone.html`, standalone);
const sw = `const C='vistacoast-v1';self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon-192.png','icon-512.png']).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});return res;}).catch(()=>r)));});`;
writeFileSync(`${out}/sw.js`, sw);
console.log('bundle KB', Math.round(js.length / 1024), 'html KB', Math.round(body.length / 1024));
