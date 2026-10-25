  const getPayments = async () => {
    const result = await window.storage.get('payment-records');
    return result ? JSON.parse(result.value) : [];
  };
  const renderPayments = async () => {
    const payments = await getPayments();
    const metalWeight = metal => payments.filter(payment => payment.type === 'metal' && payment.metal === metal).reduce((total, payment) => total + (Number(payment.weight) || 0), 0);
    document.getElementById('paymentCashTotal').textContent = money(payments.filter(payment => payment.type === 'amount' || payment.type === 'self-expense').reduce((total, payment) => total + (Number(payment.amount) || 0), 0));
    document.getElementById('paymentGoldWeight').textContent = metalWeight('gold').toFixed(3) + ' g';
    document.getElementById('paymentSilverWeight').textContent = metalWeight('silver').toFixed(3) + ' g';
    document.getElementById('paymentCount').textContent = payments.length + (payments.length === 1 ? ' payment' : ' payments');
    document.getElementById('paymentTbody').innerHTML = payments.map(payment => '<tr><td>' + safe(new Date(payment.savedAt).toLocaleDateString('en-GB')) + '</td><td>' + safe(payment.type === 'metal' ? 'Metal to Metal' : payment.type === 'self-expense' ? 'Self Expense' : 'Amount') + (payment.reason ? '<br><small style="color:var(--ivory-3);">' + safe(payment.reason) + '</small>' : '') + '</td><td>' + safe(payment.metal ? payment.metal.replace(/^./, char => char.toUpperCase()) : '—') + '</td><td>' + (payment.type === 'metal' ? (Number(payment.weight) || 0).toFixed(3) + ' g' : '—') + '</td><td>' + (payment.type === 'metal' ? (Number(payment.purity) || 0).toFixed(2) + '%' : '—') + '</td><td class="paid-amount">' + (payment.type === 'metal' ? (Number(payment.fineWeight) || 0).toFixed(3) + ' g' : '—') + '</td><td>' + (payment.type === 'metal' || !Number(payment.amount) ? '—' : money(payment.amount)) + '</td><td><button class="btn btn-ghost btn-sm payment-edit" data-id="' + safe(payment.id) + '">Edit</button> <button class="btn btn-ghost btn-sm payment-delete" data-id="' + safe(payment.id) + '">Delete</button></td></tr>').join('');
    window.refreshTablePagination('paymentTbody');
    document.getElementById('paymentsEmpty').style.display = payments.length ? 'none' : 'block';
  };
