'use strict';
// Usage: node scripts/set-server-url.js https://script.google.com/macros/s/.../exec
// Optional environment variables PRIVACY_URL and TERMS_URL (https links) are written to the same file; they are shown in the app.
const fs = require('fs'), path = require('path');
const url = (process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+/.test(url)) { console.error('SERVER_URL must be an https:// address'); process.exit(1); }
const f = path.join(__dirname, '../www/config.js');
let old = {}; try { const m = /window\.APP_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?/.exec(fs.readFileSync(f, 'utf8')); if (m) old = JSON.parse(m[1]); } catch {}
const cfg = { SERVER_URL: url, PRIVACY_URL: old.PRIVACY_URL || '', TERMS_URL: old.TERMS_URL || '' };
for (const k of ['PRIVACY_URL', 'TERMS_URL']) { const v = (process.env[k] || '').trim(); if (v) { if (!/^https:\/\/[^\s]+$/.test(v)) { console.error(k + ' must be an https:// address'); process.exit(1); } cfg[k] = v; } }
fs.writeFileSync(f, 'window.APP_CONFIG = ' + JSON.stringify(cfg) + ';\n');
console.log('www/config.js ->', cfg.SERVER_URL, cfg.PRIVACY_URL ? '(privacy link set)' : '(no privacy link)', cfg.TERMS_URL ? '(terms link set)' : '(no terms link)');
