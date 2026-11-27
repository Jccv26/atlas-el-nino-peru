import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {activeSchedule,localSignals,inScope} from "../public/senales.mjs";
import {territoryIndex} from "../public/territorios.mjs";
import {noticeChanges} from "../lib/edicion-local.mjs";

const now=Date.parse("2026-11-27T02:15:00Z"),at=new Date(now-60000).toISOString(),tooOld=new Date(now-8*3600000).toISOString();
const index=territoryIndex(JSON.parse(readFileSync(new URL("../public/atlas/territorios/catalogo.json",import.meta.url))));
test("Ahora exige dos ejecuciones diferentes, cercanas, y una edición reciente",()=>{
 const p={updatedAt:at,publication:{lastScheduled:{runId:"32",at},priorScheduled:{runId:"31",at:new Date(now-11*60000).toISOString()}}};
 assert.equal(activeSchedule(p,now),true);
 for (const other of [undefined,{runId:"32",at},{runId:"3",at:tooOld}]) assert.equal(activeSchedule({...p,publication:{...p.publication,priorScheduled:other}},now),false);
 assert.equal(activeSchedule({...p,updatedAt:tooOld},now),false);
});
test("el rojo se apaga al caducar el respaldo o cuando el parte cierra",()=>{
 const e={id:"a",kind:"oficial",region:"Piura",province:"Ayabaca",district:"Paimas",reportedAt:at,severe:true,severityEvidence:{at}};
 const signal=e=>localSignals({impacts:{events:[e]}},[],index,now)[0];
 assert.equal(signal(e).mark,"grave");
 for(const variant of [{kind:"prensa"},{reportedAt:tooOld},{severityEvidence:{at:tooOld}},{feedArchived:true}]) assert.equal(signal({...e,...variant}).mark,"impacto");
 assert.equal(signal({...e,resolved:true,status:"atendido"}).mark,"restablecido");
 assert.equal(inScope(signal(e),"Piura",index.resolve("Piura","Piura","Las Lomas"),index),false);
});
test("Tumbes en pronóstico y Piura observada permanecen en vistas separadas",()=>{
 const r={reportId:102,from:tooOld,until:at,issuedAt:at,expiresAt:new Date(now+60000).toISOString(),text:"Parte"};
 const radar={observations:[{...r,region:"Piura",province:"Piura",station:"Piura",mm:3.8}],forecasts:[{...r,region:"Tumbes"}]};
 const s=localSignals({radar},[],index,now);assert.equal(s.find(e=>e.region==="Tumbes").mode,"pronostico");
 assert.equal(s.find(e=>e.region==="Piura").mark,"lluvia");
 assert.equal(s.find(e=>e.region==="Piura").title,"3,8 mm en Piura");
 assert.equal(localSignals({radar},[],index,now+3600000).some(e=>e.mode==="pronostico"),false);
});
test("una nueva consulta sin revisión del aviso preserva la misma cronología",()=>{
 const old={id:"A",kind:"oficial",level:"AMARILLO",url:"https://www.senamhi.gob.pe/"};
 const change={...old,level:"NARANJA"};
 noticeChanges([change],[old],new Date(now));assert.equal(change.changes.length,1);
 const again={...change};noticeChanges([again],[change],new Date(now+10000));assert.deepEqual(again.changes,change.changes);
});

test('los distritos identificados del departamento de Lima se ubican en su propia provincia',()=>{
  const signals=localSignals({impacts:{events:[
    {id:'01',region:'Lima',district:'Villa María del Triunfo',reportedAt:at},
    {id:'02',region:'Lima',district:'Villa El Salvador',reportedAt:at},
    {id:'03',region:'Lima',district:'Caleta de Carquín',reportedAt:at},
    {id:'04',region:'Lima',district:'Miraflores',reportedAt:at}
  ]}},[],index,now);
  assert.deepEqual(signals.map(s=>[s.area,s.region]),[['150143','Lima Metropolitana'],['150142','Lima Metropolitana'],['150803','Lima'],['15','Lima']]);
  assert.equal(inScope(signals[0],'Lima Metropolitana','1501',index),true);
  assert.equal(inScope(signals[0],'Lima','',index),false);
});
