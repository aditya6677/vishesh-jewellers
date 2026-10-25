  ['purchaseWeight', 'purchaseRate'].forEach(id => document.getElementById(id).addEventListener('input', updatePurchaseAmount));
  document.getElementById('purchaseForm').addEventListener('submit', async event => {
    event.preventDefault();
    const metal = document.getElementById('purchaseMetal').value;
    const weight = Number(document.getElementById('purchaseWeight').value);
    const rate = Number(document.getElementById('purchaseRate').value);
    if (!(weight > 0)) { toast('Purchase weight is required and must be greater than 0.'); document.getElementById('purchaseWeight').focus(); return; }
    if (!(rate > 0)) { toast('Purchase rate per gram is required and must be greater than 0.'); document.getElementById('purchaseRate').focus(); return; }
    const purchases = await getPurchases();
    const purchase = { id: Date.now().toString(), metal, weight, rate, amount: weight * rate, savedAt: new Date().toISOString() };
    purchases.unshift(purchase);
    await originalStorageSet('purchase-records', JSON.stringify(purchases));
    await addOldGold({ sourceId: 'purchase:' + purchase.id, metal, source: 'Old metal purchase', invoice: '—', customer: '—', date: new Date(purchase.savedAt).toLocaleDateString('en-GB'), weight, rate, value: purchase.amount, receivedAt: purchase.savedAt });
    document.getElementById('purchaseWeight').value = '';
    document.getElementById('purchaseRate').value = '';
    updatePurchaseAmount();
    await renderPurchases();
  });
