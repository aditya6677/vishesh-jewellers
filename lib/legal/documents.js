'use strict';
const { createHash } = require('node:crypto');
const bundle = require('./policies.json');
const acceptedDocuments = bundle.policies.filter(document => ['terms', 'licence'].includes(document.slug));
const documentSnapshot = JSON.stringify({ version: bundle.version, acceptanceVersion: bundle.acceptanceVersion, documents: acceptedDocuments });
const documentHash = createHash('sha256').update(documentSnapshot).digest('hex');
const manifest = Object.freeze({ version: bundle.version, acceptanceVersion: bundle.acceptanceVersion, documentHash, business: bundle.business, documents: bundle.policies.map(document => ({ id: document.slug, title: document.title, summary: document.lead, url: '/legal/' + document.slug })) });
function documentFor(id) { return bundle.policies.find(document => document.slug === id); }
module.exports = { manifest, documentSnapshot, documentHash, documentFor };
