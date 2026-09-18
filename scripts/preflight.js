import { stat, open, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { loadConfig } from '../lib/config.js';
import { readJson, inspectStorage } from '../lib/storage.js';
import { backupFiles } from '../lib/backup.js';

export async function preflight(env = process.env) {
  const errors = [], warnings = [];
  if (env.NODE_ENV !== 'production') errors.push('Defina NODE_ENV=production no servidor de hospedagem.');
  let config;
  try { config = loadConfig({ ...env, NODE_ENV: 'production' }); }
  catch (error) { errors.push(error.message); return { errors, warnings }; }
  const relative = path.relative(config.root, config.dataDir);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) errors.push('Use DATA_DIR fora da pasta do código, para preservar os dados nos deploys.');
  for (const [label, directory] of [['dados', config.dataDir], ['backups', config.backupDir]]) {
    let probe;
    try {
      const info = await stat(directory);
      if (!info.isDirectory()) throw new Error();
      probe = path.join(directory, `.flamez-preflight-${randomUUID()}.tmp`);
      const handle = await open(probe, 'wx', 0o600);
      try { await handle.writeFile('probe'); await handle.sync(); } finally { await handle.close(); }
      if (process.platform !== 'win32' && (info.mode & 0o077)) warnings.push(`Restrinja as permissões da pasta de ${label} (recomendado: 700).`);
    } catch { errors.push(`Crie a pasta de ${label} e dê permissão de escrita ao usuário do serviço.`); }
    finally { if (probe) await unlink(probe).catch(() => {}); }
  }
  try { await inspectStorage({backend: config.storageBackend, dataDir: config.dataDir}); }
  catch (error) { errors.push(error.message); }
  for (const file of config.storageBackend === 'json' ? backupFiles : []) {
    try { await readJson(path.join(config.dataDir, file), {}); }
    catch { errors.push(`Arquivo inválido: ${file}. Restaure uma cópia íntegra.`); }
  }
  const session = existsSync(path.join(config.dataDir, 'bambu-session.local.json'));
  const key = existsSync(path.join(config.dataDir, 'bambu-session.key'));
  if (session && !key) errors.push('A sessão Bambu foi copiada sem sua chave. Transfira os dois arquivos ou conecte novamente.');
  if (!config.backupHours) warnings.push('Backup automático desativado. Defina uma rotina externa antes de publicar.');
  if (!config.trustedProxyIPs.length) warnings.push('Configure o IP do proxy reverso para reconhecer corretamente os endereços dos acessos.');
  if (config.deletionPassword === '1234') warnings.push('A senha de exclusão ainda usa o valor inicial. Configure uma senha própria para produção.');
  return { errors, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
  try {
    const result = await preflight();
    result.errors.forEach(message => console.error('PENDENTE: ' + message));
    result.warnings.forEach(message => console.log('ATENÇÃO: ' + message));
    console.log(result.errors.length ? 'Configuração ainda não pronta para hospedagem.' : 'Verificação local aprovada. Valide HTTPS, persistência e conectividade Bambu no servidor escolhido.');
    process.exitCode = result.errors.length ? 1 : 0;
  } catch { console.error('Não foi possível verificar a instalação. Confira as permissões do ambiente.'); process.exitCode = 1; }
}
