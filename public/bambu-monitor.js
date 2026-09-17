import { openDailyUsage } from './bambu-usage.js';
let cleanup = () => {};
export function stopBambuMonitor() { cleanup(); cleanup = () => {}; }
function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
const states = { RUNNING: 'Imprimindo', PAUSE: 'Pausada', FINISH: 'Finalizada', FAILED: 'Falhou', IDLE: 'Disponível', PREPARE: 'Preparando', SLICING: 'Fatiando', OFFLINE: 'Offline', UNKNOWN: 'Aguardando dados' };
const stages = {0:'Imprimindo',1:'Nivelamento automático',2:'Aquecendo a mesa',3:'Compensação de vibração',4:'Trocando filamento',6:'Pausada: filamento acabou',7:'Aquecendo o bico',8:'Calibrando fluxo',9:'Verificando a mesa',10:'Inspecionando primeira camada',13:'Posicionando cabeçote',14:'Limpando o bico',16:'Pausada pelo usuário',20:'Problema na temperatura do bico',21:'Problema na temperatura da mesa',22:'Descarregando filamento',23:'Perda de passos',24:'Carregando filamento',26:'AMS desconectado',32:'Acúmulo no bico',33:'Problema no cortador',34:'Problema na primeira camada',35:'Possível entupimento do bico',54:'Aguardando temperatura da mesa'};
const speedProfiles = {1:'Silencioso',2:'Padrão',3:'Sport',4:'Ludicrous'};
const temperature = value => Number.isFinite(value) ? `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)} °C` : '—';
function detail(label, value) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  const item = element('div', '', 'bambu-extra-item'); item.append(element('span', label), element('strong', String(value))); return item;
}
function renderExtra(device) {
  const telemetry = device.telemetry || {}, temperatures = telemetry.temperatures || {};
  const panel = element('div', '', 'bambu-extra-details');
  const grid = element('div', '', 'bambu-extra-grid');
  const layer = Number.isFinite(telemetry.currentLayer) ? `${telemetry.currentLayer}${Number.isFinite(telemetry.totalLayers) ? ` de ${telemetry.totalLayers}` : ''}` : null;
  const values = [
    detail('Bico programado', temperature(temperatures.nozzleTarget)), detail('Mesa programada', temperature(temperatures.bedTarget)),
    detail('Câmara', temperature(temperatures.chamber)), detail('Câmara programada', temperature(temperatures.chamberTarget)),
    detail('Camada atual', layer), detail('Etapa', Number.isFinite(telemetry.stage) ? stages[telemetry.stage] || `Etapa ${telemetry.stage}` : null),
    detail('Velocidade', Number.isFinite(telemetry.speedLevel) ? speedProfiles[telemetry.speedLevel] || `Perfil ${telemetry.speedLevel}` : null),
    detail('Sinal Wi‑Fi', Number.isFinite(telemetry.wifiSignal) ? `${telemetry.wifiSignal} dBm` : null),
    detail('Diâmetro do bico', Number.isFinite(telemetry.nozzleDiameter) ? `${telemetry.nozzleDiameter} mm` : null),
    detail('Compartimento ativo', telemetry.activeTray)
  ].filter(Boolean);
  values.forEach(value => grid.append(value));
  if (grid.childElementCount) panel.append(grid);
  for (const unit of telemetry.ams || []) {
    const ams = element('section', '', 'bambu-ams-details');
    const heading = element('strong', `AMS${unit.id ? ` ${unit.id}` : ''}`);
    const summary = [Number.isFinite(unit.temperature) ? temperature(unit.temperature) : '', Number.isFinite(unit.humidity) ? `Umidade: índice ${unit.humidity}` : ''].filter(Boolean).join(' · ');
    ams.append(heading); if (summary) ams.append(element('small', summary));
    for (const tray of unit.trays || []) {
      const value = [`Compartimento ${tray.id || '?'}`, tray.type, tray.color ? `#${tray.color.slice(0,6)}` : '', Number.isFinite(tray.remaining) ? `${tray.remaining}% restante` : ''].filter(Boolean).join(' · ');
      ams.append(element('p', value));
    }
    panel.append(ams);
  }
  if (device.alerts?.length) panel.append(element('p', `Alertas: ${device.alerts.join(' · ')}`, 'bambu-extra-alert'));
  if (!panel.childElementCount) panel.append(element('p', 'A impressora ainda não enviou informações adicionais.', 'bambu-note'));
  return panel;
}

function openPrinterDetails(device, restoreFocus) {
  const dialog = element('dialog', '', 'bambu-details-dialog');
  const header = element('header', '', 'bambu-details-header');
  const identity = element('div');
  const title = element('h2', device.name); title.id = 'bambu-details-title';
  const subtitle = element('p', 'Informações da impressora', 'bambu-note');
  identity.append(title, subtitle);
  const close = element('button', '×', 'bambu-details-close'); close.type = 'button';
  close.setAttribute('aria-label', 'Fechar informações da impressora'); close.autofocus = true;
  close.onclick = () => dialog.close();
  header.append(identity, close);
  const content = element('div', '', 'bambu-details-content');
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.append(header, content);
  const update = next => {
    if (!next) {
      content.replaceChildren(element('p', 'A impressora não está disponível nesta conexão.', 'bambu-note'));
      return;
    }
    title.textContent = next.name;
    subtitle.textContent = `${next.model || 'Impressora'} · ${next.stale ? 'Sem atualização recente' : states[next.state] || 'Aguardando dados'}`;
    content.replaceChildren(renderExtra(next));
  };
  update(device);
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => { dialog.remove(); restoreFocus(); });
  document.body.append(dialog); dialog.showModal();
  return { id: device.id, update, close: () => dialog.close(), get open() { return dialog.open; } };
}

export function renderBambuMonitor(container, api) {
  stopBambuMonitor();
  const section = element('section', '', 'bambu-monitor');
  const header = element('div', '', 'bambu-header');
  const title = element('div'); title.append(element('h2', 'Bambu Cloud'), element('p', 'Acompanhe suas impressoras pela internet.'));
  const connect = element('button', 'Conectar Bambu', 'primary-button'); connect.type = 'button';
  const disconnect = element('button', 'Desconectar', 'ghost-light-button'); disconnect.type = 'button'; disconnect.hidden = true;
  const actions = element('div', '', 'row-actions'); actions.append(connect, disconnect); header.append(title, actions);
  const info = element('p', 'Carregando conexão…', 'bambu-note'); info.setAttribute('role', 'status');
  const discovery = element('p', '', 'bambu-note');
  const grid = element('div', '', 'bambu-grid'); section.append(header, info, discovery, grid); container.append(section);
  let disposed = false, timer, refreshing = false, dailyDialog, detailsDialog;
  const resume = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  cleanup = () => {
    disposed = true; clearTimeout(timer);
    dailyDialog?.close();
    detailsDialog?.close();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('focus', resume);
  };
  async function refresh() {
    if (disposed || refreshing) return;
    refreshing = true;
    clearTimeout(timer);
    try {
      const data = await api('/api/bambu/status', { cache: 'no-store', signal: AbortSignal.timeout(12_000) }); if (disposed) return;
      connect.hidden = data.authenticated; disconnect.hidden = !data.authenticated;
      info.textContent = data.storageError || data.message || (data.authenticated ? `Atualização automática ativa · Consulta às ${new Date().toLocaleTimeString('pt-BR')}` : 'Conecte sua conta Bambu para consultar progresso e tempo restante.');
      discovery.textContent = data.authenticated ? data.discoveryMessage || 'Novas impressoras são detectadas e salvas automaticamente a cada minuto.' : '';
      if (dailyDialog?.open) dailyDialog.update(data.devices.find(device => device.id === dailyDialog.id));
      if (detailsDialog?.open) detailsDialog.update(data.devices.find(device => device.id === detailsDialog.id));
      grid.replaceChildren();
      for (const device of data.devices) {
        const card = element('article', '', 'bambu-printer');
        const fresh = !device.stale && device.state !== 'OFFLINE';
        const heading = element('div', '', 'bambu-printer-heading');
        heading.append(element('h3', device.name));
        const cardActions = element('div', '', 'bambu-printer-actions');
        if (!fresh) {
          card.classList.add('bambu-printer-no-signal');
          const badge = element('span', '', 'bambu-signal-badge');
          badge.title = !data.connected ? 'A conexão com a Bambu Cloud está indisponível.' : 'A impressora está offline ou ainda não enviou dados recentes.';
          const icon = element('span', '', 'bambu-signal-icon'); icon.setAttribute('aria-hidden', 'true');
          icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m6.5 7.5 3 3m0-3-3 3m8-3 3 3m0-3-3 3M7 15h10m-5 0v2.5a2 2 0 0 0 4 0V15m-2 0v2"/></svg>';
          badge.append(icon, element('span', 'Sem sinal')); cardActions.append(badge);
        }
        const reportButton = element('button', 'i', 'bambu-usage-button'); reportButton.type = 'button';
        reportButton.title = 'Horas de impressão de hoje e ontem'; reportButton.setAttribute('aria-label', `Ver horas de hoje e ontem de ${device.name}`);
        reportButton.onclick = () => { dailyDialog?.close(); dailyDialog = openDailyUsage(device); };
        const moreButton = element('button', '+', 'bambu-more-button'); moreButton.type = 'button';
        moreButton.title = 'Ver mais informações da impressora'; moreButton.setAttribute('aria-haspopup', 'dialog');
        moreButton.setAttribute('aria-label', `Ver mais informações de ${device.name}`);
        moreButton.dataset.deviceId = device.id;
        moreButton.onclick = () => {
          detailsDialog?.close();
          detailsDialog = openPrinterDetails(device, () => {
            if (!disposed) [...grid.querySelectorAll('.bambu-more-button')].find(button => button.dataset.deviceId === device.id)?.focus();
          });
        };
        cardActions.append(moreButton, reportButton); heading.append(cardActions);
        card.append(heading, element('small', `${device.model} · ${device.id.slice(-6)}`));
        card.append(element('p', fresh ? (states[device.state] || 'Estado não identificado') : (!data.connected ? 'Conexão com a Bambu indisponível' : device.state === 'OFFLINE' ? 'Impressora offline' : device.updatedAt ? 'Sem atualização recente' : 'Aguardando primeira atualização'), 'bambu-printer-state'));
        const metrics = element('div', '', 'bambu-metrics');
        const percent = fresh && device.progress != null ? `${device.progress}%` : '—';
        let remaining = '—';
        if (fresh && device.remainingMinutes != null) {
          const minutes = Math.round(device.remainingMinutes); remaining = `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
        }
        const progressValue = element('div'); progressValue.append(element('small', 'Progresso'), element('strong', percent));
        const timeValue = element('div'); timeValue.append(element('small', 'Tempo restante'), element('strong', remaining)); metrics.append(progressValue, timeValue);
        const progress = element('progress'); progress.max = 100; progress.value = fresh ? device.progress || 0 : 0; progress.setAttribute('aria-label', `Progresso de ${device.name}`);
        card.append(metrics, progress);
        if (device.jobName) card.append(element('p', device.jobName, 'bambu-job'));
        const temperatures = device.telemetry?.temperatures || {};
        const temperatureSummary = element('div', '', 'bambu-temperature-summary');
        const nozzle = element('div'); nozzle.append(element('small', 'Bico'), element('strong', temperature(temperatures.nozzle)));
        const bed = element('div'); bed.append(element('small', 'Mesa'), element('strong', temperature(temperatures.bed)));
        temperatureSummary.append(nozzle, bed); card.append(temperatureSummary);
        card.append(element('small', device.updatedAt ? `Último dado: ${new Date(device.updatedAt).toLocaleString('pt-BR')}` : 'Os dados aparecerão quando a impressora enviar uma atualização.'));
        grid.append(card);
      }
    } catch (error) { if (!disposed) { info.textContent = error.message; grid.replaceChildren(); } }
    finally { refreshing = false; if (!disposed) timer = setTimeout(refresh, 5000); }
  }
  connect.onclick = () => {
    const dialog = element('dialog', '', 'bambu-dialog');
    const form = element('form');
    const heading = element('h2', 'Conectar à Bambu Cloud');
    const description = element('p', 'Use o e-mail da conta que você usa no Bambu Handy. Ao solicitar, ele será enviado à Bambu para receber um código de acesso.');
    const emailLabel = element('label', 'E-mail Bambu'); const email = element('input'); email.type = 'email'; email.autocomplete = 'email'; email.required = true; emailLabel.append(email);
    const codeLabel = element('label', 'Código recebido no e-mail'); const code = element('input'); code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 8; codeLabel.append(code); codeLabel.hidden = true;
    const note = element('p', 'Sua conexão será salva com criptografia no servidor e restaurada automaticamente. Um novo código só será necessário se o acesso expirar ou for revogado pela Bambu.', 'bambu-note');
    const feedback = element('p', '', 'bambu-feedback'); feedback.setAttribute('role', 'alert');
    const footer = element('div', '', 'row-actions');
    const close = element('button', 'Fechar', 'ghost-light-button'); close.type = 'button'; close.onclick = () => dialog.close();
    const resend = element('button', 'Usar outro e-mail', 'ghost-light-button'); resend.type = 'button'; resend.hidden = true;
    const submit = element('button', 'Enviar código', 'primary-button'); submit.type = 'submit';
    let sent = false, busy = false;
    resend.onclick = () => { sent = false; email.readOnly = false; codeLabel.hidden = true; code.required = false; code.value = ''; resend.hidden = true; submit.textContent = 'Enviar código'; feedback.textContent = ''; email.focus(); };
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return; busy = true; submit.disabled = true; resend.disabled = true; close.disabled = true; feedback.textContent = '';
      try {
        if (!sent) {
          await api('/api/bambu/code', { method: 'POST', body: JSON.stringify({ email: email.value.trim() }) });
          sent = true; email.readOnly = true; codeLabel.hidden = false; code.required = true; resend.hidden = false; submit.textContent = 'Conectar'; feedback.textContent = 'Código solicitado. Confira seu e-mail e a pasta de spam.'; code.focus();
        } else {
          await api('/api/bambu/connect', { method: 'POST', body: JSON.stringify({ code: code.value.trim() }) });
          dialog.close(); await refresh();
        }
      } catch (error) { feedback.textContent = error.message; }
      finally { busy = false; submit.disabled = false; resend.disabled = false; close.disabled = false; }
    };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove());
    footer.append(close, resend, submit); form.append(heading, description, emailLabel, codeLabel, note, feedback, footer); dialog.append(form); document.body.append(dialog); dialog.showModal();
  };
  disconnect.onclick = async () => {
    disconnect.disabled = true;
    try { await api('/api/bambu/disconnect', { method: 'POST', body: '{}' }); await refresh(); }
    catch (error) { info.textContent = error.message; }
    finally { disconnect.disabled = false; }
  };
  refresh();
}
