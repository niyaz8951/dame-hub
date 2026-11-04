-- The internal address is now <username>@example.com: a domain reserved by IANA that exists (Supabase checks that),
-- can never receive mail and belongs to nobody. Replaces 002. Never mailed (confirm email is off), never shown.
-- Touches: core.on_auth_user_created only. core/v1/config.js EMAIL_DOMAIN changes in the same delivery.

create or replace function core.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text; v_display text;
begin
  v_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display  := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if v_username !~ '^[a-z0-9._-]{3,30}$' then raise exception 'INVALID:username'; end if;
  if new.email is distinct from v_username || '@example.com' then raise exception 'INVALID:username'; end if;
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 60 then raise exception 'INVALID:display_name'; end if;
  insert into core.profiles (id, username, display_name) values (new.id, v_username, v_display);
  insert into core.audit (user_id, username, action) values (new.id, v_username, 'request_access');
  return new;
end $$;
revoke execute on function core.on_auth_user_created() from public, anon, authenticated;
grant execute on function core.on_auth_user_created() to supabase_auth_admin;

select core.applied('dame-hub', '003_email_domain');
