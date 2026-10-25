  const getPurchases = async () => {
    const result = await window.storage.get('purchase-records');
    return result ? JSON.parse(result.value) : [];
  };
  const renderPurchases = async () => {
    const purchases = await getPurchases();
    const metalWeight = metal => purchases.filter(purchase => purchase.metal === metal).reduce((total, purchase) => total + (Number(purchase.weight) || 0), 0);
    document.getElementById('purchaseGoldWeight').textContent = metalWeight('gold').toFixed(3) + ' g';
    document.getElementById('purchaseSilverWeight').textContent = metalWeight('silver').toFixed(3) + ' g';
    document.getElementById('purchaseTotalValue').textContent = money(purchases.reduce((total, purchase) => total + (Number(purchase.amount) || 0), 0));
    document.getElementById('purchaseCount').textContent = purchases.length + (purchases.length === 1 ? ' purchase' : ' purchases');
    document.getElementById('purchaseTbody').innerHTML = purchases.map(purchase => '<tr><td>' + safe(new Date(purchase.savedAt).toLocaleDateString('en-GB')) + '</td><td>' + safe(String(purchase.metal || 'gold').replace(/^./, char => char.toUpperCase())) + '</td><td style="font-family:var(--font-mono); color:var(--gold-pale);">' + (Number(purchase.weight) || 0).toFixed(3) + ' g</td><td>' + money(purchase.rate) + '</td><td class="paid-amount">' + money(purchase.amount) + '</td><td><button class="btn btn-ghost btn-sm purchase-edit" data-id="' + safe(purchase.id) + '">Edit</button> <button class="btn btn-ghost btn-sm purchase-delete" data-id="' + safe(purchase.id) + '">Delete</button></td></tr>').join('');
    window.refreshTablePagination('purchaseTbody');
    document.getElementById('purchasesEmpty').style.display = purchases.length ? 'none' : 'block';
  };
