'use strict';

const { parseIbjaRates } = require('../ibja-rates');
const { historyReportUrl, parseHistoryPdf, readReport } = require('../ibja-history');

class MetalRatesService {
  constructor({ fetchRates = globalThis.fetch, parse = parseIbjaRates, parseHistory = parseHistoryPdf, now = Date.now, cacheMs = 60_000 } = {}) {
    this.fetchRates = fetchRates;
    this.parse = parse;
    this.now = now;
    this.cacheMs = cacheMs;
    this.cache = null;
    this.parseHistory = parseHistory;
    this.historyCache = null;
    this.pending = null;
  }

  async getRates(forceRefresh = false) {
    // Multiple windows/refresh clicks share one bounded network/worker job.
    if (this.pending) return this.pending;
    if (!forceRefresh && this.cache && this.now() - this.cache.fetchedAt < this.cacheMs) return this.cache.value;
    const request = this.fetchCurrentRates(forceRefresh);
    this.pending = request;
    try { return await request; }
    finally { if (this.pending === request) this.pending = null; }
  }

  async fetchCurrentRates(forceRefresh) {
    const response = await this.fetchRates('https://ibjarates.com/', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('IBJA rates unavailable');
    const html = await response.text();
    const value = this.parse(html);
    const report = historyReportUrl(html);
    if (report && value.history && value.session) {
      try {
        const cached = this.historyCache;
        let quotes;
        if (!forceRefresh && cached?.url === report && cached.session === value.session && this.now() - cached.fetchedAt < 30 * 60_000) quotes = cached.quotes;
        else {
          const document = await this.fetchRates(report, { signal: AbortSignal.timeout(10000), redirect: 'error' });
          quotes = await this.parseHistory(await readReport(document), value.session);
          this.historyCache = { url: report, session: value.session, quotes, fetchedAt: this.now() };
        }
        const dateKey = date => date.split('/').reverse().join('');
        const daily = new Map(quotes.filter(quote => quote.session === value.session && dateKey(quote.quoteDate) <= value.dateKey).map(quote => [dateKey(quote.quoteDate), quote]));
        // Homepage observations always win over report duplicates.
        for (const quote of value.history) daily.set(dateKey(quote.quoteDate), quote);
        value.history = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-31).map(([, quote]) => quote);
      } catch (_) { /* Keep valid homepage quotes when optional history is unavailable. */ }
    }
    this.cache = { fetchedAt: this.now(), value };
    return value;
  }
}

module.exports = { MetalRatesService };
