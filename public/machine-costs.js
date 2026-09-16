export const MACHINE_HEADERS = [
  "Nome da máquina", "Modelo", "Status", "Valor de aquisição",
  "Vida útil estimada (h)", "Manutenção estimada na vida útil",
  "Custo de funcionamento (R$/h)", "Custo total por hora (R$/h)",
  "Horas iniciais (h)", "Horas registradas em produção (h)", "Horas totais (h)", "Última manutenção"
];

export function machineNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

export function maintenanceProgress(data) {
  const current = Number(data['Horas totais (h)']) || 0;
  const baseline = Number(data._maintenanceHours) || 0;
  const hours = Math.max(0, current - baseline);
  return {hours, percent: Math.min(100, hours / 350 * 100), remaining: Math.max(0,350-hours), due: hours >= 350};
}

export function calculateMachineCost(data) {
  const values = MACHINE_HEADERS.slice(3, 7).map((header) => machineNumber(data[header]));
  const [purchase, hours, maintenance, running] = values;
  if (values.some((value) => !Number.isFinite(value) || value < 0) || hours <= 0) return null;
  const total = (purchase + maintenance) / hours + running;
  return Number.isFinite(total) ? total : null;
}

export function normalizeMachineData(data) {
  const next = { ...data };
  if (next["Horas iniciais (h)"] === undefined || next["Horas iniciais (h)"] === "") next["Horas iniciais (h)"] = "0";
  if (!next._bambuId && (next[MACHINE_HEADERS[5]] === undefined || next[MACHINE_HEADERS[5]] === "")) next[MACHINE_HEADERS[5]] = "0";
  if (!next._bambuId && (next[MACHINE_HEADERS[6]] === undefined || next[MACHINE_HEADERS[6]] === "")) next[MACHINE_HEADERS[6]] = "0,11";
  const total = calculateMachineCost(next);
  next[MACHINE_HEADERS[7]] = total === null ? "" : String(total);
  return next;
}

export function updateMachineHours(sheets) {
  const hours = new Map();
  for (const row of sheets.producao.rows) {
    if (row.data["Status da produção"] === "Em produção") continue;
    let items;
    try { items = JSON.parse(row.data["Itens da produção"] || "[]"); } catch { continue; }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const machine = sheets.maquinas.rows.find(m => String(m.rowNumber) === String(item.machineRow));
      let cloudJobs = {}; try { cloudJobs = JSON.parse(machine?.data._bambuJobs || '{}'); } catch {}
      if (item.bambuJobKey && cloudJobs[item.bambuJobKey]) continue;
      const value = machineNumber(item.hours);
      if (item.machineRow == null || !Number.isFinite(value) || value < 0) continue;
      const key = String(item.machineRow);
      hours.set(key, (hours.get(key) || 0) + value);
    }
  }
  for (const row of sheets.maquinas.rows) {
    let cloudJobs = {}; try { cloudJobs = JSON.parse(row.data._bambuJobs || '{}'); } catch {}
    const cloudHours = Object.values(cloudJobs).reduce((n, job) => n + (Number(job.hours) || 0), 0);
    const registered = (hours.get(String(row.rowNumber)) || 0) + cloudHours;
    const initial = Number(String(row.data["Horas iniciais (h)"] || 0).replace(',', '.')) || 0;
    row.data["Horas registradas em produção (h)"] = String(registered);
    row.data["Horas totais (h)"] = String(Math.max(0, initial + registered));
  }
}
