'use strict';
// Usage: node scripts/set-server-url.js https://script.google.com/macros/s/.../exec
// Optional environment variables PRIVACY_URL, TERMS_URL and PAY_URL (https links) are written to the same file; they are shown in the app.
// PAY_URL = your website's plans page (shown as 'Choose a plan and pay'). PLAY_BUILD=true (the Play Store bundle run) always leaves it EMPTY: no payment link in the Play version.
const fs = require('fs'), path = require('path');
const url = (process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+/.test(url)) { console.error('SERVER_URL must be an https:// address'); process.exit(1); }
const f = path.join(__dirname, '../www/config.js');
let old = {}; try { const m = /window\.APP_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?/.exec(fs.readFileSync(f, 'utf8')); if (m) old = JSON.parse(m[1]); } catch {}
const cfg = { SERVER_URL: url, PRIVACY_URL: old.PRIVACY_URL || '', TERMS_URL: old.TERMS_URL || '', PAY_URL: old.PAY_URL || '' };
for (const k of ['PRIVACY_URL', 'TERMS_URL', 'PAY_URL']) { const v = (process.env[k] || '').trim(); if (v) { if (!/^https:\/\/[^\s]+$/.test(v)) { console.error(k + ' must be an https:// address'); process.exit(1); } cfg[k] = v; } }
if (String(process.env.PLAY_BUILD || '').toLowerCase() === 'true') cfg.PAY_URL = '';
fs.writeFileSync(f, 'window.APP_CONFIG = ' + JSON.stringify(cfg) + ';\n');
console.log('www/config.js ->', cfg.SERVER_URL, cfg.PRIVACY_URL ? '(privacy link set)' : '(no privacy link)', cfg.TERMS_URL ? '(terms link set)' : '(no terms link)', cfg.PAY_URL ? '(plans link set)' : '(no plans link)');
