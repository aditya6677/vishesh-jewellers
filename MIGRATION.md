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

## Run and compare

Use Node 20.19+ within the Node 20 line, or Node 22.12+ (Electron supplies its own
Node runtime to installed desktop apps).

```sh
npm ci
npm run build:frontend
npm run dev
```

- Original UI: `http://localhost:3000/` or `/?frontend=legacy`
- React Dashboard preview: `http://localhost:3000/?frontend=react`

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

1. Stocks: typed stock API, reusable accessible dropdown/table components, and
   React forms; verify total gross/net weights and quantity behavior.
2. Purchase and Payment: preserve linked old-metal ledger calculations and edits.
3. Settings: exports, backups, restoration, and desktop folder selection.
4. Records: filters, pagination, settlements, editing, voiding, and deletion.
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
