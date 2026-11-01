# Encrypted backup behaviour

New desktop stores retain the onboarding-selected backup root. An initial portable
snapshot is created before administrator setup; it is not a current-data backup.
The onboarding recovery phrase also enables daily portable backups. Existing
stores must explicitly enable daily backups in Settings. Existing destinations
and manual backups are not moved or deleted.

The daily scheduler checks on startup and hourly while running. It creates a
portable bundle when the previous successful daily backup is at least 24 hours
old. Missed runs are caught up on next launch; closed applications cannot back up.
Weekly same-key safety copies remain available as an additional safeguard.

Automatic bundles use the existing portable v1 format: database.db, recovery.json,
manifest.json. SQLCipher encrypts the database; each bundle's SHA-256 digest is
bound into an AES-256-GCM recovery envelope. A recovery wrapping key is derived
with scrypt (N=65536,r=8,p=1), then encrypted locally under the database key with
separate authenticated context. Desktop database keys are protected by Keychain
or Windows DPAPI. The recovery passphrase is never persisted. Browser developer
previews inherit their configured database-key protection, not native safeStorage.

Recovery on a replacement computer needs the complete bundle and its passphrase,
not the old machine's key. Rotating daily recovery setup changes future bundles
only. Old phrases remain necessary for old bundles. No cloud upload is performed.

Settings displays configuration, last successful run, next due time and failures.
Failed runs do not advance the success time and retry on subsequent checks.
All backups are retained in this implementation; automatic retention/pruning is
not enabled. This avoids silently deleting existing manual or recovery copies.
Store copies off the original disk and periodically use Verify Recovery.
