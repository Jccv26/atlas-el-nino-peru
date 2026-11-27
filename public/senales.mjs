import {noticeCovers} from "./territorios.mjs?v=3";

import {isRiverNotice,stationReading,riverValidity} from "./estacion-hidrologica.mjs";

const hour = 3600000;
const number = new Intl.NumberFormat("es-PE", {maximumFractionDigits:2});
const time = value => Date.parse(value || "");
const short = s => String(s || "").toLocaleLowerCase("es").replace(/^\p{L}/u, c=>c.toLocaleUpperCase("es"));
const localTime = (value, end = false) => !value ? NaN : time(/^\d{4}-\d\d-\d\d$/.test(value) ? value+(end?"T23:59:59":"T00:00:00")+"-05:00" : value);
export function activeSchedule(panel, now) {
  const age = now - time(panel?.publication?.lastScheduled?.at);
  const edition = now - time(panel?.updatedAt);
  const spacing=time(panel?.publication?.lastScheduled?.at)-time(panel?.publication?.priorScheduled?.at);
  return spacing>0 && spacing<=35*60000 && Boolean(panel?.publication?.priorScheduled?.runId && panel.publication.priorScheduled.runId!==panel.publication.lastScheduled?.runId) && age >= 0 && age <= 35*60000 && edition >= 0 && edition <= 30*60000;
}
export function localSignals(panel, items, index, now=Date.now()) {
  if (!panel) return [];
  const result = [];
  function add(s) {
    const code=s.area || s.ubigeo;
    s.area = typeof code==="string" && /^\d{2}(?:\d{2}){0,2}$/.test(code) ? code
      : index?.resolve(s.region, s.province, s.district) || "";
    // Published reports may say "departamento de Lima". A named district
    // or province resolved in that department identifies its actual map region.
    if (s.region==="Lima" && index?.regionOf(s.area)==="Lima Metropolitana")
      s.region="Lima Metropolitana";
    result.push(s);
  }
  const radar = panel.radar || {};
  const measured = new Set();
  for (const reading of [...(radar.observations || []), ...(radar.reports || []).flatMap(r=>r.observations || [])]) {
    const {station, region, province, district, locality, mm, text, from, until, issuedAt, url} = reading;
    const key = [reading.reportId, region, province, district, station, locality, text].join("|");
    if (!region || measured.has(key) || time(until)>now || now-time(until)>24*hour) continue;
    measured.add(key);
    const place = station || locality || province || region;
    add({id:"obs:"+key, type:"observacion", mode:"ahora", layer:"lluvias", mark:"lluvia",
      label:now < time(reading.expiresAt) ? "Lluvia observada" : "Medición anterior",
      title:Number.isFinite(mm) ? number.format(mm).replace(".",",")+" mm en "+place : "Precipitación en "+place,
      text, region, province, district, locality:place, from, at:until, issuedAt, expiresAt:reading.expiresAt,
      area:reading.ubigeo,coordinates:reading.coordinates, url, source:"SENAMHI · Radar", recent:now>=time(reading.expiresAt)});
  }
  for (const r of radar.forecasts || []) {
    if (!r.region || now>=time(r.expiresAt) || now<time(r.issuedAt)) continue;
    add({...r,id:"prev:"+[r.reportId,r.region,r.province,r.text].join("|"),type:"pronostico",mode:"pronostico",
      layer:"lluvias", mark:"pronostico",label:"Pronóstico de radar",title:r.text,at:r.issuedAt,source:"SENAMHI · Radar"});
  }
  for (const event of panel.impacts?.events || []) {
    const at=event.reportedAt || event.occurredAt;
    const age = now-time(at);
    if (!(age>=0 && age<=7*24*hour)) continue;
    const ended = ["restablecido","atendido"].includes(event.status) && (event.resolved===true || event.status==="restablecido" || event.restored===true);
    const confirmed = event.kind==="oficial" || event.corroborated===true;
    const severityAt=time(event.severityEvidence?.at);
    const active = age<=6*hour && now>=severityAt && now-severityAt<=6*hour && !ended && !event.feedArchived && event.severe===true && confirmed;
    add({...event,at,layer:event.layer || "lluvias", mode:"ahora",type:"impacto",
      mark:ended?"restablecido":active?"grave":"impacto",recent:age>6*hour,
      label:ended?(event.recovery || event.status==="restablecido"?"Restablecido":"Atención concluida"):active?"Impacto grave confirmado":age>6*hour?"Impacto reciente":confirmed?"Impacto confirmado":"Reportado en campo",
      title:event.recovery?.text || event.corroboratedClaim || (event.summary && event.summary.length<=120 ? event.summary : event.title), text:event.summary, event});
  }
  for (const it of items) {
    if (isRiverNotice(it)) {
      const reading=stationReading(it);
      const status=riverValidity(it,now);
      const active=status==="vigente" || status==="listado";
      if(["sinconfirmar","actualizado","retirado","proximo"].includes(status) || time(it.publishedAt)>now)continue;
      if(reading && time(reading.at)>now)continue;
      if(!active && (!reading || now-time(reading.at)>=48*hour))continue;
      const regions=it.regions || [];
      if(!reading && !regions.length)continue;
      const region=regions.length===1 ? regions[0] : undefined;
      const description=[reading?.value,it.level && "umbral "+it.level.toLowerCase()].filter(Boolean).join(" · ");
      const title=reading ? reading.name+(description?" · "+description:"") : short(it.phenomenon || it.title);
      add({id:it.id,type:"estacion",mode:"ahora",layer:"rios",mark:"rio",
        label:status==="vigente"?"Aviso hidrológico vigente":status==="listado"?"Aviso en el listado de SENAMHI":"Medición de estación",
        title,text:it.summary,riverMetric:reading?.metric,observedAt:reading?.at,
        at:reading?.at || it.publishedAt,issuedAt:it.publishedAt,expiresAt:it.validUntil,stationStatus:status,
        recent:!active && now-time(reading?.at)>3*hour,region,regions,province:it.stationProvince,district:it.stationDistrict,
        locality:reading?.name,coordinates:it.coordinates,source:it.sourceName || it.source,url:it.url,item:it});
      continue;
    }
    if (it.radarType || it.kind!=="oficial" || it.invalidValidity || it.withdrawnAt || it.supersededBy || now>localTime(it.validUntil,true) || !Number.isFinite(localTime(it.validUntil,true))) continue;
    const origin=it.originNotice?.sourceId || it.sourceId;
    const layer=origin==="marina" || it.category==="Oleajes" ? "mar" :
      ["senamhi-lluvias","senamhi-quebradas"].includes(origin) || ((origin==="senamhi-meteo" || it.meteoRosterAt) && /lluvia|precipita|graniz|tormenta/i.test([it.category,it.phenomenon,it.title].join(" "))) ? "lluvias" : "";
    if (layer) add({id:it.id,type:"aviso",mode:"pronostico",layer,mark:"pronostico",label:"Aviso oficial",title:short(it.phenomenon || it.title),text:it.summary,source:it.sourceName,url:it.url,
      at:it.publishedAt || it.validFrom,from:it.validFrom,expiresAt:it.validUntil,regions:it.coastalRegions || it.regions,item:it});
  }
  const ports = panel.sources?.find(s=>s.id==="dicapi");
  for (const p of ports?.portStatus?.ports || []) {
    if (p.area!=="Marítimo" || p.status==="open") continue;
    add({id:"puerto:"+p.captaincy+":"+p.name,type:"puerto",mode:"ahora",layer:"mar",mark:"puerto",label:"Parte de capitanía",
      title:short(p.name)+(p.status==="closed"?" · cierre":" · restricción parcial"),
      at:p.date || ports.lastSuccessAt, checkedAt:ports.lastSuccessAt, recent:now-time(ports.lastSuccessAt)>6*hour,region:p.region,
      text:"Capitanía de "+p.captaincy+". Estado comunicado por la Autoridad Marítima Nacional.",source:"DICAPI",url:p.url || ports.url});
  }
  return result.sort((a,b)=>Number(b.mark==="grave")-Number(a.mark==="grave") || (time(b.at)||0)-(time(a.at)||0));
}
export function inScope(s, region, area, index) {
  if (!region) return true;
  if (area) return Boolean(s.region && s.region!==region ? false : s.area?.startsWith(area) || (s.item && noticeCovers(s.item,area,index)));
  return s.region===region || Boolean(s.regions?.includes(region));
}
