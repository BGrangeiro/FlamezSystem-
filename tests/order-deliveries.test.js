import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addDelivery, deliveryTotals, orderDeliveries} from '../public/order-deliveries.js';
const entry = {id:'delivery-test-0001',date:'2026-09-16',quantity:3};
test('entregas parciais acumulam, preservam datas e não duplicam tentativas', () => {
  const original = {'Quantidade de itens':'10', 'Data de entrega':'2026-09-20'};
  const first = addDelivery(original,entry);
  assert.deepEqual(deliveryTotals(first),{delivered:3,total:10,remaining:7});
  assert.deepEqual(addDelivery(first,entry), first);
  const second = addDelivery(first,{...entry,id:'delivery-test-0002',quantity:7});
  assert.equal(deliveryTotals(second).remaining,0);
  assert.equal(orderDeliveries(second).length,2);
  assert.equal(second['Data de entrega'],'2026-09-20');
  assert.equal(deliveryTotals(original).delivered,0);
});
test('entregas rejeitam quantidade excedente, data inválida e encomenda cancelada', () => {
  for (const quantity of [0,-1,1.5,11]) assert.throws(()=>addDelivery({'Quantidade de itens':'10'},{...entry,quantity}));
  assert.throws(()=>addDelivery({}, {...entry,date:'2026-02-30'}));
  assert.throws(()=>addDelivery({Cancelado:'Sim'},entry));
  assert.equal(deliveryTotals(addDelivery({},entry)).remaining,null);
});
