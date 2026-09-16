export const orderDeliveries = data => JSON.parse(data._deliveries || '[]');
export function deliveryTotals(data) {
  const delivered = orderDeliveries(data).reduce((sum, entry) => sum + entry.quantity, 0);
  const raw = String(data['Quantidade de itens'] || data['Quantidade da entrega'] || '').trim();
  const total = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  return {delivered, total, remaining: total === null ? null : Math.max(0, total - delivered)};
}
export function addDelivery(data, entry) {
  const invalid = message => Object.assign(new Error(message), {statusCode: 400});
  if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(entry.id)) throw invalid('Identificador da entrega inválido.');
  if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0,10) !== entry.date) throw invalid('Informe uma data de entrega válida.');
  if (!Number.isSafeInteger(entry.quantity) || entry.quantity <= 0) throw invalid('Informe uma quantidade inteira maior que zero.');
  const entries = orderDeliveries(data), previous = entries.find(item => item.id === entry.id);
  if (previous) {
    if (previous.date !== entry.date || previous.quantity !== entry.quantity) throw invalid('Esta entrega já foi registrada com outros dados.');
    return data;
  }
  if (/^sim$/i.test(data.Cancelado || '')) throw invalid('Não é possível adicionar entrega a uma encomenda cancelada.');
  const {delivered, total} = deliveryTotals(data);
  if (!Number.isSafeInteger(delivered + entry.quantity)) throw invalid('Quantidade acumulada inválida.');
  if (total !== null && delivered + entry.quantity > total) throw invalid(`A quantidade supera o saldo de ${total - delivered} itens desta encomenda.`);
  return {...data, _deliveries: JSON.stringify([...entries, {id: entry.id, date: entry.date, quantity: entry.quantity}])};
}
const node = (tag, text, className = '') => {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
};
export function renderDeliveryHistory(data) {
  const section = node('section', '', 'order-deliveries');
  const {delivered, total, remaining} = deliveryTotals(data);
  section.append(node('h3', 'Entregas'), node('p', total === null ? `${delivered} itens entregues · quantidade total não informada` : `${delivered} de ${total} itens entregues · faltam ${remaining}`));
  const entries = [...orderDeliveries(data)].sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) section.append(node('p', 'Nenhuma entrega registrada.'));
  for (const entry of entries) {
    const item = node('div', '', 'delivery-entry');
    item.append(node('span', entry.date.split('-').reverse().join('/')), node('strong', `${entry.quantity} ${entry.quantity === 1 ? 'item entregue' : 'itens entregues'}`)); section.append(item);
  }
  return section;
}
export function openDeliveryDialog(row, {api, reload, todayInputValue}) {
  const dialog = node('dialog', '', 'filament-dialog'), form = node('form', '', 'filament-editor');
  const totals = deliveryTotals(row.data);
  form.append(node('h2', 'Adicionar entrega'), node('p', row.data['Nome da encomenda'] || 'Encomenda'));
  form.append(node('p', totals.remaining === null ? 'Informe a quantidade total na encomenda para acompanhar o saldo.' : `Faltam entregar ${totals.remaining} itens.`));
  const dateLabel = node('label', 'Data da entrega', 'field'), date = document.createElement('input');
  date.type = 'date'; date.required = true; date.value = todayInputValue(); dateLabel.append(date);
  const quantityLabel = node('label', 'Quantidade entregue', 'field'), quantity = document.createElement('input');
  quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.required = true;
  if (totals.remaining !== null) quantity.max = String(totals.remaining);
  quantityLabel.append(quantity);
  const error = node('p', ''); error.setAttribute('role', 'alert');
  const actions = node('div', '', 'row-actions');
  const cancel = node('button', 'Cancelar', 'ghost-light-button'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
  const save = node('button', 'Salvar entrega', 'small-button'); save.type = 'submit';
  actions.append(cancel, save); form.append(dateLabel, quantityLabel, error, actions); dialog.append(form); document.body.append(dialog);
  let busy = false; const id = crypto.randomUUID();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; save.disabled = cancel.disabled = true; error.textContent = '';
    try {
      await api('/api/orders/deliveries', {method: 'POST', body: JSON.stringify({rowNumber: row.rowNumber, id, date: date.value, quantity: Number(quantity.value)})});
      dialog.close(); await reload();
    } catch (failure) { error.textContent = failure.message; }
    finally { busy = false; save.disabled = cancel.disabled = false; }
  };
  dialog.showModal(); quantity.focus();
}
