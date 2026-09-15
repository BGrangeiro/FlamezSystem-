import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProductStock,stockColors} from '../public/product-stock-data.js';

test('estoque por cor soma as quantidades e preserva o legado',()=>{
  assert.deepEqual(stockColors({Quantidade:'12'}),[{color:'Sem cor definida',quantity:12}]);
  const legacy=normalizeProductStock({SKU:'A01',Quantidade:'12'});
  assert.equal(legacy.Quantidade,'12');
  const colors=JSON.stringify([{color:'Branco',quantity:7},{color:'Preto',quantity:5},{color:'Azul',quantity:3}]);
  const result=normalizeProductStock({SKU:'A01',Quantidade:'999',Cores:colors});
  assert.equal(result.Quantidade,'15');
  assert.equal(normalizeProductStock({SKU:'A01',Cores:'[]'}).Quantidade,'0');
  const photo='data:image/png;base64,aGVsbG8=';
  assert.equal(normalizeProductStock({SKU:'A01',Foto:photo},result).Cores,colors);
  assert.equal(normalizeProductStock({SKU:'A01',Cores:colors},{Foto:photo}).Foto,photo);
  assert.equal(normalizeProductStock({SKU:'A01',Cores:colors,Foto:''},{Foto:photo}).Foto,'');
});

test('estoque por cor rejeita cores repetidas, quantidades e fotos inválidas',()=>{
  for(const colors of [[{color:'Branco',quantity:-1}],[{color:'Preto',quantity:1.5}],[{color:'',quantity:1}],[{color:'Azul',quantity:''}],[{color:'Branco',quantity:1},{color:' branco ',quantity:2}],[null]]) {
    assert.throws(()=>normalizeProductStock({SKU:'A01',Cores:JSON.stringify(colors)}));
  }
  assert.throws(()=>normalizeProductStock({SKU:'A01',Quantidade:'-1'}));
  assert.throws(()=>normalizeProductStock({SKU:'A01',Cores:'[]',Foto:'https://example.com/photo.png'}));
});
