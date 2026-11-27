import {readFileSync} from 'node:fs';
import {decodeCoenHtml} from './coen-documentos.mjs';
import {detectsPersonalData} from './privacidad.mjs';

const origin = 'https://www.gob.pe';
const day = 86400000;
const catalog = JSON.parse(readFileSync(new URL('../public/atlas/territorios/catalogo.json',import.meta.url),'utf8'));
const issuers = [
  {slug:'munipiura', region:'Piura', regionId:'20', name:'Municipalidad Provincial de Piura'},
  {slug:'munitumbes', region:'Tumbes', regionId:'24', name:'Municipalidad Provincial de Tumbes'},
];
const sourceId = issuer => 'municipalidad-'+issuer.slug.slice(4);
const prefix = issuer => '/institucion/'+issuer.slug+'/noticias';
const fold = value => String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const clean = html => decodeCoenHtml(String(html || '').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
const relevant = /\b(?:lluvias?|precipitaci(?:on|ones)|pluvial(?:es)?|inund\w*|aneg\w*|huaicos?|huaycos?|desbord\w*|quebrada\w*|derrumbe\w*|deslizamiento\w*|oleajes?|aluvion\w*)\b/;
const hypothetical = /\b(?:simulacr\w*|simulacion|podri[an]+|podran?|evitar|preven(?:ir|cion|tiv\w*)|prepar\w*|anticip\w*|posibles?|riesgos? de|peligros? de|ante eventuales|pronostic\w*|se espera|en caso de|amenaz\w*|en el supuesto|no se (?:han? |habian? )?(?:registr|report|produj|confirm|detect)\w*|descart\w*|no (?:hubo|hay|existen|existieron|resultaron|quedaron)|no se (?:inundaron|inundo|desbordo|desbordaron|encontraron)|sin (?:danos|afectaci\w*|inundaci\w*)|(?:se )?(?:recordo|recordaron)|hace \d+ (?:meses|anos)|el ano pasado)\b/;
const direct = /\b(?:qued(?:o|aron) (?:totalmente |parcialmente )?(?:inundad\w*|anegad\w*|aislad\w*|interrumpid\w*)|se (?:inundo|inundaron|desbordo|desbordaron|anego|anegaron)|(?:calles?|viviendas?|vias?|carreteras?|sectores?|familias?) (?:resultaron |quedaron |fueron |estan )?(?:inundad\w*|anegad\w*|afectad\w*|aislad\w*)|(?:provoco|provocaron|causo|causaron|ocasiono|ocasionaron) (?:danos|inundaciones|anegamiento\w*|el colapso|el cierre)|(?:se registr(?:o|aron)|se report(?:o|aron)|se constat(?:o|aron)) (?:el )?(?:inundacion\w*|anegamiento\w*|desbord\w*|danos)|transito (?:vehicular )?(?:totalmente )?interrumpido|aguas? acumuladas?|(?:se realizaron|realizo|ejecuto) trabajos de evacuacion de aguas? pluviales?)\b/;
const inPeriod = (date,now) => Number.isFinite(Date.parse(date)) && Date.parse(date)<=+now && Date.parse(date)>=+now-7*day;

function articleUrl(raw, issuer) {
  try {
    const u=new URL(raw,origin);
    if (u.origin!==origin || u.search || u.hash || u.username || u.password ||
        !u.pathname.startsWith(prefix(issuer)+'/') || !/^\d{4,10}-[a-z0-9-]+$/.test(u.pathname.slice(prefix(issuer).length+1))) return;
    return u.href;
  } catch { return; }
}
function localStamp(y,m,d,h,minute) {
  if (!m || h>23 || minute>59) return;
  const date=[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
  const stamp=Date.parse(date+'T'+String(h).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00-05:00');
  if (Number.isFinite(stamp) && new Date(stamp-5*3600000).toISOString().slice(0,10)===date) return new Date(stamp).toISOString();
}
function articleDate(value) {
  const m=fold(value).match(/^(\d{1,2}) de ([a-z]+) de (20\d\d)\s*-\s*(\d{1,2}):(\d{2})\s*([ap])\.\s*m\.$/);
  if (!m || +m[4]<1 || +m[4]>12) return;
  return localStamp(m[3],months.indexOf(m[2].replace('setiembre','septiembre'))+1,m[1],+m[4]%12+(m[6]==='p'?12:0),+m[5]);
}

export function territorialIndex(html, issuer, now) {
  const records=new Map();
  let articles=0;
  for (const li of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const card=li[1];
    const heading=card.match(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const url=heading && articleUrl(heading[1],issuer);
    if (!url) continue;
    articles++;
    const title=clean(heading[2]), clock=card.match(/<time\b[^>]*\bdatetime="(20\d\d)-(\d\d)-(\d\d) (\d\d):(\d\d):\d\d(?:\.\d+)?"[^>]*>/i);
    const publishedAt=clock && localStamp(clock[1],+clock[2],+clock[3],+clock[4],+clock[5]);
    if (inPeriod(publishedAt,now) && relevant.test(fold(title)) && !detectsPersonalData(title))
      records.set(url,{url,title,publishedAt});
  }
  if (!articles && !/no se encontraron resultados|no hay resultados/i.test(clean(html))) throw Error('Índice municipal sin verificar');
  return [...records.values()];
}

function cleanSentence(text) {
  return text.length>=15 && text.length<=550 && !detectsPersonalData(text);
}
function factSentences(body) {
  if (!relevant.test(fold(body))) return [];
  return body.split(/(?<=[.!?])\s+(?=[¡¿A-ZÁÉÍÓÚÑ])/u).filter(sentence=>{
    const value=fold(sentence).replace(/gestion del riesgo de desastres/g,'');
    return cleanSentence(sentence) && direct.test(value) && !hypothetical.test(value);
  });
}
function placesFromFacts(facts,issuer) {
  const found={};
  for (const [key,type,tier] of [['province','provincia',catalog.provinces],['district','distrito',catalog.districts]]) {
    const names=new Set();
    for (const fact of facts) {
      for (const term of fold(fact).matchAll(new RegExp('\\b'+type+' de ','g'))) {
        const tail=fold(fact).slice(term.index+term[0].length);
        const matches=tier.filter(place => place.id.startsWith(issuer.regionId) && tail.startsWith(fold(place.name)) &&
          !/[a-z]/.test(tail[fold(place.name).length] || ' ')).sort((a,b)=>b.name.length-a.name.length);
        if (matches.length) names.add(matches[0].name);
      }
    }
    if (names.size===1) found[key]=[...names][0];
  }
  const localities=new Set();
  for (const fact of facts) {
    for (const m of fact.matchAll(/\b(?:en\s+(?:la |el )?|ubicad[ao]\s+en\s+(?:la |el )?|intervino\s+(?:la |el )?)(intersección de las avenidas|avenida|sector|barrio|urbanización|centro poblado)\s+([\p{Lu}][\p{L}'’.-]*(?:\s+(?:(?:y|de|del|la|los|las)\s+)*[\p{Lu}][\p{L}'’.-]*){0,7})/gu)) {
      const name=m[1]+' '+m[2].replace(/[.;]+$/,'');
      if (name.length<=85 && !detectsPersonalData(name)) localities.add(name);
    }
  }
  if (localities.size===1) found.locality=[...localities][0];
  if (localities.size) found.localities=[...localities];
  return found;
}

export function territorialArticle(html, candidate, issuer, now) {
  if (!articleUrl(candidate.url,issuer) || !inPeriod(candidate.publishedAt,now)) return;
  const title=clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const label=clean(html.match(/<\/h1>\s*([^<]{1,60})</i)?.[1]);
  const publicationType=['Nota de prensa','Comunicado','Nota informativa'].find(type=>fold(type)===fold(label));
  const bodyHtml=html.match(/<section\b[^>]*class="body"[^>]*>([\s\S]*?)<\/section>/i)?.[1];
  const date=[...html.matchAll(/<p\b[^>]*>([^<>]{10,90})<\/p>/gi)].map(m=>articleDate(clean(m[1]))).find(Boolean);
  if (!bodyHtml || !title || !publicationType || fold(title)!==fold(candidate.title) || !date || date!==candidate.publishedAt) throw Error('Publicación municipal sin validar');
  if (detectsPersonalData(title) || hypothetical.test(fold(title))) return;
  const body=clean(bodyHtml);
  const text=fold(body);
  // An issuer's seat does not establish the district or even prove that an external event happened locally.
  if (!text.includes(fold(issuer.name)) && !fold(title).includes(fold(issuer.region))) return;
  const foreign=catalog.departments.filter(d=>d.id!==issuer.regionId).some(d => new RegExp('\\b(?:(?:region|departamento) (?:de )?|en (?:la ciudad de )?)'+fold(d.name)+'\\b').test(text));
  if (foreign) return;
  const facts=factSentences(body);
  if (!facts.length) return;
  const places=placesFromFacts(facts,issuer);
  const localContext=places.localities?.length || places.district || places.province ||
    new RegExp('\\b(?:ciudad de '+fold(issuer.region)+'|nuestra (?:ciudad|provincia)|de la ciudad|en (?:la ciudad de )?'+fold(issuer.region)+')\\b').test(fold(title+' '+body));
  if (!localContext) return;
  const summary=facts.slice(0,2).join(' ');
  const id=sourceId(issuer)+':'+candidate.url.match(/\/noticias\/(\d+)-/)[1];
  return {id,sourceId:sourceId(issuer),source:issuer.name,title,url:candidate.url,regions:[issuer.region],region:issuer.region,
    ...places,category:/\boleaje/.test(text)?'Mar':/\bdesborde|\bdesbordo el rio/.test(fold(summary))?'Ríos':'Lluvias',
    publishedAt:date,datePrecision:'minute',summary,territorialReport:{type:'afectacion-observada',publicationType}};
}

export function localImpactFromItem(item) {
  const issuer=issuers.find(s=>sourceId(s)===item?.sourceId);
  if (!issuer || item?.territorialReport?.type!=='afectacion-observada' || !articleUrl(item.url,issuer) ||
      item.region!==issuer.region || !item.publishedAt || !Number.isFinite(Date.parse(item.publishedAt)) || !item.summary ||
      [item.summary,item.title,item.district,item.province,item.locality,...(Array.isArray(item.localities)?item.localities:[])].some(detectsPersonalData)) return;
  const {title,url,region,publishedAt:reportedAt,summary,province,district,locality,localities}=item;
  const source=issuer.name;
  return {source,title,url,region,reportedAt,summary,...(district&&{district}),...(province&&{province}),...(locality&&{locality}),
    ...(Array.isArray(localities)&&{localities}),layer:item.category==='Mar'?'mar':item.category==='Ríos'?'rios':'lluvias',
    timeline:[{at:reportedAt,text:'La municipalidad publicó el reporte de su intervención.',source,url}],
    evidence:[{type:'documento',label:'Publicación municipal original',url,source,date:reportedAt}]};
}

async function read(url,fetchImpl) {
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(6500),headers:{accept:'text/html'}});
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || Number(response.headers.get('content-length'))>600000) {
    await response.body?.cancel(); throw Error('Canal municipal temporalmente inaccesible');
  }
  const chunks=[]; let bytes=0;
  for await (const part of response.body) {
    bytes+=part.length;
    if (bytes>600000) throw Error('Página municipal demasiado grande');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function collect(issuer,{now=new Date(),previousItems=[],fetchImpl=fetch,onReading}={}) {
  const url=origin+prefix(issuer);
  const indexes=await Promise.allSettled([url,url+'?filter%5Bterms%5D=lluvias'].map(async u=>territorialIndex(await read(u,fetchImpl),issuer,now)));
  const ok=indexes.filter(r=>r.status==='fulfilled');
  if (!ok.length) throw Error('Índices municipales inaccesibles');
  const candidates=[...new Map(ok.flatMap(r=>r.value).map(c=>[c.url,c])).values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,5);
  const previous=new Map(previousItems.filter(i=>localImpactFromItem(i) && inPeriod(i.publishedAt,now)).map(i=>[i.url,i]));
  const documents=await Promise.allSettled(candidates.map(async c=>territorialArticle(await read(c.url,fetchImpl),c,issuer,now)));
  if (documents.length && documents.every(r=>r.status==='rejected')) throw Error('Publicaciones municipales inaccesibles');
  documents.forEach((result,i)=>{
    if (result.status==='rejected') return;
    previous.delete(candidates[i].url);
    if (result.value) previous.set(candidates[i].url,result.value);
  });
  if (onReading) onReading({territorialCoverage:{publisher:issuer.name,region:issuer.region,articlesChecked:candidates.length,
    incomplete:ok.length!==indexes.length || documents.some(r=>r.status==='rejected')}});
  return [...previous.values()];
}
export const partesTerritoriales=issuers.map(issuer=>({id:sourceId(issuer),name:issuer.name,
  url:origin+prefix(issuer),intervalMinutes:20,description:'Intervenciones y afectaciones hidrometeorológicas documentadas por la municipalidad.',
  fetchItems:options=>collect(issuer,options)}));
