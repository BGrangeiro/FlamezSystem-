import {prepareFilamentPhoto} from './filament-settings.js';
import {stockColors,normalizeProductStock} from './product-stock-data.js';
const el=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
const button=(text,action,cls='ghost-light-button')=>{const n=el('button',cls,text);n.type='button';n.onclick=action;return n;};
export function renderProductStock(ctx) {
  const {state,elements,saveRow,deleteRow,setStatus}=ctx;
  state.editingProductStock ??= new Set();
  const redraw=()=>renderProductStock(ctx);
  elements.content.replaceChildren();
  const grid=el('div','product-stock-grid'),products=new Map(),entries=[];
  const term=elements.searchInput.value.trim().toLocaleLowerCase();
  for(const product of state.stockProducts||[]){const sku=String(product.data.SKU||'').trim();if(sku&&!products.has(sku))products.set(sku,product.data.Produto||sku);}
  for(const [sku,name] of products)entries.push({sku,name,existing:state.rows.find(row=>row.data.SKU===sku),standalone:false,key:`sku:${sku}`});
  for(const existing of state.rows.filter(row=>row.data.Avulso==='true'))entries.push({sku:'',name:existing.data.Produto,existing,standalone:true,key:`row:${existing.rowNumber}`});
  if(state.draft?.data?.Avulso==='true')entries.unshift({sku:'',name:'Novo produto avulso',existing:null,data:state.draft.data,standalone:true,key:'draft'});
  elements.content.append(el('p','machine-formula','Consulte fotos e quantidades por cor. Produtos avulsos podem ser cadastrados aqui sem SKU.'));
  for(const entry of entries){
    const {sku,name,existing,standalone,key}=entry,source=existing?.data||entry.data||{};
    if(term&&!`${sku} ${name} ${existing?.data.Cores||''}`.toLocaleLowerCase().includes(term))continue;
    if(existing&& !state.editingProductStock.has(key)) {
      const card=el('article','product-stock-card product-stock-summary'),header=el('div','stock-card-heading'),identity=el('div');
      identity.append(el('h3','',name),el('strong',`stock-sku${standalone?' stock-no-sku':''}`,standalone?'Produto sem SKU':sku));
      if(existing?.data.Foto){const photo=el('img','material-stock-photo');photo.src=existing.data.Foto;photo.alt=`Foto de ${name}`;photo.loading='lazy';header.append(photo);}
      else header.append(el('div','material-stock-placeholder','Sem foto'));
      header.append(identity);card.append(header);
      try {
        const colors=stockColors(existing?.data);
        card.append(el('span','stock-quantity-label','Quantidade em estoque'),el('strong','stock-total-value',`${colors.reduce((sum,item)=>sum+Number(item.quantity),0).toLocaleString('pt-BR')} un`));
        const list=el('dl','stock-info-list');
        for(const item of colors){const line=el('div','stock-info-line');line.append(el('dt','',item.color),el('dd','',`${Number(item.quantity).toLocaleString('pt-BR')} un`));list.append(line);}
        card.append(list);
        if(!colors.length)card.append(el('p','stock-color-empty','Nenhuma quantidade cadastrada.'));
      }catch{card.append(el('p','stock-feedback','Não foi possível ler as cores deste produto.'));}
      card.append(button('Fazer alterações',()=>{state.editingProductStock.add(key);redraw();},'primary-button'));grid.append(card);continue;
    }
    const form=el('form',`product-stock-card product-stock-summary${standalone?' product-stock-standalone-editor':''}`);grid.append(form);
    let colors;try{colors=stockColors(source);}catch{form.append(el('p','','Não foi possível ler as cores deste produto.'));continue;}
    const info=button('',()=>{
      if(popover.matches(':popover-open'))popover.hidePopover();
      else {popover.showPopover();positionInfo();}
    },'stock-info-button');
    info.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></svg>';
    info.title='Consultar estoque por cor';info.setAttribute('aria-label',`Consultar estoque por cor de ${name}`);info.setAttribute('aria-expanded','false');
    const popover=el('div','stock-info-popover');popover.id=`stock-info-${grid.children.length}`;popover.setAttribute('popover','auto');popover.setAttribute('role','region');info.setAttribute('aria-controls',popover.id);
    const infoHeader=el('div','stock-info-header'),infoTitle=el('strong','','Estoque por cor / tipo');infoTitle.id=popover.id+'-title';popover.setAttribute('aria-labelledby',infoTitle.id);
    const close=button('×',()=>popover.hidePopover(),'stock-info-close');close.setAttribute('aria-label','Fechar informações');infoHeader.append(infoTitle,close);
    popover.append(infoHeader,el('p','stock-info-product',standalone?`${name} · Produto sem SKU`:`${name} · ${sku}`));
    const breakdown=el('dl','stock-info-list');
    for(const item of colors){const line=el('div','stock-info-line');line.append(el('dt','',item.color),el('dd','',`${Number(item.quantity).toLocaleString('pt-BR')} un`));breakdown.append(line);}
    if(colors.length)popover.append(breakdown);else popover.append(el('p','stock-info-empty','Nenhuma cor ou tipo cadastrado.'));
    const infoTotal=el('div','stock-info-total');infoTotal.append(el('span','','Total salvo'),el('strong','',`${colors.reduce((sum,item)=>sum+Number(item.quantity),0).toLocaleString('pt-BR')} un`));popover.append(infoTotal);
    const positionInfo=()=>{
      const rect=info.getBoundingClientRect();
      popover.style.left=Math.max(12,Math.min(rect.right-popover.offsetWidth,window.innerWidth-popover.offsetWidth-12))+'px';
      popover.style.top=Math.max(12,Math.min(rect.bottom+8,window.innerHeight-popover.offsetHeight-12))+'px';
    };
    popover.addEventListener('toggle',event=>{const open=event.newState==='open';info.setAttribute('aria-expanded',String(open));});
    form.append(info,popover);
    let photo=source.Foto||'',processing=false;
    const header=el('div','stock-card-heading'),identity=el('div');identity.append(el('h3','',name),el('strong',`stock-sku${standalone?' stock-no-sku':''}`,standalone?'Produto sem SKU':sku));
    const image=el('img','stock-product-photo');image.alt=`Foto de ${name}`;image.loading='lazy';
    const photoButton=button('Adicionar foto',()=>upload.click(),'stock-photo-button');
    const upload=el('input');upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.hidden=true;upload.setAttribute('aria-label',`Foto de ${name}`);
    const updatePhoto=()=>{photoButton.replaceChildren();if(photo){image.src=photo;photoButton.append(image);}else photoButton.textContent='+ Foto';photoButton.title=photo?'Trocar foto':'Adicionar foto';photoButton.setAttribute('aria-label',`${photo?'Trocar':'Adicionar'} foto de ${name}`);};updatePhoto();header.append(photoButton,identity);
    const productName=el('input');productName.type='text';productName.maxLength=160;productName.required=standalone;productName.value=standalone?(source.Produto||''):name;productName.placeholder='Ex.: Protótipo de suporte';
    const productNameLabel=el('label','field','Nome do produto avulso');productNameLabel.append(productName);productNameLabel.hidden=!standalone;
    const label=el('div','stock-quantity-label','Quantidade em estoque (un)');
    const total=el('span','stock-total-value','0');
    const details=el('details','stock-color-details'),summary=el('summary','stock-quantity-toggle');
    const arrow=el('span','stock-quantity-arrow');arrow.setAttribute('aria-hidden','true');
    arrow.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    summary.append(total,arrow);details.append(summary);
    const body=el('div','stock-color-body'),summaryText=el('div','stock-color-heading');body.append(summaryText);details.append(body);
    const list=el('div','stock-color-list');body.append(list);
    const empty=el('p','stock-color-empty','Nenhuma cor cadastrada. Adicione uma cor para informar a quantidade.');body.append(empty);
    const rows=[];
    const updateTotal=()=>{const sum=rows.reduce((n,row)=>n+(Number(row.quantity.value)||0),0);total.textContent=String(sum);summaryText.textContent=`Estoque por cor · ${rows.length} ${rows.length===1?'cor':'cores'}`;summary.setAttribute('aria-label',`Estoque de ${name}: ${sum} unidades. Ver cores e quantidades`);empty.hidden=rows.length>0;};
    const addColor=(value={color:'',quantity:0})=>{
      const line=el('div','stock-color-row'),colorLabel=el('label','field','Cor'),quantityLabel=el('label','field','Quantidade');
      const color=el('input');color.type='text';color.maxLength=80;color.required=true;color.placeholder='Ex.: Branco';color.value=value.color;
      const quantity=el('input');quantity.type='number';quantity.min='0';quantity.step='1';quantity.required=true;quantity.value=String(value.quantity);
      colorLabel.append(color);quantityLabel.append(quantity);
      const row={color,quantity};rows.push(row);
      const remove=button('×',()=>{rows.splice(rows.indexOf(row),1);line.remove();updateTotal();},'stock-color-remove');remove.setAttribute('aria-label','Remover esta cor');
      line.append(colorLabel,quantityLabel,remove);list.append(line);quantity.oninput=updateTotal;updateTotal();return color;
    };
    colors.forEach(addColor);updateTotal();
    const actions=el('div','stock-color-actions');actions.append(button('+ Adicionar cor',()=>{details.open=true;addColor().focus();}));
    const removePhoto=button('Remover foto',()=>{photo='';upload.value='';updatePhoto();removePhoto.hidden=true;});removePhoto.hidden=!photo;actions.append(removePhoto);body.append(actions);
    const save=el('button','primary-button','Salvar estoque');save.type='submit';
    const feedback=el('p','stock-feedback');feedback.setAttribute('role','status');
    upload.onchange=async()=>{if(!upload.files[0])return;processing=true;save.disabled=true;photoButton.disabled=true;feedback.textContent='Preparando foto…';try{photo=await prepareFilamentPhoto(upload.files[0]);updatePhoto();removePhoto.hidden=false;feedback.textContent='Foto pronta. Clique em Salvar estoque.';}catch(e){feedback.textContent=e.message;}finally{processing=false;save.disabled=false;photoButton.disabled=false;upload.value='';}};
    const cancel=button('Cancelar',()=>{state.editingProductStock.delete(key);if(key==='draft')state.draft=null;redraw();});
    const footer=el('div','row-actions');
    if(standalone&&existing)footer.append(button('Excluir produto',()=>deleteRow('productStock',existing.rowNumber),'danger-button'));
    footer.append(save,cancel);
    form.append(header,upload,productNameLabel,label,details,feedback,footer);
    details.open=true;
    form.addEventListener('invalid',()=>{details.open=true;},true);
    form.onsubmit=async event=>{event.preventDefault();if(processing)return;
      try{
        const data=normalizeProductStock({SKU:sku,Produto:standalone?productName.value:'',Avulso:standalone?'true':'',Cores:JSON.stringify(rows.map(row=>({color:row.color.value,quantity:row.quantity.value}))),Foto:photo},source);
        feedback.textContent='';state.editingProductStock.delete(key);await saveRow('productStock',existing?.rowNumber??null,data,save);
      }catch(e){details.open=true;feedback.textContent=e.message;setStatus(e.message,'error');}
    };
  }
  if(!grid.children.length)grid.append(el('p','empty-state',term?'Nenhum produto encontrado.':'Cadastre um produto com SKU ou adicione um produto avulso.'));
  elements.content.append(grid);
}
