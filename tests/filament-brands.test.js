import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFilamentBrands} from '../public/filament-brands.js';

test('marcas dos produtos incluem configurações e estoque sem duplicar variações de escrita', () => {
  const settings=[{data:{Marca:'Bambu Lab'}},{data:{Marca:'Masterprint'}}];
  const stock=[{data:{Marca:'MasterPrint'}},{data:{Marca:'Voolt3d'}},{data:{Marca:'BambuLab'}},{data:{Marca:'F3D'}}];
  assert.deepEqual(collectFilamentBrands(settings,stock),['Bambu Lab','F3D','Masterprint','Voolt3d']);
});

test('marcas vazias são ignoradas e os nomes são aparados', () => {
  assert.deepEqual(collectFilamentBrands([{data:{Marca:'  Marca X  '}},{data:{Marca:''}},{data:{}}]),['Marca X']);
});
