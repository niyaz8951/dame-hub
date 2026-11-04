-- Demo tile tests. Run on STAGING after db/core/seed-staging.sql and demo/db/demo/001_init.sql. Rolled back.
begin;

create temp table t_ids as select username k, id from core.profiles where username in ('demo_admin','demo_user','demo_none','demo_pending');
grant select on t_ids to public;

create or replace function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  if p_key is null then perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return; end if;
  select id into v_id from t_ids where k = p_key;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.core_session_start();
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlerrm = p_code or (p_code = 'PERMISSION' and sqlstate = '42501') or (p_code = 'RLS' and sqlstate = '42501') then return; end if;
  if sqlerrm like 'expected error%' then raise; end if;
  raise exception 'expected % but got % (%) from: %', p_code, sqlerrm, sqlstate, p_sql;
end $$;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text) to public;

do $$
declare v jsonb; n int; v_id uuid; v_other uuid;
begin
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.demo_list()', 'PERMISSION');
  reset role;

  perform pg_temp.act_as('demo_pending');
  perform pg_temp.expect_error('select public.demo_list()', 'NOT_APPROVED');
  reset role;

  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error('select public.demo_list()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.demo_add(''x'', '''')', 'NO_ACCESS');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('demo', 'demo_none/a.txt')$q$, 'RLS');
  reset role;

  perform pg_temp.act_as('demo_user');
  select public.demo_add(' First note ', 'body') into v; v_id := (v ->> 'id')::uuid;
  perform pg_temp.expect_error('select public.demo_add('''', '''')', 'INVALID:title');
  perform pg_temp.expect_error('select public.demo_manage()', 'NO_RIGHT');
  select count(*) into n from public.demo_list() where mine; if n <> 1 then raise exception 'list mine'; end if;
  insert into storage.objects (bucket_id, name) values ('demo', 'demo_user/a.txt');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('demo', 'demo_admin/b.txt')$q$, 'RLS');
  reset role;

  -- admin: every right of the tile, but not another user's note
  perform pg_temp.act_as('demo_admin');
  select public.demo_add('Admin note', '') into v; v_other := (v ->> 'id')::uuid;
  perform pg_temp.expect_error(format('select public.demo_delete(%L)', v_id), 'NOT_FOUND');
  perform pg_temp.expect_error('select public.demo_manage()', 'NO_RIGHT'); -- 'manage' is not a declared right of the tile
  select count(*) into n from storage.objects where bucket_id = 'demo'; if n <> 1 then raise exception 'admin reads bucket'; end if;
  perform public.demo_delete(v_other);
  reset role;

  perform pg_temp.act_as('demo_user');
  perform public.demo_delete(v_id);
  delete from storage.objects where bucket_id = 'demo' and name = 'demo_user/a.txt';
  select count(*) into n from public.demo_list(); if n <> 0 then raise exception 'not empty'; end if;
  reset role;

  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;
  raise notice 'ALL DEMO TESTS PASSED';
end $$;

rollback;
