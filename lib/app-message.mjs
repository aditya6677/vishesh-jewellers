export function appMessage(value) {
  if (!value || typeof value.text !== 'string') return null;
  const type = value.type === 'error' || value.type === 'success' ? value.type : 'info';
  return { text: value.text, type, title: type === 'error' ? 'Please check' : type === 'success' ? 'Success' : 'Notice', icon: type === 'error' ? '!' : type === 'success' ? '✓' : 'i' };
}
