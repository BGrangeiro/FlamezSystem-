import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJson(file, fallback) {
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
  await mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data, null, 2)+'\n'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(error=>{if(error.code !== 'ENOENT') throw error;}); }
}
