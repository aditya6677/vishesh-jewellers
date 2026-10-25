  const updatePurchaseAmount = () => {
    const amount = Math.max(Number(document.getElementById('purchaseWeight').value) || 0, 0) * Math.max(Number(document.getElementById('purchaseRate').value) || 0, 0);
    document.getElementById('purchaseAmount').textContent = money(amount);
  };
