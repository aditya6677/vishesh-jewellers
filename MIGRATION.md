# Framework migration

## Recovery points

- Stable baseline: annotated tag `pre-framework-migration-2026-10-25` at `9992a56`.
- Migration branch: `migration/react-fastify`.
- `main` remains on the pre-migration implementation.
- Local encrypted store and matching key snapshot:
  `backups/pre-framework-migration-2026-10-25/` (ignored by Git).
- Original and React dashboard screenshots are kept in that same local directory.

The Git tag protects code. The encrypted data snapshot protects data, and its key
must remain with it. No data-schema migration is performed in this phase.

## Phase 1: backend and Dashboard

- Fastify is the default HTTP backend. Existing feature routes and response
  contracts are retained through a small adapter. Storage and financial services
  remain unchanged.
- `BACKEND_MODE=legacy` selects the original HTTP router for comparison or recovery.
- React, TypeScript, and Vite are installed with locked dependency versions.
- Dashboard is implemented as React components with the existing CSS classes.
- `GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` reads one store snapshot and
  uses the existing dashboard calculation function. It does not write data.
- React owns only `#react-dashboard`. Legacy Dashboard scripts are excluded in
  preview mode, so they cannot modify React's elements.
- Existing navigation calls a narrow refresh bridge when returning to Dashboard.
- Invoice, Stocks, Purchase, Payment, Records, Settings, and PIN entry still use
  the original UI implementations.

## Phase 2: Stocks

- React preview now owns Dashboard and Stocks; the original Stocks page remains
  available with `?frontend=legacy`. Other menus retain their existing UI.
- Reusable typed dropdown, dialog, and pagination components preserve the theme.
- Dedicated `/api/stocks` endpoints support listing, creation, editing, deletion,
  and ID-based batch additions (`POST /api/stocks/:id/batches`). Names never merge
  stock entries. Quantity and gross/net weights remain batch totals.
- Server validation rejects invalid inputs. Edit/batch/delete require a matching
  row revision, preventing a stale React editor from overwriting newer changes.
- Successful writes update the existing Invoice stock state through a narrow
  event bridge. The encrypted JSON schema and legacy storage API are unchanged.
- Tests cover repeated additions, total weights, duplicate names, revisions,
  validation, deletion, legacy storage compatibility, and browser script parsing.
  All 12 tests pass under Fastify and the legacy router. Browser checks cover
  Stocks rendering, dropdown keyboard dismissal, and required-field dialogs;
  mutation tests use temporary stores, not business data.

## Phase 3: Purchase and Payment

- Both menus now use React in preview mode, including themed selectors, live
  amount/fine-weight calculation, inline editing, confirmation dialogs, and
  pagination (10 rows by default). Original menus remain available in legacy mode.
- `GET/POST /api/purchases` and `/api/payments`, plus `PUT/DELETE` on `/:id`,
  use a shared transaction service. Payment types remain Amount, Self Expense,
  and Metal to Metal; metal payments deduct gross weight, not fine weight.
- Each change validates and updates the record and linked old-metal ledger in a
  single encrypted atomic store write. Edits preserve IDs and original dates.
  Revision checks reject stale changes, including changes to the linked entry.
- Purchase reductions/deletions that would create or worsen a negative old-metal
  balance are rejected: adjust the consuming metal payments first.
- Cash summaries, dashboard calculations, exports, and the JSON schema are
  unchanged. Dashboard reloads from the same store when its tab is opened.
- All 17 tests pass on both backends. Browser checks in a temporary data directory
  verified purchase calculation/save, metal-payment creation/editing, and updated
  dashboard balances. No production transactions were created for testing.

## Phase 4: Settings

- Settings now uses React in preview mode; original Settings remains in legacy mode.
- Existing backup, restore, Excel export, and desktop IPC endpoints are unchanged.
  Buttons respect browser/desktop capabilities, lock during requests, and surface
  errors in application dialogs. Desktop requests report dialog launch, not completion.
- Browser restore requires confirmation after file selection, checks the 50 MB
  limit and JSON syntax, and reloads only after the success dialog is dismissed.
  Server-side key validation and pre-restore safety backups remain authoritative.
- All 18 tests pass against both backends, including temporary-store restoration,
  mismatched keys, download contracts, and desktop-only capability checks.
  Main-preview Settings rendering and browser backup download were checked manually.
  Native Electron file dialogs still require installer-level acceptance testing.

## Phase 5a: Records backend foundation

- Records UI is still the existing implementation. This stage prepares its
  React migration without replacing invoice editing, preview/PDF, or void dialogs.
- `GET /api/records` normalizes legacy paid/due fields without writing on read;
  supports `q`, `status`, `from`, and `to`. Voided invoices retain zero due.
- Filtering functions are shared by the API, current Records table, and PDF
  export via `lib/record-filters.js`. The browser retains local pagination.
- `POST /api/records/:number/settlements` validates the current record revision
  and commits invoice/payment history plus any metal receipt in one store write.
  Positive weight and rate are validated independently. Fully-paid confirmation
  records cash without inheriting metal fields from the selected dropdown.
- Current UI uses these endpoints; stale submissions refresh Records and are
  rejected. Actions resolve invoice identity by number rather than stale indexes.
- 23 tests pass on both backends; a temporary browser fixture verified a ₹200
  settlement reduced ₹1,000 due to ₹800 and kept the user on Records.
- Next: React Records table/filter/detail components; retain existing invoice
  preview/editor bridges until Invoice migrates. This is not full Records UI migration.

## Phase 5b: React Records table and details

- React preview owns the Records table, search/status/date filters, pagination,
  expanded exchange/payment details, and settlement forms. It uses the Records
  API and retains filters after settlement; the updated row is collapsed.
- Cash, gold and silver settlement values remain server-validated. Fully-paid
  and permanent-delete actions use application confirmation dialogs. Voided and
  zero-due invoices do not expose settlement controls.
- Invoice preview/print/PDF, editing/delivery, and void/cancel still use their
  existing implementations through an explicit, revision-checked bridge that
  resolves invoice numbers to current indexes. These actions are not yet React.
- The original and React Records pages share `records/pdf-export.js`, so exports
  include all matching records, not only the currently visible page.
- Browser testing on temporary data covered 13 records with 10-row pagination,
  search, voided preview/watermark, metal settlement, refreshed history,
  fully-paid confirmation, and filtered PDF download.

## Run and compare

Use Node 20.19+ within the Node 20 line, or Node 22.12+ (Electron supplies its own
Node runtime to installed desktop apps).

```sh
npm ci
npm run build:frontend
npm run dev
```

- Original UI: `http://localhost:3000/` or `/?frontend=legacy`
- React Dashboard, Stocks, Purchase, Payment, Settings, and Records preview: `http://localhost:3000/?frontend=react`

For React development, run `npm run dev:frontend` in a second terminal. This
watches and rebuilds the frontend bundle; the existing backend reload mechanism
reloads the browser when generated assets change under nodemon. `npm start`
requires a manual browser refresh after frontend rebuilds.

`npm test` builds/type-checks the frontend and runs the regression suite against
Fastify. To compare the legacy backend on macOS/Linux:

```sh
BACKEND_MODE=legacy node --test test/*.test.js
```

In Windows PowerShell, set `$env:BACKEND_MODE = 'legacy'` before running the same
test command; remove it afterward with `Remove-Item Env:BACKEND_MODE`.

The current suite covers encrypted persistence, request limits, exports, stock
reversal, failed-delete atomicity, backup restore, rates caching, accounting,
date filters, frontend assets, and Electron IPC. Browser verification compares
all-time and date-filtered Dashboard text/values with the original page and
checks navigation back to the existing Invoice page.

## Return to the stable code

Stop the running development server. Commit or stash any later edits before
switching branches; do not discard uncommitted changes.

```sh
git switch main
npm ci
npm start
```

If `main` advances in the future, create a recovery branch at the tag instead:

```sh
git switch -c recovery/pre-framework pre-framework-migration-2026-10-25
npm ci
npm start
```

Switching code does not roll back invoices or other business data. If a data
restore is actually needed, stop the app and preserve its current data folder
before restoring the matching encrypted store/key pair.

## Packaging

Existing `npm run package:windows`, `package:desktop`, and `package:all` commands
now build the frontend first. `public/**/*` includes the generated frontend
assets, and Fastify is a production dependency. Installed apps still launch their
local backend automatically. Actual Windows/macOS installers have not been built
or tested as part of Phase 1; test both before distributing a release.

## Next phases

1. Stocks migration completed in Phase 2; continue cross-menu acceptance testing.
2. Purchase and Payment completed in Phase 3; continue cross-menu acceptance testing.
3. Settings completed in Phase 4; native desktop dialogs need installer acceptance testing.
4. Records table/details completed in Phase 5b; editor, void, and print bridges remain until Invoice migration.
5. Invoice: billing, exchange rows, stock deductions, print/PDF, and pending orders.
6. Remove compatibility code only after replacement behavior is verified.
7. Separate commercial hardening: customer credentials, signing, upgrade/data
   migrations, dependency review, and installer testing. Database changes are a
   separate project; encrypted JSON remains in use for now.

Dependency audit at this checkpoint: production dependencies report no known
vulnerabilities. The existing development/packaging dependency tree reports three
high-severity entries (`electron`, `extract-zip`, and `brace-expansion`). Update
and test those before distributing a commercial installer; this phase does not
change the pinned Electron version.
