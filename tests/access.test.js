import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAuth,hashPassword} from '../lib/auth.js';
import {clientAddress} from '../lib/access-store.js';

const request=(ip='198.51.100.24',headers={})=>({socket:{remoteAddress:ip},headers});
const response=()=>({headers:{},setHeader(key,value){this.headers[key]=value;}});
test('login ignora maiúsculas e minúsculas, mas exige os mesmos caracteres',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'flamez-access-'));
  try {
    const auth=createAuth({dataDir:dir,username:'ContaTeste',passwordHash:await hashPassword('SeNhA-42!')});
    for(const [username,password] of [['contateste','senha-42!'],['CONTATESTE','SENHA-42!'],['CoNtAtEsTe','sEnHa-42!']]){
      const reply=response();
      await auth.login(request(),reply,{username,password});
      assert.equal(auth.authenticated(request(undefined,{cookie:reply.headers['Set-Cookie'].split(';')[0]})),true);
    }
    for(const [username,password] of [['ContaTest','senha-42!'],['ContaTeste','senha-43!'],['ContaTeste',' senha-42!'],['ContaTeste','sénha-42!']]){
      await assert.rejects(auth.login(request(),response(),{username,password}),/incorretos/);
    }
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'flamez-access-'));await rm(dir,{recursive:true,force:true});}
});

test('IP é liberado após quatro logins corretos e continua salvo após reiniciar',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'flamez-access-'));
  try {
    const config={dataDir:dir,username:'teste',passwordHash:await hashPassword('senha-teste'),autoLoginByIP:true};
    let auth=createAuth(config);
    await auth.init();
    await assert.rejects(auth.login(request(),response(),{username:'teste',password:'errada'}),/incorretos/);
    assert.equal((await auth.accesses()).addresses.length,0);
    for(let n=1;n<=3;n++){
      await auth.login(request(),response(),{username:'teste',password:'senha-teste'});
      assert.equal(await auth.automaticLogin(request(),response()),false);
      assert.equal((await auth.accesses()).addresses[0].passwordLogins,n);
    }
    await auth.login(request(),response(),{username:'teste',password:'senha-teste'});
    auth=createAuth(config);await auth.init();
    const automatic=response();assert.equal(await auth.automaticLogin(request('::ffff:198.51.100.24'),automatic),true);
    const cookie=automatic.headers['Set-Cookie'].split(';')[0];
    assert.equal(auth.authenticated(request('198.51.100.24',{cookie})),true);
    assert.equal((await auth.accesses()).addresses[0].passwordLogins,4);
    assert.equal(await auth.automaticLogin(request('198.51.100.25'),response()),false);
    assert.equal(await auth.automaticLogin(request('198.51.100.25',{'x-forwarded-for':'198.51.100.24'}),response()),false);
    const changed=createAuth({...config,passwordHash:await hashPassword('nova-senha')});
    assert.equal(await changed.automaticLogin(request(),response()),false);
    await auth.revoke('198.51.100.24');
    assert.equal(auth.authenticated(request('198.51.100.24',{cookie})),false);
    assert.equal(await auth.automaticLogin(request(),response()),false);
    assert.equal((await auth.accesses()).addresses[0].passwordLogins,0);
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'flamez-access-'));await rm(dir,{recursive:true,force:true});}
});

test('contagem simultânea é preservada e proxies precisam de configuração explícita',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'flamez-access-'));
  try{
    const config={dataDir:dir,username:'teste',passwordHash:await hashPassword('senha-teste'),autoLoginByIP:true,trustedProxyIPs:['127.0.0.1']};
    const auth=createAuth(config);
    const proxied=request('127.0.0.1',{'x-forwarded-for':'203.0.113.50, 198.51.100.24'});
    assert.deepEqual(clientAddress(proxied,config),{ip:'198.51.100.24',eligible:true});
    assert.equal(clientAddress(proxied,{}).eligible,false);
    assert.equal(clientAddress(request('127.0.0.1'),config).eligible,false);
    await Promise.all(Array.from({length:4},()=>auth.login(proxied,response(),{username:'teste',password:'senha-teste'})));
    assert.equal((await auth.accesses()).addresses[0].passwordLogins,4);
    assert.equal(await auth.automaticLogin(proxied,response()),true);
    assert.equal(await createAuth({...config,autoLoginByIP:false}).automaticLogin(proxied,response()),false);
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'flamez-access-'));await rm(dir,{recursive:true,force:true});}
});
