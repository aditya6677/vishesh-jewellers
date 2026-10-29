# Desktop workspace

The previous interface is saved on GitHub at commit `6d2521b`, tag
`checkpoint/pre-desktop-workspace-1.3.0`. The redesign lives on
`feature/desktop-workspace`. Restoring code does not restore business data:
keep encrypted backups separately and never overwrite a live database to change UI versions.

## Changes

- Collapsible, permission-aware sidebar; off-canvas navigation in narrow windows.
- Compact headings and panels, with full-width invoice entry.
- Live invoice preview drawer with the existing print and PDF output.
- Shortcuts: Ctrl/Command + N (new invoice), S (complete sale/save pending order),
  F (search the current table), P (print invoice). F1 shows shortcut help.
- Unsaved-invoice confirmation for New Invoice, account navigation, logout and
  desktop close/quit. A save in progress cannot be interrupted through these controls.
- Status bar: user, local storage protection, backup availability and app version.
- Remembered sidebar state, per-table page size, and desktop window size/position.

Menu changes preserve mounted drafts. Shortcuts invoke the existing buttons and
their existing validation. No invoice, GST, payment, exchange or stock formulas changed.
No additional runtime dependencies were introduced.

## Preferences and security

UI preferences use `vj-workspace-*` local-storage keys. Window geometry uses
`workspace-window.json` in Electron's user-data folder. These preferences contain
no passwords, encryption keys or business records. Missing/corrupt preferences fall
back safely. The sandboxed preload exposes only the close-confirmation handshake.

Backup status indicates file availability, not a successful recovery verification.
Browser reload/close warnings use the browser's required native warning; desktop
close/quit uses the app's confirmation dialog.

## Validation

Run `npm test` and optionally `BACKEND_MODE=legacy npm test`. Workspace tests cover
draft comparisons, reset timing, shortcuts, unavailable preference storage, window
placement and IPC authorization/cleanup. Existing financial regression tests remain enabled.

Restart the local backend after updating source adapters. Rebuild the Electron
installer to test native behavior; browser refresh alone cannot update desktop code.

Before distribution, manually verify in the rebuilt app on Windows and macOS:

1. Resize/maximize the window, close it and reopen; verify placement is restored.
2. Edit an invoice, close or quit, cancel, and verify the backend still accepts a save.
3. Repeat and confirm discard; verify the app closes. Also test a clean close.
4. Verify shortcuts, saved invoice viewing, print/PDF, and keyboard navigation.
5. Verify staff permissions and unavailable/offline backup status remain accurate.
