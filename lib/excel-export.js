const { deflateRawSync } = require('node:zlib');
const { calculateDashboard } = require('./dashboard-summary');

const SHEET_DATA = [
  ['Invoices', 'invoice-records'],
  ['Stock', 'stock-list'],
  ['Item Catalog', 'items-master'],
  ['Purchases', 'purchase-records'],
  ['Payments', 'payment-records'],
  ['Old Metal Ledger', 'old-gold-records'],
  ['Business Profile', 'business-info']
];

const REQUIRED_KEYS = new Set([...SHEET_DATA.map(([, key]) => key), 'invoice-counter']);

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(normalized) ? normalized : null;
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function dateSerial(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return utc / 86400000 + 25569;
}

function cellType(header, value) {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (/weight|\(g\)/i.test(header)) return 'weight';
    return /amount|total|subtotal|discount|tax|value|rate|paid|due|price/i.test(header) ? 'currency' : 'number';
  }
  if (/date|saved at|settled at|received at|created at|delivered at|voided at/i.test(header)) {
    const serial = dateSerial(String(value));
    if (serial !== null) return 'date';
  }
  return 'text';
}

function columnName(index) {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

function sheetXml(rows, widths, cellStyles = [], autoFilter = true) {
  const maxColumns = Math.max(1, ...rows.map(row => row.length));
  const maxRows = Math.max(rows.length, 1);
  const lastCell = columnName(maxColumns - 1) + maxRows;
  const columnXml = widths.length
    ? '<cols>' + widths.map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + Math.max(10, Math.min(width, 52)) + '" customWidth="1"/>').join('') + '</cols>'
    : '';
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((raw, columnIndex) => {
      const header = rowIndex === 0 ? String(raw || '') : String(rows[0][columnIndex] || '');
      const type = rowIndex === 0 ? 'header' : cellType(header, raw);
      const ref = columnName(columnIndex) + (rowIndex + 1);
      const customStyle = cellStyles[rowIndex] && cellStyles[rowIndex][columnIndex];
      if (type === 'blank') return '<c r="' + ref + '"' + (customStyle ? ' s="' + customStyle + '"' : '') + '/>';
      if (type === 'header') return '<c r="' + ref + '" s="' + (customStyle || 1) + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(raw) + '</t></is></c>';
      if (type === 'date') return '<c r="' + ref + '" s="' + (customStyle || 2) + '"><v>' + dateSerial(String(raw)) + '</v></c>';
      if (type === 'currency' || type === 'number' || type === 'weight') return '<c r="' + ref + '" s="' + (customStyle || (type === 'currency' ? '5' : type === 'weight' ? '4' : '3')) + '"><v>' + raw + '</v></c>';
      return '<c r="' + ref + '"' + (customStyle ? ' s="' + customStyle + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(asText(raw)) + '</t></is></c>';
    }).join('');
    return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
  }).join('');
  const views = rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = autoFilter && rows.length > 1 ? '<autoFilter ref="A1:' + lastCell + '"/>' : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + lastCell + '"/>' + views + columnXml + '<sheetFormatPr defaultRowHeight="16"/><sheetData>' + rowXml + '</sheetData>' + filter + '</worksheet>';
}

function worksheet(name, rows, widths, cellStyles, autoFilter) {
  return { name, rows: rows.length ? rows : [['No records']], widths: widths || [], cellStyles: cellStyles || [], autoFilter: autoFilter !== false };
}

function buildSystemExport(store = {}) {
  const data = store && typeof store === 'object' && !Array.isArray(store) ? store : {};
  const getArray = key => Array.isArray(data[key]) ? data[key] : [];
  const invoices = getArray('invoice-records');
  const stock = getArray('stock-list');
  const catalog = getArray('items-master');
  const purchases = getArray('purchase-records');
  const payments = getArray('payment-records');
  const ledger = getArray('old-gold-records');
  const sheets = [];
  const savedRecordCount = Object.values(data).reduce((total, value) => total + (Array.isArray(value) ? value.length : value == null ? 0 : 1), 0);
  const snapshot = calculateDashboard(invoices, purchases, payments, ledger);
  const dashboardRows = [
    ['Vishesh Jewellers · Business Snapshot', '', '', ''],
    ['Exported On', new Date().toISOString().slice(0, 10), 'Reporting Period', 'All time · all non-voided records'],
    ['Sales & Collections', '', '', ''],
    ['Total Gold Sold (g)', snapshot.gold.sold, 'Total Gold Amount (₹)', snapshot.gold.sales],
    ['Total Silver Sold (g)', snapshot.silver.sold, 'Total Silver Amount (₹)', snapshot.silver.sales],
    ['Total Metal Sales Amount (₹)', snapshot.gold.sales + snapshot.silver.sales, 'Customer Paid Amount (₹)', snapshot.collected],
    ['Total Old Gold Received (g)', snapshot.gold.received, 'Total Old Gold Amount (₹)', snapshot.gold.receivedValue],
    ['Total Old Silver Received (g)', snapshot.silver.received, 'Total Old Silver Amount (₹)', snapshot.silver.receivedValue],
    ['Old Gold/Silver Purchase Amount (₹)', snapshot.purchases, 'Party Payments (₹)', snapshot.party],
    ['Expenses / Kharch (₹)', snapshot.expenses, 'Amount Due (₹)', snapshot.due],
    ['Remaining Amount After Payment (₹)', snapshot.afterPayment, 'Invoice Sales Total (₹)', snapshot.sales],
    ['Completed Invoices', snapshot.invoices, 'Pending Delivery Orders', snapshot.pending],
    ['After Payment & Metal Balances', '', '', ''],
    ['Old Gold Balance (g)', snapshot.gold.balance, 'Old Silver Balance (g)', snapshot.silver.balance],
    ['Gold Paid Weight (g)', snapshot.gold.paid, 'Gold Fine Paid (g)', snapshot.gold.finePaid],
    ['Silver Paid Weight (g)', snapshot.silver.paid, 'Silver Fine Paid (g)', snapshot.silver.finePaid],
    ['After Payment Amount (₹)', snapshot.afterPayment, 'Calculation', 'Customer paid − party payments − old-metal purchases − expenses']
  ];
  const dashboardStyles = [];
  dashboardStyles[0] = [6, 6, 6, 6];
  dashboardStyles[2] = [7, 7, 7, 7];
  dashboardStyles[12] = [7, 7, 7, 7];
  [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16].forEach(row => {
    const valueStyle = label => {
      if (/weight|\(g\)/i.test(label)) return 4;
      if (/amount|sales|paid|payment|purchase|kharch|expense|due/i.test(label)) return 5;
      return 3;
    };
    dashboardStyles[row] = [8, valueStyle(dashboardRows[row][0]), 8, valueStyle(dashboardRows[row][2])];
  });
  dashboardStyles[16][3] = 0;
  sheets.push(worksheet('Dashboard', dashboardRows, [38, 22, 38, 56], dashboardStyles, false));
  sheets.push(worksheet('Summary', [
    ['Data Export Summary', 'Value'],
    ['Exported At', new Date().toISOString()],
    ['Invoices', invoices.length],
    ['Stock items', stock.length],
    ['Item catalog entries', catalog.length],
    ['Purchases', purchases.length],
    ['Payments', payments.length],
    ['Old metal ledger entries', ledger.length],
    ['Saved data entries', savedRecordCount],
    ['Next invoice number', data['invoice-counter'] == null ? '' : asText(data['invoice-counter'])],
    ['Currency', 'Indian Rupee (₹)'],
    ['Weight unit', 'grams']
  ], [32, 24]));

  const invoiceHeaders = ['Invoice Number', 'Status', 'Invoice Date', 'Created At', 'Customer', 'Mobile', 'Address', 'Items', 'Subtotal (₹)', 'Exchange / Discount (₹)', 'Manual Discount (₹)', 'GST Rate (%)', 'GST (₹)', 'Total (₹)', 'Paid (₹)', 'Due (₹)', 'Return Total (₹)', 'Initial Paid (₹)', 'Invoice Type', 'Voided At', 'Void Reason', 'Terms'];
  sheets.push(worksheet('Invoices', [invoiceHeaders, ...invoices.map(record => [
    record.number, record.status || 'completed', record.invoiceDate || record.date, record.savedAt,
    record.customer, record.mobile, record.address, record.items,
    asNumber(record.subtotal), asNumber(record.discount), asNumber(record.manualDiscount), asNumber(record.gstRate), asNumber(record.tax),
    asNumber(record.total), asNumber(record.paid), asNumber(record.due), asNumber(record.returnTotal), asNumber(record.initialPaid),
    record.invoiceType || (record.status === 'pending' ? 'Pending delivery' : 'Sale'), record.voidedAt, record.voidReason, record.terms
  ])], [18, 16, 16, 22, 28, 16, 30, 42, 16, 22, 20, 14, 16, 16, 16, 16, 18, 18, 20, 22, 36, 36]));

  const itemHeaders = ['Invoice Number', 'Status', 'Invoice Date', 'Customer', 'Stock ID', 'Item', 'HSN', 'Purity', 'Pcs', 'Gross Wt / Piece (g)', 'Net Wt / Piece (g)', 'Total Gross Wt (g)', 'Total Net Wt (g)', 'Rate (₹/g)', 'Making (%)', 'Item Amount (₹)', 'Line ID'];
  const invoiceItems = invoices.flatMap(record => (record.soldItems && record.soldItems.length ? record.soldItems : record.orderItems || []).map(item => {
    const pcs = asNumber(item.pcs) || 1;
    const net = asNumber(item.net) || 0;
    const rate = asNumber(item.rate) || 0;
    const making = asNumber(item.making) || 0;
    return [record.number, record.status || 'completed', record.invoiceDate || record.date, record.customer, item.stockId, item.name, item.hsn, item.purity, pcs, asNumber(item.gross), net, (asNumber(item.gross) || 0) * pcs, net * pcs, rate, making, net * pcs * rate * (1 + making / 100), item.lineId];
  }));
  sheets.push(worksheet('Invoice Items', [itemHeaders, ...invoiceItems], [18, 16, 16, 28, 18, 32, 12, 14, 10, 20, 20, 20, 20, 16, 14, 20, 18]));

  const exchangeHeaders = ['Invoice Number', 'Invoice Date', 'Customer', 'Metal', 'Weight (g)', 'Rate (₹/g)', 'Exchange Value (₹)'];
  const exchanges = invoices.flatMap(record => (Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : []).map(exchange => [record.number, record.invoiceDate || record.date, record.customer, exchange.metal, asNumber(exchange.weight), asNumber(exchange.rate), asNumber(exchange.value)]));
  sheets.push(worksheet('Exchanges', [exchangeHeaders, ...exchanges], [18, 16, 28, 14, 16, 16, 20]));

  const settlementHeaders = ['Invoice Number', 'Invoice Date', 'Customer', 'Method', 'Amount (₹)', 'Weight (g)', 'Rate (₹/g)', 'Initial Payment', 'Settled At'];
  const settlements = invoices.flatMap(record => (record.payments || []).map(payment => [record.number, record.invoiceDate || record.date, record.customer, payment.method || 'amount', asNumber(payment.amount), asNumber(payment.weight), asNumber(payment.rate), Boolean(payment.initialPayment), payment.settledAt]));
  sheets.push(worksheet('Invoice Settlements', [settlementHeaders, ...settlements], [18, 16, 28, 18, 18, 16, 16, 18, 22]));

  const returnHeaders = ['Invoice Number', 'Return Note', 'Invoice Date', 'Returned At', 'Customer', 'Method', 'Amount (₹)', 'Cash Refund (₹)', 'Reason', 'Returned Items', 'Returned Metal'];
  const returns = invoices.flatMap(record => (record.returns || []).map(entry => [record.number, entry.noteNumber, record.invoiceDate || record.date, entry.savedAt, record.customer, entry.method, asNumber(entry.amount), asNumber(entry.cashRefund), entry.reason, entry.items, entry.oldMetal]));
  sheets.push(worksheet('Returns', [returnHeaders, ...returns], [18, 18, 16, 22, 28, 18, 18, 18, 36, 48, 36]));

  sheets.push(worksheet('Stock', [['Stock ID', 'Item', 'Purity', 'Quantity (pcs)', 'Gross Wt (g)', 'Net Wt (g)', 'Added'], ...stock.map(item => [item.id, item.item, item.purity, asNumber(item.qty), asNumber(item.gross), asNumber(item.net), item.added])], [22, 34, 16, 16, 18, 18, 28]));
  sheets.push(worksheet('Item Catalog', [['Item ID', 'Item', 'HSN', 'Category', 'Purity', 'Making (%)'], ...catalog.map(item => [item.id, item.name, item.hsn, item.category, item.purity, asNumber(item.making)])], [22, 34, 14, 24, 16, 16]));
  sheets.push(worksheet('Purchases', [['Purchase ID', 'Date', 'Metal', 'Weight (g)', 'Rate (₹/g)', 'Amount (₹)'], ...purchases.map(item => [item.id, item.savedAt, item.metal, asNumber(item.weight), asNumber(item.rate), asNumber(item.amount)])], [24, 22, 14, 16, 16, 18]));
  sheets.push(worksheet('Payments', [['Payment ID', 'Date', 'Type', 'Reason', 'Metal', 'Weight (g)', 'Purity (%)', 'Fine Weight (g)', 'Amount (₹)'], ...payments.map(item => [item.id, item.savedAt, item.type, item.reason, item.metal, asNumber(item.weight), asNumber(item.purity), asNumber(item.fineWeight), asNumber(item.amount)])], [24, 22, 18, 40, 14, 16, 16, 18, 18]));
  sheets.push(worksheet('Old Metal Ledger', [['Source ID', 'Received At', 'Date', 'Metal', 'Source', 'Invoice', 'Customer', 'Weight (g)', 'Rate (₹/g)', 'Value (₹)'], ...ledger.map(item => [item.sourceId, item.receivedAt, item.date, item.metal, item.source, item.invoice, item.customer, asNumber(item.weight), asNumber(item.rate), asNumber(item.value)])], [38, 22, 16, 14, 28, 18, 28, 16, 16, 18]));

  const business = data['business-info'] && typeof data['business-info'] === 'object' ? data['business-info'] : {};
  sheets.push(worksheet('Business Profile', [['Field', 'Value'], ...Object.entries(business).map(([key, value]) => [key, asText(value)])], [24, 52]));
  sheets.push(worksheet('System Data', [['Saved Data Key', 'Value'], ...Object.entries(data).filter(([key]) => !REQUIRED_KEYS.has(key)).map(([key, value]) => [key, asText(value)])], [32, 52]));

  const completeDataRows = [['Saved Data Key', 'Record', 'Part', 'Parts', 'Complete JSON Data']];
  for (const [key, value] of Object.entries(data)) {
    const records = Array.isArray(value) ? value : [value];
    records.forEach((record, index) => {
      const json = JSON.stringify(record);
      const parts = [];
      for (let offset = 0; offset < json.length;) {
        let end = Math.min(offset + 30000, json.length);
        if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1]) && /[\uDC00-\uDFFF]/.test(json[end])) end--;
        parts.push(json.slice(offset, end));
        offset = end;
      }
      if (!parts.length) parts.push('null');
      parts.forEach((part, partIndex) => completeDataRows.push([key, index + 1, partIndex + 1, parts.length, part]));
    });
  }
  sheets.push(worksheet('Complete Data', completeDataRows, [32, 12, 10, 10, 52]));

  const fileEntries = [
    ['[Content_Types].xml', contentTypes(sheets.length)],
    ['_rels/.rels', rootRelationships()],
    ['xl/workbook.xml', workbookXml(sheets)],
    ['xl/_rels/workbook.xml.rels', workbookRelationships(sheets.length)],
    ['xl/styles.xml', stylesXml()]
  ];
  sheets.forEach((sheet, index) => fileEntries.push(['xl/worksheets/sheet' + (index + 1) + '.xml', sheetXml(sheet.rows, sheet.widths, sheet.cellStyles, sheet.autoFilter)]));
  return createZip(fileEntries);
}

function contentTypes(count) {
  const overrides = Array.from({ length: count }, (_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + overrides + '</Types>';
}

function rootRelationships() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
}

function workbookXml(sheets) {
  const sheetEntries = sheets.map((sheet, index) => '<sheet name="' + escapeXml(sheet.name) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + sheetEntries + '</sheets><calcPr calcId="191029"/></workbook>';
}

function workbookRelationships(count) {
  const entries = Array.from({ length: count }, (_, index) => '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + entries + '<Relationship Id="rId' + (count + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0.00;[Red]-&quot;₹&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000;[Red]-#,##0.000"/><numFmt numFmtId="166" formatCode="#,##0.00;[Red]-#,##0.00"/></numFmts>' +
    '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="15"/><name val="Arial"/></font><font><b/><color rgb="FF302719"/><sz val="10"/><name val="Arial"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF302719"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5E8C8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xEDB88320 : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of files) {
    const fileName = Buffer.from(name, 'utf8');
    const uncompressed = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034B50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(uncompressed.length, 22); header.writeUInt16LE(fileName.length, 26);
    localParts.push(header, fileName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += header.length + fileName.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

module.exports = { buildSystemExport };
