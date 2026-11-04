-- Demo tile: schema demo, one table, three functions, one private bucket with policies.
-- Touches only: schema demo, functions public.demo_*, bucket 'demo' and its storage policies.
-- Register the tile 'demo' in the admin page first (the security check wants a registered prefix).

create schema if not exists demo;
revoke all on schema demo from public, anon, authenticated;

create table demo.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  username   text not null,
  title      text not null check (char_length(title) between 1 and 80),
  body       text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now()
);
alter table demo.notes enable row level security;
create index notes_created_idx on demo.notes (created_at desc);

-- Anyone with the tile: list the notes.
create or replace function public.demo_list()
returns table (id uuid, username text, title text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('demo', null);
  return query
    select n.id, n.username, n.title, n.body, n.created_at, n.user_id = v_user.id
    from demo.notes n order by n.created_at desc limit 200;
end $$;
revoke execute on function public.demo_list() from public, anon;
grant execute on function public.demo_list() to authenticated;

-- Right 'edit': add a note.
create or replace function public.demo_add(p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_id uuid; v_title text := trim(coalesce(p_title, ''));
begin
  v_user := core.require_tile('demo', 'edit');
  if char_length(v_title) not between 1 and 80 then raise exception 'INVALID:title'; end if;
  if char_length(coalesce(p_body, '')) > 2000 then raise exception 'INVALID:body'; end if;
  insert into demo.notes (user_id, username, title, body) values (v_user.id, v_user.username, v_title, coalesce(p_body, ''))
  returning id into v_id;
  perform core.audit('demo', 'note_add', jsonb_build_object('id', v_id));
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.demo_add(text, text) from public, anon;
grant execute on function public.demo_add(text, text) to authenticated;

-- Right 'edit': delete your own note only (another user's note -> NOT_FOUND, never a hint that it exists).
create or replace function public.demo_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('demo', 'edit');
  delete from demo.notes where id = p_id and user_id = v_user.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform core.audit('demo', 'note_delete', jsonb_build_object('id', p_id));
end $$;
revoke execute on function public.demo_delete(uuid) from public, anon;
grant execute on function public.demo_delete(uuid) to authenticated;

-- A right nobody is given ('manage'): the demo page calls it to show a refused call.
create or replace function public.demo_manage()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_tile('demo', 'manage');
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.demo_manage() from public, anon;
grant execute on function public.demo_manage() to authenticated;

-- Private bucket: path <username>/<file>. Read: anyone with the tile. Write/delete: right 'edit', own folder only.
insert into storage.buckets (id, name, public) values ('demo', 'demo', false) on conflict (id) do nothing;

create policy demo_read on storage.objects for select to authenticated
  using (bucket_id = 'demo' and core.has_tile(auth.uid(), 'demo', null));
create policy demo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'demo' and core.has_tile(auth.uid(), 'demo', 'edit')
              and (storage.foldername(name))[1] = core.username_of(auth.uid()));
create policy demo_update on storage.objects for update to authenticated
  using (bucket_id = 'demo' and core.has_tile(auth.uid(), 'demo', 'edit')
         and (storage.foldername(name))[1] = core.username_of(auth.uid()));
create policy demo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'demo' and core.has_tile(auth.uid(), 'demo', 'edit')
         and (storage.foldername(name))[1] = core.username_of(auth.uid()));

select core.applied('demo', '001_init');
