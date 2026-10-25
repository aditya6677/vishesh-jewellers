'use strict';

const { parseIbjaRates } = require('../ibja-rates');

class MetalRatesService {
  constructor({ fetchRates = globalThis.fetch, parse = parseIbjaRates, now = Date.now, cacheMs = 60_000 } = {}) {
    this.fetchRates = fetchRates;
    this.parse = parse;
    this.now = now;
    this.cacheMs = cacheMs;
    this.cache = null;
  }

  async getRates(forceRefresh = false) {
    if (!forceRefresh && this.cache && this.now() - this.cache.fetchedAt < this.cacheMs) return this.cache.value;
    const response = await this.fetchRates('https://ibjarates.com/', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('IBJA rates unavailable');
    const value = this.parse(await response.text());
    this.cache = { fetchedAt: this.now(), value };
    return value;
  }
}

module.exports = { MetalRatesService };
