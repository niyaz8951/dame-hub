-- 008: the super user manages accounts from Admin > Users: change username and display name, set a password
-- (reset: the user must choose a new one at next sign-in; or a password the user keeps), delete an account.
-- Owner, 2026-11-05: "admin should be able to change username of other users, reset or change password, delete users".
-- Needs 004 and 005. Read it, then paste it whole in the SQL editor.
--
-- Rules (decided 2026-11-05):
-- * A username once used stays with its account (core.username_history): after a rename or a delete nobody else can
--   take it, so a newcomer never inherits files, history lines or audit rows written under that name. The same account
--   may take its old name back. The owner frees a name in the SQL editor with core.release_username('name').
-- * Owner-created accounts sign in as <username>@users.dame-hub.local: a rename moves that address with the username.
--   Accounts on a real email keep signing in with the email; only the handle changes.
-- * A password set by the admin ends every session of the user at once (Supabase sessions deleted, so the old tokens
--   cannot start a session again). core_session_start now refuses a session Supabase no longer has.
-- * Delete removes the Supabase account, the profile and all tile access. What the user wrote in a tile stays there
--   (tiles keep the user id and the name saved at the time). If a tile ever ties its rows to the account with a
--   foreign key that blocks it, the delete is refused with IN_USE:user: disable the account instead.
-- * Nobody changes his own password, or deletes or resets himself, from Admin (the account page is for that); a super
--   user cannot be reset or deleted from Admin.
-- Touches: core.username_history (new), core.username_ok, core.end_sessions, core.set_password, core.reset_password,
-- core.release_username, core.on_auth_user_created, public.core_session_start, public.core_admin_create_user,
-- public.core_admin_update_user, public.core_admin_set_password, public.core_admin_delete_user (new).

-- ---------------------------------------------------------------------------
-- 1. Retired usernames
-- ---------------------------------------------------------------------------
create table core.username_history (
  username   text primary key,
  user_id    uuid not null,          -- the account that used it (may no longer exist)
  retired_at timestamptz not null default now()
);
alter table core.username_history enable row level security;

-- Valid, not used by another profile, not retired by another account. p_user = the account taking it (null = new).
create or replace function core.username_ok(p_username text, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_username, '') !~ '^[a-z0-9._-]{3,30}$' then raise exception 'INVALID:username'; end if;
  if exists (select 1 from core.profiles p where p.username = p_username and p.id is distinct from p_user)
     or exists (select 1 from core.username_history h where h.username = p_username and h.user_id is distinct from p_user) then
    raise exception 'TAKEN:username';
  end if;
end $$;
revoke execute on function core.username_ok(text, uuid) from public, anon, authenticated;

-- Owner only (SQL editor): lets another account take a retired username.
create or replace function core.release_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  delete from core.username_history h where h.username = lower(trim(p_username));
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into core.audit (action, detail) values ('username_released', jsonb_build_object('user', lower(trim(p_username))));
  return 'username ' || lower(trim(p_username)) || ' is free';
end $$;
revoke execute on function core.release_username(text) from public, anon, authenticated;

-- Sign-up and owner-created accounts check retired names too (same bodies as 004 and 005 otherwise).
create or replace function core.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text; v_display text;
begin
  v_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display  := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  perform core.username_ok(v_username, null);
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 60 then raise exception 'INVALID:display_name'; end if;
  insert into core.profiles (id, username, display_name) values (new.id, v_username, v_display);
  insert into core.audit (user_id, username, action) values (new.id, v_username, 'request_access');
  return new;
end $$;
revoke execute on function core.on_auth_user_created() from public, anon, authenticated;
grant execute on function core.on_auth_user_created() to supabase_auth_admin;

create or replace function public.core_admin_create_user(p_username text, p_display_name text, p_temp_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_username text := lower(trim(coalesce(p_username, ''))); v_display text := trim(coalesce(p_display_name, ''));
        v_id uuid := gen_random_uuid(); v_email text;
begin
  v_me := core.require_super();
  perform core.username_ok(v_username, null);
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 60 then raise exception 'INVALID:display_name'; end if;
  if coalesce(p_temp_password, '') !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$' then raise exception 'INVALID:password'; end if;
  v_email := v_username || '@users.dame-hub.local';
  if exists (select 1 from auth.users u where u.email = v_email) then raise exception 'TAKEN:username'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_temp_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_username, 'display_name', v_display),
    now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', v_id::text, now(), now(), now());

  update core.profiles set status = 'active', approved_at = now(), approved_by = v_me.id, must_change_password = true, updated_at = now()
  where id = v_id;
  perform core.audit(null, 'user_create', jsonb_build_object('user', v_username));
  return jsonb_build_object('username', v_username);
end $$;
revoke execute on function public.core_admin_create_user(text, text, text) from public, anon;
grant execute on function public.core_admin_create_user(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sessions: a session Supabase no longer has cannot be (re)started
-- ---------------------------------------------------------------------------
-- Ends every session of a user: Supabase's (refresh tokens go with them) and the one bound in the profile.
create or replace function core.end_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions s where s.user_id = p_user;
  update core.profiles set session_id = null, session_started_at = null, updated_at = now() where id = p_user;
end $$;
revoke execute on function core.end_sessions(uuid) from public, anon, authenticated;

-- Same as 001, plus: the session must still exist in Supabase.
create or replace function public.core_session_start()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_sid text := auth.jwt() ->> 'session_id'; v_user core.profiles;
begin
  if v_uid is null or v_sid is null then raise exception 'SIGNED_OUT'; end if;
  if not exists (select 1 from auth.sessions s where s.id::text = v_sid and s.user_id = v_uid) then raise exception 'SIGNED_OUT'; end if;
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

-- ---------------------------------------------------------------------------
-- 3. Passwords
-- ---------------------------------------------------------------------------
create or replace function core.set_password(p_user uuid, p_password text, p_must_change boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_password, '') !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$' then raise exception 'INVALID:password'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform core.end_sessions(p_user);
  update core.profiles set must_change_password = coalesce(p_must_change, true), updated_at = now() where id = p_user;
end $$;
revoke execute on function core.set_password(uuid, text, boolean) from public, anon, authenticated;

-- Owner helper of 001 (SQL editor), now also ending the Supabase sessions.
create or replace function core.reset_password(p_username text, p_temp_password text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  if coalesce(p_temp_password, '') !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$' then raise exception 'INVALID:password'; end if;
  select * into v_user from core.profiles p where p.username = p_username;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform core.set_password(v_user.id, p_temp_password, true);
  insert into core.audit (user_id, username, action) values (v_user.id, v_user.username, 'password_reset_by_owner');
  return 'temporary password set for ' || p_username || '; the user must change it at next sign-in';
end $$;
revoke execute on function core.reset_password(text, text) from public, anon, authenticated;

-- Admin > Users > Manage > Password. p_must_change true = reset (temporary password), false = a password the user keeps.
create or replace function public.core_admin_set_password(p_user uuid, p_password text, p_must_change boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_user core.profiles;
begin
  v_me := core.require_super();
  select * into v_user from core.profiles p where p.id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user.id = v_me.id or v_user.is_super then raise exception 'INVALID:user'; end if;
  perform core.set_password(v_user.id, p_password, coalesce(p_must_change, true));
  perform core.audit(null, 'password_set_by_admin', jsonb_build_object('user', v_user.username, 'must_change', coalesce(p_must_change, true)));
  return jsonb_build_object('username', v_user.username, 'must_change_password', coalesce(p_must_change, true));
end $$;
revoke execute on function public.core_admin_set_password(uuid, text, boolean) from public, anon;
grant execute on function public.core_admin_set_password(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Username and display name
-- ---------------------------------------------------------------------------
-- Admin > Users > Manage > Save. Works for any account, the super user's own included (his sign-in address does not
-- change unless it is an owner-created one). The user's session stays; the new username applies at once.
create or replace function public.core_admin_update_user(p_user uuid, p_username text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_user core.profiles; v_new text := lower(trim(coalesce(p_username, '')));
        v_display text := trim(coalesce(p_display_name, '')); v_email text; v_internal boolean;
begin
  v_me := core.require_super();
  select * into v_user from core.profiles p where p.id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if char_length(v_display) not between 1 and 60 then raise exception 'INVALID:display_name'; end if;
  select u.email = v_user.username || '@users.dame-hub.local' into v_internal from auth.users u where u.id = v_user.id;
  v_internal := coalesce(v_internal, false);

  if v_new <> v_user.username then
    perform core.username_ok(v_new, v_user.id);
    if v_internal then
      v_email := v_new || '@users.dame-hub.local';
      if exists (select 1 from auth.users u where u.email = v_email and u.id <> v_user.id) then raise exception 'TAKEN:username'; end if;
      update auth.users set email = v_email, updated_at = now() where id = v_user.id;
      update auth.identities i set identity_data = i.identity_data || jsonb_build_object('email', v_email), updated_at = now()
      where i.user_id = v_user.id and i.provider = 'email';
    end if;
    update auth.users u set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_new)
    where u.id = v_user.id;
    delete from core.username_history h where h.username = v_new and h.user_id = v_user.id;   -- taking his own old name back
    insert into core.username_history (username, user_id) values (v_user.username, v_user.id)
    on conflict (username) do update set user_id = excluded.user_id, retired_at = now();
    update core.profiles set username = v_new, updated_at = now() where id = v_user.id;
    perform core.audit(null, 'user_rename', jsonb_build_object('from', v_user.username, 'to', v_new));
  end if;

  if v_display <> v_user.display_name then
    update core.profiles set display_name = v_display, updated_at = now() where id = v_user.id;
    update auth.users u set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', v_display)
    where u.id = v_user.id;
    perform core.audit(null, 'user_display_name', jsonb_build_object('user', v_new, 'from', v_user.display_name, 'to', v_display));
  end if;
  -- signs_in_with: 'username' (owner-created account) or 'email' (own address, unchanged)
  return jsonb_build_object('username', v_new, 'display_name', v_display, 'signs_in_with', case when v_internal then 'username' else 'email' end);
end $$;
revoke execute on function public.core_admin_update_user(uuid, text, text) from public, anon;
grant execute on function public.core_admin_update_user(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Delete
-- ---------------------------------------------------------------------------
-- p_confirm must repeat the username: a second guard against a wrong row or a replayed call.
create or replace function public.core_admin_delete_user(p_user uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_user core.profiles; v_tiles text[];
begin
  v_me := core.require_super();
  select * into v_user from core.profiles p where p.id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user.id = v_me.id or v_user.is_super then raise exception 'INVALID:user'; end if;
  if lower(trim(coalesce(p_confirm, ''))) <> v_user.username then raise exception 'INVALID:confirm'; end if;
  select coalesce(array_agg(a.tile_id order by a.tile_id), '{}') into v_tiles from core.tile_access a where a.user_id = v_user.id;
  begin
    insert into core.username_history (username, user_id) values (v_user.username, v_user.id)
    on conflict (username) do update set user_id = excluded.user_id, retired_at = now();
    delete from auth.users u where u.id = v_user.id;   -- cascades: sessions, identities, profile, tile access
  exception when foreign_key_violation then
    raise exception 'IN_USE:user';
  end;
  perform core.audit(null, 'user_delete', jsonb_build_object('user', v_user.username, 'display_name', v_user.display_name,
    'status', v_user.status, 'tiles', to_jsonb(v_tiles)));
  return jsonb_build_object('username', v_user.username, 'deleted', true);
end $$;
revoke execute on function public.core_admin_delete_user(uuid, text) from public, anon;
grant execute on function public.core_admin_delete_user(uuid, text) to authenticated;

select core.applied('dame-hub', '008_manage_users');
