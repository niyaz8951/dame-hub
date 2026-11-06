# Core requests - Tools

## Open
- 2026-11-06 - **Site-wide: watch of vendored libraries** (raised under `docs/FOUNDATIONS.md`; fits F16). The rule book lets tiles copy libraries into `vendor/` but nothing tracks their versions or advisories, and each tile would otherwise check on its own. Asked: one list in the rule book (tile, library, version, licence, date checked) and a check on every push against known advisories. Why now, from this tile:
  - pdf.js 3.11.174 (`tools/vendor/pdfjs/`): CVE-2024-4367, script execution from a crafted PDF, fixed in 4.2.67, workaround `isEvalSupported: false`. Not reachable here today: the CSP has no `unsafe-eval` and the coil extractor only reads text (no glyph drawing). The tile adds the workaround on its next delivery anyway.
  - SheetJS 0.18.5 (`tools/vendor/xlsx/`): CVE-2023-30533 (prototype pollution, fixed 0.19.3) and CVE-2024-22363 (slow regex, fixed 0.20.2), both from a crafted workbook the user opens himself; it runs in a worker. npm stops at 0.18.5; newer builds come from SheetJS's own site. The tile will move to 0.20.3.

## Done
- 2026-11-04 - A tile kept inside the admin repo must open at `/dame-hub/<id>/`: done, `INSIDE_CORE` in `core/v1/config.js` + `Core.tilePath`.
