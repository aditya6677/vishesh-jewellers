  document.getElementById('refreshLiveRates').addEventListener('click', () => renderDashboard(true));
  document.getElementById('dashboardRangeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const from = document.getElementById('dashboardFrom').value;
    const to = document.getElementById('dashboardTo').value;
    if (from && to && from > to) { showAppMessage('From date must be on or before To date.', 'error'); return; }
    dashboardRange = { from, to };
    await renderDashboard();
  });
  document.getElementById('dashboardAllTime').addEventListener('click', async () => {
    document.getElementById('dashboardRangeForm').reset(); dashboardRange = {}; await renderDashboard();
  });
