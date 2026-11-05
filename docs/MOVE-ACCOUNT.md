# Moving DAME to another GitHub account

Kept in the admin repo as `docs/MOVE-ACCOUNT.md`. For the day DAME moves from `niyaz8951` to an official account or organization, or the username itself is changed. About one hour, no code change, no data change.

## Why it is easy
- The site never contains the account name: the core is always at `/dame-hub/`, tiles at `/<tile-id>/`, links are root-relative, the database stores tile ids, not URLs.
- The data is in Supabase, which does not depend on GitHub at all. Users, passwords, access and every tile's data stay exactly as they are.
- A GitHub transfer keeps each repo's history, settings and name, and redirects the old repo links (web and git) to the new place.

What changes: the address (`https://niyaz8951.github.io/...` becomes `https://<new>.github.io/...`), so users sign in once more and update their bookmark.

## The only places the account name appears
Keep this list complete; the admin project adds to it if anything new ever needs the name.
1. Supabase, every project: **Authentication > URL Configuration** (Site URL, redirect URLs).
2. Docs in `dame-hub/docs/**/*.md` (including the tile project instructions in `docs/tiles/`), `dame-hub/README.md`, `dame-hub/demo/docs/*.md`, `dame-hub/tools/docs/*.md` and every tile's `docs/*.md` and README (text only).
3. Each Claude project's instructions and its GitHub connection.
4. Collaborators on each tile repo (people, not text).
5. Not the name, but the address: the installed app is tied to `https://<account>.github.io`. After a move every user installs the app again from the new address (`docs/RUNBOOK.md`, "Install the app") and removes the old icon; the manifest itself holds only root-relative paths and changes nothing.

## Steps

### A. Moving to a new account or organization
1. Create the new account or organization. Turn on 2FA (an organization: require it for everyone; members cannot create repos; base permission Read; secret scanning and push protection on for all repos).
2. **Transfer `dame-hub` first**: repo **Settings > General > Danger zone > Transfer ownership** > new owner. Keep the name `dame-hub`.
3. Transfer every tile repo and every source repo the same way (both lists in `docs/TILES.md`). Keep their names. Source repos stay private with Pages off.
4. In each transferred repo, check: **Pages** on (`main`, root), rulesets on `main`, secret scanning and push protection on. Re-add collaborators if any are missing (in an organization, use one team per tile with Write on its repo).
5. Supabase, every project: Site URL `https://<new>.github.io/dame-hub/`; redirect URLs `https://<new>.github.io/**` and `http://localhost:8080/**`.
6. Open `https://<new>.github.io/dame-hub/`, sign in, open every tile, run `select * from core.security_check();` (no rows) and the Security Advisor (no errors).
7. Claude projects: reconnect each project's GitHub connection to the repos at their new place; in each project's instructions, replace `niyaz8951` with the new name.
8. Admin project: "DAME-ADMIN: account moved to <new>" - it replaces the account name in every repo's docs and records the move in `docs/STATUS.md`.
9. Tell the team the new address. Optional: keep a redirect for old bookmarks for a few months - in the old account, a repo `niyaz8951.github.io` with a `404.html` that sends `/dame-hub/...` and `/<tile-id>/...` to the same path on the new address. Never create a new repo named `dame-hub` or a tile id in the old account: that would break GitHub's redirects.

### B. Changing the username only
GitHub **Settings > Account > Change username**. The repos stay in the same account and GitHub redirects their links; the Pages address becomes `https://<new-username>.github.io/...`. Then do steps A5 to A9.

## Data and Supabase (separate from GitHub)
- Supabase organization `DAME` is moved by inviting the new owner (IT or the official account) as **Owner**, then removing the old one; or **Project Settings > General > Transfer project** to IT's own Supabase organization. The project URL and keys stay the same, so the site needs no change.
- If IT moves the data to its own database later, `docs/RUNBOOK.md` covers the export (database dump + Storage buckets); only `core/v1/config.js` changes (URL and publishable key).

## Never changes in a move
Repo names, paths, tile ids, schemas, functions, buckets, users, passwords, access, rights, data, audit history.
