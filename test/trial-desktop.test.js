'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const { desktopBackend }=require('../lib/database/desktop-startup');
test('fresh packaged installs use database setup while existing JSON and developer startup stay unchanged',()=>{
  const userData=path.resolve('/tmp','desktop-trial-test');
  const choose=(names=[],extra={})=>desktopBackend({userData,isPackaged:true,exists:file=>names.some(name=>file===path.join(userData,name)),...extra});
  assert.equal(choose(),'sqlite');
  assert.equal(choose(['data/store.json']),'json');
  assert.equal(choose(['data-location.json']),'json');
  assert.equal(choose(['database-installation.json','data/store.json']),'sqlite');
  assert.equal(choose([],{isPackaged:false}),'json');
  assert.equal(choose([],{backend:'json'}),'json');
  assert.equal(choose(['data/store.json'],{backend:'sqlite'}),'sqlite');
  assert.throws(()=>choose([],{backend:'unknown'}));
});
