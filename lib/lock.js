import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const busy = 'O diretório de dados está em uso. Pare o servidor antes de iniciar outra instância ou executar backup/restauração.';
const invalid = 'Trava de dados inválida. Verifique se o servidor está parado antes de remover .flamez.lock.';

async function processStart(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  // O nome do processo pode conter espaços e parênteses. starttime é o campo 22.
  const start = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  if (!/^\d+$/.test(start || '')) throw new Error('Não foi possível identificar o processo da trava de dados.');
  return start;
}

async function identity() {
  const owner = { version: 1, pid: process.pid, token: randomUUID() };
  if (process.platform === 'linux') {
    owner.bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    owner.startTime = await processStart(process.pid);
    if (!owner.bootId) throw new Error('Não foi possível identificar a inicialização do servidor.');
  }
  return owner;
}

function parseOwner(text) {
  let owner;
  try { owner = JSON.parse(text); } catch { throw new Error(invalid); }
  // Compatibilidade com o arquivo antigo, que continha apenas o PID.
  if (typeof owner === 'number') owner = { pid: owner };
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid > 2147483647) throw new Error(invalid);
  if ('version' in owner && (owner.version !== 1 || typeof owner.token !== 'string' || !owner.token)) throw new Error(invalid);
  if ('bootId' in owner || 'startTime' in owner) {
    if (typeof owner.bootId !== 'string' || !owner.bootId || typeof owner.startTime !== 'string' || !/^\d+$/.test(owner.startTime)) throw new Error(invalid);
  }
  return owner;
}

async function isStale(owner, current) {
  if (process.platform === 'linux' && owner.bootId && owner.startTime) {
    if (owner.bootId !== current.bootId) return true;
    try { return await processStart(owner.pid) !== owner.startTime; }
    catch (error) {
      // Sem acesso ao /proc, não há prova de que o proprietário morreu.
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') return false;
      return pidIsGone(owner.pid);
    }
  }
  return pidIsGone(owner.pid);
}

function pidIsGone(pid) {
  try { process.kill(pid, 0); }
  catch (error) { return error.code === 'ESRCH'; }
  return false;
}

// Serializa criação, recuperação e liberação. Nunca recupera automaticamente
// este guard: compare + unlink de um guard alheio recriaria a mesma corrida.
// Uma interrupção nesta seção curta exige verificar o servidor antes de removê-lo.
async function withRecoveryGuard(file, owner, action) {
  const guard = `${file}.recovery`;
  let handle;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { handle = await open(guard, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 19) throw new Error('O diretório de dados está em uso ou com uma recuperação de trava interrompida. Confirme que o servidor está parado antes de remover .flamez.lock.recovery.');
      await delay(20);
    }
  }
  try {
    await handle.writeFile(JSON.stringify(owner));
    return await action();
  } finally {
    await handle.close();
    await unlink(guard);
  }
}

// Um único processo pode escrever no diretório de dados.
export async function acquireLock(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, '.flamez.lock');
  const owner = await identity();
  const contents = JSON.stringify(owner);

  await withRecoveryGuard(file, owner, async () => {
    let previous;
    try { previous = await readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous !== undefined) {
      if (!await isStale(parseOwner(previous), owner)) throw new Error(busy);
      await unlink(file);
    }
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
  });

  return async () => withRecoveryGuard(file, owner, async () => {
    let actual;
    try { actual = await readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // O token impede uma liberação repetida de apagar uma trava posterior,
    // mesmo quando a nova aquisição pertence ao mesmo PID.
    if (actual === contents) await unlink(file);
  });
}
