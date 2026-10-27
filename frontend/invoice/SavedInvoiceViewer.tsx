import { useEffect, useRef, useState } from 'react';
import { recordsApi } from '../api';
import { Dialog } from '../components/Dialog';
import { downloadInvoicePdf } from '../../lib/invoice-output.mjs';
import { savedInvoiceMarkup } from './saved-invoice';
import type {} from './preview-types';

declare global { interface Window { vjSavedInvoiceOpen: (number: string, version?: string) => Promise<void> } }

export function SavedInvoiceViewer() {
  const [invoice, setInvoice] = useState<{ number: string; markup: string }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), content = useRef<HTMLDivElement>(null), exporting = useRef(false);
  useEffect(() => {
    let generation = 0;
    window.vjSavedInvoiceOpen = async (number, version) => {
      if (exporting.current) return;
      const current = ++generation;
      try {
        const { record } = await recordsApi.get(number, version);
        if (current === generation) setInvoice({ number, markup: savedInvoiceMarkup(record) });
      } catch (error) { if (current === generation) setMessage((error as Error).message); }
    };
    return () => { generation++; };
  }, []);
  useEffect(() => { if (invoice) dialog.current?.showModal(); }, [invoice]);
  const close = () => { if (!exporting.current) { dialog.current?.close(); setInvoice(undefined); } };
  function print() {
    const popup = window.open('', '_blank');
    if (!popup) { setMessage('Please allow pop-ups to print the invoice.'); return; }
    popup.document.title = 'Invoice ' + invoice!.number;
    for (const node of document.querySelectorAll('style,link[rel="stylesheet"]')) popup.document.head.append(node.cloneNode(true));
    popup.document.body.style.cssText = 'background:white;padding:24px;';
    popup.document.body.innerHTML = invoice!.markup;
    popup.document.close();
    // Keep the print-ready window open, matching the original saved-invoice flow.
  }
  async function download() {
    if (exporting.current || !invoice) return;
    exporting.current = true; setBusy(true);
    try { await downloadInvoicePdf(content.current?.querySelector<HTMLElement>('#invoicePaper') || null, invoice.number, window.html2canvas, window.jspdf?.jsPDF); }
    catch (_) { setMessage('Could not generate the PDF. Please try Print Invoice instead.'); }
    finally { exporting.current = false; setBusy(false); }
  }
  return <>
    {invoice && <dialog ref={dialog} className="modal react-dialog saved-invoice-dialog" style={{ maxWidth: 900, maxHeight: '92vh', overflow: 'auto' }} aria-label={'Invoice ' + invoice.number} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="toolbar"><h3 style={{ margin: 0 }}>Invoice {invoice.number}</h3><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={close}>Close</button></div>
      <div className="btn-row" style={{ marginBottom: 16 }}><button type="button" className="btn btn-gold btn-sm" disabled={busy} onClick={print}>🖨 Print Invoice</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void download(); }}>{busy ? 'Preparing PDF…' : '⬇ Download PDF'}</button></div>
      <div className="paper-outer" style={{ position: 'static' }} ref={content} dangerouslySetInnerHTML={{ __html: invoice.markup }} />
    </dialog>}
    {message && <Dialog title="Invoice preview" onClose={() => setMessage('')}><p>{message}</p></Dialog>}
  </>;
}
