import {prepareFilamentPhoto} from './filament-settings.js';
import {machineNumber} from './machine-costs.js';
export function normalizeMaterial(data) {
  const name=String(data.Material||'').trim(),unit=String(data.Unidade||'un').trim(),quantity=machineNumber(data.Quantidade);
  if(!name || name.length>160) throw Object.assign(new Error('Informe um nome de material com até 160 caracteres.'),{statusCode:400});
  if(!Number.isFinite(quantity)||quantity<0) throw Object.assign(new Error('Informe uma quantidade maior ou igual a zero.'),{statusCode:400});
  if(!['un','rolos','m','kg','pacotes'].includes(unit)) throw Object.assign(new Error('Selecione uma unidade válida.'),{statusCode:400});
  const photo=String(data.Foto||''),link=String(data['Link de compra']||'').trim();
  if(photo && (photo.length>2000000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo))) throw Object.assign(new Error('Foto inválida. Escolha JPG, PNG ou WebP.'),{statusCode:400});
  if(link) { let url; try {url=new URL(link);} catch {} if(!url || !['https:','http:'].includes(url.protocol) || url.username || url.password || link.length>4000) throw Object.assign(new Error('Informe um link de compra válido começando com https:// ou http://.'),{statusCode:400}); }
  return {Foto:photo,'Link de compra':link,Material:name,Quantidade:String(quantity),Unidade:unit,Observações:String(data.Observações||'').trim().slice(0,1000)};
}
export function renderMaterialStock(ctx) {
  const {state,elements,saveRow,deleteRow}=ctx;
  state.editingMaterials ??= new Set();
  const redraw=()=>renderMaterialStock(ctx);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
  elements.content.replaceChildren(el('p','machine-formula','Cadastre fita dupla face, argolas e outros materiais. Atualize as quantidades manualmente e clique em Salvar estoque.'));
  const grid=el('div','product-stock-grid');elements.content.append(grid);
  const rows=state.draft?[state.draft,...state.rows]:state.rows;
  const term=elements.searchInput.value.trim().toLocaleLowerCase();
  for(const row of rows){
    if(row.rowNumber && term && ![row.data.Material,row.data.Observações].join(' ').toLocaleLowerCase().includes(term))continue;
    if(row.rowNumber && !state.editingMaterials.has(String(row.rowNumber))) {
      const card=el('article','product-stock-card material-stock-card'),header=el('div','stock-card-heading');
      if(row.data.Foto){const photo=el('img','material-stock-photo');photo.src=row.data.Foto;photo.alt=row.data.Material;photo.loading='lazy';header.append(photo);}
      else header.append(el('div','material-stock-placeholder','Sem foto'));
      header.append(el('h3','',row.data.Material));
      const quantity=el('div','material-stock-quantity');
      const value=el('div','material-stock-value');value.append(el('strong','',Number(row.data.Quantidade).toLocaleString('pt-BR')),el('span','',row.data.Unidade));
      quantity.append(el('span','stock-quantity-label','Quantidade em estoque'),value);card.append(header,quantity);
      if(row.data.Observações)card.append(el('p','material-stock-notes',row.data.Observações));
      const actions=el('div','row-actions'),edit=el('button','primary-button','Editar');edit.type='button';edit.onclick=()=>{state.editingMaterials.add(String(row.rowNumber));redraw();};actions.append(edit);
      if(row.data['Link de compra']){try{const url=new URL(row.data['Link de compra']);if(['https:','http:'].includes(url.protocol)){const link=el('a','ghost-light-button material-buy-button','Comprar ↗');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',`Comprar ${row.data.Material}`);actions.append(link);}}catch{}}
      card.append(actions);grid.append(card);continue;
    }
    const form=el('form','product-stock-card');form.append(el('h3','',row.data.Material||'Novo material'));
    const inputs={};
    for(const [key,placeholder] of [['Material','Ex.: Fita dupla face'],['Quantidade','0'],['Unidade',''],['Observações','Detalhes opcionais'],['Link de compra','https://loja.com/produto']]){
      const label=el('label','field',key),input=el(key==='Unidade'?'select':'input');
      if(key==='Unidade') for(const value of ['un','rolos','m','kg','pacotes'])input.append(new Option(value,value));
      else {input.type='text';input.placeholder=placeholder;}
      input.value=row.data[key]??(key==='Unidade'?'un':key==='Quantidade'?'0':'');
      if(key==='Quantidade')input.inputMode='decimal';
      if(!['Observações','Link de compra'].includes(key))input.required=true;
      label.append(input);form.append(label);inputs[key]=input;
    }
    let photo=row.data.Foto||'',processing=false;
    const upload=el('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';
    const photoLabel=el('label','field','Foto do material');photoLabel.append(upload);
    const preview=el('img','material-stock-photo');preview.alt='Foto do material';preview.hidden=!photo;if(photo)preview.src=photo;
    const removePhoto=el('button','ghost-light-button','Remover foto');removePhoto.type='button';removePhoto.hidden=!photo;
    removePhoto.onclick=()=>{photo='';preview.hidden=true;removePhoto.hidden=true;upload.value='';};form.append(photoLabel,preview,removePhoto);
    const feedback=el('p','stock-feedback');feedback.setAttribute('role','alert');
    const actions=el('div','row-actions'),save=el('button','primary-button','Salvar estoque'),remove=el('button','danger-button',row.rowNumber?'Excluir':'Cancelar');
    save.type='submit';remove.type='button';remove.onclick=()=>deleteRow('materialStock',row.rowNumber);
    upload.onchange=async()=>{if(!upload.files[0])return;processing=true;save.disabled=true;upload.disabled=true;try{photo=await prepareFilamentPhoto(upload.files[0]);preview.src=photo;preview.hidden=false;removePhoto.hidden=false;feedback.textContent='Foto pronta. Clique em Salvar estoque.';}catch(error){feedback.textContent=error.message;}finally{processing=false;save.disabled=false;upload.disabled=false;upload.value='';}};
    if(row.rowNumber){const cancel=el('button','ghost-light-button','Cancelar');cancel.type='button';cancel.onclick=()=>{state.editingMaterials.delete(String(row.rowNumber));redraw();};actions.append(cancel);}
    actions.append(remove,save);form.append(feedback,actions);
    form.onsubmit=async event=>{event.preventDefault();if(processing)return;try{const data=normalizeMaterial({...Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])),Foto:photo});await saveRow('materialStock',row.rowNumber,data,save);}catch(error){feedback.textContent=error.message;}};
    grid.append(form);
  }
  if(!grid.children.length)grid.append(el('p','empty-state',term?'Nenhum material encontrado.':'Clique em Novo material para começar seu estoque.'));
}
