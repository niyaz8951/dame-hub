// Checks /dame-hub/lines.json before a push (docs/LINES.md). Run: node dev/lines-check.mjs
// Exit 1 on any error. Prints counts by kind and lines that expire within 30 days.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'lines.json');
const KINDS = { history: 'h', rule: 'r', fact: 'f', quote: 'q', news: 'n' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const errors = [];
let data;
try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('lines.json: ' + e.message); process.exit(1); }
const lines = Array.isArray(data.lines) ? data.lines : (errors.push('no "lines" array'), []);

const ids = new Set(), texts = new Map(), counts = {};
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const today = new Date().toISOString().slice(0, 10);
const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

lines.forEach((l, i) => {
  const at = `#${i + 1} ${l && l.id || '(no id)'}`;
  if (!l || typeof l !== 'object') return errors.push(at + ': not an object');
  const extra = Object.keys(l).filter((k) => !['id', 'kind', 'added', 'expires', 'text', 'by', 'source'].includes(k));
  if (extra.length) errors.push(at + ': unknown field ' + extra.join(', '));
  if (!KINDS[l.kind]) errors.push(at + ': kind must be one of ' + Object.keys(KINDS).join(', '));
  if (typeof l.id !== 'string' || !/^[a-z]\d{3,}$/.test(l.id)) errors.push(at + ': id like h001');
  else if (KINDS[l.kind] && l.id[0] !== KINDS[l.kind]) errors.push(at + ': id must start with "' + KINDS[l.kind] + '" for kind ' + l.kind);
  if (ids.has(l.id)) errors.push(at + ': duplicate id');
  ids.add(l.id);
  if (typeof l.text !== 'string' || !l.text.trim()) errors.push(at + ': text missing');
  else {
    if (l.text.length > 200) errors.push(at + ': text over 200 characters (' + l.text.length + ')');
    if (/[<>]/.test(l.text)) errors.push(at + ': no < or > in text');
    const n = norm(l.text);
    if (texts.has(n)) errors.push(at + ': same text as ' + texts.get(n));
    texts.set(n, l.id);
  }
  if (typeof l.source !== 'string' || !l.source.trim()) errors.push(at + ': source missing (where the fact or quote can be checked)');
  if (l.kind === 'quote' && (typeof l.by !== 'string' || !l.by.trim())) errors.push(at + ': a quote needs "by"');
  if (l.by !== undefined && (typeof l.by !== 'string' || l.by.length > 60)) errors.push(at + ': "by" must be text, 60 characters max');
  if (!DAY.test(l.added || '')) errors.push(at + ': added must be YYYY-MM-DD');
  if (l.expires !== undefined && !DAY.test(l.expires)) errors.push(at + ': expires must be YYYY-MM-DD');
  if (l.kind === 'news' && !l.expires) errors.push(at + ': news needs an expires date');
  counts[l.kind] = (counts[l.kind] || 0) + 1;
});

const live = lines.filter((l) => !l.expires || l.expires >= today).length;
console.log(`lines.json: ${lines.length} lines, ${live} showing today; ` + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', '));
lines.filter((l) => l.expires && l.expires < today).forEach((l) => console.log('  expired (can be removed): ' + l.id));
lines.filter((l) => l.expires && l.expires >= today && l.expires <= soon).forEach((l) => console.log('  expires soon: ' + l.id + ' ' + l.expires));
if (errors.length) { errors.forEach((e) => console.error('ERROR ' + e)); process.exit(1); }
console.log('OK');
