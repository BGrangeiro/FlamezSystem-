import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureStorage, inspectStorage, readJson, writeJson, readJsonFile, writeJsonFile, readBusinessData, writeBusinessData, BUSINESS_FILES } from '../lib/storage.js';
import { databasePath } from '../lib/database.js';
import { migrateToSqlite } from '../scripts/migrate-sqlite.js';
import { createBackup, restoreBackup } from '../scripts/backup.js';
import { verifyBackup, checksum } from '../lib/backup.js';
import { acquireLock } from '../lib/lock.js';
import { emptyBambuUsage } from '../lib/bambu-usage.js';

const fixture = () => mkdtemp(path.join(tmpdir(), 'flamez-sqlite-'));
async function cleanup(directory) {
  assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'flamez-sqlite-'));
  await rm(directory, { recursive: true, force: true });
}
function values() {
  return {
    'sheets.local.json': { version: 1, sheets: { companyExpenses: { rows: [{ rowNumber: 2, data: { Descrição: 'Peça ção 🧵', 'Valor (R$)': '125.90', Observações: 'linha 1\nlinha 2', Foto: 'data:image/png;base64,AAAA' } }] }, encomendas: { rows: [{ rowNumber: 2, data: { 'Quantidade de itens': '10', _deliveries: '[{"id":"entrega-1","date":"2026-09-17","quantity":3}]' } }] } } },
    'product-costs.local.json': { 'sku:A01': { quantity: '2', total: 0.1, note: 'Observação', nested: { enabled: true, nothing: null } } },
    'access.local.json': { version: 1, credentialId: 'test', addresses: {}, events: [] },
    'bambu-usage.local.json': emptyBambuUsage()
  };
}

test('SQLite migration preserves all values, original JSON, safety copies and external session files', async () => {
  const directory = await fixture();
  try {
    const expected = values();
    for (const [name, value] of Object.entries(expected)) await writeJsonFile(path.join(directory, name), value);
    await writeJsonFile(path.join(directory, 'bambu-session.local.json'), { encrypted: 'session-test' });
    const migrated = await migrateToSqlite(directory);
    assert.equal(migrated.records, 4);
    for (const name of BUSINESS_FILES) assert.equal(await readFile(path.join(migrated.safety, name), 'utf8'), await readFile(path.join(directory, name), 'utf8'));
    await assert.rejects(readJson(path.join(directory, BUSINESS_FILES[0]), {}), /STORAGE_BACKEND=sqlite/);
    configureStorage({ backend: 'sqlite', dataDir: directory });
    assert.deepEqual(await readBusinessData(directory), expected);
    await writeJson(path.join(directory, 'product-costs.local.json'), { changed: { total: '543.21' } });
    assert.deepEqual(await readJson(path.join(directory, 'product-costs.local.json'), {}), { changed: { total: '543.21' } });
    assert.deepEqual(await readJsonFile(path.join(directory, 'product-costs.local.json'), {}), expected['product-costs.local.json']);
    await writeJson(path.join(directory, 'bambu-session.local.json'), { encrypted: 'new-session' });
    assert.deepEqual(await readJsonFile(path.join(directory, 'bambu-session.local.json'), {}), { encrypted: 'new-session' });
    assert.deepEqual(await inspectStorage({ backend: 'sqlite', dataDir: directory }), { backend: 'sqlite', databaseExists: true, records: 4 });
    await assert.rejects(migrateToSqlite(directory), /Já existe/);
  } finally { await cleanup(directory); }
});

test('SQLite refuses implicit migration and corrupt legacy data without hiding original files', async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, BUSINESS_FILES[0]), '{invalid');
    configureStorage({ backend: 'sqlite', dataDir: directory });
    await assert.rejects(inspectStorage({ backend: 'sqlite', dataDir: directory }), /db:migrate/);
    await assert.rejects(readJson(path.join(directory, BUSINESS_FILES[0]), {}), /db:migrate/);
    await assert.rejects(writeJson(path.join(directory, BUSINESS_FILES[0]), { sheets: {} }), /db:migrate/);
    assert.equal(existsSync(databasePath(directory)), false);
    await assert.rejects(migrateToSqlite(directory), /Arquivo de dados inválido/);
    assert.equal(existsSync(databasePath(directory)), false);
    assert.equal(await readFile(path.join(directory, BUSINESS_FILES[0]), 'utf8'), '{invalid');
    const copies = await readdir(path.join(directory, 'backups'));
    assert.equal(await readFile(path.join(directory, 'backups', copies[0], BUSINESS_FILES[0]), 'utf8'), '{invalid');
    assert.equal(existsSync(path.join(directory, '.flamez.lock')), false);
  } finally { await cleanup(directory); }
});

test('SQLite migration requires the server lock and never changes an active data directory', async () => {
  const directory = await fixture();
  try {
    await writeJsonFile(path.join(directory, BUSINESS_FILES[0]), values()[BUSINESS_FILES[0]]);
    const release = await acquireLock(directory);
    try { await assert.rejects(migrateToSqlite(directory), /em uso/); }
    finally { await release(); }
    assert.equal(existsSync(databasePath(directory)), false);
    assert.equal(existsSync(path.join(directory, 'backups')), false);
  } finally { await cleanup(directory); }
});

test('SQLite backups restore across backends and commit all business records atomically', async () => {
  const directory = await fixture(), other = await fixture();
  try {
    configureStorage({ backend: 'sqlite', dataDir: directory });
    const initial = values();
    await writeBusinessData(directory, initial);
    const backup = await createBackup(directory);
    const verified = await verifyBackup(backup);
    assert.equal(verified.data.records.sheets.companyExpenses.rows[0].data['Valor (R$)'], '125.90');
    assert.equal(existsSync(path.join(directory, BUSINESS_FILES[0])), false);
    await restoreBackup(other, backup);
    assert.deepEqual(await readBusinessData(other), initial);
    const changed = { ...initial, 'product-costs.local.json': { altered: { amount: '7' } } };
    await writeBusinessData(directory, changed);
    const safety = await restoreBackup(directory, backup);
    assert.deepEqual(await readBusinessData(directory), initial);
    assert.deepEqual(await readJsonFile(path.join(safety, BUSINESS_FILES[1]), {}), changed[BUSINESS_FILES[1]]);

    // Simulate a real database write failure halfway through restoring four documents.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databasePath(directory));
    db.exec("CREATE TRIGGER reject_access BEFORE UPDATE ON documents WHEN NEW.name='access.local.json' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;");
    db.close();
    const modified = structuredClone(verified);
    modified.data.records.sheets.companyExpenses.rows[0].data.Descrição = 'Must roll back';
    modified.data.costs = { wrong: {} };
    modified.checksum = checksum(modified.data);
    const alternative = path.join(other, 'alternative-backup.json');
    await writeJsonFile(alternative, modified);
    await assert.rejects(restoreBackup(directory, alternative), /injected write failure/);
    assert.deepEqual(await readBusinessData(directory), initial);
    await writeFile(alternative, '{}');
    await assert.rejects(restoreBackup(directory, alternative), /checksum/);
    assert.deepEqual(await readBusinessData(directory), initial);
  } finally { await cleanup(directory); await cleanup(other); }
});

test('SQLite restore into a fresh directory works and old backups preserve current Bambu history', async () => {
  const directory = await fixture(), other = await fixture();
  try {
    await writeBusinessData(directory, values());
    const backup = await createBackup(directory);
    configureStorage({ backend: 'sqlite', dataDir: other });
    await restoreBackup(other, backup);
    assert.deepEqual(await readBusinessData(other), values());
    const old = await verifyBackup(backup);
    delete old.data.bambuUsage;
    old.checksum = checksum(old.data);
    const history = emptyBambuUsage();
    history.printers.test = { firstSeen: 1, days: { '2026-09-17': { printingMs: 1000, pausedMs: 0, observedMs: 1000, unobservedMs: 0 } } };
    await writeJson(path.join(other, BUSINESS_FILES[3]), history);
    const oldFile = path.join(directory, 'old-backup.json');
    await writeJsonFile(oldFile, old);
    await restoreBackup(other, oldFile);
    assert.deepEqual(await readJson(path.join(other, BUSINESS_FILES[3]), {}), history);
  } finally { await cleanup(directory); await cleanup(other); }
});

test('SQLite corruption never creates empty replacement records and inspection does not create a database', async () => {
  const directory = await fixture();
  try {
    configureStorage({ backend: 'sqlite', dataDir: directory });
    assert.deepEqual(await inspectStorage({ backend: 'sqlite', dataDir: directory }), { backend: 'sqlite', databaseExists: false, records: 0 });
    assert.equal(existsSync(databasePath(directory)), false);
    await writeJson(path.join(directory, BUSINESS_FILES[0]), { sheets: {} });
    await writeFile(databasePath(directory), 'broken database');
    await assert.rejects(readJson(path.join(directory, BUSINESS_FILES[0]), { sheets: {} }), /Banco SQLite inválido/);
    await assert.rejects(writeJson(path.join(directory, BUSINESS_FILES[0]), { sheets: {} }), /Banco SQLite inválido/);
    await assert.rejects(inspectStorage({ backend: 'sqlite', dataDir: directory }), /Banco SQLite inválido/);
    assert.equal(await readFile(databasePath(directory), 'utf8'), 'broken database');
    await writeFile(databasePath(directory), '');
    await assert.rejects(readJson(path.join(directory, BUSINESS_FILES[0]), {}), /Banco SQLite inválido/);
    assert.equal((await readFile(databasePath(directory))).length, 0);
  } finally { await cleanup(directory); }
});
