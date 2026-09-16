import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './storage.js';

export function createBambuSessionStore(dataDir) {
  const file = path.join(dataDir, 'bambu-session.local.json');
  const keyFile = path.join(dataDir, 'bambu-session.key');
  async function key(create = false) {
    try { const value = await readFile(keyFile); if (value.length !== 32) throw new Error('Invalid key'); return value; }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      const value = randomBytes(32);
      try { await writeFile(keyFile, value, { flag: 'wx', mode: 0o600 }); return value; }
      catch (error) { if (error.code === 'EEXIST') return key(); throw error; }
    }
  }
  return {
    async load() {
      const saved = await readJson(file, {});
      if (!saved.ciphertext) return null;
      const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(saved.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]).toString());
    },
    async save(session) {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', await key(true), iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
      await writeJson(file, { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') });
    },
    async clear() { await writeJson(file, {}); }
  };
}
