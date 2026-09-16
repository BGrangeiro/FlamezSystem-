import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {loadConfig} from '../lib/config.js';
import {readJson,writeJson} from '../lib/storage.js';
import {acquireLock} from '../lib/lock.js';
import {hashPassword} from '../lib/auth.js';
import {createBackup,restoreBackup} from '../scripts/backup.js';

async function fixture(){return mkdtemp(path.join(tmpdir(),'flamez-deploy-'));}
async function cleanup(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'flamez-deploy-'));await rm(dir,{recursive:true,force:true});}

test('configuração bloqueia publicação sem credenciais e dados expostos',()=>{
  assert.throws(()=>loadConfig({NODE_ENV:'production'}),/DATA_DIR/);
  assert.throws(()=>loadConfig({HOST:'0.0.0.0'}),/autenticação/);
  const root=loadConfig({}).root;
  assert.throws(()=>loadConfig({DATA_DIR:path.join(root,'public')}),/public/);
  assert.equal(loadConfig({}).host,'127.0.0.1');
  assert.equal(loadConfig({}).deletionPassword,'1234');
});

test('dados corrompidos não são substituídos por cadastros vazios',async()=>{
  const dir=await fixture();
  try {const file=path.join(dir,'data.json');await writeFile(file,'{corrompido');await assert.rejects(readJson(file,{}),/inválido/);assert.equal(await readFile(file,'utf8'),'{corrompido');}
  finally{await cleanup(dir);}
});

test('backup íntegro, restauração e exclusividade do diretório',async()=>{
  const dir=await fixture();
  try {
    const original={sheets:{produtos:{rows:[{rowNumber:2,data:{Produto:'Teste'}}]}}};
    await writeJson(path.join(dir,'sheets.local.json'),original);
    await writeJson(path.join(dir,'product-costs.local.json'),{'sku:01':{quantity:'10'}});
    const unlock=await acquireLock(dir);await assert.rejects(createBackup(dir),/em uso/);await unlock();
    const backup=await createBackup(dir);
    await writeJson(path.join(dir,'sheets.local.json'),{sheets:{}});
    await restoreBackup(dir,backup);
    assert.deepEqual(await readJson(path.join(dir,'sheets.local.json'),{}),original);
    const corrupt=await readJson(backup,{});corrupt.data.records.sheets={};await writeJson(backup,corrupt);
    await assert.rejects(restoreBackup(dir,backup),/checksum/);
    assert.deepEqual(await readJson(path.join(dir,'sheets.local.json'),{}),original);
  }finally{await cleanup(dir);}
});

test('HTTP: login, proteção de API, CSRF, limites, dados privados e logout',async()=>{
  const dir=await fixture();let child;
  try {
    for(const folder of ['lib','public'])await cp(new URL('../'+folder,import.meta.url),path.join(dir,folder),{recursive:true});
    await cp(new URL('../server.js',import.meta.url),path.join(dir,'server.js'));
    await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
    const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    const password='senha-de-teste-123456',origin='https://flamez.example';
    child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:path.join(dir,'data'),AUTH_USERNAME:'owner',AUTH_PASSWORD_HASH:await hashPassword(password),APP_ORIGIN:origin,PRODUCTION_DELETE_PASSWORD:'9876',AUTO_LOGIN_BY_IP:'true',TRUSTED_PROXY_IPS:''},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Servidor não iniciou.')),10000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Servidor saiu: '+code));});child.stdout.on('data',data=>{if(String(data).includes('iniciado')){clearTimeout(timer);resolve();}});child.stderr.on('data',data=>{clearTimeout(timer);reject(new Error(String(data)));});});
    const base='http://127.0.0.1:'+port;
    assert.equal((await fetch(base+'/healthz')).status,200);
    assert.equal((await fetch(base+'/',{redirect:'manual'})).status,302);
    assert.equal((await fetch(base+'/api/sheets')).status,401);
    assert.equal((await fetch(base+'/api/bambu/usage')).status,401);
    assert.equal((await fetch(base+'/login')).status,200);
    const headers={'content-type':'application/json',origin};
    const post=(route,body,h=headers)=>fetch(base+route,{method:'POST',headers:h,body:typeof body==='string'?body:JSON.stringify(body)});
    assert.equal((await post('/api/auth/login',{username:'owner',password:'errada'})).status,401);
    const login=await post('/api/auth/login',{username:'owner',password});assert.equal(login.status,200);
    assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict;.*Secure/);
    const cookie=login.headers.get('set-cookie').split(';')[0];headers.cookie=cookie;
    assert.equal((await fetch(base+'/api/sheets',{headers})).status,200);
    assert.deepEqual((await (await fetch(base+'/api/bambu/usage',{headers})).json()).printers,[]);
    assert.equal((await fetch(base+'/bambu-usage.local.json',{headers})).status,404);
    assert.equal((await fetch(base+'/',{headers})).headers.get('x-frame-options'),'DENY');
    for(const route of ['/sheets.local.json','/product-costs.local.json','/.env','/../server.js','/%2e%2e%2fserver.js'])assert.equal((await fetch(base+route,{headers})).status,404);
    assert.equal((await post('/api/sheets/upsert',{}, {...headers,origin:'https://outro.example'})).status,403);
    assert.equal((await post('/api/sheets/upsert','{')).status,400);
    assert.equal((await post('/api/sheets/upsert','{"__proto__":{}}')).status,400);
    assert.equal((await post('/api/sheets/upsert',{sheet:'produtos',data:{Produto:'Teste',SKU:'01'}})).status,200);
    assert.equal((await post('/api/product-costs',{productKey:'sku:01',data:{quantity:'2'}})).status,200);
    const order = await (await post('/api/sheets/upsert',{sheet:'encomendas',data:{'Nome da encomenda':'Entregas de teste','Quantidade de itens':'10'}})).json();
    const delivery = {rowNumber:order.rowNumber,id:'test-delivery-0001',date:'2026-09-16',quantity:3};
    assert.equal((await post('/api/orders/deliveries',delivery)).status,200);
    assert.equal((await post('/api/orders/deliveries',delivery)).status,200);
    const concurrent = await Promise.all([2,3].map(id=>post('/api/orders/deliveries',{...delivery,id:'test-delivery-000'+id,quantity:4})));
    assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,400]);
    assert.equal((await post('/api/sheets/upsert',{sheet:'encomendas',rowNumber:order.rowNumber,data:{...order.data,'Nome da encomenda':'Editada'}})).status,200);
    const savedOrder = (await (await fetch(base+'/api/sheets?sheet=encomendas',{headers})).json()).rows[0];
    assert.equal(JSON.parse(savedOrder.data._deliveries).length,2);
    assert.equal((await post('/api/sheets/upsert',{sheet:'encomendas',rowNumber:order.rowNumber,data:{...order.data,'Quantidade de itens':'1'}})).status,400);
    const expenseData = {Descrição:'Embalagens', 'Valor (R$)':'125,90', Data:'2026-09-16', Categoria:'Material', 'Onde comprou / para quem pagou':'Papelaria local', Observações:'Caixas e etiquetas\nCompra de teste'};
    const expenseResponse = await post('/api/sheets/upsert',{sheet:'companyExpenses',data:expenseData});
    assert.equal(expenseResponse.status,200);
    const expense = await expenseResponse.json();
    assert.equal(expense.data['Valor (R$)'],'125.90');
    assert.equal((await post('/api/sheets/upsert',{sheet:'companyExpenses',rowNumber:expense.rowNumber,data:{...expenseData,'Valor (R$)':'-10'}})).status,400);
    const expenses = await (await fetch(base+'/api/sheets?sheet=companyExpenses',{headers})).json();
    assert.equal(expenses.rows.length,1);
    assert.equal(expenses.rows[0].data.Observações,expenseData.Observações);
    assert.equal(expenses.rows[0].data['Onde comprou / para quem pagou'],'Papelaria local');
    assert.equal(expenses.rows[0].data.Categoria,'Material');
    const persisted = JSON.parse(await readFile(path.join(dir,'data','sheets.local.json'),'utf8'));
    assert.equal(persisted.sheets.companyExpenses.rows[0].data['Valor (R$)'],'125.90');
    assert.equal((await post('/api/sheets/upsert',{sheet:'companyExpenses',rowNumber:expense.rowNumber,data:{...expenseData,'Valor (R$)':'130'}})).status,200);
    assert.equal((await post('/api/sheets/delete',{sheet:'companyExpenses',rowNumber:expense.rowNumber})).status,200);
    assert.equal((await (await fetch(base+'/api/sheets?sheet=companyExpenses',{headers})).json()).rows.length,0);
    assert.equal((await post('/api/product-costs','x'.repeat(4*1024*1024+1))).status,413);
    assert.equal((await post('/api/sheets/delete',{sheet:'producao',rowNumber:2,password:'1234'})).status,403);
    assert.equal((await post('/api/auth/logout',{})).status,200);
    assert.equal((await fetch(base+'/api/product-costs',{headers})).status,401);
    assert.equal((await (await post('/api/auth/automatic',{})).json()).authenticated,false);
    for(let i=0;i<3;i++)assert.equal((await post('/api/auth/login',{username:'owner',password})).status,200);
    const recognized=await post('/api/auth/automatic',{});
    assert.equal((await recognized.json()).authenticated,true);
    headers.cookie=recognized.headers.get('set-cookie').split(';')[0];
    const accesses=await (await fetch(base+'/api/auth/accesses',{headers})).json();
    assert.equal(accesses.addresses[0].passwordLogins,4);
    assert.equal(accesses.addresses[0].trusted,true);
    assert.equal((await post('/api/auth/revoke-ip',{ip:accesses.addresses[0].ip})).status,200);
    assert.equal((await (await post('/api/auth/automatic',{})).json()).authenticated,false);
    for(let i=0;i<8;i++)await post('/api/auth/login',{username:'owner',password:'errada'});
    assert.equal((await post('/api/auth/login',{username:'owner',password:'errada'})).status,429);
  }finally{
    if(child && child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
    await cleanup(dir);
  }
});
