import {machineNumber} from './machine-costs.js';
export const PRESET_HEADERS=['Código','Produto','SKU','Produto ID','Quantidade','Horas','Filamento (g)'];
export function normalizePreset(data,products,rows,previous) {
  const invalid=message=>Object.assign(new Error(message),{statusCode:400});
  const product=products.find(p=>String(p.rowNumber)===String(data['Produto ID']));
  if(!product || !product.data.SKU?.trim())throw invalid('Selecione um produto com SKU cadastrado.');
  if(previous && String(previous['Produto ID'])!==String(product.rowNumber))throw invalid('Para outro produto, crie um novo padrão.');
  const quantity=machineNumber(data.Quantidade),hours=machineNumber(data.Horas),filament=machineNumber(data['Filamento (g)']);
  if(!Number.isSafeInteger(quantity)||quantity<=0)throw invalid('Informe uma quantidade inteira maior que zero.');
  if(!Number.isFinite(hours)||Number(hours.toFixed(2))<=0)throw invalid('Informe o tempo total em horas, maior que zero.');
  if(!Number.isFinite(filament)||Number(filament.toFixed(2))<=0)throw invalid('Informe a quantidade prevista de filamento em gramas, maior que zero.');
  const sku=previous?.SKU || product.data.SKU.trim();
  const versions=rows.filter(r=>r.data.SKU?.toLowerCase()===sku.toLowerCase()).map(r=>Number(String(r.data.Código).slice(sku.length+1))||0);
  const code=previous?.Código || `${sku}-${Math.max(0,...versions)+1}`;
  return {'Código':code,Produto:product.data.Produto,SKU:sku,'Produto ID':String(product.rowNumber),Quantidade:String(quantity),Horas:hours.toFixed(2),'Filamento (g)':String(Number(filament.toFixed(2)))};
}
export function presetValues(preset) {
  const filament=machineNumber(preset.data['Filamento (g)']);
  return {productId:String(preset.data['Produto ID']),quantity:preset.data.Quantidade,hours:Number(preset.data.Horas).toFixed(2),filament:Number.isFinite(filament)&&filament>0?String(filament):''};
}
export function renderProductionPresets(ctx) {
  const {state,elements,saveRow,deleteRow}=ctx;
  state.editingPresets??=new Set();
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
  const button=(text,action,cls='primary-button')=>{const b=el('button',cls,text);b.type='button';b.onclick=action;return b;};
  const redraw=()=>renderProductionPresets(ctx);
  elements.content.replaceChildren(el('p','machine-formula','Crie versões do mesmo SKU com quantidade, tempo total e filamento previsto. Exemplo: A01-1, A01-2. Use esses padrões em Completar dados da produção.'));
  const grid=el('div','product-stock-grid');elements.content.append(grid);
  for(const row of state.draft?[state.draft,...state.rows]:state.rows){
    if(row.rowNumber && !Object.values(row.data).join(' ').toLowerCase().includes(elements.searchInput.value.trim().toLowerCase()))continue;
    const card=el('article','product-stock-card');grid.append(card);
    card.append(el('h3','',row.data.Código||'Novo SKU padronizado'));
    if(row.rowNumber && !state.editingPresets.has(String(row.rowNumber))){
      const filament=machineNumber(row.data['Filamento (g)']);
      card.append(el('p','',row.data.Produto),el('strong','',`${row.data.Quantidade} un · ${Number(row.data.Horas).toFixed(2)} h · ${filament>0?`${filament.toLocaleString('pt-BR',{maximumFractionDigits:2})} g`:'filamento não informado'}`),button('Editar padrão',()=>{state.editingPresets.add(String(row.rowNumber));redraw();}));continue;
    }
    const form=el('form'),select=el('select');select.required=true;select.append(new Option('Selecione o produto',''));
    for(const p of state.presetProducts||[])if(p.data.SKU)select.append(new Option(`${p.data.SKU} · ${p.data.Produto}`,String(p.rowNumber)));
    select.value=row.data['Produto ID']||'';select.disabled=Boolean(row.rowNumber);
    const quantity=el('input');quantity.type='number';quantity.min='1';quantity.step='1';quantity.required=true;quantity.value=row.data.Quantidade||'';
    const hours=el('input');hours.type='text';hours.inputMode='decimal';hours.required=true;hours.placeholder='Ex.: 2.50';hours.value=row.data.Horas||'';
    const filament=el('input');filament.type='text';filament.inputMode='decimal';filament.required=true;filament.placeholder='Ex.: 300';filament.value=row.data['Filamento (g)']||'';
    for(const [title,input] of [['Produto / SKU',select],['Quantidade produzida (un)',quantity],['Tempo total na máquina (h)',hours],['Filamento previsto (g)',filament]]){const label=el('label','field',title);label.append(input);form.append(label);}
    const hint=el('p','machine-formula','O código da versão é gerado automaticamente ao salvar.');form.append(hint);
    const error=el('p','stock-feedback');error.setAttribute('role','alert');
    const save=el('button','primary-button','Salvar padrão');save.type='submit';
    const cancel=button('Cancelar',()=>{if(!row.rowNumber)deleteRow('productionPresets',null);else{state.editingPresets.delete(String(row.rowNumber));redraw();}},'ghost-light-button');
    const actions=el('div','row-actions');actions.append(cancel,save);form.append(error,actions);card.append(form);
    form.onsubmit=async e=>{e.preventDefault();try{const data=normalizePreset({'Produto ID':select.value,Quantidade:quantity.value,Horas:hours.value,'Filamento (g)':filament.value},state.presetProducts,state.rows,row.rowNumber?row.data:null);await saveRow('productionPresets',row.rowNumber,data,save);}catch(e){error.textContent=e.message;}};
  }
  if(!grid.children.length)grid.append(el('p','empty-state','Nenhum padrão encontrado. Clique em Novo padrão para cadastrar.'));
}
