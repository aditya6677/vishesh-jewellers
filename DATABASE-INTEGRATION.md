# Database integration: controlled browser preview

## Status

The application now has an explicit `DATA_BACKEND=json|sqlite` switch. **JSON is
still the default.** Existing business JSON is not migrated at startup. SQLite
requires an already prepared database, existing key and imported store ID;
missing/wrong keys, missing files, unsupported schemas or reporting timezone
changes stop startup rather than creating an empty replacement store.

The SQLite path is connected to the real HTTP APIs and React screens, not the
old experiment harness. Desktop database mode is an explicit opt-in and requires
a successful native secure-storage check at startup; packaged Windows/macOS
acceptance is still pending. No release or installed application has been replaced
by this change.

## 1. Queries and reporting

- SQL pagination for Stocks, Records, Purchases and Payments; default 10 rows,
  supported sizes 10/25/50/100. React renders the returned page rather than
  downloading/slicing an entire collection. Summary cards use complete totals,
  not page totals. Numbered pages use indexed `LIMIT/OFFSET`; very deep offsets
  still have a traversal cost. Repository keyset APIs are also available.
- FTS5 trigram search for stock/invoice text and mobile-number substrings.
  Three-or-more-character searches use FTS; shorter searches use bounded-result
  SQL substring filtering and can scan matching store rows. Search is capped at
  256 characters. Date/status/due/advance filters use typed indexed invoice facts.
- The invoice picker searches remotely, returns at most 50 matches, and keeps
  selected stock in a bounded browser cache. It never replaces the complete
  inventory cache with an affected-row mutation result. Editors explicitly
  fetch selected stock missing from the first page.
- All-time and date-range dashboards use relational SQL report tables.
  Collections, opening/closing cash, metal receipts, pending advances, expenses,
  purchases, returns and legacy weight modes preserve the current calculations.
- Ordered `vj_sum` aggregates preserve the existing JavaScript summation order;
  transaction and reversal guards no longer deserialize the full metal ledger.
  Global void audit numbering is retained using indexed ordinal counts.
- Reports run in a separate read-only worker connection so a large report does
  not block the request thread. At most four reports queue; jobs have a 60-second
  deadline. A failed worker fails reporting explicitly; it never returns a stale
  or guessed financial result. A bounded revision-keyed report cache is used;
  all document mutations invalidate it transactionally.
- Records CSV streams from a separate read-only transaction with backpressure,
  includes nested line/exchange/payment detail and protects spreadsheet formula
  cells. Dashboard CSV exports the applied range. These exports are **plaintext**
  customer/business reports, not encrypted backups.
- PDF export collects all matching pages, verifies a stable revision and caps
  at 2,000 invoices. Existing all-data XLSX is retained with a 10,000-row/25 MB
  source-data safety cap in SQLite preview; use streaming CSV for large invoice
  reports. Unlimited streaming XLSX is not implemented.

## 2. Business schema v1

`lib/database/database.js` configures SQLite3MultipleCiphers 13.0.3 in
SQLCipher-compatible mode, WAL, foreign keys, full synchronous durability and
memory-only temporary storage. This is **not upstream Zetetic SQLCipher**.
The native package has supplied N-API binaries; packaging uses those rather than
attempting a cross-platform source rebuild.

| Tables | Responsibility |
| --- | --- |
| schema_manifest | Application/schema signature, version and reporting timezone |
| stores, store_properties, store_revisions | Store isolation, settings/counter, import provenance and optimistic concurrency |
| documents | Lossless canonical business records, unique store-scoped identities and stable ordering |
| invoice_facts | Indexed invoice status/date/mobile/due/advance and report values |
| invoice_lines | Typed line identities, stock IDs, quantity, weights, rates, purity, making and sale contributions |
| invoice_payments, invoice_exchanges | Ordered typed settlement/exchange histories with original representations |
| invoice_cashflows | Dated cash receipts/legacy adjustments for period reports |
| stock_facts | Gold/silver quantities and gross/net/available weights |
| transaction_facts | Purchases, cash/self-expenses and purity-based metal payments |
| metal_movements | Signed metal receipts/outgoings, source links and ordered balance guards |
| document_search and its FTS shadow tables | Indexed substring searches |

This is a deliberate **hybrid relational/document schema**, not a single JSON
blob and not a claim that every legacy field has been converted to an integer.
Canonical records retain original monetary formatting, numeric precision,
invoice markup and legacy fields for exact round trips. Query-critical data and
child histories are materialized into typed relational tables by transactional
triggers. Their REAL values mirror the already verified JavaScript arithmetic;
historical money/weight has not been silently rounded to paise/milligrams.
A future decimal-arithmetic change requires a separate audited business change.

Foreign keys, unique identities, collection/property checks and schema gates
protect normal operations. The schema is versioned; unknown versions are refused.
Future upgrades need explicit versioned migrations. Accounts/roles/licensing
are a later phase, not silently activated by this storage work.

## 3. Backend and React integration

`lib/app.js` remains the composition root. DatabaseRuntime injects row-level
repositories and query services into the existing API routes; existing domain
validators/calculation functions remain in use. The legacy HTTP adapter and
Fastify are both supported. SQLite requires the React frontend; legacy page
mode is rejected rather than exposing incomplete financial caches.

Arbitrary `/api/storage` financial writes are disabled in SQLite mode. Only
business/master settings use the storage adapter. Legacy invoice bootstrap
reads are explicitly partial (at most 100 records); the React pages and remote
picker use their dedicated paged APIs. Domain mutations return affected-row
scope or a refresh-required response, and React reloads the correct current page.

The invoice counter advances with the invoice save, not a standalone client
write. New Invoice re-reads the server counter to handle another session's sale.
Empty prepared stores initialize collections lazily on their first operation.
Invoice, stock and linked metal changes commit/roll back together.
Duplicate creation requests are idempotent. Stale record/stock/trade revisions
are rejected. Store IDs scope every repository/query/export.

## Preparing a separate preview

Run from the project directory with Node >=22.12.0 and dependencies installed:

```sh
npm run database:prepare -- \
  --source /absolute/path/store.json \
  --source-key-file /absolute/path/existing-json-key \
  --target /absolute/private/preview/store.db \
  --target-key-file /absolute/private/preview/database.key
```

This refuses existing targets, preserves every source record/setting, checks
financial reports and reopen persistence, and verifies the source hash is
unchanged. Legacy-preservation warnings are reported; this does not convert
legacy per-piece weights to line totals. A failure may leave an unactivated
target/key for diagnosis; do not activate a failed import.

Create a private environment file outside the repository:

```text
DATA_BACKEND=sqlite
DATABASE_FILE=/absolute/private/preview/store.db
DATABASE_KEY_FILE=/absolute/private/preview/database.key
STORE_ID=main
PORT=0
```

Start with `node --env-file=/absolute/path/preview.env server.js` and open the
printed loopback URL. Never expose this preview over the internet. The key file
is a development/preview mechanism, **not** a substitute for OS-protected desktop
key storage. Keep it private; losing it without a recovery envelope loses access
to that copy. PIN 5512 is not the database encryption key.

Remove the SQLite environment variables to return to the JSON backend. Preparing
a copy or running a preview never deletes or rewrites the original JSON store.

## Verification and remaining release gates

Commands: `npm test`, `BACKEND_MODE=legacy npm test`, `npm run test:database`,
and `npm run benchmark:database -- 10000`. Tests use disposable data and cover
financial parity, normalizations, filtering, HTTP responses, worker reports,
CSV, stale edits, transaction rollback, store isolation, schema/key rejection
and restart. Browser checks cover the actual React pagination and stock picker.

`test/database-crash.test.js` additionally kills an isolated writer process with
SIGKILL immediately before and after a real invoice transaction commits. Reopening
the encrypted database verifies integrity, foreign keys, stock quantity/weights,
invoice counter, exchange receipts and dashboard parity. Before commit the entire
sale is absent; after commit the entire sale survives. These are process-crash
checks, not a simulation of power loss or a substitute for packaged OS testing.

### Guarded database backup foundation

`lib/database/backup.js` creates encrypted, verified copies without closing the
runtime connection. It requires a complete WAL checkpoint, takes an immediate
write lock, then rejects any WAL data written in the checkpoint/lock interval.
Copying is synchronous and holds the write lock; large backups can pause the
request thread. Concurrent readers preventing checkpoint completion produce a
retryable failure instead of an incomplete copy. The native `db.backup()` API
was tested and rejected this cipher configuration as incompatible; it is not used.
Files are created exclusively with mode 0600, flushed and reopened with the key
for schema, integrity and foreign-key verification. Existing files are never
overwritten. Failed candidates remain unactivated for diagnosis.

`restoreDatabaseCopy` validates a closed, immutable backup and creates a separate
recovery candidate only; never pass an active database as its source. It does not
replace or activate the live database. Backups still require the original database
key unless created through the portable workflow below. Keep the key separately protected. The backup tests verify wrong
keys, damaged sources, busy readers, no-overwrite, exact business data and report
parity using disposable stores.

### Portable passphrase recovery foundation

`lib/database/portable-backup.js` creates a new private directory containing
`database.db`, `recovery.json` and `manifest.json`. The database remains encrypted;
the key is wrapped with AES-256-GCM using a passphrase-derived scrypt key (fixed
N=65536, r=8, p=1, random salt and nonce). The authenticated envelope binds the
key to the exact database SHA-256 digest. The manifest is written last so a
partially completed folder is rejected. No raw database key or passphrase is
saved in the bundle. Backups are finalized as standalone encrypted files rather
than depending on WAL/SHM sidecars. Keep all three bundle files together.

Recovery requires a separate passphrase of at least 12 characters, not PIN 5512.
Choose a long, unique phrase; minimum length does not guarantee strength. Losing
the phrase and original key means losing access. Keep an off-device backup and
store its phrase securely elsewhere. Anyone possessing the backup and phrase
can recover its database key; local encryption is not protection against a
compromised operating system.

`restorePortableBackup` verifies metadata limits, backup digest, envelope
authentication, database integrity and the recovered candidate's exact file
digest. Recovery only creates a new destination and returns the recovered key
in memory for later OS-secured provisioning; callers must zero that buffer after
use. It never activates a database, changes a running store or writes a plaintext
key file. Backup source directories must remain immutable during recovery.
Wrong phrases, tampered envelopes/databases, mismatched digests and existing
destinations are rejected. Tests erase the original key, recover only using the
phrase, and compare exact business records and dashboard values. This is a tested
backend workflow, not a desktop key-store approval.

### Settings and weekly copies (browser preview)

Settings now provides **Create Portable Backup** with passphrase confirmation,
and **Verify Recovery** for portable bundles saved by this local app. Verification
uses a temporary recovery candidate, zeroes the recovered key and removes only
that temporary candidate. It never replaces active business data. The API accepts
only generated backup identifiers, not user-supplied filesystem paths, limits
request size, rejects foreign origins/non-loopback Host values, and allows one
passphrase operation at a time. Passphrases are not retained for weekly jobs.

Weekly safety copies are attempted at startup and every 24 hours while running,
once per ISO week; existing weekly copies are verified rather than overwritten.
These are **same-key database copies**, not passphrase-portable backups. They
require the original installation key. The default SQLite backup folder is next
to the preview database under `backups/SQLite-<path fingerprint>`; `BACKUP_DIR`
can choose a different parent. The UI shows this folder. No automatic pruning is
performed. Keep manual portable bundles and their passphrase off the device.

No cloud uploads or database folder chooser have been enabled. The Settings
verification list is limited to the 50 most recently modified recognized copies.

### Import and confirmed restore

**Import Backup** accepts exactly `database.db`, `manifest.json` and
`recovery.json` selected together. The browser transport caps the database at
25 MB and bounds both metadata files; imported files are stored under fixed
server-generated names, authenticated and verified before appearing in the list.
This is a local upload to the app server, not a cloud upload. Large-folder native
imports remain outside this bounded browser workflow.

**Restore Backup** first authenticates the passphrase and creates a separate
candidate on the active database filesystem. It requires the configured store
to exist in the backup, re-encrypts that candidate with the **existing installation
key**, verifies it, and issues a 10-minute preparation token plus record counts.
The user must separately type `RESTORE`. A changed current-data revision, expired
token or active streaming export rejects activation. A second app process is
excluded by a process-ownership lock; unverifiable locks fail closed. Verified
dead-process locks are recoverable at startup. This is coordination among app
instances, not a security boundary against someone already holding the database key.

During activation, maintenance guards block API operations, the report worker is
stopped, a verified `before-restore-<id>.db` copy is saved, and the active database
is checkpointed and closed. An authenticated restore journal is flushed before
renaming the previous database and installing the candidate. Repositories/reporting
are rebound to the replacement before normal requests resume. The old database
and safety backup are retained. Reported switch failures reopen the previous
database. A pending journal on restart deterministically rolls back an interrupted
switch and retains the interrupted replacement for diagnosis. Corrupt/unauthenticated
journals stop startup rather than guessing. Directory fsync is used on macOS/Unix;
Windows filesystem durability still requires native acceptance/power-loss testing.
Tests cover both rename boundaries, injected activation failure, stale confirmation,
different backup keys, imports, safety copies and continued repository/report operation.

Restoration replaces **the whole database file**, not selected invoice rows.
Keep off-device copies and finish unsaved work before confirming. The original
JSON store is not involved. Clean-install setup/default activation is still part
of the final migration workflow; this restore UI runs inside a configured SQLite
application, not an unconfigured installation wizard.

### OS-protected desktop keys (opt-in)

The production `LocalKeyStore` accepts macOS/Windows only and uses Electron
`safeStorage` (Keychain-backed on macOS, DPAPI-backed on Windows). Encryption
unavailability, wrong-account decryption, malformed envelopes and unsupported
platforms fail closed; no plaintext/basic-text fallback or random replacement key
is generated for an existing database. A secure-storage round trip and existing
encrypted-database validation run before desktop SQL startup.

For a **prepared copy**, opt in using `DATA_BACKEND=sqlite`,
`VJ_ENABLE_SQLITE_DESKTOP=1`, and an absolute `DATABASE_FILE`. On first provisioning
only, supply its existing base64 key file via `DATABASE_KEY_FILE`. The launcher
validates that key and writes an exclusive OS-protected envelope under Electron
userData's `database-keys/<database-path-sha256>.bin`. On later starts the envelope
is used; the bootstrap key file is not required. No bootstrap key file is deleted
automatically. Securely archive it after recovery checks. Changing the database
path requires deliberate provisioning; it is not silently treated as a new store.

The database key is removed from the child process environment and delivered over
the private parent/child IPC channel. It is never exposed to the renderer. Buffer
copies are cleared when practical; JavaScript/OS process memory is not immune to
a compromised machine. Restore keeps the installation key stable, avoiding an
unsafe two-file database/key replacement. JSON desktop operation remains unchanged.

Run `npm run check:database-key` on each supported OS/account to test native key
protection plus encrypted-database reopen with disposable files. Contract tests
use an explicit mock and are not evidence of actual Keychain/DPAPI operation.
The attempted native check in this environment exited with Electron `SIGABRT`;
therefore macOS native verification is **not passed**, and Windows native
verification is also pending. The integrated opt-in code is not release approval.

An operational-schema run on this Intel Mac imported 10,000 synthetic invoices
in 7.185 s; deep-page p95 was 17.417 ms and date-range report p95 was 263.421 ms.
Sampled process RSS was 253.15 MiB during the import/benchmark, not idle app
memory. These are single-host synthetic results, **not million-record acceptance**.
The earlier million-row experiment used a simpler schema and is not evidence
that this complete application is million-record ready.

Still outside release approval: actual native Mac/Windows key-store acceptance,
clean-install recovery setup, large native-folder imports, final user-approved migration/
rollback, full-schema million-record/concurrency/crash acceptance, and packaged
desktop installation/upgrade verification. JSON backup endpoints remain blocked
in SQLite preview; its Settings controls use the database-specific workflow.
Encrypted data does not make a compromised local app/computer impossible to modify.
# Read-only migration verification

The local browser cutover uses ignored `data/database-active.json` with the explicit `npm run start:database` launcher. Normal `npm start` remains JSON; never enter business transactions through both backends. Installed desktop apps and packaging defaults are not changed by the browser cutover. After new database transactions the original JSON is a stale rollback snapshot, not a synchronized copy.

## First-time desktop setup (opt-in)

Settings → Encrypted Backups → Change Backup Folder accepts an existing absolute folder on the server/desktop computer. It checks write access and persists the preference beside the database, then uses a dedicated SQLite-identity subfolder for future portable/weekly copies. Existing backups and the active database are never moved or deleted. The selected folder's backup list replaces the previous folder's list; older portable bundles can be imported. Unavailable destinations fail rather than silently falling back. Keep the destination attached for scheduled backups. This is a path-entry dialog, not a browser folder-upload picker.

`npm run check:setup-recovery` runs a disposable native Electron scenario: new-store setup and initial backup, stock creation, invoice with exchange/discount/GST, metal settlement, purchase and cash/metal/expense payments, updated portable backup, loss of the original protected key, wrong-passphrase rejection and recovery into a fresh installation. It compares exact canonical records, stock deductions and three dashboard ranges against both pre-restore SQL results and original JSON calculation logic. It never opens business data. The same scenario runs under Node tests with an OS-storage contract double; that does not replace native verification or clicking through the setup window. Native execution from the agent environment currently exits SIGABRT; run this command from a local terminal for native acceptance.

Launch Electron with `DATA_BACKEND=sqlite` and `VJ_ENABLE_SQLITE_DESKTOP=1`, without `DATABASE_FILE`, to show Create new store / Restore encrypted backup. Setup saves its database location under Electron userData and reuses that installation on subsequent launches. An explicit DATABASE_FILE retains the prepared-copy workflow. Default JSON launches and browser previews are unchanged.

Restore selects a portable backup folder containing database.db, manifest.json and recovery.json, and requires its recovery passphrase. Setup uses a new directory, validates the database, protects the key through OS storage, then saves installation settings; it never replaces existing business files. Failed attempts may leave isolated incomplete directories for diagnosis but are not activated. Exactly one store per backup is supported by this setup screen. New stores require a separate recovery passphrase of at least 12 characters, matching confirmation, recovery acknowledgement and a chosen backup destination. Setup creates the initial portable encrypted backup before saving installation settings. The passphrase is not saved in installation metadata. The initial backup contains the empty store, not future transactions: make regular backups in Settings and copy them off the computer. Native setup-window acceptance and Windows verification remain pending.

After copy-only preparation, run `npm run database:verify -- --source /absolute/store.json --source-key-file /absolute/source.key --target /absolute/copy.db --target-key-file /absolute/copy.key`. Use `--store` if the store is not `main`.

This checks source provenance, complete records/settings, database integrity and foreign keys, and SQL financial totals against the original JSON calculations. It does not activate storage or repair mismatches. Stop both apps for final migration verification; the result is point-in-time evidence, not a guarantee against later changes. A database already used for new transactions is expected to differ from its original import. Desktop OS-key checks and installation acceptance remain separate requirements. This full reconciliation loads the snapshot into memory and is not a million-record benchmark.
