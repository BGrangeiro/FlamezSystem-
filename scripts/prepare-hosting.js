import { cp, lstat, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['server.js','package.json','package-lock.json','README.md','.env.example','.dockerignore','Dockerfile','compose.yaml','compose.hostinger.yaml'];
const sourceDirs = ['public','lib','scripts','tests','deploy','docs'];
const blocked = name => name === '.env' || name.startsWith('.env.') && name !== '.env.example' || /\.(?:local\.json|key|pem|p12|pfx|sqlite3(?:-.*)?|log)$/.test(name);
async function validateSource(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (entry.isSymbolicLink() || blocked(entry.name)) throw new Error('Arquivo privado ou link inesperado na pasta de código: ' + entry.name);
    if (entry.isDirectory()) await validateSource(path.join(directory, entry.name));
  }
}
const staging = await mkdtemp(path.join(tmpdir(), 'flamez-release-'));
try {
  for (const name of sourceFiles) {
    if ((await lstat(path.join(root,name))).isSymbolicLink()) throw new Error('Link não permitido no pacote.');
    await cp(path.join(root,name),path.join(staging,name));
  }
  for (const name of sourceDirs) { await validateSource(path.join(root,name)); await cp(path.join(root,name),path.join(staging,name),{recursive:true}); }
  const output = path.join(root,'artifacts','hostinger'); await mkdir(output,{recursive:true});
  const file = path.join(output,'flamez-app.tar.gz');
  const result = spawnSync('tar',['-czf',file,'-C',staging,'.'],{stdio:'inherit'});
  if (result.error || result.status !== 0) throw new Error('Não foi possível criar o pacote. Instale/disponibilize tar no PATH.');
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  await writeFile(file+'.sha256', digest+'  flamez-app.tar.gz\n');
  console.log('Pacote de código: '+file);
  console.log('SHA-256: '+digest);
  console.log('Dados reais, senhas e sessão Bambu NÃO estão no pacote. Transfira o backup separadamente.');
} finally {
  if (!path.resolve(staging).startsWith(path.resolve(tmpdir())+path.sep+'flamez-release-')) throw new Error('Pasta temporária inesperada.');
  await rm(staging,{recursive:true,force:true});
}
