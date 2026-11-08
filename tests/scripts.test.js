'use strict';
// Build helper scripts and Play Store files: manifest/gradle patching, server-url config, legal-page placeholders, policy content.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(d, 'scripts'), { recursive: true }); fs.cpSync(path.join(ROOT, 'docs'), path.join(d, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(d, 'www')); fs.copyFileSync(path.join(ROOT, 'www/config.js'), path.join(d, 'www/config.js')); fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(d, 'package.json'));
  return d;
}
const run = (d, script, args = [], env = {}) => cp.spawnSync('node', [path.join(d, 'scripts', script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

test('Android patch: only camera + foreground location + internet permissions, no backup, version code/name, optional release signing', () => {
  const d = sandbox(), a = path.join(d, 'android/app/src/main'); fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, 'AndroidManifest.xml'), '<?xml version="1.0"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application\n        android:allowBackup="true"\n        android:label="x">\n    </application>\n    <!-- Permissions -->\n</manifest>\n');
  fs.writeFileSync(path.join(d, 'android/app/build.gradle'), 'android {\n    namespace = "com.x"\n    defaultConfig {\n        versionCode 1\n        versionName "1.0"\n    }\n}\n');
  let r = run(d, 'patch-android.js', [], { GITHUB_RUN_NUMBER: '42', HOME: d }); assert.equal(r.status, 0, r.stderr);
  const mf = fs.readFileSync(path.join(a, 'AndroidManifest.xml'), 'utf8'), gr = fs.readFileSync(path.join(d, 'android/app/build.gradle'), 'utf8');
  const perms = [...mf.matchAll(/uses-permission android:name="([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(perms, ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.CAMERA', 'android.permission.INTERNET']);
  assert.ok(!/BACKGROUND_LOCATION|EXTERNAL_STORAGE|READ_MEDIA|RECORD_AUDIO/.test(mf)); assert.match(mf, /allowBackup="false"/); assert.match(mf, /usesCleartextTraffic="false"/);
  assert.match(gr, /versionCode 42/); assert.match(gr, new RegExp('versionName "' + require('../package.json').version.replace(/\./g, '\\.') + '"')); assert.ok(!gr.includes('signingConfigs'));
  r = run(d, 'patch-android.js', [], { GITHUB_RUN_NUMBER: '43', KEYSTORE_PATH: '/k.jks', KEYSTORE_PASSWORD: 'p', KEY_ALIAS: 'fa', KEY_PASSWORD: 'p', HOME: d }); assert.equal(r.status, 0, r.stderr);
  const g2 = fs.readFileSync(path.join(d, 'android/app/build.gradle'), 'utf8'); assert.match(g2, /versionCode 43/); assert.match(g2, /signingConfigs \{ release/); assert.equal(g2.split('signingConfigs { release').length, 2);
  run(d, 'patch-android.js', [], { GITHUB_RUN_NUMBER: '44', KEYSTORE_PATH: '/k.jks', HOME: d }); assert.equal(fs.readFileSync(path.join(d, 'android/app/build.gradle'), 'utf8').split('signingConfigs { release').length, 2);   // idempotent
});
test('target API and Java: Capacitor 8 (API 36) and Java 21 in the workflow', () => {
  const pkg = require('../package.json'); for (const k of Object.keys(pkg.dependencies).filter(k => k.startsWith('@capacitor/'))) assert.match(pkg.dependencies[k], /^\^8\./, k);
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/build-apk.yml'), 'utf8'); assert.match(wf, /java-version: 21/); assert.match(wf, /node-version: 22/);
  const v = path.join(ROOT, 'node_modules/@capacitor/android/capacitor/build.gradle'); if (fs.existsSync(v)) assert.match(fs.readFileSync(v, 'utf8'), /JavaVersion\.VERSION_21/);
});
test('server url script keeps privacy / terms links and validates them; workflow can read the url back', () => {
  const d = sandbox(); let r = run(d, 'set-server-url.js', ['https://script.google.com/macros/s/ABC/exec/'], { PRIVACY_URL: 'https://x.github.io/app/privacy-policy.html' }); assert.equal(r.status, 0, r.stderr);
  const cfg = () => fs.readFileSync(path.join(d, 'www/config.js'), 'utf8'); assert.match(cfg(), /"SERVER_URL":"https:\/\/script\.google\.com\/macros\/s\/ABC\/exec"/); assert.match(cfg(), /"PRIVACY_URL":"https:\/\/x\.github\.io/);
  run(d, 'set-server-url.js', ['https://script.google.com/macros/s/DEF/exec']); assert.match(cfg(), /DEF/); assert.match(cfg(), /privacy-policy\.html/);   // earlier link kept
  const m = cfg().match(/"?SERVER_URL"?:\s*"([^"]+)"/); assert.ok(m && m[1].endsWith('DEF/exec'));                                              // same regex as the workflow
  assert.notEqual(run(d, 'set-server-url.js', ['http://insecure.example/exec']).status, 0); assert.notEqual(run(d, 'set-server-url.js', ['https://a.b/exec'], { TERMS_URL: 'javascript:alert(1)' }).status, 0);
});
test('legal pages: placeholders are filled and escaped; policy covers camera, location, deletion; deletion page has the in-app path', () => {
  const d = sandbox(); assert.notEqual(run(d, 'fill-legal.js', ['Only Name']).status, 0);
  const r = run(d, 'fill-legal.js', ['Demo & Sons <Pvt>', 'help@demo.example', '1 Main Road, Pune', 'Pune']); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /no placeholders left/);
  const pp = fs.readFileSync(path.join(d, 'docs/privacy-policy.html'), 'utf8'), del = fs.readFileSync(path.join(d, 'docs/delete-account.html'), 'utf8'), tm = fs.readFileSync(path.join(d, 'docs/terms.html'), 'utf8');
  assert.ok(pp.includes('Demo &amp; Sons &lt;Pvt&gt;') && !pp.includes('<Pvt>')); assert.ok(tm.includes('courts at Pune'));
  for (const w of ['front camera', 'Precise location', 'background', 'does not contain advertising', 'delete-account.html', 'help@demo.example', '30 days']) assert.ok(pp.includes(w), w);
  assert.match(del, /<b>Company<\/b> tab/); assert.match(del, /Delete company account and data/); assert.match(del, /help@demo\.example/);
});
test('Play Store pack is complete: graphics have the right sizes, listing text within limits', () => {
  const PNG = (f) => { const b = fs.readFileSync(path.join(ROOT, 'play-store/graphics', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(PNG('app-icon-512.png'), [512, 512]); assert.deepEqual(PNG('feature-graphic-1024x500.png'), [1024, 500]);
  for (const f of ['1-sign-in.png', '3-dashboard.png', '4-employees.png', '5-location-photos.png', '6-reports.png', '7-employee-home.png']) assert.deepEqual(PNG(f), [1080, 1920], f);
  const L = fs.readFileSync(path.join(ROOT, 'play-store/LISTING.md'), 'utf8'), name = /App name \(max 30\):\*\* `([^`]+)`/.exec(L)[1], short = /Short description \(max 80\):\*\*\n`([^`]+)`/.exec(L)[1], full = /Full description \(max 4000\):\*\*\n```\n([\s\S]*?)```/.exec(L)[1];
  assert.ok(name.length <= 30, name.length); assert.ok(short.length <= 80, short.length); assert.ok(full.length <= 4000 && full.length > 800, full.length);
});
