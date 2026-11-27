import test from 'node:test';
import assert from 'node:assert/strict';
import {readWeatherIndex,readWeatherDetail,mergeWeatherRecords,weatherIndexUrl} from '../public/avisos-meteorologicos-api.mjs';
import {fetchWeatherSample,meteorologicalReader,withMeteorologicalReading} from '../public/consulta-meteo.mjs';
import {meteorologicalSource} from '../lib/meteo-respaldo.mjs';
import {noticeForRegionDay} from '../public/avisos-mapa.mjs';
import {localSignals} from '../public/senales.mjs';

const now=Date.parse('2026-11-27T05:30:00Z');
const red={code:4,colorBackground:'#ff0000'},yellow={code:2,colorBackground:'#ffff00'};
const title='PRECIPITACIONES EN LA COSTA NORTE Y SIERRA';
const index=()=>({status:true,data:[{id:29404,number:486,title,startDate:'27/11/2026 00:00 horas',endDate:'28/11/2026 23:59 horas',status:'Vigente',level:red}]});
function detail() {
  return {status:true,data:{weatherWarning:{id:29404,number:486,title,level:red,
    description:'SENAMHI prevé precipitaciones durante los próximos dos días.',
    publicationDate:'26/11/2026 15:02 horas',startDate:'viernes, 27 de noviembre de 2026 a las 00:00 horas',endDate:'sábado, 28 de noviembre de 2026 a las 23:59 horas',
    maps:['viernes, 27 de noviembre de 2026','sábado, 28 de noviembre de 2026'].map((date,i)=>({date,mapNumber:i+1,
      startHour:'00:00 horas',endHour:'23:59 horas',level:i?yellow:red,wmsParameters:{viewparams:'qry:486_'+(i+1)+'_2026'},
      departments:i?[{id:'15',name:'LIMA',provinces:[{id:'06',name:'HUARAL'}]}]:
        [{id:'20',name:'PIURA',provinces:[{id:'01',name:'PIURA'}]},{id:'15',name:'LIMA',provinces:[{id:'01',name:'LIMA'}]}]}))}}};
}
const records=()=>[readWeatherDetail(detail(),readWeatherIndex(index(),now)[0],now)];
const oldEdition=()=>({updatedAt:'2026-11-26T17:00:00Z',sources:[{id:'senamhi-meteo',status:'stale',lastSuccessAt:'2026-11-26T17:00:00Z'}],
  items:[{id:'otra',sourceId:'coen'}],radar:{observations:[],forecasts:[]},impacts:{events:[]}});
const json=data=>({ok:true,json:async()=>data});
const goodFetch=async url=>json(url===weatherIndexUrl?index():detail());

test('los mapas diarios separan Lima Metropolitana, provincias y nivel nacional',()=>{
  const [notice]=records();
  assert.equal(notice.validFrom,'2026-11-27T05:00:00.000Z');
  assert.equal(notice.validUntil,'2026-11-29T04:59:00.000Z');
  assert.equal(notice.publishedAt,'2026-11-26T20:02:00.000Z');
  assert.equal(notice.category,'Lluvias');
  assert.deepEqual(notice.coverageDays.map(day=>day.regions),[['Piura','Lima Metropolitana'],['Lima']]);
  assert.deepEqual(notice.coverageDays[1].provincesByRegion.Lima,['Huaral']);
  assert.match(notice.coverageDays[1].url,/av=486&nl=2&mp=2&fc=2026/);
  assert.equal(notice.regionLevels,undefined);
  assert.ok(notice.coverageDays.every(d=>!d.regionLevels&&!d.districtLevels));
  assert.equal(noticeForRegionDay(notice,'Lima Metropolitana',now).applicableDates[0],'2026-11-27');
  assert.equal(noticeForRegionDay(notice,'Lima',now).applicableDates[0],'2026-11-28');
  const signals=localSignals(oldEdition(),[notice],undefined,now);
  assert.ok(signals.some(s=>s.mode==='pronostico') && signals.every(s=>s.type!=='impacto'));
});

test('descarta detalles cruzados, cobertura incompleta y fechas fuera de la edición',()=>{
  const [lead]=readWeatherIndex(index(),now);
  for(const edit of [d=>d.number++,d=>d.title='Aviso distinto',d=>d.maps.pop(),d=>d.maps[1].mapNumber=1,d=>d.maps[1].date=d.maps[0].date,
    d=>d.maps[1].wmsParameters.viewparams='qry:485_2_2026',d=>d.maps[0].departments[0].name='Lima',d=>d.maps[0].departments[1].provinces[0].name='Huaral',
    d=>d.maps[0].departments[0].provinces=[],d=>d.publicationDate='28/11/2026 20:00 horas',d=>d.level={code:4,colorBackground:'#ffff00'}]) {
    const value=detail();edit(value.data.weatherWarning);assert.throws(()=>readWeatherDetail(value,lead,now));
  }
  const duplicates=index();duplicates.data.push(duplicates.data[0]);assert.throws(()=>readWeatherIndex(duplicates,now));
  assert.throws(()=>readWeatherIndex(index(),Date.parse('2026-11-30')));
});

test('un aviso válido conserva precisión anterior y el índice no borra avisos activos desconocidos',()=>{
  const [record]=records(),old={...record,districtLevels:{'200101':['AMARILLO']},coverageUrls:[...record.coverageUrls,'https://www.senamhi.gob.pe/?p=aviso-meteorologico']};
  assert.deepEqual(mergeWeatherRecords([record],[old],now)[0].districtLevels,old.districtLevels);
  assert.equal(mergeWeatherRecords([record],[old],now)[0].coverageUrls.length,3);
  const changed={...record,level:'NARANJA'};
  assert.equal(mergeWeatherRecords([changed],[old],now)[0].districtLevels,undefined);
  assert.throws(()=>mergeWeatherRecords([record],[{...old,id:'senamhi-meteo:2026-487'}],now));
});

test('consulta directa desde caché validada, sin tocar fecha ni otros emisores; rechaza respuestas atrasadas',async()=>{
  const saved=new Map(),storage={getItem:key=>saved.get(key),setItem:(key,v)=>saved.set(key,v)};
  const edition=oldEdition();let calls=0;
  const reader=meteorologicalReader({request:async (...args)=>{calls++;return goodFetch(...args);},clock:()=>now,storage});
  const p=reader.refresh(edition);assert.equal(reader.refresh(edition),p);await p;
  assert.equal(reader.failed,false);assert.equal(calls,2);assert.equal(reader.refresh(edition),null);
  const served=withMeteorologicalReading(edition,reader.sample,now);
  assert.equal(served.updatedAt,edition.updatedAt);assert.equal(served.sources,edition.sources);
  assert.equal(served.items[0],edition.items[0]);assert.equal(served.items[1].directMeteoCheckedAt,reader.sample.checkedAt);
  assert.equal(edition.items.length,1);
  const restored=meteorologicalReader({clock:()=>now+60000,storage});
  assert.deepEqual(restored.sample,reader.sample);
  assert.equal(withMeteorologicalReading(edition,reader.sample,now-1),edition);
  const newer={...edition,sources:[{id:'senamhi-meteo',lastSuccessAt:new Date(now+1).toISOString()}]};
  assert.equal(withMeteorologicalReading(newer,reader.sample,now+60000),newer);
  saved.set([...saved.keys()][0],JSON.stringify({checkedAt:new Date(now).toISOString(),index:index(),details:{}}));
  assert.equal(meteorologicalReader({clock:()=>now,storage}).sample,null);
});

test('el publicador conserva su lector original, recurre al API tras su caída y nunca publica un detalle no validado',async()=>{
  const previous=records(),demo=meteorologicalSource(async()=>previous,()=>{throw Error('No corresponde consultar servicios');});
  assert.equal(await demo(),previous);
  const offline=new Error('canal web no disponible');
  const fallback=meteorologicalSource(async()=>{throw offline;},goodFetch);
  assert.equal((await fallback({now:new Date(now),previousItems:previous}))[0].noticeNumber,'486');
  const broken=meteorologicalSource(async()=>{throw offline;},async u=>json(u===weatherIndexUrl?index():{}));
  await assert.rejects(broken({now:new Date(now),previousItems:previous}),error=>error===offline);
  await assert.rejects(fetchWeatherSample(async()=>json({status:true,data:[]}),now));
});

test('si un único detalle pierde su mapa, conserva su ficha exacta y sólo fecha los otros avisos corroborados',async()=>{
  const known=records()[0],second=structuredClone(index().data[0]);second.id++;second.number++;
  const list=index();list.data.push(second);
  const edition=oldEdition();const retained={...known,id:'senamhi-meteo:2026-487',noticeNumber:'487',url:known.url.replace('29404','29405'),districtLevels:{'200101':['AMARILLO']}};
  edition.items.push(retained);
  const fetchPartial=async url=>json(url===weatherIndexUrl?list:url.endsWith('29404')?detail():{status:false});
  const reader=meteorologicalReader({request:fetchPartial,clock:()=>now});
  await reader.refresh(edition);
  assert.equal(reader.failed,true);
  const overlay=withMeteorologicalReading(edition,reader.sample,now);
  assert.equal(overlay.items.find(i=>i.id===retained.id),retained);
  assert.equal(overlay.items.find(i=>i.id===known.id).directMeteoCheckedAt,reader.sample.checkedAt);
  const server=meteorologicalSource(async()=>[],fetchPartial);
  const loaded=await server({now,previousItems:[retained]});
  assert.deepEqual(loaded.find(i=>i.id===retained.id).districtLevels,retained.districtLevels);
  await assert.rejects(meteorologicalSource(async()=>{throw Error('sin web');},fetchPartial)({now,previousItems:[]}));
});

test('dos lecturas idénticas en el publicador conservan versión y hora de modificación',async()=>{
  const {collectSource}=await import('../lib/panorama.mjs');
  const {officialSources}=await import('../lib/oficiales.mjs');
  const issuer={...officialSources.find(s=>s.id==='senamhi-meteo'),fetchItems:meteorologicalSource(async()=>{throw Error('sin HTML');},goodFetch)};
  const first=await collectSource(issuer,{sources:[],items:[]},new Date(now),true);
  const second=await collectSource(issuer,{sources:[first.source],items:first.records},new Date(now+60000),true);
  assert.equal(first.records[0].version,second.records[0].version);
  assert.equal(first.records[0].lastChangedAt,second.records[0].lastChangedAt);
});

test('los nombres abreviados de SENAMHI coinciden con las provincias del mapa mediante su UBIGEO',()=>{
  const notice=readWeatherIndex(index(),now)[0],value=detail();
  value.data.weatherWarning.maps[0].departments.push(
    {id:'11',name:'ICA',provinces:[{id:'03',name:'NAZCA'}]},
    {id:'02',name:'ANCASH',provinces:[{id:'07',name:'CARLOS F. FITZCARRALD'}]});
  const day=readWeatherDetail(value,notice,now).coverageDays[0];
  assert.deepEqual(day.provincesByRegion.Ica,['Nasca']);
  assert.deepEqual(day.provincesByRegion['Áncash'],['Carlos Fermín Fitzcarrald']);
});
