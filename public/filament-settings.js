const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
const button = (text, action, className = 'primary-button') => {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
};

// A foto é reduzida antes de salvar para manter o cadastro leve e portátil.
export async function prepareFilamentPhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Escolha uma foto JPG, PNG ou WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Escolha uma foto de até 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(bitmap.width * scale)); canvas.height = Math.max(1,Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/webp',0.8);
  } finally { bitmap.close(); }
}

export async function renderFilamentSettings(host, api, setStatus) {
  host.textContent = 'Carregando configurações…';
  let rows, selectedBrand = '';
  try { rows = (await api('/api/sheets?sheet=filamentSettings')).rows || []; }
  catch(error) { host.textContent = error.message; return; }
  if (!host.isConnected) return;

  const save = async (rowNumber, data) => {
    const result = await api('/api/sheets/upsert', {method:'POST',body:JSON.stringify({sheet:'filamentSettings',rowNumber,data})});
    const saved = result.row;
    if (saved) { const index = rows.findIndex(row=>row.rowNumber === saved.rowNumber); if(index < 0) rows.push(saved); else rows[index] = saved; }
    else rows = (await api('/api/sheets?sheet=filamentSettings')).rows || [];
    setStatus('Configurações salvas','ok');
  };

  function editor(row = null, brandOnly = false) {
    const dialog = el('dialog','filament-dialog'); const form = el('form','filament-editor');
    form.append(el('h2','',brandOnly ? 'Nova marca' : row ? 'Editar filamento' : 'Novo filamento'));
    const fields = {};
    const field = (name, type = 'text', suffix = '') => {
      const label = el('label','field',name + suffix); const input = el('input'); input.type = type; input.value = row?.data[name] || '';
      label.append(input); fields[name] = input; return label;
    };
    const grid = el('div','filament-form-grid');
    if (brandOnly) { grid.append(field('Marca')); fields.Marca.required = true; }
    else {
      grid.append(el('p','wide',`Marca: ${selectedBrand}`),field('Modelo'),field('Linha do material'),field('Cor'),field('Melhor taxa de fluxo','text',' (fator)'),field('Melhor temperatura','number',' (°C)'));
      fields.Modelo.placeholder = 'Ex.: PLA, PETG'; fields['Linha do material'].placeholder = 'Ex.: Lite, Premium, Silk';
      const lines = el('datalist'); lines.id = 'filament-material-lines';
      ['Lite','Premium','Basic','Silk','Matte'].forEach(value=>{const option=el('option');option.value=value;lines.append(option);});
      fields['Linha do material'].setAttribute('list',lines.id);grid.append(lines);
      fields.Modelo.required = true; fields.Cor.required = true;
      fields['Melhor taxa de fluxo'].placeholder = 'Ex.: 0,98'; fields['Melhor taxa de fluxo'].inputMode = 'decimal';
      fields['Melhor temperatura'].min = '0'; fields['Melhor temperatura'].max = '500'; fields['Melhor temperatura'].step = '0.1';
    }
    form.append(grid);
    let photo = row?.data.Foto || '', photoPending = false;
    const errorBox = el('p','filament-error'); errorBox.setAttribute('role','alert');
    const submit = el('button','primary-button','Salvar'); submit.type = 'submit';
    if (!brandOnly) {
      const preview = el('img','filament-photo'); preview.alt = 'Prévia do filamento'; preview.hidden = !photo;
      if(photo) preview.src = photo;
      const uploadLabel = el('label','field','Foto do filamento'); const upload = el('input'); upload.type = 'file'; upload.accept = 'image/jpeg,image/png,image/webp';
      uploadLabel.append(upload,el('small','','Escolha uma foto do computador ou celular (até 10 MB).'));
      upload.addEventListener('change',async()=>{
        if (!upload.files[0]) return;
        photoPending = true; submit.disabled = true; errorBox.textContent = '';
        try { photo = await prepareFilamentPhoto(upload.files[0]); preview.src = photo; preview.hidden = false; }
        catch(error) { errorBox.textContent = error.message; }
        finally { photoPending = false; submit.disabled = false; upload.value = ''; }
      });
      form.append(uploadLabel,preview,button('Remover foto',()=>{photo = ''; preview.removeAttribute('src'); preview.hidden = true;},'ghost-light-button'));
    }
    const close = () => {dialog.close(); dialog.remove();};
    dialog.addEventListener('cancel',event=>{event.preventDefault(); if(!submit.disabled) close();});
    const cancel = button('Cancelar',close,'ghost-light-button');
    const actions = el('div','row-actions'); actions.append(cancel,submit); form.append(errorBox,actions);
    form.addEventListener('submit',async event=>{
      event.preventDefault(); if(photoPending || submit.disabled) return;
      const data = Object.fromEntries(Object.entries(fields).map(([name,input])=>[name,input.value.trim()]));
      if (Object.values(data).some(value=>value.length > 160)) {errorBox.textContent = 'Use até 160 caracteres por campo.'; return;}
      if (brandOnly && !data.Marca || !brandOnly && (!data.Modelo || !data.Cor)) {errorBox.textContent = 'Preencha os campos obrigatórios.'; return;}
      if (brandOnly && rows.some(r=>r.data.Marca.toLocaleLowerCase() === data.Marca.toLocaleLowerCase())) {errorBox.textContent = 'Esta marca já está cadastrada.'; return;}
      if(!brandOnly) {
        const flow = data['Melhor taxa de fluxo'];
        if(flow && (!/^\d+(?:[.,]\d+)?$/.test(flow) || Number(flow.replace(',','.')) <= 0)) {errorBox.textContent = 'Informe um fator de fluxo maior que zero, como 0,98.'; return;}
        Object.assign(data,{Marca:selectedBrand,Foto:photo,Tipo:'filamento'});
      } else data.Tipo = 'marca';
      submit.disabled = true; cancel.disabled = true;
      try { await save(row?.rowNumber ?? null,data); selectedBrand = data.Marca; close(); draw(); }
      catch(error) {errorBox.textContent = error.message; submit.disabled = false; cancel.disabled = false;}
    });
    dialog.append(form); host.append(dialog); dialog.showModal();
  }

  function draw() {
    host.replaceChildren();
    const heading = el('div','filament-heading'); heading.append(el('h2','','Configurações de filamento'),button('+ Nova marca',()=>editor(null,true)));
    host.append(heading);
    const brands = [...new Set(rows.map(row=>row.data.Marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    if (!selectedBrand || !brands.includes(selectedBrand)) selectedBrand = brands[0] || '';
    const brandGrid = el('div','filament-brand-grid');
    brands.forEach(brand=>{
      const count = rows.filter(row=>row.data.Marca === brand && row.data.Tipo !== 'marca').length;
      const card = button('',()=>{selectedBrand = brand; draw();},`filament-brand${brand === selectedBrand ? ' selected' : ''}`);
      card.setAttribute('aria-pressed',String(brand === selectedBrand)); card.append(el('strong','',brand),el('span','',`${count} filamento${count === 1 ? '' : 's'}`)); brandGrid.append(card);
    });
    host.append(brandGrid);
    if(!selectedBrand) {host.append(el('p','empty-state','Adicione uma marca para cadastrar os modelos e cores dos seus filamentos.')); return;}
    const heading2 = el('div','filament-heading'); heading2.append(el('h3','',selectedBrand),button('+ Adicionar filamento',()=>editor())); host.append(heading2);
    const cards = el('div','filament-card-grid');
    const filaments = rows.filter(row=>row.data.Marca === selectedBrand && row.data.Tipo !== 'marca');
    filaments.forEach(row=>{
      const data = row.data; const card = el('details','filament-card'); const summary = el('summary','',`${[data.Modelo,data['Linha do material']].filter(Boolean).join(' ')} · ${data.Cor}`); card.append(summary);
      const body = el('div','filament-card-body');
      if(data.Foto && /^data:image\/(png|jpeg|webp);base64,/.test(data.Foto)) {const image = el('img','filament-photo'); image.src = data.Foto; image.alt = `${data.Marca} ${data.Modelo} ${data.Cor}`; image.loading = 'lazy'; body.append(image);}
      else body.append(el('div','filament-no-photo','Sem foto'));
      body.append(el('p','',`Melhor taxa de fluxo: ${data['Melhor taxa de fluxo'] || 'Não informada'}`),el('p','',`Melhor temperatura: ${data['Melhor temperatura'] ? data['Melhor temperatura'] + ' °C' : 'Não informada'}`),button('Editar especificações',()=>editor(row),'ghost-light-button'));
      card.append(body); cards.append(card);
    });
    if(!filaments.length) cards.append(el('p','','Nenhum filamento nesta marca. Use + para adicionar o primeiro.'));
    host.append(cards);
  }
  draw();
}
