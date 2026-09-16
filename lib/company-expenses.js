import { EXPENSE_CATEGORIES } from '../public/expense-categories.js';
export const EXPENSE_HEADERS = ['Descrição', 'Valor (R$)', 'Data', 'Onde comprou / para quem pagou', 'Categoria', 'Observações'];

export function normalizeExpense(data, previous = {}) {
  const invalid = message => Object.assign(new Error(message), {statusCode: 400});
  const result = Object.fromEntries(EXPENSE_HEADERS.map(key => [key, String(data?.[key] ?? '').trim()]));
  if (!result.Descrição || result.Descrição.length > 160) throw invalid('Informe uma descrição de até 160 caracteres.');
  const raw = result['Valor (R$)'];
  const valid = /^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(raw) || /^\d+(?:\.\d{1,2})?$/.test(raw);
  const amount = Number(raw.includes(',') ? raw.replaceAll('.', '').replace(',', '.') : raw);
  const cents = Math.round(amount * 100);
  if (!valid || !Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999) throw invalid('Informe um valor maior que zero, com até duas casas decimais.');
  const date = result.Data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw invalid('Informe uma data válida para o gasto.');
  if (result.Categoria.length > 80) throw invalid('A categoria deve ter até 80 caracteres.');
  result.Categoria ||= 'Outros';
  if (!EXPENSE_CATEGORIES.includes(result.Categoria) && result.Categoria !== previous.Categoria) throw invalid('Selecione uma categoria válida.');
  if (result['Onde comprou / para quem pagou'].length > 160) throw invalid('O local ou destinatário deve ter até 160 caracteres.');
  if (result.Observações.length > 5000) throw invalid('As observações devem ter até 5.000 caracteres.');
  result['Valor (R$)'] = (cents / 100).toFixed(2);
  return result;
}
