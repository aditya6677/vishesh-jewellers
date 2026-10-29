'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BrandingService, validateBranding } = require('../lib/services/branding-service');
const { buildSystemExport } = require('../lib/excel-export');
const { inflateRawSync } = require('node:zlib');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1cAAAAASUVORK5CYII=';
test('branding validates images and preserves business contacts and financial records', () => {
  let data = { 'business-info': { name: 'Original', gstin: 'GST-TEST', phone: '9000000000', address: 'Test address' }, 'invoice-records': [{ number: 'VJ000001', total: 100 }], 'stock-list': [{ net: 10 }] };
  const before = structuredClone(data);
  const service = new BrandingService({ read: () => structuredClone(data), write: value => { data = value; } });
  assert.equal(service.read().name, 'Original');
  service.save({ name: ' New store ', tagline: 'Our special relationship', logo: png });
  assert.equal(service.read().name, 'New store'); assert.equal(service.read().logo,png);
  assert.equal(data['business-info'].gstin,before['business-info'].gstin);
  assert.deepEqual(data['invoice-records'],before['invoice-records']); assert.deepEqual(data['stock-list'],before['stock-list']);
  for(const value of [{name:'',tagline:'',logo:''},{name:'Store',tagline:'x'.repeat(161),logo:''},{name:'Store',tagline:'',logo:'https://example.com/logo.png'},{name:'Store',tagline:'',logo:'data:image/svg+xml;base64,PHN2Zz4='},{name:'Store',tagline:'',logo:'data:image/png;base64,aGVsbG8='}]) assert.throws(()=>validateBranding(value));
  const unchanged=structuredClone(data);assert.throws(()=>service.save({name:'',tagline:'',logo:''}));assert.deepEqual(data,unchanged);
});
test('Excel keeps logo data lossless without putting oversized image text in the readable profile', () => {
  const workbook=buildSystemExport({'business-info':{name:'Branding test',logo:png}});
  const sheets=[];let offset=0;
  while(workbook.readUInt32LE(offset)===0x04034b50){const size=workbook.readUInt32LE(offset+18),nameLength=workbook.readUInt16LE(offset+26),extra=workbook.readUInt16LE(offset+28),start=offset+30+nameLength+extra;const name=workbook.toString('utf8',offset+30,offset+30+nameLength);if(name.startsWith('xl/worksheets/'))sheets.push(inflateRawSync(workbook.subarray(start,start+size)).toString());offset=start+size;}
  assert.ok(sheets.some(sheet=>sheet.includes('Embedded store logo (preserved in Complete Data sheet)')&&!sheet.includes(png)));
  assert.ok(sheets.some(sheet=>sheet.includes(png)));
});
