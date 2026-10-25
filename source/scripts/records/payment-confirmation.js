  const fullyPaidModal = document.createElement('div');
  fullyPaidModal.id = 'fullyPaidModal';
  fullyPaidModal.className = 'modal-backdrop';
  fullyPaidModal.innerHTML = '<div class="modal" style="max-width:450px;"><div class="toolbar"><h3 style="margin:0;">Confirm payment</h3><button class="btn btn-ghost btn-sm" id="closeFullyPaid">Close</button></div><p class="void-modal-note" id="fullyPaidNote"></p><div class="paid-confirm-amount" id="fullyPaidAmount">₹0.00</div><p class="void-modal-note">This will mark the invoice as fully paid and cannot be changed from this screen.</p><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="confirmFullyPaid">Yes, mark fully paid</button><button class="btn btn-ghost" id="cancelFullyPaid">Cancel</button></div></div>';
  document.body.appendChild(fullyPaidModal);
  let fullyPaidResolver = null;
  const closeFullyPaidModal = confirmed => {
    fullyPaidModal.classList.remove('open');
    const resolve = fullyPaidResolver;
    fullyPaidResolver = null;
    if (resolve) resolve(Boolean(confirmed));
  };
  const confirmFullyPaid = (record, due) => new Promise(resolve => {
    fullyPaidResolver = resolve;
    document.getElementById('fullyPaidNote').textContent = 'Mark invoice ' + record.number + ' as fully paid?';
    document.getElementById('fullyPaidAmount').textContent = money(due);
    fullyPaidModal.classList.add('open');
  });
  document.getElementById('closeFullyPaid').addEventListener('click', () => closeFullyPaidModal(false));
  document.getElementById('cancelFullyPaid').addEventListener('click', () => closeFullyPaidModal(false));
  document.getElementById('confirmFullyPaid').addEventListener('click', () => closeFullyPaidModal(true));
