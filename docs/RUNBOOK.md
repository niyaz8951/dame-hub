# DAME runbook (owner)

Everything here is done by the owner in the GitHub or Supabase dashboard. Nothing needs the secret key.

## Apply a SQL file
1. Open the file in the repo and read it: only its own schema, its own `public.<prefix>_*` functions, its own bucket and policies; nothing granted to `anon` or `public`.
2. Supabase > **SQL editor** > paste the whole file > Run. The last line prints `applied <repo>/<name>`; a file that already ran stops with `ALREADY_APPLIED`.
3. `select * from core.security_check();` - must return **no rows**. Then **Advisors > Security Advisor** - no errors.
4. Record it in `docs/STATUS.md` ("SQL applied").
Order: staging first (while it exists as a separate project), test, then live. A fix is a new numbered file, never an edit.

## First run on a fresh project
1. `db/core/001_init.sql`, then the security check.
2. On the site, **Request access** with your email, a username (e.g. `niyaz`) and a password.
3. `select core.make_super('niyaz');` - your account is active and super.
4. Admin page > Tiles > New tile `demo` (name Demo, right `edit`), then `demo/db/demo/001_init.sql`, security check, switch the tile on.
Staging only: `db/core/seed-staging.sql` creates the demo tile and four demo accounts (password `DemoPass2026`). Never on live.

## Create a user (no email needed)
Admin page > Users > **New user**: username, display name, temporary password (10+ characters, mixed case, a digit). Tell the person the username and the temporary password by voice; he signs in with them and must choose his own password at once. Users who prefer their own email can still use **Request access** on the site and wait for your approval.

## Approve, refuse, disable, enable a user
Admin page > Requests (approve or refuse) and Users (disable or enable). A disabled user is refused on his next call and cannot sign in. In SQL if needed:
```sql
update core.profiles set status = 'active' where username = 'name';
```

## Reset a password the user forgot
```sql
select core.reset_password('name', 'TempPass2026');
```
Sets a temporary password (10+ characters, mixed case and a digit), ends his session and forces a new password at his next sign-in. Tell him the temporary password by voice or in person, never by chat.

## Name or remove a super user
```sql
select core.make_super('name');                                   -- add
update core.profiles set is_super = false where username = 'name'; -- remove
```

## Switch a tile off / on
Admin page > Tiles > the switch. Off: the tile disappears from every dashboard and every `public.<tile>_*` function refuses with `NO_ACCESS`. Use it the moment a tile breaks a rule.

## Rotate a key
- **Publishable key** (public): Supabase > Project Settings > API Keys > create a new one, put it in `core/v1/config.js`, push, then disable the old one. Nothing else changes.
- **Secret / service_role key** or the **database password**: rotate in the dashboard at once if it was ever shown anywhere. DAME never uses them, so nothing in the repos changes. Tell the admin project so `docs/STATUS.md` records the date.

## Departing team member
Admin page > Users > Disable. GitHub: remove him as collaborator from his tile repo. If he was a tile admin, name another one (Tiles > Access).

## Sign-in troubles
- "Wrong username or password" for a user who is sure: `select p.username, u.email, p.status, p.session_started_at from core.profiles p join auth.users u on u.id = p.id where p.username = 'name';` then reset the password.
- Everyone signed out at once: sessions end after 12 hours; that is normal in the morning.
- Failed sign-in attempts are in Supabase > **Logs > Auth** (the database does not see them). Supabase rate-limits sign-in attempts; never raise those limits.

## Add a staging project
1. Supabase: new project `dame-staging`, same Auth settings as `01-SETUP.md` step 2.4, Site URL and redirects the same.
2. Run `db/core/001_init.sql`, `seed-staging.sql`, every tile's SQL; security check.
3. `core/v1/config.js`: `STAGING = { url, key }`; add the staging URL to `img-src` and `connect-src` in the CSP line of every page (core and tiles) and in `core/v1/README.md`; announce it in `docs/STATUS.md` under "Changes tiles must know".

## Export (backup)
- Database: Supabase > Database > Backups (Pro: daily). Free: from any machine with `pg_dump`, using the connection string from the dashboard (database password from your password manager, never in a file):
  `pg_dump "<connection string>" --schema=core --schema=<each tile schema> --no-owner --no-privileges -F c -f dame-$(date +%F).dump`
  and the users: `pg_dump "<connection string>" --table=auth.users --table=auth.identities --data-only -f dame-auth-$(date +%F).sql`
- Files: Supabase > Storage > each bucket > download, or `supabase storage cp -r ss:///<bucket> ./backup/<bucket>` with the Supabase CLI signed in as owner.
- Code: the repos.
A free project pauses after a week without use; open the dashboard once a week or move to Pro.

## Hand over to IT
`docs/MOVE-ACCOUNT.md` (GitHub) and the Supabase organization `DAME`: invite IT as Owner, then remove yourself. The site keeps working throughout; only the address changes if the GitHub account moves.

## Local run and tests
- `node tools/serve.mjs` in `dame-hub`: `http://localhost:8080/dame-hub/` plus every sibling repo at `/<tile-id>/` (and `demo/` from this repo). Local pages talk to `STAGING` from `config.js`.
- `tools/test/run.sh`: full local test with a throw-away Postgres standing in for Supabase (SQL tests, demo tests, security check, browser run). See the header of the script for what it needs.
- `db/core/tests.sql` and `demo/db/demo/tests.sql` can also be pasted into the staging SQL editor; they roll back and print `ALL ... TESTS PASSED`.
