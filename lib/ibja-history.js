'use strict';

const { Worker } = require('node:worker_threads');
const path = require('node:path');

function historyReportUrl(html) {
  const link = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .find(match => /Previous\s+30\s+Days/i.test(match[2]));
  if (!link) return null;
  const url = new URL(link[1].replace(/&amp;/g, '&'), 'https://ibjarates.com/');
  return url.origin === 'https://ibjarates.com' && /^\/UploadedFiles\/30DaysPdf\/[^/]+\.pdf$/i.test(url.pathname) && !url.search ? url.href : null;
}

function parseHistoryText(text, session) {
  if (!['AM', 'PM'].includes(session)) throw new Error('Invalid quote session');
  const compact = text.replace(/\s+/g, '');
  if (!/Gold999\(AMPrice\)Gold999\(PMPrice\)/i.test(compact) || !/Silver999\(AMPrice\)Silver999\(PMPrice\)/i.test(compact)) throw new Error('Unrecognized IBJA report columns');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const result = [];
  for (const row of text.matchAll(/\b(\d{2})-([A-Za-z]{3})-(\d{2}|\d{4})\b([\s\S]*?)(?=\b\d{2}-[A-Za-z]{3}-\d{2}(?:\d{2})?\b|$)/g)) {
    const month = months.findIndex(value => value.toLowerCase() === row[2].toLowerCase());
    const year = row[3].length === 2 ? 2000 + Number(row[3]) : Number(row[3]);
    const date = new Date(Date.UTC(year, month, Number(row[1])));
    if (month < 0 || date.getUTCMonth() !== month || date.getUTCDate() !== Number(row[1])) continue;
    const values = row[4].trim().split(/\s+/);
    // No interpolation, holiday substitution or guessed/misaligned columns.
    const numbers = values.slice(0, 12);
    if (numbers.length !== 12 || !numbers.every(value => /^\d{4,8}$/.test(value)) || /^\d+$/.test(values[12] || '')) continue;
    const offset = session === 'PM' ? 1 : 0;
    result.push({ quoteDate: `${row[1]}/${String(month + 1).padStart(2, '0')}/${year}`, session, goldPerGram: Number(numbers[offset]) / 10, silverPerGram: Number(numbers[10 + offset]) / 1000 });
  }
  if (!result.length) throw new Error('No valid IBJA report rows');
  return result;
}

function parseHistoryPdf(bytes, session) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'ibja-history-worker.js'), { workerData: { bytes, session }, resourceLimits: { maxOldGenerationSizeMb: 128 }, stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('IBJA history parsing timed out')); }, 8000);
    const finish = () => { clearTimeout(timer); void worker.terminate(); };
    worker.once('message', message => { finish(); message.error ? reject(new Error(message.error)) : resolve(message.quotes); });
    worker.once('error', error => { finish(); reject(error); });
    worker.once('exit', () => { clearTimeout(timer); reject(new Error('IBJA history parser stopped')); });
  });
}

async function readReport(response) {
  const limit = 2_000_000;
  if (!response.ok || Number(response.headers?.get('content-length')) > limit) throw new Error('IBJA report unavailable or too large');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('IBJA report too large');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('IBJA report is not a PDF');
  return bytes;
}

module.exports = { historyReportUrl, parseHistoryText, parseHistoryPdf, readReport };
