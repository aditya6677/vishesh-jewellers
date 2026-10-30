import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { StatusBar } from './StatusBar';

declare global {
  interface Window {
    vjDesktop?: { onCloseRequest: (callback: () => void) => () => void; confirmClose: () => void; legacySource: (options: { portable?: boolean; passphrase?: string }) => Promise<{ snapshot?: Record<string, unknown>; saved?: boolean; cancelled?: boolean; error?: string }> };
  }
}

// Only draft values are compared. Stock caches, row IDs and computed totals are not edits.
export function invoiceDraftSignature(): string {
  const details = window.vjInvoiceDetails?.read();
  const items = window.vjInvoiceItems?.read().items || [];
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value || '';
  return JSON.stringify({
    customer: details?.['cust-name'] || '', mobile: details?.['cust-mobile'] || '', address: details?.['cust-address'] || '',
    date: details?.['inv-date'] || '', type: details?.invoiceType || 'sale',
    items: items.map(row => [row.stockId, row.name, row.purity, row.gross, row.net, row.pcs, row.rate, row.making]),
    exchanges: window.vjInvoiceExchangeEntries?.() || [], paid: value('amount-paid'), discount: value('invoice-discount'),
    tax: value('gst-rate'), terms: value('inv-terms')
  });
}

export function Workspace() {
  const [confirmation, setConfirmation] = useState<{ action: () => void; closing: boolean }>();
  const [shortcuts, setShortcuts] = useState(false);
  const pending = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    let baseline = invoiceDraftSignature();
    let resetTimer = 0;
    let acceptingNew = false;
    let interacted = false;
    const dirty = () => interacted && invoiceDraftSignature() !== baseline;
    const ask = (action: () => void, closing = false) => {
      if (saving.current) { window.showAppMessage?.('Please wait until the invoice has finished saving.', 'error'); return; }
      if (!dirty()) { action(); return; }
      if (pending.current) return;
      pending.current = true; setConfirmation({ action: () => { baseline = invoiceDraftSignature(); action(); }, closing });
    };
    const reset = () => { interacted = false; window.clearTimeout(resetTimer); resetTimer = window.setTimeout(() => { if (!interacted) baseline = invoiceDraftSignature(); }, 0); };
    const initialize = () => { if (!interacted) baseline = invoiceDraftSignature(); };
    const touch = (event: Event) => {
      // Backing inputs emit synthetic events during recalculation/reset. They
      // are not user edits and must not turn a freshly saved invoice dirty.
      if (event.target instanceof Element && event.target.getClientRects().length && event.target.closest('#page-home')) {
        if (!interacted) baseline = invoiceDraftSignature();
        interacted = true;
      }
    };
    const start = () => { saving.current = true; };
    const end = () => { saving.current = false; };
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest('#btnNewInvoice, .workspace-logout, .workspace-account') : null;
      if (!element || acceptingNew) return;
      if (!dirty() && !saving.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      ask(() => { acceptingNew = true; (element as HTMLElement).click(); acceptingNew = false; });
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty() || saving.current) { event.preventDefault(); event.returnValue = ''; } };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || document.body.classList.contains('pin-locked') || document.querySelector('dialog[open]')) return;
      if (event.key === 'F1') { event.preventDefault(); setShortcuts(true); return; }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (!['n', 's', 'f', 'p'].includes(key)) return;
      const invoice = document.getElementById('page-home')?.classList.contains('active');
      const clickButton = (id: string) => { const button = document.getElementById(id) as HTMLButtonElement | null; if (button && !button.disabled && button.getClientRects().length) button.click(); };
      if (key === 'n') {
        if (!document.getElementById('invoiceTab')) return;
        event.preventDefault(); clickButton('invoiceTab'); clickButton('btnNewInvoice');
      } else if (key === 's' && invoice) {
        event.preventDefault(); clickButton(window.vjInvoiceItems?.read().pending ? 'btnSavePendingOrder' : 'btnCompleteSale');
      } else if (key === 'p' && invoice) { event.preventDefault(); window.dispatchEvent(new Event('vj:print-invoice')); }
      else if (key === 'f') {
        const search = document.querySelector<HTMLInputElement>('.page.active input[type="search"], .page.active input[placeholder*="Search"], .page.active input[placeholder*="search"]');
        if (search) { event.preventDefault(); search.focus(); search.select(); }
      }
    };
    const help = () => setShortcuts(true);
    const lock = (event: Event) => {
      if (acceptingNew || (!dirty() && !saving.current)) return;
      event.stopImmediatePropagation();
      ask(() => { acceptingNew = true; window.dispatchEvent(new Event('vj:lock-workspace')); acceptingNew = false; });
    };
    const desktopCleanup = window.vjDesktop?.onCloseRequest(() => ask(() => window.vjDesktop?.confirmClose(), true));
    document.addEventListener('click', click, true); window.addEventListener('beforeunload', unload); window.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', touch, true); document.addEventListener('focusin', touch, true); document.addEventListener('input', touch, true);
    window.addEventListener('vj:invoice-details-sync', initialize); window.addEventListener('vj:invoice-items-sync', initialize); window.addEventListener('vj:lock-workspace', lock, true);
    window.addEventListener('vj:invoice-reset', reset); window.addEventListener('vj:invoice-save-start', start); window.addEventListener('vj:invoice-save-end', end); window.addEventListener('vj:shortcut-help', help);
    return () => { window.clearTimeout(resetTimer); desktopCleanup?.(); document.removeEventListener('click', click, true); document.removeEventListener('pointerdown', touch, true); document.removeEventListener('focusin', touch, true); document.removeEventListener('input', touch, true); window.removeEventListener('vj:invoice-details-sync', initialize); window.removeEventListener('vj:invoice-items-sync', initialize); window.removeEventListener('vj:lock-workspace', lock, true); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', keydown); window.removeEventListener('vj:invoice-reset', reset); window.removeEventListener('vj:invoice-save-start', start); window.removeEventListener('vj:invoice-save-end', end); window.removeEventListener('vj:shortcut-help', help); };
  }, []);
  return <><StatusBar />{confirmation && <Dialog title={confirmation.closing ? 'Close with unsaved invoice?' : 'Discard invoice draft?'} confirmLabel={confirmation.closing ? 'Discard and close' : 'Discard draft'} danger
    onClose={() => { pending.current = false; setConfirmation(undefined); }} onConfirm={() => { const action = confirmation.action; pending.current = false; setConfirmation(undefined); action(); }}><p>Your invoice has unsaved changes. Keep working to avoid losing them.</p></Dialog>}
    {shortcuts && <Dialog title="Keyboard shortcuts" onClose={() => setShortcuts(false)}><p>Use Ctrl on Windows or ⌘ on Mac.</p><dl className="shortcut-list"><dt>Ctrl / ⌘ + N</dt><dd>New invoice</dd><dt>Ctrl / ⌘ + S</dt><dd>Complete sale / save pending order</dd><dt>Ctrl / ⌘ + F</dt><dd>Search the current table</dd><dt>Ctrl / ⌘ + P</dt><dd>Print current invoice</dd><dt>F1</dt><dd>Show shortcuts</dd></dl><p>Saving uses the same validations and stock adjustments as the on-screen button.</p></Dialog>}</>;
}
