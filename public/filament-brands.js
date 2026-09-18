function brandKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '');
}

export function collectFilamentBrands(...rowGroups) {
  const brands = new Map();
  for (const rows of rowGroups) for (const row of rows || []) {
    const brand = String(row?.data?.Marca || '').trim();
    const key = brandKey(brand);
    if (key && !brands.has(key)) brands.set(key, brand);
  }
  return [...brands.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
