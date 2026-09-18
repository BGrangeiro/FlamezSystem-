import { copyFile, mkdir, rename, unlink, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { acquireLock } from '../lib/lock.js';
import { readJsonFile } from '../lib/storage.js';
import { BUSINESS_FILES, databasePath, createMigratedDatabase, inspectDatabase } from '../lib/database.js';
import { emptyAccess, validateBackupData } from '../lib/backup.js';
import { emptyBambuUsage } from '../lib/bambu-usage.js';

export async function migrateToSqlite(directory) {
  directory = path.resolve(directory);
  const release = await acquireLock(directory);
  const temporary = path.join(directory, `.flamez-migration-${randomUUID()}.sqlite3`);
  try {
    const target = databasePath(directory);
    if (existsSync(target)) throw new Error('Já existe um banco SQLite neste diretório. A migração não sobrescreve bancos existentes.');
    const present = BUSINESS_FILES.filter(name => existsSync(path.join(directory, name)));
    if (!present.length) throw new Error('Não há arquivos JSON de gestão para migrar. Em uma instalação vazia, configure STORAGE_BACKEND=sqlite e inicie o servidor.');
    const safety = path.join(directory, 'backups', `antes-sqlite-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
    await mkdir(safety, { recursive: true, mode: 0o700 });
    for (const name of present) {
      const output = path.join(safety, name);
      await copyFile(path.join(directory, name), output);
      await chmod(output, 0o600);
    }
    const values = Object.fromEntries(await Promise.all(BUSINESS_FILES.map(async name => [name, await readJsonFile(path.join(directory, name), null)])));
    validateBackupData({ records: values[BUSINESS_FILES[0]] || { sheets: {} }, costs: values[BUSINESS_FILES[1]] || {}, access: values[BUSINESS_FILES[2]] || emptyAccess, bambuUsage: values[BUSINESS_FILES[3]] || emptyBambuUsage() });
    await createMigratedDatabase(temporary, values);
    // The application lock prevents another compliant instance from publishing here.
    if (existsSync(target)) throw new Error('O banco de destino foi criado por outro processo. A migração foi interrompida.');
    await rename(temporary, target);
    await inspectDatabase(directory);
    return { database: target, safety, records: present.length };
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv.includes('--confirm')) throw new Error('Pare o servidor e execute npm run db:migrate -- --confirm com DATA_DIR apontando para os dados atuais.');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
    const result = await migrateToSqlite(process.env.DATA_DIR || root);
    console.log(`Migração conferida: ${result.records} arquivos de gestão importados.\nBanco: ${result.database}\nCópia anterior: ${result.safety}\nOs JSON originais foram preservados. Configure STORAGE_BACKEND=sqlite antes de iniciar o servidor.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
