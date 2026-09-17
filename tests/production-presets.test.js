import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreset,presetValues} from '../public/production-presets.js';
const products=[{rowNumber:2,data:{SKU:'A01',Produto:'Gancho'}},{rowNumber:3,data:{SKU:'B02',Produto:'Suporte'}}];
const input={'Produto ID':'2',Quantidade:'12',Horas:'2,5'};
test('padrões recebem sequência por SKU e mantêm código na edição',()=>{
 const first=normalizePreset(input,products,[]);assert.equal(first.Código,'A01-1');
 const rows=[{rowNumber:2,data:first}];const second=normalizePreset(input,products,rows);assert.equal(second.Código,'A01-2');
 assert.equal(normalizePreset({...input,'Produto ID':'3'},products,rows).Código,'B02-1');
 const edited=normalizePreset({...input,Quantidade:'24'},products,rows,first);assert.equal(edited.Código,'A01-1');
 assert.deepEqual(presetValues({data:edited}),{productId:'2',quantity:'24',hours:'2.50'});
 assert.equal(first.Quantidade,'12');
});
test('padrões rejeitam produto inválido, quantidades fracionadas e horas inválidas',()=>{
 for(const delta of [{'Produto ID':'404'},{Quantidade:'1.5'},{Quantidade:'0'},{Horas:'-1'},{Horas:'0.001'}])assert.throws(()=>normalizePreset({...input,...delta},products,[]));
 const first=normalizePreset(input,products,[]);
 assert.throws(()=>normalizePreset({...input,'Produto ID':'3'},products,[],first),/outro produto/);
});
