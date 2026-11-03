'use strict';
// Browser-only demo: runs the real server.js inside a service worker, with SQLite (sql.js, WebAssembly) as the
// database and IndexedDB to keep the data between visits. Used on static hosting such as GitHub Pages, where no
// Node.js server exists. Every visitor gets their own demo data, in their own browser only.
/* global initSqlJs */
importScripts('vendor/sql-wasm.js');

const SCOPE = new URL(self.registration.scope);
const ROUTED = /^(api\/|photo\/|feed)/;

// ---------- small IndexedDB key-value store ----------
const idb = {
  open() {
    return new Promise((ok, fail) => {
      const r = indexedDB.open('saakshi-demo', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
  },
  async get(k) { const db = await idb.open(); return new Promise((ok) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); }); },
  async set(k, v) { const db = await idb.open(); return new Promise((ok) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); },
  async clear() { const db = await idb.open(); return new Promise((ok) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = ok; t.onerror = ok; }); },
};

// ---------- Node.js shims: just what server.js uses ----------
const enc = new TextEncoder(), dec = new TextDecoder();
class Buf extends Uint8Array {
  static from(x, encoding) {
    if (typeof x === 'string') {
      if (encoding === 'base64') { const s = atob(x); const b = new Buf(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
      if (encoding === 'hex') { const b = new Buf(x.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(x.substr(i * 2, 2), 16); return b; }
      const u = enc.encode(x); const b = new Buf(u.length); b.set(u); return b;
    }
    const b = new Buf(x.length); b.set(x); return b;
  }
  static isBuffer(x) { return x instanceof Buf; }
  static concat(list) { const b = new Buf(list.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of list) { b.set(x, o); o += x.length; } return b; }
  toString(encoding) {
    if (encoding === 'hex') return Array.from(this, (v) => v.toString(16).padStart(2, '0')).join('');
    if (encoding === 'base64') { let s = ''; for (const v of this) s += String.fromCharCode(v); return btoa(s); }
    return dec.decode(this);
  }
}
// SHA-256 (synchronous; Web Crypto is async only)
function sha256(bytes) {
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const w = new Uint32Array(64);
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) >>> 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Buf(32); const ov = new DataView(out.buffer); H.forEach((v, i) => ov.setUint32(i * 4, v)); return out;
}
const toBytes = (x) => (typeof x === 'string' ? Buf.from(x) : x);
const cryptoShim = {
  randomBytes(n) { const b = new Buf(n); crypto.getRandomValues(b); return b; },
  randomInt(min, max) { return min + Math.floor(Math.random() * (max - min)); },
  createHash() { const parts = []; return { update(x) { parts.push(toBytes(x)); return this; }, digest(e) { const h = sha256(Buf.concat(parts)); return e ? h.toString(e) : h; } }; },
  scryptSync(pin, salt) { return sha256(Buf.from(salt + ':' + pin)); }, // demo only: PINs never leave this browser
  timingSafeEqual(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); },
};
const files = new Map(); // photos
const fsShim = {
  mkdirSync() {}, existsSync: (p) => files.has(p), writeFileSync: (p, d) => { files.set(p, Buf.from(d)); dirty = true; },
  readFileSync: (p) => { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p); },
  statSync: (p) => ({ isFile: () => files.has(p) }), readdirSync: () => [],
};
const pathShim = {
  sep: '/',
  join: (...a) => a.join('/').replace(/\/+/g, '/'),
  resolve: (...a) => { let p = ''; for (const x of a) p = x.startsWith('/') ? x : p + '/' + x; return p.replace(/\/+/g, '/').replace(/\/$/, '') || '/'; },
  extname: (p) => (p.match(/\.[^./]+$/) || [''])[0],
};

// ---------- node:sqlite on top of sql.js ----------
let SQL, sqlDb, dirty = false;
class DatabaseSync {
  constructor() { this.db = sqlDb; }
  exec(sql) { this.db.exec(sql); if (!/^\s*(BEGIN|SELECT|PRAGMA)/i.test(sql)) dirty = true; }
  prepare(sql) {
    const db = this.db;
    const norm = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
    const rows = (args, one) => {
      const st = db.prepare(sql); const out = [];
      try { st.bind(norm(args)); while (st.step()) { out.push(st.getAsObject()); if (one) break; } } finally { st.free(); }
      return out;
    };
    return {
      run(...args) { db.run(sql, norm(args)); dirty = true; return { changes: db.getRowsModified(), lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0].values[0][0] }; },
      get(...args) { return rows(args, true)[0]; },
      all(...args) { return rows(args, false); },
    };
  }
  close() {}
}

// ---------- load server.js with those shims ----------
let handler = null, session = null;
const ready = (async () => {
  SQL = await initSqlJs({ locateFile: (f) => new URL('vendor/' + f, SCOPE).href });
  const saved = await idb.get('db');
  sqlDb = saved ? new SQL.Database(saved) : new SQL.Database();
  const photos = await idb.get('photos');
  if (photos) for (const [k, v] of photos) files.set(k, Buf.from(v));
  session = (await idb.get('session')) || null;
  const src = await (await fetch(new URL('../server.js', SCOPE))).text();
  const mods = { http: { createServer: (h) => { handler = h; return { listen: (p, cb) => cb && cb() }; } }, fs: fsShim, path: pathShim, crypto: cryptoShim, sqlite: { DatabaseSync } };
  const req = (name) => { const m = mods[name.replace(/^node:/, '')]; if (!m) throw new Error('demo: no module ' + name); return m; };
  const proc = { env: { QUIET: '1', DATA_DIR: '/data' }, argv: ['node', 'server.js', '--demo'], removeAllListeners() {} };
  const timer = (fn, ms) => { const id = setInterval(fn, ms); return { unref() {}, id }; };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', 'Buffer', '__dirname', 'setInterval', 'console', src)(req, module, module.exports, proc, Buf, '/app', timer, { log() {}, error: console.error });
  await persist(true);
})();

async function persist(force) {
  if (!dirty && !force) return;
  dirty = false;
  await idb.set('db', sqlDb.export());
  await idb.set('photos', [...files.entries()].map(([k, v]) => [k, new Uint8Array(v)]));
}

// one request at a time through the server, so the single SQLite connection is never interleaved
let queue = Promise.resolve();
function serve(request, path) {
  const run = async () => {
    await ready;
    const body = request.method === 'GET' || request.method === 'HEAD' ? new Buf(0) : Buf.from(new Uint8Array(await request.arrayBuffer()));
    const headers = Object.fromEntries(request.headers.entries());
    if (session) headers.cookie = 'ss_token=' + session;
    const req = { method: request.method, url: path, headers, socket: {}, destroy() {},
      on(ev, fn) { if (ev === 'data' && body.length) queueMicrotask(() => fn(body)); if (ev === 'end') setTimeout(fn, 0); return req; } };
    const res = await new Promise((resolve) => {
      const r = { headersSent: false, status: 200, headers: {},
        writeHead(s, h) { r.status = s; r.headers = h || {}; r.headersSent = true; },
        end(d) { resolve({ status: r.status, headers: r.headers, body: d }); } };
      handler(req, r);
    });
    const sc = res.headers['Set-Cookie'];
    if (sc) { const m = /ss_token=([a-f0-9]*)/.exec(sc); session = m && m[1] ? m[1] : null; await idb.set('session', session); delete res.headers['Set-Cookie']; }
    if (request.method !== 'GET') await persist();
    else persist();
    return new Response(res.body == null ? null : res.body instanceof Uint8Array ? res.body : String(res.body), { status: res.status, headers: res.headers });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  if (e.data === 'reset') e.waitUntil(idb.clear().then(() => e.source && e.source.postMessage('reset-done')));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const rel = url.pathname.slice(SCOPE.pathname.length);
  if (!ROUTED.test(rel)) return;
  e.respondWith(serve(e.request, '/' + rel + url.search).catch((err) => new Response(JSON.stringify({ error: 'डेमो में गड़बड़ी: ' + err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
});
