-- DAME core 013: delete a tile (owner, 2026-11-26: "enable to add or delete tiles; deleting must do the necessary cleanup").
--
--   core_admin_tile_plan(id)            what a delete removes, and what stands in its way (for the confirm dialog)
--   core_admin_tile_delete(id, confirm) removes the tile and everything the core keeps about it: people and group
--                                       access, shared items and their sharing, upload versions. The audit stays.
-- A tile that has data of its own (a schema <tile_id>, functions public.<tile_id>_*, a storage bucket <tile-id>) is
-- refused (INVALID:data): the owner removes those first with the script the admin page shows, in the SQL editor,
-- after reading it. A function a browser can call never drops a schema.
-- The files of an uploaded tile are removed from the repo by the Edge Function tile-upload (action remove), which
-- the admin page calls before this function.
-- Run after 012, as one script. Then Admin > Health > Run check now must say Clean.

create or replace function core.tile_leftovers(p_id text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_schema text := replace(p_id, '-', '_'); v_tables integer := 0; v_has_schema boolean; v_fns text[]; v_bucket boolean := false;
begin
  select exists (select 1 from pg_catalog.pg_namespace n where n.nspname = v_schema) into v_has_schema;
  if v_has_schema then
    select count(*)::integer into v_tables from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = v_schema and c.relkind in ('r', 'p');
  end if;
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into v_fns
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and left(p.proname, char_length(v_schema) + 1) = v_schema || '_';
  if to_regclass('storage.buckets') is not null then
    execute 'select exists (select 1 from storage.buckets b where b.id = $1)' into v_bucket using p_id;
  end if;
  return jsonb_build_object('schema', case when v_has_schema then v_schema end, 'tables', v_tables,
    'functions', to_jsonb(v_fns), 'bucket', case when v_bucket then p_id end,
    'blocked', v_has_schema or cardinality(v_fns) > 0 or v_bucket);
end $$;
revoke execute on function core.tile_leftovers(text) from public, anon, authenticated;

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
    'sql_files', (select count(*) from core.migrations m where m.repo = p_id),
    'data', core.tile_leftovers(p_id));
end $$;
revoke execute on function public.core_admin_tile_plan(text) from public, anon;
grant execute on function public.core_admin_tile_plan(text) to authenticated;

create or replace function public.core_admin_tile_delete(p_id text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tile core.tiles; v_out jsonb;
begin
  perform core.require_super();
  select * into v_tile from core.tiles t where t.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if coalesce(p_confirm, '') <> v_tile.id then raise exception 'INVALID:confirm'; end if;
  if (core.tile_leftovers(p_id) ->> 'blocked')::boolean then raise exception 'INVALID:data'; end if;
  v_out := jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'hosting', v_tile.hosting,
    'people', (select count(*) from core.tile_access a where a.tile_id = p_id),
    'groups', (select count(*) from core.tile_group_access g where g.tile_id = p_id),
    'containers', (select count(*) from core.containers c where c.tile_id = p_id),
    'releases', (select count(*) from core.tile_releases r where r.tile_id = p_id));
  delete from core.tiles t where t.id = p_id;   -- access, group access, containers (and their sharing), releases follow
  perform core.audit(p_id, 'tile_delete', v_out);
  return v_out;
end $$;
revoke execute on function public.core_admin_tile_delete(text, text) from public, anon;
grant execute on function public.core_admin_tile_delete(text, text) to authenticated;

select core.applied('dame-hub', '013_tile_delete');
