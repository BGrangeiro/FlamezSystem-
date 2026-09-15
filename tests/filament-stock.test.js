import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('produção movimenta estoque e horas sem duplicar baixas', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'flamez-stock-'));
  try {
    await cp(new URL('../lib',import.meta.url),path.join(dir,'lib'),{recursive:true});
    await cp(new URL('../public',import.meta.url),path.join(dir,'public'),{recursive:true});
    await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
    const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
    await writeFile(path.join(dir,'server.js'),source.split('const server = createServer(')[0]+'\nexport {upsertLocalRow,readLocalSheets,deleteLocalRow,removeProductionItem,mutate};');
    const api=await import(pathToFileURL(path.join(dir,'server.js')));
    await api.upsertLocalRow('filamentos',2,{'Tipo de filamento':'PLA',Marca:'Masterprint',Cor:'Branco','Custo médio por kg':'100','Estoque atual (kg)':'1'});
    await api.upsertLocalRow('maquinas',2,{'Nome da máquina':'01','Horas de uso':'100','Valor de aquisição':'1000','Vida útil estimada (h)':'1000'});
    await api.upsertLocalRow('produtos',2,{Produto:'Gancho',SKU:'A01'});
    const stock=await api.upsertLocalRow('productStock',2,{SKU:'A01',Quantidade:'99',Cores:JSON.stringify([{color:'Branco',quantity:4},{color:'Preto',quantity:6}]),Foto:'data:image/png;base64,aGVsbG8='});
    assert.equal(stock.data.Quantidade,'10');
    assert.equal((await api.readLocalSheets()).sheets.productStock.rows[0].data.Foto,'data:image/png;base64,aGVsbG8=');
    await assert.rejects(api.upsertLocalRow('productStock',2,{SKU:'A01',Cores:JSON.stringify([{color:'Branco',quantity:-2}])}),/quantidade/i);
    assert.equal((await api.readLocalSheets()).sheets.productStock.rows[0].data.Quantidade,'10');
    const item={name:'Teste',sku:'A01',quantity:1,used:300,total:30,filamentStockRow:2,machineRow:2,machineRate:1.11,hours:10,failureHours:10};
    const save=(status,items=[item],row=2)=>api.upsertLocalRow('producao',row,{'Dia produção':'2026-09-14','Código do produto':'A01','Status da produção':status,'Itens da produção':JSON.stringify(items)});
    const state=async()=>{const {sheets:s}=await api.readLocalSheets();return {kg:Number(s.filamentos.rows[0].data['Estoque atual (kg)']),hours:Number(s.maquinas.rows[0].data['Horas totais (h)']),logs:s.filamentLog.rows.length,s};};
    await save('Em produção');assert.equal((await state()).kg,1);assert.equal((await state()).hours,100);
    await save('Concluída');assert.equal((await state()).kg,.7);assert.equal((await state()).hours,110);
    await save('Concluída');assert.equal((await state()).kg,.7);assert.equal((await state()).logs,1);
    await save('Falhou',[{...item,failureWaste:40,failureHours:2}]);assert.equal((await state()).kg,.96);assert.equal((await state()).hours,102);
    assert.equal((await state()).s.filamentLog.rows.at(-1).data.Movimento,'Estorno');
    await save('Falhou',[{...item,failureWaste:40,failureHours:2}]);assert.equal((await state()).logs,2);
    await save('Em produção');assert.equal((await state()).kg,1);
    await save('Parcial',[{...item,waste:40}]);assert.equal((await state()).kg,.7);
    await assert.rejects(save('Concluída',[{...item,used:1500}]),/Estoque insuficiente/);assert.equal((await state()).kg,.7);
    await assert.rejects(save('Concluída',[{...item,filamentStockRow:null}]),/Selecione um filamento/);
    await assert.rejects(api.deleteLocalRow('producao',2,'0000'),/Senha incorreta/);assert.equal((await state()).kg,.7);
    await assert.rejects(api.deleteLocalRow('filamentos',2),/vinculado/);
    await api.deleteLocalRow('producao',2,'1234');assert.equal((await state()).kg,1);assert.equal((await state()).hours,100);
    await save('Falhou',[{...item,failureWaste:40,failureHours:2}]);
    assert.equal((await state()).kg,.96);
    assert.equal((await state()).s.filamentLog.rows.at(-1).data['Quantidade (g)'],'40');
    const saved=JSON.parse((await state()).s.producao.rows[0].data['Itens da produção']);
    await save('Falhou',saved);assert.equal((await state()).kg,.96);
    await api.deleteLocalRow('producao',2,'1234');
    await save('Concluída',[item,{...item,used:200,hours:2}]);assert.equal((await state()).kg,.5);
    await api.removeProductionItem(2,0,'1234');assert.equal((await state()).kg,.8);assert.equal((await state()).hours,102);
    await api.deleteLocalRow('producao',2,'1234');assert.equal((await state()).kg,1);
    await Promise.all([api.mutate(()=>save('Concluída',[item],2)),api.mutate(()=>save('Concluída',[item],3))]);assert.equal((await state()).kg,.4);
    await assert.rejects(api.upsertLocalRow('filamentLog',null,{}),/somente leitura/);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'flamez-stock-'));
    await rm(dir,{recursive:true,force:true});
  }
});
