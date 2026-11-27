const ns="http://www.w3.org/2000/svg";
function svg(tag, props={}) {
  const el=document.createElementNS(ns,tag);
  for (const [k,v] of Object.entries(props)) el.setAttribute(k,v);
  return el;
}
const symbols = {lluvia:"M0 -7C-1 -4 -5 0 -5 3a5 5 0 0 0 10 0C5 0 1 -4 0 -7Z",rio:"M-7 -3q3 -4 7 0t7 0M-7 3q3 -4 7 0t7 0",impacto:"M0 -7L7 5H-7Z",grave:"M0 -7L7 5H-7Z",restablecido:"M-6 0l4 4 8 -9",puerto:"M0 -6v11m-6 -4q5 8 12 0M-3 -3h6",pronostico:"M0 -6l6 6 -6 6 -6 -6Z"};
export function localMap({world,fit,fitRegion,onArea,onGroup}) {
  const boundaries=svg("g",{class:"local-boundaries"}), hazards=svg("g",{class:"hazard-polygons","aria-hidden":"true"}), pins=svg("g",{class:"signal-pins","aria-label":"Puntos con reportes"});
  world.insertBefore(hazards,world.querySelector("#mapLabels"));
  world.insertBefore(boundaries,world.querySelector("#mapLabels"));
  world.append(pins);
  const cache=new Map();
  function json(path,volatile=false) {
    if (!cache.has(path)) cache.set(path,fetch(path,volatile?{cache:"no-cache"}:{}).then(r=>{
      if (!r.ok) throw Error("Capa sin respuesta");
      return r.json();
    }).catch(e=>{cache.delete(path);throw e;}));
    return cache.get(path);
  }
  let seq=0,lastScope=null,paths=[],flyRequest=false,lastMarks="",marks=[],unit=0,lastSectors="";
  function scale(n) {
    unit=n;
    for (const {label,p,center,selected} of paths) {
      label.style.display=selected || (p.box.width/n>70 && p.box.height/n>28) ? "" : "none";
      label.setAttribute("transform","translate("+center[0]+" "+center[1]+") scale("+n+")");
    }
    for (const {el,x,y} of marks) el.setAttribute("transform","translate("+x+" "+y+") scale("+n+")");
  }
  async function scope(region, area, index) {
    const key=region+":"+area;
    if (key===lastScope || !index) return;
    const returning=lastScope?.startsWith(region+":") && lastScope!==key;
    const seqNow=++seq;
    lastScope=key; paths=[]; boundaries.replaceChildren();
    if (!region) return;
    const dep=index.department(region);
    const parent=area.length>=4?area.slice(0,4):region==="Lima Metropolitana"?"1501":dep;
    if (!parent) return;
    flyRequest=Boolean(area || region==="Lima Metropolitana");
    try {
      const [set,provSet]=await Promise.all([
        json("./atlas/territorios/"+parent+".json"),
        (area.length===4 || region==="Lima Metropolitana" && !area) ? json("./atlas/territorios/"+dep+".json") : null]);
      if (seq!==seqNow) return;
      const showing=set.features.filter(p=>region!=="Lima" || !p.id.startsWith("1501"));
      const frag=document.createDocumentFragment();
      for (const p of showing) {
        const el=svg("path",{d:p.d,"fill-rule":"evenodd",class:"local-area"+(area===p.id?" is-selected":""),"data-area":p.id});
        const title=svg("title");
        title.textContent=p.name;
        el.append(title);
        frag.append(el);
        const center=index.byId.get(p.id).center;
        const label=svg("text",{class:"area-label"+(area===p.id?" current":""),"text-anchor":"middle","aria-hidden":"true"});
        label.textContent=p.name;paths.push({el,p,center,label,selected:p.id===area});
      }
      boundaries.append(frag,...paths.map(p=>p.label));scale(unit);
      const selected=(provSet?.features || set.features).find(p=>p.id===(area || parent));
      if (flyRequest && selected) fit(selected.box);
      else if(returning && !area)fitRegion(region);
    } catch {if (seq===seqNow) lastScope=null;}
  }
  function markers(signals,index,anchor,scope) {
    const grouped=new Map();
    for (const s of signals) {
      const coord=s.coordinates;
      let point=Array.isArray(coord) && coord.length===2 && coord.every(Number.isFinite) && coord[0]>=-82 && coord[0]<=-68 && coord[1]>=-19 && coord[1]<=0 ?
        [105+coord[0],6-coord[1]] : null;
      const national=!scope.region;
      const territory=national && s.region ? anchor(s.region) : null;
      if(territory)point=[territory.x,territory.y];
      const exact=!national && Boolean(point);
      point ||= index?.byId.get(s.area)?.center;
      if (!point && s.region) { const a=anchor(s.region); if (a) point=[a.x,a.y]; }
      if (!point) continue;
      const key=point.join(",");
      if (!grouped.has(key)) grouped.set(key,{point,records:[],exact,national});
      grouped.get(key).records.push(s);
    }
    const groups=[...grouped.values()];
    const sig=JSON.stringify(groups.map(g=>[g.point,g.records.map(s=>[s.id,s.mark,s.label,s.title,s.at])]));
    if (sig===lastMarks) return;
    lastMarks=sig; marks=[]; pins.replaceChildren();
    const prioritize=s=>({grave:0,lluvia:1,rio:2,impacto:3,puerto:4,restablecido:5,pronostico:6}[s.mark]??7)+(s.recent?10:0);
    groups.sort((a,b)=>prioritize(b.records[0])-prioritize(a.records[0]));
    for (const g of groups) {
      g.records.sort((a,b)=>prioritize(a)-prioritize(b));
      const first=g.records[0],place=g.national?first.region:first.district || first.province || first.region;
      const desc=(g.exact?"Punto de medición":"Referencia territorial")+" · "+place+" · "+first.label+" · "+g.records.length+" reporte(s)";
      const el=svg("g",{class:"signal-pin "+first.mark+(first.recent?" old":""),tabindex:"0",role:"button","aria-label":desc});
      const inside=svg("g",{class:"pin-glyph"});
      const title=svg("title");title.textContent=desc;
      inside.append(svg("circle",{r:"16",class:"pin-hit"}),svg("circle",{r:"10",class:"pin-ground"}),svg("path",{d:symbols[first.mark],class:"pin-symbol"}));
      if(g.records.length>1) {
        inside.append(svg("circle",{cx:9,cy:-9,r:6,class:"pin-badge"}));
        const n=svg("text",{x:9,y:-6.6,"text-anchor":"middle"});n.textContent=g.records.length>9?"9+":g.records.length;inside.append(n);
      }
      el.append(title,inside);
      const open=()=>g.national && first.region ? onGroup(g.records,desc,first.region) : onGroup(g.records,desc);
      el.onclick=e=>{if(e.defaultPrevented)return;open();};
      el.onkeydown=e=>{if(["Enter"," "].includes(e.key)){e.preventDefault();e.stopPropagation();open();}};
      pins.append(el);marks.push({el,x:g.point[0],y:g.point[1]});
    }
    scale(unit);
  }
  let hazardsRevision=0;
  async function sectors(notices,now) {
    const allowed = notices.filter(s=>s.item?.sectorMap && Date.parse(s.item.validFrom)<=now && now<Date.parse(s.item.validUntil));
    const key=JSON.stringify(allowed.map(s=>s.item.sectorMap));
    if (key===lastSectors) return;
    lastSectors=key; const order=++hazardsRevision; hazards.replaceChildren();
    for (const s of allowed) {
      const meta=s.item.sectorMap;
      if (!/^data\/sectores-(?:lluvias|quebradas)\.json$/.test(meta.url)) continue;
      try {
        const data=await json("./"+meta.url+"?ed="+encodeURIComponent(meta.date+"-"+meta.noticeNumber+"-"+(meta.digest || s.item.version || "")),true);
        if(order!==hazardsRevision)return;
        if (data.digest!==meta.digest || data.sourceId!==s.item.sourceId || String(data.noticeNumber)!==String(meta.noticeNumber) || data.date!==meta.date || data.sourceUrl!==meta.sourceUrl || Date.parse(data.validUntil)!==Date.parse(s.item.validUntil) || Date.parse(data.validFrom)!==Date.parse(s.item.validFrom)) continue;
        for(const f of data.features) {
          if(!["AMARILLO","NARANJA","ROJO"].includes(f.level) || !f.d) continue;
          hazards.append(svg("path",{d:f.d,class:"sector-"+f.level.toLowerCase(),"fill-rule":"evenodd"}));
        }
      } catch {if(order===hazardsRevision)lastSectors="";}
    }
  }
  return {scope,markers,scale,sectors};
}
