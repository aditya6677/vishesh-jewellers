'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const { validBounds, loadWindowState, saveWindowState } = require('../lib/desktop-window-state');

function compile(file, mocks, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), ...globals });
  return module.exports;
}

test('workspace preferences validate page sizes and tolerate unavailable storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const api = compile('frontend/workspace/preferences.ts', { react: { useState: initial => [initial(), () => {}] } }, { localStorage: storage });
  assert.equal(api.validPageSize('25'), 25);
  for (const value of ['0', '-1', '1000000', 'corrupt', 'NaN']) assert.equal(api.validPageSize(value), 10);
  api.writePreference('sidebar', 'collapsed'); assert.equal(api.readPreference('sidebar', ''), 'collapsed');
  api.usePageSize('stocks')[1](50); assert.equal(values.get('vj-workspace-page-size-stocks'), '50');
  assert.equal(api.usePageSize('records')[0], 10);
  const blocked = compile('frontend/workspace/preferences.ts', { react: {} }, { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
  assert.equal(blocked.readPreference('sidebar', 'expanded'), 'expanded');
  assert.doesNotThrow(() => blocked.writePreference('sidebar', 'collapsed'));
});

test('older preview anchors open the drawer without navigating and detach cleanly', () => {
  const { bindPreviewLink } = compile('frontend/invoice/preview-link.ts', {});
  let click, opened = 0, prevented = 0;
  const link = { classList: { remove(value) { assert.equal(value, 'btn-sm'); }, add(value) { assert.equal(value, 'invoice-preview-button'); } }, setAttribute(name, value) { assert.equal(name, 'aria-haspopup'); assert.equal(value, 'dialog'); },
    addEventListener(name, callback) { assert.equal(name, 'click'); click = callback; },
    removeEventListener(name, callback) { assert.equal(name, 'click'); assert.equal(callback, click); click = undefined; } };
  const cleanup = bindPreviewLink(link, () => opened++);
  assert.equal(link.textContent, 'Preview');
  click({ preventDefault() { prevented++; } });
  assert.equal(opened, 1); assert.equal(prevented, 1);
  cleanup(); assert.equal(click, undefined);
  assert.doesNotThrow(() => bindPreviewLink(null, () => assert.fail())());
});

test('invoice preview fits both window dimensions while PDF clones retain full paper size', () => {
  const { previewScale, fullSizeInvoiceClone } = compile('frontend/invoice/InvoiceFit.tsx', { react: {} });
  assert.equal(previewScale(850, 1200, 1000), 1);
  assert.equal(previewScale(425, 1200, 1000), .5);
  assert.equal(previewScale(850, 500, 1000), .5);
  assert.equal(previewScale(850, 500, 2000), .25);
  assert.equal(previewScale(0, 0, 0), 1);
  const nodes = Object.fromEntries(['.invoice-fit-stage', '.invoice-fit-viewport', '.invoice-preview-drawer'].map(selector => [selector, { style: {} }]));
  fullSizeInvoiceClone({ querySelector: selector => nodes[selector] });
  assert.equal(nodes['.invoice-fit-stage'].style.transform, 'none');
  assert.equal(nodes['.invoice-fit-stage'].style.width, '850px');
  assert.equal(nodes['.invoice-fit-viewport'].style.overflow, 'visible');
  assert.equal(nodes['.invoice-preview-drawer'].style.height, 'auto');
  assert.doesNotThrow(() => fullSizeInvoiceClone({ querySelector: () => null }));
});

test('window placement rejects corrupt/offscreen preferences and saves normal rather than maximized bounds', t => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.equal(validBounds({ x: 9000, y: 0, width: 1440, height: 920 }, displays), null);
  assert.equal(validBounds({ x: 0, y: -200, width: 1440, height: 920 }, displays), null);
  assert.equal(validBounds({ x: 0, y: 0, width: 0, height: 920 }, displays), null);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-window-state-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'workspace-window.json');
  assert.equal(loadWindowState(file, displays), null);
  const bounds = { x: 40, y: 60, width: 1400, height: 900 };
  saveWindowState(file, { isDestroyed: () => false, isMinimized: () => false, getNormalBounds: () => bounds, isMaximized: () => true });
  assert.deepEqual(loadWindowState(file, displays), { bounds, maximized: true });
  assert.equal(fs.existsSync(file + '.tmp'), false);
  fs.writeFileSync(file, 'corrupt'); assert.equal(loadWindowState(file, displays), null);
});

function workspaceHarness() {
  const listeners = new Map(), cleanups = [], states = [];
  const register = (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); };
  const remove = (name, callback) => listeners.get(name)?.delete(callback);
  const emit = (name, event = {}) => { for (const callback of listeners.get(name) || []) callback(event); };
  class Element { closest() { return this; } click() { this.clicks = (this.clicks || 0) + 1; } getClientRects() { return [1]; } }
  const nodes = new Map(['btnNewInvoice', 'btnCompleteSale', 'btnSavePendingOrder', 'btnPrint', 'invoiceTab'].map(key => [key, new Element()]));
  nodes.set('page-home', { classList: { contains: () => true } });
  const values = { 'amount-paid': '0', 'invoice-discount': '0', 'gst-rate': '1.5', 'inv-terms': 'Terms' };
  for (const [key, value] of Object.entries(values)) nodes.set(key, { value });
  const detail = { 'cust-name': '', 'cust-mobile': '', 'cust-address': '', 'inv-date': '2026-10-30', invoiceType: 'sale' };
  const item = { id: 'a', stockId: '', name: '', purity: '22K', gross: '', net: '', pcs: 1, rate: '', making: 10, available: {} };
  let closeRequest, closes = 0, messages = 0;
  const window = {
    vjInvoiceDetails: { read: () => detail }, vjInvoiceItems: { read: () => ({ items: [item], pending: false }) }, vjInvoiceExchangeEntries: () => [],
    addEventListener: register, removeEventListener: remove, dispatchEvent: event => emit(event.type, event),
    clearTimeout() {}, setTimeout(callback) { callback(); return 1; },
    vjDesktop: { onCloseRequest(callback) { closeRequest = callback; return () => { closeRequest = undefined; }; }, confirmClose() { closes++; } },
    showAppMessage() { messages++; }
  };
  const document = { getElementById: key => nodes.get(key), addEventListener: register, removeEventListener: remove, querySelector: () => null, body: { classList: { contains: () => false } } };
  const api = compile('frontend/workspace/Workspace.tsx', {
    react: { useRef: value => ({ current: value }), useState: () => [undefined, value => states.push(value)], useEffect: callback => cleanups.push(callback()) },
    '../components/Dialog': {}, './StatusBar': {}
  }, { window, document, Element, Event: class { constructor(type) { this.type = type; } } });
  api.Workspace();
  return { api, emit, nodes, detail, item, states, listeners, cleanups, hiddenInput: () => { const target = new Element(); target.getClientRects = () => []; emit('input', { target }); }, interact: () => emit('pointerdown', { target: new Element() }), requestClose: () => closeRequest(), closes: () => closes, messages: () => messages };
}

test('draft signatures ignore stock-cache refreshes, but track quantity, money and customer edits', () => {
  const h = workspaceHarness();
  const before = h.api.invoiceDraftSignature();
  h.item.available = { anotherStock: 100 }; h.item.id = 'new-row-id';
  assert.equal(h.api.invoiceDraftSignature(), before);
  h.item.pcs = 4; assert.notEqual(h.api.invoiceDraftSignature(), before);
  const quantity = h.api.invoiceDraftSignature(); h.detail['cust-name'] = 'Draft customer'; assert.notEqual(h.api.invoiceDraftSignature(), quantity);
});

test('desktop close requires confirmation for dirty drafts and cannot interrupt an invoice save', () => {
  const h = workspaceHarness();
  h.requestClose(); assert.equal(h.closes(), 1);
  h.interact(); h.detail['cust-name'] = 'Unsaved'; h.requestClose();
  assert.equal(h.closes(), 1); assert.equal(h.states.at(-1).closing, true);
  h.states.at(-1).action(); assert.equal(h.closes(), 2);
  h.emit('vj:invoice-save-start'); h.requestClose(); assert.equal(h.closes(), 2); assert.equal(h.messages(), 1);
  h.emit('vj:invoice-save-end');
  for (const cleanup of h.cleanups) cleanup();
  assert.ok([...h.listeners.values()].every(callbacks => callbacks.size === 0));
});

test('keyboard shortcuts reuse existing save/print/new controls and skip modal, repeated and modified keys', () => {
  const h = workspaceHarness();
  const key = (value, extra = {}) => { let prevented = false; h.emit('keydown', { key: value, ctrlKey: true, preventDefault() { prevented = true; }, ...extra }); return prevented; };
  let printRequests = 0;
  h.listeners.set('vj:print-invoice', new Set([() => printRequests++]));
  assert.equal(key('s'), true); assert.equal(h.nodes.get('btnCompleteSale').clicks, 1);
  key('p'); assert.equal(printRequests, 1);
  key('n'); assert.equal(h.nodes.get('btnNewInvoice').clicks, 1);
  key('s', { repeat: true }); key('s', { altKey: true }); assert.equal(h.nodes.get('btnCompleteSale').clicks, 1);
  h.nodes.get('btnCompleteSale').disabled = true; key('s'); assert.equal(h.nodes.get('btnCompleteSale').clicks, 1);
});

test('preview belongs beside sale actions while print and PDF are inside the drawer only', () => {
  const { PageRenderer } = require('../lib/ui/page-renderer');
  const { createConfig } = require('../lib/config');
  const html = new PageRenderer(createConfig({})).render({ reactDashboard: true });
  assert.match(html, /<span id="react-invoice-preview-action"><\/span><button class="btn btn-gold" id="btnCompleteSale">/);
  assert.doesNotMatch(html, /<a[^>]*invoice-preview-jump|id="react-invoice-print-action"|id="react-invoice-pdf-action"/);
  const source = fs.readFileSync(path.join(root, 'frontend/invoice/InvoicePreview.tsx'), 'utf8');
  assert.match(source, /preview-output-actions"><button id="btnPrint"/);
  assert.match(source, /separate\.className = 'invoice-new-action'/);
  assert.match(source, /Preview<\/button>/);
});

test('reset ignores delayed React clearing and protects the next actual invoice edit', () => {
  const h = workspaceHarness();
  h.interact(); h.detail['cust-name'] = 'Saved customer';
  h.emit('vj:invoice-reset');
  h.hiddenInput();
  h.detail['cust-name'] = ''; h.item.gross = '';
  let prevented = false;
  h.emit('beforeunload', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  h.interact(); h.detail['cust-name'] = 'Next draft';
  h.emit('beforeunload', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('desktop close IPC accepts only the main window frame and removes handlers when closed', () => {
  const ipcMain = new EventEmitter(); let instance;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.isDestroyed = () => false; this.webContents.isCrashed = () => false; this.sent = []; this.webContents.send = name => this.sent.push(name); instance = this; }
    loadURL() {} maximize() {} destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const source = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
  const create = source.slice(source.indexOf('function createWindow(url)'), source.indexOf('async function configureFirstRun'));
  let quits = 0;
  const context = {
    desktopCloseForQuit: undefined,
    runtimeRoot: () => root, require: () => ({ loadWindowState: () => null, saveWindowState() {} }), path, app: { getPath: () => '/private/tmp', quit: () => quits++ },
    screen: { getAllDisplays: () => [] }, BrowserWindow: Window, ipcMain, __dirname: root, clearTimeout, setTimeout
  };
  vm.runInNewContext(create + '\ncreateWindow("http://127.0.0.1:3000");', context);
  let prevented = false;
  const close = () => instance.emit('close', { preventDefault() { prevented = true; } });
  const other = { sender: {}, senderFrame: {} };
  ipcMain.emit('workspace:ready', other); close(); assert.equal(prevented, false);
  const valid = { sender: instance.webContents, senderFrame: instance.webContents.mainFrame };
  ipcMain.emit('workspace:ready', valid); close(); assert.equal(prevented, true);
  assert.deepEqual(instance.sent, ['workspace:request-close']);
  assert.equal(context.desktopCloseForQuit(), true); assert.equal(quits, 0);
  ipcMain.emit('workspace:confirm-close', other); assert.equal(instance.destroyed, undefined);
  ipcMain.emit('workspace:confirm-close', valid); assert.equal(instance.destroyed, true);
  assert.equal(quits, 1); assert.equal(context.desktopCloseForQuit, undefined);
  assert.equal(ipcMain.listenerCount('workspace:confirm-close'), 0);
  assert.equal(ipcMain.listenerCount('workspace:ready'), 0);
  assert.equal(instance.options.webPreferences.contextIsolation, true);
  assert.equal(instance.options.webPreferences.nodeIntegration, false);
  assert.equal(instance.options.webPreferences.sandbox, true);
  assert.match(source, /if \(desktopCloseForQuit\?\.\(\)\) \{ event.preventDefault\(\); return; \}/);
});

test('installer includes restricted workspace preload and the preview paper remains mounted in a print-ready drawer', () => {
  assert.ok(require('../package.json').build.files.includes('scripts/workspace-preload.js'));
  const source = fs.readFileSync(path.join(root, 'frontend/invoice/InvoicePreview.tsx'), 'utf8');
  assert.match(source, /<dialog ref=\{drawer\}/);
  assert.match(source, /<InvoicePaper snapshot=\{snapshot\} paperRef=\{paper\}/);
  assert.match(source, /openPreview\(\);\s*await new Promise/);
  assert.doesNotMatch(source, /open && <InvoicePaper/);
});
