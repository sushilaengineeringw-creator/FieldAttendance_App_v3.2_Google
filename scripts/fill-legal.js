'use strict';
// Usage: node scripts/fill-legal.js "Your Company Pvt Ltd" "support@example.com" "Street, City, State PIN" "Pune"
// Replaces the {{...}} placeholders in docs/*.html (privacy policy, terms, delete-account page).
const fs = require('fs'), path = require('path');
const [name, email, address, city] = process.argv.slice(2).map((s) => (s || '').trim());
if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') || !address || !city) { console.error('Usage: node scripts/fill-legal.js "Company name" "email" "Full address" "Jurisdiction city"'); process.exit(1); }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const map = { COMPANY_NAME: esc(name), CONTACT_EMAIL: esc(email), COMPANY_ADDRESS: esc(address), JURISDICTION: esc(city) };
const dir = path.join(__dirname, '../docs'); let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const p = path.join(dir, f); let t = fs.readFileSync(p, 'utf8'); const before = t;
  for (const [k, v] of Object.entries(map)) t = t.split('{{' + k + '}}').join(v);
  if (t !== before) { fs.writeFileSync(p, t); n++; }
}
const left = fs.readdirSync(dir).filter((x) => x.endsWith('.html')).filter((f) => /\{\{[A-Z_]+\}\}/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
console.log('updated', n, 'files' + (left.length ? '; placeholders still left in: ' + left.join(', ') : '; no placeholders left'));
