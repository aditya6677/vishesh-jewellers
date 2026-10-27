import { useEffect, useRef, useState } from 'react';
import { recordsApi } from '../api';
import { Dialog } from '../components/Dialog';
import type { InvoiceRecord } from '../types';

declare global { interface Window { vjInvoiceVoidOpen: (number: string, version?: string) => Promise<void> } }

export function InvoiceVoid() {
  const [session, setSession] = useState<{ record: InvoiceRecord; version: string }>();
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string }>();
  const lock = useRef(false);
  useEffect(() => {
    let generation = 0;
    window.vjInvoiceVoidOpen = async (number, version) => {
      if (lock.current) return;
      const current = ++generation;
      try {
        const saved = await recordsApi.get(number, version);
        if (current !== generation) return;
        if (saved.record.status === 'voided') throw new Error('This invoice has already been voided.');
        setReason(''); setSession(saved);
      } catch (error) { if (current === generation) setMessage({ title: 'Could not open invoice', text: (error as Error).message }); }
    };
    return () => { generation++; };
  }, []);
  async function confirm() {
    if (!session || lock.current) return;
    if (!reason.trim()) { setMessage({ title: 'Reason required', text: 'Enter a reason before voiding this invoice.' }); return; }
    lock.current = true; setBusy(true);
    try {
      await recordsApi.void(session.record.number, session.version, reason);
      setSession(undefined);
      for (const event of ['vj:records-refresh', 'vj:record-stock-refresh', 'vj:transactions-updated']) window.dispatchEvent(new Event(event));
      setMessage({ title: session.record.status === 'pending' ? 'Order cancelled' : 'Invoice voided', text: session.record.number + ' was voided. Its stock and accounting effects have been reversed, and the original record remains available for viewing.' });
    } catch (error) { setMessage({ title: 'Invoice was not voided', text: (error as Error).message }); }
    finally { lock.current = false; setBusy(false); }
  }
  const pending = session?.record.status === 'pending';
  return <>
    {session && <Dialog title={pending ? 'Cancel pending order?' : 'Void invoice?'} confirmLabel={pending ? 'Cancel order' : 'Void invoice'} danger busy={busy} onClose={() => setSession(undefined)} onConfirm={() => { void confirm(); }}>
      <p><strong>{session.record.number}</strong>{pending ? ' will be cancelled. No sold stock will be restored for an undelivered order.' : ' will be marked void and its sold stock restored.'} Linked old-metal movements will be reversed and the invoice excluded from active financial totals. The invoice and payment history remain for audit. This cannot be undone from the app.</p>
      <div className="field"><label htmlFor="invoice-void-reason">Reason for voiding *</label><textarea id="invoice-void-reason" aria-required="true" required maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.currentTarget.value)} placeholder="e.g. Sale cancelled by customer" /></div>
    </Dialog>}
    {message && <Dialog title={message.title} onClose={() => setMessage(undefined)}><p>{message.text}</p></Dialog>}
  </>;
}
