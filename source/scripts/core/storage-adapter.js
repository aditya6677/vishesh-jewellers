
window.storage = {
  async get(key) {
    const response = await fetch('/api/storage/' + encodeURIComponent(key), { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Could not load saved data');
    return response.json();
  },
  async set(key, value) {
    const response = await fetch('/api/storage/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Could not save data');
  }
};
let loadedServerVersion = null;
let checkingServerVersion = false;
async function refreshAfterServerRestart() {
  if (checkingServerVersion) return;
  checkingServerVersion = true;
  try {
    const response = await fetch('/api/version', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const payload = await response.json();
    if (loadedServerVersion && loadedServerVersion !== payload.version) location.reload();
    loadedServerVersion = payload.version;
  } catch (_) { /* The server may be restarting; the next poll will retry. */ }
  finally { checkingServerVersion = false; }
}
refreshAfterServerRestart();
setInterval(refreshAfterServerRestart, 1000);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}
