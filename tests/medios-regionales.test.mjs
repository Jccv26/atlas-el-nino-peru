import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaSources} from '../lib/medios.mjs';
import {collectSource} from '../lib/panorama.mjs';
import {mergePanorama} from '../scripts/estado-ci.mjs';

const clock = new Date('2026-11-27T03:00:00Z');
const source = id => mediaSources.find(s => s.id === id);
function post(id, title, link, fields = {}) {
  return {id, title: {rendered: title}, link, date_gmt: '2026-11-27T00:30:00',
    modified_gmt: '2026-11-27T01:00:00', ...fields};
}

test('los medios regionales declaran su redacción, una ruta propia y una consulta de metadatos', () => {
  const definitions = [
    ['walac','walac.pe','Piura'], ['pachamama-radio','pachamamaradio.org','Puno'],
    ['diario-voces','diariovoces.com.pe','San Martín'], ['radio-uno','radiouno.pe','Tacna'],
    ['newstrujillo','newstrujillo.com','La Libertad'],
  ];
  for (const [id, host, region] of definitions) {
    const s = source(id), url = new URL(s.url);
    assert.equal(s.publisherRegion, region);
    assert.equal(s.kind, 'prensa');
    assert.equal(url.hostname, host);
    assert.equal(url.pathname, '/wp-json/wp/v2/posts');
    assert.equal(url.searchParams.get('_fields'), 'id,date_gmt,modified_gmt,link,title');
  }
});

test('solo la ubicación explícita en el titular cuenta como ámbito de la nota', async t => {
  const src=source('radio-uno');
  const rows=[
    post(1,'Lluvias interrumpen el tránsito en una avenida', 'https://radiouno.pe/noticias/1/lluvias/', {
      content:{rendered:'La redacción está en Tacna.'}, image:'https://radiouno.pe/foto.jpg',
    }),
    post(2,'Fuerte lluvia en Juliaca y tormenta eléctrica en Tarapoto','https://radiouno.pe/noticias/2/lluvias/'),
    post(3,'Crecida del río Amazonas en Iquitos','https://radiouno.pe/noticias/3/rios/'),
    post(4,'Lluvias inundan la avenida San Martín','https://radiouno.pe/noticias/4/avenida/'),
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json(rows));
  const [withoutPlace, elsewhere, river, street] = await src.fetchItems({now:clock});
  assert.equal(withoutPlace.publisherRegion,'Tacna');
  assert.equal(withoutPlace.regions,undefined);
  assert.deepEqual(elsewhere.regions,['Puno','San Martín']);
  assert.equal(elsewhere.regionOrigin,'titular-prensa');
  assert.equal(elsewhere.kind,'prensa');
  assert.deepEqual(river.regions,['Loreto']);
  assert.equal(street.regions,undefined);
  assert.deepEqual(Object.keys(withoutPlace).sort(), ['category','id','kind','publishedAt','publisherRegion',
    'source','sourceId','sourceName','title','updatedAt','url'].sort());
  assert.equal(withoutPlace.publishedAt,'2026-11-27T00:30:00.000Z');
});

test('excluye inundaciones extranjeras, metáforas, fechas futuras y enlaces ajenos', async t => {
  const s=source('diario-voces');
  const root='https://diariovoces.com.pe/nota-';
  const rows=[
    post(1,'Estiaje deja sin agua a estudiantes de Tarapoto',root+'1/'),
    post(2,'Lluvias en Trujillo, Venezuela',root+'2/'),
    post(3,'Lluvia de goles en Tarapoto',root+'3/'),
    post(4,'Tarapoto soporta fuertes lluvias',root+'4/',{date_gmt:'2026-11-29T01:00:00'}),
    post(5,'Tormentas eléctricas en Tarapoto','https://diariovoces.com.pe.example/nota/'),
    post(6,'San Martín realiza mantenimiento de una quebrada',root+'6/'),
    post(7,'Tormentas eléctricas en Tarapoto',root+'7/?access_token=x'),
    post(8,'San Martín espera lluvias',root+'8/',{date_gmt:null}),
    post(9,'Perú y Ecuador coordinan ante las lluvias en Tumbes',root+'9/'),
  ];
  t.mock.method(globalThis,'fetch', async () => Response.json(rows));
  const records=await s.fetchItems({now:clock});
  assert.deepEqual(records.map(r=>r.id), ['diario-voces:1','diario-voces:9']);
  assert.deepEqual(records[0].regions,['San Martín']);
});

test('la edición conserva la lectura regional de main tras una falla de conexión en Actions', async t => {
  const src=source('walac');
  const url='https://walac.pe/piura-lluvias/';
  const api=t.mock.method(globalThis,'fetch',async () => Response.json([post(8,'Lluvias en Piura',url)]));
  const result=await collectSource(src,{},clock,true);
  assert.equal(result.source.status,'ok');
  const base={schemaVersion:2, updatedAt:clock.toISOString(), sources:[result.source],items:result.records};
  const later=new Date(+clock+3600000);
  const unrelated={id:'existing', sourceId:'coen',title:'Parte existente',summary:'Detalle de origen'};
  const production={schemaVersion:2,updatedAt:later.toISOString(),sources:[],items:[unrelated]};
  const merged=mergePanorama(base,production,+later);
  assert.deepEqual(merged.items.find(i=>i.id==='existing'),unrelated);
  assert.equal(merged.items.find(i=>i.sourceId==='walac').url,url);
  api.mock.mockImplementation(async () => new Response('',{status:503}));
  const retried=await collectSource(src,merged,later,true);
  assert.equal(retried.source.status,'stale');
  assert.equal(retried.source.lastSuccessAt,clock.toISOString());
  assert.deepEqual(retried.records,result.records);
  const expired=await collectSource(src,merged,new Date(+later+3*86400000),true);
  assert.equal(expired.records.length,0);
});
