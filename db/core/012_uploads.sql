-- DAME core 012: uploaded tiles (owner, 2026-11-25: "a tile asks for its files; the team uploads them and the site
-- links them; Replace files when the tool changes; it goes live when an admin presses Make live").
--
--   1. core.tiles.hosting  'repo' (built in its own repo, as before) or 'upload' (files uploaded from the site,
--                          kept in dame-hub/<tile-id>/, served at /dame-hub/<tile-id>/). A kind, never a URL.
--   2. core.tile_releases  one row per upload: preview -> live -> old (or discarded). The files themselves are only
--                          in the repo (owner: "database holds only required data, not repo files"); a row holds
--                          the commit, counts, the conversion report and who did what when.
--   3. core_upload_*       called by the Edge Function tile-upload with the user's own session (the function
--                          commits to GitHub, then records here), and by upload.html to list releases.
--                          Who: the tile's managers (level manage) and the super user.
--
-- Run after 011, in the SQL editor, as one script. Then Admin > Health > Run check now must say Clean.
-- Touches: schema core (column tiles.hosting, table tile_releases), core.require_uploader, public.core_upload_*,
-- public.core_me (tile.hosting), public.core_my_tiles, public.core_admin_tiles, public.core_admin_tile_save (new last argument p_hosting).

-- ---------------------------------------------------------------------------
-- 1. Hosting of a tile
-- ---------------------------------------------------------------------------
alter table core.tiles add column if not exists hosting text not null default 'repo';
alter table core.tiles drop constraint if exists tiles_hosting_check;
alter table core.tiles add constraint tiles_hosting_check check (hosting in ('repo', 'upload'));

-- Folders of dame-hub itself: an uploaded tile may never take one of these names (its files would replace them).
create or replace function core.upload_reserved(p_id text)
returns boolean language sql immutable set search_path = '' as $$
  select p_id in ('dame-hub', 'assets', 'core', 'db', 'demo', 'dev', 'docs', 'tools', 'supabase', 'node_modules');
$$;

-- ---------------------------------------------------------------------------
-- 2. Releases
-- ---------------------------------------------------------------------------
create table if not exists core.tile_releases (
  id          bigint generated always as identity primary key,
  tile_id     text not null references core.tiles (id) on delete cascade,
  status      text not null default 'preview' check (status in ('preview', 'live', 'old', 'discarded')),
  commit_sha  text not null check (commit_sha ~ '^[0-9a-f]{40}$'),           -- the commit that wrote the preview
  live_sha    text check (live_sha ~ '^[0-9a-f]{40}$'),                      -- the last commit that made it live
  files       integer not null check (files between 1 and 500),
  bytes       bigint not null check (bytes >= 0),
  report      jsonb not null default '[]' check (octet_length(report::text) <= 20000),
  uploaded_by uuid references core.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  live_by     uuid references core.profiles (id) on delete set null,
  live_at     timestamptz
);
alter table core.tile_releases enable row level security;
create index if not exists tile_releases_tile_idx on core.tile_releases (tile_id, id desc);
-- At most one preview and one live release per tile.
create unique index if not exists tile_releases_one_preview on core.tile_releases (tile_id) where status = 'preview';
create unique index if not exists tile_releases_one_live on core.tile_releases (tile_id) where status = 'live';

-- The caller, if he may upload to this tile: an uploaded tile, and he manages it (or is the super user).
create or replace function core.require_uploader(p_tile text)
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_level text; v_hosting text;
begin
  v_user := core.require_user();
  select t.hosting into v_hosting from core.tiles t where t.id = p_tile;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_level := core.tile_level(v_user.id, p_tile);
  if v_level is null then raise exception 'NO_ACCESS'; end if;
  if v_level <> 'manage' then raise exception 'NO_RIGHT'; end if;
  if v_hosting <> 'upload' then raise exception 'INVALID:hosting'; end if;
  return v_user;
end $$;
revoke execute on function core.require_uploader(text) from public, anon, authenticated;

-- One release as the pages and the Edge Function see it.
create or replace function core.release_json(r core.tile_releases)
returns jsonb language sql security definer set search_path = '' stable as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'status', r.status, 'commit', r.commit_sha, 'live_commit', r.live_sha, 'files', r.files, 'bytes', r.bytes,
    'report', r.report, 'uploaded_by', core.username_of(r.uploaded_by), 'uploaded_at', r.uploaded_at,
    'live_by', core.username_of(r.live_by), 'live_at', r.live_at) end;
$$;
revoke execute on function core.release_json(core.tile_releases) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Functions for the Edge Function and upload.html
-- ---------------------------------------------------------------------------
-- Who is asking, and where the tile stands. The Edge Function calls this first and stops on any error.
create or replace function public.core_upload_check(p_tile text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_tile core.tiles; v_live core.tile_releases; v_prev core.tile_releases;
begin
  v_user := core.require_uploader(p_tile);
  select * into v_tile from core.tiles t where t.id = p_tile;
  if core.upload_reserved(v_tile.id) then raise exception 'INVALID:id'; end if;
  select * into v_live from core.tile_releases r where r.tile_id = p_tile and r.status = 'live';
  select * into v_prev from core.tile_releases r where r.tile_id = p_tile and r.status = 'preview';
  return jsonb_build_object('tile', v_tile.id, 'name', v_tile.name, 'accent', v_tile.accent, 'enabled', v_tile.enabled,
    'username', v_user.username, 'is_super', v_user.is_super,
    'live', core.release_json(v_live), 'preview', core.release_json(v_prev));
end $$;
revoke execute on function public.core_upload_check(text) from public, anon;
grant execute on function public.core_upload_check(text) to authenticated;

-- Every release of the tile, newest first (the upload page's history).
create or replace function public.core_upload_list(p_tile text)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_uploader(p_tile);
  return query select core.release_json(r) from core.tile_releases r where r.tile_id = p_tile order by r.id desc limit 50;
end $$;
revoke execute on function public.core_upload_list(text) from public, anon;
grant execute on function public.core_upload_list(text) to authenticated;

-- A new preview was committed to dame-hub/<tile>/_next/. Any older preview is discarded (the folder was replaced).
create or replace function public.core_upload_preview(p_tile text, p_commit text, p_files integer, p_bytes bigint, p_report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row core.tile_releases;
begin
  v_user := core.require_uploader(p_tile);
  if coalesce(p_commit, '') !~ '^[0-9a-f]{40}$' then raise exception 'INVALID:commit'; end if;
  if coalesce(p_files, 0) not between 1 and 500 then raise exception 'INVALID:files'; end if;
  if coalesce(p_bytes, -1) < 0 then raise exception 'INVALID:bytes'; end if;
  if p_report is not null and (jsonb_typeof(p_report) <> 'array' or octet_length(p_report::text) > 20000) then raise exception 'INVALID:report'; end if;
  update core.tile_releases set status = 'discarded' where tile_id = p_tile and status = 'preview';
  insert into core.tile_releases (tile_id, status, commit_sha, files, bytes, report, uploaded_by)
  values (p_tile, 'preview', p_commit, p_files, p_bytes, coalesce(p_report, '[]'::jsonb), v_user.id)
  returning * into v_row;
  perform core.audit(p_tile, 'upload_preview', jsonb_build_object('release', v_row.id, 'files', p_files, 'bytes', p_bytes,
    'commit', left(p_commit, 7)));
  return core.release_json(v_row);
end $$;
revoke execute on function public.core_upload_preview(text, text, integer, bigint, jsonb) from public, anon;
grant execute on function public.core_upload_preview(text, text, integer, bigint, jsonb) to authenticated;

-- The preview became the live files (commit p_commit replaced dame-hub/<tile>/ with it). The live one becomes old.
create or replace function public.core_upload_live(p_tile text, p_release bigint, p_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row core.tile_releases;
begin
  v_user := core.require_uploader(p_tile);
  if coalesce(p_commit, '') !~ '^[0-9a-f]{40}$' then raise exception 'INVALID:commit'; end if;
  select * into v_row from core.tile_releases r where r.id = p_release and r.tile_id = p_tile and r.status = 'preview';
  if not found then raise exception 'NOT_FOUND'; end if;
  update core.tile_releases set status = 'old' where tile_id = p_tile and status = 'live';
  update core.tile_releases set status = 'live', live_sha = p_commit, live_by = v_user.id, live_at = now()
  where id = v_row.id returning * into v_row;
  perform core.audit(p_tile, 'upload_live', jsonb_build_object('release', v_row.id, 'commit', left(p_commit, 7)));
  return core.release_json(v_row);
end $$;
revoke execute on function public.core_upload_live(text, bigint, text) from public, anon;
grant execute on function public.core_upload_live(text, bigint, text) to authenticated;

-- An old release is live again (commit p_commit restored its files). The current preview went with the folder.
create or replace function public.core_upload_rollback(p_tile text, p_release bigint, p_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row core.tile_releases;
begin
  v_user := core.require_uploader(p_tile);
  if coalesce(p_commit, '') !~ '^[0-9a-f]{40}$' then raise exception 'INVALID:commit'; end if;
  select * into v_row from core.tile_releases r
  where r.id = p_release and r.tile_id = p_tile and r.status = 'old' and r.live_sha is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  update core.tile_releases set status = 'old' where tile_id = p_tile and status = 'live';
  update core.tile_releases set status = 'discarded' where tile_id = p_tile and status = 'preview';
  update core.tile_releases set status = 'live', live_sha = p_commit, live_by = v_user.id, live_at = now()
  where id = v_row.id returning * into v_row;
  perform core.audit(p_tile, 'upload_rollback', jsonb_build_object('release', v_row.id, 'commit', left(p_commit, 7)));
  return core.release_json(v_row);
end $$;
revoke execute on function public.core_upload_rollback(text, bigint, text) from public, anon;
grant execute on function public.core_upload_rollback(text, bigint, text) to authenticated;

-- The preview folder was deleted (commit p_commit).
create or replace function public.core_upload_discard(p_tile text, p_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_id bigint;
begin
  v_user := core.require_uploader(p_tile);
  if coalesce(p_commit, '') !~ '^[0-9a-f]{40}$' then raise exception 'INVALID:commit'; end if;
  update core.tile_releases set status = 'discarded' where tile_id = p_tile and status = 'preview' returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND'; end if;
  perform core.audit(p_tile, 'upload_discard', jsonb_build_object('release', v_id, 'commit', left(p_commit, 7)));
  return jsonb_build_object('id', v_id, 'status', 'discarded');
end $$;
revoke execute on function public.core_upload_discard(text, text) from public, anon;
grant execute on function public.core_upload_discard(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Dashboard, admin list and tile form learn the hosting
-- ---------------------------------------------------------------------------
-- The tile's hosting in core_me (as 011, plus tile.hosting): pages link back to an uploaded tile at /dame-hub/<id>/.
create or replace function public.core_me(p_tile text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_tile core.tiles; v_out jsonb; v_level text;
begin
  v_user := core.require_session();
  v_out := jsonb_build_object('username', v_user.username, 'display_name', v_user.display_name,
    'email', auth.jwt() ->> 'email',
    'status', v_user.status, 'is_super', v_user.is_super, 'must_change_password', v_user.must_change_password);
  if p_tile is null then return v_out; end if;
  if v_user.status <> 'active' then raise exception 'NOT_APPROVED'; end if;
  if not core.has_tile(v_user.id, p_tile, null) then raise exception 'NO_ACCESS'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  v_level := core.tile_level(v_user.id, p_tile);
  return v_out || jsonb_build_object(
    'tile', jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'accent', v_tile.accent, 'rights', to_jsonb(v_tile.rights),
                               'levels', coalesce(v_tile.access -> 'levels', '{}'), 'kinds', coalesce(v_tile.access -> 'kinds', '{}'),
                               'hosting', v_tile.hosting),
    'tile_admin', v_level = 'manage',
    'level', v_level,
    'levels', to_jsonb(core.levels_upto(v_level)),
    'rights', to_jsonb(core.tile_held(v_user.id, p_tile)));
end $$;
revoke execute on function public.core_me(text) from public, anon;
grant execute on function public.core_me(text) to authenticated;

drop function if exists public.core_my_tiles();
create function public.core_my_tiles()
returns table (id text, name text, tagline text, icon text, accent text, level text, is_admin boolean, rights text[],
               hosting text, published boolean)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_user();
  return query
    select t.id, t.name, t.tagline, t.icon, t.accent, core.tile_level(v_user.id, t.id),
           core.tile_level(v_user.id, t.id) = 'manage', core.tile_held(v_user.id, t.id),
           t.hosting, (t.hosting = 'repo' or exists (select 1 from core.tile_releases r where r.tile_id = t.id and r.status = 'live'))
    from core.tiles t
    where t.enabled and core.tile_level(v_user.id, t.id) is not null
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_my_tiles() from public, anon;
grant execute on function public.core_my_tiles() to authenticated;

drop function if exists public.core_admin_tiles();
create function public.core_admin_tiles()
returns table (id text, name text, tagline text, icon text, accent text, sort_order integer, enabled boolean,
               rights text[], access jsonb, users integer, groups integer, admins text[], containers integer,
               hosting text, live jsonb, preview jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select t.id, t.name, t.tagline, t.icon, t.accent, t.sort_order, t.enabled, t.rights, t.access,
           (select count(*)::integer from core.tile_access a where a.tile_id = t.id),
           (select count(*)::integer from core.tile_group_access ga where ga.tile_id = t.id),
           coalesce((select array_agg(n order by n) from (
               select p.username n from core.tile_access a join core.profiles p on p.id = a.user_id where a.tile_id = t.id and a.level = 'manage'
               union select 'group ' || g.name from core.tile_group_access ga join core.groups g on g.id = ga.group_id
               where ga.tile_id = t.id and ga.level = 'manage') x), '{}'::text[]),
           (select count(*)::integer from core.containers c where c.tile_id = t.id),
           t.hosting,
           (select core.release_json(r) from core.tile_releases r where r.tile_id = t.id and r.status = 'live'),
           (select core.release_json(r) from core.tile_releases r where r.tile_id = t.id and r.status = 'preview')
    from core.tiles t
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_admin_tiles() from public, anon;
grant execute on function public.core_admin_tiles() to authenticated;

-- Tile form: as 011, plus the hosting. p_hosting null keeps the current one ('repo' for a new tile).
drop function if exists public.core_admin_tile_save(text, text, text, text, text, integer, text[]);
create function public.core_admin_tile_save(p_id text, p_name text, p_tagline text, p_icon text, p_accent text,
                                            p_sort_order integer, p_rights text[], p_hosting text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text := lower(trim(coalesce(p_id, ''))); v_accent text := lower(trim(coalesce(p_accent, 'blue')));
        v_rights text[]; v_right text; v_new boolean; v_declared boolean; v_hosting text;
begin
  perform core.require_super();
  if v_id !~ '^[a-z0-9][a-z0-9-]{1,29}$' or v_id = 'dame-hub' then raise exception 'INVALID:id'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'INVALID:name'; end if;
  if char_length(coalesce(p_tagline, '')) > 80 then raise exception 'INVALID:tagline'; end if;
  if coalesce(p_icon, '') !~ '^[a-z0-9-]{1,30}$' then raise exception 'INVALID:icon'; end if;
  if v_accent not in ('blue', 'teal', 'green', 'orange', 'violet', 'rose', 'slate') then raise exception 'INVALID:accent'; end if;
  v_new := not exists (select 1 from core.tiles t where t.id = v_id);
  v_hosting := coalesce(lower(trim(p_hosting)), (select t.hosting from core.tiles t where t.id = v_id), 'repo');
  if v_hosting not in ('repo', 'upload') then raise exception 'INVALID:hosting'; end if;
  if v_hosting = 'upload' and core.upload_reserved(v_id) then raise exception 'INVALID:hosting'; end if;
  v_declared := exists (select 1 from core.tiles t where t.id = v_id and t.access <> '{}'::jsonb);
  v_rights := '{}';
  if v_declared then
    select t.rights into v_rights from core.tiles t where t.id = v_id;
  else
    foreach v_right in array coalesce(p_rights, '{}'::text[]) loop
      v_right := lower(trim(v_right));
      if v_right = '' then continue; end if;
      if v_right !~ '^[a-z][a-z0-9_]{1,19}$' then raise exception 'INVALID:rights'; end if;
      if not (v_right = any (v_rights)) then v_rights := v_rights || v_right; end if;
    end loop;
  end if;
  insert into core.tiles (id, name, tagline, icon, accent, sort_order, rights, hosting)
  values (v_id, trim(p_name), coalesce(p_tagline, ''), p_icon, v_accent, coalesce(p_sort_order, 100), v_rights, v_hosting)
  on conflict (id) do update
    set name = excluded.name, tagline = excluded.tagline, icon = excluded.icon, accent = excluded.accent,
        sort_order = excluded.sort_order, rights = excluded.rights, hosting = excluded.hosting, updated_at = now();
  update core.tile_access a set rights = array(select r from unnest(a.rights) r where r = any (v_rights))
  where a.tile_id = v_id and not (a.rights <@ v_rights);
  update core.tile_group_access g set rights = array(select r from unnest(g.rights) r where r = any (v_rights))
  where g.tile_id = v_id and not (g.rights <@ v_rights);
  perform core.audit(v_id, case when v_new then 'tile_create' else 'tile_update' end,
                     jsonb_build_object('name', trim(p_name), 'accent', v_accent, 'rights', to_jsonb(v_rights), 'hosting', v_hosting));
  return jsonb_build_object('id', v_id, 'created', v_new, 'declared', v_declared, 'hosting', v_hosting);
end $$;
revoke execute on function public.core_admin_tile_save(text, text, text, text, text, integer, text[], text) from public, anon;
grant execute on function public.core_admin_tile_save(text, text, text, text, text, integer, text[], text) to authenticated;

select core.applied('dame-hub', '012_uploads');
