-- DAME core 010: health.
--   core.health                   one row per run of core.security_check() (kept 180 days)
--   core.run_health(source)       runs the check, stores the result, writes an audit line when something is found
--   nightly schedule               pg_cron job 'dame-health' at 22:15 UTC (02:15 Dubai)
--   public.core_admin_health()     super user: last result, nightly job on/off, the SQL files that ran (Admin > Health)
--   public.core_admin_health_run() super user: run the check now from Admin > Health
-- Needs 001. Run in the SQL editor, then: select * from core.security_check();
-- If the notice says the nightly job could not be scheduled: Supabase > Integrations > Cron > enable, then run this file's
-- "schedule" block again (the lines between "do $schedule$" and "$schedule$;").

create table if not exists core.health (
  id       bigint generated always as identity primary key,
  ran_at   timestamptz not null default now(),
  source   text not null check (source in ('nightly', 'admin', 'sql')),
  problems integer not null,
  detail   jsonb not null default '[]'
);
alter table core.health enable row level security;
create index if not exists health_ran_at_idx on core.health (ran_at desc);

create or replace function core.run_health(p_source text default 'sql')
returns integer language plpgsql security definer set search_path = '' as $$
declare v_detail jsonb; v_n integer;
begin
  if p_source is null or p_source not in ('nightly', 'admin', 'sql') then raise exception 'INVALID:source'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('problem', c.problem, 'object', c.object) order by c.problem, c.object), '[]'::jsonb),
         count(*)::integer
    into v_detail, v_n
    from core.security_check() c;
  insert into core.health (source, problems, detail) values (p_source, v_n, v_detail);
  delete from core.health where ran_at < now() - interval '180 days';
  -- The audit keeps a permanent line for every run that found something (never for a clean run, to keep it readable).
  if v_n > 0 then perform core.audit(null, 'security_check_problems', jsonb_build_object('source', p_source, 'problems', v_n)); end if;
  return v_n;
end $$;
revoke execute on function core.run_health(text) from public, anon, authenticated;

-- Last result, nightly job state, applied SQL files. Super user only. Object names only: no row of any table.
create or replace function public.core_admin_health()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_last jsonb; v_nightly boolean; v_bad integer; v_files jsonb;
begin
  perform core.require_super();
  select jsonb_build_object('ran_at', h.ran_at, 'source', h.source, 'problems', h.problems, 'detail', h.detail)
    into v_last from core.health h order by h.ran_at desc, h.id desc limit 1;
  select count(*)::integer into v_bad from core.health h where h.problems > 0 and h.ran_at > now() - interval '30 days';
  -- null = pg_cron not installed; false = installed but the job is missing or paused; true = scheduled
  if pg_catalog.to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1 and active)' into v_nightly using 'dame-health';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('repo', m.repo, 'name', m.name, 'applied_at', m.applied_at) order by m.repo, m.name), '[]'::jsonb)
    into v_files from core.migrations m;
  return jsonb_build_object('last', v_last, 'nightly', v_nightly, 'failed_runs_30d', v_bad, 'applied', v_files, 'now', now());
end $$;
revoke execute on function public.core_admin_health() from public, anon;
grant execute on function public.core_admin_health() to authenticated;

create or replace function public.core_admin_health_run()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform core.require_super();
  v_n := core.run_health('admin');
  perform core.audit(null, 'security_check_run', jsonb_build_object('problems', v_n));
  return public.core_admin_health();
end $$;
revoke execute on function public.core_admin_health_run() from public, anon;
grant execute on function public.core_admin_health_run() to authenticated;

-- First entry, so Admin > Health shows a result at once.
select core.run_health('sql');

-- Nightly schedule. Supabase has pg_cron; a database without it (local tests) just skips this with a notice.
do $schedule$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available in this database: nightly check not scheduled (Admin > Health > Run check now still works).';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('dame-health', '15 22 * * *', $job$select core.run_health('nightly')$job$);
  raise notice 'Nightly check scheduled: job dame-health, 22:15 UTC.';
exception when others then
  raise notice 'Nightly check NOT scheduled (%): Supabase > Integrations > Cron > enable, then run this block again.', sqlerrm;
end $schedule$;

select core.applied('dame-hub', '010_health');
