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

## Phase 6a: Invoice payment summary

- The Invoice page now mounts a React-owned discount, amount-paid, and due/plus
  summary in `?frontend=react`. The old dynamic summary is suppressed only in
  React preview mode; the original Invoice remains unchanged in legacy mode.
- Discount continues to combine with the existing gold/silver exchange credit,
  and the legacy invoice calculation, records, print preview, and save handlers
  consume the same field IDs. The printed invoice due/plus line updates live.
- Currency calculations are extracted to a shared tested module. Each line uses
  its entered total net weight × rate × making; PCS affects stock deduction only.
  The original calculation order and precision are preserved: line amounts and
  each GST component retain their full JavaScript precision, exchange/discount
  is subtracted afterward, and only the final amount is rounded to rupees.
  Regression tests compare results directly with the pre-migration formula.
- New Invoice resets the migrated inputs and exchange rows. Core invoice fields,
  stock selection/deduction, exchange-row editor, and order/sale save flows remain
  legacy and are still pending migration.
- Frontend typecheck/build and all automated tests passed, including new
  invoice arithmetic cases for PCS, making, GST, credits, non-GST, currency
  precision, and zero-flooring. Browser checks confirmed paid/due and printed
  preview values; draft-only checks did not save or alter production records.

## Phase 6b: Invoice exchange rows

- React preview now owns the Gold/Silver exchange rows, live row values, and
  combined exchange credit. The original exchange editor remains unchanged in
  legacy mode.
- The existing invoice/save/print flow still receives the credit through the
  same `exchange-disc` field, and reads the row details through a narrow bridge.
  Exchange credit remains weight × rate per row; PCS is not involved.
- New Invoice resets exchange rows to one empty row and clears the exchange
  credit. Invoice saving, stock deduction, old-metal ledger writes, and preview
  formatting remain on the existing implementation in this migration slice.
- Automated tests compare the shared exchange arithmetic with the original
  formula, validate negative/invalid inputs, and verify that React and legacy
  page composition stay isolated. The full suite passes; no business records
  were created or modified during verification.

## Phase 6c: Atomic invoice and pending-order creation

- React preview saves ready sales and pending orders through `POST /api/invoices`.
  The backend validates customer/date, item quantities and total weights, rates,
  exchange rows, discount, paid amount, and the preview's final total.
- One encrypted store write commits the invoice, stock deduction, all exchanged
  metal receipts, and next invoice counter. Pending orders record requested
  items and advances without deducting stock. Multiple rows requesting the same
  stock item are checked together; each exchanged item receives a unique ledger ID.
- The calculation sequence remains compatible with the original formula:
  entered net weight × rate × making, GST on the subtotal, then exchange/discount
  deductions, with only the final payable rounded to rupees. The existing
  exchange-field conversion to two decimals is retained, including fractional
  exchange values before display rounding.
- Save requests carry an ID and payload fingerprint. Retrying the same request
  returns the existing invoice without another write or stock deduction; a
  conflicting request or duplicate invoice number is rejected. The preview locks
  its form during a save and retains the draft if saving fails.
- Success uses the existing confirmation and saved-invoice preview, resets the
  form, and displays the next server-confirmed number without incrementing twice.
  Pending-order names remain editable; ready-sale names still come from stock.
- Tests cover completed/pending/non-GST invoices, customer advances, multiple
  exchanges, aggregate stock demand, retry protection, failed persistence,
  reversal compatibility, and preview error/reset behavior using temporary data.
  All 41 tests pass on both Fastify and the legacy backend; TypeScript checking
  and the production frontend build pass.
  Browser verification used a separate encrypted fixture: ₹8,547 sale, ₹1,000
  paid, ₹7,547 due; and a ₹4,400 non-GST pending order with ₹5,000 paid, leaving
  stock unchanged. Production invoices and stock were not used for test writes.
  Browser checks also confirmed fractional exchange/discount precision and
  clearing every payment/exchange field with New Invoice. The real preview was
  reopened on port 3000 without changing its encrypted store.
- This is the backend save migration. Invoice customer/business fields, item-row
  controls, preview/printing, record editing/delivery, and voiding still have
  legacy UI/compatibility code to migrate in later stages.

## Phase 6d: Invoice customer and business details

- React preview owns the visible Business details and Bill To panels, including
  customer/mobile/address, invoice date/number, and invoice type. Existing styles,
  placeholders, required name/date fields, and disabled automatic number remain.
- A typed bridge updates the existing backing controls, which are hidden in
  preview mode. This keeps the current print preview, atomic save API, business
  settings persistence, and pending-order behavior on their established contracts.
  Legacy mode retains its original visible forms.
- Initial loading and invoice resets synchronize the React state after saved
  business details and the invoice counter are loaded. Business settings update
  the preview on input and persist on blur after editing. Customer details clear
  on reset while business settings remain.
- Date inputs explicitly synchronize input and blur events, preserving the
  selected date in both the live preview and saved invoice. Invoice-type changes
  retain customer/date values and use the existing pending/ready-sale handler.
- All 45 tests pass on Fastify and the legacy backend; frontend checking/build
  pass. Temporary-browser checks verified business setting persistence across
  reload, live customer/address/date updates, invoice-type switching, successful
  save with the correct selected date, and both post-save and New Invoice resets.
  Test transactions used a separate encrypted store.

## Phase 6e: Invoice item rows

- React preview owns invoice item rows, searchable stock selection, purity,
  quantity, entered weights/rate/making, row values, and add/remove controls.
  The original row renderer and stock-picker DOM handlers are excluded only
  from React preview; legacy mode remains available.
- A typed item bridge operates on the existing invoice rows so live totals,
  printed markup, and the atomic invoice API retain the tested calculation
  sequence. Quantity affects stock allocation/deduction; prices use each row's
  entered total net weight, without multiplying by quantity.
- Selecting stock copies its name/purity and leaves gross/net weights empty.
  Purity is disabled for linked stock. Suggested rates use the existing IBJA
  conversion and remain editable; late responses cannot overwrite manual rates
  or a removed row. Offline rate entry remains available.
- Available quantity accounts for other rows in the draft. The item editor locks
  while saving, keeps input focus during typing, supports manual pending-order
  names/purity, and resets to one empty row after saving or removing every row.
- All 52 tests pass on both backends with frontend checking/build passing.
  Temporary-browser checks covered search, rate suggestions, blank weights,
  disabled purity, multi-digit typing without focus loss, add/remove, quantity
  limits, newly added stock after navigation, and completed/pending saves.
  A two-row sale of 6 pieces deducted 15 g gross and 13 g net once, with subtotal
  ₹14,300, GST ₹429, total ₹14,729, and due ₹13,729 after ₹1,000 paid. A pending
  order saved without another stock deduction. Test writes used a separate store.

## Phase 6f: Live invoice paper, tax/terms and output controls

- React preview owns the live invoice paper, tax treatment selector, terms editor,
  and main Print/PDF buttons. The original paper CSS, logo/watermark, field IDs,
  number formatting, Indian amount-in-words function, and calculation results
  remain the output contract. Legacy mode retains its previous implementation.
- A read-only preview snapshot supplies customer/business details, item amounts,
  GST, deductions, final rounding and paid/due/advance values. Legacy handlers no
  longer write into the React paper. Mini totals continue to expose the same
  values to the existing save bridge.
- Saving and output actions synchronously flush React before capturing invoice
  HTML. Tax/terms edits therefore reach both the live paper and saved markup.
  New Invoice restores the original 3% GST default and retains the entered terms,
  matching the original reset behavior.
- PDF export keeps the existing html2canvas scale/background, jsPDF A4 portrait
  dimensions, 20-point margins and invoice-number filename. It prevents duplicate
  export clicks and uses app dialogs for success/errors. Printing still uses the
  native print dialog after synchronizing the paper; printer/device acceptance
  remains part of the desktop installer checks.
- All 61 tests pass on both backends, with typecheck/build passing. Tests include
  React paper rendering, non-GST and advance labels, escaped customer text,
  snapshot parity, save-before-capture ordering and PDF/print settings.
- An isolated browser verified a ₹9,147 GST invoice with ₹8,147 due, a non-GST
  ₹8,850 invoice with a ₹1,150 advance, latest-term capture on save, compatibility
  with the existing regenerated-invoice view, and reset behavior. Its downloaded
  PDF was confirmed as one A4 page and visually reviewed. No test invoices were
  saved in the real business store.

## Run and compare

Use Node 20.19+ within the Node 20 line, or Node 22.12+ (Electron supplies its own
Node runtime to installed desktop apps).

```sh
npm ci
npm run build:frontend
npm run dev
```

- Original UI: `http://localhost:3000/` or `/?frontend=legacy`
- React Dashboard, Stocks, Purchase, Payment, Settings, Records, and the Invoice
  payment/exchange editors with the new invoice save API:
  `http://localhost:3000/?frontend=react`

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

## Phase 6g: Saved-invoice viewing

- React owns the saved-invoice modal and its print/PDF controls. Records viewing
  reads the current invoice from `GET /api/records/:number`, with a revision check
  against the displayed record. Missing or changed invoices show an app dialog.
- Historical invoice markup and original financial totals remain snapshots;
  viewing does not recalculate tax, prices, or mutate storage. Payment, due/plus,
  and settlement history are refreshed from the current saved record, using the
  same balance presentation as Records. Pending/voided watermarks remain intact.
- Saved HTML is restricted to invoice display elements/attributes; executable
  content and the retired stamp are removed before display and export. Older
  invoices without saved markup use a read-only summary fallback.
- Legacy-mode viewing is retained. Invoice editing, delivery and voiding still
  use their compatibility bridges; this phase does not change those workflows.
- Typecheck/build and all 63 tests pass on both backends. Browser fixture checks
  cover due/advance balances, metal settlements, pending/voided watermarks,
  missing markup, and removal of stale payment lines/seals/executable content.
  Print/PDF reuse the existing output paths; physical printing and Electron
  installer acceptance remain to be tested. Real encrypted data was unchanged,
  and the development preview was restarted with its unsaved draft restored.

## Phase 6h: Atomic invoice-edit/delivery persistence

- React-preview Records still opens the existing edit/delivery dialog, but saving
  now uses `PUT /api/invoices/:number` instead of three independent storage writes.
  This is the persistence migration; the dialog itself is not yet React-owned.
- The backend checks the original revision, validates the revised invoice, restores
  the original sale in a detached snapshot, checks aggregate stock demand, then
  commits stock, exchange receipts and the invoice in one encrypted write.
- Existing settlement history and its old-metal receipts remain intact. Only the
  initial invoice payment and exchange receipts are revised. Invoice number,
  counter, original save time and record ordering are retained. Pending delivery
  changes to completed only when the same validated transaction succeeds.
- The editor's original arithmetic order and unrounded exchange deduction are
  retained; invoice creation keeps its existing two-decimal deduction behavior.
  PCS affects inventory only. Server-side validation additionally rejects invalid
  net/gross relationships and stale stock details before any write.
- The compatibility save bridge prevents duplicate clicks and disables editing
  while saving. Legacy frontend mode remains unchanged.
- Typecheck/build pass. All 70 regression tests pass on Fastify and the legacy
  backend, covering stale/missing/voided edits, persistence failure, aggregate
  stock demand, historical per-piece weights, missing-stock restoration,
  settlements, advances, pending delivery, counter preservation and HTTP routing.
  An isolated browser fixture verified a full revision, regenerated invoice,
  payment history and remaining stock. Real encrypted business data was unchanged.

## Phase 6i: React invoice edit/delivery dialog

- React preview now mounts its own edit/delivery dialog. The legacy editor DOM
  and save listeners are no longer injected in React mode; original frontend
  mode retains them. The atomic revision-checked edit endpoint is unchanged.
- Customer/date/contact/terms, line-total item weights, quantities, rates, making,
  exchange rows, discount, GST and initial payment remain editable. Live totals
  and paid/due/advance presentation use the backend editor's exact calculation
  functions, injected read-only into the page rather than reimplemented.
- The searchable stock picker and themed Select can portal inside the native
  modal, preserving keyboard/modal interaction. Picker availability includes the
  original invoice allocation; backend inventory validation remains authoritative.
- Historical per-piece weights and initial-payment inference are preserved.
  Historical paper updates are detached, sanitized display operations, with no
  direct storage writes. Saving prevents duplicate submission and refreshes
  Records, Stocks and Dashboard on success. Validation errors use app dialogs.
- Browser testing identified a date-input event issue; date input now handles
  both input/change so other React renders do not reset the selected date.
- Typecheck/build and all 74 tests pass on both backends. Tests cover draft
  mapping, exact injected arithmetic, allocation availability and legacy isolation.
  Isolated browser verification covered required fields, dropdowns/search within
  the native modal, GST/non-GST totals, revised payment/settlement history,
  regenerated paper, pending delivery/date persistence and stock reconciliation.
  Real encrypted data remained unchanged; main preview restarted with draft kept.

## Phase 6j: React void/cancel and atomic reversal

- React owns the void/cancel confirmation and required reason field. React-mode
  pages no longer inject the legacy void modal or its multi-write handler.
- `POST /api/invoices/:number/void` checks the displayed revision and reason,
  rejects already-voided invoices, and commits invoice status, stock restoration
  and metal reversal receipts in one encrypted write. The original invoice,
  paid/payment history, record order and invoice counter remain for audit.
- Stock reversal reuses the verified deletion logic: line-total/per-piece history
  and prior returns are respected; missing stock/unsafe history blocks the save.
  Pending orders do not restore stock, including older orders without soldItems.
- Original metal movements remain in the ledger with linked opposite entries.
  Historical invoice-linked metal returns are reversed by their net effect too.
  The availability guard rejects reversal when invoice metal has already been
  used and removing it would create/worsen a negative old-metal balance.
- Voided records disappear from active sales/collections/due totals, retain
  reason and payment history, and open with the existing VOIDED watermark.
  This is an accounting reversal, not execution of a physical cash refund.
- All 80 tests pass on both backends, with typecheck/build passing. Tests include
  single-write persistence, duplicate/stale/missing/invalid requests, pending
  cancellation, historical returns, spent metal, disk failure, delete-after-void
  safety, audit preservation, dashboard calculations and legacy-mode isolation.
  Isolated browser checks verified required reason, both confirmations, success
  messages, voided actions/watermark, restored stock and Dashboard balances.
  Real encrypted business data remained unchanged.

## Phase 6k: React invoice-success notification

- React now owns the post-save success dialog. Completed invoices and pending
  orders retain their existing titles, explanatory copy, invoice number and
  View/Done actions. The original frontend keeps its legacy success modal.
- The save bridge sends only the committed invoice number/status to React;
  no calculations, persistence, counter, reset or inventory logic changed.
  View loads the saved record through the current saved-invoice viewer, rather
  than using the reset invoice form. Duplicate viewer clicks are guarded.
- Typecheck/build and all 82 tests pass on both backends. New tests cover
  notification wording/validation, identity-only delivery, read-only behavior
  and legacy-mode isolation. Isolated browser saves verified completed and
  pending dialogs, correct saved invoices/balances/watermark, Done dismissal,
  counter progression and no stock deduction for pending orders.
- Real encrypted business data remained unchanged; preview restarted with its
  unsaved invoice draft preserved.

## Phase 6l: React shared messages

- React now owns shared error/success/notice dialogs in preview mode. Existing
  `showAppMessage`, alert, toast classification and unhandled-rejection entry
  points notify React instead of constructing a separate legacy dialog.
- Startup notifications are buffered until React mounts. Latest-message behavior
  is retained, with a bounded queue, unchanged titles/icons and plain text output.
  OK and Escape dismiss the native modal. Legacy frontend behavior is unchanged.
- No financial calculation, storage operation, PIN or navigation behavior changed.
  Typecheck/build pass; all 85 tests pass on both backends. New tests cover message
  types, text safety, startup delivery, classification, queue limits, unhandled
  failures and legacy isolation. Isolated browser checks verified invoice
  validation errors, New Invoice success, button/Escape dismissal, and absence
  of the legacy message dialog. Real encrypted data remained unchanged.

## Phase 6m: React PIN screen

- React preview now owns the PIN screen, preserving its design, PIN `5512`,
  validation messages, input clearing/focus and the existing tab-session key.
  Reloading an unlocked tab remains unlocked; a separate tab requests its PIN.
  Original frontend mode retains the original PIN implementation.
- Critical head CSS and an early body bootstrap hide the workspace before React
  mounts. Blocked/unavailable session storage fails closed and reports a session
  storage error rather than unlocking without a persisted session.
- This remains the existing client-side UI lock, not server authentication or a
  change to data encryption. Commercial authentication hardening remains separate.
- Typecheck/build and all 88 tests pass on both backends. Tests cover exact PIN
  validation, session persistence/isolation, blocked storage, early workspace
  hiding and legacy isolation. Browser checks covered blank/wrong/correct PIN,
  reload persistence and a separate locked tab. Financial logic/data unchanged.

## Phase 6n: React navigation

- React owns all seven menu buttons and the active page, preserving order and
  Dashboard landing. Feature roots remain mounted; navigation changes visibility
  only, so invoice and other form drafts are not discarded.
- Menu entry refreshes Dashboard, Stocks, Records, Payment, Purchase and Settings
  through their existing APIs/events. Invoice entry refreshes the stock snapshot
  without resetting rows; a request generation guard ignores late older responses.
- Legacy tab creation/listeners are excluded from React mode. Existing imperative
  entry points delegate to a readiness-aware React navigation bridge. Original
  frontend mode remains unchanged. No accounting or persistence logic changed.
- Typecheck/build and all 92 tests pass on both backends. Added tests cover menu
  mapping/order, refresh routing/failures, draft preservation, stale stock reads
  and legacy isolation. Isolated browser checks covered every menu, Dashboard
  landing, retained customer/weights/rate, and newly added stock appearing in the
  invoice picker after navigation. Real encrypted data remained unchanged.

## Phase 6o: Records PDF export

- React Records exports a fresh, server-filtered snapshot through a dedicated
  report module, replacing the legacy PDF function/window bridge in React mode.
  Original frontend export remains available. All matching records are exported,
  independently of table page size, with the same filename/filter description,
  money/balance/status rules and exchange/settlement/historical-return details.
- PDF rows can continue across pages without clipping. Headers repeat, header
  fill/text colors are reset per cell, and body font/color are restored after
  each page break. An oversized first row no longer creates a blank first page.
- Browser testing caught date-input changes not reliably reaching React state;
  Records dates now handle input/change and are preserved in the exported filter.
  Empty/unavailable/failed exports use app dialogs; duplicate export clicks lock.
- Typecheck/build and all 95 tests pass on both backends. Added tests cover
  financial presentation, immutability, empty/invalid requests, multi-page long
  rows, readable styles and legacy isolation. A browser fixture exported all 14
  matching records while showing 10 per table page; PDF text confirmed the date
  range and excluded unrelated records. Both final rendered pages were visually
  inspected, including continuation headers and long-row boundaries.
- Business data and financial calculations remained unchanged. Remaining work is
  compatibility cleanup and end-to-end/desktop acceptance before default switch.

## Phase 7a: Conservative compatibility cleanup

- Removed the unused intermediate editor transformer and editor-save bridge;
  React's current editor/API path and the original legacy editor remain intact.
  Replaced the adapter-specific test with current-editor isolation checks.
- React mode no longer initializes the retired return feature. Its legacy source
  remains available to the original frontend. Removed the brittle partial-script
  split previously used to avoid old saved-invoice print handlers.
- Active invoice state/math/storage bridges remain until their consumers are
  separately verified; this pass does not claim all compatibility code is gone.
- Typecheck/build and all 96 tests pass on both backends. New cleanup checks
  verify retired files/initializers are absent in React mode and fallback editor
  code remains. Browser startup/PIN/all-menu smoke checks passed with exactly one
  visible page. No financial calculation or stored business data changed.

## Phase 7b: Remove unused action/navigation shims; lifecycle acceptance

- Audited direct React callers and removed the unused `vjRecordAction` dispatcher,
  legacy view/edit/void wrappers and imperative navigation readiness wrappers from
  React output. Original frontend implementations remain intact. The Records
  stock synchronization bridge and shared invoice math remain because they still
  have active consumers; removal is not being inferred from file age alone.
- Replaced obsolete dispatcher assertions with stock-sync and direct-React
  isolation checks. Added an encrypted on-disk lifecycle test spanning creation,
  metal settlement, full edit, void, store reopen and delete-after-void, checking
  exact cash/due/metal balances, weights, quantities and counter preservation.
- Typecheck/build and all 97 tests pass on both backends. Browser checks confirm
  direct saved viewing, editor opening, void confirmation/cancellation and Settings
  navigation after shim removal. Financial formulas and business data unchanged.
- This is the start of lifecycle acceptance, not installer acceptance. Broader
  backup/offline/output acceptance and Windows/macOS installation/upgrade checks
  still precede making React the default.

## Phase 7c: Encrypted backup/restore acceptance

- Added populated-store acceptance covering stock, invoices, transactions, metal
  ledger, business settings, counter and unknown/custom fields. Verified exact
  restored data and Dashboard results after reopening the encrypted store.
- Verified unsupported/tampered/wrong-key backups leave current encrypted bytes
  unchanged and remove restore temporary files. Simulated final-rename failure
  verifies rollback to the original store and retained recovery backup.
- A repeated-timestamp test exposed safety-copy overwrite/collision. Restore now
  chooses an unused timestamp suffix for both pre-restore copies, preserving
  separate recovery points and avoiding an existing-target collision on Windows.
- Typecheck/build and all 101 tests pass on both backends. These are real encrypted
  filesystem tests in disposable folders, not restore operations on user data.
  Business-data hash remained unchanged. Offline/output and actual installer
  acceptance remain outstanding; native Windows behavior is not claimed tested.

## Phase 7d: Offline PDF resources and output acceptance

- Found that PDF libraries still loaded from CDN on each fresh app launch. Both
  frontend modes now load local, explicitly routed browser distributions copied
  into public/vendor by the build, with upstream licenses. Packaging already
  includes public/**/*; only the two known JS routes are exposed.
- Dependency audit identified vulnerabilities in the former jsPDF 2.5.1 version.
  Pinned jsPDF 4.2.1 and html2canvas 1.4.1; production audit now reports zero known
  vulnerabilities. Existing development/packaging advisories remain separate.
- Typecheck/build and all 102 tests pass on both backends. Added copy-integrity,
  license, local-page references, package inclusion and HTTP asset-route checks.
- A disposable browser instance blocked external resources using CSP and disabled
  market rates. Records PDF and invoice PDF downloaded successfully, and a sale
  with a manual rate saved and deducted stock correctly. Both generated PDFs were
  rendered and visually inspected. No business data or financial formula changed.
- This verifies operation without external internet while the local app server
  runs; it is not a serverless PWA test or a physical-printer/installer test.
  Google Fonts remain external with offline fallback fonts; exact offline font
  parity, native dialogs and Windows/macOS installation/upgrade remain to check.

## Phase 7e: Local typography resources

- Bundled pinned Fontsource distributions for Cormorant Garamond, Jost and IBM
  Plex Mono, preserving the existing requested normal weights and 500 italic.
  Build copies 13 Latin WOFF2 faces and upstream licenses into public/vendor/fonts
  and generates local font CSS. Packaging includes the generated public resources.
- Both frontend modes and legacy print markup now reference /vendor/fonts.css,
  with no Google Fonts/preconnect references. React saved printing already copies
  the current stylesheet links. Only explicitly listed font files are served.
- Typecheck/build and all 104 tests pass on both backends. Added font-copy
  integrity, family/weight/style coverage, licenses, local CSS and HTTP content
  type/byte checks. Production audit reports zero known vulnerabilities.
- An external-resource-blocked browser fixture verified local font CSS, font-face
  declarations and readiness checks for all three families in the invoice UI.
  No financial calculation or business data changed. Native dialogs, physical
  printer behavior and actual installers remain separate acceptance items.

## Phase 7f: Desktop-dialog logic and restore failure protection

- Added temporary-filesystem acceptance with mocked Electron dialogs/safeStorage
  covering cancellation, manual backup, restore confirmation, successful restore,
  safety copy/restart requests, foreign-key folders and staged/final rename errors.
  No real OS dialogs, secure-storage/keychain operations or user folders are used.
- Found desktop restore could replace the key before a failed store replacement.
  New paired-file helper stages both files and restores both previous byte streams
  on a reported replacement failure; incomplete rollback is reported explicitly.
  Pre-restore recovery copies use UUID suffixes to prevent naming collisions.
- Choosing an existing data folder now authenticates/reads its store with the
  current app key before changing active configuration. An incompatible key leaves
  the data-location setting unchanged.
- This is failure rollback, not a crash-atomic two-file transaction. Power-loss
  recovery still depends on the retained pre-restore backup. Actual installed-app
  dialogs/keychain, native file locks, upgrade behavior and printing remain to test.
- Typecheck/build and all 110 tests pass on both backends. Real business-data hash
  remains unchanged. Browser server/draft need no restart for Electron-only changes;
  desktop fixes take effect on next desktop launch or rebuilt installer.

## Phase 7g: Unsigned macOS packaging and packaged-backend acceptance

- Built an unsigned macOS x64 `.app` in a temporary output folder. Initial staged
  runtime failed module resolution: server/lib were unpacked while Fastify was
  inside app.asar. Packaging now unpacks production node_modules alongside the
  child server so ordinary Node resolution works without development dependencies.
- Rebuilt successfully with signing explicitly disabled. Ran the actual packaged
  server from the staged runtime with isolated encrypted data, backups, empty
  NODE_PATH and a fresh port. Verified React entry, local scripts/fonts/logo,
  invoice creation, stock/paid/due values, Records and encrypted persistence.
- Archive inspection found no business-data/backup folders, .env files or app
  encryption-key files. Main browser preview and real business data were untouched.
- Added a reusable check: `npm run check:packaged -- /absolute/path/to/app.asar.unpacked`.
  It creates/removes a disposable data folder and never uses installed user data.
  Typecheck/build and all 111 regression tests pass on both backends.
- This is a staged unsigned Intel/x64 app/backend check, not an installed native
  UI/keychain, DMG, Apple Silicon/universal or Windows acceptance test. Signing,
  notarization, application icon (builder still reports the default icon), real
  upgrades/data locations, physical printing and default-frontend switch remain.

## Phase 7h: Unsigned Windows x64 NSIS build

- Built a Windows x64 runtime and NSIS installer on macOS, with code signing and
  executable metadata/icon editing explicitly disabled for this test build.
  Initial download failed on a cache permission boundary; retry used the explicit
  electronDownload.cache option in a temporary writable folder, with no security
  protections disabled. Build completed successfully with an EXE and block map.
- The staged Windows package's JavaScript backend passed the same isolated
  packaged-runtime smoke test under the Mac's Node runtime. Archive scan found no
  business data/backup/.env/key files. This is not Windows execution acceptance.
- Added DESKTOP-ACCEPTANCE.md with exact financial/stock checkpoints, native dialog,
  backup/location/upgrade/offline/printing checks and release gates. Its numeric
  sale/edit checkpoints were checked against the existing calculator.
- All 111 tests pass on both backends; build/typecheck passes. Main browser preview
  and business data remain untouched. Installer is unsigned, uses the default icon
  and still defaults to legacy UI pending the approved default-frontend switch.
- Actual Windows installation, secure storage, antivirus/SmartScreen behavior,
  upgrade/data retention and physical printing remain unverified, as do the native
  macOS UI/keychain and universal/Apple Silicon installer targets.

## Phase 7i: Unsigned macOS universal build

- Merged Intel and Apple Silicon runtimes; the main executable reports x86_64
  and arm64. Identical application archives are reused with mergeASARs disabled
  to avoid an oversized unpack-pattern failure in the ASAR merger.
- Added a post-pack layout gate and a universal packaging command. The gate
  rejects missing unpacked server/assets or misplaced backend dependencies.
- The packaged Electron runtime passed isolated backend checks for module
  resolution, React/assets/fonts, sale calculations, stock, records and encrypted
  persistence. Archive scan found no business data, backups, environment or key
  files. All 112 tests pass on both backend modes; business data is unchanged.
- DMG creation failed with hdiutil 'Device not configured' in this environment.
  A ZIP of the unsigned universal application is provided as a test artifact.
  Native UI/keychain, Apple Silicon hardware, installation, upgrades and printing
  are not verified. Signing, notarization and a custom icon remain outstanding;
  desktop still defaults to the legacy frontend.

## Phase 7j: Extended packaged financial lifecycle acceptance

- Expanded the packaged HTTP smoke test to follow the documented sale with
  exchange and discount, cash settlement, edit producing an advance, void with
  stock restoration and record deletion. Asserts quantity and total gross/net
  weights independently; quantity never multiplies the row's price.
- Passed against the universal macOS build under its actual Electron Node runtime
  with isolated temporary encrypted data. All 112 repository tests passed again.
  Real business storage hash is unchanged. No runtime/UI changes were necessary.
- Native installation, UI, secure storage, dialogs, upgrades and physical output
  still require target-machine acceptance; the default frontend remains legacy.

## Phase 7k: Dependency security update — 2026-10-28

- Updated exact Electron pin from 37.2.6 to 43.8.3 and refreshed its dependency
  tree, replacing the vulnerable extract-zip package with Electron's maintained
  extractor. Updated the affected brace-expansion 5.x dependency to 5.0.12
  without forcing cross-major overrides. npm audit now reports zero known
  vulnerabilities across the installed dependency tree (previously nine affected
  entries). This is not a guarantee against unknown vulnerabilities.
- Development and packaging require Node >=22.12.0 to satisfy the new Electron
  installer. End users still run the bundled desktop runtime, not system Node.
- Frontend build/typecheck passed; all 112 tests passed under Fastify and legacy.
  Electron 43.8.3 / Node 24.22.0 passed the isolated HTTP financial lifecycle
  runner against the source runtime. macOS emitted a codesign diagnostic, but
  the check exited successfully. This was not a fresh packaged/native UI test.
- PIN, default frontend and business data remain unchanged. Previously created
  test installers still contain Electron 37.2.6: rebuild and repeat native
  acceptance before distribution. No new installers are produced in this step.

## Phase 7l: Native application icons

- Generated Windows ICO and macOS ICNS from the existing transparent business
  logo and configured electron-builder platform icon paths. The existing window
  icon already uses that logo and is unchanged. No new image design or npm
  dependency was introduced. Assets are regenerated with npm run build:icons
  on macOS; Windows packaging consumes the generated ICO directly.
- Added container/frame tests; macOS iconutil successfully decoded the ICNS.
  Frontend build/typecheck and all 113 tests passed on both backends. Business
  storage hash is unchanged. No frontend or financial behavior was modified.
- Existing installers remain unchanged. Rebuilt installer icon embedding and
  taskbar/Dock/shortcut display still require desktop acceptance. Signing and
  notarization remain separate release gates.

## Phase 7m: Refreshed unsigned Windows installer

- Rebuilt x64 NSIS using Electron 43.8.3 and configured business icons. The first
  attempt used an invalid custom signing-hook option; corrected to the builder's
  win.signExecutable=false, preserving icon/resource editing without signing.
  The corrected build completed, including installer and block map.
- Verified x64 PE architecture and all six logo PNG frames in the application
  executable. Archive private-data scan passed. Extended packaged backend
  financial lifecycle checks passed under macOS Node with isolated data; all 113
  tests passed. Frontend build/typecheck passed and business data is unchanged.
- Installer SHA-256:
  e6b4922a2b13199dfb18c4b2c9ae805e3eb97d7fca47061887c327207f5da0bc.
  Artifact is in the sibling windows-updated-test-build.6kVA0Q directory.
- No Windows execution/installation acceptance occurred. Default frontend remains
  legacy. Native checks, signing and macOS installer refresh remain outstanding.

## Phase 7n: Refreshed macOS universal application

- Built universal macOS app using Electron 43.8.3 and business icon. Intel and
  Apple Silicon architectures are verified in both the main executable and
  Electron framework. The configured ICNS and bundle icon reference match.
- Extended isolated financial lifecycle checks passed under the packaged Electron
  Node runtime on the Intel host. Private-data archive scan passed. Frontend
  build/typecheck and all 113 tests passed; business data hash is unchanged.
  macOS emitted a codesign diagnostic in Node mode, but checks exited successfully.
- ZIP test artifact is in sibling macos-updated-test-build.nL0h3U. Did not retry
  known environment-blocked DMG creation. Signing is explicitly disabled for this
  test; notarization and native UI/keychain/Apple Silicon/upgrade/printer acceptance
  remain outstanding. Default frontend and PIN are unchanged.

## Phase 7o: React default and focused cleanup

- After user-reported manual acceptance and explicit approval, normal browser,
  PWA and desktop root/index routes now use React. Explicit frontend=legacy
  remains available. Renderer internals still accept either mode for fallback
  coverage. README updated for the default and Node requirement.
- Removed the 200-line retired returns module. Regression coverage found two
  active legacy output handlers mixed into it; retained those 17 lines in a
  dedicated records/invoice-output module. Net 183 obsolete lines removed, with
  no financial formula or historical data changes. Compatibility code still
  needed by the retained legacy mode was intentionally preserved.
- Both backend suites pass 113 tests. New packaged checks cover root React,
  explicit legacy, print bindings and absence of retired return initialization.
  Rebuilt unsigned Windows x64 NSIS and macOS universal ZIP in sibling
  react-default-desktop-builds.9n1Y7a. Packaged runtime checks, current-source
  comparisons, retired-module exclusion and private-data scans pass on both.
  macOS architectures verified; packaged Electron backend checks pass on Intel.
- Early packaging was cancelled after a snapshot timing issue omitted the new
  module; only the rebuilt and successfully verified final packages are provided.
  Live preview was not restarted, preserving its current draft. Business storage
  hash is unchanged. Native smoke-check the new builds before release; unsigned
  status/signing and notarization limitations remain.

## Next phases

1. Stocks migration completed in Phase 2; continue cross-menu acceptance testing.
2. Purchase and Payment completed in Phase 3; continue cross-menu acceptance testing.
3. Settings completed in Phase 4; native desktop dialogs need installer acceptance testing.
4. Records table/details, edit/delivery, saved viewing, voiding and row-wise PDF
   export are migrated; continue cross-menu acceptance testing.
5. The live invoice form, preview/output controls and atomic sale/order creation
   and saved-invoice viewing are migrated. Edit/delivery UI and persistence are
   migrated, as is void/cancel. PIN, navigation, invoice success and shared messages
   are done, as is Records PDF export. Next clean up unused compatibility code.
6. Remove compatibility code only after replacement behavior is verified.
7. Separate commercial hardening: customer credentials, signing, upgrade/data
   migrations, dependency review, and installer testing. Database changes are a
   separate project; encrypted JSON remains in use for now.

Historical dependency audit before Phase 7k: production dependencies reported no known
vulnerabilities. The existing development/packaging dependency tree reports three
high-severity entries (`electron`, `extract-zip`, and `brace-expansion`). Update
and test those before distributing a commercial installer; this phase does not
change the pinned Electron version.
