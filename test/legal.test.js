'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot } = require('../lib/database/snapshot-migration');
const { createSqlAccountRepository } = require('../lib/security/sql-account-repository');
const { LegalAcceptanceService, validateAcceptance } = require('../lib/legal/acceptance-service');
const { manifest, documentHash, documentSnapshot } = require('../lib/legal/documents');
const { renderDocument } = require('../lib/legal/render-document');
test('offline policies are whitelisted and acceptance binds the exact licence and terms', () => {
  assert.equal(createHash('sha256').update(documentSnapshot).digest('hex'), documentHash);
  assert.deepEqual(JSON.parse(documentSnapshot).documents.map(x => x.slug), ['terms', 'licence']);
  assert.throws(() => validateAcceptance({accepted:false}), /accept/);
  assert.throws(() => validateAcceptance({accepted:true,acceptanceVersion:'old',documentHash}), /changed/);
  for(const policy of manifest.documents) assert.match(renderDocument(policy.id), /Tech Aditya/);
  assert.equal(renderDocument('../package.json'), null);
});
test('administrator acceptance is atomic, encrypted, idempotent and survives database reopen', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'karat-legal-')),file=path.join(dir,'store.db'),key=randomBytes(32);
  let db=openDatabase(file,key,{create:true});
  try {
    importSnapshot(db,{'stock-list':[],'invoice-records':[],'purchase-records':[],'payment-records':[],'old-gold-records':[],'invoice-counter':1},{storeId:'main',sourceSha256:'a'.repeat(64),acknowledgeLegacy:true});
    createSqlAccountRepository(db,'main');
    let legal=new LegalAcceptanceService(db,'main');
    const actor={id:'test-admin',username:'legal-admin',name:'Legal administrator',role:'superadmin'};
    const input={accepted:true,acceptanceVersion:manifest.acceptanceVersion,documentHash};
    assert.equal(legal.status(actor).accepted,false);
    assert.throws(()=>legal.accept({...actor,role:'staff'},input),/Only/);
    db.exec("CREATE TRIGGER reject_legal_audit BEFORE INSERT ON account_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END");
    assert.throws(()=>legal.accept(actor,input),/audit failed/);
    assert.equal(legal.status(actor).accepted,false);
    db.exec('DROP TRIGGER reject_legal_audit');
    const accepted=legal.accept(actor,input);
    assert.deepEqual(legal.accept({...actor,name:'Changed'},input).acceptance,accepted.acceptance);
    assert.equal(db.prepare('SELECT documents_json FROM legal_acceptances').get().documents_json,documentSnapshot);
    assert.equal(db.prepare('SELECT count(*) AS n FROM legal_acceptances').get().n,1);
    db.close();db=openDatabase(file,key);legal=new LegalAcceptanceService(db,'main');
    assert.deepEqual(legal.status(actor).acceptance,accepted.acceptance);
    assert.equal(fs.readFileSync(file).includes(Buffer.from('legal-admin')),false);
  } finally { db.close();key.fill(0);fs.rmSync(dir,{recursive:true,force:true}); }
});
