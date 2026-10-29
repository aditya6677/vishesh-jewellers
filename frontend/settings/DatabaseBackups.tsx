import { useEffect, useRef, useState } from 'react';
import { databaseBackupApi, type DatabaseBackupStatus } from '../api';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';

export function DatabaseBackups() {
  const [status, setStatus] = useState<DatabaseBackupStatus>();
  const [locationOpen, setLocationOpen] = useState(false);
  const [backupFolder, setBackupFolder] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<'portable' | 'verify' | 'import' | 'prepare'>();
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string; reload?: boolean }>();
  const [files, setFiles] = useState<File[]>([]);
  const [prepared, setPrepared] = useState<{ token: string; counts: { collection: string; count: number }[] }>();
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = useRef(false);

  async function refresh(signal?: AbortSignal) {
    try { const value = await databaseBackupApi.status(signal); if (!signal?.aborted) { setStatus(value); setError(''); } }
    catch (cause) { if (!signal?.aborted) setError((cause as Error).message); }
  }
  useEffect(() => {
    const controller = new AbortController(); void refresh(controller.signal);
    return () => controller.abort();
  }, []);
  const portable = status?.backups.filter(backup => backup.portable) || [];
  const labels = portable.map(backup => new Date(backup.createdAt).toLocaleString() + ' · ' + backup.name.slice(-8));
  const selectedIndex = portable.findIndex(backup => backup.name === selected);
  function close() { if (!locked.current) { setAction(undefined); setPassphrase(''); setConfirmation(''); setFiles([]); setError(''); } }

  async function importFiles() {
    if (files.length !== 3 || !['database.db', 'manifest.json', 'recovery.json'].every(name => files.filter(file => file.name === name).length === 1)) throw new Error('Select database.db, manifest.json and recovery.json from one portable backup folder.');
    const database = files.find(file => file.name === 'database.db')!;
    const manifest = files.find(file => file.name === 'manifest.json')!;
    const recovery = files.find(file => file.name === 'recovery.json')!;
    if (database.size > 25_000_000 || manifest.size > 1024 || recovery.size > 4096) throw new Error('Browser import supports databases up to 25 MB and original app metadata files.');
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the backup file.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(database);
    });
    return { database: encoded, manifest: await manifest.text(), recovery: await recovery.text() };
  }

  async function submit() {
    if (locked.current || !action) return;
    if (passphrase.length < 12 || new TextEncoder().encode(passphrase).length > 1024) { setError('Use a separate recovery passphrase of at least 12 characters (maximum 1024 bytes), not your app PIN.'); return; }
    if (action === 'portable' && passphrase !== confirmation) { setError('The recovery passphrases do not match.'); return; }
    if ((action === 'verify' || action === 'prepare') && !selected) { setError('Select a portable backup first.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await databaseBackupApi.run(action, passphrase, selected, action === 'import' ? { files: await importFiles() } : {});
      if (action === 'prepare') {
        if (!result.token) throw new Error('Recovery preparation did not return a confirmation token.');
        setPrepared({ token: result.token, counts: result.counts || [] }); setRestoreConfirmation('');
      } else setMessage({ title: action === 'portable' ? 'Portable backup saved' : action === 'import' ? 'Backup imported' : 'Recovery verified', text: action === 'portable'
        ? 'Saved to ' + result.path + '. Copy the entire folder to another device or secure cloud storage. Keep the recovery passphrase separately; it cannot be reset.'
        : action === 'import' ? 'The backup was imported and verified. Your current data has not changed. Select it below to verify or restore it.' : result.message || 'The encrypted backup was successfully recovered and checked. Current data was not replaced.' });
      if (result.name) setSelected(result.name);
      setFiles([]); setAction(undefined); await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setPassphrase(''); setConfirmation(''); locked.current = false; setBusy(false); }
  }

  async function activate() {
    if (locked.current || !prepared) return;
    if (restoreConfirmation !== 'RESTORE') { setError('Type RESTORE to confirm.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await databaseBackupApi.run('activate', '', undefined, { token: prepared.token, confirmation: restoreConfirmation });
      setPrepared(undefined); setRestoreConfirmation('');
      setMessage({ title: 'Backup restored', text: 'The database has been restored. A safety copy of the previous data is saved at ' + result.safety + '. Close this message to reload the app.', reload: true });
    } catch (cause) { setError((cause as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }

  return <>
    {locationOpen && <Dialog title="Change backup folder" confirmLabel="Save Backup Folder" busy={busy} onClose={() => { if (!locked.current) setLocationOpen(false); }} onConfirm={() => {
      if (locked.current) return;
      locked.current = true; setBusy(true); setError('');
      void databaseBackupApi.run('location', '', undefined, { path: backupFolder }).then(result => {
        setLocationOpen(false); setSelected(''); setMessage({ title: 'Backup folder updated', text: (result.message || '') + ' New location: ' + result.path }); return refresh();
      }).catch(cause => setError((cause as Error).message)).finally(() => { locked.current = false; setBusy(false); });
    }}><p>Enter an existing folder on the computer running this app. Future portable and weekly backups will be saved there. Existing backups stay in their original folder; the active database will not move.</p><div className="field"><label htmlFor="backup-folder">Full folder path *</label><input id="backup-folder" type="text" value={backupFolder} onChange={event => setBackupFolder(event.target.value)} disabled={busy} placeholder="/Users/yourname/Documents/Backups" /></div><p className="sub">A dedicated SQLite subfolder is created automatically. Keep portable backups on another device too. Older backups can still be imported from their original location.</p>{error && <p className="due-amount" role="alert">{error}</p>}</Dialog>}
    <p className="sub">Create a portable encrypted backup with a separate recovery passphrase. It can be recovered after reinstalling, without the original installation key. Your original JSON data is unchanged.</p>
    <div className="record-info-grid" style={{ marginBottom: 16 }}>
      <div className="record-info"><b>Backup folder</b><span style={{ overflowWrap: 'anywhere' }}>{status?.directory || 'Loading…'}</span></div>
      <div className="record-info"><b>Weekly safety copies</b><span>Checked at startup and daily while running. These copies require the original database key.</span></div>
    </div>
    <p className="sub">Weekly copies are not portable recovery bundles. Keep a passphrase-protected portable backup off this computer. No backups are automatically deleted.</p>
    <div className="btn-row"><button data-permission="settings.backup" className="btn btn-gold" disabled={busy || !status} onClick={() => { setError(''); setAction('portable'); }}>Create Portable Backup</button><button data-permission="settings.backup" className="btn btn-ghost" disabled={busy || !status} onClick={() => { setError(''); setBackupFolder(status?.backupRoot || ''); setLocationOpen(true); }}>Change Backup Folder</button><button data-permission="settings.restore" className="btn btn-ghost" disabled={busy || !status} onClick={() => fileInput.current?.click()}>Import Backup…</button><button className="btn btn-ghost" disabled={busy} onClick={() => { void refresh(); }}>Refresh Backups</button></div>
    <input ref={fileInput} type="file" multiple accept=".db,.json" aria-label="Import portable backup files" hidden onChange={event => { const selectedFiles = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; if (selectedFiles.length) { setFiles(selectedFiles); setError(''); setAction('import'); } }} />
    {portable.length > 0 && <div style={{ marginTop: 18 }}>
      <label>Portable backup</label>
      <Select label="Portable backup" value={labels[selectedIndex] || 'Select a backup'} options={labels} onChange={label => setSelected(portable[labels.indexOf(label)].name)} disabled={busy} />
      <div className="btn-row" style={{ marginTop: 12 }}><button data-permission="settings.backup" className="btn btn-ghost" disabled={busy || !selected} onClick={() => { setError(''); setAction('verify'); }}>Verify Recovery</button><button data-permission="settings.restore" className="btn btn-danger" disabled={busy || !selected} onClick={() => { setError(''); setAction('prepare'); }}>Restore Backup…</button></div>
    </div>}
    <p className="sub">Verify Recovery never replaces current data. Restore requires a passphrase, a separate confirmation and a safety copy. Finish any unsaved work first. Import all three backup files together; browser import is limited to 25 MB.</p>
    {error && !action && !prepared && <p className="due-amount" role="alert">{error}</p>}
    {action && <Dialog title={action === 'portable' ? 'Protect your backup' : action === 'prepare' ? 'Prepare backup restoration' : action === 'import' ? 'Import portable backup' : 'Verify backup recovery'} confirmLabel={action === 'portable' ? 'Create Encrypted Backup' : action === 'prepare' ? 'Prepare Restore' : action === 'import' ? 'Import and Verify' : 'Verify Recovery'} busy={busy} onClose={close} onConfirm={() => { void submit(); }}>
      <p>{action === 'portable' ? 'Choose a long, unique recovery passphrase. Do not use PIN 5512. Losing this phrase and the original key means losing access to the backup.' : 'Enter the passphrase used for this backup. Your current data will not be changed.'}</p>
      <div className="field"><label htmlFor="backup-passphrase">Recovery passphrase *</label><input id="backup-passphrase" type="password" autoComplete="off" required minLength={12} value={passphrase} disabled={busy} onChange={event => setPassphrase(event.target.value)} /></div>
      {action === 'portable' && <div className="field" style={{ marginTop: 12 }}><label htmlFor="backup-confirm">Confirm recovery passphrase *</label><input id="backup-confirm" type="password" autoComplete="off" required minLength={12} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></div>}
      {error && <p className="due-amount" role="alert">{error}</p>}
    </Dialog>}
    {prepared && <Dialog title="Replace current database?" confirmLabel="Restore Backup" danger busy={busy} onClose={() => { if (!locked.current) { setPrepared(undefined); setError(''); } }} onConfirm={() => { void activate(); }}>
      <p>This replaces all data in the active database with the prepared backup. A safety copy and the previous database are retained. The app reloads afterward. Confirmation expires in 10 minutes and is rejected if current data changes.</p>
      <ul>{prepared.counts.map(row => <li key={row.collection}>{row.collection}: {row.count}</li>)}</ul>
      <div className="field"><label htmlFor="restore-confirmation">Type RESTORE to confirm</label><input id="restore-confirmation" type="text" autoComplete="off" value={restoreConfirmation} disabled={busy} onChange={event => setRestoreConfirmation(event.target.value)} /></div>
      {error && <p className="due-amount" role="alert">{error}</p>}
    </Dialog>}
    {message && <Dialog title={message.title} onClose={() => { if (message.reload) window.location.reload(); else setMessage(undefined); }}><p style={{ overflowWrap: 'anywhere' }}>{message.text}</p></Dialog>}
  </>;
}
