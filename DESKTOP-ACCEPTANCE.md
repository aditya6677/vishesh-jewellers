# Desktop acceptance — macOS Intel

## Verified in this run

A fresh, unsigned x64 macOS application bundle was built from current source using Electron 43.8.3 and the local Electron distribution. Output is isolated at `/private/tmp/vj-desktop-acceptance-VlyU8t/build/mac/Vishesh Jewellers.app`. Existing release files, installed applications and user data were not replaced. This is an application-directory test build, not a published DMG or a signed/notarized release.

The actual packaged `app.asar.unpacked` runtime passed:

- Production encrypted-database driver/dependency resolution.
- Private-pipe database-key transport, account setup/login and API authorization.
- A 14-day trial and bundled vendor public-key detection.
- React assets, offline fonts, PDF libraries and logo availability.
- Invoice creation with exchange/discount/GST, stock quantity and total-weight deductions.
- Cash settlement, invoice edit/advance calculation, void and delete reversals.
- Portable backup verification and restoration with exact dashboard parity.
- Session revocation after restore and process restart; accounts and trial identity retained.
- Recovery into a separate fresh database location with matching records, quantities, gross/net weights and dashboard totals.
- Legacy JSON packaged-runtime smoke checks, including financial operations and encrypted persistence.

ASAR inspection confirmed the intended public verification key is bundled and matches source. Business data, vendor private signing key and issuer/test CLI scripts are excluded. First-run HTML/preload assets are present. The actual vendor private key was not opened; disposable test data/passwords were used throughout and removed after each runtime check.

Logs:

- `/private/tmp/vj-desktop-acceptance-VlyU8t/database-acceptance.log`
- `/private/tmp/vj-desktop-acceptance-VlyU8t/legacy-acceptance.log`

## Not verified by this agent run

Both native Electron key/setup commands exited SIGABRT when launched from the agent environment. That is a launch blocker, not evidence of a financial or key-protection failure. Earlier user-run terminal checks passed, but they do not substitute for current native installer acceptance.

Not marked passed: installed desktop window interactions, Keychain prompts in this build, DMG mount/install, real old-binary-to-new-binary upgrade, uninstall/reinstall through Finder, code signing/notarization/Gatekeeper, Apple Silicon/universal native execution, or Windows installation/runtime. The packaged checks use Node to start the bundled backend; they do not test the Electron GUI or an OS-protected key source. Restart and fresh-data-folder recovery simulate persistence/recovery, not an installer upgrade.

## Repeat packaged checks

From the project directory, provide the absolute unpacked runtime path:

```sh
npm run check:packaged -- "/ABSOLUTE/PATH/Vishesh Jewellers.app/Contents/Resources/app.asar.unpacked"
npm run check:packaged:database -- "/ABSOLUTE/PATH/Vishesh Jewellers.app/Contents/Resources/app.asar.unpacked"
```

The SQLite check requires the vendor public key in the build and uses disposable data only. Native checks remain `npm run check:database-key` and `npm run check:setup-recovery` from the user's Terminal. Preserve a verified portable business backup before any actual installer upgrade. Do not remove real data or OS key files as part of testing.
