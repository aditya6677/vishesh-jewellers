# Desktop acceptance before release

## Current acceptance/default status

On 2026-10-28 the user reported their manual Windows/macOS installation tests
passed and approved React becoming the default. Normal `/` and `/index.html`
launches now use React; `?frontend=legacy` explicitly retains compatibility mode.
Earlier sections describe historical test builds. The new default/cleanup builds
still need a quick install/launch/output smoke check; they remain unsigned.

Use a separate test OS account or isolated test data location. Never restore a
test backup over business data. Keep a verified backup and the original app/key
location before any upgrade test. Do not disable antivirus or OS protections.

The automated suite and staged-backend smoke test do not prove native installation,
OS secure storage, physical printing, or upgrade behavior. Unsigned test builds are
not signed/notarized production releases. The packaged app still defaults to the
legacy frontend until the final frontend switch is approved and verified.

## Clean installation and persistence

- Install on each target Windows/macOS architecture. Confirm first launch, PIN
  screen, native folder/save/open dialogs and normal quit/reopen behavior.
- Add a test Gold Ring stock: 10 pieces, total gross 100 g, total net 90 g.
- Restart. Confirm stock and the next invoice number persist.
- Check the chosen data folder contains encrypted storage, outside the application
  installation directory. Do not publish its key or backup contents.

## Financial checkpoints

Weights below are totals for the invoice row, not per piece.

1. Sell 4 rings: gross 10 g, net 9 g, rate INR 100/g, making 0%, GST 3%.
2. Exchange 0.1 g gold at INR 1,000/g (INR 100 credit), manual discount INR 20,
   initial cash paid INR 300. Subtotal = INR 900, GST = INR 27, payable = INR 807,
   due = INR 507. Stock = 6 pieces, gross 90 g, net 81 g.
3. Settle INR 100 cash. Paid = INR 400; due = INR 407. Regenerated invoice and
   Records must agree and preserve both payment entries.
4. Edit the sale to 2 rings, gross 5 g, net 4.5 g. Keep rate, exchange, discount,
   initial cash and making unchanged. Subtotal = INR 450; GST = INR 13.50;
   rounded payable = INR 344. Paid = INR 400; plus/advance = INR 56.
   Stock = 8 pieces, gross 95 g, net 85.5 g.
5. Void with a reason. Original stock returns to 10 pieces / 100 g gross / 90 g
   net. Linked exchange receipts net to zero, active sales/cash/due exclude the
   voided invoice, and its original document/payment history remain viewable.
   Voiding is an accounting reversal, not execution of a physical cash refund.
6. Separately test a non-GST invoice and a pending order with an advance. Pending
   creation/cancellation must not deduct/restore stock; delivery deducts once.

## Backup, location and upgrade

- Cancel every native dialog and confirmation; verify no data/location changes.
- Save an encrypted backup. Change test data, restore the backup, restart, and
  compare all menus, counters, payments, metal balances and records.
- Confirm a pre-restore recovery copy exists. Reject a corrupt/wrong-key backup
  without losing the current data. Secure-key desktop backups are tied to the
  supported computer/account; do not assume cross-device recovery works.
- Move to a new test data folder and restart. Verify it is remembered. An existing
  folder encrypted with a different key must not become the active location.
- Install the next build over the test installation. Verify data location, PIN
  behavior, encrypted data, counter and backups survive. Do not select any option
  that removes application data while checking upgrade preservation.

## Offline and output

- Disconnect external internet while the desktop/local server remains running.
  Verify local fonts, manual rates, sale/settlement/edit, backup and reopen.
- Check invoice PDF, saved-invoice PDF and filtered Records PDF. Include a long
  row/multiple pages, due/advance, pending and voided records.
- Print on the intended physical printer; check logo, fonts, margins, totals,
  watermark and page breaks. Test print cancellation and popup permission failures.
- Confirm live rates disappear gracefully when unavailable; business operations
  must not require a successful market-rate request.

## Release gate

### Additional runtime verification — 2026-10-28

The entire 113-test suite passed under Electron 43.8.3's bundled Node runtime
in both default Fastify and BACKEND_MODE=legacy (113/113 per mode, no skips).
This includes financial lifecycle, validation, atomic persistence, encrypted
backup and mocked desktop-dialog tests. The mocks do not prove native keychain
or dialog behavior. macOS emitted codesign diagnostics in Node mode; both test
commands exited successfully. Business store SHA-256 remained unchanged:
adb69c74d6b736518317b1b56a9bddcd852840387b0e8b20a3bb51ef08493893.

No application UI was launched and no installer was executed by these checks.
Native installation, upgrade, printing and hardware-specific acceptance remain
pending. PIN remains 5512 and packaged frontend remains legacy.

Record OS/architecture, app version, installer hash and pass/fail evidence for each
target. Resolve failures before distribution. Application icon, signing,
notarization, dependency/security review and commercial authentication are separate
release requirements. Switch the default frontend only after the React build has
passed native acceptance on the target systems.

## Automated packaged acceptance — 2026-10-28

Dependency-update note: the source now pins Electron 43.8.3. Existing test
installers were built with 37.2.6 and must be rebuilt/retested before release.
Development/packaging now require Node >=22.12.0. The new Electron runtime passed
the isolated backend lifecycle runner against source; native acceptance below
does not transfer automatically from the earlier build.

The extended `scripts/check-packaged-runtime.js` passed against the universal
macOS package using its Electron executable in Node mode on the Intel host.
It starts a separate server with temporary encrypted data and checks the exact
sale/exchange, cash settlement, edit-to-advance, stock restoration after void and
record deletion checkpoints above. All 112 repository tests also passed.

This is backend acceptance only: it does not launch the desktop UI, exercise the
OS keychain/dialogs, install or upgrade the application, or print. No production
data was used. Those native checks above remain pending; React is not yet the
default packaged frontend.
