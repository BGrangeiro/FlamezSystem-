import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export const BUSINESS_FILES = Object.freeze(['sheets.local.json', 'product-costs.local.json', 'access.local.json', 'bambu-usage.local.json']);
export const DATABASE_NAME = 'flamez.sqlite3';
const APPLICATION_ID = 1179405645;
const VERSION = 1;
export const databasePath = directory => path.join(path.resolve(directory), DATABASE_NAME);
const migrationError = () => new Error('Há dados JSON neste diretório. Pare o servidor e execute npm run db:migrate -- --confirm antes de usar STORAGE_BACKEND=sqlite.');
const databaseError = cause => new Error('Banco SQLite inválido ou indisponível. Verifique permissões, espaço em disco e restaure um backup íntegro.', { cause });
const legacyExists = directory => BUSINESS_FILES.some(name => existsSync(path.join(directory, name)));

function parseRecord(value, name) {
  try {
    const result = JSON.parse(value);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Objeto esperado.');
    return result;
  } catch (cause) { throw new Error(`Registro inválido no banco SQLite: ${name}. Restaure um backup.`, { cause }); }
}

function validateSchema(db) {
  if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID || db.prepare('PRAGMA user_version').get().user_version !== VERSION) throw new Error('Formato SQLite desconhecido.');
  const result = db.prepare('PRAGMA quick_check').all();
  if (result.length !== 1 || result[0].quick_check !== 'ok') throw new Error('Integridade SQLite inválida.');
  // Also rejects incomplete schemas and unexpected record names.
  for (const row of db.prepare('SELECT name, data FROM documents').all()) {
    if (!BUSINESS_FILES.includes(row.name)) throw new Error('Registro SQLite desconhecido.');
    parseRecord(row.data, row.name);
  }
}

async function openDatabase(file, { create = false, readOnly = false, migration = false } = {}) {
  const existed = existsSync(file);
  if (!existed && !create) return null;
  const directory = path.dirname(file);
  if (!existed && !migration && legacyExists(directory)) throw migrationError();
  const { DatabaseSync } = await import('node:sqlite');
  let db;
  try {
    if (!existed) mkdirSync(directory, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(file, { readOnly });
    db.exec('PRAGMA busy_timeout=5000');
    if (!existed) {
      chmodSync(file, 0o600);
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${VERSION};
        CREATE TABLE documents (name TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), updated_at TEXT NOT NULL) STRICT;`);
    }
    validateSchema(db);
    if (!readOnly) db.exec(`PRAGMA journal_mode=${migration ? 'DELETE' : 'WAL'}; PRAGMA synchronous=FULL`);
    return db;
  } catch (cause) { db?.close(); throw databaseError(cause); }
}

function readEntries(db) {
  const result = Object.fromEntries(BUSINESS_FILES.map(name => [name, null]));
  for (const row of db.prepare('SELECT name, data FROM documents').all()) result[row.name] = parseRecord(row.data, row.name);
  return result;
}

function writeEntries(db, entries) {
  // Validate and serialize every entry before starting the transaction.
  const serialized = Object.entries(entries).map(([name, value]) => {
    if (!BUSINESS_FILES.includes(name)) throw new Error('Arquivo de negócio desconhecido.');
    const json = value === null ? null : JSON.stringify(value);
    if (json !== null) parseRecord(json, name);
    return [name, json];
  });
  db.exec('BEGIN IMMEDIATE');
  try {
    const upsert = db.prepare('INSERT INTO documents (name, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at');
    const remove = db.prepare('DELETE FROM documents WHERE name=?');
    const now = new Date().toISOString();
    for (const [name, json] of serialized) {
      if (json === null) remove.run(name);
      else upsert.run(name, json, now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function readDatabase(directory) {
  const db = await openDatabase(databasePath(directory), { create: true });
  try { return readEntries(db); } finally { db.close(); }
}

export async function writeDatabase(directory, entries) {
  const db = await openDatabase(databasePath(directory), { create: true });
  try { writeEntries(db, entries); } finally { db.close(); }
}

// Migration writes a separate database and only publishes it after verification.
export async function createMigratedDatabase(file, entries) {
  if (existsSync(file)) throw new Error('O banco de destino já existe.');
  const db = await openDatabase(file, { create: true, migration: true });
  try {
    writeEntries(db, entries);
    validateSchema(db);
    const actual = readEntries(db);
    for (const name of BUSINESS_FILES) if (JSON.stringify(actual[name]) !== JSON.stringify(entries[name] ?? null)) throw new Error(`A conferência da migração falhou: ${name}.`);
  } finally { db.close(); }
}

export async function inspectDatabase(directory) {
  const file = databasePath(directory);
  if (!existsSync(file)) {
    if (legacyExists(directory)) throw migrationError();
    return { backend: 'sqlite', databaseExists: false, records: 0 };
  }
  const db = await openDatabase(file, { readOnly: true });
  try { return { backend: 'sqlite', databaseExists: true, records: Object.values(readEntries(db)).filter(value => value !== null).length }; }
  finally { db.close(); }
}
