import { renderMonthlyPanel } from './monthly-panel.js';
import { renderFilamentSettings } from './filament-settings.js';
import { MACHINE_HEADERS, calculateMachineCost, normalizeMachineData, machineNumber, maintenanceProgress } from "./machine-costs.js";
import { renderProduction } from "./production.js";

const SHEETS = {
  productStock: {title:'Estoque de produtos'},
  painel: {title: "Painel do mês"},
  produtos: {
    title: "Produtos",
    primary: "Produto",
    secondary: "SKU",
    summary: ["Valor de venda", "Valor unitário", "Anúncio ativo", "Observações", "Shopee"]
  },
  filamentos: {
    title: "Filamentos",
    primary: "Tipo de filamento",
    select: {
      "Tipo de filamento": ["PLA", "PETG"],
      "Tipo do material": ["Valvet", "Silk", "Sólido", "Translúcido", "PETG", "PLA", "Lite"],
      "Urgência de compra": ["Alta Prioridade", "Média Prioridade", "Baixa Prioridade"]
    }
  },
  producao: {
    title: "Produção",
    primary: "Código do produto",
    select: {
      "Resultado da impressão": ["Sim", "Parcial", "Não"],
      "Impressora usada": ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]
    }
  },
  reposicao: {
    title: "Peças de Reposição",
    primary: "Nome da peça"
  },
  maquinas: {
    title: "Máquinas",
    primary: "Nome da máquina",
    headers: MACHINE_HEADERS,
    select: {
      "Status": ["Ativa", "Em manutenção", "Parada"]
    },
    multiline: ["Observações"]
  },
  encomendas: {
    title: "Encomendas",
    primary: "Nome da encomenda",
    secondary: "Cliente",
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
    summary: ["Data de entrega", "Status do processo", "Cancelado", "Valor da encomenda", "Quantidade de itens"],
    select: {
      "Status do processo": ["Parado", "Em andamento", "Finalizado"],
      "Cancelado": ["Não", "Sim"],
      "Canal de venda": ["Shopee", "Instagram", "WhatsApp", "Indicação", "Outro"]
    },
    multiline: ["Produto/Itens", "Observações"]
  }
};

const COST_DEFAULTS = {
  quantity: "1",
  materials: [],
  filamentKgPrice: "",
  filamentUsedGrams: "",
  printHours: "",
  depreciationPerHour: "0,80",
  printerWatts: "",
  energyKwhPrice: "",
  otherBatchCosts: "",
  otherUnitCosts: "",
  shopeeActive: "",
  shopeeFeeFixed: "4,30",
  shopeeFeePercent: "18",
  productNotes: "",
  notes: ""
};

const COST_TABS = [
  {
    id: "material",
    label: "Material",
    fields: [
      ["filamentKgPrice", "Valor do kg do filamento", "R$"],
      ["filamentUsedGrams", "Filamento usado no lote", "g"],
      ["quantity", "Quantidade feita no lote", "un"]
    ]
  },
  {
    id: "depreciation",
    label: "Depreciação",
    fields: [
      ["printHours", "Horas para fazer o lote", "h"],
      ["depreciationPerHour", "Depreciação por hora", "R$/h"]
    ]
  },
  {
    id: "energy",
    label: "Energia",
    fields: [
      ["printerWatts", "Potência média da impressora", "W"],
      ["energyKwhPrice", "Valor do kWh", "R$/kWh"]
    ]
  },
  {
    id: "other",
    label: "Outros",
    fields: [
      ["otherBatchCosts", "Outros gastos do lote", "R$"],
      ["otherUnitCosts", "Outros gastos por item", "R$/un"]
    ]
  }
];

const PRODUCT_SECTIONS = [
  ["calculator", "Calculadora"],
  ["shopee", "Anúncios Shopee"],
  ["notes", "Observações"]
];

const DEFAULT_SHOPEE_LISTINGS = [
  { name: "Kit com 1 unidade", units: "1", salePrice: "", receivedAmount: "", extras: [] },
  { name: "Kit com 2 unidades", units: "2", salePrice: "", receivedAmount: "", extras: [] },
  { name: "Kit com 3 unidades", units: "3", salePrice: "", receivedAmount: "", extras: [] },
  { name: "Kit com 4 unidades", units: "4", salePrice: "", receivedAmount: "", extras: [] }
];

const LOCAL_PRODUCT_COSTS_KEY = "sistemaFlamez.productCosts";
const LOCAL_AUTOSAVE_DELAY_MS = 700;

const state = {
  filamentTab: 'stock',
  activeSheet: "produtos",
  config: { mode: "local" },
  headers: [],
  rows: [],
  productCosts: {},
  autosaveTimers: new Map(),
  pendingAutosaves: new Set(),
  expanded: new Set(),
  openBreakdown: new Set(),
  openShopeeSettings: new Set(),
  openShopeeExtraMenus: new Set(),
  selectedVariations: {},
  activeProductSections: {},
  activeCostTabs: {},
  editingOrders: new Set(),
  editingMachines: new Set(),
  editingProduction: new Set(),
  productionProducts: [],
  productionMachines: [],
  draft: null,
  draftMeta: null,
  loading: false,
  loadRequestId: 0
};

const elements = {
  tabs: [...document.querySelectorAll(".tab")],
  viewTitle: document.querySelector("#viewTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  settingsButton: document.querySelector("#settingsButton"),
  variationButton: document.querySelector("#variationButton"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  addButton: document.querySelector("#addButton"),
  content: document.querySelector("#content"),
  variationDialog: document.querySelector("#variationDialog"),
  variationSource: document.querySelector("#variationSource"),
  createVariationButton: document.querySelector("#createVariationButton"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate")
};

function setStatus(text, type = "neutral") {
  elements.syncStatus.textContent = text;
  elements.syncStatus.className = `status ${type}`;
}

function readMirroredProductCosts() {
  try {
    const raw = localStorage.getItem(LOCAL_PRODUCT_COSTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function timestampValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function mergeProductCosts(fileCosts, mirroredCosts) {
  const merged = { ...fileCosts };
  Object.entries(mirroredCosts || {}).forEach(([key, mirrored]) => {
    const fromFile = fileCosts?.[key];
    if (!fromFile) {
      merged[key] = mirrored;
      return;
    }

    const fileTime = timestampValue(fromFile.updatedAt || fromFile.localUpdatedAt);
    const mirrorTime = timestampValue(mirrored.localUpdatedAt || mirrored.updatedAt);
    merged[key] = mirrorTime > fileTime ? mirrored : fromFile;
  });
  return merged;
}

function mirrorProductCosts() {
  try {
    localStorage.setItem(LOCAL_PRODUCT_COSTS_KEY, JSON.stringify(state.productCosts));
  } catch {
    // O arquivo local continua sendo a fonte principal; o espelho só protege contra F5 rápido.
  }
}

function setProductLocalData(key, data) {
  state.productCosts[key] = {
    ...data,
    localUpdatedAt: new Date().toISOString()
  };
  mirrorProductCosts();
  return state.productCosts[key];
}

function clearProductAutosave(key) {
  const timer = state.autosaveTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    state.autosaveTimers.delete(key);
  }
}

async function persistProductLocalData(key, data, options = {}) {
  const {
    button = null,
    savingText = "Salvando...",
    successMessage = "Dados locais salvos",
    errorButtonText = "Salvar",
    renderAfter = false,
    silent = false
  } = options;

  clearProductAutosave(key);

  if (button) {
    button.disabled = true;
    button.textContent = savingText;
  }

  try {
    const payload = await api("/api/product-costs", {
      method: "POST",
      body: JSON.stringify({ productKey: key, data })
    });
    setProductLocalData(key, payload.cost);
    state.pendingAutosaves.delete(key);
    if (!silent) setStatus(successMessage, "ok");
    if (renderAfter) render();
    return payload.cost;
  } catch (error) {
    setStatus(error.message, "error");
    if (button) {
      button.disabled = false;
      button.textContent = errorButtonText;
    }
    return null;
  }
}

function queueProductLocalAutosave(key, data, successMessage = "Dados locais salvos automaticamente") {
  setProductLocalData(key, data);
  state.pendingAutosaves.add(key);
  clearProductAutosave(key);
  state.autosaveTimers.set(key, setTimeout(() => {
    state.autosaveTimers.delete(key);
    setStatus("Salvando dados locais...", "neutral");
    persistProductLocalData(key, state.productCosts[key], {
      successMessage,
      silent: false
    });
  }, LOCAL_AUTOSAVE_DELAY_MS));
}

function flushPendingProductAutosaves() {
  state.pendingAutosaves.forEach((key) => {
    const data = state.productCosts[key];
    if (!data) return;

    clearProductAutosave(key);
    const body = JSON.stringify({ productKey: key, data });

    let sent = false;

    if (navigator.sendBeacon) {
      const payload = new Blob([body], { type: "application/json" });
      sent = navigator.sendBeacon("/api/product-costs", payload);
    }

    if (sent) return;

    fetch("/api/product-costs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Não foi possível completar a ação.");
  }

  return payload;
}

function valueOf(row, header) {
  return row.data?.[header] ?? "";
}

function formatMoney(value) {
  if (value === "" || value === null || value === undefined) return "-";
  const normalized = parseLocaleNumber(value);
  if (!Number.isFinite(normalized)) return String(value);
  return normalized.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseLocaleNumber(value) {
  if (typeof value === "number") return value;

  let text = String(value || "").trim().replace(/[^\d,.-]/g, "");

  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  return Number(text);
}

function parseOptionalNumber(value) {
  if (typeof value === "number") return value;

  const text = String(value || "").trim();
  if (!text) return NaN;

  return parseLocaleNumber(text);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function todayInputValue() {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60 * 1000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatSummaryValue(header, value) {
  if (/custo|valor|preço|lucro/i.test(header)) {
    return formatMoney(value);
  }

  return value || "-";
}

function productKey(row) {
  if (row.data?._productCostKey) return row.data._productCostKey;
  const sku = String(valueOf(row, "SKU") || "").trim();
  const name = String(valueOf(row, "Produto") || "").trim();

  if (sku) return `sku:${sku}`;
  if (name) return `produto:${name.toLowerCase()}`;
  return `linha:${row.rowNumber}`;
}

function productTitle(row) {
  return String(valueOf(row, "Produto") || "Produto sem nome").trim();
}

function productSku(row) {
  return String(valueOf(row, "SKU") || "").trim();
}

function getProductByRowNumber(rowNumber) {
  return state.rows.find((row) => String(row.rowNumber) === String(rowNumber)) || null;
}

function isVariationProduct(row) {
  const localData = getProductLocalData(row);
  return Boolean(localData.variationParentRowNumber || localData.variationParentKey);
}

function isVariationOf(row, parentRow) {
  const localData = getProductLocalData(row);
  return String(localData.variationParentRowNumber || "") === String(parentRow.rowNumber)
    || localData.variationParentKey === productKey(parentRow);
}

function getProductVariations(parentRow) {
  return state.rows.filter((row) => row.rowNumber !== parentRow.rowNumber && isVariationOf(row, parentRow));
}

function getSelectedProductVersion(parentRow) {
  const selectedRowNumber = state.selectedVariations[productKey(parentRow)];
  return getProductByRowNumber(selectedRowNumber) || parentRow;
}

function rowMatchesSearch(row, term) {
  return Object.values(row.data || {}).some((value) => String(value || "").toLowerCase().includes(term));
}

function nextUniqueProductValue(baseValue, header) {
  const base = String(baseValue || "").trim();
  if (!base) return "";

  const existing = new Set(state.rows.map((row) => String(valueOf(row, header) || "").trim().toLowerCase()));
  let candidate = `${base}-VAR`;
  let counter = 2;

  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base}-VAR${counter}`;
    counter += 1;
  }

  return candidate;
}

function selectProductVersion(parentRow, selectedRow) {
  const parentKey = productKey(parentRow);
  const rowKey = String(parentRow.rowNumber);
  state.expanded.add(rowKey);
  state.selectedVariations[parentKey] = selectedRow && selectedRow.rowNumber !== parentRow.rowNumber
    ? String(selectedRow.rowNumber)
    : "";
  render();
}

function startVariationDraft(sourceRow) {
  const data = { ...(sourceRow.data || {}) };
  delete data._productCostKey;
  const sourceName = productTitle(sourceRow);
  const sourceSku = productSku(sourceRow);

  if ("Produto" in data) {
    data.Produto = `${sourceName} - Variação`;
  }

  if ("SKU" in data) {
    data.SKU = nextUniqueProductValue(sourceSku || sourceName, "SKU");
  }

  state.activeSheet = "produtos";
  state.draft = { rowNumber: null, data };
  state.draftMeta = {
    type: "variation",
    sourceRowNumber: sourceRow.rowNumber,
    sourceProductKey: productKey(sourceRow),
    sourceName,
    sourceLocalData: getProductLocalData(sourceRow)
  };
  state.expanded.clear();
  setStatus("Variação copiada. Edite e salve como novo produto.", "warning");
  render();
}

function openVariationDialog() {
  elements.variationSource.replaceChildren();
  const originalRows = state.rows.filter((row) => !isVariationProduct(row));
  originalRows.forEach((row) => {
    const sku = productSku(row);
    const label = sku ? `${productTitle(row)} (${sku})` : productTitle(row);
    elements.variationSource.append(new Option(label, String(row.rowNumber)));
  });

  if (!originalRows.length) {
    setStatus("Não há produtos para copiar.", "warning");
    return;
  }

  elements.variationDialog.showModal();
}

function getCostDraft(row) {
  return {
    ...COST_DEFAULTS,
    ...(state.productCosts[productKey(row)] || {})
  };
}

function getProductLocalData(row) {
  return {
    ...COST_DEFAULTS,
    ...(state.productCosts[productKey(row)] || {})
  };
}

function getListingExtras(listing) {
  const savedExtras = Array.isArray(listing.extras) ? listing.extras : [];
  const extras = savedExtras
    .filter((extra) => extra && typeof extra === "object")
    .map((extra) => ({
      type: extra.type || "gift",
      name: extra.name || "",
      cost: extra.cost || ""
    }));

  if (!extras.length && (listing.giftName || listing.giftCost)) {
    extras.push({
      type: "gift",
      name: listing.giftName || "",
      cost: listing.giftCost || ""
    });
  }

  return extras;
}

function getShopeeListings(row) {
  const localData = getProductLocalData(row);
  const listings = Array.isArray(localData.shopeeListings)
    ? localData.shopeeListings
    : DEFAULT_SHOPEE_LISTINGS;

  return listings.map((listing, index) => ({
    name: listing.name || `Kit com ${index + 1} unidade${index === 0 ? "" : "s"}`,
    units: listing.units || String(index + 1),
    salePrice: listing.salePrice || "",
    receivedAmount: listing.receivedAmount || "",
    receivedManual: listing.receivedManual === "true" ? "true" : "",
    extras: getListingExtras(listing)
  }));
}

function getShopeeFeeSettings(localData) {
  return {
    fixed: Number.isFinite(parseOptionalNumber(localData.shopeeFeeFixed))
      ? Math.max(parseOptionalNumber(localData.shopeeFeeFixed), 0)
      : 4.3,
    percent: Number.isFinite(parseOptionalNumber(localData.shopeeFeePercent))
      ? Math.max(parseOptionalNumber(localData.shopeeFeePercent), 0)
      : 18
  };
}

function calculateShopeeReceived(salePrice, settings) {
  if (!Number.isFinite(salePrice)) return NaN;
  return salePrice - (settings.fixed + salePrice * settings.percent / 100);
}

function formatInputMoney(value) {
  if (!Number.isFinite(value)) return "";
  return formatNumber(value, 2);
}

function shopeeFormulaLabel(settings) {
  return `Recebo = Vendido por - (${formatMoney(settings.fixed)} + ${formatNumber(settings.percent, 2)}% do vendido por)`;
}

function isProductAdActive(row) {
  const localData = getProductLocalData(row);
  const saved = String(localData.shopeeActive || "").toLowerCase();

  if (saved === "sim") return true;
  if (saved === "não" || saved === "nao") return false;

  return Boolean(valueOf(row, "Link Shopee"));
}

function productAdActiveValue(row) {
  return isProductAdActive(row) ? "sim" : "nao";
}

function toggleProductAdActive(row) {
  const key = productKey(row);
  const nextActive = isProductAdActive(row) ? "nao" : "sim";
  const next = {
    ...getProductLocalData(row),
    ...state.productCosts[key],
    shopeeActive: nextActive
  };
  queueProductLocalAutosave(key, next, "Status do anúncio salvo automaticamente");
  render();
}

function openProductNotes(row, rowKey) {
  const key = productKey(row);
  state.expanded.add(rowKey);
  state.activeProductSections[key] = "notes";
  render();
}

function emptyMaterialRow() {
  return { name: "", kgPrice: "", usedGrams: "" };
}

function normalizeMaterialRows(cost) {
  const savedRows = Array.isArray(cost.materials) ? cost.materials : [];
  const rows = savedRows.map((material) => ({
      name: String(material?.name || ""),
      kgPrice: String(material?.kgPrice ?? material?.filamentKgPrice ?? ""),
      usedGrams: String(material?.usedGrams ?? material?.filamentUsedGrams ?? "")
    }));

  if (rows.length) return rows;

  if (cost.filamentKgPrice || cost.filamentUsedGrams) {
    return [{
      name: "",
      kgPrice: String(cost.filamentKgPrice || ""),
      usedGrams: String(cost.filamentUsedGrams || "")
    }];
  }

  return [emptyMaterialRow()];
}

function withMaterialRows(data, rows) {
  const normalizedRows = rows.length ? rows : [emptyMaterialRow()];
  return {
    ...data,
    materials: normalizedRows,
    filamentKgPrice: normalizedRows[0]?.kgPrice || "",
    filamentUsedGrams: normalizedRows[0]?.usedGrams || ""
  };
}

function calculateUnitCost(cost) {
  const quantity = Math.max(parseLocaleNumber(cost.quantity) || 0, 0);
  const materialRows = normalizeMaterialRows(cost);
  const printHours = Math.max(parseLocaleNumber(cost.printHours) || 0, 0);
  const depreciationPerHour = Math.max(parseLocaleNumber(cost.depreciationPerHour) || 0, 0);
  const printerWatts = Math.max(parseLocaleNumber(cost.printerWatts) || 0, 0);
  const energyKwhPrice = Math.max(parseLocaleNumber(cost.energyKwhPrice) || 0, 0);
  const otherBatchCosts = Math.max(parseLocaleNumber(cost.otherBatchCosts) || 0, 0);
  const otherUnitCosts = Math.max(parseLocaleNumber(cost.otherUnitCosts) || 0, 0);
  const divisor = quantity > 0 ? quantity : 1;

  const materialTotal = materialRows.reduce((total, material) => {
    const kgPrice = Math.max(parseLocaleNumber(material.kgPrice) || 0, 0);
    const usedGrams = Math.max(parseLocaleNumber(material.usedGrams) || 0, 0);
    return total + kgPrice * (usedGrams / 1000);
  }, 0);
  const depreciationTotal = depreciationPerHour * printHours;
  const energyTotal = (printerWatts / 1000) * printHours * energyKwhPrice;
  const batchTotal = materialTotal + depreciationTotal + energyTotal + otherBatchCosts;
  const unitTotal = batchTotal / divisor + otherUnitCosts;

  return {
    quantity,
    materialTotal,
    materials: materialRows,
    depreciationTotal,
    energyTotal,
    otherTotal: otherBatchCosts + otherUnitCosts * divisor,
    batchTotal: batchTotal + otherUnitCosts * divisor,
    materialUnit: materialTotal / divisor,
    depreciationUnit: depreciationTotal / divisor,
    energyUnit: energyTotal / divisor,
    otherUnit: otherBatchCosts / divisor + otherUnitCosts,
    unitTotal
  };
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatDateDisplay(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text || "-";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function productMetric(row, header) {
  const cost = calculateUnitCost(getCostDraft(row));
  const saleValue = parseLocaleNumber(valueOf(row, "Valor de venda"));

  if (header === "Valor unitário") {
    return cost.unitTotal > 0 ? formatMoney(cost.unitTotal) : "-";
  }

  if (header === "Valor de venda") {
    return formatMoney(valueOf(row, "Valor de venda"));
  }

  if (header === "Lucro unitário") {
    if (!Number.isFinite(saleValue) || saleValue <= 0 || cost.unitTotal <= 0) return "-";
    const profit = saleValue - cost.unitTotal;
    return `${formatMoney(profit)} (${formatPercent(profit / saleValue)})`;
  }

  if (header === "Anúncio ativo") {
    return isProductAdActive(row) ? "Sim" : "Não";
  }

  return formatSummaryValue(header, valueOf(row, header));
}

function filteredRows() {
  const term = elements.searchInput.value.trim().toLowerCase();
  const rows = state.rows;

  if (state.activeSheet === "produtos") {
    const originalRows = rows.filter((row) => !isVariationProduct(row));
    if (!term) return originalRows;

    return originalRows.filter((row) => {
      return rowMatchesSearch(row, term) || getProductVariations(row).some((variation) => rowMatchesSearch(variation, term));
    });
  }

  if (!term) return rows;

  return rows.filter((row) => rowMatchesSearch(row, term));
}

function createInput(sheetKey, header, value = "") {
  const config = SHEETS[sheetKey] || {};
  const wrapper = document.createElement("div");
  wrapper.className = config.multiline?.includes(header) ? "field wide" : "field";

  const label = document.createElement("label");
  label.textContent = header;
  wrapper.append(label);

  const options = config.select?.[header];
  let input;

  if (options) {
    input = document.createElement("select");
    input.append(new Option("", ""));
    options.forEach((option) => input.append(new Option(option, option)));
    input.value = value || "";
  } else if (config.multiline?.includes(header)) {
    input = document.createElement("textarea");
    input.value = value || "";
  } else {
    input = document.createElement("input");
    input.type = sheetKey === "maquinas" && [...MACHINE_HEADERS.slice(3, 7), "Horas de uso"].includes(header)
      ? "text"
      : guessInputType(header);
    input.value = value ?? "";
  }

  input.name = header;
  wrapper.append(input);
  return wrapper;
}

function guessInputType(header) {
  if (/dia|data/i.test(header)) return "date";
  if (/hora/i.test(header)) return "time";
  if (/custo|valor|preço|peso|quantidade|estoque|horas|desperdício/i.test(header)) return "text";
  if (/link|pdf|foto|stl|3mf|imagem/i.test(header)) return "url";
  return "text";
}

function readForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = String(value || "").trim();
  });
  return data;
}

async function saveRow(sheet, rowNumber, data, button) {
  button.disabled = true;
  button.textContent = "Salvando...";
  setStatus("Salvando localmente", "warning");
  const draftMeta = !rowNumber && sheet === "produtos" ? state.draftMeta : null;

  if (draftMeta?.type === "variation") {
    const draftKey = productKey({ rowNumber: null, data });
    const keyAlreadyExists = state.rows.some((row) => productKey(row) === draftKey);
    if (keyAlreadyExists) {
      setStatus("Use um SKU ou nome único para a variação antes de salvar.", "error");
      button.disabled = false;
      button.textContent = "Salvar";
      return;
    }
  }

  try {
    const payload = await api("/api/sheets/upsert", {
      method: "POST",
      body: JSON.stringify({ sheet, rowNumber, data })
    });

    if (draftMeta?.type === "variation") {
      const savedRow = {
        rowNumber: payload.rowNumber,
        data: payload.data || data
      };
      await persistProductLocalData(productKey(savedRow), {
        ...draftMeta.sourceLocalData,
        variationParentKey: draftMeta.sourceProductKey,
        variationParentRowNumber: String(draftMeta.sourceRowNumber),
        variationSourceName: draftMeta.sourceName
      }, {
        silent: true
      });
    }

    state.draft = null;
    state.draftMeta = null;
    if (sheet === "maquinas") state.editingMachines.delete(String(payload.rowNumber));
    if (sheet === "producao") state.editingProduction.delete(`production:${payload.rowNumber}`);
    if (sheet === "encomendas") {
      state.editingOrders.delete(String(rowNumber));
      state.editingOrders.delete(String(payload.rowNumber));
    }
    await loadSheet(sheet);
    setStatus(draftMeta?.type === "variation" ? "Variação salva localmente" : "Salvo localmente", "ok");
  } catch (error) {
    setStatus(error.message, "error");
    button.disabled = false;
    button.textContent = "Salvar";
  }
}

function productionRemovalPassword() {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='filament-dialog';
    const form=document.createElement('form');form.className='filament-editor';
    const title=document.createElement('h2');title.textContent='Remover produção';
    const text=document.createElement('p');text.textContent='A produção será removida e suas horas serão retiradas da máquina. Digite a senha para confirmar.';
    const label=document.createElement('label');label.className='field';label.textContent='Senha';
    const input=document.createElement('input');input.type='password';input.inputMode='numeric';input.required=true;input.autocomplete='off';label.append(input);
    const error=document.createElement('p');error.id='production-password-error';error.setAttribute('role','alert');error.style.color='#b91c1c';error.style.margin='0';error.hidden=true;
    input.setAttribute('aria-describedby',error.id);
    input.oninput=()=>{error.hidden=true;error.textContent='';input.removeAttribute('aria-invalid');};
    const actions=document.createElement('div');actions.className='row-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost-light-button';cancel.textContent='Cancelar';cancel.onclick=()=>dialog.close();
    const confirm=document.createElement('button');confirm.type='submit';confirm.className='danger-button';confirm.textContent='Remover produção';actions.append(cancel,confirm);
    let password=null;
    form.onsubmit=event=>{
      event.preventDefault();
      if(input.value!=='1234'){
        error.textContent='Senha incorreta. Tente novamente.';error.hidden=false;
        input.setAttribute('aria-invalid','true');input.focus();input.select();return;
      }
      password=input.value;dialog.close();
    };
    dialog.addEventListener('close',()=>{dialog.remove();resolve(password);});form.append(title,text,label,error,actions);dialog.append(form);document.body.append(dialog);dialog.showModal();
  });
}

async function removeProductionItem(rowNumber,itemIndex) {
  const password=await productionRemovalPassword();if(password===null)return;
  try {await api('/api/production/remove-item',{method:'POST',body:JSON.stringify({rowNumber,itemIndex,password})});await loadSheet('producao');setStatus('Item removido e horas das máquinas atualizadas','ok');}
  catch(error){setStatus(error.message,'error');}
}

async function deleteRow(sheet, rowNumber) {
  if (!rowNumber) {
    state.draft = null;
    state.draftMeta = null;
    setStatus("Dados locais", "ok");
    render();
    return;
  }

  const password=sheet === 'producao' ? await productionRemovalPassword() : undefined;
  if(password===null)return;
  setStatus("Excluindo localmente", "warning");

  try {
    await api("/api/sheets/delete", {
      method: "POST",
      body: JSON.stringify({ sheet, rowNumber, password })
    });
    if (sheet === "encomendas") {
      state.editingOrders.delete(String(rowNumber));
    }
    await loadSheet(sheet);
    setStatus("Linha excluída localmente", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderProductCard(row, isDraft = false) {
  const config = SHEETS.produtos;
  const rowKey = isDraft ? "draft" : String(row.rowNumber);
  const open = isDraft || state.expanded.has(rowKey);
  const card = document.createElement("article");
  card.className = "product-card";

  const summary = document.createElement("div");
  summary.className = "product-summary";

  const chevron = document.createElement("button");
  chevron.className = "chevron";
  chevron.type = "button";
  chevron.title = open ? "Fechar detalhes" : "Abrir detalhes";
  chevron.textContent = open ? "⌄" : "›";
  chevron.addEventListener("click", () => {
    if (!isDraft) {
      open ? state.expanded.delete(rowKey) : state.expanded.add(rowKey);
      render();
    }
  });
  summary.append(chevron);

  const title = document.createElement("div");
  title.className = "product-cell product-name";
  title.innerHTML = `<strong>${escapeHtml(valueOf(row, config.primary) || "Novo produto")}</strong><span>${escapeHtml(valueOf(row, config.secondary) || "Sem SKU")}</span>`;
  summary.append(title);

  config.summary.forEach((header) => {
    const cell = renderProductSummaryCell(row, header, isDraft, rowKey);
    summary.append(cell);
  });

  card.append(summary);

  if (open) {
    card.append(renderProductCostPanel(row, isDraft));
  }

  return card;
}

function renderProductSummaryCell(row, header, isDraft = false, rowKey = "") {
  const cell = document.createElement("div");
  cell.className = "product-cell";

  if (header === "Anúncio ativo") {
    const active = isProductAdActive(row);
    const label = document.createElement("span");
    label.className = "cell-label";
    label.textContent = "Anúncio ativo";

    const toggle = document.createElement("button");
    toggle.className = `status-pill status-toggle ${active ? "yes" : "no"}`;
    toggle.type = "button";
    toggle.textContent = active ? "Sim" : "Não";
    toggle.title = active ? "Clique para marcar como inativo" : "Clique para marcar como ativo";
    toggle.disabled = isDraft;
    toggle.addEventListener("click", () => toggleProductAdActive(row));

    cell.append(label, toggle);
    return cell;
  }

  if (header === "Observações") {
    const localData = getProductLocalData(row);
    const hasNotes = Boolean(String(localData.productNotes || "").trim());
    const label = document.createElement("span");
    label.className = "cell-label";
    label.textContent = "Observações";

    const button = document.createElement("button");
    button.className = `notes-button${hasNotes ? " has-notes" : ""}`;
    button.type = "button";
    button.textContent = hasNotes ? "Ver nota" : "Adicionar";
    button.title = hasNotes ? "Abrir observações do produto" : "Adicionar observação ao produto";
    button.disabled = isDraft;
    button.addEventListener("click", () => openProductNotes(row, rowKey));

    cell.append(label, button);
    return cell;
  }

  if (header === "Shopee") {
    const url = valueOf(row, "Link Shopee");
    const label = document.createElement("span");
    label.className = "cell-label";
    label.textContent = "Link do produto";
    cell.append(label);

    if (url) {
      const link = document.createElement("a");
      link.className = "shopee-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Abrir Shopee";
      cell.append(link);
    } else {
      const empty = document.createElement("span");
      empty.className = "cell-value";
      empty.textContent = "-";
      cell.append(empty);
    }

    return cell;
  }

  cell.innerHTML = `<span class="cell-label">${escapeHtml(header)}</span><span class="cell-value">${escapeHtml(productMetric(row, header))}</span>`;
  return cell;
}

function renderProductCostPanel(row, isDraft) {
  const details = document.createElement("div");
  details.className = "product-details product-workspace";

  if (isDraft) {
    details.append(renderNewProductForm(row));
    return details;
  }

  const key = productKey(row);
  const activeSection = state.activeProductSections[key] || "calculator";
  const variations = getProductVariations(row);
  const selectedRow = getSelectedProductVersion(row);
  const selectedKey = productKey(selectedRow);
  const nav = document.createElement("div");
  nav.className = "product-section-tabs";

  PRODUCT_SECTIONS.forEach(([id, label]) => {
    const button = document.createElement("button");
    button.className = `product-section-tab${id === activeSection ? " active" : ""}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      state.activeProductSections[key] = id;
      render();
    });
    nav.append(button);
  });

  if (variations.length) {
    details.append(renderProductVariations(row, variations, selectedRow));
  }

  const identity = renderProductNameField(selectedRow);
  details.append(identity);
  const modelLink = driveModelDownloadUrl(valueOf(selectedRow, "STL/3MF"));
  if (modelLink) {
    const download = document.createElement("a");
    download.className = "model-download-button";
    download.href = modelLink;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    download.textContent = "Baixar modelo";
    identity.querySelector('.product-identity-actions').append(download);
  }
  details.append(nav);

  if (activeSection === "shopee") {
    details.append(renderShopeeListingsPanel(selectedRow, selectedKey));
    return details;
  }

  if (activeSection === "notes") {
    details.append(renderProductNotesPanel(selectedRow, selectedKey));
    return details;
  }

  details.append(renderUnitCostCalculator(selectedRow, selectedKey));
  return details;
}

function renderProductNameField(row) {
  const form = document.createElement("form");
  form.className = "product-name-editor";
  const label = document.createElement("label");
  label.textContent = isVariationProduct(row) ? "Nome da variação" : "Nome do produto";
  const input = document.createElement("input");
  input.type = "text";
  input.value = productTitle(row);
  input.required = true;
  input.maxLength = 160;
  input.setAttribute("aria-label", label.textContent);
  label.append(input);
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "ghost-light-button";
  save.textContent = "Salvar nome";
  save.disabled = true;
  input.addEventListener("input", () => {
    save.disabled = !input.value.trim() || input.value.trim() === productTitle(row);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") { input.value = productTitle(row); save.disabled = true; input.blur(); }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    input.disabled = true;
    try {
      const payload = await api("/api/products/rename", { method: "POST", body: JSON.stringify({ rowNumber: row.rowNumber, name: input.value.trim() }) });
      const index = state.rows.findIndex(item => item.rowNumber === row.rowNumber);
      if (state.activeSheet === "produtos" && index >= 0) state.rows[index] = payload.row;
      setStatus("Nome atualizado", "ok");
      render();
    } catch (error) {
      setStatus(error.message, "error");
      save.disabled = false;
      input.disabled = false;
    }
  });
  const actions = document.createElement('div');actions.className = 'product-identity-actions';actions.append(save);
  form.append(label, actions);
  return form;
}

function renderProductVariations(parentRow, variations, selectedRow) {
  const panel = document.createElement("div");
  panel.className = "variation-strip";
  const label = document.createElement("span");
  label.textContent = "Selecionar versão";
  panel.append(label);

  const originalButton = document.createElement("button");
  originalButton.className = `variation-chip${selectedRow.rowNumber === parentRow.rowNumber ? " active" : ""}`;
  originalButton.type = "button";
  originalButton.innerHTML = `<strong>Original</strong><small>${escapeHtml(productSku(parentRow) || productTitle(parentRow))}</small>`;
  originalButton.addEventListener("click", () => selectProductVersion(parentRow, parentRow));
  panel.append(originalButton);

  variations.forEach((variation) => {
    const button = document.createElement("button");
    button.className = `variation-chip${selectedRow.rowNumber === variation.rowNumber ? " active" : ""}`;
    button.type = "button";
    button.title = "Usar esta variação nos cálculos e anúncios deste painel";
    button.innerHTML = `<strong>${escapeHtml(productTitle(variation))}</strong><small>${escapeHtml(productSku(variation) || "Sem SKU")}</small>`;
    button.addEventListener("click", () => selectProductVersion(parentRow, variation));
    panel.append(button);
  });

  return panel;
}

function renderProductNotesPanel(row, key) {
  const panel = document.createElement("div");
  panel.className = "product-section-panel notes-panel";
  const localData = getProductLocalData(row);

  const field = document.createElement("label");
  field.className = "field wide notes-field";
  field.innerHTML = `
    <span>Observações do produto</span>
    <textarea data-product-notes placeholder="Observações...">${escapeHtml(localData.productNotes || "")}</textarea>
  `;

  const textarea = field.querySelector("[data-product-notes]");
  textarea.addEventListener("input", () => {
    const next = {
      ...localData,
      ...state.productCosts[key],
      productNotes: textarea.value
    };
    queueProductLocalAutosave(key, next, "Observações salvas automaticamente");
  });

  panel.append(field);
  return panel;
}

function renderUnitCostCalculator(row, key) {
  const panel = document.createElement("div");
  panel.className = "product-section-panel";
  const cost = getCostDraft(row);
  const result = calculateUnitCost(cost);
  const breakdownOpen = state.openBreakdown.has(key);

  const header = document.createElement("div");
  header.className = "cost-header";

  const total = document.createElement("div");
  total.innerHTML = `<span class="cell-label">Valor unitário do item</span><strong data-unit-cost="true">${escapeHtml(result.unitTotal > 0 ? formatMoney(result.unitTotal) : "Preencha os dados")}</strong>`;

  const explanationButton = document.createElement("button");
  explanationButton.className = "cost-toggle";
  explanationButton.type = "button";
  explanationButton.textContent = `${breakdownOpen ? "⌄" : "›"} Por que custa isso`;
  explanationButton.addEventListener("click", () => {
    breakdownOpen ? state.openBreakdown.delete(key) : state.openBreakdown.add(key);
    render();
  });

  header.append(total, explanationButton);
  panel.append(header);

  if (breakdownOpen) {
    panel.append(renderCostBreakdown(result, true));
  }

  const editor = document.createElement('details'); editor.className = 'product-cost-disclosure';
  const summary = document.createElement('summary');summary.textContent = 'Editar custos e materiais';
  editor.append(summary);
  state.openProductCostEditors ||= new Set();
  editor.open = state.openProductCostEditors.has(key);
  let mounted = false;
  const mount = () => { if(!mounted) {editor.append(renderCostTabs(row,key,cost,result));mounted = true;} };
  if(editor.open) mount();
  editor.addEventListener('toggle',()=>{
    if(editor.open) {state.openProductCostEditors.add(key);mount();}
    else state.openProductCostEditors.delete(key);
  });
  panel.append(editor);
  return panel;
}

function driveModelDownloadUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.pathname.includes("/folders/")) return "";
    const id = url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || url.searchParams.get("id");
    if (!id || !/^[\w-]+$/.test(id)) return "";
    const download = new URL("https://drive.google.com/uc");
    download.searchParams.set("export", "download");
    download.searchParams.set("id", id);
    if (url.searchParams.has("resourcekey")) download.searchParams.set("resourcekey", url.searchParams.get("resourcekey"));
    return download.href;
  } catch { return ""; }
}

function renderNewProductForm(row) {
  const form = document.createElement("form");
  form.className = "product-form";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveRow("produtos", null, readForm(form), form.querySelector("[data-save]"));
  });

  if (state.draftMeta?.type === "variation") {
    const note = document.createElement("div");
    note.className = "variation-draft-note";
    note.textContent = `Variação de ${state.draftMeta.sourceName}`;
    form.append(note);
  }

  const grid = document.createElement("div");
  grid.className = "form-grid";
  state.headers.forEach((header) => {
    if (["Lucro recebido", "Foto", "Valor de venda", "Valor que recebe", "Orçamento PDF", "Status"].includes(header)) return;
    const field = createInput("produtos", header, valueOf(row, header));
    if (header === "STL/3MF") {
      const input = field.querySelector("input");
      field.querySelector("label").textContent = "Modelo STL/3MF (link do Google Drive)";
      input.setAttribute("aria-label", "Modelo STL/3MF (link do Google Drive)");
      input.placeholder = "https://drive.google.com/file/d/.../view";
      const download = document.createElement("a");
      download.className = "model-download-button";
      download.textContent = "Baixar modelo";
      download.target = "_blank";
      download.rel = "noopener noreferrer";
      const updateLink = () => {
        const url = driveModelDownloadUrl(input.value);
        input.setCustomValidity(input.value.trim() && !url ? "Informe o link de um arquivo do Google Drive, não de uma pasta." : "");
        download.hidden = !url;
        if (url) download.href = url;
        else download.removeAttribute("href");
      };
      input.addEventListener("input", updateLink);
      updateLink();
      field.append(download);
    }
    grid.append(field);
  });
  form.append(grid);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const cancelButton = document.createElement("button");
  cancelButton.className = "danger-button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => deleteRow("produtos", null));
  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "submit";
  saveButton.dataset.save = "true";
  saveButton.textContent = "Criar produto";
  actions.append(cancelButton, saveButton);
  form.append(actions);

  return form;
}

function renderCostBreakdown(result, live = false) {
  const breakdown = document.createElement("div");
  breakdown.className = "cost-breakdown";
  if (live) {
    breakdown.dataset.costBreakdown = "true";
  }
  const rows = [
    ["Material por item", result.materialUnit],
    ["Depreciação por item", result.depreciationUnit],
    ["Energia por item", result.energyUnit],
    ["Outros por item", result.otherUnit],
    ["Total do lote", result.batchTotal]
  ];

  rows.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(formatMoney(value))}</strong>`;
    breakdown.append(item);
  });

  return breakdown;
}

function renderCostTabs(row, key, cost, result) {
  const activeTab = state.activeCostTabs[key] || "material";
  const wrapper = document.createElement("div");
  wrapper.className = "cost-editor";
  const nav = document.createElement("div");
  nav.className = "cost-tabs";

  COST_TABS.forEach((tab) => {
    const button = document.createElement("button");
    button.className = `cost-tab${tab.id === activeTab ? " active" : ""}`;
    button.type = "button";
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      state.activeCostTabs[key] = tab.id;
      render();
    });
    nav.append(button);
  });

  const activeConfig = COST_TABS.find((tab) => tab.id === activeTab) || COST_TABS[0];
  const form = document.createElement("form");
  form.className = "cost-form";
  const readCostFromForm = () => {
    const next = { ...cost, ...state.productCosts[key], ...readForm(form) };
    return activeTab === "material" ? withMaterialRows(next, readMaterialRows(form)) : next;
  };
  const handleCostUpdate = () => {
    const next = readCostFromForm();
    renderLiveCostPreview(wrapper, calculateUnitCost(next));
    queueProductLocalAutosave(key, next, "Cálculo local salvo automaticamente");
  };
  form.addEventListener("input", handleCostUpdate);
  form.addEventListener("change", handleCostUpdate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProductCost(key, readCostFromForm(), form.querySelector("[data-save-cost]"));
  });

  const grid = document.createElement("div");
  grid.className = "form-grid cost-grid";

  if (activeTab === "material") {
    grid.append(renderMaterialRowsField(key, cost, form));
    grid.append(createCostInput("quantity", "Quantidade feita no lote", "un", cost.quantity));
  } else {
    activeConfig.fields.forEach(([name, label, suffix]) => {
      grid.append(createCostInput(name, label, suffix, cost[name]));
    });
  }

  if (activeTab === "other") {
    grid.append(createCostTextarea("notes", "Observações do cálculo", cost.notes));
  }

  form.append(grid);

  const preview = document.createElement("div");
  preview.className = "cost-preview";
  preview.dataset.costPreview = "true";
  preview.append(...buildCostPreviewItems(result));

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "submit";
  saveButton.dataset.saveCost = "true";
  saveButton.textContent = "Salvar cálculo local";
  actions.append(saveButton);

  wrapper.append(nav, form, preview, actions);
  return wrapper;
}

function readMaterialRows(form, options = {}) {
  const { keepEmpty = false } = options;
  const rows = [];
  form.querySelectorAll("[data-material-row]").forEach((row) => {
    rows.push({
      name: row.querySelector("[data-material-name]")?.value || "",
      kgPrice: row.querySelector("[data-material-kg-price]")?.value || "",
      usedGrams: row.querySelector("[data-material-used-grams]")?.value || ""
    });
  });
  if (keepEmpty) return rows;
  return rows.filter((material) => material.name || material.kgPrice || material.usedGrams);
}

function renderMaterialRowsField(key, cost, form) {
  const wrapper = document.createElement("div");
  wrapper.className = "field wide material-field";

  const header = document.createElement("div");
  header.className = "material-field-header";
  header.innerHTML = `
    <div>
      <span>Materiais usados no lote</span>
      <small>Use uma linha para cada filamento/cor do AMS.</small>
    </div>
  `;

  const addButton = document.createElement("button");
  addButton.className = "icon-add-button";
  addButton.type = "button";
  addButton.title = "Adicionar outro material";
  addButton.textContent = "+";
  addButton.addEventListener("click", () => {
    const current = { ...cost, ...state.productCosts[key], ...readForm(form) };
    const next = withMaterialRows(current, [
      ...readMaterialRows(form, { keepEmpty: true }),
      emptyMaterialRow()
    ]);
    queueProductLocalAutosave(key, next, "Cálculo local salvo automaticamente");
    render();
  });
  header.append(addButton);
  wrapper.append(header);

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "material-rows";

  normalizeMaterialRows(cost).forEach((material, index, rows) => {
    const row = document.createElement("div");
    row.className = "material-row";
    row.dataset.materialRow = "true";
    row.innerHTML = `
      <label>
        <span>Material/cor</span>
        <input data-material-name value="${escapeHtml(material.name)}" placeholder="Ex: PLA branco" />
      </label>
      <label>
        <span>Valor do kg</span>
        <div class="input-with-suffix">
          <input data-material-kg-price inputmode="decimal" value="${escapeHtml(material.kgPrice)}" />
          <span>R$</span>
        </div>
      </label>
      <label>
        <span>Usado no lote</span>
        <div class="input-with-suffix">
          <input data-material-used-grams inputmode="decimal" value="${escapeHtml(material.usedGrams)}" />
          <span>g</span>
        </div>
      </label>
    `;

    const removeButton = document.createElement("button");
    removeButton.className = "icon-remove-button";
    removeButton.type = "button";
    removeButton.title = rows.length === 1 ? "Limpar material" : "Remover material";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      const current = { ...cost, ...state.productCosts[key], ...readForm(form) };
      const currentRows = readMaterialRows(form, { keepEmpty: true });
      const nextRows = currentRows.filter((_, currentIndex) => currentIndex !== index);
      const next = withMaterialRows(current, nextRows.length ? nextRows : [emptyMaterialRow()]);
      queueProductLocalAutosave(key, next, "Cálculo local salvo automaticamente");
      render();
    });
    row.append(removeButton);
    rowsWrap.append(row);
  });

  wrapper.append(rowsWrap);
  return wrapper;
}

function createCostInput(name, label, suffix, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  const line = document.createElement("div");
  line.className = "input-with-suffix";
  const input = document.createElement("input");
  input.name = name;
  input.inputMode = "decimal";
  input.value = value || "";
  const suffixElement = document.createElement("span");
  suffixElement.textContent = suffix;
  line.append(input, suffixElement);
  wrapper.append(labelElement, line);
  return wrapper;
}

function createCostTextarea(name, label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "field wide";
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.name = name;
  textarea.value = value || "";
  wrapper.append(labelElement, textarea);
  return wrapper;
}

function buildCostPreviewItems(result) {
  const items = [
    ["Material", result.materialTotal],
    ["Depreciação", result.depreciationTotal],
    ["Energia", result.energyTotal],
    ["Outros", result.otherTotal]
  ];

  return items.map(([label, value]) => {
    const item = document.createElement("div");
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(formatMoney(value))}</strong>`;
    return item;
  });
}

function renderLiveCostPreview(wrapper, result) {
  const panel = wrapper.closest(".product-details") || document;
  const unitCost = panel.querySelector("[data-unit-cost]");
  if (unitCost) {
    unitCost.textContent = result.unitTotal > 0 ? formatMoney(result.unitTotal) : "Preencha os dados";
  }

  const preview = wrapper.querySelector("[data-cost-preview]");
  if (preview) {
    preview.replaceChildren(...buildCostPreviewItems(result));
  }

  const breakdown = panel.querySelector("[data-cost-breakdown]");
  if (breakdown) {
    breakdown.replaceChildren(...Array.from(renderCostBreakdown(result).children));
  }
}

async function saveProductCost(key, data, button) {
  await persistProductLocalData(key, data, {
    button,
    successMessage: "Cálculo local salvo",
    errorButtonText: "Salvar cálculo local",
    renderAfter: true
  });
}

function renderShopeeListingsPanel(row, key) {
  const panel = document.createElement("div");
  panel.className = "product-section-panel shopee-panel";
  const localData = getProductLocalData(row);
  const unitCost = calculateUnitCost(localData).unitTotal;
  const listings = getShopeeListings(row);
  const feeSettings = getShopeeFeeSettings(localData);
  const formulaLabel = shopeeFormulaLabel(feeSettings);
  const settingsOpen = state.openShopeeSettings.has(key);

  const header = document.createElement("div");
  header.className = "shopee-header";
  header.innerHTML = `
    <div>
      <span class="cell-label">Base de cálculo</span>
      <strong>${escapeHtml(unitCost > 0 ? `${formatMoney(unitCost)} por unidade` : "Defina o valor unitário na calculadora")}</strong>
    </div>
  `;

  const addButton = document.createElement("button");
  addButton.className = "cost-toggle";
  addButton.type = "button";
  addButton.textContent = "Adicionar anúncio";
  addButton.addEventListener("click", () => {
    const listingForm = panel.querySelector(".shopee-form");
    const currentListings = listingForm ? readShopeeListingsForm(listingForm) : listings;
    const next = [
      ...currentListings,
      { name: `Kit com ${currentListings.length + 1} unidades`, units: String(currentListings.length + 1), salePrice: "", receivedAmount: "", receivedManual: "", extras: [] }
    ];
    state.productCosts[key] = {
      ...localData,
      ...state.productCosts[key],
      shopeeActive: productAdActiveValue(row),
      shopeeFeeFixed: listingForm?.querySelector("[data-shopee-fee-fixed]")?.value || localData.shopeeFeeFixed || COST_DEFAULTS.shopeeFeeFixed,
      shopeeFeePercent: listingForm?.querySelector("[data-shopee-fee-percent]")?.value || localData.shopeeFeePercent || COST_DEFAULTS.shopeeFeePercent,
      shopeeListings: next
    };
    queueProductLocalAutosave(key, state.productCosts[key], "Anúncios salvos automaticamente");
    render();
  });
  const settingsButton = document.createElement("button");
  settingsButton.className = "icon-settings-button";
  settingsButton.type = "button";
  settingsButton.dataset.shopeeFormulaTitle = "true";
  settingsButton.title = `${formulaLabel}. Clique para mudar as taxas.`;
  settingsButton.textContent = "⚙";
  settingsButton.addEventListener("click", () => {
    toggleShopeeSettings(key);
  });

  const headerActions = document.createElement("div");
  headerActions.className = "shopee-header-actions";
  headerActions.append(settingsButton, addButton);
  header.append(headerActions);
  const form = document.createElement("form");
  form.className = "shopee-form";
  const handleShopeeUpdate = (event) => {
    const currentFeeSettings = readShopeeFeeSettingsForm(form, localData);
    updateShopeeAutoReceived(event.target, currentFeeSettings);
    updateShopeeAutoReceivedAfterFeeChange(event.target, form, currentFeeSettings);
    const next = readShopeeListingsForm(form);
    const updated = {
      ...localData,
      ...state.productCosts[key],
      shopeeActive: productAdActiveValue(row),
      shopeeFeeFixed: form.querySelector("[data-shopee-fee-fixed]")?.value || localData.shopeeFeeFixed || COST_DEFAULTS.shopeeFeeFixed,
      shopeeFeePercent: form.querySelector("[data-shopee-fee-percent]")?.value || localData.shopeeFeePercent || COST_DEFAULTS.shopeeFeePercent,
      shopeeListings: next
    };
    setProductLocalData(key, updated);
    renderShopeeComputedCells(form, unitCost);
    updateShopeeFormulaLabels(form, currentFeeSettings);
    queueProductLocalAutosave(key, updated, "Anúncios salvos automaticamente");
  };
  form.addEventListener("input", handleShopeeUpdate);
  form.addEventListener("change", handleShopeeUpdate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveShopeeListings(
      key,
      {
        ...localData,
        ...state.productCosts[key],
        shopeeActive: productAdActiveValue(row),
        shopeeFeeFixed: form.querySelector("[data-shopee-fee-fixed]")?.value || localData.shopeeFeeFixed || COST_DEFAULTS.shopeeFeeFixed,
        shopeeFeePercent: form.querySelector("[data-shopee-fee-percent]")?.value || localData.shopeeFeePercent || COST_DEFAULTS.shopeeFeePercent,
        shopeeListings: readShopeeListingsForm(form)
      },
      form.querySelector("[data-save-shopee]")
    );
  });

  if (settingsOpen) {
    form.append(renderShopeeSettings(localData, formulaLabel));
  }

  panel.append(header);

  const table = document.createElement("table");
  table.className = "shopee-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Anúncio</th>
        <th>Unidades</th>
        <th>Vendido por</th>
        <th data-shopee-formula-title title="${escapeHtml(formulaLabel)}">Recebo da Shopee</th>
        <th>Adicionais</th>
        <th>Custo</th>
        <th>Taxas</th>
        <th>Lucro real</th>
        <th>Margem</th>
        <th></th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  listings.forEach((listing, index) => {
    tbody.append(renderShopeeListingRow(listing, index, unitCost, listings.length, key, feeSettings));
  });
  table.append(tbody);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap shopee-table-wrap";
  wrap.append(table);
  form.append(wrap);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "submit";
  saveButton.dataset.saveShopee = "true";
  saveButton.textContent = "Salvar anúncios localmente";
  actions.append(saveButton);
  form.append(actions);

  panel.append(form);
  return panel;
}

function renderShopeeSettings(localData, formulaLabel) {
  const settings = document.createElement("div");
  settings.className = "shopee-settings";
  settings.innerHTML = `
    <div class="field">
      <label>Taxa fixa Shopee</label>
      <div class="input-with-suffix">
        <input data-shopee-fee-fixed inputmode="decimal" value="${escapeHtml(localData.shopeeFeeFixed || COST_DEFAULTS.shopeeFeeFixed)}" />
        <span>R$</span>
      </div>
    </div>
    <div class="field">
      <label>Percentual Shopee</label>
      <div class="input-with-suffix">
        <input data-shopee-fee-percent inputmode="decimal" value="${escapeHtml(localData.shopeeFeePercent || COST_DEFAULTS.shopeeFeePercent)}" />
        <span>%</span>
      </div>
    </div>
    <div class="shopee-formula-note" data-shopee-formula-note>${escapeHtml(formulaLabel)}</div>
  `;
  return settings;
}

function toggleShopeeSettings(key) {
  if (state.openShopeeSettings.has(key)) {
    state.openShopeeSettings.delete(key);
  } else {
    state.openShopeeSettings.add(key);
  }
  render();
}

function toggleShopeeExtraMenu(productStorageKey, index) {
  const menuKey = `${productStorageKey}:${index}`;
  if (state.openShopeeExtraMenus.has(menuKey)) {
    state.openShopeeExtraMenus.delete(menuKey);
  } else {
    state.openShopeeExtraMenus.add(menuKey);
  }
  render();
}

function saveShopeeListingsFromRowButton(row, productStorageKey, listings, message = "Anúncios salvos automaticamente") {
  state.productCosts[productStorageKey] = {
    ...state.productCosts[productStorageKey],
    shopeeListings: listings
  };
  queueProductLocalAutosave(productStorageKey, state.productCosts[productStorageKey], message);
  render();
}

function readShopeeFeeSettingsForm(form, fallbackData) {
  const fixedInput = form.querySelector("[data-shopee-fee-fixed]");
  const percentInput = form.querySelector("[data-shopee-fee-percent]");

  return getShopeeFeeSettings({
    shopeeFeeFixed: fixedInput?.value || fallbackData.shopeeFeeFixed || COST_DEFAULTS.shopeeFeeFixed,
    shopeeFeePercent: percentInput?.value || fallbackData.shopeeFeePercent || COST_DEFAULTS.shopeeFeePercent
  });
}

function updateShopeeAutoReceived(target, settings) {
  if (!target || target.dataset.field === "receivedAmount") {
    const row = target?.closest("tr");
    const manualInput = row?.querySelector('[data-field="receivedManual"]');
    if (manualInput) manualInput.value = "true";
    return;
  }

  if (target.dataset.field !== "salePrice") return;

  const row = target.closest("tr");
  const receivedInput = row?.querySelector('[data-field="receivedAmount"]');
  const manualInput = row?.querySelector('[data-field="receivedManual"]');
  const salePrice = parseOptionalNumber(target.value);
  const received = calculateShopeeReceived(salePrice, settings);

  if (receivedInput) {
    receivedInput.value = formatInputMoney(received);
  }

  if (manualInput) {
    manualInput.value = "";
  }
}

function updateShopeeAutoReceivedAfterFeeChange(target, form, settings) {
  if (!target?.matches("[data-shopee-fee-fixed], [data-shopee-fee-percent]")) return;

  form.querySelectorAll("tbody tr").forEach((row) => {
    const manualInput = row.querySelector('[data-field="receivedManual"]');
    if (manualInput?.value === "true") return;

    const saleInput = row.querySelector('[data-field="salePrice"]');
    const receivedInput = row.querySelector('[data-field="receivedAmount"]');
    const salePrice = parseOptionalNumber(saleInput?.value);
    const received = calculateShopeeReceived(salePrice, settings);

    if (receivedInput) {
      receivedInput.value = formatInputMoney(received);
    }
  });
}

function renderShopeeListingRow(listing, index, unitCost, totalListings, productStorageKey, feeSettings) {
  const row = document.createElement("tr");
  row.dataset.listingIndex = String(index);
  const displayListing = { ...listing };
  const salePrice = parseOptionalNumber(displayListing.salePrice);
  if (!displayListing.receivedAmount && displayListing.receivedManual !== "true" && Number.isFinite(salePrice)) {
    displayListing.receivedAmount = formatInputMoney(calculateShopeeReceived(salePrice, feeSettings));
  }
  const result = calculateShopeeListing(displayListing, unitCost);
  const formulaLabel = shopeeFormulaLabel(feeSettings);
  const extras = getListingExtras(displayListing);
  const extraMenuOpen = state.openShopeeExtraMenus.has(`${productStorageKey}:${index}`);
  const extrasMarkup = extras.map((extra, extraIndex) => `
    <div class="extra-item">
      <span>${escapeHtml(extra.type === "gift" ? "Brinde" : "Adicional")}</span>
      <input class="table-input extra-name-input" data-extra-index="${extraIndex}" data-extra-field="name" placeholder="O que é?" value="${escapeHtml(extra.name)}" />
      <input class="table-input extra-cost-input" data-extra-index="${extraIndex}" data-extra-field="cost" inputmode="decimal" placeholder="R$ 0,00" value="${escapeHtml(extra.cost)}" />
      <input type="hidden" data-extra-index="${extraIndex}" data-extra-field="type" value="${escapeHtml(extra.type)}" />
      <button class="extra-remove-button" data-extra-remove="${extraIndex}" type="button" title="Remover adicional">×</button>
    </div>
  `).join("");

  row.innerHTML = `
    <td><input class="table-input" data-field="name" value="${escapeHtml(displayListing.name)}" /></td>
    <td><input class="table-input units-input" data-field="units" inputmode="decimal" value="${escapeHtml(displayListing.units)}" /></td>
    <td><input class="table-input compact-input money-input" data-field="salePrice" inputmode="decimal" value="${escapeHtml(displayListing.salePrice)}" /></td>
    <td>
      <div class="received-input-wrap">
        <input class="table-input compact-input money-input" data-field="receivedAmount" inputmode="decimal" value="${escapeHtml(displayListing.receivedAmount)}" />
        <button class="mini-info-button" data-shopee-formula-title type="button" title="${escapeHtml(formulaLabel)}. Clique para mudar as taxas.">i</button>
      </div>
      <input type="hidden" data-field="receivedManual" value="${escapeHtml(displayListing.receivedManual)}" />
    </td>
    <td>
      <div class="extras-cell">
        <button class="extra-add-button" type="button" title="Adicionar brinde ou outro adicional">+</button>
        ${extraMenuOpen ? `
          <div class="extra-menu">
            <button class="extra-option-button" type="button">Brinde</button>
          </div>
        ` : ""}
        ${extrasMarkup || `<span class="extra-empty">Nenhum</span>`}
      </div>
    </td>
    <td data-computed="cost">${escapeHtml(result.costLabel)}</td>
    <td data-computed="fees">${escapeHtml(result.feesLabel)}</td>
    <td data-computed="profit" class="${result.profitClass}">${escapeHtml(result.profitLabel)}</td>
    <td data-computed="margin">${escapeHtml(result.marginLabel)}</td>
  `;

  row.querySelector(".mini-info-button").addEventListener("click", () => {
    toggleShopeeSettings(productStorageKey);
  });
  row.querySelector(".extra-add-button").addEventListener("click", () => {
    toggleShopeeExtraMenu(productStorageKey, index);
  });
  row.querySelector(".extra-option-button")?.addEventListener("click", () => {
    const form = row.closest("form");
    if (!form) return;
    const listings = readShopeeListingsForm(form);
    listings[index].extras = [...(listings[index].extras || []), { type: "gift", name: "", cost: "" }];
    state.openShopeeExtraMenus.delete(`${productStorageKey}:${index}`);
    saveShopeeListingsFromRowButton(row, productStorageKey, listings);
  });
  row.querySelectorAll("[data-extra-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = row.closest("form");
      if (!form) return;
      const listings = readShopeeListingsForm(form);
      const extraIndex = Number(button.dataset.extraRemove);
      listings[index].extras = (listings[index].extras || []).filter((_, itemIndex) => itemIndex !== extraIndex);
      saveShopeeListingsFromRowButton(row, productStorageKey, listings);
    });
  });

  const actionCell = document.createElement("td");
  const removeButton = document.createElement("button");
  removeButton.className = "danger-button small-button";
  removeButton.type = "button";
  removeButton.textContent = "Remover";
  removeButton.disabled = totalListings <= 1;
  removeButton.addEventListener("click", () => {
    const form = row.closest("form");
    if (!form) return;
    const next = readShopeeListingsForm(form).filter((_, rowIndex) => rowIndex !== index);
    saveShopeeListingsFromRowButton(row, productStorageKey, next);
  });
  actionCell.append(removeButton);
  row.append(actionCell);

  return row;
}

function calculateShopeeListing(listing, unitCost) {
  const units = Math.max(parseLocaleNumber(listing.units) || 0, 0);
  const salePrice = parseOptionalNumber(listing.salePrice);
  const receivedAmount = parseOptionalNumber(listing.receivedAmount);
  const extrasCost = getListingExtras(listing).reduce((total, extra) => {
    return total + Math.max(parseOptionalNumber(extra.cost) || 0, 0);
  }, 0);
  const cost = (unitCost > 0 ? unitCost * units : 0) + extrasCost;
  const fees = Number.isFinite(salePrice) && Number.isFinite(receivedAmount)
    ? salePrice - receivedAmount
    : NaN;
  const hasCostBase = (unitCost > 0 && units > 0) || extrasCost > 0;
  const profit = Number.isFinite(receivedAmount) && hasCostBase
    ? receivedAmount - cost
    : NaN;
  const margin = Number.isFinite(profit) && Number.isFinite(receivedAmount) && receivedAmount > 0
    ? profit / receivedAmount
    : NaN;

  return {
    costLabel: hasCostBase ? formatMoney(cost) : "-",
    feesLabel: Number.isFinite(fees) ? formatMoney(fees) : "-",
    profitLabel: Number.isFinite(profit) ? formatMoney(profit) : "-",
    marginLabel: Number.isFinite(margin) ? formatPercent(margin) : "-",
    profitClass: Number.isFinite(profit) && profit < 0 ? "negative-money" : "positive-money"
  };
}

function readShopeeListingsForm(form) {
  return [...form.querySelectorAll("tbody tr")].map((row) => {
    const data = {};
    row.querySelectorAll("[data-field]").forEach((input) => {
      data[input.dataset.field] = input.value.trim();
    });
    const extras = [];
    row.querySelectorAll("[data-extra-field]").forEach((input) => {
      const index = Number(input.dataset.extraIndex);
      if (!Number.isFinite(index)) return;
      extras[index] = {
        ...(extras[index] || { type: "gift", name: "", cost: "" }),
        [input.dataset.extraField]: input.value.trim()
      };
    });
    data.extras = extras.filter(Boolean).map((extra) => ({
      type: extra.type || "gift",
      name: extra.name || "",
      cost: extra.cost || ""
    }));
    return data;
  });
}

function renderShopeeComputedCells(form, unitCost) {
  const listings = readShopeeListingsForm(form);
  form.querySelectorAll("tbody tr").forEach((row, index) => {
    const listing = listings[index] || {};
    const result = calculateShopeeListing(listing, unitCost);
    row.querySelector('[data-computed="cost"]').textContent = result.costLabel;
    row.querySelector('[data-computed="fees"]').textContent = result.feesLabel;
    const profitCell = row.querySelector('[data-computed="profit"]');
    profitCell.textContent = result.profitLabel;
    profitCell.className = result.profitClass;
    row.querySelector('[data-computed="margin"]').textContent = result.marginLabel;
  });
}

function updateShopeeFormulaLabels(form, settings) {
  const label = shopeeFormulaLabel(settings);
  const panel = form.closest(".shopee-panel") || form;

  panel.querySelectorAll("[data-shopee-formula-title]").forEach((element) => {
    element.title = element.classList.contains("icon-settings-button") || element.classList.contains("mini-info-button")
      ? `${label}. Clique para mudar as taxas.`
      : label;
  });

  panel.querySelectorAll("[data-shopee-formula-note]").forEach((element) => {
    element.textContent = label;
  });
}

async function saveShopeeListings(key, data, button) {
  await persistProductLocalData(key, data, {
    button,
    successMessage: "Anúncios Shopee salvos",
    errorButtonText: "Salvar anúncios localmente",
    renderAfter: true
  });
}

function renderProducts() {
  const rows = filteredRows();
  elements.content.replaceChildren();

  if (state.draft) {
    elements.content.append(renderProductCard(state.draft, true));
  }

  rows.forEach((row) => elements.content.append(renderProductCard(row)));

  if (!rows.length && !state.draft) {
    elements.content.append(elements.emptyStateTemplate.content.cloneNode(true));
  }
}

function renderOrders() {
  const rows = filteredRows();
  elements.content.replaceChildren();

  if (state.draft) {
    elements.content.append(renderOrderCard(state.draft, true));
  }

  rows.forEach((row) => elements.content.append(renderOrderCard(row)));

  if (!rows.length && !state.draft) {
    elements.content.append(elements.emptyStateTemplate.content.cloneNode(true));
  }
}

function renderOrderCard(row, isDraft = false) {
  const config = SHEETS.encomendas;
  const rowKey = isDraft ? "draft-order" : String(row.rowNumber);
  const open = isDraft || state.expanded.has(rowKey);
  const card = document.createElement("article");
  card.className = "product-card order-card";

  const summary = document.createElement("div");
  summary.className = "order-summary";

  const chevron = document.createElement("button");
  chevron.className = "chevron";
  chevron.type = "button";
  chevron.title = open ? "Fechar detalhes" : "Abrir detalhes";
  chevron.textContent = open ? "⌄" : "›";
  chevron.addEventListener("click", () => {
    if (!isDraft) {
      if (open) {
        state.expanded.delete(rowKey);
        state.editingOrders.delete(rowKey);
      } else {
        state.expanded.add(rowKey);
      }
      render();
    }
  });
  summary.append(chevron);

  const title = document.createElement("div");
  title.className = "product-cell product-name";
  const primary = valueOf(row, "Nome da encomenda") || valueOf(row, "Encomenda") || (isDraft ? "Nova encomenda" : "Encomenda sem nome");
  const secondary = valueOf(row, config.secondary) || "Cliente não informado";
  title.innerHTML = `<strong>${escapeHtml(primary)}</strong><span>${escapeHtml(secondary)}</span>`;
  summary.append(title);

  config.summary.forEach((header) => {
    summary.append(renderOrderSummaryCell(row, header));
  });

  card.append(summary);

  if (open) {
    const editing = state.editingOrders.has(rowKey);
    card.append(isDraft || editing ? renderOrderForm(row, isDraft) : renderOrderDetailsPanel(row));
  }

  return card;
}

function renderOrderSummaryCell(row, header) {
  const cell = document.createElement("div");
  cell.className = "product-cell";
  const label = document.createElement("span");
  label.className = "cell-label";
  label.textContent = header;

  if (header === "Status do processo") {
    const status = valueOf(row, header) || "Parado";
    const pill = document.createElement("span");
    pill.className = `order-status ${orderStatusClass(status)}`;
    pill.textContent = status;
    cell.append(label, pill);
    return cell;
  }

  if (header === "Cancelado") {
    const canceled = /^sim$/i.test(String(valueOf(row, header) || ""));
    const pill = document.createElement("span");
    pill.className = `status-pill ${canceled ? "no" : "yes"}`;
    pill.textContent = canceled ? "Sim" : "Não";
    cell.append(label, pill);
    return cell;
  }

  const value = header === "Valor da encomenda"
    ? formatMoney(valueOf(row, header))
    : formatSummaryValue(header, valueOf(row, header));
  const output = document.createElement("span");
  output.className = "cell-value";
  output.textContent = value || "-";
  cell.append(label, output);
  return cell;
}

function orderStatusClass(status) {
  const normalized = normalizeText(status);
  if (normalized.includes("finalizado")) return "done";
  if (normalized.includes("andamento")) return "progress";
  return "stopped";
}

function orderDisplayValue(row, header) {
  const value = valueOf(row, header);
  if (header === "Valor da encomenda") return formatMoney(value);
  if (/^Data/i.test(header)) return formatDateDisplay(value);
  return value || "-";
}

function renderOrderDetailsPanel(row) {
  const panel = document.createElement("div");
  panel.className = "product-details order-details";

  const head = document.createElement("div");
  head.className = "order-details-head";
  const status = valueOf(row, "Status do processo") || "Parado";
  const canceled = /^sim$/i.test(String(valueOf(row, "Cancelado") || ""));
  head.innerHTML = `
    <div>
      <span class="cell-label">Resumo da encomenda</span>
      <strong>${escapeHtml(valueOf(row, "Nome da encomenda") || valueOf(row, "Encomenda") || "Encomenda sem nome")}</strong>
      <small>${escapeHtml(valueOf(row, "Cliente") || "Cliente não informado")}</small>
    </div>
    <div class="order-details-badges">
      <span class="order-status ${orderStatusClass(status)}">${escapeHtml(status)}</span>
      <span class="status-pill ${canceled ? "no" : "yes"}">${canceled ? "Cancelada" : "Ativa"}</span>
    </div>
  `;
  panel.append(head);

  const fields = [
    ["Produto/Itens", true],
    ["Data do pedido", false],
    ["Data de entrega", false],
    ["Quantidade da entrega", false],
    ["Valor da encomenda", false],
    ["Quantidade de itens", false],
    ["Canal de venda", false],
    ["Contato", false],
    ["Observações", true]
  ];

  const grid = document.createElement("div");
  grid.className = "order-info-grid";
  fields.forEach(([header, wide]) => {
    const item = document.createElement("div");
    item.className = `order-info-item${wide ? " wide" : ""}`;
    item.innerHTML = `<span>${escapeHtml(header)}</span><strong>${escapeHtml(orderDisplayValue(row, header))}</strong>`;
    grid.append(item);
  });
  panel.append(grid);

  const actions = document.createElement("div");
  actions.className = "row-actions order-view-actions";
  const editButton = document.createElement("button");
  editButton.className = "primary-button";
  editButton.type = "button";
  editButton.textContent = "Fazer alterações";
  editButton.addEventListener("click", () => {
    state.editingOrders.add(String(row.rowNumber));
    render();
  });
  actions.append(editButton);
  panel.append(actions);

  return panel;
}

function renderOrderForm(row, isDraft) {
  const form = document.createElement("form");
  form.className = "product-form order-form";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveRow("encomendas", isDraft ? null : row.rowNumber, readForm(form), form.querySelector("[data-save-order]"));
  });

  const grid = document.createElement("div");
  grid.className = "form-grid";
  const headers = state.headers.length ? state.headers : SHEETS.encomendas.headers;
  headers.forEach((header) => {
    grid.append(createInput("encomendas", header, valueOf(row, header)));
  });
  form.append(grid);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.type = "button";
  deleteButton.textContent = isDraft ? "Cancelar" : "Excluir";
  deleteButton.addEventListener("click", () => deleteRow("encomendas", isDraft ? null : row.rowNumber));

  if (!isDraft) {
    const cancelButton = document.createElement("button");
    cancelButton.className = "ghost-light-button";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar edição";
    cancelButton.addEventListener("click", () => {
      state.editingOrders.delete(String(row.rowNumber));
      render();
    });
    actions.append(cancelButton);
  }

  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "submit";
  saveButton.dataset.saveOrder = "true";
  saveButton.textContent = isDraft ? "Criar encomenda" : "Salvar encomenda";
  actions.append(deleteButton, saveButton);
  form.append(actions);

  return form;
}

function renderMachines() {
  elements.content.replaceChildren();
  const rows = state.draft ? [state.draft, ...filteredRows()] : filteredRows();
  if (!rows.length) {
    elements.content.append(elements.emptyStateTemplate.content.cloneNode(true));
    return;
  }
  rows.forEach((row) => {
    const data = normalizeMachineData(row.data || {});
    const isDraft = row.rowNumber === null;
    const rowKey = `machine:${row.rowNumber}`;
    const open = isDraft || state.expanded.has(rowKey);
    const card = document.createElement("article");
    card.className = "product-card machine-card";
    const summary = document.createElement("div");
    summary.className = "machine-summary";
    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "chevron";
    chevron.textContent = open ? "⌄" : "›";
    chevron.disabled = isDraft;
    chevron.setAttribute("aria-expanded", String(open));
    chevron.setAttribute("aria-label", open ? "Fechar informações da máquina" : "Ver informações da máquina");
    chevron.setAttribute("aria-controls", `machine-details-${row.rowNumber ?? "draft"}`);
    chevron.addEventListener("click", () => {
      if (open) {
        state.expanded.delete(rowKey);
        state.editingMachines.delete(String(row.rowNumber));
      } else state.expanded.add(rowKey);
      render();
    });
    const title = document.createElement("div");
    title.className = "product-cell product-name";
    title.innerHTML = `<strong>${escapeHtml(data["Nome da máquina"] || (isDraft ? "Nova máquina" : "Máquina sem nome"))}</strong><span>${escapeHtml(data.Modelo || "Modelo não informado")}</span>`;
    summary.append(chevron, title);
    const display = (header) => {
      const value = data[header];
      if (value === "" || value === undefined) return "Não informado";
      if (header === "Última manutenção") return formatDateDisplay(value);
      if (header === MACHINE_HEADERS[4] || header.startsWith("Horas ")) return `${formatNumber(machineNumber(value))} h`;
      if (MACHINE_HEADERS.slice(3).includes(header)) return `${formatMoney(value)}${header.includes("R$/h") ? "/h" : ""}`;
      return value;
    };
    ["Status", "Horas totais (h)", MACHINE_HEADERS[7]].forEach((header) => {
      const cell = document.createElement("div");
      cell.className = "product-cell";
      const label = document.createElement("span");
      label.className = "cell-label";
      label.textContent = header === MACHINE_HEADERS[7] ? "Custo por hora ligada" : header === "Horas totais (h)" ? "Total de horas de uso" : header;
      const value = document.createElement("span");
      value.className = header === "Status" ? `order-status ${data.Status === "Ativa" ? "done" : data.Status === "Em manutenção" ? "progress" : "stopped"}` : "cell-value";
      value.textContent = display(header);
      if (header === "Horas totais (h)") {
        cell.classList.add("machine-hours-summary");
        value.title = "Horas de uso da máquina";
      }
      cell.append(label, value);
      summary.append(cell);
    });
    card.append(summary);
    if (!isDraft) {
      const progress = maintenanceProgress(data);
      const maintenance = document.createElement('div'); maintenance.className = 'maintenance-summary';
      const label = document.createElement('strong'); label.textContent = progress.due ? 'Manutenção necessária · ciclo de 350 h atingido' : `Próxima manutenção em ${formatNumber(progress.remaining)} h`;
      const track = document.createElement('div'); track.className = 'maintenance-track'; track.setAttribute('role','progressbar'); track.setAttribute('aria-label','Ciclo de manutenção'); track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','350');track.setAttribute('aria-valuenow',String(Math.min(350,progress.hours)));
      const fill = document.createElement('div');fill.style.width=`${progress.percent}%`;fill.style.backgroundColor=`hsl(${210 * (1-progress.percent/100)} 65% 48%)`;track.append(fill);
      const info = document.createElement('small');info.textContent=`${formatNumber(progress.hours)} / 350 h · Última manutenção: ${data['Última manutenção'] ? formatDateDisplay(data['Última manutenção']) : 'Não informada'}`;
      maintenance.append(label,track,info);card.append(maintenance);
    }
    elements.content.append(card);
    if (!open) return;
    if (!isDraft && !state.editingMachines.has(String(row.rowNumber))) {
      const panel = document.createElement("div");
      panel.id = `machine-details-${row.rowNumber}`;
      panel.className = "product-details order-details";
      const details = document.createElement("div");
      details.className = "order-info-grid";
      MACHINE_HEADERS.filter(header => !["Horas iniciais (h)", "Horas registradas em produção (h)"].includes(header)).forEach((header) => {
        const item = document.createElement("div");
        item.className = "order-info-item";
        item.innerHTML = `<span>${escapeHtml(header === "Horas totais (h)" ? "Horas de uso" : header)}</span><strong>${escapeHtml(display(header))}</strong>`;
        details.append(item);
      });
      const actions = document.createElement("div");
      actions.className = "row-actions order-view-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "primary-button";
      edit.textContent = "Fazer alterações";
      edit.addEventListener("click", () => {
        state.editingMachines.add(String(row.rowNumber));
        render();
      });
      const serviced = document.createElement('button'); serviced.type='button';serviced.className='ghost-light-button';serviced.textContent='Registrar manutenção hoje';
      serviced.addEventListener('click',()=>saveRow('maquinas',row.rowNumber,{...row.data,'Última manutenção':todayInputValue(),_resetMaintenance:true},serviced));
      actions.append(edit,serviced);
      panel.append(details, actions);
      card.append(panel);
      return;
    }
    const form = document.createElement("form");
    form.id = `machine-details-${row.rowNumber ?? "draft"}`;
    form.className = "product-form order-form";
    const grid = document.createElement("div");
    grid.className = "form-grid";
    const inputs = {};
    [...MACHINE_HEADERS.slice(0, 7), "Horas de uso", "Última manutenção"].forEach((header, index) => {
      const field = createInput("maquinas", header, header === "Horas de uso" ? data["Horas totais (h)"] ?? "0" : data[header] ?? "");
      const input = field.querySelector("input, select");
      input.setAttribute("aria-label", header);
      if (index >= 3 && header !== "Última manutenção") {
        input.type = "text";
        input.inputMode = "decimal";
        input.placeholder = index === 4 ? "Ex.: 10000" : "0,00";
      }
      if (header === "Última manutenção") input.type = "date";
      inputs[header] = input;
      grid.append(field);
    });
    const result = document.createElement("div");
    result.className = "machine-result";
    result.setAttribute("aria-live", "polite");
    const formula = document.createElement("p");
    formula.className = "machine-formula";
    formula.textContent = "Custo por hora = (valor de aquisição + manutenção estimada na vida útil) ÷ vida útil em horas + custo de funcionamento por hora. Informe a manutenção total prevista para esse período.";
    const refresh = () => {
      Object.entries(inputs).forEach(([header, input]) => {
        input.setCustomValidity("");
        if (![...MACHINE_HEADERS.slice(3, 7), "Horas de uso"].includes(header) || !input.value.trim()) return;
        const value = machineNumber(input.value);
        if (!Number.isFinite(value) || value < 0 || (header === MACHINE_HEADERS[4] && value <= 0)) {
          input.setCustomValidity(header === MACHINE_HEADERS[4] ? "Informe uma vida útil maior que zero." : "Informe um número válido, igual ou maior que zero.");
        }
      });
      const total = calculateMachineCost(normalizeMachineData(readForm(form)));
      result.textContent = total === null
        ? "Custo total por hora: preencha o valor de aquisição e a vida útil com valores válidos."
        : `Custo total por hora ligada: ${formatMoney(total)}/h`;
    };
    form.addEventListener("input", refresh);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = row.rowNumber === null ? "Cancelar" : "Excluir";
    remove.addEventListener("click", () => deleteRow("maquinas", row.rowNumber));
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary-button";
    save.textContent = isDraft ? "Criar máquina" : "Salvar alterações";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      refresh();
      if (!form.reportValidity()) return;
      saveRow("maquinas", row.rowNumber, normalizeMachineData(readForm(form)), save);
    });
    if (!isDraft) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ghost-light-button";
      cancel.textContent = "Cancelar edição";
      cancel.addEventListener("click", () => {
        state.editingMachines.delete(String(row.rowNumber));
        render();
      });
      actions.append(cancel);
    }
    actions.append(remove, save);
    const hoursHelp = document.createElement("p");
    hoursHelp.className = "machine-formula";
    hoursHelp.textContent = "Informe as horas atuais da máquina. Produções finalizadas acrescentam automaticamente o tempo utilizado; produções em andamento não somam horas.";
    form.append(grid, hoursHelp, result, formula, actions);
    card.append(form);
    refresh();
  });
}

function renderProductStock() {
  elements.content.replaceChildren();
  const grid = document.createElement('div');grid.className='product-stock-grid';
  const term=elements.searchInput.value.trim().toLocaleLowerCase();
  const products=new Map();
  for(const product of state.stockProducts || []) {
    const sku=String(product.data.SKU || '').trim();
    if(sku && !products.has(sku)) products.set(sku,product.data.Produto || sku);
  }
  const hint=document.createElement('p');hint.className='machine-formula';hint.textContent='Informe a quantidade disponível de cada SKU. O estoque é atualizado manualmente.';elements.content.append(hint);
  for(const [sku,name] of products) {
    if(term && !`${sku} ${name}`.toLocaleLowerCase().includes(term)) continue;
    const existing=state.rows.find(row=>row.data.SKU===sku);
    const form=document.createElement('form');form.className='product-stock-card';
    const title=document.createElement('h3');title.textContent=name;
    const code=document.createElement('strong');code.className='stock-sku';code.textContent=sku;
    const label=document.createElement('label');label.className='field';label.textContent='Quantidade em estoque (un)';
    const input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.required=true;input.value=existing?.data.Quantidade ?? '0';label.append(input);
    const save=document.createElement('button');save.type='submit';save.className='primary-button';save.textContent='Salvar estoque';
    form.append(title,code,label,save);grid.append(form);
    form.addEventListener('submit',async event=>{event.preventDefault();const quantity=Number(input.value);if(!Number.isSafeInteger(quantity)||quantity<0){setStatus('Informe uma quantidade inteira maior ou igual a zero.','error');return;}await saveRow('productStock',existing?.rowNumber ?? null,{SKU:sku,Quantidade:String(quantity)},save);});
  }
  if(!grid.children.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent=term?'Nenhum SKU encontrado.':'Cadastre produtos com SKU na aba Produtos para informar o estoque.';grid.append(empty);}
  elements.content.append(grid);
}

function renderGenericTable() {
  const rows = filteredRows();
  elements.content.replaceChildren();

  if (!rows.length && !state.draft) {
    elements.content.append(elements.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = `table-wrap${state.activeSheet === 'filamentos' ? ' filament-stock-table' : ''}`;
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  [...state.headers, "Ações"].forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headRow.append(th);
  });

  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  const tableRows = state.draft ? [state.draft, ...rows] : rows;

  tableRows.forEach((row) => {
    const isDraft = row.rowNumber === null;
    const tr = document.createElement("tr");
    const inputs = {};

    state.headers.forEach((header) => {
      const td = document.createElement("td");
      const priority = state.activeSheet === 'filamentos' && header === 'Urgência de compra';
      const input = document.createElement(priority ? "select" : "input");
      if (priority) {
        input.append(new Option('Selecionar', ''));
        ['Baixa', 'Média', 'Alta'].forEach(level => input.append(new Option(level, `${level} Prioridade`)));
      }
      input.className = "table-input";
      input.name = header;
      if (!priority) input.type = guessInputType(header);
      input.value = valueOf(row, header);
      if (priority) {
        const original = valueOf(row, header);
        if (original && !input.value) {
          const match = /alta/i.test(original) ? 'Alta' : /m[eé]dia/i.test(original) ? 'Média' : /baixa|pouca/i.test(original) ? 'Baixa' : null;
          if (match) input.value = `${match} Prioridade`;
          else { input.append(new Option(original, original)); input.value = original; }
        }
        const color = () => { input.dataset.priority = /alta/i.test(input.value) ? 'high' : /m[eé]dia/i.test(input.value) ? 'medium' : input.value ? 'low' : ''; };
        input.addEventListener('change', color); color();
      }
      if (header === "Última manutenção") input.type = "date";
      inputs[header] = input;
      if(state.activeSheet === 'filamentos' && header === 'Custo médio por kg') {
        const currency = document.createElement('div'); currency.className = 'filament-currency';
        const prefix = document.createElement('span'); prefix.textContent = 'R$';
        input.inputMode = 'decimal'; input.setAttribute('aria-label','Custo médio por kg em reais');
        currency.append(prefix,input);td.append(currency);
      } else td.append(input);
      tr.append(td);
    });

    const actionTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger-button small-button";
    deleteButton.type = "button";
    deleteButton.textContent = isDraft ? "Cancelar" : "Excluir";
    deleteButton.addEventListener("click", () => deleteRow(state.activeSheet, isDraft ? null : row.rowNumber));
    const saveButton = document.createElement("button");
    saveButton.className = "small-button";
    saveButton.type = "button";
    saveButton.textContent = "Salvar";
    saveButton.addEventListener("click", () => {
      const data = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
      saveRow(state.activeSheet, isDraft ? null : row.rowNumber, data, saveButton);
    });
    actions.append(deleteButton, saveButton);
    actionTd.append(actions);
    tr.append(actionTd);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.append(table);
  elements.content.append(wrap);
}

function render() {
  const config = SHEETS[state.activeSheet];
  elements.viewTitle.textContent = config.title;
  elements.tabs.forEach((tab) => {
    const active = tab.dataset.sheet === state.activeSheet;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  elements.settingsButton?.classList.add("hidden");
  elements.addButton.classList.toggle("hidden",['painel','productStock'].includes(state.activeSheet));
  elements.searchInput.classList.toggle("hidden",state.activeSheet === "painel");
  elements.variationButton.classList.toggle("hidden", state.activeSheet !== "produtos");
  elements.addButton.textContent = state.activeSheet === "produtos"
    ? "Novo produto"
    : state.activeSheet === "encomendas"
      ? "Nova encomenda"
      : state.activeSheet === "maquinas"
        ? "Nova máquina"
        : state.activeSheet === "producao"
          ? "Nova produção"
          : "Adicionar linha";

  if (state.loading) {
    elements.content.innerHTML = `<div class="empty-state"><h2>Carregando...</h2><p>Buscando os dados locais.</p></div>`;
    return;
  }

  if (state.activeSheet === 'productStock') {
    renderProductStock();
  } else if (state.activeSheet === "painel") {
    renderMonthlyPanel({state,elements,formatMoney,formatNumber,todayInputValue});
  } else if (state.activeSheet === "produtos") {
    renderProducts();
  } else if (state.activeSheet === "encomendas") {
    renderOrders();
  } else if (state.activeSheet === "maquinas") {
    renderMachines();
  } else if (state.activeSheet === "producao") {
    renderProduction({ state, elements, escapeHtml, formatMoney, formatNumber, formatDateDisplay, productKey, render, saveRow, deleteRow, removeProductionItem, todayInputValue });
  } else if (state.activeSheet === 'filamentos') {
    if (state.filamentTab === 'stock') renderGenericTable();
    else elements.content.replaceChildren();
    const nav = document.createElement('div'); nav.className = 'product-section-tabs';
    [['stock','Estoque de filamentos'],['settings','Configurações de filamento']].forEach(([id,label])=>{
      const button = document.createElement('button'); button.type = 'button';
      button.className = `product-section-tab${state.filamentTab === id ? ' active' : ''}`; button.textContent = label;
      button.addEventListener('click',()=>{state.filamentTab = id; render();}); nav.append(button);
    });
    elements.content.prepend(nav);
    elements.addButton.classList.toggle('hidden',state.filamentTab === 'settings');
    elements.searchInput.classList.toggle('hidden',state.filamentTab === 'settings');
    if (state.filamentTab === 'settings') {
      const host = document.createElement('section'); elements.content.append(host);
      renderFilamentSettings(host, api, setStatus);
    }
  } else {
    renderGenericTable();
  }
}

async function loadConfig() {
  state.config = { mode: "local" };
  setStatus("Dados locais", "ok");
}

async function loadProductCosts() {
  const payload = await api("/api/product-costs");
  state.productCosts = mergeProductCosts(payload.costs || {}, readMirroredProductCosts());
  mirrorProductCosts();
}

async function loadSheet(sheet = state.activeSheet) {
  const requestId = state.loadRequestId + 1;
  state.loadRequestId = requestId;
  state.loading = true;
  render();

  try {
    const payload = await api(`/api/sheets?sheet=${encodeURIComponent(sheet === "painel" ? "producao" : sheet)}`);
    if(sheet === 'productStock') {
      const products = await api('/api/sheets?sheet=produtos');
      if(requestId !== state.loadRequestId) return;
      state.stockProducts = products.rows || [];
    }
    if (sheet === "painel") {
      const machines = await api("/api/sheets?sheet=maquinas");
      if (requestId !== state.loadRequestId) return;
      state.productionMachines = machines.rows || [];
    }
    if (sheet === "producao") {
      const products = await api("/api/sheets?sheet=produtos");
      const machines = await api("/api/sheets?sheet=maquinas");
      if (requestId !== state.loadRequestId) return;
      state.productionProducts = products.rows || [];
      state.productionMachines = machines.rows || [];
    }
    if (requestId !== state.loadRequestId) return;
    state.activeSheet = sheet;
    state.headers = payload.headers || [];
    state.rows = payload.rows || [];
    state.draft = null;
    state.loading = false;
    setStatus("Dados locais", "ok");
    render();
  } catch (error) {
    if (requestId !== state.loadRequestId) return;
    state.loading = false;
    state.headers = [];
    state.rows = [];
    state.draft = null;
    setStatus(error.message, "error");
    render();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.editingMachines.clear();
    state.editingProduction.clear();
    state.activeSheet = tab.dataset.sheet;
    state.expanded.clear();
    state.draft = null;
    state.draftMeta = null;
    loadSheet(state.activeSheet);
  });
});

elements.refreshButton.addEventListener("click", () => loadSheet(state.activeSheet));
elements.searchInput.addEventListener("input", render);
window.addEventListener("beforeunload", flushPendingProductAutosaves);
elements.variationButton.addEventListener("click", openVariationDialog);
elements.addButton.addEventListener("click", () => {
  const headers = state.headers.length ? state.headers : (SHEETS[state.activeSheet].headers || []);
  const data = Object.fromEntries(headers.map((header) => [header, ""]));
  if (state.activeSheet === "producao") data["Dia produção"] = todayInputValue();
  if (state.activeSheet === "encomendas") {
    if ("Data do pedido" in data) data["Data do pedido"] = todayInputValue();
    if ("Status do processo" in data) data["Status do processo"] = "Parado";
    if ("Cancelado" in data) data.Cancelado = "Não";
  }
  state.draft = { rowNumber: null, data };
  state.draftMeta = null;
  render();
});

elements.createVariationButton.addEventListener("click", () => {
  const sourceRow = getProductByRowNumber(elements.variationSource.value);
  if (!sourceRow) {
    setStatus("Escolha um produto original.", "error");
    return;
  }

  elements.variationDialog.close();
  startVariationDraft(sourceRow);
});

await loadConfig();
await loadProductCosts();
await loadSheet(state.activeSheet);
