import path from 'node:path';
import { readJson, writeJson } from './storage.js';

export const USAGE_TIME_ZONE = 'America/Sao_Paulo';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: USAGE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const usageDay = timestamp => dateFormat.format(timestamp);
export function previousUsageDay(day) {
  return new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
}
const blankDay = () => ({ printingMs: 0, pausedMs: 0, observedMs: 0, unobservedMs: 0 });

// Locate civil midnight in the configured timezone, independently of the host timezone.
export function splitUsageInterval(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const segments = [];
  while (start < end) {
    const day = usageDay(start);
    let boundary = end;
    if (usageDay(end - 1) !== day) {
      let low = start, high = Math.min(end, start + 26 * 3600000);
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (usageDay(mid) === day) low = mid; else high = mid;
      }
      boundary = high;
    }
    segments.push({ day, milliseconds: boundary - start });
    start = boundary;
  }
  return segments;
}

export function validateBambuUsage(data) {
  if (!data || data.version !== 1 || !data.printers || typeof data.printers !== 'object' || Array.isArray(data.printers)) throw new Error('Histórico Bambu inválido. Restaure um backup.');
  for (const [id, printer] of Object.entries(data.printers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ['__proto__','constructor','prototype'].includes(id) || !printer?.days || typeof printer.days !== 'object' || Array.isArray(printer.days) || !Number.isFinite(printer.firstSeen)) throw new Error('Histórico Bambu inválido.');
    for (const [day, totals] of Object.entries(printer.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Object.keys(blankDay()).some(key => !Number.isFinite(totals?.[key]) || totals[key] < 0)) throw new Error('Totais do histórico Bambu inválidos.');
    }
  }
  return data;
}

export const emptyBambuUsage = () => ({ version: 1, timeZone: USAGE_TIME_ZONE, printers: {} });

export function createBambuUsage(dataDir, { now = Date.now } = {}) {
  const file = path.join(dataDir, 'bambu-usage.local.json');
  let data = emptyBambuUsage(), timer, writes = Promise.resolve(), revision = 0, savedRevision = 0, storageError = '';
  const cursors = new Map();
  function dirty() {
    revision++;
    if (!timer) { timer = setTimeout(() => { timer = undefined; flush().catch(() => {}); }, 1000); timer.unref?.(); }
  }
  function flush() {
    clearTimeout(timer); timer = undefined;
    writes = writes.catch(() => {}).then(async () => {
      if (savedRevision === revision) return;
      const version = revision;
      try { await writeJson(file, structuredClone(data)); savedRevision = version; storageError = ''; }
      catch (error) { storageError = 'Não foi possível salvar o histórico de horas. Verifique o espaço e as permissões do servidor.'; throw error; }
    });
    return writes;
  }
  function addInterval(printer, start, end, state) {
    for (const { day, milliseconds } of splitUsageInterval(start, end)) {
      const totals = printer.days[day] ||= blankDay();
      if (state === null) totals.unobservedMs += milliseconds;
      else {
        totals.observedMs += milliseconds;
        if (state === 'RUNNING') totals.printingMs += milliseconds;
        if (state === 'PAUSE') totals.pausedMs += milliseconds;
      }
    }
  }
  function summary(id, at = now()) {
    const printer = data.printers[id];
    const today = usageDay(at), yesterday = previousUsageDay(today);
    const total = day => ({ day, ...blankDay(), ...printer?.days[day], recorded: Boolean(printer?.days[day]) });
    return { timeZone: USAGE_TIME_ZONE, firstSeen: printer?.firstSeen ?? null, today: total(today), yesterday: total(yesterday) };
  }
  return {
    async init() { data = validateBambuUsage(await readJson(file, emptyBambuUsage())); },
    register(devices) {
      for (const device of devices) {
        if (!/^[a-zA-Z0-9_-]+$/.test(device.id) || ['__proto__','constructor','prototype'].includes(device.id)) continue;
        let printer = data.printers[device.id];
        if (!printer) { printer = data.printers[device.id] = { name: device.name, model: device.model, firstSeen: now(), lastSeen: null, days: {} }; dirty(); }
        if (printer.name !== device.name || printer.model !== device.model) { printer.name = device.name; printer.model = device.model; dirty(); }
      }
    },
    observe(device, at = now()) {
      const printer = data.printers[device.id];
      if (!printer || !Number.isFinite(at) || (printer.lastSeen !== null && at <= printer.lastSeen)) return;
      const previous = cursors.get(device.id);
      if (previous) {
        // Never extrapolate printing across lost communication, restarts or delayed reports.
        const reliable = !previous.broken && at - previous.at <= 120000 && !(previous.jobId && device.jobId && previous.jobId !== device.jobId);
        addInterval(printer, previous.at, at, reliable ? previous.state : null);
      } else if (printer.lastSeen !== null) addInterval(printer, printer.lastSeen, at, null);
      printer.days[usageDay(at)] ||= blankDay();
      printer.lastSeen = at;
      cursors.set(device.id, { at, state: device.state || 'UNKNOWN', jobId: device.jobId });
      dirty();
    },
    breakConnection(ids) {
      for (const [id, cursor] of cursors) if (!ids || ids.includes(id)) cursor.broken = true;
    },
    summary,
    history() {
      const at = now();
      return { timeZone: USAGE_TIME_ZONE, storageError, printers: Object.entries(data.printers).map(([id, printer]) => {
        const days = [];
        for (let day = usageDay(at), first = usageDay(printer.firstSeen); day >= first; day = previousUsageDay(day)) {
          days.push({ day, ...blankDay(), ...printer.days[day], recorded: Boolean(printer.days[day]) });
        }
        return { id, name: printer.name, model: printer.model, firstSeen: printer.firstSeen, lastSeen: printer.lastSeen, ...summary(id, at), days };
      }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })) };
    },
    get error() { return storageError; },
    flush
  };
}
