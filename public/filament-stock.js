import { machineNumber } from './machine-costs.js';
const invalid = message => Object.assign(new Error(message), {statusCode:400});
export const filamentName = row => ['Marca','Tipo de filamento','Tipo do material','Cor'].map(k=>row.data[k]).filter(Boolean).join(' · ');
const nextLogRow = rows => Math.max(1,...rows.map(row=>Number(row.rowNumber)||1))+1;
export function appendFilamentLog(sheets, data) {
  const logs=sheets.filamentLog.rows;
  logs.push({rowNumber:nextLogRow(logs),data:{
    Data:new Date().toISOString(),
    'Dia da produção':'',Produção:'',Filamento:'',Movimento:'',
    'Quantidade (g)':'','Saldo (kg)':'',Status:'',Origem:'Manual',...data
  }});
}
export function validateStockItems(items, stock) {
  for(const item of items) {
    const filament=stock.find(r=>String(r.rowNumber)===String(item.filamentStockRow));
    if(!filament || !filament.data.Marca?.trim() || !filament.data.Cor?.trim()) throw invalid('Selecione um filamento do estoque com marca e cor. Abra Fazer alterações para completar o vínculo.');
    if(!(Number(item.plannedUsed ?? item.used)>0)) throw invalid('Informe a quantidade de filamento em gramas.');
    item.filamentBrand=filament.data.Marca;item.filamentColor=filament.data.Cor;
  }
}
function consumption(row) {
  const totals=new Map();
  if(!row || !['Concluída','Parcial','Falhou'].includes(row.data['Status da produção'])) return totals;
  for(const item of JSON.parse(row.data['Itens da produção'] || '[]')) {
    if(!item.filamentStockRow) continue;
    const grams=Number(item.used)+Number(item.waste);
    if(!Number.isFinite(grams)||grams<0) throw invalid('Consumo de filamento inválido.');
    const id=String(item.filamentStockRow);totals.set(id,(totals.get(id)||0)+grams);
  }
  return totals;
}
export function reconcileFilamentStock(previous, next) {
  const oldRows=new Map(previous.producao.rows.map(r=>[r.rowNumber,r]));
  const newRows=new Map(next.producao.rows.map(r=>[r.rowNumber,r]));
  const changes=[];
  for(const id of new Set([...oldRows.keys(),...newRows.keys()])) {
    const before=consumption(oldRows.get(id)),after=consumption(newRows.get(id));
    for(const stockId of new Set([...before.keys(),...after.keys()])) {
      const delta=Math.round(((after.get(stockId)||0)-(before.get(stockId)||0))*1e6)/1e6;
      if(delta) changes.push({id,stockId,delta,row:newRows.get(id)||oldRows.get(id),removed:!newRows.has(id)});
    }
  }
  const stockChanges=new Map();
  for(const c of changes) stockChanges.set(c.stockId,(stockChanges.get(c.stockId)||0)+c.delta);
  for(const [id,grams] of stockChanges) {
    const row=next.filamentos.rows.find(r=>String(r.rowNumber)===id);
    if(!row) throw invalid('O filamento vinculado não está mais no estoque.');
    if(!Number.isFinite(machineNumber(row.data['Estoque atual (kg)']))) throw invalid(`Corrija o saldo do filamento: ${filamentName(row)}.`);
    if(machineNumber(row.data['Estoque atual (kg)'])*1000-grams < -0.000001) throw invalid(`Estoque insuficiente: ${filamentName(row)}. A produção não foi salva.`);
  }
  // Restituições primeiro para que uma troca entre itens não gere saldo intermediário negativo.
  changes.sort((a,b)=>a.delta-b.delta);
  for(const c of changes) {
    const stock=next.filamentos.rows.find(r=>String(r.rowNumber)===c.stockId);
    const balance=Math.max(0,Math.round((machineNumber(stock.data['Estoque atual (kg)'])-c.delta/1000)*1e9)/1e9);
    stock.data['Estoque atual (kg)']=balance.toFixed(9);
    const automatic=(c.row.data._bambuAutomatic==='true'||c.row.data._bambuAutomaticOutcome==='true')&&c.row.data._bambuManualOutcome!=='true';
    appendFilamentLog(next,{ 'Dia da produção':c.row.data['Dia produção'],Produção:`${c.row.data['Código do produto'] || 'Produção'} (#${c.id})`,Filamento:filamentName(stock),Movimento:c.delta>0?'Saída':'Entrada','Quantidade (g)':String(Math.abs(c.delta)),'Saldo (kg)':String(balance),Status:c.removed?'Produção removida':c.delta<0?'Filamento devolvido ao estoque':c.row.data['Status da produção'],Origem:automatic?'Automática':'Manual'});
  }
}
