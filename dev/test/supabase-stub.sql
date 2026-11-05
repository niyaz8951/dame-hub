-- Minimal stand-in for a Supabase project, for local testing of DAME SQL only.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if; end $$;
grant anon, authenticated, service_role to postgres;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to public;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table auth.users owner to supabase_auth_admin;
grant usage on schema auth to anon, authenticated, supabase_auth_admin;
grant all on auth.users to supabase_auth_admin;
grant trigger on auth.users to postgres;
-- auth.uid()/auth.jwt() read request.jwt.claims like PostgREST does
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant execute on function auth.jwt(), auth.uid() to public;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, owner uuid, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
-- Supabase's default privileges in public
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
-- an extension-owned function in public must not be flagged
create extension if not exists "uuid-ossp" with schema public;
-- the rest of Supabase's auth.users columns, for the seed
alter table auth.users add column instance_id uuid, add column aud text, add column role text, add column email_confirmed_at timestamptz,
  add column raw_app_meta_data jsonb, add column confirmation_token text, add column recovery_token text, add column email_change_token_new text,
  add column email_change text, add column email_change_token_current text, add column phone_change text, add column phone_change_token text,
  add column reauthentication_token text;
create table auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, identity_data jsonb, provider text, provider_id text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
grant all on auth.identities to supabase_auth_admin;
-- Supabase sessions (refresh tokens hang off them); the JWT claim session_id is auth.sessions.id
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now());
grant all on auth.sessions to supabase_auth_admin;
