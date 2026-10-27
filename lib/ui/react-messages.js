'use strict';

function applyReactMessages(html) {
  const start = html.indexOf("function showAppMessage(message, type = 'info'){");
  const end = html.indexOf('\nfunction fmt(n){', start);
  if (start < 0 || end < 0) throw new Error('Shared message migration boundary changed.');
  const original = html.slice(start, end);
  const toastStart = original.indexOf('function toast(msg){');
  const toastEnd = original.indexOf("window.addEventListener('unhandledrejection'", toastStart);
  if (toastStart < 0 || toastEnd < 0) throw new Error('Shared message classification boundary changed.');
  const bridge = `function showAppMessage(message, type = 'info'){
  const queue = window.vjAppMessageQueue || (window.vjAppMessageQueue = []);
  queue.push({ text: String(message), type });
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  window.dispatchEvent(new Event('vj:app-message'));
}
window.alert = message => showAppMessage(message, 'error');
`;
  return html.slice(0, start) + bridge + original.slice(toastStart) + html.slice(end);
}

module.exports = { applyReactMessages };
