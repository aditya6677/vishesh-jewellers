import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
type Branding = { name: string; tagline: string; logo: string };
declare global { interface Window { vjApplyBranding?: (value: Branding) => void } }
export function StoreBranding() {
  const [value, setValue] = useState<Branding>({ name: '', tagline: '', logo: '' });
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; text: string }>();
  const fileInput = useRef<HTMLInputElement>(null), locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/branding', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('Could not load store branding.'); setValue(await response.json() as Branding); setLoaded(true); }).catch(error => { if (!controller.signal.aborted) setNotice({ title: 'Could not load branding', text: (error as Error).message }); });
    return () => controller.abort();
  }, []);
  async function chooseLogo(file?: File) {
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1_000_000) throw new Error('Choose a PNG or JPEG logo up to 1 MB.');
      const bitmap = await createImageBitmap(file);
      const tooLarge = bitmap.width > 4096 || bitmap.height > 4096; bitmap.close();
      if (tooLarge) throw new Error('Logo dimensions must be no larger than 4096 × 4096 pixels.');
      const logo = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read this logo.')); reader.readAsDataURL(file); });
      setValue(current => ({ ...current, logo }));
    } catch (error) { setNotice({ title: 'Choose another logo', text: (error as Error).message }); }
  }
  async function save() {
    if (locked.current) return;
    if (!value.name.trim()) { setNotice({ title: 'Store name required', text: 'Enter your store name before saving.' }); return; }
    locked.current = true; setBusy(true);
    try {
      const response = await fetch('/api/branding', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      const result = await response.json() as Branding & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not save store branding.');
      setValue(result); window.vjApplyBranding?.(result);
      setNotice({ title: 'Store branding saved', text: 'Your workspace and new invoice previews now use this branding. Previously saved invoices have not been rewritten.' });
    } catch (error) { setNotice({ title: 'Branding not saved', text: (error as Error).message }); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="panel" style={{ marginBottom: 18 }}><h3><span className="dot" />Store Branding</h3><p className="sub">Superadmin controls the store name, tagline and logo. Your contact and GST details are preserved.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || !loaded} style={{ border: 0, padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: 18, border: '1px solid rgba(198,154,58,.2)', borderRadius: 12, marginBottom: 18 }}><img src={value.logo || '/assets/karatdesk-logo.png'} alt="Store logo preview" style={{ width: 76, height: 76, objectFit: 'contain' }} /><div><strong style={{ fontSize: 22 }}>{value.name || 'Your store name'}</strong><p className="sub" style={{ margin: '5px 0 0' }}>{value.tagline}</p></div></div>
      <div className="row row-2"><div className="field"><label htmlFor="store-brand-name">Store name *</label><input id="store-brand-name" type="text" required maxLength={100} value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} /></div><div className="field"><label htmlFor="store-brand-tagline">Tagline</label><input id="store-brand-tagline" type="text" maxLength={160} value={value.tagline} onChange={event => setValue({ ...value, tagline: event.target.value })} /></div></div>
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg" aria-label="Choose store logo" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void chooseLogo(file); }} />
      <p className="sub">PNG or JPEG · up to 1 MB · transparent PNG recommended.</p><div className="btn-row"><button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()}>Choose Logo</button><button type="button" className="btn btn-ghost" onClick={() => setValue({ ...value, logo: '' })}>Use Default Logo</button><button type="submit" className="btn btn-gold">{busy ? 'Saving…' : 'Save Branding'}</button></div>
    </fieldset></form>{notice && <Dialog title={notice.title} onClose={() => setNotice(undefined)}><p>{notice.text}</p></Dialog>}
  </div>;
}
