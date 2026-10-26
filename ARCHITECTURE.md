# Application structure

The framework migration branch adds Fastify as the default HTTP backend and an
opt-in React/TypeScript Dashboard, Stocks, Purchase, Payment, Settings, and Records built by Vite. See [MIGRATION.md](MIGRATION.md)
for the active phase and fallback instructions. `frontend/` contains independently
owned React components; the original menus below remain available during migration.

`server.js` starts the app and reports its address to Electron. It contains no UI,
business calculations, storage operations, or route implementations.

## Backend

| Location | Responsibility |
| --- | --- |
| `lib/config.js` | Environment configuration and paths |
| `lib/app.js` | Creates and injects services; registers routes |
| `lib/http/` | Routing, JSON request parsing, and responses |
| `lib/routes/` | Storage, invoices, reports, rates, settings, and pages |
| `lib/services/` | Backup lifecycle, invoice deletion, rates caching, stock operations, and atomic purchase/payment ledger updates |
| `lib/domain/constants.js` | Frozen runtime enums for statuses, storage keys, and IPC messages |
| `lib/ui/` | Page rendering and explicit feature manifest |
| `lib/json-store.js` | Encrypted JSON persistence |
| `lib/dashboard-summary.js` | Pure dashboard calculations shared with the browser |
| `lib/delete-invoice.js` | Pure invoice/stock/ledger reversal |
| `lib/excel-export.js` | Excel report generation |
| `lib/ibja-rates.js` | IBJA response parsing |
| `lib/stock-flow.js` | Compatibility transformations for the original stock/invoice page |

Route functions receive dependencies instead of constructing them or reading
global environment values. Services own state and operations; calculations remain
plain functions. Classes are used for services with dependencies or lifecycle
state, rather than introducing inheritance for every helper. Add a route module
and register it in `lib/app.js` to extend the API.

`createApplication()` does not start listening or migrate the store. Call
`await initialize()` and then `server.listen()` explicitly. Importing `server.js` also
does not start the server. Existing npm commands and Electron IPC remain supported.

## Browser menus

Menu HTML is in `source/views/`. Additional styling is in
`source/styles/application.css`. Browser behavior is grouped in
`source/scripts/dashboard`, `invoice`, `records`, `payments`, `purchases`,
`settings`, `core`, and `shared`.

These browser files are **ordered script fragments**, not isolated ES modules.
`lib/ui/manifest.js` lists their initialization order. `PageRenderer` combines
them into the original shared closure so existing handlers and calculations keep
their lexical bindings. This compatibility boundary deliberately avoids changing
the app's startup and event behavior during the server refactor. Do not load a
fragment independently or reorder entries without checking its dependencies.

The original invoice/stock shell, reusable dropdowns, and base styling remain in
`source/index.html`. Legacy return code is retained in `records/legacy-returns.js`
for compatibility; this refactor does not re-enable the return feature.

To add a menu, create its view and behavior files, add them to the manifest, and
wire its tab in `source/scripts/core/tabs.js`. Keep calculations in pure functions
and put reusable presentation behavior in `shared/`.

## Verification and development

Run `npm test`. Tests use temporary encrypted stores and available local ports;
they never read or modify business data. They cover page composition, browser
syntax, storage contracts, exports, deletion reversals, backup restore, rates
caching, dashboard accounting, and Electron server/IPC startup.

Run `npm run dev` to watch backend and browser source changes. Existing Electron
packaging globs include files under `lib/`, `source/`, and `public/`. Packaging
commands build the React bundle first. Fastify is installed as a runtime dependency.
