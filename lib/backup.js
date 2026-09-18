import { createHash } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, readBusinessData, BUSINESS_FILES } from './storage.js';
import { emptyBambuUsage, validateBambuUsage } from './bambu-usage.js';

export const backupFiles = BUSINESS_FILES;
export const emptyAccess = { version: 1, credentialId: '', addresses: {}, events: [] };
export const checksum = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function validateBackupData(data) {
  if (!data || !data.records?.sheets || Array.isArray(data.records.sheets) || !data.costs || typeof data.costs !== 'object' || Array.isArray(data.costs)) throw new Error('Backup inválido.');
  for (const sheet of Object.values(data.records.sheets)) if (!Array.isArray(sheet.rows) || sheet.rows.some(row => !row?.data || typeof row.data !== 'object')) throw new Error('Registros inválidos no backup.');
  if (data.bambuUsage) validateBambuUsage(data.bambuUsage);
}
export async function verifyBackup(file) {
  const backup = await readJson(file, {});
  if (backup.version !== 1 || backup.checksum !== checksum(backup.data)) throw new Error('Backup inválido ou checksum diferente.');
  validateBackupData(backup.data);
  return backup;
}
// Caller owns the data-directory lock and serializes business writes.
export async function snapshotBackup(directory, output, automatic = false) {
  const values = await readBusinessData(directory);
  const records = values[backupFiles[0]];
  if (!records) return null;
  const data = { records, costs: values[backupFiles[1]] || {}, access: values[backupFiles[2]] || emptyAccess, bambuUsage: values[backupFiles[3]] || emptyBambuUsage() };
  validateBackupData(data);
  const createdAt = new Date().toISOString();
  const file = path.join(output, `flamez-${automatic ? 'auto-' : ''}${createdAt.replace(/[:.]/g, '-')}.json`);
  await writeJson(file, { version: 1, createdAt, checksum: checksum(data), data });
  await verifyBackup(file);
  return file;
}
export async function pruneAutomaticBackups(output, keep) {
  const names = (await readdir(output)).filter(name => /^flamez-auto-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.json$/.test(name)).sort().reverse();
  // Never prune manual backups, restore safety copies, or files outside this directory.
  for (const name of names.slice(keep)) await unlink(path.join(output, name));
}
export function createBackupScheduler({ hours, keep, run, output, onError = () => {}, schedule = setInterval, cancel = clearInterval }) {
  let timer, pending = Promise.resolve(), busy = false, stopped = false;
  const state = { enabled: hours > 0, lastSuccessAt: null, failed: false };
  const tick = () => {
    if (stopped || busy) return pending;
    busy = true;
    pending = Promise.resolve().then(run).then(async file => {
      if (file) { await pruneAutomaticBackups(output, keep); state.lastSuccessAt = new Date().toISOString(); state.failed = false; }
    }).catch(error => { state.failed = true; onError(error); }).finally(() => { busy = false; });
    return pending;
  };
  return {
    start() { if (!state.enabled || timer) return; timer = schedule(tick, hours * 3600000); timer?.unref?.(); void tick(); },
    async stop() { stopped = true; cancel(timer); await pending; },
    status: () => ({ ...state }),
    tick
  };
}
