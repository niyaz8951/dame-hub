-- Owner-created accounts: the super user creates a user with username + temporary password; the user never
-- needs an email. Internally the account gets <username>@users.dame-hub.local, inserted directly (so Supabase's
-- sign-up domain check does not apply) and never mailed. Self-service "request access" with a real email stays.
-- Touches: public.core_admin_create_user (new). Also, for the sign-in page: config.js INTERNAL_DOMAIN.

create or replace function public.core_admin_create_user(p_username text, p_display_name text, p_temp_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me core.profiles; v_username text := lower(trim(coalesce(p_username, ''))); v_display text := trim(coalesce(p_display_name, ''));
        v_id uuid := gen_random_uuid(); v_email text;
begin
  v_me := core.require_super();
  if v_username !~ '^[a-z0-9._-]{3,30}$' then raise exception 'INVALID:username'; end if;
  if exists (select 1 from core.profiles p where p.username = v_username) then raise exception 'TAKEN:username'; end if;
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 60 then raise exception 'INVALID:display_name'; end if;
  if p_temp_password !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$' then raise exception 'INVALID:password'; end if;
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

  -- the sign-up trigger created the pending profile; the owner's account is active at once
  update core.profiles set status = 'active', approved_at = now(), approved_by = v_me.id, must_change_password = true, updated_at = now()
  where id = v_id;
  perform core.audit(null, 'user_create', jsonb_build_object('user', v_username));
  return jsonb_build_object('username', v_username);
end $$;
revoke execute on function public.core_admin_create_user(text, text, text) from public, anon;
grant execute on function public.core_admin_create_user(text, text, text) to authenticated;

select core.applied('dame-hub', '005_owner_users');
