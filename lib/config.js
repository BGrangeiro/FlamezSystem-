import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {normalizeIP} from './access-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 5177);
  const host = env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
  const dataDir = path.resolve(env.DATA_DIR || root);
  const username = env.AUTH_USERNAME || '';
  const passwordHash = env.AUTH_PASSWORD_HASH || '';
  const origin = env.APP_ORIGIN || '';
  const deletionPassword = env.PRODUCTION_DELETE_PASSWORD || (production ? '' : '1234');
  const autoLoginByIP=env.AUTO_LOGIN_BY_IP==='true';
  const trustedProxyIPs=String(env.TRUSTED_PROXY_IPS||'').split(',').map(ip=>ip.trim()).filter(Boolean);
  if(trustedProxyIPs.some(ip=>!normalizeIP(ip)))throw new Error('TRUSTED_PROXY_IPS deve conter IPs de proxies confiáveis, separados por vírgula.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve estar entre 1 e 65535.');
  if (production && (!env.DATA_DIR || !path.isAbsolute(env.DATA_DIR))) throw new Error('Configure DATA_DIR com um caminho absoluto e persistente.');
  if (production && (!username || !passwordHash || !origin || deletionPassword.length < 4)) throw new Error('Configure AUTH_USERNAME, AUTH_PASSWORD_HASH, APP_ORIGIN e PRODUCTION_DELETE_PASSWORD antes de publicar.');
  if (Boolean(username) !== Boolean(passwordHash)) throw new Error('Configure usuário e hash da senha juntos.');
  if (passwordHash && !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash)) throw new Error('AUTH_PASSWORD_HASH inválido. Execute npm run credentials.');
  if (origin && (new URL(origin).origin !== origin || (production && !origin.startsWith('https://')))) throw new Error('APP_ORIGIN deve conter apenas a origem do site, com HTTPS em produção e sem barra final.');
  const relative = path.relative(path.join(root, 'public'), dataDir);
  if (!relative || (relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative))) throw new Error('DATA_DIR não pode ficar dentro de public.');
  if (!username && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Acesso pela rede exige autenticação. Configure AUTH_USERNAME e AUTH_PASSWORD_HASH.');
  return {root, production, port, host, dataDir, username, passwordHash, origin, deletionPassword,autoLoginByIP,trustedProxyIPs:trustedProxyIPs.map(normalizeIP)};
}
