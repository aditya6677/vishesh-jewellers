'use strict';

// Order preserves initialization dependencies in the existing browser application.
module.exports = Object.freeze({
  views: Object.freeze(['dashboard', 'settings', 'payments', 'purchases', 'records']),
  scripts: Object.freeze([
    'core/branding',
    'core/pin-lock',
    'invoice/setup',
    'invoice/exchange',
    'invoice/payment-summary',
    'records/repository',
    'purchases/list',
    'payments/list',
    'shared/old-metal',
    'shared/transaction-editor',
    'records/filters',
    'records/pdf-export',
    'dashboard/summary',
    'invoice/preview',
    'records/void-invoice',
    'records/payment-confirmation',
    'invoice/success-dialog',
    'invoice/editor',
    'records/legacy-returns',
    'records/list',
    'core/navigation',
    'settings/status',
    'purchases/calculation',
    'dashboard/events',
    'core/tabs',
    'settings/events',
    'records/filter-events',
    'payments/form',
    'purchases/form',
    'shared/transaction-events',
    'records/settlements',
    'invoice/save'
  ])
});
