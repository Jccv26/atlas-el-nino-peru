import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {initialLayer,combinedSignals,regionalOverview} from "../public/capa-todo.mjs";
import {shareUrl} from "../public/compartir.mjs";
import {applyVerifiedPressLocations} from "../public/ubicacion-prensa.mjs";
import {localSignals,inScope} from "../public/senales.mjs";
import {selectPressGroups} from "../public/prensa-regional.mjs";
import {territoryIndex} from "../public/territorios.mjs";

const now=Date.parse("2026-11-27T03:00:00Z");
const hoursAgo=h=>new Date(now-h*3600000).toISOString();
const event=(id,region,props={})=>({id,region,layer:"lluvias",title:"Calles inundadas",kind:"oficial",reportedAt:hoursAgo(1),occurredAt:hoursAgo(3),...props});
const signals=(events,items=[])=>localSignals({impacts:{events}},items,null,now);
const regional=rows=>Object.fromEntries(regionalOverview(combinedSignals(rows,now)).map(r=>[r.region,r.mark]));

test("Todo se abre por defecto y conserva enlaces nuevos, temáticos y antiguos",()=>{
  const view=q=>initialLayer(new URLSearchParams(q));
  assert.equal(view(""),"todo");
  assert.equal(view("utm_source=enlace"),"todo");
  for(const layer of ["todo","lluvias","rios","mar"])assert.equal(view("capa="+layer),layer);
  assert.equal(view("region=Piura"),"mar");
  assert.equal(view("region=Piura&ubigeo=200101"),"lluvias");
  assert.equal(view("vista=pronostico&peligro=quebradas"),"lluvias");
  const query=new URL(shareUrl({region:"Piura",ubigeo:"2001",capa:"todo",vista:"pronostico",peligro:"quebradas"})).searchParams;
  assert.equal(view(query),"todo");
  assert.deepEqual(Object.fromEntries(query),{region:"Piura",ubigeo:"2001",capa:"todo",vista:"pronostico"});
});
test("clasifica el respaldo y la fecha de cada hecho, sin convertir la frecuencia de reportes en gravedad",()=>{
  const severe={severe:true,severityEvidence:{at:hoursAgo(2),text:"Tránsito totalmente interrumpido",url:"https://example.org/parte"}};
  const items=[
    event("antiguo","Tacna",{occurredAt:hoursAgo(40)}),
    event("grave","Cusco",severe),
    event("desfasado","Loreto",{...severe,severityEvidence:{at:hoursAgo(8)}}),
    event("atendido","Tumbes",{...severe,occurredAt:hoursAgo(40),status:"atendido",resolved:true,recovery:{text:"Tránsito restablecido",at:hoursAgo(1)}}),
    event("prensa","Áncash",{kind:"prensa",...severe}),
    event("incierto","Ica",{kind:"prensa",title:"Alerta de lluvia con posible inundación"}),
    event("prevencion","Pasco",{kind:"prensa",title:"Autoridades coordinan respuesta por lluvias"}),
    event("parte","Arequipa",{occurredAt:undefined}),
    ...Array.from({length:12},(_,i)=>event("dato"+i,"Piura")),
  ];
  const rows=signals(items);
  assert.deepEqual(regional(rows),{Cusco:"grave",Loreto:"impacto",Piura:"impacto","Áncash":"reportado",Arequipa:"reportado",Tumbes:"restablecido"});
  assert.equal(regionalOverview(combinedSignals(rows,now))[0].region,"Cusco");
  assert.deepEqual(regionalOverview(combinedSignals(rows,now)).filter(r=>r.region==="Piura").length,1);
});
test("opera con avisos vigentes y fechas de verificación de los partes de puerto, y consolida evidencia corroborada",()=>{
  const src="https://example.org/articulo",duplicate=event("articulo","Piura",{kind:"prensa",url:src});
  const confirmed=event("cruce","Piura",{kind:"prensa",url:"https://example.net/otra",corroborated:true,relatedItems:[{url:src}]});
  const rows=signals([duplicate,confirmed,duplicate],[
    {id:"futuro",kind:"oficial",sourceId:"marina",title:"Oleajes previstos",validFrom:hoursAgo(-12),validUntil:hoursAgo(-36),regions:["Callao","Ica"]},
    {id:"vencido",kind:"oficial",sourceId:"marina",title:"Oleajes anteriores",validFrom:hoursAgo(40),validUntil:hoursAgo(30),regions:["Tacna"]},
  ]);
  rows.push({id:"puerto",type:"puerto",mode:"ahora",region:"Lima",at:hoursAgo(168),checkedAt:hoursAgo(1)});
  assert.deepEqual(regional(rows.filter(s=>s.mode==="ahora")),{Piura:"impacto",Lima:"observacion"});
  assert.deepEqual(regional(rows.filter(s=>s.mode==="pronostico")),{Callao:"pronostico",Ica:"pronostico"});
  assert.equal(combinedSignals(rows,now).filter(s=>s.event).length,1);
});
test("la nota verificada de la Costa Verde se localiza en Miraflores tanto en el mapa como en prensa",async()=>{
  const url="https://elcomercio.pe/lima/sucesos/ante-fuertes-oleajes-municipalidad-de-lima-dispone-restriccion-vehicular-en-la-costa-verde-apuesplan-ultimas-noticia/";
  const title="Costa Verde con oleajes anómalos: Municipalidad de Lima cierra un carril norte a sur por circuito de playas afectado";
  const item={id:"nota",kind:"prensa",sourceId:"el-comercio",regions:["Lima"],title,url,publishedAt:hoursAgo(1)};
  const e=event("impacto","Lima",{kind:"prensa",sourceId:item.sourceId,itemId:item.id,layer:"mar",url,title,occurredAt:undefined});
  const other={...item,id:"otra",url:"https://elcomercio.pe/otra-sobre-costa-verde/",regions:["Callao"]};
  const panel={items:[item,other],impacts:{events:[e]},sources:[{kind:"prensa",id:"el-comercio",name:"El Comercio",url:"https://elcomercio.pe"}]};
  applyVerifiedPressLocations(panel);
  applyVerifiedPressLocations(panel);
  assert.equal(item.region,"Lima Metropolitana");
  assert.deepEqual(other.regions,["Callao"]);
  const locations=JSON.parse(await readFile(new URL("../public/atlas/territorios/catalogo.json",import.meta.url)));
  const index=territoryIndex(locations);
  const [s]=localSignals(panel,panel.items,index,now);
  assert.equal(s.area,"150122");
  assert.equal(s.district,index.byId.get("150122").name);
  assert.equal(s.region,index.regionOf(s.area));
  assert.equal(inScope(s,"Lima Metropolitana","1501",index),true);
  assert.equal(inScope(s,"Lima","",index),false);
  assert.equal(selectPressGroups(panel,{region:"Lima Metropolitana",now}).national[0].item.id,"nota");
  assert.equal(selectPressGroups(panel,{region:"Lima",now}).national.length,0);
});
