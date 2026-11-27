import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {localSignals,inScope} from "../public/senales.mjs";
import {territoryIndex} from "../public/territorios.mjs";
import {currentCombined,combinedSignals,regionalOverview} from "../public/capa-todo.mjs";
import {signalDates,territorialBrief} from "../public/resumen-territorial.mjs";
import {riverValidity,stationReading} from "../public/estacion-hidrologica.mjs";
import {layerRecords} from "../public/avisos-mapa.mjs";
const now=Date.parse("2026-11-27T04:24:44Z");
const index=territoryIndex(JSON.parse(readFileSync(new URL("../public/atlas/territorios/catalogo.json",import.meta.url))));
const notice={id:"senamhi-rios:2026-1719",sourceId:"senamhi-rios",sourceName:"SENAMHI · Ríos",kind:"oficial",
  url:"https://www.senamhi.gob.pe/?p=avisos-detalle-hidrologicos&ca=70799&ce=47E01126",
  title:"INCREMENTO DEL CAUDAL DEL RÍO TUMBES - ESTACIÓN CABO INGA",category:"Ríos",level:"AMARILLO",
  regions:["Tumbes"],stationName:"Cabo Inga",stationProvince:"Tumbes",stationDistrict:"San Jacinto",
  observedAt:"2026-11-27T02:00:00Z",validFrom:"2026-11-27T02:00:00Z",publishedAt:"2026-11-27T03:34:00Z",
  validUntil:"2026-11-27T10:00:00Z",riverMeasurement:{kind:"caudal",value:608.88,unit:"m³/s"}};
const signals=(items,when=now)=>localSignals({},layerRecords(items,when),index,when);
test("1719. Cabo Inga conserva caudal, estación, provincia, umbral y fechas; no crea un impacto ni un pronóstico",()=>{
  const [s]=signals([notice]);
  assert.equal(s.area,"240105");assert.equal(s.mode,"ahora");assert.equal(s.mark,"rio");assert.equal(s.type,"estacion");
  assert.equal(s.at,notice.observedAt);assert.equal(s.label,"Aviso hidrológico vigente");
  assert.match(s.title,/Cabo Inga · 608,88 m³\/s · umbral amarillo/);
  assert.equal(inScope(s,"Tumbes","2401",index),true);assert.equal(inScope(s,"Tumbes","2402",index),false);
  const overview=regionalOverview(combinedSignals([s],now));assert.equal(overview.length,1);assert.equal(overview[0].mark,"observacion");
  assert.match(signalDates(s),/Medición.*21:00.*Aviso vigente hasta.*05:00/);
  const [point]=territorialBrief([s],{region:"Tumbes",area:"2401",index}).highlights;
  assert.match(point.label,/Caudal del río.*San Jacinto/);assert.match(point.text,/608,88 m³\/s/);
  assert.deepEqual(stationReading({...notice,riverMeasurement:undefined}),{name:"Cabo Inga",at:notice.observedAt,metric:"caudal",value:""});
});
test("1705, 1707 y 1713 permanecen vigentes tras 24 y 48 horas con su medición original",()=>{
  const rows=[
    ["1705","Santa María de Nanay","Alto Nanay","2026-11-23T11:00:00Z","2026-11-27T15:00:00Z",121.9],
    ["1707","Bellavista","Mazan","2026-11-23T11:00:00Z","2026-11-27T15:00:00Z",85.55],
    ["1713","ENAPU Perú","Punchana","2026-11-25T11:00:00Z","2026-11-28T11:00:00Z",109.71],
  ].map(([n,stationName,stationDistrict,at,end,value])=>({...notice,id:"senamhi-rios:2026-"+n,title:"NIVEL DEL RÍO",
    regions:["Loreto"],stationDistrict,stationName,stationProvince:"Maynas",level:n==="1713"?"AMARILLO":"ROJO",
    riverMeasurement:{kind:"nivel",value,unit:"m s. n. m."},validFrom:at,observedAt:at,publishedAt:at,validUntil:end}));
  const group=signals(rows);
  assert.equal(group.length,3);assert(group.every(s=>inScope(s,"Loreto","1601",index) && s.mode==="ahora"));
  assert.equal(combinedSignals(group,now).length,3);assert.deepEqual(regionalOverview(group).map(x=>x.mark),["observacion"]);
  for(const s of group){
    assert.equal(s.at,s.item.observedAt);assert.match(s.title,/m s\. n\. m\./);assert.match(signalDates(s),/Medición.*Aviso vigente hasta/);
    const end=Date.parse(s.expiresAt);
    assert.equal(currentCombined(s,end-1),true);assert.equal(currentCombined(s,end),false);
    assert.equal(riverValidity(s.item,end),"finalizado");
    assert.equal(combinedSignals(signals([s.item],end),end).length,0);
  }
});
test("una medición reciente sigue con su hora al vencer el aviso; el retiro o reemplazo la saca de la capa",()=>{
  const end=Date.parse(notice.validUntil);
  const [s]=signals([notice],end);
  assert.equal(s.label,"Medición de estación");assert.match(signalDates(s),/Medición.*21:00.*Aviso finalizado/);
  assert(!s.title.includes("vigente"));assert.equal(currentCombined(s,end),true);
  for(const flags of [{withdrawnAt:notice.observedAt},{supersededBy:"1720"},{invalidValidity:true}]){
    assert.equal(localSignals({},[{...notice,...flags}],index,now).length,0);
    assert.equal(currentCombined({...s,item:{...notice,...flags}},now),false);
  }
});
test("el HTML sin observación acreditada se muestra a escala regional como aviso y sólo durante su vigencia",()=>{
  const raw={...notice,stationName:undefined,stationProvince:undefined,stationDistrict:undefined,
    observedAt:undefined,riverMeasurement:undefined};
  const [s]=signals([raw]);assert.equal(s.area,"24");assert.equal(s.observedAt,undefined);assert.equal(s.locality,undefined);
  assert.equal(s.at,raw.publishedAt);assert.equal(s.mark,"rio");assert.equal(inScope(s,"Tumbes","2401",index),false);
  assert.match(signalDates(s),/^Publicación.*22:34.*Aviso vigente hasta/);assert.doesNotMatch(signalDates(s),/Medición/);
  assert.equal(currentCombined(s,now),true);assert.equal(currentCombined(s,Date.parse(raw.validUntil)),false);
  assert.equal(signals([raw],Date.parse(raw.validUntil)).length,0);
});
