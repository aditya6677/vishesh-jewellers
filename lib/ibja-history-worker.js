'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const PDFParser = require('pdf2json');
const { parseHistoryText } = require('./ibja-history');
const parser = new PDFParser();
parser.once('pdfParser_dataError', error => parentPort.postMessage({ error: 'Could not read IBJA history PDF: ' + String(error.parserError?.message || error.parserError || 'Invalid PDF') }));
parser.once('pdfParser_dataReady', data => {
  try {
    const text = data.Pages.flatMap(page => page.Texts.flatMap(item => item.R.map(run => decodeURIComponent(run.T)))).join(' ');
    parentPort.postMessage({ quotes: parseHistoryText(text, workerData.session) });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
  finally { parser.destroy(); }
});
// An unpooled buffer keeps the PDF byte offsets valid for small documents too.
const bytes = Buffer.allocUnsafeSlow(workerData.bytes.length);
bytes.set(workerData.bytes);
parser.parseBuffer(bytes);
