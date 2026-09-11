// Opcional: coloque aqui uma senha curta e repita o mesmo valor no sistema local.
// Se ficar vazio, qualquer pessoa com a URL publicada do Web App poderá usar a API.
const SFL_API_TOKEN = "";

const CABECALHOS_ENCOMENDAS = [
  "Encomenda",
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
];

function doGet(e) {
  return SFL_responderJson_(SFL_executarApi_(e, null));
}

function doPost(e) {
  const body = SFL_parseBody_(e);
  return SFL_responderJson_(SFL_executarApi_(e, body));
}

function SFL_executarApi_(e, body) {
  try {
    const params = (e && e.parameter) || {};
    const action = String((body && body.action) || params.action || "list");

    SFL_validarToken_(params, body);

    if (action === "ping") {
      return {
        ok: true,
        message: "Sistema Flamez conectado",
        spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName()
      };
    }

    if (action === "list") {
      return SFL_listar_(String(params.sheet || "produtos"));
    }

    if (action === "upsert") {
      return SFL_salvarLinha_(body);
    }

    if (action === "delete") {
      return SFL_excluirLinha_(body);
    }

    throw new Error("Ação de API não reconhecida: " + action);
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

function SFL_validarToken_(params, body) {
  if (!SFL_API_TOKEN) return;

  const tokenRecebido = String((body && body.token) || params.token || "");

  if (tokenRecebido !== SFL_API_TOKEN) {
    throw new Error("Token da API inválido.");
  }
}

function SFL_listar_(sheetKey) {
  const config = SFL_obterConfigAba_(sheetKey);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = obterAbaPorTipo_(ss, config.tipo, config.nome);
  const headers = SFL_garantirCabecalhos_(sheet, config);
  const lastRow = sheet.getLastRow();
  const rows = [];

  if (lastRow >= 2) {
    const range = sheet.getRange(2, 1, lastRow - 1, headers.length);
    const values = range.getValues();

    for (let index = 0; index < values.length; index++) {
      const rowNumber = index + 2;
      const hasContent = values[index].some(function (value) {
        return String(value || "").trim() !== "";
      });

      if (!hasContent) continue;

      rows.push({
        rowNumber: rowNumber,
        data: SFL_montarObjetoLinha_(sheet, rowNumber, headers)
      });
    }
  }

  return {
    ok: true,
    sheet: sheetKey,
    sheetName: sheet.getName(),
    headers: headers,
    rows: rows
  };
}

function SFL_salvarLinha_(body) {
  if (!body || !body.sheet) {
    throw new Error("Informe a aba que será salva.");
  }

  const config = SFL_obterConfigAba_(String(body.sheet));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = obterAbaPorTipo_(ss, config.tipo, config.nome);
  const headers = SFL_garantirCabecalhos_(sheet, config);
  const data = body.data || {};
  const rowNumber = Number(body.rowNumber || 0) || Math.max(sheet.getLastRow() + 1, 2);
  const values = headers.map(function (header) {
    return SFL_normalizarValorEntrada_(header, data[header]);
  });

  garantirQuantidadeMinimaDeLinhas_(sheet, rowNumber);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  SFL_prepararLinha_(config, sheet, rowNumber);

  return {
    ok: true,
    sheet: body.sheet,
    rowNumber: rowNumber,
    data: SFL_montarObjetoLinha_(sheet, rowNumber, headers)
  };
}

function SFL_excluirLinha_(body) {
  if (!body || !body.sheet || !body.rowNumber) {
    throw new Error("Informe a aba e o número da linha.");
  }

  const config = SFL_obterConfigAba_(String(body.sheet));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = obterAbaPorTipo_(ss, config.tipo, config.nome);
  const rowNumber = Number(body.rowNumber);

  if (!Number.isFinite(rowNumber) || rowNumber <= 1 || rowNumber > sheet.getLastRow()) {
    throw new Error("Linha inválida para exclusão.");
  }

  sheet.deleteRow(rowNumber);

  return {
    ok: true,
    sheet: body.sheet,
    deletedRowNumber: rowNumber
  };
}

function SFL_obterConfigAba_(sheetKey) {
  const configs = {
    produtos: {
      tipo: "produtos",
      nome: "Produtos",
      cabecalhos: CABECALHOS_PRODUTOS
    },
    filamentos: {
      tipo: "filamentos",
      nome: "Filamentos",
      cabecalhos: CABECALHOS_FILAMENTOS
    },
    producao: {
      tipo: "producao",
      nome: "Produção",
      cabecalhos: CABECALHOS_PRODUCAO
    },
    reposicao: {
      tipo: "reposicao",
      nome: "Peças de Reposição",
      cabecalhos: CABECALHOS_REPOSICAO
    },
    encomendas: {
      tipo: "encomendas",
      nome: "Encomendas",
      cabecalhos: CABECALHOS_ENCOMENDAS
    }
  };

  const config = configs[sheetKey];

  if (!config) {
    throw new Error("Aba não suportada: " + sheetKey);
  }

  return config;
}

function SFL_garantirCabecalhos_(sheet, config) {
  garantirQuantidadeMinimaDeColunas_(sheet, config.cabecalhos.length);

  const existentes = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), config.cabecalhos.length))
    .getValues()[0];
  const normalizados = existentes.map(function (header) {
    return normalizarTexto_(header);
  });
  const headers = config.cabecalhos.slice();

  headers.forEach(function (header, index) {
    const atual = normalizarTexto_(existentes[index]);

    if (!atual) {
      sheet.getRange(1, index + 1).setValue(header);
      return;
    }

    if (atual !== normalizarTexto_(header) && normalizados.indexOf(normalizarTexto_(header)) === -1) {
      sheet.getRange(1, index + 1).setValue(header);
    }
  });

  return headers;
}

function SFL_montarObjetoLinha_(sheet, rowNumber, headers) {
  const values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const data = {};

  headers.forEach(function (header, index) {
    const column = index + 1;

    if (SFL_ehColunaLinkProduto_(header)) {
      data[header] = obterUrlDaCelula_(sheet.getRange(rowNumber, column));
      return;
    }

    data[header] = SFL_serializarValor_(values[index]);
  });

  return data;
}

function SFL_prepararLinha_(config, sheet, rowNumber) {
  if (config.tipo === "produtos") {
    prepararLinhaProduto(sheet, rowNumber);
    return;
  }

  if (config.tipo === "filamentos") {
    prepararLinhaFilamento(sheet, rowNumber);
    return;
  }

  if (config.tipo === "producao") {
    prepararLinhaProducao(sheet, rowNumber);
    processarMovimentacaoProducao_(sheet, rowNumber);
    return;
  }

  if (config.tipo === "reposicao") {
    prepararLinhaReposicao(sheet, rowNumber);
    return;
  }

  if (config.tipo === "encomendas") {
    SFL_prepararLinhaEncomenda_(sheet, rowNumber);
  }
}

function SFL_ehColunaLinkProduto_(header) {
  return [
    "Orçamento PDF",
    "Foto",
    "Link Shopee",
    "STL/3MF",
    "Imagem"
  ].indexOf(header) !== -1;
}

function SFL_normalizarValorEntrada_(header, value) {
  const text = String(value === null || value === undefined ? "" : value).trim();

  if (!text) return "";

  if (/^(Dia produção|Data do pedido|Data de entrega)$/i.test(header)) {
    return SFL_parseData_(text) || text;
  }

  if (/^(Custo|Valor de venda|Valor que recebe|Preço|Custo médio por kg|Estoque atual \(kg\)|Quantidade produzida|Peso \(g\)|Horas \(h\)|Desperdício \(g\)|Peso estimado \(g\)|Quantidade da entrega|Valor da encomenda|Quantidade de itens)$/i.test(header)) {
    return numeroPlanilha_(text);
  }

  return text;
}

function SFL_parseData_(text) {
  const iso = String(text).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const br = String(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  }

  return null;
}

function SFL_serializarValor_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
      "yyyy-MM-dd"
    );
  }

  return value === null || value === undefined ? "" : value;
}

function SFL_parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  return JSON.parse(e.postData.contents);
}

function SFL_responderJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function SFL_prepararLinhaEncomenda_(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  SFL_aplicarValidacaoEncomenda_(sheet, rowNumber, headers, "Status do processo", ["Parado", "Em andamento", "Finalizado"]);
  SFL_aplicarValidacaoEncomenda_(sheet, rowNumber, headers, "Cancelado", ["Não", "Sim"]);
  SFL_aplicarValidacaoEncomenda_(sheet, rowNumber, headers, "Canal de venda", ["Shopee", "Instagram", "WhatsApp", "Indicação", "Outro"]);
  SFL_aplicarFormatoEncomenda_(sheet, rowNumber, headers, "Data do pedido", "dd/mm/yyyy");
  SFL_aplicarFormatoEncomenda_(sheet, rowNumber, headers, "Data de entrega", "dd/mm/yyyy");
  SFL_aplicarFormatoEncomenda_(sheet, rowNumber, headers, "Valor da encomenda", "R$ #,##0.00");
}

function SFL_aplicarValidacaoEncomenda_(sheet, rowNumber, headers, header, options) {
  const column = headers.indexOf(header) + 1;
  if (!column) return;

  const rule = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(rowNumber, column).setDataValidation(rule);
}

function SFL_aplicarFormatoEncomenda_(sheet, rowNumber, headers, header, format) {
  const column = headers.indexOf(header) + 1;
  if (!column) return;

  sheet.getRange(rowNumber, column).setNumberFormat(format);
}
