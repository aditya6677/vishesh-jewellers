import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { PolicyReader } from '../legal/PolicyReader';
import { legalStatus, type LegalDocument } from '../legal/legal-api';
type Plan = { state: string; plan?: string; installationId?: string; daysRemaining?: number | null; expiresAt?: string | null; invoiceLimit?: number | null; invoicesIssued?: number; activationConfigured?: boolean; message: string };
export function LicensePlan() {
  const [plan, setPlan] = useState<Plan>(), [token, setToken] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [review, setReview] = useState<Plan>(), [reading, setReading] = useState<LegalDocument>();
  async function policy(id: string) {
    try { setReading((await legalStatus()).documents.find(document => document.id === id)); }
    catch(error) { setNotice((error as Error).message); }
  }
  async function activate() {
    if(busy) return;
    setBusy(true);
    try {
      const response=await fetch('/api/license/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
      const value=await response.json();
      if(!response.ok) throw Error(value.error||'Activation failed.');
      setReview(undefined); setToken(''); await refresh(); window.dispatchEvent(new Event('vj:license-refresh')); setNotice('Paid activation saved. Your existing records are preserved.');
    } catch(error) { setReview(undefined); setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function refresh() { const response = await fetch('/api/license'); const value = await response.json() as Plan; if (response.ok) setPlan(value); }
  useEffect(() => { void refresh().catch(error => setNotice((error as Error).message)); }, []);
  if (!plan || plan.state === 'disabled') return null;
  const canActivate = ['superadmin', 'owner'].includes(window.vjAccountSession?.user.role || '');
  return <div className="panel" style={{ marginBottom: 18 }}><h3><span className="dot" />Plan &amp; Activation</h3><div className="record-info-grid"><div className="record-info"><b>Current plan</b><span>{plan.plan || plan.state}</span></div><div className="record-info"><b>Time remaining</b><span>{plan.daysRemaining === null ? 'No expiry' : plan.daysRemaining === undefined ? '—' : plan.daysRemaining + ' days'}</span></div><div className="record-info"><b>Invoices issued</b><span>{plan.invoicesIssued ?? 0}{plan.invoiceLimit ? ' / ' + plan.invoiceLimit : ' · Unlimited allowance'}</span></div><div className="record-info"><b>Valid until</b><span>{plan.expiresAt ? new Date(plan.expiresAt).toLocaleString() : '—'}</span></div></div><p className="sub">{plan.message}</p><div className="field"><label htmlFor="license-store-id">Store activation ID</label><input id="license-store-id" type="text" readOnly value={plan.installationId || ''} /></div><p className="sub">Contact the team that supplied this app and share the activation ID to obtain a paid activation. Your records remain accessible after expiry.</p>
    {canActivate && <form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); void fetch('/api/license/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Activation verification failed.'); setReview(value); }).catch(error => setNotice((error as Error).message)).finally(() => setBusy(false)); }}><div className="field"><label htmlFor="license-token">Vendor-issued activation</label><textarea id="license-token" value={token} onChange={event => setToken(event.target.value)} disabled={busy || !plan.activationConfigured} placeholder="Paste your signed activation here" /></div><div className="btn-row"><button type="submit" className="btn btn-gold" disabled={busy || !token.trim() || !plan.activationConfigured}>{busy ? 'Verifying…' : 'Review Paid Activation'}</button><button type="button" className="btn btn-ghost" onClick={() => { void refresh(); }}>Refresh Plan</button></div>{!plan.activationConfigured && <p className="sub">Paid activation requires the vendor verification key in this build. Contact your software provider.</p>}</form>}
    {notice && <Dialog title="Plan activation" onClose={() => setNotice('')}><p>{notice}</p></Dialog>}
    {review && <Dialog title="Review paid activation" onClose={() => setReview(undefined)} onConfirm={() => { void activate(); }} confirmLabel="Confirm activation" busy={busy}><p>This signed activation is valid for this store. Activating keeps your existing records.</p><dl><dt>Plan</dt><dd>{review.plan}</dd><dt>Valid until</dt><dd>{review.expiresAt ? new Date(review.expiresAt).toLocaleString() : 'No expiry'}</dd><dt>Invoice allowance</dt><dd>{review.invoiceLimit ?? 'Unlimited'}</dd></dl><p className="sub">Confirm the price and scope with Tech Aditya before paying. This screen activates a vendor-issued licence; it does not take a payment.</p><div className="btn-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { void policy('licence'); }}>Read licence</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { void policy('refunds'); }}>Trial &amp; refund policy</button></div></Dialog>}
    {reading && <PolicyReader document={reading} close={() => setReading(undefined)} />}
  </div>;
}
