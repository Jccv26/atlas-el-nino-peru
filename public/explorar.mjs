import {noticeForRegionDay} from "./avisos-mapa.mjs?v=4";
import {activeSchedule, inScope, localSignals} from "./senales.mjs?v=3";
import {regionTitle, normalizePlace} from "./territorios.mjs?v=3";
import {recordDates,recordSources} from "./ficha-aviso.mjs";
import {visualPanel as recordVisual} from "./material-visual.mjs";
import {territorialBrief,signalDates} from "./resumen-territorial.mjs?v=2";
import {combinedSignals,combinedLabels,currentCombined,regionalOverview} from "./capa-todo.mjs?v=2";
const $=id=>document.getElementById(id);
export function explorer({node,link,dialog,recordDialog,dateTime,showRecord,onPlace,noticeShare}) {
  let current=[],all=[],lastView="",lastResults="",trailKey="",latestPanel,scopeArea="",scopeRegion="",scopeCatalog;
  let briefKey="", briefPanel, briefIndex,impactListKey="";
  const captions={lluvia:"Lluvia medida", impacto:"Impacto reportado", grave:"Impacto grave confirmado", restablecido:"Restablecido",rio:"Estación de río",puerto:"Puerto",pronostico:"Pronóstico"};
  function signalDialog(s,fromLink=false) {
    if(s.item) {showRecord(s.item,fromLink);return;}
    const event=s.event;
    const fields=[];
    const references=recordSources(node,link);
    references.add("Publicación original de "+s.source+" ↗",s.url);
    const place=[s.locality || s.station,s.district,s.province,regionTitle(s.region)].filter(Boolean);
    const seen=new Set([s.title]);
    for(const text of [event?.corroboratedClaim,s.text]) {
      if(text && !seen.has(text)) {fields.push(node("p",text,"record-lead"));seen.add(text);}
    }
    fields.push(node("p",[...new Set(place)].join(" · ") || s.regions?.map(regionTitle).join(", "),"signal-place"),
      node("p",s.source,"record-source"),noticeShare(s));
    const noteId=event?.itemId || (s.radar || s.type==="observacion" ? latestPanel?.items?.find(it=>it.radarType===(s.type==="observacion"?"observacion":"pronostico") && it.url===s.url && it.region===s.region && it.province===s.province && (!s.locality || it.locality===s.locality))?.id : null);
    const note=latestPanel?.explanations?.notices?.[noteId];
    if(s.mark==="grave" && event?.severityEvidence) {
      fields.push(node("h3","Por qué se marca en rojo"),node("p",event.severityEvidence.text));
      references.add("Evidencia de la afectación ↗",event.severityEvidence.url);
    }
    if(event?.localities?.length)fields.push(node("p","Lugares mencionados · "+event.localities.join(" y ")));
    const checked=event?.checkedAt || s.checkedAt || (s.radar || s.type==="observacion" ? latestPanel?.radar?.lastSuccessAt : null);
    fields.push(...recordDates([
      ["Inicio de la medición",s.type==="observacion" && s.from],
      ["Fin de la medición",s.type==="observacion" && s.at],
      [event?.occurredAtPrecision==="aproximada"?"Hora aproximada del hecho":"Fecha del hecho",event?.occurredAt],
      ["Publicación",s.issuedAt || event?.reportedAt || (s.type!=="puerto" && s.at)],
      ["Fecha del parte portuario",s.type==="puerto" && s.at!==s.checkedAt && s.at],
      ["Vigente hasta",s.mode==="pronostico" && s.expiresAt],["Última verificación",checked]
    ],node,dateTime));
    if(note?.mode==="ia") fields.push(node("h3","Lectura con IA"),node("p",note.what),node("p",note.meaning));
    if(event?.timeline?.length) {
      const sorted=[...event.timeline].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
      const last=sorted.at(-1);
      fields.push(node("h3",sorted.length>1?"Qué cambió":"Última actualización"),node("p",last.text));
      const det=node("details","","record-timeline");det.append(node("summary","Cronología · "+sorted.length+" registros"));
      const ol=node("ol");
      for(const step of sorted) {
        const li=node("li");li.append(node("strong",dateTime(step.at)),node("p",step.text));
        if(step.url) references.add((step.source || s.source)+" · cronología ↗",step.url);
        ol.append(li);
      }
      det.append(ol);fields.push(det);
    }
    for(const ev of event?.evidence || []) {
      if(!ev.url || ev.url===s.url && ev.type==="documento")continue;
      const date=ev.date && (ev.dateKind==="anexo"?"Fecha indicada en el anexo":ev.dateKind==="captura"?"Fecha de toma":"Fecha de publicación")+" · "+dateTime(ev.date);
      references.add((ev.label || (ev.type==="fotos"?"Anexo fotográfico":"Documento original"))+" ↗",ev.url,
        [ev.caption,date,ev.source].filter(Boolean).join(" · "));
    }
    if(event?.corroborated && Array.isArray(event.relatedItems))
      for(const ref of event.relatedItems)references.add((ref.source || "Segunda fuente del hecho")+" ↗",ref.url);
    if(event?.contributors?.length) {
      for(const c of event.contributors)references.add(c.source+" ↗",c.url);
    }
    if(event?.recommendations?.length) {
      fields.push(node("h3","Qué recomienda la autoridad"));
      for (const rec of event.recommendations) {
        fields.push(node("p",rec.text));
        references.add(rec.source+" · recomendación ↗",rec.url);
      }
    }
    const originalItem=event?.itemId && latestPanel?.items?.find(it=>it.id===event.itemId);
    const visual=recordVisual(originalItem ? {...s,item:originalItem} : s,{addSource:references.add});
    if(visual)fields.push(visual);
    fields.push(...references.section());
    recordDialog(s,fromLink,s.label,s.title,...fields);
  }
  function row(s) {
    const mark=s.type==="impacto" && s.combinedMark || s.mark;
    const b=node("button","","signal-row "+mark);
    b.type="button";
    const who=node("span","","signal-kicker");
    const label=s.combinedMark && s.type==="impacto"?combinedLabels[s.combinedMark]:s.label;
    who.append(node("i","","symbol "+mark),node("span",label));
    const scopedItem=s.item && scopeRegion && inScope(s,scopeRegion,scopeArea,scopeCatalog);
    const place=(scopedItem && (scopeCatalog?.byId.get(scopeArea)?.name || regionTitle(scopeRegion))) || s.district || s.province || s.region || (s.regions?.length ? s.regions.slice(0,2).map(regionTitle).join(", ")+(s.regions.length>2?" y más":"") : "");
    const levels=(scopeArea && s.item?.districtLevels?.[scopeArea]) || [];
    b.append(who,node("strong",s.title),node("small",[place,levels.length?"Sectores en "+levels.map(l=>l.toLowerCase()).join(" y "):"",signalDates(s)].filter(Boolean).join(" · ")));
    b.onclick=()=>signalDialog(s);return b;
  }
  function group(list,title="Reportes del lugar") {
    if(list.length===1) return signalDialog(list[0]);
    const container=node("div","","group-signals");container.append(...list.map(row));
    dialog("Consulta territorial",title,container);
  }
  function renderBrief(records,{panel,index,region,area,city,now}) {
    const box=$("areaBrief"),sources=$("areaBriefSources");
    box.hidden=!region;
    if(!region) {sources.hidden=true;briefKey="";return;}
    const scope=[region,area,city].join("|");
    if(sources.dataset.scope!==scope) {sources.open=false;sources.dataset.scope=scope;}
    const key=scope+"|"+Math.floor(now/60000);
    if(briefPanel===panel && briefIndex===index && briefKey===key)return;
    briefPanel=panel;briefIndex=index;briefKey=key;
    const place=city || (area==="1501" ? "Lima Metropolitana" : index?.byId.get(area)?.name) || regionTitle(region);
    $("areaBriefTitle").textContent=(area?.length===4 && area!=="1501" ? "Resumen de la provincia de " : "Resumen de ")+place;
    const clocks=[];
    if(panel?.updatedAt)clocks.push("Edición nacional del "+dateTime(panel.updatedAt));
    if(records.some(s=>s.item?.directRiverCheckedAt))clocks.push("Ríos consultados directamente el "+dateTime(panel.directRiverCheckedAt));
    if(records.some(s=>s.item?.directMeteoCheckedAt))clocks.push("Avisos meteorológicos consultados directamente el "+dateTime(panel.directMeteoCheckedAt));
    $("areaBriefCut").textContent=clocks.length ? clocks.join(" · ")+" · hora de Perú" : "";
    const facts=$("areaBriefFacts"),visual=$("areaBriefVisual");
    facts.replaceChildren();visual.replaceChildren();
    const brief=territorialBrief(records,{region,area,index});
    let regionalFact;
    if(panel && index && area?.length===4 && area!=="1501" && !records.length) {
      const elsewhere=all.flatMap(s=>{
        if(!inScope(s,region,"",index))return [];
        if(!s.item?.coverageDaysComplete)return [s];
        const item=noticeForRegionDay(s.item,region,now);
        return item?[{...s,item,from:item.validFrom,expiresAt:item.validUntil}]:[];
      });
      const scoped=territorialBrief(combinedSignals(elsewhere,now),{region,index});
      regionalFact=scoped.highlights[0];
      if(regionalFact)brief.sources.push(...territorialBrief([regionalFact.signal],{region,index}).sources);
    }
    if(!panel || area && !index) facts.append(node("p","Consultando la edición del lugar…","brief-gap"));
    else if(!brief.highlights.length) {
      const scopeName=area?.length===6 ? "este distrito" : area?.length===4 ? "esta provincia" : city ? "esta ciudad" : "esta región";
      facts.append(node("p","La edición no contiene mediciones recientes, avisos hidrológicos vigentes, impactos reportados en las últimas 24 horas ni pronósticos con cobertura documentada para "+scopeName+".","brief-gap"));
      if(regionalFact) {
        const wider=node("div","","brief-context");
        wider.append(node("strong","Contexto regional de "+regionTitle(region)),node("p",regionalFact.label+" · "+regionalFact.text),node("small",regionalFact.date));
        const button=node("button","Ver región de "+regionTitle(region)+" →","pane-more");
        button.type="button";button.onclick=()=>onPlace(region,"");wider.append(button);facts.append(wider);
      }
    } else {
      const list=node("ul","","brief-facts"),extra=node("ul","","brief-facts");
      for(const [index,fact] of brief.highlights.entries()) {
        const li=node("li");
        li.append(node("strong",fact.label),node("p",fact.text),node("small",fact.date));
        if(fact.districtNames.length>2) {
          const scope=node("details","","brief-places");
          scope.append(node("summary","Sectores por distrito"),node("p",fact.districtNames.join(". ")+"."));
          li.append(scope);
        }
        (index<3 ? list : extra).append(li);
      }
      facts.append(list);
      if(extra.childElementCount) {
        const det=node("details","","brief-more");
        det.append(node("summary","Ver "+extra.childElementCount+(extra.childElementCount===1 ? " idea más" : " ideas más")),extra);
        facts.append(det);
      }
      if(!records.some(s=>s.mode==="ahora")) facts.append(node("p","Las fuentes consultadas no aportan una observación reciente, un aviso hidrológico vigente o un impacto reciente para este lugar.","brief-gap"));
    }
    const originals=new Map(brief.sources.map(ref=>[ref.url,ref]));
    const addSource=(label,url,detail)=>{if(url && !originals.has(url))originals.set(url,{source:label,url,title:detail});};
    for(const s of new Set([...brief.highlights.map(f=>f.signal),...records])) {
      // An illustration from a broader bulletin may refer to a different district.
      if(s.type!=="impacto" || !s.district && !s.locality && !s.province || area && !s.area?.startsWith(area))continue;
      const image=recordVisual(s,{addSource});
      if(image){
        const caption=node("p",["Registro visual",s.district || s.locality || s.province,s.event?.title].filter(Boolean).join(" · "),"brief-cut");
        visual.append(caption,image);break;
      }
    }
    sources.hidden=!originals.size;
    const list=sources.querySelector("ul");
    list.replaceChildren();
    for(const ref of originals.values()){
      const li=node("li");
      const a=link([ref.source,ref.title].filter(Boolean).join(" · ")+" ↗",ref.url);
      if(a.href){li.append(a);list.append(li);}
    }
  }
  function nationalImpacts(overview,loading) {
    const container=$("nationalImpactRows");
    const rows=overview.filter(r=>!["observacion","pronostico"].includes(r.mark));
    const key=JSON.stringify([loading,rows.map(r=>[r.region,r.mark,r.signal.id,r.signal.label,r.signal.title,signalDates(r.signal)])]);
    if(impactListKey===key)return;
    impactListKey=key;container.replaceChildren();
    if(!rows.length) {
      container.append(node("p",loading?"Consultando reportes…":"La edición no registra impactos con alcance regional verificable en las últimas 24 horas.","brief-gap"));
      return;
    }
    for(const r of rows) {
      const s=r.signal,locality=s.district || s.province || s.locality;
      const b=node("button","","signal-row");b.type="button";
      b.dataset.region=r.region;
      const status=node("span",[combinedLabels[r.mark],locality].filter(Boolean).join(" · "),"impact-status "+r.mark);
      const arrow=node("span","›","impact-open");arrow.setAttribute("aria-hidden","true");
      b.append(node("strong",regionTitle(r.region)),status,arrow,
        node("span",s.title),node("small",[s.source,signalDates(s)].filter(Boolean).join(" · ")));
      b.onclick=()=>onPlace(r.region,"");container.append(b);
    }
  }
  function render({panel,items,index,map,region,area,city,view,layer,hazard,readFailed=false,retryCatalog=null,now=Date.now()}) {
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
    const combined=layer==="todo";
    const matchesLayer=s=>combined || s.layer===layer;
    const isRecent=s=>combined || s.type==="estacion" ? currentCombined(s,now) : s.mode==="pronostico" || now-Date.parse(s.type==="puerto" && s.checkedAt || s.at)<=24*3600000;
    const viewRows=all.filter(s=>s.mode===view && matchesLayer(s));
    const viewSignals=combined ? combinedSignals(viewRows,now) : viewRows.filter(isRecent);
    const overview=combined ? regionalOverview(viewSignals) : [];
    const national=!region && combined && view==="ahora";
    $("nationalImpacts").hidden=!national;
    if(national)nationalImpacts(overview,!panel);
    let scoped=all.flatMap(s=>{
      if(!region || !s.item?.coverageDaysComplete)return [s];
      const item=noticeForRegionDay(s.item,region,now,area,index);
      return item?[{...s,item,regions:item.regions,from:item.validFrom,expiresAt:item.validUntil}]:[];
    }).filter(s=>inScope(s,region,area,index));
    if(city && !area) scoped=scoped.filter(s=>normalizePlace(s.district || s.locality).replace(/^ciudad de /,"")===normalizePlace(city));
    const recent=combinedSignals(scoped,now);
    renderBrief(recent,{panel,index,region,area,city,now});
    current=scoped.filter(s=>s.mode===view && matchesLayer(s));
    const past=current.filter(s=>!isRecent(s));
    current=combined ? combinedSignals(current,now) : current.filter(isRecent);
    const archive=$("pastSignals");archive.hidden=!past.length;
    const archiveKey=past.map(s=>s.id+"|"+s.at).join(";");
    if(archive.dataset.list!==archiveKey){
      archive.dataset.list=archiveKey;
      archive.querySelector("summary").textContent="Reportes anteriores · "+past.length;
      const more=node("button","Consultar el archivo del lugar →","pane-more");more.type="button";more.onclick=()=>group(past,"Reportes de días anteriores");
      archive.querySelector("div").replaceChildren(...past.slice(0,3).map(row),...(past.length>3?[more]:[]));
    }
    // Forecasts published only for a region remain in its regional context. They never become district pins.
    const drawn=current.filter(s=>!s.item?.sectorMap && s.type!=="aviso" && (combined || !s.recent || view==="pronostico" || !current.some(o=>o.id!==s.id && o.type===s.type && o.area===s.area && o.locality===s.locality && Date.parse(o.at)>Date.parse(s.at))));
    map?.local({region,area,layer,retryCatalog},drawn,view==="pronostico" && !combined?current.filter(s=>s.item?.sectorMap && s.item.sourceId==="senamhi-"+hazard):[],index);
    const root=$("placeTrail"),title=city || (area==="1501" ? "Lima Metropolitana" : area && index?.byId.get(area)?.name) || regionTitle(region) || "Todo el Perú";
    const nextTrailKey=[region,area,city,title,Boolean(index)].join("|");
    if(trailKey!==nextTrailKey){root.replaceChildren();
    const crumb=(text,r,id,isLast=false)=>{
      if(isLast) {const here=node("span",text);here.setAttribute("aria-current","location");root.append(here);return;}
      const b=node("button",text);b.type="button";b.title=!r?"Volver a todo el Perú":!id?"Volver a la región "+regionTitle(r):"Volver a la provincia de "+(index?.byId.get(id)?.name || text);b.setAttribute("aria-label",b.title);b.onclick=()=>onPlace(r,id);root.append(b);
    };
    crumb("Perú","", "", !region);
    const provinceName=area && index?.byId.get(area.slice(0,4))?.name;
    const homonym=Boolean(provinceName && normalizePlace(provinceName)===normalizePlace(regionTitle(region)));
    if(region) crumb(homonym?"Región "+regionTitle(region):regionTitle(region),region,"",(!area || region==="Lima Metropolitana" && area==="1501") && !city);
    if(area && index) {
      if(area.length>=4 && !(region==="Lima Metropolitana" && area==="1501")) crumb(homonym ? "Provincia de "+provinceName : provinceName || area.slice(0,4), region,area.slice(0,4),area.length===4);

    } else if(city) crumb(city,region,"",true);
    trailKey=nextTrailKey;}
    $("placeTitle").textContent=title;
    const available=region && !area && region!=="Lima Metropolitana" ? (index?.children(region) || []).filter(p=>p.id.length===4) : [];
    const select=$("areaSelect");
    if ($("areaSelectLabel").dataset.scope!==region+area || select.options.length!==available.length+1) {
      select.replaceChildren(new Option("Seleccionar provincia",""));
      for(const p of available)select.append(new Option(p.name,p.id));
      $("areaSelectLabel").dataset.scope=region+area;
    }
    select.onchange=()=>{if(select.value)onPlace(region,select.value);};
    $("areaSelectLabel").hidden=!available.length;
    $("areaSelectTitle").textContent="Provincias de la región";
    $("regionalContext").hidden=!region;
    $("signalsTitle").textContent=view==="pronostico"?"Pronósticos y avisos":"Mediciones y reportes";
    $("signalsCount").textContent=current.length?String(current.length):"";
    const viewKey=[region,area,city,view,layer,hazard].join("|");
    const canSwitch=view==="ahora" && recent.some(s=>s.mode==="pronostico" && matchesLayer(s));
    const listKey=JSON.stringify([viewKey,Boolean(panel),canSwitch,current.map(s=>[s.id,s.title,s.label,s.at,s.expiresAt,s.item?.directRiverCheckedAt,s.item?.directMeteoCheckedAt])]);
    if(listKey!==lastResults) {
      lastResults=listKey;
      const list=$("localSignals");list.replaceChildren();
      if(!current.length) list.append(node("p",panel ? (view==="pronostico"?"Sin pronóstico con este alcance en la edición consultada.":"Sin reporte reciente para este lugar.") : "Consultando las fuentes…","signal-empty"));
      else list.append(...current.slice(0,4).map(row));
      if(!current.length && canSwitch) {
        const b=node("button","Ver pronóstico de "+title+" →","pane-more");
        b.type="button";b.onclick=()=>document.querySelector('[data-view="pronostico"]').click();
        list.append(b);
      }
      $("allSignals").hidden=current.length<=4;
      $("allSignals").onclick=()=>group(current,"Reportes de "+title);
    }
    const key=$("mapKey");key.replaceChildren();
    const types=view==="pronostico"?["pronostico"] : layer==="lluvias"?["lluvia","impacto","grave","restablecido"]:layer==="rios"?["rio","impacto"]:["puerto"];
    const legendTypes=combined ? view==="pronostico"?["pronostico"]:["grave","impacto","reportado","restablecido","observacion"] : types;
    for(const type of legendTypes){const legend=node("span");legend.append(node("i","","symbol "+type),document.createTextNode(combined ? combinedLabels[type] : captions[type]));key.append(legend);}
    if(view==="pronostico" && layer==="lluvias") {
      for(const l of ["amarillo","naranja","rojo"]){const mark=node("span");mark.append(node("i","","level-dot "+l),document.createTextNode("Nivel "+l));key.append(mark);}
      key.append(node("small",(hazard==="quebradas"?"Posible activación de quebradas":"Pronóstico de lluvia en 24 h")+" · sectores delimitados por SENAMHI"));
    }
    else if(combined)key.append(node("small",view==="ahora"?"El color regional indica el tipo de evidencia más relevante. El número cuenta reportes.":"Las áreas muestran el alcance de los pronósticos. En Lluvias puedes consultar los niveles de peligro de cada aviso."));
    else key.append(node("small","Los puntos agrupan reportes por lugar. Abre la ficha para ver la ubicación indicada por la fuente."));
    // Data refreshes may update a card while the reader stays in the same view.
    if(lastView && viewKey!==lastView && matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      for(const el of [$("placeTitle"),$("localSignals"),key]) {
        for(const prior of el.getAnimations?.() || [])if(prior.id==="territorial-view")prior.cancel();
        el.animate?.([{opacity:.68,transform:"translateY(3px)"},{opacity:1,transform:"none"}],
          {id:"territorial-view",duration:180,easing:"ease-out"});
      }
    }
    lastView=viewKey;
    return {current,viewSignals,overview};
  }
  return {render,group,signalDialog,get signals(){return all;},get current(){return current;}};
}
