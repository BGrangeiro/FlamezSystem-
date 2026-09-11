import {maintenanceProgress} from './machine-costs.js';
export function monthlyStats(rows, month) {
  const result={finished:0,pending:0,failed:0,partial:0,units:0,grams:0,waste:0,filamentCost:0,machineCost:0,wasteCost:0,hours:0,unparsed:0,machines:new Map()};
  for(const row of rows){
    let date=String(row.data['Dia produção'] || '');
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(date)) date=date.split('/').reverse().join('-');
    if(date.slice(0,7)!==month)continue;
    const status=row.data['Status da produção'] || 'Concluída';
    if(status==='Em produção'){result.pending++;continue;}
    result.finished++;
    if(status==='Falhou')result.failed++;
    if(status==='Parcial')result.partial++;
    let items;try{items=JSON.parse(row.data['Itens da produção']);if(!Array.isArray(items))throw new Error();}catch{result.unparsed++;continue;}
    for(const item of items){
      const used=Number(item.used)||0,waste=Number(item.waste)||0,cost=Number(item.total)||0,hours=Number(item.hours)||0;
      if(status==='Concluída')result.units+=Number(item.quantity)||0;
      result.grams+=used+waste;result.waste+=waste;result.filamentCost+=cost;result.machineCost+=Number(item.machineCost)||0;result.hours+=hours;
      result.wasteCost+=(used+waste)>0?cost*waste/(used+waste):0;
      if(item.machineRow!=null){const key=String(item.machineRow);const value=result.machines.get(key)||{name:item.machineName||key,hours:0,cost:0};value.hours+=hours;value.cost+=Number(item.machineCost)||0;result.machines.set(key,value);}
    }
  }
  return result;
}
export function renderMonthlyPanel({state,elements,formatMoney:money,formatNumber:num,todayInputValue}){
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const render=()=>renderMonthlyPanel({state,elements,formatMoney:money,formatNumber:num,todayInputValue});
  elements.content.replaceChildren();
  const filter=el('label','monthly-filter','Mês de referência');const input=el('input');input.type='month';input.value=state.dashboardMonth||todayInputValue().slice(0,7);filter.append(input);
  input.addEventListener('change',()=>{if(!input.value)return;state.dashboardMonth=input.value;render();});elements.content.append(filter);
  const stats=monthlyStats(state.rows,input.value);
  const metrics=el('div','monthly-metrics');
  for(const [label,value] of [['Produções finalizadas',stats.finished],['Em produção',stats.pending],['Peças em lotes concluídos',num(stats.units,0)],['Filamento consumido',`${num(stats.grams/1000,3)} kg`],['Desperdício',`${num(stats.waste/1000,3)} kg`],['Filamento desperdiçado',money(stats.wasteCost)],['Custo de filamento',money(stats.filamentCost)],['Custo de máquinas',money(stats.machineCost)],['Custo total registrado',money(stats.filamentCost+stats.machineCost)],['Horas de máquina',`${num(stats.hours)} h`],['Produções parciais',stats.partial],['Produções que falharam',stats.failed]]){
    const card=el('article','monthly-metric');card.append(el('span','cell-label',label),el('strong','',String(value)));metrics.append(card);
  }
  elements.content.append(metrics);
  elements.content.append(el('p','machine-formula','Consumos, custos e horas consideram apenas produções finalizadas no mês. A contagem de peças inclui somente lotes concluídos, pois lotes parciais ainda não registram a quantidade aprovada. O custo do desperdício considera apenas filamento.'));
  if(stats.unparsed)elements.content.append(el('p','status warning',`${stats.unparsed} registro(s) antigo(s) sem dados suficientes: totais parciais.`));
  const section=el('section','monthly-section');section.append(el('h2','','Uso das máquinas no mês'));
  for(const [id, machine] of stats.machines){const name=state.productionMachines.find(m=>String(m.rowNumber)===id)?.data['Nome da máquina']||machine.name;section.append(el('p','monthly-machine',`${name} · ${num(machine.hours)} h · ${money(machine.cost)}`));}
  if(!stats.machines.size)section.append(el('p','machine-formula','Nenhuma hora de máquina registrada neste mês.'));
  elements.content.append(section);
  const alerts=el('section','monthly-section');alerts.append(el('h2','','Manutenção das máquinas · situação atual'));
  state.productionMachines.forEach(machine=>{const progress=maintenanceProgress(machine.data);alerts.append(el('p',progress.due?'maintenance-due':'monthly-machine',`${machine.data['Nome da máquina']} · ${progress.due?'Manutenção necessária':`${num(progress.remaining)} h até a próxima manutenção`}`));});
  if(!state.productionMachines.length)alerts.append(el('p','machine-formula','Nenhuma máquina cadastrada.'));
  elements.content.append(alerts);
}
