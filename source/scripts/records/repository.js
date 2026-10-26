  const getRecords = async () => {
    const response = await fetch('/api/records', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load invoice records.');
    recordVersions = result.versions;
    return result.items;
  };
  let recordVersions = {};
  const money = value => '₹' + amount(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getOldGold = async () => {
    const result = await window.storage.get('old-gold-records');
    return result ? JSON.parse(result.value) : [];
  };
