import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrologyIndexUrl,hydrologyDetailUrl,readHydrologyIndex,readHydrologyDetail,mergeHydrologyIndex,acceptsHydrologyIndex} from '../public/avisos-hidrologicos-api.mjs';
import {phisisRiverIndex,riverSource} from '../lib/rios-phisis.mjs';

const now=new Date('2026-11-27T05:13:17Z');
const level={code:3,name:'Fuerte',colorBackground:'#ffa500'};
const row={id:70800,number:1720,title:'SITUACIÓN ACTUAL DEL CAUDAL DEL RÍO TUMBES - ESTACIÓN CABO INGA',status:'Vigente',
  startDate:'26/11/2026 22:00 horas',endDate:'27/11/2026 06:00 horas',emissionDate:'26/11/2026 23:34 horas',
  stationCode:'47E01126',stationName:'CABO INGA',level,department:'TUMBES',latitude:-3.9786,longitude:-80.39925};
const detail={id:70800,number:1720,title:row.title,level,station:'CABO INGA',department:'TUMBES',province:'TUMBES',district:'SAN JACINTO',
  emissionDate:row.emissionDate,startDate:'jueves, 26 de noviembre de 2026 a las 22:00 horas',endDate:'viernes, 27 de noviembre de 2026 a las 06:00 horas',
  lastDate:'26/11/2026',lastHour:'22:00 horas',lastHourValue:'805.28',unit:'m3/s'};
const active=rows=>({status:true,data:rows,validations:[]});
const details=patch=>({status:true,data:{hydrologicalWarning:{...detail,...patch}}});
const [index]=readHydrologyIndex(active([row]),now);
const complete=readHydrologyDetail(details({}),index,now);
const [prior]=readHydrologyIndex(active([{...row,id:70799,number:1719,emissionDate:'26/11/2026 22:34 horas',
  startDate:'26/11/2026 21:00 horas',endDate:'27/11/2026 05:00 horas',level:{code:2,colorBackground:'#ffff00'}}]),now);

test('Servicios separa la hora de emisión, la observación y la vigencia y sólo ubica el distrito del detalle',()=>{
  assert.equal(index.stationName,'Cabo Inga');
  assert.equal(index.level,'NARANJA');
  assert.equal(index.publishedAt,'2026-11-27T04:34:00.000Z');
  assert.equal(index.validUntil,'2026-11-27T11:00:00.000Z');
  assert.deepEqual(index.regions,['Tumbes']);
  assert.deepEqual(index.coordinates,[-80.39925,-3.9786]);
  for(const key of ['observedAt','stationDistrict','stationProvince','riverMeasurement'])assert.equal(index[key],undefined);
  assert.equal(complete.observedAt,'2026-11-27T03:00:00.000Z');
  assert.deepEqual(complete.riverMeasurement,{kind:'caudal',value:805.28,unit:'m³/s'});
  assert.equal(complete.stationDistrict,'San Jacinto');
  assert.equal(complete.stationProvince,'Tumbes');
  assert.equal(hydrologyDetailUrl(index),'https://servicios.senamhi.gob.pe/api/hydrology/warnings/70800?stationCode=47E01126');
  assert.equal(readHydrologyIndex(active([{...row,department:'LIMA'}]),now)[0].region,'');
  assert.equal(readHydrologyDetail(details({lastHour:'04:00 horas',lastDate:'27/11/2026'}),index,now).observedAt,undefined);
  assert.equal(readHydrologyDetail(details({unit:'m.s.n.m'}),index,now).riverMeasurement,undefined);
});
test('el índice y los detalles de la API rechazan fechas, procedencia e identidades ambiguas',()=>{
  for(const invalid of [active([row,row]),active([{...row,startDate:'31/02/2026 22:00 horas'}]),active([{...row,level:{code:2,colorBackground:'#ff0000'}}]),
    active([{...row,emissionDate:'27/11/2026 04:33 horas'}]),active([{...row,stationCode:'x?redirect=otro'}]),{status:false,data:[]},
    {status:true,data:[],validations:['Página incompleta']}])assert.throws(()=>readHydrologyIndex(invalid,now));
  for(const patch of [{number:1719},{id:70799},{station:'OTRA'},{emissionDate:'26/11/2026 23:15 horas'},
    {endDate:'viernes, 27 de noviembre de 2026 a las 07:00 horas'}, {level:{code:4,colorBackground:'#ff0000'}}])
    assert.throws(()=>readHydrologyDetail(details(patch),index,now));
  for(const url of [index.url.replace('www.senamhi.gob.pe','example.org'),index.url+'&extra=yes',index.url.replace('https:','http:')])
    assert.throws(()=>hydrologyDetailUrl({...index,url}));
});
test('el respaldo conserva un detalle exacto y jamás reactiva el número anterior de la estación',()=>{
  const previous={...complete,summary:'Resumen de la ficha oficial'};
  assert.equal(mergeHydrologyIndex([index],[previous],now)[0].summary,previous.summary);
  const [fresh,retired]=mergeHydrologyIndex([index],[{...prior,stationProvince:'Otra provincia',observedAt:'2026-11-27T02:00:00Z'}],now);
  assert.equal(fresh.stationProvince,undefined);
  assert.equal(fresh.observedAt,undefined);
  assert.equal(retired.supersededBy,'1720');
  assert.equal(retired.supersededUrl,index.url);
  const rollback=mergeHydrologyIndex([prior],[complete,retired],now);
  assert.equal(rollback.find(r=>r.id===prior.id).supersededBy,'1720');
  assert.equal(rollback.find(r=>r.id===complete.id).withdrawnAt,undefined);
  assert.equal(mergeHydrologyIndex([prior],[{...prior,withdrawnAt:now.toISOString()}],now)[0].withdrawnAt,now.toISOString());
  assert.equal(mergeHydrologyIndex([], [complete], now)[0].withdrawnAt,undefined);
  assert.equal(acceptsHydrologyIndex([], [complete], now),false);
  assert.equal(acceptsHydrologyIndex([prior], [complete], now),false);
  assert.equal(acceptsHydrologyIndex([], [complete], new Date('2026-11-27T11:01:00Z')),true);
  const upcoming={...index,validFrom:'2026-11-27T09:00:00Z',sourceStatus:'emitido'};
  assert.equal(mergeHydrologyIndex([prior],[upcoming],now).find(r=>r.id===prior.id).supersededBy,undefined);
  const altered={...complete,url:complete.url.replace('ca=70800','ca=70811')};
  assert.equal(mergeHydrologyIndex([index],[altered],now)[0].riverMeasurement,undefined);
  assert.equal(mergeHydrologyIndex([complete],[prior],now).length,2);
  const simultaneous=mergeHydrologyIndex([index,prior],[],now);
  assert.equal(simultaneous.find(r=>r.id===prior.id).supersededBy,undefined);
});
test('el conector usa la API HTTPS de Servicios al caer portal y PHISIS, y tolera un detalle interrumpido',async()=>{
  const requests=[];
  const response=data=>({body:JSON.stringify(data),headers:new Headers({'content-type':'application/json; charset=utf-8'})});
  let failDetail=false, invalidContent=false, emptyIndex=false, stats={};
  const fetchItems=riverSource({fetchWeb:async()=>{throw Error('portal');},diagnose:()=>'TIEMPO_AGOTADO',read:async(url,opts)=>{
    if(url===phisisRiverIndex)throw Error('WFS');
    assert.equal(opts.redirect,'error');
    assert.ok(opts.signal instanceof AbortSignal);
    requests.push(url);
    if(url===hydrologyIndexUrl)return invalidContent?{body:'[]',headers:new Headers({'content-type':'text/html'})}:response(active(emptyIndex?[]:[row]));
    assert.equal(url,hydrologyDetailUrl(index));
    if(failDetail)throw Error('red');
    return response(details({}));
  }});
  const opts={now,previousItems:[prior],onReading:info=>stats=info};
  const first=await fetchItems(opts);
  assert.deepEqual(requests,[hydrologyIndexUrl,hydrologyDetailUrl(index)]);
  assert.equal(stats.readChannel,'servicios');
  assert.equal(stats.servicesDetailCount,1);
  assert.equal(first.find(r=>r.id===index.id).riverMeasurement.value,805.28);
  failDetail=true;
  const second=await fetchItems({...opts,previousItems:first});
  assert.equal(stats.servicesDetailCount,0);
  assert.equal(second.find(r=>r.id===index.id).riverMeasurement.value,805.28);
  invalidContent=true;
  await assert.rejects(fetchItems(opts));
  invalidContent=false;emptyIndex=true;
  await assert.rejects(fetchItems({...opts,previousItems:first}),/contradice/);
});
