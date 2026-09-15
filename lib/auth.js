import {createAccessStore,clientAddress,normalizeIP} from './access-store.js';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(String(value)).digest();
const normalizeCredential = value => String(value ?? '').toLowerCase();
export const sameSecret = (a,b) => timingSafeEqual(digest(a),digest(b));
export async function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  const hash=await derive(normalizeCredential(password),salt,64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export function createAuth(config) {
  const sessions=new Map(), attempts=new Map();
  const access=createAccessStore(config);
  const enabled=Boolean(config.username), lifetime=8*60*60*1000;
  const cookieName=config.production?'__Host-flamez':'flamez_session';
  const cookie=(token,age)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.production?'; Secure':''}`;
  function token(request) {return (request.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';}
  function authenticated(request) {
    if(!enabled)return true;
    const key=digest(token(request)).toString('hex'),expires=sessions.get(key);
    if(expires && expires.until>Date.now())return true;
    sessions.delete(key);return false;
  }
  async function login(request,response,body) {
    if(!enabled)return;
    const now=Date.now(),address=clientAddress(request,config),ip=address.ip;
    for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
    const attempt=attempts.get(ip)||{count:0,until:now+15*60*1000};
    if(attempt.count>=8)throw Object.assign(new Error('Muitas tentativas. Aguarde 15 minutos.'),{statusCode:429});
    attempt.count++;attempts.set(ip,attempt);
    const [,salt,expected]=config.passwordHash.split(':');
    const actual=await derive(normalizeCredential(body.password),salt,64);
    if(!sameSecret(normalizeCredential(body.username),normalizeCredential(config.username))||!timingSafeEqual(actual,Buffer.from(expected,'hex'))) {await access.record(address,'password',false);throw Object.assign(new Error('Usuário ou senha incorretos.'),{statusCode:401});}
    attempts.delete(ip);
    await access.record(address,'password',true);
    issueSession(request,response,address.ip);
  }
  function issueSession(request,response,ip) {
    const now=Date.now();
    for(const [key,session] of sessions)if(session.until<now)sessions.delete(key);
    // Substituir uma sessão existente não deixa cookies antigos válidos.
    sessions.delete(digest(token(request)).toString('hex'));
    if(sessions.size>=1000)sessions.delete(sessions.keys().next().value);
    const value=randomBytes(32).toString('hex');sessions.set(digest(value).toString('hex'),{until:now+lifetime,ip});
    response.setHeader('Set-Cookie',cookie(value,lifetime/1000));
  }
  async function automaticLogin(request,response) {
    if(!enabled)return false;
    if(authenticated(request))return true;
    const address=clientAddress(request,config);
    if(!await access.automatic(address))return false;
    issueSession(request,response,address.ip);return true;
  }
  async function revoke(ip) {
    if(!normalizeIP(ip))throw Object.assign(new Error('IP inválido.'),{statusCode:400});
    await access.revoke(normalizeIP(ip));
    for(const [key,session] of sessions)if(session.ip===normalizeIP(ip))sessions.delete(key);
  }
  function logout(request,response) {sessions.delete(digest(token(request)).toString('hex'));response.setHeader('Set-Cookie',cookie('',0));}
  function checkMutation(request) {
    if(!['POST','PUT','PATCH','DELETE'].includes(request.method))return;
    const expected=config.origin || `http://${request.headers.host}`;
    if((enabled && request.headers.origin!==expected) || (request.headers.origin && request.headers.origin!==expected)) throw Object.assign(new Error('Origem da solicitação não permitida.'),{statusCode:403});
    if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||'')) throw Object.assign(new Error('Envie os dados no formato JSON.'),{statusCode:415});
  }
  return {enabled,authenticated,login,logout,checkMutation,automaticLogin,accesses:access.list,revoke,init:access.init,flush:access.flush};
}
