'use strict';
const { manifest, documentSnapshot, documentHash } = require('./documents');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function validateAcceptance(input) {
  if (input?.accepted !== true) fail('Read and accept the Software Licence and Terms of Use to continue.');
  if (input.acceptanceVersion !== manifest.acceptanceVersion || input.documentHash !== documentHash) fail('The licence has changed. Reload and review the current documents before accepting.', 409);
}
class LegalAcceptanceService {
  constructor(db, storeId, { now = Date.now } = {}) {
    this.db = db; this.storeId = storeId; this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS legal_acceptances (
      store_id TEXT NOT NULL REFERENCES stores(store_id), acceptance_version TEXT NOT NULL,
      policy_version TEXT NOT NULL, documents_sha256 TEXT NOT NULL, documents_json TEXT NOT NULL CHECK(json_valid(documents_json)),
      accepted_at TEXT NOT NULL, actor_id TEXT NOT NULL, actor_username TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL,
      app_version TEXT NOT NULL, PRIMARY KEY(store_id,acceptance_version)
    )`);
  }
  status(actor) {
    const acceptance = this.db.prepare('SELECT policy_version AS policyVersion, acceptance_version AS acceptanceVersion, documents_sha256 AS documentHash, accepted_at AS acceptedAt, actor_id AS actorId, actor_username AS username, actor_name AS name, actor_role AS role, app_version AS appVersion FROM legal_acceptances WHERE store_id=? AND acceptance_version=?').get(this.storeId, manifest.acceptanceVersion) || null;
    return { ...manifest, enabled: true, accepted: Boolean(acceptance), canAccept: ['superadmin', 'owner'].includes(actor?.role), acceptance };
  }
  accept(actor, input) {
    if (!actor?.id || !['superadmin', 'owner'].includes(actor.role)) fail('Only Superadmin or Owner can accept the store software licence.', 403);
    validateAcceptance(input);
    return this.db.transaction(() => {
      if (!this.status(actor).accepted) {
        const acceptedAt = new Date(this.now()).toISOString();
        this.db.prepare('INSERT INTO legal_acceptances VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(this.storeId, manifest.acceptanceVersion, manifest.version, documentHash, documentSnapshot, acceptedAt, actor.id, actor.username, actor.name, actor.role, require('../../package.json').version);
        this.db.prepare('INSERT INTO account_audit(store_id,occurred_at,action) VALUES(?,?,?)').run(this.storeId, acceptedAt, JSON.stringify({ actorId: actor.id, operation: 'legal.accepted', acceptanceVersion: manifest.acceptanceVersion, documentHash }));
      }
      return this.status(actor);
    }).immediate();
  }
}
module.exports = { LegalAcceptanceService, validateAcceptance };
