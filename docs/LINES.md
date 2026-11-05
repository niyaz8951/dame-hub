# Dashboard lines

One short line in the dashboard hero, in place of the old tile count. A new one on every sign-in and refresh, never one of the recently shown ones. Owner, 2026-11-05: "an online fact or motivational quote or HVAC historical quote, whenever users refresh or log in".

## Where it lives
- `/dame-hub/lines.json`: the list. Read by `assets/hub-dashboard.js` (`showLine`). Nothing in Supabase, no SQL.
- `dev/lines-check.mjs`: checks the file. Run it before every push: `node dev/lines-check.mjs`.
- The file is **public**, like every page. Facts, history, rules of thumb and quotes only. Never a project, customer, price, cost, person (beyond a public historical figure), product roadmap or anything else internal (`docs/SECURITY.md` section 1).

## A line
```json
{ "id": "h038", "kind": "history", "added": "2026-12-01", "text": "...", "source": "https://..." }
{ "id": "q016", "kind": "quote", "added": "2026-12-01", "text": "...", "by": "Name, year", "source": "work or letter, year" }
{ "id": "n001", "kind": "news", "added": "2026-12-01", "expires": "2027-03-01", "text": "...", "source": "https://..." }
```
| Field | Rule |
|---|---|
| `id` | Letter of the kind + number, never reused: `h` history, `r` rule, `f` fact, `q` quote, `n` news. Next number = highest of that letter + 1. |
| `kind` | `history` (shown as HVAC history), `rule` (Rule of thumb), `fact` (Did you know), `quote` (Quote), `news` (Latest). |
| `text` | One or two sentences, 200 characters max, plain text (no `<` `>`). Units with every number. Quotes without quote marks (the page adds them). |
| `by` | Quotes only: who, and the year when known. 60 characters max. |
| `source` | Where it can be checked: a URL, a standard, a patent, the work and year of a quote, or the arithmetic for a rule. Not shown on the page. |
| `added` | The day it was added (`YYYY-MM-DD`). A line with a future date waits until that day. |
| `expires` | Required for `news`, usually 90 days after `added`. Optional otherwise. Expired lines stop showing on their own; remove them at the next refresh. |

## What makes a good line
- **True and checked.** Every fact against a source found in that session; every number worked out again. When in doubt, leave it out.
- **Quotes only with a solid attribution** (the work, letter or speech it comes from). Famous lines that are commonly misattributed (most "Einstein" quotes, "What gets measured gets managed", "Whether you think you can...") are not used. Quotes from works still in copyright: short, famous, and no more than one per author per batch.
- Mix: mostly HVAC history and rules of thumb, a few quotes and Did-you-knows, news only when it matters to the team (refrigerant rules, standard editions, Middle East regulations, Daikin milestones that are public).
- Neutral: no politics, religion, jokes about people or groups, no product comparisons naming competitors badly.
- Short enough to read in five seconds on a phone.

## Refresh (Claude chat: **DAME-LINES refresh**)
1. Read `lines.json` from the repo (the repo copy, not a remembered one). Run `node dev/lines-check.mjs`.
2. Remove expired lines. Do not renumber anything.
3. Search for new material: recent HVAC news (last 60 days), anniversaries in the coming months, history, standards, engineering rules of thumb. Check each against a source.
4. Add 20-30 lines, none the same as an existing one in substance. Balance the kinds.
5. Run `node dev/lines-check.mjs` until it says OK. Look at a few on a phone width if any is near 200 characters.
6. Push to `main` with the message `Lines: +<n>, -<m> expired`. Add one line to "Log" at the end of this file (date, added, expired). No SQL, no security check; the site updates about a minute after the push (the browser may keep the old list up to 10 minutes).

## How the page shows it
- Its own row across the full width of the banner, under a thin divider, centred. A long line fills the first row and wraps centred below.

## How the page picks
- Loads the list after sign-in, keeps lines with a known kind, text up to 240 characters, `added` on or before today and `expires` on or after today (device's local date).
- Remembers the ids of the last shown lines in `localStorage` (`dame.lines.recent`, cleared on sign-out with the other `dame.` keys): half the list, at most 40. Picks at random from the rest.
- If the file cannot be read, the hero shows the date and greeting only.
- Grows comfortably to about 2,000 lines (around 300 KB). Past that, split into several files and load one at random; that change is in `assets/hub-dashboard.js` only.

## Log
- 2026-11-05: 76 lines (first batch).
