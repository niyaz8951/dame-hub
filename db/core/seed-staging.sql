-- DAME demo accounts. STAGING ONLY - never run on the live project.
-- Creates the tile 'demo' and four accounts, password DemoPass2026 for all:
--   demo_admin   active, tile admin of 'demo'
--   demo_user    active, has 'demo' with the right 'edit'
--   demo_none    active, no tile
--   demo_pending pending (waiting for approval)
-- Safe to run again: existing rows are left as they are.

insert into core.tiles (id, name, tagline, icon, sort_order, enabled, rights)
values ('demo', 'Demo', 'Shows how a tile works', 'tile', 900, true, array['edit'])
on conflict (id) do nothing;

do $$
declare v_name text; v_id uuid;
begin
  foreach v_name in array array['demo_admin', 'demo_user', 'demo_none', 'demo_pending'] loop
    if exists (select 1 from auth.users where email = v_name || '@users.thinkneering.com') then continue; end if;
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_name || '@users.thinkneering.com', extensions.crypt('DemoPass2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_name, 'display_name', replace(initcap(replace(v_name, '_', ' ')), ' ', ' ')),
      now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', v_name || '@users.thinkneering.com', 'email_verified', true),
      'email', v_id::text, now(), now(), now());
  end loop;

  update core.profiles set status = 'active', approved_at = now() where username in ('demo_admin', 'demo_user', 'demo_none') and status = 'pending';

  insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select p.id, 'demo', true, '{}' from core.profiles p where p.username = 'demo_admin'
  on conflict do nothing;
  insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select p.id, 'demo', false, array['edit'] from core.profiles p where p.username = 'demo_user'
  on conflict do nothing;
end $$;

select username, status from core.profiles where username like 'demo_%' order by username;
