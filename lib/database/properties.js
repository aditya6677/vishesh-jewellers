'use strict';
function ensureProperty(db, storeId, name, collection, payload) {
  const existing = db.prepare('SELECT is_collection FROM store_properties WHERE store_id=? AND name=?').get(storeId, name);
  if (existing) { if (existing.is_collection !== Number(collection)) throw new Error('Invalid store property type.'); return; }
  const position = db.prepare('SELECT coalesce(max(position),-1)+1 AS n FROM store_properties WHERE store_id=?').get(storeId).n;
  if (!Number.isSafeInteger(position)) throw new Error('Store property position overflow.');
  db.prepare('INSERT INTO store_properties VALUES(?,?,?,?,?)').run(storeId, name, position, Number(collection), payload);
}
module.exports = { ensureProperty };
