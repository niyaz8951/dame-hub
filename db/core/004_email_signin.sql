-- Accounts are keyed by the user's own email address (Gmail or any other); the username is a chosen handle.
-- Replaces the sign-up trigger (no internal-domain check), adds email to core_me() and core_admin_users().
-- Touches: core.on_auth_user_created, public.core_me, public.core_admin_users.

create or replace function core.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text; v_display text;
begin
  v_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display  := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if v_username !~ '^[a-z0-9._-]{3,30}$' then raise exception 'INVALID:username'; end if;
  if exists (select 1 from core.profiles p where p.username = v_username) then raise exception 'TAKEN:username'; end if;
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 60 then raise exception 'INVALID:display_name'; end if;
  insert into core.profiles (id, username, display_name) values (new.id, v_username, v_display);
  insert into core.audit (user_id, username, action) values (new.id, v_username, 'request_access');
  return new;
end $$;
revoke execute on function core.on_auth_user_created() from public, anon, authenticated;
grant execute on function core.on_auth_user_created() to supabase_auth_admin;

-- core_me: same signature, now also returns the caller's email (for the account page only).
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
    'tile', jsonb_build_object('id', v_tile.id, 'name', v_tile.name, 'rights', to_jsonb(v_tile.rights)),
    'tile_admin', core.is_tile_admin(v_user.id, p_tile),
    'rights', case when v_user.is_super or coalesce(v_access.is_admin, false) then to_jsonb(v_tile.rights)
                   else to_jsonb(coalesce(v_access.rights, '{}'::text[])) end);
end $$;
revoke execute on function public.core_me(text) from public, anon;
grant execute on function public.core_me(text) to authenticated;

-- core_admin_users: the super user sees the email, to recognise who is asking for access.
drop function public.core_admin_users(text);
create function public.core_admin_users(p_status text default null)
returns table (id uuid, username text, display_name text, email text, status text, is_super boolean,
               created_at timestamptz, approved_at timestamptz, last_sign_in timestamptz, tiles text[])
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_super();
  return query
    select p.id, p.username, p.display_name, u.email::text, p.status, p.is_super, p.created_at, p.approved_at, p.session_started_at,
           coalesce((select array_agg(a.tile_id order by a.tile_id) from core.tile_access a where a.user_id = p.id), '{}'::text[])
    from core.profiles p
    left join auth.users u on u.id = p.id
    where p_status is null or p.status = p_status
    order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end, p.username;
end $$;
revoke execute on function public.core_admin_users(text) from public, anon;
grant execute on function public.core_admin_users(text) to authenticated;

select core.applied('dame-hub', '004_email_signin');
