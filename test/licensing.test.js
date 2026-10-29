'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, generateKeyPairSync, sign } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { LicenseService, DAY } = require('../lib/services/license-service');
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vj-license-test-')),key=randomBytes(32),file=path.join(directory,'store.db');
  const db=openDatabase(file,key,{create:true});
  importSnapshot(db,{'invoice-records':[],'stock-list':[],'purchase-records':[],'payment-records':[],'old-gold-records':[],'invoice-counter':1},{storeId:'main',sourceSha256:'a'.repeat(64),acknowledgeLegacy:true});
  const pair=generateKeyPairSync('ed25519');let now=Date.UTC(2026,9,29,10);
  const database={db,databaseKey:key,databaseFile:file,storeId:'main'};
  const service=new LicenseService(database,{publicKey:pair.publicKey,now:()=>now});
  t.after(()=>{if(db.open)db.close();key.fill(0);fs.rmSync(directory,{recursive:true,force:true})});
  const token=changes=>{const payload=Buffer.from(JSON.stringify({version:1,installationId:service.status().installationId,type:'paid',plan:'Paid test',expiresAt:null,invoiceLimit:null,...changes})).toString('base64url');return payload+'.'+sign(null,Buffer.from(payload),pair.privateKey).toString('base64url')};
  return {service,database,token,setTime:value=>{now=value},getTime:()=>now};
}
test('14-day trial begins once, has full allowance, expires exactly and detects clock rollback',t=>{
  const f=fixture(t),before=readSnapshot(f.database.db,'main');
  assert.equal(f.service.status().state,'not-started');
  const trial=f.service.beginTrial();assert.equal(trial.daysRemaining,14);assert.equal(trial.invoiceLimit,null);assert.equal(trial.writable,true);
  assert.equal(fs.readFileSync(f.service.anchorFile,'utf8').includes(trial.installationId),false);
  const start=f.getTime();f.setTime(start+3*DAY);assert.equal(f.service.beginTrial().startedAt,trial.startedAt);assert.equal(f.service.status().daysRemaining,11);
  f.setTime(start);assert.equal(f.service.status().state,'clock-check');assert.throws(()=>f.service.assertWrite(),/clock/i);
  f.setTime(start+14*DAY-1);assert.equal(f.service.status().writable,true);
  f.setTime(start+14*DAY);assert.equal(f.service.status().state,'expired');assert.throws(()=>f.service.assertWrite(),/expired/);
  assert.deepEqual(readSnapshot(f.database.db,'main'),before);
});
test('signed paid activation is store-specific; invoice quota is transactional and survives restored counters',t=>{
  const f=fixture(t);f.service.beginTrial();
  assert.throws(()=>f.service.activate(f.token({installationId:'another-store'})),/match/);
  const valid=f.token({invoiceLimit:2});assert.throws(()=>f.service.activate(valid.slice(0,-4)+'aaaa'),/signature/);
  assert.equal(f.service.activate(valid).state,'paid');
  f.service.issueInvoice(()=>({replayed:false}));
  assert.equal(f.service.status().invoicesIssued,1);
  assert.throws(()=>f.service.issueInvoice(()=>{throw Error('financial validation failed')}),/financial/);
  assert.equal(f.service.status().invoicesIssued,1);
  f.service.issueInvoice(()=>({replayed:false}));assert.equal(f.service.status().state,'limit-reached');
  assert.throws(()=>f.service.issueInvoice(()=>({replayed:false})),/allowance/);
  const saved=JSON.parse(f.database.db.prepare('SELECT payload FROM store_licenses').get().payload);saved.issued=0;
  f.database.db.prepare('UPDATE store_licenses SET payload=?').run(JSON.stringify(saved));
  assert.equal(f.service.status().invoicesIssued,2);
  f.service.activate(f.token({invoiceLimit:10}));assert.equal(f.service.status().writable,true);
  fs.writeFileSync(f.service.anchorFile,JSON.stringify({payload:'{}',mac:'00'.repeat(32)}));assert.equal(f.service.status().state,'blocked');
});
test('perpetual paid activation and a process restart preserve entitlement and business data',t=>{
  const f=fixture(t);f.service.beginTrial();const original=readSnapshot(f.database.db,'main');
  f.service.activate(f.token({plan:'Perpetual acceptance',expiresAt:null,invoiceLimit:null}));
  f.setTime(f.getTime()+400*DAY);
  assert.equal(f.service.status().state,'paid');assert.equal(f.service.status().expiresAt,null);
  const restarted=new LicenseService(f.database,{publicKey:f.service.publicKey,now:f.getTime});
  assert.equal(restarted.status().state,'paid');assert.equal(restarted.status().plan,'Perpetual acceptance');
  assert.deepEqual(readSnapshot(f.database.db,'main'),original);
});
