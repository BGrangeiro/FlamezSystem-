import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProductTest} from '../public/product-tests.js';

test('produto a testar aceita links da Shopee, Drive e outros sites', () => {
  assert.deepEqual(normalizeProductTest({Produto:'  Gancho novo  ',Link:'https://shopee.com.br/item/123'}),{Produto:'Gancho novo',Link:'https://shopee.com.br/item/123'});
  assert.equal(normalizeProductTest({Produto:'Arquivo de referência',Link:'drive.google.com/file/d/abc'}).Link,'https://drive.google.com/file/d/abc');
  assert.equal(normalizeProductTest({Produto:'Site qualquer',Link:'http://example.com/produto?q=1'}).Link,'http://example.com/produto?q=1');
});

test('produto a testar rejeita nome vazio e links perigosos ou inválidos', () => {
  assert.throws(()=>normalizeProductTest({Produto:'',Link:'https://example.com'}),/nome do produto/i);
  assert.throws(()=>normalizeProductTest({Produto:'Teste',Link:''}),/link do produto/i);
  assert.throws(()=>normalizeProductTest({Produto:'Teste',Link:'javascript:alert(1)'}),/link válido|site válido/i);
  assert.throws(()=>normalizeProductTest({Produto:'Teste',Link:'file:///segredo'}),/site válido/i);
});
