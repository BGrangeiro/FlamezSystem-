const node = (tag, text, className) => {
  const value = document.createElement(tag); if (text) value.textContent = text; if (className) value.className = className; return value;
};
export function formatUsageDuration(milliseconds) {
  if (milliseconds > 0 && milliseconds < 60000) return '< 1 min';
  const minutes = Math.floor(Math.max(0, milliseconds || 0) / 60000);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
const dayLabel = day => new Date(day + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const startedLabel = value => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function openDailyUsage(device) {
  const dialog = node('dialog', '', 'bambu-dialog bambu-usage-dialog');
  const header = node('div', '', 'bambu-usage-header');
  const title = node('h2', device.name); const close = node('button', 'Fechar', 'ghost-light-button'); close.type = 'button'; close.onclick = () => dialog.close();
  header.append(title, close);
  const intro = node('p', 'Tempo em impressão · Horário de Brasília', 'bambu-note');
  const days = node('div', '', 'bambu-usage-days');
  const note = node('p', '', 'bambu-note');
  dialog.append(header, intro, days, note);
  const update = next => {
    if (!next) return;
    title.textContent = next.name;
    days.replaceChildren();
    for (const [key, label] of [['today', 'Hoje'], ['yesterday', 'Ontem']]) {
      const record = next.usage?.[key];
      const card = node('div', '', 'bambu-usage-day');
      card.append(node('span', label), node('small', record ? dayLabel(record.day) : ''), node('strong', record?.recorded ? formatUsageDuration(record.printingMs) : 'Sem registro'));
      if (record?.unobservedMs > 0) card.append(node('small', 'Há períodos sem monitoramento', 'bambu-usage-warning'));
      days.append(card);
    }
    note.textContent = next.usage?.firstSeen ? `Acompanhamento iniciado em ${startedLabel(next.usage.firstSeen)}. Contagem pelos dados recebidos, sem incluir pausas ou períodos sem comunicação.` : 'O histórico começa quando o Flamez recebe dados da impressora.';
  };
  update(device);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  return { id: device.id, update, close: () => dialog.close(), get open() { return dialog.open; } };
}

let cleanup = () => {};
export function stopBambuUsageLog() { cleanup(); cleanup = () => {}; }
export function renderBambuUsageLog(container, api) {
  stopBambuUsageLog(); container.replaceChildren();
  const header = node('div', '', 'bambu-log-header');
  header.append(node('h2', 'Histórico de uso'), node('p', 'Abra uma impressora para consultar as horas de cada dia. Fechamento à meia-noite, no horário de Brasília.', 'bambu-note'));
  const feedback = node('p', 'Carregando histórico…', 'bambu-note'); feedback.setAttribute('role', 'status');
  const list = node('div', '', 'bambu-log-list'); container.append(header, feedback, list);
  const cards = new Map(); let disposed = false, timer;
  cleanup = () => { disposed = true; clearTimeout(timer); };
  async function refresh() {
    try {
      const data = await api('/api/bambu/usage', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (disposed) return;
      feedback.textContent = data.storageError || (data.printers.length ? 'O histórico permanece salvo mesmo se a impressora for removida da conta Bambu. Períodos com o servidor desligado ou sem sinal não contam como impressão.' : 'As impressoras aparecerão aqui automaticamente ao serem detectadas na Bambu Cloud.');
      for (const printer of data.printers) {
        let view = cards.get(printer.id);
        if (!view) {
          const details = node('details', '', 'bambu-log-printer'); const summary = node('summary');
          const name = node('strong'); const model = node('small'); const identity = node('div'); identity.append(name, model);
          const count = node('span', '', 'bambu-log-count'); summary.append(identity, count);
          const body = node('div', '', 'bambu-log-days'); details.append(summary, body); list.append(details);
          view = { details, name, model, count, body }; cards.set(printer.id, view);
        }
        view.name.textContent = printer.name; view.model.textContent = `${printer.model} · ${printer.id.slice(-6)}`;
        view.count.textContent = `${printer.days.length} ${printer.days.length === 1 ? 'dia' : 'dias'}`;
        view.body.replaceChildren();
        view.body.append(node('p', `Acompanhamento desde ${startedLabel(printer.firstSeen)}`, 'bambu-note'));
        for (const day of printer.days) {
          const row = node('div', '', 'bambu-log-day');
          const label = day.day === printer.today.day ? ' · Hoje' : day.day === printer.yesterday.day ? ' · Ontem' : '';
          row.append(node('span', dayLabel(day.day) + label), node('strong', day.recorded ? formatUsageDuration(day.printingMs) : '—'));
          const note = !day.recorded ? 'Sem monitoramento' : day.unobservedMs > 0 ? 'Registro com lacunas' : 'Tempo acompanhado';
          row.append(node('small', note)); view.body.append(row);
        }
      }
    } catch (error) { if (!disposed) feedback.textContent = error.message; }
    finally { if (!disposed) timer = setTimeout(refresh, 30000); }
  }
  refresh();
}
