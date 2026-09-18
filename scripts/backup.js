import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { configureStorage, readBusinessData, writeBusinessData, writeJsonFile } from '../lib/storage.js';
import { acquireLock } from '../lib/lock.js';
import { backupFiles as files, emptyAccess, snapshotBackup, verifyBackup } from '../lib/backup.js';

export async function createBackup(directory, output=path.join(directory,'backups')) {
  const release=await acquireLock(directory);
  try {
    const result = await snapshotBackup(directory, output);
    if (!result) throw new Error('Não há dados para copiar neste diretório.');
    return result;
  } finally {await release();}
}
export async function restoreBackup(directory, source) {
  const backup=await verifyBackup(source);
  const release=await acquireLock(directory);
  try {
    const before = await readBusinessData(directory);
    const safety=path.join(directory,'backups','antes-restauracao-'+Date.now());
    await mkdir(safety,{recursive:true,mode:0o700});
    for (const name of files) if (before[name] !== null) await writeJsonFile(path.join(safety, name), before[name]);
    const restored = { [files[0]]: backup.data.records, [files[1]]: backup.data.costs, [files[2]]: backup.data.access || emptyAccess };
    // Older backups have no Bambu history; preserve the current history in that case.
    if (backup.data.bambuUsage) restored[files[3]] = backup.data.bambuUsage;
    // SQLite commits all documents together. JSON keeps its rollback behavior.
    await writeBusinessData(directory, restored);
    return safety;
  } finally {await release();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    if(existsSync(path.join(root,'.env')))loadEnvFile(path.join(root,'.env'));
    const directory=path.resolve(process.env.DATA_DIR||root);
    configureStorage({ backend: process.env.STORAGE_BACKEND || 'json', dataDir: directory });
    if(process.argv[2]==='verify') {
      if (!process.argv[3]) throw new Error('Use npm run backup:verify -- CAMINHO_DO_BACKUP.');
      await verifyBackup(path.resolve(process.argv[3])); console.log('Backup íntegro e compatível. Nenhum dado foi alterado.');
    } else if(process.argv[2]==='restore') {
      if(!process.argv[3] || !process.argv.includes('--confirm'))throw new Error('Use npm run restore -- CAMINHO_DO_BACKUP --confirm com o servidor parado.');
      console.log('Restaurado. Cópia anterior em: '+await restoreBackup(directory,path.resolve(process.argv[3])));
    } else console.log('Backup criado: '+await createBackup(directory,process.env.BACKUP_DIR?path.resolve(process.env.BACKUP_DIR):undefined));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
