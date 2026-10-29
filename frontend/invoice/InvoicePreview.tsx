import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Select } from '../components/Select';
import { Dialog } from '../components/Dialog';
import { InvoicePaper } from './InvoicePaper';
import { downloadInvoicePdf, printInvoice } from '../../lib/invoice-output.mjs';
import type { InvoicePreviewSnapshot } from './preview-types';

export function InvoicePreview() {
  const [snapshot, setSnapshot] = useState<InvoicePreviewSnapshot | null>(() => window.vjInvoicePreviewSource?.read() || null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const openPreview = () => { if (!drawer.current?.open) drawer.current?.showModal(); };
  const paper = useRef<HTMLDivElement>(null);
  const exportingRef = useRef(false);
  const flush = () => { const next = window.vjInvoicePreviewSource?.read(); if (next) flushSync(() => setSnapshot(next)); };

  useEffect(() => {
    const sync = () => { const next = window.vjInvoicePreviewSource?.read(); if (next) setSnapshot(next); };
    const resetTax = () => window.vjInvoicePreviewSource?.tax('1.5');
    const start = () => setSaving(true);
    const end = () => setSaving(false);
    window.vjInvoicePreview = { flush };
    window.addEventListener('vj:invoice-preview-sync', sync);
    window.addEventListener('vj:invoice-payment-updated', sync);
    window.addEventListener('vj:invoice-reset', sync);
    window.addEventListener('vj:invoice-save-start', start);
    window.addEventListener('vj:invoice-save-end', end);
    document.getElementById('btnNewInvoice')?.addEventListener('click', resetTax);
    window.addEventListener('vj:open-invoice-preview', openPreview);
    sync();
    return () => {
      delete window.vjInvoicePreview;
      window.removeEventListener('vj:invoice-preview-sync', sync);
      window.removeEventListener('vj:invoice-payment-updated', sync);
      window.removeEventListener('vj:invoice-reset', sync);
      window.removeEventListener('vj:invoice-save-start', start);
      window.removeEventListener('vj:invoice-save-end', end);
      document.getElementById('btnNewInvoice')?.removeEventListener('click', resetTax);
      window.removeEventListener('vj:open-invoice-preview', openPreview);
    };
  }, []);

  const download = async () => {
    if (exportingRef.current || saving) return;
    exportingRef.current = true; setExporting(true);
    try {
      flush();
      openPreview();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const current = window.vjInvoicePreviewSource?.read();
      await downloadInvoicePdf(paper.current, current?.number || 'invoice', window.html2canvas, window.jspdf?.jsPDF);
      setMessage({ title: 'PDF downloaded', text: 'Your invoice PDF is ready.' });
    } catch (_) { setMessage({ title: 'Could not generate PDF', text: 'Please try Print Invoice instead.' }); }
    finally { exportingRef.current = false; setExporting(false); }
  };
  const taxTarget = document.getElementById('react-invoice-tax');
  const termsTarget = document.getElementById('react-invoice-terms');
  const printTarget = document.getElementById('react-invoice-print-action');
  const pdfTarget = document.getElementById('react-invoice-pdf-action');
  const previewTarget = document.getElementById('react-invoice-preview-action');
  const busy = saving || exporting;

  return <>
    {createPortal(<dialog ref={drawer} className="invoice-preview-drawer" aria-label="Live invoice preview" onClick={event => { if (event.target === drawer.current) drawer.current.close(); }}>
      <div className="invoice-preview-heading"><div><h3>Live invoice preview</h3><span>Updates as you enter details</span></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => drawer.current?.close()}>Close preview</button></div>
      <div className="btn-row preview-output-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => printInvoice(flush, () => window.print())}>Print Invoice</button><button type="button" className="btn btn-gold btn-sm" disabled={busy} onClick={() => { void download(); }}>{exporting ? 'Preparing…' : 'Download PDF'}</button></div>
      {snapshot ? <InvoicePaper snapshot={snapshot} paperRef={paper} /> : <p role="status">Loading invoice preview…</p>}
    </dialog>, document.body)}
    {previewTarget && createPortal(<button type="button" className="btn btn-ghost btn-sm" onClick={openPreview}>Preview invoice ↗</button>, previewTarget)}
    {snapshot && taxTarget && createPortal(<div className="field"><label>Tax treatment</label><Select label="Tax treatment"
      value={snapshot.taxValue === '0' ? 'Non-GST Invoice — No GST charged' : 'GST Invoice — 3% (CGST + SGST)'}
      options={['GST Invoice — 3% (CGST + SGST)', 'Non-GST Invoice — No GST charged']} disabled={busy}
      onChange={value => window.vjInvoicePreviewSource?.tax(value.startsWith('Non-GST') ? '0' : '1.5')} /></div>, taxTarget)}
    {snapshot && termsTarget && createPortal(<div className="panel"><h3><span className="dot" />Terms &amp; Conditions</h3>
      <textarea id="react-inv-terms" aria-label="Terms & Conditions" value={snapshot.terms} style={{ minHeight: 70 }} disabled={busy}
        onChange={event => window.vjInvoicePreviewSource?.terms(event.currentTarget.value)} /></div>, termsTarget)}
    {printTarget && createPortal(<button id="btnPrint" type="button" className="btn btn-ghost" disabled={busy}
      onClick={() => { try { openPreview(); printInvoice(flush, () => window.print()); } catch (_) { setMessage({ title: 'Could not print', text: 'Please try opening the print dialog again.' }); } }}>🖨 Print Invoice</button>, printTarget)}
    {pdfTarget && createPortal(<button id="btnPdf" type="button" className="btn btn-ghost" disabled={busy} onClick={() => { void download(); }}>{exporting ? 'Preparing PDF…' : '⬇ Download PDF'}</button>, pdfTarget)}
    {message && <Dialog title={message.title} onClose={() => setMessage(null)}><p>{message.text}</p></Dialog>}
  </>;
}
