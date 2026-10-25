  const openRecords = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('recordsTab').classList.add('active');
    document.getElementById('page-records').classList.add('active');
    await renderRecords();
  };
  const openDashboard = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('dashboardTab').classList.add('active');
    document.getElementById('page-dashboard').classList.add('active');
    await renderDashboard();
  };
  const openPurchases = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('purchasesTab').classList.add('active');
    document.getElementById('page-purchases').classList.add('active');
    await renderPurchases();
  };
  const openPayments = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('paymentsTab').classList.add('active');
    document.getElementById('page-payments').classList.add('active');
    await renderPayments();
  };
