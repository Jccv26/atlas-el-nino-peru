// Keep the reported time of an event, its publication and each forecast period distinct.
const day = new Intl.DateTimeFormat("es-PE",{day:"numeric",month:"short",year:"numeric",timeZone:"America/Lima"});
const clock = new Intl.DateTimeFormat("es-PE",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Lima"});
const joinList = new Intl.ListFormat("es-PE",{type:"conjunction"});
const isDay = value => /^\d{4}-\d\d-\d\d$/.test(value);
const stamp = value => new Date(isDay(value) ? value+"T12:00:00-05:00" : value || "");
const dateLabel = value => {
  const d=stamp(value);
  return Number.isFinite(+d) ? day.format(d)+(isDay(value)?"":", "+clock.format(d)) : "";
};
function period(from,until) {
  const a=stamp(from),b=stamp(until);
  if (!Number.isFinite(+a)) return dateLabel(until);
  if (!Number.isFinite(+b) || +a===+b) return dateLabel(from);
  if (!isDay(from) && !isDay(until) && day.format(a)===day.format(b))
    return day.format(a)+", "+clock.format(a)+"–"+clock.format(b);
  return dateLabel(from)+" al "+dateLabel(until);
}
export function signalDates(s) {
  if (s.mode==="pronostico") {
    const days=s.item?.applicableDates;
    if(days?.length)return "Días previstos · "+days.map(dateLabel).join(" / ");
    return (s.from?"Vigencia · ":"Hasta ")+period(s.from,s.expiresAt);
  }
  if (s.type==="observacion") return "Medición · "+period(s.from,s.at);
  const e=s.event;
  if (e) {
    const occurred=e.occurredAt && (e.occurredAtPrecision==="aproximada"?"Hecho, hora aproximada · ":"Hecho · ")+dateLabel(e.occurredAt);
    const issued=(e.kind==="prensa"?"Publicación · ":"Parte · ")+dateLabel(e.reportedAt || s.at);
    return [occurred,issued].filter(Boolean).join(". ");
  }
  if (s.type==="puerto") return [s.at && "Parte · "+dateLabel(s.at),s.checkedAt && s.checkedAt!==s.at && "Consultado · "+dateLabel(s.checkedAt)].filter(Boolean).join(". ");
  return "Medición · "+dateLabel(s.at);
}

const pointType = s => {
  if (s.type==="impacto") return "impacto";
  if (s.type==="pronostico") return "radar previsto";
  if (s.mode==="pronostico") {
    const origin=s.item?.originNotice?.sourceId || s.item?.sourceId;
    return s.layer==="mar" ? "oleaje" : origin==="senamhi-quebradas" ? "quebradas" : "lluvia prevista";
  }
  return s.type;
};
const factTime = s => Date.parse(s.event?.recovery?.at || s.event?.occurredAt || s.at) || 0;
const labels = {observacion:"Lluvia medida",estacion:"Nivel del río",puerto:"Estado del puerto",oleaje:"Pronóstico de oleaje",quebradas:"Pronóstico de quebradas","lluvia prevista":"Pronóstico de lluvia","radar previsto":"Pronóstico de las próximas horas"};
function point(s,context,records) {
  const e=s.event, type=pointType(s);
  const place=s.district || s.province || (e?.localities?.length===1 && e.localities[0]);
  const title=s.title || s.text;
  const within=context.area || (context.region==="Lima Metropolitana" ? "1501" : "");
  const districts=within.length===4 ? Object.entries(s.item?.districtLevels || {}).filter(([id])=>id.startsWith(within)) : [];
  const provinceLevels=districts.length ? [...new Set(districts.flatMap(([,levels])=>levels))] : [];
  const level=within.length===6 ? s.item?.districtLevels?.[within] : within ? provinceLevels : s.item?.regionLevels?.[context.region];
  const scope=place && !title.toLocaleLowerCase("es").includes(place.toLocaleLowerCase("es")) ? place : "";
  let sectors=Array.isArray(level) && level.length ? "Sectores en "+joinList.format(level.map(l=>l.toLocaleLowerCase("es")))+"." : "";
  if(districts.length && context.index) {
    const examples=districts.slice(0,2).map(([id,levels])=>{
      const name=context.index.byId.get(id)?.name;
      return name && name+" ("+joinList.format(levels.map(x=>x.toLocaleLowerCase("es")))+")";
    }).filter(Boolean);
    if(examples.length)sectors="El mapa incluye sectores de "+districts.length+(districts.length===1?" distrito":" distritos")+
      (districts.length>examples.length?", entre ellos ":", ")+joinList.format(examples)+".";
  }
  const label=e ? (e.kind==="prensa"&&!e.corroborated ? "Reporte de "+e.source : s.mark==="grave" ? "Impacto grave confirmado" : s.mark==="restablecido" ? "Restablecimiento" : "Impacto documentado") : labels[type] || s.label;
  let body=title;
  const province=within.length===4 && context.index?.byId.get(within)?.name;
  if(province && s.item?.applicableDates?.length && s.type==="aviso") {
    const phenomenon=/llovizna/i.test(title)?"lloviznas":/granizo/i.test(title)?"granizo":/tormenta/i.test(title)?"tormentas":"precipitaciones";
    body="El aviso de "+phenomenon+" incluye sectores de la provincia de "+province+".";
  }
  if(e?.recovery && e.summary && title!==e.summary) body=e.summary.replace(/[.\s]+$/,"")+". "+e.recovery.text;
  else if(e?.summary && title===e.summary && e.title && title!==e.title) body=e.title.replace(/[.\s]+$/,"")+". "+e.summary;
  if(s.type==="observacion") {
    const other=records.find(o=>o!==s && o.type===s.type && o.url===s.url && o.at===s.at && o.from===s.from && o.locality && s.locality && o.locality!==s.locality);
    if(other) body=title.replace(/[.\s]+$/,"")+". En el mismo intervalo, "+other.title+".";
  }
  const districtNames=districts.flatMap(([id,levels])=>{
    const name=context.index?.byId.get(id)?.name;
    return name?[name+" · "+joinList.format(levels.map(l=>l.toLocaleLowerCase("es")))]:[];
  });
  return {label:[label,scope].filter(Boolean).join(" · "),text:sectors ? body.replace(/[.\s]+$/,"")+". "+sectors : body,date:signalDates(s),districtNames,signal:s};
}
function selectHighlights(records) {
  const priority=s=>s.mark==="grave"?0:s.event?.kind==="oficial" || s.event?.corroborated ? 1:2;
  const sorted=[...records].sort((a,b)=>priority(a)-priority(b) || factTime(b)-factTime(a));
  const groups=new Map();
  for(const s of sorted) {
    const key=pointType(s);
    if(!groups.has(key)) groups.set(key,s);
  }
  // Keep both what has been documented and the next forecast in the first lines.
  const selected=["impacto","observacion","estacion","puerto","lluvia prevista","radar previsto","quebradas","oleaje"].map(k=>groups.get(k)).filter(Boolean);
  const first=groups.get("impacto");
  const other=first && sorted.find(s=>s.type==="impacto" && s.district && s.district!==first.district && s.url!==first.url);
  if(other)selected.push(other);
  return selected;
}
function sourcesFor(records) {
  const sources=new Map();
  function add(url,source,title) {
    if (typeof url!=="string" || sources.has(url))return;
    let u;
    try {u=new URL(url);} catch {return;}
    if (!["https:","http:"].includes(u.protocol) || u.username || u.password)return;
    sources.set(url,{url,source:source || "Fuente original",title:title || ""});
  }
  for(const s of records) {
    const e=s.event,it=s.item;
    add(s.url,s.source,e?.title || s.title);
    for(const ev of e?.evidence || []) add(ev.url,ev.source || s.source,ev.label || e.title);
    if(e?.recovery) add(e.recovery.url,e.recovery.source || s.source,e.recovery.text);
    for(const ref of [...(e?.relatedItems || []),...(e?.contributors || []),...(e?.recommendations || []),...(e?.timeline || [])])
      add(ref.url,ref.source || s.source,ref.title || ref.text || e.title);
    if(e?.severityEvidence)add(e.severityEvidence.url,s.source,"Evidencia del impacto");
    for(const ref of it?.relatedNotices || []) {
      add(ref.url,ref.source,ref.title);
      if(ref.documentUrl)add(ref.documentUrl,ref.source,"Documento del aviso");
    }
    if(it?.coenDocument?.pdfUrl)add(it.coenDocument.pdfUrl,s.source,"Documento del aviso");
    for(const url of it?.coverageUrls || []) add(url,s.source,"Mapa de cobertura");
  }
  return [...sources.values()];
}
export function territorialBrief(records,{region,area,index}={}) {
  const newest=selectHighlights(records);
  return {
    highlights:newest.map(s=>point(s,{region,area,index},records)),
    sources:sourcesFor([...newest,...records]),
  };
}
