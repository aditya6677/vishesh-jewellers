'use strict';
function createSearchSchema(db) {
  db.exec(`CREATE VIRTUAL TABLE document_search USING fts5(store_id UNINDEXED,collection UNINDEXED,text,tokenize='trigram');
    CREATE TRIGGER search_insert AFTER INSERT ON documents WHEN NEW.collection IN ('stock-list','invoice-records') BEGIN
      INSERT INTO document_search(rowid,store_id,collection,text) VALUES(NEW.rowid,NEW.store_id,NEW.collection,
        vj_search_text(NEW.collection,NEW.payload,NEW.identity));
    END;
    CREATE TRIGGER search_update AFTER UPDATE ON documents WHEN NEW.collection IN ('stock-list','invoice-records') BEGIN
      DELETE FROM document_search WHERE rowid=OLD.rowid;
      INSERT INTO document_search(rowid,store_id,collection,text) VALUES(NEW.rowid,NEW.store_id,NEW.collection,
        vj_search_text(NEW.collection,NEW.payload,NEW.identity));
    END;
    CREATE TRIGGER search_delete AFTER DELETE ON documents BEGIN DELETE FROM document_search WHERE rowid=OLD.rowid; END;`);
}
const matchPhrase = query => '"' + query.replaceAll('"', '""') + '"';
module.exports = { createSearchSchema, matchPhrase };
