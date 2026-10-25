  document.getElementById('settingsChooseData').addEventListener('click', async () => {
    const status = document.getElementById('settingsDataStatus');
    try {
      const response = await fetch('/api/data-location', { method: 'POST' });
      if (!response.ok) throw new Error();
      status.textContent = 'Choose a folder in the system dialog. The app will restart after confirmation.';
    } catch (_) { status.textContent = 'This option is available only in the desktop app.'; }
  });
  const requestBackupAction = async (action, message) => {
    const status = document.getElementById('settingsBackupStatus');
    try {
      const locationResponse = await fetch('/api/data-location', { cache: 'no-store' });
      const location = await locationResponse.json();
      if (!location.desktop && action === 'create') {
        const response = await fetch('/api/backup/download', { cache: 'no-store' });
        if (!response.ok) {
          let error = 'Could not create the encrypted backup.';
          try { error = (await response.json()).error || error; } catch (_) {}
          throw new Error(error);
        }
        const file = await response.blob();
        const downloadUrl = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'Vishesh-Jewellers-Backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        status.textContent = 'Encrypted JSON backup downloaded.';
        showAppMessage('Your encrypted JSON backup has been downloaded. Keep the app data key with your data folder; this backup is restorable with that same key.', 'success');
        return;
      }
      if (!location.desktop && action === 'restore') {
        document.getElementById('settingsRestoreFile').click();
        return;
      }
      const response = await fetch('/api/backup/' + action, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'This option is available only in the desktop app.');
      status.textContent = message;
    } catch (error) {
      status.textContent = error.message || 'Could not start the backup action.';
      showAppMessage(status.textContent, 'error');
    }
  };
  document.getElementById('settingsCreateBackup').addEventListener('click', () => requestBackupAction('create', 'Choose where to save the encrypted backup.'));
  document.getElementById('settingsRestoreBackup').addEventListener('click', () => requestBackupAction('restore', 'Select a backup file in the system dialog. Current data will be backed up before restoring.'));
  document.getElementById('settingsRestoreFile').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const status = document.getElementById('settingsBackupStatus');
    try {
      const response = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await file.text()
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not restore this backup.');
      status.textContent = 'Backup restored. Reloading the app…';
      showAppMessage('Backup restored successfully. The app will reload with the recovered data.', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      status.textContent = error.message || 'Could not restore this backup.';
      showAppMessage(status.textContent, 'error');
    } finally { event.target.value = ''; }
  });
  document.getElementById('settingsExportData').addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = document.getElementById('settingsDataStatus');
    button.disabled = true;
    status.textContent = 'Preparing the Excel workbook…';
    try {
      const response = await fetch('/api/export.xlsx', { cache: 'no-store' });
      if (!response.ok) {
        let message = 'Could not export the saved data. Please try again.';
        try { message = (await response.json()).error || message; } catch (_) {}
        throw new Error(message);
      }
      const file = await response.blob();
      const downloadUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'Vishesh-Jewellers-Data-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      status.textContent = 'Excel export downloaded.';
      showAppMessage('Your Excel data export is ready. It includes the readable report sheets and complete saved-data reference.', 'success');
    } catch (error) {
      status.textContent = error.message || 'Could not export the saved data.';
      showAppMessage(status.textContent, 'error');
    } finally {
      button.disabled = false;
    }
  });
