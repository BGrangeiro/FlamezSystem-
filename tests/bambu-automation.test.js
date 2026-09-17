import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCloudMachines, bindProduction, recordCloudReport, completeCloudProductions, identifyCloudProduct } from '../lib/bambu-automation.js';
import { updateMachineHours } from '../public/machine-costs.js';
import { reconcileFilamentStock } from '../public/filament-stock.js';
import { mergeReport } from '../lib/bambu-cloud.js';
import { applyProductionOutcome } from '../public/production-status.js';

const make = () => ({ maquinas: { rows: [{ rowNumber: 2, data: { 'Nome da máquina': '01', 'Horas iniciais (h)': '100', 'Valor de aquisição': '5000' } }] }, produtos: { rows: [{rowNumber:2,data:{SKU:'A01',Produto:'Gancho Quadrado'}}] }, producao: { rows: [] }, filamentos: { rows: [{ rowNumber: 2, data: { Marca: 'Test', Cor: 'Branco', 'Estoque atual (kg)': '1' } }] }, filamentLog: { rows: [] } });
const device = { id: 'printer1', name: '01', model: 'A1', jobId: 'job1', jobName: 'A01(02).3mf', state: 'RUNNING' };
const production = number => ({ rowNumber: number, data: { 'Status da produção': 'Em produção', 'Itens da produção': JSON.stringify([{ machineRow: 2, filamentStockRow: 2, quantity: 2, plannedUsed: 300, plannedFilamentTotal: 15, plannedHours: 13, used: 300, waste: 0, total: 15, hours: 0, machineRate: 2 }]) } });

test('cloud discovery preserves existing finance and uniquely links names without duplicates', () => {
  const s = make(); registerCloudMachines(s, [device]); registerCloudMachines(s, [device]);
  assert.equal(s.maquinas.rows.length, 1); assert.equal(s.maquinas.rows[0].data._bambuId, 'printer1');
  assert.equal(s.maquinas.rows[0].data['Valor de aquisição'], '5000');
  registerCloudMachines(s, [{ ...device, id: 'printer2', name: '02' }]);
  assert.equal(s.maquinas.rows[1].data['Valor de aquisição'], '');
});

test('automatic cloud production is created on start, records errors and finishes with observed time', () => {
  const s = make(); registerCloudMachines(s, [device]);
  assert.equal(identifyCloudProduct(s, 'A01(02).3mf').sku, 'A01');
  recordCloudReport(s, { ...device, updatedAt: 1000 });
  assert.equal(s.producao.rows.length, 1);
  const automatic = s.producao.rows[0];
  assert.equal(automatic.data._bambuAutomatic, 'true');
  assert.equal(automatic.data['Código do produto'], 'A01');
  assert.equal(automatic.data['Status da produção'], 'Em produção');
  recordCloudReport(s, { ...device, alerts:['Erro Bambu DEADBEEF'], updatedAt: 61000 }, true);
  assert.match(automatic.data.Observações, /Erro Bambu DEADBEEF/);
  assert.equal(JSON.parse(automatic.data._bambuEvents).length, 1);
  recordCloudReport(s, { ...device, state:'FINISH', progress:100, updatedAt:121000 }, true);
  assert.equal(automatic.data['Status da produção'], 'Concluída');
  assert.equal(automatic.data['Horas (h)'], String(2/60));
  assert.ok(automatic.data['Hora de finalização']);
  const ledger = JSON.parse(s.maquinas.rows[0].data._bambuJobs);
  assert.equal(Object.values(ledger)[0].name, 'A01(02).3mf');
});

test('finished job counts physical hours once, completes bound production and deducts stock once', () => {
  const s = make(); registerCloudMachines(s, [device]);
  recordCloudReport(s, { ...device, updatedAt: 1000 });
  const p = production(2); bindProduction(s, p, undefined, 2000); s.producao.rows.push(p);
  assert.throws(() => bindProduction(s, production(3), undefined, 2000), /Já existe/);
  for (let minute = 1; minute <= 60; minute++) recordCloudReport(s, { ...device, updatedAt: 1000 + minute * 60000 }, true);
  const before = structuredClone(s);
  recordCloudReport(s, { ...device, state: 'FINISH', progress: 100, updatedAt: 3601001 }, true);
  completeCloudProductions(s); updateMachineHours(s); reconcileFilamentStock(before, s);
  assert.equal(p.data['Status da produção'], 'Concluída');
  assert.ok(Math.abs(Number(s.maquinas.rows[0].data['Horas totais (h)']) - 101) < 0.00001);
  assert.equal(Number(s.filamentos.rows[0].data['Estoque atual (kg)']), .7);
  const saved = structuredClone(s);
  recordCloudReport(s, { ...device, state: 'FINISH', updatedAt: 3661000 }, true);
  completeCloudProductions(s); updateMachineHours(s); reconcileFilamentStock(saved, s);
  assert.equal(s.filamentLog.rows.length, 1);
  assert.equal(s.maquinas.rows[0].data['Horas totais (h)'], saved.maquinas.rows[0].data['Horas totais (h)']);
  s.producao.rows = []; updateMachineHours(s);
  assert.equal(s.maquinas.rows[0].data['Horas totais (h)'], saved.maquinas.rows[0].data['Horas totais (h)']);
});

test('old finish, pauses, lost connection and errors cannot create fictional runtime or finish a new job', () => {
  const s = make(); registerCloudMachines(s, [device]);
  recordCloudReport(s, { ...device, state: 'FINISH', updatedAt: 1000 });
  const p = production(2); bindProduction(s, p, undefined, 2000); s.producao.rows.push(p);
  recordCloudReport(s, { ...device, state: 'FINISH', updatedAt: 3000 }, true);
  assert.deepEqual(completeCloudProductions(s), []);
  recordCloudReport(s, { ...device, jobId: 'new', updatedAt: 4000 }, true);
  recordCloudReport(s, { ...device, jobId: 'new', state: 'PAUSE', alerts: ['Erro Bambu 07008011'], updatedAt: 64000 }, true);
  recordCloudReport(s, { ...device, jobId: 'new', state: 'PAUSE', alerts: ['Erro Bambu 07008011'], updatedAt: 124000 }, true);
  assert.equal(JSON.parse(p.data._bambuEvents).filter(e => e.message.includes('Erro Bambu')).length, 1);
  recordCloudReport(s, { ...device, jobId: 'new', updatedAt: 3600000 }, false);
  recordCloudReport(s, { ...device, jobId: 'new', state: 'FINISH', updatedAt: 3660000 }, true);
  completeCloudProductions(s); updateMachineHours(s);
  assert.ok(Math.abs(Number(s.maquinas.rows[0].data['Horas totais (h)']) - (100 + 2 / 60)) < 1e-8);
});

test('report parser accepts error-only updates and clears resolved alerts', () => {
  const report = mergeReport(device, { print: { print_error: 42, hms: [{ attr: 1, code: 2 }] } }, 1000);
  assert.equal(report.updatedAt, 1000); assert.equal(report.alerts.length, 2);
  assert.deepEqual(mergeReport(report, { print: { print_error: 0, hms: [] } }, 2000).alerts, []);
  assert.equal(mergeReport(report, { print: { print_error: 0 } }, 2000).alerts.length, 1);
});

test('multiple SKUs share job hours and 100 percent alone does not finish a production', () => {
  const s = make(); registerCloudMachines(s, [device]);
  recordCloudReport(s, { ...device, updatedAt: 1000 });
  const p = production(2); const item = JSON.parse(p.data['Itens da produção'])[0];
  p.data['Itens da produção'] = JSON.stringify([{ ...item, plannedHours: 1 }, { ...item, plannedHours: 3 }]);
  bindProduction(s, p, undefined, 2000); s.producao.rows.push(p);
  recordCloudReport(s, { ...device, progress: 100, updatedAt: 61000 }, true);
  assert.deepEqual(completeCloudProductions(s), []);
  recordCloudReport(s, { ...device, state: 'FINISH', updatedAt: 121000 }, true);
  completeCloudProductions(s); updateMachineHours(s);
  const next = JSON.parse(p.data['Itens da produção']);
  assert.equal(next[1].hours, next[0].hours * 3);
  assert.ok(Math.abs(next.reduce((n, i) => n + i.hours, 0) - 2 / 60) < 1e-9);
});

test('FAILED records actual observed hours and defaults to full waste; a later waste correction restores stock', () => {
  const s = make(); registerCloudMachines(s, [device]);
  recordCloudReport(s, { ...device, updatedAt: 1000 });
  const p = production(2); bindProduction(s, p, undefined, 2000); s.producao.rows.push(p);
  const before = structuredClone(s);
  recordCloudReport(s, { ...device, state: 'FAILED', updatedAt: 61000 }, true);
  completeCloudProductions(s); reconcileFilamentStock(before, s); updateMachineHours(s);
  assert.equal(p.data['Status da produção'], 'Falhou');
  assert.equal(p.data['Desperdício (g)'], '300'); assert.equal(p.data['Peso (g)'], '300');
  assert.equal(Number(s.filamentos.rows[0].data['Estoque atual (kg)']), .7);
  assert.ok(Math.abs(Number(s.maquinas.rows[0].data['Horas totais (h)']) - (100 + 1 / 60)) < 1e-9);
  const failed = structuredClone(s);
  const corrected = applyProductionOutcome(JSON.parse(p.data['Itens da produção']).map(i => ({ ...i, failureWaste: 40 })), 'Falhou');
  p.data['Itens da produção'] = JSON.stringify(corrected);
  reconcileFilamentStock(failed, s); updateMachineHours(s);
  assert.equal(Number(s.filamentos.rows[0].data['Estoque atual (kg)']), .96);
  assert.equal(s.maquinas.rows[0].data['Horas totais (h)'], failed.maquinas.rows[0].data['Horas totais (h)']);
});

test('manual failed outcome and waste survive subsequent cloud finish reports', () => {
  const s = make(); registerCloudMachines(s, [device]);
  recordCloudReport(s, {...device,updatedAt:1000});
  recordCloudReport(s, {...device,state:'FINISH',updatedAt:61000},true);
  const previous = structuredClone(s.producao.rows[0]);
  const row = s.producao.rows[0];
  const items = applyProductionOutcome([{...JSON.parse(row.data['Itens da produção'])[0],plannedUsed:100,plannedFilamentTotal:10,failureWaste:25,failureHours:0.01}], 'Falhou');
  row.data['Status da produção'] = 'Falhou';
  row.data['Itens da produção'] = JSON.stringify(items);
  row.data['Desperdício (g)'] = '25';
  bindProduction(s,row,previous,62000);
  recordCloudReport(s,{...device,state:'FINISH',updatedAt:121000},true);
  assert.equal(row.data['Status da produção'],'Falhou');
  assert.equal(row.data['Desperdício (g)'],'25');
  assert.deepEqual(JSON.parse(row.data['Itens da produção']),items);
  recordCloudReport(s,{...device,jobId:'job2',updatedAt:181000},true);
  assert.equal(s.producao.rows.length,2);
  assert.equal(s.producao.rows[1].data['Status da produção'],'Em produção');
});

test('automatic finalization is immutable on repeated reports and after restart', () => {
  let s=make();registerCloudMachines(s,[device]);
  recordCloudReport(s,{...device,updatedAt:1000});
  recordCloudReport(s,{...device,state:'FINISH',updatedAt:61000},true);
  const frozen=structuredClone(s.producao.rows[0].data);
  s=JSON.parse(JSON.stringify(s));
  recordCloudReport(s,{...device,state:'FINISH',updatedAt:71000},true);
  recordCloudReport(s,{...device,state:'FAILED',updatedAt:81000},true);
  assert.deepEqual(s.producao.rows[0].data,frozen);
});
test('manual reopening cannot be completed again by old cloud reports or ledger', () => {
  const s=make();registerCloudMachines(s,[device]);
  recordCloudReport(s,{...device,updatedAt:1000});
  recordCloudReport(s,{...device,state:'FINISH',updatedAt:61000},true);
  const row=s.producao.rows[0],previous=structuredClone(row);
  row.data['Status da produção']='Em produção';
  bindProduction(s,row,previous,62000);
  recordCloudReport(s,{...device,state:'FINISH',updatedAt:71000},true);
  assert.deepEqual(completeCloudProductions(s),[]);
  assert.equal(row.data['Status da produção'],'Em produção');
  assert.equal(row.data._bambuManualOutcome,'true');
});
