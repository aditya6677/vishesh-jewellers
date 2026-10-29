# Account migration: incremental implementation

## Store branding

Settings includes a Superadmin-only Store Branding panel for name, tagline and PNG/JPEG logo (1 MB, up to 4096×4096). Changes merge into encrypted business-info without replacing GST/contact details or financial collections. Dedicated branding writes and generic business-info writes are denied to non-Superadmins in account mode. Workspace name/logo/footer, login branding, new invoice preview and watermark use saved branding. Saved invoice HTML snapshots are not rewritten; regenerated snapshots can safely retain embedded raster logos. SVG and remote logo URLs are not accepted. Readable Excel shows a logo placeholder while Complete Data retains the encoded asset in bounded parts.

A verified same-key safety backup including account tables was taken before this feature's activation. Portable backup creation still requires the human to enter their recovery passphrase in Settings; no passphrase was retrieved, reused or invented by the agent.

## Current: connected account flow (explicit SQLite activation)

Set ACCOUNTS_ENABLED=1 on an encrypted SQLite installation to enable setup/login and API permission checks. The local migrated launcher also reads accountsEnabled from ignored data/database-active.json. Once the first Superadmin is configured, an adjacent ownership marker forces accounts on for later normal launches even if the environment flag is omitted. Missing users with an existing marker fail closed; restoring a pre-account backup through the running account-enabled app is refused. This is not protection against a machine administrator modifying source, keys or database files.

The human creates the first local-installation Superadmin at /login or /. No shared password is generated. /accounts provides password change, user creation, identity edits, deactivation/reactivation, role assignment, temporary-password resets, permissions for the built-in Owner/Admin/Staff roles and the latest 200 audit entries. Superadmin grants are immutable. Owners administer only Admin/Staff; administrative privilege cannot be delegated by ticking a Staff permission. Custom role names, remote vendor identity and licensing are separate future work.

Sessions use random tokens in HttpOnly SameSite=Strict cookies on loopback HTTP, with idle/absolute expiry and worker-memory sessions invalidated on restart. Use TLS/Secure cookies and a separate deployment design before any remote hosting; this implementation rejects non-localhost Host and cross-origin mutation requests. Every protected business API is checked, generic financial writes are denied, and account credentials never appear in business storage/export. Read access necessarily lets a user copy the information they can legitimately view. Existing cached authenticated HTML is removed by the account-mode service worker.

Passwords use salted scrypt in a bounded worker queue. Per-username lockouts persist in encrypted SQL; a process-local global attempt limiter bounds random-username attempts. Access changes, resets and role-permission changes revoke affected sessions. Client inactivity locks after 30 minutes; the API also validates current account status on each request. Passwords/passphrases are not written to audit logs. Business action audit logging is operational history after successful requests, not an atomic compliance ledger or tamper-proof audit trail.

Database backups preserve user/role/hash tables. Restoring account-enabled backups preserves their credentials, revokes current sessions and requires re-login. Owners must create a fresh portable backup after account setup; earlier financial-only backups remain untouched but cannot reset ownership through the running app. Forgotten last-Superadmin credentials require a separately designed, verified recovery process; no hidden bypass/default credential was added.

Local browser activation does not update an already installed desktop binary or certify native Windows behavior. Business data calculations are unchanged. Branding and trial/paid licensing remain separate modules.

## Increment 2: encrypted SQLite foundation

Dedicated `account_users`, `account_roles`, `account_installations`, and `account_audit` tables now support the existing account-service contract inside the encrypted database. Generic business snapshots and Excel export do not include credentials. Database backups include these tables. Menu/action permission definitions cover dashboard, invoices, records, stocks, purchases, payments, settings and user administration, with explicit default role permissions and unknown-permission rejection.

`AsyncAccounts` runs the existing password/session service in a worker with at most eight pending requests. Password hashing no longer needs to run on the HTTP/event-loop thread when this adapter is connected. Worker sessions remain in memory and are revoked on restart. Tests cover initial Superadmin setup, duplicate setup rejection, temporary-password change, privilege denial, last-Superadmin protection, deactivation/session revocation, encrypted backup preservation, and unchanged financial records.

These additions are not yet connected to the active app. The live database has not been altered by account tests. PIN login remains until a complete login/HTTP authorization boundary is ready. Login/setup UI, HttpOnly cookies, origin checks, persistent throttling, customizable-role management, actor-level audit details, account-aware restore policy and full route/UI permission enforcement are still required. Do not mistake the permission catalogue for enforced business authorization. No actual user/password has been generated.

Branch: `feature/store-accounts`. Rollback: published tag `v1.1.1`.

## Increment 1: isolated account-security foundation

Implemented under `lib/security/`:
- Explicit installation-key requirement and separate AES-256-GCM account storage.
  Account records never enter the generic business store or readable Excel export.
- Salted, versioned scrypt password hashes: N=131072, r=8, p=1; 12–128-character
  password policy and constant-time derived-key comparison. No default password.
- One-time in-process Superadmin setup and per-installation store ID.
- Superadmin, Owner, Admin and Staff role constants. Initial permissions cover
  account administration only; business permission mapping is not implemented yet.
- Random server session tokens retained only as hashes, idle/absolute expiry,
  logout, immediate revocation after access changes/password reset, and mandatory
  temporary-password replacement. Sessions deliberately do not survive restart.
- Generic login errors, bounded in-memory attempt tracking, and temporary lockout.
- No deletion of account history, and no removal of the last active Superadmin.
- Owners cannot create/reset or modify Superadmin or Owner accounts.

## Intentionally not activated

These modules are not imported by the application composition root. The running
app still uses its existing PIN and business APIs. No real administrator account,
password, data-file migration, or active account storage has been created.
This is NOT a production username/password rollout and does not yet secure the
current business API. Do not expose that API publicly.

The local installation Superadmin is not yet a remote vendor/platform identity.
Online licensing and vendor access remain a separate service design.

## Required before activation

1. Move expensive hashing to bounded asynchronous/worker execution before wiring
   HTTP endpoints, so login attempts cannot stall financial operations. Extend
   lockout/rate-limit policy across source addresses, restart and setup endpoints.
2. Add login/setup UI and first-run ownership protection; the human enters the
   initial password. No password or shared bootstrap credential goes into code.
3. Issue HttpOnly SameSite cookies, add origin/CSRF checks, and validate sessions
   on all protected endpoints. Gate user management with fresh role checks.
4. Enforce mandatory password changes across routes; add role/menu/action policy
   coverage. Block generic storage/export routes from exposing account data.
5. Define backup/restore/data-location migration for the separate account file and
   installation key. Existing business-only backups do not back up this new file.
6. Audit reset/access actions, recovery procedures, session revocation and user
   isolation. Do not provide unrestricted owner-to-Superadmin escalation.
7. Run both financial/backend suites and browser/Desktop acceptance before
   replacing PIN login. Bump version when the next push is requested.

Security foundation tests use disposable encrypted files and test-only passwords.
Existing business data and the published release remain untouched.

Reference: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
