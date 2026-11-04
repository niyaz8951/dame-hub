-- DAME core tests. Run on STAGING in the SQL editor, as one script. Everything is rolled back.
-- Expected output: one notice per group ending in "ok", then "ALL CORE TESTS PASSED". Any failure stops with ERROR.
begin;

create temp table t_ids (k text primary key, id uuid);

-- Users are created through the same trigger as a real sign-up.
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
values
  (gen_random_uuid(), 't.super@example.com',   '{"username":"t.super","display_name":"Test Super"}', now(), now()),
  (gen_random_uuid(), 't.admin@example.com',   '{"username":"t.admin","display_name":"Test Tile Admin"}', now(), now()),
  (gen_random_uuid(), 't.user@example.com',    '{"username":"t.user","display_name":"Test User"}', now(), now()),
  (gen_random_uuid(), 't.pending@example.com', '{"username":"t.pending"}', now(), now()),
  (gen_random_uuid(), 't.disabled@example.com','{"username":"t.disabled"}', now(), now()),
  (gen_random_uuid(), 't.none@example.com',    '{"username":"t.none"}', now(), now());
insert into t_ids select username, id from core.profiles where username like 't.%';

-- helper: act as a user with a fresh session bound through core_session_start()
create or replace function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  if p_key is null then
    perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return;
  end if;
  select id into v_id from t_ids where k = p_key;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'session_id', v_sid, 'role', 'authenticated', 'email', (select email from auth.users where id = v_id))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlerrm = p_code or (p_code = 'PERMISSION' and sqlstate = '42501') then return; end if;
  if sqlerrm like 'expected error%' then raise; end if;
  raise exception 'expected % but got % (%) from: %', p_code, sqlerrm, sqlstate, p_sql;
end $$;

grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text) to public;
grant select on t_ids to public;

do $$
declare v jsonb; n int;
begin
  -- ---- sign-up trigger
  perform pg_temp.expect_error($q$insert into auth.users (email, raw_user_meta_data) values ('bad@example.com', '{"username":"Bad Name!"}')$q$, 'INVALID:username');
  perform pg_temp.expect_error($q$insert into auth.users (email, raw_user_meta_data) values ('someone@gmail.com', '{"username":"t.user"}')$q$, 'TAKEN:username');
  perform pg_temp.expect_error($q$insert into auth.users (email, raw_user_meta_data) values ('t.user@example.com', '{"username":"other"}')$q$, 'duplicate key value violates unique constraint "users_email_key"');
  insert into auth.users (email, raw_user_meta_data) values ('someone@gmail.com', '{"username":"t.gmail"}'); -- any real address works
  select count(*) into n from core.profiles where username like 't.%' and status = 'pending'; if n <> 7 then raise exception 'profiles not pending'; end if;
  raise notice 'sign-up trigger ok';

  -- ---- anon may call core_site_info and nothing else
  perform pg_temp.act_as(null);
  select public.core_site_info() into v; if v ->> 'site_name' <> 'DAME HUB' then raise exception 'site_info'; end if;
  perform pg_temp.expect_error('select public.core_me()', 'PERMISSION');
  perform pg_temp.expect_error('select public.core_my_tiles()', 'PERMISSION');
  perform pg_temp.expect_error('select public.core_session_start()', 'PERMISSION');
  perform pg_temp.expect_error('select core.has_tile(null, ''x'')', 'PERMISSION');
  reset role;
  raise notice 'anon refused ok';

  -- ---- owner steps: super user, approvals
  perform core.make_super('t.super');
  perform pg_temp.expect_error('select core.make_super(''nobody'')', 'NOT_FOUND');
  -- a session that was never started is refused
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from t_ids where k = 't.super'), 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform pg_temp.expect_error('select public.core_me()', 'SIGNED_OUT');
  reset role;
  raise notice 'unbound session refused ok';

  perform pg_temp.act_as('t.super');
  select public.core_session_start() into v; if not (v ->> 'is_super')::boolean then raise exception 'super start'; end if;
  perform public.core_admin_set_status((select id from t_ids where k = 't.admin'), 'active');
  perform public.core_admin_set_status((select id from t_ids where k = 't.user'), 'active');
  perform public.core_admin_set_status((select id from t_ids where k = 't.none'), 'active');
  perform public.core_admin_set_status((select id from t_ids where k = 't.disabled'), 'active');
  perform public.core_admin_set_status((select id from t_ids where k = 't.disabled'), 'disabled');
  perform pg_temp.expect_error(format('select public.core_admin_set_status(%L, ''disabled'')', (select id from t_ids where k = 't.super')), 'INVALID:user');
  perform pg_temp.expect_error(format('select public.core_admin_set_status(%L, ''gone'')', (select id from t_ids where k = 't.user')), 'INVALID:status');
  select count(*) into n from public.core_admin_users('pending'); if n < 1 then raise exception 'pending list'; end if;
  -- owner-created account: active at once, must change password, internal address
  select public.core_admin_create_user('t.made', 'Made By Owner', 'TempPass2026') into v;
  if v ->> 'username' <> 't.made' then raise exception 'create user'; end if;
  perform pg_temp.expect_error($q$select public.core_admin_create_user('t.made', 'x', 'TempPass2026')$q$, 'TAKEN:username');
  perform pg_temp.expect_error($q$select public.core_admin_create_user('Bad Name', 'x', 'TempPass2026')$q$, 'INVALID:username');
  perform pg_temp.expect_error($q$select public.core_admin_create_user('t.made2', 'x', 'short')$q$, 'INVALID:password');
  reset role;
  if not exists (select 1 from core.profiles p join auth.users u on u.id = p.id where p.username = 't.made' and p.status = 'active' and p.must_change_password and u.email = 't.made@users.dame-hub.local'
                 and u.encrypted_password = extensions.crypt('TempPass2026', u.encrypted_password)) then raise exception 'created account wrong'; end if;
  if not exists (select 1 from auth.identities i join auth.users u on u.id = i.user_id where u.email = 't.made@users.dame-hub.local') then raise exception 'identity missing'; end if;
  perform pg_temp.act_as('t.super'); perform public.core_session_start();
  select count(*) into n from public.core_admin_users(null) where email like '%@%'; if n < 6 then raise exception 'emails in admin list'; end if;
  raise notice 'approval ok';

  -- ---- tiles
  select public.core_admin_tile_save('t-tile', 'Test tile', 'A neutral line', 'tile', 10, array['edit', 'Edit ', 'export']) into v;
  if not (v ->> 'created')::boolean then raise exception 'tile create'; end if;
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('Bad Id', 'x', '', 'tile', 1, '{}')$q$, 'INVALID:id');
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('dame-hub', 'x', '', 'tile', 1, '{}')$q$, 'INVALID:id');
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('t-tile', 'x', '', 'tile', 1, array['no spaces'])$q$, 'INVALID:rights');
  select rights into v from (select to_jsonb(rights) rights from public.core_admin_tiles() where id = 't-tile') s;
  if v <> '["edit","export"]'::jsonb then raise exception 'rights normalised: %', v; end if;
  -- access while the tile is OFF: nobody but super sees it
  perform public.core_tile_access_set('t-tile', (select id from t_ids where k = 't.admin'), true, '{}', true);
  perform public.core_tile_access_set('t-tile', (select id from t_ids where k = 't.user'), true, array['edit'], null);
  perform pg_temp.expect_error(format('select public.core_tile_access_set(''t-tile'', %L, true, array[''nope''], null)', (select id from t_ids where k = 't.user')), 'INVALID:rights');
  perform pg_temp.expect_error(format('select public.core_tile_access_set(''t-tile'', %L, true, ''{}'', null)', (select id from t_ids where k = 't.pending')), 'INVALID:user');
  perform pg_temp.expect_error(format('select public.core_tile_access_set(''t-tile'', %L, true, ''{}'', null)', (select id from t_ids where k = 't.disabled')), 'INVALID:user');
  perform pg_temp.expect_error('select core.require_tile(''t-tile'')', 'PERMISSION'); -- core helpers are not callable from the API role
  reset role;
  if core.has_tile((select id from t_ids where k = 't.user'), 't-tile') then raise exception 'tile off but has_tile'; end if;
  perform pg_temp.act_as('t.super'); perform public.core_session_start();
  perform public.core_admin_tile_enable('t-tile', true);
  perform pg_temp.expect_error('select public.core_admin_tile_enable(''ghost'', true)', 'NOT_FOUND');
  select count(*) into n from public.core_my_tiles(); if n < 1 then raise exception 'super sees tiles'; end if;
  select count(*) into n from public.core_admin_audit(50, null, 't-tile', null); if n < 3 then raise exception 'audit rows'; end if;
  reset role;
  raise notice 'tiles ok';

  -- ---- pending user: can sign in, everything else refused
  perform pg_temp.act_as('t.pending');
  select public.core_session_start() into v; if v ->> 'status' <> 'pending' then raise exception 'pending start'; end if;
  select public.core_me() into v; if v ->> 'status' <> 'pending' then raise exception 'pending me'; end if;
  perform pg_temp.expect_error('select public.core_me(''t-tile'')', 'NOT_APPROVED');
  perform pg_temp.expect_error('select public.core_my_tiles()', 'NOT_APPROVED');
  perform pg_temp.expect_error('select public.core_admin_users()', 'NOT_APPROVED');
  perform pg_temp.expect_error('select public.core_tile_users(''t-tile'')', 'NOT_APPROVED');
  reset role;
  raise notice 'pending refused ok';

  -- ---- disabled user: start returns disabled and binds nothing; calls refused
  perform pg_temp.act_as('t.disabled');
  select public.core_session_start() into v; if v ->> 'status' <> 'disabled' then raise exception 'disabled start'; end if;
  perform pg_temp.expect_error('select public.core_me()', 'SIGNED_OUT');
  perform pg_temp.expect_error('select public.core_my_tiles()', 'SIGNED_OUT');
  reset role;
  raise notice 'disabled refused ok';

  -- ---- active user with no tile
  perform pg_temp.act_as('t.none');
  perform public.core_session_start();
  select count(*) into n from public.core_my_tiles(); if n <> 0 then raise exception 'none sees tiles'; end if;
  perform pg_temp.expect_error('select public.core_me(''t-tile'')', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.core_admin_users()', 'NO_RIGHT');
  perform pg_temp.expect_error($q$select public.core_admin_create_user('t.x', 'x', 'TempPass2026')$q$, 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_admin_tiles()', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_admin_audit()', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_admin_tile_enable(''t-tile'', false)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_tile_users(''t-tile'')', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.core_tile_access_set(''t-tile'', %L, true)', (select id from t_ids where k = 't.none')), 'NO_RIGHT');
  reset role;
  -- as a tile function would call it (owner role, caller's session): no tile -> refused
  perform pg_temp.expect_error('select core.display_names(''t-tile'', ''{}''::uuid[])', 'NO_ACCESS');
  raise notice 'no tile refused ok';

  -- ---- user with the tile and the right 'edit'
  perform pg_temp.act_as('t.user');
  perform public.core_session_start();
  select public.core_me('t-tile') into v;
  if v -> 'tile' ->> 'id' <> 't-tile' or (v ->> 'tile_admin')::boolean or v -> 'rights' <> '["edit"]'::jsonb then raise exception 'user me: %', v; end if;
  select count(*) into n from public.core_my_tiles(); if n <> 1 then raise exception 'user tiles'; end if;
  perform pg_temp.expect_error('select public.core_tile_users(''t-tile'')', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_admin_users()', 'NO_RIGHT');
  perform pg_temp.expect_error('select core.display_names(''t-tile'', ''{}''::uuid[])', 'PERMISSION'); -- not from the API role
  reset role;
  -- display_names, as a tile function calls it: active and disabled named, pending and unknown ids left out
  select count(*) into n from core.display_names('t-tile', array[
    (select id from t_ids where k = 't.admin'), (select id from t_ids where k = 't.disabled'),
    (select id from t_ids where k = 't.pending'), gen_random_uuid()]);
  if n <> 2 then raise exception 'display_names rows: %', n; end if;
  if (select active from core.display_names('t-tile', array[(select id from t_ids where k = 't.disabled')])) then raise exception 'display_names disabled active'; end if;
  if (select display_name from core.display_names('t-tile', array[(select id from t_ids where k = 't.admin')])) <> 'Test Tile Admin' then raise exception 'display_names name'; end if;
  perform pg_temp.expect_error('select core.display_names(''ghost'', ''{}''::uuid[])', 'NO_ACCESS');
  perform pg_temp.expect_error(format('select core.display_names(''t-tile'', %L::uuid[])', (select array_agg(gen_random_uuid()) from generate_series(1, 501))), 'INVALID:ids');
  if not core.has_tile((select id from t_ids where k = 't.user'), 't-tile') then raise exception 'has_tile'; end if;
  if not core.has_tile((select id from t_ids where k = 't.user'), 't-tile', 'edit') then raise exception 'has_tile edit'; end if;
  if core.has_tile((select id from t_ids where k = 't.user'), 't-tile', 'export') then raise exception 'has_tile export'; end if;
  if core.has_tile((select id from t_ids where k = 't.none'), 't-tile') then raise exception 'has_tile none'; end if;
  if core.has_tile((select id from t_ids where k = 't.user'), 'ghost') then raise exception 'has_tile ghost'; end if;
  raise notice 'user rights ok';

  -- ---- one session per user: a second sign-in replaces the first
  perform pg_temp.act_as('t.user');          -- new session id
  perform pg_temp.expect_error('select public.core_me()', 'SIGNED_OUT');  -- not yet started
  perform public.core_session_start();
  select public.core_me() into v; if v ->> 'username' <> 't.user' then raise exception 'second session'; end if;
  if v ->> 'email' is distinct from 't.user@example.com' then raise exception 'email in me: %', v; end if;
  reset role;
  -- the 12-hour limit
  update core.profiles set session_started_at = now() - interval '13 hours' where username = 't.user';
  perform set_config('role', 'authenticated', true);
  perform pg_temp.expect_error('select public.core_me()', 'SIGNED_OUT');
  reset role;
  raise notice 'single session + 12h ok';

  -- ---- tile admin: manages his tile only, cannot name admins, cannot touch himself
  perform pg_temp.act_as('t.admin');
  perform public.core_session_start();
  select public.core_me('t-tile') into v;
  if not (v ->> 'tile_admin')::boolean or v -> 'rights' <> '["edit","export"]'::jsonb then raise exception 'admin me: %', v; end if;
  select count(*) into n from public.core_tile_users('t-tile'); if n < 3 then raise exception 'tile users'; end if;
  perform public.core_tile_access_set('t-tile', (select id from t_ids where k = 't.none'), true, array['export'], null);
  perform pg_temp.expect_error(format('select public.core_tile_access_set(''t-tile'', %L, true, ''{}'', true)', (select id from t_ids where k = 't.none')), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.core_tile_access_set(''t-tile'', %L, false)', (select id from t_ids where k = 't.admin')), 'INVALID:user');
  perform pg_temp.expect_error('select public.core_tile_users(''other'')', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_admin_tiles()', 'NO_RIGHT');
  perform public.core_tile_access_set('t-tile', (select id from t_ids where k = 't.none'), false);
  reset role;
  if core.has_tile((select id from t_ids where k = 't.none'), 't-tile') then raise exception 'access removed'; end if;
  raise notice 'tile admin ok';

  -- ---- switching a tile off refuses everyone but super
  perform pg_temp.act_as('t.super'); perform public.core_session_start();
  perform public.core_admin_tile_enable('t-tile', false);
  reset role;
  perform pg_temp.act_as('t.user'); perform public.core_session_start();
  perform pg_temp.expect_error('select public.core_me(''t-tile'')', 'NO_ACCESS');
  select count(*) into n from public.core_my_tiles(); if n <> 0 then raise exception 'off tile listed'; end if;
  reset role;
  raise notice 'tile off ok';

  -- ---- removing a right from the tile removes it from users
  perform pg_temp.act_as('t.super'); perform public.core_session_start();
  perform public.core_admin_tile_save('t-tile', 'Test tile', '', 'tile', 10, array['export']);
  reset role;
  if core.has_tile((select id from t_ids where k = 't.user'), 't-tile', 'edit') then raise exception 'stale right'; end if;
  raise notice 'rights sync ok';

  -- ---- owner password reset: session ends, must change at next sign-in
  perform core.reset_password('t.user', 'TempPass123');
  perform pg_temp.expect_error('select core.reset_password(''t.user'', ''short'')', 'INVALID:password');
  perform pg_temp.act_as('t.user');
  select public.core_session_start() into v; if not (v ->> 'must_change_password')::boolean then raise exception 'must change'; end if;
  perform public.core_password_changed();
  select public.core_me() into v; if (v ->> 'must_change_password')::boolean then raise exception 'flag not cleared'; end if;
  select public.core_set_display_name('  New Name ') into v; if v ->> 'display_name' <> 'New Name' then raise exception 'display'; end if;
  perform pg_temp.expect_error('select public.core_set_display_name('''')', 'INVALID:display_name');
  perform public.core_sign_out();
  perform pg_temp.expect_error('select public.core_me()', 'SIGNED_OUT');
  reset role;
  raise notice 'account ok';

  -- ---- applied() refuses a second run
  perform pg_temp.expect_error('select core.applied(''dame-hub'', ''001_init'')', 'ALREADY_APPLIED: dame-hub/001_init');
  -- ---- the wall itself
  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;

  raise notice 'ALL CORE TESTS PASSED';
end $$;

rollback;
