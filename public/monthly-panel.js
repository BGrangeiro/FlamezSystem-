import {maintenanceProgress} from './machine-costs.js';
export function monthlyStats(rows, month, throughDay = 31) {
  const result={finished:0,pending:0,failed:0,partial:0,units:0,grams:0,waste:0,filamentCost:0,machineCost:0,wasteCost:0,hours:0,unparsed:0,activeDays:new Set(),daily:new Map(),machines:new Map()};
  for(const row of rows){
    let date=String(row.data['Dia produção'] || '');
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(date)) date=date.split('/').reverse().join('-');
    if(date.slice(0,7)!==month || Number(date.slice(8,10)) > throughDay)continue;
    const status=row.data['Status da produção'] || 'Concluída';
    if(status==='Em produção'){result.pending++;continue;}
    result.finished++;
    if(status==='Falhou')result.failed++;
    if(status==='Parcial')result.partial++;
    let items;try{items=JSON.parse(row.data['Itens da produção']);if(!Array.isArray(items))throw new Error();}catch{result.unparsed++;continue;}
    if(items.length) result.activeDays.add(date.slice(0,10));
    const daily=result.daily.get(Number(date.slice(8,10))) || {grams:0,hours:0,cost:0,units:0};
    for(const item of items){
      const used=Number(item.used)||0,waste=Number(item.waste)||0,cost=Number(item.total)||0,hours=Number(item.hours)||0;
      if(status==='Concluída' && item.type !== 'manual') {result.units+=Number(item.quantity)||0;daily.units+=Number(item.quantity)||0;}
      daily.grams+=used+waste;daily.hours+=hours;daily.cost+=cost+(Number(item.machineCost)||0);
      result.grams+=used+waste;result.waste+=waste;result.filamentCost+=cost;result.machineCost+=Number(item.machineCost)||0;result.hours+=hours;
      result.wasteCost+=(used+waste)>0?cost*waste/(used+waste):0;
      if(item.machineRow!=null){const key=String(item.machineRow);const value=result.machines.get(key)||{name:item.machineName||key,hours:0,cost:0};value.hours+=hours;value.cost+=Number(item.machineCost)||0;result.machines.set(key,value);}
    }
    result.daily.set(Number(date.slice(8,10)),daily);
  }
  return result;
}

export function shiftMonth(month,offset) {
  const [year,m]=month.split('-').map(Number);const date=new Date(year,m-1+offset,1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
export function monthlyProjection(stats,month,today) {
  const elapsed=Number(today.slice(8,10));const [year,m]=month.split('-').map(Number);
  if(month!==today.slice(0,7) || !stats.activeDays.size) return null;
  const days=new Date(year,m,0).getDate(),factor=days/elapsed;
  return {days,elapsed,grams:stats.grams*factor,hours:stats.hours*factor,cost:(stats.filamentCost+stats.machineCost)*factor,units:stats.units*factor};
}

export function renderMonthlyPanel({state,elements,formatMoney:money,formatNumber:num,todayInputValue}) {
  const ctx={state,elements,formatMoney:money,formatNumber:num,todayInputValue};
  const redraw=()=>renderMonthlyPanel(ctx);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const button=(label,action,cls='dash-button')=>{const n=el('button',cls,label);n.type='button';n.addEventListener('click',action);return n;};
  const today=todayInputValue(),current=today.slice(0,7),month=state.dashboardMonth || current;
  const reference=state.dashboardCompareMonth || shiftMonth(month,-1),compare=state.dashboardCompare !== false;
  const isCurrent=month===current,limit=isCurrent ? Number(today.slice(8,10)) : 31;
  const matched=state.dashboardMatched !== false;
  const stats=monthlyStats(state.rows,month,limit),previous=monthlyStats(state.rows,reference,matched?limit:31);
  const projection=monthlyProjection(stats,month,today);
  const monthName=m=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1));
  const total=s=>s.filamentCost+s.machineCost;
  const rate=s=>s.grams ? s.waste/s.grams*100 : 0;
  const success=s=>s.finished ? (s.finished-s.failed-s.partial)/s.finished*100 : 0;
  const root=el('div','month-dashboard');elements.content.replaceChildren(root);
  const hero=el('section','dash-hero');
  const intro=el('div');intro.append(el('span','dash-eyebrow','FLAMEZ 3D / INTELIGÊNCIA DE PRODUÇÃO'),el('h2','','Sua produção em perspectiva.'),el('p','',`${monthName(month)} · ${isCurrent?'Acompanhamento até hoje':'Histórico de produção'}`));
  hero.append(intro,el('span','dash-hero-badge',`${stats.activeDays.size} ${stats.activeDays.size === 1 ? 'dia' : 'dias'} com produção finalizada`));root.append(hero);
  const filters=el('div','dash-filters');
  function monthField(title,value,action) {const label=el('label','dash-field',title);const input=el('input');input.type='month';input.value=value;input.max=current;input.addEventListener('change',()=>{if(input.value && input.value<=current)action(input.value);});label.append(input);return label;}
  filters.append(monthField('Mês de referência',month,value=>{state.dashboardMonth=value;redraw();}));
  const comparison=el('label','dash-checkbox');const check=el('input');check.type='checkbox';check.checked=compare;check.addEventListener('change',()=>{state.dashboardCompare=check.checked;redraw();});comparison.append(check,el('span','','Comparar meses'));filters.append(comparison);
  if(compare) {
    filters.append(monthField('Comparar com',reference,value=>{state.dashboardCompareMonth=value;redraw();}));
    const period=el('label','dash-field','Período comparado');const select=el('select');select.append(new Option('Mesmos dias do mês','matched'),new Option('Mês comparado completo','full'));select.value=matched?'matched':'full';select.addEventListener('change',()=>{state.dashboardMatched=select.value==='matched';redraw();});period.append(select);filters.append(period);
  }
  root.append(filters);
  if(compare) root.append(el('p','dash-caption',`Comparação com ${monthName(reference)}${matched && isCurrent ? `, até o dia ${limit}` : ', mês completo'}. Variações de consumo e custo indicam volume, não lucro.`));
  if(stats.unparsed || (compare && previous.unparsed)) root.append(el('p','dash-notice','Há registros antigos sem detalhes de consumo. Os indicadores podem estar incompletos.'));
  const delta=(value,old)=>old ? `${value>=old?'+':''}${num((value-old)/old*100,1)}%` : value ? 'Sem base anterior' : 'Sem variação';
  const metrics=el('div','dash-kpis');
  for(const [label,value,old,format] of [
    ['Peças concluídas',stats.units,previous.units,v=>num(v,0)],['Filamento consumido',stats.grams,previous.grams,v=>`${num(v/1000,3)} kg`],
    ['Horas de máquinas',stats.hours,previous.hours,v=>`${num(v)} h`],['Custo de produção',total(stats),total(previous),money]
  ]) {const card=el('article','dash-kpi');card.append(el('span','dash-kpi-label',label),el('strong','dash-kpi-value',format(value)));if(compare)card.append(el('span','dash-delta',`${delta(value,old)} · anterior: ${format(old)}`));metrics.append(card);}
  root.append(metrics);
  const insights=el('div','dash-insights');
  insights.append(el('p','',`${stats.finished} lotes finalizados · ${stats.pending} em produção`),el('p','',`Conclusão integral: ${num(success(stats),1)}% dos lotes finalizados`),el('p','',`Desperdício: ${num(stats.waste/1000,3)} kg (${num(rate(stats),1)}%) · ${money(stats.wasteCost)} em filamento`));root.append(insights);
  const grid=el('div','dash-grid');root.append(grid);
  const panel=(title,subtitle,cls='')=>{const section=el('section',`dash-panel ${cls}`);section.append(el('h3','',title));if(subtitle)section.append(el('p','dash-caption',subtitle));return section;};
  const trend=panel('Ritmo de produção','Evolução acumulada por dia do mês.','dash-trend');
  const mode=state.dashboardChart || 'grams';
  const config={grams:{label:'Filamento',format:v=>`${num(v/1000,3)} kg`},hours:{label:'Horas',format:v=>`${num(v)} h`},cost:{label:'Custos',format:money},units:{label:'Peças',format:v=>num(v,0)}};
  const tabs=el('div','dash-chart-tabs');Object.entries(config).forEach(([key,c])=>{const b=button(c.label,()=>{state.dashboardChart=key;redraw();},`dash-button ${mode===key?'selected':''}`);b.setAttribute('aria-pressed',String(mode===key));tabs.append(b);});trend.append(tabs);
  const days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
  const points=(s,count)=>{let sum=0;return Array.from({length:count},(_,i)=>{sum+=s.daily.get(i+1)?.[mode] || 0;return sum;});};
  const actual=points(stats,Math.min(days,limit));
  const priorDays=new Date(Number(reference.slice(0,4)),Number(reference.slice(5,7)),0).getDate();
  const prior=compare?points(previous,Math.min(days,priorDays,matched?limit:31)):[];
  const max=Math.max(1,...actual,...prior),width=760,height=245,left=70,top=20,bottom=35;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Gráfico acumulado de ${config[mode].label}, ${monthName(month)}${compare?' comparado a '+monthName(reference):''}`);svg.classList.add('dash-line-chart');
  const shape=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(text!==undefined)n.textContent=text;svg.append(n);return n;};
  const x=i=>left+i/Math.max(1,days-1)*(width-left-20),y=v=>height-bottom-v/max*(height-top-bottom);
  for(let i=0;i<4;i++){const value=max*i/3;shape('line',{x1:left,x2:width-20,y1:y(value),y2:y(value),stroke:'#e3e7f3'});shape('text',{x:left-8,y:y(value)+4,'text-anchor':'end',fill:'#646b86','font-size':11},mode==='grams'?`${num(value/1000,2)} kg`:mode==='cost'?`R$ ${num(value,0)}`:num(value,0));}
  [1,Math.round(days/2),days].forEach(day=>shape('text',{x:x(day-1),y:height-9,'text-anchor':'middle',fill:'#646b86','font-size':11},String(day)));
  function line(values,color,dashed=false){if(!values.length)return;shape('polyline',{points:values.map((v,i)=>`${x(i)},${y(v)}`).join(' '),fill:'none',stroke:color,'stroke-width':3,...(dashed?{'stroke-dasharray':'6 5'}:{})});values.forEach((v,i)=>{const dot=shape('circle',{cx:x(i),cy:y(v),r:3,fill:color});const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`Dia ${i+1}: ${config[mode].format(v)}`;dot.append(title);});}
  line(prior,'#a5adca',true);line(actual,'#1c31a5');trend.append(svg);
  trend.append(el('p','dash-caption',`● ${monthName(month)}${compare?'   ┄ '+monthName(reference):''}`));
  const data=el('details','dash-data');data.append(el('summary','','Ver dados do gráfico'));const table=el('table');const head=el('tr');['Dia',monthName(month),...(compare?[monthName(reference)]:[])].forEach(t=>head.append(el('th','',t)));table.append(head);
  for(let i=0;i<Math.max(actual.length,prior.length);i++){const row=el('tr');[i+1,actual[i]===undefined?'—':config[mode].format(actual[i]),...(compare?[prior[i]===undefined?'—':config[mode].format(prior[i])]:[])].forEach(t=>row.append(el('td','',t)));table.append(row);}data.append(table);trend.append(data);grid.append(trend);
  const outlook=panel('Projeção de fechamento','Estimativa pelo ritmo médio dos dias corridos.','dash-outlook');
  if(projection){for(const [label,value] of [['Filamento',`${num(projection.grams/1000,3)} kg`],['Horas',`${num(projection.hours)} h`],['Custo estimado',money(projection.cost)],['Peças',num(projection.units,0)]]){const row=el('div','dash-forecast-row');row.append(el('span','',label),el('strong','',value));outlook.append(row);}outlook.append(el('p','dash-caption',`Realizado ÷ ${projection.elapsed} dias × ${projection.days} dias. ${stats.activeDays.size<3?'Poucos dias com registros: estimativa preliminar.':'A estimativa depende da continuidade do ritmo atual.'}`));}
  else outlook.append(el('p','dash-empty',isCurrent?'Registre uma produção finalizada para visualizar a projeção.':'Projeções disponíveis para o mês atual. Este período mostra resultados registrados.'));
  grid.append(outlook);
  function bars(section,values,format){const max=Math.max(1,...values.map(v=>v.value));for(const value of values){const row=el('div','dash-bar-row');const label=el('div','dash-bar-label');label.append(el('span','',value.label),el('strong','',format(value.value)));const track=el('div','dash-bar-track'),fill=el('div',`dash-bar-fill ${value.tone||''}`);fill.style.width=`${Math.max(0,value.value/max*100)}%`;track.append(fill);row.append(label,track);section.append(row);}if(!values.length)section.append(el('p','dash-empty','Nenhum registro neste período.'));}
  const history=panel('Últimos seis meses','Custos registrados em cada mês; o mês atual pode estar incompleto.','dash-history');
  bars(history,Array.from({length:6},(_,i)=>{const m=shiftMonth(month,i-5);return {label:monthName(m),value:total(monthlyStats(state.rows,m,m===current?limit:31)),tone:m===month?'':'muted'};}),money);grid.append(history);
  const quality=panel('Qualidade da produção','Distribuição dos lotes e consumo de filamento.','dash-quality');
  bars(quality,[{label:'Concluída',value:stats.finished-stats.failed-stats.partial,tone:'green'},{label:'Parcial',value:stats.partial,tone:'amber'},{label:'Falhou',value:stats.failed,tone:'red'},{label:'Em produção',value:stats.pending}],v=>num(v,0));
  quality.append(el('p','dash-caption',`Aproveitamento do filamento: ${num(stats.grams?(stats.grams-stats.waste)/stats.grams*100:0,1)}%. ${compare?`Desperdício no período comparado: ${num(rate(previous),1)}%.`:''}`));grid.append(quality);
  const machines=panel('Participação das máquinas','Distribuição do uso no mês selecionado.','dash-machines');
  const machineMode=state.dashboardMachineChart === 'cost' ? 'cost' : 'hours';
  const machineFormat=machineMode==='hours' ? v=>`${num(v)} h` : money;
  const machineTabs=el('div','dash-chart-tabs');
  for(const [key,label] of [['hours','Horas de produção'],['cost','Custo de uso']]) {
    const tab=button(label,()=>{state.dashboardMachineChart=key;redraw();},`dash-button ${machineMode===key?'selected':''}`);
    tab.setAttribute('aria-pressed',String(machineMode===key));machineTabs.append(tab);
  }
  machines.append(machineTabs);
  const palette=['#334dcc','#20a59a','#f0ad45','#8c69cd','#dc708a','#4c96cf','#718448','#ab714d'];
  const machineEntries=[...stats.machines].sort((a,b)=>b[1][machineMode]-a[1][machineMode]);
  const machineColors=new Map([...stats.machines.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map((id,index)=>[id,palette[index%palette.length]]));
  const machineTotal=machineEntries.reduce((sum,[,m])=>sum+Math.max(0,m[machineMode]),0);
  const machineBody=el('div','dash-machine-body');
  const chartWrap=el('div','dash-donut-wrap');
  const pie=document.createElementNS(svg.namespaceURI,'svg');
  pie.setAttribute('viewBox','0 0 240 240');pie.setAttribute('role','img');
  pie.setAttribute('aria-label',`Gráfico de pizza: participação das máquinas por ${machineMode==='hours'?'horas de produção':'custo de uso'}. Total: ${machineFormat(machineTotal)}. Valores na legenda.`);
  pie.classList.add('dash-donut');
  const circle=document.createElementNS(svg.namespaceURI,'circle');
  for(const [key,value] of Object.entries({cx:120,cy:120,r:88,fill:'none',stroke:'#edf0f8','stroke-width':32}))circle.setAttribute(key,value);
  pie.append(circle);
  let offset=0;
  const legend=el('div','dash-machine-legend');
  machineEntries.forEach(([id,machine])=>{
    const name=state.productionMachines.find(m=>String(m.rowNumber)===id)?.data['Nome da máquina']||machine.name;
    const value=Math.max(0,machine[machineMode]),share=machineTotal?value/machineTotal:0;
    const color=machineColors.get(id);
    if(share>0){
      const slice=document.createElementNS(svg.namespaceURI,'circle');
      for(const [key,v] of Object.entries({cx:120,cy:120,r:88,fill:'none',stroke:color,'stroke-width':32,pathLength:100,'stroke-dasharray':`${share*100} ${100-share*100}`,'stroke-dashoffset':-offset,transform:'rotate(-90 120 120)'}))slice.setAttribute(key,v);
      const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${name}: ${machineFormat(value)} (${num(share*100,1)}%)`;slice.append(title);pie.append(slice);
      offset+=share*100;
    }
    const card=el('div','dash-machine');
    const heading=el('div','dash-machine-heading'),swatch=el('span','dash-swatch');swatch.style.background=color;
    heading.append(swatch,el('strong','',name),el('b','dash-machine-share',`${num(share*100,1)}%`));
    card.append(heading,el('span','dash-machine-detail',`${num(machine.hours)} h · ${money(machine.cost)}`));
    if(compare)card.append(el('small','dash-machine-detail',`${delta(machine[machineMode],previous.machines.get(id)?.[machineMode]||0)} ${machineMode==='hours'?'em horas':'em custo'}`));
    legend.append(card);
  });
  const center=el('div','dash-donut-center');center.append(el('strong','',machineFormat(machineTotal)),el('span','',machineMode==='hours'?'horas distribuídas':'custo distribuído'));
  chartWrap.append(pie,center);machineBody.append(chartWrap,legend);machines.append(machineBody);
  if(!machineTotal)machines.append(el('p','dash-empty',`Sem ${machineMode==='hours'?'horas':'custos'} de máquina registrados neste período.`));
  grid.append(machines);
  const maintenance=panel('Próximas manutenções','Visão atual da frota · ciclo preventivo de 400 horas, independente do mês selecionado.','dash-maintenance-panel');
  const maintenanceEntries=state.productionMachines.map(machine=>({machine,progress:maintenanceProgress(machine.data)})).sort((a,b)=>b.progress.hours-a.progress.hours);
  const dueCount=maintenanceEntries.filter(({progress})=>progress.due).length;
  const soonCount=maintenanceEntries.filter(({progress})=>!progress.due && progress.remaining<=80).length;
  const summary=el('div','dash-maintenance-summary');
  for(const [value,label,tone] of [[dueCount,'Precisam de revisão','urgent'],[soonCount,'Próximas do limite','soon'],[maintenanceEntries.length-dueCount-soonCount,'Dentro do ciclo','healthy']]){
    const chip=el('span',`dash-status-summary ${tone}`);chip.append(el('strong','',num(value,0)),el('span','',label));summary.append(chip);
  }
  maintenance.append(summary);
  const maintenanceGrid=el('div','dash-maintenance-grid');
  for(const {machine,progress} of maintenanceEntries){
    const tone=progress.due?'urgent':progress.remaining<=80?'soon':'healthy';
    const row=el('article',`dash-maintenance ${tone}`);
    const heading=el('div','dash-maintenance-heading');
    heading.append(el('strong','',machine.data['Nome da máquina']||'Máquina sem nome'),el('span',`dash-status ${tone}`,progress.due?'Revisão necessária':tone==='soon'?'Revisão próxima':'Em dia'));
    row.append(heading,el('span','dash-maintenance-model',machine.data.Modelo||'Manutenção preventiva'));
    const remaining=el('div','dash-maintenance-remaining');remaining.append(el('strong','',num(progress.remaining)),el('span','','h até a revisão'));row.append(remaining);
    const track=el('div','dash-bar-track'),fill=el('div',`dash-bar-fill ${progress.due?'red':tone==='soon'?'amber':'green'}`);fill.style.width=`${progress.percent}%`;track.append(fill);
    const description=`${num(progress.hours)} de 400 h utilizadas`;
    track.setAttribute('role','progressbar');track.setAttribute('aria-label',`${machine.data['Nome da máquina']}: ${description}`);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(progress.percent));track.setAttribute('aria-valuetext',description);
    const foot=el('div','dash-maintenance-foot');foot.append(el('span','',description),el('strong','',`${num(progress.percent,0)}%`));
    row.append(track,foot);maintenanceGrid.append(row);
  }
  maintenance.append(maintenanceGrid);
  if(!maintenanceEntries.length)maintenance.append(el('p','dash-empty','Nenhuma máquina cadastrada. Cadastre sua frota para acompanhar as próximas revisões.'));
  grid.append(maintenance);
  const notes=el('details','dash-method');notes.append(el('summary','','Como os indicadores são calculados'),el('p','','Consumo, custos e horas incluem apenas lotes finalizados. Peças contam produtos de lotes concluídos, excluindo produções avulsas e quantidades parciais não confirmadas. Custos incluem filamento e máquinas; o desperdício estimado em reais inclui somente filamento. Não há cálculo de lucro. Dias sem registros contam como zero nas projeções.'));root.append(notes);
}
