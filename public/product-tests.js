export const PRODUCT_TEST_HEADERS = ['Produto', 'Link'];

export function normalizeProductTest(data) {
  const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
  const product = String(data.Produto || '').trim();
  let link = String(data.Link || '').trim();
  if (!product) throw invalid('Informe o nome do produto.');
  if (product.length > 160) throw invalid('O nome do produto deve ter no máximo 160 caracteres.');
  if (!link) throw invalid('Informe o link do produto.');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(link)) link = `https://${link}`;
  let url;
  try { url = new URL(link); } catch { throw invalid('Informe um link válido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw invalid('Use um link de site válido, começando com http:// ou https://.');
  if (url.href.length > 2048) throw invalid('O link é muito longo.');
  return { Produto: product, Link: url.href };
}

export function renderProductTests(ctx) {
  const { state, elements, saveRow, deleteRow, render } = ctx;
  state.editingProductTests ??= new Set();
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (text, action, className = 'primary-button') => {
    const node = el('button', className, text); node.type = 'button'; node.onclick = action; return node;
  };
  const redraw = () => render();
  elements.content.replaceChildren(el('p', 'machine-formula', 'Salve ideias de produtos para avaliar depois. O link pode ser da Shopee, Google Drive ou de qualquer outro site.'));
  const grid = el('div', 'product-test-grid'); elements.content.append(grid);
  const query = elements.searchInput.value.trim().toLowerCase();
  for (const row of state.draft ? [state.draft, ...state.rows] : state.rows) {
    if (row.rowNumber && query && !String(row.data.Produto || '').toLowerCase().includes(query)) continue;
    const card = el('article', 'product-test-card'); grid.append(card);
    if (row.rowNumber && !state.editingProductTests.has(String(row.rowNumber))) {
      card.append(el('h3', '', row.data.Produto));
      const actions = el('div', 'row-actions');
      const link = el('a', 'primary-button product-test-link', 'Abrir link');
      link.href = row.data.Link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      actions.append(link, button('Editar', () => { state.editingProductTests.add(String(row.rowNumber)); redraw(); }, 'ghost-light-button'));
      card.append(actions); continue;
    }
    card.append(el('h3', '', row.rowNumber ? 'Editar produto' : 'Novo produto para testar'));
    const form = el('form', 'product-test-form');
    const product = el('input'); product.type = 'text'; product.required = true; product.maxLength = 160; product.placeholder = 'Ex.: Suporte de controle'; product.value = row.data.Produto || '';
    const link = el('input'); link.type = 'text'; link.inputMode = 'url'; link.required = true; link.placeholder = 'https://...'; link.value = row.data.Link || '';
    for (const [title, input] of [['Nome do produto', product], ['Link do produto', link]]) { const label = el('label', 'field', title); label.append(input); form.append(label); }
    const feedback = el('p', 'stock-feedback'); feedback.setAttribute('role', 'alert');
    const save = el('button', 'primary-button', 'Salvar produto'); save.type = 'submit';
    const cancel = button('Cancelar', () => { if (!row.rowNumber) deleteRow('productTests', null); else { state.editingProductTests.delete(String(row.rowNumber)); redraw(); } }, 'ghost-light-button');
    const actions = el('div', 'row-actions');
    if (row.rowNumber) actions.append(button('Excluir', () => deleteRow('productTests', row.rowNumber), 'danger-button'));
    actions.append(cancel, save); form.append(feedback, actions); card.append(form);
    form.onsubmit = async event => {
      event.preventDefault();
      try { await saveRow('productTests', row.rowNumber, normalizeProductTest({ Produto: product.value, Link: link.value }), save); }
      catch (error) { feedback.textContent = error.message; }
    };
  }
  if (!grid.children.length) grid.append(el('div', 'empty-state', query ? 'Nenhum produto encontrado.' : 'Nenhum produto para testar cadastrado.'));
}
