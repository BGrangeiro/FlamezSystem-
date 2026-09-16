import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCloudMachines, bindProduction, recordCloudReport, completeCloudProductions } from '../lib/bambu-automation.js';
import { updateMachineHours } from '../public/machine-costs.js';
import { reconcileFilamentStock } from '../public/filament-stock.js';
import { mergeReport } from '../lib/bambu-cloud.js';
import { applyProductionOutcome } from '../public/production-status.js';

const make = () => ({ maquinas: { rows: [{ rowNumber: 2, data: { 'Nome da máquina': '01', 'Horas iniciais (h)': '100', 'Valor de aquisição': '5000' } }] }, producao: { rows: [] }, filamentos: { rows: [{ rowNumber: 2, data: { Marca: 'Test', Cor: 'Branco', 'Estoque atual (kg)': '1' } }] }, filamentLog: { rows: [] } });
const device = { id: 'printer1', name: '01', model: 'A1', jobId: 'job1', state: 'RUNNING' };
const production = number => ({ rowNumber: number, data: { 'Status da produção': 'Em produção', 'Itens da produção': JSON.stringify([{ machineRow: 2, filamentStockRow: 2, quantity: 2, plannedUsed: 300, plannedFilamentTotal: 15, plannedHours: 13, used: 300, waste: 0, total: 15, hours: 0, machineRate: 2 }]) } });

test('cloud discovery preserves existing finance and uniquely links names without duplicates', () => {
  const s = make(); registerCloudMachines(s, [device]); registerCloudMachines(s, [device]);
  assert.equal(s.maquinas.rows.length, 1); assert.equal(s.maquinas.rows[0].data._bambuId, 'printer1');
  assert.equal(s.maquinas.rows[0].data['Valor de aquisição'], '5000');
  registerCloudMachines(s, [{ ...device, id: 'printer2', name: '02' }]);
  assert.equal(s.maquinas.rows[1].data['Valor de aquisição'], '');
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
