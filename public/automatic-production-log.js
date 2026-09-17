function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function parseItems(row) {
  try { const items = JSON.parse(row.data['Itens da produção'] || '[]'); return Array.isArray(items) ? items : []; }
  catch { return []; }
}

function duration(hours) {
  const minutes = Math.max(0, Math.round((Number(hours) || 0) * 60));
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

function statusClass(status) {
  return status === 'Concluída' ? 'success' : status === 'Falhou' ? 'failed' : 'pending';
}

export function automaticProductionGroups(rows) {
  const groups = new Map();
  for (const row of rows.filter(candidate => candidate.data._bambuAutomatic === 'true')) {
    const day = String(row.data['Dia produção'] || '').slice(0, 10) || 'sem-data';
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, entries]) => ({
    day,
    entries: entries.sort((a, b) => Date.parse(b.data._bambuStartedAt || 0) - Date.parse(a.data._bambuStartedAt || 0))
  }));
}

export function renderAutomaticProductionLog(container, rows, formatDate) {
  const section = node('section', '', 'automatic-log');
  const header = node('header', '', 'automatic-log-header');
  const title = node('div'); title.append(node('span', 'HISTÓRICO DA BAMBU CLOUD', 'automatic-production-eyebrow'), node('h2', 'Log automático'), node('p', 'Arquivos acompanhados, tempo observado e máquina utilizada em cada dia.'));
  header.append(title); section.append(header);
  const groups = automaticProductionGroups(rows);
  if (!groups.length) {
    section.append(node('div', 'O primeiro item aparecerá aqui assim que uma impressora conectada iniciar uma produção.', 'automatic-production-empty-state'));
    container.replaceChildren(section); return;
  }
  for (const group of groups) {
    const details = node('details', '', 'automatic-log-day'); details.open = group === groups[0];
    const summary = node('summary');
    const identity = node('div'); identity.append(node('strong', group.day === 'sem-data' ? 'Sem data' : formatDate(group.day)), node('span', `${group.entries.length} ${group.entries.length === 1 ? 'item' : 'itens'}`));
    const total = group.entries.reduce((sum, row) => sum + Number(row.data['Horas (h)'] || 0), 0);
    summary.append(identity, node('strong', duration(total), 'automatic-log-total')); details.append(summary);
    const list = node('div', '', 'automatic-log-list');
    for (const row of group.entries) {
      const item = parseItems(row)[0] || {};
      const card = node('article', '', 'automatic-log-entry');
      const heading = node('div', '', 'automatic-log-entry-heading');
      const product = node('div');
      if (item.sku) product.append(node('strong', item.sku, 'automatic-log-sku'));
      product.append(node('span', item.name || row.data['Código do produto'] || 'Arquivo sem nome'));
      heading.append(product, node('span', row.data['Status da produção'] || 'Em produção', `automatic-production-status status-${statusClass(row.data['Status da produção'])}`));
      const info = node('div', '', 'automatic-log-info');
      [['Máquina', row.data['Impressora usada'] || item.machineName || '—'], ['Tempo registrado', duration(row.data['Horas (h)'])], ['Início', dateTime(row.data._bambuStartedAt || row.data['Hora de início'])], ['Término', dateTime(row.data._bambuEndedAt || row.data['Hora de finalização'])]].forEach(([label, value]) => {
        const field = node('div'); field.append(node('span', label), node('strong', value)); info.append(field);
      });
      card.append(heading, node('small', row.data._bambuFileName || item.fileName || '', 'automatic-production-file'), info);
      let events = []; try { events = JSON.parse(row.data._bambuEvents || '[]'); } catch {}
      if (events.length) {
        const alerts = node('div', '', 'automatic-log-alerts'); alerts.append(node('strong', 'Ocorrências'));
        events.slice().reverse().forEach(event => alerts.append(node('p', `${dateTime(event.at)} · ${event.message}`)));
        card.append(alerts);
      }
      list.append(card);
    }
    details.append(list); section.append(details);
  }
  container.replaceChildren(section);
}
