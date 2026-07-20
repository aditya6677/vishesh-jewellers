const fs = require('node:fs');

function createJsonStore(dataFile) {
  const ensure = () => {
    fs.mkdirSync(require('node:path').dirname(dataFile), { recursive: true });
    if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '{}\n');
  };

  const read = () => {
    ensure();
    try {
      const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      // Support the original format while data is gradually written in the new shape.
      if (parsed.values && typeof parsed.values === 'object') {
        return Object.fromEntries(Object.entries(parsed.values).map(([key, value]) => {
          try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
        }));
      }
      return parsed;
    } catch {
      return {};
    }
  };

  const write = store => {
    ensure();
    const tempFile = dataFile + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(store, null, 2) + '\n');
    fs.renameSync(tempFile, dataFile);
  };

  return { ensure, read, write };
}

module.exports = { createJsonStore };
