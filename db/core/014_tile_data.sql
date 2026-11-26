-- DAME core 014: the data service for uploaded tools (docs/BLUEPRINT.md sections 6-7, phase 1; owner 2026-11-26:
-- "enterprise grade ... running SQL to be handled somehow"). An uploaded tool runs sealed and never gets a table:
-- it keeps JSON records in named collections through the bridge (Dame.save / load / list / remove), which calls
-- these functions with the user's session.
--   Shared records (p_mine false): everyone with the tile reads; Contribute adds and changes his own; Edit changes
--   anyone's; Approve and Manage delete anyone's. Every change is kept in core.tile_data_history.
--   Private records (p_mine true): only the user himself, any level. Also holds the tool's localStorage ('_local').
--   Preview (p_preview true): a separate set, only for the tile's managers, so a preview never touches live data.
-- Limits: 256 KB a record, 20 000 records and 50 MB a tile. Only for tiles with hosting 'upload'.
-- Run after 013, as one script. Then Admin > Health > Run check now must say Clean.

create table if not exists core.tile_data (
  tile_id    text not null references core.tiles (id) on delete cascade,
  preview    boolean not null default false,
  collection text not null check (collection ~ '^[a-z_][a-z0-9_-]{0,39}$'),
  scope_user uuid not null,                     -- the user for a private record, the zero uuid for a shared one
  id         text not null check (char_length(id) between 1 and 100),
  data       jsonb not null,
  bytes      integer not null,
  created_by uuid references core.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references core.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tile_id, preview, collection, scope_user, id)
);
alter table core.tile_data enable row level security;

create table if not exists core.tile_data_history (
  n          bigint generated always as identity primary key,
  tile_id    text not null references core.tiles (id) on delete cascade,
  collection text not null,
  id         text not null,
  action     text not null check (action in ('create', 'update', 'delete')),
  data       jsonb,
  by_user    uuid references core.profiles (id) on delete set null,
  at         timestamptz not null default now()
);
alter table core.tile_data_history enable row level security;
create index if not exists tile_data_history_idx on core.tile_data_history (tile_id, collection, id, n desc);

-- The caller and his level for the data of an uploaded tile. Preview: managers only, also while the tile is off.
create or replace function core.require_data(p_tile text, p_preview boolean, out v_user core.profiles, out v_rank integer)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_preview, false) then
    v_user := core.require_uploader(p_tile); v_rank := 5; return;
  end if;
  v_user := core.require_tile(p_tile, null);
  if not exists (select 1 from core.tiles t where t.id = p_tile and t.hosting = 'upload') then raise exception 'INVALID:hosting'; end if;
  v_rank := core.level_rank(core.tile_level(v_user.id, p_tile));
end $$;
revoke execute on function core.require_data(text, boolean) from public, anon, authenticated;

create or replace function core.data_json(r core.tile_data)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('id', r.id, 'data', r.data, 'by', core.username_of(r.created_by), 'at', r.created_at,
    'updated_by', core.username_of(r.updated_by), 'updated_at', r.updated_at);
$$;
revoke execute on function core.data_json(core.tile_data) from public, anon, authenticated;

create or replace function public.core_data_get(p_tile text, p_collection text, p_id text, p_mine boolean default false, p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; v_row core.tile_data;
begin
  g := core.require_data(p_tile, p_preview);
  select * into v_row from core.tile_data d
  where d.tile_id = p_tile and d.preview = coalesce(p_preview, false) and d.collection = p_collection and d.id = p_id
    and d.scope_user = case when coalesce(p_mine, false) then (g.v_user).id else '00000000-0000-0000-0000-000000000000'::uuid end;
  if not found then return null; end if;
  return core.data_json(v_row);
end $$;
revoke execute on function public.core_data_get(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.core_data_get(text, text, text, boolean, boolean) to authenticated;

-- Newest change first; p_after = the updated_at of the last record of the page before.
create or replace function public.core_data_list(p_tile text, p_collection text, p_mine boolean default false, p_preview boolean default false,
                                                 p_limit integer default 500, p_after timestamptz default null)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  g := core.require_data(p_tile, p_preview);
  return query
    select core.data_json(d) from core.tile_data d
    where d.tile_id = p_tile and d.preview = coalesce(p_preview, false) and d.collection = p_collection
      and d.scope_user = case when coalesce(p_mine, false) then (g.v_user).id else '00000000-0000-0000-0000-000000000000'::uuid end
      and (p_after is null or d.updated_at < p_after)
    order by d.updated_at desc, d.id
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;
revoke execute on function public.core_data_list(text, text, boolean, boolean, integer, timestamptz) from public, anon;
grant execute on function public.core_data_list(text, text, boolean, boolean, integer, timestamptz) to authenticated;

-- Create (p_id null: an id is made) or replace a record.
create or replace function public.core_data_put(p_tile text, p_collection text, p_id text, p_data jsonb, p_mine boolean default false, p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; v_scope uuid; v_id text := coalesce(nullif(trim(p_id), ''), gen_random_uuid()::text); v_old core.tile_data; v_row core.tile_data;
        v_bytes integer; v_prev boolean := coalesce(p_preview, false); v_count bigint; v_total bigint;
begin
  g := core.require_data(p_tile, p_preview);
  if coalesce(p_collection, '') !~ '^[a-z_][a-z0-9_-]{0,39}$' then raise exception 'INVALID:collection'; end if;
  if char_length(v_id) > 100 then raise exception 'INVALID:id'; end if;
  if p_data is null then raise exception 'INVALID:data'; end if;
  v_bytes := octet_length(p_data::text);
  if v_bytes > 262144 then raise exception 'INVALID:size'; end if;
  v_scope := case when coalesce(p_mine, false) then (g.v_user).id else '00000000-0000-0000-0000-000000000000'::uuid end;
  select * into v_old from core.tile_data d
  where d.tile_id = p_tile and d.preview = v_prev and d.collection = p_collection and d.scope_user = v_scope and d.id = v_id for update;
  if not coalesce(p_mine, false) then
    if g.v_rank < 2 then raise exception 'NO_RIGHT'; end if;                                          -- Contribute writes
    if v_old.id is not null and v_old.created_by is distinct from (g.v_user).id and g.v_rank < 3 then raise exception 'NO_RIGHT'; end if;   -- Edit changes others'
  end if;
  select count(*), coalesce(sum(d.bytes), 0) into v_count, v_total from core.tile_data d where d.tile_id = p_tile;
  if v_old.id is null and v_count >= 20000 then raise exception 'INVALID:full'; end if;
  if v_total - coalesce(v_old.bytes, 0) + v_bytes > 52428800 then raise exception 'INVALID:full'; end if;
  insert into core.tile_data (tile_id, preview, collection, scope_user, id, data, bytes, created_by, updated_by)
  values (p_tile, v_prev, p_collection, v_scope, v_id, p_data, v_bytes, (g.v_user).id, (g.v_user).id)
  on conflict (tile_id, preview, collection, scope_user, id) do update
    set data = excluded.data, bytes = excluded.bytes, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  if not coalesce(p_mine, false) and not v_prev then
    insert into core.tile_data_history (tile_id, collection, id, action, data, by_user)
    values (p_tile, p_collection, v_id, case when v_old.id is null then 'create' else 'update' end, p_data, (g.v_user).id);
  end if;
  return core.data_json(v_row);
end $$;
revoke execute on function public.core_data_put(text, text, text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.core_data_put(text, text, text, jsonb, boolean, boolean) to authenticated;

create or replace function public.core_data_delete(p_tile text, p_collection text, p_id text, p_mine boolean default false, p_preview boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare g record; v_scope uuid; v_old core.tile_data; v_prev boolean := coalesce(p_preview, false);
begin
  g := core.require_data(p_tile, p_preview);
  v_scope := case when coalesce(p_mine, false) then (g.v_user).id else '00000000-0000-0000-0000-000000000000'::uuid end;
  select * into v_old from core.tile_data d
  where d.tile_id = p_tile and d.preview = v_prev and d.collection = p_collection and d.scope_user = v_scope and d.id = p_id for update;
  if not found then return false; end if;
  if not coalesce(p_mine, false) then
    if g.v_rank < 2 then raise exception 'NO_RIGHT'; end if;
    if v_old.created_by is distinct from (g.v_user).id and g.v_rank < 4 then raise exception 'NO_RIGHT'; end if;   -- Approve deletes others'
  end if;
  delete from core.tile_data d
  where d.tile_id = p_tile and d.preview = v_prev and d.collection = p_collection and d.scope_user = v_scope and d.id = p_id;
  if not coalesce(p_mine, false) and not v_prev then
    insert into core.tile_data_history (tile_id, collection, id, action, data, by_user)
    values (p_tile, p_collection, p_id, 'delete', v_old.data, (g.v_user).id);
    perform core.audit(p_tile, 'data_delete', jsonb_build_object('collection', p_collection, 'id', p_id));
  end if;
  return true;
end $$;
revoke execute on function public.core_data_delete(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.core_data_delete(text, text, text, boolean, boolean) to authenticated;

-- Everything shared in the tile, for its managers (the Files page: Download the data). Private records are not in it.
create or replace function public.core_data_export(p_tile text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_out jsonb;
begin
  v_user := core.require_uploader(p_tile);
  select jsonb_build_object('tile', p_tile, 'exported_at', now(), 'exported_by', v_user.username,
    'records', coalesce(jsonb_agg(jsonb_build_object('collection', d.collection) || core.data_json(d) order by d.collection, d.updated_at), '[]'::jsonb))
  into v_out from core.tile_data d
  where d.tile_id = p_tile and not d.preview and d.scope_user = '00000000-0000-0000-0000-000000000000'::uuid;
  perform core.audit(p_tile, 'data_export', jsonb_build_object('records', jsonb_array_length(v_out -> 'records')));
  return v_out;
end $$;
revoke execute on function public.core_data_export(text) from public, anon;
grant execute on function public.core_data_export(text) to authenticated;

-- The delete dialog also says how much data goes (as 013, plus records).
create or replace function public.core_admin_tile_plan(p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tile core.tiles;
begin
  perform core.require_super();
  select * into v_tile from core.tiles t where t.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'hosting', v_tile.hosting, 'enabled', v_tile.enabled,
    'people', (select count(*) from core.tile_access a where a.tile_id = p_id),
    'groups', (select count(*) from core.tile_group_access g where g.tile_id = p_id),
    'containers', (select count(*) from core.containers c where c.tile_id = p_id),
    'shares', (select count(*) from core.shares s where s.tile_id = p_id),
    'releases', (select count(*) from core.tile_releases r where r.tile_id = p_id),
    'files', exists (select 1 from core.tile_releases r where r.tile_id = p_id and r.status in ('live', 'preview')),
    'records', (select count(*) from core.tile_data d where d.tile_id = p_id and not d.preview),
    'sql_files', (select count(*) from core.migrations m where m.repo = p_id),
    'data', core.tile_leftovers(p_id));
end $$;
revoke execute on function public.core_admin_tile_plan(text) from public, anon;
grant execute on function public.core_admin_tile_plan(text) to authenticated;

select core.applied('dame-hub', '014_tile_data');
