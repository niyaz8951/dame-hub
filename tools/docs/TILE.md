# Tools tile

Tile id `tools` - path `/dame-hub/tools/` (kept inside the admin repo; `INSIDE_CORE` in `core/v1/config.js`) - no schema, no functions, no bucket.

## What it does
Four everyday engineering tools, each running entirely in the browser: the files the user chooses are read on the device and the results (Excel, PDF, PNG, CSV) are built there. Nothing is uploaded; the tile stores nothing in Supabase.

| Tool | Path | What it does |
|---|---|---|
| Parts List Extractor | `parts-extractor/` | Many spare-parts workbooks (.xlsx, .xlsm, .xls) in, one long table out: finds the header row, expands merged cells, unpivots the model columns. Runs in a worker. |
| Coil Data Extractor | `coil-data-extractor/` | WinCoil coil selection quotations (.docx, text PDF) in, one Excel table out, one row per coil, every field a column with its unit. |
| Container Calculator | `container-calculator/` | How many containers or trailers a shipment needs, with a load plan, stowage drawings and a PDF report. Packing runs in a module worker. |
| Psychrometric Chart | `psychrometric-chart/` | Air states on an ASHRAE-style chart (Hyland-Wexler), coil loads, SHR, mixing; CSV, PNG and print. |

Brought over as they were from `QuickTools` (parts extractor) and `Thinkneering` (the other three) on 2026-11-04, at the owner's request. Only the page head, the paths and the colour tokens changed.

## Rights
None. Anyone given the tile may use every tool.

## Data
- None in Supabase.
- `localStorage`, per browser, cleared on sign-out (keys start with `dame.`): `dame.tools.container-calculator.v1` (the last cargo list and settings), `dame.tools.psychro.v1:<username>` (the last set of air states).

## Files
```
tools/
  index.html                 the tile's home: one card per tool
  assets/tl.js               guard (Core.requireLogin({ tile: 'tools' })) + the TN / Hub helpers the tools call
  assets/tl.css              home page
  assets/tl-legacy.css       the old site's stylesheet with its tokens pointed at theme.css and the tile accent
  <tool>/index.html, styles.css, *.js
  vendor/pdfjs/              pdf.js (Apache 2.0) - text from PDF quotations
  vendor/xlsx/               SheetJS community build 0.18.5 (Apache 2.0) - reading workbooks in the parts extractor's worker
```

## Decisions
- Lives in `dame-hub/tools/` (owner, 2026-11-04): no separate repo. The core lists it in `INSIDE_CORE`, so the dashboard opens `/dame-hub/tools/`. The dev tooling that used to be in `tools/` moved to `dev/`.
- The tool pages keep their own layout (`tl-legacy.css` + each tool's `styles.css`) under the core topbar; the tile accent drives their primary colour. Chart series colours (`--chart-1..8`) are theme tokens set in `psychrometric-chart/styles.css`.
- The tools build markup with `innerHTML` from values they escape (`TN.esc`, `escapeHtml`); no database data is involved, and the CSP forbids inline scripts and style attributes. Accepted for this tile; new tools use `Core.el`.
- `Hub.toast` / `TN.toast` map to `Core.toast`; `tn:ready` fires when the guard has passed; `window.psyProfile` resolves to `{ user: me }`.
