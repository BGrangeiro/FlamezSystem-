import {filamentName} from './filament-stock.js';
const el=(tag,cls='',text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
const normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
function colorBadge(name) {
  const badge=el('span','filament-picker-color',name||'Cor não informada');
  const palette=[['azul claro','#93c5fd'],['azul escuro','#1e3a8a'],['azul marinho','#172554'],['verde claro','#a3e635'],['verde escuro','#166534'],['rosa claro','#fbcfe8'],['cinza claro','#d1d5db'],['cinza escuro','#4b5563'],['preto','#202124'],['branco','#ffffff'],['azul','#2563eb'],['vermelho','#dc2626'],['amarelo','#facc15'],['verde','#16a34a'],['laranja','#f97316'],['roxo','#7e22ce'],['lilas','#c4b5fd'],['rosa','#ec4899'],['marrom','#854d2b'],['cinza','#9ca3af'],['prata','#cbd5e1'],['dourado','#d4af37'],['bege','#e7d4b1'],['turquesa','#2dd4bf'],['natural','#f3eedf'],['transparente','#f8fafc']];
  const color=normalize(name).trim();
  const hex=/^#[a-f0-9]{6}$/.test(color)?color:palette.find(([label])=>new RegExp(`\\b${label}\\b`).test(color))?.[1];
  if(hex){
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
    const luminance=0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
    badge.style.backgroundColor=hex;badge.style.color=luminance>0.179?'#111827':'#ffffff';
  }
  return badge;
}
const chevron='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
export function createFilamentPicker(rows,selected) {
  const wrap=el('div','field filament-picker-field'),label=el('span','','Filamento utilizado');
  const input=el('input');input.type='hidden';input.value=rows.some(r=>String(r.rowNumber)===String(selected))?String(selected):'';
  const trigger=el('button','filament-picker-trigger');trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');
  const drawTrigger=()=>{
    const row=rows.find(r=>String(r.rowNumber)===input.value),copy=el('span','filament-picker-selected');
    copy.append(el('strong','',row?row.data.Marca:'Selecionar filamento'),el('small','',row?[row.data['Tipo de filamento'],row.data['Tipo do material'],row.data.Cor].filter(Boolean).join(' · '):'Escolha a marca, o material e a cor'));
    const arrow=el('span','filament-picker-chevron');arrow.innerHTML=chevron;trigger.replaceChildren(copy,arrow);
    trigger.setAttribute('aria-label',row?`Trocar filamento: ${filamentName(row)}`:'Selecionar filamento utilizado');
  };
  drawTrigger();wrap.append(label,input,trigger);
  trigger.onclick=()=>{
    const dialog=el('dialog','filament-picker-dialog');dialog.setAttribute('aria-label','Selecionar filamento');
    const header=el('div','filament-picker-header'),heading=el('div');heading.append(el('small','','PRODUÇÃO'),el('h2','','Escolha o filamento'),el('p','','Encontre o material pela marca, tipo ou cor.'));
    const close=el('button','filament-picker-close','×');close.type='button';close.setAttribute('aria-label','Fechar seleção de filamento');close.onclick=()=>dialog.close();header.append(heading,close);
    const search=el('input','filament-picker-search');search.type='search';search.placeholder='Buscar marca, material ou cor…';search.setAttribute('aria-label','Buscar filamento');
    const brands=el('div','filament-picker-brands');brands.setAttribute('aria-label','Filtrar por marca');
    const results=el('div','filament-picker-results'),count=el('p','filament-picker-count');count.setAttribute('role','status');
    let brand='';const chips=[];
    const draw=()=>{
      chips.forEach(({button,value})=>button.setAttribute('aria-pressed',String(value===brand)));
      const filtered=rows.filter(r=>(!brand||r.data.Marca===brand)&&normalize(filamentName(r)).includes(normalize(search.value.trim())));
      count.textContent=`${filtered.length} ${filtered.length===1?'filamento disponível para seleção':'filamentos disponíveis para seleção'}`;
      results.replaceChildren();
      for(const row of filtered){
        const selected=String(row.rowNumber)===input.value,card=el('button','filament-picker-option');card.type='button';card.setAttribute('aria-pressed',String(selected));
        const top=el('span','filament-picker-option-top');top.append(el('span','filament-picker-brand',row.data.Marca||'Sem marca'),el('span','filament-picker-check',selected?'✓ Selecionado':'Selecionar'));
        const materialLine=el('span','filament-picker-material-line');
        materialLine.append(el('strong','filament-picker-material',[row.data['Tipo de filamento'],row.data['Tipo do material']].filter(Boolean).join(' · ')||'Material não informado'),colorBadge(row.data.Cor));
        card.append(top,materialLine);
        card.onclick=()=>{input.value=String(row.rowNumber);drawTrigger();input.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();};results.append(card);
      }
      if(!filtered.length)results.append(el('p','filament-picker-empty',rows.length?'Nenhum filamento encontrado. Tente outra busca ou marca.':'Cadastre os filamentos na aba Filamentos para selecioná-los aqui.'));
    };
    for(const value of ['',...new Set(rows.map(r=>r.data.Marca).filter(Boolean))]){
      const button=el('button','filament-picker-chip',value||'Todas as marcas');button.type='button';button.onclick=()=>{brand=value;draw();};chips.push({button,value});brands.append(button);
    }
    search.oninput=draw;dialog.append(header,search,brands,count,results);
    dialog.addEventListener('close',()=>{dialog.remove();trigger.focus();},{once:true});
    document.body.append(dialog);draw();dialog.showModal();search.focus();
  };
  return {wrap,input};
}
