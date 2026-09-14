export function dailyReportStats(rows) {
  const stats = {grams:0,waste:0,filamentCost:0,machineCost:0,hours:0,units:0,pendingGrams:0,pendingHours:0,missing:0,statuses:{'Em produção':0,'Concluída':0,'Parcial':0,'Falhou':0},machines:[],products:[]};
  const machines = new Map(), products = new Map();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  for(const row of rows.filter(row=>row.rowNumber !== null)) {
    const status = row.data['Status da produção'] || 'Concluída';
    stats.statuses[status] = (stats.statuses[status] || 0) + 1;
    let items;
    try {items = JSON.parse(row.data['Itens da produção']); if(!Array.isArray(items)) throw new Error();}
    catch {stats.missing++;continue;}
    for(const item of items) {
      const grams = number(item.used)+number(item.waste), hours = number(item.hours), pending = status === 'Em produção';
      if(pending) {stats.pendingGrams+=grams;stats.pendingHours+=number(item.plannedHours ?? item.hours);}
      else {
        stats.grams+=grams; stats.waste+=number(item.waste); stats.hours+=hours;
        stats.filamentCost+=number(item.total);stats.machineCost+=number(item.machineCost);
        if(status === 'Concluída' && item.type !== 'manual') stats.units+=number(item.quantity);
      }
      if(item.machineRow != null) {
        const key = String(item.machineRow);
        if(!machines.has(key)) machines.set(key,{name:item.machineName || key,hours:0,pending:0,cost:0,grams:0,failedHours:0,items:0});
        const machine = machines.get(key);
        if(pending) machine.pending+=number(item.plannedHours ?? item.hours);
        else {machine.hours+=hours;machine.cost+=number(item.machineCost);machine.grams+=grams;machine.items++;if(status === 'Falhou') machine.failedHours+=hours;}
      }
      if(!pending) {
        const key = item.type === 'manual' ? `manual:${item.name}` : item.sku || String(item.productRow);
        if(!products.has(key)) products.set(key,{name:item.name || item.sku || 'Produção',sku:item.sku || '',grams:0,cost:0});
        const product=products.get(key);product.grams+=grams;product.cost+=number(item.total)+number(item.machineCost);
      }
    }
  }
  stats.machines=[...machines.values()].sort((a,b)=>b.hours-a.hours);
  stats.products=[...products.values()].sort((a,b)=>b.grams-a.grams);
  return stats;
}

export function showDailyReport(group,{money,num,date}) {
  const stats=dailyReportStats(group.rows);
  const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls || '';if(text!==undefined) node.textContent=text;return node;};
  const dialog=el('dialog','daily-report');dialog.setAttribute('aria-label',`Relatório de produção de ${date(group.day)}`);
  const header=el('header','daily-report-header');
  header.append(el('strong','daily-report-title',`RELATÓRIO DO DIA · ${date(group.day)}`));
  const close=el('button','daily-report-close','Fechar'); close.type='button';close.addEventListener('click',()=>dialog.close());header.append(close);
  dialog.append(header,el('h2','','Produção em números'),el('p','report-note','Consumo, custos e horas abaixo consideram produções finalizadas. As horas são atribuídas à data registrada no lote.'));
  if(stats.missing) dialog.append(el('p','report-note',`${stats.missing} registro(s) antigo(s) sem detalhes: totais incompletos.`));
  const metrics=el('div','daily-report-metrics');
  const metric=(label,value)=>{const card=el('div','report-metric');card.append(el('span','',label),el('strong','',value));metrics.append(card);};
  metric('Filamento utilizado',`${num(stats.grams/1000,3)} kg`);
  metric('Horas de máquinas',`${num(stats.hours)} h`);
  metric('Custo total registrado',money(stats.filamentCost+stats.machineCost));
  metric('Desperdício',`${num(stats.waste/1000,3)} kg · ${num(stats.grams ? stats.waste/stats.grams*100 : 0,1)}%`);
  metric('Custo de filamento',money(stats.filamentCost));metric('Custo de máquinas',money(stats.machineCost));
  metric('Unidades em lotes concluídos',num(stats.units,0));
  metric('Em produção (previsão)',`${num(stats.pendingGrams/1000,3)} kg · ${num(stats.pendingHours)} h`);
  dialog.append(metrics);
  const charts=el('div','daily-report-charts');
  function chart(title,values,format) {
    const section=el('section',`report-chart${title === 'Composição dos custos' ? ' report-cost-chart' : ''}`);section.append(el('h3','',title));
    const max=Math.max(1,...values.map(value=>value.amount));
    values.forEach(value=>{
      const row=el('div','report-bar-row');const label=el('div','report-bar-label');label.append(el('span','',value.name),el('strong','',format(value.amount)));
      const track=el('div','report-bar-track');const fill=el('div',`report-bar-fill ${value.tone || ''}`);fill.style.width=`${Math.max(0,value.amount/max*100)}%`;track.append(fill);row.append(label,track);section.append(row);
    });
    if(!values.length) section.append(el('p','report-note','Nenhum dado finalizado neste dia.'));
    charts.append(section);
  }
  chart('Horas por máquina',stats.machines.map(m=>({name:`Máquina ${m.name}`,amount:m.hours})),v=>`${num(v)} h`);
  chart('Resultado das produções',Object.entries(stats.statuses).map(([name,amount])=>({name,amount,tone:name === 'Falhou' ? 'failed' : name === 'Parcial' ? 'partial' : name === 'Concluída' ? 'success' : ''})),v=>num(v,0));
  chart('Consumo por produto',stats.products.map(p=>({name:`${p.sku ? p.sku+' · ' : ''}${p.name}`,amount:p.grams/1000})),v=>`${num(v,3)} kg`);
  chart('Composição dos custos',[{name:'Filamento',amount:stats.filamentCost},{name:'Máquinas',amount:stats.machineCost}],money);
  dialog.append(charts,el('h3','','Detalhamento por máquina'));
  const machines=el('div','report-machine-grid');
  stats.machines.forEach(machine=>{
    const card=el('section','report-machine');card.append(el('h4','',`Máquina ${machine.name}`),el('strong','report-machine-hours',`${num(machine.hours)} h`),el('p','',`${num(machine.grams/1000,3)} kg de filamento · ${money(machine.cost)} de máquina`),el('p','',`${machine.items} item(ns) finalizado(s) · ${num(machine.failedHours)} h em produções que falharam`));
    if(machine.pending) card.append(el('p','report-note',`${num(machine.pending)} h previstas em andamento`));machines.append(card);
  });
  if(!stats.machines.length) machines.append(el('p','report-note','Nenhuma máquina vinculada aos registros do dia.'));
  dialog.append(machines);
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
