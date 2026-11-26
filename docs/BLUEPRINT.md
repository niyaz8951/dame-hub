# DAME HUB blueprint: departments, delegated admins, enterprise rules

The direction set by the owner on 2026-11-26 ("DAME HUB > department tiles > team / process tiles; the super user makes a department and its admin; the admin adds tiles and uploads tools; enterprise grade; SQL handled somehow"). This file is the rule set to build and run by. Where it differs from `docs/STANDARDS.md` or `docs/SECURITY.md` today, those files change **in the delivery that builds the phase** (section 12), not before; until then they stand. Nothing here weakens the wall: internal data stays in Supabase and reaches only people with access.

## 1. Principles
1. **Least power.** Everyone can do exactly what his role needs, inside his own department, and nothing else.
2. **The database decides.** Pages only show and hide. Every rule below is enforced in a function, with a refused test.
3. **Uploaded code is never trusted.** It runs sealed; it cannot read a session, another tile or the core.
4. **No one works alone at the top.** Two super users; no department without an admin; nothing reaches live data without an approval.
5. **Everything is recorded** and nothing in the audit is ever deleted.
6. **Departments need no developer and no SQL.** Whatever a department builds works through services the core already provides.
7. **Replaceable parts.** Sign-in, file store, database and pipeline each sit behind one interface, so IT can swap one without touching tiles.

## 2. Structure
```
DAME HUB (site)                 dashboard: the departments a user belongs to
  Department  (a tile, kind department)    its page: optional uploaded page + its tiles
    Tile      (kind tool or repo)          a team's or a process's tool
```
- Exactly three levels. A department holds tiles, never departments.
- Ids: department `sales`; its tiles `sales-pmo`, `sales-quotes` (the department id, a dash, a short name). Lower case, digits, dashes; permanent; never reused after a delete.
- Paths are derived from ids, never stored: uploaded files `/dame-hub/<tile-id>/`, repo tiles `/<tile-id>/`.
- The tiles that exist today (`hvac-notes`, `projects`, `maps`, `tools`, `demo`) stay as they are, as site-level tiles run by the super user, until the owner places them in a department.

## 3. Roles
| Role | Who names him | Scope |
|---|---|---|
| Super user | another super user | the whole site |
| Department admin | a super user, or an admin of that department | one department and every tile in it |
| Tile manager | the department admin | one tile (upload its files, give access to it) |
| Member | admin or manager | what his level allows (Read, Contribute, Edit, Approve) |

| Action | Super | Dept admin | Tile manager | Member |
|---|---|---|---|---|
| Create, delete a department; name its first admin | yes | - | - | - |
| Name or remove admins of his department | yes | yes | - | - |
| Create, edit, switch on / off, delete an uploaded tile in the department | yes | yes | - | - |
| Add a repo tile (needs SQL), move a tile between departments | yes | - | - | - |
| Upload, preview, make live, restore | yes | yes | his tile | - |
| Give and take access, levels, groups of the department | yes | yes | his tile | - |
| See the audit | all | his department | his tile | - |
| Approve SQL for live, keys, secrets, GitHub, Supabase | yes | - | - | - |

Rules that keep it safe:
- At least **two** active super users; the last one cannot be removed or disabled.
- A department always has at least one admin; the last one cannot be removed (hand over first).
- An admin cannot raise himself, act outside his department, or change a super user's account.
- A disabled account loses every role at once.

## 4. Access
- A level given on a department applies to every tile in it. A tile can be set to **only the people listed**; department admins still open it.
- Levels stay `read < contribute < edit < approve < manage` (core 011); department admin = Manage on the department.
- Groups: site groups by the super user; department groups by its admins, usable only inside that department.
- A user sees on the dashboard only departments where he has a level; inside, only tiles he may open. Everything else answers "nothing here".

## 5. Tile kinds
| Kind | For | Made by | Data |
|---|---|---|---|
| `department` | a department's space and landing page | super user | none of its own |
| `tool` (uploaded) | a ready HTML tool: calculator, tracker, register, form, dashboard | department admin | the data service (section 7) |
| `repo` | a tile that needs its own tables or a development team | super user, with a team and its Claude project | its own schema, through the pipeline (section 8) |

## 6. Uploaded tools
1. Files go up from the site only (Files page): upload > converted > preview > **Make live** > versions, restore.
2. They run in a **sealed frame**: a sandboxed frame without same-origin rights, on a page whose policy lets it reach nothing outside. It cannot read the session, cookies, storage, the parent page, another tile or any outside address.
3. A tool talks to the site only through the bridge the core gives it: `Dame.user()` (name and level, no token), `Dame.save / load / list / remove` (section 7), `Dame.download(name, blob)`, `Dame.toast(text)`.
4. No real data, names, prices or keys in the files: the repo is public. Data is entered in the tool and lives in the database.
5. Limits per tile: 300 files, 20 MB, 30 kept versions. Per department: 40 tiles. Changed only by a super user.
6. The rules for builders and the prompt for an AI that builds a tool are one text (`assets/hub-tool-guide.js`), shown when a tile is made and on every Files page. It is updated in the same delivery as any rule here.

## 7. Data
- **Class:** technical and work data only; nothing personal beyond username and display name (`docs/FOUNDATIONS.md` F9). Anything of a higher class waits for IT's platform.
- **The data service** (core): each tool gets named collections of JSON records. Every record has an owner, a time and a visibility: **mine** (only the user), **tile** (everyone with the tile; Contribute writes, Edit changes others' records, Approve / Manage delete), with a size cap per record and per tile. No tool creates a table.
- Every change to a shared record is kept in a history; a manager can export a tile's data as a file; deleting a tile exports first, then removes.
- Files that are data (drawings, spreadsheets users upload) go to the tile's private bucket through the same bridge, never to the repo.
- Backups: the whole database daily, kept 30 days, restore tested every quarter (section 9).

## 8. SQL and change control
- **Departments never write or run SQL** (sections 6 and 7 make it unnecessary).
- Core and repo-tile SQL goes through one pipeline, replacing paste-by-hand:
  1. a numbered file in `db/` arrives by pull request;
  2. the pipeline builds a fresh database, runs every file, the tests and `core.security_check()`: any failure stops it;
  3. it applies the file to **staging** and runs the checks again;
  4. it waits for a **super user's approval** in GitHub;
  5. it applies to **live**, records it (`core.applied`), and runs the security check; a failure pages the owner.
- Files are never edited after live; a mistake is fixed by the next file. Every file says how to undo it.
- The connection strings live only in GitHub environment secrets set by the owner; live is a protected environment that needs the approval. No key or password is ever in a repo, a page, a chat or the database.
- Code changes to `dame-hub` also arrive by pull request with the test run green; `main` is protected.

## 9. Security controls
- Accounts: username sign-in, approval by a super user, one session, 12 hours, password rules, lockout by Supabase. Company sign-in (SSO) when IT provides it (F22).
- MFA on GitHub and Supabase for every super user; the upload token is fine-grained, one repo, one year, rotated by diary.
- Every page carries the site policy; uploaded tools carry the stricter sealed policy.
- Environments: local (stand-in), staging, live. Nothing is tested on live.
- Monitoring: Admin > Health shows the security check, SQL waiting, upload setup and token expiry, backup age. Red items are fixed before any new work.
- Incident: switch the tile or department off (one click, functions refuse), revoke the upload token if code is suspected, read the audit, restore the last good version, record it in `docs/STATUS.md`.
- Review: the two super users read the audit and the admin list monthly; access of leavers is removed the day they leave.

## 10. Audit
Recorded with who, when, where: sign-ins, approvals, roles named and removed, access given and taken, departments and tiles created, edited, switched and deleted, every upload, live, restore and discard, data exports, SQL applied, limits changed. Admins read their department's; super users read all.

## 11. Lifecycle
- **New department:** super user creates it, names two admins where possible, switches it on. The admins get the guide.
- **New tool:** admin creates the tile (the guide and prompt appear), uploads, checks the preview, makes it live, gives access.
- **Change:** upload again > preview > Make live. Restore if wrong.
- **Retire:** switch off (kept), or delete (data exported first; id never reused).
- **Leaver:** account disabled; if he was the last admin, a super user names another first.
- **Growing up:** a tool that outgrows the data service becomes a repo tile with its own team; its data moves by one SQL file.
- **Handover to IT:** each interface (sign-in, file store, database, pipeline) with its contract, the runbook, the export, the audit.

## 12. Build order, each with its exit test
| Phase | What | Done when |
|---|---|---|
| 0 | Run 012 and 013, upload setup, first upload on live | PMO is live from an upload |
| 1 | Sealed frame and bridge; the data service (core 014) | a tracker saves shared records; a hostile test tool cannot read the session |
| 2 | Departments, department admins, inherited access, limits (core 015) | an admin builds a department alone; every action outside it is refused |
| 3 | Staging project and the SQL pipeline | a file reaches live only through an approval; a bad file is stopped |
| 4 | Second super user, backups, Health items, monthly review | restore tested; last-admin and last-super rules refuse |
| 5 | Existing tiles placed in departments; IT review | owner and IT sign off |
A phase starts only when the one before passed its test on staging and the owner said go.

## 13. What the owner provides
1. Phase 0 steps (`docs/RUNBOOK.md`, "Uploaded tiles: set up once").
2. A staging Supabase project; later the connection strings as GitHub environment secrets (never sent to anyone).
3. A second super user.
4. The list of departments and two admins each.
5. A "go" per phase, and the monthly review.
