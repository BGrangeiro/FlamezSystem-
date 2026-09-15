import path from 'node:path';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {readJson,writeJson} from './storage.js';

export function normalizeIP(value) {
  const ip=String(value||'').trim().toLowerCase();
  if(ip.startsWith('::ffff:')&&isIP(ip.slice(7))===4)return ip.slice(7);
  return isIP(ip)?ip:'';
}
export function clientAddress(request,config) {
  const peer=normalizeIP(request.socket.remoteAddress);
  const forwarded=request.headers['x-forwarded-for'];
  const trusted=(config.trustedProxyIPs||[]).includes(peer);
  if(trusted){
    // O proxy único acrescenta o IP real ao final; valores anteriores podem ser enviados pelo cliente.
    const ip=normalizeIP(String(forwarded||'').split(',').at(-1));
    return {ip:ip||peer,eligible:Boolean(ip)};
  }
  // Nunca transforme o IP de um proxy não configurado em um passe para todos os visitantes.
  return {ip:peer,eligible:Boolean(peer)&&!forwarded&&!request.headers['x-forwarded-proto']&&!request.headers.forwarded};
}
export function createAccessStore(config) {
  const file=path.join(config.dataDir,'access.local.json');
  const credentialId=createHash('sha256').update(config.username+'\0'+config.passwordHash).digest('hex');
  let pending=Promise.resolve();
  const serial=task=>{const result=pending.then(task);pending=result.catch(()=>{});return result;};
  async function read() {
    const data=await readJson(file,{version:1,credentialId,addresses:{},events:[]});
    if(data.version!==1||!data.addresses||typeof data.addresses!=='object'||Array.isArray(data.addresses)||!Array.isArray(data.events))throw new Error('Registro de acessos inválido.');
    // A alteração das credenciais remove todas as autorizações de entrada automática.
    if(data.credentialId!==credentialId){data.credentialId=credentialId;data.addresses={};}
    return data;
  }
  function append(data,address,method,success) {
    const now=new Date().toISOString();
    data.events.push({at:now,ip:address.ip||'Não identificado',method,success});
    data.events=data.events.slice(-1000);
    if(!success||!address.ip)return;
    const previous=data.addresses[address.ip]||{passwordLogins:0};
    const passwordLogins=Math.min(Number(previous.passwordLogins||0)+(method==='password'&&address.eligible?1:0),4);
    data.addresses[address.ip]={...previous,passwordLogins,lastLoginAt:now,trusted:address.eligible&&passwordLogins>3};
  }
  return {
    init:()=>serial(read),
    record:(address,method,success)=>serial(async()=>{const data=await read();append(data,address,method,success);await writeJson(file,data);}),
    automatic:address=>serial(async()=>{
      const data=await read();
      if(!config.autoLoginByIP||!address.eligible||!data.addresses[address.ip]?.trusted||data.addresses[address.ip].passwordLogins<=3)return false;
      append(data,address,'automatic',true);await writeJson(file,data);return true;
    }),
    list:()=>serial(async()=>{const data=await read();return {addresses:Object.entries(data.addresses).map(([ip,record])=>({ip,...record})).sort((a,b)=>b.lastLoginAt.localeCompare(a.lastLoginAt)),events:data.events.slice(-100).reverse()};}),
    revoke:ip=>serial(async()=>{
      const data=await read();
      if(data.addresses[ip])data.addresses[ip]={...data.addresses[ip],passwordLogins:0,trusted:false};
      data.events.push({at:new Date().toISOString(),ip,method:'revoked',success:true});data.events=data.events.slice(-1000);
      await writeJson(file,data);
    }),
    flush:()=>pending
  };
}
