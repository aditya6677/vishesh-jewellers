import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsApi, type DataLocation } from '../api';
import { Dialog } from '../components/Dialog';
import { DatabaseBackups } from './DatabaseBackups';
import { StoreBranding } from './StoreBranding';
import { LicensePlan } from './LicensePlan';
import { LegalSupport } from '../legal/LegalSupport';

type Action = 'backup' | 'export' | 'folder' | 'restore';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function Settings() {
  const [location, setLocation] = useState<DataLocation>();
  const [latest, setLatest] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Action>();
  const [confirmation, setConfirmation] = useState<'folder' | 'restore'>();
  const [selectedFile, setSelectedFile] = useState<File>();
  const [message, setMessage] = useState<{ title: string; text: string; reload?: boolean }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const [nextLocation, backup] = await Promise.all([settingsApi.location(controller.signal), settingsApi.backups(controller.signal)]);
      if (!controller.signal.aborted) { setLocation(nextLocation); setLatest(backup.latest); setLoadError(''); }
    } catch (error) { if (!controller.signal.aborted) setLoadError((error as Error).message); }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('vj:settings-refresh', refresh);
    return () => { request.current?.abort(); window.removeEventListener('vj:settings-refresh', refresh); };
  }, [reload]);

  async function run(action: Action) {
    if (lock.current || !location) return;
    lock.current = true; setBusy(action);
    try {
      if (action === 'folder') {
        await settingsApi.action('/api/data-location');
        setMessage({ title: 'Choose Data Folder', text: 'Choose a folder in the desktop dialog. The app copies your data and restarts after confirmation. The old folder is retained.' });
      } else if (action === 'export' || (action === 'backup' && !location.desktop)) {
        const excel = action === 'export';
        const blob = await settingsApi.download(excel ? '/api/export.xlsx' : '/api/backup/download');
        download(blob, 'Vishesh-Jewellers-' + (excel ? 'Data-' : 'Backup-') + new Date().toISOString().slice(0, 10) + (excel ? '.xlsx' : '.json'));
        setMessage({ title: excel ? 'Excel export ready' : 'Encrypted backup ready', text: excel ? 'The download has started. This workbook contains unencrypted customer and business data; store it securely.' : 'The download has started. Keep the original data folder and its matching encryption key so this backup can be restored.' });
      } else if (action === 'backup') {
        await settingsApi.action('/api/backup/create');
        setMessage({ title: 'Save encrypted backup', text: 'Choose a destination in the desktop save dialog. The desktop app will confirm when the backup has been saved.' });
      } else if (location.desktop) {
        await settingsApi.action('/api/backup/restore');
        setMessage({ title: 'Choose a backup', text: 'Select the backup in the desktop dialog. Current data will be backed up before restoration. Follow the desktop confirmation to finish.' });
      } else {
        if (!selectedFile) throw new Error('Select an encrypted JSON backup first.');
        if (selectedFile.size > 50_000_000) throw new Error('Backup file is too large (maximum 50 MB).');
        let payload: unknown;
        try { payload = JSON.parse(await selectedFile.text()); } catch { throw new Error('This file is not valid JSON. Select an app backup file.'); }
        await settingsApi.action('/api/backup/restore', payload);
        setMessage({ title: 'Backup restored', text: 'Your data has been restored. Close this message to reload the app with the recovered records.', reload: true });
      }
    } catch (error) { setMessage({ title: 'Action could not be completed', text: (error as Error).message || 'Please refresh Settings and try again.' }); }
    finally { lock.current = false; setBusy(undefined); setConfirmation(undefined); setSelectedFile(undefined); }
  }

  const disabled = Boolean(busy) || !location || Boolean(message?.reload);
  return <>
    <div className="page-head"><p className="eyebrow">Application settings</p><h2>Settings</h2><p className="sub">Manage encrypted data, backups, and readable reports.</p></div>
    {loadError && <p className="due-amount" role="alert">{loadError}</p>}
    {window.vjAccountSession && <LicensePlan />}
    {(!window.vjAccountSession || window.vjAccountSession.user.role === 'superadmin') && <StoreBranding />}
    <div className="panel"><h3><span className="dot" />Data Location</h3>
      <div className="record-info-grid" style={{ marginBottom: 18 }}><div className="record-info"><b>Current folder</b><span style={{ overflowWrap: 'anywhere' }}>{location?.path || (loadError ? 'Unavailable' : 'Loading…')}</span></div><div className="record-info"><b>Protection</b><span className="paid-amount">AES-256 encrypted</span></div></div>
      <p className="sub">{window.vjDatabaseMode ? 'Database folder changes are disabled during this preview. Backups and restore do not change the configured data location.' : 'The desktop app copies existing data to the selected folder, then restarts. The old folder is not deleted.'}</p>
      <div className="btn-row"><button className="btn btn-gold" disabled={disabled || !location?.desktop || window.vjDatabaseMode} onClick={() => setConfirmation('folder')}>Choose Data Folder</button><button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { void reload(); }}>Refresh Settings</button></div>
      {location && !location.desktop && !window.vjDatabaseMode && <p className="sub">Changing the data folder is available in the desktop app.</p>}
    </div>
    <div className="panel" style={{ marginTop: 18 }}><h3><span className="dot" />Encrypted Backups</h3>
      {window.vjDatabaseMode ? <DatabaseBackups /> : <>
      <p className="sub">A backup is created automatically once per week when the {location?.desktop ? 'desktop app' : 'local server'} starts. You can also create one manually or restore a previous backup.</p>
      <p className="sub">{location?.desktop ? 'Backups include a key protected by this computer’s secure storage. Restore is intended for the same computer and OS account.' : 'Restore requires the matching app data key. Keep the original data folder and its key file together; the encrypted JSON file alone is not enough.'}</p>
      <p className="sub" style={{ overflowWrap: 'anywhere' }}>{latest ? 'Latest backup: ' + latest : location ? 'No saved backup has been found.' : 'Loading backup status…'}</p>
      </>}
      {!window.vjDatabaseMode && <div className="btn-row"><button className="btn btn-gold" disabled={disabled} onClick={() => { void run('backup'); }}>{busy === 'backup' ? 'Preparing backup…' : location?.desktop ? 'Create Backup Now' : 'Download Encrypted Backup'}</button>
        <button className="btn" disabled={disabled} onClick={() => location?.desktop ? setConfirmation('restore') : fileInput.current?.click()}>Restore Backup…</button></div>}
      <input ref={fileInput} type="file" accept="application/json,.json" aria-label="Select encrypted backup" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) { setSelectedFile(file); setConfirmation('restore'); } }} />
    </div>
    <div className="panel" style={{ marginTop: 18 }}><h3><span className="dot" />Export All Data</h3>
      <p className="sub">Download a readable Excel workbook with a Business Snapshot dashboard and separate sheets for invoices, items, exchanges, settlements, returns, stock, purchases, payments, the old-metal ledger, and a complete saved-data reference.</p>
      <p className="sub">The Excel file is not encrypted and contains customer details. Store it securely.</p>
      {window.vjDatabaseMode && <p className="sub">SQLite preview Excel exports are limited to 10,000 rows / 25 MB. For a larger invoice report, use the streaming CSV export in Records.</p>}
      <button data-permission="settings.export" className="btn btn-gold" disabled={disabled} onClick={() => { void run('export'); }}>{busy === 'export' ? 'Preparing workbook…' : '↓ Export All Data to Excel'}</button>
    </div>
    <LegalSupport />
    {busy && <p role="status" aria-live="polite">Working… Please keep this window open.</p>}
    {confirmation && <Dialog title={confirmation === 'restore' ? 'Restore Backup?' : 'Change Data Folder?'} confirmLabel={confirmation === 'restore' ? 'Continue with Restore' : 'Choose Folder'} busy={Boolean(busy)} onClose={() => { setConfirmation(undefined); setSelectedFile(undefined); }} onConfirm={() => { void run(confirmation); }}>
      <p>{confirmation === 'restore' ? `Restoring ${selectedFile ? '“' + selectedFile.name + '”' : 'a backup'} replaces the current app data. A safety backup is saved first. The matching encryption key is required.` : 'Your existing data will be copied to the chosen folder and the desktop app will restart. Finish any unsaved work before continuing.'}</p>
    </Dialog>}
    {message && <Dialog title={message.title} onClose={() => { if (message.reload) window.location.reload(); else setMessage(undefined); }}><p>{message.text}</p></Dialog>}
  </>;
}
