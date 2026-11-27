// COEN's daily bulletin reproduces SENAMHI's national table of active
// hydrological warnings. Read only that explicitly attributed table.
const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const departments='Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|');
const names=new Map(departments.map(r=>[fold(r),r]));
const months='enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
const validDate=(value)=>{
  const parts=value.match(/^(\d\d?)\/(\d\d?)\/(20\d\d)$/);
  if (!parts) return;
  const formatted=parts[3]+'-'+parts[2].padStart(2,'0')+'-'+parts[1].padStart(2,'0');
  const valueMs=Date.parse(formatted);
  if (Number.isFinite(valueMs) && new Date(valueMs).toISOString().startsWith(formatted)) return formatted;
};
export function dailyBulletin(title) {
  return /monitoreo de peligros y perspectivas/.test(fold(title)) && /boletin informativo/.test(fold(title));
}
export function waterRoster(text, entry, doc, now) {
  const pages=text.split('\f'), cover=fold(pages[0]).replace(/\s+/g,' ').trim();
  const edition=cover.match(/boletin informativo n\s*[°ºo.]?\s*(\d{1,5})/);
  const indexNumber=entry.title.match(/\bn\s*[°ºo.]?\s*(\d{1,5})/i)?.[1];
  if (!edition || !indexNumber || Number(indexNumber)!==Number(edition[1])) return [];
  const line=cover.match(/monitoreo de peligros y perspectivas\s+(\d\d?) de ([a-z]+) de (20\d\d)\s+(\d\d?:\d\d)\s*h\b/);
  if (!line) return [];
  const month=months.indexOf(line[2].replace('setiembre','septiembre'))+1;
  const issued=validDate(line[1]+'/'+month+'/'+line[3]);
  const stamp=Date.parse(issued+'T'+line[4].padStart(5,'0')+':00-05:00');
  if (!Number.isFinite(stamp) || stamp>+now+300000 || stamp<+now-48*3600000) return [];
  const asOf=new Date(stamp).toISOString();
  const rows=[];
  for (const [pageIndex,page] of pages.entries()) {
    if (!/avisos hidrologicos emitidos y vigentes/.test(fold(page)) || !/fuente\s*:\s*senamhi\b/.test(fold(page))) continue;
    const lines=page.split(/\r?\n/);
    const header=lines.findIndex(l=>/departamento\s+aviso hidrologico\s+n\s*[°º]/.test(fold(l)) && /INICIO\s+FIN\s+NIVEL/i.test(l));
    if (header<0) continue;
    const table=lines.slice(header+1).join('\n').split(/NIVELES? DE PELIGRO|Fuente\s*:/i)[0];
    for (const block of table.split(/\n\s*\n/g)) {
      const lines=block.split('\n').filter(l=>l.trim());
      const pattern=/(?:^|\s)(\d{1,5})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(AMARILLO|NARANJA|ROJO)\s*$/i;
      const blocks=lines.map(l=>l.match(pattern)).filter(Boolean);
      if (blocks.length!==1) continue;
      const marker=blocks[0];
      const region=departments.find(r=>lines.some(l=>new RegExp('^'+fold(r)+'(?:\\s{2,}|$)').test(fold(l.trim()))));
      if (!region) continue;
      const river=lines.map(l=>{
        const portion=l.replace(pattern,'').trim();
        if (names.has(fold(portion))) return '';
        if (fold(portion).startsWith(fold(region)+' ')) return portion.slice(region.length).trim();
        return portion;
      }).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
      if (river.length>310 || !/\b(rio|caudal|hidrologic[oa])\b/.test(fold(river))) continue;
      const [,number,start,end,level]=marker;
      const validFrom=validDate(start),validUntil=validDate(end);
      const dated=validFrom && validUntil && validFrom<=validUntil;
      const year=validFrom?.slice(0,4) || (issued.slice(5,7)!=='01' ? issued.slice(0,4) : null);
      if (!year) continue;
      const regions=region==='Lima'?[]:[region]; // No distinction of Lima province in this table.
      const locality=river.match(/estaci[oó]n\s+(.+)$/i)?.[1];
      rows.push({
        id:'coen:cuadro-rios:'+year+'-'+number, sourceId:'coen',source:'COEN · INDECI',
        title:'Boletín nacional del COEN · Aviso hidrológico n.º '+number+' · '+river,
        url:doc.pdfUrl+'#page='+(pageIndex+1),coverageUrls:[doc.pdfUrl],coenDocument:doc,
        category:'Ríos',publishedAt:asOf,rosterListedAt:asOf,regionOrigin:'cuadro-coen',
        originNotice:{sourceId:'senamhi-rios',number,year},regions,region:regions.join(', '),level:level.toUpperCase(),
        ...(dated && {validFrom,validUntil,datePrecision:'day'}),...(locality && {locality}),
        summary:'El cuadro nacional del COEN identifica este aviso de SENAMHI en '+region+'. El nivel publicado es '+level.toLowerCase()+'.'+(dated?'':' El cuadro contiene fechas incompletas.'),
      });
    }
  }
  return new Set(rows.map(r=>r.id)).size===rows.length?rows:[];
}

// Compare the last national bulletin with separately evidenced station
// bulletins. Scope is that bulletin's time, not every possible future notice.
export function riverCoverage(items, source, now) {
  const cutoff=Math.max(...items.filter(r=>r.rosterListedAt).map(r=>Date.parse(r.rosterListedAt)));
  if (!Number.isFinite(cutoff) || +now-cutoff>48*3600000) return;
  const roster=items.filter(r=>r.rosterListedAt && Date.parse(r.rosterListedAt)===cutoff);
  const references=new Set(roster.map(r=>r.originNotice.year+'-'+r.originNotice.number));
  const sorted=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  const detailed=new Set(),extra=new Set(), inIndex=new Set();
  for (const item of items) {
    const ref=item.originNotice?.sourceId==='senamhi-rios' && !item.rosterListedAt ? item.originNotice:null;
    const direct=item.sourceId==='senamhi-rios';
    if ((!direct && !ref) || item.supersededBy || item.withdrawnAt || item.invalidValidity) continue;
    const key=ref?ref.year+'-'+ref.number:item.id.slice('senamhi-rios:'.length);
    if (direct && ['vigente','emitido'].includes(fold(item.sourceStatus || ''))) inIndex.add(key);
    const end=Date.parse(item.validUntil?.length===10 ? item.validUntil+'T23:59:59-05:00' : item.validUntil);
    if (!(end<cutoff) && (!direct || Date.parse(source.lastSuccessAt)>=cutoff)) detailed.add(key);
    const measured=Date.parse(item.observedAt || item.validFrom || item.publishedAt);
    if (!references.has(key) && measured>cutoff && measured<=+now && !item.rosterListedAt &&
        (ref || inIndex.has(key))) extra.add(key);
  }
  return {asOf:new Date(cutoff).toISOString(),url:roster[0].url,
    listed:sorted(references),individuallyConfirmed:sorted([...references].filter(k=>detailed.has(k))),
    rosterOnly:sorted([...references].filter(k=>!detailed.has(k))),additionalSinceCutoff:sorted(extra),
    absentFromLastIndex:sorted([...references,...extra].filter(k=>!inIndex.has(k)))};
}

export function reconcileCoenStations(records) {
  const roster=records.filter(r=>r.rosterListedAt && r.originNotice?.sourceId==='senamhi-rios');
  if (!roster.length) return records;
  const latest=roster.reduce((t,r)=>r.rosterListedAt>t?r.rosterListedAt:t,'');
  const current=roster.filter(r=>r.rosterListedAt===latest);
  const numbers=new Set(current.map(r=>r.originNotice.year+'-'+r.originNotice.number));
  const station=r=>r.locality && r.regions?.length===1 ? fold(r.regions[0]+'|'+r.locality) : null;
  return records.map(r=>{
    const origin=r.originNotice;
    if (r.rosterListedAt || origin?.sourceId!=='senamhi-rios' || !station(r)) return r;
    if (numbers.has(origin.year+'-'+origin.number)) {
      if (r.withdrawalOrigin!=='cuadro-coen') return r;
      const {withdrawnAt,withdrawalOrigin,withdrawalUrl,...confirmed}=r;
      return confirmed;
    }
    if (!r.validFrom || Date.parse(r.validFrom)>Date.parse(latest) || !r.validUntil || Date.parse(r.validUntil)<Date.parse(latest)) return r;
    const successor=current.find(next=>station(next)===station(r) && next.originNotice.year===origin.year &&
      Number(next.originNotice.number)>Number(origin.number));
    if (!successor || (r.withdrawalOrigin==='cuadro-coen' && r.withdrawalUrl===successor.url)) return r;
    return {...r,withdrawnAt:latest,withdrawalOrigin:'cuadro-coen',withdrawalUrl:successor.url};
  });
}
