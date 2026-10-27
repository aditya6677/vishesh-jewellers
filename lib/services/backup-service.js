'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createJsonStore } = require('../json-store');
const { BackupFormat } = require('../domain/constants');

function isoWeekStamp(date = new Date()) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day - yearStart) / 86400000) + 1) / 7);
  return `${day.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

class BackupService {
  constructor({ dataFile, backupDir, encryptionKey }, { storeFactory = createJsonStore, now = () => new Date() } = {}) {
    this.dataFile = dataFile;
    this.backupDir = backupDir;
    this.encryptionKey = encryptionKey;
    this.storeFactory = storeFactory;
    this.now = now;
  }

  createPayload() {
    return {
      format: BackupFormat.ENCRYPTED,
      createdAt: this.now().toISOString(),
      encryption: 'AES-256-GCM; restore requires the existing app data key',
      encryptedStore: JSON.parse(fs.readFileSync(this.dataFile, 'utf8'))
    };
  }

  write(targetPath) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = targetPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(this.createPayload(), null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tempPath, targetPath);
  }

  createWeekly() {
    const target = path.join(this.backupDir, `Vishesh-Jewellers-Weekly-${isoWeekStamp(this.now())}.json`);
    if (!fs.existsSync(target)) this.write(target);
    const weekly = fs.readdirSync(this.backupDir).filter(name => /^Vishesh-Jewellers-Weekly-\d{4}-\d{2}\.json$/.test(name)).sort();
    weekly.slice(0, Math.max(0, weekly.length - 12)).forEach(name => fs.unlinkSync(path.join(this.backupDir, name)));
  }

  latest() {
    const names = fs.existsSync(this.backupDir)
      ? fs.readdirSync(this.backupDir).filter(name => /^Vishesh-Jewellers-(Weekly|Backup|Before-Restore)-.*\.json$/.test(name))
      : [];
    names.sort((a, b) => fs.statSync(path.join(this.backupDir, b)).mtimeMs - fs.statSync(path.join(this.backupDir, a)).mtimeMs);
    return names[0] || null;
  }

  restore(backup) {
    const encryptedStore = backup?.encryptedStore;
    if (![BackupFormat.ENCRYPTED, BackupFormat.LEGACY].includes(backup?.format) ||
        encryptedStore?.format !== 'vishesh-jewellers-encrypted-v1' || encryptedStore?.algorithm !== 'aes-256-gcm') {
      throw new Error('This is not a supported Vishesh Jewellers encrypted backup.');
    }
    const tempPath = this.dataFile + '.restore-tmp';
    try {
      fs.writeFileSync(tempPath, JSON.stringify(encryptedStore, null, 2) + '\n', { mode: 0o600 });
      this.storeFactory(tempPath, { encryptionKey: this.encryptionKey }).read();
      const baseStamp = this.now().toISOString().replace(/[:.]/g, '-');
      let stamp = baseStamp, suffix = 1;
      // Preserve every recovery point, including rapid/retried restores with
      // identical clock timestamps (and avoid target collisions on Windows).
      while (fs.existsSync(this.dataFile + '.before-restore-' + stamp) ||
             fs.existsSync(path.join(this.backupDir, 'Vishesh-Jewellers-Before-Restore-' + stamp + '.json'))) {
        stamp = baseStamp + '-' + suffix++;
      }
      this.write(path.join(this.backupDir, 'Vishesh-Jewellers-Before-Restore-' + stamp + '.json'));
      const previousPath = this.dataFile + '.before-restore-' + stamp;
      fs.renameSync(this.dataFile, previousPath);
      try { fs.renameSync(tempPath, this.dataFile); }
      catch (error) { fs.renameSync(previousPath, this.dataFile); throw error; }
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw error;
    }
  }
}

module.exports = { BackupService, isoWeekStamp };
