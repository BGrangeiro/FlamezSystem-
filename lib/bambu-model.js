export function amsPresence(device) {
  if (typeof device.telemetry?.hasAms === 'boolean') return device.telemetry.hasAms;
  if (device.telemetry?.ams?.some(unit => unit && unit.id != null && unit.id !== '')) return true;
  return null;
}
export function identifiedModel(device) {
  const model = String(device.model || '');
  const hasAms = amsPresence(device);
  const base = model.trim().replace(/\s+combo$/i, '');
  if (hasAms === null || !/^(?:Bambu(?: Lab)?\s+)?A1(?:\s+mini)?$/i.test(base)) return model;
  return hasAms ? `${base} Combo` : base;
}
export function identifiedName(device) {
  const model = identifiedModel(device);
  return model !== device.model && device.name?.trim().toLowerCase() === device.model?.trim().toLowerCase() ? model : device.name;
}
