import { randomBytes } from 'node:crypto';
import { hashPassword } from '../lib/auth.js';
const password=randomBytes(24).toString('base64url');
console.log('Guarde a senha abaixo em um gerenciador de senhas. Ela não será salva em arquivo.');
console.log('Senha de acesso: '+password);
console.log('AUTH_PASSWORD_HASH='+await hashPassword(password));
console.log('PRODUCTION_DELETE_PASSWORD='+randomBytes(8).toString('hex'));
