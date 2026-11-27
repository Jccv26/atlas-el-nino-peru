import {noticeForRegionDay} from "./avisos-mapa.mjs?v=3";
import {activeSchedule, inScope, localSignals} from "./senales.mjs";
import {regionTitle, normalizePlace} from "./territorios.mjs";
const $=id=>document.getElementById(id);
export function explorer({node,link,dialog,dateTime,showRecord,onPlace,noticeShare}) {
  let current=[],all=[],lastView="",lastResults="",trailKey="",latestPanel,scopeArea="",scopeRegion="",scopeCatalog;
  const captions={lluvia:"Lluvia medida", impacto:"Impacto reportado", grave:"Impacto grave confirmado", restablecido:"Restablecido",rio:"Estación de río",puerto:"Puerto",pronostico:"Pronóstico"};
  function signalDialog(s) {
    const place=[s.locality || s.station,s.district,s.province,regionTitle(s.region)].filter(Boolean);
    const fields=[node("p",[...new Set(place)].join(" · ") || s.regions?.map(regionTitle).join(", "),"signal-place")];
    if(s.item) {showRecord(s.item);return;}
    fields.push(noticeShare(s));
    const event=s.event;
    const noteId=event?.itemId || (s.radar || s.type==="observacion" ? latestPanel?.items?.find(it=>it.radarType===(s.type==="observacion"?"observacion":"pronostico") && it.url===s.url && it.region===s.region && it.province===s.province && (!s.locality || it.locality===s.locality))?.id : null);
    const note=latestPanel?.explanations?.notices?.[noteId];
    if(s.mark==="grave" && event?.severityEvidence)fields.push(node("h3","Por qué se marca en rojo"),node("p",event.severityEvidence.text),link("Evidencia de la afectación ↗",event.severityEvidence.url));
    if(event?.corroboratedClaim)fields.push(node("p",event.corroboratedClaim));
    if(event?.localities?.length)fields.push(node("p","Lugares mencionados · "+event.localities.join(" y ")));
    if(s.text && s.title!==s.text) fields.push(node("p",s.text,"signal-narrative"));
    if(s.type==="observacion") fields.push(node("p","Intervalo observado del "+dateTime(s.from)+" al "+dateTime(s.at)+" · hora de Perú."));
    else if(event?.occurredAt) fields.push(node("p",(event.occurredAtPrecision==="aproximada"?"Hora aproximada del hecho · ":"Ocurrió el ")+dateTime(event.occurredAt)+" · hora de Perú."));
    const issue=s.issuedAt || event?.reportedAt || s.at;
    if(issue) fields.push(node("p","Publicado por "+s.source+" el "+dateTime(issue)+"."));
    if(s.mode==="pronostico" && s.expiresAt) fields.push(node("p","Vigente hasta el "+dateTime(s.expiresAt)+"."));
    const checked=event?.checkedAt || s.checkedAt || (s.radar || s.type==="observacion" ? latestPanel?.radar?.lastSuccessAt : null);
    if(checked) fields.push(node("small","Última verificación del documento · "+dateTime(checked)));
    if(note?.mode==="ia") fields.push(node("h3","Lectura con IA"),node("p",note.what),node("p",note.meaning),link("Publicación que respalda el resumen ↗",s.url));
    if(event?.timeline?.length) {
      const sorted=[...event.timeline].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
      const last=sorted.at(-1);
      fields.push(node("h3",sorted.length>1?"Qué cambió":"Última actualización"),node("p",last.text));
      const det=node("details","","record-timeline");det.append(node("summary","Cronología · "+sorted.length+" registros"));
      const ol=node("ol");
      for(const step of sorted) {
        const li=node("li");li.append(node("strong",dateTime(step.at)),node("p",step.text));
        if(step.url) li.append(link((step.source || s.source)+" ↗",step.url));ol.append(li);
      }
      det.append(ol);fields.push(det);
    }
    for(const ev of event?.evidence || []) {
      if(!ev.url || ev.url===s.url && ev.type==="documento")continue;
      fields.push(link((ev.label || (ev.type==="fotos"?"Anexo fotográfico":"Documento original"))+" ↗",ev.url));
      if(ev.caption)fields.push(node("p",ev.caption));
      if(ev.date)fields.push(node("small",(ev.dateKind==="anexo"?"Fecha indicada en el anexo":ev.dateKind==="captura"?"Fecha de toma":"Fecha de publicación")+" · "+dateTime(ev.date)+(ev.source?" · "+ev.source:"")));
    }
    if(event?.corroborated && Array.isArray(event.relatedItems))
      for(const ref of event.relatedItems)if(ref.url)fields.push(link((ref.source || "Segunda fuente del hecho")+" ↗",ref.url));
    if(event?.contributors?.length) {
      fields.push(node("h3","Quién documentó el hecho"));
      for(const c of event.contributors)fields.push(link(c.source+" ↗",c.url));
    }
    if(event?.recommendations?.length) {
      fields.push(node("h3","Qué recomienda la autoridad"));
      for (const rec of event.recommendations) fields.push(node("p",rec.text),link(rec.source+" ↗",rec.url));
    }
    if(s.url)fields.push(link("Abrir publicación de "+s.source+" ↗",s.url));
    dialog(s.label,s.title,...fields);
  }
  function row(s) {
    const b=node("button","","signal-row "+s.mark);
    b.type="button";
    const who=node("span","","signal-kicker");
    who.append(node("i","","symbol "+s.mark),node("span",s.label));
    const scopedItem=s.item && scopeRegion && inScope(s,scopeRegion,scopeArea,scopeCatalog);
    const place=(scopedItem && (scopeCatalog?.byId.get(scopeArea)?.name || regionTitle(scopeRegion))) || s.district || s.province || s.region || (s.regions?.length ? s.regions.slice(0,2).map(regionTitle).join(", ")+(s.regions.length>2?" y más":"") : "");
    const levels=(scopeArea && s.item?.districtLevels?.[scopeArea]) || [];
    b.append(who,node("strong",s.title),node("small",[place && regionTitle(place),levels.length?"Sectores en "+levels.map(l=>l.toLowerCase()).join(" y "):"",dateTime(s.at)].filter(Boolean).join(" · ")));
    b.onclick=()=>signalDialog(s);return b;
  }
  function group(list,title="Reportes del lugar") {
    if(list.length===1) return signalDialog(list[0]);
    const container=node("div","","group-signals");container.append(...list.map(row));
    dialog("Consulta territorial",title,container);
  }
  function render({panel,items,index,map,region,area,city,view,layer,hazard,readFailed=false,now=Date.now()}) {
    latestPanel=panel;scopeArea=area;scopeRegion=region;scopeCatalog=index;
    const verified=!readFailed && activeSchedule(panel,now);
    const stamp=panel?.updatedAt;
    $("editionLine").textContent=stamp?"Edición del "+dateTime(stamp)+" · hora de Perú"+(readFailed?" · pendiente de reconexión":now-Date.parse(stamp)>30*60000?" · actualización demorada":""):"Consultando la última edición…";
    for(const b of document.querySelectorAll("[data-view]")) {
      b.setAttribute("aria-pressed",String(b.dataset.view===view));
      if(b.dataset.view==="ahora")b.textContent=verified?"Ahora":"Último corte";
    }
    const clock=$("sourceFreshness");
    const radar=panel?.radar;
    const applicableRadar=layer==="lluvias" && view==="ahora" && radar;
    const last=applicableRadar && [...(radar.reports || [])].sort((a,b)=>b.issuedAt.localeCompare(a.issuedAt))[0];
    clock.hidden=!applicableRadar;
    if(applicableRadar) {
      const mark=[last?"Último parte consultado en el índice nacional de radar · "+dateTime(last.issuedAt):"Sin parte horario de radar disponible",
        ["stale","partial","unavailable"].includes(radar.status)?"Lectura del radar pendiente de actualización":""].filter(Boolean);
      clock.textContent=mark.join(". ")+".";
    }
    all=localSignals(panel,items,index,now);
    const viewSignals=all.filter(s=>s.mode===view && s.layer===layer);
    const isRecent=s=>s.mode==="pronostico" || now-Date.parse(s.type==="puerto" && s.checkedAt || s.at)<=24*3600000;
    current=viewSignals.flatMap(s=>{
      if(!region || !s.item?.coverageDaysComplete)return [s];
      const item=noticeForRegionDay(s.item,region,now);
      return item?[{...s,item,regions:item.regions,from:item.validFrom,expiresAt:item.validUntil}]:[];
    }).filter(s=>inScope(s,region,area,index));
    if(city && !area) current=current.filter(s=>normalizePlace(s.district || s.locality).replace(/^ciudad de /,"")===normalizePlace(city));
    const past=current.filter(s=>!isRecent(s));
    current=current.filter(isRecent);
    const archive=$("pastSignals");archive.hidden=!past.length;
    const archiveKey=past.map(s=>s.id+"|"+s.at).join(";");
    if(archive.dataset.list!==archiveKey){
      archive.dataset.list=archiveKey;
      archive.querySelector("summary").textContent="Reportes anteriores · "+past.length;
      const more=node("button","Consultar el archivo del lugar →","pane-more");more.type="button";more.onclick=()=>group(past,"Reportes de días anteriores");
      archive.querySelector("div").replaceChildren(...past.slice(0,3).map(row),...(past.length>3?[more]:[]));
    }
    // Forecasts published only for a region remain in its regional context. They never become district pins.
    const drawn=current.filter(s=>!s.item?.sectorMap && s.type!=="aviso" && (!s.recent || view==="pronostico" || !current.some(o=>o.id!==s.id && o.type===s.type && o.area===s.area && o.locality===s.locality && Date.parse(o.at)>Date.parse(s.at))));
    map?.local({region,area},drawn,view==="pronostico"?current.filter(s=>s.item?.sectorMap && s.item.sourceId==="senamhi-"+hazard):[],index);
    const root=$("placeTrail"),title=city || (area && index?.byId.get(area)?.name) || regionTitle(region) || "Todo el Perú";
    const nextTrailKey=[region,area,city,title,Boolean(index)].join("|");
    if(trailKey!==nextTrailKey){root.replaceChildren();
    const crumb=(text,r,id,isLast=false)=>{
      if(isLast) {const here=node("span",text);here.setAttribute("aria-current","location");root.append(here);return;}
      const b=node("button",text);b.type="button";b.title=!r?"Volver a todo el Perú":!id?"Volver a la región "+text:"Volver a la provincia de "+text;b.setAttribute("aria-label",b.title);b.onclick=()=>onPlace(r,id);root.append(b);
    };
    crumb("Perú","", "", !region);
    if(region) crumb(regionTitle(region),region,"",!area && !city);
    if(area && index) {
      if(area.length>=4 && !(region==="Lima Metropolitana" && area==="1501")) crumb(index.byId.get(area.slice(0,4))?.name || area.slice(0,4), region,area.slice(0,4),area.length===4);
      if(area.length===6) crumb(title,region,area,true);
    } else if(city) crumb(city,region,"",true);
    trailKey=nextTrailKey;}
    $("placeTitle").textContent=title;
    const available=index?.children(region,area) || [];
    const select=$("areaSelect");
    if ($("areaSelectLabel").dataset.scope!==region+area || select.options.length!==available.length+1) {
      select.replaceChildren(new Option("Seleccionar "+(available[0]?.id.length===6?"distrito":"provincia"),""));
      for(const p of available)select.append(new Option(p.name,p.id));
      $("areaSelectLabel").dataset.scope=region+area;
    }
    select.onchange=()=>{if(select.value)onPlace(region,select.value);};
    $("areaSelectLabel").hidden=!available.length;
    $("areaSelectTitle").textContent=available[0]?.id.length===6?"Distritos de esta provincia":"Provincias de la región";
    $("regionalContext").hidden=!region;
    $("signalsTitle").textContent=view==="pronostico"?"Pronósticos y avisos":"Mediciones y reportes";
    $("signalsCount").textContent=current.length?String(current.length):"";
    const viewKey=[region,area,city,view,layer,hazard].join("|");
    const listKey=JSON.stringify([viewKey,Boolean(panel),current.map(s=>[s.id,s.title,s.label,s.at])]);
    if(listKey!==lastResults) {
      lastResults=listKey;
      const list=$("localSignals");list.replaceChildren();
      if(!current.length) list.append(node("p",panel ? (view==="pronostico"?"Sin pronóstico con este alcance en la edición consultada.":"Sin reporte reciente para este lugar.") : "Consultando las fuentes…","signal-empty"));
      else list.append(...current.slice(0,4).map(row));
      $("allSignals").hidden=current.length<=4;
      $("allSignals").onclick=()=>group(current,"Reportes de "+title);
    }
    const key=$("mapKey");key.replaceChildren();
    const types=view==="pronostico"?["pronostico"] : layer==="lluvias"?["lluvia","impacto","grave","restablecido"]:layer==="rios"?["rio","impacto"]:["puerto"];
    for(const type of types){const legend=node("span");legend.append(node("i","","symbol "+type),document.createTextNode(captions[type]));key.append(legend);}
    if(view==="pronostico" && layer==="lluvias") {
      for(const l of ["amarillo","naranja","rojo"]){const mark=node("span");mark.append(node("i","","level-dot "+l),document.createTextNode("Nivel "+l));key.append(mark);}
      key.append(node("small",(hazard==="quebradas"?"Posible activación de quebradas":"Pronóstico de lluvia en 24 h")+" · sectores delimitados por SENAMHI"));
    }
    else key.append(node("small","Los puntos agrupan reportes por lugar. Abre la ficha para ver la ubicación indicada por la fuente."));
    if(viewKey!==lastView && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for(const el of [$("placeTitle"),$("localSignals"),key]) el.animate([{opacity:.25,transform:"translateY(5px)"},{opacity:1,transform:"translateY(0)"}],{duration:260,easing:"ease-out"});
    }
    lastView=viewKey;
    return {current,viewSignals:viewSignals.filter(isRecent)};
  }
  return {render,group,signalDialog,get signals(){return all;},get current(){return current;}};
}
