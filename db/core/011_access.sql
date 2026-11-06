-- DAME core 011: one access model for every tile (owner, 2026-11-06: "SharePoint-like access, one user base and one
-- access base"). Read docs/TILE-CONTRACT.md section 5 first.
--
--   1. Levels   read < contribute < edit < approve < manage, the same five in every tile. A user's level in a tile is
--               the highest of his own and his groups'. Tile admin = level manage. Super user = manage everywhere.
--   2. Groups   site-wide groups of people (super user). A tile gives a level to a person or to a group.
--   3. Tile declaration (core.tile_declare): what each level means in the tile, aliases that keep the tile's old
--               rights working (maps 'edit' = contribute, 'verify' = approve ...), special rights, container kinds.
--   4. Containers  a project, a map, a notebook ... registered by the tile (core.container_put). Default: everyone in
--               the tile; or only the people and groups it is shared with (Can view / Can edit). The tile level is
--               the ceiling. Managers see every container (owner, 2026-11-06: technical data only).
--   5. The Access panel (core_share_*), the manager's access page (core_tile_access_list / core_tile_level_set),
--      groups, Check access and Handover in Admin (core_admin_*).
--
-- Nothing breaks: core.require_tile / has_tile / is_tile_admin keep their signatures. Old rights of projects,
-- hvac-notes, maps and demo become aliases or special rights (section 6), and every user keeps what he could do.
-- Run after 010, in the SQL editor, as one script. Then Admin > Health > Run check now must say Clean.
-- Touches: schema core (new tables groups, group_members, tile_group_access, containers, shares; columns
-- tiles.access, tile_access.level), core.* helpers, public.core_* functions.

-- ---------------------------------------------------------------------------
-- 1. Levels
-- ---------------------------------------------------------------------------
create or replace function core.level_rank(p_level text)
returns integer language sql immutable set search_path = '' as $$
  select case p_level when 'read' then 1 when 'contribute' then 2 when 'edit' then 3
                      when 'approve' then 4 when 'manage' then 5 else 0 end;
$$;

create or replace function core.level_of(p_rank integer)
returns text language sql immutable set search_path = '' as $$
  select case p_rank when 1 then 'read' when 2 then 'contribute' when 3 then 'edit'
                     when 4 then 'approve' when 5 then 'manage' else null end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
-- The tile's declaration (core.tile_declare). '{}' = not declared yet: tiles.rights are all special rights.
alter table core.tiles add column if not exists access jsonb not null default '{}';

alter table core.tile_access add column if not exists level text;

create table if not exists core.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 40),
  note       text not null default '' check (char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists groups_name_idx on core.groups (lower(name));
alter table core.groups enable row level security;

create table if not exists core.group_members (
  group_id uuid not null references core.groups (id) on delete cascade,
  user_id  uuid not null references core.profiles (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on core.group_members (user_id);
alter table core.group_members enable row level security;

create table if not exists core.tile_group_access (
  tile_id    text not null references core.tiles (id) on delete cascade,
  group_id   uuid not null references core.groups (id) on delete cascade,
  level      text not null check (level in ('read', 'contribute', 'edit', 'approve', 'manage')),
  rights     text[] not null default '{}',
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (tile_id, group_id)
);
alter table core.tile_group_access enable row level security;

-- A container: something a tile shares as a whole (a project, a map, a notebook). Items inside follow it.
-- owner_id: who made it (handover moves it); a profile with containers cannot be deleted (hand over first).
create table if not exists core.containers (
  tile_id    text not null references core.tiles (id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z][a-z0-9_]{1,19}$'),
  id         text not null check (char_length(id) between 1 and 100),
  name       text not null check (char_length(name) between 1 and 200),
  owner_id   uuid references core.profiles (id) on delete restrict,
  everyone   text check (everyone in ('read', 'edit')),     -- null = only the owner and the people / groups shared with
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tile_id, kind, id)
);
create index if not exists containers_owner_idx on core.containers (owner_id);
alter table core.containers enable row level security;

create table if not exists core.shares (
  tile_id  text not null,
  kind     text not null,
  id       text not null,
  user_id  uuid references core.profiles (id) on delete cascade,
  group_id uuid references core.groups (id) on delete cascade,
  level    text not null check (level in ('read', 'edit')),
  added_by uuid,
  added_at timestamptz not null default now(),
  foreign key (tile_id, kind, id) references core.containers (tile_id, kind, id) on delete cascade,
  check ((user_id is null) <> (group_id is null))
);
create unique index if not exists shares_user_idx on core.shares (tile_id, kind, id, user_id) where user_id is not null;
create unique index if not exists shares_group_idx on core.shares (tile_id, kind, id, group_id) where group_id is not null;
create index if not exists shares_by_user_idx on core.shares (user_id) where user_id is not null;
create index if not exists shares_by_group_idx on core.shares (group_id) where group_id is not null;
alter table core.shares enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Levels of the people who have tiles today (rights -> level), then the column is required.
-- ---------------------------------------------------------------------------
update core.tile_access a set level = case
    when a.is_admin then 'manage'
    when a.tile_id = 'projects' and 'review' = any (a.rights) then 'approve'
    when a.tile_id = 'hvac-notes' and 'edit' = any (a.rights) then 'edit'
    when a.tile_id = 'maps' and 'verify' = any (a.rights) then 'approve'
    when a.tile_id = 'maps' and 'edit' = any (a.rights) then 'contribute'
    when a.tile_id = 'maps' then 'read'
    when a.tile_id = 'demo' and 'edit' = any (a.rights) then 'contribute'
    when a.tile_id = 'demo' then 'read'
    else 'contribute' end
where a.level is null;
alter table core.tile_access alter column level set default 'contribute';
alter table core.tile_access alter column level set not null;
alter table core.tile_access drop constraint if exists tile_access_level_check;
alter table core.tile_access add constraint tile_access_level_check
  check (level in ('read', 'contribute', 'edit', 'approve', 'manage'));

-- is_admin stays as a mirror of level = manage (nothing reads it after 011; kept so nothing old breaks).
-- An old-style write that sets only is_admin (a script, the staging seed) moves the level with it.
create or replace function core.tile_access_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.is_admin then new.level := 'manage'; end if;
  elsif new.is_admin is distinct from old.is_admin and new.level = old.level then
    new.level := case when new.is_admin then 'manage' else 'contribute' end;
  end if;
  new.is_admin := new.level = 'manage';
  return new;
end $$;
drop trigger if exists tile_access_sync on core.tile_access;
create trigger tile_access_sync before insert or update on core.tile_access
  for each row execute function core.tile_access_sync();

-- ---------------------------------------------------------------------------
-- 4. Who may do what (the wall). Tiles call these; never copy them.
-- ---------------------------------------------------------------------------

-- The user's level in the tile (own and groups'), on or off. Null: no access, not active, or no such tile.
create or replace function core.tile_level(p_user uuid, p_tile text)
returns text language plpgsql security definer set search_path = '' stable as $$
declare v_user core.profiles; v_rank integer;
begin
  if p_user is null then return null; end if;
  select * into v_user from core.profiles p where p.id = p_user;
  if not found or v_user.status <> 'active' then return null; end if;
  if not exists (select 1 from core.tiles t where t.id = p_tile) then return null; end if;
  if v_user.is_super then return 'manage'; end if;
  select max(s.r) into v_rank from (
    select core.level_rank(a.level) r from core.tile_access a where a.user_id = p_user and a.tile_id = p_tile
    union all
    select core.level_rank(g.level) from core.tile_group_access g
      join core.group_members m on m.group_id = g.group_id
    where g.tile_id = p_tile and m.user_id = p_user) s;
  return core.level_of(v_rank);
end $$;

-- Special rights the user holds in the tile (own and groups'), limited to what the tile declares.
create or replace function core.tile_specials(p_user uuid, p_tile text)
returns text[] language sql security definer set search_path = '' stable as $$
  select coalesce(array_agg(distinct s.r), '{}'::text[]) from (
    select unnest(a.rights) r from core.tile_access a where a.user_id = p_user and a.tile_id = p_tile
    union all
    select unnest(g.rights) from core.tile_group_access g join core.group_members m on m.group_id = g.group_id
    where g.tile_id = p_tile and m.user_id = p_user) s
  join core.tiles t on t.id = p_tile
  where s.r = any (t.rights);
$$;

-- True when the user is active, the tile is on, he has it, and (when p_right is named) he holds it.
-- p_right is, in this order: an alias the tile declared (-> its level), a special right of the tile, or a level name.
-- Super users hold everything; managers hold every alias, special right and level of their tile.
create or replace function core.has_tile(p_user uuid, p_tile text, p_right text default null)
returns boolean language plpgsql security definer set search_path = '' stable as $$
declare v_tile core.tiles; v_level text; v_alias text;
begin
  if p_user is null then return false; end if;
  select * into v_tile from core.tiles t where t.id = p_tile and t.enabled;
  if not found then return false; end if;
  v_level := core.tile_level(p_user, p_tile);
  if v_level is null then return false; end if;
  if p_right is null then return true; end if;
  if exists (select 1 from core.profiles p where p.id = p_user and p.is_super) then return true; end if;
  v_alias := v_tile.access -> 'aliases' ->> p_right;
  if v_alias is not null then return core.level_rank(v_level) >= core.level_rank(v_alias); end if;
  if p_right = any (v_tile.rights) then
    return v_level = 'manage' or p_right = any (core.tile_specials(p_user, p_tile));
  end if;
  if core.level_rank(p_right) > 0 then return core.level_rank(v_level) >= core.level_rank(p_right); end if;
  return false;
end $$;

-- Tile admin = level manage (own or through a group). Super users manage every tile.
create or replace function core.is_tile_admin(p_user uuid, p_tile text)
returns boolean language sql security definer set search_path = '' stable as $$
  select coalesce(core.tile_level(p_user, p_tile) = 'manage', false);
$$;

-- Session ok, active, tile on, at least this level. The level-named twin of require_tile(tile, right).
create or replace function core.require_level(p_tile text, p_level text)
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  if core.level_rank(p_level) = 0 then raise exception 'INVALID:level'; end if;
  v_user := core.require_tile(p_tile, null);
  if core.level_rank(core.tile_level(v_user.id, p_tile)) < core.level_rank(p_level) then raise exception 'NO_RIGHT'; end if;
  return v_user;
end $$;

-- Declared names (aliases + special rights) the user holds: for the page's show and hide only.
create or replace function core.tile_held(p_user uuid, p_tile text)
returns text[] language sql security definer set search_path = '' stable as $$
  select coalesce(array_agg(n order by o, n), '{}'::text[]) from (
    select k n, 1 o from core.tiles t, jsonb_object_keys(coalesce(t.access -> 'aliases', '{}')) k where t.id = p_tile
    union
    select r, 2 from core.tiles t, unnest(t.rights) r where t.id = p_tile) s
  where core.has_tile(p_user, p_tile, n);
$$;

-- Level names up to and including the user's level (read .. his level).
create or replace function core.levels_upto(p_level text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(core.level_of(i) order by i), '{}'::text[]) from generate_series(1, core.level_rank(p_level)) i;
$$;

-- People who can open the tile (009, now with groups): for "share with" and "assign to" lists inside tile functions.
create or replace function core.tile_users(p_tile text)
returns table (id uuid, username text, display_name text)
language plpgsql security definer set search_path = '' stable as $$
begin
  perform core.require_tile(p_tile, null);
  return query
    select p.id, p.username, p.display_name
    from core.profiles p
    where p.status = 'active' and core.tile_level(p.id, p_tile) is not null
    order by p.username;
end $$;
revoke execute on function core.tile_users(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tile declaration (owner only: the SQL editor or the tile's own SQL file, for its own tile id)
-- ---------------------------------------------------------------------------
-- p_spec = { "levels":  { "read": "...", "contribute": "...", ... }   what each level means in this tile (shown in Access)
--            "aliases": { "edit": "contribute", "verify": "approve" } old or tile words that mean a level
--            "rights":  { "nb_theory": "..." }                        special rights, given one by one (keep them rare)
--            "kinds":   { "map": "Map" }                              container kinds the tile registers
--            "default": "contribute" }                                level given when access is switched on
create or replace function core.tile_declare(p_tile text, p_spec jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_spec jsonb := coalesce(p_spec, '{}'); v_key text; v_val text; v_out jsonb; v_rights text[] := '{}';
        v_levels jsonb := '{}'; v_aliases jsonb := '{}'; v_specials jsonb := '{}'; v_kinds jsonb := '{}'; v_default text;
begin
  if not exists (select 1 from core.tiles t where t.id = p_tile) then raise exception 'NOT_FOUND'; end if;
  if jsonb_typeof(v_spec) <> 'object' then raise exception 'INVALID:spec'; end if;
  for v_key in select jsonb_object_keys(v_spec) loop
    if v_key not in ('levels', 'aliases', 'rights', 'kinds', 'default') then raise exception 'INVALID:spec %', v_key; end if;
  end loop;
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(v_spec -> 'levels', '{}')) loop
    if core.level_rank(v_key) = 0 or char_length(v_val) > 200 then raise exception 'INVALID:levels %', v_key; end if;
    v_levels := v_levels || jsonb_build_object(v_key, v_val);
  end loop;
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(v_spec -> 'aliases', '{}')) loop
    if v_key !~ '^[a-z][a-z0-9_]{1,19}$' or core.level_rank(v_val) = 0 then raise exception 'INVALID:aliases %', v_key; end if;
    v_aliases := v_aliases || jsonb_build_object(v_key, v_val);
  end loop;
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(v_spec -> 'rights', '{}')) loop
    if v_key !~ '^[a-z][a-z0-9_]{1,19}$' or core.level_rank(v_key) > 0 or v_aliases ? v_key or char_length(v_val) > 200 then
      raise exception 'INVALID:rights %', v_key;
    end if;
    v_specials := v_specials || jsonb_build_object(v_key, v_val);
    v_rights := v_rights || v_key;
  end loop;
  if cardinality(v_rights) > 40 then raise exception 'INVALID:rights'; end if;
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(v_spec -> 'kinds', '{}')) loop
    if v_key !~ '^[a-z][a-z0-9_]{1,19}$' or char_length(v_val) not between 1 and 40 then raise exception 'INVALID:kinds %', v_key; end if;
    v_kinds := v_kinds || jsonb_build_object(v_key, v_val);
  end loop;
  v_default := coalesce(v_spec ->> 'default', 'contribute');
  if core.level_rank(v_default) not between 1 and 4 then raise exception 'INVALID:default'; end if;
  v_out := jsonb_build_object('levels', v_levels, 'aliases', v_aliases, 'rights', v_specials, 'kinds', v_kinds, 'default', v_default);
  update core.tiles set access = v_out, rights = v_rights, updated_at = now() where id = p_tile;
  -- special rights the tile no longer declares leave every person and group
  update core.tile_access a set rights = array(select r from unnest(a.rights) r where r = any (v_rights))
  where a.tile_id = p_tile and not (a.rights <@ v_rights);
  update core.tile_group_access g set rights = array(select r from unnest(g.rights) r where r = any (v_rights))
  where g.tile_id = p_tile and not (g.rights <@ v_rights);
  insert into core.audit (user_id, username, tile_id, action, detail)
  values (auth.uid(), (select p.username from core.profiles p where p.id = auth.uid()), p_tile, 'tile_declare', v_out);
  return 'declared ' || p_tile;
end $$;
revoke execute on function core.tile_declare(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Containers (tiles call these inside their own functions)
-- ---------------------------------------------------------------------------

-- Register a container when the tile creates it (owner = the caller unless p_owner is given, e.g. when a tile's SQL
-- file registers what it already holds), or rename it. p_everyone: 'edit' (everyone in the tile, the default),
-- 'read' (everyone can view) or null (only the owner and the people / groups it is shared with).
create or replace function core.container_put(p_tile text, p_kind text, p_id text, p_name text,
                                              p_everyone text default 'edit', p_owner uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tile core.tiles; v_name text := left(trim(coalesce(p_name, '')), 200);
begin
  select * into v_tile from core.tiles t where t.id = p_tile;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not coalesce(v_tile.access -> 'kinds' ? p_kind, false) then raise exception 'INVALID:kind'; end if;
  if char_length(coalesce(p_id, '')) not between 1 and 100 then raise exception 'INVALID:id'; end if;
  if v_name = '' then raise exception 'INVALID:name'; end if;
  if p_everyone is not null and p_everyone not in ('read', 'edit') then raise exception 'INVALID:everyone'; end if;
  insert into core.containers (tile_id, kind, id, name, owner_id, everyone)
  values (p_tile, p_kind, p_id, v_name, coalesce(p_owner, auth.uid()), p_everyone)
  on conflict (tile_id, kind, id) do update set name = excluded.name, updated_at = now();
end $$;

-- Remove a container and its shares (when the tile deletes the thing for good).
create or replace function core.container_drop(p_tile text, p_kind text, p_id text)
returns void language sql security definer set search_path = '' as $$
  delete from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
$$;

-- For a tile's own SQL file moving existing sharing into the core (never from the page): share one container with a
-- person (p_user) or a group (p_group) at 'read' or 'edit'. The owner is never shared with himself.
create or replace function core.share_put(p_tile text, p_kind text, p_id text, p_user uuid, p_group uuid, p_level text default 'edit')
returns void language plpgsql security definer set search_path = '' as $$
declare v_c core.containers;
begin
  select * into v_c from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (p_user is null) = (p_group is null) or p_level not in ('read', 'edit') then raise exception 'INVALID:shares'; end if;
  if p_user is not null then
    if p_user is not distinct from v_c.owner_id or not exists (select 1 from core.profiles p where p.id = p_user) then return; end if;
    insert into core.shares (tile_id, kind, id, user_id, level) values (p_tile, p_kind, p_id, p_user, p_level)
    on conflict (tile_id, kind, id, user_id) where user_id is not null do update set level = excluded.level;
  else
    insert into core.shares (tile_id, kind, id, group_id, level) values (p_tile, p_kind, p_id, p_group, p_level)
    on conflict (tile_id, kind, id, group_id) where group_id is not null do update set level = excluded.level;
  end if;
end $$;

-- For a tile's own SQL file replacing a special right by a container (hvac-notes nb_<notebook>): everyone and every group
-- holding p_right on the tile gets a share of that container. Returns how many shares were made.
create or replace function core.shares_from_right(p_tile text, p_right text, p_kind text, p_id text, p_level text default 'edit')
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; v_r record;
begin
  for v_r in select a.user_id u, null::uuid g from core.tile_access a where a.tile_id = p_tile and p_right = any (a.rights)
             union all
             select null, ga.group_id from core.tile_group_access ga where ga.tile_id = p_tile and p_right = any (ga.rights) loop
    perform core.share_put(p_tile, p_kind, p_id, v_r.u, v_r.g, p_level);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- The user's level on one container: null = he may not open it (the tile answers NOT_FOUND).
-- Manager of the tile: manage. Owner: his tile level. Shared "Can edit" (him, a group of his, or everyone): his tile
-- level. Shared "Can view": read. The tile level is always the ceiling; no tile, no access.
create or replace function core.container_level(p_user uuid, p_tile text, p_kind text, p_id text)
returns text language plpgsql security definer set search_path = '' stable as $$
declare v_level text; v_c core.containers; v_acc integer;
begin
  if not core.has_tile(p_user, p_tile, null) then return null; end if;
  select * into v_c from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
  if not found then return null; end if;
  v_level := core.tile_level(p_user, p_tile);
  if v_level = 'manage' then return 'manage'; end if;
  if v_c.owner_id = p_user then return v_level; end if;
  select max(core.level_rank(z.x)) into v_acc from (
    select v_c.everyone x
    union all
    select s.level from core.shares s where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id and s.user_id = p_user
    union all
    select s.level from core.shares s join core.group_members m on m.group_id = s.group_id
    where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id and m.user_id = p_user) z;
  if coalesce(v_acc, 0) = 0 then return null; end if;
  if v_acc >= 3 then return v_level; end if;
  return 'read';
end $$;

-- First line of a tile function that works on one container: the caller's profile, or
-- SIGNED_OUT / NOT_APPROVED / NO_ACCESS / NOT_FOUND (may not open it: never a hint it exists) / NO_RIGHT.
create or replace function core.require_container(p_tile text, p_kind text, p_id text, p_level text default 'read')
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_level text;
begin
  v_user := core.require_tile(p_tile, null);
  v_level := core.container_level(v_user.id, p_tile, p_kind, p_id);
  if v_level is null then raise exception 'NOT_FOUND'; end if;
  if core.level_rank(v_level) < core.level_rank(coalesce(p_level, 'read')) then raise exception 'NO_RIGHT'; end if;
  return v_user;
end $$;

-- Ids of the containers of one kind the caller may open (at least p_level): for list pages.
create or replace function core.container_ids(p_tile text, p_kind text, p_level text default 'read')
returns setof text language plpgsql security definer set search_path = '' stable as $$
declare v_uid uuid := auth.uid();
begin
  if not core.has_tile(v_uid, p_tile, null) then return; end if;
  return query
    select c.id from core.containers c
    where c.tile_id = p_tile and c.kind = p_kind
      and core.level_rank(core.container_level(v_uid, p_tile, p_kind, c.id)) >= core.level_rank(coalesce(p_level, 'read'));
end $$;

-- What a list may show about one container for the caller: owner, how it is shared, his level. Null when he may not open it.
create or replace function core.container_info(p_tile text, p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_uid uuid := auth.uid(); v_level text; v_c core.containers;
begin
  v_level := core.container_level(v_uid, p_tile, p_kind, p_id);
  if v_level is null then return null; end if;
  select * into v_c from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
  return jsonb_build_object('level', v_level, 'mine', v_c.owner_id = v_uid, 'owner_id', v_c.owner_id,
    'owner_name', (select p.display_name from core.profiles p where p.id = v_c.owner_id),
    'everyone', v_c.everyone,
    'shared', (select count(*) from core.shares s where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id));
end $$;

revoke execute on function core.level_rank(text), core.level_of(integer), core.tile_level(uuid, text),
  core.tile_specials(uuid, text), core.require_level(text, text), core.tile_held(uuid, text), core.levels_upto(text),
  core.container_put(text, text, text, text, text, uuid), core.container_drop(text, text, text),
  core.share_put(text, text, text, uuid, uuid, text), core.shares_from_right(text, text, text, text, text),
  core.require_container(text, text, text, text), core.container_ids(text, text, text), core.container_info(text, text, text)
  from public, anon, authenticated;
revoke execute on function core.tile_access_sync() from public, anon, authenticated;
-- Storage policies run as the caller: container_level joins has_tile / is_tile_admin / username_of in the callable set.
revoke execute on function core.container_level(uuid, text, text, text) from public, anon;
grant execute on function core.container_level(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Page load: core_me and the dashboard now carry the level
-- ---------------------------------------------------------------------------
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
                               'levels', coalesce(v_tile.access -> 'levels', '{}'), 'kinds', coalesce(v_tile.access -> 'kinds', '{}')),
    'tile_admin', v_level = 'manage',
    'level', v_level,
    'levels', to_jsonb(core.levels_upto(v_level)),
    'rights', to_jsonb(core.tile_held(v_user.id, p_tile)));
end $$;
revoke execute on function public.core_me(text) from public, anon;
grant execute on function public.core_me(text) to authenticated;

drop function if exists public.core_my_tiles();
create function public.core_my_tiles()
returns table (id text, name text, tagline text, icon text, accent text, level text, is_admin boolean, rights text[])
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_user();
  return query
    select t.id, t.name, t.tagline, t.icon, t.accent, core.tile_level(v_user.id, t.id),
           core.tile_level(v_user.id, t.id) = 'manage', core.tile_held(v_user.id, t.id)
    from core.tiles t
    where t.enabled and core.tile_level(v_user.id, t.id) is not null
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_my_tiles() from public, anon;
grant execute on function public.core_my_tiles() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Access to a tile: managers (and the super user) give levels to people and groups
-- ---------------------------------------------------------------------------
-- Everything the access page shows for one tile.
create or replace function public.core_tile_access_list(p_tile text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_tile core.tiles;
begin
  v_me := core.require_user();
  if not core.is_tile_admin(v_me.id, p_tile) then raise exception 'NO_RIGHT'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  return jsonb_build_object(
    'tile', jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'rights', to_jsonb(v_tile.rights), 'access', v_tile.access),
    'can_name_managers', v_me.is_super, 'me', v_me.id,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
        'level', a.level, 'rights', to_jsonb(coalesce(a.rights, '{}'::text[])),
        'via', coalesce((select jsonb_agg(jsonb_build_object('group', g.name, 'level', ga.level) order by g.name)
                         from core.group_members m join core.groups g on g.id = m.group_id
                         join core.tile_group_access ga on ga.group_id = g.id and ga.tile_id = p_tile
                         where m.user_id = p.id), '[]'::jsonb),
        'effective', core.tile_level(p.id, p_tile))
      order by (a.user_id is null), p.username)
      from core.profiles p left join core.tile_access a on a.user_id = p.id and a.tile_id = p_tile
      where p.status = 'active' and not p.is_super), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'note', g.note,
        'members', (select count(*) from core.group_members m join core.profiles p on p.id = m.user_id
                    where m.group_id = g.id and p.status = 'active'),
        'level', ga.level, 'rights', to_jsonb(coalesce(ga.rights, '{}'::text[])))
      order by (ga.group_id is null), lower(g.name))
      from core.groups g left join core.tile_group_access ga on ga.group_id = g.id and ga.tile_id = p_tile), '[]'::jsonb));
end $$;
revoke execute on function public.core_tile_access_list(text) from public, anon;
grant execute on function public.core_tile_access_list(text) to authenticated;

-- Give, change or remove a level (p_level null = no access) and special rights (null = keep) for a person or a group.
-- Only the super user gives or takes the level manage. A manager does not change his own access.
create or replace function public.core_tile_level_set(p_tile text, p_type text, p_id uuid, p_level text, p_rights text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_tile core.tiles; v_user core.profiles; v_group core.groups; v_old text; v_had boolean;
        v_level text := nullif(lower(trim(coalesce(p_level, ''))), ''); v_rights text[]; v_right text; v_who text;
begin
  v_me := core.require_user();
  if not core.is_tile_admin(v_me.id, p_tile) then raise exception 'NO_RIGHT'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  if p_type not in ('user', 'group') then raise exception 'INVALID:type'; end if;
  if v_level is not null and core.level_rank(v_level) = 0 then raise exception 'INVALID:level'; end if;
  if p_rights is not null then
    v_rights := '{}';
    foreach v_right in array p_rights loop
      v_right := lower(trim(v_right));
      if v_right = '' then continue; end if;
      if not (v_right = any (v_tile.rights)) then raise exception 'INVALID:rights'; end if;
      if not (v_right = any (v_rights)) then v_rights := v_rights || v_right; end if;
    end loop;
  end if;

  if p_type = 'user' then
    select * into v_user from core.profiles p where p.id = p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_user.is_super or (v_user.id = v_me.id and not v_me.is_super) then raise exception 'INVALID:user'; end if;
    select a.level into v_old from core.tile_access a where a.user_id = p_id and a.tile_id = p_tile;
    v_had := found;
    if (v_level = 'manage' or v_old = 'manage') and v_level is distinct from v_old and not v_me.is_super then raise exception 'NO_RIGHT'; end if;
    v_who := v_user.username;
    if v_level is null then
      delete from core.tile_access where user_id = p_id and tile_id = p_tile;
    else
      if v_user.status <> 'active' then raise exception 'INVALID:user'; end if;
      insert into core.tile_access (user_id, tile_id, level, rights, granted_by)
      values (p_id, p_tile, v_level, coalesce(v_rights, '{}'), v_me.id)
      on conflict (user_id, tile_id) do update
        set level = excluded.level, rights = coalesce(v_rights, core.tile_access.rights), granted_by = v_me.id, granted_at = now();
    end if;
  else
    select * into v_group from core.groups g where g.id = p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    select ga.level into v_old from core.tile_group_access ga where ga.group_id = p_id and ga.tile_id = p_tile;
    v_had := found;
    if (v_level = 'manage' or v_old = 'manage') and v_level is distinct from v_old and not v_me.is_super then raise exception 'NO_RIGHT'; end if;
    if not v_me.is_super and exists (select 1 from core.group_members m where m.group_id = p_id and m.user_id = v_me.id) then
      raise exception 'INVALID:group';   -- a manager does not change a group he is in (his own access)
    end if;
    v_who := 'group ' || v_group.name;
    if v_level is null then
      delete from core.tile_group_access where group_id = p_id and tile_id = p_tile;
    else
      insert into core.tile_group_access (tile_id, group_id, level, rights, granted_by)
      values (p_tile, p_id, v_level, coalesce(v_rights, '{}'), v_me.id)
      on conflict (tile_id, group_id) do update
        set level = excluded.level, rights = coalesce(v_rights, core.tile_group_access.rights), granted_by = v_me.id, granted_at = now();
    end if;
  end if;
  if v_had or v_level is not null then
    perform core.audit(p_tile, case when v_level is null then 'access_remove' when v_had then 'access_update' else 'access_grant' end,
      jsonb_build_object(p_type, v_who, 'level', v_level, 'was', v_old, 'rights', to_jsonb(v_rights)));
  end if;
  return jsonb_build_object('type', p_type, 'id', p_id, 'level', v_level);
end $$;
revoke execute on function public.core_tile_level_set(text, text, uuid, text, text[]) from public, anon;
grant execute on function public.core_tile_level_set(text, text, uuid, text, text[]) to authenticated;

-- 001's access door, kept for anything still calling it: admin = manage, otherwise the tile's default level.
create or replace function public.core_tile_access_set(p_tile text, p_user uuid, p_access boolean,
                                                        p_rights text[] default null, p_admin boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_tile core.tiles; v_old text; v_level text;
begin
  v_me := core.require_user();
  if not core.is_tile_admin(v_me.id, p_tile) then raise exception 'NO_RIGHT'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from core.profiles p where p.id = p_user) then raise exception 'NOT_FOUND'; end if;
  if not coalesce(p_access, false) then
    perform public.core_tile_level_set(p_tile, 'user', p_user, null, null);
    return jsonb_build_object('username', core.username_of(p_user), 'has_access', false);
  end if;
  if exists (select 1 from core.profiles p where p.id = p_user and p.status <> 'active') then raise exception 'INVALID:user'; end if;
  select a.level into v_old from core.tile_access a where a.user_id = p_user and a.tile_id = p_tile;
  v_level := case when p_admin then 'manage'
                  when p_admin = false and v_old = 'manage' then coalesce(v_tile.access ->> 'default', 'contribute')
                  else coalesce(v_old, v_tile.access ->> 'default', 'contribute') end;
  perform public.core_tile_level_set(p_tile, 'user', p_user, v_level, case when p_rights is null and v_old is null then '{}'::text[] else p_rights end);
  return jsonb_build_object('username', core.username_of(p_user), 'has_access', true);
end $$;

-- 001's list for the old access panel, now from levels.
create or replace function public.core_tile_users(p_tile text)
returns table (id uuid, username text, display_name text, has_access boolean, is_admin boolean, rights text[])
language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles;
begin
  v_me := core.require_user();
  if not core.is_tile_admin(v_me.id, p_tile) then raise exception 'NO_RIGHT'; end if;
  return query
    select p.id, p.username, p.display_name, a.user_id is not null, coalesce(a.level = 'manage', false), coalesce(a.rights, '{}'::text[])
    from core.profiles p
    left join core.tile_access a on a.user_id = p.id and a.tile_id = p_tile
    where p.status = 'active' and not p.is_super
    order by (a.user_id is null), p.username;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The Access panel of a container (every tile opens it with Core.share)
-- ---------------------------------------------------------------------------
create or replace function core.share_view(p_tile text, p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_uid uuid := auth.uid(); v_c core.containers; v_tile core.tiles; v_level text; v_tl text;
begin
  select * into v_c from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
  select * into v_tile from core.tiles t where t.id = p_tile;
  v_level := core.container_level(v_uid, p_tile, p_kind, p_id);
  v_tl := core.tile_level(v_uid, p_tile);
  return jsonb_build_object(
    'tile', jsonb_build_object('id', v_tile.id, 'name', v_tile.name),
    'kind', p_kind, 'kind_label', coalesce(v_tile.access -> 'kinds' ->> p_kind, p_kind), 'id', p_id, 'name', v_c.name,
    'everyone', v_c.everyone, 'level', v_level,
    'can_share', v_level = 'manage' or (v_c.owner_id = v_uid and core.level_rank(v_tl) >= 2),
    'can_change_owner', v_level = 'manage',
    'owner', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'active', p.status = 'active')
              from core.profiles p where p.id = v_c.owner_id),
    'shares', coalesce((select jsonb_agg(x order by x ->> 'type' desc, lower(x ->> 'name')) from (
        select jsonb_build_object('type', 'user', 'id', p.id, 'name', p.display_name, 'username', p.username, 'level', s.level,
                                  'active', p.status = 'active', 'has_tile', core.tile_level(p.id, p_tile) is not null) x
        from core.shares s join core.profiles p on p.id = s.user_id
        where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id
        union all
        select jsonb_build_object('type', 'group', 'id', g.id, 'name', g.name, 'level', s.level,
                                  'members', (select count(*) from core.group_members m where m.group_id = g.id))
        from core.shares s join core.groups g on g.id = s.group_id
        where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id) q), '[]'::jsonb));
end $$;
revoke execute on function core.share_view(text, text, text) from public, anon, authenticated;

-- Anyone who may open the container sees who else may.
create or replace function public.core_share_get(p_tile text, p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_container(p_tile, p_kind, p_id, 'read');
  return core.share_view(p_tile, p_kind, p_id);
end $$;
revoke execute on function public.core_share_get(text, text, text) from public, anon;
grant execute on function public.core_share_get(text, text, text) to authenticated;

-- Who can open it: p_everyone 'edit' | 'read' | null, and the list [{ type: user|group, id, level: read|edit }].
-- The owner (with at least contribute in the tile) and the tile's managers change it.
create or replace function public.core_share_set(p_tile text, p_kind text, p_id text, p_everyone text, p_shares jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_view jsonb; v_c core.containers; v_item jsonb; v_type text; v_level text; v_pid uuid;
        v_everyone text := nullif(trim(coalesce(p_everyone, '')), ''); v_n integer := 0;
begin
  v_me := core.require_container(p_tile, p_kind, p_id, 'read');
  v_view := core.share_view(p_tile, p_kind, p_id);
  if not (v_view ->> 'can_share')::boolean then raise exception 'NO_RIGHT'; end if;
  if v_everyone is not null and v_everyone not in ('read', 'edit') then raise exception 'INVALID:everyone'; end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) > 200 then raise exception 'INVALID:shares'; end if;
  select * into v_c from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
  update core.containers set everyone = v_everyone, updated_at = now() where tile_id = p_tile and kind = p_kind and id = p_id;
  delete from core.shares s where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id;
  for v_item in select value from jsonb_array_elements(p_shares) loop
    v_type := v_item ->> 'type'; v_level := v_item ->> 'level';
    begin v_pid := (v_item ->> 'id')::uuid; exception when others then raise exception 'INVALID:shares'; end;
    if v_level not in ('read', 'edit') or v_pid is null then raise exception 'INVALID:shares'; end if;
    if v_type = 'user' then
      if not exists (select 1 from core.profiles p where p.id = v_pid and p.status = 'active') then raise exception 'INVALID:user'; end if;
      if v_pid is not distinct from v_c.owner_id then continue; end if;
      insert into core.shares (tile_id, kind, id, user_id, level, added_by) values (p_tile, p_kind, p_id, v_pid, v_level, v_me.id)
      on conflict (tile_id, kind, id, user_id) where user_id is not null do update set level = excluded.level;
    elsif v_type = 'group' then
      if not exists (select 1 from core.groups g where g.id = v_pid) then raise exception 'INVALID:group'; end if;
      insert into core.shares (tile_id, kind, id, group_id, level, added_by) values (p_tile, p_kind, p_id, v_pid, v_level, v_me.id)
      on conflict (tile_id, kind, id, group_id) where group_id is not null do update set level = excluded.level;
    else
      raise exception 'INVALID:shares';
    end if;
    v_n := v_n + 1;
  end loop;
  perform core.audit(p_tile, 'share_set', jsonb_build_object('kind', p_kind, 'id', p_id, 'name', v_c.name,
    'everyone', v_everyone, 'shares', v_n));
  return core.share_view(p_tile, p_kind, p_id);
end $$;
revoke execute on function public.core_share_set(text, text, text, text, jsonb) from public, anon;
grant execute on function public.core_share_set(text, text, text, text, jsonb) to authenticated;

-- People and groups the Access panel offers: people who can open the tile, and every group.
create or replace function public.core_share_people(p_tile text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_tile(p_tile, null);
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name)
                        order by u.username) from core.tile_users(p_tile) u), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                          'members', (select count(*) from core.group_members m where m.group_id = g.id)) order by lower(g.name))
                        from core.groups g), '[]'::jsonb));
end $$;
revoke execute on function public.core_share_people(text) from public, anon;
grant execute on function public.core_share_people(text) to authenticated;

-- A tile manager hands one container to another person who has the tile.
create or replace function public.core_share_owner_set(p_tile text, p_kind text, p_id text, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c core.containers;
begin
  perform core.require_container(p_tile, p_kind, p_id, 'manage');
  if core.tile_level(p_user, p_tile) is null then raise exception 'INVALID:user'; end if;
  select * into v_c from core.containers c where c.tile_id = p_tile and c.kind = p_kind and c.id = p_id;
  update core.containers set owner_id = p_user, updated_at = now() where tile_id = p_tile and kind = p_kind and id = p_id;
  delete from core.shares s where s.tile_id = p_tile and s.kind = p_kind and s.id = p_id and s.user_id = p_user;
  perform core.audit(p_tile, 'owner_set', jsonb_build_object('kind', p_kind, 'id', p_id, 'name', v_c.name,
    'from', core.username_of(v_c.owner_id), 'to', core.username_of(p_user)));
  return core.share_view(p_tile, p_kind, p_id);
end $$;
revoke execute on function public.core_share_owner_set(text, text, text, uuid) from public, anon;
grant execute on function public.core_share_owner_set(text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Super user: groups, Check access, Handover; lists that now know levels and groups
-- ---------------------------------------------------------------------------
create or replace function public.core_admin_groups()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'note', g.note, 'created_at', g.created_at,
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
                            'status', p.status) order by p.username)
                          from core.group_members m join core.profiles p on p.id = m.user_id where m.group_id = g.id), '[]'::jsonb),
      'tiles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'level', ga.level) order by t.sort_order, t.name)
                        from core.tile_group_access ga join core.tiles t on t.id = ga.tile_id where ga.group_id = g.id), '[]'::jsonb),
      'shares', (select count(*) from core.shares s where s.group_id = g.id))
    order by lower(g.name)) from core.groups g), '[]'::jsonb);
end $$;
revoke execute on function public.core_admin_groups() from public, anon;
grant execute on function public.core_admin_groups() to authenticated;

create or replace function public.core_admin_group_save(p_id uuid, p_name text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_name text := trim(coalesce(p_name, '')); v_note text := trim(coalesce(p_note, '')); v_id uuid;
begin
  v_me := core.require_super();
  if char_length(v_name) not between 2 and 40 then raise exception 'INVALID:name'; end if;
  if char_length(v_note) > 200 then raise exception 'INVALID:note'; end if;
  if exists (select 1 from core.groups g where lower(g.name) = lower(v_name) and g.id is distinct from p_id) then
    raise exception 'TAKEN:group';
  end if;
  if p_id is null then
    insert into core.groups (name, note, created_by) values (v_name, v_note, v_me.id) returning id into v_id;
    perform core.audit(null, 'group_create', jsonb_build_object('group', v_name));
  else
    update core.groups set name = v_name, note = v_note, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
    perform core.audit(null, 'group_update', jsonb_build_object('group', v_name));
  end if;
  return jsonb_build_object('id', v_id, 'name', v_name);
end $$;
revoke execute on function public.core_admin_group_save(uuid, text, text) from public, anon;
grant execute on function public.core_admin_group_save(uuid, text, text) to authenticated;

-- Members replace the list. Pending accounts cannot be members; disabled ones may stay (they reach nothing).
create or replace function public.core_admin_group_members_set(p_group uuid, p_users uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_g core.groups; v_users uuid[] := coalesce(p_users, '{}'::uuid[]);
begin
  v_me := core.require_super();
  select * into v_g from core.groups g where g.id = p_group;
  if not found then raise exception 'NOT_FOUND'; end if;
  if cardinality(v_users) > 500 then raise exception 'INVALID:users'; end if;
  if exists (select 1 from unnest(v_users) u where not exists (select 1 from core.profiles p where p.id = u and p.status in ('active', 'disabled'))) then
    raise exception 'INVALID:user';
  end if;
  delete from core.group_members m where m.group_id = p_group and not (m.user_id = any (v_users));
  insert into core.group_members (group_id, user_id, added_by)
  select p_group, u, v_me.id from (select distinct unnest(v_users) u) s
  on conflict (group_id, user_id) do nothing;
  perform core.audit(null, 'group_members', jsonb_build_object('group', v_g.name,
    'members', (select to_jsonb(coalesce(array_agg(p.username order by p.username), '{}')) from core.group_members m
                join core.profiles p on p.id = m.user_id where m.group_id = p_group)));
  return jsonb_build_object('id', p_group, 'members', (select count(*) from core.group_members m where m.group_id = p_group));
end $$;
revoke execute on function public.core_admin_group_members_set(uuid, uuid[]) from public, anon;
grant execute on function public.core_admin_group_members_set(uuid, uuid[]) to authenticated;

-- Deleting a group takes its tile levels and shares with it; its members keep their own access.
create or replace function public.core_admin_group_delete(p_id uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_g core.groups;
begin
  perform core.require_super();
  select * into v_g from core.groups g where g.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if lower(trim(coalesce(p_confirm, ''))) <> lower(v_g.name) then raise exception 'INVALID:confirm'; end if;
  delete from core.groups where id = p_id;
  perform core.audit(null, 'group_delete', jsonb_build_object('group', v_g.name));
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;
revoke execute on function public.core_admin_group_delete(uuid, text) from public, anon;
grant execute on function public.core_admin_group_delete(uuid, text) to authenticated;

-- Check access: everything one person can reach, and why.
create or replace function public.core_admin_check_access(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_u core.profiles;
begin
  perform core.require_super();
  select * into v_u from core.profiles p where p.id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', v_u.id, 'username', v_u.username, 'display_name', v_u.display_name, 'status', v_u.status, 'is_super', v_u.is_super),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by lower(g.name))
                        from core.group_members m join core.groups g on g.id = m.group_id where m.user_id = p_user), '[]'::jsonb),
    'tiles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'enabled', t.enabled,
        'level', case when v_u.is_super then 'manage' else (select core.level_of(max(core.level_rank(x.l))) from (
                   select a.level l from core.tile_access a where a.user_id = p_user and a.tile_id = t.id
                   union all select ga.level from core.tile_group_access ga join core.group_members m on m.group_id = ga.group_id
                   where ga.tile_id = t.id and m.user_id = p_user) x) end,
        'own', (select a.level from core.tile_access a where a.user_id = p_user and a.tile_id = t.id),
        'via', coalesce((select jsonb_agg(jsonb_build_object('group', g.name, 'level', ga.level) order by g.name)
                         from core.tile_group_access ga join core.group_members m on m.group_id = ga.group_id
                         join core.groups g on g.id = ga.group_id where ga.tile_id = t.id and m.user_id = p_user), '[]'::jsonb),
        'rights', to_jsonb(core.tile_specials(p_user, t.id)),
        'owns', (select count(*) from core.containers c where c.tile_id = t.id and c.owner_id = p_user),
        'shared', (select count(distinct (s.kind, s.id)) from core.shares s where s.tile_id = t.id
                   and (s.user_id = p_user or s.group_id in (select m.group_id from core.group_members m where m.user_id = p_user))))
      order by t.sort_order, t.name)
      from core.tiles t
      where v_u.is_super
         or exists (select 1 from core.tile_access a where a.user_id = p_user and a.tile_id = t.id)
         or exists (select 1 from core.tile_group_access ga join core.group_members m on m.group_id = ga.group_id
                    where ga.tile_id = t.id and m.user_id = p_user)
         or exists (select 1 from core.containers c where c.tile_id = t.id and c.owner_id = p_user)), '[]'::jsonb),
    'owns', coalesce((select jsonb_agg(jsonb_build_object('tile', c.tile_id, 'kind', c.kind, 'id', c.id, 'name', c.name, 'everyone', c.everyone)
                      order by c.tile_id, c.kind, lower(c.name)) from core.containers c where c.owner_id = p_user), '[]'::jsonb),
    'shared', coalesce((select jsonb_agg(x order by x ->> 'tile', lower(x ->> 'name')) from (
        select distinct on (c.tile_id, c.kind, c.id) jsonb_build_object('tile', c.tile_id, 'kind', c.kind, 'id', c.id, 'name', c.name,
          'level', s.level, 'via', coalesce(g.name, 'direct')) x
        from core.shares s join core.containers c on c.tile_id = s.tile_id and c.kind = s.kind and c.id = s.id
        left join core.groups g on g.id = s.group_id
        where s.user_id = p_user or s.group_id in (select m.group_id from core.group_members m where m.user_id = p_user)
        order by c.tile_id, c.kind, c.id, core.level_rank(s.level) desc) q), '[]'::jsonb));
end $$;
revoke execute on function public.core_admin_check_access(uuid) from public, anon;
grant execute on function public.core_admin_check_access(uuid) to authenticated;

-- Handover: every container p_from owns (in one tile, or all) moves to p_to. Says which tiles p_to cannot open.
create or replace function public.core_admin_handover(p_from uuid, p_to uuid, p_tile text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_from core.profiles; v_to core.profiles; v_n integer; v_tiles text[]; v_missing text[];
begin
  perform core.require_super();
  select * into v_from from core.profiles p where p.id = p_from;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_to from core.profiles p where p.id = p_to;
  if not found or v_to.status <> 'active' or p_to = p_from then raise exception 'INVALID:user'; end if;
  select coalesce(array_agg(distinct c.tile_id), '{}') into v_tiles from core.containers c
  where c.owner_id = p_from and (p_tile is null or c.tile_id = p_tile);
  update core.containers set owner_id = p_to, updated_at = now() where owner_id = p_from and (p_tile is null or tile_id = p_tile);
  get diagnostics v_n = row_count;
  -- the new owner no longer needs a share on what he now owns
  delete from core.shares s using core.containers c
  where s.user_id = p_to and c.tile_id = s.tile_id and c.kind = s.kind and c.id = s.id and c.owner_id = p_to;
  select coalesce(array_agg(t order by t), '{}') into v_missing from unnest(v_tiles) t where core.tile_level(p_to, t) is null;
  perform core.audit(p_tile, 'handover', jsonb_build_object('from', v_from.username, 'to', v_to.username, 'moved', v_n));
  return jsonb_build_object('moved', v_n, 'tiles', to_jsonb(v_tiles), 'without_access', to_jsonb(v_missing));
end $$;
revoke execute on function public.core_admin_handover(uuid, uuid, text) from public, anon;
grant execute on function public.core_admin_handover(uuid, uuid, text) to authenticated;

-- Users list: the tiles column now counts tiles reached through groups too.
create or replace function public.core_admin_users(p_status text default null)
returns table (id uuid, username text, display_name text, email text, status text, is_super boolean,
               created_at timestamptz, approved_at timestamptz, last_sign_in timestamptz, tiles text[])
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select p.id, p.username, p.display_name, u.email::text, p.status, p.is_super, p.created_at, p.approved_at, p.session_started_at,
           coalesce((select array_agg(distinct x.t order by x.t) from (
               select a.tile_id t from core.tile_access a where a.user_id = p.id
               union select ga.tile_id from core.tile_group_access ga join core.group_members m on m.group_id = ga.group_id
               where m.user_id = p.id) x), '{}'::text[])
    from core.profiles p
    left join auth.users u on u.id = p.id
    where p_status is null or p.status = p_status
    order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end, p.username;
end $$;

drop function if exists public.core_admin_tiles();
create function public.core_admin_tiles()
returns table (id text, name text, tagline text, icon text, accent text, sort_order integer, enabled boolean,
               rights text[], access jsonb, users integer, groups integer, admins text[], containers integer)
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
           (select count(*)::integer from core.containers c where c.tile_id = t.id)
    from core.tiles t
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_admin_tiles() from public, anon;
grant execute on function public.core_admin_tiles() to authenticated;

-- Tile form: once a tile has declared itself (core.tile_declare), its rights come from the declaration only.
create or replace function public.core_admin_tile_save(p_id text, p_name text, p_tagline text, p_icon text, p_accent text,
                                                        p_sort_order integer, p_rights text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text := lower(trim(coalesce(p_id, ''))); v_accent text := lower(trim(coalesce(p_accent, 'blue')));
        v_rights text[]; v_right text; v_new boolean; v_declared boolean;
begin
  perform core.require_super();
  if v_id !~ '^[a-z0-9][a-z0-9-]{1,29}$' or v_id = 'dame-hub' then raise exception 'INVALID:id'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'INVALID:name'; end if;
  if char_length(coalesce(p_tagline, '')) > 80 then raise exception 'INVALID:tagline'; end if;
  if coalesce(p_icon, '') !~ '^[a-z0-9-]{1,30}$' then raise exception 'INVALID:icon'; end if;
  if v_accent not in ('blue', 'teal', 'green', 'orange', 'violet', 'rose', 'slate') then raise exception 'INVALID:accent'; end if;
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
  v_new := not exists (select 1 from core.tiles t where t.id = v_id);
  insert into core.tiles (id, name, tagline, icon, accent, sort_order, rights)
  values (v_id, trim(p_name), coalesce(p_tagline, ''), p_icon, v_accent, coalesce(p_sort_order, 100), v_rights)
  on conflict (id) do update
    set name = excluded.name, tagline = excluded.tagline, icon = excluded.icon, accent = excluded.accent,
        sort_order = excluded.sort_order, rights = excluded.rights, updated_at = now();
  update core.tile_access a set rights = array(select r from unnest(a.rights) r where r = any (v_rights))
  where a.tile_id = v_id and not (a.rights <@ v_rights);
  update core.tile_group_access g set rights = array(select r from unnest(g.rights) r where r = any (v_rights))
  where g.tile_id = v_id and not (g.rights <@ v_rights);
  perform core.audit(v_id, case when v_new then 'tile_create' else 'tile_update' end,
                     jsonb_build_object('name', trim(p_name), 'accent', v_accent, 'rights', to_jsonb(v_rights)));
  return jsonb_build_object('id', v_id, 'created', v_new, 'declared', v_declared);
end $$;

-- Delete (008), now refused while the account still owns containers: hand them over first (Check access).
create or replace function public.core_admin_delete_user(p_user uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_user core.profiles; v_tiles text[];
begin
  v_me := core.require_super();
  select * into v_user from core.profiles p where p.id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user.id = v_me.id or v_user.is_super then raise exception 'INVALID:user'; end if;
  if lower(trim(coalesce(p_confirm, ''))) <> v_user.username then raise exception 'INVALID:confirm'; end if;
  if exists (select 1 from core.containers c where c.owner_id = v_user.id) then raise exception 'IN_USE:containers'; end if;
  select coalesce(array_agg(a.tile_id order by a.tile_id), '{}') into v_tiles from core.tile_access a where a.user_id = v_user.id;
  begin
    insert into core.username_history (username, user_id) values (v_user.username, v_user.id)
    on conflict (username) do update set user_id = excluded.user_id, retired_at = now();
    delete from auth.users u where u.id = v_user.id;   -- cascades: sessions, identities, profile, tile access, groups, shares
  exception when foreign_key_violation then
    raise exception 'IN_USE:user';
  end;
  perform core.audit(null, 'user_delete', jsonb_build_object('user', v_user.username, 'display_name', v_user.display_name,
    'status', v_user.status, 'tiles', to_jsonb(v_tiles)));
  return jsonb_build_object('username', v_user.username, 'deleted', true);
end $$;

-- ---------------------------------------------------------------------------
-- 11a. core.security_check(): unchanged except rule h (pg_cron's own two policies; hvac-notes core request 2026-11-06)
-- ---------------------------------------------------------------------------
create or replace function core.security_check()
returns table (problem text, object text)
language plpgsql security definer set search_path = '' as $$
declare v_system text[] := array['pg_catalog','information_schema','auth','storage','realtime','vault','extensions',
  'graphql','graphql_public','net','pgsodium','pgsodium_masks','supabase_functions','supabase_migrations','_realtime',
  'pgbouncer','cron','pgmq','pgtle','repack','topology','tiger','tiger_data','_analytics','_supavisor'];
begin
  -- a. table without RLS in any of our schemas
  return query
    select 'table without RLS', n.nspname || '.' || c.relname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relrowsecurity
      and not (n.nspname = any (v_system)) and n.nspname not like 'pg\_%';
  -- b. anything in public that is not a function
  return query
    select 'non-function object in public', (c.relname || ' (' || c.relkind::text || ')')::text
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f');
  -- c. public function without an allowed prefix (core_ or a registered tile)
  return query
    select 'public function without allowed prefix', p.proname::text
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not (p.proname like 'core\_%')
      and not exists (select 1 from core.tiles t where p.proname like replace(t.id, '-', '_') || '\_%');
  -- d. public function executable by anon (other than core_site_info)
  return query
    select 'function executable by anon', n.nspname || '.' || p.proname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where not (n.nspname = any (v_system)) and n.nspname not like 'pg\_%'
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not (n.nspname = 'public' and p.proname = 'core_site_info')
      and pg_catalog.has_function_privilege('anon', p.oid, 'execute');
  -- e. public function that is not security definer or has no empty search_path
  return query
    select 'public function not security definer with search_path = ''''', p.proname::text
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (not p.prosecdef or p.proconfig is null or not ('search_path=' = any (p.proconfig) or 'search_path=""' = any (p.proconfig)));
  -- f. table in our schemas readable or writable by anon or authenticated directly
  return query
    select 'table granted to ' || r.rolname, n.nspname || '.' || c.relname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
    where c.relkind in ('r', 'p', 'v', 'm') and not (n.nspname = any (v_system)) and n.nspname not like 'pg\_%'
      and (pg_catalog.has_table_privilege(r.rolname, c.oid, 'select') or pg_catalog.has_table_privilege(r.rolname, c.oid, 'insert')
           or pg_catalog.has_table_privilege(r.rolname, c.oid, 'update') or pg_catalog.has_table_privilege(r.rolname, c.oid, 'delete'));
  -- g. public bucket
  return query
    select 'public bucket', b.id::text from storage.buckets b where b.public;
  -- h. policy for anon or public (applies to anon) anywhere. Only exception: pg_cron's own two policies (the nightly
  --    check needs pg_cron), and only exactly as pg_cron makes them: each database user sees his own jobs. Any other
  --    shape of them is reported again. (hvac-notes core request, 2026-11-06.)
  return query
    select 'policy for anon/public', n.nspname || '.' || c.relname || ': ' || pol.polname
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where (pol.polroles = '{0}'::oid[]
           or exists (select 1 from pg_catalog.pg_roles ro where ro.oid = any (pol.polroles) and ro.rolname = 'anon'))
      and not (n.nspname = 'cron'
               and ((c.relname = 'job' and pol.polname = 'cron_job_policy')
                    or (c.relname = 'job_run_details' and pol.polname = 'cron_job_run_details_policy'))
               and pol.polroles = '{0}'::oid[] and pol.polcmd = '*' and pol.polpermissive and pol.polwithcheck is null
               and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) ~ '^\(username = \(?CURRENT_USER\)?(::(text|name))?\)$');
  -- i. policy on our own tables (functions read them; a policy means direct access was intended)
  return query
    select 'policy on an internal table', n.nspname || '.' || c.relname || ': ' || pol.polname
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where not (n.nspname = any (v_system)) and n.nspname not like 'pg\_%';
end $$;

-- ---------------------------------------------------------------------------
-- 11. Declarations of the tiles registered today (each tile's own SQL may declare again later, for its own id).
--     Aliases keep every core.require_tile(tile, '<old right>') in the tiles' code working unchanged.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from core.tiles where id = 'projects') then
    perform core.tile_declare('projects', jsonb_build_object(
      'levels', jsonb_build_object(
        'read', 'Open the projects shared with him (view only)',
        'contribute', 'Create projects; read datasheets, convert specifications, fill and download compliance in the projects he may open',
        'edit', 'As contribute (no separate step in Projects yet)',
        'approve', 'The knowledge base: compliance review, Product Options, Matching rules',
        'manage', 'Every project, sharing, TL Review, people and access of the tile'),
      'aliases', jsonb_build_object('review', 'approve', 'edit', 'contribute'),
      'kinds', jsonb_build_object('project', 'Project'),
      'default', 'contribute'));
  end if;
  if exists (select 1 from core.tiles where id = 'hvac-notes') then
    perform core.tile_declare('hvac-notes', jsonb_build_object(
      'levels', jsonb_build_object(
        'read', 'Read the notebooks open to him',
        'contribute', 'Read; highlights, card notes and replies',
        'edit', 'Publish pages (Publish page), download all pages, remove anyone''s notes',
        'approve', 'As edit (approval still sits with managers until the tile moves to levels)',
        'manage', 'Approve and hide pages, notebook audience, people and access of the tile'),
      'aliases', jsonb_build_object('edit', 'edit'),
      'rights', (select coalesce(jsonb_object_agg(r, 'Read the ' || replace(substr(r, 4), '_', ' ') || ' notebook when it is set to Selected users'), '{}'::jsonb)
                 from core.tiles t, unnest(t.rights) r where t.id = 'hvac-notes' and r like 'nb\_%'),
      'kinds', jsonb_build_object('notebook', 'Notebook'),
      'default', 'contribute'));
  end if;
  if exists (select 1 from core.tiles where id = 'maps') then
    perform core.tile_declare('maps', jsonb_build_object(
      'levels', jsonb_build_object(
        'read', 'Read team maps and his own',
        'contribute', 'Add maps, edit his own and team-edit maps, import',
        'edit', 'As contribute',
        'approve', 'Verify branches, Review, send back',
        'manage', 'Every map (private ones too), settings and trash, people and access of the tile'),
      'aliases', jsonb_build_object('edit', 'contribute', 'verify', 'approve'),
      'kinds', jsonb_build_object('map', 'Map'),
      'default', 'contribute'));
  end if;
  if exists (select 1 from core.tiles where id = 'demo') then
    perform core.tile_declare('demo', jsonb_build_object(
      'levels', jsonb_build_object('read', 'Read the notes shared with him', 'contribute', 'Add notes and files, share his own notes',
                                   'manage', 'Every note, people and access of the tile'),
      'aliases', jsonb_build_object('edit', 'contribute'),
      'kinds', jsonb_build_object('note', 'Note'),
      'default', 'contribute'));
  end if;
  if exists (select 1 from core.tiles where id = 'tools') then
    perform core.tile_declare('tools', jsonb_build_object(
      'levels', jsonb_build_object('read', 'Use every tool (nothing is stored)'),
      'default', 'read'));
  end if;
end $$;

select core.applied('dame-hub', '011_access');
