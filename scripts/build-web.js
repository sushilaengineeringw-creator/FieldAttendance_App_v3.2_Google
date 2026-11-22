'use strict';
// Builds the iPhone / browser version of the app into docs/app/ (served by your GitHub Pages site).
// It is the SAME www/ code as the Android app (the app already falls back to the browser's camera and GPS when it is not running inside the Android shell).
// Usage: node scripts/set-server-url.js <exec-url>   (writes www/config.js)   then   node scripts/build-web.js
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..'), out = path.join(root, 'docs', 'app');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'www'))) fs.copyFileSync(path.join(root, 'www', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'assets', 'web'))) fs.copyFileSync(path.join(root, 'assets', 'web', f), path.join(out, f));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({ name: 'Field Attendance', short_name: 'Attendance', start_url: './', scope: './', display: 'standalone', background_color: '#f2f6fc', theme_color: '#0b4fb3',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 1));
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');   // keep the page out of search results
if (/PASTE-YOUR-ID/.test(fs.readFileSync(path.join(out, 'config.js'), 'utf8'))) { console.error('config.js still has the placeholder server address - run scripts/set-server-url.js first'); process.exit(1); }
console.log('Web app written to docs/app/ (' + fs.readdirSync(out).length + ' files)');
