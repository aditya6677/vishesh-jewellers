  const openSettings = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('settingsTab').classList.add('active');
    document.getElementById('page-settings').classList.add('active');
    const status = document.getElementById('settingsDataStatus');
    try {
      const response = await fetch('/api/data-location', { cache: 'no-store' });
      const location = await response.json();
      document.getElementById('settingsDataPath').textContent = location.path;
      document.getElementById('settingsChooseData').disabled = !location.desktop;
      document.getElementById('settingsCreateBackup').disabled = false;
      document.getElementById('settingsRestoreBackup').disabled = false;
      document.getElementById('settingsCreateBackup').textContent = location.desktop ? 'Create Backup Now' : 'Download Encrypted Backup';
      status.textContent = location.desktop ? '' : 'Changing the data folder is available in the desktop app.';
      document.getElementById('settingsBackupDescription').textContent = location.desktop
        ? 'A backup is created automatically once per week when the desktop app starts. Create one manually or restore one at any time. Weekly backups are saved in Documents → Vishesh Jewellers Backups.'
        : 'A backup is created automatically once per week when the local server starts. Download one whenever you want, or restore a downloaded backup. Weekly snapshots are saved in Documents → Vishesh Jewellers Backups.';
      document.getElementById('settingsBackupNote').textContent = location.desktop
        ? 'The business data is encrypted, and the backup includes a key protected by this computer’s secure storage. Restore is intended for the same computer and OS account; it cannot be moved to another computer.'
        : 'The downloaded business data is encrypted. Restoring requires the matching app data key, so keep the original data folder and its key file together. This backup is not portable to another computer.';
      const backupResponse = await fetch('/api/backup-status', { cache: 'no-store' });
      const backup = await backupResponse.json();
      document.getElementById('settingsBackupStatus').textContent = backup.latest
        ? 'Latest backup: ' + backup.latest
        : 'No automatic backup has been created yet.';
    } catch (_) { status.textContent = 'Could not load the current data location.'; }
  };
