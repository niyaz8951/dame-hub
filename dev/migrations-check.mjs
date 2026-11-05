// Checks a repo's db/migrations.json against its SQL files (docs/TILE-CONTRACT.md, "SQL list").
// Usage: node dev/migrations-check.mjs [repo-or-tile-folder ...]   (default: this repo, demo/ and tools/)
// From a tile repo: node ../dame-hub/dev/migrations-check.mjs .
// Fails when: the list is missing or malformed; a numbered SQL file under db/<schema>/ is not listed; a listed file
// does not exist; the order is not by number; a file's last line is not select core.applied('<repo>', '<name>').
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = process.argv.slice(2).length ? process.argv.slice(2).map((r) => resolve(r)) : [here, join(here, 'demo'), join(here, 'tools')];
let bad = 0;
const fail = (root, msg) => { bad++; console.log('✗ ' + root + ': ' + msg); };

for (const root of roots) {
  const badBefore = bad;
  const listPath = join(root, 'db', 'migrations.json');
  if (!existsSync(listPath)) { fail(root, 'no db/migrations.json'); continue; }
  let list;
  try { list = JSON.parse(readFileSync(listPath, 'utf8')); } catch (e) { fail(root, 'db/migrations.json is not valid JSON: ' + e.message); continue; }
  if (!/^[a-z0-9-]+$/.test(list.repo || '')) { fail(root, 'repo must be the repo or tile id'); continue; }
  if (!Array.isArray(list.files)) { fail(root, 'files must be a list'); continue; }

  // numbered SQL files on disk: db/<schema>/NNN_name.sql (tests.sql and seed-*.sql are not migrations)
  const onDisk = [];
  const dbDir = join(root, 'db');
  for (const schema of readdirSync(dbDir)) {
    const d = join(dbDir, schema);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) if (/^\d{3}_[a-z0-9_]+\.sql$/.test(f)) onDisk.push('db/' + schema + '/' + f);
  }

  const seen = new Set();
  let prev = '';
  list.files.forEach((f, i) => {
    const where = 'files[' + i + ']';
    if (!f || typeof f.name !== 'string' || typeof f.path !== 'string') { fail(root, where + ' needs name and path'); return; }
    if (!/^db\/[a-z0-9_]+\/\d{3}_[a-z0-9_]+\.sql$/.test(f.path)) { fail(root, where + ' path must be db/<schema>/NNN_name.sql'); return; }
    const base = f.path.split('/').pop().replace(/\.sql$/, '');
    if (base !== f.name) fail(root, where + ' name ' + f.name + ' does not match ' + f.path);
    if (seen.has(f.path)) fail(root, where + ' listed twice: ' + f.path);
    seen.add(f.path);
    if (prev && base.slice(0, 3) < prev) fail(root, where + ' out of order: ' + base + ' after ' + prev);
    prev = base.slice(0, 3);
    const file = join(root, f.path);
    if (!existsSync(file)) { fail(root, where + ' file missing: ' + f.path); return; }
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const last = lines[lines.length - 1].trim();
    const want = "select core.applied('" + list.repo + "', '" + f.name + "');";
    if (last !== want) fail(root, f.path + ' must end with ' + want + ' (found: ' + last + ')');
  });
  for (const p of onDisk) if (!seen.has(p)) fail(root, p + ' is not in db/migrations.json');
  if (bad === badBefore) console.log('✓ ' + root + ': ' + list.files.length + ' file(s), repo ' + list.repo);
}
if (bad) { console.log(bad + ' problem(s)'); process.exit(1); }
console.log('migrations OK');
