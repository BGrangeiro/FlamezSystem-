import { normalizeProductStock } from './public/product-stock-data.js';
import { createBambuCloud } from './lib/bambu-cloud.js';
import { createBambuSessionStore } from './lib/bambu-session.js';
import { createBambuUsage } from './lib/bambu-usage.js';
import { createBackupScheduler, snapshotBackup } from './lib/backup.js';
import { registerCloudMachines, bindProduction, recordCloudReport, completeCloudProductions } from './lib/bambu-automation.js';
import { loadConfig } from './lib/config.js';
import { readJson, writeJson } from './lib/storage.js';
import { createAuth, sameSecret } from './lib/auth.js';
import { acquireLock } from './lib/lock.js';
import { loadEnvFile } from 'node:process';
import { reconcileFilamentStock, validateStockItems } from './public/filament-stock.js';
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MACHINE_HEADERS, normalizeMachineData, machineNumber, updateMachineHours } from "./public/machine-costs.js";
import { applyProductionOutcome } from "./public/production-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
if (existsSync(path.join(__dirname, '.env'))) loadEnvFile(path.join(__dirname, '.env'));
const config=loadConfig();
const auth=createAuth(config);
const bambuUsage = createBambuUsage(config.dataDir);
const bambuCloud = createBambuCloud({ sessionStore: createBambuSessionStore(config.dataDir), usage: bambuUsage,
  onInventory: devices => mutate(async () => {
    const data = await readLocalSheets();
    if (registerCloudMachines(data.sheets, devices)) await writeLocalSheets(data);
  }),
  onReport: (device, continuous) => mutate(async () => {
    let data = await readLocalSheets();
    registerCloudMachines(data.sheets, [device]);
    recordCloudReport(data.sheets, device, continuous);
    // Persist physical machine use even if stock validation blocks a production update.
    await writeLocalSheets(data);
    for (const candidate of data.sheets.producao.rows) {
      const next = structuredClone(data);
      const completed = completeCloudProductions(next.sheets, candidate.rowNumber);
      if (!completed.length) continue;
      try { await writeLocalSheets(next); data = next; }
      catch (error) {
        for (const row of data.sheets.producao.rows) if (completed.includes(row.rowNumber)) row.data._bambuSyncError = `A Bambu informou o término da impressão, mas a produção precisa de revisão: ${error.message}`;
        await writeLocalSheets(data);
      }
    }
  })
});
const localSheetsPath = path.join(config.dataDir, 'sheets.local.json');
const productCostsPath = path.join(config.dataDir, 'product-costs.local.json');
const port = config.port;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const DEFAULT_LOCAL_SHEETS = {
  filamentLog: {sheet:'filamentLog',sheetName:'Log de filamentos',headers:['Data','Dia da produção','Produção','Filamento','Movimento','Quantidade (g)','Saldo (kg)','Status'],rows:[]},
  productStock: {sheet:'productStock',sheetName:'Estoque de produtos',headers:['SKU','Quantidade','Cores','Foto'],rows:[]},
  filamentSettings: {
    sheet: "filamentSettings",
    sheetName: "Configurações de filamento",
    headers: ["Marca", "Modelo", "Linha do material", "Cor", "Melhor taxa de fluxo", "Melhor temperatura", "Foto", "Tipo"],
    rows: []
  },
  produtos: {
    sheet: "produtos",
    sheetName: "Produtos",
    headers: [
      "Produto",
      "SKU",
      "Custo",
      "Valor de venda",
      "Valor que recebe",
      "Lucro recebido",
      "Orçamento PDF",
      "Foto",
      "Link Shopee",
      "STL/3MF",
      "Status",
      "Categoria",
      "Peso estimado (g)",
      "Tempo estimado",
      "Observações",
      "Imagem",
      "Anúncio ativo",
      "Lucro unitário"
    ],
    rows: []
  },
  filamentos: {
    sheet: "filamentos",
    sheetName: "Filamentos",
    headers: [
      "Tipo de filamento",
      "Cor",
      "Tipo do material",
      "Marca",
      "Custo médio por kg",
      "Estoque atual (kg)",
      "Urgência de compra"
    ],
    rows: []
  },
  producao: {
    sheet: "producao",
    sheetName: "Produção",
    headers: [
      "Dia produção",
      "Código do produto",
      "Impressora usada",
      "Quantidade produzida",
      "Hora de início",
      "Hora de finalização",
      "Resultado da impressão",
      "Peso (g)",
      "Horas (h)",
      "Desperdício (g)",
      "Filamento usado",
      "Observações"
    ],
    rows: []
  },
  reposicao: {
    sheet: "reposicao",
    sheetName: "Peças de Reposição",
    headers: ["Imagem", "Nome da peça", "Preço", "Estoque"],
    rows: []
  },
  maquinas: {
    sheet: "maquinas",
    sheetName: "Máquinas",
    headers: MACHINE_HEADERS,
    rows: []
  },
  encomendas: {
    sheet: "encomendas",
    sheetName: "Encomendas",
    headers: [
      "Nome da encomenda",
      "Cliente",
      "Produto/Itens",
      "Data do pedido",
      "Data de entrega",
      "Quantidade da entrega",
      "Status do processo",
      "Cancelado",
      "Valor da encomenda",
      "Quantidade de itens",
      "Canal de venda",
      "Contato",
      "Observações"
    ],
    rows: []
  }
};

function migrateLocalSheet(key, sheet) {
  if(key === 'productStock') return {...sheet,headers:DEFAULT_LOCAL_SHEETS.productStock.headers};
  if(key === 'filamentSettings') return {...sheet,headers:DEFAULT_LOCAL_SHEETS.filamentSettings.headers};
  if (key === "maquinas") {
    return { ...sheet, headers: MACHINE_HEADERS, rows: sheet.rows.map((row) => ({
      ...row, data: normalizeMachineData(row.data || {})
    })) };
  }
  if (key !== "encomendas") return sheet;

  const headers = sheet.headers.map((header) => header === "Encomenda" ? "Nome da encomenda" : header);
  const expectedHeaders = DEFAULT_LOCAL_SHEETS.encomendas.headers;
  expectedHeaders.forEach((header) => {
    if (!headers.includes(header)) headers.push(header);
  });

  const rows = sheet.rows.map((row) => {
    const data = { ...(row.data || {}) };
    if (!data["Nome da encomenda"] && data.Encomenda) {
      data["Nome da encomenda"] = data.Encomenda;
    }
    delete data.Encomenda;
    return { ...row, data };
  });

  return { ...sheet, headers, rows };
}

async function readLocalSheets() {
  const data=await readJson(localSheetsPath, {sheets:{}});
  if(!data.sheets || typeof data.sheets!=='object' || Array.isArray(data.sheets)) throw new Error('Estrutura de dados inválida. Restaure um backup.');
  for(const sheet of Object.values(data.sheets)) if(!sheet || !Array.isArray(sheet.rows) || sheet.rows.some(row=>!row || !row.data || typeof row.data!=='object' || Array.isArray(row.data))) throw new Error('Registros inválidos no arquivo de dados. Restaure um backup.');

  const sheets = {};
  Object.entries(DEFAULT_LOCAL_SHEETS).forEach(([key, defaults]) => {
    const saved = data?.sheets?.[key] || {};
    sheets[key] = migrateLocalSheet(key, {
      ...defaults,
      ...saved,
      sheet: key,
      sheetName: saved.sheetName || defaults.sheetName,
      headers: Array.isArray(saved.headers) && saved.headers.length ? saved.headers : defaults.headers,
      rows: Array.isArray(saved.rows) ? saved.rows : []
    });
  });

  updateMachineHours(sheets);
  return {
    version: 1,
    mode: "local",
    updatedAt: data?.updatedAt || new Date().toISOString(),
    sheets
  };
}

async function writeLocalSheets(data) {
  const previous = await readLocalSheets();
  reconcileFilamentStock(previous.sheets, data.sheets);
  updateMachineHours(data.sheets);
  const next = {
    ...data,
    mode: "local",
    updatedAt: new Date().toISOString()
  };
  await writeJson(localSheetsPath,next);
  return next;
}

function nextRowNumber(rows) {
  const max = rows.reduce((highest, row) => Math.max(highest, Number(row.rowNumber) || 1), 1);
  return max + 1;
}

async function listLocalSheet(sheetKey) {
  const data = await readLocalSheets();
  const sheet = data.sheets[sheetKey];

  if (!sheet) {
    const error = new Error(`Aba local não suportada: ${sheetKey}`);
    error.statusCode = 404;
    throw error;
  }

  return {
    ok: true,
    mode: "local",
    sheet: sheetKey,
    sheetName: sheet.sheetName,
    headers: sheet.headers,
    rows: sheet.rows
  };
}

async function upsertLocalRow(sheetKey, rowNumber, rowData) {
  const data = await readLocalSheets();
  const sheet = data.sheets[sheetKey];

  if (!sheet) {
    const error = new Error(`Aba local não suportada: ${sheetKey}`);
    error.statusCode = 404;
    throw error;
  }

  if(sheetKey === 'filamentLog') throw Object.assign(new Error('O Log é somente leitura.'),{statusCode:400});
  if(sheetKey === 'filamentos') {
    const amount=machineNumber(rowData['Estoque atual (kg)']), price=machineNumber(rowData['Custo médio por kg']);
    if(!Number.isFinite(amount)||amount<0||!Number.isFinite(price)||price<0) throw Object.assign(new Error('Informe estoque e custo por kg válidos, maiores ou iguais a zero.'),{statusCode:400});
  }
  if(sheetKey === 'reposicao') {
    const invalid = message => Object.assign(new Error(message),{statusCode:400});
    const name=String(rowData['Nome da peça']||'').trim(),price=machineNumber(rowData.Preço),stock=Number(String(rowData.Estoque??'').replace(',','.'));
    if(!name)throw invalid('Informe o nome da peça.');
    if(name.length>160||!Number.isFinite(price)||price<0)throw invalid('Informe um nome e um preço válidos.');
    if(!Number.isSafeInteger(stock)||stock<0)throw invalid('Informe uma quantidade inteira maior ou igual a zero.');
    if(rowData.Imagem&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rowData.Imagem)||rowData.Imagem.length>2000000))throw invalid('Foto inválida ou muito grande.');
    rowData={Imagem:String(rowData.Imagem||''),'Nome da peça':name,Preço:String(rowData.Preço),Estoque:String(stock)};
  }
  const targetRowNumber = Number(rowNumber || 0) || nextRowNumber(sheet.rows);
  if(sheetKey === 'productStock') {
    const sku = String(rowData.SKU || '').trim();
    rowData = normalizeProductStock(rowData,sheet.rows.find(row=>row.rowNumber===targetRowNumber)?.data);
    const quantity = Number(rowData.Quantidade);
    if(!sku || !Number.isSafeInteger(quantity) || quantity < 0) throw Object.assign(new Error('Informe um SKU e uma quantidade inteira maior ou igual a zero.'),{statusCode:400});
    if(!data.sheets.produtos.rows.some(row=>String(row.data.SKU || '').trim() === sku)) throw Object.assign(new Error('Este SKU não está cadastrado em Produtos.'),{statusCode:400});
    if(sheet.rows.some(row=>row.rowNumber !== targetRowNumber && row.data.SKU === sku)) throw Object.assign(new Error('Este SKU já possui estoque. Atualize a página para editar a quantidade existente.'),{statusCode:400});
    rowData={...rowData,SKU:sku,Quantidade:String(quantity)};
  }
  if (sheetKey === 'filamentSettings') {
    const invalid = message => Object.assign(new Error(message), {statusCode:400});
    if (!['marca','filamento'].includes(rowData.Tipo) || !String(rowData.Marca || '').trim()) throw invalid('Informe a marca.');
    if (rowData.Tipo === 'filamento' && (!String(rowData.Modelo || '').trim() || !String(rowData.Cor || '').trim())) throw invalid('Informe modelo e cor.');
    for (const key of sheet.headers.filter(key=>key !== 'Foto')) if (String(rowData[key] || '').length > 160) throw invalid('Campo muito longo.');
    if (rowData.Foto && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rowData.Foto) || rowData.Foto.length > 2000000)) throw invalid('Foto inválida ou muito grande.');
    const flow = String(rowData['Melhor taxa de fluxo'] || '').replace(',','.');
    if (flow && (!/^\d+(?:\.\d+)?$/.test(flow) || Number(flow) <= 0)) throw invalid('Taxa de fluxo inválida.');
    const temperature = rowData['Melhor temperatura'];
    if (temperature && (!Number.isFinite(Number(temperature)) || Number(temperature) < 0 || Number(temperature) > 500)) throw invalid('Temperatura inválida.');
  }
  if (sheetKey === "maquinas") {
    const existing = sheet.rows.find((row) => Number(row.rowNumber) === targetRowNumber);
    const desiredHours = rowData["Horas de uso"];
    const maintenanceDate = rowData["Última manutenção"];
    const resetMaintenance = rowData._resetMaintenance === true;
    rowData = normalizeMachineData({ ...existing?.data, ...rowData });
    if (desiredHours !== undefined) {
      const hours = machineNumber(desiredHours);
      if (!Number.isFinite(hours) || hours < 0) throw Object.assign(new Error("Informe uma quantidade de horas válida."), {statusCode: 400});
      rowData["Horas iniciais (h)"] = String(hours - Number(existing?.data["Horas registradas em produção (h)"] || 0));
      delete rowData["Horas de uso"];
    }
    if (maintenanceDate && (maintenanceDate !== existing?.data['Última manutenção'] || resetMaintenance)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(maintenanceDate) || !Number.isFinite(Date.parse(maintenanceDate))) throw Object.assign(new Error('Data de manutenção inválida.'), {statusCode:400});
      const currentHours = desiredHours === undefined ? Number(existing?.data['Horas totais (h)'] || 0) : machineNumber(desiredHours);
      let laterHours = 0;
      let cloudJobs = {}; try { cloudJobs = JSON.parse(existing?.data._bambuJobs || '{}'); } catch {}
      if (!resetMaintenance) for (const job of Object.values(cloudJobs)) {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(job.endedAt));
        if (day > maintenanceDate) laterHours += Number(job.hours) || 0;
      }
      if (!resetMaintenance) for (const production of data.sheets.producao.rows) {
        if (production.data['Status da produção'] === 'Em produção' || String(production.data['Dia produção']).slice(0,10) <= maintenanceDate) continue;
        try { for (const item of JSON.parse(production.data['Itens da produção'] || '[]')) if (Number(item.machineRow) === targetRowNumber && !cloudJobs[item.bambuJobKey]) laterHours += Number(item.hours) || 0; } catch {}
      }
      rowData._maintenanceHours = String(Math.max(0,currentHours - laterHours));
    }
    if (maintenanceDate === '') delete rowData._maintenanceHours;
    delete rowData._resetMaintenance;
    for (const header of MACHINE_HEADERS.slice(3, 7)) {
      const value = rowData[header];
      if (value === "" || value === undefined) continue;
      const number = machineNumber(value);
      if (!Number.isFinite(number) || number < 0 || (header === MACHINE_HEADERS[4] && number <= 0)) {
        const error = new Error(`Valor inválido para ${header}.`);
        error.statusCode = 400;
        throw error;
      }
    }
  }
  if (sheetKey === "producao" && rowData["Itens da produção"]) {
    let items = JSON.parse(rowData["Itens da produção"]);
    if (!Array.isArray(items)) throw Object.assign(new Error("Itens da produção inválidos."), { statusCode: 400 });
    validateStockItems(items, data.sheets.filamentos.rows);
    if (rowData["Status da produção"]) {
      try { items = applyProductionOutcome(items, rowData["Status da produção"]); }
      catch (error) { error.statusCode = 400; throw error; }
      rowData["Itens da produção"] = JSON.stringify(items);
      rowData["Desperdício (g)"] = String(items.reduce((n,item)=>n+item.waste,0));
      rowData["Custo de máquinas (R$)"] = String(items.reduce((n,item)=>n+item.machineCost,0));
    }
    for (const item of items) {
      if (item.machineRow == null || item.machineRow === "") {
        if (item.hours != null && item.hours !== "" && Number(item.hours) !== 0) throw Object.assign(new Error("Selecione a máquina para registrar horas."), { statusCode: 400 });
        continue;
      }
      if (!Number.isFinite(machineNumber(item.hours)) || machineNumber(item.hours) < 0) throw Object.assign(new Error("Horas da máquina inválidas."), { statusCode: 400 });
    }
  }
  const normalizedData = {};
  sheet.headers.forEach((header) => {
    normalizedData[header] = String(rowData?.[header] ?? "").trim();
  });

  Object.entries(rowData || {}).forEach(([key, value]) => {
    if (!(key in normalizedData)) normalizedData[key] = String(value ?? "").trim();
  });

  const existingIndex = sheet.rows.findIndex((row) => Number(row.rowNumber) === targetRowNumber);
  const nextRow = { rowNumber: targetRowNumber, data: normalizedData };
  if (sheetKey === 'maquinas') {
    const previous = sheet.rows[existingIndex]?.data || {};
    for (const key of ['_bambuId', '_bambuCurrent', '_bambuJobs']) {
      delete nextRow.data[key];
      if (previous[key] !== undefined) nextRow.data[key] = previous[key];
    }
  }
  if (sheetKey === 'producao') bindProduction(data.sheets, nextRow, sheet.rows[existingIndex]);

  if (existingIndex >= 0) {
    sheet.rows[existingIndex] = nextRow;
  } else {
    sheet.rows.push(nextRow);
    sheet.rows.sort((a, b) => Number(a.rowNumber) - Number(b.rowNumber));
  }

  await writeLocalSheets(data);

  return {
    ok: true,
    mode: "local",
    sheet: sheetKey,
    rowNumber: targetRowNumber,
    data: normalizedData
  };
}

function requireProductionPassword(password) {
  if(!sameSecret(password,config.deletionPassword)) throw Object.assign(new Error('Senha incorreta. A produção não foi removida.'),{statusCode:403});
}

async function removeProductionItem(rowNumber,itemIndex,password) {
  requireProductionPassword(password);
  const data=await readLocalSheets();
  const row=data.sheets.producao.rows.find(row=>row.rowNumber===Number(rowNumber));
  if(!row) throw Object.assign(new Error('Produção não encontrada.'),{statusCode:404});
  const items=JSON.parse(row.data['Itens da produção'] || '[]');
  if(!Number.isInteger(itemIndex)||itemIndex<0||itemIndex>=items.length) throw Object.assign(new Error('Item não encontrado. Atualize a página.'),{statusCode:400});
  items.splice(itemIndex,1);
  if(!items.length) data.sheets.producao.rows=data.sheets.producao.rows.filter(r=>r!==row);
  else {
    row.data['Itens da produção']=JSON.stringify(items);
    for(const [field,value] of [['Quantidade produzida',items.reduce((n,i)=>n+Number(i.quantity||0),0)],['Peso (g)',items.reduce((n,i)=>n+Number(i.used||0)+Number(i.waste||0),0)],['Desperdício (g)',items.reduce((n,i)=>n+Number(i.waste||0),0)],['Custo do filamento (R$)',items.reduce((n,i)=>n+Number(i.total||0),0)],['Custo de máquinas (R$)',items.reduce((n,i)=>n+Number(i.machineCost||0),0)]]) row.data[field]=String(value);
    row.data['Código do produto']=items.map(i=>i.sku||i.name).join(', ');
  }
  await writeLocalSheets(data);
  return {ok:true};
}

async function deleteLocalRow(sheetKey, rowNumber, password) {
  if(sheetKey === 'producao') requireProductionPassword(password);
  const data = await readLocalSheets();
  const sheet = data.sheets[sheetKey];

  if (!sheet) {
    const error = new Error(`Aba local não suportada: ${sheetKey}`);
    error.statusCode = 404;
    throw error;
  }

  if(sheetKey === 'filamentLog') throw Object.assign(new Error('O Log é somente leitura.'),{statusCode:400});
  if(sheetKey === 'filamentos' && data.sheets.producao.rows.some(r=>JSON.parse(r.data['Itens da produção']||'[]').some(i=>String(i.filamentStockRow)===String(rowNumber)))) throw Object.assign(new Error('Este filamento está vinculado a uma produção e não pode ser excluído.'),{statusCode:400});
  const targetRowNumber = Number(rowNumber);
  const initialLength = sheet.rows.length;
  sheet.rows = sheet.rows.filter((row) => Number(row.rowNumber) !== targetRowNumber);

  if (sheet.rows.length === initialLength) {
    const error = new Error("Linha local não encontrada.");
    error.statusCode = 404;
    throw error;
  }

  await writeLocalSheets(data);

  return {
    ok: true,
    mode: "local",
    sheet: sheetKey,
    deletedRowNumber: targetRowNumber
  };
}

async function renameProduct(rowNumber, name) {
  const nextName = String(name ?? "").trim();
  if (!nextName || nextName.length > 160) {
    const error = new Error("Informe um nome de 1 a 160 caracteres.");
    error.statusCode = 400;
    throw error;
  }
  const sheets = await readLocalSheets();
  const row = sheets.sheets.produtos.rows.find(item => Number(item.rowNumber) === Number(rowNumber));
  if (!row) {
    const error = new Error("Produto não encontrado.");
    error.statusCode = 404;
    throw error;
  }
  const sku = String(row.data.SKU || "").trim();
  const oldName = String(row.data.Produto || "").trim();
  // Keep the original storage identity when a name-based product is renamed.
  row.data._productCostKey ||= sku ? `sku:${sku}` : oldName ? `produto:${oldName.toLowerCase()}` : `linha:${row.rowNumber}`;
  row.data.Produto = nextName;
  await writeLocalSheets(sheets);
  return { ok: true, row };
}

async function readProductCosts() { return readJson(productCostsPath,{}); }

async function saveProductCost(productKey, data) {
  if (!productKey || ["__proto__","constructor","prototype"].includes(productKey)) {
    throw new Error("Produto sem chave para salvar o cálculo local.");
  }

  const costs = await readProductCosts();
  costs[productKey] = {
    ...data,
    updatedAt: new Date().toISOString()
  };
  await writeJson(productCostsPath,costs);
  return costs[productKey];
}

async function readBody(request) {
  const chunks = [];
  let size=0;

  for await (const chunk of request) {
    size+=chunk.length;
    if(size>4*1024*1024) throw Object.assign(new Error('Solicitação muito grande. Limite: 4 MB.'),{statusCode:413});
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const data=raw?JSON.parse(raw,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw new Error('Campo inválido.');return value;}):{};
    if(!data || typeof data!=='object'||Array.isArray(data))throw new Error('Objeto esperado.');
    return data;
  } catch {throw Object.assign(new Error('JSON inválido.'),{statusCode:400});}
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function serveStatic(requestUrl, response) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://localhost:${port}`).pathname);
  const safePath = path.normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir + path.sep)) {
    sendJson(response, 403, { ok: false, message: "Arquivo bloqueado." });
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Arquivo não encontrado.");
  }
}

let mutationQueue = Promise.resolve();
function mutate(task) { const result=mutationQueue.then(task);mutationQueue=result.catch(()=>{});return result; }
const backups = createBackupScheduler({ hours: config.backupHours, keep: config.backupKeep, output: config.backupDir,
  run: () => mutate(async () => {
    await auth.flush(); await bambuUsage.flush();
    return snapshotBackup(config.dataDir, config.backupDir, true);
  }),
  onError: () => console.error('Backup automático falhou. Confira espaço em disco e permissões do diretório de backup.')
});
async function handleApi(request, response, url) {
  try {
    auth.checkMutation(request);
    if(url.pathname==='/api/auth/login' && request.method==='POST') {await auth.login(request,response,await readBody(request));sendJson(response,200,{ok:true});return;}
    if(url.pathname==='/api/auth/automatic' && request.method==='POST') {sendJson(response,200,{ok:true,authenticated:await auth.automaticLogin(request,response)});return;}
    if(!auth.authenticated(request)) {sendJson(response,401,{ok:false,message:'Entre para acessar o sistema.'});return;}
    if(url.pathname==='/api/system/status' && request.method==='GET') {sendJson(response,200,{ok:true,backups:backups.status()});return;}
    if(url.pathname==='/api/bambu/status' && request.method==='GET') {sendJson(response,200,{ok:true,...bambuCloud.status()});return;}
    if(url.pathname==='/api/bambu/usage' && request.method==='GET') {sendJson(response,200,{ok:true,...bambuUsage.history()});return;}
    if(url.pathname==='/api/bambu/code' && request.method==='POST') {const body=await readBody(request);sendJson(response,200,await bambuCloud.requestCode(body.email));return;}
    if(url.pathname==='/api/bambu/connect' && request.method==='POST') {const body=await readBody(request);sendJson(response,200,await bambuCloud.verify(body.code));return;}
    if(url.pathname==='/api/bambu/disconnect' && request.method==='POST') {await bambuCloud.disconnect();sendJson(response,200,{ok:true});return;}
    if(url.pathname==='/api/auth/accesses' && request.method==='GET') {sendJson(response,200,{ok:true,...await auth.accesses()});return;}
    if(url.pathname==='/api/auth/revoke-ip' && request.method==='POST') {const body=await readBody(request);await auth.revoke(body.ip);sendJson(response,200,{ok:true});return;}
    if(url.pathname==='/api/auth/session' && request.method==='GET') {sendJson(response,200,{ok:true,enabled:auth.enabled,username:config.username});return;}
    if(url.pathname==='/api/auth/logout' && request.method==='POST') {auth.logout(request,response);sendJson(response,200,{ok:true});return;}
    if(url.pathname === '/api/production/remove-item' && request.method === 'POST') {
      const body=await readBody(request);
      sendJson(response,200,await mutate(()=>removeProductionItem(body.rowNumber,body.itemIndex,body.password)));return;
    }
    if (url.pathname === "/api/products/rename" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await mutate(()=>renameProduct(body.rowNumber, body.name)));
      return;
    }
    if (url.pathname === "/api/sheets" && request.method === "GET") {
      const sheet = url.searchParams.get("sheet") || "produtos";
      sendJson(response, 200, await listLocalSheet(sheet));
      return;
    }

    if (url.pathname === "/api/sheets/ping" && request.method === "GET") {
      sendJson(response, 200, { ok: true, mode: "local", message: "Sistema Flamez local pronto" });
      return;
    }

    if (url.pathname === "/api/sheets/upsert" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await mutate(()=>upsertLocalRow(String(body.sheet || ""), body.rowNumber, body.data || {})));
      return;
    }

    if (url.pathname === "/api/sheets/delete" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await mutate(()=>deleteLocalRow(String(body.sheet || ""), body.rowNumber, body.password)));
      return;
    }

    if (url.pathname === "/api/product-costs" && request.method === "GET") {
      sendJson(response, 200, { ok: true, costs: await readProductCosts() });
      return;
    }

    if (url.pathname === "/api/product-costs" && request.method === "POST") {
      const body = await readBody(request);
      const cost = await mutate(()=>saveProductCost(String(body.productKey || ""), body.data || {}));
      sendJson(response, 200, { ok: true, productKey: body.productKey, cost });
      return;
    }

    sendJson(response, 404, { ok: false, message: "Rota de API não encontrada." });
  } catch (error) {
    if(!error.statusCode) console.error("Falha na API:",error.message);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : "Não foi possível salvar ou carregar os dados. Verifique o servidor e o backup."
    });
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('X-Robots-Tag','noindex, nofollow');
  response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(config.production) response.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const url = new URL(request.url, 'http://localhost');
    if(url.pathname==='/healthz' && request.method==='GET') {sendJson(response,200,{ok:true});return;}
    if(url.pathname.startsWith('/api/')) {await handleApi(request,response,url);return;}
    if(!['GET','HEAD'].includes(request.method)) {sendJson(response,405,{ok:false,message:'Método não permitido.'});return;}
    if(url.pathname==='/login') {await serveStatic('/login.html',response);return;}
    const loginAsset=['/login.js','/login.css','/assets/flamez-favicon-white.svg','/assets/flamez-logo-transparent.png'].includes(url.pathname);
    if(!loginAsset && !auth.authenticated(request)) {response.writeHead(302,{location:'/login','cache-control':'no-store'});response.end();return;}
    await serveStatic(request.url,response);
  } catch(error) {console.error('Falha na solicitação:',error.message);if(!response.headersSent)sendJson(response,400,{ok:false,message:'Solicitação inválida.'});else response.end();}
});
server.requestTimeout=30_000;
server.headersTimeout=15_000;
server.keepAliveTimeout=5_000;
let releaseLock;
try {
  releaseLock=await acquireLock(config.dataDir);
  await readLocalSheets();
  await readProductCosts();
  if(auth.enabled)await auth.init();
  await bambuUsage.init();
  await bambuCloud.init();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,config.host,resolve);});
  console.log('Sistema Flamez iniciado na porta '+port+'. Autenticação: '+(auth.enabled?'ativa':'modo local'));
  backups.start();
} catch(error) {
  bambuCloud.close(); await bambuCloud.flush(); await auth.flush();
  await releaseLock?.(); console.error('Não foi possível iniciar:',error.message); process.exitCode=1;
}
let stopping=false;
async function shutdown() {
  if(stopping)return;stopping=true;
  bambuCloud.close();
  const timeout=setTimeout(()=>process.exit(1),30_000);timeout.unref();
  await new Promise(resolve=>server.close(resolve));
  await backups.stop();
  await mutationQueue;
  await bambuCloud.flush();
  await auth.flush();
  await releaseLock?.();
  clearTimeout(timeout);
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
