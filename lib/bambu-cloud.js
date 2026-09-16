// Community protocol references: docs.page/greghesp/ha-bambulab/setup
// and github.com/greghesp/ha-bambulab (pybambu). No printer control commands.
const BASE = 'https://api.bambulab.com';
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const finite = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const inventoryRecords = list => [...new Map(list.filter(d => typeof d?.dev_id === 'string' && /^[a-zA-Z0-9_-]+$/.test(d.dev_id) && !['__proto__','constructor','prototype'].includes(d.dev_id)).map(d => [d.dev_id, { dev_id: d.dev_id, name: String(d.name || 'Impressora Bambu').slice(0,160), dev_product_name: String(d.dev_product_name || d.dev_model_name || '').slice(0,80) }])).values()];
const runtimeDevice = d => ({ id: d.dev_id, name: d.name, model: d.dev_product_name, state: 'UNKNOWN', progress: null, remainingMinutes: null, updatedAt: null });

export function mergeReport(previous, payload, now = Date.now()) {
  const report = payload?.print;
  if (!report || typeof report !== 'object' || Array.isArray(report)) return previous;
  const next = { ...previous };
  const job = report.subtask_id;
  if (typeof job === 'string' && job !== next.jobId) {
    next.progress = null; next.remainingMinutes = null; next.jobId = job;
    next.printAlerts = []; next.hmsAlerts = []; next.alerts = [];
  }
  let received = false;
  if ('print_error' in report || 'mc_print_error_code' in report || Array.isArray(report.hms)) {
    const alerts = [];
    for (const field of ['print_error', 'mc_print_error_code']) {
      if (/^\d+$/.test(String(report[field])) && Number(report[field]) > 0) alerts.push(`Erro Bambu ${Number(report[field]).toString(16).toUpperCase().padStart(8, '0')}`);
    }
    if ('print_error' in report || 'mc_print_error_code' in report) next.printAlerts = alerts;
    if (Array.isArray(report.hms)) {
      next.hmsAlerts = [];
      for (const entry of report.hms.slice(0, 40)) {
        if (Number.isSafeInteger(entry?.attr) && Number.isSafeInteger(entry?.code) && entry.attr >= 0 && entry.code >= 0) next.hmsAlerts.push(`HMS ${entry.attr.toString(16).toUpperCase().padStart(8, '0')}-${entry.code.toString(16).toUpperCase().padStart(8, '0')}`);
      }
    }
    next.alerts = [...new Set([...(next.printAlerts || []), ...(next.hmsAlerts || [])])]; received = true;
  }
  if (typeof report.gcode_state === 'string') { next.state = report.gcode_state.slice(0, 40); received = true; }
  if (finite(report.mc_percent, 100)) { next.progress = report.mc_percent; received = true; }
  if (finite(report.mc_remaining_time, 1_000_000)) { next.remainingMinutes = report.mc_remaining_time; received = true; }
  if (typeof report.subtask_name === 'string') next.jobName = report.subtask_name.slice(0, 200);
  if (received) next.updatedAt = now;
  return next;
}

export function createBambuCloud({ request = fetch, connectMqtt, loadMqtt = () => import('mqtt'), now = Date.now, schedule = setInterval, cancelSchedule = clearInterval, sessionStore, usage, onInventory, onReport } = {}) {
  let automationWork = Promise.resolve(), automationError = '';
  const seen = new Set();
  const automate = task => { automationWork = automationWork.then(task).then(() => { automationError = ''; }).catch(() => { automationError = 'Não foi possível sincronizar máquinas e produções. Uma nova tentativa será feita ao receber dados.'; }); };
  let refreshTimer, discoveryTimer, discoveryWork = Promise.resolve(), discoveryMessage = '', inventoryUpdatedAt = null;
  let client, devices = [], account = '', pendingUntil = 0, lastCode = -Infinity;
  let connected = false, authenticated = false, message = '', attempts = 0, busy = false;
  let generation = 0;
  async function cloud(path, body, token, allowEmpty = false) {
    let response;
    try {
      response = await request(BASE + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { accept: 'application/json', 'content-type': 'application/json',
          'user-agent': 'FlamezSystem/1.0', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch { throw failure('Não foi possível acessar a Bambu Cloud. Confira sua internet e tente novamente.', 502); }
    if (response.status === 403) throw failure('A Bambu bloqueou o acesso desta integração. A conexão ainda não pode ser validada.', 403);
    if (response.status === 429) throw failure('A Bambu limitou as tentativas. Aguarde alguns minutos.', 429);
    if (!response.ok) throw failure('A Bambu não aceitou a solicitação. Confira o e-mail e o código; ele pode ter expirado.');
    const stage = allowEmpty ? 'solicitar o código' : path.endsWith('/login') ? 'validar o código' : 'carregar sua conta';
    const raw = await response.text();
    // Sending a verification code may succeed with an empty HTTP 200/204.
    // Login and device endpoints must still return a JSON object.
    if (!raw.trim() && allowEmpty) return {};
    if (!raw.trim()) throw failure(`A Bambu retornou uma resposta vazia ao ${stage} (HTTP ${response.status}). Tente novamente.`, 502);
    if (/^\s*</.test(raw)) throw failure(`A Bambu retornou uma página web em vez dos dados ao ${stage} (HTTP ${response.status}). A integração não conseguiu concluir essa etapa.`, 502);
    let data;
    try { data = JSON.parse(raw); } catch { throw failure(`A Bambu retornou um formato inválido ao ${stage} (HTTP ${response.status}).`, 502); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure(`A Bambu retornou dados inválidos ao ${stage}.`, 502);
    if (data?.code != null && data.code !== 0) throw failure('A Bambu não aceitou a solicitação. Confira seus dados e tente novamente.');
    return data;
  }
  async function exclusive(task) {
    if (busy) throw failure('Já existe uma conexão em andamento. Aguarde.', 409);
    busy = true; try { return await task(); } finally { busy = false; }
  }
  function stop() {
    cancelSchedule(refreshTimer); refreshTimer = undefined;
    cancelSchedule(discoveryTimer); discoveryTimer = undefined;
    usage?.breakConnection();
    seen.clear();
    generation++; const old = client; client = undefined;
    connected = false; authenticated = false; devices = []; message = ''; discoveryMessage = '';
    old?.end(true);
  }
  return {
    async init() {
      return exclusive(async () => {
        try {
          const saved = await sessionStore?.load();
          if (!saved) return;
          if (typeof saved.token !== 'string' || !/^u_[a-zA-Z0-9_-]+$/.test(saved.username) || !Array.isArray(saved.devices)) throw new Error('Invalid session');
          let expiration;
          try { expiration = JSON.parse(Buffer.from(saved.token.split('.')[1], 'base64url').toString()).exp; } catch { /* opaque token */ }
          if (typeof expiration === 'number' && expiration * 1000 <= now()) {
            await sessionStore.clear(); message = 'Sua sessão Bambu expirou. Conecte novamente com um código.'; return;
          }
          await startSession(saved.token, saved.username, { devices: saved.devices }, true);
        } catch { message = 'Não foi possível restaurar a sessão Bambu salva. Conecte novamente.'; }
      });
    },
    status() {
      return { authenticated, connected, message, discoveryMessage, inventoryUpdatedAt, storageError: usage?.error || automationError, devices: devices.map(device => ({ ...device,
        usage: usage?.summary(device.id),
        stale: !connected || !device.updatedAt || now() - device.updatedAt > 120_000
      })) };
    },
    requestCode(email) { return exclusive(async () => {
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('Informe o e-mail da sua conta Bambu.');
      if (now() - lastCode < 60_000) throw failure('Aguarde um minuto antes de solicitar outro código.', 429);
      lastCode = now();
      await cloud('/v1/user-service/user/sendemail/code', { email: email.trim(), type: 'codeLogin' }, undefined, true);
      account = email.trim(); pendingUntil = now() + 10 * 60_000; attempts = 0;
      return { ok: true };
    }); },
    verify(code) { return exclusive(async () => {
      if (!account || now() > pendingUntil) throw failure('Solicite um novo código para conectar.');
      if (++attempts > 5) throw failure('Limite de tentativas atingido. Solicite outro código.', 429);
      if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw failure('Digite o código recebido no e-mail.');
      const login = await cloud('/v1/user-service/user/login', { account, code });
      const token = login?.accessToken;
      if (typeof token !== 'string' || !token) throw failure('A Bambu exige uma autenticação adicional não disponível nesta conexão.');
      let username;
      try { username = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).username; } catch { /* opaque tokens use preference */ }
      if (!username) {
        const preference = await cloud('/v1/design-user-service/my/preference', undefined, token);
        if (preference.uid) username = `u_${preference.uid}`;
      }
      if (typeof username !== 'string' || !/^u_[a-zA-Z0-9_-]+$/.test(username)) throw failure('Não foi possível identificar sua conta Bambu.');
      const data = await cloud('/v1/iot-service/api/user/bind', undefined, token);
      if (!Array.isArray(data.devices)) throw failure('A Bambu não retornou a lista de impressoras.');
      await sessionStore?.save({ token, username, devices: inventoryRecords(data.devices) });
      return startSession(token, username, data);
    }); },
    async disconnect() { return exclusive(async () => { await sessionStore?.clear(); stop(); account = ''; pendingUntil = 0; }); },
    close() { stop(); },
    async flush() { await discoveryWork; await automationWork; await usage?.flush(); }
  };
  async function startSession(token, username, data, restored = false) {
      let connect = connectMqtt;
      if (!connect) {
        try { connect = (await loadMqtt()).connect; }
        catch { throw failure('O componente de conexão Bambu (mqtt) não está disponível no servidor. Execute npm ci na pasta do projeto e reinicie o sistema.', 503); }
      }
      stop(); const current = generation;
      devices = inventoryRecords(data.devices).map(runtimeDevice);
      usage?.register(devices);
      if (onInventory) { const inventory = devices.map(d => ({ ...d })); automate(() => onInventory(inventory)); }
      inventoryUpdatedAt = restored ? null : now();
      authenticated = true; account = ''; pendingUntil = 0;
      message = 'Conectando à telemetria da Bambu…';
      client = connect('mqtts://us.mqtt.bambulab.com:8883', { username, password: token,
        protocolVersion: 4, clean: true, resubscribe: false, keepalive: 60, reconnectPeriod: 60_000,
        connectTimeout: 15_000, rejectUnauthorized: true });
      const active = client;
      const subscribed = new Set();
      const discover = () => {
        if (current !== generation || busy) return Promise.resolve();
        discoveryWork = exclusive(async () => {
          try {
            const latest = await cloud('/v1/iot-service/api/user/bind', undefined, token);
            if (current !== generation) return;
            if (!Array.isArray(latest.devices)) throw new Error('Invalid inventory');
            const records = inventoryRecords(latest.devices);
            await sessionStore?.save({ token, username, devices: records });
            if (current !== generation) return;
            const previous = new Map(devices.map(device => [device.id, device]));
            const removed = devices.filter(device => !records.some(record => record.dev_id === device.id)).map(device => device.id);
            removed.forEach(id => subscribed.delete(`device/${id}/report`));
            devices = records.map(record => ({ ...(previous.get(record.dev_id) || runtimeDevice(record)), name: record.name, model: record.dev_product_name }));
            usage?.register(devices); usage?.breakConnection(removed);
            if (onInventory) { const inventory = devices.map(d => ({ ...d })); automate(() => onInventory(inventory)); }
            if (removed.length && active.connected) active.unsubscribe(removed.map(id => `device/${id}/report`));
            inventoryUpdatedAt = now(); discoveryMessage = '';
            if (active.connected) subscribeDevices();
          } catch {
            if (current === generation) discoveryMessage = 'A busca por novas impressoras falhou. Tentaremos novamente automaticamente.';
          }
        });
        return discoveryWork;
      };
      discoveryTimer = schedule(discover, 60_000); discoveryTimer?.unref?.();
      const requestStatus = () => {
        if (current !== generation || !connected || !active.connected) return;
        for (const device of devices) {
          // Request telemetry only; never start, pause or modify a print.
          active.publish(`device/${device.id}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }), { qos: 0, retain: false }, error => {
            if (current === generation && error) message = 'Não foi possível solicitar novos dados. Tentaremos novamente automaticamente.';
          });
        }
      };
      const subscribeDevices = () => {
        if (current !== generation) return;
        if (!devices.length) { connected = true; message = 'Nenhuma impressora vinculada. A detecção de novas impressoras está ativa.'; return; }
        const topics = devices.map(d => `device/${d.id}/report`).filter(topic => !subscribed.has(topic));
        // MQTT.js skips already-subscribed topics and returns an empty grants array.
        // Keep the existing subscription healthy when discovery returns the same printers.
        if (!topics.length) return;
        active.subscribe(topics, { qos: 0 }, (error, granted) => {
          if (current !== generation) return;
          if (!error && Array.isArray(granted)) granted.forEach((grant, index) => { if (grant.qos < 128) subscribed.add(grant.topic || topics[index]); });
          connected = active.connected && devices.every(d => subscribed.has(`device/${d.id}/report`));
          message = connected ? '' : 'A Bambu não autorizou a leitura das impressoras.';
          cancelSchedule(refreshTimer); refreshTimer = undefined;
          if (connected) {
            requestStatus();
            refreshTimer = schedule(requestStatus, 60_000); refreshTimer?.unref?.();
          }
        });
      };
      active.on('connect', () => { subscribed.clear(); subscribeDevices(); if (restored) { restored = false; queueMicrotask(discover); } });
      active.on('message', (topic, bytes) => {
        if (current !== generation || bytes.length > 512_000) return;
        const index = devices.findIndex(d => topic === `device/${d.id}/report`);
        if (index < 0) return;
        try {
          const before = devices[index]; const next = mergeReport(before, JSON.parse(bytes.toString()), now());
          devices[index] = next;
          if (next.updatedAt && next.updatedAt !== before.updatedAt) usage?.observe(next, next.updatedAt);
          if (onReport && next.updatedAt && next.updatedAt !== before.updatedAt) {
            const continuous = seen.has(next.id); seen.add(next.id);
            automate(() => onReport(next, continuous));
          }
        } catch { /* ignore malformed report */ }
      });
      active.on('close', () => { if (current === generation) { seen.clear(); usage?.breakConnection(); connected = false; message = 'Conexão interrompida. Tentando novamente em até um minuto.'; } });
      active.on('error', error => {
        if (current !== generation) return;
        if ([4, 5, 134, 135].includes(error.code)) {
          stop(); message = 'A Bambu recusou a sessão salva. Conecte novamente com um código.';
          return;
        }
        connected = false; message = 'Não foi possível conectar à telemetria. A conexão será tentada novamente automaticamente.';
      });
      return { ok: true };
  }
}
