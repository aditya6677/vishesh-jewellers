'use strict';

// Frozen objects provide runtime enums without introducing a build step.
const HttpMethod = Object.freeze({ GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE' });
const HttpStatus = Object.freeze({ OK: 200, ACCEPTED: 202, BAD_REQUEST: 400, NOT_FOUND: 404, TOO_LARGE: 413, INTERNAL_ERROR: 500, UNAVAILABLE: 503 });
const BackupFormat = Object.freeze({ ENCRYPTED: 'vishesh-jewellers-encrypted-backup-v1', LEGACY: 'vishesh-jewellers-backup-v1' });
const DesktopMessage = Object.freeze({ READY: 'server-ready', CHOOSE_LOCATION: 'choose-data-location', CREATE_BACKUP: 'create-backup', RESTORE_BACKUP: 'restore-backup' });
const StorageKey = Object.freeze({ INVOICES: 'invoice-records', STOCK: 'stock-list', OLD_METAL: 'old-gold-records', PURCHASES: 'purchase-records', PAYMENTS: 'payment-records' });
const InvoiceStatus = Object.freeze({ COMPLETED: 'completed', PENDING: 'pending', VOIDED: 'voided' });

module.exports = { HttpMethod, HttpStatus, BackupFormat, DesktopMessage, StorageKey, InvoiceStatus };
