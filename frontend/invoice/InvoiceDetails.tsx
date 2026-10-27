import { useEffect, useRef, useState } from 'react';
import { Select } from '../components/Select';

type BusinessField = 'biz-name' | 'biz-gstin' | 'biz-phone' | 'biz-email' | 'biz-address';
type DetailField = BusinessField | 'cust-name' | 'cust-mobile' | 'cust-address' | 'inv-no' | 'inv-date' | 'invoiceType';
type DetailValues = Record<DetailField, string>;
type EditableField = Exclude<DetailField, 'inv-no'>;

declare global {
  interface Window {
    vjInvoiceDetails?: {
      read: () => DetailValues;
      update: (field: EditableField, value: string) => void;
      commitBusiness: (field: BusinessField) => void;
    };
  }
}

const emptyDetails: DetailValues = {
  'biz-name': 'Vishesh Jewellers', 'biz-gstin': '', 'biz-phone': '', 'biz-email': '', 'biz-address': 'Main Market Road',
  'cust-name': '', 'cust-mobile': '', 'cust-address': '', 'inv-no': '', 'inv-date': '', invoiceType: 'sale'
};

export function InvoiceDetails() {
  const [values, setValues] = useState<DetailValues>(() => window.vjInvoiceDetails?.read() || emptyDetails);
  const dirtyBusinessFields = useRef(new Set<BusinessField>());

  useEffect(() => {
    const sync = () => {
      const current = window.vjInvoiceDetails?.read();
      if (current) setValues(current);
    };
    window.addEventListener('vj:invoice-details-sync', sync);
    window.addEventListener('vj:invoice-reset', sync);
    sync();
    return () => {
      window.removeEventListener('vj:invoice-details-sync', sync);
      window.removeEventListener('vj:invoice-reset', sync);
    };
  }, []);

  const update = (field: EditableField, value: string) => {
    window.vjInvoiceDetails?.update(field, value);
    if (field.startsWith('biz-')) dirtyBusinessFields.current.add(field as BusinessField);
    setValues(current => ({ ...current, [field]: value }));
  };
  const commitBusiness = (field: BusinessField) => {
    if (!dirtyBusinessFields.current.delete(field)) return;
    window.vjInvoiceDetails?.commitBusiness(field);
  };
  const idFor = (field: DetailField) => 'invoice-details-' + field;
  const input = (field: EditableField, label: string, placeholder = '', required = false, type = 'text') => <div className="field">
    <label htmlFor={idFor(field)}>{label}</label>
    <input id={idFor(field)} type={type} value={values[field]} placeholder={placeholder} required={required}
      onChange={event => update(field, event.currentTarget.value)}
      onInput={type === 'date' ? event => update(field, event.currentTarget.value) : undefined}
      onBlur={event => {
        if (type === 'date') update(field, event.currentTarget.value);
        if (field.startsWith('biz-')) commitBusiness(field as BusinessField);
      }} />
  </div>;

  return <>
    <div className="panel" style={{ marginBottom: 18 }}>
      <details className="collapse"><summary>Business details (shown on every invoice)</summary>
        <div className="row row-2">
          {input('biz-name', 'Shop Name')}
          {input('biz-gstin', 'GSTIN', 'e.g. 09ABCDE1234F1Z5')}
          {input('biz-phone', 'Phone', 'Phone number(s)')}
          {input('biz-email', 'Email', 'Email address')}
        </div>
        <div className="field"><label htmlFor={idFor('biz-address')}>Shop Address</label>
          <textarea id={idFor('biz-address')} value={values['biz-address']} placeholder="Shop address, city"
            onChange={event => update('biz-address', event.currentTarget.value)} onBlur={() => commitBusiness('biz-address')} />
        </div>
      </details>
    </div>
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3><span className="dot" />Bill To</h3>
      <div className="row row-2">
        {input('cust-name', 'Customer Name *', 'Vishesh', true)}
        {input('cust-mobile', 'Mobile (optional)', '10-digit mobile')}
      </div>
      <div className="field"><label htmlFor={idFor('cust-address')}>Address</label>
        <textarea id={idFor('cust-address')} value={values['cust-address']} placeholder="Customer address" onChange={event => update('cust-address', event.currentTarget.value)} />
      </div>
      <div className="row row-2">
        <div className="field"><label htmlFor={idFor('inv-no')}>Invoice No.</label>
          <input id={idFor('inv-no')} value={values['inv-no']} disabled title="Invoice number is assigned automatically" />
        </div>
        {input('inv-date', 'Date *', '', true, 'date')}
        <div className="field"><label>Invoice type *</label>
          <Select label="Invoice type" value={values.invoiceType === 'pending' ? 'Pending delivery order' : 'Ready sale — deduct stock'}
            options={['Ready sale — deduct stock', 'Pending delivery order']}
            onChange={value => update('invoiceType', value === 'Pending delivery order' ? 'pending' : 'sale')} />
        </div>
      </div>
    </div>
  </>;
}
