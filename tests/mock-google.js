'use strict';
// In-memory fake of the Apps Script services used by apps-script/Code.gs (SpreadsheetApp, DriveApp, PropertiesService, CacheService, LockService ...).
// It imitates ONE behaviour of real Sheets that matters here: setValues() converts text that looks like a date / time / number / TRUE-FALSE / formula
// unless the text starts with an apostrophe - so a missing apostrophe in Code.gs is caught by the tests.
// This tests OUR logic; it cannot prove real Google behaves identically.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function coerce(x) {   // what Sheets does with a value written by setValues()
  if (typeof x !== 'string') return x;
  if (x.startsWith("'")) return x.slice(1);
  if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x);
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(x) || /^\d{1,2}:\d{2}$/.test(x)) return new Date(1);   // becomes a date / time cell
  if (/^(true|false)$/i.test(x)) return x.toLowerCase() === 'true';
  if (x.startsWith('=')) return '#NAME?';
  return x;
}
class Sheet {
  constructor(name, log) { this.name = name; this.g = []; this.log = log; this.maxRows = 1000; }
  _ensure(r, c) { while (this.g.length < r) this.g.push([]); for (let i = 0; i < r; i++) while (this.g[i].length < c) this.g[i].push(''); }
  getLastRow() { let n = 0; this.g.forEach((r, i) => { if (r.some(v => v !== '' && v != null)) n = i + 1; }); return n; }
  getMaxRows() { return Math.max(this.maxRows, this.g.length); }
  insertRowsAfter(_, n) { this.maxRows = this.getMaxRows() + n; }
  setName(n) { this.name = n; return this; }
  setFrozenRows() { return this; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    if (r + nr - 1 > s.getMaxRows()) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return {
      getValues: () => { s.log.push('getValues'); s._ensure(r + nr - 1, c + nc - 1); return Array.from({ length: nr }, (_, i) => s.g[r - 1 + i].slice(c - 1, c - 1 + nc)); },
      setValues: (v) => {
        if (v.length !== nr || v.some(row => row.length !== nc)) throw new Error('The number of rows/columns in the data does not match the range.');
        s._ensure(r + nr - 1, c + nc - 1); v.forEach((row, i) => row.forEach((x, j) => { s.g[r - 1 + i][c - 1 + j] = coerce(x); }));
      },
    };
  }
}
class Spreadsheet {
  constructor(id, title, log) { this.id = id; this.title = title; this.log = log; this.order = [new Sheet('Sheet1', log)]; }
  get tabs() { return Object.fromEntries(this.order.map(s => [s.name, s])); }
  getId() { return this.id; }
  getSheets() { return this.order; }
  getSheetByName(n) { return this.order.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n, this.log); this.order.push(s); return s; }
  setSpreadsheetTimeZone() {}
}

function makeEnv() {
  const props = { OWNER_PASSWORD: 'owner-pass-1' }, cache = {}, log = [];
  const store = { n: 0, filesById: {}, sheetsById: {}, failDrive: false }, registry = {}; let ssCounter = 0;
  const notFound = () => new Error('No item with the given ID could be found, or you do not have permission to access it.');
  const folder = (id) => ({
    getId: () => id,
    createFolder: (name) => newFolder(name, id),
    createFile: (blob) => {
      const fid = 'FILE' + String(++store.n).padStart(14, '0');
      store.filesById[fid] = { id: fid, name: blob.getName(), parents: [id], bytes: Buffer.from(blob.getBytes().map(x => (x + 256) % 256)), trashed: false, mime: blob.getContentType() };
      return file(fid);
    },
    setSharing: (access, perm) => { store.filesById[id].sharing = access + ':' + perm; },
    setTrashed: (t) => { store.filesById[id].trashed = t; },
  });
  function newFolder(name, parent) {
    if (store.failDrive) throw new Error('Drive is temporarily unavailable');
    const id = 'FOLDER' + String(++store.n).padStart(14, '0');
    store.filesById[id] = { id, name, parents: parent ? [parent] : [], folder: true, trashed: false, sharing: null }; return folder(id);
  }
  function file(id) {
    const rec = store.filesById[id]; if (!rec || rec.folder) throw notFound();
    return {
      getId: () => id, getName: () => rec.name, setTrashed: (t) => { rec.trashed = t; },
      getParents: () => { const ps = rec.parents.slice(); return { hasNext: () => ps.length > 0, next: () => folder(ps.shift()) }; },
      getBlob: () => ({ getBytes: () => Array.from(rec.bytes).map(b => (b << 24) >> 24) }),
      moveTo: (f) => { rec.parents = [f.getId()]; },
    };
  }
  const env = {
    console,
    SpreadsheetApp: {
      create: (title) => { const id = 'SS' + String(++ssCounter).padStart(14, '0'), ss = new Spreadsheet(id, title, log); store.sheetsById[id] = ss; if (!registry.ss) registry.ss = ss; return ss; },
      openById: (id) => { const ss = store.sheetsById[id]; if (!ss) throw notFound(); return ss; },
      flush: () => {},
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
      getRootFolder: () => ({}), createFolder: (name) => newFolder(name, null),
      getFolderById: (id) => { const r = store.filesById[id]; if (!r || !r.folder) throw notFound(); return folder(id); },
      getFileById: (id) => file(id),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ getContent: () => s, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      formatDate: (d, tz, f) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
        return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('hh', p.hour).replace('mm', p.minute).replace(' a', '');
      },
      getUuid: () => crypto.randomUUID(),
      base64Encode: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => (b + 256) % 256))).toString('base64'),
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map(b => (b << 24) >> 24),
      newBlob: (bytes, mime, name) => ({ getBytes: () => bytes, getName: () => name, getContentType: () => mime }),
      computeDigest: (_, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map(b => (b << 24) >> 24),
    },
  };
  return { env, props, cache, log, store, sheetsById: store.sheetsById, filesById: store.filesById, registry };
}
function load() {
  const E = makeEnv(), ctx = vm.createContext(E.env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + '\n;this.__x={doGet,doPost,setup,ATT_H,EMP_H,CO_H,ymd_,addDays_};', ctx);
  const x = ctx.__x;
  const api = (body) => JSON.parse(x.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return Object.assign(E, { x, api, ctx });
}
module.exports = { load, makeEnv };
