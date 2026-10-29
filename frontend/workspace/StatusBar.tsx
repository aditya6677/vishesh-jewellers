import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function StatusBar() {
  const [version, setVersion] = useState('');
  const [backup, setBackup] = useState('Backup status unavailable');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/version', { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => { if (result?.appVersion) setVersion(result.appVersion); }).catch(() => {});
    const refresh = () => {
      if (window.vjAccountSession && !window.vjAccountSession.permissions.includes('settings.backup')) { setBackup('Backup managed by administrator'); return; }
      void fetch('/api/backup-status', { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => {
        if (!result) return;
        setBackup(result.latest ? 'Backup available' : 'No backup found');
      }).catch(() => {});
    };
    refresh(); window.addEventListener('vj:backup-updated', refresh); window.addEventListener('vj:settings-refresh', refresh);
    return () => { controller.abort(); window.removeEventListener('vj:backup-updated', refresh); window.removeEventListener('vj:settings-refresh', refresh); };
  }, []);
  const footer = document.querySelector('.app-footer');
  return footer ? createPortal(<span className="workspace-status"><span>{window.vjAccountSession?.user.name || 'Local workspace'}</span><span title="Business data stays on this computer">● {window.vjDatabaseMode ? 'Encrypted database' : 'Local data'}</span><span>{backup}</span>{version && <span>v{version}</span>}</span>, footer) : null;
}
