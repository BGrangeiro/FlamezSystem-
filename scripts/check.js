import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const directories=['public','lib','scripts','tests'];
const files=['server.js'];
for(const directory of directories)for(const file of await readdir(directory))if(file.endsWith('.js'))files.push(path.join(directory,file));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
console.log('Sintaxe validada em '+files.length+' arquivos JavaScript.');
