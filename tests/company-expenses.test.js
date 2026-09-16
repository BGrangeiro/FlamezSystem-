import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExpense} from '../lib/company-expenses.js';
import {maintenanceProgress} from '../public/machine-costs.js';

const expense = {'Descrição': 'Compra de filamento', 'Valor (R$)': '1.234,56', Data: '2026-09-16', Categoria: 'Filamento', 'Onde comprou / para quem pagou': 'Loja de filamentos', Observações: 'Fornecedor local\nPagamento via Pix'};
test('gastos preservam observações e normalizam reais sem perder centavos', () => {
  const normalized = normalizeExpense(expense);
  assert.equal(normalized['Valor (R$)'], '1234.56');
  assert.equal(normalized.Observações, expense.Observações);
  assert.equal(normalized['Onde comprou / para quem pagou'], 'Loja de filamentos');
  assert.equal(normalizeExpense({...expense, 'Valor (R$)': '0,01'})['Valor (R$)'], '0.01');
  for (const value of ['', '0', '-1', 'NaN', '1,234', '1.234', '1e3', '99999999999999999999']) {
    assert.throws(() => normalizeExpense({...expense, 'Valor (R$)': value}), error => error.statusCode === 400);
  }
  assert.throws(() => normalizeExpense({...expense, Data: '2026-02-30'}), /data válida/);
  assert.throws(() => normalizeExpense({...expense, Descrição: ' '}), /descrição/);
});

test('categorias de gastos validam novas opções e preservam categorias anteriores', () => {
  for (const Categoria of ['Custo da empresa', 'Imprevisto', 'Filamento', 'Peças', 'Impressora', 'Material', 'Outros']) assert.equal(normalizeExpense({...expense, Categoria}).Categoria, Categoria);
  assert.equal(normalizeExpense({...expense, Categoria: ''}).Categoria, 'Outros');
  assert.throws(() => normalizeExpense({...expense, Categoria: 'Inválida'}), /categoria válida/);
  assert.equal(normalizeExpense({...expense, Categoria: 'Materiais'}, {Categoria: 'Materiais'}).Categoria, 'Materiais');
  assert.throws(() => normalizeExpense({...expense, 'Onde comprou / para quem pagou': 'x'.repeat(161)}), /160 caracteres/);
});

test('manutenção vence em 400 horas desde a última referência', () => {
  assert.deepEqual(maintenanceProgress({'Horas totais (h)': '450', _maintenanceHours: '100'}), {hours: 350, percent: 87.5, remaining: 50, due: false});
  assert.equal(maintenanceProgress({'Horas totais (h)': '499', _maintenanceHours: '100'}).due, false);
  assert.deepEqual(maintenanceProgress({'Horas totais (h)': '500', _maintenanceHours: '100'}), {hours: 400, percent: 100, remaining: 0, due: true});
});
