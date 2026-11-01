import support from '../../lib/domain/support-contact.json';

export function TeamContact() {
  return <div className="plan-team-contact"><div className="plan-contact-icon" aria-hidden="true">◇</div><div><strong>{support.name}</strong><span>Activation, renewal &amp; support</span></div><div className="plan-contact-links"><a href={'mailto:' + support.email}>{support.email}</a><a href={'tel:' + support.phoneHref}>{support.phone}</a></div></div>;
}
