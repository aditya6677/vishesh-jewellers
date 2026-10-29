import { useEffect, useState } from 'react';
import { legalStatus, type LegalDocument, type LegalStatus } from './legal-api';
import { PolicyReader } from './PolicyReader';

export function LegalSupport() {
  const [status, setStatus] = useState<LegalStatus>();
  const [error, setError] = useState('');
  const [reading, setReading] = useState<LegalDocument>();
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void legalStatus(controller.signal).then(value => { setStatus(value); setError(''); }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); }); };
    refresh(); window.addEventListener('vj:legal-refresh', refresh); window.addEventListener('vj:settings-refresh', refresh);
    return () => { controller.abort(); window.removeEventListener('vj:legal-refresh', refresh); window.removeEventListener('vj:settings-refresh', refresh); };
  }, []);
  return <section className="panel legal-support" aria-label="Legal and Support">
    <div className="legal-section-header"><div><span className="legal-eyebrow">KARATDESK BY TECH ADITYA</span><h3>Legal &amp; Support</h3><p>Clear terms. Thoughtful protection. Always available offline.</p></div><span className="legal-offline-badge">Offline documents</span></div>
    {error && <p role="alert" className="due-amount">{error}</p>}
    {!status && !error && <p role="status">Loading your legal documents…</p>}
    <div className="legal-document-grid">{status?.documents.map(policy => <button key={policy.id} type="button" className="legal-document-card" onClick={() => setReading(policy)}>
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></svg><span><strong>{policy.title}</strong><small>Read offline ↗</small></span>
    </button>)}</div>
    {status && <div className={'legal-acceptance-record' + (status.accepted ? ' is-accepted' : '')}>
      <div><span className="legal-eyebrow">STORE LICENCE ACCEPTANCE</span><strong>{status.accepted ? 'Accepted & recorded locally' : status.enabled ? 'Administrator review required' : 'Legacy installation'}</strong></div>
      {status.acceptance ? <dl><div><dt>Accepted by</dt><dd>{status.acceptance.name} · {status.acceptance.username}</dd></div><div><dt>Date</dt><dd>{new Date(status.acceptance.acceptedAt).toLocaleString()}</dd></div><div><dt>Policy version</dt><dd>{status.acceptance.policyVersion}</dd></div><div><dt>Recorded in app</dt><dd>v{status.acceptance.appVersion}</dd></div></dl> : <p>{status.enabled ? 'An Owner or Superadmin can review and accept the current licence. Existing records, exports and backups remain accessible.' : 'Recording administrator acceptance requires username/password accounts and the encrypted database. These documents are still available to read.'}</p>}
      {status.enabled && !status.accepted && <button type="button" className="btn btn-gold btn-sm" onClick={() => window.dispatchEvent(new Event('vj:legal-review'))}>Review licence</button>}
    </div>}
    {status && <div className="legal-business-contact"><div><strong>{status.business.name}</strong><span>{status.business.address}</span></div><a className="btn btn-ghost btn-sm" href={'mailto:' + status.business.email + '?subject=KaratDesk%20support'}>{status.business.email} ↗</a></div>}
    <p className="legal-privacy-note">Licence acceptance is stored in your encrypted local database. It is not consent to optional marketing or unrelated data use. Never send passwords, encryption keys or recovery passphrases to support.</p>
    {reading && <PolicyReader document={reading} close={() => setReading(undefined)} />}
  </section>;
}
