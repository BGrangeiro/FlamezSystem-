import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createBambuUsage, splitUsageInterval } from '../lib/bambu-usage.js';
import { createBackup, restoreBackup } from '../scripts/backup.js';
import { writeJson } from '../lib/storage.js';

test('15 horas desde 15h dividem 9h e 6h em Brasília, independente do fuso do servidor', () => {
  const start = Date.parse('2026-09-15T15:00:00-03:00');
  assert.deepEqual(splitUsageInterval(start, start + 15 * 3600000), [
    {day:'2026-09-15', milliseconds:9*3600000}, {day:'2026-09-16', milliseconds:6*3600000}
  ]);
  assert.deepEqual(splitUsageInterval(Date.parse('2026-12-31T23:59:00-03:00'),Date.parse('2027-01-01T00:01:00-03:00')), [
    {day:'2026-12-31',milliseconds:60000},{day:'2027-01-01',milliseconds:60000}
  ]);
});

test('horas diárias persistem sem duplicar; pausas, falha, interrupção e reinício são tratados', async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'flamez-usage-'));
  let usage;
  try {
    let at = Date.parse('2026-09-15T15:00:00-03:00');
    usage = createBambuUsage(dir,{now:()=>at}); await usage.init();
    const device = {id:'A1',name:'01',model:'A1',state:'RUNNING',jobId:'job1'};
    usage.register([device]); usage.observe(device,at);
    for(let minute=0;minute<900;minute++){at+=60000;usage.observe(device,at);}
    assert.equal(usage.summary('A1').yesterday.printingMs,9*3600000);
    assert.equal(usage.summary('A1').today.printingMs,6*3600000);
    usage.observe(device,at); // identical delivery cannot duplicate time
    usage.observe({...device,state:'PAUSE'},at+1000); at+=61000;
    usage.observe({...device,state:'PAUSE'},at);
    assert.equal(usage.summary('A1').today.pausedMs,60000);
    at+=60000;usage.observe({...device,state:'RUNNING'},at);
    at+=60000;usage.observe({...device,state:'FAILED'},at);
    const printed = usage.summary('A1').today.printingMs;
    at+=60000;usage.observe({...device,state:'FAILED'},at);
    assert.equal(usage.summary('A1').today.printingMs,printed);
    usage.breakConnection();at+=60000;usage.observe(device,at);
    assert.equal(usage.summary('A1').today.unobservedMs,60000);
    at+=600000;usage.observe(device,at); // long gap is not extrapolated
    assert.equal(usage.summary('A1').today.printingMs,printed);
    await usage.flush();
    usage=createBambuUsage(dir,{now:()=>at});await usage.init();at+=60000;usage.observe(device,at);
    assert.equal(usage.summary('A1').today.printingMs,printed);
    assert.equal(usage.summary('A1').today.unobservedMs,720000);
    usage.register([{...device,name:'Renomeada'}]);
    assert.equal(usage.history().printers.length,1);assert.equal(usage.history().printers[0].name,'Renomeada');
    await usage.flush();
    await writeJson(path.join(dir,'sheets.local.json'),{sheets:{}});await writeJson(path.join(dir,'product-costs.local.json'),{});
    const backup=await createBackup(dir);
    await writeJson(path.join(dir,'bambu-usage.local.json'),{version:1,printers:{}});
    await restoreBackup(dir,backup);usage=createBambuUsage(dir,{now:()=>at});await usage.init();
    assert.equal(usage.summary('A1').today.printingMs,printed);
    at += 3*86400000;
    const history=usage.history().printers[0];
    assert.equal(history.days.length,5);assert.equal(history.today.recorded,false);
  } finally { await usage?.flush();assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'flamez-usage-'));await rm(dir,{recursive:true,force:true}); }
});
