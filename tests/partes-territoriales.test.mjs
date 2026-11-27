import test from 'node:test';
import assert from 'node:assert/strict';
import {partesTerritoriales,localImpactFromItem,territorialIndex,territorialArticle} from '../lib/partes-territoriales.mjs';

const issuer={slug:'munipiura',region:'Piura',regionId:'20',name:'Municipalidad Provincial de Piura'};
const source=partesTerritoriales.find(s=>s.id==='municipalidad-piura');
const now=new Date('2026-11-27T02:00:00Z');
const url=source.url+'/1479811-municipalidad-de-piura-evacua-aguas-pluviales-en-dos-puntos-criticos-de-la-ciudad';
const title='Municipalidad de Piura evacúa aguas pluviales en dos puntos críticos de la ciudad';
const date='23 de noviembre de 2026 -  2:43 p. m.';
const candidate={url,title,publishedAt:'2026-11-23T19:43:00.000Z'};
const card=(href=url,t=title,stamp='2026-11-23 14:43:00.000')=>'<li><h3><a href="'+href+'">'+t+'</a></h3><time datetime="'+stamp+'">fecha</time></li>';
const page=(text,t=title,stamp=date)=>'<h1>'+t+'</h1>Nota de prensa<p>'+stamp+'</p><section class="body"><div>'+text+'</div></section>';
const realCase='La Municipalidad Provincial de Piura reportó acumulación de agua en dos puntos de la ciudad. A través de la Subgerencia de Gestión del Riesgo de Desastres se intervino la intersección de las avenidas Loreto y Don Bosco, donde se utilizaron motobombas para retirar las aguas acumuladas. Asimismo, se realizaron trabajos de evacuación de aguas pluviales en la avenida Las Azucenas.';

test('recupera y contrasta fecha y hora en el índice y la nota, dejando el distrito sin asignar',async()=>{
  const fetchImpl=async u=>new Response(u===url?page(realCase):card(),{headers:{'content-type':'text/html; charset=utf-8'}});
  const [item]=await source.fetchItems({now,fetchImpl});
  const event=localImpactFromItem(item);
  assert.equal(item.territorialReport.publicationType,'Nota de prensa');
  assert.equal(event.reportedAt,'2026-11-23T19:43:00.000Z');
  assert.equal(event.source,issuer.name);
  assert.equal(event.district,undefined);
  assert.equal(event.province,undefined);
  assert.equal(event.locality,undefined);
  assert.deepEqual(event.localities,['intersección de las avenidas Loreto y Don Bosco','avenida Las Azucenas']);
  assert.equal(event.occurredAt,undefined);
  assert.equal(event.evidence[0].url,url);
});

test('excluye simulacros, planes, negaciones, eventos fuera de jurisdicción, anuncios antiguos y enlaces ajenos',()=>{
  for(const body of [
    'La Municipalidad Provincial de Piura prepara un simulacro en el sector Los Pinos ante posibles viviendas inundadas.',
    'La Municipalidad Provincial de Piura informa que no hubo viviendas inundadas en el distrito de Castilla.',
    'La Municipalidad Provincial de Piura informó que las lluvias dejaron viviendas inundadas en el distrito de Castilla, en Arequipa.',
    'La Municipalidad Provincial de Piura recomendó medidas para evitar viviendas inundadas en el barrio El Portal.',
    'La Municipalidad Provincial de Piura desplegó bombas en preparación para las lluvias e inundaciones del próximo año.',
  ]) assert.equal(territorialArticle(page(body),candidate,issuer,now),undefined);
  assert.equal(territorialArticle(page(realCase),candidate,issuer,new Date('2026-12-05T00:00:00Z')),undefined);
  const external='https://example.org/institucion/munipiura/noticias/123456-lluvias';
  assert.deepEqual(territorialIndex(card()+card(external)+card(url,title,'2027-01-01 10:00:00.000'),issuer,now),[candidate]);
  assert.equal(localImpactFromItem({...candidate,sourceId:'coen'}),undefined);
});

test('acepta distrito y sector expresos y conserva la última lectura si la nueva nota deja de ser verificable',async()=>{
  const body='La Municipalidad Provincial de Piura indicó que las lluvias ocasionaron daños en el sector Los Pinos, en el distrito de Castilla.';
  const one=territorialArticle(page(body),candidate,issuer,now);
  assert.equal(one.district,'Castilla');assert.equal(one.province,undefined);assert.equal(one.locality,'sector Los Pinos');
  const event=localImpactFromItem(one);
  assert.equal(event.district,'Castilla');assert.equal(event.locality,'sector Los Pinos');
  assert.throws(()=>territorialArticle(page(body,title,'23 de noviembre de 2026 - 3:43 p. m.'),candidate,issuer,now));
  const fail=async u=>new Response(u===url?'<h1>desconocido</h1>':card(),{headers:{'content-type':'text/html'}});
  await assert.rejects(()=>source.fetchItems({now,previousItems:[one],fetchImpl:fail}),/inaccesibles/);
});

test('una nota sin hora es insuficiente y un índice ilegible genera fallo de fuente',()=>{
  assert.deepEqual(territorialIndex(card(url,title,'2026-11-23'),issuer,now),[]);
  assert.throws(()=>territorialIndex('<h1>Acceso en mantenimiento</h1>',issuer,now));
  assert.throws(()=>territorialArticle(page(realCase,title,'23 de noviembre de 2026'),candidate,issuer,now));
});
