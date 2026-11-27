// Extract only the national table of rain-related meteorological warnings.
// Its departments describe the whole notice. The individual SENAMHI maps
// are the source for day-by-day and province-level scope.
export function rainTable(page, pageNo, doc, asOf, departments, parseDate) {
  const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const lines=page.split(/\r?\n/);
  if (!/avisos meteorologicos emitidos y vigentes/.test(fold(page)) || !/fuente\s*:\s*senamhi\b/.test(fold(page))) return [];
  const header=lines.findIndex(l=>/DEPARTAMENTO\s+N[°º]\s+INICIO\s+FIN\s+NIVEL/.test(l));
  if (header<1) return [];
  const center=(line,pattern)=>{const m=line.match(pattern);return m?m.index+m[0].length/2:NaN;};
  const dep=center(lines[header],/DEPARTAMENTO/);
  const title=center(lines[header-1],/AVISO/);
  const num=center(lines[header],/N[°º]/);
  const begin=center(lines[header],/INICIO/);
  if (!(dep<title && title<num && num<begin)) return [];
  const positions=[(dep+title)/2,(title+num)/2,(num+begin)/2];
  const table=lines.slice(header+2).join('\n').split(/NIVELES? DE PELIGRO|Fuente\s*:/i)[0];
  const cells=table.split('\n').map(line=>{
    const cols=['','','',''];
    for(const word of line.matchAll(/\S+(?: \S+)*/g)) {
      const mid=word.index+word[0].length/2;
      let c=positions.filter(b=>mid>b).length;
      cols[c]+=(cols[c]?' ':'')+word[0];
    }
    return cols;
  });
  const groups=[];let first=null;
  for(const [i,row] of cells.entries()) {
    if (!row[0]) continue;
    first??=i;
    const end=fold(row[0]).replace(/\.$/,'');
    if (row[0].endsWith('.') && [...departments.keys()].some(r=>end===r || end.endsWith(' '+r))) {
      groups.push([first,i]);first=null;
    }
  }
  const out=[];
  for(const [i,[start,end]] of groups.entries()) {
    const top=i?Math.floor((groups[i-1][1]+start)/2)+1:0;
    const bottom=i+1<groups.length?Math.floor((end+groups[i+1][0])/2)+1:cells.length;
    const selected=cells.slice(top,bottom);
    const col=c=>selected.map(row=>row[c]).filter(Boolean).join(' ').trim();
    const title=col(1);
    if (!/lluvia|llovizna|precipitaci|graniz|nieve|nevada|tormenta/i.test(title)) continue;
    const identifier=col(2).match(/^(\d{1,5})\s*\((vigente|emitido)\)$/i);
    const data=col(3).match(/^(\d\d?\/\d\d?\/\d{4})\s+(\d\d?\/\d\d?\/\d{4})\s+(AMARILLO|NARANJA|ROJO)$/i);
    if(!identifier||!data) continue;
    const validFrom=parseDate(data[1]),validUntil=parseDate(data[2]);
    if(!validFrom||!validUntil||validFrom>validUntil) continue;
    const labels=fold(col(0)).replace(/(?:la\s+)?prov(?:incia)?\.?\s+const(?:itucional)?\.?\s+del?\s+callao/g,'callao')
      .replace(/\.$/,'').split(/,|\s+y\s+/).map(t=>t.trim()).filter(Boolean);
    if(!labels.length||labels.some(l=>!departments.has(l)))continue;
    const named=labels.map(l=>departments.get(l));
    const regions=named.filter(n=>n!=='Lima'); // No province evidence in this column.
    const year=validFrom.slice(0,4),number=identifier[1];
    out.push({id:'coen:cuadro-meteo:'+year+'-'+number,sourceId:'coen',source:'COEN · INDECI',
      title:'Boletín nacional del COEN · Aviso meteorológico n.º '+number+' · '+title,
      url:doc.pdfUrl+'#page='+pageNo,coverageUrls:[doc.pdfUrl],coenDocument:doc,
      category:'Lluvias',publishedAt:asOf,meteoRosterAt:asOf,regionOrigin:'cuadro-coen',phenomenon:title,
      originNotice:{sourceId:'senamhi-meteo',number,year},validFrom,validUntil,datePrecision:'day',
      regions,region:regions.join(', '),level:data[3].toUpperCase(),
      summary:'El cuadro de SENAMHI reproducido por el COEN enumera los departamentos de '+named.join(', ')+'. Este cuadro cubre todo el periodo del aviso.'});
  }
  return out;
}
