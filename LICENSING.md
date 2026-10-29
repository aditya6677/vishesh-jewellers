# Trials and paid activation

## Automated paid-activation acceptance coverage

Disposable API/database tests cover expired-trial activation with exact before/after financial snapshots, paid invoice allowance and replay protection, invalid signatures, wrong-store activations, already-expired activations and invalid limits, allowance upgrades, exact paid-expiry boundaries, perpetual renewal and process restart. Records, stock, ledgers, invoice counter and dashboard totals are compared across activation/rejection/renewal. Test signing keys are generated only in memory or disposable temporary folders; the vendor's actual private key and active store trial are not used. This does not replace native installer or Windows acceptance.

## Customer flow

Fresh packaged desktop installations (without existing JSON data) now open encrypted-store setup by default. Choose a store name, optional tagline, recovery passphrase and backup folder, then create the first administrator. The **14 × 24-hour full-feature trial starts when administrator setup completes**, not when the installer is downloaded. There is no trial invoice cap or credit-card requirement. Staff permissions still apply; full-feature trial does not give every staff member Superadmin rights.

Trial dates persist in encrypted SQLite. The app shows days remaining and Plan & Activation in Settings. At expiry, business mutations are refused by the backend; records, reports/exports, authentication, activation and portable backup/verification remain accessible. Paid licenses can set an expiry, a lifetime-issued-invoice allowance, both, or neither. Reaching a paid allowance makes business operations read-only until upgrade. Voiding or deleting an invoice never refunds allowance; successful idempotent retries are not charged twice. Issued-count updates share the financial SQL transaction.

Backups retain license identity. An AES-256-GCM authenticated, encrypted local high-water anchor prevents an ordinary in-app restore from resetting trial dates or reducing the issued counter. Restore rejects pre-license/other-store backups in a licensed installation. Restoring on a fresh machine adopts dates from its backup, not a new 14-day period. More than five minutes of backward clock movement blocks business writes until corrected/support review. Existing legacy JSON desktop installations keep their old startup path; their migration remains explicit. Legacy issued counts are conservatively seeded from the greater of the existing invoice counter minus one and current invoice-row count; all later issued invoices are counted transactionally.

## Vendor signing setup — required before publishing paid activation

Only the vendor holds an Ed25519 private signing key. Store Superadmins and Owners may paste a signed activation but cannot issue licenses or extend trial dates through the app. No private key is embedded in the customer build. Without the public verification key, trial works but paid activation is disabled with a clear message.

From this project directory, run the vendor-only CLI with **new absolute paths** (the private directory must already exist):

```sh
npm run license:issuer -- keys --public "$PWD/assets/license-public-key.pem" --private "/ABSOLUTE/PRIVATE/license-private.pem"
```

Enter a private-key passphrase of 12–128 characters at the hidden prompt. The private PEM is encrypted; back it up securely and keep its passphrase separately. Never send either to customers or commit the private key. The public PEM belongs in assets/license-public-key.pem and must be included in the rebuilt app. Restart the local preview after adding the public key.

To issue an activation for the Store activation ID shown in Settings:

```sh
npm run license:issuer -- issue --private "/ABSOLUTE/PRIVATE/license-private.pem" --store "STORE-ACTIVATION-UUID" --plan "Paid" --limit 1000 --expires "2027-10-29T23:59:59Z"
```

Omit --limit for unlimited allowance; omit --expires for no expiry. The allowance is the lifetime total, including existing invoices; an upgrade limit must exceed invoices already issued. Enter the key passphrase privately. Send the resulting signed activation to the customer, who pastes it into Settings → Plan & Activation. Never put passphrases in command arguments, source code or chat. CLI scripts are not packaged for customers. A signed activation is a license artifact, not an authentication credential.

## Important offline limitations

This is **offline enforcement**, not a tamper-proof entitlement service. A machine administrator who controls the code, database keys, clocks and installation files can work around local checks. A complete reinstall with all local evidence removed can obtain another offline trial. Copying an entire licensed store to another machine is not prevented by store-bound signatures. Strict one-trial-per-customer/device, revocation, trusted time, device limits and payments require a separately deployed vendor activation service. Do not advertise those guarantees or ship a commercial release claiming online licensing exists.

The browser developer launcher reads licensingEnabled from ignored data/database-active.json. Its local anchor also forces licensing on during later normal startups. No existing release assets or installed desktop binary are changed by source edits; build and test fresh installers before distributing the new trial. Native Windows installation acceptance remains pending.
