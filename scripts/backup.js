// Consistent online backup of the SQLite DB; keeps the newest KEEP files.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;

(async () => {
  fs.mkdirSync(dest, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dest, `nfl-pickem-${stamp}.db`);
  const db = new Database(path.join(root, 'nfl-pickem.db'), { readonly: true });
  await db.backup(file);
  db.close();
  console.log(`Backup written: ${file}`);

  const old = fs.readdirSync(dest)
    .filter(f => /^nfl-pickem-\d{4}-.*\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.unlinkSync(path.join(dest, f));
})().catch(e => { console.error(e); process.exit(1); });
