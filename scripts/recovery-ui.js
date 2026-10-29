'use strict';
const element = id => document.getElementById(id);
let busy = false, recovered = false;
async function act(action) {
  if (busy) return;
  if (action === 'fresh' && element('confirmation').value !== 'CREATE NEW STORE') { element('message').textContent = 'Type CREATE NEW STORE exactly. Your existing files will not be deleted.'; return; }
  busy = true; document.querySelectorAll('button,input').forEach(control => { control.disabled = true; });
  element('message').textContent = action === 'restore' || action === 'fresh' ? 'Complete the setup window. Existing data stays unchanged until setup succeeds.' : '';
  try {
    const result = await window.storeRecovery.action(action, element('confirmation').value);
    element('message').textContent = result.message || result.error || '';
    if (result.recovered) { recovered = true; element('restart').hidden = false; element('fresh-options').hidden = true; }
  } catch { element('message').textContent = 'Recovery could not complete. Existing files have not been reset. Close the app and contact Tech Aditya.'; }
  finally {
    busy = false; document.querySelectorAll('button,input').forEach(control => { control.disabled = false; });
    for (const id of ['restore', 'retry', 'fresh']) element(id).disabled = recovered;
    element('confirmation').value = '';
  }
}
for (const id of ['restore','retry','folder','fresh','restart','quit']) element(id).onclick = () => act(id);
window.storeRecovery.info().then(info => { element('title').textContent = info.title; element('explanation').textContent = info.message; element('guidance').textContent = info.guidance; element('data-folder').textContent = 'App data: ' + info.directory; }).catch(() => { element('explanation').textContent = 'Could not load startup information. Keep all app data and contact Tech Aditya.'; });
