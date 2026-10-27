export function calculateExchangeEntryValue(weight, rate) {
  const safeWeight = Math.max(Number(weight) || 0, 0);
  const safeRate = Math.max(Number(rate) || 0, 0);
  return safeWeight * safeRate;
}

export function calculateInvoiceExchange(entries) {
  return entries.reduce((sum, entry) => sum + calculateExchangeEntryValue(entry.weight, entry.rate), 0);
}
