'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStock, StockService } = require('../lib/services/stock-service');
const details = item => ({ item, purity: '22K', qty: 1, gross: 10, net: 9 });

test('stock names capitalize each word without lowercasing abbreviations or changing numbers', () => {
  for (const [input, expected] of [
    ['ring', 'Ring'], ['gold Chain', 'Gold Chain'], ['  silver ring  ', 'Silver Ring'],
    ['gold  chain', 'Gold  Chain'], ['gold-ring', 'Gold-Ring'], ['KDM 916 ring', 'KDM 916 Ring']
  ]) assert.equal(validateStock(details(input)).item, expected);
});

test('create and edit normalize names while existing records and batch identity stay untouched', () => {
  let data = { 'stock-list': [{ id: 'old', ...details('old ring') }] };
  const service = new StockService({ read: () => structuredClone(data), write: value => { data = value; } }, { id: () => 'new' });
  const created = service.create(details('gold chain'));
  assert.equal(created.items[0].item, 'old ring');
  assert.equal(created.items[1].item, 'Gold Chain');
  service.mutate('new', { ...details('silver chain'), version: created.versions.new }, 'edit');
  assert.equal(data['stock-list'][1].item, 'Silver Chain');
  const version = service.list().versions.old;
  service.mutate('old', { qty: 1, gross: 1, net: 1, version }, 'batch');
  assert.equal(data['stock-list'][0].item, 'old ring');
});
