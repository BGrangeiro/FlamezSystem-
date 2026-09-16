import { EXPENSE_CATEGORIES } from './expense-categories.js';

const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const PAYEE = 'Onde comprou / para quem pagou';

export function renderCompanyExpenses({state, elements, saveRow, deleteRow, formatMoney, todayInputValue}) {
  elements.content.replaceChildren();
  const term = elements.searchInput.value.trim().toLocaleLowerCase('pt-BR');
  const rows = state.rows.filter(row => Object.values(row.data).some(value => String(value).toLocaleLowerCase('pt-BR').includes(term)))
    .sort((a, b) => b.data.Data.localeCompare(a.data.Data) || b.rowNumber - a.rowNumber);
  const total = rows.reduce((sum, row) => sum + Math.round(Number(row.data['Valor (R$)']) * 100), 0) / 100;
  const summary = el('div', 'expense-summary');
  const countLabel = rows.length === 1 ? (term ? '1 gasto encontrado' : '1 gasto registrado') : `${rows.length} gastos ${term ? 'encontrados' : 'registrados'}`;
  summary.append(el('div', '', countLabel), el('strong', '', formatMoney(total)));
  elements.content.append(summary);
  const grid = el('div', 'expense-grid');
  const entries = state.draft ? [state.draft, ...rows] : rows;
  if (!entries.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('h2', '', 'Nenhum gasto registrado'), el('p', '', 'Clique em Novo gasto para anotar uma compra ou despesa da empresa.'));
    elements.content.append(empty);
    return;
  }
  for (const row of entries) {
    const draft = row.rowNumber === null;
    const card = el(draft ? 'article' : 'details', 'expense-card');
    const body = el('div', 'expense-body');
    if (draft) card.append(el('h2', 'expense-draft-title', 'Novo gasto'));
    else {
      const header = el('summary', 'expense-card-toggle');
      for (const [label, value, className] of [
        ['O que foi comprado ou pago', row.data.Descrição, 'expense-name'],
        ['Valor', formatMoney(Number(row.data['Valor (R$)'])), 'expense-amount'],
        [PAYEE, row.data[PAYEE] || 'Não informado', 'expense-payee']
      ]) {
        const item = el('span', className);
        item.append(el('small', '', label), el('strong', '', value)); header.append(item);
      }
      const arrow = el('span', 'expense-chevron', '⌄'); arrow.setAttribute('aria-hidden', 'true'); header.append(arrow);
      card.append(header);
    }
    const showDetails = () => {
      body.replaceChildren();
      const info = el('dl', 'expense-details');
      const date = row.data.Data ? row.data.Data.split('-').reverse().join('/') : 'Não informada';
      for (const [label, value] of [['Data do gasto', date], ['Categoria', row.data.Categoria || 'Outros'], ['Observações', row.data.Observações || 'Nenhuma observação.']]) {
        const item = el('div', label === 'Observações' ? 'expense-wide' : '');
        item.append(el('dt', '', label), el('dd', '', value)); info.append(item);
      }
      const edit = el('button', 'small-button', 'Editar gasto'); edit.type = 'button';
      edit.onclick = () => { showEditor(); body.querySelector('input').focus(); };
      body.append(info, edit);
    };
    const showEditor = () => {
      body.replaceChildren();
      const form = el('form', 'expense-form');
      const fields = [
        ['Descrição', 'O que foi comprado ou pago?', 'text', 160],
        ['Valor (R$)', 'Valor (R$)', 'text'],
        ['Data', 'Data do gasto', 'date'],
        [PAYEE, PAYEE, 'text', 160],
        ['Categoria', 'Categoria', 'select'],
        ['Observações', 'Observações', 'textarea', 5000]
      ];
      for (const [name, title, type, maxLength] of fields) {
        const label = el('label', `field${['Descrição', 'Observações'].includes(name) ? ' expense-wide' : ''}`, title);
        const input = document.createElement(['textarea', 'select'].includes(type) ? type : 'input');
        if (type === 'select') {
          for (const category of EXPENSE_CATEGORIES) input.append(new Option(category, category));
          if (row.data.Categoria && !EXPENSE_CATEGORIES.includes(row.data.Categoria)) input.append(new Option(`${row.data.Categoria} (anterior)`, row.data.Categoria));
        } else if (type === 'textarea') { input.rows = 4; input.placeholder = 'Motivo da compra, detalhes do pagamento…'; }
        else input.type = type;
        input.name = name;
        input.value = row.data[name] || (name === 'Data' && draft ? todayInputValue() : name === 'Categoria' ? 'Outros' : '');
        if (name === 'Valor (R$)') { input.value = input.value.replace('.', ','); input.inputMode = 'decimal'; input.placeholder = '0,00'; }
        if (name === PAYEE) input.placeholder = 'Loja, fornecedor ou pessoa';
        if (maxLength) input.maxLength = maxLength;
        if (['Descrição', 'Valor (R$)', 'Data', 'Categoria'].includes(name)) input.required = true;
        label.append(input); form.append(label);
      }
      const actions = el('div', 'row-actions expense-wide');
      const cancel = el('button', 'ghost-light-button', 'Cancelar'); cancel.type = 'button';
      cancel.onclick = () => { if (draft) deleteRow('companyExpenses', null); else { showDetails(); body.querySelector('button').focus(); } };
      actions.append(cancel);
      if (!draft) {
        const remove = el('button', 'danger-button', 'Excluir gasto'); remove.type = 'button';
        remove.onclick = () => { if (window.confirm(`Excluir o gasto “${row.data.Descrição}”?`)) deleteRow('companyExpenses', row.rowNumber); };
        actions.append(remove);
      }
      const save = el('button', 'small-button', 'Salvar gasto'); save.type = 'submit';
      form.onsubmit = event => {
        event.preventDefault();
        saveRow('companyExpenses', row.rowNumber, Object.fromEntries(new FormData(form)), save);
      };
      actions.append(save); form.append(actions); body.append(form);
    };
    if (draft) showEditor(); else showDetails();
    card.append(body); grid.append(card);
  }
  elements.content.append(grid);
}
