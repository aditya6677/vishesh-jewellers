import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { acceptLegal, legalStatus, type LegalDocument, type LegalStatus } from './legal-api';
import { LegalSupport } from './LegalSupport';
import { PolicyReader } from './PolicyReader';

export function LegalGate() {
  const [status, setStatus] = useState<LegalStatus>();
  const [review, setReview] = useState(false), [centre, setCentre] = useState(false), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reading, setReading] = useState<LegalDocument>();
  const dialog = useRef<HTMLDialogElement>(null), support = useRef<HTMLDialogElement>(null);
  const prompted = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void legalStatus(controller.signal).then(value => {
      setStatus(value);
      if (value.accepted) { setReview(false); setError(''); }
      else if (value.enabled && !prompted.current) { prompted.current = true; setChecked(false); setReview(true); }
    }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); }); };
    const open = () => setCentre(true);
    const request = () => { setCentre(false); setChecked(false); setReview(true); refresh(); };
    refresh(); window.addEventListener('vj:legal-refresh', refresh); window.addEventListener('vj:legal-open', open); window.addEventListener('vj:legal-review', request);
    return () => { controller.abort(); window.removeEventListener('vj:legal-refresh', refresh); window.removeEventListener('vj:legal-open', open); window.removeEventListener('vj:legal-review', request); };
  }, []);
  useEffect(() => { if (review) dialog.current?.showModal(); else dialog.current?.close(); }, [review]);
  useEffect(() => { if (centre) support.current?.showModal(); else support.current?.close(); }, [centre]);
  async function accept() {
    if (!status || !checked || busy || !status.canAccept) return;
    setBusy(true); setError('');
    try { setStatus(await acceptLegal(status)); setReview(false); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const footer = document.querySelector('.app-footer');
  const pending = status?.enabled && !status.accepted;
  return <>
    {footer && createPortal(<button type="button" className="footer-legal-button" aria-label="Legal & Support" title="Legal & Support" onClick={() => setCentre(true)}>◇ <span>Legal &amp; Support</span></button>, footer)}
    {pending && createPortal(<aside className="legal-pending-banner" role="status"><span>Licence review required · Existing records and backups remain accessible.</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setChecked(false); setReview(true); }}>Review</button></aside>, document.querySelector('main') || document.body)}
    {createPortal(<dialog ref={dialog} className="modal legal-review" aria-labelledby="legal-review-title" onCancel={event => { event.preventDefault(); if (!busy) setReview(false); }}>
      <div className="legal-review-mark" aria-hidden="true">◇</div><span className="legal-eyebrow">KARATDESK BY TECH ADITYA</span><h2 id="legal-review-title">A clear agreement.<br />A confident start.</h2>
      <p>Review the software licence for this store. Your accounts, invoices and business records will not be reset.</p>
      <div className="legal-review-documents">{status?.documents.map(policy => <button key={policy.id} type="button" className="btn btn-ghost btn-sm" onClick={() => setReading(policy)}>{policy.title} ↗</button>)}</div>
      {status?.canAccept ? <label className="legal-consent"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.currentTarget.checked)} /><span>I am authorised to act for this store and agree to the <strong>Software Licence and Terms of Use</strong>, version {status.version}.</span></label> : <p className="legal-role-note">An Owner or Superadmin must accept on behalf of the store. You can continue with read-only access and ask an administrator to review.</p>}
      <p className="legal-privacy-note">Privacy and refund notices are separate information—not blanket consent to optional data use. Acceptance records your administrator identity, policy version and date in the encrypted database.</p>
      {error && <p className="due-amount" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setReview(false)}>Continue read-only</button>{status?.canAccept && <button type="button" className="btn btn-gold" disabled={!checked || busy} onClick={() => { void accept(); }}>{busy ? 'Recording acceptance…' : 'Agree & continue'}</button>}</div>
    </dialog>, document.body)}
    {createPortal(<dialog ref={support} className="modal legal-centre" aria-label="Legal and Support" onCancel={event => { event.preventDefault(); setCentre(false); }}><div className="legal-centre-close"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCentre(false)}>Close</button></div>{centre && <LegalSupport />}</dialog>, document.body)}
    {reading && <PolicyReader document={reading} close={() => setReading(undefined)} />}
  </>;
}
