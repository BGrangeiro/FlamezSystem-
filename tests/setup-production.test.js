import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { setupProduction } from '../scripts/setup-production.js';
import { loadConfig } from '../lib/config.js';

test('configuração de produção exige domínio, gera hash e preserva arquivo existente', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'flamez-setup-'));
  try {
    const output = path.join(directory,'.env');
    const args = {origin:'https://sistema.example.com',dataDir:directory.replaceAll('\\','/'),output};
    const result = await setupProduction(args);
    const raw = await readFile(output,'utf8');
    assert.ok(!raw.includes(result.password));
    const config = loadConfig(parseEnv(raw));
    assert.equal(config.storageBackend,'sqlite'); assert.equal(config.autoLoginByIP,false);
    assert.equal(config.username,'Flamez3D'); assert.equal(config.backupHours,24);
    await assert.rejects(setupProduction(args), {code:'EEXIST'});
    assert.equal(await readFile(output,'utf8'),raw);
    for (const origin of ['http://example.com','https://example.com/','https://example.com/path','https://85.31.63.215']) await assert.rejects(setupProduction({...args,origin}));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
