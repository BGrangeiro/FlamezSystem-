import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

// Um único processo pode escrever no diretório de dados.
export async function acquireLock(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'.flamez.lock');
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const handle=await open(file,'wx',0o600);
      try {await handle.writeFile(String(process.pid));} finally {await handle.close();}
      return async()=>{if(await readFile(file,'utf8').catch(()=>'')===String(process.pid))await unlink(file);};
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      const pid=Number(await readFile(file,'utf8'));
      if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Trava de dados inválida. Verifique se o servidor está parado antes de remover .flamez.lock.');
      try {process.kill(pid,0);} catch(check) {if(check.code==='ESRCH'){await unlink(file);continue;}}
      throw new Error('O diretório de dados está em uso. Pare o servidor antes de iniciar outra instância ou executar backup/restauração.');
    }
  }
  throw new Error('Não foi possível bloquear o diretório de dados.');
}
