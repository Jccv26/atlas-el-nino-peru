import test from "node:test";
import assert from "node:assert/strict";
import {needsRiverReading,riverReader,withRiverReading} from "../public/consulta-rios.mjs";
import {hydrologyIndexUrl,hydrologyDetailUrl,readHydrologyIndex} from "../public/avisos-hidrologicos-api.mjs";

const now=Date.parse("2026-11-27T05:30:00Z");
const ago=m=>new Date(now-m*60000).toISOString();
const originRow={
 id:70800,number:1720,title:"SITUACIÓN ACTUAL DEL CAUDAL DEL RÍO TUMBES - ESTACIÓN CABO INGA",
 stationCode:"47E01126",stationName:"CABO INGA",department:"TUMBES",latitude:-3.9,longitude:-80.4,
 level:{code:3,colorBackground:"#ffa500"},startDate:"26/11/2026 22:00 horas",endDate:"27/11/2026 06:00 horas",
 emissionDate:"26/11/2026 23:34 horas",status:"VIGENTE",
};
const payload=row=>({status:true,data:[row]});
const directDetail={status:true,data:{hydrologicalWarning:{id:70800,number:1720,title:originRow.title,station:originRow.stationName,
 department:"TUMBES",province:"TUMBES",district:"SAN JACINTO",level:originRow.level,startDate:originRow.startDate,
 endDate:originRow.endDate,emissionDate:originRow.emissionDate,lastDate:"26/11/2026",lastHour:"22:00 horas",unit:"m3/s",lastHourValue:"805.28"}}};
const oldRow={...originRow,id:70799,number:1719,title:"INCREMENTO DEL CAUDAL DEL RÍO TUMBES - ESTACIÓN CABO INGA",
 emissionDate:"26/11/2026 22:34 horas",startDate:"26/11/2026 21:00 horas",endDate:"27/11/2026 05:00 horas",level:{code:2,colorBackground:"#ffff00"}};
const centralRiver=readHydrologyIndex(payload(oldRow),new Date(now))[0];
const other={id:"otro",sourceId:"coen"};
const edition={updatedAt:ago(45),sources:[{id:"senamhi-rios",status:"ok",lastSuccessAt:ago(45)}],items:[centralRiver,other],
 publication:{event:"push",runId:"123"},bulletin:{id:"boletin"}};
const response=data=>({ok:true,json:async()=>data});

test("el lector directo de Ríos se activa por antigüedad de la edición o de la fuente",()=>{
 assert.equal(needsRiverReading(null,now),false);
 assert.equal(needsRiverReading(edition,now),true);
 const recent={updatedAt:ago(1),sources:[{id:"senamhi-rios",status:"ok",lastSuccessAt:ago(3)}]};
 assert.equal(needsRiverReading(recent,now),false);
 assert.equal(needsRiverReading({...recent,sources:[{...recent.sources[0],lastSuccessAt:ago(17)}]},now),true);
});
test("Ríos consulta una sola vez, conserva el detalle en caché y sólo modifica los avisos hidrológicos visibles",async()=>{
 const calls=[],store=new Map();const storage={setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)};
 const panelCopy=structuredClone(edition);
 const reader=riverReader({clock:()=>now,storage,request:async(url,options)=>{
   calls.push(url);assert.equal(options.credentials,"omit");assert.equal(options.mode,"cors");assert(options.signal);
   return response(url===hydrologyIndexUrl?payload(originRow):directDetail);
 }});
 const first=reader.refresh(edition);
 assert.equal(reader.refresh(edition),first);
 await first;
 assert.equal(reader.failed,false);assert.equal(reader.sample.records.length,1);
 assert.deepEqual(calls,[hydrologyIndexUrl,hydrologyDetailUrl(reader.sample.records[0])]);
 const view=withRiverReading(edition,reader.sample,now);
 assert.equal(view.updatedAt,edition.updatedAt);assert.equal(view.bulletin,edition.bulletin);assert.equal(view.publication,edition.publication);
 assert.equal(view.sources,edition.sources);assert.equal(view.items.find(r=>r.id==="otro"),other);
 const current=view.items.find(r=>r.noticeNumber==="1720");assert.equal(current.riverMeasurement.value,805.28);
 assert.equal(current.stationDistrict,"San Jacinto");assert.equal(current.directRiverCheckedAt,ago(0));assert.equal(current.observedAt,"2026-11-27T03:00:00.000Z");
 assert.equal(view.items.find(r=>r.noticeNumber==="1719").supersededBy,"1720");
 assert.deepEqual(edition,panelCopy);assert.equal(reader.refresh(edition),null);
 const offline=riverReader({clock:()=>now+1000,storage,request(){throw Error("offline");}});
 assert.equal(offline.refresh(edition),null);assert.deepEqual(offline.sample.records[0].riverMeasurement,current.riverMeasurement);
 // A newer publisher read always wins. A more recent browser time cannot promote a regressed source.
 assert.equal(withRiverReading({...edition,sources:[{id:"senamhi-rios",lastSuccessAt:new Date(now+500).toISOString()}]},reader.sample,now+1000).directRiverCheckedAt,undefined);
 assert.equal(withRiverReading({...edition,items:[current]}, {checkedAt:ago(0),records:[centralRiver]},now).directRiverCheckedAt,undefined);
});
test("sin conexión o con índice vacío no se retira un aviso vigente ni se afirma una consulta exitosa",async()=>{
 for(const request of [async()=>{throw Error("CORS");},async()=>response({status:true,data:[]})]){
   const reader=riverReader({clock:()=>now,request});
   await reader.refresh(edition);assert.equal(reader.sample,null);assert.equal(reader.failed,true);
   assert.equal(withRiverReading(edition,reader.sample,now),edition);assert.equal(reader.refresh(edition),null);
 }
});
test("una caída o reaparición contradictoria conserva la consulta verificada incluso al reabrir el mapa",async()=>{
 let time=now,answer=originRow,down=false;
 const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 const otherStation={...originRow,id:80800,number:1721,stationCode:"YY22",stationName:"OTRA",title:"SITUACIÓN DEL CAUDAL EN OTRA ESTACIÓN"};
 const fetch=async url=>{
   if(down)throw Error("sin conexión");
   return response(url===hydrologyIndexUrl?payload(answer):directDetail);
 };
 const create=()=>riverReader({clock:()=>time,request:fetch,storage}), emptyEdition={...edition,items:[other]};
 const reader=create();
 await reader.refresh(emptyEdition);
 const first=reader.sample;
 assert.equal(first.records[0].noticeNumber,"1720");
 time+=16*60000;down=true;
 await reader.refresh(emptyEdition);
 assert.equal(reader.failed,true);assert.equal(reader.sample,first);
 assert.equal(reader.refresh(emptyEdition),null);
 down=false;time+=6*60000;answer=otherStation;
 await reader.refresh(emptyEdition);
 assert.equal(reader.failed,false);assert.equal(reader.sample.records[0].noticeNumber,"1721");
 const last=reader.sample.checkedAt;
 const reopened=create();
 answer=originRow;time+=16*60000;
 await reopened.refresh(emptyEdition);
 assert.equal(reopened.failed,true);
 assert.equal(reopened.sample.checkedAt,last);
 assert.equal(reopened.sample.records.some(r=>r.noticeNumber==="1720"),false);
});
