import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { invoiceSuccessMessage, type InvoiceSuccessMessage } from '../../lib/invoice-success.mjs';

export function InvoiceSuccess() {
  const [message, setMessage] = useState<InvoiceSuccessMessage | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), opening = useRef(false);
  useEffect(() => {
    const saved = (event: Event) => { const next = invoiceSuccessMessage((event as CustomEvent<unknown>).detail); if (next) setMessage(next); };
    window.addEventListener('vj:invoice-saved', saved);
    return () => window.removeEventListener('vj:invoice-saved', saved);
  }, []);
  useEffect(() => { if (message) dialog.current?.showModal(); return () => dialog.current?.close(); }, [message]);
  async function view() {
    if (!message || opening.current) return;
    opening.current = true;
    const number = message.number;
    dialog.current?.close(); setMessage(null);
    try { await window.vjSavedInvoiceOpen(number); }
    catch (_) { setError('The invoice was saved. Open Records to view it.'); }
    finally { opening.current = false; }
  }
  return <>
    {message && <dialog ref={dialog} className="modal react-dialog invoice-success-dialog" aria-label={message.title} onCancel={event => { event.preventDefault(); setMessage(null); }}>
      <div className="invoice-success-icon" aria-hidden="true">✓</div>
      <h3 style={{ margin: 0 }}>{message.title}</h3><p className="void-modal-note">{message.note}</p>
      <div className="invoice-success-number">{message.number}</div>
      <div className="btn-row" style={{ marginTop: 18, justifyContent: 'center' }}>
        <button type="button" className="btn btn-gold" onClick={() => { void view(); }}>{message.viewLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setMessage(null)} autoFocus>Done</button>
      </div>
    </dialog>}
    {error && <Dialog title="Invoice saved" onClose={() => setError('')}><p>{error}</p></Dialog>}
  </>;
}
