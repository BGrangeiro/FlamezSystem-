import test from 'node:test';
import assert from 'node:assert/strict';
import { identifiedModel, identifiedName } from '../lib/bambu-model.js';
import { mergeReport } from '../lib/bambu-cloud.js';
import { registerCloudMachines } from '../lib/bambu-automation.js';
test('identifica A1 Combo por AMS recebido e preserva nomes personalizados', () => {
  const base = { id:'printer', name:'01', model:'A1' };
  assert.equal(identifiedModel(base), 'A1');
  const device = mergeReport(base, {print:{ams:{ams:[{id:'0',tray:[]}],tray_now:'0'}}});
  assert.equal(identifiedModel(device), 'A1 Combo');
  assert.equal(identifiedName(device), '01');
  assert.equal(identifiedName({...device,name:'A1'}), 'A1 Combo');
  assert.equal(identifiedModel({...device,model:'A1 mini'}), 'A1 mini Combo');
  assert.equal(identifiedModel({...device,model:'P1S'}), 'P1S');
  assert.equal(identifiedModel(mergeReport(device,{print:{mc_percent:10}})), 'A1 Combo');
  assert.equal(identifiedModel(mergeReport(device,{print:{ams:{ams:[]}}})), 'A1');
  assert.equal(identifiedModel(mergeReport(base,{print:{ams:[{}]}})), 'A1');
  const sheets = {maquinas:{rows:[{rowNumber:2,data:{_bambuId:'printer','Nome da máquina':'01',Modelo:'A1'}}]}};
  assert.equal(registerCloudMachines(sheets,[device]),true);
  assert.equal(sheets.maquinas.rows[0].data.Modelo,'A1 Combo');
  assert.equal(sheets.maquinas.rows[0].data['Nome da máquina'],'01');
  assert.equal(registerCloudMachines(sheets,[base]),false);
});

test('AMS presence bits identify Combo without a detailed inventory', () => {
  const base = {id:'printer',name:'02',model:'A1'};
  for (const ams of [{ams_exist_bits:'1'}, {ams_exist_bits:'f'}, {ams_exist_bits:1}]) {
    const device = mergeReport(base,{print:{ams}});
    assert.equal(identifiedModel(device),'A1 Combo');
    assert.equal(identifiedModel(mergeReport(device,{print:{ams:{tray_now:'254'}}})),'A1 Combo');
  }
  assert.equal(identifiedModel(mergeReport(base,{print:{ams_exist_bits:'1'}})),'A1 Combo');
  for (const bits of ['', null, 'invalid', -1]) {
    assert.equal(identifiedModel(mergeReport(base,{print:{ams:{ams_exist_bits:bits}}})),'A1');
  }
});
test('explicit absence overrides leftover slots and corrects a saved Combo model', () => {
  const device = mergeReport({id:'printer',name:'01',model:'A1'}, {print:{ams:{ams_exist_bits:'0',ams:[{id:'0',tray:[]}]}}});
  assert.equal(identifiedModel(device),'A1');
  const sheets = {maquinas:{rows:[{rowNumber:2,data:{_bambuId:'printer','Nome da máquina':'01',Modelo:'A1 COMBO'}}]}};
  assert.equal(registerCloudMachines(sheets,[device]),true);
  assert.equal(sheets.maquinas.rows[0].data.Modelo,'A1');
  const connected = mergeReport(device,{print:{ams:{ams_exist_bits:'1'}}});
  registerCloudMachines(sheets,[connected]);
  assert.equal(sheets.maquinas.rows[0].data.Modelo,'A1 Combo');
  registerCloudMachines(sheets,[{id:'printer',name:'01',model:'A1'}]);
  assert.equal(sheets.maquinas.rows[0].data.Modelo,'A1 Combo');
});
