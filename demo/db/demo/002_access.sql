-- Demo tile 002: the access model of core 011 (docs/TILE-CONTRACT.md section 5). Run after core 011.
-- The tile declares what its levels mean; each note becomes a container (kind 'note') that its author shares from
-- the Access panel (Core.share). Notes written before stay visible to everyone with the tile (Can view).
-- Touches only: the demo declaration, demo's containers, functions public.demo_*.

select core.tile_declare('demo', '{
  "levels": {
    "read": "Read the notes shared with him",
    "contribute": "Add notes and files, share and delete his own notes",
    "manage": "Every note, people and access of the tile"
  },
  "aliases": { "edit": "contribute" },
  "kinds": { "note": "Note" },
  "default": "contribute"
}');

-- notes already there: owner = author (when the account still exists), everyone can view
select count(core.container_put('demo', 'note', n.id::text, n.title, 'read',
                                (select p.id from core.profiles p where p.id = n.user_id)))
from demo.notes n;

-- The notes the caller may open, with what he may do there (access: level, mine, everyone, shared).
drop function if exists public.demo_list();
create function public.demo_list()
returns table (id uuid, username text, title text, body text, created_at timestamptz, mine boolean, access jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('demo', null);
  return query
    select n.id, n.username, n.title, n.body, n.created_at, n.user_id = v_user.id, core.container_info('demo', 'note', n.id::text)
    from demo.notes n
    where n.id::text in (select core.container_ids('demo', 'note'))
    order by n.created_at desc limit 200;
end $$;
revoke execute on function public.demo_list() from public, anon;
grant execute on function public.demo_list() to authenticated;

-- Level contribute: add a note. It starts as "everyone in Demo can view"; the author narrows it in Access.
create or replace function public.demo_add(p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_id uuid; v_title text := trim(coalesce(p_title, ''));
begin
  v_user := core.require_level('demo', 'contribute');
  if char_length(v_title) not between 1 and 80 then raise exception 'INVALID:title'; end if;
  if char_length(coalesce(p_body, '')) > 2000 then raise exception 'INVALID:body'; end if;
  insert into demo.notes (user_id, username, title, body) values (v_user.id, v_user.username, v_title, coalesce(p_body, ''))
  returning id into v_id;
  perform core.container_put('demo', 'note', v_id::text, v_title, 'read');
  perform core.audit('demo', 'note_add', jsonb_build_object('id', v_id));
  return jsonb_build_object('id', v_id);
end $$;

-- Delete your own note (a note he may not open, or someone else's: NOT_FOUND, never a hint that it exists).
create or replace function public.demo_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_container('demo', 'note', p_id::text, 'contribute');
  delete from demo.notes where id = p_id and user_id = v_user.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform core.container_drop('demo', 'note', p_id::text);
  perform core.audit('demo', 'note_delete', jsonb_build_object('id', p_id));
end $$;

-- Level manage (the tile's managers and the super user): the page calls it to show an allowed or refused call.
create or replace function public.demo_manage()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_level('demo', 'manage');
  return jsonb_build_object('ok', true);
end $$;

select core.applied('demo', '002_access');
