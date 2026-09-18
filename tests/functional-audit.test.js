import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {applyProductionOutcome,productionDraftItem,PRODUCTION_STATUSES} from '../public/production-status.js';
import {monthlyStats,monthlyProjection,shiftMonth} from '../public/monthly-panel.js';
import {dailyReportStats} from '../public/production-report.js';
import {calculateMachineCost,maintenanceProgress} from '../public/machine-costs.js';
const item={name:'Gancho',sku:'A01',quantity:4,used:100,total:10,hours:2,machineRow:2,machineRate:3,filamentStockRow:2,failureHours:0.5,failureWaste:20,waste:10};
for(const from of PRODUCTION_STATUSES)for(const to of PRODUCTION_STATUSES)test(`transição ${from} → ${to}: cálculo e repetição sem duplicação`,()=>{
 const before=applyProductionOutcome([item],from);
 const result=applyProductionOutcome(before.map(i=>({...i,waste:10})),to);
 assert.deepEqual(applyProductionOutcome(result,to),result);
 assert.equal(result[0].used+result[0].waste,to==='Falhou'?20:100);
 assert.equal(result[0].hours,to==='Em produção'?0:to==='Falhou'?0.5:2);
 assert.equal(result[0].machineCost,result[0].hours*3);
 assert.equal(productionDraftItem(result[0]).used,100);
});
test('relatórios diário e mensal concordam em custos, peças e desperdício',()=>{
 const rows=PRODUCTION_STATUSES.map((status,i)=>({rowNumber:i+2,data:{'Dia produção':'2026-09-10','Status da produção':status,'Itens da produção':JSON.stringify(applyProductionOutcome([item],status))}}));
 const daily=dailyReportStats(rows),monthly=monthlyStats(rows,'2026-09');
 for(const key of ['grams','waste','hours','units','filamentCost','machineCost'])assert.equal(monthly[key],daily[key],key);
 assert.equal(monthly.units,4);assert.equal(monthly.pending,1);assert.equal(monthly.failed,1);
 assert.equal(monthlyProjection(monthly,'2026-09','2026-09-15').grams,monthly.grams*2);
 assert.equal(monthlyProjection(monthly,'2026-08','2026-09-15'),null);
 assert.equal(shiftMonth('2026-01',-1),'2025-12');
 assert.equal(shiftMonth('2026-12',1),'2027-01');
 assert.equal(monthlyStats(rows,'2026-09',9).grams,0);
});
test('custo de máquina e manutenção nos limites do ciclo',()=>{
 const data={'Valor de aquisição':'1000','Vida útil estimada (h)':'1000','Manutenção estimada na vida útil':'100','Custo de funcionamento (R$/h)':'0,2'};
 assert.equal(calculateMachineCost(data),1.3);
 assert.equal(calculateMachineCost({...data,'Vida útil estimada (h)':'0'}),null);
 assert.equal(maintenanceProgress({'Horas totais (h)':'499',_maintenanceHours:'100'}).remaining,1);
 assert.equal(maintenanceProgress({'Horas totais (h)':'500',_maintenanceHours:'100'}).due,true);
 assert.equal(maintenanceProgress({'Horas totais (h)':'500',_maintenanceHours:'500'}).remaining,400);
});
test('persistência isolada: cadastros, alterações, exclusões e status ao recarregar',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'flamez-audit-'));
 try{
  for(const name of ['public','lib'])await cp(new URL('../'+name,import.meta.url),path.join(dir,name),{recursive:true});
  await writeFile(path.join(dir,'package.json'),'{{"type":"module"}}'.replace('{{','{').replace('}}','}'));
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  await writeFile(path.join(dir,'server.js'),source.split('const server = createServer(')[0]+'\nexport {upsertLocalRow,readLocalSheets,deleteLocalRow,mutate};');
  const api=await import(pathToFileURL(path.join(dir,'server.js')));
  const save=(sheet,data,row=null)=>api.mutate(()=>api.upsertLocalRow(sheet,row,data));
  const list=async sheet=>(await api.readLocalSheets()).sheets[sheet].rows;
  await t.test('materiais: foto, link, atualização decimal, recarga e exclusão',async()=>{
   const material=await save('materialStock',{Material:'Fita',Quantidade:'2,5',Unidade:'m',Foto:'data:image/png;base64,AAAA','Link de compra':'https://example.com/fita'});
   assert.equal((await list('materialStock'))[0].data.Quantidade,'2.5');
   await save('materialStock',{...material.data,Quantidade:'5'},material.rowNumber);
   assert.equal((await list('materialStock'))[0].data.Quantidade,'5');
   await assert.rejects(save('materialStock',{...material.data,Quantidade:'-1'},material.rowNumber));
   assert.equal((await list('materialStock'))[0].data.Quantidade,'5');
   await api.deleteLocalRow('materialStock',material.rowNumber);assert.equal((await list('materialStock')).length,0);
  });
  const product=await save('produtos',{SKU:'A01',Produto:'Gancho'});
  await t.test('produtos a testar: link genérico, edição, persistência e exclusão',async()=>{
   const candidate=await save('productTests',{Produto:'Ideia da Shopee',Link:'shopee.com.br/produto/123'});
   assert.equal(candidate.data.Link,'https://shopee.com.br/produto/123');
   await save('productTests',{Produto:'Arquivo no Drive',Link:'https://drive.google.com/file/d/abc'},candidate.rowNumber);
   const persisted=(await list('productTests'))[0];
   assert.equal(persisted.data.Produto,'Arquivo no Drive');assert.equal(persisted.data.Link,'https://drive.google.com/file/d/abc');
   await assert.rejects(save('productTests',{Produto:'Link perigoso',Link:'file:///segredo'}));
   await api.deleteLocalRow('productTests',candidate.rowNumber);assert.equal((await list('productTests')).length,0);
  });
  await t.test('padrões: concorrência, edição, persistência e referência ao produto',async()=>{
   const input={'Produto ID':String(product.rowNumber),Quantidade:'4',Horas:'2.5','Filamento (g)':'120'};
   await Promise.all(Array.from({length:5},()=>save('productionPresets',input)));
   const rows=await list('productionPresets');assert.deepEqual(rows.map(r=>r.data.Código),['A01-1','A01-2','A01-3','A01-4','A01-5']);
   await save('productionPresets',{...input,Quantidade:'8'},rows[0].rowNumber);
   assert.equal((await list('productionPresets'))[0].data.Código,'A01-1');
   assert.equal((await list('productionPresets'))[0].data.Quantidade,'8');
  });
  await t.test('estoque de produtos: quantidades por cor, recarga e edição',async()=>{
   const r=await save('productStock',{SKU:'A01',Cores:JSON.stringify([{color:'Branco',quantity:4},{color:'Preto',quantity:6}])});
   assert.equal((await list('productStock'))[0].data.Quantidade,'10');
   await save('productStock',{...r.data,Cores:JSON.stringify([{color:'Branco',quantity:2}])},r.rowNumber);
   assert.equal((await list('productStock'))[0].data.Quantidade,'2');
   const standalone=await save('productStock',{Avulso:'true',Produto:'Protótipo avulso',Cores:JSON.stringify([{color:'Teste',quantity:3}])});
   const standaloneSaved=(await list('productStock')).find(row=>row.rowNumber===standalone.rowNumber);
   assert.equal(standaloneSaved.data.SKU,'');assert.equal(standaloneSaved.data.Produto,'Protótipo avulso');assert.equal(standaloneSaved.data.Quantidade,'3');
   await api.deleteLocalRow('productStock',standalone.rowNumber);
  });
  await save('filamentos',{Marca:'Teste',Cor:'Branco','Custo médio por kg':'100','Estoque atual (kg)':'5'},2);
  await save('maquinas',{'Nome da máquina':'01','Horas iniciais (h)':'0'},2);
  await t.test('produção: concluir, falhar, reler de disco e preservar desperdício',async()=>{
   const data={'Dia produção':'2026-09-17','Status da produção':'Concluída','Itens da produção':JSON.stringify(applyProductionOutcome([item],'Concluída'))};
   const row=await save('producao',data);
   await save('producao',{...row.data,'Status da produção':'Falhou','Itens da produção':JSON.stringify(applyProductionOutcome([item],'Falhou'))},row.rowNumber);
   await list('maquinas');const saved=(await list('producao'))[0];
   assert.equal(saved.data['Status da produção'],'Falhou');assert.equal(saved.data['Desperdício (g)'],'20');
   assert.equal(Number((await list('filamentos'))[0].data['Estoque atual (kg)']),4.98);
   await save('producao',saved.data,saved.rowNumber);assert.equal(Number((await list('filamentos'))[0].data['Estoque atual (kg)']),4.98);
  });
 }finally{assert.ok(dir.startsWith(path.join(tmpdir(),'flamez-audit-')));await rm(dir,{recursive:true,force:true});}
});
