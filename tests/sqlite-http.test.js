import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { hashPassword } from '../lib/auth.js';
import { configureStorage, readBusinessData } from '../lib/storage.js';
import { databasePath } from '../lib/database.js';
import { createBackup, restoreBackup } from '../scripts/backup.js';

test('HTTP SQLite survives a server restart with expenses, order deliveries, product costs and authentication', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'flamez-sqlite-http-'));
  const dataDir = path.join(directory, 'data');
  let child;
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  };
  try {
    for (const name of ['lib', 'public']) await cp(new URL('../' + name, import.meta.url), path.join(directory, name), { recursive: true });
    await cp(new URL('../server.js', import.meta.url), path.join(directory, 'server.js'));
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
    const port = await new Promise(resolve => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
    });
    const origin = 'https://sqlite.flamez.example', password = 'senha-teste-sqlite';
    const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir, STORAGE_BACKEND: 'sqlite', APP_ORIGIN: origin, AUTH_USERNAME: 'owner', AUTH_PASSWORD_HASH: await hashPassword(password), PRODUCTION_DELETE_PASSWORD: '9876', AUTO_LOGIN_BY_IP: 'false', TRUSTED_PROXY_IPS: '', BACKUP_INTERVAL_HOURS: '0' };
    const start = async () => {
      child = spawn(process.execPath, ['server.js'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise((resolve, reject) => {
        let errors = '';
        const timer = setTimeout(() => reject(new Error('Servidor SQLite não iniciou. ' + errors)), 15000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Servidor SQLite saiu (${code}): ${errors}`)); });
        child.stderr.on('data', data => { errors += data; });
        child.stdout.on('data', data => { if (String(data).includes('iniciado')) { clearTimeout(timer); resolve(); } });
      });
    };
    const base = `http://127.0.0.1:${port}`;
    const headers = { 'content-type': 'application/json', origin };
    const post = (route, value) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(value) });
    const login = async () => {
      const response = await post('/api/auth/login', { username: 'owner', password });
      assert.equal(response.status, 200);
      headers.cookie = response.headers.get('set-cookie').split(';')[0];
    };
    await start();
    assert.equal((await fetch(base + '/api/sheets')).status, 401);
    await login();
    const expense = { Descrição: 'Filamento PLA', 'Valor (R$)': '123,45', Data: '2026-09-17', Categoria: 'Filamento', 'Onde comprou / para quem pagou': 'Loja teste', Observações: 'Lote parcial\nGuardar comprovante' };
    assert.equal((await post('/api/sheets/upsert', { sheet: 'companyExpenses', data: expense })).status, 200);
    const orderResponse = await post('/api/sheets/upsert', { sheet: 'encomendas', data: { 'Nome da encomenda': 'Lote parcelado', 'Quantidade de itens': '10' } });
    assert.equal(orderResponse.status, 200);
    const order = await orderResponse.json();
    const delivery = { rowNumber: order.rowNumber, id: 'sqlite-delivery-0001', date: '2026-09-17', quantity: 3 };
    assert.equal((await post('/api/orders/deliveries', delivery)).status, 200);
    assert.equal((await post('/api/product-costs', { productKey: 'sku:TEST', data: { quantity: '10', amount: '123.45', note: 'Custo salvo' } })).status, 200);
    assert.equal((await fetch(base + '/flamez.sqlite3', { headers })).status, 404);
    await stop();

    configureStorage({ backend: 'sqlite', dataDir });
    assert.ok(existsSync(databasePath(dataDir)));
    assert.equal(existsSync(path.join(dataDir, 'sheets.local.json')), false);
    const backup = await createBackup(dataDir);
    const snapshot = await readBusinessData(dataDir);
    assert.equal(snapshot['access.local.json'].events.length, 1);
    await restoreBackup(dataDir, backup);
    await start();
    assert.equal((await fetch(base + '/api/sheets', { headers })).status, 401);
    await login();
    const expenses = await (await fetch(base + '/api/sheets?sheet=companyExpenses', { headers })).json();
    assert.equal(expenses.rows[0].data['Valor (R$)'], '123.45');
    assert.equal(expenses.rows[0].data.Observações, expense.Observações);
    assert.equal(expenses.rows[0].data['Onde comprou / para quem pagou'], 'Loja teste');
    const orders = await (await fetch(base + '/api/sheets?sheet=encomendas', { headers })).json();
    assert.equal(JSON.parse(orders.rows[0].data._deliveries)[0].quantity, 3);
    assert.equal((await post('/api/orders/deliveries', delivery)).status, 200);
    const repeated = await (await fetch(base + '/api/sheets?sheet=encomendas', { headers })).json();
    assert.equal(JSON.parse(repeated.rows[0].data._deliveries).length, 1);
    const costs = await (await fetch(base + '/api/product-costs', { headers })).json();
    assert.equal(costs.costs['sku:TEST'].note, 'Custo salvo');
    assert.equal((await post('/api/auth/logout', {})).status, 200);
    assert.equal((await fetch(base + '/api/sheets', { headers })).status, 401);
  } finally {
    await stop();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'flamez-sqlite-http-'));
    await rm(directory, { recursive: true, force: true });
  }
});
