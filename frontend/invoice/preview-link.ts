// An already-running backend can still serve the former anchor while the new
// frontend bundle is loaded. A hash jump cannot open a closed preview dialog.
export function bindPreviewLink(link: HTMLAnchorElement | null, open: () => void): () => void {
  if (!link) return () => {};
  const click = (event: Event) => { event.preventDefault(); open(); };
  link.setAttribute('aria-haspopup', 'dialog');
  link.textContent = 'Preview';
  link.classList.remove('btn-sm');
  link.classList.add('invoice-preview-button');
  link.addEventListener('click', click);
  return () => link.removeEventListener('click', click);
}
