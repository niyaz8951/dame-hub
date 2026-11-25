// DAME tile-upload, the Supabase Edge Function (docs/RUNBOOK.md, "Uploaded tiles: set up once").
// Writes an uploaded tile's files into the admin repo through the GitHub API; the database records each release.
//
// Secrets (Supabase > Edge Functions > Secrets; the owner sets them, nobody else sees them):
//   DAME_GITHUB_TOKEN   fine-grained token: only the admin repo, Contents read and write. Never in code or chat.
//   DAME_GITHUB_REPO    <account>/dame-hub (listed in docs/MOVE-ACCOUNT.md)
//   DAME_SITE_ORIGINS   https://<account>.github.io  (comma-separated; add http://localhost:8080 for local tests)
//   DAME_GITHUB_BRANCH  optional, default main
// SUPABASE_URL is set by Supabase. "Verify JWT" is off for this function: the database checks the session itself
// (handler.ts asks core_upload_check with the caller's own token before anything is read or written).

import { handle, Fail, type Store } from './handler.ts';
import { LIMITS, type InFile, type Fetched } from './convert.ts';

const TOKEN = Deno.env.get('DAME_GITHUB_TOKEN') || '';
const REPO = Deno.env.get('DAME_GITHUB_REPO') || '';
const BRANCH = Deno.env.get('DAME_GITHUB_BRANCH') || 'main';
const ORIGINS = (Deno.env.get('DAME_SITE_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';

type Entry = { path: string; mode: string; type: string; sha?: string | null; content?: string };

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
function utf8(bytes: Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_e) { return null; }
}

class GitHubStore implements Store {
  private async gh(method: string, path: string, body?: unknown): Promise<any> {
    if (!TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(REPO)) throw new Fail('SETUP', 'Uploads are not set up yet (GitHub token or repo missing). Tell the site owner.', 503);
    const res = await fetch('https://api.github.com/repos/' + REPO + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dame-tile-upload', 'Content-Type': 'application/json' } });
    const text = await res.text();
    let j: any = null; try { j = text ? JSON.parse(text) : null; } catch (_e) { j = { message: text }; }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Fail('GITHUB', 'GitHub refused the token (expired, or no write access to the repo). Tell the site owner.', 503);
      const err = new Fail('GITHUB', 'GitHub: ' + String(j && j.message || res.status).slice(0, 200), 502);
      (err as any).gh = res.status;
      throw err;
    }
    return j;
  }
  private async head(): Promise<{ commit: string; tree: string }> {
    const ref = await this.gh('GET', '/git/ref/heads/' + BRANCH);
    const c = await this.gh('GET', '/git/commits/' + ref.object.sha);
    return { commit: ref.object.sha, tree: c.tree.sha };
  }
  private async entries(tree: string): Promise<Entry[]> {
    const t = await this.gh('GET', '/git/trees/' + tree);
    if (t.truncated) throw new Fail('GITHUB', 'The folder is too large to read in one go.', 502);
    return (t.tree || []).map((e: any) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha }));
  }
  private async tree(entries: Entry[], baseTree?: string): Promise<string> {
    const t = await this.gh('POST', '/git/trees', baseTree ? { base_tree: baseTree, tree: entries } : { tree: entries });
    return t.sha;
  }
  // Builds the tree of a folder from files (paths relative to it), deepest folders first.
  private async build(files: InFile[]): Promise<string> {
    const blobs = new Map<string, Entry>();
    let binaries = 0;
    for (const f of files) {
      const text = utf8(f.bytes);
      if (text !== null && f.bytes.length <= 1024 * 1024) blobs.set(f.path, { path: f.path, mode: '100644', type: 'blob', content: text });
      else {
        if (++binaries > 120) throw new Fail('TOO_BIG', 'Too many images and other binary files in one upload (at most 120).', 413);
        const b = await this.gh('POST', '/git/blobs', { content: b64(f.bytes), encoding: 'base64' });
        blobs.set(f.path, { path: f.path, mode: '100644', type: 'blob', sha: b.sha });
      }
    }
    const dirOf = (p: string) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));
    const dirs = new Set<string>(['']);
    for (const p of blobs.keys()) { let d = dirOf(p); while (d) { dirs.add(d); d = dirOf(d); } }
    const order = Array.from(dirs).sort((a, b) => b.split('/').length - a.split('/').length || (b > a ? 1 : -1));
    const made = new Map<string, string>();
    for (const d of order) {
      const pre = d ? d + '/' : '';
      const list: Entry[] = [];
      for (const [p, e] of blobs) if (dirOf(p) === d) list.push({ ...e, path: p.slice(pre.length) });
      for (const [sub, sha] of made) if (dirOf(sub) === d && sub !== d) list.push({ path: sub.slice(pre.length), mode: '040000', type: 'tree', sha });
      made.set(d, await this.tree(list));
    }
    return made.get('')!;
  }
  // Applies one change to the folder of the tile on a fresh head; retried when someone pushed meanwhile.
  private async change(tile: string, message: string, fn: (tileEntries: Entry[] | null, head: { commit: string; tree: string }) => Promise<string | null>): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await this.head();
      const root = await this.entries(head.tree);
      const own = root.find((e) => e.path === tile);
      if (own && own.type !== 'tree') throw new Fail('GITHUB', 'A file with the tile\'s name is in the way in the repo.', 409);
      const tileEntries = own ? await this.entries(own.sha!) : null;
      const newTile = await fn(tileEntries, head);
      const rootTree = await this.tree([{ path: tile, mode: '040000', type: 'tree', sha: newTile }], head.tree);
      const commit = await this.gh('POST', '/git/commits', { message, tree: rootTree, parents: [head.commit] });
      try {
        await this.gh('PATCH', '/git/refs/heads/' + BRANCH, { sha: commit.sha, force: false });
        return commit.sha;
      } catch (e) {
        if ((e as any).gh === 422 || (e as any).gh === 409) continue;   // not a fast-forward: someone pushed; start again
        throw e;
      }
    }
    throw new Fail('BUSY', 'The repo changed several times meanwhile. Try again in a minute.', 409);
  }

  async writePreview(tile: string, files: InFile[], fresh: boolean): Promise<string> {
    const next = await this.build(files);   // blobs and trees first: they do not depend on the head
    return this.change(tile, tile + ': new preview (' + files.length + ' files)', async (own) => {
      if (fresh && own && own.some((e) => e.path !== '_next')) throw new Fail('FOLDER_TAKEN', 'The repo already has a folder named ' + tile + ' that was not uploaded here. The site owner must move it first.', 409);
      const keep = (own || []).filter((e) => e.path !== '_next');
      return this.tree([...keep, { path: '_next', mode: '040000', type: 'tree', sha: next }]);
    });
  }
  async makeLive(tile: string): Promise<string> {
    return this.change(tile, tile + ': make the preview live', async (own) => {
      const next = (own || []).find((e) => e.path === '_next' && e.type === 'tree');
      if (!next) throw new Fail('NOT_FOUND', 'The preview folder is not in the repo any more. Upload again.', 404);
      return next.sha!;
    });
  }
  async discard(tile: string): Promise<string> {
    return this.change(tile, tile + ': discard the preview', async (own) => {
      const keep = (own || []).filter((e) => e.path !== '_next');
      return keep.length ? this.tree(keep) : null;   // null: the tile folder goes (nothing was live)
    });
  }
  async rollback(tile: string, liveCommit: string): Promise<string> {
    if (!/^[0-9a-f]{40}$/.test(liveCommit)) throw new Fail('NOT_FOUND', 'That version cannot be restored.', 404);
    const c = await this.gh('GET', '/git/commits/' + liveCommit);
    const old = (await this.entries(c.tree.sha)).find((e) => e.path === tile && e.type === 'tree');
    if (!old) throw new Fail('NOT_FOUND', 'That version is not in the repo history.', 404);
    return this.change(tile, tile + ': restore an earlier version', async () => old.sha!);
  }
}

// Outside files (CDN scripts, style sheets, fonts, images) for convert.ts: https only, size-capped, 10 s each.
async function fetcher(url: string): Promise<Fetched> {
  const none = (status: number): Fetched => ({ ok: false, status, bytes: new Uint8Array(0), type: '' });
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } });
  if (!res.ok || !res.body || Number(res.headers.get('content-length') || 0) > LIMITS.downloadBytes) { await res.body?.cancel(); return none(res.ok ? 413 : res.status); }
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {                                  // read with a cap: a server may not say the size
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIMITS.downloadBytes) { await reader.cancel(); return none(413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0; for (const p of parts) { bytes.set(p, at); at += p.length; }
  return { ok: true, status: res.status, bytes, type: (res.headers.get('content-type') || '').toLowerCase() };
}

const store = new GitHubStore();
Deno.serve((req: Request) => handle(req, { supabaseUrl: SUPABASE_URL, store, fetcher, origins: ORIGINS }));
