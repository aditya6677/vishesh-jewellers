function parseIbjaRates(html) {
  const quotes = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(cell => ({
      label: (cell[1].match(/data-label=["']([^"']+)["']/i) || [])[1],
      text: cell[2].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
    }));
    const date = cells.find(cell => ['AM', 'PM'].includes(cell.label) && /^\d{2}\/\d{2}\/\d{4}$/.test(cell.text));
    const value = label => Number((cells.find(cell => cell.label === label)?.text || '').replace(/,/g, ''));
    const gold = value('Gold 999'), silver = value('Silver 999');
    if (!date || !(gold > 0) || !(silver > 0) || !Number.isFinite(gold + silver)) continue;
    const [day, month, year] = date.text.split('/');
    quotes.push({ source: 'IBJA', sourceUrl: 'https://ibjarates.com/', quoteDate: date.text, dateKey: year + month + day, session: date.label, goldPerGram: gold / 10, silverPerGram: silver / 1000, excludesGst: true });
  }
  quotes.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.session.localeCompare(a.session));
  if (!quotes.length) throw new Error('No valid dated IBJA gold/silver quote available');
  const latest = quotes[0];
  const previous = quotes.find(quote => quote.session === latest.session && quote.dateKey < latest.dateKey);
  const percentChange = (current, prior) => prior > 0 ? ((current - prior) / prior) * 100 : null;
  return {
    ...latest,
    previousQuote: previous ? {
      quoteDate: previous.quoteDate,
      session: previous.session,
      goldPerGram: previous.goldPerGram,
      silverPerGram: previous.silverPerGram
    } : null,
    goldChangePercent: previous ? percentChange(latest.goldPerGram, previous.goldPerGram) : null,
    silverChangePercent: previous ? percentChange(latest.silverPerGram, previous.silverPerGram) : null
  };
}
module.exports = { parseIbjaRates };
