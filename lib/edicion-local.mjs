import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {refreshRadar} from "./radar-ahora.mjs";
import {buildLocalImpacts} from "./impactos-locales.mjs";
import {buildOriginalIndex} from "../public/enlaces-aviso.mjs";

export const radarDescriptor={id:"senamhi-radar",name:"SENAMHI · Radar",kind:"oficial",url:"https://www.senamhi.gob.pe/?p=reportes-nowcasting-radar",intervalMinutes:10};
const fingerprint=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0,16);
async function seed(filename) {
  try{return JSON.parse(await readFile(new URL("../public/data/"+filename,import.meta.url),"utf8"));}catch{return null;}
}
export function radarReadingItems(radar) {
  const items=new Map();
  function add(row,observed) {
    if(!row.region || !row.text || !row.url)return;
    const locality=row.station || row.locality || row.province || row.region;
    const signature=[row.reportId,observed,row.region,row.province,locality,observed?"":row.text];
    const id="senamhi-radar:"+fingerprint(signature);
    const title=observed ? Number.isFinite(row.mm)?new Intl.NumberFormat("es-PE").format(row.mm)+" mm de lluvia en "+locality:"Precipitación observada en "+locality : "Pronóstico de lluvia para "+locality;
    items.set(id,{id,sourceId:radarDescriptor.id,sourceName:radarDescriptor.name,source:radarDescriptor.name,kind:"oficial",
      category:"Lluvias",radarType:observed?"observacion":"pronostico",title,summary:row.text,url:row.url,regions:[row.region],region:row.region,
      province:row.province,district:row.district,locality,observedFrom:observed?row.from:undefined,observedAt:observed?row.until:undefined,
      validFrom:observed?undefined:row.from,validUntil:observed?undefined:row.until, publishedAt:row.issuedAt,datePrecision:"minute",observationExpiresAt:observed?row.expiresAt:undefined,
      version:fingerprint([title,row.text,row.from,row.until]),firstSeenAt:row.issuedAt,lastChangedAt:row.issuedAt});
  }
  for(const row of [...(radar.observations || []),...radar.reports.flatMap(r=>r.observations || [])])add(row,true);
  for(const row of radar.forecasts || [])add(row,false);
  return [...items.values()];
}
// Build the first archive from the preceding edition as well: some of those
// items can disappear during the refresh that installs the new link format.
export async function editionOriginalIndex(current,...history) {
  const old=history.filter(Boolean);
  const previous=Object.assign(Object.create(null),...old.map(p=>p.sharedOriginals || {}),current?.sharedOriginals || {});
  const inputs=[...old.filter(p=>!p.sharedOriginals),current].filter(Boolean);
  const items=inputs.flatMap(p=>[...(p.items || []),...(p.impacts?.events || []),...(p.radar?.reports || []),
    ...(p.sources?.find(s=>s.id==='dicapi')?.portStatus?.ports || [])]);
  return buildOriginalIndex({items,previous});
}
export async function enrichEdition(snapshot,previous,options={}) {
  const now=new Date(snapshot.updatedAt);
  const [radarSeed,impactSeed]=await Promise.all([seed("radar-semilla.json"),seed("impactos-semilla.json")]);
  const cachedRadar=previous.radar && (!radarSeed || Date.parse(previous.radar.checkedAt)>=Date.parse(radarSeed.checkedAt))?previous.radar:radarSeed;
  const combined=new Map();
  for(const e of [...(impactSeed?.events || []),...(previous.impacts?.events || [])]) {
    const old=combined.get(e.id);
    if(!old || Date.parse(e.checkedAt || e.reportedAt)>=Date.parse(old.checkedAt || old.reportedAt))combined.set(e.id,e);
  }
  const [radar,impacts]=await Promise.all([
    refreshRadar(cachedRadar,{now,force:options.force===true}),
    buildLocalImpacts({items:snapshot.items,previous:{schemaVersion:1,events:[...combined.values()]},now}),
  ]);
  snapshot.radar=radar;
  snapshot.impacts=impacts;
  const rows=radarReadingItems(radar);
  const status=radar.status==="ok"?"ok":radar.lastSuccessAt?"stale":"error";
  snapshot.sources=snapshot.sources.filter(s=>s.id!==radarDescriptor.id);
  snapshot.sources.push({...radarDescriptor,status,checkedAt:radar.checkedAt,lastSuccessAt:radar.lastSuccessAt,count:rows.length});
  const impactByItem=new Map(impacts.events.map(e=>[e.itemId,e]));
  for(const it of snapshot.items) {
    const event=impactByItem.get(it.id);
    if(!event || event.kind!=="oficial") continue;
    // Only cite the verified official text and attachments. Readers can inspect each original.
    it.localEvidence={summary:event.summary || "", district:event.district, locality:event.locality, status:event.status,recovery:event.recovery?.text || "",
      evidence:event.evidence?.filter(e=>e.type==="fotos").map(e=>({label:e.label,url:e.url,date:e.date})) || []};
  }
  snapshot.items=[...snapshot.items.filter(it=>it.sourceId!==radarDescriptor.id),...rows].sort((a,b)=>(Date.parse(b.publishedAt || b.validFrom)||0)-(Date.parse(a.publishedAt || a.validFrom)||0));
  noticeChanges(snapshot.items,previous.items || [],now);
  snapshot.sharedOriginals=await editionOriginalIndex(snapshot,previous);
  return snapshot;
}

export function noticeChanges(items,prior,now) {
  const previous=new Map(prior.map(it=>[it.id,it]));
  for(const item of items) {
    const old=previous.get(item.id);
    if(!old || item.kind!=="oficial")continue;
    const changes=[...(old.changes || [])];
    const notes=[];
    for(const [key,label] of [["level","Nivel comunicado"],["validUntil","Fin de vigencia"],["expectedRestorationAt","Reposición prevista"]]) {
      if(!old[key] || !item[key] || old[key]===item[key])continue;
      const format=v=>key==="level"?v.toLowerCase():new Intl.DateTimeFormat("es-PE",{timeZone:"America/Lima",dateStyle:"short",...(String(v).includes("T")&&{timeStyle:"short"})}).format(new Date(v.length===10?v+"T12:00:00-05:00":v));
      notes.push(label+" pasó de "+format(old[key])+" a "+format(item[key])+".");
    }
    if(item.withdrawnAt && !old.withdrawnAt)notes.push("El aviso salió del listado activo de la entidad.");
    if(item.supersededBy && old.supersededBy!==item.supersededBy)notes.push("La entidad lo actualizó mediante el aviso "+item.supersededBy+".");
    if(item.localEvidence?.recovery && old.localEvidence?.recovery && old.localEvidence.recovery!==item.localEvidence.recovery)notes.push(item.localEvidence.recovery);
    if(notes.length)changes.unshift({at:now.toISOString(),text:notes.join(" "),url:item.url});
    if(changes.length)item.changes=changes.slice(0,5);
  }
}
