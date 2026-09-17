import { identifiedModel, identifiedName, amsPresence } from './bambu-model.js';
import { applyProductionOutcome } from '../public/production-status.js';
import { calculateMachineCost, normalizeMachineData } from '../public/machine-costs.js';
import { usageDay, USAGE_TIME_ZONE } from './bambu-usage.js';

export const parseObject = (value, fallback = {}) => { try { return JSON.parse(value || '') || fallback; } catch { return fallback; } };
const itemsOf = row => parseObject(row.data['Itens da produção'], []);
const active = state => ['RUNNING', 'PAUSE', 'PREPARE', 'SLICING'].includes(state);
const terminal = state => ['FINISH', 'FAILED'].includes(state);
const automaticStatus = state => state === 'FINISH' ? 'Concluída' : state === 'FAILED' ? 'Falhou' : 'Em produção';
const dateTime = timestamp => new Intl.DateTimeFormat('pt-BR', { timeZone: USAGE_TIME_ZONE, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(timestamp));
const baseName = value => String(value || '').trim().split(/[\\/]/).pop() || '';
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function identifyCloudProduct(sheets, jobName) {
  const fileName = baseName(jobName);
  const candidates = sheets.produtos.rows.map(product => ({ product, sku: String(product.data.SKU || '').trim() })).filter(entry => entry.sku).sort((a,b) => b.sku.length - a.sku.length);
  for (const { product, sku } of candidates) if (new RegExp(`^${escapeRegExp(sku)}(?:\\s*\\(\\d+\\))?(?:\\.[^.]+)?$`, 'i').test(fileName)) {
    return { fileName, sku: sku.toUpperCase(), name: String(product.data.Produto || '').trim() || sku.toUpperCase(), productRow: product.rowNumber, recognized: true };
  }
  return { fileName, sku: '', name: fileName.replace(/\.[^.]+$/, '') || 'Arquivo não informado', productRow: null, recognized: false };
}

function automaticObservation(row, at, message) {
  const line = `${dateTime(at)} · ${message}`;
  const recorded = parseObject(row.data._bambuAutomaticObservations, []);
  if (!recorded.some(entry => entry.key === message)) recorded.push({ key: message, at: new Date(at).toISOString(), line });
  row.data._bambuAutomaticObservations = JSON.stringify(recorded);
  const manual = String(row.data.Observações || '').split('\n').filter(value => value && !value.includes(' · Erro Bambu ') && !value.includes(' · HMS '));
  row.data.Observações = [...manual, ...recorded.map(entry => entry.line)].join('\n');
}

function syncAutomaticProduction(sheets, device, machine, job) {
  if (!job.key || (!active(job.state) && !terminal(job.state))) return null;
  let row = sheets.producao.rows.find(candidate => candidate.data._bambuAutomatic === 'true' && candidate.data._bambuJobKey === job.key);
  // A reviewed result belongs to the user; later telemetry must not replace it.
  if (row && (row.data._bambuManualOutcome === 'true' || ['Concluída', 'Falhou', 'Parcial'].includes(row.data['Status da produção']))) return row;
  const product = identifyCloudProduct(sheets, job.name || device.jobName);
  const hours = Math.max(0, Number(job.milliseconds) || 0) / 3600000;
  const machineRate = calculateMachineCost(normalizeMachineData(machine.data));
  if (!row) {
    row = { rowNumber: Math.max(1, ...sheets.producao.rows.map(candidate => Number(candidate.rowNumber) || 1)) + 1, data: {} };
    sheets.producao.rows.push(row);
  }
  let previousItem = {};
  try { previousItem = JSON.parse(row.data['Itens da produção'] || '[]')[0] || {}; } catch {}
  const item = {
    ...previousItem,
    automatic: true, source: 'bambu', bambuJobKey: job.key,
    productRow: product.productRow, name: product.name, sku: product.sku,
    quantity: Number(previousItem.quantity) || 0,
    machineRow: machine.rowNumber, machineName: machine.data['Nome da máquina'],
    plannedHours: hours, failureHours: hours, hours: active(job.state) ? 0 : hours,
    machineRate, machineCost: machineRate === null || active(job.state) ? 0 : machineRate * hours,
    plannedUsed: Number(previousItem.plannedUsed ?? previousItem.used) || 0,
    plannedFilamentTotal: Number(previousItem.plannedFilamentTotal ?? previousItem.total) || 0,
    used: Number(previousItem.used) || 0, waste: Number(previousItem.waste) || 0, total: Number(previousItem.total) || 0,
    fileName: product.fileName, skuRecognized: product.recognized
  };
  const status = automaticStatus(job.state);
  Object.assign(row.data, {
    'Dia produção': usageDay(job.start), 'Código do produto': product.sku || product.name,
    'Impressora usada': machine.data['Nome da máquina'], 'Quantidade produzida': previousItem.quantity ? String(previousItem.quantity) : '',
    'Hora de início': new Date(job.start).toISOString(), 'Hora de finalização': terminal(job.state) ? new Date(job.lastAt).toISOString() : '',
    'Resultado da impressão': status, 'Status da produção': status,
    'Peso (g)': previousItem.plannedUsed ? String(Number(previousItem.used || 0) + Number(previousItem.waste || 0)) : '',
    'Horas (h)': String(hours), 'Desperdício (g)': previousItem.plannedUsed ? String(previousItem.waste || 0) : '',
    'Filamento usado': previousItem.filamentLabel || '', 'Custo do filamento (R$)': previousItem.plannedUsed ? String(previousItem.total || 0) : '',
    'Custo de máquinas (R$)': machineRate === null || active(job.state) ? '0' : String(machineRate * hours),
    'Itens da produção': JSON.stringify([item]),
    '_bambuAutomatic': 'true', '_bambuJobKey': job.key, '_bambuPrinterId': device.id,
    '_bambuFileName': product.fileName, '_bambuStartedAt': new Date(job.start).toISOString(),
    '_bambuEndedAt': terminal(job.state) ? new Date(job.lastAt).toISOString() : '', '_bambuState': job.state
  });
  return row;
}

export function registerCloudMachines(sheets, devices) {
  let changed = false;
  for (const device of devices) {
    let row = sheets.maquinas.rows.find(r => r.data._bambuId === device.id);
    if (!row) {
      // Only adopt a unique exact name. Never guess between similarly named machines.
      const candidates = sheets.maquinas.rows.filter(r => !r.data._bambuId && r.data['Nome da máquina']?.trim().toLowerCase() === device.name.trim().toLowerCase());
      row = candidates.length === 1 ? candidates[0] : null;
      if (!row) {
        row = { rowNumber: Math.max(1, ...sheets.maquinas.rows.map(r => r.rowNumber)) + 1, data: {
          'Nome da máquina': identifiedName(device), Modelo: identifiedModel(device), Status: 'Ativa',
          'Valor de aquisição': '', 'Vida útil estimada (h)': '', 'Manutenção estimada na vida útil': '',
          'Custo de funcionamento (R$/h)': '', 'Última manutenção': '', 'Horas iniciais (h)': '0'
        } };
        sheets.maquinas.rows.push(row);
      }
      row.data._bambuId = device.id; changed = true;
    }
    const model = identifiedModel(device);
    const sameFamily = value => String(value || '').trim().replace(/\s+combo$/i, '').toLowerCase();
    const confirmed = amsPresence(device) !== null;
    if (model && (!row.data.Modelo || (confirmed && sameFamily(row.data.Modelo) === sameFamily(device.model) && row.data.Modelo !== model))) {
      row.data.Modelo = model; changed = true;
    }
    const name = identifiedName(device);
    if (name !== device.name && row.data['Nome da máquina'] === device.name) {
      row.data['Nome da máquina'] = name; changed = true;
    }
  }
  return changed;
}

export function bindProduction(sheets, row, previous, at = Date.now()) {
  // Keep manual decisions across reloads, restarts and every cloud completion path.
  if (previous && (previous.data._bambuManualOutcome === 'true' || previous.data._bambuAutomatic === 'true' ||
      previous.data['Status da produção'] !== row.data['Status da produção'])) {
    row.data._bambuManualOutcome = 'true';
  }
  const bindings = parseObject(previous?.data._bambuBindings);
  const items = itemsOf(row);
  const ids = new Set(items.map(i => String(i.machineRow)));
  for (const id of Object.keys(bindings)) if (!ids.has(id)) delete bindings[id];
  if (row.data['Status da produção'] === 'Em produção') for (const id of ids) {
    const machine = sheets.maquinas.rows.find(m => String(m.rowNumber) === id);
    if (!machine?.data._bambuId || bindings[id]) continue;
    const conflicts = sheets.producao.rows.some(r => r.rowNumber !== row.rowNumber && r.data._bambuAutomatic !== 'true' && r.data['Status da produção'] === 'Em produção' && itemsOf(r).some(i => String(i.machineRow) === id));
    if (conflicts) throw Object.assign(new Error(`Já existe uma produção em andamento na máquina ${machine.data['Nome da máquina']}. Finalize ou ajuste essa produção antes de vincular outra.`), { statusCode: 409 });
    const job = parseObject(machine.data._bambuCurrent);
    bindings[id] = { after: at, key: active(job.state) && at - job.lastAt < 120000 ? job.key : null };
  }
  row.data._bambuBindings = JSON.stringify(bindings);
  row.data._bambuEvents = previous?.data._bambuEvents || '[]';
  row.data._bambuSyncError = previous?.data._bambuSyncError || '';
  row.data['Itens da produção'] = JSON.stringify(items.map(item => {
    const copy = { ...item }; delete copy.bambuJobKey;
    if (bindings[String(item.machineRow)]?.key) copy.bambuJobKey = bindings[String(item.machineRow)].key;
    else if (previous?.data._bambuAutomatic === 'true') {
      const prior = itemsOf(previous).find(entry => String(entry.machineRow) === String(item.machineRow) && entry.bambuJobKey === previous.data._bambuJobKey);
      if (prior) copy.bambuJobKey = prior.bambuJobKey;
    }
    return copy;
  }));
}

function event(row, key, at, message) {
  const events = parseObject(row.data._bambuEvents, []);
  if (!events.some(e => e.key === key)) events.push({ key, at: new Date(at).toISOString(), message });
  row.data._bambuEvents = JSON.stringify(events);
}

// A persisted job ledger makes repeated FINISH reports and process restarts idempotent.
export function recordCloudReport(sheets, device, continuous = false) {
  const machine = sheets.maquinas.rows.find(r => r.data._bambuId === device.id);
  if (!machine || !device.updatedAt) return;
  const jobs = parseObject(machine.data._bambuJobs);
  let job = parseObject(machine.data._bambuCurrent);
  const at = device.updatedAt;
  if (job.lastAt >= at) return;
  const currentName = baseName(device.jobName);
  const changedId = device.jobId && job.id && device.jobId !== job.id;
  const changedName = currentName && job.name && currentName !== job.name && active(device.state);
  if (active(device.state) && (!job.key || changedId || changedName || terminal(job.state))) {
    job = { key: `${device.id}:${device.jobId || 'local'}:${at}`, id: device.jobId || '', name: currentName, start: at, milliseconds: 0, state: device.state, lastAt: at };
  }
  if (!job.key || (device.jobId && job.id && device.jobId !== job.id)) return; // An old completed job cannot complete a newly entered production.
  if (continuous && job.state === 'RUNNING' && at - job.lastAt <= 120000) job.milliseconds += at - job.lastAt;
  job.lastAt = at; job.state = device.state; if (currentName) job.name = currentName;
  if (terminal(job.state) && !jobs[job.key]) jobs[job.key] = { id: job.id, name: job.name || '', startedAt: job.start, hours: job.milliseconds / 3600000, state: job.state, endedAt: at };
  machine.data._bambuCurrent = JSON.stringify(job);
  machine.data._bambuJobs = JSON.stringify(jobs);
  const automaticRow = syncAutomaticProduction(sheets, device, machine, job);
  if (automaticRow) for (const alert of device.alerts || []) {
    event(automaticRow, `${job.key}:${alert}`, at, `Máquina ${machine.data['Nome da máquina']}: ${alert}`);
    automaticObservation(automaticRow, at, alert);
  }
  for (const row of sheets.producao.rows) {
    if (row.data._bambuManualOutcome === 'true' || row.data['Status da produção'] !== 'Em produção') continue;
    const bindings = parseObject(row.data._bambuBindings);
    const binding = bindings[String(machine.rowNumber)];
    if (!binding) continue;
    if (!binding.key && active(job.state) && at >= binding.after) binding.key = job.key;
    if (binding.key !== job.key) continue;
    row.data._bambuBindings = JSON.stringify(bindings);
    row.data['Itens da produção'] = JSON.stringify(itemsOf(row).map(item => String(item.machineRow) === String(machine.rowNumber) ? { ...item, bambuJobKey: job.key } : item));
    for (const alert of device.alerts || []) event(row, `${job.key}:${alert}`, at, `Máquina ${machine.data['Nome da máquina']}: ${alert}`);
    if (device.state === 'PAUSE') event(row, `${job.key}:pause:${device.alerts?.join(',') || 'manual'}`, at, `Máquina ${machine.data['Nome da máquina']}: impressão pausada${device.alerts?.length ? ' com alerta' : ' (motivo não informado pela Bambu)'}.`);
    if (device.state === 'FAILED') event(row, `${job.key}:failed`, at, `Máquina ${machine.data['Nome da máquina']}: impressão interrompida. Revise o desperdício antes de finalizar.`);
    if (device.state === 'FINISH') event(row, `${job.key}:finish`, at, `Máquina ${machine.data['Nome da máquina']}: impressão concluída pela Bambu.`);
  }
}

export function completeCloudProductions(sheets, onlyRow) {
  const completed = [];
  for (const row of sheets.producao.rows) {
    if (onlyRow !== undefined && row.rowNumber !== onlyRow) continue;
    if (row.data._bambuManualOutcome === 'true' || row.data['Status da produção'] !== 'Em produção') continue;
    const items = itemsOf(row);
    if (!items.length) continue;
    const jobs = items.map(item => {
      const machine = sheets.maquinas.rows.find(m => String(m.rowNumber) === String(item.machineRow));
      return parseObject(machine?.data._bambuJobs)[item.bambuJobKey];
    });
    if (!jobs.every(job => job && terminal(job.state))) continue;
    const status = jobs.every(job => job.state === 'FINISH') ? 'Concluída' : jobs.every(job => job.state === 'FAILED') ? 'Falhou' : 'Parcial';
    // Multiple SKUs in one print share its duration, rather than multiplying machine hours.
    const weights = new Map();
    items.forEach(item => weights.set(item.bambuJobKey, (weights.get(item.bambuJobKey) || 0) + (Number(item.plannedHours) || 1)));
    const next = applyProductionOutcome(items.map((item, index) => {
      const hours = jobs[index].hours * (Number(item.plannedHours) || 1) / weights.get(item.bambuJobKey);
      return { ...item, plannedHours: hours, failureHours: hours,
        waste: jobs[index].state === 'FAILED' ? Number(item.failureWaste ?? item.plannedUsed ?? item.used) : 0 };
    }), status);
    row.data['Itens da produção'] = JSON.stringify(next);
    row.data['Status da produção'] = status; row.data._bambuSyncError = '';
    for (const [field, property] of [['Quantidade produzida','quantity'],['Desperdício (g)','waste'],['Custo do filamento (R$)','total'],['Custo de máquinas (R$)','machineCost']]) row.data[field] = String(next.reduce((n, i) => n + Number(i[property] || 0), 0));
    row.data['Peso (g)'] = String(next.reduce((n, i) => n + Number(i.used || 0) + Number(i.waste || 0), 0));
    completed.push(row.rowNumber);
  }
  return completed;
}
