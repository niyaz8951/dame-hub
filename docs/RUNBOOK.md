# DAME runbook (owner)

Everything here is done by the owner in the GitHub or Supabase dashboard. Nothing needs the secret key.

## Apply a SQL file
1. Open the file in the repo and read it: only its own schema, its own `public.<prefix>_*` functions, its own bucket and policies; nothing granted to `anon` or `public`.
2. Supabase > **SQL editor** > paste the whole file > Run. The last line prints `applied <repo>/<name>`; a file that already ran stops with `ALREADY_APPLIED`.
3. Admin > **Health** > **Run check now** - must say **Clean** (same as `select * from core.security_check();` returning no rows). Then Supabase **Advisors > Security Advisor** - no errors.
4. Admin > Health > **SQL files** shows what is still waiting, in order. `docs/STATUS.md` ("SQL applied") records it at the next delivery.
Order: staging first (while it exists as a separate project), test, then live. A fix is a new numbered file, never an edit.

## Health (Admin > Health)
- **Security check**: the last result of `core.security_check()`, run every night at 02:15 Dubai (pg_cron job `dame-health`) and whenever you press **Run check now**. Anything listed is a hole in the wall: switch off the tile that owns the object (Tiles), then tell the admin project the object's name. Every run that finds something also leaves an audit line `security_check_problems`.
- **Nightly check off / not installed**: Supabase > Integrations > **Cron** > enable, then run the `do $schedule$ ... $schedule$;` block at the end of `db/core/010_health.sql` again. To see the job: `select jobname, schedule, active from cron.job;`; its last runs: `select status, start_time from cron.job_run_details order by start_time desc limit 5;`.
- **SQL files**: per repo, the files its `db/migrations.json` lists that have not run here, in order, each linked. Run them top to bottom (core first), reading each one. "No list" means the tile has not published its list yet; its applied count is shown.
- The red number on the tab = problems + waiting files.

## First run on a fresh project
1. `db/core/001_init.sql`, then the security check.
2. On the site, **Request access** with your email, a username (e.g. `niyaz`) and a password.
3. `select core.make_super('niyaz');` - your account is active and super.
4. The other core files in order (`db/migrations.json`; Admin > Health lists them), then the security check.
5. Admin page > Tiles > New tile `demo` (name Demo), then `demo/db/demo/001_init.sql` and `002_access.sql`, security check, switch the tile on.
Staging only: `db/core/seed-staging.sql` creates the demo tile and five demo accounts (password `DemoPass2026`). Never on live.

## Create a user (no email needed)
Admin page > Users > **New user**: username, display name, temporary password (10+ characters, mixed case, a digit). Tell the person the username and the temporary password by voice; he signs in with them and must choose his own password at once. Users who prefer their own email can still use **Request access** on the site and wait for your approval.

## Manage a user: rename, password, disable, delete
Admin page > Users > **Manage** on the user's row (needs `db/core/008_manage_users.sql`):
- **Name**: change the username and the display name. An account you created signs in with the new username at once (tell him); an account on his own email keeps signing in with the email, only the handle changes. The old username stays with that account: nobody else can take it (a newcomer would otherwise inherit history lines and files written under it). To free one anyway: `select core.release_username('name');`
- **Password**: type one or press **Generate**, then **Set password**. He is signed out everywhere at once. With "Ask for a new password at the next sign-in" ticked (the default) it is a reset: he must choose his own at sign-in. Unticked, it is a password he keeps. Tell it by voice or in person, never by chat.
- **Disable / Enable**: as below.
- **Access** (Check access): every tile he can open with his level and why (own, through which group), his special rights, what he owns and what is shared with him. **Hand over** moves everything he owns (projects, maps, notebooks ...) to another active person; a red note names any tile the new owner cannot open yet (give it in Tiles > Access).
- **Delete account**: type the username, then **Delete for good**. The sign-in, the profile, all tile access, group memberships and shares go; what he wrote in tiles stays under the name saved at the time. Cannot be undone; if unsure, disable instead. Refused while he still owns something in a tile: hand it over first (above). If a tile ties records to the account in another way the delete is refused with a message: disable the account.
Your own row and other super users show the name section only: your password is changed on the Account page, a super user's in SQL (below).

## Approve, refuse, disable, enable a user
Admin page > Requests (approve or refuse) and Users > Manage (disable or enable). A disabled user is refused on his next call and cannot sign in. In SQL if needed:
```sql
update core.profiles set status = 'active' where username = 'name';
```

## Reset a password in SQL (a super user, or without the admin page)
The admin page does this for everyone else (Users > Manage > Password).
```sql
select core.reset_password('name', 'TempPass2026');
```
Sets a temporary password (10+ characters, mixed case and a digit), ends all his sessions and forces a new password at his next sign-in. Tell him the temporary password by voice or in person, never by chat.

## Name or remove a super user
```sql
select core.make_super('name');                                   -- add
update core.profiles set is_super = false where username = 'name'; -- remove
```

## Give access: levels, groups, managers
- **Tiles > Access** (or, for a tile's manager, account menu > *Access to <tile>* inside the tile): each person and each group has one level - No access, Read, Contribute, Edit, Approve, Manage. A person's level is the highest of his own and his groups'; the row says "Edit through Application" when a group gives more. What each level means in that tile is under *What the levels mean*. Special rights, if the tile declares any, are the chips under the name.
- **Manage** is the tile admin: he gives the other levels to people and groups of his tile and opens everything in it. Only you give or take Manage.
- **Groups** (Admin > Groups): New group, Members, Edit, Delete (type the name). A group reaches nothing until it has a level on a tile (Tiles > Access) or something is shared with it. Deleting a group takes its levels and shares with it; its members keep their own access.
- **Sharing one project, map or notebook**: its owner or a manager presses **Share** in the tile: everyone in the tile (can edit or can view), or only the people and groups listed (Can view / Can edit). Nobody gets more than his level in the tile. Managers always open it.
- A tile that has not run `core.tile_declare` yet shows "Not declared" in Tiles; its rights field still works the old way until then.

## Switch a tile off / on
Admin page > Tiles > the switch. Off: the tile disappears from every dashboard and every `public.<tile>_*` function refuses with `NO_ACCESS`. Use it the moment a tile breaks a rule.

## Rotate a key
- **Publishable key** (public): Supabase > Project Settings > API Keys > create a new one, put it in `core/v1/config.js`, push, then disable the old one. Nothing else changes.
- **Secret / service_role key** or the **database password**: rotate in the dashboard at once if it was ever shown anywhere. DAME never uses them, so nothing in the repos changes. Tell the admin project so `docs/STATUS.md` records the date.

## Departing team member
Admin page > Users > Manage: **Hand over** what he owns to his successor, then **Disable** (delete later, once nobody needs his account any more). Take him out of his groups (Groups > Members). GitHub: remove him as collaborator from his tile repo. If he was a manager of a tile, give Manage to another (Tiles > Access).

## Sign-in troubles
- "Wrong username or password" for a user who is sure: `select p.username, u.email, p.status, p.session_started_at from core.profiles p join auth.users u on u.id = p.id where p.username = 'name';` then reset the password.
- Everyone signed out at once: sessions end after 12 hours; that is normal in the morning.
- Failed sign-in attempts are in Supabase > **Logs > Auth** (the database does not see them). Supabase rate-limits sign-in attempts; never raise those limits.

## Add a staging project
1. Supabase: new project `dame-staging`, same Auth settings as `01-SETUP.md` step 2.4, Site URL and redirects the same.
2. Run `db/core/001_init.sql`, `seed-staging.sql`, every tile's SQL; security check.
3. `core/v1/config.js`: `STAGING = { url, key }`; add the staging URL to `img-src` and `connect-src` in the CSP line of every page (core and tiles) and in `core/v1/README.md`; announce it in `docs/TILE-CHANGES.md`.

## Install the app (team instructions)
One app for the whole site; tiles open inside it. Sign in first, then in the account menu (top right) tap **Install app**.
- **Android** (Chrome, Edge, Samsung Internet): the browser's own prompt opens; tap **Install**. If nothing opens, browser menu (three dots) > **Install app** / **Add to Home screen**.
- **iPhone, iPad**: Safari > **Share** (square with arrow) > **Add to Home Screen** > **Add**. Chrome on iPhone: Share in the address bar > Add to Home Screen.
- **Laptop** (Chrome, Edge): the install icon at the right end of the address bar, or menu > **Install DAME HUB**. Safari on Mac: File > Add to Dock. Firefox does not install web apps.
The app is a window on the live site: nothing is kept on the device, and signing out in the app signs out everywhere. "Can't be installed" means the manifest did not load: open `https://<account>.github.io/dame-hub/manifest.webmanifest` in the browser; it must show JSON, and Pages must be live.

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
- `node dev/serve.mjs` in `dame-hub`: `http://localhost:8080/dame-hub/` plus every sibling repo at `/<tile-id>/` (tiles inside this repo, `demo` and `tools`, at `/dame-hub/<tile-id>/`). Local pages talk to `STAGING` from `config.js`.
- `dev/test/run.sh`: full local test with a throw-away Postgres standing in for Supabase (SQL tests, demo tests, security check, browser run). See the header of the script for what it needs.
- `db/core/tests.sql` and `demo/db/demo/tests.sql` can also be pasted into the staging SQL editor; they roll back and print `ALL ... TESTS PASSED`.
