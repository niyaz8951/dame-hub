-- DAME core tests. Run on STAGING in the SQL editor, as one script, after every db/core file (001 to 011). Everything is rolled back.
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
  execute 'reset role';
  select id into v_id from t_ids where k = p_key;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, v_id, now(), now()); -- as Supabase Auth at sign-in
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
  select public.core_admin_tile_save('t-tile', 'Test tile', 'A neutral line', 'tile', 'green', 10, array['edit', 'Edit ', 'export']) into v;
  if not (v ->> 'created')::boolean then raise exception 'tile create'; end if;
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('Bad Id', 'x', '', 'tile', 'blue', 1, '{}')$q$, 'INVALID:id');
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('dame-hub', 'x', '', 'tile', 'blue', 1, '{}')$q$, 'INVALID:id');
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('t-tile', 'x', '', 'tile', 'blue', 1, array['no spaces'])$q$, 'INVALID:rights');
  select rights into v from (select to_jsonb(rights) rights from public.core_admin_tiles() where id = 't-tile') s;
  if v <> '["edit","export"]'::jsonb then raise exception 'rights normalised: %', v; end if;
  perform pg_temp.expect_error($q$select public.core_admin_tile_save('t-tile', 'x', '', 'tile', 'pink', 1, '{}')$q$, 'INVALID:accent');
  if (select accent from public.core_admin_tiles() where id = 't-tile') <> 'green' then raise exception 'accent saved'; end if;
  if (select accent from public.core_my_tiles() where id = 't-tile') <> 'green' then raise exception 'accent on dashboard'; end if;
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
  if (public.core_me('t-tile') -> 'tile' ->> 'accent') <> 'green' then raise exception 'accent in core_me'; end if;
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
  perform pg_temp.expect_error('select core.tile_users(''t-tile'')', 'PERMISSION');
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
  -- tile_users (009), as a tile function calls it: active users with the tile + super users; never pending, disabled or without the tile
  select count(*) into n from core.tile_users('t-tile');
  if n <> 3 then raise exception 'tile_users rows: %', n; end if;
  if exists (select 1 from core.tile_users('t-tile') where username in ('t.pending', 't.disabled', 't.none')) then raise exception 'tile_users leaks'; end if;
  if (select string_agg(username, ',' order by username) from core.tile_users('t-tile')) <> 't.admin,t.super,t.user' then raise exception 'tile_users names'; end if;
  perform pg_temp.expect_error('select core.tile_users(''ghost'')', 'NO_ACCESS');
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
  perform public.core_admin_tile_save('t-tile', 'Test tile', '', 'tile', 'green', 10, array['export']);
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

  -- ---- 008: the super user manages accounts (rename, password, delete)
  declare v_tu uuid := (select id from t_ids where k = 't.user');
  begin
    -- anon and non-super refused
    perform pg_temp.act_as(null);
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''x.y'', ''x'')', v_tu), 'PERMISSION');
    perform pg_temp.expect_error(format('select public.core_admin_set_password(%L, ''NewPass2026x'', true)', v_tu), 'PERMISSION');
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''t.user'')', v_tu), 'PERMISSION');
    perform pg_temp.act_as('t.none'); perform public.core_session_start();
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''x.y'', ''x'')', v_tu), 'NO_RIGHT');
    perform pg_temp.expect_error(format('select public.core_admin_set_password(%L, ''NewPass2026x'', true)', v_tu), 'NO_RIGHT');
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''t.user'')', v_tu), 'NO_RIGHT');
    perform pg_temp.expect_error('select core.release_username(''t.user'')', 'PERMISSION');
    reset role;
  end;
  raise notice 'manage users refused ok';

  declare v_claims text; v_made uuid; v_tu uuid := (select id from t_ids where k = 't.user'); v_super uuid := (select id from t_ids where k = 't.super');
  begin
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    -- rename an owner-created account: the internal sign-in address moves with it
    perform public.core_admin_create_user('t.mk', 'Mk', 'TempPass2026');
    reset role;
    v_made := (select id from core.profiles where username = 't.mk');
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    select public.core_admin_update_user(v_made, ' T.Mk2 ', 'Mk Two') into v;
    if v ->> 'username' <> 't.mk2' or v ->> 'signs_in_with' <> 'username' then raise exception 'rename: %', v; end if;
    reset role;
    if (select email from auth.users where id = v_made) <> 't.mk2@users.dame-hub.local' then raise exception 'internal email not moved'; end if;
    if (select identity_data ->> 'email' from auth.identities where user_id = v_made) <> 't.mk2@users.dame-hub.local' then raise exception 'identity not moved'; end if;
    if (select display_name from core.profiles where id = v_made) <> 'Mk Two' then raise exception 'display name'; end if;
    if not exists (select 1 from core.username_history where username = 't.mk' and user_id = v_made) then raise exception 'history'; end if;
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    -- a retired name stays with its account: others refused (admin, sign-up), the same account takes it back
    perform pg_temp.expect_error($q$select public.core_admin_create_user('t.mk', 'x', 'TempPass2026')$q$, 'TAKEN:username');
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''t.mk'', ''x'')', v_tu), 'TAKEN:username');
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''t.admin'', ''x'')', v_tu), 'TAKEN:username');
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''Bad Name!'', ''x'')', v_tu), 'INVALID:username');
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''t.user'', ''  '')', v_tu), 'INVALID:display_name');
    perform pg_temp.expect_error(format('select public.core_admin_update_user(%L, ''t.zz'', ''x'')', gen_random_uuid()), 'NOT_FOUND');
    select public.core_admin_update_user(v_made, 't.mk', 'Mk Two') into v;
    if v ->> 'username' <> 't.mk' then raise exception 'take back'; end if;
    select public.core_admin_update_user(v_made, 't.mk3', 'Mk Two') into v;
    -- an email account: only the handle changes, the address stays
    select public.core_admin_update_user(v_tu, 't.user2', 'Test User') into v;
    if v ->> 'signs_in_with' <> 'email' then raise exception 'email account'; end if;
    reset role;
    if (select email from auth.users where id = v_tu) <> 't.user@example.com' then raise exception 'email changed'; end if;
    perform pg_temp.expect_error($q$insert into auth.users (email, raw_user_meta_data) values ('x9@example.com', '{"username":"t.mk2"}')$q$, 'TAKEN:username');
    raise notice 'rename ok';

    -- set password: every session of the user ends, the old token cannot start one again
    insert into t_ids values ('t.mk3', v_made);
    perform pg_temp.act_as('t.mk3'); perform public.core_session_start(); perform public.core_me();
    v_claims := current_setting('request.jwt.claims');
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    perform pg_temp.expect_error(format('select public.core_admin_set_password(%L, ''NewPass2026x'', true)', v_super), 'INVALID:user');
    perform pg_temp.expect_error(format('select public.core_admin_set_password(%L, ''short'', true)', v_made), 'INVALID:password');
    perform pg_temp.expect_error(format('select public.core_admin_set_password(%L, ''NewPass2026x'', true)', gen_random_uuid()), 'NOT_FOUND');
    select public.core_admin_set_password(v_made, 'KeepPass2026x', false) into v;
    if (v ->> 'must_change_password')::boolean then raise exception 'keep password'; end if;
    reset role;
    if (select encrypted_password from auth.users where id = v_made) <> extensions.crypt('KeepPass2026x', (select encrypted_password from auth.users where id = v_made)) then raise exception 'password not set'; end if;
    if exists (select 1 from auth.sessions where user_id = v_made) then raise exception 'sessions not ended'; end if;
    perform set_config('request.jwt.claims', v_claims, true); perform set_config('role', 'authenticated', true);
    perform pg_temp.expect_error('select public.core_me()', 'SIGNED_OUT');
    perform pg_temp.expect_error('select public.core_session_start()', 'SIGNED_OUT');
    reset role;
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    perform public.core_admin_set_password(v_made, 'TempPass2027', null);
    reset role;
    if not (select must_change_password from core.profiles where id = v_made) then raise exception 'reset flag'; end if;
    raise notice 'set password ok';

    -- delete: confirm by username, never self or a super user; access goes with the account, the name stays retired
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    perform public.core_tile_access_set('t-tile', v_made, true);
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''t.mk'')', v_made), 'INVALID:confirm');
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''t.super'')', v_super), 'INVALID:user');
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''x'')', gen_random_uuid()), 'NOT_FOUND');
    select public.core_admin_delete_user(v_made, ' T.Mk3 ') into v;
    if not (v ->> 'deleted')::boolean then raise exception 'delete'; end if;
    reset role;
    if exists (select 1 from auth.users where id = v_made) or exists (select 1 from core.profiles where id = v_made)
       or exists (select 1 from core.tile_access where user_id = v_made) or exists (select 1 from auth.identities where user_id = v_made) then
      raise exception 'delete left rows'; end if;
    if not exists (select 1 from core.username_history where username = 't.mk3') then raise exception 'deleted name not retired'; end if;
    if not exists (select 1 from core.audit where action = 'user_delete' and detail ->> 'user' = 't.mk3') then raise exception 'delete audit'; end if;
    -- a tile row tied to the account by a blocking foreign key: refused, nothing removed
    create table core.t_fk (user_id uuid references core.profiles (id)); -- rolled back with the rest
    insert into core.t_fk values ((select id from t_ids where k = 't.disabled'));
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''t.disabled'')', (select id from t_ids where k = 't.disabled')), 'IN_USE:user');
    reset role;
    drop table core.t_fk;
    if not exists (select 1 from core.profiles where username = 't.disabled') then raise exception 'blocked delete removed rows'; end if;
    if exists (select 1 from core.username_history where username = 't.disabled') then raise exception 'blocked delete retired name'; end if;
    -- owner frees a retired name
    perform core.release_username('t.mk3');
    perform pg_temp.expect_error('select core.release_username(''t.mk3'')', 'NOT_FOUND');
    raise notice 'delete ok';
  end;

  -- ---- health (010): super only; run now; a problem is stored and audited
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.core_admin_health()', 'PERMISSION');
  perform pg_temp.expect_error('select public.core_admin_health_run()', 'PERMISSION');
  perform pg_temp.act_as('t.user'); perform public.core_session_start();
  perform pg_temp.expect_error('select public.core_admin_health()', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.core_admin_health_run()', 'NO_RIGHT');
  perform pg_temp.expect_error('select core.run_health()', 'PERMISSION');
  reset role;
  perform pg_temp.act_as('t.pending'); perform public.core_session_start();
  perform pg_temp.expect_error('select public.core_admin_health()', 'NOT_APPROVED');
  reset role;
  perform pg_temp.act_as('t.super'); perform public.core_session_start();
  select public.core_admin_health_run() into v;
  if (v -> 'last' ->> 'problems')::int <> 0 or v -> 'last' ->> 'source' <> 'admin' then raise exception 'health run: %', v -> 'last'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'applied') e where e ->> 'repo' = 'dame-hub' and e ->> 'name' = '010_health') then raise exception 'health applied list'; end if;
  reset role;
  if not exists (select 1 from core.audit where action = 'security_check_run') then raise exception 'health run audit'; end if;
  create table core.t_norls (x int); -- a problem on purpose, rolled back with the rest
  if core.run_health('nightly') < 1 then raise exception 'health missed a problem'; end if;
  if not exists (select 1 from core.audit where action = 'security_check_problems' and detail ->> 'source' = 'nightly') then raise exception 'health problem audit'; end if;
  perform pg_temp.expect_error('select core.run_health(''other'')', 'INVALID:source');
  drop table core.t_norls;
  perform pg_temp.act_as('t.super'); perform public.core_session_start();
  select public.core_admin_health() into v;
  if (v -> 'last' ->> 'problems')::int < 1 or (v ->> 'failed_runs_30d')::int < 1 then raise exception 'health last: %', v; end if;
  if v -> 'last' -> 'detail' -> 0 ->> 'object' <> 'core.t_norls' then raise exception 'health detail: %', v -> 'last' -> 'detail'; end if;
  reset role;
  raise notice 'health ok';


  -- ---- 011: levels, groups, declarations, containers, the Access panel, Check access, Handover
  declare
    v_mgr uuid; v_one uuid; v_two uuid; v_three uuid; v_out uuid; v_r uuid; v_g uuid; v_g2 uuid;
  begin
    reset role;
    insert into auth.users (email, raw_user_meta_data) values
      ('a.mgr@example.com', '{"username":"a.mgr","display_name":"A Manager"}'), ('a.one@example.com', '{"username":"a.one"}'),
      ('a.two@example.com', '{"username":"a.two"}'), ('a.three@example.com', '{"username":"a.three"}'),
      ('a.out@example.com', '{"username":"a.out"}'), ('a.r@example.com', '{"username":"a.r"}');
    insert into t_ids select username, id from core.profiles where username like 'a.%';
    update core.profiles set status = 'active' where username like 'a.%';
    v_mgr := (select id from t_ids where k = 'a.mgr'); v_one := (select id from t_ids where k = 'a.one');
    v_two := (select id from t_ids where k = 'a.two'); v_three := (select id from t_ids where k = 'a.three');
    v_out := (select id from t_ids where k = 'a.out'); v_r := (select id from t_ids where k = 'a.r');

    -- a tile, declared by the owner (SQL editor or the tile's own file); the API role may not declare
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    perform public.core_admin_tile_save('a-tile', 'Access tile', '', 'tile', 'teal', 20, array['old_right']);
    perform public.core_admin_tile_enable('a-tile', true);
    perform pg_temp.expect_error($q$select core.tile_declare('a-tile', '{}')$q$, 'PERMISSION');
    perform pg_temp.expect_error($q$select core.container_put('a-tile', 'box', 'x', 'x')$q$, 'PERMISSION');
    reset role;
    perform core.tile_declare('a-tile', '{"levels":{"read":"Read boxes","manage":"Everything"},"aliases":{"edit":"contribute","verify":"approve"},
      "rights":{"special_x":"A special right"},"kinds":{"box":"Box"},"default":"contribute"}');
    perform pg_temp.expect_error($q$select core.tile_declare('a-tile', '{"aliases":{"edit":"boss"}}')$q$, 'INVALID:aliases edit');
    perform pg_temp.expect_error($q$select core.tile_declare('a-tile', '{"rights":{"approve":"x"}}')$q$, 'INVALID:rights approve');
    perform pg_temp.expect_error($q$select core.tile_declare('a-tile', '{"kinds":{"Bad Kind":"x"}}')$q$, 'INVALID:kinds Bad Kind');
    perform pg_temp.expect_error($q$select core.tile_declare('a-tile', '{"default":"manage"}')$q$, 'INVALID:default');
    perform pg_temp.expect_error($q$select core.tile_declare('a-tile', '{"other":1}')$q$, 'INVALID:spec other');
    perform pg_temp.expect_error($q$select core.tile_declare('ghost', '{}')$q$, 'NOT_FOUND');
    if (select rights from core.tiles where id = 'a-tile') <> array['special_x'] then raise exception 'declare rights'; end if;

    -- levels: people and a group (super user)
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    -- the form cannot change a declared tile's rights
    perform public.core_admin_tile_save('a-tile', 'Access tile', '', 'tile', 'teal', 20, array['other']);
    if (select rights from public.core_admin_tiles() where id = 'a-tile') <> array['special_x'] then raise exception 'declared rights kept'; end if;
    perform public.core_tile_level_set('a-tile', 'user', v_mgr, 'manage');
    perform public.core_tile_level_set('a-tile', 'user', v_one, 'contribute', array['special_x']);
    perform public.core_tile_level_set('a-tile', 'user', v_two, 'read');
    perform public.core_tile_level_set('a-tile', 'user', v_r, 'read');
    v_g := (public.core_admin_group_save(null, ' Application ', 'Application engineers') ->> 'id')::uuid;
    perform pg_temp.expect_error($q$select public.core_admin_group_save(null, 'application', '')$q$, 'TAKEN:group');
    perform pg_temp.expect_error($q$select public.core_admin_group_save(null, 'x', '')$q$, 'INVALID:name');
    perform public.core_admin_group_members_set(v_g, array[v_two, v_three]);
    perform pg_temp.expect_error(format('select public.core_admin_group_members_set(%L, array[%L]::uuid[])', v_g, (select id from t_ids where k = 't.pending')), 'INVALID:user');
    perform public.core_tile_level_set('a-tile', 'group', v_g, 'edit');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''user'', %L, ''boss'')', v_one), 'INVALID:level');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''user'', %L, ''read'', array[''nope''])', v_one), 'INVALID:rights');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''team'', %L, ''read'')', v_one), 'INVALID:type');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''user'', %L, ''read'')', (select id from t_ids where k = 't.super')), 'INVALID:user');
    reset role;
    if core.tile_level(v_two, 'a-tile') <> 'edit' or core.tile_level(v_three, 'a-tile') <> 'edit' then raise exception 'group level'; end if;
    if core.tile_level(v_one, 'a-tile') <> 'contribute' or core.tile_level(v_out, 'a-tile') is not null then raise exception 'own level'; end if;
    -- aliases, special rights, level names
    if not core.has_tile(v_one, 'a-tile', 'edit') or core.has_tile(v_one, 'a-tile', 'verify') then raise exception 'alias one'; end if;
    if not core.has_tile(v_mgr, 'a-tile', 'verify') or not core.has_tile(v_mgr, 'a-tile', 'special_x') then raise exception 'manager holds all'; end if;
    if not core.has_tile(v_one, 'a-tile', 'special_x') or core.has_tile(v_two, 'a-tile', 'special_x') then raise exception 'special'; end if;
    if not core.has_tile(v_two, 'a-tile', 'contribute') or core.has_tile(v_two, 'a-tile', 'approve') then raise exception 'level names'; end if;
    if core.has_tile(v_one, 'a-tile', 'undeclared') or core.has_tile(v_out, 'a-tile') then raise exception 'undeclared or no access'; end if;
    if not core.is_tile_admin(v_mgr, 'a-tile') or core.is_tile_admin(v_one, 'a-tile') then raise exception 'is_tile_admin'; end if;
    if (select is_admin from core.tile_access where user_id = v_mgr and tile_id = 'a-tile') is not true then raise exception 'is_admin mirror'; end if;
    -- page view: level, levels, held names
    perform pg_temp.act_as('a.three'); perform public.core_session_start();
    select public.core_me('a-tile') into v;
    if v ->> 'level' <> 'edit' or v -> 'levels' <> '["read","contribute","edit"]' or v -> 'rights' <> '["edit"]' or (v ->> 'tile_admin')::boolean then raise exception 'me three: %', v; end if;
    if v -> 'tile' -> 'kinds' ->> 'box' <> 'Box' then raise exception 'me kinds'; end if;
    if (select level from public.core_my_tiles() where id = 'a-tile') <> 'edit' then raise exception 'my_tiles level'; end if;
    perform pg_temp.expect_error('select public.core_tile_access_list(''a-tile'')', 'NO_RIGHT');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''user'', %L, ''read'')', v_one), 'NO_RIGHT');
    perform pg_temp.expect_error('select public.core_admin_groups()', 'NO_RIGHT');
    reset role;
    perform core.require_level('a-tile', 'edit');
    perform pg_temp.expect_error('select core.require_level(''a-tile'', ''approve'')', 'NO_RIGHT');
    perform pg_temp.expect_error('select core.require_level(''a-tile'', ''boss'')', 'INVALID:level');

    -- a manager: levels below manage only, not himself, not a group he is in
    perform pg_temp.act_as('a.mgr'); perform public.core_session_start();
    select public.core_tile_access_list('a-tile') into v;
    if (v ->> 'can_name_managers')::boolean or jsonb_array_length(v -> 'groups') <> 1 then raise exception 'access list: %', v; end if;
    if (select e ->> 'effective' from jsonb_array_elements(v -> 'people') e where e ->> 'username' = 'a.three') <> 'edit' then raise exception 'effective via group'; end if;
    perform public.core_tile_level_set('a-tile', 'user', v_out, 'read');
    perform public.core_tile_level_set('a-tile', 'user', v_out, null);
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''user'', %L, ''manage'')', v_one), 'NO_RIGHT');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''group'', %L, ''manage'')', v_g), 'NO_RIGHT');
    perform pg_temp.expect_error(format('select public.core_tile_level_set(''a-tile'', ''user'', %L, ''read'')', v_mgr), 'INVALID:user');
    perform pg_temp.expect_error('select public.core_tile_access_list(''t-tile'')', 'NO_RIGHT');
    reset role;

    -- containers: a.one makes box b1, only him (as the tile's function does: owner role, caller's session)
    perform pg_temp.act_as('a.one'); perform public.core_session_start(); reset role;
    perform core.container_put('a-tile', 'box', 'b1', 'Box one', null);
    perform pg_temp.expect_error($q$select core.container_put('a-tile', 'crate', 'b9', 'x')$q$, 'INVALID:kind');
    perform pg_temp.expect_error($q$select core.container_put('a-tile', 'box', 'b9', '  ')$q$, 'INVALID:name');
    perform pg_temp.expect_error($q$select core.container_put('a-tile', 'box', 'b9', 'x', 'all')$q$, 'INVALID:everyone');
    if core.container_level(v_one, 'a-tile', 'box', 'b1') <> 'contribute' then raise exception 'owner level'; end if;
    if core.container_level(v_mgr, 'a-tile', 'box', 'b1') <> 'manage' then raise exception 'managers see all'; end if;
    if core.container_level((select id from t_ids where k = 't.super'), 'a-tile', 'box', 'b1') <> 'manage' then raise exception 'super sees all'; end if;
    if core.container_level(v_two, 'a-tile', 'box', 'b1') is not null or core.container_level(v_out, 'a-tile', 'box', 'b1') is not null then raise exception 'private'; end if;
    if core.container_level(v_one, 'a-tile', 'box', 'nope') is not null then raise exception 'unregistered'; end if;
    perform core.require_container('a-tile', 'box', 'b1', 'contribute');
    perform pg_temp.expect_error($q$select core.require_container('a-tile', 'box', 'b1', 'edit')$q$, 'NO_RIGHT');
    if (select count(*) from core.container_ids('a-tile', 'box')) <> 1 then raise exception 'ids owner'; end if;
    if (core.container_info('a-tile', 'box', 'b1') ->> 'mine')::boolean is not true then raise exception 'info mine'; end if;
    perform pg_temp.act_as('a.two'); perform public.core_session_start(); reset role;
    perform pg_temp.expect_error($q$select core.require_container('a-tile', 'box', 'b1')$q$, 'NOT_FOUND');
    if (select count(*) from core.container_ids('a-tile', 'box')) <> 0 then raise exception 'ids private'; end if;
    if core.container_info('a-tile', 'box', 'b1') is not null then raise exception 'info private'; end if;

    -- the Access panel: owner shares; others may look but not change
    perform pg_temp.act_as('a.two'); perform public.core_session_start();
    perform pg_temp.expect_error($q$select public.core_share_get('a-tile', 'box', 'b1')$q$, 'NOT_FOUND');
    perform pg_temp.act_as('a.one'); perform public.core_session_start();
    select public.core_share_get('a-tile', 'box', 'b1') into v;
    if not (v ->> 'can_share')::boolean or (v ->> 'can_change_owner')::boolean or v ->> 'kind_label' <> 'Box' or v -> 'owner' ->> 'username' <> 'a.one' then raise exception 'share get: %', v; end if;
    select public.core_share_set('a-tile', 'box', 'b1', null, jsonb_build_array(jsonb_build_object('type', 'user', 'id', v_two, 'level', 'read'),
      jsonb_build_object('type', 'user', 'id', v_r, 'level', 'edit'), jsonb_build_object('type', 'user', 'id', v_one, 'level', 'edit'))) into v;
    if jsonb_array_length(v -> 'shares') <> 2 then raise exception 'owner not shared with himself: %', v -> 'shares'; end if;
    perform pg_temp.expect_error($q$select public.core_share_set('a-tile', 'box', 'b1', null, '[{"type":"user","id":"00000000-0000-0000-0000-000000000000","level":"owner"}]')$q$, 'INVALID:shares');
    perform pg_temp.expect_error($q$select public.core_share_set('a-tile', 'box', 'b1', null, '[{"type":"group","id":"00000000-0000-0000-0000-000000000000","level":"read"}]')$q$, 'INVALID:group');
    perform pg_temp.expect_error($q$select public.core_share_set('a-tile', 'box', 'b1', 'all', '[]')$q$, 'INVALID:everyone');
    perform pg_temp.expect_error($q$select public.core_share_set('a-tile', 'box', 'b1', null, '{}')$q$, 'INVALID:shares');
    select count(*) into n from public.core_share_people('a-tile') p, jsonb_array_elements(p -> 'people') e; if n <> 6 then raise exception 'share people: %', n; end if;
    reset role;
    if core.container_level(v_two, 'a-tile', 'box', 'b1') <> 'read' then raise exception 'can view'; end if;
    if core.container_level(v_r, 'a-tile', 'box', 'b1') <> 'read' then raise exception 'tile level is the ceiling'; end if;
    perform pg_temp.act_as('a.two'); perform public.core_session_start();
    select public.core_share_get('a-tile', 'box', 'b1') into v; if (v ->> 'can_share')::boolean then raise exception 'viewer shares'; end if;
    perform pg_temp.expect_error($q$select public.core_share_set('a-tile', 'box', 'b1', 'edit', '[]')$q$, 'NO_RIGHT');
    perform pg_temp.act_as('a.out'); perform public.core_session_start();
    perform pg_temp.expect_error($q$select public.core_share_get('a-tile', 'box', 'b1')$q$, 'NO_ACCESS');
    perform pg_temp.expect_error($q$select public.core_share_people('a-tile')$q$, 'NO_ACCESS');
    perform pg_temp.act_as(null);
    perform pg_temp.expect_error($q$select public.core_share_get('a-tile', 'box', 'b1')$q$, 'PERMISSION');
    reset role;
    -- a group "Can edit": its members work at their tile level; everyone "Can view"
    perform pg_temp.act_as('a.one'); perform public.core_session_start();
    perform public.core_share_set('a-tile', 'box', 'b1', 'read', jsonb_build_array(jsonb_build_object('type', 'group', 'id', v_g, 'level', 'edit')));
    reset role;
    if core.container_level(v_three, 'a-tile', 'box', 'b1') <> 'edit' then raise exception 'group can edit'; end if;
    if core.container_level(v_r, 'a-tile', 'box', 'b1') <> 'read' then raise exception 'everyone can view'; end if;
    perform pg_temp.act_as('a.r'); perform public.core_session_start(); reset role;
    if (select count(*) from core.container_ids('a-tile', 'box')) <> 1 or (select count(*) from core.container_ids('a-tile', 'box', 'edit')) <> 0 then raise exception 'ids level'; end if;

    -- a manager changes the owner; the old owner can no longer share
    perform pg_temp.act_as('a.mgr'); perform public.core_session_start();
    select public.core_share_get('a-tile', 'box', 'b1') into v; if not (v ->> 'can_change_owner')::boolean then raise exception 'mgr owner'; end if;
    perform pg_temp.expect_error(format('select public.core_share_owner_set(''a-tile'', ''box'', ''b1'', %L)', v_out), 'INVALID:user');
    perform public.core_share_owner_set('a-tile', 'box', 'b1', v_three);
    perform pg_temp.act_as('a.one'); perform public.core_session_start();
    perform pg_temp.expect_error(format('select public.core_share_owner_set(''a-tile'', ''box'', ''b1'', %L)', v_one), 'NO_RIGHT');
    perform pg_temp.expect_error($q$select public.core_share_set('a-tile', 'box', 'b1', 'edit', '[]')$q$, 'NO_RIGHT'); -- still "everyone can view"
    reset role;

    -- Check access, Handover, delete refused while owning, group delete
    perform pg_temp.act_as('t.super'); perform public.core_session_start();
    select public.core_admin_check_access(v_three) into v;
    if v -> 'groups' -> 0 ->> 'name' <> 'Application' or (select e ->> 'level' from jsonb_array_elements(v -> 'tiles') e where e ->> 'id' = 'a-tile') <> 'edit'
       or jsonb_array_length(v -> 'owns') <> 1 then raise exception 'check access: %', v; end if;
    perform pg_temp.expect_error(format('select public.core_admin_delete_user(%L, ''a.three'')', v_three), 'IN_USE:containers');
    perform pg_temp.expect_error(format('select public.core_admin_handover(%L, %L)', v_three, v_three), 'INVALID:user');
    select public.core_admin_handover(v_three, v_out) into v;
    if (v ->> 'moved')::int <> 1 or v -> 'without_access' <> '["a-tile"]' then raise exception 'handover: %', v; end if;
    select public.core_admin_handover(v_out, v_one, 'a-tile') into v; if (v ->> 'moved')::int <> 1 then raise exception 'handover back'; end if;
    perform public.core_admin_delete_user(v_three, 'a.three');
    select count(*) into n from jsonb_array_elements(public.core_admin_groups()) g where g ->> 'name' = 'Application' and jsonb_array_length(g -> 'members') = 1;
    if n <> 1 then raise exception 'groups list'; end if;
    perform pg_temp.expect_error(format('select public.core_admin_group_delete(%L, ''Sales'')', v_g), 'INVALID:confirm');
    perform public.core_admin_group_delete(v_g, 'application');
    reset role;
    if core.tile_level(v_two, 'a-tile') <> 'read' then raise exception 'group gone'; end if;
    if exists (select 1 from core.shares where group_id = v_g) then raise exception 'group shares gone'; end if;
    -- a tile's migration: holders of a special right become shares; share_put by hand
    perform core.container_put('a-tile', 'box', 'b2', 'Box two', null, v_mgr);
    update core.tile_access set rights = array['special_x'] where tile_id = 'a-tile' and user_id = v_two;
    if core.shares_from_right('a-tile', 'special_x', 'box', 'b2', 'read') <> 2 then raise exception 'shares_from_right count'; end if;
    if core.container_level(v_two, 'a-tile', 'box', 'b2') <> 'read' then raise exception 'shares_from_right level'; end if;
    perform core.share_put('a-tile', 'box', 'b2', v_r, null, 'edit');
    perform core.share_put('a-tile', 'box', 'b2', v_mgr, null, 'edit');   -- the owner: ignored
    if (select count(*) from core.shares where tile_id = 'a-tile' and id = 'b2') <> 3 then raise exception 'share_put'; end if;
    perform pg_temp.expect_error($q$select core.share_put('a-tile', 'box', 'nope', null, null)$q$, 'NOT_FOUND');
    perform pg_temp.expect_error($q$select core.share_put('a-tile', 'box', 'b2', null, null)$q$, 'INVALID:shares');
    perform pg_temp.act_as('a.one'); perform public.core_session_start();
    perform pg_temp.expect_error($q$select core.share_put('a-tile', 'box', 'b2', null, null)$q$, 'PERMISSION');
    reset role;
    -- redeclaring without a special right takes it from everyone; a tile switched off opens nothing
    perform core.tile_declare('a-tile', '{"kinds":{"box":"Box"}}');
    if exists (select 1 from core.tile_access where tile_id = 'a-tile' and rights <> '{}') then raise exception 'special right left'; end if;
    update core.tiles set enabled = false where id = 'a-tile';
    if core.container_level(v_one, 'a-tile', 'box', 'b1') is not null then raise exception 'tile off'; end if;
    -- storage policies may ask the container level; the API role may not reach the rest
    perform pg_temp.act_as('a.one'); perform public.core_session_start();
    perform core.container_level(v_one, 'a-tile', 'box', 'b1');
    perform pg_temp.expect_error($q$select core.require_container('a-tile', 'box', 'b1')$q$, 'PERMISSION');
    perform pg_temp.expect_error($q$select core.container_ids('a-tile', 'box')$q$, 'PERMISSION');
    perform pg_temp.expect_error($q$select core.tile_level(null, 'a-tile')$q$, 'PERMISSION');
    reset role;
  end;
  raise notice 'access (011) ok';


  -- ---- 011: the security check passes pg_cron's own two policies, and only those, only in pg_cron's shape
  if exists (select 1 from core.security_check() where object like 'cron.%') then raise exception 'pg_cron policies reported'; end if;
  if to_regnamespace('cron') is null then   -- local: a stand-in for pg_cron, rolled back with the rest
    create schema cron;
    create table cron.job (jobid bigint, username text not null default current_user);
    create table cron.job_run_details (runid bigint, username text);
    alter table cron.job enable row level security; alter table cron.job_run_details enable row level security;
    create policy cron_job_policy on cron.job using (username = current_user);
    create policy cron_job_run_details_policy on cron.job_run_details using (username = current_user);
    if exists (select 1 from core.security_check() where object like 'cron.%') then raise exception 'pg_cron policies reported'; end if;
    create policy t_other on cron.job using (true);
    if not exists (select 1 from core.security_check() where object = 'cron.job: t_other') then raise exception 'other cron policy missed'; end if;
    drop policy t_other on cron.job;
    alter policy cron_job_policy on cron.job using (true);
    if not exists (select 1 from core.security_check() where object = 'cron.job: cron_job_policy') then raise exception 'changed cron policy missed'; end if;
    drop schema cron cascade;
  end if;
  raise notice 'security check: pg_cron policies ok';

  -- ---- applied() refuses a second run
  perform pg_temp.expect_error('select core.applied(''dame-hub'', ''001_init'')', 'ALREADY_APPLIED: dame-hub/001_init');
  -- ---- the wall itself
  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;

  raise notice 'ALL CORE TESTS PASSED';
end $$;

rollback;
