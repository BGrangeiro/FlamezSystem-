import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/auth.js';

export async function setupProduction({origin, dataDir, output, username = 'Flamez3D'}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.port || !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) throw new Error('Informe a origem HTTPS de um domínio, sem caminho, porta ou barra final.');
  if (!dataDir || !path.isAbsolute(dataDir) || /[\r\n\0"\\]/.test(dataDir)) throw new Error('Informe DATA_DIR absoluto; no Windows use barras /.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(username)) throw new Error('Usuário deve conter somente letras, números, _ ou -.');
  const password = randomBytes(24).toString('base64url');
  const deletionPassword = randomBytes(12).toString('hex');
  const env = [
    'NODE_ENV=production', 'HOST=0.0.0.0', 'PORT=5177', `DATA_DIR="${dataDir}"`, 'STORAGE_BACKEND=sqlite',
    `APP_ORIGIN=${origin}`, `APP_DOMAIN=${url.hostname}`, `AUTH_USERNAME=${username}`, `AUTH_PASSWORD_HASH=${await hashPassword(password)}`,
    'AUTO_LOGIN_BY_IP=false', 'TRUSTED_PROXY_IPS=172.30.77.2', `PRODUCTION_DELETE_PASSWORD=${deletionPassword}`,
    'BACKUP_INTERVAL_HOURS=24', 'BACKUP_KEEP=30', ''
  ].join('\n');
  await mkdir(path.dirname(path.resolve(output)), {recursive: true, mode: 0o700});
  await writeFile(output, env, {flag: 'wx', mode: 0o600});
  return {username, password, deletionPassword};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
    if (!value('--origin')) throw new Error('Use npm run setup:production -- --origin https://sistema.seudominio.com --data-dir /var/lib/flamez --output .env');
    const credentials = await setupProduction({origin: value('--origin'), dataDir: value('--data-dir') || '/var/lib/flamez', output: value('--output') || '.env', username: value('--username') || 'Flamez3D'});
    console.log('Configuração criada para compose.hostinger.yaml. Um arquivo existente nunca é sobrescrito.');
    console.log('Guarde estas credenciais no seu gerenciador de senhas:');
    console.log('Usuário: ' + credentials.username);
    console.log('Senha de acesso: ' + credentials.password);
    console.log('Senha de exclusão de produção: ' + credentials.deletionPassword);
    console.log('A senha de acesso foi salva somente como hash. Não publique o arquivo .env.');
  } catch (error) { console.error(error.code === 'EEXIST' ? 'O arquivo de configuração já existe. Preserve as credenciais atuais.' : error.message); process.exitCode = 1; }
}
