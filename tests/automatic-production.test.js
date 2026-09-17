import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyAutomaticJob } from '../public/automatic-production.js';
import { automaticProductionGroups } from '../public/automatic-production-log.js';
import { resolveProductionDraftItem, formatProductionHours } from '../public/production.js';

const products = [
  { rowNumber: 2, data: { SKU: 'A01', Produto: 'Gancho Quadrado' } },
  { rowNumber: 3, data: { SKU: 'A010', Produto: 'Outro produto' } }
];

test('produção automática reconhece SKU normal e cópias numeradas do mesmo arquivo', () => {
  assert.deepEqual(identifyAutomaticJob('A01.3mf', products), { fileName: 'A01.3mf', sku: 'A01', productName: 'Gancho Quadrado', productRow: 2, recognized: true });
  assert.equal(identifyAutomaticJob('A01(02).3mf', products).sku, 'A01');
  assert.equal(identifyAutomaticJob('a01 (12).3MF', products).sku, 'A01');
  assert.equal(identifyAutomaticJob('C:\\prints\\A010(2).3mf', products).sku, 'A010');
});

test('produção automática preserva nomes de arquivos sem SKU cadastrado', () => {
  const result = identifyAutomaticJob('Protótipo novo.3mf', products);
  assert.equal(result.recognized, false);
  assert.equal(result.fileName, 'Protótipo novo.3mf');
  assert.equal(result.productName, 'Protótipo novo');
  assert.equal(identifyAutomaticJob('A01 suporte.3mf', products).recognized, false);
});

test('dados de uma produção automática sem SKU podem ser completados e salvos', () => {
  const snapshot = { productRow: null, name: 'Protótipo novo', sku: '', quantity: 0, automatic: true };
  assert.deepEqual(resolveProductionDraftItem(snapshot, 'null', '3', products), {
    ...snapshot,
    quantity: 3,
    waste: 0
  });
  assert.throws(() => resolveProductionDraftItem(snapshot, 'null', '0', products), /quantidade de unidades/i);
});

test('trocar o produto de uma produção automática usa o cadastro selecionado', () => {
  const snapshot = { productRow: null, name: 'Arquivo antigo', sku: '', quantity: 0, automatic: true };
  assert.deepEqual(resolveProductionDraftItem(snapshot, '2', '4', products), {
    productRow: 2,
    name: 'Gancho Quadrado',
    sku: 'A01',
    quantity: 4
  });
});

test('log automático agrupa itens por dia e mantém os mais recentes primeiro', () => {
  const rows = [
    {rowNumber:2,data:{_bambuAutomatic:'true','Dia produção':'2026-09-15',_bambuStartedAt:'2026-09-15T10:00:00Z'}},
    {rowNumber:3,data:{_bambuAutomatic:'true','Dia produção':'2026-09-16',_bambuStartedAt:'2026-09-16T10:00:00Z'}},
    {rowNumber:4,data:{_bambuAutomatic:'true','Dia produção':'2026-09-16',_bambuStartedAt:'2026-09-16T12:00:00Z'}},
    {rowNumber:5,data:{'Dia produção':'2026-09-17'}}
  ];
  const groups = automaticProductionGroups(rows);
  assert.deepEqual(groups.map(group => [group.day,group.entries.map(entry=>entry.rowNumber)]), [['2026-09-16',[4,3]],['2026-09-15',[2]]]);
});

test('campos de horas mostram duas casas e aceitam ponto ou vírgula', () => {
  assert.equal(formatProductionHours(1.23456789), '1.23');
  assert.equal(formatProductionHours('1,5'), '1.50');
  assert.equal(formatProductionHours(0), '0.00');
  assert.equal(formatProductionHours(''), '');
  assert.equal(formatProductionHours('inválido'), 'inválido');
});

test('materiais validam quantidade decimal e unidade', async () => {
  const {normalizeMaterial}=await import('../public/material-stock.js');
  assert.deepEqual(normalizeMaterial({Material:'Fita dupla face',Quantidade:'2,5',Unidade:'m'}),{Material:'Fita dupla face',Quantidade:'2.5',Unidade:'m',Observações:'',Foto:'','Link de compra':''});
  assert.throws(()=>normalizeMaterial({Material:'Argolas',Quantidade:'-1',Unidade:'un'}),/quantidade/);
});
test('falha registra consumo real mesmo acima da previsão e recalcula custo', async () => {
  const {applyProductionOutcome}=await import('../public/production-status.js');
  const [item]=applyProductionOutcome([{plannedUsed:100,plannedFilamentTotal:10,plannedHours:2,machineRow:2,machineRate:3,failureHours:0.5,failureWaste:'120'}],'Falhou');
  assert.equal(item.waste,120);assert.equal(item.used,0);assert.equal(item.total,12);assert.equal(item.machineCost,1.5);
  assert.throws(()=>applyProductionOutcome([{...item,failureWaste:-1}],'Falhou'),/desperdiçado/);
});

test('material aceita foto e link de compra e rejeita links executáveis', async () => {
 const {normalizeMaterial}=await import('../public/material-stock.js');
 const data={Material:'Argolas',Quantidade:'10',Unidade:'un',Foto:'data:image/png;base64,AAAA','Link de compra':'https://example.com/argolas'};
 assert.equal(normalizeMaterial(data).Foto,data.Foto);
 assert.equal(normalizeMaterial(data)['Link de compra'],data['Link de compra']);
 assert.throws(()=>normalizeMaterial({...data,'Link de compra':'javascript:alert(1)'}),/link de compra/);
 assert.throws(()=>normalizeMaterial({...data,Foto:'https://example.com/image.png'}),/Foto/);
});
