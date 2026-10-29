# Safe startup recovery

A startup failure opens a dedicated, sandboxed recovery window instead of advising
users to delete AppData. It never automatically regenerates an existing store's key.

- **Retry startup**: retry without resetting stored data.
- **Open data folder**: open only this installation's app-data folder.
- **Restore portable backup**: choose the folder containing `database.db`,
  `recovery.json`, and `manifest.json`, and enter its recovery passphrase.
- **Set up a separate new store**: explicitly type `CREATE NEW STORE`, then finish
  normal new-store onboarding. This creates an empty store, not a recovery of old records.

Restore and new setup run in a unique `recovery-*` subdirectory. The prepared
database and its OS-protected key are verified before activating its installation
pointer. Previous databases and keys stay untouched; previous installation settings
are copied into that recovery directory's `previous-settings` folder. A failure
before activation leaves the old installation pointer unchanged. The app must
restart after successful activation.

Portable recovery requires the backup's passphrase. An OS-bound JSON backup/key
cannot simply be transferred between accounts or computers. If no usable portable
backup exists, keep the original files and try the original OS account or seek support.
Do not promise that a missing encryption key or recovery passphrase can be reset.

Automated tests cover populated recovery, exact record/report matching, wrong
passphrases, damaged staged databases, failed activation, old-file preservation,
IPC authorization and setup mode locking. Native Windows DPAPI and macOS Keychain
acceptance still require testing in rebuilt installers on those platforms.
The existing `npm run check:setup-recovery` and Windows/macOS release CI now also
exercise startup activation with the real OS keystore using disposable data.

For native acceptance, use disposable data: corrupt only the disposable wrapped
key, verify the recovery screen, cancel recovery and confirm files are unchanged,
then restore a portable backup. Reopen the app and compare records and reports.
Also verify separate fresh setup keeps the previous files. Never conduct a
deliberate-corruption test against a customer's actual installation.
