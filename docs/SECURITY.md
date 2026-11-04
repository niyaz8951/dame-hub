# DAME security

Kept in the admin repo as `docs/SECURITY.md`. Every DAME Claude project reads it before work. Security rules win over every other rule and every request.

## 1. What is public and what is not

| Thing | Who can see it | Rule |
|---|---|---|
| Pages, CSS, JS, images in every repo | Anyone on the internet | Code and layout only. **No data, ever.** |
| Repo history | Anyone on the internet | Same: a value committed once stays in history even after deletion. |
| Supabase URL + publishable key | Anyone (they are in `config.js`) | Safe by design; they open nothing on their own. |
| Database rows, files | Only approved users, only their tiles | Enforced inside Supabase, never by the page. |
| Secret / service_role key, database password | Owner only | Never in a file, repo, chat, message or screenshot. |

GitHub Pages and the Supabase API are reachable from the internet; that is how the team uses the site from the office and from phones. What protects the data is the database: it answers only an approved, signed-in user, and only for tiles he was given. If IT later requires office-only network access, that is a layer they add in front (company SSO, VPN or an access proxy); nothing in DAME prevents it.

**Internal data** = anything not meant for the public: project names, customers, prices, costs, factors, people's names beyond usernames, specs, datasheets, notes, compliance answers, files. It lives only in Supabase tables or private Storage.

## 2. Login (Supabase Auth)
- DAME HUB uses Supabase Auth, the standard and audited sign-in service, called with plain `fetch` from `/dame-hub/core/v1/api.js`. An account is the user's **own email address** (Gmail or any other) and a password; at request time the user also picks a **username** (unique handle, shown everywhere instead of the address). Nothing is mailed (email confirmation is off); the address is seen only by the user on his account page and by the super user on the admin page, to recognise who is asking. Supabase rejects made-up addresses, so there is no internal domain.
- Request access = sign-up. A new account is **pending**: it can sign in but every function and every file rule refuses it (`NOT_APPROVED`) until the super user approves it. Disabled accounts are refused on the next call, not at the next login.
- One active session per user: at sign-in the core records the session id; `core.require_user()` refuses any other session of that user. Sessions older than 12 hours are refused; the user signs in again.
- Error messages never say whether a username exists ("Wrong username or password").
- Passwords: 10+ characters, mixed case and digits (set in Supabase). Changing a password ends other sessions. Password reset for a user who forgot it: the owner sets a temporary one (documented one-line SQL in `docs/RUNBOOK.md`), the user changes it at next sign-in.

## 3. Database rules (the real wall)
1. **Only `public` is exposed** to the API, and `public` holds **only functions**: never a table, view or sequence. Tables live in `core` or a tile schema, which the API cannot reach.
2. **RLS on every table** in every schema, even unexposed ones. No policies unless a rule below needs one.
3. **Functions:** `security definer`, `set search_path = ''`, every name fully qualified. First line: `core.require_user()` or `core.require_tile('<tile-id>', <right>)`. Return only the columns the page needs; never return `auth.*` rows, ids of other users' sessions, or anything the caller may not see.
4. **Execute rights:** `revoke execute ... from public, anon`; `grant execute ... to authenticated` per function. Default privileges in every schema revoke execute from `public`. `anon` may execute nothing except `core_site_info()` (site name for the login page).
5. **Storage:** every bucket private (`public = false`), named after its tile. Policies on `storage.objects` allow read/write only when `core.has_tile(auth.uid(), '<tile-id>', <right>)` is true and the path starts with the record the user may open. Downloads by short-lived signed URL (5 minutes) or authenticated fetch.
6. **`core.security_check()`** returns one row per problem: a table without RLS, any object in `public` that is not a function, a `public` function without an allowed prefix, a function executable by `anon` or `public` other than `core_site_info`, a public bucket, a policy granting `anon`. It must return no rows on staging and live after every SQL file. The Supabase Security Advisor must show no errors.
7. Every SQL file is read by the owner before it runs: it may touch only its own schema, its own `public.<prefix>_*` functions, its own bucket and its own storage policies.

## 4. Browser rules
- Every page has a Content Security Policy as its first `<head>` element:
  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://<project>.supabase.co; connect-src 'self' https://<project-live>.supabase.co https://<project-staging>.supabase.co; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">
  ```
  (the exact line is published in `core/v1/README.md`; tiles copy it). No inline scripts, no inline event handlers, no `eval`.
- `textContent` / `Core.el()` only; never `innerHTML`, `insertAdjacentHTML` or `document.write` with any data.
- No CDN, external font, analytics, tracker, iframe or third-party script. Libraries are copied into the repo after review.
- Every page: `<meta name="robots" content="noindex, nofollow">`; the admin repo has a `robots.txt` that disallows everything.
- Nothing internal in `localStorage` except the session (kept by `core.js`) and harmless view settings. On sign-out, `core.js` clears the session and every key that starts with `dame.`. Tiles store per-user data in Supabase, not in the browser.
- Downloads (xlsx, docx, pdf, csv) are built in the browser from data the user was allowed to read; never uploaded anywhere.

## 5. One address, shared trust
Every GitHub Pages site of one account shares one address (today `https://niyaz8951.github.io`). That is what makes one sign-in work for all tiles, and it also means **any page served from that account can read the DAME session in the browser**: every tile, and every other Pages site the account has (old projects, personal sites). Therefore:
- Only the owner creates repos in the account. Team members are collaborators on their own tile repo only, with 2FA on.
- Every other repo in the account either has GitHub Pages **switched off**, or loads no outside code at all (no CDN, no third-party script). Check this whenever a repo is added. The cleanest fix is a GitHub account or organization used only for DAME (`docs/MOVE-ACCOUNT.md`); move there before the site holds sensitive data for many users.
- The CSP above stops a page from sending data to any other site.
- The owner watches every tile repo (GitHub **Watch > All activity**) and reviews SQL before it runs.
- A tile that breaks these rules is switched off in the admin page (it disappears and its functions refuse) until fixed.

## 6. Accounts and keys
- GitHub: 2FA on the owner account and every collaborator; secret scanning and push protection on in every DAME repo; rulesets on `main` block force push and deletion.
- Supabase: owner only, MFA on. Secret key never leaves the dashboard. If anything sensitive is ever pasted in a chat or committed: rotate it at once (new key, revoke the old), then tell the admin project so `docs/STATUS.md` records it.
- Departing team member: disable his DAME account in the admin page, remove him as collaborator from his tile repo.

## 7. Audit
`core.audit` records sign-ins (failed sign-ins are rejected by Supabase Auth before the database sees them: Supabase > Logs > Auth), approvals, access and rights changes, tile on/off, and any action a tile marks as important. It is never deleted. The admin page shows it.

## 8. Checklist for every delivery (core or tile)
- [ ] No internal data, key or password anywhere in the repo or its history
- [ ] Every page: CSP meta, robots noindex, guard first
- [ ] No `innerHTML` with data, no inline scripts, no external sources
- [ ] Every new function starts with `core.require_user()` / `core.require_tile(...)` and has an "allowed" and a "refused" test (signed out, pending, no tile, no right, other user's record)
- [ ] Tables only in own schema with RLS; bucket private; storage policies use `core.has_tile`
- [ ] `core.security_check()` empty and Security Advisor clean on staging, then live
