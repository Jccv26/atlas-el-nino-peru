// Select from the published edition. Visiting this section never contacts a publisher.
const retention = 72 * 3600000;
const regions = new Set('Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Lima Metropolitana|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|'));
// Editions before publisherRegion existed used these same four editorial sources.
const olderPublishers = new Map([
  ['el-tiempo-piura','Piura'], ['cutivalu','Piura'], ['el-buho','Arequipa'], ['voz-selva','Loreto'],
]);
const fold = text => String(text || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const simple = text => fold(text).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const displayDate = new Intl.DateTimeFormat('es-PE',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Lima'});

function articleUrl(raw, sourceUrl) {
  try {
    const u = new URL(raw);
    const source = new URL(sourceUrl);
    const host = name => name.replace(/^www\./,'');
    if (u.protocol!=='https:' || u.username || u.password || u.port || host(u.hostname)!==host(source.hostname)) return '';
    if ((u.pathname==='/' && !u.search) || u.pathname===source.pathname && u.search===source.search) return '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
      if (/(?:token|apikey|api_key|authorization|password|signature)/i.test(key)) return '';
    }
    u.hash='';
    return u.href;
  } catch {return '';}
}
function namedRegions(item) {
  const supplied=Array.isArray(item.regions) ? item.regions : [];
  // Earlier feeds assigned places by broad keywords as well. For those
  // editions, only retain a named department visible in the actual headline.
  const title=' '+simple(item.title)+' ';
  return [...new Set(supplied.filter(r => regions.has(r) && (item.regionOrigin==='titular-prensa' || title.includes(' '+simple(r)+' '))))];
}
function publisherRegion(source,item) {
  const place=source.publisherRegion || item.publisherRegion || olderPublishers.get(source.id);
  return regions.has(place) ? place : '';
}
function titleKey(title,places) {
  let words=simple(title.replace(/\s*[[(](?:video|fotos?|audio|en vivo)[\])]\s*$/i,''));
  for (const place of places) {
    if (words.startsWith(simple(place)+' ')) {words=words.slice(simple(place).length).trim();break;}
  }
  return words;
}
const domestic = /\b(?:peru|peruan[oa]s?|enfen|senamhi|indeci|coen|cenepred|todo el pais|costa (?:norte|central|sur) del pais|sierra (?:norte|central|sur) del pais)\b/;
const foreign = /\b(?:ee\s*\.?\s*uu|estados unidos|accion de gracias|miami|florida|california|new york|nueva york|ecuador|guayaquil|quito|chile|bolivia|brasil|colombia|mexico|honduras|venezuela|argentina|cuba|haiti|china|india|japon|indonesia|filipinas|australia|vietnam|pakistan|espana|francia|italia|caribe|reino unido)\b/;
const sports = /\b(?:deportes?|futbol|futbolista|seleccion peruana|liga 1|goles?|goleada|champions league|mundial de clubes|partido amistoso|torneo apertura|torneo clausura|voley|penales|copa libertadores)\b/;
const climate = /\b(?:fenomeno (?:de )?(?:el |del )?nino|el nino costero|enfen|enso|senamhi|lluvi[a-z]*|precipitaci[a-z]*|llovizn[a-z]*|inund[a-z]*|aneg[a-z]*|drenaj[a-z]*|desbord[a-z]*|oleajes?|huaycos?|huaicos?|quebradas?|sequi[a-z]*|estiaj[a-z]*|graniz[a-z]*|tormentas?|deficit hidrico|caudales?|nivel (?:del|de los) rios?|temperatura del mar|calentamiento (?:del mar|del pacifico)|anomalia (?:termica|marina)|mar de fondo|motobombas?|olas? de calor)\b/;
const editorialPriority = sourceId => ['rpp','el-comercio'].includes(sourceId) ? 0 : 1;

function eligible(item, sources, region, now) {
  if (item?.kind!=='prensa' || typeof item.title!=='string' || !item.title.trim() || item.withdrawnAt || item.supersededBy) return;
  const source=sources.get(item.sourceId);
  if (!source || !source.name || !source.url || /\b(?:publirreportaje|contenido (?:patrocinado|auspiciado))\b/i.test(item.title)) return;
  if (!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/i.test(item.publishedAt || '')) return;
  const time=Date.parse(item.publishedAt);
  if (!Number.isFinite(time) || time>now || now-time>retention) return;
  const url=articleUrl(item.url,source.url);
  if (!url) return;
  const title=fold(item.title);
  const path=new URL(url).pathname.toLowerCase();
  const ensoReport = item.category==='Fenómeno El Niño' && /\b(?:el nino|la nina|enso)\b/.test(title);
  if (sports.test(title) || foreign.test(simple(title)) || /\/(?:mundo|internacional(?:es)?|deportes?|futbol|sports|world)\//.test(path) ||
      /\blluvias? de (?:goles|estrellas|criticas|elogios|aplausos|ofertas|premios|memes|comentarios|meteoritos|balas)\b/.test(title) || !(climate.test(title) || ensoReport)) return;
  const places=namedRegions(item);
  const publisher=publisherRegion(source,item);
  const peruScope=domestic.test(title) || /^\/(?:peru|lima)\//.test(path);
  if (!publisher && !places.length && !peruScope) return;
  // Source location is not evidence of the location of the story.
  if (region && !(places.length ? places.includes(region) : publisher===region)) return;
  const nationwide=/\b(?:todo el (?:pais|peru|litoral)|a nivel nacional|en todo el territorio nacional)\b/.test(fold(item.title));
  const literal=places.every(place=>(' '+simple(title)+' ').includes(' '+simple(place)+' '));
  const scope=places.length ? (literal?'La nota menciona ':'Referencia territorial · ')+places.join(', ') :
    publisher ? 'Medio de '+publisher+(nationwide?' · Cobertura nacional':' · Sin ubicación precisa en el titular') :
    'Cobertura de Perú · Sin región precisada';
  return {item,sourceId:source.id,source:source.name,publisher,places,scope,url,time,title:item.title.trim()};
}
export function selectPressGroups(panel, {region='',now=Date.now(),limit=3}={}) {
  const sources=new Map((panel?.sources || []).filter(s=>s.kind==='prensa').map(s=>[s.id,s]));
  const candidates=(panel?.items || []).map(item=>eligible(item,sources,region,+now)).filter(Boolean);
  const cases=new Map();
  for (const event of panel?.impacts?.events || []) {
    if (!event.corroborated || !event.id) continue;
    cases.set(event.url,event.id);
    for (const ref of event.evidence || []) if (ref.type==='documento') cases.set(ref.url,event.id);
  }
  const urls=new Set(),titles=new Set(),casesSeen=new Set();
  const latest=(a,b)=>b.time-a.time || a.url.localeCompare(b.url);
  function select(list, regional) {
    list.sort((a,b)=>regional
      ? Number(Boolean(b.places.length))-Number(Boolean(a.places.length)) || latest(a,b)
      : editorialPriority(a.sourceId)-editorialPriority(b.sourceId) || latest(a,b));
    const chosen=[],counts=new Map(),areas=new Set();
    for (const pass of [0,1,2]) {
      for (const candidate of list) {
        if (chosen.length>=limit) return chosen;
        const {sourceId,publisher,url,places,title}=candidate;
        const count=counts.get(sourceId) || 0;
        const area=places.join('|') || publisher;
        if (count>=2 || (pass<2 && count) || (pass===0 && areas.has(area) && (regional || editorialPriority(sourceId)>0))) continue;
        const key=titleKey(title,places),caseId=cases.get(url);
        if (urls.has(url) || titles.has(key) || (caseId && casesSeen.has(caseId))) continue;
        chosen.push(candidate);
        counts.set(sourceId,count+1);areas.add(area);urls.add(url);titles.add(key);
        if (caseId) casesSeen.add(caseId);
      }
    }
    return chosen;
  }
  // Each group owns its space. Keep duplicate articles out of both groups.
  const regional=select(candidates.filter(c=>c.publisher),true);
  const national=select(candidates.filter(c=>!c.publisher),false);
  return {regional,national};
}

const renders=new WeakMap();
function renderGroup(doc,list,state,rows,message,showRecord) {
  // An unrelated map update should not move focus from an article link.
  const key=JSON.stringify([message,Boolean(showRecord),rows.map(r=>[r.item.id,r.item.version,r.url,r.title,r.source,r.scope,r.time])]);
  if (renders.get(list)===key) return;
  renders.set(list,key);
  state.textContent=message;
  state.hidden=!message;
  const children=rows.map(r=>{
    const li=doc.createElement('li');
    const attribution=doc.createElement('p');
    attribution.className='regional-byline';
    const outlet=doc.createElement('strong');outlet.textContent=r.source;
    const time=doc.createElement('time');time.dateTime=r.item.publishedAt;time.textContent=displayDate.format(r.time)+' (Perú)';
    attribution.append(outlet,time);
    const headline=doc.createElement('a');
    headline.href=r.url;headline.target='_blank';headline.rel='noopener noreferrer';headline.textContent=r.title;
    const foot=doc.createElement('div');foot.className='regional-meta';
    const place=doc.createElement('span');place.textContent=r.scope;foot.append(place);
    if (showRecord) {
      const more=doc.createElement('button');
      more.type='button';more.textContent='Ver ficha';
      more.setAttribute('aria-label','Ver ficha de '+r.title);
      more.addEventListener('click',()=>showRecord(r.item));
      foot.append(more);
    }
    li.append(attribution,headline,foot);
    return li;
  });
  list.replaceChildren(...children);
}

export function renderRegionalPress({panel,region='',showRecord,now=Date.now(),document:doc=globalThis.document}={}) {
  const scope=doc?.getElementById('regionalPressScope');
  if (!scope) return;
  scope.textContent=region ? 'Selección de prensa para '+region+' · Últimas 72 horas.' : 'Cobertura periodística de las últimas 72 horas.';
  const groups=selectPressGroups(panel,{region,now});
  for (const [prefix,rows,media] of [['regional',groups.regional,'regionales'],['national',groups.national,'nacionales']]) {
    const list=doc.getElementById(prefix+'PressList'),state=doc.getElementById(prefix+'PressState');
    if (!list || !state) continue;
    const message=rows.length?'':!panel?'Aún no hay una edición disponible.':
      'Sin notas pertinentes de medios '+media+(region?' para '+region:'')+' con fecha y enlace verificables en las últimas 72 horas.';
    renderGroup(doc,list,state,rows,message,showRecord);
  }
}
