import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MACHINE_HEADERS, normalizeMachineData, machineNumber, updateMachineHours } from "./public/machine-costs.js";
import { applyProductionOutcome } from "./public/production-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const localSheetsPath = path.join(__dirname, "sheets.local.json");
const productCostsPath = path.join(__dirname, "product-costs.local.json");
const port = Number(process.env.PORT || 5177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const DEFAULT_LOCAL_SHEETS = {
  productStock: {sheet:'productStock',sheetName:'Estoque de produtos',headers:['SKU','Quantidade'],rows:[]},
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
  let data = null;

  if (existsSync(localSheetsPath)) {
    try {
      data = JSON.parse(await readFile(localSheetsPath, "utf8"));
    } catch {
      data = null;
    }
  }

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
  updateMachineHours(data.sheets);
  const next = {
    ...data,
    mode: "local",
    updatedAt: new Date().toISOString()
  };
  await writeFile(localSheetsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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

  const targetRowNumber = Number(rowNumber || 0) || nextRowNumber(sheet.rows);
  if(sheetKey === 'productStock') {
    const sku = String(rowData.SKU || '').trim();
    const quantity = machineNumber(rowData.Quantidade);
    if(!sku || !Number.isSafeInteger(quantity) || quantity < 0) throw Object.assign(new Error('Informe um SKU e uma quantidade inteira maior ou igual a zero.'),{statusCode:400});
    if(!data.sheets.produtos.rows.some(row=>String(row.data.SKU || '').trim() === sku)) throw Object.assign(new Error('Este SKU não está cadastrado em Produtos.'),{statusCode:400});
    if(sheet.rows.some(row=>row.rowNumber !== targetRowNumber && row.data.SKU === sku)) throw Object.assign(new Error('Este SKU já possui estoque. Atualize a página para editar a quantidade existente.'),{statusCode:400});
    rowData={SKU:sku,Quantidade:String(quantity)};
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
      if (!resetMaintenance) for (const production of data.sheets.producao.rows) {
        if (production.data['Status da produção'] === 'Em produção' || String(production.data['Dia produção']).slice(0,10) <= maintenanceDate) continue;
        try { for (const item of JSON.parse(production.data['Itens da produção'] || '[]')) if (Number(item.machineRow) === targetRowNumber) laterHours += Number(item.hours) || 0; } catch {}
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
  if(password !== '1234') throw Object.assign(new Error('Senha incorreta. A produção não foi removida.'),{statusCode:403});
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

async function readProductCosts() {
  if (!existsSync(productCostsPath)) {
    return {};
  }

  try {
    const raw = await readFile(productCostsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveProductCost(productKey, data) {
  if (!productKey) {
    throw new Error("Produto sem chave para salvar o cálculo local.");
  }

  const costs = await readProductCosts();
  costs[productKey] = {
    ...data,
    updatedAt: new Date().toISOString()
  };
  await writeFile(productCostsPath, `${JSON.stringify(costs, null, 2)}\n`, "utf8");
  return costs[productKey];
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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

  if (!filePath.startsWith(publicDir)) {
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

async function handleApi(request, response, url) {
  try {
    if(url.pathname === '/api/production/remove-item' && request.method === 'POST') {
      const body=await readBody(request);
      sendJson(response,200,await removeProductionItem(body.rowNumber,body.itemIndex,body.password));return;
    }
    if (url.pathname === "/api/products/rename" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await renameProduct(body.rowNumber, body.name));
      return;
    }
    if (url.pathname === "/api/config" && request.method === "GET") {
      sendJson(response, 200, { ok: true, config: { mode: "local" } });
      return;
    }

    if (url.pathname === "/api/config" && request.method === "POST") {
      await readBody(request);
      sendJson(response, 200, { ok: true, config: { mode: "local" } });
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
      sendJson(response, 200, await upsertLocalRow(String(body.sheet || ""), body.rowNumber, body.data || {}));
      return;
    }

    if (url.pathname === "/api/sheets/delete" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await deleteLocalRow(String(body.sheet || ""), body.rowNumber, body.password));
      return;
    }

    if (url.pathname === "/api/product-costs" && request.method === "GET") {
      sendJson(response, 200, { ok: true, costs: await readProductCosts() });
      return;
    }

    if (url.pathname === "/api/product-costs" && request.method === "POST") {
      const body = await readBody(request);
      const cost = await saveProductCost(String(body.productKey || ""), body.data || {});
      sendJson(response, 200, { ok: true, productKey: body.productKey, cost });
      return;
    }

    sendJson(response, 404, { ok: false, message: "Rota de API não encontrada." });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.message || "Erro inesperado.",
      details: error.payload || null
    });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  await serveStatic(request.url, response);
});

server.listen(port, () => {
  console.log(`Sistema Flamez rodando em http://localhost:${port}`);
});
