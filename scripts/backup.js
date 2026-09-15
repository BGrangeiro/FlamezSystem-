import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { readJson, writeJson } from '../lib/storage.js';
import { acquireLock } from '../lib/lock.js';

const files=['sheets.local.json','product-costs.local.json','access.local.json'];
const emptyAccess={version:1,credentialId:'',addresses:{},events:[]};
const checksum=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
function validate(data) {
  if(!data || !data.records?.sheets || Array.isArray(data.records.sheets) || !data.costs || typeof data.costs!=='object' || Array.isArray(data.costs)) throw new Error('Backup inválido.');
  for(const sheet of Object.values(data.records.sheets)) if(!Array.isArray(sheet.rows)||sheet.rows.some(row=>!row?.data || typeof row.data!=='object'))throw new Error('Registros inválidos no backup.');
}
export async function createBackup(directory, output=path.join(directory,'backups')) {
  const release=await acquireLock(directory);
  try {
    if(!existsSync(path.join(directory,files[0])))throw new Error('Não há dados para copiar neste diretório.');
    const data={records:await readJson(path.join(directory,files[0]),{}),costs:await readJson(path.join(directory,files[1]),{}),access:await readJson(path.join(directory,files[2]),emptyAccess)};validate(data);
    const file=path.join(output,`flamez-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
    await writeJson(file,{version:1,createdAt:new Date().toISOString(),checksum:checksum(data),data});return file;
  } finally {await release();}
}
export async function restoreBackup(directory, source) {
  const backup=await readJson(source,{});
  if(backup.version!==1||backup.checksum!==checksum(backup.data))throw new Error('Backup inválido ou checksum diferente.');
  validate(backup.data);
  const release=await acquireLock(directory);
  try {
    const before=await Promise.all(files.map(file=>readFile(path.join(directory,file)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
    const safety=path.join(directory,'backups','antes-restauracao-'+Date.now());
    await mkdir(safety,{recursive:true,mode:0o700});
    for(let i=0;i<files.length;i++)if(before[i])await writeFile(path.join(safety,files[i]),before[i],{mode:0o600});
    try {
      await writeJson(path.join(directory,files[0]),backup.data.records);
      await writeJson(path.join(directory,files[1]),backup.data.costs);
      await writeJson(path.join(directory,files[2]),backup.data.access||emptyAccess);
    } catch(error) {
      for(let i=0;i<files.length;i++) {
        if(before[i])await writeFile(path.join(directory,files[i]),before[i],{mode:0o600});
        else await unlink(path.join(directory,files[i])).catch(e=>{if(e.code!=='ENOENT')throw e;});
      }
      throw error;
    }
    return safety;
  } finally {await release();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    if(existsSync(path.join(root,'.env')))loadEnvFile(path.join(root,'.env'));
    const directory=path.resolve(process.env.DATA_DIR||root);
    if(process.argv[2]==='restore') {
      if(!process.argv[3] || !process.argv.includes('--confirm'))throw new Error('Use npm run restore -- CAMINHO_DO_BACKUP --confirm com o servidor parado.');
      console.log('Restaurado. Cópia anterior em: '+await restoreBackup(directory,path.resolve(process.argv[3])));
    } else console.log('Backup criado: '+await createBackup(directory,process.env.BACKUP_DIR?path.resolve(process.env.BACKUP_DIR):undefined));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
