import { showDailyReport } from './production-report.js';
import { PRODUCTION_STATUSES, applyProductionOutcome, productionDraftItem } from './production-status.js';
import { machineNumber, calculateMachineCost, normalizeMachineData } from './machine-costs.js';

export function productionItem(product, cost, quantity, waste = '0') {
  const count = machineNumber(quantity);
  const lost = machineNumber(waste);
  const batch = machineNumber(cost?.quantity);
  const materials = cost?.materials?.length ? cost.materials : [{ kgPrice: cost?.filamentKgPrice, usedGrams: cost?.filamentUsedGrams }];
  if (!Number.isInteger(count) || count <= 0) throw new Error('Informe uma quantidade inteira maior que zero.');
  if (!Number.isFinite(lost) || lost < 0) throw new Error('Informe um desperdício válido em gramas.');
  if (!(batch > 0)) throw new Error('Preencha a quantidade do lote na calculadora do produto.');
  let grams = 0, amount = 0;
  const snapshot = materials.map(material => {
    const weight = machineNumber(material.usedGrams ?? material.filamentUsedGrams);
    const price = machineNumber(material.kgPrice ?? material.filamentKgPrice);
    if (!Number.isFinite(weight) || weight < 0 || !Number.isFinite(price) || price < 0) throw new Error('Preencha o peso e o preço por kg de todos os materiais na calculadora do produto.');
    grams += weight / batch;
    amount += weight / batch / 1000 * price;
    return { name: material.name || 'Filamento', gramsPerUnit: weight / batch, kgPrice: price };
  });
  if (!(grams > 0)) throw new Error('O produto precisa ter consumo de filamento maior que zero.');
  const used = grams * count;
  const total = amount * count + lost / grams * amount;
  if (![used, total].every(Number.isFinite)) throw new Error('Valores acima do limite permitido.');
  return { productRow: product.rowNumber, name: product.data.Produto, sku: product.data.SKU || '', quantity: count, waste: lost, gramsPerUnit: grams, used, total, materials: snapshot };
}

export function manualProductionItem(data, machine) {
  const used = machineNumber(data.grams), price = machineNumber(data.price), hours = machineNumber(data.hours);
  const rate = machine ? calculateMachineCost(normalizeMachineData(machine.data)) : null;
  if (!String(data.name || '').trim()) throw new Error('Informe o nome da produção avulsa.');
  if (!(used > 0) || !Number.isFinite(used) || !Number.isFinite(price) || price < 0 || !Number.isFinite(hours) || hours < 0) throw new Error('Informe filamento maior que zero, preço e horas válidos.');
  if (rate === null) throw new Error('Selecione uma máquina com custo por hora calculado na aba Máquinas.');
  const total = used / 1000 * price, machineCost = hours * rate;
  if (![total, machineCost].every(Number.isFinite)) throw new Error('Valores acima do limite permitido.');
  return { type: 'manual', name: data.name.trim(), sku: '', quantity: 1, used, waste: 0, total, gramsPerUnit: used, materials: [{name: 'Filamento', gramsPerUnit: used, kgPrice: price}], machineRow: machine.rowNumber, machineName: machine.data['Nome da máquina'], hours, machineRate: rate, machineCost };
}

export function dailySkuTotals(items) {
  const groups = new Map();
  items.forEach(item => {
    const key = item.type === 'manual' ? `manual:${item.name}` : item.sku || `row:${item.productRow}`;
    if (!groups.has(key)) groups.set(key, {label: item.type === 'manual' ? `Avulsa: ${item.name}` : item.sku ? `SKU ${item.sku}` : item.name, quantity: 0, used: 0, total: 0, machineCost: 0});
    const group = groups.get(key);
    group.quantity += item.quantity; group.used += item.used + item.waste; group.total += item.total; group.machineCost += item.machineCost || 0;
  });
  return [...groups.values()];
}

export function productionTotals(items) {
  return items.reduce((sum, item) => ({ used: sum.used + item.used, waste: sum.waste + item.waste, total: sum.total + item.total, quantity: sum.quantity + item.quantity, machineCost: sum.machineCost + (item.machineCost || 0) }), {used: 0, waste: 0, total: 0, quantity: 0, machineCost: 0});
}

export function groupProductionDays(rows) {
  const groups = new Map();
  rows.forEach(row => {
    let day = String(row.data['Dia produção'] || '').trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(day)) day = day.slice(0, 10);
    const local = day.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (local) day = `${local[3]}-${local[2]}-${local[1]}`;
    if (!groups.has(day)) groups.set(day, { day, rows: [], items: [], incomplete: false });
    const group = groups.get(day);
    group.rows.push(row);
    if (row.rowNumber === null) return;
    try {
      const items = JSON.parse(row.data['Itens da produção']);
      if (!Array.isArray(items)) throw new Error();
      group.items.push(...items);
    } catch { group.incomplete = true; }
  });
  return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export function renderProduction(ctx) {
  const {state, elements, escapeHtml: esc, formatMoney: money, formatNumber: num, formatDateDisplay: date, productKey, render, saveRow, deleteRow, removeProductionItem, todayInputValue} = ctx;
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const button = (text, handler, cls = 'primary-button') => { const el = node('button', cls, text); el.type = 'button'; el.addEventListener('click', handler); return el; };
  elements.content.replaceChildren();
  const term = elements.searchInput.value.trim().toLowerCase();
  const rows = state.draft ? [state.draft, ...state.rows] : state.rows;
  const groups = groupProductionDays(rows).filter(group => group.rows.some(row => row.rowNumber === null || Object.values(row.data).some(v => String(v).toLowerCase().includes(term))));
  if (!groups.length) elements.content.append(elements.emptyStateTemplate.content.cloneNode(true));
  const cell = (label, value) => { const el = node('div', 'product-cell'); el.append(node('span','cell-label',label),node('strong','cell-value',value)); return el; };
  groups.forEach(group => {
    const dayKey = `production-day:${group.day}`;
    const open = group.rows.some(row => row.rowNumber === null) || state.expanded.has(dayKey);
    const totals = productionTotals(group.items);
    const card = node('article', 'product-card machine-card');
    const summary = node('div', 'machine-summary production-day-summary');
    const toggle = button(open ? '⌄' : '›', () => {
      if (open) {
        state.expanded.delete(dayKey);
        group.rows.forEach(row => state.editingProduction.delete(`production:${row.rowNumber}`));
      } else state.expanded.add(dayKey);
      render();
    }, 'chevron');
    toggle.disabled = group.rows.some(row => row.rowNumber === null);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `Mostrar ou ocultar produções de ${date(group.day)}`);
    toggle.setAttribute('aria-controls', `production-day-${group.day || 'undated'}`);
    const partial = group.incomplete ? ' (parcial)' : '';
    const breakdown = (label, value, costs = false) => {
      const wrapper = node('div', 'product-cell production-metric');
      const details = node('details', 'production-metric-details');
      const head = node('summary');
      head.append(node('span','cell-label',label), node('strong','cell-value',value));
      details.append(head);
      const list = node('div','production-metric-list');
      if (costs) {
        const products = group.items.filter(item => item.type !== 'manual');
        const others = group.items.filter(item => item.type === 'manual');
        dailySkuTotals(products).forEach(item => list.append(node('p','', `${item.label.replace(/^SKU /, '')} · ${num(item.quantity,0)} un · ${money(item.total)}`)));
        if (others.length) {
          const otherTotals = productionTotals(others);
          list.append(node('strong','',`Outras Produções: ${num((otherTotals.used + otherTotals.waste)/1000,3)} kg`));
          dailySkuTotals(others).forEach(item => list.append(node('p','',`${item.label.replace(/^Avulsa: /, '')} · ${money(item.total + item.machineCost)}`)));
        }
        list.append(node('strong','',`Total registrado: ${money(totals.total + totals.machineCost)}`));
      } else {
        dailySkuTotals(group.items).forEach(item => list.append(node('p','', `${item.label.replace(/^SKU /, '')}: ${num(item.quantity,0)} un · ${num(item.used/1000,3)} kg`)));
      }
      if (!group.items.length) list.append(node('p','','Nenhum item calculado.'));
      details.append(list); wrapper.append(details); return wrapper;
    };
    summary.append(toggle, cell('Data da produção', group.day ? date(group.day) : 'Sem data'), breakdown(`Filamento total${partial}`, `${num((totals.used + totals.waste)/1000,3)} kg`), cell(`Desperdício${partial}`, `${num(totals.waste)} g`), breakdown(`Custo do filamento${partial}`, money(totals.total), true));
    const add = button('Adicionar produção', () => {
      state.draft = { rowNumber: null, data: { 'Dia produção': group.day || todayInputValue() } };
      state.draftMeta = null;
      state.expanded.add(dayKey);
      render();
    }, 'ghost-light-button production-add-product');
    add.disabled = Boolean(state.draft);
    const addCell = node('div', 'production-day-action'); addCell.append(add,button('Relatório',()=>showDailyReport(group,{money,num,date}),'ghost-light-button production-report-button')); summary.append(addCell);
    card.append(summary); elements.content.append(card);
    if (!open) return;
    const dayPanel = node('div', 'production-day-details');
    dayPanel.id = `production-day-${group.day || 'undated'}`;
    card.append(dayPanel);
    if (group.incomplete) dayPanel.append(node('p', 'machine-formula', 'Totais parciais: este dia contém registros antigos sem cálculo de filamento. Abra Fazer alterações nesses registros para completar os dados.'));
    group.rows.forEach((row, index) => {
    const draft = row.rowNumber === null, key = `production:${row.rowNumber}`;
    let items = null;
    try { const parsed = JSON.parse(row.data['Itens da produção']); if (Array.isArray(parsed)) items = parsed; } catch {}
    const panel = node('section', 'product-details order-details production-record');
    panel.append(node('h3', '', draft ? 'Nova produção' : `Produção ${index + 1}`));
    dayPanel.append(panel);
    const savedStatus = row.data['Status da produção'] || (draft ? 'Em produção' : 'Concluída');
    if (draft || state.editingProduction.has(key)) panel.append(node('span', `order-status ${savedStatus === 'Concluída' ? 'done' : savedStatus === 'Falhou' ? 'stopped' : 'progress'}`, savedStatus));
    if (!draft && !state.editingProduction.has(key)) {
      const grid = node('div','order-info-grid');
      if (items) items.forEach(item => {
        const detail = node('div','order-info-item production-detail-card');
        const body = node('div','production-detail-body');
        const titleRow = node('div','production-title-row');
        titleRow.append(node('h4','production-item-title',item.name || item.sku || 'Produção sem nome'));
        if(item.sku) titleRow.append(node('strong','production-detail-sku',item.sku));
        body.append(titleRow);
        const materials = Array.isArray(item.materials) ? item.materials : [];
        const filamentName = item.filamentLabel || materials.map(m=>m.name).filter(Boolean).join(' + ') || 'Filamento não informado';
        const filament = [filamentName,item.filamentColor].filter(Boolean).join(' · ');
        body.append(node('p','production-detail-quantity',`${num(item.quantity,0)} un · ${filament} · ${num(item.used + item.waste)} g`));
        const statusArea = node('div','production-quick-status');
        const statusTone = value => value === 'Concluída' ? 'success' : value === 'Parcial' ? 'partial' : value === 'Falhou' ? 'failed' : 'pending';
        const dropdown = node('div','production-status-dropdown');
        const choices = node('div','production-status-menu'); choices.hidden = true;
        const closeMenu = () => {choices.hidden = true; trigger.setAttribute('aria-expanded','false');};
        const trigger = button(`${savedStatus} ▾`,()=>{
          const opening = choices.hidden;
          panel.querySelectorAll('.production-status-menu').forEach(menu=>menu.hidden = true);
          panel.querySelectorAll('.production-status-trigger').forEach(b=>b.setAttribute('aria-expanded','false'));
          choices.hidden = !opening; trigger.setAttribute('aria-expanded',String(opening));
        },`production-status-button production-status-trigger status-choice ${statusTone(savedStatus)}`);
        trigger.setAttribute('aria-expanded','false');
        trigger.setAttribute('aria-label',`Alterar status: ${savedStatus}`);
        choices.setAttribute('role','group'); choices.setAttribute('aria-label','Alterar status da produção');
        PRODUCTION_STATUSES.filter(value=>value !== savedStatus).forEach(value=>{
          const choice = button(value,()=>{closeMenu();openStatusEditor(value,trigger);},`production-status-button status-choice ${statusTone(value)}`);
          choices.append(choice);
        });
        dropdown.addEventListener('focusout',event=>{if(!dropdown.contains(event.relatedTarget)) closeMenu();});
        dropdown.addEventListener('keydown',event=>{
          if(event.key === 'Escape') {closeMenu(); trigger.focus();}
          if(event.key === 'ArrowDown' && event.target === trigger) {event.preventDefault();choices.hidden = false;trigger.setAttribute('aria-expanded','true');choices.querySelector('button')?.focus();}
        });
        dropdown.append(trigger,choices); statusArea.append(dropdown); body.append(statusArea);
        if(savedStatus === 'Falhou') {
          const adjust = button('Ajustar',()=>openStatusEditor('Falhou',adjust,true),'production-adjust-hours');
          statusArea.append(adjust);
        }
        function openStatusEditor(value,trigger,adjustHours = false) {
          if(panel.dataset.statusSaving === 'true' || (value === savedStatus && !adjustHours)) return;
          panel.querySelectorAll('.production-status-editor').forEach(editor=>editor.remove());
          const quick = node('form','production-status-editor');
          const select = {value,disabled:false};
          const fields = node('div','production-status-fields');
          const error = node('p','production-status-error'); error.setAttribute('role','alert');
          const save = node('button','primary-button','Salvar status'); save.type = 'submit'; save.hidden = true;
          const cancel = button('Cancelar',()=>{quick.remove();trigger.focus();},'ghost-light-button');
          const actions = node('div','row-actions'); actions.append(cancel,save);
          quick.append(fields,error,actions); statusArea.append(quick);
          let entries = [];
          async function persist() {
            try {
              const changed = items.map((original,i)=>{
                const entry = entries[i] || {};
                return {...original,...(entry.waste ? {waste:entry.waste.value} : {}),...(select.value === 'Falhou' ? {failureWaste:entry.failureWaste ? entry.failureWaste.value : original.plannedUsed ?? original.used} : {}),...(entry.failure ? {failureHours:entry.failure.value} : select.value === 'Falhou' ? {failureHours:original.plannedHours ?? original.hours ?? 0} : {}),...(entry.hours ? {plannedHours:entry.hours.value} : {})};
              });
              const next = applyProductionOutcome(changed,select.value), totals = productionTotals(next);
              select.disabled = true; cancel.disabled = true; panel.dataset.statusSaving = 'true';
              panel.querySelectorAll('.production-status-button').forEach(b=>b.disabled = true);
              await saveRow('producao',row.rowNumber,{...row.data,'Status da produção':select.value,'Itens da produção':JSON.stringify(next),'Desperdício (g)':String(totals.waste),'Peso (g)':String(totals.used+totals.waste),'Custo do filamento (R$)':String(totals.total),'Custo de máquinas (R$)':String(totals.machineCost)},save);
              // A falha de gravação é apresentada pelo saveRow; mantenha a opção de tentar novamente.
              if(quick.isConnected) {panel.dataset.statusSaving = 'false';select.disabled = false;cancel.disabled = false;save.hidden = false;panel.querySelectorAll('.production-status-button').forEach(b=>b.disabled = false);}
            } catch(e) { error.textContent = e.message; }
          }
          const prepare = () => {
            fields.replaceChildren(); error.textContent = ''; entries = []; save.hidden = true;
            if(select.value === savedStatus && !adjustHours) return;
            items.forEach(original=>{
              const entry = {}; entries.push(entry);
              const group = node('div','production-status-item');
              const add = (key,title,value) => {
                const wrap = node('label','field',title); const input = node('input'); input.type = 'text'; input.inputMode = 'decimal'; input.required = true; input.value = value; entry[key] = input; wrap.append(input); group.append(wrap);
              };
              if(select.value === 'Parcial') add('waste',`Filamento descartado (g) · máximo ${num(original.plannedUsed ?? original.used)} g`,savedStatus === 'Parcial' ? original.waste : '');
              if(select.value === 'Falhou' && adjustHours) {
                add('failure','Horas gastas até interromper (h)',original.failureHours ?? original.hours ?? '');
                add('failureWaste',`Filamento desperdiçado (g) · máximo ${num(original.plannedUsed ?? original.used)} g`,original.failureWaste ?? original.waste);
              }
              if(['Concluída','Parcial'].includes(select.value) && original.machineRow && !(Number(original.plannedHours ?? original.hours) > 0)) add('hours','Tempo total na máquina (h)','');
              if(group.children.length) {group.prepend(node('strong','',original.name || original.sku || 'Produção'));fields.append(group);}
            });
            if(fields.children.length) {
              if(select.value === 'Falhou') fields.prepend(node('p','','Informe o tempo e o filamento realmente gastos até interromper. Os custos serão recalculados.'));
              save.hidden = false;
              fields.querySelector('input')?.focus();
            } else persist();
          };
          quick.addEventListener('submit',event=>{event.preventDefault();if(!select.disabled && (select.value !== savedStatus || adjustHours)) persist();});
          prepare();
        }
        const materialCost = Number(item.total) || 0, machineCost = Number(item.machineCost) || 0;
        body.append(node('strong','production-detail-total',`${savedStatus === 'Em produção' ? 'Total previsto' : 'Total gasto'}: ${money(materialCost + machineCost)}`));
        const calculation = node('div','production-detail-calculation');
        calculation.append(node('h5','production-calculation-title','Composição do custo'));
        const totalGrams = Number(item.used) + Number(item.waste);
        const unitGrams = materials.reduce((n,m)=>n+(Number(m.gramsPerUnit)||0),0);
        materials.forEach(m=>{
          const kg = unitGrams > 0 ? totalGrams * Number(m.gramsPerUnit) / unitGrams / 1000 : 0;
          calculation.append(node('p','',`${materials.length === 1 ? filament : m.name || 'Filamento'}: ${num(kg,4)} kg × ${money(m.kgPrice)}/kg = ${money(kg * Number(m.kgPrice))}`));
        });
        if(item.machineRow != null) calculation.append(node('p','',`Máquina ${item.machineName || item.machineRow}: ${num(item.hours)} h${item.machineRate == null ? ' · custo por hora não informado' : ` × ${money(item.machineRate)}/h = ${money(machineCost)}`}`));
        calculation.append(node('p','',`${money(materialCost)} de filamento + ${money(machineCost)} de máquina = ${money(materialCost + machineCost)}`));
        calculation.append(node('p','',`Desperdício: ${num(item.waste)} g`));
        detail.append(body,calculation);
        grid.append(detail);
      });
      else Object.entries(row.data).filter(([,v])=>v).forEach(([label,value]) => grid.append(cell(label,value)));
      panel.append(grid);
      if (row.data.Observações) panel.append(node('p','machine-formula',row.data.Observações));
      const actions = node('div','production-record-actions');
      actions.append(button('Fazer alterações',()=>{state.editingProduction.add(key);render();}));
      panel.append(actions);
      return;
    }
    const form = node('form','production-form');
    const field = (label, type, value) => { const wrap=node('label','field');wrap.append(node('span','',label)); const input=node('input'); input.type=type; input.value=value; wrap.append(input);return {wrap,input}; };
    const day=field('Data da produção','date',row.data['Dia produção'] || todayInputValue());day.input.required=true;
    const notes=field('Observações','text',row.data.Observações || '');
    const statusLabel = node('label','field'); statusLabel.append(node('span','','Status da produção'));
    const status = node('select'); PRODUCTION_STATUSES.forEach(value=>status.append(new Option(value,value))); status.value=savedStatus; statusLabel.append(status);
    form.append(day.wrap,statusLabel);
    if (items) items = items.map(productionDraftItem);
    if (!items && !draft) form.append(node('p','machine-formula','Registro antigo: selecione os produtos e quantidades para calcular o consumo. Os dados anteriores serão preservados.'));
    const list=node('div','production-items'); form.append(list);
    const entries=[];
    const output=node('div','machine-result');
    const readEntry = entry => {
      if (entry.read) return entry.read();
      let item;
      if (entry.snapshot && entry.select.value === String(entry.snapshot.productRow) && entry.quantity.value === String(entry.snapshot.quantity)) item = {...entry.snapshot, waste: 0};
      else {
        const product=state.productionProducts.find(p=>String(p.rowNumber)===entry.select.value);
        if (!product) throw new Error('Selecione um produto.');
        item = productionItem(product, state.productCosts[productKey(product)], entry.quantity.value, '0');
      }
      const machineId = entry.machine.value;
      const hours = machineNumber(entry.hours.value || '0');
      if (!Number.isFinite(hours) || hours < 0) throw new Error('Informe um tempo válido em horas.');
      if (!machineId && hours > 0) throw new Error('Selecione a máquina utilizada para registrar as horas.');
      if (machineId && ['Concluída','Parcial'].includes(status.value) && !entry.hours.value.trim()) throw new Error('Informe o tempo de uso da máquina.');
      if (machineId && String(entry.snapshot?.machineRow) === machineId && Number(entry.snapshot.hours) === hours) {
        return {...item, machineRow: entry.snapshot.machineRow, machineName: entry.snapshot.machineName, hours, machineRate: entry.snapshot.machineRate, machineCost: entry.snapshot.machineCost || 0};
      }
      const machine = state.productionMachines.find(m=>String(m.rowNumber)===machineId);
      if (machineId && !machine) throw new Error('Selecione uma máquina disponível.');
      const rate = machine ? calculateMachineCost(normalizeMachineData(machine.data)) : null;
      return {...item, machineRow: machine?.rowNumber ?? null, machineName: machine?.data['Nome da máquina'] || '', hours, machineRate: rate, machineCost: rate === null ? 0 : rate * hours};

    };
    const outcomeFields = (entry, snapshot) => {
      const waste = field('Filamento descartado (g)','text',snapshot?.waste ?? '0'); waste.input.inputMode='decimal';
      const failure = field('Horas gastas até interromper (h)','text',snapshot?.failureHours ?? ''); failure.input.inputMode='decimal';
      entry.waste = waste.input; entry.wasteWrap = waste.wrap; entry.failure = failure.input; entry.failureWrap = failure.wrap;
      const filament = field('Filamento usado (material / modelo)','text',snapshot?.filamentLabel || '');
      filament.input.placeholder = 'Ex.: PETG · vazio usa os materiais do produto';
      const color = field('Cor do filamento','text',snapshot?.filamentColor || '');
      color.input.placeholder = 'Ex.: Branco'; entry.color = color.input;
      const failureWaste = field('Filamento desperdiçado (g)','text',snapshot?.failureWaste ?? '');
      failureWaste.input.placeholder = 'Vazio: 100% do filamento previsto'; failureWaste.input.inputMode = 'decimal';
      entry.failureWaste = failureWaste.input; entry.failureWasteWrap = failureWaste.wrap;
      entry.filament = filament.input;
      entry.wrap.append(filament.wrap,color.wrap,waste.wrap,failure.wrap,failureWaste.wrap);
    };
    const readOutcomes = () => applyProductionOutcome(entries.map(entry=>({...readEntry(entry), filamentLabel: entry.filament.value.trim(), filamentColor: entry.color.value.trim(), waste: status.value === 'Parcial' ? entry.waste.value : 0, failureHours: entry.failure.value, failureWaste: entry.failureWaste.value.trim() || undefined})),status.value);
    const refresh=()=>{
      entries.forEach(entry=>{
        entry.wasteWrap.hidden = status.value !== 'Parcial';
        entry.failureWrap.hidden = status.value !== 'Falhou';
        entry.failureWasteWrap.hidden = status.value !== 'Falhou';
        entry.waste.required = status.value === 'Parcial';
        entry.failure.required = status.value === 'Falhou';
        if (entry.hours) entry.hours.required = ['Concluída','Parcial'].includes(status.value) && Boolean(entry.machine?.value || entry.read);
      });
      try { const t=productionTotals(readOutcomes()); output.textContent=`Filamento total: ${num((t.used+t.waste)/1000,3)} kg · Desperdício: ${num(t.waste)} g · Filamento: ${money(t.total)} · Máquinas: ${money(t.machineCost)} · Total: ${money(t.total+t.machineCost)}${status.value === 'Em produção' ? ' · Horas ainda não somadas à máquina' : ''}`; } catch(e) {output.textContent=e.message;}
    };
    status.addEventListener('change',refresh);

    const addItem = snapshot => {
      const wrap=node('div','production-item'); const label=node('label','field');label.append(node('span','','Produto / SKU')); const select=node('select');select.required=true;select.append(new Option('Selecione um produto',''));
      state.productionProducts.forEach(p=>select.append(new Option(`${p.data.SKU || 'Sem SKU'} · ${p.data.Produto}`,String(p.rowNumber))));
      if(snapshot && !state.productionProducts.some(p=>p.rowNumber===snapshot.productRow)) select.append(new Option(`${snapshot.sku} · ${snapshot.name} (arquivado)`,String(snapshot.productRow)));
      select.value=snapshot ? String(snapshot.productRow) : ''; label.append(select);
      const quantity=field('Quantidade produzida (un)','number',snapshot?.quantity ?? '1');quantity.input.min='1';quantity.input.step='1';quantity.input.required=true;

      const machineLabel = node('label','field'); machineLabel.append(node('span','','Máquina utilizada'));
      const machine = node('select'); machine.append(new Option('Sem máquina vinculada',''));
      state.productionMachines.forEach(m=>machine.append(new Option(m.data['Nome da máquina'] || 'Sem nome',String(m.rowNumber))));
      if(snapshot?.machineRow != null && !state.productionMachines.some(m=>String(m.rowNumber)===String(snapshot.machineRow))) machine.append(new Option(`${snapshot.machineName} (arquivada)`,String(snapshot.machineRow)));
      machine.value = snapshot?.machineRow == null ? '' : String(snapshot.machineRow); machineLabel.append(machine);
      const hours = field('Tempo total na máquina (h)','text',snapshot?.hours ?? ''); hours.input.inputMode='decimal'; hours.input.placeholder='Ex.: 13 ou 1,5';
      const entry={select,quantity:quantity.input,snapshot,wrap,machine,hours:hours.input}; outcomeFields(entry,snapshot); entries.push(entry);
      wrap.append(label,quantity.wrap,machineLabel,hours.wrap,button('Remover',()=>{if(!draft && snapshot) {removeProductionItem(row.rowNumber,items.indexOf(snapshot));return;}entries.splice(entries.indexOf(entry),1);wrap.remove();refresh();},'danger-button'));
      wrap.addEventListener('input',refresh);list.append(wrap);refresh();
    };
    const addManual = snapshot => {
      if (!snapshot && entries.length === 1 && entries[0].select?.value === '' && !entries[0].snapshot) entries.pop().wrap.remove();
      const wrap = node('div','production-item production-manual');
      wrap.append(node('h4','','Produção avulsa / protótipo'));
      const name = field('Nome do que foi produzido','text',snapshot?.name || ''); name.input.required = true;
      const grams = field('Filamento utilizado (g)','text',snapshot?.used ?? '');
      const price = field('Preço do filamento (R$/kg)','text',snapshot?.materials?.[0]?.kgPrice ?? '');
      const hours = field('Tempo de uso da máquina (h)','text',snapshot?.hours ?? '');
      [grams,price,hours].forEach(f => {f.input.inputMode='decimal';f.input.required=true;});
      const label=node('label','field'); label.append(node('span','','Máquina utilizada'));
      const select=node('select'); select.required=true; select.append(new Option('Selecione uma máquina',''));
      state.productionMachines.forEach(machine=>select.append(new Option(machine.data['Nome da máquina'] || 'Sem nome',String(machine.rowNumber))));
      if(snapshot && !state.productionMachines.some(m=>String(m.rowNumber)===String(snapshot.machineRow))) select.append(new Option(`${snapshot.machineName} (arquivada)`,String(snapshot.machineRow)));
      select.value=snapshot ? String(snapshot.machineRow) : ''; label.append(select);
      const original = () => snapshot && name.input.value===snapshot.name && grams.input.value===String(snapshot.used) && price.input.value===String(snapshot.materials[0].kgPrice) && hours.input.value===String(snapshot.hours) && select.value===String(snapshot.machineRow);
      const entry={wrap,hours:hours.input,read:()=> original() ? snapshot : manualProductionItem({name:name.input.value,grams:grams.input.value,price:price.input.value,hours:hours.input.value || '0'},state.productionMachines.find(m=>String(m.rowNumber)===select.value))};
      outcomeFields(entry,snapshot); entries.push(entry);
      wrap.append(name.wrap,grams.wrap,price.wrap,label,hours.wrap,button('Remover',()=>{if(!draft && snapshot) {removeProductionItem(row.rowNumber,items.indexOf(snapshot));return;}entries.splice(entries.indexOf(entry),1);wrap.remove();refresh();},'danger-button'));
      wrap.addEventListener('input',refresh); list.append(wrap); refresh();
    };
    (items?.length ? items : [null]).forEach(item => item?.type === 'manual' ? addManual(item) : addItem(item));
    form.append(button('Adicionar produção avulsa',()=>addManual(null),'ghost-light-button production-add-product'));

    form.append(button('Adicionar produto',()=>addItem(null),'ghost-light-button production-add-product'),notes.wrap,output,node('p','machine-formula','O consumo vem da calculadora: gramas do lote ÷ unidades do lote × quantidade produzida. Concluída: desperdício zero. Parcial: informe a parte do filamento descartada. Falhou: informe as horas e o filamento realmente gastos; sem ajuste, o desperdício é 100% do previsto. Em produção: as horas ficam pendentes. O tempo da máquina é o total deste item, não por unidade. Se vários produtos compartilharam uma impressão, distribua o tempo entre eles para não duplicar horas.'));
    const actions=node('div','row-actions');
    actions.append(button(draft?'Cancelar':'Cancelar edição',()=>{if(draft) state.draft=null;state.editingProduction.delete(key);render();},'ghost-light-button'));
    if(!draft) actions.append(button('Remover produção',()=>deleteRow('producao',row.rowNumber),'danger-button'));
    const save=node('button','primary-button',draft?'Salvar produção':'Salvar alterações');save.type='submit'; actions.append(save);form.append(actions);
    form.addEventListener('submit',async event=>{event.preventDefault();try {
      if(!entries.length) throw new Error('Adicione pelo menos um produto.');
      const next=readOutcomes(), t=productionTotals(next);
      state.expanded.add(`production-day:${day.input.value}`);
      await saveRow('producao',row.rowNumber,{...row.data,'Status da produção':status.value,'Dia produção':day.input.value,'Itens da produção':JSON.stringify(next),'Quantidade produzida':String(t.quantity),'Peso (g)':String(t.used+t.waste),'Desperdício (g)':String(t.waste),'Custo do filamento (R$)':String(t.total),'Custo de máquinas (R$)':String(t.machineCost),'Código do produto':next.map(i=>i.sku || i.name).join(', '),Observações:notes.input.value},save);
    }catch(e){output.textContent=e.message;}});
    panel.append(form);
    });
  });
}
