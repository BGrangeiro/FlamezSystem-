import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBambuCloud, mergeReport } from '../lib/bambu-cloud.js';

test('telemetria parcial preserva dados e troca de trabalho remove valores anteriores', () => {
  const first = mergeReport({ id: 'A1' }, { print: { subtask_id: '1', mc_percent: 42, mc_remaining_time: 93, gcode_state: 'RUNNING' } }, 100);
  assert.equal(first.progress, 42);
  const second = mergeReport(first, { print: { mc_remaining_time: 90 } }, 200);
  assert.equal(second.progress, 42); assert.equal(second.remainingMinutes, 90);
  const third = mergeReport(second, { print: { subtask_id: '2', gcode_state: 'PREPARE', mc_percent: -1 } }, 300);
  assert.equal(third.progress, null); assert.equal(third.remainingMinutes, null);
  assert.equal(mergeReport(third, { print: { nozzle_temper: 220 } }, 400).updatedAt, 300);
});

test('conexão Bambu recebe somente relatórios, protege credenciais e expira dados', async () => {
  let clock = 1000; const calls = []; const client = new EventEmitter(); let stopped = false;
  const published = []; let tick, cancelled = false;
  client.connected = true; client.publish = (topic, bytes, options, callback) => { published.push({topic, payload: JSON.parse(bytes)}); callback(); };
  client.end = () => { stopped = true; }; client.subscribe = (topics, options, callback) => { assert.deepEqual(topics, ['device/A1/report']); callback(null, [{ qos: 0 }]); };
  const token = `header.${Buffer.from(JSON.stringify({ username: 'u_123' })).toString('base64url')}.secret`;
  const cloud = createBambuCloud({ schedule: (callback, delay) => { assert.equal(delay, 60000); tick = callback; return 1; }, cancelSchedule: () => { cancelled = true; }, now: () => clock, request: async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/login') ? { accessToken: token } : url.endsWith('/bind') ? { devices: [{ dev_id: 'A1', name: 'A1', dev_access_code: 'PRIVATE', dev_product_name: 'A1' }] } : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }, connectMqtt: (url, options) => { assert.equal(options.password, token); assert.equal(options.rejectUnauthorized, true); return client; } });
  await cloud.requestCode('test@example.com');
  await assert.rejects(cloud.requestCode('test@example.com'), /um minuto/);
  await cloud.verify('123456'); client.emit('connect');
  assert.equal(cloud.status().connected, true);
  assert.equal(published.length, 1); tick(); assert.equal(published.length, 2);
  assert.deepEqual(published[0], {topic:'device/A1/request', payload:{pushing:{sequence_id:'0',command:'pushall'}}});
  assert.equal(cloud.status().devices[0].stale, true);
  client.emit('message', 'device/OTHER/report', Buffer.from('{"print":{"mc_percent":50}}'));
  assert.equal(cloud.status().devices[0].progress, null);
  client.emit('message', 'device/A1/report', Buffer.from('{"print":{"mc_percent":42,"mc_remaining_time":93}}'));
  assert.equal(cloud.status().devices[0].progress, 42);
  assert.equal(cloud.status().devices[0].stale, false);
  assert.ok(!JSON.stringify(cloud.status()).includes('PRIVATE'));
  assert.ok(!JSON.stringify(cloud.status()).includes(token));
  clock += 121000; assert.equal(cloud.status().devices[0].stale, true);
  await cloud.disconnect(); assert.equal(stopped, true); assert.equal(cloud.status().authenticated, false);
  assert.equal(cancelled, true); tick(); assert.equal(published.length, 2);
  client.emit('connect'); assert.equal(cloud.status().connected, false);
  assert.equal(calls.length, 3);
});

test('bloqueio da Bambu é informado sem tentar contornar a proteção', async () => {
  let calls = 0;
  const cloud = createBambuCloud({ request: async () => { calls++; return { status: 403, ok: false }; } });
  await assert.rejects(cloud.requestCode('test@example.com'), /bloqueou/);
  assert.equal(calls, 1); assert.equal(cloud.status().authenticated, false);
});

test('envio de código aceita sucesso vazio, mas login exige dados', async () => {
  for (const status of [200, 204]) {
    const cloud = createBambuCloud({ request: async () => ({ status, ok: true, text: async () => '' }) });
    assert.deepEqual(await cloud.requestCode('test@example.com'), { ok: true });
    await assert.rejects(cloud.verify('123456'), /resposta vazia ao validar o código/);
    assert.equal(cloud.status().authenticated, false);
  }
});

test('página HTML e JSON inválido não são confundidos com código enviado', async () => {
  for (const body of ['<html>PRIVATE CONTENT</html>', 'PRIVATE CONTENT', 'null', '[]']) {
    const cloud = createBambuCloud({ request: async () => ({ status: 200, ok: true, text: async () => body }) });
    await assert.rejects(cloud.requestCode('test@example.com'), error => {
      assert.ok(error.message.includes('solicitar o código'));
      assert.ok(!error.message.includes('PRIVATE CONTENT')); return true;
    });
    await assert.rejects(cloud.verify('123456'), /Solicite um novo código/);
  }
});

test('descoberta automática adiciona e salva impressoras, mantém telemetria e preserva histórico ao remover', async () => {
  const tasks = [], sessions = [], subscriptions = [], breaks = [], registered = [];
  let records = [{dev_id:'A1',name:'01',dev_product_name:'A1'}];
  const client = new EventEmitter();client.connected=true;client.end=()=>{};
  client.publish=(topic,body,options,done)=>done();client.unsubscribe=topics=>subscriptions.push({removed:topics});
  client.subscribe=(topics,options,done)=>{subscriptions.push(topics);done(null,topics.map(()=>({qos:0})));};
  const token=`h.${Buffer.from('{"username":"u_123"}').toString('base64url')}.s`;
  const cloud=createBambuCloud({
    request:async url=>({ok:true,status:200,text:async()=>JSON.stringify(url.endsWith('/login')?{accessToken:token}:url.endsWith('/bind')?{devices:records}:{})}),
    connectMqtt:()=>client,schedule:fn=>{tasks.push(fn);return tasks.length;},cancelSchedule:()=>{},
    sessionStore:{save:async value=>sessions.push(value)},
    usage:{register:value=>registered.push(value.map(d=>d.id)),breakConnection:ids=>breaks.push(ids),summary:()=>({}),observe:()=>{}}
  });
  await cloud.requestCode('test@example.com');await cloud.verify('123456');client.emit('connect');
  client.emit('message','device/A1/report',Buffer.from('{"print":{"mc_percent":42}}'));
  records=[{dev_id:'A1',name:'Nova identificação',dev_product_name:'A1'},{dev_id:'MINI',name:'02',dev_product_name:'A1 mini'}];
  await tasks[0]();
  assert.equal(cloud.status().devices.length,2);assert.equal(cloud.status().devices[0].progress,42);
  assert.equal(cloud.status().devices[0].name,'Nova identificação');
  assert.equal(sessions.at(-1).devices.length,2);assert.deepEqual(subscriptions.at(-1),['device/MINI/report']);
  const subscribedCount = subscriptions.length;await tasks[0]();
  assert.equal(subscriptions.length,subscribedCount);assert.equal(cloud.status().connected,true);
  records=[records[1]];await tasks[0]();assert.equal(cloud.status().devices.length,1);
  assert.deepEqual(breaks.at(-1),['A1']);assert.ok(registered.flat().includes('MINI'));
  cloud.close();const count=sessions.length;await tasks[0]();assert.equal(sessions.length,count);
});
