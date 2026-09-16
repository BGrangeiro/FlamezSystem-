import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJson } from '../lib/storage.js';
import { snapshotBackup, verifyBackup, pruneAutomaticBackups, createBackupScheduler } from '../lib/backup.js';
import { loadConfig } from '../lib/config.js';
import { preflight } from '../scripts/preflight.js';

const fixture = () => mkdtemp(path.join(tmpdir(), 'flamez-hosting-'));
async function cleanup(dir) { assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'flamez-hosting-')); await rm(dir, { recursive: true, force: true }); }

test('online snapshot verifies all business records and excludes Bambu credentials', async () => {
  const dir = await fixture();
  try {
    await writeJson(path.join(dir, 'sheets.local.json'), { sheets: { maquinas: { rows: [{ data: { _bambuJobs: '{"job":{"hours":3}}' } }] } } });
    await writeJson(path.join(dir, 'bambu-session.local.json'), { token: 'must-not-export' });
    const file = await snapshotBackup(dir, path.join(dir, 'backups'), true);
    const backup = await verifyBackup(file);
    assert.equal(backup.data.records.sheets.maquinas.rows[0].data._bambuJobs, '{"job":{"hours":3}}');
    assert.ok(backup.data.bambuUsage); assert.ok(!JSON.stringify(backup).includes('must-not-export'));
    await writeFile(file, '{}'); await assert.rejects(verifyBackup(file), /checksum/);
  } finally { await cleanup(dir); }
});

test('retention removes only old automatic backups and scheduler prevents overlap', async () => {
  const dir = await fixture();
  try {
    for (const day of ['01','02','03']) await writeFile(path.join(dir, `flamez-auto-2026-01-${day}T00-00-00-000Z.json`), '{}');
    await writeFile(path.join(dir, 'flamez-2026-01-01T00-00-00-000Z.json'), '{}');
    await mkdir(path.join(dir, 'antes-restauracao-123'));
    await pruneAutomaticBackups(dir, 2);
    assert.equal((await readdir(dir)).length, 4);
    let release, calls = 0, cancelled = false;
    const scheduler = createBackupScheduler({ hours: 24, keep: 2, output: dir,
      run: () => { calls++; return new Promise(resolve => { release = resolve; }); }, schedule: () => 1, cancel: () => { cancelled = true; } });
    scheduler.start(); await Promise.resolve(); scheduler.tick(); assert.equal(calls, 1);
    release(null); await scheduler.stop(); assert.ok(cancelled);
    await scheduler.tick(); assert.equal(calls, 1);
  } finally { await cleanup(dir); }
});

test('hosting configuration validates backup settings and preflight uses no secret output', async () => {
  assert.throws(() => loadConfig({ BACKUP_INTERVAL_HOURS: '-1' }), /BACKUP_INTERVAL/);
  assert.throws(() => loadConfig({ BACKUP_KEEP: '0' }), /BACKUP_KEEP/);
  assert.throws(() => loadConfig({ BACKUP_DIR: path.join(loadConfig({}).root, 'public', 'backups') }), /public/);
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, 'backups'));
    const env = { NODE_ENV: 'production', DATA_DIR: dir, APP_ORIGIN: 'https://flamez.example', AUTH_USERNAME: 'owner', AUTH_PASSWORD_HASH: `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`, PRODUCTION_DELETE_PASSWORD: '9876' };
    assert.equal(loadConfig(env).backupHours, 24);
    assert.deepEqual((await preflight(env)).errors, []);
    await writeFile(path.join(dir, 'bambu-session.local.json'), '{}');
    assert.match((await preflight(env)).errors.join(' '), /chave/);
    const bad = await preflight({}); assert.ok(bad.errors.length > 0);
    assert.ok(!JSON.stringify(bad).includes(env.AUTH_PASSWORD_HASH));
    assert.equal((await readdir(dir)).filter(name => name.includes('preflight')).length, 0);
  } finally { await cleanup(dir); }
});
