import test from 'node:test';
import assert from 'node:assert/strict';
import {editionAsset,publicAddress} from '../public/publicacion.mjs';

const brand = 'https://perualdia.github.io/?region=Piura';
const pilot = 'https://jccv26.github.io/atlas-el-nino-peru/';

test('la marca y el piloto leen la misma edición y abren enlaces en el dominio correspondiente', () => {
  for (const path of ['data/panorama.json','atlas/oceano.json','media/boletin.wav','data/sectores-lluvias.json']) {
    assert.equal(editionAsset(path,brand).href,pilot+path);
    assert.equal(editionAsset(path,pilot+'?region=Piura').href,pilot+path);
  }
  assert.equal(publicAddress(brand),'https://perualdia.github.io/');
  assert.equal(publicAddress('file:///tmp/index.html'),pilot);
  assert.equal(editionAsset('./api/panorama','http://localhost:3000/').href,'http://localhost:3000/api/panorama');
});
test('los recursos de una edición no pueden apuntar a otro origen o repositorio', () => {
  for (const path of ['https://example.com/pista','//example.org/audio','../otro-proyecto/voz.wav']) {
    assert.throws(()=>editionAsset(path,brand));
  }
});
