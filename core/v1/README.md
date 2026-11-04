# core/v1 - what every page loads

Load order in `<head>`, after the two meta lines:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://cykpvtekrdfmqimtrcps.supabase.co; connect-src 'self' https://cykpvtekrdfmqimtrcps.supabase.co; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/dame-hub/core/v1/theme.css">
<script src="/dame-hub/core/v1/config.js" defer></script>
<script src="/dame-hub/core/v1/api.js" defer></script>
<script src="/dame-hub/core/v1/core.js" defer></script>
<script src="/<tile-id>/assets/<prefix>-page.js" defer></script>
```

The CSP line above is the published one. When a staging Supabase project is added, its URL is appended to `img-src` and `connect-src` here and in every page (core and tiles); `docs/STATUS.md` announces it under "Changes tiles must know".

Page skeleton:

```html
<!doctype html>
<html lang="en" data-loading>
<head> ...as above... <title>Name - DAME</title></head>
<body>
  <header id="topbar"></header>
  <main> ...page content, hidden until the guard passes... </main>
</body>
</html>
```

The page script starts with the guard and does nothing before it resolves:

```js
Core.requireLogin({ tile: 'hvac-notes' }).then(function (me) { /* build the page */ });
// also: { tile, right: 'edit' }  { super: true }  { page: 'Account' }
```

`style-src 'self'` blocks `style=""` attributes in markup. Set classes instead; setting `node.style.x` from a script is allowed.

## Core
| Call | What it does |
|---|---|
| `Core.requireLogin(opts)` | Promise of `me` = `{ username, display_name, status, is_super, tile, tile_admin, rights }`. Shows "waiting for approval" / "nothing here" itself and never resolves in those cases. Sends to sign-in when signed out. |
| `Core.user`, `Core.tile` | Set once the guard passed. For showing and hiding only; the database decides. |
| `Core.el(tag, attrs, ...children)` | Builds an element. `attrs`: `class`, `text`, `on: { click: fn }`, `dataset`, any attribute. Children: strings, nodes, arrays. |
| `Core.clear(node)`, `Core.append(node, child)`, `Core.$(selector)` | DOM helpers. |
| `Core.sheet({ title, body, actions, modal })` | Dialog; promise of the chosen action's `value`. `actions: [{ label, kind: 'primary'/'danger', value, onClick }]`; `onClick` returning `false` keeps it open. |
| `Core.confirm(text, { ok, danger })` | Yes / Cancel dialog; promise of `true`/`false`. |
| `Core.toast(text, kind)` | Short message; `kind`: `success`, `danger`. |
| `Core.showError(err, box)` | Puts the plain message of a thrown error into `box` (or a toast). |
| `Core.busy(button, fn)` | Runs `fn` with the button disabled and a spinner. |
| `Core.showState(title, text, { href, label })` | Replaces `main` with a centred message (empty, error). |
| `Core.date(v)`, `Core.dateTime(v)` | `4 Nov 2026`, `4 Nov 2026, 09:30`, local time. |
| `Core.download(name, blob)` | Saves a file built in the browser. |
| `Core.setTitle(text)`, `Core.param(name)`, `Core.go(path)` | Title, query parameter, navigation. |
| `Core.signOut()` | Ends the session everywhere and goes to the sign-in page. |
| `Core.ICONS` | Icon names a tile may use: `tile notes chart tools users folder book calc gear shield wind check`. |

## Api
| Call | What it does |
|---|---|
| `Api.rpc(name, params)` | Calls `public.<name>` with the session; params as `{ p_x: ... }` (match the function's argument names). Resolves to the result or rejects with `{ code, message }`. Codes: `SIGNED_OUT NOT_APPROVED NO_ACCESS NO_RIGHT NOT_FOUND INVALID:<field> NETWORK RATE SERVER`. |
| `Api.file.upload(bucket, path, blob)` | Upload (upsert). The bucket's policies decide. |
| `Api.file.url(bucket, path, seconds)` | Signed download URL, 5 minutes by default. |
| `Api.file.download(bucket, path)` | Promise of a Blob. |
| `Api.file.list(bucket, prefix)` | Objects under a prefix. |
| `Api.file.remove(bucket, path)` | Delete. |
| `Api.errorMessage(err)` | Plain message for any error. |
| `Api.auth.*` | Used by the core pages only. |

## Theme
Tokens: `--brand --brand-strong --brand-soft --on-brand --bg --surface --surface-2 --text --text-2 --text-3 --line --line-strong --success(-soft) --warning(-soft) --danger(-soft) --radius --radius-sm --space-1..7 --shadow --font --mono`.
Classes: `.icon.i-<name> .card .btn(.primary .danger .ghost .small .block) .field .hint .error .check .switch .table-wrap .badge(.brand .success .warning .danger) .chip .chips .notice(.success .warning .danger .brand) .state .tabs .tiles .tile .icon.<name> .row .stack .page-head .narrow .muted .faint .mono`.
Night mode follows the device; the topbar button overrides it (stored in `localStorage` as `dame.theme`).
