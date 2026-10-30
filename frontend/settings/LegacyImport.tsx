import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { money } from '../components/Metric';
type Preview = { token: string; storeName: string; counts: Record<string, number>; warnings: { collection: string; code: string }[]; ignoredKeys: string[]; nextInvoice: string; summary: { summary: { sales: number; collected: number; due: number }; fresh: Record<string, number> } };
async function request<T>(action: string, input?: unknown): Promise<T> {
  const response = await fetch('/api/legacy-import/' + action, { method: input === undefined ? 'GET' : 'POST', headers: input === undefined ? {} : { 'content-type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(120000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Legacy import failed.');
  return result;
}
export function LegacyImport() {
  const [status, setStatus] = useState<{ available: boolean; reason?: string }>();
  const [preview, setPreview] = useState<Preview>();
  const [file, setFile] = useState<File>();
  const [phrase, setPhrase] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; text: string; reload?: boolean }>();
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const allowed = !window.vjAccountSession || window.vjAccountSession.permissions.includes('settings.restore');
  const native = typeof window.vjDesktop?.legacySource === 'function';
  useEffect(() => { if (allowed) void request<{ available: boolean; reason?: string }>('status').then(setStatus).catch(error => setStatus({ available: false, reason: error.message })); }, [allowed]);
  if (!allowed) return null;
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); } catch (error) { setNotice({ title: 'Import could not continue', text: (error as Error).message }); }
    finally { setBusy(false); lock.current = false; setPhrase(''); setConfirmPhrase(''); }
  };
  const selectNative = () => run(async () => {
    const result = await window.vjDesktop!.legacySource({});
    if (result.error) throw new Error(result.error);
    if (result.snapshot) setPreview(await request<Preview>('preview', { snapshot: result.snapshot }));
  });
  return <div className="panel" style={{ marginTop: 18 }}>
    <h3><span className="dot" />Import from Older App</h3>
    <p className="sub">Move encrypted data from an older app version into an empty KaratDesk store. Preview first; original files are never changed. Accounts, roles and licensing stay separate.</p>
    {!status ? <p role="status">Checking migration availability…</p> : !status.available && <p className="sub">{status.reason}</p>}
    <div className="btn-row">
      <button className="btn btn-gold" disabled={busy || !status?.available || !native} onClick={() => { void selectNative(); }}>Select Older Data…</button>
      <button className="btn btn-ghost" disabled={busy || !status?.available} onClick={() => input.current?.click()}>Open Portable Legacy File…</button>
      {native && <button className="btn btn-ghost" disabled={busy} onClick={() => setExporting(true)}>Create Portable Legacy File…</button>}
    </div>
    <p className="sub">Original desktop backups need their matching key and OS account. For another computer, create a portable legacy file on the original computer first. Native file selection requires the updated desktop app. Maximum file size: 24 MB.</p>
    <input ref={input} type="file" accept=".json,application/json" aria-label="Select portable legacy data" hidden onChange={event => { const chosen = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (chosen) { if (chosen.size > 24_000_000) setNotice({ title: 'File too large', text: 'Maximum legacy file size is 24 MB.' }); else setFile(chosen); } }} />
    {(file || exporting) && <Dialog title={exporting ? 'Protect Portable Legacy Data' : 'Unlock Portable Legacy Data'} busy={busy} confirmLabel={exporting ? 'Select Old Data & Export' : 'Preview Import'} onClose={() => { if (!busy) { setFile(undefined); setExporting(false); setPhrase(''); setConfirmPhrase(''); } }} onConfirm={() => { void run(async () => {
      if (exporting) {
        if (phrase.length < 12 || phrase !== confirmPhrase) throw new Error('Use at least 12 characters and confirm the same passphrase.');
        const result = await window.vjDesktop!.legacySource({ portable: true, passphrase: phrase });
        if (result.error) throw new Error(result.error);
        if (result.saved) { setExporting(false); setNotice({ title: 'Portable file saved', text: 'Copy this encrypted file to the destination computer. Keep its passphrase separately; it is required for import.' }); }
      } else if (file) {
        const value = JSON.parse(await file.text());
        if (value.format !== 'karatdesk-legacy-portable-v1') throw new Error('This is not a portable legacy file. Open the original encrypted JSON using Select Older Data in the desktop app.');
        setPreview(await request<Preview>('preview', { portable: value, passphrase: phrase })); setFile(undefined);
      }
    }); }}>
      <p>{exporting ? 'Choose a strong passphrase for use on the destination computer. It cannot be recovered by the app.' : file?.name}</p>
      <div className="field"><label htmlFor="legacy-import-passphrase">Recovery passphrase</label><input id="legacy-import-passphrase" type="password" autoComplete="off" value={phrase} onChange={event => setPhrase(event.target.value)} disabled={busy} /></div>
      {exporting && <div className="field"><label htmlFor="legacy-import-passphrase-confirm">Confirm passphrase</label><input id="legacy-import-passphrase-confirm" type="password" autoComplete="off" value={confirmPhrase} onChange={event => setConfirmPhrase(event.target.value)} disabled={busy} /></div>}
    </Dialog>}
    {preview && <Dialog title="Review Older Store Data" confirmLabel="Import Business Data" busy={busy} onClose={() => { if (!busy) { setPreview(undefined); setConfirmation(''); setAcknowledged(false); } }} onConfirm={() => { void run(async () => {
      const result = await request<{ verified: boolean; counts: Record<string, number>; nextInvoice: string; safetyBackup: string }>('commit', { token: preview.token, confirmation, acknowledgeLegacy: acknowledged });
      setPreview(undefined); setConfirmation(''); setAcknowledged(false);
      setNotice({ title: 'Import verified', text: `Business records and dashboard totals matched. Imported ${result.counts['invoice-records'] || 0} invoices, ${result.counts['stock-list'] || 0} stocks, ${result.counts['purchase-records'] || 0} purchases and ${result.counts['payment-records'] || 0} payments. Next invoice: ${result.nextInvoice}. Safety backup: ${result.safetyBackup}. Close this message to reload the app.`, reload: true });
    }); }}>
      <p><strong>{preview.storeName}</strong> · preview expires after 10 minutes</p>
      <div className="record-info-grid">{Object.entries(preview.counts).map(([label, count]) => <div className="record-info" key={label}><b>{label.replace(/-/g, ' ')}</b><span>{count}</span></div>)}</div>
      <div className="record-info-grid"><div className="record-info"><b>Invoice sales</b><span>{money(preview.summary.summary.sales)}</span></div><div className="record-info"><b>Cash collected</b><span>{money(preview.summary.summary.collected)}</span></div><div className="record-info"><b>Due / advance balance</b><span>{money(preview.summary.summary.due)}</span></div><div className="record-info"><b>Next invoice</b><span>{preview.nextInvoice}</span></div></div>
      <div className="record-info-grid">{Object.entries(preview.summary.fresh).map(([metal, weight]) => <div className="record-info" key={metal}><b>{metal === 'fineGold' ? 'Fine Gold' : metal} stock remaining</b><span>{weight.toFixed(3)} g</span></div>)}</div>
      {preview.warnings.length > 0 && <><p className="sub">{preview.warnings.length} historical-format warnings. Existing amounts and weight conventions will be preserved, not recalculated.</p><ul>{preview.warnings.slice(0, 5).map((warning, index) => <li key={index}>{warning.collection}: {warning.code.replace(/-/g, ' ')}</li>)}</ul></>}
      {preview.ignoredKeys.length > 0 && <p className="sub">Excluded non-business settings: {preview.ignoredKeys.join(', ')}</p>}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginTop: 4 }} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} /> I reviewed the totals and agree to preserve historical records. A safety backup is created first.</label>
      <div className="field"><label htmlFor="legacy-import-confirmation">Type IMPORT to confirm</label><input id="legacy-import-confirmation" type="text" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></div>
    </Dialog>}
    {notice && <Dialog title={notice.title} onClose={() => { if (notice.reload) window.location.reload(); else setNotice(undefined); }}><p>{notice.text}</p></Dialog>}
  </div>;
}
