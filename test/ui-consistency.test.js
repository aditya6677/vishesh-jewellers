'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('React inputs declare their type and use the shared custom dropdown', () => {
  const files = fs.readdirSync(path.join(root, 'frontend'), { recursive: true }).filter(file => file.endsWith('.tsx'));
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'frontend', file), 'utf8');
    for (const input of source.matchAll(/<input\b[\s\S]*?\/>/g)) assert.match(input[0], /\btype\s*=/, file + ': explicit input type required for consistent styling');
    assert.doesNotMatch(source, /<select\b/, file + ': use the shared Select component');
  }
});

test('shared UI styles cover default text/search fields, focus states and tablet navigation', () => {
  const html = fs.readFileSync(path.join(root, 'source/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source/styles/application.css'), 'utf8');
  assert.match(html, /input:not\(\[type\]\), input\[type=text\], input\[type=search\]/);
  assert.match(css, /#invoice-details-inv-no:disabled/);
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /a\.btn, a\.btn:hover, a\.btn:focus, a\.btn:active, a\.btn:visited\s*\{ text-decoration: none; \}/);
  assert.match(html, /nav\.tabs\{[^}]*overflow-x:auto; flex-wrap:nowrap/);
  assert.match(html, /nav\.tabs button\.active\{\s*background:linear-gradient/);
  assert.doesNotMatch(html, /nav\.tabs button\.active::after/);
  assert.match(html, /min-height:44px; padding:12px 22px; border-radius:999px/);
  assert.match(css, /\.workspace-account-actions \{ grid-area:1 \/ 2/);
});

test('shared UI keeps calculated fields, table actions and small-screen dialogs consistent', () => {
  const css = fs.readFileSync(path.join(root, 'source/styles/application.css'), 'utf8');
  assert.match(css, /output\.payment-balance\s*\{[^}]*display:block/);
  assert.match(css, /td\.actions-cell\s*\{\s*display:table-cell; white-space:nowrap/);
  assert.match(css, /max-height:calc\(100dvh - 32px\)/);
  assert.match(css, /overscroll-behavior:contain/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  const pagination = fs.readFileSync(path.join(root, 'frontend/components/Pagination.tsx'), 'utf8');
  assert.match(pagination, /role="navigation" aria-label="Table pagination"/);
  assert.match(pagination, /className="page-range" aria-live="polite"/);
});

test('invoice entry uses the full width with a dedicated preview drawer in the desktop workspace', () => {
  const css = fs.readFileSync(path.join(root, 'source/styles/application.css'), 'utf8');
  assert.match(css, /\.invoice-layout\s*\{ grid-template-columns:minmax\(0,1fr\); gap:28px;/);
  assert.match(css, /\.paper-outer\s*\{ position:static;[^}]*max-width:900px/);
  const source = fs.readFileSync(path.join(root, 'source/index.html'), 'utf8');
  assert.match(source, /invoice-preview-jump/);
  const preview = fs.readFileSync(path.join(root, 'frontend/invoice/InvoicePreview.tsx'), 'utf8');
  assert.match(preview, /<h3>Live invoice preview<\/h3>/);
  assert.match(preview, /className="invoice-preview-drawer"/);
  assert.match(css, /\.desktop-workspace main \{ margin:0 0 0 var\(--sidebar-width\)/);
});
