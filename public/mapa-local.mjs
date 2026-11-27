import {editionAsset} from "./publicacion.mjs";
import {combinedLabels,combinedPriority} from "./capa-todo.mjs?v=2";
const ns="http://www.w3.org/2000/svg";
function svg(tag, props={}) {
  const el=document.createElementNS(ns,tag);
  for (const [k,v] of Object.entries(props)) el.setAttribute(k,v);
  return el;
}
const symbols = {lluvia:"M0 -7C-1 -4 -5 0 -5 3a5 5 0 0 0 10 0C5 0 1 -4 0 -7Z",rio:"M-7 -3q3 -4 7 0t7 0M-7 3q3 -4 7 0t7 0",impacto:"M0 -7L7 5H-7Z",grave:"M0 -7L7 5H-7Z",restablecido:"M-6 0l4 4 8 -9",puerto:"M0 -6v11m-6 -4q5 8 12 0M-3 -3h6",pronostico:"M0 -6l6 6 -6 6 -6 -6Z"};
const ringsByFeature=new WeakMap();
export function provincialHazardPath(feature,box) {
  if(!box)return feature.d;
  if(!ringsByFeature.has(feature)) {
    const rings=[];
    for(const part of feature.d.matchAll(/M([^MZ]+)Z/g)) {
      let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
      for(const point of part[1].split("L")) {
        const [a,b]=point.split(",").map(Number);
        x=Math.min(x,a);y=Math.min(y,b);right=Math.max(right,a);bottom=Math.max(bottom,b);
      }
      rings.push({path:part[0],x,y,right,bottom});
    }
    const complete=rings.length && rings.every(r=>[r.x,r.y,r.right,r.bottom].every(Number.isFinite)) &&
      rings.map(r=>r.path).join("")===feature.d;
    ringsByFeature.set(feature,complete?rings:null);
  }
  // Keep complete official rings, including holes, through a generous margin
  // around the province. There is no clipping or change to the hazard level.
  const pad=Math.max(box.width,box.height,1)*2;
  const rings=ringsByFeature.get(feature);
  if(!rings)return feature.d;
  return rings.filter(r=>r.x<=box.x+box.width+pad && r.right>=box.x-pad &&
    r.y<=box.y+box.height+pad && r.bottom>=box.y-pad).map(r=>r.path).join("");
}
export function localMap({world,fit,fitRegion,onArea,onGroup}) {
  const fills=svg("g",{class:"province-fills","aria-hidden":"true","pointer-events":"none"});
  const boundaries=svg("g",{class:"local-boundaries"}), hazards=svg("g",{class:"hazard-polygons","aria-hidden":"true","pointer-events":"none"}), pins=svg("g",{class:"signal-pins","aria-label":"Puntos con reportes"});
  world.insertBefore(fills,world.querySelector("#mapLabels"));
  world.insertBefore(hazards,world.querySelector("#mapLabels"));
  world.insertBefore(boundaries,world.querySelector("#mapLabels"));
  world.append(pins);
  const cache=new Map();
  function json(path,volatile=false) {
    if (!cache.has(path)) cache.set(path,fetch(volatile?editionAsset(path):path,volatile?{cache:"no-cache"}:{}).then(r=>{
      if (!r.ok) throw Error("Capa sin respuesta");
      return r.json();
    }).catch(e=>{cache.delete(path);throw e;}));
    return cache.get(path);
  }
  let seq=0,lastScope=null,paths=[],visibleFeatures=[],lastMarks="",marks=[],unit=0,lastSectors="";
  let drawnLayer="",pinTransition;
  const map=world.ownerSVGElement,frame=map.parentElement;
  const controls=[...frame.querySelectorAll(".map-scope,.layer-switch,#hazardChoice,#mapLegend,#mapBack")];
  let reserved=[],layoutDirty=true,layoutFrame=0;
  function invalidateLayout() {
    layoutDirty=true;
    if(layoutFrame || !paths.length)return;
    layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;if(unit>0)scale(unit);});
  }
  const resizeControls=new ResizeObserver(invalidateLayout);
  for(const control of [map,...controls])resizeControls.observe(control);
  const framesChanged=new MutationObserver(invalidateLayout);
  framesChanged.observe(frame,{attributes:true,attributeFilter:["class","data-map-layer"]});
  for(const control of controls)framesChanged.observe(control,{attributes:true,attributeFilter:["hidden","class"]});
  function measureControls() {
    const mapBox=map.getBoundingClientRect();
    reserved=[];
    for(const control of controls) {
      const rect=control.getBoundingClientRect();
      if(rect.width>0 && rect.height>0 && rect.left<mapBox.right && rect.right>mapBox.left &&
        rect.top<mapBox.bottom && rect.bottom>mapBox.top && getComputedStyle(control).visibility!=="hidden") {
        reserved.push({left:rect.left-mapBox.left-4,right:rect.right-mapBox.left+4,top:rect.top-mapBox.top-4,bottom:rect.bottom-mapBox.top+4});
      }
    }
    layoutDirty=false;
  }
  function measureLabels() {
    // Measure text at its intrinsic SVG size only when geometry or fonts change.
    for(const {label} of paths)label.style.display="";
    for(const entry of paths) {
      const b=entry.label.getBBox();
      entry.textBox={left:b.x-3,right:b.x+b.width+3,top:b.y-3,bottom:b.y+b.height+3};
    }
  }
  document.fonts?.ready.then(()=>{if(paths.length){measureLabels();invalidateLayout();}});
  const offsets=[[0,0],[0,-22],[0,24],[-22,0],[22,0],[0,-42],[0,44],[-30,-18],[30,-18],[-30,18],[30,18]];
  const overlaps=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
  const warning=document.createElement("p");
  warning.className="province-map-status"; warning.hidden=true; warning.setAttribute("role","status");
  world.ownerSVGElement.parentElement.append(warning);
  function scale(n) {
    if (!(n>0) || !Number.isFinite(n)) return;
    unit=n;
    if(layoutDirty && paths.length)measureControls();
    const view=world.ownerSVGElement.viewBox.baseVal;
    const occupied=reserved.slice();
    for(const mark of marks) {
      const x=(mark.x-view.x)/n,y=(mark.y-view.y)/n;
      occupied.push({left:x-15,right:x+17,top:y-16,bottom:y+13});
    }
    for (const {label,center,shape,textBox} of paths) {
      const x=(center[0]-view.x)/n,y=(center[1]-view.y)/n;
      const origin={left:x+textBox.left,right:x+textBox.right,top:y+textBox.top,bottom:y+textBox.bottom};
      const around=[];
      for(const control of reserved) {
        if(!overlaps(origin,control))continue;
        // Try the closest edge of the actual overlay. The legend can be much
        // taller than a label, especially when it lists several observations.
        around.push([0,control.top-origin.bottom-1],[0,control.bottom-origin.top+1],
          [control.left-origin.right-1,0],[control.right-origin.left+1,0]);
      }
      const candidates=around.length?[[0,0],...around.filter(([dx,dy])=>Math.abs(dx+dy)<=110).sort((a,b)=>Math.hypot(...a)-Math.hypot(...b)),...offsets.slice(1)]:offsets;
      let shown=false;
      for(const [dx,dy] of candidates) {
        const box={left:origin.left+dx,right:origin.right+dx,top:origin.top+dy,bottom:origin.bottom+dy};
        if(box.left<3 || box.right>view.width/n-3 || box.top<3 || box.bottom>view.height/n-3 ||
          occupied.some(other=>overlaps(box,other)))continue;
        const tx=center[0]+n*dx,ty=center[1]+n*dy;
        // The published centre is inside its province. A shifted label must
        // also fit there, rather than appearing over an unrelated neighbour.
        if((dx || dy) && (!shape || ![textBox.left+3,0,textBox.right-3].every(side=>
          shape.isPointInFill(new DOMPoint(tx+n*side,ty+n*(textBox.top+textBox.bottom)/2)))))continue;
        occupied.push(box);
        label.setAttribute("transform","translate("+tx+" "+ty+") scale("+n+")");
        shown=true;break;
      }
      label.style.display=shown ? "" : "none";
    }
    for (const {el,x,y,glyph,counter,hit,radius} of marks) {
      el.setAttribute("transform","translate("+x+" "+y+") scale("+n+")");
      if (!radius) continue;
      // Reserve space inside the outline. Small regions keep their count in
      // the accessible label and region panel when the badge cannot be read.
      const space=radius/n;
      const showCount=space>=13;
      if (counter) counter.style.display=showCount ? "" : "none";
      const extent=counter && showCount ? 18 : 10;
      const factor=Math.min(.94,.76*space/extent);
      glyph.setAttribute("transform","scale("+factor+")");
      hit.setAttribute("r",Math.min(18,space+2));
    }
  }
  function drawBoundaries(features,region,id,index) {
    const material=document.createDocumentFragment();
    const surfaces=document.createDocumentFragment();
    const active=boundaries.contains(document.activeElement)?document.activeElement.dataset.area:"";
    let selection=null,casing=null;
    paths=[];
    for (const p of features) {
      const place=index.byId.get(p.id);
      if(!place)continue;
      const selected=p.id===id, neighbour=index.regionOf(p.id)!==region;
      const state=(selected?" is-selected":"")+(neighbour?" adjacent":"");
      surfaces.append(svg("path",{d:p.d,"fill-rule":"evenodd",class:"province-fill"+state,
        "data-province":p.id,"data-tone":Number(p.id)%3,stroke:"none"}));
      const el=svg("path",{d:p.d,"fill-rule":"evenodd",fill:"transparent",class:"local-area"+state,
        "pointer-events":"fill","vector-effect":"non-scaling-stroke",
        "data-area":p.id,role:"button",tabindex:neighbour?"-1":"0","aria-label":"Provincia de "+p.name,"aria-pressed":String(selected)});
      const title=svg("title");
      title.textContent=p.name;el.append(title);
      if(selected) {
        selection=el;
        casing=svg("path",{d:p.d,class:"province-selection-casing",fill:"none","vector-effect":"non-scaling-stroke","pointer-events":"none","aria-hidden":"true"});
      } else material.append(el);
      el.onkeydown=e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();e.stopPropagation();onArea(p.id);}};
      const label=svg("text",{class:"area-label"+(selected?" current":""),"text-anchor":"middle","aria-hidden":"true"});
      label.textContent=p.name;
      paths.push({label,p,center:place.center,shape:el,selected,neighbour});
    }
    paths.sort((a,b)=>Number(b.selected)-Number(a.selected) || Number(a.neighbour)-Number(b.neighbour));
    visibleFeatures=features;
    world.ownerSVGElement.classList.remove("province-awaits-shape");
    if(selection)material.append(casing,selection);
    fills.replaceChildren(surfaces);
    boundaries.replaceChildren(material,...paths.map(p=>p.label));
    measureLabels();
    if(unit>0)scale(unit);
    if(active)boundaries.querySelector('[data-area="'+active+'"]')?.focus({preventScroll:true});
  }
  function pendingSelection(selected) {
    paths=[]; visibleFeatures=[]; fills.replaceChildren(); boundaries.replaceChildren();
    world.ownerSVGElement.classList.add("province-awaits-shape");
    if(selected?.center) {
      const label=svg("text",{class:"area-label current","text-anchor":"middle"});
      label.textContent=selected.name;boundaries.append(label);
      paths=[{p:selected,center:selected.center,label,selected:true}];
      measureLabels();
      if(unit>0)scale(unit);
    }
  }
  async function scope(region,area,index) {
    if (!index) return;
    const id=(area || "").slice(0,4);
    const key=region+":"+id;
    if (key===lastScope) return;
    const previous=lastScope;
    const order=++seq;
    lastScope=key;warning.hidden=true;
    if (!region) {
      paths=[];visibleFeatures=[];fills.replaceChildren();boundaries.replaceChildren();
      world.ownerSVGElement.classList.remove("province-awaits-shape");
      return;
    }
    const dep=index.department(region);
    if (!dep) return;
    const selected=id && index.byId.get(id);
    if(previous?.startsWith(region+":") && visibleFeatures.length)
      drawBoundaries(visibleFeatures,region,id,index);
    else pendingSelection(selected);
    if (selected?.box) fit(selected.box);
    else if (!id && previous?.startsWith(region+":")) fitRegion(region);
    // Only department files contain province boundaries. Districts in reports
    // retain their source UBIGEO and never request another geometry layer.
    const readDepartment=code=>json("./atlas/territorios/"+code+".json");
    try {
      const set=await readDepartment(dep);
      if(order!==seq)return;
      if(!id && region==="Lima Metropolitana") {
        drawBoundaries(set.features.filter(p=>p.id==="1501"),region,id,index);
      } else drawBoundaries(set.features,region,id,index);
      if(id && !selected?.box) {
        const shape=set.features.find(p=>p.id===id);
        if(shape)fit(shape.box);
      }
      if (!selected?.box) return;
      // Show provinces across a department border when they are visible in
      // the same neighbourhood, including Lima and Callao.
      const box=selected.box, pad=Math.max(box.width,box.height,0.45);
      const nearby=index.provinces.filter(p=>p.id.slice(0,2)!==dep && p.box &&
        p.box.x<=box.x+box.width+pad && p.box.x+p.box.width>=box.x-pad &&
        p.box.y<=box.y+box.height+pad && p.box.y+p.box.height>=box.y-pad);
      if(!nearby.length)return;
      const neighbours=new Set(nearby.map(p=>p.id));
      const others=await Promise.allSettled([...new Set(nearby.map(p=>p.id.slice(0,2)))].map(readDepartment));
      if(order!==seq)return;
      const extra=others.flatMap(r=>r.status==="fulfilled"?r.value.features.filter(p=>neighbours.has(p.id)):[]);
      if(extra.length)drawBoundaries([...set.features,...extra],region,id,index);
    } catch {
      if(order!==seq)return;
      // Keep the national outline under the selected location. Never leave
      // the previous region's boundaries on a new selection after a failure.
      pendingSelection(selected);lastScope=null;
      warning.textContent="Límites provinciales pendientes de carga. Puedes consultar las fichas.";
      warning.hidden=false;
    }
  }
  function markers(signals,index,anchor,scope,clearance) {
    const changedLayer=drawnLayer && drawnLayer!==scope.layer;
    drawnLayer=scope.layer;
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
    const sig=scope.layer+JSON.stringify(groups.map(g=>[g.national,g.point,g.records.map(s=>[s.id,s.mark,s.combinedMark,s.label,s.title,s.at])]));
    if (sig===lastMarks) return;
    lastMarks=sig; marks=[]; pins.replaceChildren();
    const prioritize=s=>scope.layer==="todo" ? (combinedPriority[s.combinedMark]??6) :
      ({grave:0,lluvia:1,rio:2,impacto:3,puerto:4,restablecido:5,pronostico:6}[s.mark]??7)+(s.recent?10:0);
    for (const g of groups) g.records.sort((a,b)=>prioritize(a)-prioritize(b));
    groups.sort((a,b)=>prioritize(b.records[0])-prioritize(a.records[0]));
    for (const g of groups) {
      const first=g.records[0],place=g.national?first.region:first.district || first.province || first.region;
      const category=scope.layer==="todo" ? first.combinedMark : null;
      const desc=(g.exact?"Ubicación indicada por la fuente":"Referencia territorial")+" · "+place+" · "+(combinedLabels[category] || first.label)+" · "+g.records.length+(g.records.length===1?" reporte":" reportes");
      const el=svg("g",{class:"signal-pin "+(category==="reportado"?"reportado":first.mark)+(first.recent?" old":""),tabindex:"0",role:"button","aria-label":desc});
      const inside=svg("g",{class:"pin-glyph"});
      const title=svg("title");title.textContent=desc;
      const glyph=svg("g",{class:"round-report"});
      const hit=svg("circle",{r:15,class:"pin-hit"});
      inside.append(hit,glyph);
      glyph.append(svg("circle",{r:9,class:"pin-ground"}),svg("path",{d:symbols[first.mark],class:"pin-symbol"}));
      let counter;
      if(g.records.length>1) {
        counter=svg("g");
        counter.append(svg("circle",{cx:8,cy:-8,r:6,class:"pin-badge"}));
        const count=svg("text",{x:8,y:-5.6,"text-anchor":"middle"});
        count.textContent=String(g.records.length);
        if(count.textContent.length>2)count.setAttribute("font-size","6");
        counter.append(count);
        glyph.append(counter);
      }
      el.append(title,inside);
      const open=()=>g.national && first.region ? onGroup(g.records,desc,first.region) : onGroup(g.records,desc);
      el.onclick=e=>{if(e.defaultPrevented)return;open();};
      el.onkeydown=e=>{if(["Enter"," "].includes(e.key)){e.preventDefault();e.stopPropagation();open();}};
      pins.append(el);marks.push({el,x:g.point[0],y:g.point[1],glyph,hit,counter,radius:g.national && clearance.get(place)});
    }
    scale(unit);
    if(changedLayer) {
      pinTransition?.cancel();
      if(marks.length && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        pinTransition=pins.animate?.([{opacity:.45},{opacity:1}],{duration:160,easing:"ease-out"});
    }
  }
  let hazardsRevision=0;
  async function sectors(notices,now,province) {
    const allowed = notices.filter(s=>s.item?.sectorMap && Date.parse(s.item.validFrom)<=now && now<Date.parse(s.item.validUntil));
    const key=JSON.stringify([province?.id,allowed.map(s=>s.item.sectorMap)]);
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
          const path=provincialHazardPath(f,province?.box);
          if(path)hazards.append(svg("path",{d:path,class:"sector-"+f.level.toLowerCase(),"fill-rule":"evenodd"}));
        }
      } catch {if(order===hazardsRevision)lastSectors="";}
    }
  }
  return {scope,markers,scale,sectors};
}
