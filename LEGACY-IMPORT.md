# Import older encrypted JSON data

In the SQLite app, open Settings → Import from Older App with `settings.restore` permission (Owner or Superadmin by default).

## Original computer

Use the updated desktop app under the original operating-system account. Choose **Select Older Data…** and select the older encrypted `store.json` or JSON backup. The app tries the backup's protected key or the existing `data-key.bin`. If necessary, select the original `data-key.bin` or development `.data-encryption-key` using the native file picker. No key is generated or sent to the renderer. Original files are never written.

## Another computer

On the original computer, use **Create Portable Legacy File…**, choose and confirm a recovery passphrase (at least 12 characters), then select the old data and save a new encrypted file. This operation is available even if the current store is not empty. Keep the passphrase separately; it is not recoverable by the app.

On the destination computer, choose **Open Portable Legacy File…** and enter that passphrase. A legacy OS-bound JSON backup alone is not a cross-computer portable backup.

## Preview and import

The destination must be a new, empty SQLite store: no business records, existing catalog, previous issued invoice counter, or previous import receipt. This feature does not merge stores or automatically switch the original JSON installation to SQLite. Keep that installation and its data until migration is verified.

Review counts, stock weights, invoice sales, cash collected, due/advance balance, warnings and the next invoice number. Acknowledge preservation of historical records and type `IMPORT`. Preview tokens expire in 10 minutes.

The app creates a uniquely named encrypted safety database backup, rechecks destination emptiness, imports business collections and allowlisted store details atomically, and verifies exact records plus all-time/date-range SQL financial summaries. Invoice counter is advanced if necessary to prevent reusing existing VJ invoice numbers. It does not rededuct stock, recalculate historical invoices, reclassify Gold as Fine Gold, or import old users/passwords/licences. Accounts, legal acceptance and licence tables are not replaced.

On failure, the database transaction rolls back. On success, a receipt prevents repeat import; reload the workspace. Limits: 24 MB selected files, 32 MB API requests. Larger stores need a separately reviewed migration. This is distinct from the existing SQLite backup/restore workflow.
