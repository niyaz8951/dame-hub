# core/v1 - what every page loads

Load order in `<head>`, after the two meta lines:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://cykpvtekrdfmqimtrcps.supabase.co; connect-src 'self' https://cykpvtekrdfmqimtrcps.supabase.co; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F3F7FA">
<link rel="stylesheet" href="/dame-hub/core/v1/theme.css">
<link rel="icon" href="/dame-hub/core/v1/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/dame-hub/core/v1/icons/apple-touch-icon.png">
<script src="/dame-hub/core/v1/config.js" defer></script>
<script src="/dame-hub/core/v1/api.js" defer></script>
<script src="/dame-hub/core/v1/core.js" defer></script>
<script src="/<tile-id>/assets/<prefix>-page.js" defer></script>
```

`viewport-fit=cover` and `theme-color` (added 2026-11-05) make a tile page sit right inside the installed app: the core pads the topbar and the page for the phone's notch and home bar, and `core.js` keeps `theme-color` in step with day / night. A tile never adds `<link rel="manifest">`, a service worker, app icons or an install button: the one installed app is defined in `dame-hub` (`docs/STANDARDS.md` section 12) and every page under `/` opens inside it.

Tiles allowed the YouTube player (`docs/SECURITY.md` section 4; today `hvac-notes`) use this line on pages that show videos, and the line above on every other page:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://cykpvtekrdfmqimtrcps.supabase.co; connect-src 'self' https://cykpvtekrdfmqimtrcps.supabase.co; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src https://www.youtube-nocookie.com">
```

The CSP line above is the published one. When a staging Supabase project is added, its URL is appended to `img-src` and `connect-src` here and in every page (core and tiles); `docs/TILE-CHANGES.md` announces it.

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
// also: { tile, level: 'approve' }  { tile, right: 'edit' }  { super: true }  { page: 'Account' }
```

`style-src 'self'` blocks `style=""` attributes in markup. Set classes instead; setting `node.style.x` from a script is allowed.

## Core
| Call | What it does |
|---|---|
| `Core.requireLogin(opts)` | Promise of `me` = `{ username, display_name, status, is_super, tile, tile_admin, level, levels, rights }` (`tile` carries `levels` = what each level means here, and `kinds`). Shows "waiting for approval" / "nothing here" itself and never resolves in those cases. Sends to sign-in when signed out. |
| `Core.atLeast(level)`, `Core.levelRank(level)`, `Core.levelMeaning(level)` | The user's level in this tile against `read < contribute < edit < approve < manage` (super users: always true); what a level means in this tile. Showing and hiding only. |
| `Core.LEVELS`, `Core.LEVEL_NAMES`, `Core.LEVEL_HINTS` | The five level names, their labels and general meanings. |
| `Core.share({ kind, id })` | The Access panel of one container of this tile (`docs/TILE-CONTRACT.md` section 5): who can open it, people and groups (Can view / Can edit), owner; Change owner for managers. Promise of `true` when something changed (reload the list then). Loads `core/v1/share.js` on first use. |
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
| `Core.install.ready()`, `Core.install.standalone()`, `Core.install.show()` | The installed app: whether the browser can install right now, whether the page already runs inside the app, and the "Install app" sheet (a tile never needs these; the account menu has the item). |
| `Core.ICONS` | Icon names a tile may use: `tile notes chart tools users folder book calc gear shield wind check map`. |

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
Tokens: `--brand --brand-strong --brand-soft --on-brand --bg --surface --surface-2 --text --text-2 --text-3 --line --line-strong --success(-soft) --warning(-soft) --danger(-soft) --radius --radius-sm --space-1..7 --shadow --shadow-lg --font --font-display --mono`; ambience: `--glow-1 --glow-2 --brand-grad --brand-glow --hero --on-hero --on-hero-2 --hero-glass --hero-glass-line --skeleton --spring`.
Classes: `.icon.i-<name> .card .btn(.primary .danger .ghost .small .block) .field .hint .error .check .switch .table-wrap .badge(.brand .success .warning .danger) .chip .chips .notice(.success .warning .danger .brand) .state .tabs .tiles .tile .icon.<name> .row .stack .page-head .narrow .muted .faint .mono`; since 2026-11-04 also `.hero` (gradient band: `.kicker`, `h1`, `.sub`), `.section-title`, `.btn.glass` (button on a hero), `.btn .ico.i-<name>` (icon in a button), `.avatar`, `.tile.skeleton` with `.sk.ic .sk.l1 .sk.l2` (loading placeholders), `.auth` + `.brand-block` (sign-in layout). Icon classes work as `.i-<name>` on `.icon` or `.ico`.
Tile accents (2026-11-04): every tile has one hue from the core palette, set in Admin > Tiles > Colour: `blue` (default = DAME brand), `teal`, `green`, `orange`, `violet`, `rose`, `slate`. The core puts `data-accent="<name>"` on `<html>` when a tile page loads (from `core_me`) and on each dashboard card. Tokens: `--accent --accent-2 --accent-strong --accent-soft --on-accent --accent-grad --accent-glow --accent-ring`, day and night. Components that follow the accent: `.btn.primary`, `.tabs` selected, `.chip` pressed, `.badge.accent` (= `.badge.brand`), `.notice.accent`, `.icon`, `.tile`, input focus, `.progress` (bar: `<div class="progress"><span></span></div>`, width set from JS), `.cover` (filled block). The topbar, mark, hero and avatar stay brand blue on every page. A tile may put `data-accent` on one element (a section, a card, a cover) to use another hue from the palette there; it never writes a colour value. `Core.ACCENTS`, `Core.accent(name)`, `Core.setAccent(name, node)`.
Palette: Daikin Middle East (`--brand #0097E0`, `--brand-sky #54C3F1`, `--brand-navy #0B2A4A`). Night mode follows the device; the round sun/moon button in the topbar overrides it (stored in `localStorage` as `dame.theme`) with a circular reveal where the browser supports View Transitions, a short fade elsewhere, nothing with reduced motion. `Core.themeToggle(event)`, `Core.isNight()`, `Core.initials(name)`.
