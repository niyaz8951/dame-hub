-- core.display_names: current names of the authors of shared records in a tile (request from hvac-notes,
-- 2026-11-04: shared highlights and notes). Called only from a tile's own public.<tile_id>_* functions,
-- never from the browser (schema core is not exposed and authenticated cannot execute it).
-- Touches: core.display_names (new). Nothing else changes.

create or replace function core.display_names(p_tile text, p_ids uuid[])
returns table (id uuid, username text, display_name text, active boolean)
language plpgsql security definer set search_path = '' stable as $$
begin
  -- The caller must have the tile; a tile may only ask in its own name.
  perform core.require_tile(p_tile, null);
  if coalesce(cardinality(p_ids), 0) > 500 then raise exception 'INVALID:ids'; end if;
  -- Pending accounts are never shown. Disabled users keep their name on what they wrote (active = false).
  -- Only the username and display name: never the email, status details or session data.
  return query
    select p.id, p.username, p.display_name, p.status = 'active'
    from core.profiles p
    where p.id = any (coalesce(p_ids, '{}'::uuid[]))
      and p.status in ('active', 'disabled');
end $$;
revoke execute on function core.display_names(text, uuid[]) from public, anon, authenticated;

select core.applied('dame-hub', '006_display_names');
