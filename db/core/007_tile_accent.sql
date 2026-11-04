-- 007: tile accent. Each tile has one hue from the core palette (theme.css "tile accents"); the admin page sets it,
-- the dashboard card and the tile's pages carry it as data-accent. Existing tiles keep blue (= DAME brand).
-- Owner, 2026-11-04: "each tile has its own colour theme, not deviating much from the base site".

alter table core.tiles
  add column if not exists accent text not null default 'blue'
  check (accent in ('blue', 'teal', 'green', 'orange', 'violet', 'rose', 'slate'));

-- Dashboard: tiles this user may open, now with the accent.
drop function if exists public.core_my_tiles();
create or replace function public.core_my_tiles()
returns table (id text, name text, tagline text, icon text, accent text, is_admin boolean, rights text[])
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_user();
  return query
    select t.id, t.name, t.tagline, t.icon, t.accent,
           core.is_tile_admin(v_user.id, t.id),
           case when v_user.is_super or coalesce(a.is_admin, false) then t.rights else coalesce(a.rights, '{}'::text[]) end
    from core.tiles t
    left join core.tile_access a on a.tile_id = t.id and a.user_id = v_user.id
    where t.enabled and (v_user.is_super or a.user_id is not null)
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_my_tiles() from public, anon;
grant execute on function public.core_my_tiles() to authenticated;

-- Page load on a tile: the tile object now carries the accent (core.js sets data-accent on <html>).
create or replace function public.core_me(p_tile text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_tile core.tiles; v_access core.tile_access; v_out jsonb;
begin
  v_user := core.require_session();
  v_out := jsonb_build_object('username', v_user.username, 'display_name', v_user.display_name,
    'email', auth.jwt() ->> 'email',
    'status', v_user.status, 'is_super', v_user.is_super, 'must_change_password', v_user.must_change_password);
  if p_tile is null then return v_out; end if;
  if v_user.status <> 'active' then raise exception 'NOT_APPROVED'; end if;
  if not core.has_tile(v_user.id, p_tile, null) then raise exception 'NO_ACCESS'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  select * into v_access from core.tile_access a where a.user_id = v_user.id and a.tile_id = p_tile;
  return v_out || jsonb_build_object(
    'tile', jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'accent', v_tile.accent, 'rights', to_jsonb(v_tile.rights)),
    'tile_admin', core.is_tile_admin(v_user.id, p_tile),
    'rights', case when v_user.is_super or coalesce(v_access.is_admin, false) then to_jsonb(v_tile.rights)
                   else to_jsonb(coalesce(v_access.rights, '{}'::text[])) end);
end $$;
revoke execute on function public.core_me(text) from public, anon;
grant execute on function public.core_me(text) to authenticated;

-- Admin list with the accent.
drop function if exists public.core_admin_tiles();
create or replace function public.core_admin_tiles()
returns table (id text, name text, tagline text, icon text, accent text, sort_order integer, enabled boolean,
               rights text[], users integer, admins text[])
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select t.id, t.name, t.tagline, t.icon, t.accent, t.sort_order, t.enabled, t.rights,
           (select count(*)::integer from core.tile_access a where a.tile_id = t.id),
           coalesce((select array_agg(p.username order by p.username) from core.tile_access a
                     join core.profiles p on p.id = a.user_id where a.tile_id = t.id and a.is_admin), '{}'::text[])
    from core.tiles t
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_admin_tiles() from public, anon;
grant execute on function public.core_admin_tiles() to authenticated;

-- Save with the accent. The 6-argument version is dropped so only one door exists.
drop function if exists public.core_admin_tile_save(text, text, text, text, integer, text[]);
create or replace function public.core_admin_tile_save(p_id text, p_name text, p_tagline text, p_icon text, p_accent text,
                                                        p_sort_order integer, p_rights text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text := lower(trim(coalesce(p_id, ''))); v_accent text := lower(trim(coalesce(p_accent, 'blue')));
        v_rights text[]; v_right text; v_new boolean;
begin
  perform core.require_super();
  if v_id !~ '^[a-z0-9][a-z0-9-]{1,29}$' or v_id = 'dame-hub' then raise exception 'INVALID:id'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'INVALID:name'; end if;
  if char_length(coalesce(p_tagline, '')) > 80 then raise exception 'INVALID:tagline'; end if;
  if coalesce(p_icon, '') !~ '^[a-z0-9-]{1,30}$' then raise exception 'INVALID:icon'; end if;
  if v_accent not in ('blue', 'teal', 'green', 'orange', 'violet', 'rose', 'slate') then raise exception 'INVALID:accent'; end if;
  v_rights := '{}';
  foreach v_right in array coalesce(p_rights, '{}'::text[]) loop
    v_right := lower(trim(v_right));
    if v_right = '' then continue; end if;
    if v_right !~ '^[a-z][a-z0-9_]{1,19}$' then raise exception 'INVALID:rights'; end if;
    if not (v_right = any (v_rights)) then v_rights := v_rights || v_right; end if;
  end loop;
  v_new := not exists (select 1 from core.tiles t where t.id = v_id);
  insert into core.tiles (id, name, tagline, icon, accent, sort_order, rights)
  values (v_id, trim(p_name), coalesce(p_tagline, ''), p_icon, v_accent, coalesce(p_sort_order, 100), v_rights)
  on conflict (id) do update
    set name = excluded.name, tagline = excluded.tagline, icon = excluded.icon, accent = excluded.accent,
        sort_order = excluded.sort_order, rights = excluded.rights, updated_at = now();
  update core.tile_access a set rights = (select coalesce(array_agg(r), '{}'::text[]) from unnest(a.rights) r where r = any (v_rights))
  where a.tile_id = v_id;
  perform core.audit(v_id, case when v_new then 'tile_create' else 'tile_update' end,
                     jsonb_build_object('name', trim(p_name), 'accent', v_accent, 'rights', to_jsonb(v_rights)));
  return jsonb_build_object('id', v_id, 'created', v_new);
end $$;
revoke execute on function public.core_admin_tile_save(text, text, text, text, text, integer, text[]) from public, anon;
grant execute on function public.core_admin_tile_save(text, text, text, text, text, integer, text[]) to authenticated;

select core.applied('dame-hub', '007_tile_accent');
