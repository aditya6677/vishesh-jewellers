  const addOldGold = async entry => {
    if (!entry || !Number(entry.weight)) return;
    const entries = await getOldGold();
    if (entries.some(saved => saved.sourceId === entry.sourceId)) return;
    entries.unshift(entry);
    await originalStorageSet('old-gold-records', JSON.stringify(entries));
  };
