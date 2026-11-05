-- DAME core 009: core.tile_users(p_tile) - who a tile may offer in a "share with" list.
-- Requested by `projects` (docs/CORE-REQUESTS.md, 2026-11-05) for its Share sheet.
-- Same pattern as core.display_names (006): called only inside a tile's own functions, never by the API role.
-- Needs 001 (and 006 for the pattern only). Run in the SQL editor, then: select * from core.security_check();

create or replace function core.tile_users(p_tile text)
returns table (id uuid, username text, display_name text)
language plpgsql security definer set search_path = '' stable as $$
begin
  -- The caller must have the tile; a tile may only ask in its own name.
  perform core.require_tile(p_tile, null);
  -- Active people who can open the tile: users given access, plus super users (who have every tile).
  -- Only the username and display name: never the email, status, rights or session data.
  return query
    select p.id, p.username, p.display_name
    from core.profiles p
    where p.status = 'active'
      and (p.is_super or exists (select 1 from core.tile_access a where a.user_id = p.id and a.tile_id = p_tile))
    order by p.username;
end $$;
revoke execute on function core.tile_users(text) from public, anon, authenticated;

select core.applied('dame-hub', '009_tile_users');
