  document.getElementById('paymentTbody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const payment = (await getPayments()).find(entry => entry.id === button.dataset.id);
    if (!payment) return;
    if (button.classList.contains('payment-edit')) openTransactionEditor('payment', payment);
    if (button.classList.contains('payment-delete')) openTransactionDelete('payment', payment);
  });
  document.getElementById('purchaseTbody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const purchase = (await getPurchases()).find(entry => entry.id === button.dataset.id);
    if (!purchase) return;
    if (button.classList.contains('purchase-edit')) openTransactionEditor('purchase', purchase);
    if (button.classList.contains('purchase-delete')) openTransactionDelete('purchase', purchase);
  });
