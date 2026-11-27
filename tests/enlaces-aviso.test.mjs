import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {avisoKey,resolveAviso,buildOriginalIndex,validatedOriginal} from '../public/enlaces-aviso.mjs';
import {editionOriginalIndex} from '../lib/edicion-local.mjs';
import {mirrorPublic} from '../scripts/estado-ci.mjs';

const pdf='https://www.senamhi.gob.pe/prod/sismet/v1/api/v1/public/resources/1729/file';
const url='https://portal.indeci.gob.pe/emergencias/reporte-complementario-de-lluvias-en-piura/';
const publication='2026-11-27T02:00:00Z';
const item={id:'coen:'+url,sourceId:'coen',url,title:'Reporte complementario 15',publishedAt:publication};
const signal={id:'obs:muy largo',type:'observacion',url:pdf,text:'Una misma oración del boletín menciona dos estaciones.',
  region:'Piura',province:'Sullana',locality:'El Chira',from:publication};
const noSignal={...signal,type:'pronostico',issuedAt:publication};

test('un historial extenso conserva los originales actuales y acota su peso en la edición móvil',async()=>{
  const previous={};
  for(let i=0;i<1200;i++) {
    const key='u'+String(i).padStart(22,'0');
    previous[key]='https://portal.indeci.gob.pe/emergencias/'+('reporte-'.repeat(145))+i+'/';
  }
  const archive=await buildOriginalIndex({items:[item],previous});
  assert.ok(Buffer.byteLength(JSON.stringify(archive))<=1024*1024);
  assert.ok(Object.keys(archive).length<Object.keys(previous).length);
  const original=await resolveAviso(await avisoKey(item),{originals:archive});
  assert.equal(original.originalUrl,url);
});

test('identidad compacta por documento, tipo, estación, distrito y edición, estable ante cambios de la pantalla',async()=>{
  const token=await avisoKey(signal);
  assert.ok(token.length<55 && !token.includes('http'));
  assert.equal(token,await avisoKey({...signal,recent:true,mark:'otros',label:'Medición anterior',id:'otra etiqueta larga',area:'2006'}));
  const variants=[
    {...signal,locality:'La Ardilla'}, {...signal,district:'Lancones'}, {...signal,url:pdf.replace('1729','1731')},
    noSignal,{...noSignal,district:'Lancones'}, {...noSignal,district:'Salitral'},
  ];
  const keys=await Promise.all([signal,...variants].map(avisoKey));
  assert.equal(new Set(keys).size,keys.length);
  assert.equal((await resolveAviso(token,{signals:[...variants,signal]})).record,signal);
  assert.equal((await resolveAviso(await avisoKey(item),{items:[item]})).kind,'item');
  assert.notEqual(await avisoKey(item),await avisoKey({...item,title:'Reporte complementario 16',publishedAt:'2026-11-28T03:00:00Z'}));
  const station={...item,sourceId:'senamhi-rios',id:'senamhi-rios:2026-1',stationName:'Puchaca',observedAt:publication};
  assert.notEqual(await avisoKey({id:station.id,type:'estacion',item:station}),
    await avisoKey({id:station.id,type:'estacion',item:{...station,observedAt:'2026-11-28T03:00:00Z'}}));
});

test('al desaparecer un registro abre solo el documento verificado, compartido entre varias fichas',async()=>{
  const newer={...noSignal,district:'Lancones'};
  const before=await buildOriginalIndex({items:[item],signals:[signal,newer]});
  assert.equal(Object.keys(before).length,2);
  const urls=await buildOriginalIndex({previous:before});
  assert.deepEqual(await resolveAviso(await avisoKey(signal),{originals:urls}),{kind:'archived',originalUrl:pdf});
  assert.deepEqual(await resolveAviso(await avisoKey(item),{originals:urls}),{kind:'archived',originalUrl:url});
  const falseRadar=(await avisoKey(signal)).replace(/\.r[\w]+$/,'.rded');
  assert.equal((await resolveAviso(falseRadar,{originals:urls})).kind,'missing');
  assert.equal((await resolveAviso(await avisoKey(item),{originals:{[Object.keys(before).find(k=>k.startsWith('u'))]:'https://rpp.pe/peru/lluvia-noticia-8453'}})).kind,'missing');
});

test('solo permite enlaces de ediciones por ruta y parámetros, descarta rastreadores, credenciales y redirecciones',async()=>{
  const bad=['https://portal.indeci.gob.pe.ejemplo.org/emergencias/test/', 'javascript:alert(1)', '//ejemplo.org/a',
    'https://evil.org@portal.indeci.gob.pe/emergencias/con-lluvia/','https://portal.indeci.gob.pe/emergencias/lluvias/?next=https://evil.org',
    'https://www.senamhi.gob.pe/?p=aviso-meteorologico-vigente&a=2026&b=3333&c=00&d=SENA&b=1',
    'https://www.gob.pe/redirect?url=https://example.com', 'https://eltiempo.pe/abre%2F%2Fevil.org/'];
  for(const raw of bad) assert.equal(validatedOriginal(raw),null,raw);
  assert.equal(validatedOriginal(url+'?utm_source=web'),url);
  assert.equal(validatedOriginal('https://www.senamhi.gob.pe/?p=aviso-activacion-quebrada'),null);
  assert.equal(validatedOriginal('https://www.senamhi.gob.pe/?p=avisos-detalle-hidrologicos&ca=70788&ce=4724A3F6'),
    'https://www.senamhi.gob.pe/?p=avisos-detalle-hidrologicos&ca=70788&ce=4724A3F6');
  assert.equal((await resolveAviso('https://example.com')).kind,'invalid');
  assert.equal((await resolveAviso('__proto__')).kind,'invalid');
  assert.equal(await avisoKey({url:'https://evil.org'}),'');
});

test('SUNASS dirige al buscador con el código de referencia cuando el registro dejó de aparecer',async()=>{
  const sourceDirectoryUrl='https://aplicaciones.sunass.gob.pe/Interrupciones/consultaInterrupcion.html';
  const row={id:'sunass:078412',sourceId:'sunass',url:sourceDirectoryUrl};
  const originals=await buildOriginalIndex({items:[row]});
  assert.deepEqual(await resolveAviso(await avisoKey(row),{originals}),{kind:'missing',sourceDirectoryUrl,sourceRecordId:'078412',sourceName:'SUNASS'});
});

test('migra la edición previa y conserva originales aunque GitHub reemplace el listado de una fuente',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'atlas-enlaces-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=join(temp,'root'),cache=join(temp,'cache');
  await Promise.all([mkdir(join(root,'public/data'),{recursive:true}),mkdir(join(cache,'public/data'),{recursive:true})]);
  const edition=(updatedAt,items)=>({schemaVersion:2,updatedAt,items,sources:[{id:'coen',count:items.length,status:'ok',lastSuccessAt:updatedAt,checkedAt:updatedAt}]});
  const published=edition('2026-11-27T02:00:00Z',[item]);
  const latest=edition('2026-11-27T03:00:00Z',[]);
  await writeFile(join(cache,'public/data/panorama.json'),JSON.stringify(published));
  await mirrorPublic(root,cache,Date.parse('2026-11-27T03:01:00Z'),true,latest);
  const merged=JSON.parse(await readFile(join(root,'public/data/panorama.json')));
  assert.equal(merged.items.length,0);
  const after=await editionOriginalIndex(edition('2026-11-27T04:00:00Z',[]),merged);
  assert.deepEqual(await resolveAviso(await avisoKey(item),{originals:after}),{kind:'archived',originalUrl:url});
});

test('reabre publicaciones regionales archivadas y limita cada dominio a sus rutas editoriales',async()=>{
  const examples=[
    ['walac','https://walac.pe/piura-intensa-lluvia-inunda-diferentes-calles-de-la-ciudad/'],
    ['pachamama-radio','https://pachamamaradio.org/puno-preven-hasta-90-de-probabilidad-de-lluvias-del-28-al-30/'],
    ['diario-voces','https://diariovoces.com.pe/soritor-bajo-amenaza-sanitaria-fiscalia-constata-grave-contaminacion-en-lagunas-de-oxidacion-y-quebrada-capellania/'],
    ['radio-uno','https://radiouno.pe/noticias/288984/lluvias-dejan-enorme-laguna-en-la-avenida-jorge-basadre-y-dificultan-el-transito-vehicular/'],
    ['newstrujillo','https://newstrujillo.com/fuerte-oleaje-destruye-losa-deportiva-y-socava-la-ribera-en-el-sector-taquila/'],
  ];
  const items=examples.map(([sourceId,url])=>({sourceId,id:sourceId+':'+url,url,title:'Publicación del medio',publishedAt:publication}));
  const originals=await buildOriginalIndex({items});
  for(const row of items){
    assert.equal(validatedOriginal(row.url),row.url);
    assert.equal(validatedOriginal(row.url+'?utm_campaign=compartir'),row.url);
    assert.deepEqual(await resolveAviso(await avisoKey(row),{originals}),{kind:'archived',originalUrl:row.url});
  }
  for(const url of ['https://walac.pe/categoria/la-ciudad-de-piura/','https://www.pachamamaradio.org/wp-json/wp/v2/posts',
    'https://newstrujillo.com/feed/','https://newstrujillo.com/categoria/un-oleaje/', 'https://archivo.newstrujillo.com/fuerte-oleaje-en-taquila/',
    'https://diariovoces.com.pe/?redirect=https://example.org','https://radiouno.pe/noticias/288984/',
    'https://radiouno.pe/categoria/288984/lluvias-en-tacna/','https://radiouno.pe/noticias/abc/lluvias-en-tacna/',
    'https://archivo.radiouno.pe/noticias/288984/lluvias-en-tacna/','https://pachamamaradio.org.ejemplo.org/lluvias-en-puno/']){
    assert.equal(validatedOriginal(url),null,url);
  }
});
