import type { Ref } from 'react';
import type { InvoicePreviewSnapshot } from './preview-types';

const number = (value: string | number) => (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => '₹' + number(value);
const weight = (value: string | number) => (parseFloat(String(value)) || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function InvoicePaper({ snapshot: s, paperRef }: { snapshot: InvoicePreviewSnapshot; paperRef?: Ref<HTMLDivElement> }) {
  const balance = s.totals.grand - s.paid;
  return <div id="invoicePaper" ref={paperRef} data-invoice-renderer="react">
    <div className="paper-head"><div className="paper-brand">
      <img src="/assets/vishesh-jewellers-logo.png" alt="Vishesh Jewellers" className="invoice-logo" />
      <div><h2 id="p-biz-name">{s.business.name}</h2><p>Beginning... of Special Relationship...</p></div>
    </div><div className="paper-contact">
      <div className="gst-badge" id="p-gstin">{s.totals.gstPct === 0 ? 'NON-GST INVOICE' : 'GSTIN: ' + (s.business.gstin || '—')}</div><br />
      <span id="p-phone">{s.business.phone ? 'Ph: ' + s.business.phone : ''}</span><br />
      <span id="p-email">{s.business.email}</span><br /><span id="p-address">{s.business.address}</span>
    </div></div>
    <div className="meta-row"><div>Invoice No.: <span className="inv-no" id="p-inv-no">{s.number}</span></div><div>Date: <span className="inv-no" id="p-date">{s.date}</span></div></div>
    <div className="bill-to"><div className="lbl">Bill To</div><div className="nm" id="p-cust-name">{s.customer.name}</div>
      <div className="addr" id="p-cust-address">{[s.customer.address, s.customer.mobile ? 'Mob: ' + s.customer.mobile : ''].filter(Boolean).join(' · ')}</div></div>
    <table className="paper-items"><thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Purity</th><th>Gr.Wt</th><th>Net Wt</th><th>Pcs</th><th>Rate</th><th>Mkg%</th><th>Amount</th></tr></thead>
      <tbody id="p-items-body">{s.items.length ? s.items.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.name || '—'}</td><td className="num">{row.hsn}</td><td>{row.purity}</td>
        <td className="num">{weight(row.gross)}</td><td className="num">{weight(row.net)}</td><td className="num">{parseInt(String(row.pcs)) || 1}</td>
        <td className="num">{number(row.rate)}</td><td className="num">{number(row.making)}%</td><td className="num">{number(row.amount)}</td></tr>)
        : <tr><td colSpan={10} style={{ textAlign: 'center', color: '#9C8B60', padding: '16px 0' }}>Add items to see them here</td></tr>}</tbody>
    </table>
    <div className="paper-totals" id="p-totals">
      <div className="tl"><span>Total</span><b>{money(s.totals.subtotal)}</b></div>
      <div className="tl"><span>Exchange / Discount</span><b>{money(s.totals.disc)}</b></div>
      {s.totals.gstPct > 0 && <><div className="tl"><span>CGST {s.totals.gstPct}%</span><b>{money(s.totals.cgst)}</b></div><div className="tl"><span>SGST {s.totals.gstPct}%</span><b>{money(s.totals.sgst)}</b></div></>}
      <div className="tl"><span>Round Off</span><b>{money(s.totals.roundOff)}</b></div>
      <div className="gt"><span>Grand Total</span><b>{money(s.totals.grand)}</b></div>
      <div className="tl payment-summary-line"><span>{balance >= 0 ? 'Amount Due' : 'Excess / Plus Amount'}</span><b>{money(Math.abs(balance))}</b></div>
    </div><div className="words-line" id="p-words">{s.words}</div>
    <div className="paper-foot"><div className="terms"><div className="t-title">Terms &amp; Conditions</div><div id="p-terms">{s.terms}</div></div>
      <div className="sig-block"><div className="for-line">For <span id="p-biz-name-2">{s.business.name}</span></div><div className="sig-caption">Authorised Signatory</div></div></div>
  </div>;
}
