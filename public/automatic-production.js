let cleanup = () => {};

export function stopAutomaticProduction() {
  cleanup();
  cleanup = () => {};
}

function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function baseName(value) {
  return String(value || '').trim().split(/[\\/]/).pop() || '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function identifyAutomaticJob(jobName, products = []) {
  const fileName = baseName(jobName);
  const skuProducts = products
    .map(product => ({ product, sku: String(product?.data?.SKU || '').trim() }))
    .filter(entry => entry.sku)
    .sort((a, b) => b.sku.length - a.sku.length);

  for (const entry of skuProducts) {
    const match = fileName.match(new RegExp(`^${escapeRegExp(entry.sku)}(?:\\s*\\(\\d+\\))?(?:\\.[^.]+)?$`, 'i'));
    if (match) return {
      fileName,
      sku: entry.sku.toUpperCase(),
      productName: String(entry.product.data.Produto || '').trim(),
      productRow: entry.product.rowNumber,
      recognized: true
    };
  }

  return { fileName, sku: '', productName: fileName.replace(/\.[^.]+$/, '') || 'Arquivo não informado', productRow: null, recognized: false };
}

const stateLabels = {
  RUNNING: 'Imprimindo', PAUSE: 'Pausada', PREPARE: 'Preparando', SLICING: 'Fatiando',
  FINISH: 'Finalizada', FAILED: 'Falhou', IDLE: 'Disponível', OFFLINE: 'Offline', UNKNOWN: 'Aguardando dados'
};
const activeStates = new Set(['RUNNING', 'PAUSE', 'PREPARE', 'SLICING']);

function remainingLabel(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.max(0, Math.round(minutes));
  return `${Math.floor(rounded / 60)} h ${rounded % 60} min`;
}

function machineCard(device, products) {
  const job = identifyAutomaticJob(device.jobName, products);
  const fresh = !device.stale && device.state !== 'OFFLINE';
  const card = node('article', '', `automatic-production-card${fresh && activeStates.has(device.state) ? ' is-active' : ''}`);
  const heading = node('div', '', 'automatic-production-heading');
  const identity = node('div');
  identity.append(node('span', 'MÁQUINA', 'automatic-production-eyebrow'), node('h3', device.name || 'Impressora Bambu'));
  const status = node('span', fresh ? stateLabels[device.state] || 'Estado não identificado' : 'Sem sinal', `automatic-production-status status-${String(fresh ? device.state : 'OFFLINE').toLowerCase()}`);
  heading.append(identity, status);
  card.append(heading);

  if (device.jobName) {
    const jobInfo = node('div', '', 'automatic-production-job');
    const title = node('div');
    if (job.recognized) {
      title.append(node('strong', job.sku, 'automatic-production-sku'));
      if (job.productName) title.append(node('span', job.productName, 'automatic-production-product'));
    } else {
      title.append(node('strong', job.productName, 'automatic-production-product'));
      title.append(node('span', 'Arquivo sem SKU reconhecido', 'automatic-production-unmatched'));
    }
    jobInfo.append(title, node('small', job.fileName, 'automatic-production-file'));
    card.append(jobInfo);
  } else {
    card.append(node('p', fresh ? 'Nenhum arquivo em produção no momento.' : 'Aguardando informações da impressora.', 'automatic-production-empty'));
  }

  const metrics = node('div', '', 'automatic-production-metrics');
  const progress = fresh && Number.isFinite(device.progress) ? `${device.progress}%` : '—';
  const layer = device.telemetry && Number.isFinite(device.telemetry.currentLayer)
    ? `${device.telemetry.currentLayer}${Number.isFinite(device.telemetry.totalLayers) ? ` de ${device.telemetry.totalLayers}` : ''}` : '—';
  [['Progresso', progress], ['Tempo restante', fresh ? remainingLabel(device.remainingMinutes) : '—'], ['Camada', layer]].forEach(([label, value]) => {
    const metric = node('div'); metric.append(node('span', label), node('strong', value)); metrics.append(metric);
  });
  card.append(metrics);
  const bar = node('progress'); bar.max = 100; bar.value = fresh && Number.isFinite(device.progress) ? device.progress : 0;
  bar.setAttribute('aria-label', `Progresso da produção na máquina ${device.name}`); card.append(bar);
  card.append(node('small', device.updatedAt ? `Atualizado em ${new Date(device.updatedAt).toLocaleString('pt-BR')}` : 'Aguardando a primeira atualização.', 'automatic-production-updated'));
  return card;
}

export function renderAutomaticProduction(container, api, products = []) {
  stopAutomaticProduction();
  const section = node('section', '', 'automatic-production');
  const header = node('header', '', 'automatic-production-hero');
  const title = node('div');
  title.append(node('span', 'ACOMPANHAMENTO EM TEMPO REAL', 'automatic-production-eyebrow'), node('h2', 'Produção automática'), node('p', 'Arquivos das impressoras conectadas à Bambu Cloud, atualizados automaticamente.'));
  const connection = node('span', 'Carregando…', 'automatic-production-connection');
  header.append(title, connection);
  const feedback = node('p', '', 'automatic-production-feedback'); feedback.setAttribute('role', 'status');
  const activeTitle = node('h3', 'Sendo produzido agora', 'automatic-production-section-title');
  const activeGrid = node('div', '', 'automatic-production-grid');
  const otherSection = node('section', '', 'automatic-production-other');
  const otherTitle = node('h3', 'Outras impressoras', 'automatic-production-section-title');
  const otherGrid = node('div', '', 'automatic-production-grid'); otherSection.append(otherTitle, otherGrid);
  section.append(header, feedback, activeTitle, activeGrid, otherSection); container.replaceChildren(section);

  let disposed = false, refreshing = false, timer;
  const resume = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('focus', resume);
  cleanup = () => {
    disposed = true; clearTimeout(timer);
    document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('focus', resume);
  };

  async function refresh() {
    if (disposed || refreshing) return;
    refreshing = true; clearTimeout(timer);
    try {
      const data = await api('/api/bambu/status', { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (disposed) return;
      connection.textContent = data.connected ? 'Ao vivo' : data.authenticated ? 'Reconectando' : 'Bambu não conectada';
      connection.classList.toggle('is-live', Boolean(data.connected));
      feedback.textContent = data.storageError || data.message || (data.connected ? `Última consulta às ${new Date().toLocaleTimeString('pt-BR')}` : 'Conecte sua conta na aba Máquinas para acompanhar a produção.');
      activeGrid.replaceChildren(); otherGrid.replaceChildren();
      const devices = [...(data.devices || [])].sort((a, b) => Number(activeStates.has(b.state) && !b.stale) - Number(activeStates.has(a.state) && !a.stale));
      for (const device of devices) {
        const target = !device.stale && activeStates.has(device.state) ? activeGrid : otherGrid;
        target.append(machineCard(device, products));
      }
      if (!activeGrid.childElementCount) activeGrid.append(node('div', 'Nenhuma impressora está produzindo agora.', 'automatic-production-empty-state'));
      otherSection.hidden = !otherGrid.childElementCount;
      if (!devices.length) feedback.textContent = data.authenticated ? 'Nenhuma impressora foi encontrada na conta Bambu.' : 'Conecte sua conta na aba Máquinas para acompanhar a produção.';
    } catch (error) {
      if (!disposed) { connection.textContent = 'Sem conexão'; connection.classList.remove('is-live'); feedback.textContent = error.message; }
    } finally {
      refreshing = false;
      if (!disposed) timer = setTimeout(refresh, 5000);
    }
  }
  refresh();
}
