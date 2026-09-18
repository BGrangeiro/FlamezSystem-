import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireLock } from '../lib/lock.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'flamez-lock-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'flamez-lock-'));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, file: path.join(dir, '.flamez.lock') };
}

test('active owner is exclusive and repeated release cannot delete its successor', async t => {
  const { dir, file } = await fixture(t);
  const release = await acquireLock(dir);
  const first = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(first.pid, process.pid);
  assert.ok(first.token);
  await assert.rejects(acquireLock(dir), /em uso/);
  await release();
  const releaseNext = await acquireLock(dir);
  const next = await readFile(file, 'utf8');
  assert.notEqual(JSON.parse(next).token, first.token);
  await release();
  assert.equal(await readFile(file, 'utf8'), next);
  await releaseNext();
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('legacy active PID and malformed lock are preserved', async t => {
  const { dir, file } = await fixture(t);
  for (const value of [String(process.pid), '', '{broken', '0', 'null', '{"pid":1,"bootId":"old"}']) {
    await writeFile(file, value);
    await assert.rejects(acquireLock(dir), value === String(process.pid) ? /em uso/ : /inválida/);
    assert.equal(await readFile(file, 'utf8'), value);
  }
});

test('an interrupted recovery fails closed without changing either lock', async t => {
  const { dir, file } = await fixture(t);
  await writeFile(file, String(process.pid));
  await writeFile(`${file}.recovery`, 'interrupted recovery');
  await assert.rejects(acquireLock(dir), /recuperação de trava interrompida/);
  assert.equal(await readFile(file, 'utf8'), String(process.pid));
  assert.equal(await readFile(`${file}.recovery`, 'utf8'), 'interrupted recovery');
});

test('a terminated owner can be recovered and competing recoveries have one winner', async t => {
  const { dir, file } = await fixture(t);
  const moduleUrl = new URL('../lib/lock.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireLock } from ${JSON.stringify(moduleUrl)};
    await acquireLock(process.argv[1]);
    process.send('locked');
    process.on('message', () => {});
  `, dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', resolve);
    child.once('exit', code => reject(new Error(`Child exited ${code}: ${errors}`)));
  });
  await assert.rejects(acquireLock(dir), /em uso/);
  const exited = once(child, 'exit'); child.kill(); await exited;
  const contenders = await Promise.allSettled(Array.from({ length: 12 }, () => acquireLock(dir)));
  const winners = contenders.filter(result => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).pid, process.pid);
  await winners[0].value();
  // O formato antigo também continua recuperável quando o PID deixou de existir.
  await writeFile(file, String(child.pid));
  const release = await acquireLock(dir);
  await release();
});

test('Linux distinguishes reboot and reused PID from an active process', { skip: process.platform !== 'linux' }, async t => {
  const { dir, file } = await fixture(t);
  const release = await acquireLock(dir);
  const owner = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(owner.bootId);
  assert.match(owner.startTime, /^\d+$/);
  await release();
  for (const stale of [{ ...owner, bootId: 'previous-boot' }, { ...owner, startTime: String(BigInt(owner.startTime) + 1n) }]) {
    await writeFile(file, JSON.stringify(stale));
    const recovered = await acquireLock(dir);
    assert.notEqual(JSON.parse(await readFile(file, 'utf8')).token, owner.token);
    await recovered();
  }
});
