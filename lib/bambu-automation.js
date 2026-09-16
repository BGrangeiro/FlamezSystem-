import { applyProductionOutcome } from '../public/production-status.js';

export const parseObject = (value, fallback = {}) => { try { return JSON.parse(value || '') || fallback; } catch { return fallback; } };
const itemsOf = row => parseObject(row.data['Itens da produção'], []);
const active = state => ['RUNNING', 'PAUSE', 'PREPARE'].includes(state);
const terminal = state => ['FINISH', 'FAILED'].includes(state);

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
          'Nome da máquina': device.name, Modelo: device.model, Status: 'Ativa',
          'Valor de aquisição': '', 'Vida útil estimada (h)': '', 'Manutenção estimada na vida útil': '',
          'Custo de funcionamento (R$/h)': '', 'Última manutenção': '', 'Horas iniciais (h)': '0'
        } };
        sheets.maquinas.rows.push(row);
      }
      row.data._bambuId = device.id; changed = true;
    }
    if (!row.data.Modelo && device.model) { row.data.Modelo = device.model; changed = true; }
  }
  return changed;
}

export function bindProduction(sheets, row, previous, at = Date.now()) {
  const bindings = parseObject(previous?.data._bambuBindings);
  const items = itemsOf(row);
  const ids = new Set(items.map(i => String(i.machineRow)));
  for (const id of Object.keys(bindings)) if (!ids.has(id)) delete bindings[id];
  if (row.data['Status da produção'] === 'Em produção') for (const id of ids) {
    const machine = sheets.maquinas.rows.find(m => String(m.rowNumber) === id);
    if (!machine?.data._bambuId || bindings[id]) continue;
    const conflicts = sheets.producao.rows.some(r => r.rowNumber !== row.rowNumber && r.data['Status da produção'] === 'Em produção' && itemsOf(r).some(i => String(i.machineRow) === id));
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
  const changedId = device.jobId && job.id && device.jobId !== job.id;
  if (active(device.state) && (!job.key || changedId || terminal(job.state))) {
    job = { key: `${device.id}:${device.jobId || 'local'}:${at}`, id: device.jobId || '', start: at, milliseconds: 0, state: device.state, lastAt: at };
  }
  if (!job.key || changedId) return; // An old completed job cannot complete a newly entered production.
  if (continuous && job.state === 'RUNNING' && at - job.lastAt <= 120000) job.milliseconds += at - job.lastAt;
  job.lastAt = at; job.state = device.state;
  if (terminal(job.state) && !jobs[job.key]) jobs[job.key] = { hours: job.milliseconds / 3600000, state: job.state, endedAt: at };
  machine.data._bambuCurrent = JSON.stringify(job);
  machine.data._bambuJobs = JSON.stringify(jobs);
  for (const row of sheets.producao.rows) {
    if (row.data['Status da produção'] !== 'Em produção') continue;
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
    if (row.data['Status da produção'] !== 'Em produção') continue;
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
