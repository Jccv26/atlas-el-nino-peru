import assert from 'node:assert/strict';
import test from 'node:test';
import {applyImpactPdf, applyPressPage, buildLocalImpacts, parseCoenImpactPage} from '../lib/impactos-locales.mjs';

const url='https://portal.indeci.gob.pe/emergencias/reporte-paimas/';
const pdf='https://portal.indeci.gob.pe/wp-content/uploads/2026/11/reporte-16509.pdf';
const title='REPORTE COMPLEMENTARIO N.º 16509 – 26/11/2026 / COEN – INDECI / 17:55 HORAS (Reporte N.º 2) LLUVIAS INTENSAS EN EL DISTRITO DE PAIMAS – PIURA';
const item={id:'coen:'+url,sourceId:'coen',title,url,publishedAt:'2026-11-26T21:25:00.000Z',regions:['Piura']};
const now=new Date('2026-11-27T02:16:00Z');
const row=(date,text)=>'<tr><td>'+date+'</td><td>'+text+'</td></tr>';
const facts=row('26/11/2026 06:44 horas', 'Las lluvias ocasionaron daños en la infraestructura de transporte en el sector de San Pedro, distrito de Paimas, provincia de Ayabaca.');
const page=(rows=facts,anchor=pdf,heading=title)=>'<h1>Emergencias</h1><h1>'+heading+'</h1><div class="article"><table>'+row('Fecha y hora de la ocurrencia','Descripción')+rows+'</table><a href="'+anchor+'" download>PDF</a></div>';
const annex=title+'\n1. HECHOS:\n\f3.1 Información contextual\nRuta nacional: tránsito vehicular y peatonal restablecido.\n4. ACCIONES\n4.2 Desarrollo de acciones\n17:55 horas\nMunicipalidad Distrital de Paimas informó que la emergencia ha sido atendida, se procede al cierre del reporte.\n08:10 horas\n5. FUENTES:\n - REPORTE COMPLEMENTARIO N.º 16498 - 26/11/2026 / COEN - INDECI / 08:10 HORAS\n6. Anexo: Vista fotográfica\n\fANEXO\n VISTA FOTOGRÁFICA\n26 NOV 2026\n\f';
const run=opts=>buildLocalImpacts({items:[item],now,readPage:async()=>page(),readPdf:async()=>annex,readPress:async()=>'', ...opts});
test('COEN diferencia ocurrencia, emisión y cierre y enlaza la página del anexo',async()=>{
  const {events:[e]}=await run();
  assert.equal(e.district,'Paimas');assert.equal(e.province,'Ayabaca');assert.equal(e.locality,'San Pedro');
  assert.equal(e.occurredAt,'2026-11-26T11:44:00.000Z');assert.equal(e.reportedAt,'2026-11-26T22:55:00.000Z');
  assert.equal(e.status,'atendido');assert.equal(e.resolved,true);assert.equal(e.severe,undefined);
  assert.equal(e.recovery.url,pdf+'#page=2');assert.equal(e.evidence.find(v=>v.type==='fotos').url,pdf+'#page=3');
  assert.equal(e.timeline.filter(t=>t.at==='2026-11-26T13:10:00.000Z').length,1);
  assert.equal(e.checkedAt,now.toISOString());assert.ok(e.recommendations[0].url.includes('gob.pe'));
});
test('solo un parte vigente puede documentar una afectación grave y un cierre posterior la desactiva',async()=>{
  const base=(await run({limit:0})).events[0];
  const altered=title+'\n\f3.1 Información contextual\nRuta nacional: tránsito vehicular totalmente interrumpido.\n4. ACCIONES';
  assert.ok(applyImpactPdf(base,altered,pdf,title));assert.equal(base.severe,true);assert.ok(base.severityEvidence.url.endsWith('#page=2'));
  assert.equal(base.resolved,undefined);
  assert.equal(applyImpactPdf(base,altered.replace('16509','16500'),pdf,title),false);
  const former=annex.replace('17:55 horas\nMunicipalidad','07:00 horas\nMunicipalidad');
  const e=(await run({readPdf:async()=>former})).events[0];
  assert.notEqual(e.status,'atendido');
});
test('un índice, una ficha cambiada, datos personales o una tabla con múltiples lugares no se asignan al primer distrito',()=>{
  assert.equal(parseCoenImpactPage(page(facts,pdf,title.replace('16509','16498')),title),undefined);
  assert.deepEqual(parseCoenImpactPage(page(facts+facts),title),{pdfUrl:pdf});
  assert.deepEqual(parseCoenImpactPage(page(row('26/11/2026','Informe DNI 12345678')),title),{pdfUrl:pdf});
  assert.equal(parseCoenImpactPage(page(facts,'https://otro.example/archivo.pdf'),title).pdfUrl,undefined);
});
test('dos medios o dos partes cercanos no se fusionan en ausencia de prueba y los boletines y los pronósticos quedan fuera',async()=>{
  const press={id:'rpp:a',sourceId:'rpp',url:'https://rpp.pe/peru/piura/a',title:'Lluvias: calles inundadas en Piura',regions:['Piura'],publishedAt:item.publishedAt};
  const second={...press,id:'andina:b',url:'https://andina.pe/agencia/b',sourceId:'andina'};
  const coastal={...item,id:'coen:oleaje',url:url.replace('paimas','oleaje'),title:title.replace('LLUVIAS INTENSAS','OLEAJE ANÓMALO')};
  const discarded=[{...press,id:'forecast',title:'Pronostican lluvias y calles inundadas en Piura'}, {...item,id:'vientos',title:title.replace('LLUVIAS INTENSAS','VIENTOS FUERTES')},
    {...item,title:title.replace('REPORTE COMPLEMENTARIO','REPORTE DE PELIGRO INMINENTE')},{...item,title:title.replace('REPORTE COMPLEMENTARIO','BOLETÍN HIDROLÓGICO')},
    {...press,id:'fake',url:'https://rpp.pe.example.com/falso'}, {...press,id:'old',publishedAt:'2026-10-24'}];
  const {events}=await run({items:[press,press,second,coastal,...discarded],limit:0,pressLimit:0});
  assert.equal(events.length,3);assert.equal(events.filter(e=>e.kind==='prensa').length,2);
  assert.ok(events.every(e=>!e.corroborated && !e.severe));assert.equal(events.find(e=>e.kind==='oficial').layer,'mar');
});
test('la caché mantiene el último dato verificado ante caída y retira datos antiguos al cambiar el parte',async()=>{
  const previous=await run();
  const outage=await run({previous,now:new Date(+now+86400000/3),readPage:async()=>{throw Error('fuente caída');}});
  assert.equal(outage.events[0].resolved,true);assert.equal(outage.events[0].checkedAt,now.toISOString());
  const updated=await run({previous,items:[{...item,title:title.replace('16509','16510')}],readPage:async()=>{throw Error('pendiente');}});
  assert.equal(updated.events[0].resolved,undefined);assert.equal(updated.events[0].occurredAt,undefined);
  assert.equal(updated.events[0].id,previous.events[0].id);
});
test('la nota verifica URL, hora y autoría editorial y conserva material en su sitio de origen',async()=>{
  const press={id:'rpp:x',sourceId:'rpp',url:'https://rpp.pe/peru/piura/x',title:'Piura: lluvia deja calles inundadas [VIDEO]',regions:['Piura'],publishedAt:'2026-11-26T23:41:16.000Z'};
  const {events:[e]}=await run({items:[press],limit:0,pressLimit:0});
  const obj={'@type':'NewsArticle', mainEntityOfPage:{'@id':press.url}, headline:press.title,datePublished:'2026-11-26T18:41:16-05:00',dateModified:'2026-11-26T19:01:10-05:00',video:{'@type':'VideoObject'},articleBody:'La lluvia ha interrumpido el tránsito vehicular.'};
  const html=raw=>'<script type="application/ld+json">'+JSON.stringify(raw)+'</script>';
  assert.equal(applyPressPage(e,html({...obj,datePublished:'2025-11-26T18:41:16-05:00'}),now),false);
  assert.ok(applyPressPage(e,html(obj),now));assert.equal(e.updatedAt,'2026-11-27T00:01:10.000Z');
  assert.equal(e.evidence.find(v=>v.type==='video').url,press.url);assert.equal(e.severe,undefined);
});
test('el anexo distingue su propia fecha y leyenda de la fecha de publicación',async()=>{
 const image=annex.replace('VISTA FOTOGRÁFICA\n26 NOV 2026','VISTAS FOTOGRÁFICAS\n23 NOV 2026\n Lluvias intensas en el distrito de Paimas');
 const e=(await run({readPdf:async()=>image})).events[0].evidence.find(v=>v.type==='fotos');
 assert.equal(e.date,'2026-11-23');assert.equal(e.dateKind,'anexo');assert.match(e.caption,/Paimas/);
 const unknown=(await run({readPdf:async()=>image.replace('23 NOV 2026','sin fecha')})).events[0].evidence.find(v=>v.type==='fotos');
 assert.equal(unknown.dateKind,'publicacion');assert.notEqual(unknown.date,'2026-11-23');
});
test('una ficha ya verificada sobrevive al cambio de la ventana RSS, pero expira o se retira de inmediato',async()=>{
 const previous=await run();
 const archived=await run({previous,items:[],now:new Date(+now+3600000)});
 assert.equal(archived.events[0].checkedAt,previous.events[0].checkedAt);assert.equal(archived.events[0].feedArchived,true);
 assert.equal((await run({previous,items:[],now:new Date(+now+8*86400000)})).events.length,0);
 assert.equal((await run({previous,items:[{...item,withdrawnAt:now.toISOString()}]})).events.length,0);
});
test('dos URL de COEN se agrupan si la edición posterior identifica el parte anterior, el distrito y el fenómeno',async()=>{
 const prior={...item,id:'coen:anterior',url:url.replace('paimas','primero'),title:title.replace('16509','16498').replace('17:55','08:10').replace('N.º 2','N.º 1')};
 const nearby={...prior,id:'coen:otro',url:url.replace('paimas','otro'),title:prior.title.replace('PAIMAS','CASTILLA')};
 const result=await run({items:[item,prior,nearby],readPage:async candidate=>{
   if(candidate===item.url)return page();
   throw Error('fuente antigua');
 }});
 assert.deepEqual(result.events.map(e=>e.district).sort(),['Castilla','Paimas']);
});
test('un parte municipal de afectación constatada conserva calles y emisor, aunque no exista parte COEN',async()=>{
 const note={id:'municipalidad-piura:1234567',sourceId:'municipalidad-piura',title:'Lluvias anegan vías del distrito de Castilla',region:'Piura',district:'Castilla',province:'Piura',localities:['Calle Norte','Calle Sur'],url:'https://www.gob.pe/institucion/munipiura/noticias/1234567-lluvias-en-castilla',publishedAt:item.publishedAt,firstSeenAt:now.toISOString(),summary:'La municipalidad reportó vías anegadas en Castilla.',category:'Lluvias',territorialReport:{type:'afectacion-observada'}};
 const {events}=await run({items:[note,{...note,id:'fake',url:'https://www.gob.pe/institucion/munitumbes/noticias/1234567-otra-provincia'}]});
 assert.equal(events.length,1);assert.equal(events[0].source,'Municipalidad Provincial de Piura');assert.equal(events[0].kind,'oficial');
 assert.deepEqual(events[0].localities,['Calle Norte','Calle Sur']);assert.equal(events[0].district,'Castilla');assert.equal(events[0].severe,undefined);
});
