// DAME tile-upload: the request handler, shared by the Edge Function (index.ts, GitHub as the store) and the local
// test harness (dev/test/mock-supabase.mjs, a folder as the store).
//
// POST ?tile=<id>&action=<action> with the caller's own session (Authorization: Bearer <access token>, apikey) and a
// multipart/form-data body:
//   action=upload    paths (JSON array), file (one per path)  -> converts, writes dame-hub/<tile>/_next/
//   action=live      release                                  -> the preview replaces dame-hub/<tile>/
//   action=discard                                            -> deletes dame-hub/<tile>/_next/
//   action=rollback  release                                  -> dame-hub/<tile>/ as it was when that release was live
//   action=remove                                             -> deletes dame-hub/<tile>/ (super user only; before a tile is deleted)
// Every action asks the database first (core_upload_check: signed in, approved, manager of an uploaded tile), before
// the body is even read; then changes the files; then records it (core_upload_*). The database never holds the files.

import { convertTool, LIMITS, type InFile, type Note, type Fetcher } from './convert.ts';

export interface Store {
  // fresh: the tile has no release yet, so a folder of that name in the repo is someone else's: refuse to touch it.
  writePreview(tile: string, files: InFile[], fresh: boolean): Promise<string>;  // each returns the new commit
  makeLive(tile: string): Promise<string>;
  discard(tile: string): Promise<string>;
  rollback(tile: string, liveCommit: string): Promise<string>;
  remove(tile: string): Promise<string>;
}
export type Env = { supabaseUrl: string; store: Store; fetcher: Fetcher; origins: string[] };

export class Fail extends Error {
  code: string; status: number; notes?: Note[];
  constructor(code: string, message: string, status = 400, notes?: Note[]) { super(message); this.code = code; this.status = status; this.notes = notes; }
}

const RESERVED = ['dame-hub', 'assets', 'core', 'db', 'demo', 'dev', 'docs', 'tools', 'supabase', 'node_modules'];

function cors(origin: string | null, env: Env): Record<string, string> {
  const h: Record<string, string> = { 'Vary': 'Origin' };
  if (origin && env.origins.indexOf(origin) >= 0) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
function reply(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// The database, with the caller's own session: the functions decide, as for any page.
async function rpc(env: Env, req: Request, name: string, params: Record<string, unknown>): Promise<any> {
  const auth = req.headers.get('authorization') || '';
  const apikey = req.headers.get('apikey') || '';
  if (!/^Bearer\s+\S+$/.test(auth) || !apikey) throw new Fail('SIGNED_OUT', 'Please sign in again.', 401);
  let res: Response;
  try {
    res = await fetch(env.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { 'Authorization': auth, 'apikey': apikey, 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  } catch (_e) { throw new Fail('NETWORK', 'The database cannot be reached. Try again.', 502); }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch (_e) { body = { message: text }; }
  if (!res.ok) {
    const msg = String(body && body.message || '');
    if (/^(SIGNED_OUT|NOT_APPROVED|NO_ACCESS|NO_RIGHT|NOT_FOUND|INVALID:[a-z_]+)$/.test(msg)) throw new Fail(msg, msg, res.status === 401 ? 401 : 403);
    if (res.status === 401 || res.status === 403) throw new Fail('SIGNED_OUT', 'Please sign in again.', 401);
    throw new Fail('SERVER', msg || 'The database refused the request.', 502);
  }
  return body;
}

async function readUpload(form: FormData): Promise<InFile[]> {
  let paths: unknown;
  try { paths = JSON.parse(String(form.get('paths') || '[]')); } catch (_e) { throw new Fail('INVALID:paths', 'The file list is not readable.'); }
  const files = form.getAll('file');
  if (!Array.isArray(paths) || paths.length !== files.length || !files.length) throw new Fail('INVALID:paths', 'No files, or the file list does not match the files.');
  if (files.length > LIMITS.files) throw new Fail('TOO_BIG', 'Too many files (at most ' + LIMITS.files + ').', 413);
  let total = 0;
  const out: InFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (typeof f === 'string' || typeof paths[i] !== 'string') throw new Fail('INVALID:paths', 'The file list does not match the files.');
    total += (f as Blob).size;
    if (total > LIMITS.totalBytes) throw new Fail('TOO_BIG', 'The upload is too big (more than 20 MB).', 413);
    out.push({ path: paths[i] as string, bytes: new Uint8Array(await (f as Blob).arrayBuffer()) });
  }
  return out;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('origin');
  const h = cors(origin, env);
  if (origin && env.origins.indexOf(origin) < 0) return reply(403, { ok: false, code: 'ORIGIN', message: 'Not allowed from this address.' }, h);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return reply(405, { ok: false, code: 'METHOD', message: 'POST only.' }, h);
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';
    const tile = url.searchParams.get('tile') || '';
    if (['upload', 'live', 'discard', 'rollback', 'remove'].indexOf(action) < 0) throw new Fail('INVALID:action', 'Unknown action.');
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(tile) || RESERVED.indexOf(tile) >= 0) throw new Fail('INVALID:id', 'Not a tile id.');
    const check = await rpc(env, req, 'core_upload_check', { p_tile: tile });   // nothing is read before this passes
    const length = Number(req.headers.get('content-length') || 0);
    if (length > LIMITS.totalBytes + 2 * 1024 * 1024) throw new Fail('TOO_BIG', 'The upload is too big (more than 20 MB).', 413);
    let form: FormData;
    try { form = await req.formData(); } catch (_e) { throw new Fail('INVALID:form', 'The request is not readable.'); }
    const releaseNo = Number(form.get('release') || 0);

    if (action === 'upload') {
      const input = await readUpload(form);
      const conv = await convertTool(input, { tile, supabaseUrl: env.supabaseUrl, fetcher: env.fetcher });
      if (!conv.ok) throw new Fail('CONVERT', 'The files need a change before they can go up. See the list below.', 422, conv.notes);
      const bytes = conv.files.reduce((s, f) => s + f.bytes.length, 0);
      const commit = await env.store.writePreview(tile, conv.files, !check.live && !check.preview);
      const release = await rpc(env, req, 'core_upload_preview',
        { p_tile: tile, p_commit: commit, p_files: conv.files.length, p_bytes: bytes, p_report: conv.notes });
      return reply(200, { ok: true, release, notes: conv.notes, preview: '/dame-hub/' + tile + '/_next/' }, h);
    }
    if (action === 'live') {
      if (!check.preview) throw new Fail('NOT_FOUND', 'There is no preview to make live.', 404);
      if (releaseNo && releaseNo !== check.preview.id) throw new Fail('CONFLICT', 'A newer upload arrived meanwhile. Reload the page and check it first.', 409);
      const commit = await env.store.makeLive(tile);
      const release = await rpc(env, req, 'core_upload_live', { p_tile: tile, p_release: check.preview.id, p_commit: commit });
      return reply(200, { ok: true, release }, h);
    }
    if (action === 'discard') {
      if (!check.preview) throw new Fail('NOT_FOUND', 'There is no preview to discard.', 404);
      const commit = await env.store.discard(tile);
      const release = await rpc(env, req, 'core_upload_discard', { p_tile: tile, p_commit: commit });
      return reply(200, { ok: true, release }, h);
    }
    if (action === 'remove') {
      if (!check.is_super) throw new Fail('NO_RIGHT', 'NO_RIGHT', 403);
      const commit = await env.store.remove(tile);
      return reply(200, { ok: true, commit }, h);
    }
    if (action === 'rollback') {
      const list: any[] = await rpc(env, req, 'core_upload_list', { p_tile: tile });
      const target = (list || []).find((r) => r && r.id === releaseNo && r.status === 'old' && r.live_commit);
      if (!target) throw new Fail('NOT_FOUND', 'That version cannot be restored.', 404);
      const commit = await env.store.rollback(tile, target.live_commit);
      const release = await rpc(env, req, 'core_upload_rollback', { p_tile: tile, p_release: target.id, p_commit: commit });
      return reply(200, { ok: true, release }, h);
    }
    throw new Fail('INVALID:action', 'Unknown action.');
  } catch (e) {
    if (e instanceof Fail) return reply(e.status, { ok: false, code: e.code, message: e.message, notes: e.notes || [] }, h);
    console.error('tile-upload', e);
    return reply(500, { ok: false, code: 'SERVER', message: 'Something went wrong while writing the files. Nothing was recorded; try again.' }, h);
  }
}
