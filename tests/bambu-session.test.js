import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createBambuSessionStore } from '../lib/bambu-session.js';
import { createBambuCloud } from '../lib/bambu-cloud.js';

test('sessão criptografada restaura após reinício e desconectar remove acesso salvo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flamez-bambu-'));
  try {
    const store = createBambuSessionStore(dir);
    const token = `header.${Buffer.from(JSON.stringify({exp: 9999999999})).toString('base64url')}.secret`;
    await store.save({token, username:'u_123', devices:[{dev_id:'A1',name:'Minha A1'}]});
    assert.ok(!(await readFile(path.join(dir,'bambu-session.local.json'),'utf8')).includes(token));
    let connections = 0;
    const make = () => createBambuCloud({sessionStore:createBambuSessionStore(dir), connectMqtt: (url, options) => {
      connections++; assert.equal(options.password, token); const client = new EventEmitter(); client.end = () => {}; return client;
    }});
    const first = make(); await first.init(); assert.equal(first.status().authenticated,true); first.close();
    const second = make(); await second.init(); assert.equal(second.status().authenticated,true); assert.equal(connections,2);
    await second.disconnect(); assert.equal(await store.load(),null);
    const third = make(); await third.init(); assert.equal(third.status().authenticated,false);
    await store.save({token:`h.${Buffer.from('{"exp":1}').toString('base64url')}.s`,username:'u_123',devices:[]});
    await third.init(); assert.match(third.status().message,/expirou/); assert.equal(await store.load(),null);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
