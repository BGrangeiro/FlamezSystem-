import { machineNumber } from './machine-costs.js';
export const PRODUCTION_STATUSES = ['Em produção', 'Concluída', 'Parcial', 'Falhou'];
export function applyProductionOutcome(items, status) {
  if (!PRODUCTION_STATUSES.includes(status)) throw new Error('Selecione um status válido.');
  return items.map(item => {
    const weight = Number(item.plannedUsed ?? item.used);
    const baseCost = Number(item.plannedFilamentTotal ?? item.total);
    const plannedHours = machineNumber(item.plannedHours ?? item.hours ?? 0);
    if (![weight, baseCost, plannedHours].every(Number.isFinite) || weight < 0 || baseCost < 0 || plannedHours < 0) throw new Error('Dados da produção inválidos.');
    const waste = status === 'Falhou' ? machineNumber(item.failureWaste ?? weight) : status === 'Parcial' ? machineNumber(item.waste) : 0;
    if (!Number.isFinite(waste) || waste < 0 || (status !== 'Falhou' && waste > weight)) throw new Error(status === 'Falhou' ? 'Informe o filamento realmente desperdiçado em gramas, maior ou igual a zero.' : 'O desperdício deve estar entre zero e o filamento previsto do item.');
    const hours = status === 'Em produção' ? 0 : status === 'Falhou' ? machineNumber(item.failureHours) : plannedHours;
    if (!Number.isFinite(hours) || hours < 0) throw new Error('Informe as horas realmente gastas até interromper a impressão.');
    if (!item.machineRow && hours > 0) throw new Error('Selecione a máquina utilizada.');
    return {...item, plannedUsed: weight, plannedFilamentTotal: baseCost, plannedHours,
      used: status === 'Falhou' ? 0 : weight - waste, waste,
      total: status === 'Falhou' ? (weight > 0 ? baseCost * waste / weight : 0) : baseCost, hours,
      machineCost: item.machineRate == null ? 0 : Number(item.machineRate) * hours};
  });
}
export function productionDraftItem(item) {
  const copy = {...item, used: item.plannedUsed ?? item.used, total: item.plannedFilamentTotal ?? item.total, hours: item.plannedHours ?? item.hours};
  delete copy.plannedUsed; delete copy.plannedFilamentTotal; delete copy.plannedHours;
  return copy;
}
