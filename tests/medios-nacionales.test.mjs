import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaSources} from '../lib/medios.mjs';
import {collectSource} from '../lib/panorama.mjs';
import {avisoKey,buildOriginalIndex,resolveAviso,validatedOriginal} from '../public/enlaces-aviso.mjs';

const now=new Date('2026-11-27T03:10:00Z');
const rpp='https://rpp.pe/peru/actualidad/piura-cerca-de-50-personas-quedan-atrapadas-en-un-centro-comercial-por-inundacion-en-las-calles-tras-fuertes-lluvias-noticia-1720050';
const comercio='https://elcomercio.pe/peru/piura/piura-lluvias-torrenciales-inundan-la-plaza-tres-culturas-y-otras-zonas-vulnerables-fenomeno-el-nino-senamhi-ayabaca-morropon-ultimas-noticia/';
const rr='Piura: inundaciones por fuertes lluvias impidieron a peatones desplazarse a sus viviendas';
const ec='Piura: lluvias torrenciales inundan la Plaza Tres Culturas y otras zonas vulnerables';
const source=id=>mediaSources.find(s=>s.id===id);
const http=xml=>new Response(xml,{headers:{'content-type':'application/xml'}});
function rss(entries) {
  return '<rss><channel>'+entries.map(([title,link,date])=>'<item><title><![CDATA['+title+']]></title><link>'+link+
    '</link><pubDate>'+date+'</pubDate><description>Contenido ajeno al titular</description><content:encoded><![CDATA[texto que no se debe republicar]]></content:encoded></item>').join('')+'</channel></rss>';
}
function xmlNews(name='RPP') {
  return '<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>'+rpp+
    '</loc><lastmod>2026-11-26T21:32:13-05:00</lastmod><image:image><image:loc>https://cdn.example.org/foto</image:loc><image:title>Imagen distinta</image:title></image:image>'+
    '<news:news><news:publication><news:name>'+name+'</news:name><news:language>es</news:language></news:publication><news:publication_date>2026-11-26T19:42:23-05:00</news:publication_date><news:title>'+
    rr+'</news:title></news:news></url></urlset>';
}

test('RPP reúne RSS y sitemap con una sola nota, conserva su ID histórico y separa publicación de actualización',async()=>{
  const urls=[];const date='Thu, 26 Nov 2026 19:42:23 -0500';
  const rows=await source('rpp').fetchItems({now,fetchImpl:async url=>{
    urls.push(url);return http(url.endsWith('/rss') ? rss([[rr,rpp,date],['Lluvia de goles en la final',rpp.replace('1720050','1720061'),date]]) : xmlNews());
  }});
  assert.equal(urls.length,2);
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,'rpp:'+rpp);
  assert.equal(rows[0].publishedAt,'2026-11-27T00:42:23.000Z');
  assert.equal(rows[0].updatedAt,'2026-11-27T02:32:13.000Z');
  assert.equal(rows[0].kind,'prensa');
  assert.deepEqual(rows[0].regions,['Piura']);
  assert.ok(!JSON.stringify(rows[0]).includes('no se debe republicar'));
});

test('El Comercio cruza sus tres RSS, valida edición, emisor y vigencia y enlaza al artículo después de rotar',async()=>{
  const date='Thu, 26 Nov 2026 19:08:21 -0500';
  let checks;const expected=source('el-comercio');
  const rows=await expected.fetchItems({now,onReading:x=>{checks=x;},fetchImpl:async url=>{
    if(url.includes('/lima/')) return new Response('',{status:503});
    return http(rss([[ec,comercio,date],['Lluvias en ciudad ajena',comercio.replace('elcomercio.pe','example.org'),date],
      ['Lluvias en México','https://elcomercio.pe/mundo/latinoamerica/lluvias-en-mexico-noticia/',date],
      ['Lluvias en Piura',comercio.replace('/piura/','/paita/'),'Fri, 20 Nov 2026 19:00:00 -0500'],
      ['Lluvias en Lima',comercio.replace('/piura/','/lima/'),'Fri, 27 Nov 2026 09:00:00 -0500']]));
  }});
  assert.deepEqual(checks.nationalPressCoverage,{channelsRead:2,totalChannels:3});
  assert.equal(rows.length,1);
  assert.equal(rows[0].publishedAt,'2026-11-27T00:08:21.000Z');
  assert.ok(!rows[0].updatedAt);
  const originals=await buildOriginalIndex({items:rows});
  assert.deepEqual(await resolveAviso(await avisoKey(rows[0]),{originals}),{kind:'archived',originalUrl:comercio});
});

test('si todos los canales fallan el recolector conserva el registro y la última hora de éxito',async t=>{
  const s=source('el-comercio');
  const item={id:s.id+':'+comercio,sourceId:s.id,title:ec,url:comercio,kind:'prensa',category:'Lluvias',publishedAt:'2026-11-27T00:08:21.000Z'};
  const prior={sources:[{...s,status:'ok',count:1,checkedAt:'2026-11-27T02:30:00.000Z',lastSuccessAt:'2026-11-27T02:30:00.000Z'}],items:[item]};
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  const outcome=await collectSource(s,prior,now,true);
  assert.equal(outcome.records.length,1);
  assert.equal(outcome.records[0].id,item.id);
  assert.equal(outcome.source.status,'stale');
  assert.equal(outcome.source.lastSuccessAt,prior.sources[0].lastSuccessAt);
});

test('los enlaces compartidos nacionales aceptan artículos de ambos editores y rechazan búsquedas y redirecciones',async()=>{
  for(const [sourceId,url] of [['rpp',rpp],['el-comercio',comercio]]){
    assert.equal(validatedOriginal(url),url);
    const entry={id:sourceId+':'+url,sourceId,url};
    const originals=await buildOriginalIndex({items:[entry]});
    assert.deepEqual(await resolveAviso(await avisoKey(entry),{originals}),{kind:'archived',originalUrl:url});
  }
  for(const url of ['https://elcomercio.pe/buscar/?q=piura','https://elcomercio.pe/peru/piura/','https://elcomercio.pe.ejemplo.org/peru/prueba-lluvias-noticia/',
    'https://rpp.pe/buscar?q=piura',rpp+'?next=https://example.org',comercio+'?destino=https://example.org'])assert.equal(validatedOriginal(url),null);
});

test('una nota extranjera de un RSS antiguo sale incluso al servir caché o fallar la siguiente lectura',async t=>{
  const s=source('rpp'), publishedAt='2026-11-27T00:01:00.000Z';
  const keep={id:'rpp:'+rpp,sourceId:'rpp',title:rr,url:rpp,kind:'prensa',publishedAt};
  const url='https://rpp.pe/mundo/estados-unidos/tormentas-inundaciones-y-nieve-azotan-a-ee-uu-este-dia-de-accion-de-gracias-noticia-1720033';
  const drop={...keep,id:'rpp:'+url,url,title:'Tormentas, inundaciones y nieve azotan a EE. UU. este Día de Acción de Gracias'};
  const recent='2026-11-27T03:08:00.000Z';
  const prior={sources:[{id:'rpp',status:'ok',count:2,checkedAt:recent,lastSuccessAt:recent}],items:[keep,drop]};
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  for (const force of [false,true]){
    const result=await collectSource(s,prior,now,force);
    assert.deepEqual(result.records,[keep]);
    assert.equal(result.source.count,1);
    assert.equal(result.source.lastSuccessAt,recent);
  }
});
