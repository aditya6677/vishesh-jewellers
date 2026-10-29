# In-app legal documents

The bundled policies in lib/legal/policies.json work offline. Settings and the footer open an accessible reader with Privacy, Terms, Software Licence, Trial/Refund and Contact documents.

New installations record acceptance during Superadmin account creation, atomically with the account. Existing stores retain records, exports and backups while awaiting Owner/Superadmin review. Business HTTP mutations require acceptance; the software does not erase data on rejection.

Acceptance evidence is inside the encrypted SQLite database: administrator identity, time, app version, policy version, SHA-256 hash and exact accepted Terms/Licence snapshot. Database backups therefore preserve this evidence. It is not optional-marketing consent and is not automatically uploaded.

Change acceptanceVersion only for material contractual changes that require renewed agreement. Retain historical rows and snapshots. Noncontractual notice/contact corrections should not needlessly force reacceptance.

Paid activation is verified before a confirmation screen displays the signed plan, expiry and allowance. Licence/refund documents are readable before confirmation. Activation does not charge money.

Manual release checks: fresh setup checkbox initially unchecked; keyboard-readable documents; existing store can dismiss review and export/back up; staff cannot accept; owner accepts once; reopening/backup recovery retains acceptance; test both themes and narrow windows. Rebuild installers to ship these changes.

Have the policies reviewed by qualified Indian counsel before paid commercial distribution. Encryption and acceptance records do not make an application tamper-proof or replace applicable consumer rights.
