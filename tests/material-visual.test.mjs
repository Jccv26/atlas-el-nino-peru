import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichPressVisuals,hasPublisherPhoto} from '../lib/medios-visuales.mjs';
import {visualMaterials} from '../public/material-visual.mjs';

const url='https://walac.pe/piura-intensa-lluvia-inunda-diferentes-calles-de-la-ciudad/';
const article={kind:'prensa',id:'walac:32',sourceId:'walac',sourceName:'Walac Noticias',title:'Piura: lluvia inunda calles',url,publishedAt:'2026-11-26T20:00:00Z'};
const item=()=>({...article}), now=new Date('2026-11-27T02:00:00Z');
const photo={type:'rich',version:'1.0',provider_url:'https://walac.pe',thumbnail_url:'https://walac.pe/wp-content/uploads/2026/11/image-10.png',
  html:'<blockquote>Texto de la nota</blockquote><iframe src="'+url+'embed/#?secret=TEMP"></iframe>'};
const reply=x=>Response.json(x);
test('acepta la tarjeta ofrecida para la noticia exacta y rechaza imágenes o marcos ajenos',()=>{
  assert.ok(hasPublisherPhoto(url,photo));
  for(const changes of [{thumbnail_url:'https://otra.pe/wp-content/uploads/2026/11/foto.jpg'},{thumbnail_url:''},
    {provider_url:'https://walac.pe.otro.com'},{html:'<iframe src="https://walac.pe/otra-nota/embed/"></iframe>'},
    {html:photo.html+photo.html},{html:'<img src="'+photo.thumbnail_url+'">'},{type:'photo'}])assert.equal(hasPublisherPhoto(url,{...photo,...changes}),false);
});
test('una tarjeta verificada llega a la ficha y al impacto, y una corrección retira una foto anterior',async()=>{
  const snapshot=()=>({items:[item()],sources:[],impacts:{events:[{sourceId:'walac',kind:'prensa',url}]}});
  let calls=0;
  const transport=async u=>{calls++;assert.equal(u.origin,'https://walac.pe');assert.equal(u.searchParams.get('url'),url);return reply(photo);};
  const a=await enrichPressVisuals(snapshot(),{},{now,fetchImpl:transport});
  assert.equal(calls,1);
  assert.deepEqual(a.items[0].pressVisual,a.impacts.events[0].pressVisual);
  assert.ok(!JSON.stringify(a).includes('TEMP') && !JSON.stringify(a).includes('image-10'));
  const b=await enrichPressVisuals(snapshot(),a,{now,fetchImpl:transport});
  assert.equal(calls,1);
  assert.equal(visualMaterials(b.items[0])[0].frame,url+'embed/');
  b.items[0].updatedAt='2026-11-27T01:00:00Z';
  await enrichPressVisuals(b,a,{now,fetchImpl:async()=>reply({...photo,thumbnail_url:''})});
  assert.deepEqual(visualMaterials(b.items[0]),[]);
  assert.equal(b.impacts.events[0].pressVisual,undefined);
});
test('mantiene sólo la foto acreditada de esa nota, el canal oficial o la página comprobada del anexo',()=>{
  const pdf='https://portal.indeci.gob.pe/wp-content/uploads/2026/11/REPORTE-16509.pdf#page=6';
  const actual={type:'fotos',label:'Anexo',page:6,url:pdf,dateKind:'anexo',date:'2026-11-20'};
  const record={sourceId:'coen',url:'https://portal.indeci.gob.pe/emergencias/ejemplo-del-caso/',evidence:[actual]};
  const annex=visualMaterials({event:record})[0];
  assert.equal(annex.origin,pdf);
  assert.equal(annex.frame,undefined);
  assert.deepEqual(visualMaterials({...record,evidence:[{...actual,page:9}]}),[]);
  const video={kind:'video',sourceId:'senamhi-youtube',id:'senamhi-youtube:87rgxjPMmuE',url:'https://www.youtube.com/watch?v=87rgxjPMmuE'};
  assert.equal(visualMaterials(video)[0].frame,'https://www.youtube-nocookie.com/embed/87rgxjPMmuE');
  assert.deepEqual(visualMaterials({...video,id:'senamhi-youtube:yyyyyyyyyyy'}),[]);
  const andina='https://andina.pe/agencia/noticia-ejercito-tumbes-1101569.aspx';
  const links=visualMaterials({sourceId:'andina',url:andina,evidence:[{type:'fotos',source:'Andina / Difusión',url:andina}]});
  assert.equal(links[0].origin,andina);assert.equal(links[0].frame,undefined);
});

test('la semilla antigua respeta la retirada más reciente de una foto',async()=>{
  const check={url,revision:article.publishedAt};
  const stale={...item(),pressVisual:{type:'oembed-photo',url},visualCheck:{...check,at:'2026-11-26T21:00:00Z'}};
  const newest={...item(),visualCheck:{...check,at:'2026-11-26T22:00:00Z'}};
  const result=await enrichPressVisuals({items:[stale]},{items:[newest]},{now,limit:0});
  assert.equal(result.items[0].pressVisual,undefined);
  assert.deepEqual(result.items[0].visualCheck,newest.visualCheck);
});
