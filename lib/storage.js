import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BUSINESS_FILES, databasePath, readDatabase, writeDatabase, inspectDatabase } from './database.js';

export { BUSINESS_FILES } from './database.js';
const configurations = new Map();
export function configureStorage({ backend = 'json', dataDir }) {
  if (!['json', 'sqlite'].includes(backend)) throw new Error('STORAGE_BACKEND deve ser json ou sqlite.');
  if (!dataDir) throw new Error('Configure o diretório de dados.');
  configurations.set(path.resolve(dataDir), backend);
}
export const storageBackend = directory => configurations.get(path.resolve(directory)) || 'json';
function businessDirectory(file) {
  return BUSINESS_FILES.includes(path.basename(file)) ? path.dirname(path.resolve(file)) : null;
}
function assertJsonBackend(directory) {
  if (existsSync(databasePath(directory))) throw new Error('Existe um banco SQLite neste diretório. Configure STORAGE_BACKEND=sqlite para evitar carregar os arquivos JSON antigos.');
}

export async function inspectStorage({ backend = 'json', dataDir }) {
  if (backend === 'sqlite') return inspectDatabase(path.resolve(dataDir));
  if (backend !== 'json') throw new Error('STORAGE_BACKEND deve ser json ou sqlite.');
  assertJsonBackend(dataDir);
  for (const name of BUSINESS_FILES) await readJsonFile(path.join(dataDir, name), null);
  return { backend: 'json', databaseExists: false };
}

export async function readJson(file, fallback) {
  const directory = businessDirectory(file);
  if (directory && storageBackend(directory) === 'sqlite') return (await readDatabase(directory))[path.basename(file)] ?? structuredClone(fallback);
  if (directory) assertJsonBackend(directory);
  return readJsonFile(file, fallback);
}

export async function readJsonFile(file, fallback) {
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
  try {
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Objeto JSON esperado.');
    return data;
  } catch (cause) {
    throw new Error(`Arquivo de dados inválido: ${path.basename(file)}. Restaure um backup antes de continuar.`, {cause});
  }
}

export async function writeJson(file, data) {
  const directory = businessDirectory(file);
  if (directory && storageBackend(directory) === 'sqlite') return writeDatabase(directory, { [path.basename(file)]: data });
  if (directory) assertJsonBackend(directory);
  return writeJsonFile(file, data);
}

export async function writeJsonFile(file, data) {
  await mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data, null, 2)+'\n'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(error=>{if(error.code !== 'ENOENT') throw error;}); }
}

export async function readBusinessData(directory) {
  if (storageBackend(directory) === 'sqlite') return readDatabase(directory);
  assertJsonBackend(directory);
  return Object.fromEntries(await Promise.all(BUSINESS_FILES.map(async name => [name, await readJsonFile(path.join(directory, name), null)])));
}

export async function writeBusinessData(directory, values) {
  for (const name of Object.keys(values)) if (!BUSINESS_FILES.includes(name)) throw new Error('Arquivo de negócio desconhecido.');
  if (storageBackend(directory) === 'sqlite') return writeDatabase(directory, values);
  assertJsonBackend(directory);
  const before = await readBusinessData(directory);
  const write = async (name, value) => value === null ? unlink(path.join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; }) : writeJsonFile(path.join(directory, name), value);
  try { for (const [name, value] of Object.entries(values)) await write(name, value); }
  catch (error) {
    for (const name of Object.keys(values)) await write(name, before[name]);
    throw error;
  }
}
