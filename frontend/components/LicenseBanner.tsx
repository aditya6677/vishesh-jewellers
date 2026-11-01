import { useEffect, useState } from 'react';
import { TeamContact } from './TeamContact';

type Plan = { state: string; plan?: string; daysRemaining?: number | null; message: string };
export function LicenseBanner() {
  const [plan, setPlan] = useState<Plan>();
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try { const response = await fetch('/api/license', { signal: AbortSignal.timeout(15000) }); if (response.ok) { const value = await response.json() as Plan; if (mounted) setPlan(value); } }
      catch { /* Server-side licence enforcement remains authoritative offline. */ }
    };
    const update = () => { void refresh(); };
    update();
    const timer = window.setInterval(update, 60000);
    window.addEventListener('vj:license-refresh', update); window.addEventListener('focus', update);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('vj:license-refresh', update); window.removeEventListener('focus', update); };
  }, []);
  if (!plan || ['disabled', 'not-started'].includes(plan.state) || plan.state === 'paid' && (plan.daysRemaining == null || plan.daysRemaining > 14)) return null;
  const expired = plan.state === 'expired';
  const warning = !['trial', 'paid'].includes(plan.state);
  return <div className={'license-status-banner plan-banner' + (warning ? ' plan-banner-warning' : '')} role="status">
    <div className="plan-banner-heading"><span className="plan-state-icon" aria-hidden="true">{warning ? '!' : '◇'}</span><div><strong>{expired ? 'Your plan has ended · Read-only access' : plan.state === 'trial' ? 'Your full-feature trial' : plan.state === 'paid' ? 'Your subscription renews soon' : 'Your plan needs attention'}</strong><p>{expired ? 'Your data is safe. Existing records, exports and backups remain available. Contact our team to activate or renew.' : warning ? plan.message : plan.daysRemaining + ' days remaining · View your plan in Settings.'}</p></div></div>
    {warning && <TeamContact />}
  </div>;
}
