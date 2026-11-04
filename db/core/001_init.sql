-- DAME core: schema, tables, security wall, core_* functions, security check.
-- Run as the owner in the Supabase SQL editor. Read it first. Never edit after it ran on live.
-- Touches: schema core, functions public.core_*, trigger on auth.users, default privileges in public.

-- ---------------------------------------------------------------------------
-- 0. Schema and privileges
-- ---------------------------------------------------------------------------
create schema if not exists core;

-- Nobody but the owner reaches core directly. Functions in public run as the owner (security definer).
revoke all on schema core from public, anon, authenticated;

-- From now on a function the owner creates, in any schema, is executable by nobody until a file grants it.
-- (Postgres gives PUBLIC execute by default; a schema-specific entry cannot undo the global default, so this is global.)
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies: only security definer functions read them)
-- ---------------------------------------------------------------------------
create table core.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  display_name         text not null check (char_length(display_name) between 1 and 60),
  status               text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  is_super             boolean not null default false,
  must_change_password boolean not null default false,
  session_id           uuid,
  session_started_at   timestamptz,
  approved_at          timestamptz,
  approved_by          uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table core.profiles enable row level security;

create table core.tiles (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,29}$'),
  name       text not null check (char_length(name) between 1 and 40),
  tagline    text not null default '' check (char_length(tagline) <= 80),
  icon       text not null default 'tile' check (icon ~ '^[a-z0-9-]{1,30}$'),
  sort_order integer not null default 100,
  enabled    boolean not null default false,
  rights     text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table core.tiles enable row level security;

create table core.tile_access (
  user_id    uuid not null references core.profiles (id) on delete cascade,
  tile_id    text not null references core.tiles (id) on delete cascade,
  is_admin   boolean not null default false,
  rights     text[] not null default '{}',
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, tile_id)
);
alter table core.tile_access enable row level security;

create table core.audit (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  user_id  uuid,
  username text,
  tile_id  text,
  action   text not null,
  detail   jsonb not null default '{}'
);
alter table core.audit enable row level security;
create index audit_at_idx on core.audit (at desc);

create table core.migrations (
  repo       text not null,
  name       text not null,
  applied_at timestamptz not null default now(),
  primary key (repo, name)
);
alter table core.migrations enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (schema core; tiles call these, never copy them)
-- ---------------------------------------------------------------------------

-- Writes an audit row for the current caller.
create or replace function core.audit(p_tile text, p_action text, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  select p.username into v_name from core.profiles p where p.id = v_uid;
  insert into core.audit (user_id, username, tile_id, action, detail)
  values (v_uid, v_name, p_tile, p_action, coalesce(p_detail, '{}'::jsonb));
end $$;

-- Last line of every SQL file. Refuses a file that already ran.
create or replace function core.applied(p_repo text, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from core.migrations m where m.repo = p_repo and m.name = p_name) then
    raise exception 'ALREADY_APPLIED: %/%', p_repo, p_name;
  end if;
  insert into core.migrations (repo, name) values (p_repo, p_name);
  return 'applied ' || p_repo || '/' || p_name;
end $$;

-- Signed in, same session as at sign-in, session younger than 12 hours. Any status.
create or replace function core.require_session()
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_sid text; v_user core.profiles;
begin
  if v_uid is null then raise exception 'SIGNED_OUT'; end if;
  select * into v_user from core.profiles p where p.id = v_uid;
  if not found then raise exception 'SIGNED_OUT'; end if;
  v_sid := auth.jwt() ->> 'session_id';
  if v_user.session_id is null or v_sid is null or v_user.session_id::text <> v_sid then
    raise exception 'SIGNED_OUT';
  end if;
  if v_user.session_started_at is null or v_user.session_started_at < now() - interval '12 hours' then
    raise exception 'SIGNED_OUT';
  end if;
  return v_user;
end $$;

-- Session ok and account active. First line of every function that reads or writes data.
create or replace function core.require_user()
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_session();
  if v_user.status <> 'active' then raise exception 'NOT_APPROVED'; end if;
  return v_user;
end $$;

-- True when the user is active and may open the tile (and has the right, when one is named).
-- Super users have every tile and every right. Tile admins have every declared right of their tile.
create or replace function core.has_tile(p_user uuid, p_tile text, p_right text default null)
returns boolean language plpgsql security definer set search_path = '' stable as $$
declare v_user core.profiles; v_tile core.tiles; v_access core.tile_access;
begin
  if p_user is null then return false; end if;
  select * into v_user from core.profiles p where p.id = p_user;
  if not found or v_user.status <> 'active' then return false; end if;
  select * into v_tile from core.tiles t where t.id = p_tile and t.enabled;
  if not found then return false; end if;
  if v_user.is_super then return true; end if;
  select * into v_access from core.tile_access a where a.user_id = p_user and a.tile_id = p_tile;
  if not found then return false; end if;
  if p_right is null then return true; end if;
  if v_access.is_admin then return p_right = any (v_tile.rights); end if;
  return p_right = any (v_access.rights);
end $$;

create or replace function core.is_tile_admin(p_user uuid, p_tile text)
returns boolean language plpgsql security definer set search_path = '' stable as $$
declare v_user core.profiles;
begin
  if p_user is null then return false; end if;
  select * into v_user from core.profiles p where p.id = p_user;
  if not found or v_user.status <> 'active' then return false; end if;
  if v_user.is_super then return true; end if;
  return exists (select 1 from core.tile_access a
                 where a.user_id = p_user and a.tile_id = p_tile and a.is_admin);
end $$;

-- Session ok, active, has the tile (and the right). First line of every tile function.
create or replace function core.require_tile(p_tile text, p_right text default null)
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_user();
  if not core.has_tile(v_user.id, p_tile, null) then raise exception 'NO_ACCESS'; end if;
  if p_right is not null and not core.has_tile(v_user.id, p_tile, p_right) then raise exception 'NO_RIGHT'; end if;
  return v_user;
end $$;

-- For storage paths like <username>/<file>.
create or replace function core.username_of(p_user uuid)
returns text language sql security definer set search_path = '' stable as $$
  select p.username from core.profiles p where p.id = p_user and p.status = 'active';
$$;

-- Storage policies run as the caller, so these three are callable by authenticated. Nothing else in core is.
grant usage on schema core to authenticated;
revoke execute on all functions in schema core from public, anon, authenticated;
grant execute on function core.has_tile(uuid, text, text) to authenticated;
grant execute on function core.is_tile_admin(uuid, text) to authenticated;
grant execute on function core.username_of(uuid) to authenticated;

-- Owner-only helpers, run in the SQL editor (never exposed).
create or replace function core.make_super(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  update core.profiles set is_super = true, status = 'active', approved_at = coalesce(approved_at, now()), updated_at = now()
  where username = p_username returning * into v_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into core.audit (user_id, username, action, detail)
  values (v_user.id, v_user.username, 'make_super', '{}');
  return 'super user: ' || p_username;
end $$;

-- Sets a temporary password, ends the user's session and forces a change at next sign-in.
create or replace function core.reset_password(p_username text, p_temp_password text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  if p_temp_password !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$' then raise exception 'INVALID:password'; end if;
  select * into v_user from core.profiles p where p.username = p_username;
  if not found then raise exception 'NOT_FOUND'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')), updated_at = now()
  where id = v_user.id;
  update core.profiles set session_id = null, session_started_at = null, must_change_password = true, updated_at = now()
  where id = v_user.id;
  insert into core.audit (user_id, username, action) values (v_user.id, v_user.username, 'password_reset_by_owner');
  return 'temporary password set for ' || p_username || '; the user must change it at next sign-in';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Sign-up trigger: every new auth user gets a pending profile, or the sign-up fails
-- ---------------------------------------------------------------------------
create or replace function core.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text; v_display text;
begin
  v_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display  := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if v_username !~ '^[a-z0-9._-]{3,30}$' then raise exception 'INVALID:username'; end if;
  if new.email is distinct from v_username || '@users.dame-hub.local' then raise exception 'INVALID:username'; end if;
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 60 then raise exception 'INVALID:display_name'; end if;
  insert into core.profiles (id, username, display_name) values (new.id, v_username, v_display);
  insert into core.audit (user_id, username, action) values (new.id, v_username, 'request_access');
  return new;
end $$;
grant usage on schema core to supabase_auth_admin;
grant execute on function core.on_auth_user_created() to supabase_auth_admin;

drop trigger if exists dame_on_auth_user_created on auth.users;
create trigger dame_on_auth_user_created
  after insert on auth.users for each row execute function core.on_auth_user_created();

-- ---------------------------------------------------------------------------
-- 4. The door: public.core_* functions (the only things the API can call)
-- ---------------------------------------------------------------------------

-- Login page, anonymous: site name only.
create or replace function public.core_site_info()
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('site_name', 'DAME HUB', 'core_version', 1);
$$;
revoke execute on function public.core_site_info() from public;
grant execute on function public.core_site_info() to anon, authenticated;

-- Called once right after sign-in: binds this session to the account (ends any other).
create or replace function public.core_session_start()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_sid text := auth.jwt() ->> 'session_id'; v_user core.profiles;
begin
  if v_uid is null or v_sid is null then raise exception 'SIGNED_OUT'; end if;
  select * into v_user from core.profiles p where p.id = v_uid;
  if not found then raise exception 'SIGNED_OUT'; end if;
  if v_user.status = 'disabled' then
    insert into core.audit (user_id, username, action) values (v_uid, v_user.username, 'sign_in_disabled');
    return jsonb_build_object('status', 'disabled');
  end if;
  update core.profiles set session_id = v_sid::uuid, session_started_at = now(), updated_at = now()
  where id = v_uid;
  insert into core.audit (user_id, username, action, detail)
  values (v_uid, v_user.username, 'sign_in', jsonb_build_object('replaced_session', v_user.session_id is not null));
  return jsonb_build_object('username', v_user.username, 'display_name', v_user.display_name,
    'status', v_user.status, 'is_super', v_user.is_super, 'must_change_password', v_user.must_change_password);
end $$;
revoke execute on function public.core_session_start() from public, anon;
grant execute on function public.core_session_start() to authenticated;

-- Every page load: who am I, and (when a tile is named) what may I do in it.
create or replace function public.core_me(p_tile text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_tile core.tiles; v_access core.tile_access; v_out jsonb;
begin
  v_user := core.require_session();
  v_out := jsonb_build_object('username', v_user.username, 'display_name', v_user.display_name,
    'status', v_user.status, 'is_super', v_user.is_super, 'must_change_password', v_user.must_change_password);
  if p_tile is null then return v_out; end if;
  if v_user.status <> 'active' then raise exception 'NOT_APPROVED'; end if;
  if not core.has_tile(v_user.id, p_tile, null) then raise exception 'NO_ACCESS'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  select * into v_access from core.tile_access a where a.user_id = v_user.id and a.tile_id = p_tile;
  return v_out || jsonb_build_object(
    'tile', jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'rights', to_jsonb(v_tile.rights)),
    'tile_admin', core.is_tile_admin(v_user.id, p_tile),
    'rights', case when v_user.is_super or coalesce(v_access.is_admin, false) then to_jsonb(v_tile.rights)
                   else to_jsonb(coalesce(v_access.rights, '{}'::text[])) end);
end $$;
revoke execute on function public.core_me(text) from public, anon;
grant execute on function public.core_me(text) to authenticated;

-- Dashboard: the tiles this user may open, in order.
create or replace function public.core_my_tiles()
returns table (id text, name text, tagline text, icon text, is_admin boolean, rights text[])
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_user();
  return query
    select t.id, t.name, t.tagline, t.icon,
           core.is_tile_admin(v_user.id, t.id),
           case when v_user.is_super or coalesce(a.is_admin, false) then t.rights else coalesce(a.rights, '{}'::text[]) end
    from core.tiles t
    left join core.tile_access a on a.tile_id = t.id and a.user_id = v_user.id
    where t.enabled and (v_user.is_super or a.user_id is not null)
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_my_tiles() from public, anon;
grant execute on function public.core_my_tiles() to authenticated;

-- Sign-out: forget the session (the page also calls Auth logout).
create or replace function public.core_sign_out()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  if v_uid is null then return; end if;
  update core.profiles set session_id = null, session_started_at = null, updated_at = now()
  where id = v_uid returning username into v_name;
  if v_name is not null then
    insert into core.audit (user_id, username, action) values (v_uid, v_name, 'sign_out');
  end if;
end $$;
revoke execute on function public.core_sign_out() from public, anon;
grant execute on function public.core_sign_out() to authenticated;

-- After the account page changed the password through Auth.
create or replace function public.core_password_changed()
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_session();
  update core.profiles set must_change_password = false, updated_at = now() where id = v_user.id;
  perform core.audit(null, 'password_changed', '{}');
end $$;
revoke execute on function public.core_password_changed() from public, anon;
grant execute on function public.core_password_changed() to authenticated;

-- Account page: change display name.
create or replace function public.core_set_display_name(p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_name text := trim(coalesce(p_display_name, ''));
begin
  v_user := core.require_session();
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'INVALID:display_name'; end if;
  update core.profiles set display_name = v_name, updated_at = now() where id = v_user.id;
  return jsonb_build_object('display_name', v_name);
end $$;
revoke execute on function public.core_set_display_name(text) from public, anon;
grant execute on function public.core_set_display_name(text) to authenticated;

-- ----- Super user: accounts ------------------------------------------------

create or replace function core.require_super()
returns core.profiles language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_user();
  if not v_user.is_super then raise exception 'NO_RIGHT'; end if;
  return v_user;
end $$;

create or replace function public.core_admin_users(p_status text default null)
returns table (id uuid, username text, display_name text, status text, is_super boolean,
               created_at timestamptz, approved_at timestamptz, last_sign_in timestamptz, tiles text[])
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select p.id, p.username, p.display_name, p.status, p.is_super, p.created_at, p.approved_at, p.session_started_at,
           coalesce((select array_agg(a.tile_id order by a.tile_id) from core.tile_access a where a.user_id = p.id), '{}'::text[])
    from core.profiles p
    where p_status is null or p.status = p_status
    order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end, p.username;
end $$;
revoke execute on function public.core_admin_users(text) from public, anon;
grant execute on function public.core_admin_users(text) to authenticated;

-- approve (-> active), disable, enable (-> active).
create or replace function public.core_admin_set_status(p_user uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_user core.profiles;
begin
  v_me := core.require_super();
  if p_status not in ('active', 'disabled') then raise exception 'INVALID:status'; end if;
  if p_user = v_me.id then raise exception 'INVALID:user'; end if;
  select * into v_user from core.profiles p where p.id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user.is_super and p_status = 'disabled' then raise exception 'INVALID:user'; end if;
  update core.profiles
  set status = p_status, updated_at = now(),
      approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end,
      approved_by = case when p_status = 'active' then coalesce(approved_by, v_me.id) else approved_by end,
      session_id = case when p_status = 'disabled' then null else session_id end
  where id = p_user;
  perform core.audit(null, case when v_user.status = 'pending' and p_status = 'active' then 'approve_user'
                                when p_status = 'disabled' then 'disable_user' else 'enable_user' end,
                     jsonb_build_object('user', v_user.username));
  return jsonb_build_object('username', v_user.username, 'status', p_status);
end $$;
revoke execute on function public.core_admin_set_status(uuid, text) from public, anon;
grant execute on function public.core_admin_set_status(uuid, text) to authenticated;

-- ----- Super user: tiles ---------------------------------------------------

create or replace function public.core_admin_tiles()
returns table (id text, name text, tagline text, icon text, sort_order integer, enabled boolean,
               rights text[], users integer, admins text[])
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select t.id, t.name, t.tagline, t.icon, t.sort_order, t.enabled, t.rights,
           (select count(*)::integer from core.tile_access a where a.tile_id = t.id),
           coalesce((select array_agg(p.username order by p.username) from core.tile_access a
                     join core.profiles p on p.id = a.user_id where a.tile_id = t.id and a.is_admin), '{}'::text[])
    from core.tiles t
    order by t.sort_order, t.name;
end $$;
revoke execute on function public.core_admin_tiles() from public, anon;
grant execute on function public.core_admin_tiles() to authenticated;

-- Create or update a tile. The id never changes. Enabled is switched separately.
create or replace function public.core_admin_tile_save(p_id text, p_name text, p_tagline text, p_icon text,
                                                        p_sort_order integer, p_rights text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text := lower(trim(coalesce(p_id, ''))); v_rights text[]; v_right text; v_new boolean;
begin
  perform core.require_super();
  if v_id !~ '^[a-z0-9][a-z0-9-]{1,29}$' or v_id = 'dame-hub' then raise exception 'INVALID:id'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'INVALID:name'; end if;
  if char_length(coalesce(p_tagline, '')) > 80 then raise exception 'INVALID:tagline'; end if;
  if coalesce(p_icon, '') !~ '^[a-z0-9-]{1,30}$' then raise exception 'INVALID:icon'; end if;
  v_rights := '{}';
  foreach v_right in array coalesce(p_rights, '{}'::text[]) loop
    v_right := lower(trim(v_right));
    if v_right = '' then continue; end if;
    if v_right !~ '^[a-z][a-z0-9_]{1,19}$' then raise exception 'INVALID:rights'; end if;
    if not (v_right = any (v_rights)) then v_rights := v_rights || v_right; end if;
  end loop;
  v_new := not exists (select 1 from core.tiles t where t.id = v_id);
  insert into core.tiles (id, name, tagline, icon, sort_order, rights)
  values (v_id, trim(p_name), coalesce(p_tagline, ''), p_icon, coalesce(p_sort_order, 100), v_rights)
  on conflict (id) do update
    set name = excluded.name, tagline = excluded.tagline, icon = excluded.icon,
        sort_order = excluded.sort_order, rights = excluded.rights, updated_at = now();
  -- drop rights that no longer exist from every access row
  update core.tile_access a set rights = (select coalesce(array_agg(r), '{}'::text[]) from unnest(a.rights) r where r = any (v_rights))
  where a.tile_id = v_id;
  perform core.audit(v_id, case when v_new then 'tile_create' else 'tile_update' end,
                     jsonb_build_object('name', trim(p_name), 'rights', to_jsonb(v_rights)));
  return jsonb_build_object('id', v_id, 'created', v_new);
end $$;
revoke execute on function public.core_admin_tile_save(text, text, text, text, integer, text[]) from public, anon;
grant execute on function public.core_admin_tile_save(text, text, text, text, integer, text[]) to authenticated;

create or replace function public.core_admin_tile_enable(p_id text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  update core.tiles set enabled = coalesce(p_enabled, false), updated_at = now() where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform core.audit(p_id, case when p_enabled then 'tile_on' else 'tile_off' end, '{}');
  return jsonb_build_object('id', p_id, 'enabled', coalesce(p_enabled, false));
end $$;
revoke execute on function public.core_admin_tile_enable(text, boolean) from public, anon;
grant execute on function public.core_admin_tile_enable(text, boolean) to authenticated;

-- ----- Super user: audit ---------------------------------------------------

create or replace function public.core_admin_audit(p_limit integer default 100, p_before timestamptz default null,
                                                    p_tile text default null, p_username text default null)
returns table (id bigint, at timestamptz, username text, tile_id text, action text, detail jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select a.id, a.at, a.username, a.tile_id, a.action, a.detail
    from core.audit a
    where (p_before is null or a.at < p_before)
      and (p_tile is null or a.tile_id = p_tile)
      and (p_username is null or a.username = p_username)
    order by a.at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;
revoke execute on function public.core_admin_audit(integer, timestamptz, text, text) from public, anon;
grant execute on function public.core_admin_audit(integer, timestamptz, text, text) to authenticated;

-- ----- Tile admin (or super): access and rights for one tile ---------------

create or replace function public.core_tile_users(p_tile text)
returns table (id uuid, username text, display_name text, has_access boolean, is_admin boolean, rights text[])
language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles;
begin
  v_me := core.require_user();
  if not core.is_tile_admin(v_me.id, p_tile) then raise exception 'NO_RIGHT'; end if;
  if not exists (select 1 from core.tiles t where t.id = p_tile) then raise exception 'NOT_FOUND'; end if;
  return query
    select p.id, p.username, p.display_name, a.user_id is not null, coalesce(a.is_admin, false), coalesce(a.rights, '{}'::text[])
    from core.profiles p
    left join core.tile_access a on a.user_id = p.id and a.tile_id = p_tile
    where p.status = 'active' and not p.is_super
    order by (a.user_id is null), p.username;
end $$;
revoke execute on function public.core_tile_users(text) from public, anon;
grant execute on function public.core_tile_users(text) to authenticated;

-- Give or remove access and rights. p_admin may be set only by the super user (null = leave as is).
create or replace function public.core_tile_access_set(p_tile text, p_user uuid, p_access boolean,
                                                        p_rights text[] default null, p_admin boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_user core.profiles; v_tile core.tiles; v_rights text[]; v_right text; v_had boolean;
begin
  v_me := core.require_user();
  if not core.is_tile_admin(v_me.id, p_tile) then raise exception 'NO_RIGHT'; end if;
  if p_admin is not null and not v_me.is_super then raise exception 'NO_RIGHT'; end if;
  if p_user = v_me.id and not v_me.is_super then raise exception 'INVALID:user'; end if;
  select * into v_tile from core.tiles t where t.id = p_tile;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_user from core.profiles p where p.id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user.status <> 'active' then raise exception 'INVALID:user'; end if;
  v_had := exists (select 1 from core.tile_access a where a.user_id = p_user and a.tile_id = p_tile);

  if not coalesce(p_access, false) then
    delete from core.tile_access where user_id = p_user and tile_id = p_tile;
    if v_had then perform core.audit(p_tile, 'access_remove', jsonb_build_object('user', v_user.username)); end if;
    return jsonb_build_object('username', v_user.username, 'has_access', false);
  end if;

  v_rights := '{}';
  foreach v_right in array coalesce(p_rights, '{}'::text[]) loop
    v_right := lower(trim(v_right));
    if v_right = '' then continue; end if;
    if not (v_right = any (v_tile.rights)) then raise exception 'INVALID:rights'; end if;
    if not (v_right = any (v_rights)) then v_rights := v_rights || v_right; end if;
  end loop;

  insert into core.tile_access (user_id, tile_id, is_admin, rights, granted_by)
  values (p_user, p_tile, coalesce(p_admin, false), case when p_rights is null then '{}'::text[] else v_rights end, v_me.id)
  on conflict (user_id, tile_id) do update
    set rights = case when p_rights is null then core.tile_access.rights else v_rights end,
        is_admin = coalesce(p_admin, core.tile_access.is_admin),
        granted_by = v_me.id, granted_at = now();
  perform core.audit(p_tile, case when v_had then 'access_update' else 'access_grant' end,
                     jsonb_build_object('user', v_user.username, 'rights', to_jsonb(v_rights), 'admin', p_admin));
  return jsonb_build_object('username', v_user.username, 'has_access', true);
end $$;
revoke execute on function public.core_tile_access_set(text, uuid, boolean, text[], boolean) from public, anon;
grant execute on function public.core_tile_access_set(text, uuid, boolean, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. core.security_check(): one row per problem. Must return no rows.
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
  -- h. policy for anon or public (applies to anon) anywhere
  return query
    select 'policy for anon/public', n.nspname || '.' || c.relname || ': ' || pol.polname
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where pol.polroles = '{0}'::oid[]
       or exists (select 1 from pg_catalog.pg_roles ro where ro.oid = any (pol.polroles) and ro.rolname = 'anon');
  -- i. policy on our own tables (functions read them; a policy means direct access was intended)
  return query
    select 'policy on an internal table', n.nspname || '.' || c.relname || ': ' || pol.polname
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where not (n.nspname = any (v_system)) and n.nspname not like 'pg\_%';
end $$;

select core.applied('dame-hub', '001_init');
