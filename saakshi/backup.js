'use strict';
// Daily backup: a consistent copy of the database plus every photo not yet backed up.
//   node backup.js [backup-folder]      (default: DATA_DIR/backups)
// Inside Docker: docker compose exec app node backup.js
process.removeAllListeners('warning');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const out = path.resolve(process.argv[2] || path.join(DATA_DIR, 'backups'));
const stamp = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
fs.mkdirSync(path.join(out, 'photos'), { recursive: true });
const target = path.join(out, `saakshi-${stamp}.db`);
const db = new DatabaseSync(path.join(DATA_DIR, 'saakshi.db'));
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
let copied = 0;
const src = path.join(DATA_DIR, 'photos');
if (fs.existsSync(src)) for (const f of fs.readdirSync(src)) {
  const dst = path.join(out, 'photos', f);
  if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(src, f), dst); copied++; }
}
// keep the last 30 database copies
const dbs = fs.readdirSync(out).filter((f) => /^saakshi-.*\.db$/.test(f)).sort();
for (const f of dbs.slice(0, Math.max(0, dbs.length - 30))) fs.unlinkSync(path.join(out, f));
console.log(`Backup: ${target} (+${copied} new photos)`);
